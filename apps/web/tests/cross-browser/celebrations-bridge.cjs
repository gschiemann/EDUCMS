/**
 * Sports celebration-pack WebKit canary — cross-browser regression guard.
 *
 * Sibling to holiday-bridge.cjs. Where holiday-bridge exercises the
 * iframe postMessage protocol the 18 holiday templates use, this script
 * guards the `public/celebrations/*.html` sports cue pack — the
 * touchdown / three-pointer / home-run / goal / kill / etc. animations
 * the Sprint 13 CueDeck fires onto the video board.
 *
 * These files are NOT postMessage bridges. They are self-contained
 * <canvas> animations: an inline IIFE parses team color from the query
 * string, then drives requestAnimationFrame to paint pixels. So the
 * protocol assertions differ from holiday-bridge — what we guard here is
 * the *exact class of bug* that bit us on 2026-05-09:
 *
 *   A literal LF byte inside a regex literal in inline minified JS. V8
 *   (Chrome) tolerated it; WebKit (Safari) threw `SyntaxError:
 *   Unterminated regular expression literal` and killed the ENTIRE
 *   inline script. On a celebration page that means the canvas stays
 *   blank black — no animation, no team color, dead on Friday night —
 *   and we wouldn't notice in Chrome-only local dev.
 *
 * Per celebration HTML:
 *   1. Page loads with ZERO uncaught pageerrors (the SyntaxError class).
 *   2. The `#c` canvas exists at its declared 1920×1080 backing size.
 *   3. The animation actually PAINTED — we load with `?pause=1200` so
 *      the IIFE freezes mid-animation at a deterministic frame, then
 *      sample the canvas and assert it is not uniformly blank/black.
 *      A dead inline script (the 2026-05-09 failure) leaves the canvas
 *      either absent or all-black; a healthy one has drawn the field,
 *      the ball, particles, the flash.
 *   4. Team-color override (`?team=ff2d55`) is accepted without error —
 *      proves the query-string parse + hexToRgb path (a string-heavy
 *      code path, the kind minifiers mangle) runs in WebKit.
 *
 * Run locally:
 *   cd apps/web && pnpm test:celebrations
 *
 * Run in CI: see .github/workflows/cross-browser.yml — same job class
 * as the holiday-bridge canary, runs on every push + PR.
 *
 * WebKit-only for the same reason as holiday-bridge: Safari is the
 * historical blind spot; the canvas animation paints trivially in
 * Chromium. Add chromium/firefox passes here only if a NEW engine-
 * specific celebration bug surfaces (don't add speculatively — keep CI
 * fast, under 2 min/browser per CLAUDE.md cross-browser rule #4).
 */
const { webkit } = require('@playwright/test');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { mkdirSync, writeFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');

const REPORT_DIR = __dirname;
// apps/web/tests/cross-browser → apps/web/public is up two levels.
const PUBLIC_DIR = resolve(__dirname, '../../public');
const CELEBRATIONS_DIR = resolve(PUBLIC_DIR, 'celebrations');
const PORT = 8766; // distinct from holiday-bridge's 8765 so both can run
const BASE = `http://localhost:${PORT}`;

// Discover celebration animation pages dynamically so a new cue HTML is
// auto-covered the moment it lands. We only test the canvas-animation
// pages, NOT the gallery nav pages (index.html = link list,
// deck.html = multi-scene launcher that switches scenes on a timer and
// has its own UI chrome). Every animation file paints into a #c canvas
// and accepts ?pause / ?team; the two nav files do not.
const NAV_PAGES = new Set(['index.html', 'deck.html']);
const TEMPLATES = readdirSync(CELEBRATIONS_DIR)
  .filter((f) => f.endsWith('.html') && !NAV_PAGES.has(f))
  .map((f) => f.replace(/\.html$/, ''))
  .sort();

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
    // Load WITHOUT ?pause so the animation runs through its full
    // timeline. Each cue peaks at a different moment (impact 1280–1520ms,
    // hold 3300–3400ms), so a single frozen frame is timeline-sensitive
    // and would false-positive on a cue still in its dark pre-impact
    // phase. Instead we sample peak luminance across a window below.
    // ?team exercises the query-string color-parse path (string-heavy
    // code a minifier is most likely to mangle into a WebKit SyntaxError).
    await page.goto(`${BASE}/celebrations/${template}.html?team=ff2d55`, {
      waitUntil: 'load',
    });

    // Step 1 — zero uncaught errors. THE canary assertion. A regex /
    // minified-JS SyntaxError that WebKit rejects but V8 tolerates shows
    // up here as a pageerror and as a blank canvas (step 3).
    await delay(250); // let the IIFE bind handlers + start the rAF loop
    if (pageErrors.length > 0) {
      fail(template, 'no-page-errors', pageErrors.slice(0, 2).join(' | '));
      return; // a dead script makes every later assertion meaningless
    }
    pass(template, 'no-page-errors', 'clean parse + run');

    // Step 2 — the canvas exists at its declared backing resolution.
    const canvas = await page.evaluate(() => {
      const el = document.getElementById('c');
      if (!el || el.tagName !== 'CANVAS') return null;
      return { w: el.width, h: el.height, clientW: el.clientWidth, clientH: el.clientHeight };
    });
    if (!canvas) {
      fail(template, 'canvas-present', 'no #c canvas in DOM');
      return;
    }
    if (canvas.w < 100 || canvas.h < 100) {
      fail(template, 'canvas-present', `backing size ${canvas.w}×${canvas.h} (expected ≥100²)`);
      return;
    }
    if (canvas.clientW < 1 || canvas.clientH < 1) {
      // Laid-out size 0 = CSS collapse (e.g. the Chromium-83 absolute-
      // positioning shorthand trap from CLAUDE.md rule #10 would manifest
      // here on a collapsed #stage). Distinct from backing-store size.
      fail(template, 'canvas-present', `laid-out size ${canvas.clientW}×${canvas.clientH} (collapsed)`);
      return;
    }
    pass(template, 'canvas-present', `${canvas.w}×${canvas.h} backing, ${canvas.clientW}×${canvas.clientH} laid out`);

    // Step 3 — the animation actually PAINTED. A dead inline script (the
    // 2026-05-09 failure) never draws anything: the canvas stays at its
    // near-black clear color (#04060b, luminance ~6) for the whole run.
    // A healthy animation lights up a big chunk of the frame at some
    // point in its timeline (the field/ice, the ball, the celebration
    // flash + particles). Because each cue peaks at a different ms, we
    // sample an 8×8 luminance grid repeatedly across a ~2s window and
    // keep the PEAK lit-sample count — timeline-agnostic, so a cue that's
    // dark at one instant but bright at impact still passes.
    const sampleLuma = () =>
      page.evaluate(() => {
        const el = document.getElementById('c');
        const ctx2d = el && el.getContext('2d');
        if (!ctx2d) return { ok: false, maxLum: 0, litSamples: 0, total: 64 };
        const W = el.width, H = el.height;
        let maxLum = 0;
        let litSamples = 0;
        for (let gy = 0; gy < 8; gy++) {
          for (let gx = 0; gx < 8; gx++) {
            const x = Math.floor(((gx + 0.5) / 8) * W);
            const y = Math.floor(((gy + 0.5) / 8) * H);
            const d = ctx2d.getImageData(x, y, 1, 1).data;
            const lum = 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2];
            if (lum > maxLum) maxLum = lum;
            if (lum > 30) litSamples += 1; // clearly above the ~6 bg
          }
        }
        return { ok: true, maxLum, litSamples, total: 64 };
      });

    let peakLum = 0;
    let peakLit = 0;
    let had2d = false;
    // ~10 samples over ~2.0s covers impact (1.28–1.52s) AND the start of
    // hold (3.3s) for every cue in the pack.
    for (let s = 0; s < 10; s++) {
      const snap = await sampleLuma();
      if (snap.ok) had2d = true;
      if (snap.maxLum > peakLum) peakLum = snap.maxLum;
      if (snap.litSamples > peakLit) peakLit = snap.litSamples;
      // Early-out once we've clearly seen a bright, well-lit frame.
      if (peakLum >= 60 && peakLit >= 6) break;
      await delay(200);
    }
    if (!had2d) {
      fail(template, 'canvas-painted', 'no 2d context on #c canvas');
      return;
    }
    // Require BOTH a bright peak AND several lit samples at the peak so a
    // single stray pixel can't pass it. A dead script never clears ~6.
    if (peakLum < 50 || peakLit < 4) {
      fail(template, 'canvas-painted',
        `never painted: peakLum=${peakLum.toFixed(0)}, peakLit=${peakLit}/64 over 2s — inline script likely died`);
      return;
    }
    pass(template, 'canvas-painted', `peakLum=${peakLum.toFixed(0)}, peakLit=${peakLit}/64`);

    // Step 4 — team-color override accepted. We already loaded with
    // ?team=ff2d55; if the query-string parse / hexToRgb path threw, it
    // would have surfaced as a pageerror in step 1. This step records
    // that the color-parse path was exercised (the string-heavy code a
    // minifier is most likely to mangle into a WebKit SyntaxError).
    pass(template, 'team-color-parse', 'accepted ?team=ff2d55 without error');
  } finally {
    await ctx.close();
  }
}

(async () => {
  if (TEMPLATES.length === 0) {
    console.error(`No celebration HTML files found in ${CELEBRATIONS_DIR}`);
    process.exit(1);
  }
  console.log('Starting local HTTP server on port', PORT);
  const server = await startServer();
  try {
    console.log('Launching WebKit (Safari engine)...');
    const browser = await webkit.launch();
    try {
      console.log(`Running ${TEMPLATES.length} celebration pages in 4-way parallel batches...`);
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
  console.log('\n=== CELEBRATION RESULTS ===');
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
  console.log(`\nTOTAL: ${passCount} pass, ${failCount} fail (${TEMPLATES.length} celebration pages)`);

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(resolve(REPORT_DIR, 'celebrations-report.json'), JSON.stringify(results, null, 2));
  console.log(`Wrote ${REPORT_DIR}/celebrations-report.json`);

  process.exit(failCount > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
