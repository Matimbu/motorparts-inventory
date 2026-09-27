#!/usr/bin/env node
// Renders the app icons (public/icons/*.svg) to the PNG sizes phones need to install the app.
//   node scripts/make-icons.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { launch, sleep } = require('./browser.js');

const DIR = path.join(__dirname, '..', 'public', 'icons');
const JOBS = [['icon.svg', 'icon-192.png', 192], ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512], ['icon.svg', 'apple-touch-icon.png', 180]];

(async () => {
  const b = await launch();
  await b.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const [src, out, size] of JOBS) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    const svg = fs.readFileSync(path.join(DIR, src), 'utf8');
    const html = `<html><body style="margin:0"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}"></body></html>`;
    const loaded = b.once('Page.loadEventFired');
    await b.send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
    await loaded; await sleep(150);
    const { data } = await b.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(DIR, out), Buffer.from(data, 'base64'));
    console.log(`  ${out} (${size}x${size})`);
  }
  b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
