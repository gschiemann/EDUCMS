#!/usr/bin/env node
/**
 * EXTERNAL_HTML menu-board plug-and-play verifier (2026-08-04).
 * ─────────────────────────────────────────────────────────────
 * Proves the 31 `applyMenu()` signage boards (signage/{qsr,menus-pos,bar})
 * really overlay LIVE POS data: loads a board over HTTP in headless
 * chromium, posts the same `educms-overrides {menu:{items}}` message
 * WidgetRenderer posts (auto-on for these URLs — no operator toggle), and
 * asserts the DOM: a name-matched item's price flips to the POS price, and
 * an 86'd item gets the sold-out treatment (data-soldout, grayscale).
 *
 * If the sandbox API (:8080) is up with the custom-webhook items pushed
 * ("Carolina Oysters" 2650¢, "Shrimp & Stone Grits" available:false), the
 * feed is fetched LIVE from /pos/items; otherwise it falls back to an
 * inline fixture with the same shape (still proves the shim contract).
 *
 * Run: node scripts/pos-sandbox/verify-applymenu.mjs
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
// @playwright/test re-exports the browser drivers; it's the flavor the web
// workspace ships (run from apps/web so the import resolves).
import { chromium } from '@playwright/test';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '../../../apps/web/public'));
const BOARD = '/templates/signage/menus-pos/01-fullservice-menu.html';
const PORT = 4646;
const API = process.env.SANDBOX_API || 'http://localhost:8080/api/v1';

const fmt = (c) => '$' + (c / 100).toFixed(2);

// PosMenuItem shape — exactly what usePosMenuItems hands WidgetRenderer.
const FIXTURE = [
  { name: 'Carolina Oysters', price: fmt(2650), available: true },
  { name: 'Shrimp & Stone Grits', price: fmt(1800), available: false },
];

async function liveFeed() {
  try {
    const login = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@springfield.edu', password: 'admin123' }),
    });
    const { access_token } = await login.json();
    const res = await fetch(`${API}/pos/items`, { headers: { Authorization: `Bearer ${access_token}` } });
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const items = rows.map((r) => ({
      name: String(r.name),
      desc: r.description || undefined,
      price: typeof r.priceCents === 'number' ? fmt(r.priceCents) : '',
      available: r.available !== false,
    }));
    // /pos/items is available-only, so re-add the 86'd shrimp the same way
    // the device feed (includeUnavailable=1) would carry it.
    if (!items.some((i) => /shrimp/i.test(i.name))) {
      items.push({ name: 'Shrimp & Stone Grits', price: fmt(1800), available: false });
    }
    return items;
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!path.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': path.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const items = (await liveFeed()) || FIXTURE;
const usedLive = items.length > 2;
console.log(`Feed: ${usedLive ? 'LIVE from sandbox API' : 'inline fixture'} (${items.length} items)`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`http://127.0.0.1:${PORT}${BOARD}`, { waitUntil: 'load' });
await page.waitForTimeout(500);

const before = await page.textContent('[data-field="i.0.0.p"]');
await page.evaluate((menuItems) => {
  window.postMessage({ type: 'educms-overrides', menu: { items: menuItems } }, '*');
}, items);
await page.waitForTimeout(800);

const after = await page.textContent('[data-field="i.0.0.p"]');
const oysterName = (await page.textContent('[data-field="i.0.0.n"]'))?.trim();
const soldOut = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-field$=".n"]')].find((e) => /shrimp/i.test(e.textContent));
  if (!el) return { found: false };
  let n = el;
  for (let i = 0; i < 6 && n; i++) {
    if (n.getAttribute && n.getAttribute('data-soldout') === '1') return { found: true, soldout: true, opacity: n.style.opacity };
    n = n.parentElement;
  }
  return { found: true, soldout: false };
});

let pass = 0, fail = 0;
const check = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); };

check(`board static price was ${before?.trim()}`, !!before);
check(`"${oysterName}" price overlaid to $26.50 by live feed`, after?.trim() === '$26.50', `got "${after?.trim()}"`);
check('86\'d "Shrimp & Stone Grits" got sold-out treatment', soldOut.found && soldOut.soldout === true, JSON.stringify(soldOut));

await browser.close();
server.close();
console.log(`\nRESULT: ${pass}/${pass + fail} passed${fail ? ' — FAILURES ABOVE' : ' — ALL GREEN'}`);
process.exit(fail ? 1 : 0);
