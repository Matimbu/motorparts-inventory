// Demo data: a generated motorparts catalog and ~60 days of sales history.
// Everything here is made up from templates and a fixed random seed, so the demo
// looks like a real shop without containing any real shop's items, prices or sales.
'use strict';

function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  const pick = (arr) => arr[Math.floor(next() * arr.length)];
  const weighted = (pairs) => { let r = next() * pairs.reduce((t, [, w]) => t + w, 0); for (const [v, w] of pairs) if ((r -= w) < 0) return v; return pairs[0][0]; };
  return { next, int, pick, weighted };
}
const round5 = (n) => n >= 100 ? Math.round(n / 5) * 5 : Math.round(n);

// Fictional brands, so the demo doesn't mirror any real shop's assortment.
const BRANDS = ['Kaizen', 'Torque One', 'RideMax', 'Apex', 'Velocity', 'Nitro', 'Sakura', 'ProMoto', 'Zenith', 'Bulldog'];
const SCOOTERS = ['NMAX / AEROX', 'CLICK 125 / 150', 'MIO i125', 'BEAT', 'PCX / ADV 160'];
const BIKES = [...SCOOTERS, 'SNIPER 155', 'RAIDER 150', 'XRM 125'];
const COLORS = ['Black', 'Silver', 'Red', 'Gold', 'Blue'];

// [name template, fits, cost range, stock range, options]
// {b} = brand, {s} = size, {c} = color. Each fits entry and variant becomes its own item.
const TEMPLATES = [
  ['LUBRICANTS & FLUIDS', [
    ['{b} Scooter Oil 10W-40 1L', ['UNIVERSAL'], [230, 330], [2, 9], { brands: 4 }],
    ['{b} Scooter Oil 10W-40 800ml', ['UNIVERSAL'], [190, 280], [2, 7], { brands: 3 }],
    ['{b} Gear Oil 120ml', ['UNIVERSAL'], [60, 110], [4, 14], { brands: 3 }],
    ['{b} Fully Synthetic 10W-40 1L', ['UNIVERSAL'], [420, 560], [1, 4], { brands: 2 }],
    ['Brake Fluid DOT4 300ml', ['UNIVERSAL'], [95, 140], [3, 8]],
    ['Coolant Ready-Mix 1L', ['UNIVERSAL'], [120, 180], [2, 6]],
    ['Chain Lube Spray 400ml', ['UNIVERSAL'], [150, 220], [2, 6]],
    ['Throttle Body Cleaner 500ml', ['UNIVERSAL'], [130, 190], [3, 8]],
    ['Hi-Temp Grease 100g', ['UNIVERSAL'], [45, 80], [10, 24]],
  ]],
  ['TRANSMISSION & DRIVETRAIN', [
    ['{b} Pulley Set', SCOOTERS.slice(0, 3), [1200, 1900], [1, 3], { brands: 2 }],
    ['{b} Flyball {s}', ['NMAX / AEROX', 'CLICK 125 / 150'], [220, 340], [1, 4], { brands: 1, sizes: ['9G', '10G', '11G', '12G'] }],
    ['Center Spring {s}', SCOOTERS.slice(0, 3), [150, 260], [1, 4], { sizes: ['1000 RPM', '1500 RPM'] }],
    ['{b} Clutch Shoe', SCOOTERS.slice(0, 4), [600, 950], [1, 3], { brands: 1 }],
    ['Clutch Spring 1200', ['NMAX / AEROX', 'CLICK 125 / 150'], [180, 280], [1, 4]],
    ['Slider Piece Set', SCOOTERS, [90, 150], [2, 5]],
    ['V-Belt', SCOOTERS, [420, 780], [1, 4]],
    ['Drive Chain 428H x 120L', ['SNIPER 155', 'RAIDER 150', 'XRM 125'], [380, 620], [1, 4]],
    ['Sprocket Set 14/42', ['SNIPER 155', 'RAIDER 150', 'XRM 125'], [450, 750], [1, 3]],
  ]],
  ['BRAKING SYSTEM', [
    ['{b} Brake Pad Front', BIKES, [120, 260], [2, 6], { brands: 1 }],
    ['{b} Brake Pad Rear', ['NMAX / AEROX', 'PCX / ADV 160', 'SNIPER 155'], [120, 240], [1, 5], { brands: 1 }],
    ['Brake Shoe Rear', ['CLICK 125 / 150', 'MIO i125', 'BEAT', 'XRM 125'], [110, 190], [2, 6]],
    ['{b} 4-Piston Caliper ({c})', ['UNIVERSAL'], [2600, 3400], [0, 3], { brands: 1, colors: 3 }],
    ['{b} Brake Master Pump ({c})', ['UNIVERSAL'], [1400, 2200], [0, 2], { brands: 1, colors: 2 }],
    ['Braided Brake Hose 1000mm', ['UNIVERSAL'], [520, 780], [1, 4]],
    ['Disc Rotor 220mm', ['NMAX / AEROX', 'CLICK 125 / 150', 'SNIPER 155'], [780, 1250], [0, 2]],
  ]],
  ['SUSPENSION', [
    ['{b} Rear Shock 305mm ({c})', ['NMAX / AEROX'], [4800, 9200], [0, 2], { brands: 2, colors: 2 }],
    ['{b} Rear Shock 300mm ({c})', ['CLICK 125 / 150', 'MIO i125'], [850, 1600], [0, 2], { brands: 1, colors: 2 }],
    ['Front Fork Oil Seal Set', BIKES.slice(0, 6), [140, 260], [1, 5]],
    ['Fork Oil 10W 500ml', ['UNIVERSAL'], [180, 260], [2, 6]],
  ]],
  ['WHEELS & TIRES', [
    ['{b} Tubeless Tire {s}', ['UNIVERSAL'], [980, 1650], [1, 5], { brands: 2, sizes: ['90/80-14', '100/80-14', '110/70-13', '120/70-13'] }],
    ['{b} Mags Set ({c})', ['NMAX / AEROX', 'CLICK 125 / 150'], [5200, 8200], [0, 2], { brands: 1, colors: 2 }],
    ['Tire Valve Aluminum ({c})', ['UNIVERSAL'], [80, 140], [4, 12], { colors: 3 }],
  ]],
  ['COOLING SYSTEM', [
    ['{b} Radiator Assembly', ['NMAX / AEROX', 'CLICK 125 / 150', 'PCX / ADV 160'], [2100, 3600], [0, 2], { brands: 1 }],
    ['Radiator Cap 1.1', ['UNIVERSAL'], [140, 220], [2, 6]],
    ['Coolant Hose Set', ['NMAX / AEROX', 'CLICK 125 / 150'], [320, 520], [1, 3]],
  ]],
  ['EXHAUST SYSTEM', [
    ['{b} Full System Pipe', ['NMAX / AEROX', 'CLICK 125 / 150', 'SNIPER 155'], [4200, 7600], [0, 2], { brands: 1 }],
    ['Exhaust Gasket', ['UNIVERSAL'], [35, 70], [8, 20]],
  ]],
  ['ENGINE PARTS', [
    ['{b} Camshaft Stage {s}', ['NMAX / AEROX', 'CLICK 125 / 150', 'SNIPER 155'], [780, 1300], [0, 2], { brands: 1, sizes: ['1', '2'] }],
    ['Valve Spring Racing', ['NMAX / AEROX', 'CLICK 125 / 150'], [420, 650], [1, 3]],
    ['Piston Kit {s}', ['NMAX / AEROX', 'CLICK 125 / 150', 'MIO i125'], [900, 1500], [0, 2], { sizes: ['STD', '+0.50'] }],
    ['Engine Gasket Set', BIKES.slice(0, 6), [260, 450], [1, 3]],
    ['Timing Chain', BIKES.slice(0, 5), [380, 560], [1, 3]],
  ]],
  ['ELECTRICAL SYSTEM', [
    ['PowerCell Battery {s}', ['UNIVERSAL'], [850, 1500], [1, 4], { sizes: ['YTZ5S', 'YTZ7V', 'YTX4L', 'YTX7A'] }],
    ['Iridium Spark Plug', ['UNIVERSAL'], [320, 480], [3, 10]],
    ['Standard Spark Plug', ['UNIVERSAL'], [95, 150], [6, 18]],
    ['LED Headlight Bulb H4', ['UNIVERSAL'], [380, 650], [2, 6]],
    ['Ignition Coil', ['NMAX / AEROX', 'CLICK 125 / 150', 'MIO i125'], [420, 700], [1, 3]],
    ['Blade Fuse 10A (10 pcs)', ['UNIVERSAL'], [35, 60], [8, 20]],
  ]],
  ['FUEL SYSTEM', [
    ['Fuel Filter', ['UNIVERSAL'], [45, 95], [4, 12]],
    ['Air Filter Element', BIKES.slice(0, 6), [180, 320], [1, 5]],
    ['{b} Fuel Injector 10-hole', ['NMAX / AEROX', 'CLICK 125 / 150'], [1600, 2400], [0, 2], { brands: 1 }],
  ]],
  ['CONTROLS & ACCESSORIES', [
    ['{b} Handle Grip ({c})', ['UNIVERSAL'], [180, 320], [1, 4], { brands: 1, colors: 4 }],
    ['Throttle Cable', BIKES.slice(0, 6), [110, 190], [1, 4]],
    ['Brake Cable', ['CLICK 125 / 150', 'MIO i125', 'BEAT', 'XRM 125'], [100, 170], [1, 4]],
    ['Side Mirror Set ({c})', ['UNIVERSAL'], [250, 480], [1, 4], { colors: 2 }],
    ['Lever Guard ({c})', ['UNIVERSAL'], [650, 1100], [0, 2], { colors: 2 }],
  ]],
  ['BEARINGS, SEALS & RUBBER PARTS', [
    ['Bearing {s}', ['UNIVERSAL'], [20, 55], [8, 20], { sizes: ['6200', '6201', '6202', '6203', '6301', '6302'] }],
    ['Crankshaft Oil Seal Set', BIKES.slice(0, 5), [90, 160], [2, 6]],
    ['Wheel Hub Damper', ['CLICK 125 / 150', 'MIO i125', 'SNIPER 155'], [120, 210], [1, 4]],
  ]],
  ['NUTS, BOLTS & HARDWARE', [
    ['CNC Body Screw {s}', ['UNIVERSAL'], [28, 48], [20, 45], { sizes: ['4x16', '5x15', '6x20', '6x30'] }],
    ['Titanium Bolt {s} ({c})', ['UNIVERSAL'], [55, 95], [10, 30], { sizes: ['6x20', '6x40'], colors: 2 }],
    ['Clip Nut 4.2mm (10 pcs)', ['UNIVERSAL'], [25, 45], [15, 35]],
    ['Washer Assorted Pack', ['UNIVERSAL'], [40, 70], [10, 25]],
  ]],
  ['BODY & FRAME', [
    ['Fairing Clip Set', ['UNIVERSAL'], [60, 110], [5, 15]],
    ['Footrest Rubber', BIKES.slice(0, 5), [90, 160], [1, 5]],
    ['Tinted Visor', ['NMAX / AEROX', 'PCX / ADV 160'], [520, 850], [0, 3]],
    ['Rear Mudguard', ['NMAX / AEROX', 'CLICK 125 / 150'], [260, 420], [1, 3]],
  ]],
];

/** A generated catalog in the same shape as a spreadsheet import. */
function demoCatalog(seed = 20260921) {
  const rng = createRng(seed);
  const items = [];
  for (const [category, templates] of TEMPLATES) {
    for (const [tpl, fits, [cmin, cmax], [smin, smax], opt = {}] of templates) {
      const brands = opt.brands ? Array.from({ length: opt.brands }, (_, i) => BRANDS[(i + rng.int(0, BRANDS.length - 1)) % BRANDS.length]) : [''];
      const sizes = opt.sizes || [''];
      const colors = opt.colors ? COLORS.slice(0, opt.colors) : [''];
      for (const b of [...new Set(brands)]) for (const s of sizes) for (const c of colors) for (const f of fits) {
        const name = tpl.replace('{b}', b).replace('{s}', s).replace('{c}', c).replace(/\s+/g, ' ').trim();
        const cost = round5(rng.int(cmin, cmax));
        const srp = rng.next() < 0.07 ? 0 : round5(cost * (1.18 + rng.next() * 0.27));
        items.push({ category, name, compat: f, stock: rng.int(smin, smax), cost, srp });
      }
    }
  }
  return items;
}

// Manila is UTC+8 with no daylight saving.
const MANILA = 8 * 3600 * 1000;
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const manilaDay = (ms) => new Date(ms + MANILA).toISOString().slice(0, 10);

const CUSTOMERS = ['Mark D.', 'Joel S.', 'Anna P.', 'Ramil C.', 'Kevin T.', 'Liza M.', 'Paolo R.', 'Arnel B.', 'Grace V.', 'Jun L.'];

/**
 * Backfill sales, deliveries and voids over the past `days` days, so the dashboard,
 * reports and stock log look like a shop that has been running for a while.
 * Works on any version of the schema that has users/items/sales/sale_lines/movements.
 */
function seedDemoHistory(db, { days = 60, seed = 7, hashPassword, now = Date.now() } = {}) {
  const rng = createRng(seed);
  const hasCol = (t, c) => !!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name = ?`).get(c);
  const mustChange = hasCol('users', 'must_change');
  if (hashPassword && !db.prepare("SELECT 1 FROM users WHERE username = 'jenny'").get()) {
    db.prepare(`INSERT INTO users (username, full_name, role, pass_hash${mustChange ? ', must_change' : ''})
      VALUES ('jenny', 'Jenny R.', 'staff', ?${mustChange ? ', 0' : ''})`).run(hashPassword('staff1234'));
  }
  if (mustChange) db.prepare("UPDATE users SET must_change = 0 WHERE username = 'admin'").run();
  const staff = db.prepare('SELECT id FROM users ORDER BY id').all().map(u => u.id);
  const items = db.prepare('SELECT id, name, cost, srp, stock, reorder_level FROM items').all();
  const stock = new Map(items.map(i => [i.id, i.stock]));
  const start = now - days * 86400000;
  const midnight = (ms) => Date.parse(manilaDay(ms) + 'T00:00:00Z') - MANILA;

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE items SET created_at = ?, updated_at = ?').run(sqlTime(start - 86400000), sqlTime(start - 86400000));
    db.prepare("UPDATE movements SET created_at = ? WHERE type = 'NEW'").run(sqlTime(start - 86400000));
    const move = db.prepare(`INSERT INTO movements (item_id, type, qty, stock_after, note, user_id, sale_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const saleIns = db.prepare(`INSERT INTO sales (receipt_no, customer, payment, total, cost_total, user_id, voided, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const lineIns = db.prepare('INSERT INTO sale_lines (sale_id, item_id, name, qty, price, cost) VALUES (?, ?, ?, ?, ?, ?)');

    for (let day = 0; day <= days; day++) {
      const base = midnight(start + day * 86400000);
      const weekday = new Date(base + MANILA).getUTCDay();
      const lastHour = day === days ? Math.min(19, new Date(now + MANILA).getUTCHours()) : 19;
      if (lastHour <= 9) continue;

      // a supplier delivery about once a week restocks what ran low
      if (day % 7 === 3) {
        const t = base + (10 + rng.next()) * 3600000;
        for (const it of items) {
          const s = stock.get(it.id);
          if (s > Math.max(1, it.reorder_level) || rng.next() < 0.35) continue;
          const qty = it.srp && it.srp < 100 ? rng.int(10, 20) : rng.int(2, 5);
          stock.set(it.id, s + qty);
          move.run(it.id, 'IN', qty, s + qty, 'Delivery from supplier', staff[0], null, sqlTime(t));
        }
      }

      const sales = Math.max(1, Math.round((weekday === 0 || weekday === 6 ? 8 : 5) + (day / days) * 3 + (rng.next() - 0.5) * 5));
      const times = Array.from({ length: sales }, () => base + (9 + rng.next() * (lastHour - 9)) * 3600000).sort((a, b) => a - b);
      let receiptNo = 0;
      for (const t of times) {
        const sellable = items.filter(i => i.srp > 0 && stock.get(i.id) > 0);
        if (!sellable.length) break;
        const lines = [];
        const count = rng.weighted([[1, 60], [2, 30], [3, 10]]);
        for (let k = 0; k < count; k++) {
          const it = rng.weighted(sellable.map(i => [i, 1 / Math.sqrt(i.srp)]));
          if (lines.some(l => l.it === it)) continue;
          const qty = Math.min(stock.get(it.id), it.srp < 100 ? rng.int(1, 4) : 1);
          const price = rng.next() < 0.12 ? round5(it.srp * 0.93) : it.srp;
          lines.push({ it, qty, price });
        }
        if (!lines.length) continue;
        const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
        const cost = lines.reduce((s, l) => s + l.qty * l.it.cost, 0);
        const payment = rng.weighted([['Cash', 58], ['GCash', 30], ['Maya', 7], ['COD (LBC / J&T)', 5]]);
        const customer = payment.startsWith('COD') ? 'Online order' : rng.next() < 0.25 ? rng.pick(CUSTOMERS) : '';
        const voided = rng.next() < 0.02 ? 1 : 0;
        const user = rng.next() < 0.4 ? staff[0] : staff[staff.length - 1];
        const receipt = `${manilaDay(t).replace(/-/g, '')}-${String(++receiptNo).padStart(3, '0')}`;
        const saleId = Number(saleIns.run(receipt, customer, payment, total, cost, user, voided, sqlTime(t)).lastInsertRowid);
        for (const l of lines) {
          lineIns.run(saleId, l.it.id, l.it.name, l.qty, l.price, l.it.cost);
          const after = stock.get(l.it.id) - l.qty;
          stock.set(l.it.id, after);
          move.run(l.it.id, 'SALE', -l.qty, after, `Sold @ ${l.price}`, user, saleId, sqlTime(t));
        }
        if (voided) {
          for (const l of lines) {
            const after = stock.get(l.it.id) + l.qty;
            stock.set(l.it.id, after);
            move.run(l.it.id, 'VOID', l.qty, after, `Voided receipt ${receipt}`, staff[0], saleId, sqlTime(t + 600000));
          }
        }
      }
    }
    const setStock = db.prepare('UPDATE items SET stock = ? WHERE id = ?');
    for (const [id, s] of stock) setStock.run(s, id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/**
 * A demo "Google Sheet": the current inventory in the same block layout the sync reads,
 * plus a handful of changes a shop owner would make (a delivery, new items, a price bump, a rename).
 */
function demoSheetCsv(items) {
  const rows = items.map(i => ({ ...i }));
  const byName = (n) => rows.find(r => r.name === n);
  // deliveries recorded in the sheet
  rows.filter(r => r.stock <= 1 && r.srp > 0).slice(0, 5).forEach((r, i) => { r.stock += [4, 6, 3, 10, 5][i]; });
  // price updates
  rows.filter(r => r.srp > 300).slice(2, 4).forEach(r => { r.srp += 20; });
  // a rename
  const fluid = byName('Brake Fluid DOT4 300ml');
  if (fluid) fluid.name = 'Brake Fluid DOT4 350ml';
  // new arrivals, one still without an SRP
  rows.push(
    { category: 'TRANSMISSION & DRIVETRAIN', name: 'Nitro Flyball 13G', compat: 'NMAX / AEROX', stock: 4, cost: 260, srp: 350 },
    { category: 'TRANSMISSION & DRIVETRAIN', name: 'Nitro Flyball 14G', compat: 'NMAX / AEROX', stock: 4, cost: 260, srp: 350 },
    { category: 'ELECTRICAL SYSTEM', name: 'LED Signal Light Set', compat: 'UNIVERSAL', stock: 3, cost: 180, srp: 0 },
  );
  const cats = [...new Set(rows.map(r => r.category))];
  const width = 14;
  const grid = [['', 'DEMO MOTORPARTS INVENTORY']];
  const put = (r, c, v) => { while (grid.length <= r) grid.push([]); grid[r][c] = v; };
  cats.forEach((cat, k) => {
    const c = k * width + 3; // item-name column; category sits two to the left
    put(1, c - 2, cat); put(1, c, 'DETAILS'); put(1, c + 4, 'COMPATIBILITY');
    put(1, c + 7, 'STOCK'); put(1, c + 8, 'TOTAL'); put(1, c + 9, 'UNIT PRICE'); put(1, c + 10, 'SRP PRICE');
    rows.filter(r => r.category.toUpperCase() === cat.toUpperCase()).forEach((r, i) => {
      put(2 + i, c - 2, r.stock > 0 ? 'AVAILABLE' : 'NO AVAILABLE');
      put(2 + i, c, r.name); put(2 + i, c + 4, r.compat); put(2 + i, c + 7, String(r.stock));
      put(2 + i, c + 8, (r.stock * r.cost).toLocaleString('en-US')); put(2 + i, c + 9, r.cost.toLocaleString('en-US'));
      put(2 + i, c + 10, r.srp ? r.srp.toLocaleString('en-US') : '');
    });
  });
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return grid.map(r => Array.from({ length: r.length }, (_, i) => cell(r[i])).join(',')).join('\r\n');
}

module.exports = { demoCatalog, seedDemoHistory, demoSheetCsv, createRng };
