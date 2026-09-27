'use strict';
/* Motorparts Inventory — front end (vanilla JS, hash routing) */

// Shop name, address and receipt text come from the server (data/shop.json), loaded at startup.
let SHOP = { name: 'Motorparts', badge: 'MP', wordmark: 'Motorparts', tagline: '', address: '', phone: '', receiptFooter: '' };
function applyBranding() {
  document.title = `${SHOP.name} Inventory`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><circle cx='32' cy='32' r='30' fill='#111'/>` +
    `<circle cx='32' cy='32' r='26' fill='none' stroke='#e0202b' stroke-width='3'/><text x='32' y='42' font-family='Arial Black,Arial' ` +
    `font-weight='900' font-size='24' fill='#e0202b' text-anchor='middle' font-style='italic'>${esc(SHOP.badge)}</text></svg>`;
  let link = document.querySelector('link[rel=icon]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}
const PAYMENTS = ['Cash', 'GCash', 'Maya', 'Bank Transfer', 'COD (LBC / J&T)'];

const state = {
  user: null, items: [], categories: [], cart: [],
  inv: { q: '', cat: '', status: 'all', sort: 'category', dir: 1, bike: '', uni: false },
  pos: { bike: '', uni: false },
};

// ------------------------------------------------------------ fits my bike
// The Fits column reads like "NMAX / AEROX" or "CLICK 125 / 150"; the first word of each part is the model.
// Brand-level fits ("HONDA") count for that brand's models, so picking CLICK also shows Honda-fit parts.
const BIKE_BRAND = { CLICK: 'HONDA', BEAT: 'HONDA', PCX: 'HONDA', ADV: 'HONDA', XRM: 'HONDA', VARIO: 'HONDA', WAVE: 'HONDA',
  TMX: 'HONDA', AIRBLADE: 'HONDA', GENIO: 'HONDA', NMAX: 'YAMAHA', AEROX: 'YAMAHA', MIO: 'YAMAHA', SNIPER: 'YAMAHA', M3: 'YAMAHA',
  XMAX: 'YAMAHA', FAZZIO: 'YAMAHA', RAIDER: 'SUZUKI', SMASH: 'SUZUKI', SKYDRIVE: 'SUZUKI', BURGMAN: 'SUZUKI' };
const NOT_MODELS = new Set(['UNIVERSAL', 'RH', 'LH', 'NON', 'ABS', 'FRONT', 'REAR', 'HONDA', 'YAMAHA', 'SUZUKI', 'KAWASAKI']);
function fitsOf(it) {
  if (!it._fits) {
    const words = new Set();
    for (const part of String(it.compat || '').toUpperCase().replace(/\(.*?\)/g, ' ').split(/[/,&+]/)) {
      const w = part.trim().split(/\s+/)[0];
      if (w && /^[A-Z][A-Z0-9]+$/.test(w) && !/^V\d+$/.test(w)) words.add(w); // "V2" in "AEROX V1/V2" is a version, not a bike
    }
    it._fits = words;
  }
  return it._fits;
}
const isUniversal = (it) => !it.compat || /^\s*universal\s*$/i.test(it.compat);
const fitsBike = (it, bike) => fitsOf(it).has(bike) || fitsOf(it).has(BIKE_BRAND[bike]);
function bikeList(items) {
  const n = new Map();
  for (const it of items) for (const w of fitsOf(it)) if (!NOT_MODELS.has(w)) n.set(w, (n.get(w) || 0) + 1);
  return [...n].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([w]) => w);
}
// items for the chosen bike: parts made for it first, then universal parts if asked for
function bikeFilter(items, f) {
  if (!f.bike) return items;
  return items.filter(it => fitsBike(it, f.bike) || (f.uni && isUniversal(it)));
}
function bikeChipsHtml(f, id) {
  const bikes = bikeList(state.items);
  if (!bikes.length) return '';
  return `<div class="bike-row" id="${id}"><span class="bike-label">${icon('bike')}Fits</span>
    <button class="chip ${f.bike ? '' : 'on'}" data-bike="">Any bike</button>
    ${bikes.map(b => `<button class="chip ${f.bike === b ? 'on' : ''}" data-bike="${esc(b)}">${esc(b)}</button>`).join('')}
    <label class="uni-toggle ${f.bike ? '' : 'hidden'}"><input type="checkbox" data-uni ${f.uni ? 'checked' : ''}> + Universal parts</label></div>`;
}
function bindBikeChips(root, f, redraw) {
  root.onclick = (e) => {
    const b = e.target.closest('[data-bike]'); if (!b) return;
    f.bike = b.dataset.bike;
    root.querySelectorAll('[data-bike]').forEach(c => c.classList.toggle('on', c === b));
    root.querySelector('.uni-toggle').classList.toggle('hidden', !f.bike);
    redraw();
  };
  root.querySelector('[data-uni]').onchange = (e) => { f.uni = e.target.checked; redraw(); };
}

// ------------------------------------------------------------ utils
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pesoFmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const peso = (n) => pesoFmt.format(Number(n) || 0);
const pesoShort = (n) => { n = Number(n) || 0; return Math.abs(n) >= 1e6 ? '₱' + (n / 1e6).toFixed(2) + 'M' : Math.abs(n) >= 1e4 ? '₱' + (n / 1e3).toFixed(1) + 'k' : peso(n); };
const count = (n) => new Intl.NumberFormat('en-PH').format(Number(n) || 0);
const pcs = (n) => `${count(n)} ${Math.abs(Number(n)) === 1 ? 'pc' : 'pcs'}`;
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtDate = (s) => { if (!s) return ''; const d = new Date(s.replace(' ', 'T')); return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }); };
const fmtDateTime = (s) => { if (!s) return ''; const d = new Date(s.replace(' ', 'T')); return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const isAdmin = () => state.user?.role === 'admin';
const itemStatus = (it) => it.stock <= 0 ? 'out' : it.stock <= it.reorder_level ? 'low' : 'ok';
const statusPill = (it) => ({ out: '<span class="pill out">No stock</span>', low: '<span class="pill low">Low stock</span>', ok: '<span class="pill ok">Available</span>' })[itemStatus(it)];
const MOVE_LABEL = { IN: 'Stock in', OUT: 'Stock out', SALE: 'Sale', ADJUST: 'Count adjust', VOID: 'Sale voided', NEW: 'Added' };
const fromSheet = (m) => /Google Sheet/.test(m.note || '');
const isReturn = (m) => /^Customer return/.test(m.note || '');
const moveTag = (m, withQty) => `<span class="tag ${fromSheet(m) ? 'SYNC' : isReturn(m) ? 'RETURN' : m.type}">${
  fromSheet(m) ? (m.type === 'NEW' ? 'From sheet' : 'Sheet sync') : isReturn(m) ? 'Return' : MOVE_LABEL[m.type]}${
  withQty ? ` ${m.qty > 0 ? '+' : ''}${m.qty}` : ''}</span>`;
const ago = (iso) => {
  const sec = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return sec < 60 ? 'just now' : sec < 3600 ? `${Math.floor(sec / 60)} min ago` : sec < 86400 ? `${Math.floor(sec / 3600)} h ago` : fmtDateTime(iso);
};

async function api(method, url, body) {
  if (!navigator.onLine) throw new Error("You're offline. Check the internet connection and try again.");
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') { state.user = null; renderLogin(); throw new Error('Please log in again'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Receipt printers differ per counter, so the paper size is a setting on this device.
const PAPERS = [['80', '80mm receipt printer'], ['58', '58mm receipt printer'], ['a4', 'A4 / Letter printer']];
function printDoc(html) {
  const root = $('#print-root');
  root.className = `paper-${remember.get('print.paper') || '80'}`;
  root.innerHTML = html;
  window.print();
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

const I = {
  dash: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6"/>',
  receipt: '<path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2zM9 7h6M9 11h6M9 15h4"/>',
  log: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  down: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>',
  inout: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.3"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  bike: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M15 6h3l2 6M5.5 17 9 10h6l3.5 7M9 10 7.5 7H5"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;
const logoHtml = () => `<div class="logo"><div class="logo-badge">${esc(SHOP.badge)}</div><div class="logo-text">${esc(SHOP.wordmark)}<small>${SHOP.demo ? 'Demo data' : 'Inventory System'}</small></div></div>`;

// ------------------------------------------------------------ data
async function loadItems() {
  [state.items, state.categories] = await Promise.all([api('GET', '/api/items'), api('GET', '/api/categories')]);
}

// ------------------------------------------------------------ modal
function openModal({ title, body, foot = '', wide = false, onMount }) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div></div>`;
  const back = root.firstElementChild;
  back.addEventListener('mousedown', e => { if (e.target === back) closeModal(); });
  back.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
  onMount?.(back);
  back.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  return back;
}
function closeModal() { $('#modal-root').innerHTML = ''; }
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  // "/" jumps to the page's search box, unless you're already typing somewhere
  if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !$('#modal-root').children.length) {
    const box = $('#pos-q') || $('#inv-q');
    if (box) { e.preventDefault(); box.focus(); box.select(); }
  }
});
const remember = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

function confirmBox(title, message, okLabel = 'Confirm', danger = true) {
  return new Promise(resolve => {
    const m = openModal({
      title, body: `<p style="margin:0">${message}</p>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'primary' : 'dark'}" data-ok>${esc(okLabel)}</button>`,
    });
    m.querySelector('[data-ok]').onclick = () => { closeModal(); resolve(true); };
    m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => resolve(false)));
  });
}

function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function showErr(root, msg) { const e = root.querySelector('.err'); e.textContent = msg; e.classList.remove('hidden'); }

// ------------------------------------------------------------ shell / router
const NAV = [
  ['dashboard', 'Dashboard', 'dash'],
  ['inventory', 'Inventory', 'box'],
  ['sell', 'Sell / POS', 'cart'],
  ['sales', 'Sales', 'receipt'],
  ['closing', 'Daily closing', 'lock'],
  ['stock-log', 'Stock Log', 'log'],
  ['reports', 'Reports', 'chart'],
  ['settings', 'Settings', 'gear'],
];
const MOBILE_NAV = ['dashboard', 'inventory', 'sell', 'sales', 'settings'];

function renderShell() {
  $('#app').innerHTML = `
    <div class="shell">
      <aside class="side">
        ${logoHtml()}
        <nav class="nav">${NAV.map(([k, l, i]) => `<a href="#/${k}" data-nav="${k}">${icon(i)}${l}</a>`).join('')}</nav>
        <div class="side-foot">
          <div class="who">${esc(state.user.full_name || state.user.username)}</div>
          <div class="muted">${state.user.role === 'admin' ? 'Admin' : 'Staff'} · @${esc(state.user.username)}</div>
          <button data-logout>Log out</button>
        </div>
      </aside>
      <div>
        <header class="topbar">${logoHtml()}<button data-logout>Log out</button></header>
        <main class="main" id="main"></main>
      </div>
    </div>
    <nav class="bottom-nav">${NAV.filter(n => MOBILE_NAV.includes(n[0])).map(([k, l, i]) =>
      `<a href="#/${k}" data-nav="${k}">${icon(i)}${l.split(' ')[0]}</a>`).join('')}</nav>`;
  document.querySelectorAll('[data-logout]').forEach(b => b.onclick = async () => {
    await api('POST', '/api/logout').catch(() => {});
    state.user = null; renderLogin();
  });
}

const PAGES = {};
async function route() {
  if (!state.user) return;
  const page = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';  // e.g. #/closing?day=2026-09-27
  const fn = PAGES[page] || PAGES.dashboard;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === page));
  const main = $('#main');
  main.innerHTML = '<div class="loading">Loading…</div>';
  window.scrollTo(0, 0);
  try { await fn(main); }
  catch (e) { main.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);

function pageHead(title, sub, actions = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="head-actions">${actions}</div></div>`;
}

// ------------------------------------------------------------ login
function authPage(formHtml) {
  closeModal();
  $('#app').innerHTML = `
    <div class="login">
      <section class="login-art">
        ${logoHtml()}
        <div>
          <h2>Every part.<br>Every peso.<br><em>Accounted for.</em></h2>
          <p>${esc(SHOP.tagline)} Inventory, sales and stock tracking for ${esc(SHOP.name)}${SHOP.address ? `, ${esc(SHOP.address)}` : ''}.</p>
        </div>
        <p style="font-size:12.5px;margin:0">${esc(SHOP.phone)}</p>
      </section>
      <section class="login-form"><form class="stack">${formHtml}</form></section>
    </div>`;
  const form = $('.login-form form');
  form.querySelector('input')?.focus();
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); } });
  return form;
}

function renderLogin() {
  const form = authPage(`
    <div><h1>Log in</h1><p class="muted" style="margin:0">Use your shop account to continue.</p></div>
    ${SHOP.demo ? `<div class="sync-status">Demo data. Log in as <b>admin</b> / <b>admin123</b>, or staff <b>jenny</b> / <b>staff1234</b>.</div>` : ''}
    <div class="err hidden"></div>
    <div class="field"><label for="u">Username</label><input class="input" id="u" name="username" autocomplete="username" required></div>
    <div class="field"><label for="p">Password</label><input class="input" id="p" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn primary block" type="submit">Log in</button>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button'); btn.disabled = true;
    try {
      const creds = formData(form);
      state.user = await api('POST', '/api/login', creds);
      await start(creds.password);
    } catch (err) { showErr(form, err.message); btn.disabled = false; }
  };
}

// First login (or after an admin reset): replace the temporary password before anything else.
function renderSetPassword(currentPw) {
  const form = authPage(`
    <div><h1>Set your password</h1><p class="muted" style="margin:0">Hi ${esc(state.user.full_name || state.user.username)}! You're using a temporary
      password. Choose your own before continuing, at least 8 characters.</p></div>
    <div class="err hidden"></div>
    ${currentPw ? '' : `<div class="field"><label>Temporary password</label><input class="input" name="current" type="password" autocomplete="current-password" required></div>`}
    <div class="field"><label>New password</label><input class="input" name="next" type="password" minlength="8" autocomplete="new-password" required></div>
    <div class="field"><label>Repeat new password</label><input class="input" name="again" type="password" minlength="8" autocomplete="new-password" required></div>
    <button class="btn primary block" type="submit">Save and continue</button>
    <button class="btn block" type="button" data-logout>Log out</button>`);
  form.querySelector('[data-logout]').onclick = async () => {
    await api('POST', '/api/logout').catch(() => {});
    state.user = null; renderLogin();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(form);
    if (d.next !== d.again) return showErr(form, 'New passwords do not match');
    try {
      await api('POST', '/api/me/password', { current: currentPw || d.current, next: d.next });
      state.user.must_change = 0;
      toast('Password saved');
      await start();
    } catch (err) { showErr(form, err.message); }
  };
}

async function start(currentPw) {
  if (state.user.must_change) return renderSetPassword(currentPw);
  await loadItems();
  renderShell();
  if (!location.hash) location.hash = '#/dashboard'; else route();
}

// ------------------------------------------------------------ dashboard
PAGES.dashboard = async (main) => {
  const d = await api('GET', '/api/dashboard');
  const t = d.totals;
  const maxCat = Math.max(1, ...d.byCategory.map(c => c.capital));
  const days = [...Array(7)].map((_, i) => ymd(addDays(new Date(), i - 6)));
  const salesByDay = Object.fromEntries(d.last7.map(r => [r.day, r.total]));
  const maxDay = Math.max(1, ...days.map(k => salesByDay[k] || 0));
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  main.innerHTML = pageHead('Dashboard', `${greet}, ${esc(state.user.full_name || state.user.username)}. Here's how the shop stands today.`,
    `<a class="btn" href="#/inventory">${icon('box')}Inventory</a><a class="btn primary" href="#/sell">${icon('cart')}New sale</a>`) + `
    <div class="stats">
      <div class="card stat hero"><div class="label">Total money in stock</div><div class="value num">${peso(t.capital)}</div>
        <div class="sub">${count(t.units)} pcs across ${count(t.items)} items (at unit cost)</div></div>
      <div class="card stat"><div class="label">Retail value (SRP)</div><div class="value num">${peso(t.retail)}</div>
        <div class="sub">Potential profit <b style="color:var(--green)">${peso(t.retail - t.capital)}</b>${t.no_srp
          ? ` · <a href="#/inventory" data-nosrp style="color:var(--amber);font-weight:600">${t.no_srp} without SRP</a>` : ''}</div></div>
      <div class="card stat"><div class="label">Sales today</div><div class="value num">${peso(d.today.total)}</div>
        <div class="sub">${d.today.count} receipt${d.today.count === 1 ? '' : 's'} · profit ${peso(d.today.profit)}${
          d.today.returns ? ` · ${peso(d.today.returns)} refunded` : ''}</div></div>
      <div class="card stat"><div class="label">Needs restock</div><div class="value num ${t.out_of_stock ? 'red' : ''}">${t.out_of_stock + t.low_stock}</div>
        <div class="sub">${t.out_of_stock} out of stock · ${t.low_stock} running low</div></div>
    </div>
    <div class="dash-grid">
      <div class="stack" style="gap:18px">
        <div class="card">
          <div class="card-head"><h2>Sales — last 7 days</h2><a href="#/reports">Reports →</a></div>
          ${d.last7.length ? `<div class="cols">${days.map(k => { const v = salesByDay[k] || 0; return `<div class="col">
            <div class="v num">${v ? pesoShort(v) : ''}</div>
            <div class="stick ${v ? '' : 'zero'}" style="height:${Math.max(2, (v / maxDay) * 100)}%"></div>
            <div class="d">${new Date(k + 'T00:00').toLocaleDateString('en-PH', { weekday: 'short' })}</div></div>`; }).join('')}</div>`
            : `<div class="chart-empty"><b>No sales in the last 7 days yet</b>
              <span>Sales show up here as soon as they're rung up in <a href="#/sell">Sell / POS</a>.
              The Google Sheet only holds stock counts, and voided sales don't count.</span></div>`}
          <div class="muted" style="padding:0 18px 14px;font-size:12.5px">This month: <b style="color:var(--ink)">${peso(d.month.total)}</b> from ${d.month.count} sales · profit ${peso(d.month.profit)}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Money in stock by category</h2></div>
          <div class="bars">${d.byCategory.map(c => `<div class="bar-row">
            <div class="name" title="${esc(c.category)}">${esc(c.category)} <span class="muted">(${c.items})</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${(c.capital / maxCat) * 100}%"></div></div>
            <div class="amt num">${peso(c.capital)}</div></div>`).join('')}</div>
        </div>
      </div>
      <div class="stack" style="gap:18px">
        <div class="card">
          <div class="card-head"><h2>Restock soon</h2><span><a href="#" data-reorder>Reorder list</a> · <a href="#/inventory" data-lowlink>See all →</a></span></div>
          ${d.lowItems.length ? `<ul class="list">${d.lowItems.map(it => `<li data-item="${it.id}" style="cursor:pointer">
            <div style="min-width:0"><div class="t">${esc(it.name)}</div><div class="s">${esc(it.category)} · ${esc(it.compat)}</div></div>
            <div style="text-align:right">${statusPill(it)}<div class="s num">${it.stock} left</div></div></li>`).join('')}</ul>`
            : '<div class="empty">Everything is well stocked.</div>'}
        </div>
        <div class="card">
          <div class="card-head"><h2>Recent activity</h2><a href="#/stock-log">Stock log →</a></div>
          ${d.recent.length ? `<ul class="list">${d.recent.map(m => `<li>
            <div style="min-width:0"><div class="t">${esc(m.name)}</div><div class="s">${fmtDateTime(m.at)} · ${esc(m.username || '')}</div></div>
            ${moveTag(m, true)}</li>`).join('')}</ul>`
            : '<div class="empty">No sales or stock movements yet.</div>'}
        </div>
      </div>
    </div>`;
  main.querySelectorAll('[data-item]').forEach(li => li.onclick = () => itemDetail(Number(li.dataset.item)));
  main.querySelector('[data-lowlink]').onclick = () => { state.inv.status = 'attention'; };
  main.querySelector('[data-nosrp]')?.addEventListener('click', () => { state.inv.status = 'nosrp'; });
  main.querySelector('[data-reorder]').onclick = (e) => { e.preventDefault(); reorderModal(); };
};

// ------------------------------------------------------------ inventory
PAGES.inventory = async (main) => {
  const [, sync] = await Promise.all([loadItems(), api('GET', '/api/sheet/status').catch(() => null)]);
  const f = state.inv;
  main.innerHTML = pageHead('Inventory', `${count(state.items.length)} items in ${state.categories.length} categories${
    sync?.syncedAt ? ` · synced from Google Sheet ${ago(sync.syncedAt)}` : ''}`,
    `<button class="btn" data-reorder>${icon('truck')}Reorder list</button>
     <a class="btn" href="/api/export/items.csv">${icon('down')}Export to Excel (CSV)</a>
     <button class="btn primary" data-add>${icon('plus')}Add item</button>`) + `
    <div class="card">
      <div class="toolbar">
        <div class="search">${icon('search')}<input class="input" id="inv-q" placeholder="Search item, brand, SKU or motorcycle (e.g. NMAX, Click)…" value="${esc(f.q)}"></div>
        <select class="select" id="inv-cat"><option value="">All categories</option>
          ${state.categories.map(c => `<option value="${c.id}" ${String(c.id) === f.cat ? 'selected' : ''}>${esc(c.name)} (${c.items})</option>`).join('')}</select>
        <div class="chips" id="inv-status">${[['all', 'All'], ['ok', 'Available'], ['attention', 'Low / No stock'], ['out', 'No stock'], ['nosrp', 'No SRP']]
          .map(([k, l]) => `<button class="chip ${f.status === k ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
      </div>
      ${bikeChipsHtml(f, 'inv-bikes')}
      <div class="summary-bar" id="inv-sum"></div>
      <div class="table-wrap"><table class="tbl responsive">
        <thead><tr>
          ${[['name', 'Item'], ['category', 'Category'], ['stock', 'Stock', 'r'], ['cost', 'Unit cost', 'r'], ['srp', 'SRP', 'r'], ['value', 'Total cost', 'r']]
            .map(([k, l, c]) => `<th class="sortable ${c || ''}" data-sort="${k}">${l}<span data-arrow="${k}"></span></th>`).join('')}
          <th>Status</th><th></th></tr></thead>
        <tbody id="inv-body"></tbody></table></div>
    </div>`;

  const draw = () => {
    const q = f.q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    let rows = bikeFilter(state.items, f).filter(it => {
      if (f.cat && String(it.category_id) !== f.cat) return false;
      const s = itemStatus(it);
      if (f.status === 'ok' && s !== 'ok') return false;
      if (f.status === 'out' && s !== 'out') return false;
      if (f.status === 'attention' && s === 'ok') return false;
      if (f.status === 'nosrp' && it.srp > 0) return false;
      const hay = `${it.name} ${it.sku} ${it.compat} ${it.category}`.toLowerCase();
      return q.every(w => hay.includes(w));
    });
    const key = f.sort, dir = f.dir;
    const val = (it) => key === 'value' ? it.stock * it.cost : it[key];
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
      return (c || a.name.localeCompare(b.name)) * dir;
    });
    main.querySelectorAll('[data-arrow]').forEach(s => s.textContent = s.dataset.arrow === key ? (dir > 0 ? ' ↑' : ' ↓') : '');
    const units = rows.reduce((s, r) => s + r.stock, 0), cap = rows.reduce((s, r) => s + r.stock * r.cost, 0), ret = rows.reduce((s, r) => s + r.stock * r.srp, 0);
    const unpriced = f.status === 'nosrp' && rows.some(r => r.cost > 0);
    $('#inv-sum').innerHTML = `<span>Showing <b>${rows.length}</b> items</span><span><b>${count(units)}</b> pcs</span>
      <span>Total cost <b class="num">${peso(cap)}</b></span><span>Retail value <b class="num">${peso(ret)}</b></span>
      ${unpriced ? `<span class="bulk-price">Type a price in each row, or set all at cost +
        <input class="input num" id="markup" type="number" min="1" max="300" value="30">%
        <button class="btn sm primary" data-bulkprice>Set all</button></span>` : ''}`;
    $('#inv-body').innerHTML = rows.length ? rows.map(it => {
      const margin = it.srp - it.cost;
      return `<tr class="clickable" data-id="${it.id}">
        <td class="first"><div class="item-name">${esc(it.name)}</div><div class="item-sub">${esc(it.sku)} · Fits: ${esc(it.compat)}</div></td>
        <td class="hide-sm">${esc(it.category)}</td>
        <td class="r num" data-l="Stock"><b>${count(it.stock)}</b></td>
        <td class="r num" data-l="Cost">${peso(it.cost)}</td>
        <td class="r num" data-l="SRP">${it.srp > 0 ? `${peso(it.srp)}<div class="item-sub" title="Profit per piece">+${peso(margin)}</div>`
          : `<span class="srp-quick"><input class="input num srp-in" data-id="${it.id}" type="number" min="1" step="1"
              placeholder="${it.cost > 0 ? suggestSrp(it.cost) : 'SRP'}" title="No selling price yet. Type one and press Enter."></span>`}</td>
        <td class="r num" data-l="Total">${peso(it.stock * it.cost)}</td>
        <td>${statusPill(it)}</td>
        <td class="actions">
          <button class="btn sm" data-stock="${it.id}">${icon('inout')}Stock</button>
          <button class="icon-btn" data-edit="${it.id}" title="Edit">${icon('edit')}</button>
        </td></tr>`;
    }).join('') : `<tr><td colspan="8" class="empty">No items match your search.</td></tr>`;
  };
  draw();

  $('#inv-q').oninput = (e) => { f.q = e.target.value; draw(); };
  if ($('#inv-bikes')) bindBikeChips($('#inv-bikes'), f, draw);
  $('#inv-cat').onchange = (e) => { f.cat = e.target.value; draw(); };
  $('#inv-status').onclick = (e) => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    f.status = b.dataset.s;
    $('#inv-status').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
    draw();
  };
  main.querySelector('thead').onclick = (e) => {
    const th = e.target.closest('[data-sort]'); if (!th) return;
    const k = th.dataset.sort;
    f.dir = f.sort === k ? -f.dir : (['stock', 'cost', 'srp', 'value'].includes(k) ? -1 : 1);
    f.sort = k; draw();
  };
  $('#inv-body').onclick = (e) => {
    const s = e.target.closest('[data-stock]'), ed = e.target.closest('[data-edit]'), row = e.target.closest('tr[data-id]');
    if (s) return stockModal(Number(s.dataset.stock), draw);
    if (ed) return itemForm(Number(ed.dataset.edit), draw);
    if (row) itemDetail(Number(row.dataset.id), draw);
  };
  main.querySelector('[data-add]').onclick = () => itemForm(null, draw);
  main.querySelector('[data-reorder]').onclick = () => reorderModal();
  // quick pricing: type an SRP right in the list
  $('#inv-body').addEventListener('click', (e) => { if (e.target.closest('.srp-quick')) e.stopPropagation(); }, true);
  $('#inv-body').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.srp-in')) e.target.blur(); });
  $('#inv-body').addEventListener('change', async (e) => {
    if (!e.target.matches('.srp-in')) return;
    const srp = Number(e.target.value);
    if (!(srp > 0)) return;
    try {
      await api('POST', '/api/items/prices', { prices: [{ id: Number(e.target.dataset.id), srp }] });
      toast(`Price set: ${peso(srp)}`); await loadItems(); draw();
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#inv-sum').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-bulkprice]'); if (!b) return;
    const markup = Number($('#markup').value) || 30;
    const list = state.items.filter(it => it.srp <= 0 && it.cost > 0).map(it => ({ id: it.id, srp: suggestSrp(it.cost, markup) }));
    if (!list.length) return;
    if (!await confirmBox('Set prices for all?', `Give <b>${list.length}</b> items without an SRP a price of cost + ${markup}%, rounded to ₱5.
      You can still change any of them later. A price the owner sets in the Google Sheet replaces these on the next sync.`, 'Set prices', false)) return;
    try { const r = await api('POST', '/api/items/prices', { prices: list }); toast(`${r.saved} prices set`); await loadItems(); draw(); }
    catch (err) { toast(err.message, 'error'); }
  });
};
const suggestSrp = (cost, markup = 30) => Math.max(5, Math.ceil((cost * (1 + markup / 100)) / 5) * 5);

function itemForm(id, after) {
  const it = id ? state.items.find(i => i.id === id) : { name: '', category_id: state.categories[0]?.id, compat: 'UNIVERSAL', stock: 0, cost: '', srp: '', reorder_level: 0, sku: '' };
  const m = openModal({
    title: id ? 'Edit item' : 'Add new item',
    body: `<form class="stack" id="item-form">
      <div class="err hidden"></div>
      <div class="field"><label>Item name</label><input class="input" name="name" value="${esc(it.name)}" placeholder="e.g. RCB Caliper R1 (Black)" required></div>
      <div class="grid-2">
        <div class="field"><label>Category</label><select class="select" name="category_id">
          ${state.categories.map(c => `<option value="${c.id}" ${c.id === it.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Fits / Compatibility</label><input class="input" name="compat" value="${esc(it.compat)}" placeholder="UNIVERSAL, NMAX / AEROX…" list="compat-list">
          <datalist id="compat-list">${[...new Set(state.items.map(i => i.compat))].sort().map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
      </div>
      <div class="grid-3">
        <div class="field"><label>Unit cost (₱)</label><input class="input" name="cost" type="number" step="0.01" min="0" value="${esc(it.cost)}" required></div>
        <div class="field"><label>SRP / Selling price (₱)</label><input class="input" name="srp" type="number" step="0.01" min="0" value="${esc(it.srp)}" required></div>
        <div class="field"><label>Profit per piece</label><input class="input" id="margin" disabled></div>
      </div>
      <div class="grid-3">
        ${id ? `<div class="field"><label>SKU / Code</label><input class="input" name="sku" value="${esc(it.sku)}" required></div>`
             : `<div class="field"><label>Starting stock</label><input class="input" name="stock" type="number" min="0" step="1" value="0"></div>`}
        <div class="field"><label>Low-stock alert at</label><input class="input" name="reorder_level" type="number" min="0" step="1" value="${esc(it.reorder_level)}">
          <span class="hint">Warn at this qty or less (0 = only when sold out)</span></div>
        ${id ? `<div class="field"><label>Current stock</label><input class="input" value="${it.stock}" disabled><span class="hint">Change via “Stock” button</span></div>` : ''}
      </div>
    </form>`,
    foot: `${id && isAdmin() ? `<button class="btn danger" data-del>${icon('trash')}Delete</button><span class="spacer"></span>` : ''}
      <button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${id ? 'Save changes' : 'Add item'}</button>`,
  });
  const form = m.querySelector('form');
  const upd = () => { const c = Number(form.cost.value) || 0, s = Number(form.srp.value) || 0;
    $('#margin').value = s ? `${peso(s - c)} (${c ? Math.round(((s - c) / c) * 100) : 0}%)` : ''; };
  form.cost.oninput = form.srp.oninput = upd; upd();
  const save = async () => {
    if (!form.reportValidity()) return;
    try {
      if (id) await api('PUT', `/api/items/${id}`, formData(form));
      else await api('POST', '/api/items', formData(form));
      closeModal(); toast(id ? 'Item updated' : 'Item added');
      await loadItems(); after?.();
    } catch (e) { showErr(m, e.message); }
  };
  m.querySelector('[data-save]').onclick = save;
  form.onsubmit = (e) => { e.preventDefault(); save(); };
  m.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!await confirmBox('Delete item?', `Delete <b>${esc(it.name)}</b> permanently? This cannot be undone.`, 'Delete')) return;
    try { await api('DELETE', `/api/items/${id}`); toast('Item deleted'); await loadItems(); after?.(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

function stockModal(id, after, startType = 'IN') {
  const it = state.items.find(i => i.id === id);
  let type = startType;
  const m = openModal({
    title: 'Update stock',
    body: `<div style="margin-bottom:14px"><div class="item-name" style="font-weight:700">${esc(it.name)}</div>
      <div class="muted" style="font-size:13px">${esc(it.sku)} · Current stock: <b style="color:var(--ink)">${it.stock}</b></div></div>
      <div class="seg" id="seg">
        <button type="button" data-t="IN">+ Stock in</button><button type="button" data-t="OUT">− Stock out</button><button type="button" data-t="ADJUST">Physical count</button></div>
      <form class="stack" id="stock-form"><div class="err hidden"></div>
        <div class="grid-2">
          <div class="field"><label id="qty-label">Quantity</label><input class="input" name="qty" type="number" min="0" step="1" required></div>
          <div class="field" id="cost-field"><label>Unit cost for this delivery (₱)</label><input class="input" name="cost" type="number" step="0.01" min="0" value="${it.cost}"><span class="hint">Updates the item's unit cost</span></div>
        </div>
        <div class="field"><label>Note</label><input class="input" name="note" id="note" list="notes"><datalist id="notes"></datalist></div>
        <div class="muted" id="preview" style="font-size:13px"></div>
      </form>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button>`,
  });
  const form = m.querySelector('form');
  const NOTES = { IN: ['New delivery from supplier', 'Customer return'], OUT: ['Damaged / defective', 'Returned to supplier', 'Used in shop service', 'Lost'], ADJUST: ['Monthly physical count'] };
  const set = (t) => {
    type = t;
    m.querySelectorAll('#seg button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    $('#cost-field').classList.toggle('hidden', t !== 'IN');
    $('#qty-label').textContent = t === 'ADJUST' ? 'Actual count on shelf' : t === 'IN' ? 'Quantity received' : 'Quantity removed';
    $('#notes').innerHTML = NOTES[t].map(n => `<option value="${n}">`).join('');
    prev();
  };
  const prev = () => {
    const q = parseInt(form.qty.value, 10);
    if (Number.isNaN(q)) { $('#preview').textContent = ''; return; }
    const next = type === 'IN' ? it.stock + q : type === 'OUT' ? it.stock - q : q;
    $('#preview').innerHTML = `New stock will be <b style="color:var(--ink)">${next}</b>${next < 0 ? ' — not enough stock' : ''}`;
  };
  m.querySelector('#seg').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) set(b.dataset.t); };
  form.qty.oninput = prev;
  set(type);
  form.qty.focus();
  const save = async () => {
    if (!form.reportValidity()) return;
    try {
      const body = { type, qty: form.qty.value, note: form.note.value };
      if (type === 'IN') body.cost = form.cost.value;
      const r = await api('POST', `/api/items/${id}/stock`, body);
      closeModal(); toast(`Stock updated — now ${r.stock}`);
      await loadItems(); after?.();
    } catch (e) { showErr(m, e.message); }
  };
  m.querySelector('[data-save]').onclick = save;
  form.onsubmit = (e) => { e.preventDefault(); save(); };
}

async function itemDetail(id, after) {
  const it = await api('GET', `/api/items/${id}`);
  const m = openModal({
    title: it.name, wide: true,
    body: `<div class="muted" style="margin:-6px 0 14px;font-size:13px">${esc(it.sku)} · ${esc(it.category)} · Fits: ${esc(it.compat)} · ${statusPill(it)}</div>
      <div class="kv">
        <div><span>In stock</span><b class="num">${count(it.stock)}</b></div>
        <div><span>Unit cost</span><b class="num">${peso(it.cost)}</b></div>
        <div><span>SRP</span><b class="num">${peso(it.srp)}</b></div>
        <div><span>Total cost</span><b class="num">${peso(it.stock * it.cost)}</b></div>
      </div>
      <h4 style="margin:0 0 8px;font:700 16px var(--display);text-transform:uppercase">History</h4>
      <div class="table-wrap" style="max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:10px">
      <table class="tbl"><thead><tr><th>Date</th><th>Action</th><th class="r">Qty</th><th class="r">Stock after</th><th>Note</th><th>By</th></tr></thead><tbody>
        ${it.history.map(h => `<tr><td style="white-space:nowrap">${fmtDateTime(h.at)}</td><td>${moveTag(h)}</td>
          <td class="r num">${h.qty > 0 ? '+' : ''}${h.qty}</td><td class="r num">${h.stock_after}</td>
          <td>${esc(h.note)}${h.receipt_no ? ` <span class="muted">#${esc(h.receipt_no)}</span>` : ''}</td><td>${esc(h.username || '')}</td></tr>`).join('')}
      </tbody></table></div>`,
    foot: it.archived ? `<span class="muted" style="margin-right:auto">No longer in the Google Sheet, so it's hidden from inventory and POS.</span>
      <button class="btn" data-close>Close</button>` : `<button class="btn" data-edit>${icon('edit')}Edit details</button><span class="spacer"></span>
      <button class="btn" data-out>− Stock out</button><button class="btn primary" data-in>+ Stock in</button>`,
  });
  if (it.archived) return;
  const refresh = async () => { after?.(); if (location.hash.includes('dashboard')) route(); };
  m.querySelector('[data-edit]').onclick = () => itemForm(id, refresh);
  m.querySelector('[data-in]').onclick = () => stockModal(id, refresh, 'IN');
  m.querySelector('[data-out]').onclick = () => stockModal(id, refresh, 'OUT');
}

// ------------------------------------------------------------ sell / POS
PAGES.sell = async (main) => {
  await loadItems();
  main.innerHTML = pageHead('Sell / POS', 'Tap an item to add it to the sale. Stock is deducted automatically.') + `
    <div class="pos">
      <div class="card">
        <div class="toolbar">
          <div class="search">${icon('search')}<input class="input" id="pos-q" placeholder="Search item or motorcycle…" autocomplete="off"></div>
          <select class="select" id="pos-cat"><option value="">All categories</option>${state.categories.filter(c => c.items)
            .map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        </div>
        ${bikeChipsHtml(state.pos, 'pos-bikes')}
        <div class="pos-hint muted" id="pos-hint"></div>
        <div class="pos-results" id="pos-results"></div>
      </div>
      <div class="card cart">
        <div class="card-head" style="padding-bottom:12px;border-bottom:1px solid var(--line)"><h2>Current sale</h2><button class="btn sm" data-clear>Clear</button></div>
        <div class="cart-lines" id="cart-lines"></div>
        <div class="cart-total">
          <div class="grid-2" style="gap:10px;margin-bottom:12px">
            <div class="field"><label>Customer (optional)</label><input class="input" id="pos-cust" placeholder="Walk-in"></div>
            <div class="field"><label>Payment</label><select class="select" id="pos-pay">${PAYMENTS.map(p => `<option>${p}</option>`).join('')}</select></div>
          </div>
          <div class="row"><span>Items</span><span id="c-units">0</span></div>
          <div class="grand"><span style="font-weight:600">Total</span><b class="num" id="c-total">₱0</b></div>
          <button class="btn primary block" id="pos-done" style="padding:13px">Complete sale</button>
        </div>
      </div>
    </div>`;

  const drawResults = () => {
    const raw = $('#pos-q').value.trim(), q = raw.toLowerCase().split(/\s+/).filter(Boolean), cat = $('#pos-cat').value, p = state.pos;
    const browsing = !raw && !cat && !p.bike;
    const specific = (it) => p.bike && fitsBike(it, p.bike) ? 1 : 0;
    const rows = bikeFilter(state.items, p).filter(it => (!cat || String(it.category_id) === cat) &&
      q.every(w => `${it.name} ${it.sku} ${it.compat} ${it.category}`.toLowerCase().includes(w)))
      .sort((a, b) => (b.stock > 0) - (a.stock > 0) || specific(b) - specific(a)
        || (browsing ? (b.sold_30d || 0) - (a.sold_30d || 0) : 0) || a.name.localeCompare(b.name)).slice(0, 150);
    $('#pos-hint').textContent = browsing ? 'Best sellers of the last 30 days first. Type to search, or pick a bike above. Press / to search from anywhere.'
      : p.bike ? `Parts that fit ${p.bike}${p.uni ? ', then universal parts' : ''}.` : '';
    $('#pos-results').innerHTML = rows.length ? rows.map(it => `<div class="pos-item ${it.stock <= 0 ? 'disabled' : ''}" data-id="${it.id}">
      <div style="min-width:0"><div style="font-weight:600">${esc(it.name)}</div><div class="item-sub muted" style="font-size:12.5px">${esc(it.compat)} · ${it.stock > 0 ? `${it.stock} in stock` : 'No stock'}${it.sold_30d ? ` · ${it.sold_30d} sold this month` : ''}</div></div>
      <div class="price num">${it.srp > 0 ? peso(it.srp) : '<span class="pill low">No SRP</span>'}</div></div>`).join('') : '<div class="empty">No items found.</div>';
  };
  const drawCart = () => {
    const c = state.cart;
    $('#cart-lines').innerHTML = c.length ? c.map((l, i) => `<div class="cart-line" data-i="${i}">
      <div class="top"><span>${esc(l.name)}</span><span class="num">${peso(l.qty * l.price)}</span></div>
      <div class="ctrl">
        <div class="qty"><button data-dec aria-label="Less">−</button><input data-qty type="number" min="1" max="${l.max}" value="${l.qty}"><button data-inc aria-label="More">+</button></div>
        <span class="muted">×</span><input class="input price-in num" data-price type="number" min="0" step="0.01" value="${l.price}" title="Price each (edit for discount)">
        <button class="icon-btn" data-rm title="Remove" style="margin-left:auto">${icon('trash')}</button>
      </div>${l.price <= 0 ? `<div class="item-sub" style="color:var(--red-dark);font-size:12px;margin-top:4px;font-weight:600">Enter the selling price${l.srp ? '' : ' (no SRP in the sheet)'}</div>`
        : l.price < l.cost ? `<div class="item-sub" style="color:var(--red-dark);font-size:12px;margin-top:4px">Below cost (${peso(l.cost)})</div>`
        : l.price < l.srp ? `<div class="item-sub" style="color:var(--amber);font-size:12px;margin-top:4px">Discounted from ${peso(l.srp)}</div>` : ''}</div>`).join('')
      : '<div class="empty">No items yet.<br>Search and tap an item to add it.</div>';
    $('#c-units').textContent = c.reduce((s, l) => s + l.qty, 0);
    $('#c-total').textContent = peso(c.reduce((s, l) => s + l.qty * l.price, 0));
    $('#pos-done').disabled = !c.length || c.some(l => !(l.price > 0));
  };
  drawResults(); drawCart();
  const lastPay = remember.get('pos.payment');
  if (lastPay && PAYMENTS.includes(lastPay)) $('#pos-pay').value = lastPay;
  $('#pos-pay').onchange = (e) => remember.set('pos.payment', e.target.value);
  if ($('#pos-bikes')) bindBikeChips($('#pos-bikes'), state.pos, drawResults);
  if (matchMedia('(min-width: 1001px)').matches) $('#pos-q').focus();

  $('#pos-q').oninput = drawResults;
  $('#pos-cat').onchange = drawResults;
  $('#pos-q').onkeydown = (e) => { if (e.key === 'Enter') $('#pos-results .pos-item:not(.disabled)')?.click(); };
  $('#pos-results').onclick = (e) => {
    const row = e.target.closest('.pos-item'); if (!row || row.classList.contains('disabled')) return;
    const it = state.items.find(i => i.id === Number(row.dataset.id));
    const line = state.cart.find(l => l.item_id === it.id);
    if (line) { if (line.qty < it.stock) line.qty++; else return toast(`Only ${it.stock} in stock`, 'error'); }
    else state.cart.push({ item_id: it.id, name: it.name, qty: 1, price: it.srp, srp: it.srp, cost: it.cost, max: it.stock });
    drawCart();
  };
  $('#cart-lines').onclick = (e) => {
    const el = e.target.closest('[data-i]'); if (!el) return;
    const l = state.cart[el.dataset.i];
    if (e.target.closest('[data-inc]')) { if (l.qty < l.max) l.qty++; else toast(`Only ${l.max} in stock`, 'error'); }
    else if (e.target.closest('[data-dec]')) { l.qty > 1 ? l.qty-- : state.cart.splice(el.dataset.i, 1); }
    else if (e.target.closest('[data-rm]')) state.cart.splice(el.dataset.i, 1);
    else return;
    drawCart();
  };
  $('#cart-lines').onchange = (e) => {
    const el = e.target.closest('[data-i]'); if (!el) return;
    const l = state.cart[el.dataset.i];
    if (e.target.matches('[data-qty]')) l.qty = Math.min(l.max, Math.max(1, parseInt(e.target.value, 10) || 1));
    if (e.target.matches('[data-price]')) l.price = Math.max(0, Number(e.target.value) || 0);
    drawCart();
  };
  main.querySelector('[data-clear]').onclick = () => { state.cart = []; drawCart(); };
  $('#pos-done').onclick = async () => {
    const btn = $('#pos-done'); btn.disabled = true;
    try {
      const r = await api('POST', '/api/sales', {
        customer: $('#pos-cust').value, payment: $('#pos-pay').value,
        lines: state.cart.map(l => ({ item_id: l.item_id, qty: l.qty, price: l.price })),
      });
      state.cart = [];
      await loadItems(); drawResults(); drawCart();
      $('#pos-cust').value = ''; $('#pos-q').value = ''; drawResults();
      toast(`Sale saved — receipt #${r.receipt_no}`);
      await showReceipt(r.id);
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  };
};

function receiptHtml(s) {
  const returns = s.returns || [];
  const refunded = returns.reduce((t, r) => t + r.total, 0);
  return `<div class="receipt">
    ${s.voided ? '<div class="void-stamp">VOIDED</div>' : ''}
    <div class="c"><h4>${esc(SHOP.name.toUpperCase())}</h4><div>${esc(SHOP.address)}</div><div>${esc(SHOP.phone)}</div>
      <div class="doc-type">ACKNOWLEDGEMENT RECEIPT</div></div>
    <hr><div>Receipt #: ${esc(s.receipt_no)}</div><div>Date: ${esc(fmtDateTime(s.at))}</div>
    ${s.customer ? `<div>Customer: ${esc(s.customer)}</div>` : ''}<div>Cashier: ${esc(s.full_name || s.username || '')}</div><hr>
    <table>${s.lines.map(l => `<tr><td colspan="2">${esc(l.name)}</td></tr>
      <tr><td>&nbsp;&nbsp;${l.qty} x ${peso(l.price)}</td><td class="r">${peso(l.qty * l.price)}</td></tr>`).join('')}</table><hr>
    <table><tr class="${returns.length ? '' : 'big'}"><td>TOTAL</td><td class="r">${peso(s.total)}</td></tr>
      <tr><td>Payment</td><td class="r">${esc(s.payment)}</td></tr></table>
    ${returns.length ? `<hr><div class="c"><b>RETURNED</b></div><table>${returns.map(r => `
      <tr><td colspan="2" class="ret-head">${esc(fmtDateTime(r.at))} · ${esc(r.reason)}</td></tr>
      ${r.lines.map(l => `<tr><td>&nbsp;&nbsp;${l.qty} x ${esc(l.name)}</td><td class="r">-${peso(l.qty * l.price)}</td></tr>`).join('')}`).join('')}</table>
      <hr><table><tr class="big"><td>NET TOTAL</td><td class="r">${peso(s.total - refunded)}</td></tr></table>` : ''}
    <hr><div class="c">${esc(SHOP.tagline)}<br>${esc(SHOP.receiptFooter)}</div>
    <div class="c fine">This is not an official receipt.</div></div>`;
}
async function showReceipt(id, after) {
  const s = await api('GET', `/api/sales/${id}`);
  const returnable = !s.voided && s.lines.some(l => l.qty > l.returned);
  const canVoid = isAdmin() && !s.voided && !(s.returns || []).length;
  const m = openModal({
    title: `Receipt #${s.receipt_no}`,
    body: receiptHtml(s),
    foot: `${canVoid ? `<button class="btn danger" data-void>Void sale</button>` : ''}
      ${returnable ? `<button class="btn" data-return>${icon('undo')}Return items</button>` : ''}<span class="spacer"></span>
      <button class="btn" data-close>Close</button><button class="btn dark" data-print>${icon('print')}Print</button>`,
  });
  m.querySelector('[data-print]').onclick = () => printDoc(receiptHtml(s));
  m.querySelector('[data-return]')?.addEventListener('click', () => returnModal(s, after));
  m.querySelector('[data-void]')?.addEventListener('click', async () => {
    if (!await confirmBox('Void this sale?', `Receipt <b>#${esc(s.receipt_no)}</b> (${peso(s.total)}) will be cancelled and the items returned to stock.`, 'Void sale')) return;
    try { await api('POST', `/api/sales/${id}/void`); toast('Sale voided, stock returned'); await loadItems(); after?.(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

// Return some of a receipt's items: pick quantities, a reason, and refund the difference.
function returnModal(s, after) {
  const open = s.lines.filter(l => l.qty > l.returned);
  const m = openModal({
    title: `Return items · #${s.receipt_no}`, wide: true,
    body: `<form class="stack" id="ret-form"><div class="err hidden"></div>
      <div class="table-wrap" style="border:1px solid var(--line);border-radius:10px"><table class="tbl">
        <thead><tr><th>Item</th><th class="r">Bought</th><th class="r">Price</th><th class="r">Return</th></tr></thead>
        <tbody>${open.map(l => `<tr><td class="item-name">${esc(l.name)}${l.returned ? `<div class="item-sub">${l.returned} already returned</div>` : ''}</td>
          <td class="r num">${l.qty}</td><td class="r num">${peso(l.price)}</td>
          <td class="r"><input class="input num ret-qty" type="number" min="0" max="${l.qty - l.returned}" step="1" value="${open.length === 1 && l.qty - l.returned === 1 ? 1 : 0}"
            data-line="${l.id}" data-price="${l.price}"></td></tr>`).join('')}</tbody></table></div>
      <div class="grid-2">
        <div class="field"><label>Reason</label><select class="select" name="reason">${['Wrong fitment', 'Defective', 'Changed mind', 'Other']
          .map(r => `<option>${r}</option>`).join('')}</select></div>
        <div class="field"><label>Note (optional)</label><input class="input" name="note" placeholder="e.g. customer's bike is Click 160"></div>
      </div>
      <div class="muted" style="font-size:13px">Returned items go back into stock. The refund counts on today's sales.</div>
    </form>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Refund ₱0</button>`,
  });
  const form = m.querySelector('form'), ok = m.querySelector('[data-ok]');
  const picked = () => [...form.querySelectorAll('.ret-qty')].map(i => ({ line_id: Number(i.dataset.line),
    qty: Math.max(0, Math.min(Number(i.max), parseInt(i.value, 10) || 0)), price: Number(i.dataset.price) })).filter(l => l.qty > 0);
  const upd = () => { const t = picked().reduce((a, l) => a + l.qty * l.price, 0); ok.textContent = `Refund ${peso(t)}`; ok.disabled = !t; };
  form.oninput = upd; upd();
  form.querySelector('.ret-qty')?.focus();
  ok.onclick = async () => {
    try {
      const r = await api('POST', `/api/sales/${s.id}/returns`, { lines: picked(), reason: form.reason.value, note: form.note.value });
      toast(`Returned. Refund ${peso(r.total)}`);
      await loadItems(); after?.();
      showReceipt(s.id, after);
    } catch (e) { showErr(m, e.message); }
  };
}

// Low and out-of-stock items with suggested quantities, ready to paste into Messenger or print.
async function reorderModal() {
  await loadItems();
  const need = state.items.filter(it => it.stock <= it.reorder_level)
    .map(it => ({ ...it, order: Math.max(1, Math.max(2, it.reorder_level * 2) - it.stock) }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const m = openModal({
    title: 'Reorder list', wide: true,
    body: need.length ? `<p class="muted" style="margin:0 0 12px">Items at or below their low-stock alert. Adjust the quantities, untick what you don't need.</p>
      <div class="table-wrap sync-table" style="max-height:52vh"><table class="tbl"><thead><tr><th></th><th>Item</th><th>Fits</th>
        <th class="r">In stock</th><th class="r">Order</th><th class="r">Est. cost</th></tr></thead><tbody>
        ${need.map((it, i) => `<tr><td><input type="checkbox" data-i="${i}" checked></td>
          <td><div class="item-name">${esc(it.name)}</div><div class="item-sub">${esc(it.category)}</div></td><td>${esc(it.compat)}</td>
          <td class="r num">${it.stock}</td><td class="r"><input class="input num ret-qty" type="number" min="1" data-q="${i}" value="${it.order}"></td>
          <td class="r num" data-c="${i}"></td></tr>`).join('')}</tbody></table></div>
      <div class="cash-line" style="margin-top:12px"><span id="ro-count"></span><b class="num" id="ro-total"></b></div>`
      : '<div class="empty">Nothing needs reordering. Every item is above its low-stock alert.</div>',
    foot: need.length ? `<button class="btn" data-close>Close</button><button class="btn" data-print>${icon('print')}Print</button>
      <button class="btn primary" data-copy>Copy for Messenger</button>` : '<button class="btn" data-close>Close</button>',
  });
  if (!need.length) return;
  const chosen = () => need.map((it, i) => ({ it, qty: Math.max(1, parseInt(m.querySelector(`[data-q="${i}"]`).value, 10) || 1),
    on: m.querySelector(`[data-i="${i}"]`).checked })).filter(x => x.on);
  const upd = () => {
    need.forEach((it, i) => { m.querySelector(`[data-c="${i}"]`).textContent = peso(it.cost * (parseInt(m.querySelector(`[data-q="${i}"]`).value, 10) || 0)); });
    const c = chosen();
    $('#ro-count').textContent = `${c.length} item${c.length === 1 ? '' : 's'} · ${pcs(c.reduce((t, x) => t + x.qty, 0))}`;
    $('#ro-total').textContent = peso(c.reduce((t, x) => t + x.qty * x.it.cost, 0));
  };
  m.oninput = upd; m.onchange = upd; upd();
  const asText = () => `${SHOP.name} order, ${fmtDate(ymd())}\n` +
    chosen().map(({ it, qty }) => `• ${qty} x ${it.name}${isUniversal(it) ? '' : ` (${it.compat})`}`).join('\n');
  m.querySelector('[data-copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(asText()); toast('Copied. Paste it in Messenger.'); }
    catch { toast('Copy blocked by the browser. Use Print instead.', 'error'); }
  };
  m.querySelector('[data-print]').onclick = () => {
    printDoc(`<div class="receipt"><div class="c"><h4>${esc(SHOP.name.toUpperCase())}</h4><div class="doc-type">REORDER LIST</div>
      <div>${esc(fmtDate(ymd()))}</div></div><hr><table>${chosen().map(({ it, qty }) => `<tr><td>${qty} x ${esc(it.name)}${isUniversal(it) ? '' : `<br>&nbsp;&nbsp;${esc(it.compat)}`}</td></tr>`).join('')}</table></div>`);
  };
}

// ------------------------------------------------------------ sales history
PAGES.sales = async (main) => {
  let from = ymd(addDays(new Date(), -29)), to = ymd();
  main.innerHTML = pageHead('Sales', 'Every receipt recorded in the system.', `<a class="btn" href="#/closing">${icon('lock')}Close the day</a>
    <a class="btn primary" href="#/sell">${icon('cart')}New sale</a>`) + `
    <div class="card">
      <div class="toolbar"><div class="date-range"><input class="input" type="date" id="s-from" value="${from}"><span class="muted">to</span>
        <input class="input" type="date" id="s-to" value="${to}"></div></div>
      <div class="summary-bar" id="s-sum"></div>
      <div class="table-wrap"><table class="tbl responsive"><thead><tr><th>Receipt</th><th>Date</th><th>Customer</th><th>Payment</th>
        <th class="r">Items</th><th class="r">Total</th><th class="r">Profit</th><th>Cashier</th></tr></thead><tbody id="s-body"></tbody></table></div>
    </div>`;
  const load = async () => {
    const rows = await api('GET', `/api/sales?from=${from}&to=${to}`);
    const live = rows.filter(r => !r.voided);
    const returned = live.reduce((s, r) => s + r.returned, 0);
    $('#s-sum').innerHTML = `<span><b>${live.length}</b> sales</span><span>Total <b class="num">${peso(live.reduce((s, r) => s + r.total - r.returned, 0))}</b></span>
      <span>Profit <b class="num">${peso(live.reduce((s, r) => s + r.total - r.cost_total - (r.returned - r.returned_cost), 0))}</b></span>
      ${returned ? `<span>Returns <b class="num">${peso(returned)}</b></span>` : ''}${rows.length - live.length ? `<span>${rows.length - live.length} voided</span>` : ''}`;
    $('#s-body').innerHTML = rows.length ? rows.map(r => `<tr class="clickable ${r.voided ? 'voided' : ''}" data-id="${r.id}">
      <td class="first keep"><b>#${esc(r.receipt_no)}</b>${r.voided ? ' <span class="pill out" style="text-decoration:none">Voided</span>'
        : r.returned ? ` <span class="pill low">${r.returned >= r.total ? 'Returned' : 'Part returned'}</span>` : ''}</td>
      <td data-l="Date">${fmtDateTime(r.at)}</td><td data-l="Customer">${esc(r.customer || 'Walk-in')}</td><td data-l="Paid">${esc(r.payment)}</td>
      <td class="r num" data-l="Items">${r.units}</td><td class="r num" data-l="Total"><b>${peso(r.total - r.returned)}</b>${
        r.returned ? `<div class="item-sub">of ${peso(r.total)}</div>` : ''}</td>
      <td class="r num" data-l="Profit">${peso(r.total - r.cost_total - (r.returned - r.returned_cost))}</td><td class="hide-sm">${esc(r.username || '')}</td></tr>`).join('')
      : `<tr><td colspan="8" class="empty">No sales in this date range.</td></tr>`;
  };
  $('#s-from').onchange = (e) => { from = e.target.value; load(); };
  $('#s-to').onchange = (e) => { to = e.target.value; load(); };
  $('#s-body').onclick = (e) => { const r = e.target.closest('tr[data-id]'); if (r) showReceipt(Number(r.dataset.id), load); };
  await load();
};

// ------------------------------------------------------------ stock log
PAGES['stock-log'] = async (main) => {
  let type = '', from = ymd(addDays(new Date(), -29)), to = ymd();
  main.innerHTML = pageHead('Stock Log', 'Every stock movement: deliveries, sales, pull-outs and counts.') + `
    <div class="card">
      <div class="toolbar">
        <div class="chips" id="l-type">${[['', 'All'], ['SALE', 'Sales'], ['IN', 'Stock in'], ['OUT', 'Stock out'], ['ADJUST', 'Counts'], ['VOID', 'Voids'], ['NEW', 'New items']]
          .map(([k, l]) => `<button class="chip ${k === type ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
        <div class="date-range" style="margin-left:auto"><input class="input" type="date" id="l-from" value="${from}"><span class="muted">to</span><input class="input" type="date" id="l-to" value="${to}"></div>
      </div>
      <div class="table-wrap"><table class="tbl responsive"><thead><tr><th>Date</th><th>Item</th><th>Action</th><th class="r">Qty</th><th class="r">Stock after</th><th>Note</th><th>By</th></tr></thead>
        <tbody id="l-body"></tbody></table></div>
    </div>`;
  const load = async () => {
    const rows = await api('GET', `/api/movements?type=${type}&from=${from}&to=${to}`);
    $('#l-body').innerHTML = rows.length ? rows.map(m => `<tr class="clickable" data-item="${m.item_id}">
      <td data-l="Date" style="white-space:nowrap">${fmtDateTime(m.at)}</td>
      <td class="first"><div class="item-name">${esc(m.name)}</div><div class="item-sub">${esc(m.sku)}</div></td>
      <td>${moveTag(m)}</td>
      <td class="r num" data-l="Qty"><b>${m.qty > 0 ? '+' : ''}${m.qty}</b></td><td class="r num" data-l="After">${m.stock_after}</td>
      <td data-l="Note">${esc(m.note)}${m.receipt_no ? ` <span class="muted">#${esc(m.receipt_no)}</span>` : ''}</td><td class="hide-sm">${esc(m.username || '')}</td></tr>`).join('')
      : `<tr><td colspan="7" class="empty">No stock movements in this range.</td></tr>`;
  };
  $('#l-type').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; type = b.dataset.t;
    $('#l-type').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b)); load(); };
  $('#l-from').onchange = (e) => { from = e.target.value; load(); };
  $('#l-to').onchange = (e) => { to = e.target.value; load(); };
  $('#l-body').onclick = (e) => { const r = e.target.closest('tr[data-item]'); if (r) itemDetail(Number(r.dataset.item), load); };
  await load();
};

// ------------------------------------------------------------ daily closing
const BILLS = [1000, 500, 200, 100, 50, 20];
PAGES.closing = async (main) => {
  let day = (location.hash.split('?day=')[1] || '').slice(0, 10) || null;
  const [data, history] = await Promise.all([api('GET', `/api/closing${day ? `?day=${day}` : ''}`), api('GET', '/api/closings')]);
  day = data.day;
  const s = data.summary, c = data.closing;
  const past = day !== data.today;
  main.innerHTML = pageHead('Daily closing', `${fmtDate(day)}${past ? '' : ' (today)'}. Count the cash drawer and close the day.`,
    `<input class="input" type="date" id="cl-day" value="${day}" max="${data.today}" style="width:auto">
     ${c ? `<button class="btn dark" data-zprint>${icon('print')}Print Z-report</button>` : ''}`) + `
    <div class="stats">
      <div class="card stat hero"><div class="label">Net sales</div><div class="value num">${peso(s.net)}</div>
        <div class="sub">${s.receipts} receipt${s.receipts === 1 ? '' : 's'} · ${pcs(s.units)}</div></div>
      <div class="card stat"><div class="label">Refunds</div><div class="value num">${peso(s.refunds)}</div>
        <div class="sub">${s.return_count} return${s.return_count === 1 ? '' : 's'}</div></div>
      <div class="card stat"><div class="label">Voided</div><div class="value num">${peso(s.voids.total)}</div>
        <div class="sub">${s.voids.count} receipt${s.voids.count === 1 ? '' : 's'} cancelled</div></div>
      <div class="card stat"><div class="label">Gross profit</div><div class="value num" style="color:var(--green)">${peso(s.profit)}</div>
        <div class="sub">${s.net ? Math.round((s.profit / s.net) * 100) : 0}% margin</div></div>
    </div>
    <div class="dash-grid">
      <div class="stack" style="gap:18px">
        <div class="card"><div class="card-head"><h2>By payment method</h2></div>
          ${s.payments.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Payment</th><th class="r">Receipts</th><th class="r">Sales</th>
            <th class="r">Refunds</th><th class="r">Net</th></tr></thead><tbody>${s.payments.map(p => `<tr><td class="item-name">${esc(p.payment)}</td>
            <td class="r num">${p.receipts}</td><td class="r num">${peso(p.sales)}</td><td class="r num">${p.refunds ? '-' + peso(p.refunds) : '—'}</td>
            <td class="r num"><b>${peso(p.net)}</b></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No sales on this day.</div>'}</div>
        <div class="grid-2" style="gap:18px">
          <div class="card"><div class="card-head"><h2>Cashiers</h2></div>
            ${s.cashiers.length ? `<ul class="list">${s.cashiers.map(x => `<li><div><div class="t">${esc(x.name)}</div><div class="s">${x.receipts} receipts</div></div>
              <b class="num">${peso(x.total)}</b></li>`).join('')}</ul>` : '<div class="empty">No sales.</div>'}</div>
          <div class="card"><div class="card-head"><h2>Top items</h2></div>
            ${s.top.length ? `<ul class="list">${s.top.map(x => `<li><div style="min-width:0"><div class="t">${esc(x.name)}</div><div class="s">${pcs(x.qty)}${x.compat ? ` · ${esc(x.compat)}` : ''}</div></div>
              <b class="num">${peso(x.total)}</b></li>`).join('')}</ul>` : '<div class="empty">Nothing sold.</div>'}</div>
        </div>
      </div>
      <div class="stack" style="gap:18px">
        <div class="card"><div class="card-head"><h2>Cash count</h2>${c ? `<span class="pill ok">Closed</span>` : ''}</div>
          <form class="card-pad stack" id="cl-form"><div class="err hidden"></div>
            ${c ? `<div class="sync-status">Closed by <b>${esc(c.by_name || '')}</b> · ${fmtDateTime(c.at)}${isAdmin() ? '. You can update it.' : '.'}</div>` : ''}
            <div class="grid-2">
              <div class="field"><label>Opening cash (float)</label><input class="input num" name="opening_cash" type="number" min="0" step="0.01"
                value="${c ? c.opening_cash : (remember.get('closing.float') || 0)}"></div>
              <div class="field"><label>Cash sales, net</label><input class="input num" value="${peso(s.cashNet)}" disabled></div>
            </div>
            <div class="cash-line"><span>Expected in the drawer</span><b class="num" id="cl-expected"></b></div>
            <details class="bills" ${c ? '' : 'open'}><summary>Count by bills</summary>
              <div class="bill-grid">${BILLS.map(b => `<label><span>₱${b}</span><input class="input num" type="number" min="0" step="1" data-bill="${b}" placeholder="0"></label>`).join('')}
                <label><span>Coins</span><input class="input num" type="number" min="0" step="0.01" data-coins placeholder="₱0"></label></div>
            </details>
            <div class="field"><label>Counted cash</label><input class="input num big-input" name="counted_cash" type="number" min="0" step="0.01" required
              value="${c ? c.counted_cash : ''}" placeholder="Total cash in the drawer"></div>
            <div class="cash-line diff" id="cl-diff"></div>
            <div class="field"><label>Note (optional)</label><input class="input" name="note" value="${esc(c?.note || '')}" placeholder="e.g. ₱200 paid to the delivery rider"></div>
            <button class="btn primary block" ${c && !isAdmin() ? 'disabled' : ''}>${c ? 'Update closing' : 'Close the day'}</button>
          </form></div>
        <div class="card"><div class="card-head"><h2>Past closings</h2></div>
          ${history.length ? `<ul class="list">${history.map(h => `<li data-day="${h.day}" style="cursor:pointer"><div><div class="t">${fmtDate(h.day)}</div>
            <div class="s">${esc(h.by_name || '')} · counted ${peso(h.counted_cash)}</div></div>${diffPill(h.difference)}</li>`).join('')}</ul>`
            : '<div class="empty">No closings yet.</div>'}</div>
      </div>
    </div>`;

  const form = $('#cl-form');
  const expected = () => (Number(form.opening_cash.value) || 0) + s.cashNet;
  const refresh = () => {
    $('#cl-expected').textContent = peso(expected());
    const counted = form.counted_cash.value === '' ? null : Number(form.counted_cash.value);
    $('#cl-diff').innerHTML = counted === null ? '' : `<span>Difference</span>${diffPill(counted - expected(), true)}`;
  };
  form.oninput = (e) => {
    if (e.target.matches('[data-bill], [data-coins]')) {
      const sum = [...form.querySelectorAll('[data-bill]')].reduce((t, i) => t + (Number(i.value) || 0) * Number(i.dataset.bill), 0)
        + (Number(form.querySelector('[data-coins]').value) || 0);
      form.counted_cash.value = sum || '';
    }
    refresh();
  };
  refresh();
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    try {
      const d = formData(form);
      remember.set('closing.float', d.opening_cash || 0);
      await api('POST', '/api/closing', { day, ...d });
      toast(`${fmtDate(day)} closed`); route();
    } catch (err) { showErr(form, err.message); }
  };
  $('#cl-day').onchange = (e) => { location.hash = `#/closing?day=${e.target.value}`; };
  main.querySelectorAll('[data-day]').forEach(li => li.onclick = () => { location.hash = `#/closing?day=${li.dataset.day}`; });
  main.querySelector('[data-zprint]')?.addEventListener('click', () => printDoc(zReportHtml(c)));
};
function diffPill(d, big) {
  const v = Math.round(d * 100) / 100;
  const label = v === 0 ? 'Exact' : v > 0 ? `Over ${peso(v)}` : `Short ${peso(-v)}`;
  return `<span class="pill ${v === 0 ? 'ok' : v > 0 ? 'low' : 'out'}${big ? ' big-pill' : ''}">${label}</span>`;
}
function zReportHtml(c) {
  const s = c.summary;
  const row = (a, b) => `<tr><td>${a}</td><td class="r">${b}</td></tr>`;
  return `<div class="receipt">
    <div class="c"><h4>${esc(SHOP.name.toUpperCase())}</h4><div class="doc-type">END OF DAY (Z) REPORT</div><div>${esc(fmtDate(c.day))}</div></div><hr>
    <table>${row('Receipts', s.receipts)}${row('Gross sales', peso(s.gross))}${row('Refunds', '-' + peso(s.refunds))}
      ${row('Voided', `${s.voids.count} (${peso(s.voids.total)})`)}<tr class="big"><td>NET SALES</td><td class="r">${peso(s.net)}</td></tr></table><hr>
    <table>${s.payments.map(p => row(esc(p.payment), peso(p.net))).join('')}</table><hr>
    <table>${row('Opening cash', peso(c.opening_cash))}${row('Cash sales, net', peso(s.cashNet))}${row('Expected', peso(c.expected_cash))}
      ${row('Counted', peso(c.counted_cash))}<tr class="big"><td>DIFFERENCE</td><td class="r">${peso(c.counted_cash - c.expected_cash)}</td></tr></table>
    ${c.note ? `<hr><div>Note: ${esc(c.note)}</div>` : ''}
    <hr><div class="c">Closed by ${esc(c.by_name || '')} · ${esc(fmtDateTime(c.at))}</div></div>`;
}

// ------------------------------------------------------------ reports
PAGES.reports = async (main) => {
  const now = new Date();
  const presets = {
    today: [ymd(), ymd()],
    week: [ymd(addDays(now, -6)), ymd()],
    month: [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd()],
    last: [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))],
    year: [ymd(new Date(now.getFullYear(), 0, 1)), ymd()],
  };
  let [from, to] = presets.month;
  main.innerHTML = pageHead('Reports', 'Sales, profit and best sellers for any period.', `<button class="btn" data-print>${icon('print')}Print</button>`) + `
    <div class="card card-pad" style="margin-bottom:18px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">
      <div class="chips" id="r-pre">${[['today', 'Today'], ['week', 'Last 7 days'], ['month', 'This month'], ['last', 'Last month'], ['year', 'This year']]
        .map(([k, l]) => `<button class="chip ${k === 'month' ? 'on' : ''}" data-p="${k}">${l}</button>`).join('')}</div>
      <div class="date-range" style="margin-left:auto"><input class="input" type="date" id="r-from"><span class="muted">to</span><input class="input" type="date" id="r-to"></div>
    </div>
    <div id="r-out"></div>`;
  const load = async () => {
    $('#r-from').value = from; $('#r-to').value = to;
    const r = await api('GET', `/api/reports?from=${from}&to=${to}`);
    const s = r.summary, maxD = Math.max(1, ...r.daily.map(d => d.total)), maxC = Math.max(1, ...r.byCategory.map(c => c.total));
    $('#r-out').innerHTML = `
      <div class="stats">
        <div class="card stat hero"><div class="label">Sales</div><div class="value num">${peso(s.total)}</div><div class="sub">${s.count} receipts${s.returns ? ` · ${peso(s.returns)} refunded (${s.return_count})` : ''}</div></div>
        <div class="card stat"><div class="label">Gross profit</div><div class="value num" style="color:var(--green)">${peso(s.profit)}</div>
          <div class="sub">${s.total ? Math.round((s.profit / s.total) * 100) : 0}% margin</div></div>
        <div class="card stat"><div class="label">Cost of goods sold</div><div class="value num">${peso(s.cost)}</div><div class="sub">Capital used</div></div>
        <div class="card stat"><div class="label">Average sale</div><div class="value num">${peso(s.count ? s.total / s.count : 0)}</div><div class="sub">per receipt</div></div>
      </div>
      <div class="dash-grid">
        <div class="stack" style="gap:18px">
          <div class="card"><div class="card-head"><h2>Daily sales</h2></div>
            ${r.daily.length ? `<div class="bars">${r.daily.map(d => `<div class="bar-row"><div class="name">${fmtDate(d.day)} <span class="muted">(${d.count})</span></div>
              <div class="bar-track"><div class="bar-fill" style="width:${(d.total / maxD) * 100}%"></div></div><div class="amt num">${peso(d.total)}</div></div>`).join('')}</div>`
              : '<div class="empty">No sales in this period.</div>'}</div>
          <div class="card"><div class="card-head"><h2>Best sellers</h2></div>
            ${r.top.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="r">Sold</th><th class="r">Sales</th><th class="r">Profit</th></tr></thead><tbody>
              ${r.top.map(t => `<tr><td><div class="item-name">${esc(t.name)}</div>${t.compat ? `<div class="item-sub">${esc(t.compat)}</div>` : ''}</td><td class="r num">${t.qty}</td><td class="r num">${peso(t.total)}</td><td class="r num">${peso(t.profit)}</td></tr>`).join('')}
            </tbody></table></div>` : '<div class="empty">Nothing sold yet.</div>'}</div>
        </div>
        <div class="stack" style="gap:18px">
          <div class="card"><div class="card-head"><h2>By category</h2></div>
            ${r.byCategory.length ? `<div class="bars">${r.byCategory.map(c => `<div class="bar-row"><div class="name">${esc(c.category)}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${(c.total / maxC) * 100}%"></div></div><div class="amt num">${peso(c.total)}</div></div>`).join('')}</div>`
              : '<div class="empty">No data.</div>'}</div>
          <div class="card"><div class="card-head"><h2>Payment methods</h2></div>
            ${r.payments.length ? `<ul class="list">${r.payments.map(p => `<li><div><div class="t">${esc(p.payment)}</div><div class="s">${p.count} sales</div></div><b class="num">${peso(p.total)}</b></li>`).join('')}</ul>`
              : '<div class="empty">No data.</div>'}</div>
        </div>
      </div>`;
  };
  $('#r-pre').onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b) return; [from, to] = presets[b.dataset.p];
    $('#r-pre').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b)); load(); };
  const custom = () => { from = $('#r-from').value; to = $('#r-to').value; $('#r-pre').querySelectorAll('.chip').forEach(c => c.classList.remove('on')); if (from && to) load(); };
  $('#r-from').onchange = custom; $('#r-to').onchange = custom;
  main.querySelector('[data-print]').onclick = () => {
    $('#print-root').innerHTML = `<h2 style="font-family:var(--display)">${esc(SHOP.name.toUpperCase())} — SALES REPORT ${fmtDate(from)} to ${fmtDate(to)}</h2>` + $('#r-out').innerHTML;
    window.print();
  };
  await load();
};

// ------------------------------------------------------------ Google Sheet sync
function sheetStatusHtml(st) {
  if (st.error) return `<div class="sync-status error">${esc(st.error)}</div>`;
  if (!st.syncedAt) return `<div class="sync-status">Not synced yet.</div>`;
  const x = st.summary || {};
  return `<div class="sync-status">Last synced <b>${ago(st.syncedAt)}</b> · ${count(x.sheetItems)} items in the sheet ·
    ${x.added} new, ${x.updated} updated, ${x.removed} hidden${st.auto ? ` · auto-sync every ${st.auto === 60 ? 'hour' : st.auto + ' minutes'}` : ''}</div>`;
}
function sheetCard(st) {
  return `<div class="card"><div class="card-head"><h2>Google Sheet sync</h2></div>
    <div class="card-pad stack">
      <p class="muted" style="margin:0">Brings new items, stock counts and prices from the shop's Google Sheet into the website.
        It only reads the sheet. Nothing is ever written to it.</p>
      <div class="field"><label for="sh-link">Sheet link</label>
        <input class="input" id="sh-link" value="${esc(st.link)}" placeholder="https://docs.google.com/spreadsheets/d/…">
        <span class="hint">The sheet must be shared as "Anyone with the link can view".</span></div>
      <div class="field"><label for="sh-auto">Auto-sync</label>
        <select class="select" id="sh-auto">${[[0, "Off, I'll check by hand"], [15, 'Every 15 minutes'], [60, 'Every hour']]
          .map(([v, l]) => `<option value="${v}" ${st.auto === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="hint">Auto-sync pauses itself if a change would hide many items at once.</span></div>
      <div id="sh-status">${sheetStatusHtml(st)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-shsave>Save</button>
        <button class="btn primary" data-shcheck>Check for changes</button></div>
    </div></div>`;
}
function bindSheetCard(main, reload) {
  const save = () => api('PUT', '/api/sheet', { link: $('#sh-link').value.trim(), auto: Number($('#sh-auto').value) });
  main.querySelector('[data-shsave]').onclick = async () => {
    try { await save(); toast('Saved'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  main.querySelector('[data-shcheck]').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Reading the sheet…';
    try { await save(); showSyncPreview(await api('POST', '/api/sheet/preview'), reload); }
    catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Check for changes'; }
  };
}
function syncChangeText(d) {
  const parts = [];
  if (d.restored) parts.push('Back in the sheet');
  if (d.stock) parts.push(`Stock ${d.stock[0]} → <b>${d.stock[1]}</b>`);
  if (d.cost) parts.push(`Cost ${peso(d.cost[0])} → <b>${peso(d.cost[1])}</b>`);
  if (d.srp) parts.push(`SRP ${peso(d.srp[0])} → <b>${peso(d.srp[1])}</b>`);
  if (d.category) parts.push(`Moved to <b>${esc(d.category[1])}</b>`);
  return parts.join(' · ');
}
function showSyncPreview(p, after) {
  const none = !p.added.length && !p.updates.length && !p.removed.length;
  const table = (head, rows) => `<div class="table-wrap sync-table"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const m = openModal({
    title: 'Changes from the Google Sheet', wide: true,
    body: none ? `<div class="empty">Everything already matches the sheet (${count(p.sheetItems)} items).</div>` : `
      <div class="kv">
        <div><span>New items</span><b class="num">${p.added.length}</b></div>
        <div><span>Updated</span><b class="num">${p.updates.length}</b></div>
        <div><span>Hidden</span><b class="num">${p.removed.length}</b></div>
        <div><span>Money in stock</span><b class="num">${peso(p.capitalAfter)}</b><small>now ${peso(p.capitalNow)}</small></div>
      </div>
      ${p.added.length ? `<details class="sync-sec" open><summary>New items (${p.added.length})</summary>
        ${table('<th>Item</th><th>Fits</th><th class="r">Stock</th><th class="r">SRP</th>', p.added.map(a =>
          `<tr><td class="item-name">${esc(a.name)}</td><td>${esc(a.compat)}</td><td class="r num">${a.stock}</td>
          <td class="r num">${a.srp > 0 ? peso(a.srp) : '<span class="pill low">No SRP</span>'}</td></tr>`).join(''))}</details>` : ''}
      ${p.updates.length ? `<details class="sync-sec" open><summary>Updated (${p.updates.length})</summary>
        ${table('<th>Item</th><th>Fits</th><th>Change</th>', p.updates.map(u =>
          `<tr><td class="item-name">${esc(u.name)}</td><td>${esc(u.compat)}</td><td>${syncChangeText(u.diff)}</td></tr>`).join(''))}</details>` : ''}
      ${p.removed.length ? `<details class="sync-sec"><summary>Hidden: no longer in the sheet (${p.removed.length})</summary>
        <p class="muted" style="margin:4px 0 8px;font-size:12.5px">Usually renamed items. They're hidden, not deleted, so past sales keep their history.</p>
        ${table('<th>Item</th><th>Fits</th><th class="r">Stock here</th>', p.removed.map(r =>
          `<tr><td class="item-name">${esc(r.name)}</td><td>${esc(r.compat)}</td><td class="r num">${r.stock}</td></tr>`).join(''))}</details>` : ''}
      <p class="muted" style="margin:14px 0 0;font-size:12.5px">Stock counts follow the sheet only where the sheet changed, so sales rung up
        here since the last sync stay counted.</p>`,
    foot: none ? `<button class="btn" data-close>Close</button>`
      : `<button class="btn" data-close>Cancel</button><button class="btn primary" data-apply>Apply changes</button>`,
  });
  m.querySelector('[data-apply]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api('POST', '/api/sheet/apply');
      closeModal(); toast(`Synced: ${r.added} new, ${r.updated} updated, ${r.removed} hidden`);
      await loadItems(); after?.();
    } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; }
  });
}

// ------------------------------------------------------------ settings
PAGES.settings = async (main) => {
  const admin = isAdmin();
  const [users, cats, sheet] = await Promise.all([admin ? api('GET', '/api/users') : [], api('GET', '/api/categories'),
    admin ? api('GET', '/api/sheet') : null]);
  main.innerHTML = pageHead('Settings', admin ? 'Google Sheet sync, accounts, categories and backups.' : 'Your account.') + `
    <div class="settings-grid">
      <div class="stack" style="gap:18px">
        ${admin ? sheetCard(sheet) : ''}
        <div class="card"><div class="card-head"><h2>Receipt printer</h2></div>
          <div class="card-pad stack"><p class="muted" style="margin:0">Paper size for receipts, reorder lists and Z-reports printed from this device.</p>
            <select class="select" id="paper">${PAPERS.map(([v, l]) => `<option value="${v}" ${(remember.get('print.paper') || '80') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <div><button class="btn" type="button" data-testprint>${icon('print')}Print a test receipt</button></div></div></div>
        <div class="card"><div class="card-head"><h2>Change my password</h2></div>
          <form class="stack card-pad" id="pw-form"><div class="err hidden"></div>
            <div class="field"><label>Current password</label><input class="input" type="password" name="current" autocomplete="current-password" required></div>
            <div class="grid-2"><div class="field"><label>New password</label><input class="input" type="password" name="next" minlength="8" autocomplete="new-password" required></div>
            <div class="field"><label>Repeat new password</label><input class="input" type="password" name="again" minlength="8" autocomplete="new-password" required></div></div>
            <div><button class="btn dark">Update password</button></div></form></div>
        ${admin ? `<div class="card"><div class="card-head"><h2>Staff accounts</h2><button class="btn sm primary" data-adduser>${icon('plus')}Add account</button></div>
          <ul class="list">${users.map(u => `<li><div><div class="t">${esc(u.full_name || u.username)}</div><div class="s">@${esc(u.username)} · ${u.role === 'admin' ? 'Admin' : 'Staff'}</div></div>
            <div style="display:flex;gap:4px"><button class="btn sm" data-reset="${u.id}" data-name="${esc(u.username)}">Reset password</button>
            ${u.id !== state.user.id ? `<button class="icon-btn" data-deluser="${u.id}" data-name="${esc(u.username)}" title="Remove">${icon('trash')}</button>` : ''}</div></li>`).join('')}</ul>
          <div class="muted" style="padding:0 18px 16px;font-size:12.5px">Staff can sell, receive stock and edit items. Only admins can delete items, void sales and manage accounts.</div></div>
        <div class="card"><div class="card-head"><h2>Backup &amp; export</h2></div><div class="card-pad stack">
          <p class="muted" style="margin:0">Download a copy regularly and keep it on a flash drive or Google Drive.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="/api/export/items.csv">${icon('down')}Inventory (CSV for Excel)</a>
          <a class="btn" href="/api/backup">${icon('down')}Full backup (JSON)</a></div></div></div>` : ''}
      </div>
      ${admin ? `<div class="stack" style="gap:18px">
        <div class="card"><div class="card-head"><h2>Categories</h2><button class="btn sm primary" data-addcat>${icon('plus')}Add category</button></div>
        <ul class="list">${cats.map(c => `<li><div><div class="t">${esc(c.name)}</div><div class="s">Code ${esc(c.code)} · ${c.items} items</div></div>
          <div style="display:flex;gap:2px"><button class="icon-btn" data-rencat="${c.id}" data-name="${esc(c.name)}" title="Rename">${icon('edit')}</button>
          ${c.items ? '' : `<button class="icon-btn" data-delcat="${c.id}" data-name="${esc(c.name)}" title="Delete">${icon('trash')}</button>`}</div></li>`).join('')}</ul></div></div>` : ''}
    </div>`;

  $('#paper').onchange = (e) => { remember.set('print.paper', e.target.value); toast('Printer paper saved on this device'); };
  main.querySelector('[data-testprint]').onclick = () => printDoc(receiptHtml({ receipt_no: 'TEST', at: new Date().toISOString(), customer: '',
    username: state.user.username, full_name: state.user.full_name, payment: 'Cash', total: 350, voided: 0, returns: [],
    lines: [{ name: 'Test item (not a sale)', qty: 1, price: 350 }] }));
  const pw = $('#pw-form');
  pw.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(pw);
    if (d.next !== d.again) return showErr(pw, 'New passwords do not match');
    try { await api('POST', '/api/me/password', d); pw.reset(); pw.querySelector('.err').classList.add('hidden'); toast('Password updated'); }
    catch (err) { showErr(pw, err.message); }
  };
  if (!admin) return;
  const reload = () => route();
  bindSheetCard(main, reload);
  main.querySelector('[data-adduser]').onclick = () => {
    const m = openModal({ title: 'Add account',
      body: `<form class="stack"><div class="err hidden"></div>
        <div class="field"><label>Full name</label><input class="input" name="full_name" required></div>
        <div class="grid-2"><div class="field"><label>Username</label><input class="input" name="username" autocapitalize="off" required></div>
        <div class="field"><label>Role</label><select class="select" name="role"><option value="staff">Staff</option><option value="admin">Admin</option></select></div></div>
        <div class="field"><label>Password</label><input class="input" name="password" type="password" minlength="8" autocomplete="new-password" required></div></form>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Create account</button>` });
    const f = m.querySelector('form');
    m.querySelector('[data-ok]').onclick = async () => { if (!f.reportValidity()) return;
      try { await api('POST', '/api/users', formData(f)); closeModal(); toast('Account created'); reload(); } catch (e) { showErr(m, e.message); } };
  };
  main.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => {
    const m = openModal({ title: `Reset password — @${b.dataset.name}`,
      body: `<form class="stack"><div class="err hidden"></div><div class="field"><label>New password</label><input class="input" name="password" type="password" minlength="8" autocomplete="new-password" required></div></form>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Set password</button>` });
    const f = m.querySelector('form');
    m.querySelector('[data-ok]').onclick = async () => { if (!f.reportValidity()) return;
      try { await api('POST', `/api/users/${b.dataset.reset}/password`, formData(f)); closeModal(); toast('Password changed'); } catch (e) { showErr(m, e.message); } };
  });
  main.querySelectorAll('[data-deluser]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('Remove account?', `@${esc(b.dataset.name)} will no longer be able to log in. Their past sales stay recorded.`, 'Remove')) return;
    try { await api('DELETE', `/api/users/${b.dataset.deluser}`); toast('Account removed'); reload(); } catch (e) { toast(e.message, 'error'); }
  });
  const catPrompt = (title, value, onOk) => {
    const m = openModal({ title, body: `<form class="stack"><div class="err hidden"></div><div class="field"><label>Category name</label><input class="input" name="name" value="${esc(value)}" required></div></form>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Save</button>` });
    const f = m.querySelector('form');
    const go = async () => { if (!f.reportValidity()) return; try { await onOk(f.name.value); closeModal(); await loadItems(); reload(); } catch (e) { showErr(m, e.message); } };
    m.querySelector('[data-ok]').onclick = go; f.onsubmit = (e) => { e.preventDefault(); go(); };
  };
  main.querySelector('[data-addcat]').onclick = () => catPrompt('Add category', '', n => api('POST', '/api/categories', { name: n }));
  main.querySelectorAll('[data-rencat]').forEach(b => b.onclick = () => catPrompt('Rename category', b.dataset.name, n => api('PUT', `/api/categories/${b.dataset.rencat}`, { name: n })));
  main.querySelectorAll('[data-delcat]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('Delete category?', `Delete <b>${esc(b.dataset.name)}</b>?`, 'Delete')) return;
    try { await api('DELETE', `/api/categories/${b.dataset.delcat}`); await loadItems(); reload(); } catch (e) { toast(e.message, 'error'); }
  });
};

// ------------------------------------------------------------ boot
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* the app works without it */ });
}
(async () => {
  try { SHOP = { ...SHOP, ...await (await fetch('/api/shop')).json() }; } catch { /* keep defaults */ }
  applyBranding();
  try { state.user = await api('GET', '/api/me'); }
  catch { state.user = null; }
  if (state.user) start(); else renderLogin();
})();
