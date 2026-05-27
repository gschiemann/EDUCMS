/**
 * Live test against the deployed VenueOS ribbon page.
 *
 * Steps:
 *   1. Open Chromium ultrawide (3000×400)
 *   2. Navigate to https://educms-five.vercel.app/ribbon/<gameId>
 *   3. Capture initial screenshot (sponsor / slide rendering)
 *   4. Capture console logs
 *   5. Get the operator's admin JWT from a known auth flow OR fire a cue
 *      via dispatching the preview event directly inside the page
 *      (the orchestrator listens for it; legacy ribbon doesn't —
 *      so for legacy we instead inject a fake `cues` entry into the
 *      next /sports/board poll by mocking the fetch — or simpler, we
 *      hit the admin /sports/games/:id/cue endpoint with a Bearer token)
 *   6. Wait 2s for the next poll
 *   7. Capture the cinematic-rendering screenshot
 *   8. Save to /tmp + print the URLs
 *
 * No assumptions about what works — every step prints what it actually
 * saw.
 */

import { chromium } from '/Users/gschiemann/Desktop/EDU CMS/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs';
import fs from 'fs';

const URL_BASE = 'https://educms-five.vercel.app';
const GAME_ID  = '0771435a-c16f-4169-b59f-4e9faf75855c';
const RIBBON   = `${URL_BASE}/ribbon/${GAME_ID}`;

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = (name) => `/tmp/ribbon-test-${stamp}-${name}`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 3000, height: 400 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

const consoleLines = [];
page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

const requests = [];
page.on('response', async (res) => {
  const u = res.url();
  if (u.includes('/sports/board/') && !u.includes('cts-cue-fired')) {
    let payload = null;
    try { payload = await res.json(); } catch {}
    requests.push({
      url: u,
      status: res.status(),
      payload: payload
        ? {
            sport: payload.sport,
            cuesCount: (payload.cues || []).length,
            cueKeys: (payload.cues || []).map((c) => c.key),
            ribbonSlides: payload.ribbonSlides,
            ribbonPresets: payload.ribbonPresets,
            ribbonTemplateId: payload.ribbonTemplateId,
          }
        : null,
    });
  }
});

console.log('\n[1/6] Navigating to', RIBBON);
await page.goto(RIBBON, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2500); // settle

console.log('[2/6] Initial screenshot (sponsor + slide rendering at idle)');
await page.screenshot({ path: out('1-idle.png'), fullPage: false });
console.log('       saved →', out('1-idle.png'));

console.log('\n[3/6] Inspecting page state inline...');
const inspection = await page.evaluate(() => {
  const out = {};
  // Find any img elements + report their natural vs rendered size
  const imgs = Array.from(document.querySelectorAll('img'));
  out.imgCount = imgs.length;
  out.images = imgs.slice(0, 6).map((img) => ({
    src: (img.src || '').slice(0, 100),
    natural: `${img.naturalWidth}x${img.naturalHeight}`,
    rendered: `${Math.round(img.getBoundingClientRect().width)}x${Math.round(img.getBoundingClientRect().height)}`,
    objectFit: getComputedStyle(img).objectFit,
    cssWidth: getComputedStyle(img).width,
    cssHeight: getComputedStyle(img).height,
  }));
  // Find any canvas elements (cinematic celebrations render to <canvas>)
  const canvases = Array.from(document.querySelectorAll('canvas'));
  out.canvasCount = canvases.length;
  out.canvases = canvases.map((c) => ({
    natural: `${c.width}x${c.height}`,
    rendered: `${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`,
  }));
  // Body innerHTML size (sanity check the page actually rendered something)
  out.bodyHtmlLen = document.body.innerHTML.length;
  // Look for the ribbon-cue overlay container (z-index 60 per our code)
  const overlays = Array.from(document.querySelectorAll('div[style*="z-index: 60"], div[style*="zIndex: 60"]'));
  out.overlayCount = overlays.length;
  return out;
});
console.log(JSON.stringify(inspection, null, 2));

console.log('\n[4/6] Captured board polls so far:');
for (const r of requests) {
  console.log(' ', r.status, r.url.split('?')[0]);
  if (r.payload) console.log('     ', JSON.stringify(r.payload));
}

console.log('\n[5/6] Dispatching window event to simulate a celebration cue arrival');
// Inject a synthetic cue into the legacy ribbon's cueQueue by faking
// the next board poll. Easiest: hook fetch to inject one fresh cue,
// then wait for the poll cycle.
await page.evaluate(() => {
  const realFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await realFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0].url;
    if (url && url.includes('/sports/board/') && !url.includes('cts-cue-fired')) {
      const json = await res.clone().json().catch(() => null);
      if (json && Array.isArray(json.cues)) {
        const fakeId = 'fake-cue-' + Date.now();
        json.cues.push({
          id: fakeId,
          key: 'goal',
          target: 'ALL',
          team: null,
          color: '#21e6ff',
          snapshot: {
            homeTeam: json.homeTeam || 'BRUINS',
            awayTeam: json.awayTeam || 'BUCKEYES',
            homeScore: json.homeScore ?? 1,
            awayScore: json.awayScore ?? 1,
            segmentLabel: 'Q2',
          },
        });
        return new Response(JSON.stringify(json), {
          status: res.status,
          headers: res.headers,
        });
      }
    }
    return res;
  };
  // Force the next poll cycle by triggering an immediate manual fetch.
  // (Legacy ribbon page polls every 750ms via its useEffect already.)
});

await page.waitForTimeout(2500); // give 2-3 poll cycles to land + render

console.log('\n[6/6] Capturing screenshot DURING cue render');
await page.screenshot({ path: out('2-during-cue.png'), fullPage: false });
console.log('       saved →', out('2-during-cue.png'));

const cueInspection = await page.evaluate(() => {
  const out = {};
  const canvases = Array.from(document.querySelectorAll('canvas'));
  out.canvasCount = canvases.length;
  out.canvases = canvases.map((c) => ({
    natural: `${c.width}x${c.height}`,
    rendered: `${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`,
  }));
  const overlays = Array.from(document.querySelectorAll('div[style*="z-index: 60"], div[style*="zIndex: 60"]'));
  out.overlayCount = overlays.length;
  out.overlayHtmlSample = overlays[0]?.outerHTML.slice(0, 500);
  return out;
});
console.log(JSON.stringify(cueInspection, null, 2));

console.log('\n=== Console / page errors captured during test ===');
console.log(consoleLines.slice(0, 40).join('\n') || '(none)');

await browser.close();
console.log('\nDone. Screenshots saved to /tmp/ribbon-test-' + stamp + '-{1-idle,2-during-cue}.png');
