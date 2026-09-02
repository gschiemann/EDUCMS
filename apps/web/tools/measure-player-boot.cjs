#!/usr/bin/env node
/*
 * Player boot-cost harness (P0-3, 2026-09-02).
 *
 * Answers the only question that matters for a low-memory OEM Android
 * panel: HOW MUCH JAVASCRIPT does /player download and parse before it can
 * register/pair? Registration is the one thing a fresh device needs first;
 * everything the renderer graph drags in ahead of it is boot-time poison.
 *
 * Usage (against a PRODUCTION build, never `next dev`):
 *   pnpm --filter web build
 *   (cd apps/web && npx next start -p 3110)
 *   node apps/web/tools/measure-player-boot.cjs [label] [port]
 *
 * It stubs /api/v1/** so the harness needs no API server, and reports:
 *   - first-contentful-paint
 *   - the timestamp of the first POST /screens/register
 *   - JS chunk count + bytes fetched BEFORE that register fired
 *   - JS chunk count + bytes for the whole boot
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'));

const LABEL = process.argv[2] || 'run';
const PORT = process.argv[3] || '3110';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const reqs = [];
  const t0 = Date.now();
  let registerAt = null;

  page.on('response', async (res) => {
    const u = res.url();
    if (u.indexOf('/_next/static/') === -1) return;
    let len = 0;
    try {
      const b = await res.body();
      len = b.length;
    } catch (e) {
      /* body already consumed / aborted */
    }
    reqs.push({
      url: u.replace(/^https?:\/\/[^/]+/, ''),
      bytes: len,
      t: Date.now() - t0,
      js: /\.js(\?|$)/.test(u),
    });
  });

  page.on('request', (r) => {
    if (registerAt === null && r.url().indexOf('/api/v1/screens/register') !== -1) {
      registerAt = Date.now() - t0;
    }
  });

  await page.route('**/api/v1/**', async (route) => {
    const u = route.request().url();
    if (u.indexOf('/screens/register') !== -1) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ screenId: 'scr_measure', paired: false, pairingCode: 'ABC123' }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`http://127.0.0.1:${PORT}/player`, { waitUntil: 'load' });
  const fcp = await page.evaluate(() => {
    const e = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint');
    return e ? Math.round(e.startTime) : null;
  });
  await page.waitForTimeout(6000);

  const js = reqs.filter((r) => r.js);
  const beforeReg = registerAt === null ? js : js.filter((r) => r.t <= registerAt);
  const sum = (a) => a.reduce((s, r) => s + r.bytes, 0);

  console.log(
    JSON.stringify(
      {
        label: LABEL,
        fcpMs: fcp,
        registerAtMs: registerAt,
        totalJsChunks: js.length,
        totalJsBytes: sum(js),
        jsChunksBeforeRegister: beforeReg.length,
        jsBytesBeforeRegister: sum(beforeReg),
      },
      null,
      2,
    ),
  );
  console.log('--- chunks (bytes, tMs, name) ---');
  for (const r of js.slice().sort((a, b) => b.bytes - a.bytes)) {
    console.log(`${r.bytes}\t${r.t}\t${r.url.split('/').pop()}`);
  }
  await browser.close();
})();
