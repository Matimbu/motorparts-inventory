// Motorparts Inventory System
// Zero-dependency Node.js server (requires Node 22.13+ for node:sqlite)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const demo = require('./demo.js');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SEED_FILE = path.join(__dirname, 'data', 'seed.json');   // the shop's own starting inventory (private)
const SHOP_FILE = path.join(__dirname, 'data', 'shop.json');   // the shop's name, address, receipt text (private)
const DEMO_SHOP_FILE = path.join(__dirname, 'data', 'demo', 'shop.json');
// DEMO=1 forces generated demo data, DEMO=0 turns it off; unset = demo only when there's no seed.json.
const USE_DEMO = process.env.DEMO === '1' || process.argv.includes('--demo') || (process.env.DEMO !== '0' && !fs.existsSync(SEED_FILE));
// demo data lives in its own file so it can never mix with a real shop's records
const DB_PATH = path.join(DATA_DIR, USE_DEMO ? 'demo.db' : 'inventory.db');
const SHOP = { demo: USE_DEMO, ...JSON.parse(fs.readFileSync(!USE_DEMO && fs.existsSync(SHOP_FILE) ? SHOP_FILE : DEMO_SHOP_FILE, 'utf8')) };
const FILE_PREFIX = SHOP.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 7;
// Dates are stored in UTC and shown in Philippine time (UTC+8, no daylight saving),
// so reports stay correct even when the server itself runs in UTC.
const LT = `'+8 hours'`;
// Behind Railway's proxy we can trust its client-IP and HTTPS headers.
const BEHIND_PROXY = !!(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT) ||
  process.env.TRUST_PROXY === '1';

if (BEHIND_PROXY && !process.env.DATA_DIR && !USE_DEMO) {
  console.warn('WARNING: DATA_DIR is not set. The database is on temporary storage and will be LOST on the next deploy.');
  console.warn('         Attach a volume and set DATA_DIR to its mount path (e.g. /data).');
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// ---------------------------------------------------------------- schema
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin','staff')),
  pass_hash TEXT NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL COLLATE NOCASE,
  code TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  compat TEXT NOT NULL DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  cost REAL NOT NULL DEFAULT 0,
  srp REAL NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT UNIQUE NOT NULL,
  customer TEXT NOT NULL DEFAULT '',
  payment TEXT NOT NULL DEFAULT 'Cash',
  total REAL NOT NULL,
  cost_total REAL NOT NULL,
  user_id INTEGER REFERENCES users(id),
  voided INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sale_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  price REAL NOT NULL,
  cost REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('IN','OUT','SALE','ADJUST','VOID','NEW')),
  qty INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  sale_id INTEGER REFERENCES sales(id),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mov_item ON movements(item_id);
CREATE INDEX IF NOT EXISTS idx_mov_date ON movements(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_lines_item ON sale_lines(item_id);
CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  total REAL NOT NULL,
  cost_total REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS return_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  sale_line_id INTEGER NOT NULL REFERENCES sale_lines(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  price REAL NOT NULL,
  cost REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_return_lines_line ON return_lines(sale_line_id);
CREATE TABLE IF NOT EXISTS closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT UNIQUE NOT NULL,
  opening_cash REAL NOT NULL DEFAULT 0,
  expected_cash REAL NOT NULL,
  counted_cash REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Money in and out: kept sales, and refunds as negative amounts on the day they were given.
DROP VIEW IF EXISTS ledger;
CREATE VIEW ledger AS
  SELECT 'sale' AS kind, s.id AS sale_id, s.created_at, s.total, s.cost_total, s.payment FROM sales s WHERE s.voided = 0
  UNION ALL
  SELECT 'return', r.sale_id, r.created_at, -r.total, -r.cost_total, s.payment FROM returns r JOIN sales s ON s.id = r.sale_id;
DROP VIEW IF EXISTS ledger_lines;
CREATE VIEW ledger_lines AS
  SELECT l.item_id, l.name, l.qty, l.price, l.cost, s.created_at FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE s.voided = 0
  UNION ALL
  SELECT rl.item_id, rl.name, -rl.qty, rl.price, rl.cost, r.created_at FROM return_lines rl JOIN returns r ON r.id = rl.return_id;
`);

// columns added after the first release
function addColumn(table, column, definition) {
  if (!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('users', 'must_change', 'INTEGER NOT NULL DEFAULT 0');
addColumn('items', 'archived', 'INTEGER NOT NULL DEFAULT 0'); // hidden: no longer in the Google Sheet
// last values seen in the Google Sheet, so a sync only applies what changed there
addColumn('items', 'sheet_stock', 'INTEGER');
addColumn('items', 'sheet_cost', 'REAL');
addColumn('items', 'sheet_srp', 'REAL');

// ---------------------------------------------------------------- helpers
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => { throw new HttpError(400, msg); };
const int = (v, name) => { const n = Number(v); if (!Number.isInteger(n)) bad(`${name} must be a whole number`); return n; };
const num = (v, name) => { const n = Number(v); if (!Number.isFinite(n) || n < 0) bad(`${name} must be a valid amount`); return n; };
const str = (v, max = 200) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

function categoryCode(name) {
  const words = name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 3).map(w => w[0]).join('') : words[0].slice(0, 3)).toUpperCase();
}
function nextSku(categoryId) {
  const cat = db.prepare('SELECT code FROM categories WHERE id = ?').get(categoryId);
  if (!cat) bad('Unknown category');
  const rows = db.prepare('SELECT sku FROM items WHERE sku LIKE ?').all(`${cat.code}-%`);
  const max = rows.reduce((m, r) => Math.max(m, parseInt(r.sku.split('-').pop(), 10) || 0), 0);
  return `${cat.code}-${String(max + 1).padStart(4, '0')}`;
}
function ensureCategory(name) {
  name = str(name, 80);
  if (!name) bad('Category is required');
  const found = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
  if (found) return found.id;
  let code = categoryCode(name), n = 2;
  while (db.prepare('SELECT 1 FROM categories WHERE code = ?').get(code)) code = categoryCode(name) + n++;
  return Number(db.prepare('INSERT INTO categories (name, code) VALUES (?, ?)').run(name, code).lastInsertRowid);
}
const titleCase = s => s.toLowerCase().replace(/(^|[\s(/&,-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
function logMove(itemId, type, qty, stockAfter, note, userId, saleId = null) {
  db.prepare(`INSERT INTO movements (item_id, type, qty, stock_after, note, user_id, sale_id)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(itemId, type, qty, stockAfter, note || '', userId ?? null, saleId);
}

// ---------------------------------------------------------------- seed
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  db.prepare("INSERT INTO users (username, full_name, role, pass_hash, must_change) VALUES ('admin', 'Store Owner', 'admin', ?, 1)")
    .run(hashPassword('admin123'));
  if (!USE_DEMO) console.log('Created default login  ->  username: admin   password: admin123  (you will be asked to change it)');
}
if (!db.prepare('SELECT 1 FROM categories LIMIT 1').get()) {
  const cats = ['Braking System', 'Lubricants & Fluids', 'Transmission & Drivetrain', 'Suspension', 'Wheels & Tires',
    'Cooling System', 'Exhaust System', 'Engine Parts', 'Electrical System', 'Fuel System', 'Controls & Accessories',
    'Bearings, Seals & Rubber Parts', 'Nuts, Bolts & Hardware', 'Body & Frame'];
  const seed = USE_DEMO ? demo.demoCatalog() : fs.existsSync(SEED_FILE) ? JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')) : [];
  tx(() => {
    const ids = {};
    for (const c of cats) ids[c.toUpperCase()] = ensureCategory(c);
    for (const it of seed) {
      const catId = ids[it.category.toUpperCase()] ?? ensureCategory(titleCase(it.category));
      const sku = nextSku(catId);
      const stock = Math.round(Number(it.stock) || 0);
      // single-piece items alert when sold out; bulk items (bolts, bearings…) alert at 25% of current stock
      const reorder = stock >= 10 ? Math.round(stock * 0.25) : 0;
      const r = db.prepare(`INSERT INTO items (sku, name, category_id, compat, stock, cost, srp, reorder_level)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(sku, str(it.name), catId, str(it.compat), stock, Number(it.cost) || 0, Number(it.srp) || 0, reorder);
      logMove(Number(r.lastInsertRowid), 'NEW', stock, stock, 'Imported from the starting inventory', 1);
    }
  });
  console.log(`Imported ${seed.length} items${USE_DEMO ? ' (generated demo data)' : ' from the spreadsheet'}.`);
  if (USE_DEMO) seedDemo();
}

// Demo mode: two months of made-up sales, a staff login, and a demo "Google Sheet"
// that differs from the inventory in a few places, so every screen has something to show.
function seedDemo() {
  demo.seedDemoHistory(db, { hashPassword });
  const items = db.prepare(`SELECT upper(c.name) AS category, i.name, i.compat, i.stock, i.cost, i.srp
    FROM items i JOIN categories c ON c.id = i.category_id ORDER BY c.name, i.name`).all();
  db.prepare('UPDATE items SET sheet_stock = stock, sheet_cost = cost, sheet_srp = srp').run();
  const set = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  set.run('demo_sheet_csv', demo.demoSheetCsv(items));
  set.run('sheet_link', 'https://docs.google.com/spreadsheets/d/DEMO_SHEET_0000000000000000000000/edit');
  set.run('sheet_synced_at', new Date(Date.now() - 86400000).toISOString());
  set.run('sheet_summary', JSON.stringify({ added: 0, updated: 2, removed: 0, sheetItems: items.length,
    capitalAfter: items.reduce((t, i) => t + i.stock * i.cost, 0) }));
  // two weeks of past closings: mostly exact, a couple short or over
  const rng = demo.createRng(11);
  const addClosing = db.prepare(`INSERT OR IGNORE INTO closings (day, opening_cash, expected_cash, counted_cash, note, summary, user_id, created_at)
    VALUES (?, 1000, ?, ?, ?, ?, 1, ?)`);
  for (let d = 14; d >= 1; d--) {
    const day = new Date(Date.now() + 8 * 3600000 - d * 86400000).toISOString().slice(0, 10);
    const sum = daySummary(day), expected = 1000 + sum.cashNet, r = rng.next();
    const diff = r < 0.8 ? 0 : r < 0.9 ? -rng.int(2, 20) * 10 : rng.int(1, 5) * 10;
    addClosing.run(day, expected, expected + diff, diff < 0 ? 'Short, will check the receipts tomorrow' : '', JSON.stringify(sum),
      `${day} 11:30:00`);
  }
  console.log('Demo mode: log in as admin / admin123 (or staff jenny / staff1234). Not for real data.');
}

// ---------------------------------------------------------------- auth
function getUser(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  return db.prepare(`SELECT u.id, u.username, u.full_name, u.role, u.must_change FROM sessions s JOIN users u ON u.id = s.user_id
                     WHERE s.token = ? AND s.expires_at > datetime('now')`).get(m[1]) || null;
}
const requireAdmin = (user) => { if (user.role !== 'admin') throw new HttpError(403, 'Only the admin can do this'); };
const isHttps = (req) => BEHIND_PROXY && req.headers['x-forwarded-proto'] === 'https';
const cookie = (req, value, maxAge) =>
  `sid=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
function clientIp(req) {
  if (!BEHIND_PROXY) return req.socket.remoteAddress;
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
}
// Slow down password guessing: 10 wrong attempts from one IP locks login for 15 minutes.
const failedLogins = new Map();
const LOGIN_LIMIT = 10, LOGIN_WINDOW_MS = 15 * 60 * 1000;
function checkLoginLimit(ip) {
  const f = failedLogins.get(ip);
  if (f && f.until > Date.now() && f.count >= LOGIN_LIMIT)
    throw new HttpError(429, `Too many wrong attempts. Try again in ${Math.ceil((f.until - Date.now()) / 60000)} minutes.`);
}
function recordFailedLogin(ip) {
  const f = failedLogins.get(ip);
  if (!f || f.until <= Date.now()) failedLogins.set(ip, { count: 1, until: Date.now() + LOGIN_WINDOW_MS });
  else f.count++;
  if (failedLogins.size > 10000) for (const [k, v] of failedLogins) if (v.until <= Date.now()) failedLogins.delete(k);
}
// Routes still reachable while a user must replace a temporary password.
const PASSWORD_CHANGE_ROUTES = new Set(['/api/me', '/api/me/password', '/api/logout']);
const DEMO_LOCKED = new Set(['POST /api/me/password', 'POST /api/users', 'POST /api/users/:id/password', 'DELETE /api/users/:id']);

// ---------------------------------------------------------------- queries
const ITEM_SELECT = `SELECT i.id, i.sku, i.name, i.category_id, c.name AS category, i.compat, i.stock, i.cost, i.srp,
  i.reorder_level, i.archived, i.updated_at FROM items i JOIN categories c ON c.id = i.category_id`;

function dashboard() {
  const totals = db.prepare(`SELECT COUNT(*) AS items, COALESCE(SUM(stock),0) AS units,
      COALESCE(SUM(stock*cost),0) AS capital, COALESCE(SUM(stock*srp),0) AS retail,
      SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END) AS out_of_stock,
      SUM(CASE WHEN stock > 0 AND stock <= reorder_level THEN 1 ELSE 0 END) AS low_stock,
      SUM(CASE WHEN srp <= 0 THEN 1 ELSE 0 END) AS no_srp
    FROM items WHERE archived = 0`).get();
  const byCategory = db.prepare(`SELECT c.name AS category, COUNT(i.id) AS items, COALESCE(SUM(i.stock),0) AS units,
      COALESCE(SUM(i.stock*i.cost),0) AS capital FROM categories c LEFT JOIN items i ON i.category_id = c.id AND i.archived = 0
    GROUP BY c.id ORDER BY capital DESC`).all();
  const money = `COALESCE(SUM(kind = 'sale'), 0) AS count, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(total - cost_total), 0) AS profit,
    COALESCE(-SUM(CASE WHEN kind = 'return' THEN total END), 0) AS returns`;
  const today = db.prepare(`SELECT ${money} FROM ledger WHERE date(created_at,${LT}) = date('now',${LT})`).get();
  const month = db.prepare(`SELECT ${money} FROM ledger WHERE strftime('%Y-%m',created_at,${LT}) = strftime('%Y-%m','now',${LT})`).get();
  const lowItems = db.prepare(`${ITEM_SELECT} WHERE i.archived = 0 AND i.stock <= i.reorder_level ORDER BY i.stock ASC, i.name LIMIT 12`).all();
  const recent = db.prepare(`SELECT m.type, m.qty, m.note, datetime(m.created_at,${LT}) AS at, i.name, u.username
    FROM movements m JOIN items i ON i.id = m.item_id LEFT JOIN users u ON u.id = m.user_id
    WHERE m.type <> 'NEW' ORDER BY m.id DESC LIMIT 8`).all();
  const last7 = db.prepare(`SELECT date(created_at,${LT}) AS day, SUM(total) AS total FROM ledger
    WHERE date(created_at,${LT}) >= date('now',${LT},'-6 days') GROUP BY day`).all();
  return { totals, byCategory, today, month, lowItems, recent, last7 };
}

function report(from, to) {
  // everything is net of returns, counted on the day the refund was given
  const range = `date(created_at,${LT}) BETWEEN ? AND ?`;
  const summary = db.prepare(`SELECT COALESCE(SUM(kind = 'sale'), 0) AS count, COALESCE(SUM(total),0) AS total,
      COALESCE(SUM(cost_total),0) AS cost, COALESCE(SUM(total-cost_total),0) AS profit,
      COALESCE(-SUM(CASE WHEN kind = 'return' THEN total END), 0) AS returns,
      COALESCE(SUM(kind = 'return'), 0) AS return_count FROM ledger WHERE ${range}`).get(from, to);
  const daily = db.prepare(`SELECT date(created_at,${LT}) AS day, SUM(kind = 'sale') AS count, SUM(total) AS total,
      SUM(total-cost_total) AS profit FROM ledger WHERE ${range} GROUP BY day ORDER BY day`).all(from, to);
  const top = db.prepare(`SELECT l.item_id, l.name, i.compat, SUM(l.qty) AS qty, SUM(l.qty*l.price) AS total,
      SUM(l.qty*(l.price-l.cost)) AS profit FROM ledger_lines l LEFT JOIN items i ON i.id = l.item_id
    WHERE date(l.created_at,${LT}) BETWEEN ? AND ? GROUP BY l.item_id HAVING SUM(l.qty) > 0
    ORDER BY total DESC LIMIT 15`).all(from, to);
  const byCategory = db.prepare(`SELECT c.name AS category, SUM(l.qty) AS qty, SUM(l.qty*l.price) AS total
    FROM ledger_lines l JOIN items i ON i.id = l.item_id JOIN categories c ON c.id = i.category_id
    WHERE date(l.created_at,${LT}) BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC`).all(from, to);
  const payments = db.prepare(`SELECT payment, SUM(kind = 'sale') AS count, SUM(total) AS total FROM ledger WHERE ${range}
    GROUP BY payment ORDER BY total DESC`).all(from, to);
  return { summary, daily, top, byCategory, payments };
}

const today = () => db.prepare(`SELECT date('now', ${LT}) AS d`).get().d;
function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

// ---------------------------------------------------------------- routes
const routes = [];
const route = (method, pattern, handler, opts = {}) =>
  routes.push({ method, pattern, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, ...opts });

route('POST', '/api/login', ({ req, body, res }) => {
  const ip = clientIp(req);
  checkLoginLimit(ip);
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(str(body.username));
  if (!u || !verifyPassword(String(body.password || ''), u.pass_hash)) {
    recordFailedLogin(ip);
    throw new HttpError(401, 'Wrong username or password');
  }
  failedLogins.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).run(token, u.id);
  res.setHeader('Set-Cookie', cookie(req, token, SESSION_DAYS * 86400));
  return { id: u.id, username: u.username, full_name: u.full_name, role: u.role, must_change: u.must_change };
}, { public: true });

route('POST', '/api/logout', ({ req, res }) => {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (m) db.prepare('DELETE FROM sessions WHERE token = ?').run(m[1]);
  res.setHeader('Set-Cookie', cookie(req, '', 0));
  return { ok: true };
}, { public: true });

route('GET', '/api/me', ({ user }) => user);
route('GET', '/api/shop', () => SHOP, { public: true });

route('POST', '/api/me/password', ({ user, body }) => {
  const u = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(user.id);
  if (!verifyPassword(String(body.current || ''), u.pass_hash)) bad('Current password is incorrect');
  const next = String(body.next || '');
  if (next.length < 8) bad('New password must be at least 8 characters');
  if (next === String(body.current) || next === 'admin123') bad('Choose a new password, not the old one');
  db.prepare('UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?').run(hashPassword(next), user.id);
  return { ok: true };
});

route('GET', '/api/dashboard', () => dashboard());

route('GET', '/api/categories', () => db.prepare(`SELECT c.id, c.name, c.code, COUNT(i.id) AS items FROM categories c
  LEFT JOIN items i ON i.category_id = c.id AND i.archived = 0 GROUP BY c.id ORDER BY c.name`).all());
route('POST', '/api/categories', ({ user, body }) => { requireAdmin(user); return { id: ensureCategory(body.name) }; });
route('PUT', '/api/categories/:id', ({ user, body, params }) => {
  requireAdmin(user);
  const name = str(body.name, 80); if (!name) bad('Name is required');
  try { db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, int(params.id, 'id')); }
  catch { bad('A category with that name already exists'); }
  return { ok: true };
});
route('DELETE', '/api/categories/:id', ({ user, params }) => {
  requireAdmin(user);
  if (db.prepare('SELECT 1 FROM items WHERE category_id = ? LIMIT 1').get(params.id))
    bad('This category still has items (including hidden ones that left the Google Sheet)');
  db.prepare('DELETE FROM categories WHERE id = ?').run(params.id);
  return { ok: true };
});

// pieces sold in the last 30 days, so the POS can put best sellers first
const SOLD_30D = `(SELECT COALESCE(SUM(l.qty), 0) FROM sale_lines l JOIN sales s ON s.id = l.sale_id
  WHERE l.item_id = i.id AND s.voided = 0 AND s.created_at >= datetime('now', '-30 days'))`;
route('GET', '/api/items', () => db.prepare(`${ITEM_SELECT.replace(' FROM items i', `, ${SOLD_30D} AS sold_30d FROM items i`)}
  WHERE i.archived = 0 ORDER BY c.name, i.name`).all());
route('GET', '/api/items/:id', ({ params }) => {
  const item = db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(params.id);
  if (!item) throw new HttpError(404, 'Item not found');
  item.history = db.prepare(`SELECT m.type, m.qty, m.stock_after, m.note, datetime(m.created_at,${LT}) AS at,
    u.username, s.receipt_no FROM movements m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN sales s ON s.id = m.sale_id
    WHERE m.item_id = ? ORDER BY m.id DESC LIMIT 50`).all(params.id);
  return item;
});

function readItem(body) {
  const name = str(body.name); if (!name) bad('Item name is required');
  return {
    name, category_id: int(body.category_id, 'Category'), compat: str(body.compat) || 'UNIVERSAL',
    cost: num(body.cost, 'Unit cost'), srp: num(body.srp, 'SRP'),
    reorder_level: Math.max(0, int(body.reorder_level ?? 0, 'Reorder level')),
  };
}
route('POST', '/api/items', ({ user, body }) => {
  const it = readItem(body);
  const stock = Math.max(0, int(body.stock ?? 0, 'Stock'));
  return tx(() => {
    const sku = str(body.sku, 40) || nextSku(it.category_id);
    if (db.prepare('SELECT 1 FROM items WHERE sku = ?').get(sku)) bad('That SKU is already used');
    const r = db.prepare(`INSERT INTO items (sku, name, category_id, compat, stock, cost, srp, reorder_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(sku, it.name, it.category_id, it.compat, stock, it.cost, it.srp, it.reorder_level);
    const id = Number(r.lastInsertRowid);
    logMove(id, 'NEW', stock, stock, 'Item added', user.id);
    return { id, sku };
  });
});
// Set selling prices without opening each item: one or many at once.
route('POST', '/api/items/prices', ({ body }) => tx(() => {
  const list = Array.isArray(body.prices) ? body.prices : [];
  if (!list.length) bad('No prices to save');
  const set = db.prepare(`UPDATE items SET srp = ?, updated_at = datetime('now') WHERE id = ? AND archived = 0`);
  let saved = 0;
  const previous = [];
  for (const p of list) {
    const srp = num(p.srp, 'SRP');
    if (srp <= 0 && !body.restore) bad('Prices must be more than ₱0');   // restore = undoing back to "no price yet"
    const id = int(p.id, 'Item');
    const before = db.prepare('SELECT srp FROM items WHERE id = ?').get(id);
    if (before) previous.push({ id, srp: before.srp });
    saved += set.run(srp, id).changes;
  }
  return { saved, previous };
}));
route('PUT', '/api/items/:id', ({ body, params }) => {
  const it = readItem(body);
  const sku = str(body.sku, 40); if (!sku) bad('SKU is required');
  if (db.prepare('SELECT 1 FROM items WHERE sku = ? AND id <> ?').get(sku, params.id)) bad('That SKU is already used');
  const r = db.prepare(`UPDATE items SET sku=?, name=?, category_id=?, compat=?, cost=?, srp=?, reorder_level=?,
    updated_at=datetime('now') WHERE id=?`).run(sku, it.name, it.category_id, it.compat, it.cost, it.srp, it.reorder_level, params.id);
  if (!r.changes) throw new HttpError(404, 'Item not found');
  return { ok: true };
});
route('DELETE', '/api/items/:id', ({ user, params }) => {
  requireAdmin(user);
  if (db.prepare('SELECT 1 FROM sale_lines WHERE item_id = ? LIMIT 1').get(params.id))
    bad('This item has sales history and cannot be deleted. Set its stock to 0 instead.');
  db.prepare('DELETE FROM items WHERE id = ?').run(params.id);
  return { ok: true };
});

// Stock in / stock out / physical count
route('POST', '/api/items/:id/stock', ({ user, body, params }) => tx(() => {
  const item = db.prepare('SELECT id, stock, cost, archived FROM items WHERE id = ?').get(params.id);
  if (!item) throw new HttpError(404, 'Item not found');
  if (item.archived) bad('This item is no longer in the Google Sheet');
  const type = String(body.type);
  const qty = int(body.qty, 'Quantity');
  let next;
  if (type === 'IN') { if (qty <= 0) bad('Quantity must be more than 0'); next = item.stock + qty; }
  else if (type === 'OUT') {
    if (qty <= 0) bad('Quantity must be more than 0');
    if (qty > item.stock) bad(`Only ${item.stock} in stock`);
    next = item.stock - qty;
  } else if (type === 'ADJUST') { if (qty < 0) bad('Count cannot be negative'); next = qty; }
  else bad('Unknown stock action');
  const previousCost = item.cost;
  if (type === 'IN' && body.cost !== undefined && body.cost !== '') {
    db.prepare('UPDATE items SET cost = ? WHERE id = ?').run(num(body.cost, 'Unit cost'), item.id);
  }
  db.prepare(`UPDATE items SET stock = ?, updated_at = datetime('now') WHERE id = ?`).run(next, item.id);
  const delta = type === 'ADJUST' ? next - item.stock : (type === 'OUT' ? -qty : qty);
  logMove(item.id, type, delta, next, str(body.note), user.id);
  const movementId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
  return { stock: next, movement_id: movementId, previous_cost: previousCost };
}));

// Undo a stock change made in the last 15 minutes, but only while nothing else has touched the item since.
route('POST', '/api/movements/:id/undo', ({ user, body, params }) => tx(() => {
  const m = db.prepare(`SELECT m.*, i.stock AS now_stock, i.archived FROM movements m JOIN items i ON i.id = m.item_id WHERE m.id = ?`).get(params.id);
  if (!m) throw new HttpError(404, 'That change was not found');
  if (!['IN', 'OUT', 'ADJUST'].includes(m.type) || m.sale_id) bad('Only manual stock changes can be undone');
  if (m.archived) bad('This item is no longer in the Google Sheet');
  if (db.prepare(`SELECT 1 WHERE datetime('now', '-15 minutes') > ?`).get(m.created_at)) bad('Too late to undo. Make a new stock change instead.');
  if (m.now_stock !== m.stock_after) bad('The stock changed again since then, so it can\'t be undone safely.');
  const back = m.stock_after - m.qty;
  if (back < 0) bad('That would make the stock negative');
  db.prepare(`UPDATE items SET stock = ?, updated_at = datetime('now') WHERE id = ?`).run(back, m.item_id);
  if (m.type === 'IN' && body.previous_cost !== undefined && body.previous_cost !== null)
    db.prepare('UPDATE items SET cost = ? WHERE id = ?').run(num(body.previous_cost, 'Unit cost'), m.item_id);
  logMove(m.item_id, m.qty > 0 ? 'OUT' : m.qty < 0 ? 'IN' : 'ADJUST', -m.qty, back, `Undo of ${MOVE_WORD[m.type]}`, user.id);
  return { stock: back };
}));
const MOVE_WORD = { IN: 'stock in', OUT: 'stock out', ADJUST: 'count' };

route('GET', '/api/movements', ({ query }) => {
  const where = ["m.type <> 'NEW' OR m.note NOT LIKE 'Imported from %'"];
  const args = [];
  if (query.type) { where.push('m.type = ?'); args.push(query.type); }
  if (query.from) { where.push(`date(m.created_at,${LT}) >= ?`); args.push(query.from); }
  if (query.to) { where.push(`date(m.created_at,${LT}) <= ?`); args.push(query.to); }
  return db.prepare(`SELECT m.id, m.type, m.qty, m.stock_after, m.note, datetime(m.created_at,${LT}) AS at,
      i.id AS item_id, i.sku, i.name, u.username, s.receipt_no
    FROM movements m JOIN items i ON i.id = m.item_id LEFT JOIN users u ON u.id = m.user_id LEFT JOIN sales s ON s.id = m.sale_id
    WHERE (${where.join(') AND (')}) ORDER BY m.id DESC LIMIT 500`).all(...args);
});

// Sales
route('POST', '/api/sales', ({ user, body }) => tx(() => {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) bad('Add at least one item');
  let total = 0, costTotal = 0;
  const taken = new Map(); // item id -> qty already claimed by earlier lines of this sale
  const prepared = lines.map(l => {
    const item = db.prepare('SELECT id, name, stock, cost, archived FROM items WHERE id = ?').get(int(l.item_id, 'Item'));
    if (!item) bad('Item not found');
    if (item.archived) bad(`${item.name} is no longer in the inventory`);
    const qty = int(l.qty, 'Quantity'); if (qty <= 0) bad('Quantity must be more than 0');
    const left = item.stock - (taken.get(item.id) || 0);
    if (qty > left) bad(`Not enough stock for ${item.name} (only ${left} left)`);
    taken.set(item.id, (taken.get(item.id) || 0) + qty);
    const price = num(l.price, 'Price');
    if (price <= 0) bad(`Enter a selling price for ${item.name}`);
    total += qty * price; costTotal += qty * item.cost;
    return { item, qty, price };
  });
  const ymd = db.prepare(`SELECT strftime('%Y%m%d', 'now', ${LT}) AS d`).get().d;
  const n = db.prepare('SELECT COUNT(*) AS n FROM sales WHERE receipt_no LIKE ?').get(`${ymd}-%`).n + 1;
  const receipt = `${ymd}-${String(n).padStart(3, '0')}`;
  const saleId = Number(db.prepare(`INSERT INTO sales (receipt_no, customer, payment, total, cost_total, user_id)
    VALUES (?, ?, ?, ?, ?, ?)`).run(receipt, str(body.customer, 120), str(body.payment, 40) || 'Cash', total, costTotal, user.id).lastInsertRowid);
  for (const { item, qty, price } of prepared) {
    db.prepare('INSERT INTO sale_lines (sale_id, item_id, name, qty, price, cost) VALUES (?, ?, ?, ?, ?, ?)')
      .run(saleId, item.id, item.name, qty, price, item.cost);
    const after = db.prepare(`UPDATE items SET stock = stock - ?, updated_at = datetime('now') WHERE id = ? RETURNING stock`).get(qty, item.id).stock;
    logMove(item.id, 'SALE', -qty, after, `Sold @ ${price}`, user.id, saleId);
  }
  return { id: saleId, receipt_no: receipt };
}));
route('GET', '/api/sales', ({ query }) => {
  const from = query.from || '0000-01-01', to = query.to || '9999-12-31';
  return db.prepare(`SELECT s.id, s.receipt_no, s.customer, s.payment, s.total, s.cost_total, s.voided,
      datetime(s.created_at,${LT}) AS at, u.username, (SELECT SUM(qty) FROM sale_lines WHERE sale_id = s.id) AS units,
      (SELECT COALESCE(SUM(total), 0) FROM returns WHERE sale_id = s.id) AS returned,
      (SELECT COALESCE(SUM(cost_total), 0) FROM returns WHERE sale_id = s.id) AS returned_cost
    FROM sales s LEFT JOIN users u ON u.id = s.user_id
    WHERE date(s.created_at,${LT}) BETWEEN ? AND ? ORDER BY s.id DESC LIMIT 500`).all(from, to);
});
route('GET', '/api/sales/:id', ({ params }) => {
  const sale = db.prepare(`SELECT s.*, datetime(s.created_at,${LT}) AS at, u.username, u.full_name FROM sales s
    LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(params.id);
  if (!sale) throw new HttpError(404, 'Sale not found');
  sale.lines = db.prepare(`SELECT l.*, (SELECT COALESCE(SUM(qty), 0) FROM return_lines WHERE sale_line_id = l.id) AS returned
    FROM sale_lines l WHERE l.sale_id = ?`).all(params.id);
  sale.returns = db.prepare(`SELECT r.id, r.total, r.reason, datetime(r.created_at,${LT}) AS at, u.username, u.full_name
    FROM returns r LEFT JOIN users u ON u.id = r.user_id WHERE r.sale_id = ? ORDER BY r.id`).all(params.id);
  for (const r of sale.returns) r.lines = db.prepare('SELECT name, qty, price FROM return_lines WHERE return_id = ?').all(r.id);
  return sale;
});

// Return some items from a receipt: stock goes back, the refund is recorded on today's books.
const RETURN_REASONS = ['Wrong fitment', 'Defective', 'Changed mind', 'Other'];
route('POST', '/api/sales/:id/returns', ({ user, body, params }) => tx(() => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(params.id);
  if (!sale) throw new HttpError(404, 'Sale not found');
  if (sale.voided) bad('This sale was voided');
  const reason = RETURN_REASONS.includes(body.reason) ? body.reason : 'Other';
  const note = str(body.note, 120);
  const wanted = (Array.isArray(body.lines) ? body.lines : []).map(l => ({ id: int(l.line_id, 'Line'), qty: int(l.qty, 'Quantity') }))
    .filter(l => l.qty > 0);
  if (!wanted.length) bad('Choose at least one item to return');
  let total = 0, cost = 0;
  const lines = wanted.map(w => {
    const line = db.prepare(`SELECT l.*, (SELECT COALESCE(SUM(qty), 0) FROM return_lines WHERE sale_line_id = l.id) AS returned
      FROM sale_lines l WHERE l.id = ? AND l.sale_id = ?`).get(w.id, sale.id);
    if (!line) bad('That item is not on this receipt');
    if (w.qty > line.qty - line.returned) bad(`Only ${line.qty - line.returned} of ${line.name} can still be returned`);
    total += w.qty * line.price; cost += w.qty * line.cost;
    return { line, qty: w.qty };
  });
  const returnId = Number(db.prepare('INSERT INTO returns (sale_id, total, cost_total, reason, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(sale.id, total, cost, note ? `${reason}: ${note}` : reason, user.id).lastInsertRowid);
  for (const { line, qty } of lines) {
    db.prepare('INSERT INTO return_lines (return_id, sale_line_id, item_id, name, qty, price, cost) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(returnId, line.id, line.item_id, line.name, qty, line.price, line.cost);
    const after = db.prepare(`UPDATE items SET stock = stock + ?, updated_at = datetime('now') WHERE id = ? RETURNING stock`).get(qty, line.item_id).stock;
    logMove(line.item_id, 'IN', qty, after, `Customer return · receipt ${sale.receipt_no} · ${reason}`, user.id, sale.id);
  }
  return { id: returnId, total };
}));
route('POST', '/api/sales/:id/void', ({ user, params }) => tx(() => {
  requireAdmin(user);
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(params.id);
  if (!sale) throw new HttpError(404, 'Sale not found');
  if (sale.voided) bad('This sale is already voided');
  if (db.prepare('SELECT 1 FROM returns WHERE sale_id = ? LIMIT 1').get(sale.id))
    bad('Items on this receipt were already returned. Return the rest instead of voiding it.');
  db.prepare('UPDATE sales SET voided = 1 WHERE id = ?').run(sale.id);
  for (const l of db.prepare('SELECT * FROM sale_lines WHERE sale_id = ?').all(sale.id)) {
    const after = db.prepare('UPDATE items SET stock = stock + ? WHERE id = ? RETURNING stock').get(l.qty, l.item_id).stock;
    logMove(l.item_id, 'VOID', l.qty, after, `Voided receipt ${sale.receipt_no}`, user.id, sale.id);
  }
  return { ok: true };
}));

// ---------------------------------------------------------------- daily closing
// One day's totals, per payment method and cashier, and the cash that should be in the drawer.
function daySummary(day) {
  const on = `date(created_at,${LT}) = ?`;
  const totals = db.prepare(`SELECT COALESCE(SUM(kind = 'sale'), 0) AS receipts,
      COALESCE(SUM(CASE WHEN kind = 'sale' THEN total END), 0) AS gross,
      COALESCE(-SUM(CASE WHEN kind = 'return' THEN total END), 0) AS refunds, COALESCE(SUM(kind = 'return'), 0) AS return_count,
      COALESCE(SUM(total), 0) AS net, COALESCE(SUM(total - cost_total), 0) AS profit FROM ledger WHERE ${on}`).get(day);
  const payments = db.prepare(`SELECT payment, COALESCE(SUM(kind = 'sale'), 0) AS receipts,
      COALESCE(SUM(CASE WHEN kind = 'sale' THEN total END), 0) AS sales, COALESCE(-SUM(CASE WHEN kind = 'return' THEN total END), 0) AS refunds,
      SUM(total) AS net FROM ledger WHERE ${on} GROUP BY payment ORDER BY net DESC`).all(day);
  const voids = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total FROM sales WHERE voided = 1 AND ${on}`).get(day);
  const cashiers = db.prepare(`SELECT COALESCE(NULLIF(u.full_name, ''), u.username, 'Removed account') AS name, COUNT(*) AS receipts, SUM(s.total) AS total
    FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.voided = 0 AND date(s.created_at,${LT}) = ?
    GROUP BY s.user_id ORDER BY total DESC`).all(day);
  const units = db.prepare(`SELECT COALESCE(SUM(qty), 0) AS n FROM ledger_lines WHERE ${on}`).get(day).n;
  const top = db.prepare(`SELECT l.name, i.compat, SUM(l.qty) AS qty, SUM(l.qty * l.price) AS total FROM ledger_lines l
    LEFT JOIN items i ON i.id = l.item_id WHERE date(l.created_at,${LT}) = ?
    GROUP BY l.item_id HAVING SUM(l.qty) > 0 ORDER BY total DESC LIMIT 5`).all(day);
  const cashNet = payments.find(p => p.payment === 'Cash')?.net || 0;
  return { day, ...totals, payments, voids, cashiers, units, top, cashNet };
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const closingRow = (day) => {
  const c = db.prepare(`SELECT c.*, datetime(c.created_at,${LT}) AS at, COALESCE(NULLIF(u.full_name, ''), u.username) AS by_name
    FROM closings c LEFT JOIN users u ON u.id = c.user_id WHERE c.day = ?`).get(day);
  if (c) c.summary = JSON.parse(c.summary);
  return c || null;
};
route('GET', '/api/closing', ({ query }) => {
  const day = DAY.test(query.day || '') ? query.day : today();
  return { day, today: today(), summary: daySummary(day), closing: closingRow(day) };
});
route('POST', '/api/closing', ({ user, body }) => {
  const day = DAY.test(body.day || '') ? body.day : bad('Pick a day');
  if (day > today()) bad("You can't close a day that hasn't happened yet");
  const existing = closingRow(day);
  if (existing && user.role !== 'admin') bad('This day is already closed. Only the admin can redo it.');
  const summary = daySummary(day);
  const opening = num(body.opening_cash ?? 0, 'Opening cash'), counted = num(body.counted_cash, 'Counted cash');
  db.prepare(`INSERT INTO closings (day, opening_cash, expected_cash, counted_cash, note, summary, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET opening_cash = excluded.opening_cash, expected_cash = excluded.expected_cash,
      counted_cash = excluded.counted_cash, note = excluded.note, summary = excluded.summary, user_id = excluded.user_id,
      created_at = datetime('now')`)
    .run(day, opening, opening + summary.cashNet, counted, str(body.note, 300), JSON.stringify(summary), user.id);
  return closingRow(day);
});
route('GET', '/api/closings', () => db.prepare(`SELECT c.day, c.expected_cash, c.counted_cash, c.counted_cash - c.expected_cash AS difference,
  c.note, datetime(c.created_at,${LT}) AS at, COALESCE(NULLIF(u.full_name, ''), u.username) AS by_name
  FROM closings c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.day DESC LIMIT 60`).all());

route('GET', '/api/reports', ({ query }) => {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(query.from || '') || !re.test(query.to || '')) bad('Pick a valid date range');
  return report(query.from, query.to);
});

// Users (admin only)
route('GET', '/api/users', ({ user }) => { requireAdmin(user);
  return db.prepare('SELECT id, username, full_name, role, created_at FROM users ORDER BY id').all(); });
route('POST', '/api/users', ({ user, body }) => {
  requireAdmin(user);
  const username = str(body.username, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) bad('Username: 3+ letters/numbers, no spaces');
  if (String(body.password || '').length < 8) bad('Password must be at least 8 characters');
  const role = body.role === 'admin' ? 'admin' : 'staff';
  try {
    db.prepare('INSERT INTO users (username, full_name, role, pass_hash, must_change) VALUES (?, ?, ?, ?, 1)')
      .run(username, str(body.full_name, 80), role, hashPassword(String(body.password)));
  } catch { bad('That username is taken'); }
  return { ok: true };
});
route('POST', '/api/users/:id/password', ({ user, body, params }) => {
  requireAdmin(user);
  if (String(body.password || '').length < 8) bad('Password must be at least 8 characters');
  db.prepare('UPDATE users SET pass_hash = ?, must_change = 1 WHERE id = ?').run(hashPassword(String(body.password)), params.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(params.id);
  return { ok: true };
});
route('DELETE', '/api/users/:id', ({ user, params }) => {
  requireAdmin(user);
  if (Number(params.id) === user.id) bad('You cannot delete your own account');
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(params.id);
  if (target?.role === 'admin' && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n <= 1) bad('Keep at least one admin');
  db.prepare('UPDATE sales SET user_id = NULL WHERE user_id = ?').run(params.id);
  db.prepare('UPDATE movements SET user_id = NULL WHERE user_id = ?').run(params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(params.id);
  return { ok: true };
});

// Exports
route('GET', '/api/export/items.csv', ({ res }) => {
  const rows = db.prepare(`${ITEM_SELECT} WHERE i.archived = 0 ORDER BY c.name, i.name`).all();
  const head = ['SKU', 'Category', 'Item', 'Compatibility', 'Stock', 'Unit Cost', 'SRP', 'Total Cost', 'Status'];
  const lines = [head.join(',')].concat(rows.map(r => [r.sku, r.category, r.name, r.compat, r.stock, r.cost, r.srp, r.stock * r.cost,
    r.stock <= 0 ? 'NO AVAILABLE' : r.stock <= r.reorder_level ? 'LOW STOCK' : 'AVAILABLE'].map(csvCell).join(',')));
  send(res, 200, '﻿' + lines.join('\r\n'), 'text/csv; charset=utf-8',
    { 'Content-Disposition': `attachment; filename="${FILE_PREFIX}-Inventory-${today()}.csv"` });
});
route('GET', '/api/backup', ({ user, res }) => {
  requireAdmin(user);
  const dump = {};
  for (const t of ['users', 'categories', 'items', 'sales', 'sale_lines', 'returns', 'return_lines', 'closings', 'movements', 'settings']) {
    dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
    if (t === 'users') dump[t].forEach(u => delete u.pass_hash);
  }
  send(res, 200, JSON.stringify(dump, null, 1), 'application/json',
    { 'Content-Disposition': `attachment; filename="${FILE_PREFIX}-backup-${today()}.json"` });
});

// ---------------------------------------------------------------- Google Sheet sync
// One-way and read-only: the client's sheet is only ever READ through its public
// "anyone with the link can view" CSV export. Nothing here can write to it.
const getSetting = (key, fallback = null) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
const setSetting = (key, value) => db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
const AUTO_SYNC_CHOICES = [0, 15, 60]; // minutes; 0 = off

function parseSheetLink(link) {
  const m = /docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(String(link || ''));
  if (!m) bad('Paste the Google Sheet link (it starts with https://docs.google.com/spreadsheets/d/…)');
  return { id: m[1], gid: /[#&?]gid=(\d+)/.exec(link)?.[1] || '0' };
}

async function fetchSheetCsv(link) {
  const { id, gid } = parseSheetLink(link);
  if (USE_DEMO && getSetting('demo_sheet_csv')) return getSetting('demo_sheet_csv');
  let res;
  try {
    res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`,
      { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  } catch { throw new HttpError(503, "Couldn't reach Google Sheets. Try again in a minute."); }
  if (!res.ok || !(res.headers.get('content-type') || '').includes('text/csv'))
    throw new HttpError(400, 'Can\'t read the sheet. It must be shared as "Anyone with the link can view".');
  return res.text();
}

function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// The sheet is laid out in category blocks: a "DETAILS" header with the category name two
// columns to its left, then one item per row: name, fits (+4), stock (+7), unit cost (+9), SRP (+10).
function readSheetItems(grid) {
  const at = (r, c) => String(grid[r]?.[c] ?? '').replace(/\s+/g, ' ').trim();
  const amount = (v) => { const n = Number(String(v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
  const heads = [];
  grid.forEach((row, r) => row.forEach((v, c) => { if (at(r, c).toUpperCase() === 'DETAILS') heads.push([r, c]); }));
  const isHead = new Set(heads.map(([r, c]) => `${r}:${c}`));
  const items = [];
  for (const [r, c] of heads) {
    const category = at(r, c - 2);
    if (!category) continue;
    for (let rr = r + 1; rr < grid.length && !isHead.has(`${rr}:${c}`); rr++) {
      const name = at(rr, c);
      if (!name || name === '-') continue;
      items.push({ category, name, compat: at(rr, c + 4) || 'UNIVERSAL',
        stock: Math.max(0, Math.round(amount(at(rr, c + 7)))), cost: amount(at(rr, c + 9)), srp: amount(at(rr, c + 10)) });
    }
  }
  return items;
}

// Compare the sheet with the website. A field is updated when the sheet changed it since the
// last sync (or the item was never synced), so POS sales made here aren't undone every sync.
function planSync(sheet) {
  const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const fits = (x) => norm(x.compat) || 'universal';
  const k3 = (x) => `${norm(x.category)}|${norm(x.name)}|${fits(x)}`;
  const k2 = (x) => `${norm(x.name)}|${fits(x)}`;
  const web = db.prepare(`SELECT i.id, i.name, i.compat, i.stock, i.cost, i.srp, i.archived,
    i.sheet_stock, i.sheet_cost, i.sheet_srp, c.name AS category FROM items i JOIN categories c ON c.id = i.category_id`).all();

  const used = new Set(), pairs = [], unmatched = [];
  const byK3 = new Map(web.map(w => [k3(w), w]));
  for (const s of sheet) {
    const w = byK3.get(k3(s));
    if (w && !used.has(w.id)) { used.add(w.id); pairs.push([s, w]); } else unmatched.push(s);
  }
  // Same name and fit under a different category heading: the item moved.
  const rest = web.filter(w => !used.has(w.id));
  const tally = (arr) => arr.reduce((m, x) => m.set(k2(x), (m.get(k2(x)) || 0) + 1), new Map());
  const restCount = tally(rest), unmatchedCount = tally(unmatched);
  const added = [];
  for (const s of unmatched) {
    const w = restCount.get(k2(s)) === 1 && unmatchedCount.get(k2(s)) === 1 ? rest.find(x => k2(x) === k2(s)) : null;
    if (w) { used.add(w.id); pairs.push([s, w]); } else added.push(s);
  }

  const changed = [];
  for (const [s, w] of pairs) {
    const diff = {};
    const pick = (field, sheetField, eq) => {
      const sheetMoved = w[sheetField] === null || !eq(w[sheetField], s[field]);
      if ((sheetMoved || w.archived) && !eq(w[field], s[field])) diff[field] = [w[field], s[field]];
    };
    const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
    pick('stock', 'sheet_stock', same);
    pick('cost', 'sheet_cost', same);
    pick('srp', 'sheet_srp', same);
    if (norm(w.category) !== norm(s.category)) diff.category = [w.category, titleCase(s.category)];
    if (w.archived) diff.restored = true;
    changed.push({ id: w.id, name: s.name, compat: s.compat, diff, sheet: s,
      rename: w.name !== s.name || w.compat !== s.compat, seen: w.sheet_stock === null || !same(w.sheet_stock, s.stock) ||
        !same(w.sheet_cost, s.cost) || !same(w.sheet_srp, s.srp) });
  }
  const removed = web.filter(w => !used.has(w.id) && !w.archived).map(w => ({ id: w.id, name: w.name, compat: w.compat, stock: w.stock }));
  const updates = changed.filter(c => Object.keys(c.diff).length);
  const active = web.filter(w => !w.archived);
  const capitalNow = active.reduce((t, w) => t + w.stock * w.cost, 0);
  // the website's stock after applying: sheet value where it changes, otherwise what's here now
  let capitalAfter = added.reduce((t, s) => t + s.stock * s.cost, 0);
  for (const c of changed) {
    const w = web.find(x => x.id === c.id);
    capitalAfter += (c.diff.stock ? c.diff.stock[1] : w.stock) * (c.diff.cost ? c.diff.cost[1] : w.cost);
  }
  return {
    sheetItems: sheet.length, activeItems: active.length, capitalNow, capitalAfter,
    added, removed, updates, bookkeeping: changed.filter(c => !Object.keys(c.diff).length && (c.seen || c.rename)),
  };
}

function applySync(plan, userId) {
  return tx(() => {
    for (const s of plan.added) {
      const catId = ensureCategory(titleCase(s.category));
      const reorder = s.stock >= 10 ? Math.round(s.stock * 0.25) : 0;
      const id = Number(db.prepare(`INSERT INTO items (sku, name, category_id, compat, stock, cost, srp, reorder_level,
          sheet_stock, sheet_cost, sheet_srp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(nextSku(catId), s.name, catId, s.compat, s.stock, s.cost, s.srp, reorder, s.stock, s.cost, s.srp).lastInsertRowid);
      logMove(id, 'NEW', s.stock, s.stock, 'Added from Google Sheet', userId);
    }
    for (const c of [...plan.updates, ...plan.bookkeeping]) {
      const s = c.sheet, d = c.diff;
      const before = db.prepare('SELECT stock FROM items WHERE id = ?').get(c.id).stock;
      const stock = d.stock ? d.stock[1] : before;
      db.prepare(`UPDATE items SET name = ?, compat = ?, stock = ?, cost = COALESCE(?, cost), srp = COALESCE(?, srp),
          category_id = COALESCE(?, category_id), archived = 0, sheet_stock = ?, sheet_cost = ?, sheet_srp = ?,
          updated_at = CASE WHEN ? THEN datetime('now') ELSE updated_at END WHERE id = ?`)
        .run(s.name, s.compat, stock, d.cost ? s.cost : null, d.srp ? s.srp : null,
          d.category ? ensureCategory(titleCase(s.category)) : null, s.stock, s.cost, s.srp,
          Object.keys(d).length ? 1 : 0, c.id);
      if (stock !== before) logMove(c.id, 'ADJUST', stock - before, stock, 'Google Sheet sync', userId);
    }
    for (const r of plan.removed) {
      const before = db.prepare('SELECT stock FROM items WHERE id = ?').get(r.id).stock;
      db.prepare(`UPDATE items SET archived = 1, stock = 0, updated_at = datetime('now') WHERE id = ?`).run(r.id);
      if (before) logMove(r.id, 'ADJUST', -before, 0, 'No longer in Google Sheet', userId);
    }
  });
}

const syncSummary = (p) => ({ added: p.added.length, updated: p.updates.length, removed: p.removed.length,
  sheetItems: p.sheetItems, capitalAfter: p.capitalAfter });

async function loadPlan() {
  const link = getSetting('sheet_link');
  if (!link) bad('Save the Google Sheet link first');
  const sheet = readSheetItems(parseCsv(await fetchSheetCsv(link)));
  if (!sheet.length) throw new HttpError(422, 'No items found in the sheet. Did its layout change?');
  return planSync(sheet);
}

let syncRunning = false;
async function runSync(userId, auto) {
  if (syncRunning) throw new HttpError(409, 'A sync is already running');
  syncRunning = true;
  try {
    const plan = await loadPlan();
    // Auto-sync never makes sweeping changes on its own; a person reviews those.
    if (auto && plan.removed.length > Math.max(10, plan.activeItems * 0.2))
      throw new HttpError(409, `Auto-sync paused: ${plan.removed.length} items would be hidden. Review it with "Check for changes".`);
    applySync(plan, userId);
    const summary = syncSummary(plan);
    setSetting('sheet_synced_at', new Date().toISOString());
    setSetting('sheet_summary', JSON.stringify(summary));
    setSetting('sheet_error', '');
    return summary;
  } catch (e) {
    setSetting('sheet_error', e instanceof HttpError ? e.message : 'Sync failed');
    if (!(e instanceof HttpError)) console.error(e);
    throw e;
  } finally { syncRunning = false; }
}

const sheetStatus = () => ({
  syncedAt: getSetting('sheet_synced_at'), summary: JSON.parse(getSetting('sheet_summary', 'null')),
  error: getSetting('sheet_error') || null, auto: Number(getSetting('sheet_auto', '0')),
});
route('GET', '/api/sheet/status', () => sheetStatus());
route('GET', '/api/sheet', ({ user }) => { requireAdmin(user); return { link: getSetting('sheet_link', ''), ...sheetStatus() }; });
route('PUT', '/api/sheet', ({ user, body }) => {
  requireAdmin(user);
  const link = str(body.link, 500);
  if (link) parseSheetLink(link);
  const auto = Number(body.auto) || 0;
  if (!AUTO_SYNC_CHOICES.includes(auto)) bad('Pick an auto-sync interval');
  if (auto && !link) bad('Save the Google Sheet link before turning on auto-sync');
  setSetting('sheet_link', link);
  setSetting('sheet_auto', auto);
  return { ok: true };
});
route('POST', '/api/sheet/preview', async ({ user }) => {
  requireAdmin(user);
  const p = await loadPlan();
  return { ...syncSummary(p), capitalNow: p.capitalNow, added: p.added, removed: p.removed,
    updates: p.updates.map(({ id, name, compat, diff }) => ({ id, name, compat, diff })) };
});
route('POST', '/api/sheet/apply', async ({ user }) => { requireAdmin(user); return runSync(user.id, false); });

async function autoSyncTick() {
  const every = Number(getSetting('sheet_auto', '0'));
  if (!every || syncRunning) return;
  const last = Date.parse(getSetting('sheet_tried_at', '')) || 0;
  if (Date.now() - last < every * 60000) return;
  setSetting('sheet_tried_at', new Date().toISOString());
  try { await runSync(null, true); } catch { /* recorded in sheet_error */ }
}
setInterval(autoSyncTick, 60000).unref();

// ---------------------------------------------------------------- nightly summary
// A short end-of-day message for the owner: sales, profit, cash, what ran out. Sent to Telegram when a bot is
// configured through TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (kept in the environment, never in the database).
const php = (n) => '₱' + Math.round(Number(n) || 0).toLocaleString('en-PH');
const CHANNEL_READY = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
const nowManila = () => db.prepare(`SELECT strftime('%H:%M', 'now', ${LT}) AS t`).get().t;

function buildSummary(day) {
  const d = daySummary(day);
  const stockLine = db.prepare(`SELECT SUM(stock <= 0) AS out_n, SUM(stock > 0 AND stock <= reorder_level) AS low_n FROM items WHERE archived = 0`).get();
  const needs = db.prepare(`SELECT name, compat, stock FROM items WHERE archived = 0 AND stock <= reorder_level ORDER BY stock, name LIMIT 5`).all();
  const c = closingRow(day);
  const label = new Date(day + 'T00:00:00Z').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const lines = [`${SHOP.name} · ${label}`, ''];
  if (!d.receipts && !d.refunds) lines.push('No sales today.');
  else {
    lines.push(`Sales ${php(d.net)} from ${d.receipts} receipt${d.receipts === 1 ? '' : 's'}`);
    lines.push(`Profit ${php(d.profit)}${d.net ? ` (${Math.round((d.profit / d.net) * 100)}%)` : ''}`);
    if (d.refunds) lines.push(`Refunds ${php(d.refunds)} (${d.return_count})`);
    if (d.voids.count) lines.push(`Voided ${d.voids.count} receipt${d.voids.count === 1 ? '' : 's'} (${php(d.voids.total)})`);
    lines.push('', d.payments.map(p => `${p.payment.replace(/ \(.*\)/, '')} ${php(p.net)}`).join(' · '));
    if (d.top.length) lines.push('', 'Best sellers: ' + d.top.slice(0, 3).map(t => `${t.name} ×${t.qty}`).join(', '));
  }
  lines.push('');
  if (c) {
    const diff = Math.round((c.counted_cash - c.expected_cash) * 100) / 100;
    lines.push(`Drawer closed: ${diff === 0 ? 'exact' : diff > 0 ? `over ${php(diff)}` : `SHORT ${php(-diff)}`}${c.note ? ` (${c.note})` : ''}`);
  } else lines.push(d.receipts ? 'Drawer not closed yet.' : '');
  if (stockLine.out_n || stockLine.low_n) {
    lines.push(`Restock: ${stockLine.out_n || 0} out of stock, ${stockLine.low_n || 0} running low`);
    for (const n of needs) lines.push(`  • ${n.name}${n.compat && n.compat !== 'UNIVERSAL' ? ` (${n.compat})` : ''}: ${n.stock} left`);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function sendTelegram(text) {
  if (!CHANNEL_READY) throw new HttpError(400, 'Telegram is not set up. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the server.');
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }), signal: AbortSignal.timeout(15000) });
  } catch { throw new HttpError(503, "Couldn't reach Telegram. Try again in a minute."); }
  if (!res.ok) throw new HttpError(502, `Telegram refused the message (${res.status}). Check the bot token and chat id.`);
}

const summarySettings = () => ({ on: getSetting('summary_on', '0') === '1', time: getSetting('summary_time', '21:00'),
  channel: CHANNEL_READY, lastSent: getSetting('summary_last_sent') || null, error: getSetting('summary_error') || null });
route('GET', '/api/summary', ({ user, query }) => {
  requireAdmin(user);
  const day = DAY.test(query.day || '') ? query.day : today();
  return { day, text: buildSummary(day), settings: summarySettings() };
});
route('PUT', '/api/summary/settings', ({ user, body }) => {
  requireAdmin(user);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.time || ''))) bad('Pick a time');
  if (body.on && !CHANNEL_READY) bad('Set up Telegram on the server first (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID).');
  setSetting('summary_on', body.on ? '1' : '0');
  setSetting('summary_time', body.time);
  return summarySettings();
});
route('POST', '/api/summary/send', async ({ user }) => {
  requireAdmin(user);
  await sendTelegram(buildSummary(today()));
  return { ok: true };
});
// once a day, at or after the chosen time (Manila), if it hasn't gone out yet
async function summaryTick() {
  if (getSetting('summary_on', '0') !== '1' || !CHANNEL_READY) return;
  const day = today();
  if (getSetting('summary_sent_day') === day || nowManila() < getSetting('summary_time', '21:00')) return;
  setSetting('summary_sent_day', day);   // claim the day first, so a slow send can't go out twice
  try {
    await sendTelegram(buildSummary(day));
    setSetting('summary_last_sent', new Date().toISOString()); setSetting('summary_error', '');
  } catch (e) { setSetting('summary_error', e.message); }   // not retried every minute; use "Send a test" once it's fixed
}
setInterval(summaryTick, 60000).unref();

// ---------------------------------------------------------------- server
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1e6) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request', 'text/plain'); }
  let file = path.normalize(path.join(PUBLIC_DIR, decoded));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html');
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, 'Bad request', 'text/plain'); }
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (url.pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');
  if (url.pathname === '/manifest.webmanifest') return send(res, 200, JSON.stringify({
    name: `${SHOP.name} Inventory`, short_name: SHOP.name, description: 'Inventory, POS and sales',
    start_url: '/', scope: '/', display: 'standalone', background_color: '#0d0d0f', theme_color: '#0d0d0f',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }), 'application/manifest+json');
  if (!url.pathname.startsWith('/api/')) {
    try { return serveStatic(req, res, url.pathname); }
    catch (e) { console.error(e); return send(res, 500, 'Server error', 'text/plain'); }
  }
  try {
    const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
    if (!r) throw new HttpError(404, 'Not found');
    const params = r.re.exec(url.pathname).groups || {};
    const user = getUser(req);
    if (!r.public && !user) throw new HttpError(401, 'Please log in');
    // A public demo shares one admin login: nobody may lock the others out.
    if (USE_DEMO && DEMO_LOCKED.has(`${r.method} ${r.pattern}`))
      throw new HttpError(403, 'Passwords and accounts are locked in the demo, so every visitor can log in.');
    if (user?.must_change && !r.public && !PASSWORD_CHANGE_ROUTES.has(url.pathname))
      throw new HttpError(403, 'Please set a new password first');
    if (req.method !== 'GET' && req.headers['content-type'] && !req.headers['content-type'].includes('application/json'))
      throw new HttpError(415, 'JSON only');
    const body = req.method === 'GET' ? {} : await readBody(req);
    const result = await r.handler({ req, res, user, body, params, query: Object.fromEntries(url.searchParams) });
    if (!res.headersSent) send(res, 200, JSON.stringify(result ?? null));
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e.status || 500, JSON.stringify({ error: e instanceof HttpError ? e.message : 'Something went wrong on the server' }));
  }
});

// Railway stops containers with SIGTERM on redeploy; close the database cleanly.
function shutdown() {
  server.close();
  try { db.close(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  const nets = Object.values(require('node:os').networkInterfaces()).flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal).map(n => `http://${n.address}:${PORT}`);
  console.log(`\n  ${SHOP.name} Inventory is running${USE_DEMO ? ' (DEMO DATA)' : ''}`);
  console.log(`  On this computer:   http://localhost:${PORT}`);
  if (nets.length) console.log(`  On phones (same Wi-Fi): ${nets.join('  ')}`);
  console.log('');
});
