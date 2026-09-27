#!/usr/bin/env node
// Takes screenshots of every screen of a running copy of the app, desktop and phone.
// Zero dependencies: drives a locally installed Edge or Chrome over the DevTools protocol.
//
//   node scripts/screenshots.js --url http://localhost:3000 --out docs/screenshots
//   options: --user admin --pass admin123 --only 02,05 --scale 1
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) =>
  v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a, []));
const BASE = String(args.url || 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.resolve(args.out || 'screenshots');
const USER = args.user || 'admin', PASS = args.pass || 'admin123';
const ONLY = args.only ? String(args.only).split(',') : null;
const SCALE = Number(args.scale || 1);
// It logs in, rings up nothing, but does create a "newstaff" account for the first-login shot:
// only ever point it at a local demo copy.
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) && !args['allow-remote']) {
  console.error('Refusing to run against a non-local URL (it creates a test account). Use a local demo copy.');
  process.exit(1);
}

const { launch } = require('./browser.js');

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch();
  const evaluate = async (expr) => {
    const r = await b.send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const viewport = (w, h, mobile) => b.send('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: mobile ? 2 : SCALE, mobile: !!mobile });
  // a throwaway query string forces a real page load even when only the #route changes
  let loads = 0;
  const load = async (url) => {
    const [base, hash = ''] = url.split('#');
    const loaded = b.once('Page.loadEventFired');
    await b.send('Page.navigate', { url: `${base}?r=${++loads}${hash ? '#' + hash : ''}` });
    await loaded;
  };
  // wait until the app has rendered the route (no "Loading…" placeholder, fonts ready)
  const settle = (extra = 350) => evaluate(`
    for (let i = 0; i < 60; i++) {
      const main = document.querySelector('#main'), app = document.querySelector('#app');
      if (app && app.children.length && !(main && main.querySelector('.loading'))) break;
      await new Promise(r => setTimeout(r, 100));
    }
    await document.fonts.ready; await new Promise(r => setTimeout(r, ${extra}));`);
  const go = async (hash) => { await evaluate(`document.querySelector('#modal-root') && (document.querySelector('#modal-root').innerHTML = ''); location.hash = '${hash}';`); await settle(); await evaluate('window.scrollTo(0, 0)'); };
  const login = (u, p) => evaluate(`const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ${JSON.stringify(u)}, password: ${JSON.stringify(p)} }) }); return r.json();`);
  const manifest = [];
  const shot = async (name, title, fn) => {
    if (ONLY && !ONLY.some(o => name.includes(o))) return;
    try {
      const ok = await fn();
      if (ok === false) { console.log(`  skip  ${name} (not in this version)`); return; }
      const { data } = await b.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
      manifest.push({ file: `${name}.png`, title });
      console.log(`  saved ${name}.png`);
    } catch (e) { console.log(`  FAIL  ${name}: ${e.message}`); }
  };

  // ---------------------------------------------------------------- desktop
  await viewport(1440, 900);
  await b.send('Network.clearBrowserCookies');
  await load(BASE + '/'); await settle(600);
  await shot('01-login', 'Login', async () => true);
  const me = await login(USER, PASS);
  if (me.error) throw new Error(`Login failed: ${me.error}`);
  await load(BASE + '/#/dashboard'); await settle(600);

  await shot('02-dashboard', 'Dashboard', async () => { await go('#/dashboard'); });
  await shot('03-inventory', 'Inventory', async () => { await go('#/inventory'); });
  await shot('04-item-detail', 'Item details and history', async () => {
    await go('#/inventory');
    await evaluate(`document.querySelector('#inv-body tr[data-id]')?.click();`); await settle(500);
  });
  await shot('05-pos', 'Sell / POS with a cart', async () => {
    await go('#/sell');
    await evaluate(`const q = document.querySelector('#pos-q'); q.value = 'oil'; q.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 200));
      const rows = [...document.querySelectorAll('#pos-results .pos-item:not(.disabled)')].filter(r => !r.innerText.includes('No SRP'));
      rows[0]?.click(); rows[2]?.click(); rows[0]?.click();
      q.value = 'brake pad'; q.dispatchEvent(new Event('input'));`);
    await settle(300);
  });
  await shot('15-pos-fits-bike', 'POS: parts that fit a chosen bike', async () => {
    await evaluate(`document.querySelector('[data-clear]')?.click();`);
    await go('#/sell');
    const bike = await evaluate(`const q = document.querySelector('#pos-q'); q.value = ''; q.dispatchEvent(new Event('input'));
      const chip = [...document.querySelectorAll('#pos-bikes [data-bike]')].find(c => c.dataset.bike === 'NMAX') || document.querySelectorAll('#pos-bikes [data-bike]')[1];
      chip?.click(); return chip?.dataset.bike || '';`);
    if (!bike) return false;
    await settle(200);
  });
  await shot('06-receipt', 'Receipt', async () => {
    await evaluate(`document.querySelector('[data-clear]')?.click();`);
    await go('#/sales');
    await evaluate(`for (let i = 0; i < 30 && !document.querySelector('#s-body tr[data-id]'); i++) await new Promise(r => setTimeout(r, 100));
      document.querySelector('#s-body tr[data-id]:not(.voided)')?.click();`);
    await settle(600);
  });
  await shot('16-return-items', 'Returning an item from a receipt', async () => {
    await go('#/sales');
    await evaluate(`for (let i = 0; i < 30 && !document.querySelector('#s-body tr[data-id]'); i++) await new Promise(r => setTimeout(r, 100));
      [...document.querySelectorAll('#s-body tr[data-id]:not(.voided)')][1]?.click();`);
    await settle(500);
    const has = await evaluate(`const b = document.querySelector('[data-return]'); b?.click(); return !!b;`);
    if (!has) return false;
    await settle(300);
    await evaluate(`const q = document.querySelector('.ret-qty'); if (q) { q.value = 1; q.dispatchEvent(new Event('input', { bubbles: true })); }`);
    await settle(150);
  });
  await shot('17-daily-closing', 'Daily closing and cash count', async () => {
    await go('#/closing');
    const has = await evaluate(`return !!document.querySelector('#cl-form');`);
    if (!has) return false;
    await evaluate(`const f = document.querySelector('#cl-form');
      if (!f.counted_cash.value) {
        f.opening_cash.value = 1000;
        for (const [b, n] of [[1000, 2], [500, 1], [200, 2], [100, 3], [50, 1], [20, 4]]) { const i = f.querySelector('[data-bill="' + b + '"]'); if (i) i.value = n; }
        f.querySelector('[data-bill="1000"]').dispatchEvent(new Event('input', { bubbles: true }));
      }`);
    await settle(200);
  });
  await shot('18-reorder-list', 'Reorder list for the supplier', async () => {
    await go('#/inventory');
    const has = await evaluate(`const b = document.querySelector('[data-reorder]'); b?.click(); return !!b;`);
    if (!has) return false;
    await settle(500);
  });
  await shot('19-quick-pricing', 'Pricing items that have no SRP', async () => {
    await go('#/inventory');
    const has = await evaluate(`const b = document.querySelector('[data-s="nosrp"]'); b?.click(); return !!document.querySelector('.srp-in');`);
    if (!has) return false;
    await evaluate(`const i = document.querySelector('.srp-in'); i.focus(); i.value = i.placeholder;`);
    await settle(200);
  });
  await shot('07-sales', 'Sales history', async () => { await go('#/sales'); await settle(300); });
  await shot('08-stock-log', 'Stock log', async () => { await go('#/stock-log'); await settle(300); });
  await shot('09-reports', 'Reports', async () => { await go('#/reports'); await settle(500); });
  await shot('10-settings', 'Settings', async () => { await go('#/settings'); });
  await shot('11-sheet-sync', 'Google Sheet sync preview', async () => {
    await go('#/settings');
    const has = await evaluate(`return !!document.querySelector('[data-shcheck]');`);
    if (!has) return false;
    await evaluate(`document.querySelector('[data-shcheck]').click();
      for (let i = 0; i < 80 && !document.querySelector('.modal'); i++) await new Promise(r => setTimeout(r, 100));`);
    await settle(400);
    return evaluate(`return !!document.querySelector('.modal .kv');`);
  });
  await shot('12-no-srp', 'Items without a selling price', async () => {
    await go('#/inventory');
    const has = await evaluate(`const b = document.querySelector('[data-s="nosrp"]'); b?.click(); return !!b;`);
    await settle(200); return has;
  });

  // ---------------------------------------------------------------- phone
  await viewport(390, 844, true);
  await shot('20-phone-dashboard', 'Dashboard on a phone', async () => { await go('#/inventory'); await go('#/dashboard'); });
  await shot('21-phone-inventory', 'Inventory on a phone', async () => { await go('#/inventory'); await evaluate(`document.querySelector('[data-s="all"]')?.click();`); });
  await shot('22-phone-pos', 'POS on a phone', async () => {
    await go('#/sell');
    await evaluate(`const q = document.querySelector('#pos-q'); q.value = 'flyball'; q.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 150));
      [...document.querySelectorAll('#pos-results .pos-item:not(.disabled)')].filter(r => !r.innerText.includes('No SRP'))[0]?.click();`);
    await settle(200);
  });
  await shot('23-phone-receipt', 'Receipt on a phone', async () => {
    await evaluate(`document.querySelector('[data-clear]')?.click();`);
    await go('#/sales');
    await evaluate(`for (let i = 0; i < 30 && !document.querySelector('#s-body tr[data-id]'); i++) await new Promise(r => setTimeout(r, 100));
      document.querySelector('#s-body tr[data-id]:not(.voided)')?.click();`);
    await settle(500);
  });

  // ---------------------------------------------------------------- first login (temporary password)
  await viewport(1440, 900);
  await shot('13-set-password', 'First login: choose your own password', async () => {
    const made = await evaluate(`const r = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'newstaff', full_name: 'New Staff', password: 'Temp-pass-123', role: 'staff' }) });
      const me = await (await fetch('/api/me')).json(); return r.ok || /taken/.test((await r.json()).error || '') ? 'ok' : 'no';`);
    if (made !== 'ok') return false;
    await b.send('Network.clearBrowserCookies');
    const u = await login('newstaff', 'Temp-pass-123');
    if (!u.must_change) return false;
    await load(BASE + '/'); await settle(600);
    return evaluate(`return /Set your password/i.test(document.body.innerText);`);
  });
  await shot('14-phone-login', 'Login on a phone', async () => {
    await viewport(390, 844, true);
    await b.send('Network.clearBrowserCookies'); await load(BASE + '/'); await settle(600);
  });

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest.sort((a, z) => a.file.localeCompare(z.file)), null, 1));
  b.close();
  console.log(`\n${manifest.length} screenshots in ${OUT}`);
}

run().catch(e => { console.error(e.message); process.exit(1); });
