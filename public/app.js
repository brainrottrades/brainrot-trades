/* Brainrot Trades — single-page app.
   Fortnite "Steal the Brainrot" (Creative). NOT the Roblox game.
   Views: home (landing) · prices · checker · rarity · chat · trades ·
   sales · messages · friends · members · account · admin · subscribe.
   Full content is behind the $3/month subscription; the landing page is public.
*/
'use strict';

const $ = (sel, root) => (root || document).querySelector(sel);
let view = $('#view');
const topActions = $('#topActions');
const bottomNav = $('#bottomNav');
const chatFab = $('#chatFab');
const toastEl = $('#toast');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function money(n) {
  if (n == null || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function moneyRange(lo, hi) {
  if (lo === hi) return money(lo);
  return money(lo) + ' – ' + money(hi);
}
function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return new Date(iso).toLocaleDateString();
}
function toast(msg, ms) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.hidden = true; }, ms || 3500);
}
function badgeHtml(badge) {
  if (!badge) return '';
  const cls = badge === 'OWNER' ? 'owner' : (badge === 'CO-OWNER' ? 'coowner' : (badge === 'ADMIN' ? 'admin' : ''));
  return ' <span class="badge ' + cls + '">' + esc(badge) + '</span>';
}
function verifiedBadge(u) {
  return u && u.verified ? ' <span class="badge verified">✓ VERIFIED</span>' : '';
}
function userLink(u) {
  // u: {id, username, badge} — link to the member profile.
  return '<a href="#/members/' + u.id + '">' + esc(u.username) + '</a>' + badgeHtml(u.badge);
}
function imgHtml(item, cls) {
  if (item && item.image) {
    return '<img src="' + esc(item.image) + '" alt="' + esc(item.name) + '" class="' + (cls || '') + '" loading="lazy">';
  }
  return '<span class="no-pic">NO PICTURE YET</span>';
}
function finePrintHtml() {
  return '<footer class="site">Brainrot Trades is a price guide and meeting place only, for Fortnite Steal the Brainrot (Creative) — Eternals only, no Secrets and no base brainrots, and not the Roblox game. '
    + 'We are not a party to any trade, sale or private deal, we do not hold money or brainrots, '
    + 'and we are not liable for anything that happens between members — including scams, '
    + 'lost items or lost money. Trade at your own risk: check prices, use a middleman you trust, '
    + 'and never send money first to a stranger. Fan-made guide, not affiliated with Epic Games, Fortnite, SpyderSammy, or the Roblox game Steal a Brainrot. All trademarks belong to their owners. If you own an image shown here and want it removed, contact pgevil22@gmail.com. <a href="/privacy">Privacy policy</a></footer>';
}

// ---------- API ----------
async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
const get = path => api(path);
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });
const del = path => api(path, { method: 'DELETE' });

// ---------- state ----------
const state = {
  me: null,            // {id, username, email, verified, badge, isAdmin, hasAccess, subscription}
  cfg: null,           // {priceUsd, planId, clientId, paypalConfigured, ...}
  meta: null,          // {mutations, traits, traitRule}
  items: null,         // full brainrot list (members only)
  rarity: null,
  unread: 0,
  route: null,
  timers: [],
};
function clearTimers() { state.timers.forEach(clearInterval); state.timers = []; }
function every(ms, fn) { const t = setInterval(fn, ms); state.timers.push(t); return t; }

async function loadMe() {
  try {
    const r = await get('/api/me');
    state.me = r.user;
  } catch (e) { state.me = null; }
  renderTop();
}
async function loadCfg() {
  try { state.cfg = await get('/api/config'); } catch (e) { state.cfg = null; }
}
function loggedIn() { return !!state.me; }
function hasAccess() { return !!(state.me && state.me.hasAccess); }
function isAdmin() { return !!(state.me && state.me.isAdmin); }

function renderTop() {
  if (!state.me) {
    topActions.innerHTML =
      '<a class="btn secondary" href="#/login">Log in</a>' +
      '<a class="btn" href="#/signup">Sign up</a>';
  } else {
    topActions.innerHTML =
      '<span class="userchip"><span>' + esc(state.me.username) + '</span>' + badgeHtml(state.me.badge) + verifiedBadge(state.me) + '</span>' +
      '<button class="btn secondary" id="logoutBtn">Log out</button>';
    const b = $('#logoutBtn');
    if (b) b.onclick = async () => { await post('/api/auth/logout'); state.me = null; state.items = null; location.hash = '#/home'; await loadMe(); renderNav(); toast('Logged out.'); };
  }
}

const NAV = [
  { route: 'home', label: 'Home', ico: '🏠' },
  { route: 'prices', label: 'Prices', ico: '💲' },
  { route: 'checker', label: 'Checker', ico: '⚖️' },
  { route: 'rarity', label: 'Rarity', ico: '⭐' },
  { route: 'sales', label: 'For Sale', ico: '🛒' },
  { route: 'trades', label: 'Trades', ico: '🔄' },
  { route: 'chat', label: 'Chat', ico: '💬' },
  { route: 'messages', label: 'Messages', ico: '✉️' },
  { route: 'help', label: 'Help', ico: '❓' },
  { route: 'account', label: 'Account', ico: '👤' },
];
function renderNav() {
  const cur = (state.route || 'home').split('/')[0];
  bottomNav.innerHTML = NAV.map(n => {
    const active = (n.route === cur) || (n.route === 'home' && cur === 'home') ? ' class="active"' : '';
    const badge = n.route === 'messages' && state.unread > 0
      ? ' <span class="badge">' + state.unread + '</span>' : '';
    return '<a href="#/' + n.route + '"' + active + '><span class="ico">' + n.ico + '</span>' + n.label + badge + '</a>';
  }).join('');
  bottomNav.hidden = false;
  // Floating chat button: visible for members on views other than chat itself.
  chatFab.hidden = !(hasAccess() && cur !== 'chat');
}
async function refreshUnread() {
  if (!loggedIn()) { state.unread = 0; renderNav(); return; }
  try {
    const r = await get('/api/dm/unread');
    if (r.unread !== state.unread) { state.unread = r.unread; renderNav(); }
  } catch (e) { /* ignore */ }
}

// ---------- router ----------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0] || 'home';
  const parts = h.split('/');
  return { route: parts[0] || 'home', arg: parts[1] || null };
}
const ROUTES = {};
function go(route) { location.hash = '#/' + route; }
window.addEventListener('hashchange', route);
chatFab.addEventListener('click', () => go('chat'));
$('#brandHome').addEventListener('click', e => { e.preventDefault(); go('home'); });

async function route() {
  // Fresh view element on every visit: routes attach delegated click handlers
  // to #view, and replacing it drops the old ones so an action never fires
  // twice after coming back to a tab (double deletes, double confirms…).
  const fresh = view.cloneNode(false);
  view.replaceWith(fresh);
  view = fresh;
  clearTimers();
  const { route: name, arg } = parseHash();
  state.route = name;
  const fn = ROUTES[name] || ROUTES.home;
  renderNav();
  view.innerHTML = '<div class="card"><p>Loading…</p></div>';
  try {
    await fn(arg);
  } catch (e) {
    if (e && e.status === 402) { paywallView('This is for members.'); return; }
    if (e && e.status === 401) { loginView('Please log in first.'); return; }
    view.innerHTML = '<div class="card"><div class="error">' + esc(e.message || 'Something went wrong.') + '</div>'
      + '<p><a class="btn secondary" href="#/home">Back to Home</a></p></div>' + finePrintHtml();
  }
  renderNav();
  window.scrollTo(0, 0);
}

function paywallView(note) {
  const price = state.cfg ? state.cfg.priceUsd : 3;
  if (loggedIn() && state.me && !state.me.verified) {
    view.innerHTML =
      '<div class="card paywall"><h1>Waiting for approval</h1>' +
      '<p>Your account is waiting for the owner to approve it. Check back soon — once approved, subscribe $' + price + '/month for full access.</p>' +
      '<p class="muted">Signed in as ' + esc(state.me.username) + ' (' + esc(state.me.email) + ').</p></div>' + finePrintHtml();
    return;
  }
  view.innerHTML =
    '<div class="card paywall"><h1>Members only</h1>' +
    '<p>' + esc(note || 'The full site is for subscribers.') + '</p>' +
    '<p class="price-tag">' + (state.cfg && state.cfg.trialAvailable ? 'First month free' : '$' + price + '/month') + '</p>' +
    (state.cfg && state.cfg.trialAvailable ? '<p class="muted">Then $' + price + '/month. Your PayPal stays on file — it renews automatically.</p>' : '') +
    '<p class="muted">Price list, trade checker, rarity chart, live chat, trade board, For Sale, private messages and friends.</p>' +
    (loggedIn()
      ? '<p><a class="btn" href="#/subscribe">Subscribe' + (state.cfg && state.cfg.trialAvailable ? ' — first month free' : ' — $' + price + '/month') + '</a></p>'
      : '<p><a class="btn" href="#/signup">Sign up</a> <a class="btn secondary" href="#/login">Log in</a></p>') +
    '</div>' + finePrintHtml();
}

// ---------- landing page ----------
ROUTES.home = async function () {
  let preview = [];
  try { preview = (await get('/api/preview')).items; } catch (e) { preview = []; }
  const price = state.cfg ? state.cfg.priceUsd : 3;
  const feats = [
    ['Price list', 'All 77 Eternal brainrots priced, with pictures — every brainrot has a ballpark price.'],
    ['Trade checker', 'Check any brainrot by mutation and traits, and compare two brainrots to see if a trade is worth it.'],
    ['Rarity chart', 'Every Eternal ranked least rarest to rarest, plus Absolute and GOAT rarities.'],
    ['Live chat', 'Talk with other players and organise trades in real time.'],
    ['Trade board', 'Post what you have and what you want — other members come to you.', 'trades'],
    ['For Sale', 'List brainrots for real money with your own price and picture.', 'sales'],
    ['Help forum', 'Ask for help or answer other players — the owner and admins read every post.', 'help'],
    ['Verified members', 'Every member verifies their email. Owners, co-owners and admins are badged.'],
    ['Owner moderation & safety', 'Scam checklist before every deal, report and block buttons, and the owner reviews reports.'],
  ];
  view.innerHTML =
    '<section class="hero card"><img class="hero-icon" src="/img/skibidi-toilet.png" alt="Skibidi Toilet">' +
    '<h1>Brainrot Trades</h1>' +
    '<p class="muted">Fortnite Steal the Brainrot (Creative map 3225-0366-8885) — Eternals only. Prices, trades, rarity and a safe place to buy, sell and trade. Not the Roblox game.</p>' +
    '<p class="price-tag">$' + price + '/month</p>' +
    '<p class="muted">Everything in the app, one price. Cancel anytime.</p>' +
    (hasAccess()
      ? '<p><a class="btn" href="#/prices">Open the price list</a> <a class="btn secondary" href="#/sales">Sell a brainrot</a></p>'
      : '<p><a class="btn" href="#/signup">Sign up</a> <a class="btn secondary" href="#/login">Log in</a></p>') +
    '</section>' +
    '<div class="card"><h2>What you get</h2><ul class="feature-list">' +
    feats.map(f => '<li><strong>' + (f[2] ? '<a href="#/' + f[2] + '">' + esc(f[0]) + '</a>' : esc(f[0])) + '</strong><br><span class="muted">' + esc(f[1]) + '</span></li>').join('') +
    '</ul></div>' +
    (preview.length ? '<div class="card"><h2>A taste of the price list</h2><div class="grid two">' +
      preview.map(i =>
        '<div class="brainrot-card">' + imgHtml(i) + '<div class="info"><h3>' + esc(i.name) + '</h3>' +
        '<div class="price">' + moneyRange(i.typicalLow, i.typicalHigh) + '</div>' +
        (i.ballpark ? ' <span class="badge ballpark">BALLPARK</span>' : '') +
        '</div></div>').join('') +
      '</div><p class="muted small">Sample only — the full list of 77 brainrots is for members.</p>' +
      (hasAccess() ? '' : '<p><a class="btn" href="#/signup">See all 77 — ' + (state.cfg && state.cfg.trialAvailable ? 'first month free' : 'subscribe $' + price + '/month') + '</a></p>') +
      '</div>' : '') +
    '<div class="card"><h2>How it works</h2><ol class="steps">' +
    '<li><strong>Sign up</strong> — pick a username and email.</li>' +
    '<li><strong>Verify</strong> — sign in with Google and you\'re verified instantly, or sign up with email and the owner approves you.</li>' +
    '<li><strong>' + (state.cfg && state.cfg.trialAvailable ? 'Subscribe — first month free, then $' + price + '/month' : 'Subscribe $' + price + '/month') + '</strong> — PayPal, cancel anytime. Full access right away.</li>' +
    '</ol></div>' +
    '<div class="card"><h2>Stay safe</h2><p class="muted">Check the price before you trade. Use a middleman you trust. Never send money first to a stranger. '
    + 'Every listing and message has a report button, and the owner reviews reports.</p></div>' +
    finePrintHtml();
};

// ---------- auth ----------
function authCard(title, inner) {
  return '<div class="card"><h1>' + esc(title) + '</h1>' + inner + '</div>' + finePrintHtml();
}
ROUTES.signup = async function () {
  const googleBtn = (state.cfg && state.cfg.googleAuthEnabled)
    ? '<p><a class="btn block" href="/api/auth/google">Continue with Google</a></p>'
      + '<p class="form-note">Google verifies your email instantly — no code, no waiting. No Google account? Sign up below instead.</p>'
    : '';
  view.innerHTML = authCard('Sign up',
    googleBtn +
    '<form id="signupForm">' +
    '<label for="suUser">Username</label><input id="suUser" required minlength="3" maxlength="24" autocomplete="username" placeholder="Your display name">' +
    '<label for="suEmail">Email</label><input id="suEmail" type="email" required autocomplete="email" placeholder="you@example.com">' +
    '<label for="suPass">Password</label><input id="suPass" type="password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters">' +
    '<p style="margin-top:12px"><button class="btn block" type="submit">Create account</button></p>' +
    '<p class="form-note">No Google account? Your account waits for the owner to approve it, then subscribe $' + (state.cfg ? state.cfg.priceUsd : 3) + '/month for full access.</p>' +
    '<p class="form-note">Already have an account? <a href="#/login">Log in</a></p>' +
    '<div id="formMsg"></div></form>');
  $('#signupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#formMsg');
    try {
      const r = await post('/api/auth/register', {
        username: $('#suUser').value.trim(), email: $('#suEmail').value.trim(), password: $('#suPass').value,
      });
      if (r.user) { await loadMe(); toast(r.message || 'Account created.'); go('home'); return; }
      msg.innerHTML = '<div class="success">' + esc(r.message || 'Account created. The owner will approve it.') + '</div>';
      toast(r.message || 'Account created.');
    } catch (err) { msg.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  });
};
ROUTES.login = async function (note) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const googleFailed = params.get('google') === 'failed';
  const googleBtn = (state.cfg && state.cfg.googleAuthEnabled)
    ? '<p><a class="btn block" href="/api/auth/google">Continue with Google</a></p>' : '';
  view.innerHTML = authCard('Log in',
    (googleFailed ? '<div class="error">Google sign-in did not work. Try again, or log in with your email instead.</div>' : '') +
    (typeof note === 'string' && note ? '<div class="error">' + esc(note) + '</div>' : '') +
    googleBtn +
    '<form id="loginForm">' +
    '<label for="liEmail">Email</label><input id="liEmail" type="email" required autocomplete="email">' +
    '<label for="liPass">Password</label><input id="liPass" type="password" required autocomplete="current-password">' +
    '<p style="margin-top:12px"><button class="btn block" type="submit">Log in</button></p>' +
    '<p class="form-note">No account yet? <a href="#/signup">Sign up</a></p>' +
    '<div id="formMsg"></div></form>');
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#formMsg');
    try {
      await post('/api/auth/login', { email: $('#liEmail').value.trim(), password: $('#liPass').value });
      await loadMe();
      state.items = null;
      toast('Logged in.');
      go('home');
    } catch (err) { msg.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  });
};
function loginView(note) { return ROUTES.login(note); }
ROUTES.verify = async function () {
  const email = sessionStorage.getItem('bt_verify_email') || '';
  view.innerHTML = authCard('Verify your email',
    '<p class="muted">We sent a 6-digit code to <strong>' + esc(email || 'your email') + '</strong>. It expires in 30 minutes.</p>' +
    '<form id="verifyForm">' +
    '<label for="vEmail">Email</label><input id="vEmail" type="email" required value="' + esc(email) + '">' +
    '<label for="vCode">6-digit code</label><input id="vCode" required inputmode="numeric" maxlength="6" placeholder="123456">' +
    '<p style="margin-top:12px"><button class="btn block" type="submit">Verify</button></p>' +
    '<p><button class="btn secondary block" type="button" id="resendBtn">Email me a new code</button></p>' +
    '<div id="formMsg"></div></form>');
  $('#verifyForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#formMsg');
    try {
      const r = await post('/api/auth/verify', { email: $('#vEmail').value.trim(), code: $('#vCode').value.trim() });
      await loadMe();
      sessionStorage.removeItem('bt_verify_email');
      toast('Email verified.');
      if (r.hasAccess) go('prices'); else go('subscribe');
    } catch (err) { msg.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  });
  $('#resendBtn').addEventListener('click', async () => {
    const msg = $('#formMsg');
    try {
      const r = await post('/api/auth/resend-code', { email: $('#vEmail').value.trim() });
      msg.innerHTML = '<div class="success">New code sent' + (r.devMode ? ' (dev mode — check the server console).' : '.') + '</div>';
    } catch (err) { msg.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  });
};

// ---------- subscribe ($3/month via PayPal) ----------
ROUTES.subscribe = async function () {
  if (!loggedIn()) { loginView('Log in or sign up first, then subscribe.'); return; }
  if (!state.me.verified) { paywallView(); return; }
  const price = state.cfg ? state.cfg.priceUsd : 3;
  if (hasAccess()) {
    const sub = state.me.subscription;
    view.innerHTML = '<div class="card"><h1>Your subscription</h1>' +
      '<p>You have full access' + (sub && sub.endsAt ? ' until ' + esc(new Date(sub.endsAt).toLocaleDateString()) : '') + '.</p>' +
      (sub && sub.isTrial ? '<p><strong>Free trial</strong> — your first month is free. After it ends, it renews at $' + price + '/month automatically until you cancel.</p>' : '') +
      (state.me.isAdmin
        ? '<p class="muted">Owner, co-owner and admin accounts get full access free — you are never charged.</p>'
        : '<p><button class="btn danger" id="cancelSub">Cancel subscription</button></p>' +
          '<p class="form-note">Cancelling here stops your access on this site. Also cancel in your PayPal account (Settings → Payments → Manage automatic payments) to stop PayPal billing you.</p>') +
      '<p><a class="btn secondary" href="#/prices">Back to the price list</a></p><div id="formMsg"></div></div>' + finePrintHtml();
    const c = $('#cancelSub');
    if (c) c.onclick = async () => {
      if (!confirm('Cancel your subscription?')) return;
      try {
        const r = await post('/api/subscribe/cancel');
        await loadMe();
        $('#formMsg').innerHTML = '<div class="success">' + esc(r.message || 'Cancelled.') + '</div>';
      } catch (err) { $('#formMsg').innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
    };
    return;
  }
  // Not subscribed yet: which plan? The free-trial plan on the first month
  // (one per email), otherwise the standard $3/month plan.
  let plan = null;
  try { plan = await get('/api/subscribe/plan'); } catch (e) { plan = null; }
  const planId = (plan && plan.planId) || (state.cfg && state.cfg.planId) || '';
  const isTrial = !!(plan && plan.trialEligible);
  view.innerHTML = '<div class="card"><h1>Subscribe</h1>' +
    (isTrial
      ? '<p class="price-tag" style="font-size:2rem;font-weight:800;color:var(--accent)">First month free</p>' +
        '<p>Then $' + price + '/month after that.</p>'
      : '<p class="price-tag" style="font-size:2rem;font-weight:800;color:var(--accent)">$' + price + '/month</p>') +
    '<p>Full access to everything: price list, trade checker, rarity chart, live chat, trade board, For Sale, private messages and friends.</p>' +
    '<ul class="feature-list">' +
      (isTrial ? '<li>First month free — one free month per email</li><li>Your PayPal stays on file — it renews automatically at $' + price + '/month after the free month</li>' : '<li>Charged monthly until you cancel</li>') +
      '<li>Cancel anytime — access runs to the end of the paid month</li><li>Pay with PayPal</li></ul>' +
    '<div id="paypalButtons"></div>' +
    '<div id="formMsg"></div>' +
    '<p class="form-note">Payments go to the site owner via PayPal. Brainrot Trades is not a party to trades or sales between members.</p>' +
    '</div>' + finePrintHtml();
  if (!state.cfg || !state.cfg.paypalConfigured || !planId) {
    $('#formMsg').innerHTML = '<div class="error">PayPal is not configured on this site yet. The owner needs to finish the PayPal setup.</div>';
    return;
  }
  try {
    await loadPayPalSdk();
    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'subscribe' },
      createSubscription: (data, actions) => actions.subscription.create({ plan_id: planId }),
      onApprove: async (data) => {
        try {
          const r = await post('/api/subscribe/activate', { subscriptionId: data.subscriptionID, planId });
          await loadMe();
          toast(isTrial ? 'Free trial started — welcome!' : 'Subscribed — welcome!');
          if (r.verifiedWithPayPal === false) {
            toast('Subscribed. Note: the site has not verified this subscription with PayPal yet (owner setup).');
          }
          go('prices');
        } catch (err) {
          $('#formMsg').innerHTML = '<div class="error">' + esc(err.message) + '</div>';
        }
      },
      onError: (err) => { $('#formMsg').innerHTML = '<div class="error">PayPal checkout failed. Try again.</div>'; },
    }).render('#paypalButtons');
  } catch (e) {
    $('#formMsg').innerHTML = '<div class="error">Could not load PayPal checkout. Check your connection and try again.</div>';
  }
};
let paypalSdkPromise = null;
function loadPayPalSdk() {
  if (window.paypal) return Promise.resolve();
  if (paypalSdkPromise) return paypalSdkPromise;
  paypalSdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(state.cfg.clientId)
      + '&vault=true&intent=subscription';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return paypalSdkPromise;
}

// ---------- price list ----------
async function ensureItems() {
  if (!state.items) {
    const r = await get('/api/brainrots');
    state.items = r.items;
  }
  return state.items;
}
async function ensureMeta() {
  if (!state.meta) state.meta = await get('/api/meta');
  return state.meta;
}
ROUTES.prices = async function () {
  const items = await ensureItems();
  view.innerHTML =
    '<div class="card"><h1>Price list</h1>' +
    '<p class="muted">All 77 Eternal brainrots. Prices are sellers’ asking prices in USD (Nov 2026 snapshot), not sold prices. '
    + '“Ballpark” means an estimate — no confirmed listing was found.</p>' +
    '<div class="toolbar"><input id="q" type="search" placeholder="Search brainrots…" aria-label="Search brainrots"></div>' +
    '<div id="list" class="grid two"></div></div>' + finePrintHtml();
  const render = q => {
    const list = items.filter(i => !q || i.name.toLowerCase().includes(q));
    $('#list').innerHTML = list.length ? list.map(i =>
      '<div class="card brainrot-card">' + imgHtml(i) + '<div class="info"><h3>' + esc(i.name) + '</h3>' +
      '<div class="price">' + moneyRange(i.typicalLow, i.typicalHigh) + '</div>' +
      '<div class="range">Seen ' + moneyRange(i.rangeLow, i.rangeHigh) + '</div>' +
      (i.ballpark ? ' <span class="badge ballpark">BALLPARK</span>' : '') +
      (i.overridden ? ' <span class="badge">UPDATED</span>' : '') +
      (i.custom ? ' <span class="badge">NEW</span>' : '') +
      '<div class="row" style="margin-top:8px"><a class="btn ghost" href="#/checker?item=' + encodeURIComponent(i.id) + '">Check price</a></div>' +
      '</div></div>').join('')
      : '<p class="muted">No brainrots match that search.</p>';
  };
  render('');
  $('#q').addEventListener('input', e => render(e.target.value.trim().toLowerCase()));
};

// ---------- trade / price checker ----------
ROUTES.checker = async function () {
  const items = await ensureItems();
  const meta = await ensureMeta();
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const prefill = params.get('item') || '';
  const opts = items.map(i => '<option value="' + esc(i.id) + '">' + esc(i.name) + '</option>').join('');
  const mutOpts = meta.mutations.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('');
  const traitChips = meta.traits.map(t =>
    '<button type="button" class="chip" data-trait="' + esc(t.name) + '" aria-pressed="false">' + esc(t.name) + '</button>').join('');
  view.innerHTML =
    '<div class="card"><h1>Trade checker</h1>' +
    '<p class="muted">Pick a brainrot, its mutation and how many traits it has. The price updates with the same rules as the price list: '
    + 'confirmed variant listings first, otherwise the typical price times the mutation factor, then a trait uplift of '
    + (meta.traitRule ? '5% / 12% / 20% per extra trait (under $10 / $10–$50 / over $50), capped at 3.5×' : '') + '.</p>' +
    '<form id="checkForm">' +
    '<label for="cItem">Brainrot</label><select id="cItem">' + opts + '</select>' +
    '<label for="cMut">Mutation</label><select id="cMut">' + mutOpts + '</select>' +
    '<label>Traits (tap to pick, up to 10)</label><div class="trait-picks" id="traitPicks">' + traitChips + '</div>' +
    '<p style="margin-top:12px"><button class="btn block" type="submit">Check price</button></p>' +
    '</form><div id="checkResult"></div></div>' +
    '<div class="card"><h2>Compare a trade</h2><p class="muted">Is what you get worth what you give?</p>' +
    '<form id="cmpForm"><div class="grid two">' +
    '<div><label for="aItem">You give</label><select id="aItem">' + opts + '</select>' +
    '<label for="aMut">Mutation</label><select id="aMut">' + mutOpts + '</select>' +
    '<label for="aTraits">Traits</label><input id="aTraits" type="number" min="0" max="10" value="0"></div>' +
    '<div><label for="bItem">You get</label><select id="bItem">' + opts + '</select>' +
    '<label for="bMut">Mutation</label><select id="bMut">' + mutOpts + '</select>' +
    '<label for="bTraits">Traits</label><input id="bTraits" type="number" min="0" max="10" value="0"></div>' +
    '</div><p style="margin-top:12px"><button class="btn block" type="submit">Compare</button></p></form>' +
    '<div id="cmpResult"></div></div>' + finePrintHtml();
  const picked = new Set();
  $('#traitPicks').addEventListener('click', e => {
    const b = e.target.closest('[data-trait]');
    if (!b) return;
    const name = b.dataset.trait;
    if (picked.has(name)) { picked.delete(name); b.setAttribute('aria-pressed', 'false'); }
    else if (picked.size < 10) { picked.add(name); b.setAttribute('aria-pressed', 'true'); }
  });
  if (prefill && items.some(i => i.id === prefill)) $('#cItem').value = prefill;
  $('#checkForm').addEventListener('submit', async e => {
    e.preventDefault();
    const box = $('#checkResult');
    try {
      const r = await post('/api/checker', { itemId: $('#cItem').value, mutation: $('#cMut').value, traitCount: picked.size });
      const item = items.find(i => i.id === r.item.id);
      box.innerHTML = '<div class="checker-result card">' + imgHtml(r.item) +
        '<h3>' + esc(r.item.name) + ' — ' + esc(r.mutation) + ' · ' + r.traitCount + ' trait' + (r.traitCount === 1 ? '' : 's') + '</h3>' +
        '<div class="big">' + moneyRange(r.low, r.high) + '</div>' +
        '<p class="muted small">Basis: ' + esc(r.basis) + (r.listedTraits ? ' (listing already counted ' + r.listedTraits + ' traits)' : '') +
        (r.extraTraits ? ' · ' + r.extraTraits + ' extra traits ×' + r.uplift : '') + '. ' +
        'Prices are sellers’ asking prices, not sold prices.</p></div>';
    } catch (err) { box.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  });
  // Coming from a "Check price" link: show that brainrot's price right away.
  if (prefill && items.some(i => i.id === prefill)) $('#checkForm').dispatchEvent(new Event('submit', { cancelable: true }));
  $('#cmpForm').addEventListener('submit', async e => {
    e.preventDefault();
    const box = $('#cmpResult');
    try {
      const r = await post('/api/checker/compare', {
        a: { itemId: $('#aItem').value, mutation: $('#aMut').value, traitCount: Number($('#aTraits').value) || 0 },
        b: { itemId: $('#bItem').value, mutation: $('#bMut').value, traitCount: Number($('#bTraits').value) || 0 },
      });
      const verdict = r.verdict === 'EVEN' ? 'About even'
        : r.verdict === 'A_WORTH_MORE' ? 'What you GIVE is worth more — by about ' + money(r.differenceUsd)
        : 'What you GET is worth more — by about ' + money(r.differenceUsd);
      box.innerHTML = '<div class="checker-result card"><div class="big">' + esc(verdict) + '</div>' +
        '<p>' + esc(r.a.name) + ': <strong>' + money(r.a.mid) + '</strong> &nbsp;·&nbsp; ' + esc(r.b.name) + ': <strong>' + money(r.b.mid) + '</strong></p>' +
        '<p class="muted small">' + esc(r.note) + '</p></div>';
    } catch (err) { box.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  });
};

// ---------- rarity chart ----------
ROUTES.rarity = async function () {
  const r = await get('/api/rarity');
  const row = x => '<div class="rarity-row"><span class="name">' + esc(x.name) +
    (x.image ? ' <img src="' + esc(x.image) + '" alt="" loading="lazy" style="display:inline-block;width:28px;height:28px;vertical-align:middle;border-radius:6px">' : '') +
    (x.overridden ? ' <span class="badge">UPDATED</span>' : '') +
    '</span><span class="pct">' + x.pct + '%</span></div>';
  const maxPct = Math.max.apply(null, r.eternal.map(x => x.pct));
  view.innerHTML =
    '<div class="card"><h1>Rarity chart</h1>' +
    '<p class="muted">Spawn chances at Luck Tier 13 (in-game index, Nov 22, 2026). Least rarest to rarest. Eternals only, plus Absolute and GOAT. Reference only — only Eternals can be listed for sale or posted on the trade board.</p>' +
    '<h2>Eternal</h2>' + r.eternal.map(row).join('') +
    '<h2 style="margin-top:16px">Absolute</h2>' + r.absolute.map(row).join('') +
    '<h2 style="margin-top:16px">GOAT</h2>' + row({ name: r.goat.name + ' — fixed 0.000001%, ignores all events, luck and multipliers (index shows 0.0002% at Tier 13)', pct: r.goat.pctTier13, image: r.goat.image }) +
    '<p class="muted small" style="margin-top:12px">' + esc(r.note) + '</p></div>' + finePrintHtml();
};

// ---------- live chat ----------
ROUTES.chat = async function () {
  view.innerHTML =
    '<div class="card"><h1>Live chat</h1>' +
    '<p class="muted">Talk with other players and organise trades. Be kind — the owner can hide or delete messages, and reports are reviewed.</p>' +
    '<div class="chat-log" id="chatLog"></div>' +
    '<form class="chat-form" id="chatForm"><input id="chatInput" maxlength="500" placeholder="Say something…" autocomplete="off" aria-label="Chat message">' +
    '<button class="btn" type="submit">Send</button></form></div>' + finePrintHtml();
  let lastId = 0;
  const load = async () => {
    try {
      const r = await get('/api/chat?after=' + lastId);
      const log = $('#chatLog');
      if (!log) return;
      r.messages.forEach(m => {
        lastId = Math.max(lastId, m.id);
        if (m.hidden) return;
        const div = document.createElement('div');
        div.className = 'chat-msg';
        div.innerHTML = '<div class="meta">' + userLink({ id: m.user_id, username: m.username, badge: null }) +
          ' · ' + timeAgo(m.created_at) +
          (isAdmin() ? ' <button class="btn ghost" data-del="' + m.id + '" style="min-height:28px;padding:2px 8px;font-size:.8rem">Delete</button>' : '') +
          ' <button class="btn ghost" data-report-chat="' + m.id + '" style="min-height:28px;padding:2px 8px;font-size:.8rem">Report</button></div>' +
          '<div>' + esc(m.text) + '</div>';
        log.appendChild(div);
      });
      log.scrollTop = log.scrollHeight;
    } catch (e) { /* keep polling */ }
  };
  await load();
  every(5000, load);
  $('#chatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const inp = $('#chatInput');
    const text = inp.value.trim();
    if (!text) return;
    try { await post('/api/chat', { text }); inp.value = ''; await load(); }
    catch (err) { toast(err.message); }
  });
  $('#chatLog').addEventListener('click', async e => {
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) {
      if (!confirm('Delete this message?')) return;
      try { await del('/api/chat/' + delBtn.dataset.del); delBtn.closest('.chat-msg').remove(); } catch (err) { toast(err.message); }
      return;
    }
    const repBtn = e.target.closest('[data-report-chat]');
    if (repBtn) reportPrompt('chat', repBtn.dataset.reportChat);
  });
};

// ---------- help forum ----------
// Players and admins both post here. The owner and admins read every topic.
ROUTES.help = async function () {
  const listHtml = topics =>
    '<div class="card"><h1>Help</h1>' +
    '<p class="muted">Ask for help, or answer someone else. Players and admins both post here — the owner and admins read every post. Never share your password.</p>' +
    '<form id="helpForm"><label for="hTitle">Title</label><input id="hTitle" maxlength="120" required placeholder="e.g. Listing my brainrot is not working">' +
    '<label for="hMsg">What do you need help with?</label><textarea id="hMsg" maxlength="1000" required placeholder="Describe the problem…"></textarea>' +
    '<p style="margin-top:12px"><button class="btn block" type="submit">Post help request</button></p><div id="helpMsg"></div></form></div>' +
    (topics.length ? topics.map(t =>
      '<div class="card" style="cursor:pointer" data-help-topic="' + t.id + '">' +
      '<h3>' + esc(t.title) + ' ' + (t.status === 'closed' ? '<span class="badge">CLOSED</span>' : '<span class="badge">OPEN</span>') + '</h3>' +
      '<p class="muted small">' + userLink({ id: t.user_id, username: t.username, badge: t.badge }) + ' · ' + timeAgo(t.created_at) +
      ' · ' + (t.replyCount || 0) + ' repl' + ((t.replyCount || 0) === 1 ? 'y' : 'ies') + '</p>' +
      '</div>').join('') : '<div class="card"><p class="muted">No help requests yet — be the first to ask.</p></div>');
  const loadList = async () => {
    const r = await get('/api/help');
    view.innerHTML = listHtml(r.topics) + finePrintHtml();
    $('#helpForm').addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('#helpMsg');
      try {
        await post('/api/help', { title: $('#hTitle').value.trim(), message: $('#hMsg').value.trim() });
        toast('Help request posted.');
        await loadList();
      } catch (err) { msg.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
    });
    view.querySelectorAll('[data-help-topic]').forEach(el => el.addEventListener('click', () => showTopic(Number(el.dataset.helpTopic))));
  };
  const showTopic = async id => {
    const r = await get('/api/help/' + id);
    const t = r.topic;
    const canMod = t.user_id === state.me.id || isAdmin();
    view.innerHTML =
      '<div class="card"><p><button class="btn ghost" id="helpBack">← Back to Help</button></p>' +
      '<h1>' + esc(t.title) + ' ' + (t.status === 'closed' ? '<span class="badge">CLOSED</span>' : '<span class="badge">OPEN</span>') + '</h1>' +
      '<p class="muted small">' + userLink({ id: t.user_id, username: t.username, badge: t.badge }) + ' · ' + timeAgo(t.created_at) + '</p>' +
      '<p>' + esc(t.message) + '</p>' +
      '<div class="row">' +
      (canMod ? '<button class="btn secondary" id="helpClose">' + (t.status === 'closed' ? 'Reopen' : 'Close') + '</button>' : '') +
      (isAdmin() ? '<button class="btn danger" id="helpDel">Delete</button>' : '') +
      '</div></div>' +
      '<div class="card"><h2>Replies</h2><div class="comments-list">' +
      (r.replies.length ? r.replies.map(c =>
        '<div class="comment"><strong>' + userLink({ id: c.user_id, username: c.username, badge: c.badge }) + '</strong> <span class="muted small">' + timeAgo(c.created_at) + '</span>' +
        '<p>' + esc(c.text) + '</p></div>').join('') : '<p class="muted small">No replies yet.</p>') +
      '</div>' +
      (t.status === 'open' || isAdmin() ?
        '<form id="helpReplyForm" style="margin-top:12px"><div class="row"><input id="helpReplyText" type="text" maxlength="500" placeholder="Write a reply…" aria-label="Write a reply" required><button class="btn" type="submit">Reply</button></div><div id="helpReplyMsg"></div></form>'
        : '<p class="muted small" style="margin-top:12px">This topic is closed.</p>') +
      '</div>' + finePrintHtml();
    $('#helpBack').addEventListener('click', loadList);
    const closeBtn = $('#helpClose');
    if (closeBtn) closeBtn.addEventListener('click', async () => {
      try { await post('/api/help/' + t.id + (t.status === 'closed' ? '/reopen' : '/close'), {}); await showTopic(t.id); }
      catch (err) { toast(err.message); }
    });
    const delBtn = $('#helpDel');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this help topic and all its replies?')) return;
      try { await del('/api/help/' + t.id); toast('Deleted.'); await loadList(); }
      catch (err) { toast(err.message); }
    });
    const form = $('#helpReplyForm');
    if (form) form.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('#helpReplyMsg');
      try {
        await post('/api/help/' + t.id + '/reply', { text: $('#helpReplyText').value.trim() });
        await showTopic(t.id);
      } catch (err) { msg.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
    });
  };
  await loadList();
};

// ---------- report helper ----------
function reportPrompt(targetType, targetId) {
  const reason = prompt('What is wrong with this? (The owner reviews all reports.)');
  if (!reason || !reason.trim()) return;
  post('/api/reports', { targetType, targetId: Number(targetId), reason: reason.trim() })
    .then(() => toast('Report sent. The owner will review it.'))
    .catch(err => toast(err.message));
}

// ---------- trade board ----------
ROUTES.trades = async function () {
  const items = await ensureItems();
  const opts = '<option value="">— any —</option>' + items.map(i => '<option value="' + esc(i.id) + '">' + esc(i.name) + '</option>').join('');
  view.innerHTML =
    '<div class="card"><h1>Trade board</h1>' +
    '<p class="muted">Post what you have and what you want. Message a poster to work out a trade — check the price first. <strong>Eternals only</strong> — no Secrets, no base brainrots. Fortnite Steal the Brainrot only, not the Roblox game.</p>' +
    '<form id="tradeForm"><label for="tTitle">Title</label><input id="tTitle" required maxlength="120" placeholder="e.g. Trading Gothic Vulkarion 2-trait">' +
    '<label for="tItem">Brainrot (optional)</label><select id="tItem">' + opts + '</select>' +
    '<label for="tHave">I have</label><input id="tHave" placeholder="What you are offering">' +
    '<label for="tWant">I want</label><input id="tWant" placeholder="What you want back">' +
    '<p style="margin-top:12px"><button class="btn block" type="submit">Post trade</button></p><div id="formMsg"></div></form></div>' +
    '<div id="tradeList"></div>' + finePrintHtml();
  const load = async () => {
    const r = await get('/api/trades');
    $('#tradeList').innerHTML = r.trades.length ? r.trades.map(t =>
      '<div class="card"><div class="spread"><h3 style="margin:0">' + esc(t.title) + '</h3>' +
      (t.status === 'open' ? '<span class="badge verified">OPEN</span>' : '<span class="badge">CLOSED</span>') + '</div>' +
      '<p class="muted small">' + userLink({ id: t.user_id, username: t.username, badge: null }) + ' · ' + timeAgo(t.created_at) + '</p>' +
      (t.have_text ? '<p><strong>Have:</strong> ' + esc(t.have_text) + '</p>' : '') +
      (t.want_text ? '<p><strong>Want:</strong> ' + esc(t.want_text) + '</p>' : '') +
      '<div class="row">' +
      (t.status === 'open' && t.user_id !== state.me.id ? '<button class="btn" data-dm-user="' + t.user_id + '" data-dm-name="' + esc(t.username) + '">Message</button>' : '') +
      (t.user_id === state.me.id && t.status === 'open' ? '<button class="btn secondary" data-close-trade="' + t.id + '">Close trade</button>' : '') +
      '<button class="btn ghost" data-report-trade="' + t.id + '">Report</button>' +
      (isAdmin() ? '<button class="btn danger" data-del-trade="' + t.id + '">Delete</button>' : '') +
      '</div></div>').join('')
      : '<div class="card"><p class="muted">No trades posted yet. Be the first.</p></div>';
  };
  await load();
  $('#tradeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#formMsg');
    try {
      await post('/api/trades', { title: $('#tTitle').value.trim(), brainrotId: $('#tItem').value || null, haveText: $('#tHave').value.trim(), wantText: $('#tWant').value.trim() });
      $('#tradeForm').reset();
      toast('Trade posted.');
      await load();
    } catch (err) { msg.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  });
  view.addEventListener('click', async e => {
    const dmBtn = e.target.closest('[data-dm-user]');
    if (dmBtn) { openDm(dmBtn.dataset.dmUser, dmBtn.dataset.dmName); return; }
    const closeBtn = e.target.closest('[data-close-trade]');
    if (closeBtn) { try { await post('/api/trades/' + closeBtn.dataset.closeTrade + '/close'); await load(); } catch (err) { toast(err.message); } return; }
    const delBtn = e.target.closest('[data-del-trade]');
    if (delBtn) { if (!confirm('Delete this trade post?')) return; try { await del('/api/trades/' + delBtn.dataset.delTrade); await load(); } catch (err) { toast(err.message); } return; }
    const repBtn = e.target.closest('[data-report-trade]');
    if (repBtn) reportPrompt('trade', repBtn.dataset.reportTrade);
  });
};

// ---------- For Sale ----------
const SCAM_CHECKLIST = [
  'I checked the price of this brainrot in the price list first.',
  'I will never send money first to a stranger — I will use a middleman I trust or trade in-game first.',
  'I know the seller can lie about traits, mutations and level — I will verify in-game before paying.',
  'I will not pay with gift cards, crypto, or any payment I cannot get back.',
  'I understand Brainrot Trades is not a party to this deal and cannot get my money back.',
];
function checklistModalHtml() {
  return '<div class="modal" id="checklistModal" role="dialog" aria-modal="true" aria-label="Scam checklist">' +
    '<div class="modal-box"><h2>Before you contact a seller</h2>' +
    '<p class="muted">Read every line and tick each box. Most scams happen because a buyer skips these.</p>' +
    '<ul class="checklist">' + SCAM_CHECKLIST.map((c, i) =>
      '<li><label><input type="checkbox" class="cl-item" data-i="' + i + '"> <span>' + esc(c) + '</span></label></li>').join('') + '</ul>' +
    '<label for="clMsg">Your message to the seller</label>' +
    '<textarea id="clMsg" placeholder="Hi — is this still for sale?"></textarea>' +
    '<div class="row" style="margin-top:12px"><button class="btn" id="clConfirm" disabled>Message seller</button>' +
    '<button class="btn secondary" id="clCancel">Cancel</button></div></div></div>';
}
function openChecklistModal(sellerId, sellerName) {
  const wrap = document.createElement('div');
  wrap.innerHTML = checklistModalHtml();
  document.body.appendChild(wrap.firstElementChild);
  const modal = $('#checklistModal');
  const update = () => { $('#clConfirm').disabled = !Array.from(modal.querySelectorAll('.cl-item')).every(c => c.checked); };
  modal.addEventListener('change', update);
  $('#clCancel').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  $('#clConfirm').onclick = async () => {
    const msg = $('#clMsg').value.trim();
    if (!msg) { toast('Write a message to the seller first.'); return; }
    try {
      await post('/api/dm/' + sellerId, { text: msg });
      modal.remove();
      toast('Message sent to ' + sellerName + '.');
      openDm(sellerId, sellerName);
    } catch (err) { toast(err.message); }
  };
}
ROUTES.sales = async function () {
  const items = await ensureItems();
  const meta = await ensureMeta();
  const opts = items.map(i => '<option value="' + esc(i.id) + '">' + esc(i.name) + '</option>').join('');
  const mutOpts = meta.mutations.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('');
  view.innerHTML =
    '<div class="card"><h1>For Sale</h1>' +
    '<p class="muted">Brainrots listed by members, for real money. The seller sets their own price. Check the price list before you pay anything. <strong>Eternals only</strong> — no Secrets, no base brainrots. Fortnite Steal the Brainrot only, not the Roblox game. If your brainrot is not in the list, pick Other and type its name.</p>' +
    '<form id="saleForm"><label for="sItem">Brainrot</label><select id="sItem">' + opts + '<option value="other">Other — not in the list</option></select>' +
    '<label for="sOtherName" id="sOtherNameLabel" style="display:none">Brainrot name</label><input id="sOtherName" maxlength="60" placeholder="Type the brainrot name" style="display:none">' +
    '<label for="sMut">Mutation</label><select id="sMut">' + mutOpts + '</select>' +
    '<label for="sPrice">Your price (USD)</label><input id="sPrice" type="number" min="1" max="100000" step="0.01" required placeholder="e.g. 30">' +
    '<label for="sDesc">Description</label><textarea id="sDesc" maxlength="500" placeholder="Traits, level…"></textarea>' +
    '<label for="sFile">Picture of your brainrot (optional)</label><input id="sFile" type="file" accept="image/*">' +
    '<div id="imgPreview" style="margin-top:8px"></div>' +
    '<label for="sImg">Or paste a picture URL (optional — leave blank to use the game picture)</label><input id="sImg" type="url" placeholder="https://…">' +
    '<p style="margin-top:12px"><button class="btn block" type="submit">List for sale</button></p><div id="formMsg"></div></form></div>' +
    '<div class="card"><div class="toolbar"><input id="saleQ" type="search" placeholder="Search for sale — brainrot, seller, traits…" aria-label="Search listings"></div></div>' +
    '<div id="saleList"></div>' + finePrintHtml();
  let allSales = [];
  const likeLabel = (liked, count) => (liked ? 'Liked' : 'Like') + ' (' + (count || 0) + ')';
  const cardHtml = s =>
    '<div class="card brainrot-card">' +
    (s.image ? '<img src="' + esc(s.image) + '" alt="' + esc(s.brainrotName) + '" loading="lazy">' : '<span class="no-pic">NO PICTURE YET</span>') +
    '<div class="info"><h3>' + esc(s.brainrotName) + '</h3>' +
    '<div class="price">' + money(s.price_usd) + '</div>' +
    (s.mutation && s.mutation !== 'Default' ? '<div class="range">Mutation: ' + esc(s.mutation) + '</div>' : '') +
    (s.brainrot_id === 'other' ? '<div class="range">Other brainrot — not in our price list</div>' : '') +
    (s.gamePicture ? '<div class="range">Game picture — seller uploaded no photo</div>' : '') +
    '<p class="muted small">' + userLink({ id: s.user_id, username: s.username, badge: null }) + ' · ' + timeAgo(s.created_at) +
    (s.status === 'open' ? '' : ' · <span class="badge">SOLD</span>') + '</p>' +
    (s.description ? '<p>' + esc(s.description) + '</p>' : '') +
    '<div class="row">' +
    '<button class="btn ghost' + (s.likedByMe ? ' liked' : '') + '" data-like="' + s.id + '">' + likeLabel(s.likedByMe, s.likeCount) + '</button>' +
    '<button class="btn ghost" data-comments="' + s.id + '">Comments (' + (s.commentCount || 0) + ')</button>' +
    (s.status === 'open' && s.user_id !== state.me.id ? '<button class="btn" data-contact-seller="' + s.user_id + '" data-seller-name="' + esc(s.username) + '">Message seller</button>' : '') +
    (s.user_id === state.me.id && s.status === 'open' ? '<button class="btn secondary" data-close-sale="' + s.id + '">Mark sold</button>' : '') +
    '<button class="btn ghost" data-report-sale="' + s.id + '">Report</button>' +
    (isAdmin() ? '<button class="btn danger" data-del-sale="' + s.id + '">Delete</button>' : '') +
    '</div>' +
    '<div class="comments" id="comments-' + s.id + '" style="display:none"></div>' +
    '</div></div>';
  const loadComments = async listingId => {
    const box = $('#comments-' + listingId);
    if (!box) return;
    try {
      const r = await get('/api/sales/' + listingId + '/comments');
      box.innerHTML = '<div class="comments-list">' + (r.comments.length ? r.comments.map(c =>
        '<div class="comment"><strong>' + esc(c.username) + '</strong> <span class="muted small">' + timeAgo(c.created_at) + '</span>' +
        '<p>' + esc(c.text) + '</p>' +
        '<div class="row">' +
        (c.user_id === state.me.id || isAdmin() ? '<button class="btn ghost" data-del-comment="' + c.id + '" data-listing="' + listingId + '">Delete</button>' : '') +
        (c.user_id !== state.me.id ? '<button class="btn ghost" data-report-comment="' + c.id + '">Report</button>' : '') +
        '</div></div>').join('') : '<p class="muted small">No comments yet — be the first.</p>') + '</div>' +
        '<form data-comment-form="' + listingId + '"><div class="row"><input type="text" maxlength="500" placeholder="Ask about this brainrot…" aria-label="Write a comment" required><button class="btn" type="submit">Comment</button></div></form>';
      const form = box.querySelector('[data-comment-form]');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const input = form.querySelector('input');
        try {
          await post('/api/sales/' + listingId + '/comments', { text: input.value });
          await loadComments(listingId);
          const s = allSales.find(x => x.id === listingId);
          if (s) { s.commentCount = (s.commentCount || 0) + 1; updateCommentsBtn(listingId, s.commentCount); }
        } catch (err) { toast(err.message); }
      });
      box.querySelectorAll('[data-del-comment]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this comment?')) return;
        try {
          await del('/api/sales/comments/' + b.dataset.delComment);
          await loadComments(listingId);
          const s = allSales.find(x => x.id === listingId);
          if (s) { s.commentCount = Math.max(0, (s.commentCount || 1) - 1); updateCommentsBtn(listingId, s.commentCount); }
        } catch (err) { toast(err.message); }
      }));
      box.querySelectorAll('[data-report-comment]').forEach(b => b.addEventListener('click', () => reportPrompt('sale_comment', b.dataset.reportComment)));
    } catch (err) { box.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  };
  const updateCommentsBtn = (listingId, count) => {
    const b = document.querySelector('[data-comments="' + listingId + '"]');
    if (b) b.textContent = 'Comments (' + count + ')';
  };
  const attachCardHandlers = () => {
    document.querySelectorAll('#saleList [data-like]').forEach(b => b.addEventListener('click', async () => {
      try {
        const r = await post('/api/sales/' + b.dataset.like + '/like');
        b.innerHTML = likeLabel(r.liked, r.likeCount);
        b.classList.toggle('liked', r.liked);
        const s = allSales.find(x => x.id === Number(b.dataset.like));
        if (s) { s.likeCount = r.likeCount; s.likedByMe = r.liked; }
      } catch (err) { toast(err.message); }
    }));
    document.querySelectorAll('#saleList [data-comments]').forEach(b => b.addEventListener('click', async () => {
      const box = $('#comments-' + b.dataset.comments);
      if (!box) return;
      if (box.style.display === 'none') { box.style.display = ''; await loadComments(Number(b.dataset.comments)); }
      else box.style.display = 'none';
    }));
  };
  const renderSales = q => {
    const list = allSales.filter(s => !q ||
      s.brainrotName.toLowerCase().includes(q) ||
      (s.username || '').toLowerCase().includes(q) ||
      (s.mutation || '').toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q));
    $('#saleList').innerHTML = list.length ? list.map(cardHtml).join('')
      : '<div class="card"><p class="muted">' + (allSales.length ? 'No listings match that search.' : 'Nothing for sale right now.') + '</p></div>';
    attachCardHandlers();
  };
  const load = async () => {
    const r = await get('/api/sales');
    allSales = r.sales;
    renderSales(($('#saleQ') && $('#saleQ').value.trim().toLowerCase()) || '');
  };
  await load();
  $('#saleQ').addEventListener('input', e => renderSales(e.target.value.trim().toLowerCase()));
  // "Other" brainrot: show the name box only when Other is picked.
  const toggleOther = () => { const other = $('#sItem').value === 'other'; $('#sOtherName').style.display = other ? '' : 'none'; $('#sOtherNameLabel').style.display = other ? '' : 'none'; };
  $('#sItem').addEventListener('change', toggleOther);
  // Shrink a picked picture in the browser (max 800px, JPEG) so the upload stays small.
  const shrinkImage = file => new Promise((resolve, reject) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      const max = 800;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Could not read that picture.')); };
    img.src = objUrl;
  });
  $('#sFile').addEventListener('change', () => {
    const f = $('#sFile').files[0];
    const prev = $('#imgPreview');
    if (!f) { prev.innerHTML = ''; return; }
    if (!f.type.startsWith('image/')) { prev.innerHTML = '<div class="error">That is not a picture.</div>'; return; }
    prev.innerHTML = '<img src="' + esc(URL.createObjectURL(f)) + '" alt="preview" style="max-width:160px;border-radius:10px">';
  });
  $('#saleForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#formMsg');
    try {
      let imageUrl = $('#sImg').value.trim() || null;
      const file = $('#sFile').files[0];
      if (file) {
        if (!file.type.startsWith('image/')) throw new Error('That file is not a picture.');
        msg.innerHTML = '<p class="muted">Uploading picture…</p>';
        const data = await shrinkImage(file);
        const up = await post('/api/sales/upload-image', { data });
        imageUrl = up.url;
      }
      await post('/api/sales', { brainrotId: $('#sItem').value, customName: $('#sItem').value === 'other' ? $('#sOtherName').value.trim() : undefined, priceUsd: Number($('#sPrice').value), description: $('#sDesc').value.trim(), imageUrl, mutation: $('#sMut').value });
      $('#saleForm').reset();
      $('#sOtherName').style.display = 'none';
      $('#sOtherNameLabel').style.display = 'none';
      $('#imgPreview').innerHTML = '';
      toast('Listed for sale.');
      await load();
    } catch (err) { msg.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  });
  view.addEventListener('click', async e => {
    const contactBtn = e.target.closest('[data-contact-seller]');
    if (contactBtn) { openChecklistModal(contactBtn.dataset.contactSeller, contactBtn.dataset.sellerName); return; }
    const closeBtn = e.target.closest('[data-close-sale]');
    if (closeBtn) { try { await post('/api/sales/' + closeBtn.dataset.closeSale + '/close'); await load(); } catch (err) { toast(err.message); } return; }
    const delBtn = e.target.closest('[data-del-sale]');
    if (delBtn) { if (!confirm('Delete this listing?')) return; try { await del('/api/sales/' + delBtn.dataset.delSale); await load(); } catch (err) { toast(err.message); } return; }
    const repBtn = e.target.closest('[data-report-sale]');
    if (repBtn) reportPrompt('sale', repBtn.dataset.reportSale);
  });
};

// ---------- private messages ----------
function openDm(userId, name) { go('messages/' + userId); }
ROUTES.messages = async function (arg) {
  if (arg) return dmConversationView(arg);
  const r = await get('/api/dm/conversations');
  view.innerHTML =
    '<div class="card"><h1>Messages</h1>' +
    '<p class="muted">Private chats between you and one other member. Nobody else can read them — not even the owner. '
    + 'If someone scams or threatens you, report the message and the owner can see that one message.</p>' +
    '<p><a class="btn secondary" href="#/friends">Friends</a> <a class="btn secondary" href="#/members">Find members</a></p></div>' +
    '<div id="convList">' + (r.conversations.length ? r.conversations.map(c =>
      '<a href="#/messages/' + c.userId + '" class="card conv-row">' +
      '<span class="conv-name">' + esc(c.username) + badgeHtml(c.badge) + '</span>' +
      '<span class="conv-last">' + (c.lastFromMe ? 'You: ' : '') + esc(c.lastMessage) + '</span>' +
      '<span class="conv-meta">' + timeAgo(c.lastAt) +
      (c.unread > 0 ? ' <span class="badge">' + c.unread + ' new</span>' : '') + '</span></a>').join('')
      : '<div class="card"><p class="muted">No conversations yet. Message a seller from For Sale, or a friend, to start one.</p></div>') +
    '</div>' + finePrintHtml();
  every(15000, async () => { try { const rr = await get('/api/dm/conversations'); if (location.hash === '#/messages') route(); } catch (e) {} });
};
async function dmConversationView(userId) {
  const r = await get('/api/dm/' + userId);
  const other = r.other;
  view.innerHTML =
    '<div class="card"><div class="spread"><h1 style="margin:0">' + esc(other.username) + badgeHtml(other.badge) + verifiedBadge(other) + '</h1>' +
    '<a class="btn secondary" href="#/messages">← All messages</a></div>' +
    '<p class="muted small">Private — only the two of you can read this. ' +
    (r.blockedByMe ? 'You blocked this member. ' : '') + (r.blockedMe ? 'This member blocked you. ' : '') + '</p>' +
    '<div class="row">' +
    '<a class="btn secondary" href="#/members/' + other.id + '">View profile</a>' +
    (r.blockedByMe
      ? '<button class="btn secondary" id="unblockBtn">Unblock</button>'
      : '<button class="btn danger" id="blockBtn">Block</button>') +
    '</div></div>' +
    '<div class="chat-log" id="dmLog"></div>' +
    (r.blockedByMe || r.blockedMe
      ? '<div class="card"><p class="muted">Messaging is blocked between you and this member.</p></div>'
      : '<form class="chat-form" id="dmForm"><input id="dmInput" maxlength="1000" placeholder="Write a private message…" autocomplete="off" aria-label="Private message">' +
        '<button class="btn" type="submit">Send</button></form>') +
    '<p class="muted small">Never send money first to a stranger. If this person tries to scam you, report the message below and block them.</p>' +
    finePrintHtml();
  let lastId = 0;
  const renderMsgs = msgs => {
    const log = $('#dmLog');
    if (!log) return;
    msgs.forEach(m => {
      lastId = Math.max(lastId, m.id);
      const mine = m.from_user_id === state.me.id;
      const div = document.createElement('div');
      div.className = 'chat-msg' + (mine ? ' mine' : '');
      div.innerHTML = '<div class="meta">' + (mine ? 'You' : esc(other.username)) + ' · ' + timeAgo(m.created_at) +
        ' <button class="btn ghost" data-report-dm="' + m.id + '" style="min-height:28px;padding:2px 8px;font-size:.8rem">Report</button></div>' +
        '<div>' + esc(m.text) + '</div>';
      log.appendChild(div);
    });
    log.scrollTop = log.scrollHeight;
  };
  renderMsgs(r.messages);
  every(4000, async () => {
    try { const rr = await get('/api/dm/' + userId + '?after=' + lastId); renderMsgs(rr.messages); } catch (e) {}
  });
  const form = $('#dmForm');
  if (form) form.addEventListener('submit', async e => {
    e.preventDefault();
    const inp = $('#dmInput');
    const text = inp.value.trim();
    if (!text) return;
    try { await post('/api/dm/' + userId, { text }); inp.value = ''; const rr = await get('/api/dm/' + userId + '?after=' + lastId); renderMsgs(rr.messages); }
    catch (err) { toast(err.message); }
  });
  const blockBtn = $('#blockBtn');
  if (blockBtn) blockBtn.onclick = async () => {
    if (!confirm('Block ' + other.username + '? They will not be able to message you or add you as a friend.')) return;
    try { await post('/api/dm/' + userId + '/block'); toast('Blocked.'); route(); } catch (err) { toast(err.message); }
  };
  const unblockBtn = $('#unblockBtn');
  if (unblockBtn) unblockBtn.onclick = async () => {
    try { await post('/api/dm/' + userId + '/unblock'); toast('Unblocked.'); route(); } catch (err) { toast(err.message); }
  };
  $('#dmLog').addEventListener('click', e => {
    const repBtn = e.target.closest('[data-report-dm]');
    if (repBtn) reportPrompt('dm', repBtn.dataset.reportDm);
  });
  await refreshUnread();
}

// ---------- friends ----------
ROUTES.friends = async function () {
  const r = await get('/api/friends');
  const row = (f, actions) =>
    '<div class="card"><div class="spread"><div><strong>' + esc(f.user.username) + '</strong>' + badgeHtml(f.user.badge) + verifiedBadge(f.user) + '</div>' +
    '<div class="row">' + actions + '</div></div></div>';
  view.innerHTML =
    '<div class="card"><h1>Friends</h1>' +
    '<p class="muted">Friends can message each other directly. Only verified subscribed members can add friends.</p>' +
    '<p><a class="btn" href="#/members">Find members</a></p></div>' +
    (r.pendingIn.length ? '<div class="card"><h2>Requests for you</h2>' +
      r.pendingIn.map(f => row(f,
        '<button class="btn" data-accept-friend="' + f.id + '">Accept</button>' +
        '<button class="btn secondary" data-decline-friend="' + f.id + '">Decline</button>')).join('') + '</div>' : '') +
    (r.pendingOut.length ? '<div class="card"><h2>Requests you sent</h2>' +
      r.pendingOut.map(f => row(f, '<span class="muted small">Waiting…</span> <button class="btn secondary" data-decline-friend="' + f.id + '">Cancel</button>')).join('') + '</div>' : '') +
    '<div class="card"><h2>Your friends (' + r.friends.length + ')</h2>' +
    (r.friends.length ? r.friends.map(f => row(f,
      '<button class="btn" data-dm-user="' + f.user.id + '" data-dm-name="' + esc(f.user.username) + '">Message</button>' +
      '<a class="btn secondary" href="#/members/' + f.user.id + '">Profile</a>' +
      '<button class="btn danger" data-remove-friend="' + f.user.id + '">Remove</button>')).join('')
      : '<p class="muted">No friends yet. Find members and send a friend request.</p>') + '</div>' + finePrintHtml();
  view.addEventListener('click', async e => {
    const a = e.target.closest('[data-accept-friend]');
    if (a) { try { await post('/api/friends/' + a.dataset.acceptFriend + '/accept'); toast('Friend added.'); route(); } catch (err) { toast(err.message); } return; }
    const d = e.target.closest('[data-decline-friend]');
    if (d) { try { await post('/api/friends/' + d.dataset.declineFriend + '/decline'); route(); } catch (err) { toast(err.message); } return; }
    const rm = e.target.closest('[data-remove-friend]');
    if (rm) { if (!confirm('Remove this friend?')) return; try { await del('/api/friends/' + rm.dataset.removeFriend); toast('Friend removed.'); route(); } catch (err) { toast(err.message); } return; }
    const dm = e.target.closest('[data-dm-user]');
    if (dm) openDm(dm.dataset.dmUser, dm.dataset.dmName);
  });
};

// ---------- members ----------
ROUTES.members = async function (arg) {
  if (arg) return memberProfileView(arg);
  view.innerHTML =
    '<div class="card"><h1>Members</h1>' +
    '<p class="muted">Find other verified members to trade with, message, or add as a friend.</p>' +
    '<div class="toolbar"><input id="mq" type="search" placeholder="Search by username…" aria-label="Search members"></div>' +
    '<div id="memberList"></div></div>' + finePrintHtml();
  const load = async q => {
    const r = await get('/api/members' + (q ? '?q=' + encodeURIComponent(q) : ''));
    $('#memberList').innerHTML = r.members.length ? r.members.map(m =>
      '<div class="card"><div class="spread"><div><a href="#/members/' + m.id + '"><strong>' + esc(m.username) + '</strong></a>' +
      badgeHtml(m.badge) + verifiedBadge(m) + '<div class="muted small">Joined ' + esc(new Date(m.joined).toLocaleDateString()) + '</div></div>' +
      '<a class="btn secondary" href="#/members/' + m.id + '">Profile</a></div></div>').join('')
      : '<p class="muted">No members found.</p>';
  };
  await load('');
  let t = null;
  $('#mq').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => load(e.target.value.trim()), 300); });
};
async function memberProfileView(id) {
  const r = await get('/api/members/' + id);
  const m = r.member;
  const isMe = state.me && state.me.id === m.id;
  let friendBtn = '';
  if (!isMe && !r.blockedByMe && !r.blockedMe) {
    if (r.friendStatus === 'none') friendBtn = '<button class="btn" id="addFriendBtn">Add friend</button>';
    else if (r.friendStatus === 'pending_out') friendBtn = '<span class="muted">Friend request sent — waiting…</span>';
    else if (r.friendStatus === 'pending_in') friendBtn = '<a class="btn" href="#/friends">Respond to their request</a>';
    else friendBtn = '<button class="btn danger" id="removeFriendBtn">Remove friend</button>';
  }
  view.innerHTML =
    '<div class="card"><h1>' + esc(m.username) + badgeHtml(m.badge) + verifiedBadge(m) + '</h1>' +
    '<p class="muted">Joined ' + esc(new Date(m.joined).toLocaleDateString()) + ' · ' + m.friendCount + ' friend' + (m.friendCount === 1 ? '' : 's') + '</p>' +
    (r.blockedByMe ? '<p class="muted">You blocked this member.</p>' : '') +
    (r.blockedMe ? '<p class="muted">This member blocked you.</p>' : '') +
    '<div class="row">' +
    (!isMe && !r.blockedByMe && !r.blockedMe ? '<button class="btn" id="dmBtn">Message</button>' : '') +
    friendBtn +
    (!isMe ? '<button class="btn ghost" id="reportMemberBtn">Report member</button>' : '') +
    '</div><div id="formMsg"></div></div>' + finePrintHtml();
  const dmBtn = $('#dmBtn');
  if (dmBtn) dmBtn.onclick = () => openDm(m.id, m.username);
  const addBtn = $('#addFriendBtn');
  if (addBtn) addBtn.onclick = async () => {
    try { await post('/api/friends/request/' + m.id); toast('Friend request sent.'); route(); }
    catch (err) { $('#formMsg').innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  };
  const rmBtn = $('#removeFriendBtn');
  if (rmBtn) rmBtn.onclick = async () => {
    if (!confirm('Remove this friend?')) return;
    try { await del('/api/friends/' + m.id); toast('Friend removed.'); route(); }
    catch (err) { $('#formMsg').innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  };
  const repBtn = $('#reportMemberBtn');
  if (repBtn) repBtn.onclick = () => reportPrompt('member', m.id);
}

// ---------- account ----------
ROUTES.account = async function () {
  if (!loggedIn()) { loginView('Log in to see your account.'); return; }
  const me = state.me;
  const blocked = await get('/api/dm/blocked/list').catch(() => ({ blocked: [] }));
  view.innerHTML =
    '<div class="card"><h1>Your account</h1>' +
    '<p><strong>' + esc(me.username) + '</strong>' + badgeHtml(me.badge) + verifiedBadge(me) + '</p>' +
    '<p class="muted">' + esc(me.email) + ' · Joined ' + esc(new Date(me.createdAt).toLocaleDateString()) + '</p>' +
    '<p>Subscription: ' + (me.hasAccess
      ? '<strong>Active</strong>' + (me.subscription && me.subscription.endsAt ? ' until ' + esc(new Date(me.subscription.endsAt).toLocaleDateString()) : ' (free — owner, co-owner or admin)')
      : '<strong>Not active</strong> — <a href="#/subscribe">subscribe $' + (state.cfg ? state.cfg.priceUsd : 3) + '/month</a>') + '</p>' +
    (me.isAdmin ? '<p><a class="btn" href="#/admin">Open admin panel</a></p>' : '') +
    '<p><a class="btn secondary" href="#/messages">Messages' + (state.unread ? ' (' + state.unread + ' unread)' : '') + '</a> ' +
    '<a class="btn secondary" href="#/friends">Friends</a></p>' +
    '<p><button class="btn secondary" id="logoutBtn2">Log out</button></p></div>' +
    (blocked.blocked.length ? '<div class="card"><h2>Blocked members</h2>' +
      blocked.blocked.map(b => '<div class="spread"><span>' + esc(b.username) + '</span>' +
        '<button class="btn secondary" data-unblock="' + b.id + '">Unblock</button></div>').join('') + '</div>' : '') +
    finePrintHtml();
  $('#logoutBtn2').onclick = async () => { await post('/api/auth/logout'); state.me = null; state.items = null; location.hash = '#/home'; await loadMe(); renderNav(); };
  view.addEventListener('click', async e => {
    const u = e.target.closest('[data-unblock]');
    if (u) { try { await post('/api/dm/' + u.dataset.unblock + '/unblock'); toast('Unblocked.'); route(); } catch (err) { toast(err.message); } }
  });
};

// ---------- admin ----------
ROUTES.admin = async function () {
  if (!isAdmin()) {
    view.innerHTML = '<div class="card"><div class="error">Admin only.</div></div>' + finePrintHtml();
    return;
  }
  const stats = await get('/api/admin/stats');
  const items = await ensureItems();
  view.innerHTML =
    '<div class="card"><h1>Admin panel</h1>' +
    '<p class="muted">Owner: ' + esc('pgevil22@gmail.com') + ' · Co-owner: amber_fenton@yahoo.com · Admin: vcadorette@icloud.com. '
    + 'You can never warn or ban the owner, a co-owner cannot warn or ban another co-owner, and only the owner or a co-owner can warn or ban an admin.</p>' +
    '<div class="grid two">' +
    '<div class="card"><strong>Members</strong><div class="price">' + stats.members + '</div></div>' +
    '<div class="card"><strong>Active subscriptions</strong><div class="price">' + stats.activeSubscriptions + '</div></div>' +
    '<div class="card"><strong>Chat messages</strong><div class="price">' + stats.chatMessages + '</div></div>' +
    '<div class="card"><strong>Open reports</strong><div class="price">' + stats.openReports + '</div></div>' +
    '<div class="card"><strong>Waiting for approval</strong><div class="price">' + (stats.pendingApprovals || 0) + '</div></div>' +
    '</div>' +
    '<p class="muted small">PayPal Secret configured: ' + (stats.paypalSecretConfigured ? 'yes — subscriptions are verified with PayPal' : 'no — subscriptions are recorded from checkout only; add PAYPAL_CLIENT_SECRET to verify them server-side') + '.</p></div>' +
    '<div class="card"><h2>Waiting for approval</h2><div id="pendingList">Loading…</div></div>' +
    '<div class="card"><h2>Reports</h2><div id="reportList">Loading…</div></div>' +
    '<div class="card"><h2>Members</h2><div id="memberAdminList">Loading…</div></div>' +
    '<div class="card"><h2>Edit a brainrot price</h2>' +
    '<form id="priceForm"><label for="pItem">Brainrot</label><select id="pItem">' +
    items.map(i => '<option value="' + esc(i.id) + '">' + esc(i.name) + ' — now ' + moneyRange(i.typicalLow, i.typicalHigh) + '</option>').join('') + '</select>' +
    '<label for="pLow">Typical low (USD)</label><input id="pLow" type="number" step="0.01" min="0" required>' +
    '<label for="pHigh">Typical high (USD)</label><input id="pHigh" type="number" step="0.01" min="0" required>' +
    '<label><input type="checkbox" id="pBall" style="width:24px;height:24px;min-height:24px"> Ballpark (estimate, no confirmed listing)</label>' +
    '<p style="margin-top:12px"><button class="btn" type="submit">Save price</button> ' +
    '<button class="btn secondary" type="button" id="pReset">Reset to research price</button></p><div id="priceMsg"></div></form></div>' +
    '<div class="card"><h2>Add a new brainrot</h2>' +
    '<form id="addForm"><label for="aName">Name</label><input id="aName" required maxlength="80">' +
    '<label for="aLow">Typical low (USD)</label><input id="aLow" type="number" step="0.01" min="0" required>' +
    '<label for="aHigh">Typical high (USD)</label><input id="aHigh" type="number" step="0.01" min="0" required>' +
    '<p style="margin-top:12px"><button class="btn" type="submit">Add brainrot</button></p><div id="addMsg"></div></form></div>' +
    '<div class="card"><h2>Update rarity</h2>' +
    '<form id="rarForm"><label for="rName">Brainrot name</label><input id="rName" required placeholder="e.g. Vulkarion">' +
    '<label for="rPct">Spawn % at Tier 13</label><input id="rPct" type="number" step="0.0001" min="0" required>' +
    '<label for="rTier">Tier</label><select id="rTier"><option>Eternal</option><option>Absolute</option><option>GOAT</option></select>' +
    '<p style="margin-top:12px"><button class="btn" type="submit">Save rarity</button></p><div id="rarMsg"></div></form></div>' +
    finePrintHtml();
  const loadPending = async () => {
    const r = await get('/api/admin/pending');
    $('#pendingList').innerHTML = r.pending.length ? r.pending.map(p =>
      '<div class="card"><div class="spread"><div><strong>' + esc(p.username) + '</strong>' +
      '<div class="muted small">' + esc(p.email) + ' · signed up ' + timeAgo(p.created_at) + '</div></div>' +
      '<div class="row"><button class="btn" data-approve="' + p.id + '">Approve</button>' +
      '<button class="btn danger" data-reject="' + p.id + '">Reject</button></div></div></div>').join('')
      : '<p class="muted">No accounts waiting.</p>';
  };
  const loadReports = async () => {
    const r = await get('/api/admin/reports');
    $('#reportList').innerHTML = r.reports.length ? r.reports.map(rep =>
      '<div class="card"><p><strong>' + esc(rep.target_type) + ' #' + rep.target_id + '</strong> — ' + esc(rep.reason) +
      '<br><span class="muted small">Reported by ' + esc(rep.reporter_username) + ' · ' + timeAgo(rep.created_at) + ' · ' + esc(rep.status) + '</span></p>' +
      '<div class="row">' +
      (rep.target_type === 'dm' ? '<button class="btn secondary" data-view-dm="' + rep.target_id + '">View reported message</button>' : '') +
      (rep.status === 'open' ? '<button class="btn" data-resolve-report="' + rep.id + '">Resolve</button>' : '') +
      '</div><div class="dm-report" id="dmrep-' + rep.target_id + '"></div></div>').join('')
      : '<p class="muted">No reports.</p>';
  };
  const loadMembers = async () => {
    const r = await get('/api/admin/members');
    $('#memberAdminList').innerHTML = r.members.map(m =>
      '<div class="card"><div class="spread"><div><strong>' + esc(m.username) + '</strong>' + badgeHtml(m.badge) + verifiedBadge(m) +
      '<div class="muted small">' + esc(m.email) + ' · sub: ' + esc(m.subscription) + (m.warnCount ? ' · warnings: ' + m.warnCount : '') + (m.banned ? ' · BANNED' : '') + '</div></div>' +
      '<div class="row">' +
      '<button class="btn secondary" data-warn="' + m.id + '">Warn</button>' +
      (m.banned
        ? '<button class="btn" data-unban="' + m.id + '">Unban</button>'
        : '<button class="btn danger" data-ban="' + m.id + '">Ban</button>') +
      '<button class="btn secondary" data-grant="' + m.id + '">Give 30 days</button>' +
      '<button class="btn ghost" data-revoke="' + m.id + '">Remove access</button>' +
      '</div></div></div>').join('');
  };
  await loadPending();
  await loadReports();
  await loadMembers();
  view.addEventListener('click', async e => {
    const ap = e.target.closest('[data-approve]');
    if (ap) { try { await post('/api/admin/approve', { userId: Number(ap.dataset.approve) }); toast('Approved.'); await loadPending(); await loadMembers(); } catch (err) { toast(err.message); } return; }
    const rj = e.target.closest('[data-reject]');
    if (rj) { if (!confirm('Reject this account? It will be deleted.')) return; try { await post('/api/admin/reject', { userId: Number(rj.dataset.reject) }); toast('Rejected.'); await loadPending(); await loadMembers(); } catch (err) { toast(err.message); } return; }
    const res = e.target.closest('[data-resolve-report]');
    if (res) { await post('/api/admin/reports/' + res.dataset.resolveReport + '/resolve'); await loadReports(); return; }
    const vdm = e.target.closest('[data-view-dm]');
    if (vdm) {
      try {
        const d = await get('/api/admin/dm/' + vdm.dataset.viewDm);
        $('#dmrep-' + vdm.dataset.viewDm).innerHTML = '<div class="card" style="background:var(--surface2)"><p><strong>Reported message</strong> (private chat — shown only because it was reported)</p>' +
          '<p>' + esc(d.message.from) + ' → ' + esc(d.message.to) + ': “' + esc(d.message.text) + '”</p>' +
          '<p class="muted small">' + esc(d.report.reason) + ' · reported by ' + esc(d.report.reporter) + '</p></div>';
      } catch (err) { toast(err.message); }
      return;
    }
    const w = e.target.closest('[data-warn]');
    if (w) { try { await post('/api/admin/members/' + w.dataset.warn + '/warn'); toast('Warning added.'); await loadMembers(); } catch (err) { toast(err.message); } return; }
    const b = e.target.closest('[data-ban]');
    if (b) { if (!confirm('Ban this member? They will not be able to log in or post.')) return; try { await post('/api/admin/members/' + b.dataset.ban + '/ban'); toast('Banned.'); await loadMembers(); } catch (err) { toast(err.message); } return; }
    const u = e.target.closest('[data-unban]');
    if (u) { try { await post('/api/admin/members/' + u.dataset.unban + '/unban'); toast('Unbanned.'); await loadMembers(); } catch (err) { toast(err.message); } return; }
    const g = e.target.closest('[data-grant]');
    if (g) { try { await post('/api/admin/subscription/grant', { userId: Number(g.dataset.grant), days: 30 }); toast('30 days given.'); await loadMembers(); } catch (err) { toast(err.message); } return; }
    const rv = e.target.closest('[data-revoke]');
    if (rv) { try { await post('/api/admin/subscription/revoke', { userId: Number(rv.dataset.revoke) }); toast('Access removed.'); await loadMembers(); } catch (err) { toast(err.message); } return; }
  });
  $('#priceForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#priceMsg');
    try {
      await post('/api/admin/prices', { itemId: $('#pItem').value, typicalLow: Number($('#pLow').value), typicalHigh: Number($('#pHigh').value), ballpark: $('#pBall').checked });
      state.items = null;
      msg.innerHTML = '<div class="success">Price saved.</div>';
    } catch (err) { msg.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  });
  $('#pReset').addEventListener('click', async () => {
    const msg = $('#priceMsg');
    try { await post('/api/admin/prices/reset', { itemId: $('#pItem').value }); state.items = null; msg.innerHTML = '<div class="success">Reset to the research price.</div>'; }
    catch (err) { msg.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  });
  $('#addForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#addMsg');
    try {
      const r = await post('/api/admin/brainrots', { name: $('#aName').value.trim(), typicalLow: Number($('#aLow').value), typicalHigh: Number($('#aHigh').value) });
      state.items = null;
      msg.innerHTML = '<div class="success">Added: ' + esc(r.id) + '.</div>';
      $('#addForm').reset();
    } catch (err) { msg.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  });
  $('#rarForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#rarMsg');
    try {
      await post('/api/admin/rarity', { name: $('#rName').value.trim(), pct: Number($('#rPct').value), tier: $('#rTier').value });
      state.rarity = null;
      msg.innerHTML = '<div class="success">Rarity saved.</div>';
    } catch (err) { msg.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  });
};

// ---------- init ----------
(async function init() {
  await loadCfg();
  await loadMe();
  await refreshUnread();
  every(60000, refreshUnread);
  route();
})();
