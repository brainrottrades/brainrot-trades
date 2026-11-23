/* Brainrot Trades — single-page app.
   Fortnite "Steal the Brainrot" (Creative). NOT the Roblox game.
   Views: home (landing) · prices · checker · rarity · chat · trades ·
   sales · messages · friends · members · account · admin · subscribe.
   Full content is behind the $3/month subscription; the landing page is public.
*/
'use strict';

const $ = (sel, root) => (root || document).querySelector(sel);
const view = $('#view');
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
  return '<footer class="site">Brainrot Trades is a price guide and meeting place only. '
    + 'We are not a party to any trade, sale or private deal, we do not hold money or brainrots, '
    + 'and we are not liable for anything that happens between members — including scams, '
    + 'lost items or lost money. Trade at your own risk: check prices, use a middleman you trust, '
    + 'and never send money first to a stranger.</footer>';
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
  { route: 'chat', label: 'Chat', ico: '💬' },
  { route: 'messages', label: 'Messages', ico: '✉️' },
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
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  const parts = h.split('/');
  return { route: parts[0] || 'home', arg: parts[1] || null };
}
const ROUTES = {};
function go(route) { location.hash = '#/' + route; }
window.addEventListener('hashchange', route);
chatFab.addEventListener('click', () => go('chat'));
$('#brandHome').addEventListener('click', e => { e.preventDefault(); go('home'); });

async function route() {
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
  view.innerHTML =
    '<div class="card paywall"><h1>Members only</h1>' +
    '<p>' + esc(note || 'The full site is for subscribers.') + '</p>' +
    '<p class="price-tag">$' + price + '/month</p>' +
    '<p class="muted">Price list, trade checker, rarity chart, live chat, trade board, For Sale, private messages and friends.</p>' +
    (loggedIn()
      ? '<p><a class="btn" href="#/subscribe">Subscribe — $' + price + '/month</a></p>'
      : '<p><a class="btn" href="#/signup">Sign up</a> <a class="btn secondary" href="#/login">Log in</a></p>') +
    '</div>' + finePrintHtml();
}

// ---------- landing page ----------
ROUTES.home = async function () {
  let preview = [];
  try { preview = (await get('/api/preview')).items; } catch (e) { preview = []; }
  const price = state.cfg ? state.cfg.priceUsd : 3;
  const feats = [
    ['Price list', 'All 88 Eternal brainrots priced, with pictures — every brainrot has a ballpark price.'],
    ['Trade checker', 'Check any brainrot by mutation and traits, and compare two brainrots to see if a trade is worth it.'],
    ['Rarity chart', 'Every Eternal ranked least rarest to rarest, plus Absolute and GOAT rarities.'],
    ['Live chat', 'Talk with other players and organise trades in real time.'],
    ['Trade board', 'Post what you have and what you want — other members come to you.'],
    ['For Sale', 'List brainrots for real money with your own price and picture.'],
    ['Verified members', 'Every member verifies their email. Owners, co-owners and admins are badged.'],
    ['Owner moderation & safety', 'Scam checklist before every deal, report and block buttons, and the owner reviews reports.'],
  ];
  view.innerHTML =
    '<section class="hero card"><img class="hero-icon" src="/img/skibidi-toilet.png" alt="Skibidi Toilet">' +
    '<h1>Brainrot Trades</h1>' +
    '<p class="muted">Fortnite Steal the Brainrot — prices, trades, rarity and a safe place to buy, sell and trade.</p>' +
    '<p class="price-tag">$' + price + '/month</p>' +
    '<p class="muted">Everything in the app, one price. Cancel anytime.</p>' +
    (hasAccess()
      ? '<p><a class="btn" href="#/prices">Open the price list</a></p>'
      : '<p><a class="btn" href="#/signup">Sign up</a> <a class="btn secondary" href="#/login">Log in</a></p>') +
    '</section>' +
    '<div class="card"><h2>What you get</h2><ul class="feature-list">' +
    feats.map(f => '<li><strong>' + esc(f[0]) + '</strong><br><span class="muted">' + esc(f[1]) + '</span></li>').join('') +
    '</ul></div>' +
    (preview.length ? '<div class="card"><h2>A taste of the price list</h2><div class="grid two">' +
      preview.map(i =>
        '<div class="brainrot-card">' + imgHtml(i) + '<div class="info"><h3>' + esc(i.name) + '</h3>' +
        '<div class="price">' + moneyRange(i.typicalLow, i.typicalHigh) + '</div>' +
        (i.ballpark ? ' <span class="badge ballpark">BALLPARK</span>' : '') +
        '</div></div>').join('') +
      '</div><p class="muted small">Sample only — the full list of 88 brainrots is for members.</p>' +
      (hasAccess() ? '' : '<p><a class="btn" href="#/signup">See all 88 — subscribe $' + price + '/month</a></p>') +
      '</div>' : '') +
    '<div class="card"><h2>How it works</h2><ol class="steps">' +
    '<li><strong>Sign up</strong> — pick a username and email.</li>' +
    '<li><strong>Verify your email</strong> — we send a 6-digit code.</li>' +
    '<li><strong>Subscribe $' + price + '/month</strong> — PayPal, cancel anytime. Full access right away.</li>' +
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
  view.innerHTML = authCard('Sign up',
    '<form id="signupForm">' +
    '<label for="suUser">Username</label><input id="suUser" required minlength="3" maxlength="24" autocomplete="username" placeholder="Your display name">' +
    '<label for="suEmail">Email</label><input id="suEmail" type="email" required autocomplete="email" placeholder="you@example.com">' +
    '<label for="suPass">Password</label><input id="suPass" type="password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters">' +
    '<p style="margin-top:12px"><button class="btn block" type="submit">Create account</button></p>' +
    '<p class="form-note">We email you a 6-digit code to verify your email. Then subscribe $' + (state.cfg ? state.cfg.priceUsd : 3) + '/month for full access.</p>' +
    '<p class="form-note">Already have an account? <a href="#/login">Log in</a></p>' +
    '<div id="formMsg"></div></form>');
  $('#signupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#formMsg');
    try {
      const r = await post('/api/auth/register', {
        username: $('#suUser').value.trim(), email: $('#suEmail').value.trim(), password: $('#suPass').value,
      });
      sessionStorage.setItem('bt_verify_email', $('#suEmail').value.trim().toLowerCase());
      toast(r.message || 'Code sent.');
      go('verify');
    } catch (err) { msg.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; }
  });
};
ROUTES.login = async function (note) {
  view.innerHTML = authCard('Log in',
    (typeof note === 'string' && note ? '<div class="error">' + esc(note) + '</div>' : '') +
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
  const price = state.cfg ? state.cfg.priceUsd : 3;
  if (hasAccess()) {
    const sub = state.me.subscription;
    view.innerHTML = '<div class="card"><h1>Your subscription</h1>' +
      '<p>You have full access' + (sub && sub.endsAt ? ' until ' + esc(new Date(sub.endsAt).toLocaleDateString()) : '') + '.</p>' +
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
  view.innerHTML = '<div class="card"><h1>Subscribe</h1>' +
    '<p class="price-tag" style="font-size:2rem;font-weight:800;color:var(--accent)">$' + price + '/month</p>' +
    '<p>Full access to everything: price list, trade checker, rarity chart, live chat, trade board, For Sale, private messages and friends.</p>' +
    '<ul class="feature-list"><li>Charged monthly until you cancel</li><li>Cancel anytime — access runs to the end of the paid month</li><li>Pay with PayPal</li></ul>' +
    '<div id="paypalButtons"></div>' +
    '<div id="formMsg"></div>' +
    '<p class="form-note">Payments go to the site owner via PayPal. Brainrot Trades is not a party to trades or sales between members.</p>' +
    '</div>' + finePrintHtml();
  if (!state.cfg || !state.cfg.paypalConfigured) {
    $('#formMsg').innerHTML = '<div class="error">PayPal is not configured on this site yet. The owner needs to finish the PayPal setup.</div>';
    return;
  }
  try {
    await loadPayPalSdk();
    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'subscribe' },
      createSubscription: (data, actions) => actions.subscription.create({ plan_id: state.cfg.planId }),
      onApprove: async (data) => {
        try {
          const r = await post('/api/subscribe/activate', { subscriptionId: data.subscriptionID });
          await loadMe();
          toast('Subscribed — welcome!');
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
    '<p class="muted">All 88 Eternal brainrots. Prices are sellers’ asking prices in USD (Nov 2026 snapshot), not sold prices. '
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
    (x.image ? ' <img src="' + esc(x.image) + '" alt="" style="display:inline-block;width:28px;height:28px;vertical-align:middle;border-radius:6px">' : '') +
    (x.overridden ? ' <span class="badge">UPDATED</span>' : '') +
    '</span><span class="pct">' + x.pct + '%</span></div>';
  const maxPct = Math.max.apply(null, r.eternal.map(x => x.pct));
  view.innerHTML =
    '<div class="card"><h1>Rarity chart</h1>' +
    '<p class="muted">Spawn chances at Luck Tier 13 (in-game index, Nov 22, 2026). Least rarest to rarest. Eternals only, plus Absolute and GOAT.</p>' +
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
    '<p class="muted">Post what you have and what you want. Message a poster to work out a trade — check the price first.</p>' +
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
  const opts = items.map(i => '<option value="' + esc(i.id) + '">' + esc(i.name) + '</option>').join('');
  view.innerHTML =
    '<div class="card"><h1>For Sale</h1>' +
    '<p class="muted">Brainrots listed by members, for real money. The seller sets their own price. Check the price list before you pay anything.</p>' +
    '<form id="saleForm"><label for="sItem">Brainrot</label><select id="sItem">' + opts + '</select>' +
    '<label for="sPrice">Your price (USD)</label><input id="sPrice" type="number" min="1" max="100000" step="0.01" required placeholder="e.g. 30">' +
    '<label for="sDesc">Description</label><textarea id="sDesc" maxlength="500" placeholder="Traits, mutation, level…"></textarea>' +
    '<label for="sImg">Your own picture URL (optional — leave blank to use the game picture)</label><input id="sImg" type="url" placeholder="https://…">' +
    '<p style="margin-top:12px"><button class="btn block" type="submit">List for sale</button></p><div id="formMsg"></div></form></div>' +
    '<div id="saleList"></div>' + finePrintHtml();
  const load = async () => {
    const r = await get('/api/sales');
    $('#saleList').innerHTML = r.sales.length ? r.sales.map(s =>
      '<div class="card brainrot-card">' +
      (s.image ? '<img src="' + esc(s.image) + '" alt="' + esc(s.brainrotName) + '">' : '<span class="no-pic">NO PICTURE YET</span>') +
      '<div class="info"><h3>' + esc(s.brainrotName) + '</h3>' +
      '<div class="price">' + money(s.price_usd) + '</div>' +
      (s.gamePicture ? '<div class="range">Game picture — seller uploaded no photo</div>' : '') +
      '<p class="muted small">' + userLink({ id: s.user_id, username: s.username, badge: null }) + ' · ' + timeAgo(s.created_at) +
      (s.status === 'open' ? '' : ' · <span class="badge">SOLD</span>') + '</p>' +
      (s.description ? '<p>' + esc(s.description) + '</p>' : '') +
      '<div class="row">' +
      (s.status === 'open' && s.user_id !== state.me.id ? '<button class="btn" data-contact-seller="' + s.user_id + '" data-seller-name="' + esc(s.username) + '">Message seller</button>' : '') +
      (s.user_id === state.me.id && s.status === 'open' ? '<button class="btn secondary" data-close-sale="' + s.id + '">Mark sold</button>' : '') +
      '<button class="btn ghost" data-report-sale="' + s.id + '">Report</button>' +
      (isAdmin() ? '<button class="btn danger" data-del-sale="' + s.id + '">Delete</button>' : '') +
      '</div></div></div>').join('')
      : '<div class="card"><p class="muted">Nothing for sale right now.</p></div>';
  };
  await load();
  $('#saleForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#formMsg');
    try {
      await post('/api/sales', { brainrotId: $('#sItem').value, priceUsd: Number($('#sPrice').value), description: $('#sDesc').value.trim(), imageUrl: $('#sImg').value.trim() || null });
      $('#saleForm').reset();
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
    '</div>' +
    '<p class="muted small">PayPal Secret configured: ' + (stats.paypalSecretConfigured ? 'yes — subscriptions are verified with PayPal' : 'no — subscriptions are recorded from checkout only; add PAYPAL_CLIENT_SECRET to verify them server-side') + '.</p></div>' +
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
  await loadReports();
  await loadMembers();
  view.addEventListener('click', async e => {
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
