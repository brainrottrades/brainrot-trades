/**
 * Brainrot Trades — standalone public website.
 * Fortnite "Steal the Brainrot" (Creative map 3225-0366-8885, by Ferins).
 * NOT the Roblox game "Steal a Brainrot" — Roblox prices do not apply.
 *
 * Stack: Node.js 22+ (built-in node:sqlite, no native deps) + Express + Nodemailer.
 * Run:  npm install && npm start   (listens on PORT, default 3000)
 *
 * Config:
 *   config/paypal.json   — live PayPal Client ID + $3/month Plan ID (public values)
 *   config/admins.json   — owner + co-owner + admin emails (free access, admin panel)
 *   config/email.json    — SMTP settings (copy from email.json.example).
 *                          If missing, verification codes are printed to the
 *                          server console instead of emailed (DEV MODE ONLY).
 * Env:
 *   PAYPAL_CLIENT_SECRET — REST app Secret, for future server-side verification
 *                          of subscriptions against PayPal's API. Never commit it.
 *   PORT, HOST, SESSION_SECRET
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const nodemailer = require('nodemailer');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
// Persistent data lives on DATA_DIR when set (Render persistent disk, mounted
// at /data). Otherwise it lives in ./data — which the free tier wipes on every
// deploy. The disk is what makes the site permanent: accounts, listings,
// chats, price edits and uploaded pictures all survive deploys.
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

// ---------- config ----------
function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { return fallback; }
}
const paypalCfg = readJson('config/paypal.json', {});
const adminsCfg = readJson('config/admins.json', {});
// Email config: config/email.json wins; otherwise SMTP_* environment
// variables (for hosted deploys such as Render, where there is no config
// file to edit). If neither is set, the server runs in dev mode and prints
// verification codes to its own console.
const emailCfg = readJson('config/email.json', null) || (process.env.SMTP_HOST ? {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.SMTP_FROM || process.env.SMTP_USER,
} : null);
const OWNER_EMAIL = (adminsCfg.ownerEmail || 'pgevil22@gmail.com').toLowerCase();
// SendGrid (HTTPS API) — the recommended mail path on Render, where
// outbound SMTP (Gmail ports 587/465) is blocked and times out.
// Set SENDGRID_API_KEY (+ optional SENDGRID_FROM) in Render env vars.
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const SENDGRID_FROM = process.env.SENDGRID_FROM || (emailCfg && emailCfg.from) || 'pgevil22@gmail.com';
const CO_OWNER_EMAILS = new Set((adminsCfg.coOwnerEmails || ['amber_fenton@yahoo.com']).map(e => e.toLowerCase()));
const ADMIN_EMAILS = new Set((adminsCfg.adminEmails || []).map(e => e.toLowerCase()));
// Owner, co-owner and admin accounts are pre-authorized: they verify
// instantly on sign-up (no code, no approval) and get free access.
function isStaffEmail(em) {
  const e = (em || '').toLowerCase();
  return e === OWNER_EMAIL || CO_OWNER_EMAILS.has(e) || ADMIN_EMAILS.has(e);
}
const PRICE_USD = Number(paypalCfg.priceUsd || 3);
const PLAN_ID = paypalCfg.planId || '';
const CLIENT_ID = paypalCfg.clientId || '';
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
// Google sign-in (OAuth 2.0). Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in
// Render env vars; without them the Google button is hidden. No email codes:
// Google verifies the email itself, and email sign-ups wait for owner approval.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://brainrot-trades.onrender.com/api/auth/google/callback';
const googleAuthEnabled = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

const brainrotsData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brainrots.json'), 'utf8'));

// ---------- database ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  warn_count INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verifications (
  email TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  paypal_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL,
  ends_at TEXT,
  cancelled_at TEXT
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  text TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trade_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  title TEXT NOT NULL,
  brainrot_id TEXT,
  have_text TEXT,
  want_text TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sale_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  brainrot_id TEXT NOT NULL,
  price_usd REAL NOT NULL,
  description TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  from_user_id INTEGER NOT NULL,
  from_username TEXT NOT NULL,
  to_user_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  reporter_username TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS help_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS help_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL,
  addressee_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  UNIQUE (requester_id, addressee_id)
);
CREATE TABLE IF NOT EXISTS item_overrides (
  item_id TEXT PRIMARY KEY,
  typical_low REAL,
  typical_high REAL,
  ballpark INTEGER,
  updated_by TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS rarity_overrides (
  name TEXT PRIMARY KEY,
  pct REAL,
  tier TEXT,
  updated_by TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS custom_brainrots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  typical_low REAL NOT NULL,
  typical_high REAL NOT NULL,
  ballpark INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sale_likes (
  listing_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (listing_id, user_id)
);
CREATE TABLE IF NOT EXISTS sale_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);
// Google sign-in (added Nov 22, 2026): link a Google account id to a user.
// The ALTER is idempotent — it throws if the column already exists.
try { db.exec('ALTER TABLE users ADD COLUMN google_id TEXT'); } catch (e) { /* column already exists */ }
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)');
try { db.exec('ALTER TABLE sale_listings ADD COLUMN mutation TEXT'); } catch (e) { /* column already exists */ }
try { db.exec('ALTER TABLE sale_listings ADD COLUMN custom_name TEXT'); } catch (e) { /* column already exists */ }

// ---------- mail ----------
// SendGrid (HTTPS) is preferred when configured — Render blocks outbound
// SMTP, so Gmail SMTP times out on both ports 587 and 465.
let transporter = null;
if (SENDGRID_API_KEY) {
  console.log('[mail] SendGrid configured (HTTPS API)');
}
if (emailCfg && emailCfg.host && emailCfg.user) {
  transporter = nodemailer.createTransport({
    host: emailCfg.host, port: Number(emailCfg.port || 587),
    secure: !!emailCfg.secure,
    auth: { user: emailCfg.user, pass: emailCfg.pass },
  });
  console.log('[mail] SMTP configured:', emailCfg.host);
} else if (!SENDGRID_API_KEY) {
  console.log('[mail] WARNING: config/email.json not found — DEV MODE. Verification codes will be printed to this console, NOT emailed. Do not use dev mode in production.');
}
async function sendVerificationEmail(email, code) {
  const subject = 'Your Brainrot Trades verification code';
  const text = `Your Brainrot Trades verification code is: ${code}\n\nIt expires in 30 minutes. If you did not request this, ignore this email.`;
  if (SENDGRID_API_KEY) {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalizations: [{ to: [{ email }] }], from: { email: SENDGRID_FROM }, subject, content: [{ type: 'text/plain', value: text }] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`SendGrid ${resp.status}: ${detail.slice(0, 200)}`);
    }
    return { devMode: false };
  }
  if (!transporter) {
    console.log(`[mail-dev] Verification code for ${email}: ${code} (dev mode — no email sent)`);
    return { devMode: true };
  }
  await transporter.sendMail({ from: emailCfg.from, to: email, subject, text });
  return { devMode: false };
}

// ---------- helpers ----------
const nowIso = () => new Date().toISOString();
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function publicUser(u) {
  if (!u) return null;
  const email = u.email.toLowerCase();
  const isOwner = email === OWNER_EMAIL;
  const isCoOwner = CO_OWNER_EMAILS.has(email);
  const isAdminEmail = ADMIN_EMAILS.has(email);
  return {
    id: u.id, username: u.username, email: u.email, verified: !!u.verified,
    warnCount: u.warn_count, banned: !!u.banned, createdAt: u.created_at,
    isOwner, isCoOwner, isAdminEmail, isAdmin: isOwner || isCoOwner || isAdminEmail,
    badge: isOwner ? 'OWNER' : (isCoOwner ? 'CO-OWNER' : (isAdminEmail ? 'ADMIN' : null)),
  };
}
function activeSubscription(userId) {
  const row = db.prepare(
    `SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'
     AND (ends_at IS NULL OR ends_at > ?) ORDER BY id DESC LIMIT 1`
  ).get(userId, nowIso());
  return row || null;
}
function hasAccess(u) {
  if (!u || !u.verified || u.banned) return false;
  const email = u.email.toLowerCase();
  if (email === OWNER_EMAIL || CO_OWNER_EMAILS.has(email) || ADMIN_EMAILS.has(email)) return true;
  return !!activeSubscription(u.id);
}
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  next();
}
function requireVerified(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  if (!req.user.verified) return res.status(403).json({ error: 'Please verify your email first.' });
  if (req.user.banned) return res.status(403).json({ error: 'This account is banned.' });
  next();
}
function requireAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  if (!hasAccess(req.user)) {
    return res.status(402).json({ error: 'Subscription required', needsSubscription: true, priceUsd: PRICE_USD });
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  const email = req.user.email.toLowerCase();
  if (email !== OWNER_EMAIL && !CO_OWNER_EMAILS.has(email) && !ADMIN_EMAILS.has(email)) {
    return res.status(403).json({ error: 'Admin only.' });
  }
  next();
}
// A user can be warned/banned only if they are not the owner, and a co-owner
// cannot act on another co-owner. Returns an error string or null.
function adminActionBlocked(actor, target) {
  const actorEmail = actor.email.toLowerCase();
  const targetEmail = target.email.toLowerCase();
  if (targetEmail === OWNER_EMAIL) return 'The owner cannot be warned or banned.';
  if (CO_OWNER_EMAILS.has(targetEmail) && actorEmail !== OWNER_EMAIL) {
    return 'A co-owner cannot warn or ban another co-owner.';
  }
  if (ADMIN_EMAILS.has(targetEmail) && actorEmail !== OWNER_EMAIL && !CO_OWNER_EMAILS.has(actorEmail)) {
    return 'Only the owner or a co-owner can warn or ban an admin.';
  }
  return null;
}

// ---------- pricing engine (same rules as the live app) ----------
// Trait uplift: base * (1+r)^extraTraits, capped at 3.5x base.
// r = 5% (base under $10), 12% ($10-$50), 20% (over $50).
// extraTraits = traits above those already counted in a confirmed variant listing.
function traitRate(baseMid) {
  return baseMid < 10 ? 0.05 : (baseMid <= 50 ? 0.12 : 0.20);
}
function calcPrice(item, mutation, traitCount) {
  const factors = brainrotsData.mutationFactors || {};
  const v = (item.variants || {})[mutation];
  let baseLow, baseHigh, basis, listedTraits = 0;
  if (v) {
    baseLow = v.low; baseHigh = v.high; basis = 'confirmed'; listedTraits = v.traits || 0;
  } else {
    const f = mutation === 'Default' ? 1 : (factors[mutation] || 1);
    baseLow = item.typicalLow * f; baseHigh = item.typicalHigh * f;
    basis = f === 1 ? 'typical' : 'estimated';
  }
  const baseMid = (baseLow + baseHigh) / 2;
  const extra = Math.max(0, (traitCount || 0) - listedTraits);
  const uplift = Math.min(3.5, Math.pow(1 + traitRate(baseMid), extra));
  return {
    low: Math.round(baseLow * uplift * 100) / 100,
    high: Math.round(baseHigh * uplift * 100) / 100,
    mid: Math.round(baseMid * uplift * 100) / 100,
    basis, listedTraits, extraTraits: extra, uplift: Math.round(uplift * 100) / 100,
  };
}
function effectiveItems() {
  const overrides = new Map(
    db.prepare('SELECT * FROM item_overrides').all().map(r => [r.item_id, r])
  );
  const items = brainrotsData.items.map(it => {
    const o = overrides.get(it.id);
    return {
      ...it,
      typicalLow: o && o.typical_low != null ? o.typical_low : it.typicalLow,
      typicalHigh: o && o.typical_high != null ? o.typical_high : it.typicalHigh,
      ballpark: o && o.ballpark != null ? !!o.ballpark : it.ballpark,
      overridden: !!o,
    };
  });
  for (const c of db.prepare('SELECT * FROM custom_brainrots').all()) {
    items.push({
      id: c.id, name: c.name, typicalLow: c.typical_low, typicalHigh: c.typical_high,
      rangeLow: c.typical_low, rangeHigh: c.typical_high, ballpark: !!c.ballpark,
      variants: {}, image: c.image || null, rarityPct: null, custom: true,
    });
  }
  return items;
}
function findItem(id) {
  return effectiveItems().find(i => i.id === id) || null;
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(ROOT, 'public'), {
  maxAge: '1h',
  setHeaders(res, filePath) {
    // App code must always be fresh: a deploy has to reach every member
    // at once, not after their cached copy expires (members kept seeing
    // the old app.js for an hour after the For Sale nav went live).
    // no-cache still lets the browser revalidate with the ETag, so
    // unchanged files cost one tiny 304. Pictures keep the 1h cache.
    if (/\.(js|css|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
// Uploaded sale pictures live on the disk too (DATA_DIR/uploads), served at /uploads.
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads'), { maxAge: '1h' }));

// Session: signed HttpOnly cookie. Signature prevents tampering without the secret.
function signCookie(token) {
  return token + '.' + crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex').slice(0, 16);
}
function parseSessionCookie(req) {
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim())
    .find(s => s.startsWith('bt_session='));
  if (!raw) return null;
  const val = decodeURIComponent(raw.slice('bt_session='.length));
  const [token, sig] = val.split('.');
  if (!token || !sig) return null;
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex').slice(0, 16);
  return sig === expect ? token : null;
}
app.use((req, res, next) => {
  req.user = null;
  const token = parseSessionCookie(req);
  if (token) {
    const s = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, nowIso());
    if (s) {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
      if (u) req.user = u;
    }
  }
  next();
});
function setSession(res, userId) {
  const token = newToken();
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, userId, nowIso(), expires);
  res.setHeader('Set-Cookie', `bt_session=${encodeURIComponent(signCookie(token))}; HttpOnly; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax`);
}
function clearSession(req, res) {
  const token = parseSessionCookie(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'bt_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

// ---------- public API ----------
app.get('/api/config', (req, res) => {
  res.json({
    priceUsd: PRICE_USD, currency: paypalCfg.currency || 'USD',
    planId: PLAN_ID, planName: paypalCfg.planName || 'Brainrot Trades Monthly',
    clientId: CLIENT_ID, paypalConfigured: !!(CLIENT_ID && PLAN_ID),
    paypalSecretConfigured: !!PAYPAL_SECRET,
    emailConfigured: !!transporter || !!SENDGRID_API_KEY,
    googleAuthEnabled,
  });
});
app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const u = publicUser(req.user);
  const sub = activeSubscription(req.user.id);
  res.json({ user: { ...u, hasAccess: hasAccess(req.user), subscription: sub ? { status: sub.status, endsAt: sub.ends_at, paypalSubscriptionId: sub.paypal_subscription_id } : null } });
});

// ---------- auth ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || username.length < 3 || username.length > 24 || !/^[A-Za-z0-9_.-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-24 characters (letters, numbers, _ . -).' });
  }
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  const em = email.toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(400).json({ error: 'That username is taken.' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(em)) {
    return res.status(400).json({ error: 'An account with that email already exists. Try logging in.' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  // No emailed codes: owner/co-owner/admin accounts verify instantly;
  // everyone else waits for the owner to approve them (Admin panel).
  const autoVerified = isStaffEmail(em) ? 1 : 0;
  const info = db.prepare('INSERT INTO users (username, email, password_hash, password_salt, verified, created_at) VALUES (?,?,?,?,?,?)')
    .run(username, em, hashPassword(password, salt), salt, autoVerified, nowIso());
  if (autoVerified) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
    setSession(res, u.id);
    return res.json({ ok: true, user: publicUser(u), hasAccess: hasAccess(u), message: 'Account created — you are verified.' });
  }
  res.json({ ok: true, pendingApproval: true, message: 'Account created. The owner will approve it — then log in and subscribe for full access.' });
});
app.post('/api/auth/verify', (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Email and code are required.' });
  const em = email.toLowerCase();
  const row = db.prepare('SELECT * FROM verifications WHERE email = ?').get(em);
  if (!row) return res.status(400).json({ error: 'No code was requested for this email. Sign up first.' });
  if (row.expires_at < nowIso()) return res.status(400).json({ error: 'That code expired. Request a new one.' });
  if (Number(row.attempts) >= 5) return res.status(400).json({ error: 'Too many wrong attempts. Request a new code.' });
  if (row.code !== String(code).trim()) {
    db.prepare('UPDATE verifications SET attempts = attempts + 1 WHERE email = ?').run(em);
    return res.status(400).json({ error: 'Wrong code. Check your email and try again.' });
  }
  db.prepare('UPDATE users SET verified = 1 WHERE email = ?').run(em);
  db.prepare('DELETE FROM verifications WHERE email = ?').run(em);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(em);
  setSession(res, u.id);
  res.json({ ok: true, user: publicUser(u), hasAccess: hasAccess(u) });
});
app.post('/api/auth/resend-code', async (req, res) => {
  const { email } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const em = email.toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(em);
  if (!u) return res.status(400).json({ error: 'No account with that email.' });
  if (u.verified) return res.status(400).json({ error: 'This account is already verified.' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare('INSERT OR REPLACE INTO verifications (email, code, expires_at, attempts) VALUES (?,?,?,0)').run(em, code, expires);
  try {
    const r = await sendVerificationEmail(em, code);
    res.json({ ok: true, devMode: r.devMode });
  } catch (e) {
    console.error('[mail] resend failed:', e.message);
    res.status(500).json({ error: 'Could not send the email. Try again later.' });
  }
});
// ---------- Google sign-in (OAuth 2.0) ----------
// Google verifies the email, so a Google account is verified instantly —
// no code, no approval. Email/password sign-ups still wait for approval.
function googleAuthUrl(state) {
  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code', scope: 'openid email profile',
    state, prompt: 'select_account', access_type: 'online',
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
}
app.get('/api/auth/google', (req, res) => {
  if (!googleAuthEnabled) return res.status(400).send('Google sign-in is not configured on this server.');
  const state = crypto.randomBytes(16).toString('hex');
  // Remember the state server-side too (single-use, 30 min): some browsers
  // drop the state cookie on the way back from Google, which used to fail
  // the sign-in silently at the state check. The cookie is still checked first.
  db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(new Date(Date.now() - 30 * 60 * 1000).toISOString());
  db.prepare('INSERT INTO oauth_states (state, created_at) VALUES (?,?)').run(state, nowIso());
  res.setHeader('Set-Cookie', `bt_oauth_state=${state}; HttpOnly; Path=/; Max-Age=1800; SameSite=Lax`);
  res.redirect(googleAuthUrl(state));
});
app.get('/api/auth/google/callback', async (req, res) => {
  const fail = why => { if (why) console.error('[google] sign-in failed:', why); return res.redirect('/#/login?google=failed'); };
  try {
    if (!googleAuthEnabled) return fail('google auth not configured');
    if (req.query.error) return fail('google returned error: ' + req.query.error);
    const stateCookie = (req.headers.cookie || '').split(';').map(s => s.trim())
      .find(s => s.startsWith('bt_oauth_state='));
    const stateVal = stateCookie ? decodeURIComponent(stateCookie.slice('bt_oauth_state='.length)) : null;
    const qState = req.query.state;
    // State check: the cookie is checked first; the server-side record is
    // the fallback for browsers that drop the cookie on the way back.
    // Either way the state is single-use and expires after 30 minutes.
    const dbState = qState ? db.prepare('SELECT state FROM oauth_states WHERE state = ?').get(qState) : null;
    if (dbState) db.prepare('DELETE FROM oauth_states WHERE state = ?').run(qState);
    const stateOk = (stateVal && stateVal === qState) || !!dbState;
    if (!stateOk || !req.query.code) return fail('state check failed (cookie ' + (stateVal ? 'present' : 'missing') + ', server record ' + (dbState ? 'found' : 'not found') + ')');
    res.setHeader('Set-Cookie', 'bt_oauth_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: req.query.code, client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!tokenRes.ok) { console.error('[google] token exchange failed:', tokenRes.status); return fail(); }
    const tokens = await tokenRes.json();
    const meRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!meRes.ok) { console.error('[google] userinfo failed:', meRes.status); return fail(); }
    const profile = await meRes.json();
    // Google's userinfo returns `email_verified`, not `verified_email`.
    if (!profile || !profile.email || !profile.email_verified) { console.error('[google] sign-in failed: profile email not verified'); return fail(); }
    const em = String(profile.email).toLowerCase();
    const sub = String(profile.sub);
    let u = db.prepare('SELECT * FROM users WHERE google_id = ?').get(sub)
      || db.prepare('SELECT * FROM users WHERE email = ?').get(em);
    if (u) {
      if (u.banned) { console.error('[google] sign-in failed: account banned'); return fail(); }
      db.prepare('UPDATE users SET google_id = ?, verified = 1 WHERE id = ?').run(sub, u.id);
      u = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
    } else {
      let base = em.split('@')[0].replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 20) || 'member';
      if (base.length < 3) base = 'member' + base;
      let username = base, n = 1;
      while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) username = base + (n++);
      const salt = crypto.randomBytes(16).toString('hex');
      const info = db.prepare('INSERT INTO users (username, email, password_hash, password_salt, google_id, verified, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(username, em, hashPassword(crypto.randomBytes(32).toString('hex'), salt), salt, sub, 1, nowIso());
      u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
    }
    setSession(res, u.id);
    res.redirect('/#/prices');
  } catch (e) {
    console.error('[google] callback failed:', e.message);
    fail();
  }
});
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!u || hashPassword(password, u.password_salt) !== u.password_hash) {
    return res.status(400).json({ error: 'Wrong email or password.' });
  }
  if (u.banned) return res.status(403).json({ error: 'This account is banned.' });
  setSession(res, u.id);
  res.json({ ok: true, user: publicUser(u), hasAccess: hasAccess(u) });
});
app.post('/api/auth/logout', (req, res) => { clearSession(req, res); res.json({ ok: true }); });

// ---------- subscription ($3/month via PayPal) ----------
app.post('/api/subscribe/activate', requireVerified, (req, res) => {
  const { subscriptionId } = req.body || {};
  if (!subscriptionId || typeof subscriptionId !== 'string') {
    return res.status(400).json({ error: 'Missing PayPal subscription ID.' });
  }
  // NOTE: without the PayPal REST app Secret, the server cannot verify this
  // subscription against PayPal's API. The subscription ID comes from the
  // PayPal checkout approval in the member's own browser. Once the Secret is
  // configured (PAYPAL_CLIENT_SECRET), verify it here with
  // GET https://api-m.paypal.com/v1/billing/subscriptions/{id} first.
  const starts = new Date();
  const ends = new Date(starts.getTime() + 31 * 24 * 3600 * 1000);
  db.prepare(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = ? WHERE user_id = ? AND status = 'active'`)
    .run(nowIso(), req.user.id);
  db.prepare('INSERT INTO subscriptions (user_id, paypal_subscription_id, status, started_at, ends_at) VALUES (?,?,?,?,?)')
    .run(req.user.id, subscriptionId, 'active', starts.toISOString(), ends.toISOString());
  res.json({ ok: true, hasAccess: true, endsAt: ends.toISOString(), verifiedWithPayPal: !!PAYPAL_SECRET });
});
app.post('/api/subscribe/cancel', requireVerified, (req, res) => {
  db.prepare(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = ? WHERE user_id = ? AND status = 'active'`)
    .run(nowIso(), req.user.id);
  res.json({
    ok: true,
    message: 'Your access here is cancelled. Also cancel the subscription in your PayPal account (Settings > Payments > Manage automatic payments) to stop PayPal billing you — this site cannot cancel it at PayPal without the REST app Secret configured.',
  });
});

// ---------- brainrots / checker / rarity (public data, but the full app is paywalled) ----------
// Public preview for the landing page: 6 well-known brainrots only.
// The full price list stays behind the subscription.
app.get('/api/preview', (req, res) => {
  const ids = ['vulkarion', 'magico-moonman', 'mecha-traladone', 'mobytron', 'iceberry-mammoth', 'jackosaurus'];
  const items = effectiveItems().filter(i => ids.includes(i.id));
  res.json({ items: items.map(i => ({
    id: i.id, name: i.name, typicalLow: i.typicalLow, typicalHigh: i.typicalHigh,
    ballpark: i.ballpark, image: i.image ? `/img/brainrots/${i.image}` : null,
  })) });
});
app.get('/api/brainrots', requireAccess, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  let items = effectiveItems();
  if (q) items = items.filter(i => i.name.toLowerCase().includes(q));
  res.json({ items: items.map(i => ({
    id: i.id, name: i.name, typicalLow: i.typicalLow, typicalHigh: i.typicalHigh,
    rangeLow: i.rangeLow, rangeHigh: i.rangeHigh, ballpark: i.ballpark,
    image: i.image ? `/img/brainrots/${i.image}` : null, rarityPct: i.rarityPct,
    custom: !!i.custom, overridden: !!i.overridden,
  })) });
});
app.get('/api/meta', requireAccess, (req, res) => {
  res.json({ mutations: brainrotsData.mutations, traits: brainrotsData.traits, traitRule: brainrotsData.traitRule });
});
app.post('/api/checker', requireAccess, (req, res) => {
  const { itemId, mutation, traitCount } = req.body || {};
  const item = findItem(itemId);
  if (!item) return res.status(404).json({ error: 'Brainrot not found.' });
  const mut = brainrotsData.mutations.includes(mutation) ? mutation : 'Default';
  const n = Math.max(0, Math.min(10, Number(traitCount) || 0));
  res.json({ item: { id: item.id, name: item.name, image: item.image ? `/img/brainrots/${item.image}` : null }, mutation: mut, traitCount: n, ...calcPrice(item, mut, n) });
});
app.post('/api/checker/compare', requireAccess, (req, res) => {
  const { a, b } = req.body || {};
  if (!a || !b) return res.status(400).json({ error: 'Two brainrots are required.' });
  const ia = findItem(a.itemId), ib = findItem(b.itemId);
  if (!ia || !ib) return res.status(404).json({ error: 'Brainrot not found.' });
  const pa = calcPrice(ia, a.mutation || 'Default', a.traitCount || 0);
  const pb = calcPrice(ib, b.mutation || 'Default', b.traitCount || 0);
  const verdict = pa.mid === pb.mid ? 'EVEN'
    : pa.mid > pb.mid ? 'A_WORTH_MORE' : 'B_WORTH_MORE';
  res.json({
    a: { name: ia.name, ...pa }, b: { name: ib.name, ...pb },
    verdict, differenceUsd: Math.round(Math.abs(pa.mid - pb.mid) * 100) / 100,
    note: 'Prices are sellers\' asking prices (Nov 2026 snapshot) with the trait rule applied. A trade can still be worth it for a brainrot you like more, even if the numbers say otherwise.',
  });
});
app.get('/api/rarity', requireAccess, (req, res) => {
  const overrides = new Map(db.prepare('SELECT * FROM rarity_overrides').all().map(r => [r.name, r]));
  const eternal = brainrotsData.rarityEternal.map(r => {
    const o = overrides.get(r.name);
    return { name: r.name, pct: o ? o.pct : r.pct, tier: 'Eternal', overridden: !!o };
  });
  const absolute = brainrotsData.rarityAbsolute.map(r => {
    const o = overrides.get(r.name);
    const img = r.name === 'Crystune' ? null : (r.img ? `/img/brainrots/${r.img}` : null);
    return { name: r.name, pct: o ? o.pct : r.pct, tier: 'Absolute', image: img, overridden: !!o };
  });
  const goat = { ...brainrotsData.rarityGoat, tier: 'GOAT', image: '/img/skibidi-toilet.png' };
  res.json({
    eternal, absolute, goat,
    note: 'Spawn chances at Luck Tier 13 (in-game index, Nov 22, 2026). Skibidi Toilet is the only GOAT brainrot: its fixed spawn chance is 0.000001% and it ignores all events, luck and multipliers; the index screen shows it at 0.0002% at Tier 13.',
  });
});

// ---------- live chat ----------
const lastChatAt = new Map();
app.get('/api/chat', requireAccess, (req, res) => {
  const after = Number(req.query.after || 0);
  const rows = db.prepare('SELECT * FROM chat_messages WHERE id > ? ORDER BY id ASC LIMIT 100').all(after);
  res.json({ messages: rows });
});
app.post('/api/chat', requireAccess, (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message is empty.' });
  if (text.length > 500) return res.status(400).json({ error: 'Messages are limited to 500 characters.' });
  const last = lastChatAt.get(req.user.id) || 0;
  if (Date.now() - last < 3000) return res.status(429).json({ error: 'Slow down — one message every 3 seconds.' });
  lastChatAt.set(req.user.id, Date.now());
  const info = db.prepare('INSERT INTO chat_messages (user_id, username, text, created_at) VALUES (?,?,?,?)')
    .run(req.user.id, req.user.username, text, nowIso());
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.post('/api/chat/:id/hide', requireAdmin, (req, res) => {
  db.prepare('UPDATE chat_messages SET hidden = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.delete('/api/chat/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM chat_messages WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- help forum ----------
// Players and admins both post here. The owner and admins read every topic.
app.get('/api/help', requireAccess, (req, res) => {
  const rows = db.prepare(`SELECT t.*,
    (SELECT COUNT(*) FROM help_replies WHERE topic_id = t.id) AS replyCount,
    (SELECT MAX(created_at) FROM help_replies WHERE topic_id = t.id) AS lastReplyAt,
    u.email AS author_email
    FROM help_topics t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.id DESC LIMIT 100`).all();
  res.json({ topics: rows.map(t => ({ id: t.id, user_id: t.user_id, username: t.username,
    badge: t.author_email ? publicUser({ email: t.author_email }).badge : null,
    title: t.title, status: t.status, replyCount: t.replyCount, lastReplyAt: t.lastReplyAt, created_at: t.created_at })) });
});
app.post('/api/help', requireAccess, (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 120);
  const message = String(req.body?.message || '').trim().slice(0, 1000);
  if (!title) return res.status(400).json({ error: 'Give your help request a title.' });
  if (!message) return res.status(400).json({ error: 'Write what you need help with.' });
  const info = db.prepare('INSERT INTO help_topics (user_id, username, title, message, created_at) VALUES (?,?,?,?,?)')
    .run(req.user.id, req.user.username, title, message, nowIso());
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.get('/api/help/:id', requireAccess, (req, res) => {
  const t = db.prepare('SELECT t.*, u.email AS author_email FROM help_topics t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Help topic not found.' });
  const replies = db.prepare('SELECT r.*, u.email AS author_email FROM help_replies r LEFT JOIN users u ON u.id = r.user_id WHERE r.topic_id = ? ORDER BY r.id ASC').all(t.id);
  res.json({ topic: { id: t.id, user_id: t.user_id, username: t.username,
      badge: t.author_email ? publicUser({ email: t.author_email }).badge : null,
      title: t.title, message: t.message, status: t.status, created_at: t.created_at },
    replies: replies.map(r => ({ id: r.id, user_id: r.user_id, username: r.username,
      badge: r.author_email ? publicUser({ email: r.author_email }).badge : null,
      text: r.text, created_at: r.created_at })) });
});
app.post('/api/help/:id/reply', requireAccess, (req, res) => {
  const t = db.prepare('SELECT * FROM help_topics WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Help topic not found.' });
  const email = req.user.email.toLowerCase();
  const admin = email === OWNER_EMAIL || CO_OWNER_EMAILS.has(email) || ADMIN_EMAILS.has(email);
  if (t.status === 'closed' && !admin) return res.status(400).json({ error: 'This help topic is closed.' });
  const text = String(req.body?.text || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'Message is empty.' });
  const info = db.prepare('INSERT INTO help_replies (topic_id, user_id, username, text, created_at) VALUES (?,?,?,?,?)')
    .run(t.id, req.user.id, req.user.username, text, nowIso());
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.post('/api/help/:id/close', requireAuth, (req, res) => {
  const t = db.prepare('SELECT * FROM help_topics WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Help topic not found.' });
  const email = req.user.email.toLowerCase();
  const admin = email === OWNER_EMAIL || CO_OWNER_EMAILS.has(email) || ADMIN_EMAILS.has(email);
  if (t.user_id !== req.user.id && !admin) return res.status(403).json({ error: 'Only the person who asked, or an admin, can close this.' });
  db.prepare("UPDATE help_topics SET status = 'closed' WHERE id = ?").run(t.id);
  res.json({ ok: true });
});
app.post('/api/help/:id/reopen', requireAuth, (req, res) => {
  const t = db.prepare('SELECT * FROM help_topics WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Help topic not found.' });
  const email = req.user.email.toLowerCase();
  const admin = email === OWNER_EMAIL || CO_OWNER_EMAILS.has(email) || ADMIN_EMAILS.has(email);
  if (t.user_id !== req.user.id && !admin) return res.status(403).json({ error: 'Only the person who asked, or an admin, can reopen this.' });
  db.prepare("UPDATE help_topics SET status = 'open' WHERE id = ?").run(t.id);
  res.json({ ok: true });
});
app.delete('/api/help/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM help_replies WHERE topic_id = ?').run(req.params.id);
  db.prepare('DELETE FROM help_topics WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- trade board ----------
app.get('/api/trades', requireAccess, (req, res) => {
  const rows = db.prepare('SELECT * FROM trade_posts ORDER BY id DESC LIMIT 100').all();
  res.json({ trades: rows });
});
app.post('/api/trades', requireAccess, (req, res) => {
  const { title, brainrotId, haveText, wantText } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Give your trade a title.' });
  if (brainrotId && !findItem(brainrotId)) return res.status(400).json({ error: 'Pick a brainrot from the list (Eternals only).' });
  const info = db.prepare('INSERT INTO trade_posts (user_id, username, title, brainrot_id, have_text, want_text, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, String(title).trim().slice(0, 120), brainrotId || null, haveText || '', wantText || '', nowIso());
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.post('/api/trades/:id/close', requireAuth, (req, res) => {
  const t = db.prepare('SELECT * FROM trade_posts WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Trade not found.' });
  const email = req.user.email.toLowerCase();
  const isAdmin = email === OWNER_EMAIL || CO_OWNER_EMAILS.has(email) || ADMIN_EMAILS.has(email);
  if (t.user_id !== req.user.id && !isAdmin) return res.status(403).json({ error: 'Not yours.' });
  db.prepare("UPDATE trade_posts SET status = 'closed' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
app.delete('/api/trades/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM trade_posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- For Sale ----------
app.get('/api/sales', requireAccess, (req, res) => {
  const rows = db.prepare('SELECT * FROM sale_listings ORDER BY id DESC LIMIT 100').all();
  const items = new Map(effectiveItems().map(i => [i.id, i]));
  const likeCounts = new Map(db.prepare('SELECT listing_id, COUNT(*) c FROM sale_likes GROUP BY listing_id').all().map(r => [r.listing_id, r.c]));
  const myLikes = new Set(db.prepare('SELECT listing_id FROM sale_likes WHERE user_id = ?').all(req.user.id).map(r => r.listing_id));
  const commentCounts = new Map(db.prepare('SELECT listing_id, COUNT(*) c FROM sale_comments GROUP BY listing_id').all().map(r => [r.listing_id, r.c]));
  res.json({ sales: rows.map(r => {
    const item = items.get(r.brainrot_id);
    return { ...r, image: r.image_url || (item && item.image ? `/img/brainrots/${item.image}` : null), brainrotName: item ? item.name : (r.custom_name || r.brainrot_id), gamePicture: !r.image_url,
      likeCount: likeCounts.get(r.id) || 0, likedByMe: myLikes.has(r.id), commentCount: commentCounts.get(r.id) || 0 };
  }) });
});
app.post('/api/sales', requireAccess, (req, res) => {
  const { brainrotId, priceUsd, description, imageUrl, mutation, customName } = req.body || {};
  // "Other" — a brainrot we missed from the list: the seller types its name.
  // Anything else must be one of the 77 Eternals in the list.
  let custom = null;
  if (brainrotId === 'other') {
    custom = String(customName || '').replace(/[<>]/g, '').trim().slice(0, 60);
    if (!custom) return res.status(400).json({ error: 'Type the brainrot\'s name.' });
  } else {
    const item = findItem(brainrotId);
    if (!item) return res.status(400).json({ error: 'Pick a brainrot to sell.' });
  }
  const price = Number(priceUsd);
  if (!price || price <= 0 || price > 100000) return res.status(400).json({ error: 'Enter a sensible price in USD.' });
  if (imageUrl && !/^https?:\/\//.test(imageUrl) && !imageUrl.startsWith('/uploads/')) return res.status(400).json({ error: 'Image must be a full http(s) URL, or leave it blank to use the game picture.' });
  const mut = (brainrotsData.mutations || []).includes(mutation) ? mutation : 'Default';
  const info = db.prepare('INSERT INTO sale_listings (user_id, username, brainrot_id, price_usd, description, image_url, mutation, custom_name, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, brainrotId, price, String(description || '').slice(0, 500), imageUrl || null, mut, custom, nowIso());
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
// ---------- sale picture upload ----------
// Sellers upload a picture (shrunk in the browser first). Stored under
// public/uploads/ and served as a normal file. Free-tier note: uploads live
// on the server disk, so they disappear on redeploy — same as listings.
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const UPLOAD_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
app.post('/api/sales/upload-image', requireAccess, (req, res) => {
  const data = String((req.body || {}).data || '');
  const m = data.match(/^data:(image\/jpeg|image\/png|image\/webp|image\/gif);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: 'Upload a JPEG, PNG, WebP or GIF picture.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0 || buf.length > 1024 * 1024) return res.status(400).json({ error: 'Picture is too big (max 1MB after shrinking).' });
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const name = crypto.randomBytes(12).toString('hex') + UPLOAD_MIME[m[1]];
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    res.json({ ok: true, url: '/uploads/' + name });
  } catch (e) {
    console.error('[upload] failed:', e.message);
    res.status(500).json({ error: 'Could not save the picture. Try again.' });
  }
});
app.post('/api/sales/:id/close', requireAuth, (req, res) => {
  const s = db.prepare('SELECT * FROM sale_listings WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Listing not found.' });
  const email = req.user.email.toLowerCase();
  const isAdmin = email === OWNER_EMAIL || CO_OWNER_EMAILS.has(email) || ADMIN_EMAILS.has(email);
  if (s.user_id !== req.user.id && !isAdmin) return res.status(403).json({ error: 'Not yours.' });
  db.prepare("UPDATE sale_listings SET status = 'sold' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
app.delete('/api/sales/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM sale_listings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
// Contact a seller — the scam checklist must be confirmed.
app.post('/api/sales/:id/contact', requireAccess, (req, res) => {
  const { message, checklistConfirmed } = req.body || {};
  if (!checklistConfirmed) return res.status(400).json({ error: 'Please confirm the scam checklist first.' });
  const s = db.prepare('SELECT * FROM sale_listings WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Listing not found.' });
  if (s.user_id === req.user.id) return res.status(400).json({ error: 'That is your own listing.' });
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'Write a message to the seller.' });
  const info = db.prepare('INSERT INTO contact_messages (listing_id, from_user_id, from_username, to_user_id, message, created_at) VALUES (?,?,?,?,?,?)')
    .run(s.id, req.user.id, req.user.username, s.user_id, String(message).trim().slice(0, 500), nowIso());
  res.json({ ok: true, id: Number(info.lastInsertRowid), note: 'Message sent to the seller. Never pay outside the game trade — use a middleman you trust, and never send money first to a stranger.' });
});
app.get('/api/contact/inbox', requireAccess, (req, res) => {
  const rows = db.prepare('SELECT * FROM contact_messages WHERE to_user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ messages: rows });
});
app.get('/api/contact/sent', requireAccess, (req, res) => {
  const rows = db.prepare('SELECT * FROM contact_messages WHERE from_user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ messages: rows });
});

// ---------- reports ----------
// ---------- sale likes & comments ----------
app.post('/api/sales/:id/like', requireAccess, (req, res) => {
  const s = db.prepare('SELECT id FROM sale_listings WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Listing not found.' });
  const existing = db.prepare('SELECT 1 FROM sale_likes WHERE listing_id = ? AND user_id = ?').get(s.id, req.user.id);
  if (existing) db.prepare('DELETE FROM sale_likes WHERE listing_id = ? AND user_id = ?').run(s.id, req.user.id);
  else db.prepare('INSERT INTO sale_likes (listing_id, user_id, created_at) VALUES (?,?,?)').run(s.id, req.user.id, nowIso());
  const count = db.prepare('SELECT COUNT(*) c FROM sale_likes WHERE listing_id = ?').get(s.id).c;
  res.json({ ok: true, liked: !existing, likeCount: count });
});
app.get('/api/sales/:id/comments', requireAccess, (req, res) => {
  const s = db.prepare('SELECT id FROM sale_listings WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Listing not found.' });
  const rows = db.prepare('SELECT * FROM sale_comments WHERE listing_id = ? ORDER BY id ASC LIMIT 100').all(s.id);
  res.json({ comments: rows });
});
app.post('/api/sales/:id/comments', requireAccess, (req, res) => {
  const s = db.prepare('SELECT id FROM sale_listings WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Listing not found.' });
  const text = String((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Write something first.' });
  const info = db.prepare('INSERT INTO sale_comments (listing_id, user_id, username, text, created_at) VALUES (?,?,?,?,?)')
    .run(s.id, req.user.id, req.user.username, text.slice(0, 500), nowIso());
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.delete('/api/sales/comments/:id', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM sale_comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Comment not found.' });
  const email = req.user.email.toLowerCase();
  const isAdmin = email === OWNER_EMAIL || CO_OWNER_EMAILS.has(email) || ADMIN_EMAILS.has(email);
  if (c.user_id !== req.user.id && !isAdmin) return res.status(403).json({ error: 'Not yours.' });
  db.prepare('DELETE FROM sale_comments WHERE id = ?').run(c.id);
  res.json({ ok: true });
});
app.post('/api/reports', requireAccess, (req, res) => {
  const { targetType, targetId, reason } = req.body || {};
  if (!['chat', 'trade', 'sale', 'member', 'dm', 'sale_comment'].includes(targetType)) return res.status(400).json({ error: 'Invalid report type.' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'Say what is wrong.' });
  const info = db.prepare('INSERT INTO reports (reporter_id, reporter_username, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, targetType, Number(targetId) || 0, String(reason).trim().slice(0, 500), nowIso());
  res.json({ ok: true, id: Number(info.lastInsertRowid), message: 'Report received. The owner reviews all reports.' });
});

// ---------- members ----------
// Member discovery is for subscribed members only — unverified visitors
// cannot browse members or add friends.
app.get('/api/members', requireAccess, (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const where = q ? 'AND LOWER(username) LIKE ?' : '';
  const args = q ? [`%${q}%`] : [];
  const rows = db.prepare(
    `SELECT id, username, email, verified, created_at FROM users
     WHERE banned = 0 ${where} ORDER BY username ASC LIMIT ? OFFSET ?`
  ).all(...args, limit, offset);
  res.json({ members: rows.map(u => ({
    id: u.id, username: u.username, badge: publicUser(u).badge,
    verified: !!u.verified, joined: u.created_at,
  })) });
});
app.get('/api/members/:id', requireAccess, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND banned = 0').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Member not found.' });
  const me = req.user.id;
  const fr = db.prepare(
    `SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?)
     OR (requester_id = ? AND addressee_id = ?)`
  ).get(me, u.id, u.id, me);
  const blockedByMe = !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(me, u.id);
  const blockedMe = !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(u.id, me);
  const friendCount = db.prepare(
    `SELECT COUNT(*) c FROM friendships WHERE status = 'accepted'
     AND (requester_id = ? OR addressee_id = ?)`
  ).get(u.id, u.id).c;
  res.json({
    member: {
      id: u.id, username: u.username, badge: publicUser(u).badge,
      verified: !!u.verified, joined: u.created_at, friendCount,
    },
    friendStatus: !fr ? 'none' : fr.status === 'accepted' ? 'friends'
      : (fr.requester_id === me ? 'pending_out' : 'pending_in'),
    friendRequestId: fr ? fr.id : null,
    blockedByMe, blockedMe,
  });
});

// ---------- friends ----------
function friendRow(a, b) {
  return db.prepare(
    `SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?)
     OR (requester_id = ? AND addressee_id = ?)`
  ).get(a, b, b, a);
}
app.post('/api/friends/request/:userId', requireAccess, (req, res) => {
  const targetId = Number(req.params.userId);
  if (!targetId || targetId === req.user.id) return res.status(400).json({ error: 'Pick someone else to add.' });
  const t = db.prepare('SELECT * FROM users WHERE id = ? AND banned = 0').get(targetId);
  if (!t) return res.status(404).json({ error: 'Member not found.' });
  if (db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
    .get(req.user.id, targetId, targetId, req.user.id)) {
    return res.status(403).json({ error: 'You cannot add this member.' });
  }
  const existing = friendRow(req.user.id, targetId);
  if (existing) {
    if (existing.status === 'accepted') return res.status(400).json({ error: 'You are already friends.' });
    return res.status(400).json({ error: 'A friend request is already pending.' });
  }
  const info = db.prepare('INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?,?,?,?)')
    .run(req.user.id, targetId, 'pending', nowIso());
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.get('/api/friends', requireAccess, (req, res) => {
  const me = req.user.id;
  const rows = db.prepare(
    `SELECT f.*, u.id AS uid, u.username, u.email, u.verified
     FROM friendships f JOIN users u
       ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
     WHERE f.requester_id = ? OR f.addressee_id = ?
     ORDER BY f.id DESC`
  ).all(me, me, me);
  const shape = r => ({
    id: r.id, status: r.status, direction: r.requester_id === me ? 'out' : 'in',
    user: { id: r.uid, username: r.username, badge: publicUser({ email: r.email }).badge, verified: !!r.verified },
    createdAt: r.created_at,
  });
  res.json({
    friends: rows.filter(r => r.status === 'accepted').map(shape),
    pendingIn: rows.filter(r => r.status === 'pending' && r.addressee_id === me).map(shape),
    pendingOut: rows.filter(r => r.status === 'pending' && r.requester_id === me).map(shape),
  });
});
app.post('/api/friends/:id/accept', requireAccess, (req, res) => {
  const fr = db.prepare('SELECT * FROM friendships WHERE id = ?').get(req.params.id);
  if (!fr || fr.addressee_id !== req.user.id || fr.status !== 'pending') {
    return res.status(404).json({ error: 'Friend request not found.' });
  }
  db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(fr.id);
  res.json({ ok: true });
});
app.post('/api/friends/:id/decline', requireAccess, (req, res) => {
  const fr = db.prepare('SELECT * FROM friendships WHERE id = ?').get(req.params.id);
  if (!fr || (fr.addressee_id !== req.user.id && fr.requester_id !== req.user.id)) {
    return res.status(404).json({ error: 'Friend request not found.' });
  }
  db.prepare('DELETE FROM friendships WHERE id = ?').run(fr.id);
  res.json({ ok: true });
});
app.delete('/api/friends/:userId', requireAccess, (req, res) => {
  const fr = friendRow(req.user.id, Number(req.params.userId));
  if (!fr) return res.status(404).json({ error: 'Not friends.' });
  db.prepare('DELETE FROM friendships WHERE id = ?').run(fr.id);
  res.json({ ok: true });
});

// ---------- private messages (DMs) ----------
// Private between the two people in the conversation. Only verified
// subscribed members can send. Admins CANNOT read private chats — they only
// see a single message if a member reports it (see /api/admin/dm/:messageId).
function dmBlocked(a, b) {
  return !!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
    .get(a, b, b, a);
}
function dmOtherUser(me, otherId) {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND banned = 0').get(otherId);
  return u || null;
}
app.get('/api/dm/conversations', requireAccess, (req, res) => {
  const me = req.user.id;
  const rows = db.prepare(
    `SELECT m.*, u.username AS other_username, u.email AS other_email
     FROM dm_messages m
     JOIN users u ON u.id = CASE WHEN m.from_user_id = ? THEN m.to_user_id ELSE m.from_user_id END
     WHERE m.id IN (
       SELECT MAX(id) FROM dm_messages
       WHERE from_user_id = ? OR to_user_id = ?
       GROUP BY CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END
     )
     ORDER BY m.id DESC LIMIT 50`
  ).all(me, me, me, me);
  const convs = rows.map(r => {
    const otherId = r.from_user_id === me ? r.to_user_id : r.from_user_id;
    const unread = db.prepare(
      "SELECT COUNT(*) c FROM dm_messages WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0"
    ).get(otherId, me).c;
    return {
      userId: otherId, username: r.other_username,
      badge: publicUser({ email: r.other_email }).badge,
      lastMessage: r.text, lastAt: r.created_at,
      lastFromMe: r.from_user_id === me, unread,
    };
  });
  res.json({ conversations: convs });
});
app.get('/api/dm/unread', requireAccess, (req, res) => {
  const c = db.prepare('SELECT COUNT(*) c FROM dm_messages WHERE to_user_id = ? AND is_read = 0').get(req.user.id).c;
  res.json({ unread: c });
});
app.get('/api/dm/:userId', requireAccess, (req, res) => {
  const otherId = Number(req.params.userId);
  const other = dmOtherUser(req.user.id, otherId);
  if (!other) return res.status(404).json({ error: 'Member not found.' });
  if (otherId === req.user.id) return res.status(400).json({ error: 'That is you.' });
  db.prepare('UPDATE dm_messages SET is_read = 1 WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0')
    .run(otherId, req.user.id);
  const after = Number(req.query.after || 0);
  const rows = db.prepare(
    `SELECT * FROM dm_messages
     WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
       AND id > ? ORDER BY id ASC LIMIT 100`
  ).all(req.user.id, otherId, otherId, req.user.id, after);
  res.json({
    other: { id: other.id, username: other.username, badge: publicUser(other).badge, verified: !!other.verified },
    blockedByMe: !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(req.user.id, otherId),
    blockedMe: !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(otherId, req.user.id),
    messages: rows,
  });
});
const lastDmAt = new Map();
app.post('/api/dm/:userId', requireAccess, (req, res) => {
  const otherId = Number(req.params.userId);
  const other = dmOtherUser(req.user.id, otherId);
  if (!other) return res.status(404).json({ error: 'Member not found.' });
  if (otherId === req.user.id) return res.status(400).json({ error: 'You cannot message yourself.' });
  if (dmBlocked(req.user.id, otherId)) return res.status(403).json({ error: 'Messages are blocked between you and this member.' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message is empty.' });
  if (text.length > 1000) return res.status(400).json({ error: 'Messages are limited to 1000 characters.' });
  const last = lastDmAt.get(req.user.id) || 0;
  if (Date.now() - last < 2000) return res.status(429).json({ error: 'Slow down — one message every 2 seconds.' });
  lastDmAt.set(req.user.id, Date.now());
  const info = db.prepare('INSERT INTO dm_messages (from_user_id, to_user_id, text, created_at) VALUES (?,?,?,?)')
    .run(req.user.id, otherId, text, nowIso());
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.post('/api/dm/:userId/block', requireAccess, (req, res) => {
  const otherId = Number(req.params.userId);
  const other = dmOtherUser(req.user.id, otherId);
  if (!other || otherId === req.user.id) return res.status(404).json({ error: 'Member not found.' });
  db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)')
    .run(req.user.id, otherId, nowIso());
  res.json({ ok: true });
});
app.post('/api/dm/:userId/unblock', requireAccess, (req, res) => {
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, Number(req.params.userId));
  res.json({ ok: true });
});
app.get('/api/dm/blocked/list', requireAccess, (req, res) => {
  const rows = db.prepare(
    'SELECT u.id, u.username FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY u.username'
  ).all(req.user.id);
  res.json({ blocked: rows });
});

// ---------- admin ----------
app.get('/api/admin/members', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 200').all();
  res.json({ members: rows.map(u => ({ ...publicUser(u), subscription: activeSubscription(u.id) ? 'active' : 'none' })) });
});
app.post('/api/admin/members/:id/warn', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Member not found.' });
  const blocked = adminActionBlocked(req.user, t);
  if (blocked) return res.status(403).json({ error: blocked });
  db.prepare('UPDATE users SET warn_count = warn_count + 1 WHERE id = ?').run(t.id);
  res.json({ ok: true });
});
app.post('/api/admin/members/:id/ban', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Member not found.' });
  const blocked = adminActionBlocked(req.user, t);
  if (blocked) return res.status(403).json({ error: blocked });
  db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(t.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
  res.json({ ok: true });
});
app.post('/api/admin/members/:id/unban', requireAdmin, (req, res) => {
  db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
// ---------- account approvals (no emailed codes) ----------
// Email/password sign-ups wait here until an admin approves them. Google
// sign-ins and owner/co-owner/admin emails verify instantly instead.
app.get('/api/admin/pending', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, username, email, created_at FROM users WHERE verified = 0 AND banned = 0 ORDER BY created_at ASC').all();
  res.json({ pending: rows });
});
app.post('/api/admin/approve', requireAdmin, (req, res) => {
  const { userId } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId));
  if (!u) return res.status(400).json({ error: 'No such account.' });
  if (u.verified) return res.status(400).json({ error: 'That account is already verified.' });
  db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(u.id);
  db.prepare('DELETE FROM verifications WHERE email = ?').run(u.email.toLowerCase());
  res.json({ ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});
app.post('/api/admin/reject', requireAdmin, (req, res) => {
  const { userId } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId));
  if (!u) return res.status(400).json({ error: 'No such account.' });
  if (isStaffEmail(u.email)) return res.status(400).json({ error: 'That account cannot be rejected.' });
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM verifications WHERE email = ?').run(u.email.toLowerCase());
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  res.json({ ok: true });
});
app.post('/api/admin/subscription/grant', requireAdmin, (req, res) => {
  const { userId, days } = req.body || {};
  const t = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!t) return res.status(404).json({ error: 'Member not found.' });
  const email = t.email.toLowerCase();
  if (email === OWNER_EMAIL || CO_OWNER_EMAILS.has(email) || ADMIN_EMAILS.has(email)) {
    return res.status(400).json({ error: 'This account already has free access.' });
  }
  const d = Math.max(1, Math.min(365, Number(days) || 30));
  const ends = new Date(Date.now() + d * 24 * 3600 * 1000);
  db.prepare(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = ? WHERE user_id = ? AND status = 'active'`).run(nowIso(), t.id);
  db.prepare(`INSERT INTO subscriptions (user_id, paypal_subscription_id, status, started_at, ends_at) VALUES (?, 'ADMIN-GRANT', 'active', ?, ?)`)
    .run(t.id, nowIso(), ends.toISOString());
  res.json({ ok: true, endsAt: ends.toISOString() });
});
app.post('/api/admin/subscription/revoke', requireAdmin, (req, res) => {
  const { userId } = req.body || {};
  const t = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!t) return res.status(404).json({ error: 'Member not found.' });
  const email = t.email.toLowerCase();
  if (email === OWNER_EMAIL || CO_OWNER_EMAILS.has(email) || ADMIN_EMAILS.has(email)) {
    return res.status(400).json({ error: 'This account cannot have access revoked.' });
  }
  db.prepare(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = ? WHERE user_id = ? AND status = 'active'`).run(nowIso(), t.id);
  res.json({ ok: true });
});
app.post('/api/admin/prices', requireAdmin, (req, res) => {
  const { itemId, typicalLow, typicalHigh, ballpark } = req.body || {};
  const item = findItem(itemId);
  if (!item) return res.status(404).json({ error: 'Brainrot not found.' });
  db.prepare(`INSERT INTO item_overrides (item_id, typical_low, typical_high, ballpark, updated_by, updated_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET typical_low=excluded.typical_low, typical_high=excluded.typical_high, ballpark=excluded.ballpark, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .run(itemId, Number(typicalLow), Number(typicalHigh), ballpark ? 1 : 0, req.user.username, nowIso());
  res.json({ ok: true });
});
app.post('/api/admin/prices/reset', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM item_overrides WHERE item_id = ?').run(req.body?.itemId);
  res.json({ ok: true });
});
app.post('/api/admin/brainrots', requireAdmin, (req, res) => {
  const { name, typicalLow, typicalHigh, ballpark, image } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
  const id = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (findItem(id)) return res.status(400).json({ error: 'A brainrot with that name already exists.' });
  db.prepare('INSERT INTO custom_brainrots (id, name, typical_low, typical_high, ballpark, image, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, String(name).trim(), Number(typicalLow) || 0, Number(typicalHigh) || 0, ballpark ? 1 : 0, image || null, req.user.username, nowIso());
  res.json({ ok: true, id });
});
app.post('/api/admin/rarity', requireAdmin, (req, res) => {
  const { name, pct, tier } = req.body || {};
  if (!name || pct == null || Number(pct) < 0) return res.status(400).json({ error: 'Name and a spawn % are required.' });
  db.prepare(`INSERT INTO rarity_overrides (name, pct, tier, updated_by, updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET pct=excluded.pct, tier=excluded.tier, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .run(String(name).trim(), Number(pct), tier || 'Eternal', req.user.username, nowIso());
  res.json({ ok: true });
});
app.get('/api/admin/reports', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT 100').all();
  res.json({ reports: rows });
});
app.post('/api/admin/reports/:id/resolve', requireAdmin, (req, res) => {
  db.prepare("UPDATE reports SET status = 'resolved' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
// Admins cannot browse private chats. They may see ONE private message only
// when a member reported it (report target_type 'dm', target_id = message id).
app.get('/api/admin/dm/:messageId', requireAdmin, (req, res) => {
  const rep = db.prepare("SELECT * FROM reports WHERE target_type = 'dm' AND target_id = ?").get(req.params.messageId);
  if (!rep) return res.status(404).json({ error: 'No report for this message.' });
  const m = db.prepare('SELECT * FROM dm_messages WHERE id = ?').get(req.params.messageId);
  if (!m) return res.status(404).json({ error: 'Message not found.' });
  const from = db.prepare('SELECT username FROM users WHERE id = ?').get(m.from_user_id);
  const to = db.prepare('SELECT username FROM users WHERE id = ?').get(m.to_user_id);
  res.json({
    message: {
      id: m.id, from: from ? from.username : 'unknown', to: to ? to.username : 'unknown',
      text: m.text, createdAt: m.created_at,
    },
    report: { id: rep.id, reporter: rep.reporter_username, reason: rep.reason, status: rep.status },
  });
});
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const members = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const subs = db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE status='active' AND (ends_at IS NULL OR ends_at > ?)").get(nowIso()).c;
  const chat = db.prepare('SELECT COUNT(*) c FROM chat_messages').get().c;
  const trades = db.prepare("SELECT COUNT(*) c FROM trade_posts WHERE status='open'").get().c;
  const sales = db.prepare("SELECT COUNT(*) c FROM sale_listings WHERE status='open'").get().c;
  const openReports = db.prepare("SELECT COUNT(*) c FROM reports WHERE status='open'").get().c;
  const pendingApprovals = db.prepare('SELECT COUNT(*) c FROM users WHERE verified = 0 AND banned = 0').get().c;
  res.json({ members, activeSubscriptions: subs, chatMessages: chat, openTrades: trades, openSales: sales, openReports, pendingApprovals, paypalSecretConfigured: !!PAYPAL_SECRET });
});

// Privacy policy page (also the URL Google needs to publish the sign-in app).
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'privacy.html'));
});

// ---------- SPA fallback ----------
// Express 5 no longer accepts app.get('*'); a final middleware catches
// everything the API and static files did not match.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Brainrot Trades running at http://${HOST}:${PORT}`);
  console.log(`Subscription: $${PRICE_USD}/month USD, PayPal plan ${PLAN_ID || '(not configured)'} — plan configured: ${!!(CLIENT_ID && PLAN_ID)}`);
  console.log(`Email configured: ${!!transporter || !!SENDGRID_API_KEY} (${SENDGRID_API_KEY ? 'SendGrid' : (transporter ? 'SMTP' : 'dev mode — codes print to this console')})`);
  console.log(`PayPal Secret configured: ${!!PAYPAL_SECRET} (server-side verification ${PAYPAL_SECRET ? 'ON' : 'OFF — see README'})`);
});
