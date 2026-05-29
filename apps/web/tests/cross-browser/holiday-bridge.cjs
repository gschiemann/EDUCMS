/**
 * Holiday template bridge test — cross-browser regression guard.
 *
 * Boots a real WebKit (= Safari engine) browser and exercises the
 * postMessage protocol every holiday template uses. Catches the class
 * of "works in Chrome, crashes in Safari" bugs that bit us on
 * 2026-05-09 (literal LF byte inside a regex literal in the inline
 * minified bridge — V8 tolerated it, WebKit threw).
 *
 * Run locally:
 *   cd apps/web && pnpm test:cross-browser
 *
 * Run in CI: see .github/workflows/cross-browser.yml — same script,
 * runs on every push + PR.
 *
 * Per template (18 templates, 4 in parallel):
 *   1. holiday:ready fires with non-empty field schema
 *   2. template-set-hotspots:enabled=true sets <html data-hotspots-on="1">,
 *      [data-field] elements get dotted outline + cursor:pointer
 *   3. Click [data-field] posts holiday:fieldClicked with correct key
 *   4. template-apply-styles applies inline color + fontSize on the field
 *   5. template-set-hotspots:enabled=false clears the attribute + outline
 *
 * Why we need this: the user's policy is "the app must always support
 * Mac and Windows browsers." Ad-hoc local Chrome testing missed Safari
 * fragility for months. This test is the canary.
 *
 * Adding more browsers: import { chromium, firefox } alongside webkit
 * and run testOne for each. Today it's WebKit-only because Safari is
 * the historical blind spot; the protocol passes trivially in Chromium.
 */
const { webkit } = require('@playwright/test');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const REPORT_DIR = __dirname;
// apps/web/tests/cross-browser → apps/web/public is up two levels.
const PUBLIC_DIR = resolve(__dirname, '../../public');
const PORT = 8765;
const BASE = `http://localhost:${PORT}`;

const TEMPLATES = [
  'es-christmas', 'es-easter', 'es-halloween', 'es-stpatricks', 'es-thanksgiving', 'es-valentines',
  'ms-christmas', 'ms-easter', 'ms-halloween', 'ms-stpatricks', 'ms-thanksgiving', 'ms-valentines',
  'hs-christmas', 'hs-easter', 'hs-halloween', 'hs-stpatricks', 'hs-thanksgiving', 'hs-valentines',
];

const results = [];
function pass(template, step, detail = '') { results.push({ template, step, ok: true, detail }); }
function fail(template, step, detail = '') { results.push({ template, step, ok: false, detail }); }

// Resolve once the server is actually accepting connections, or throw.
// A fixed `await delay(600)` raced the first page.goto into "Connection
// refused" on a loaded CI runner (flaky Cross-Browser red, 2026-05-28) —
// python's http.server can take well over 600ms to bind. Poll instead.
async function waitForServer(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      await new Promise((res, rej) => {
        const req = http.get(`http://localhost:${port}/`, (r) => { r.resume(); res(); });
        req.on('error', rej);
        req.setTimeout(1000, () => req.destroy(new Error('readiness probe timeout')));
      });
      return; // listening
    } catch (e) {
      lastErr = e;
      await delay(200);
    }
  }
  throw new Error(`local HTTP server on port ${port} did not become ready in ${timeoutMs}ms: ${lastErr && lastErr.message}`);
}

async function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', PUBLIC_DIR], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  await waitForServer(PORT);
  return proc;
}

async function testOne(browser, template) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  try {
    // Listener BEFORE navigation — captures holiday:ready when inline script
    // posts on DOMContentLoaded. window.parent === window when loaded as
    // top-level page, so the message lands back on this same window.
    await page.addInitScript(() => {
      const w = window;
      w.__msgs = [];
      window.addEventListener('message', (e) => {
        if (e.data && typeof e.data === 'object' && typeof e.data.type === 'string') {
          w.__msgs.push({ type: e.data.type, key: e.data.key, fields: e.data.fields });
        }
      });
    });

    await page.goto(`${BASE}/holiday-templates/${template}.html`, { waitUntil: 'load' });

    // Step 1 — holiday:ready
    await delay(150);
    const ready = await page.evaluate(() => window.__msgs.find((m) => m.type === 'holiday:ready'));
    if (!ready) { fail(template, 'holiday:ready', 'never received'); return; }
    if (!Array.isArray(ready.fields) || ready.fields.length === 0) {
      fail(template, 'holiday:ready', `empty fields array`); return;
    }
    pass(template, 'holiday:ready', `${ready.fields.length} fields`);

    // Step 2 — enable hotspots
    await page.evaluate(() => {
      window.postMessage({ type: 'template-set-hotspots', enabled: true }, window.location.origin);
    });
    await delay(80);
    const hotspotsOn = await page.evaluate(() => document.documentElement.getAttribute('data-hotspots-on'));
    if (hotspotsOn !== '1') {
      fail(template, 'hotspots-on', `attribute = ${JSON.stringify(hotspotsOn)}`); return;
    }
    const outlineProbe = await page.evaluate(() => {
      const el = document.querySelector('[data-field]');
      if (!el) return { found: false };
      const cs = getComputedStyle(el);
      return {
        found: true,
        fieldKey: el.getAttribute('data-field'),
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        cursor: cs.cursor,
      };
    });
    if (!outlineProbe.found) {
      fail(template, 'hotspot-outline', 'no [data-field] in DOM'); return;
    }
    if (outlineProbe.outlineStyle !== 'dotted' || outlineProbe.cursor !== 'pointer') {
      fail(template, 'hotspot-outline',
        `outlineStyle=${outlineProbe.outlineStyle}, cursor=${outlineProbe.cursor}`); return;
    }
    pass(template, 'hotspot-outline',
      `${outlineProbe.outlineStyle} ${outlineProbe.outlineWidth} on "${outlineProbe.fieldKey}"`);

    // Step 3 — click [data-field], expect holiday:fieldClicked
    await page.evaluate(() => { window.__msgs = []; });
    const firstFieldKey = outlineProbe.fieldKey;
    await page.click(`[data-field="${firstFieldKey}"]`, { force: true });
    await delay(80);
    const clickMsg = await page.evaluate(() => window.__msgs.find((m) => m.type === 'holiday:fieldClicked'));
    if (!clickMsg) {
      fail(template, 'holiday:fieldClicked', 'no message after click'); return;
    }
    if (clickMsg.key !== firstFieldKey) {
      fail(template, 'holiday:fieldClicked', `got "${clickMsg.key}" expected "${firstFieldKey}"`); return;
    }
    pass(template, 'holiday:fieldClicked', `key="${clickMsg.key}"`);

    // Step 4 — template-apply-styles
    await page.evaluate((field) => {
      window.postMessage({
        type: 'template-apply-styles',
        styles: { [field]: { color: '#ff0000', fontSize: 99 } },
      }, window.location.origin);
    }, firstFieldKey);
    await delay(80);
    const afterStyles = await page.evaluate((field) => {
      const sel = `[data-field="${field.replace(/"/g, '\\"')}"]`;
      const el = document.querySelector(sel);
      if (!el) return null;
      return { inlineColor: el.style.color, inlineFontSize: el.style.fontSize };
    }, firstFieldKey);
    if (!afterStyles) {
      fail(template, 'template-apply-styles', 'field disappeared'); return;
    }
    if (afterStyles.inlineFontSize !== '99px') {
      fail(template, 'template-apply-styles',
        `fontSize=${afterStyles.inlineFontSize} (expected 99px)`); return;
    }
    if (!/255|ff0000|red/i.test(afterStyles.inlineColor)) {
      fail(template, 'template-apply-styles',
        `color=${afterStyles.inlineColor} (expected red)`); return;
    }
    pass(template, 'template-apply-styles',
      `color=${afterStyles.inlineColor}, fontSize=${afterStyles.inlineFontSize}`);

    // Step 5 — disable hotspots
    await page.evaluate(() => {
      window.postMessage({ type: 'template-set-hotspots', enabled: false }, window.location.origin);
    });
    await delay(80);
    const hotspotsOff = await page.evaluate(() => {
      const attr = document.documentElement.getAttribute('data-hotspots-on');
      const el = document.querySelector('[data-field]');
      const cs = el ? getComputedStyle(el) : null;
      return { attr, outlineStyle: cs?.outlineStyle };
    });
    if (hotspotsOff.attr !== null) {
      fail(template, 'hotspots-off', `attribute still set: ${hotspotsOff.attr}`); return;
    }
    if (hotspotsOff.outlineStyle === 'dotted') {
      fail(template, 'hotspots-off', `outline still ${hotspotsOff.outlineStyle}`); return;
    }
    pass(template, 'hotspots-off', `outline=${hotspotsOff.outlineStyle}`);

    if (pageErrors.length > 0) {
      fail(template, 'page-errors', pageErrors.slice(0, 2).join(' | '));
    }
  } finally {
    await ctx.close();
  }
}

(async () => {
  console.log('Starting local HTTP server on port', PORT);
  const server = await startServer();
  try {
    console.log('Launching WebKit (Safari engine)...');
    const browser = await webkit.launch();
    try {
      console.log(`Running ${TEMPLATES.length} templates in 4-way parallel batches...`);
      for (let i = 0; i < TEMPLATES.length; i += 4) {
        const batch = TEMPLATES.slice(i, i + 4);
        await Promise.all(batch.map((t) => testOne(browser, t)));
        process.stdout.write('.');
      }
      console.log('');
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }

  const byTemplate = {};
  for (const r of results) {
    if (!byTemplate[r.template]) byTemplate[r.template] = [];
    byTemplate[r.template].push(r);
  }
  let passCount = 0;
  let failCount = 0;
  console.log('\n=== RESULTS ===');
  for (const t of TEMPLATES) {
    const tr = byTemplate[t] || [];
    const tpass = tr.filter((r) => r.ok).length;
    const tfail = tr.filter((r) => !r.ok).length;
    passCount += tpass;
    failCount += tfail;
    const status = tfail === 0 ? '✓' : '✗';
    console.log(`${status} ${t}: ${tpass} pass, ${tfail} fail`);
    for (const r of tr.filter((x) => !x.ok)) {
      console.log(`    ✗ ${r.step}: ${r.detail}`);
    }
  }
  console.log(`\nTOTAL: ${passCount} pass, ${failCount} fail`);

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(resolve(REPORT_DIR, 'report.json'), JSON.stringify(results, null, 2));
  console.log(`Wrote ${REPORT_DIR}/report.json`);

  process.exit(failCount > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
