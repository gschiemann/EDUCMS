/**
 * Kiosk edit-shim — entity-decode + XSS-safety regression guard.
 *
 * Bug (2026-06-04, found while rebranding a Touch Kiosk to Domino's in the
 * live builder): a text override typed "Mix & Match" rendered on the kiosk as
 * the literal "Mix &amp; Match". The global server sanitizer
 * (apps/api/src/security/sanitization.pipe.ts) HTML-encodes every request-body
 * string for XSS defense — correct for innerHTML sinks — but the kiosk applies
 * overrides via el.textContent (which never parses HTML, already XSS-safe), so
 * the encoding double-applied and corrupted the DISPLAY.
 *
 * Fix: _edit-shim.js applyText() now decodeEntities() the value before the
 * textContent assignment, using a DETACHED <textarea> (RCDATA-parses entities,
 * NEVER creates elements/runs scripts), then assigns via textContent (also no
 * HTML parse). This test locks BOTH halves: the operator sees exactly what they
 * typed, AND a malicious encoded payload stays inert.
 *
 * Runs in WebKit (Safari engine — the historical "works in Chrome, breaks in
 * Safari" blind spot) AND Chromium. Run locally:  cd apps/web && pnpm test:kiosk-shim
 */
const { webkit, chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { resolve } = require('node:path');

const PUBLIC_DIR = resolve(__dirname, '../../public');
const PORT = 8771;
const BASE = `http://localhost:${PORT}`;

let passN = 0;
let failN = 0;
const pass = (b, name, info) => { passN++; console.log(`  ✓ [${b}] ${name}${info ? ' — ' + info : ''}`); };
const fail = (b, name, info) => { failN++; console.log(`  ✗ [${b}] ${name}${info ? ' — ' + info : ''}`); };

const enc = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function waitForServer(port, timeoutMs = 10000) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((res, rej) => {
        const req = http.get(`http://localhost:${port}/templates/kiosk/food.html`, (r) => { r.resume(); res(); });
        req.on('error', rej);
        req.setTimeout(500, () => req.destroy(new Error('timeout')));
      });
      return;
    } catch (e) { lastErr = e; await delay(200); }
  }
  throw new Error(`http server on ${port} not ready in ${timeoutMs}ms: ${lastErr && lastErr.message}`);
}

async function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', PUBLIC_DIR], { stdio: ['ignore', 'ignore', 'ignore'] });
  await waitForServer(PORT);
  return proc;
}

// Exactly what the server's sanitization.pipe persists (HTML-encoded input).
const TEXT = {
  'brand.restaurant': 'Mix &amp; Match — A &lt; B',                                  // → "Mix & Match — A < B"
  'item.harvest.name': '&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt; Pepperoni',  // encoded XSS payload
};

async function testOne(browserType, name) {
  const browser = await browserType.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await page.goto(`${BASE}/templates/kiosk/food.html?text=${enc(TEXT)}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.Kiosk, null, { timeout: 6000 });
    await page.evaluate(() => window.Kiosk.go('menu'));
    await delay(400);
    const r = await page.evaluate(() => ({
      bodyText: document.body.innerText,
      xss: !!window.__xss,
      rogueImg: !!document.querySelector('.screen img[onerror], .stage img[onerror], #kiosk img[onerror]'),
    }));
    if (r.bodyText.includes('Mix & Match — A < B') && !r.bodyText.includes('&amp;')) pass(name, 'decode &/<', 'literal "Mix & Match — A < B"');
    else fail(name, 'decode &/<', 'got: ' + ((r.bodyText.match(/Mix[^\n]*/) || [''])[0]));
    if (r.bodyText.includes('<img src=x onerror=')) pass(name, 'payload kept literal');
    else fail(name, 'payload kept literal', 'XSS string not present as text');
    if (!r.xss) pass(name, 'no XSS execution'); else fail(name, 'no XSS execution', 'window.__xss was set!');
    if (!r.rogueImg) pass(name, 'no rogue <img onerror>'); else fail(name, 'no rogue <img onerror>', 'element created!');
    if (pageErrors.length === 0) pass(name, '0 page errors'); else fail(name, 'page errors', pageErrors.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
  }
}

(async () => {
  const server = await startServer();
  try {
    console.log('Kiosk edit-shim — entity-decode + XSS-safety:');
    await testOne(webkit, 'webkit');
    await testOne(chromium, 'chromium');
  } finally {
    server.kill();
  }
  console.log(`\n${failN === 0 ? '✅' : '❌'} kiosk-shim: ${passN} passed, ${failN} failed`);
  process.exit(failN === 0 ? 0 : 1);
})();
