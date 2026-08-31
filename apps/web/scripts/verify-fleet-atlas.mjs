/**
 * verify-fleet-atlas — screenshot the HQ dashboard against its approved mocks.
 *
 * The Network Atlas is a design contract (scratch/design/multi-location-
 * dashboard/network-atlas-v1.png) and CI cannot grade a design. This is the
 * repeatable way to put the real render next to the mock.
 *
 *   0. install the harness route (it lives OUTSIDE src/app because a
 *      compiled-in route costs real production bundle bytes — the bundle
 *      ratchet caught exactly that on 2026-08-31; the installed copy is
 *      .gitignored so it can never be committed):
 *        node apps/web/scripts/verify-fleet-atlas.mjs --install
 *   1. build with the harness on:
 *        NEXT_PUBLIC_ENABLE_DEV_HARNESS=1 pnpm --filter web build
 *   2. serve the PRODUCTION build (never `next dev` — the dev server drops
 *      responsive CSS variants, which is how a layout ships looking right
 *      only on the author's machine):
 *        cd apps/web && pnpm exec next start -p 3111
 *   3. node apps/web/scripts/verify-fleet-atlas.mjs
 *   4. remove the route again (and rebuild before shipping anything):
 *        node apps/web/scripts/verify-fleet-atlas.mjs --remove
 *
 * Writes rebuild3-{list,atlas,drawer}.png into scratch/design/verify/ and
 * prints the DOM facts worth asserting (pin count, donut arcs, panel widths).
 * The staged data lives in apps/web/src/app/dev/fleet-mock/page.tsx.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── --install / --remove: copy the harness page into (out of) src/app ──
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_SRC = path.join(HERE, 'harness', 'fleet-mock.page.tsx');
const ROUTE_DIR = path.join(HERE, '..', 'src', 'app', 'dev', 'fleet-mock');
const ROUTE_PAGE = path.join(ROUTE_DIR, 'page.tsx');
const mode = process.argv[2];
if (mode === '--install') {
  fs.mkdirSync(ROUTE_DIR, { recursive: true });
  fs.copyFileSync(HARNESS_SRC, ROUTE_PAGE);
  console.log(`installed ${ROUTE_PAGE} — now build with NEXT_PUBLIC_ENABLE_DEV_HARNESS=1`);
  process.exit(0);
}
if (mode === '--remove') {
  fs.rmSync(ROUTE_DIR, { recursive: true, force: true });
  console.log('harness route removed — rebuild before shipping.');
  process.exit(0);
}
if (!fs.existsSync(ROUTE_PAGE)) {
  console.error('Harness route not installed — run with --install first (see header).');
  process.exit(1);
}

const OUT = '/Users/gschiemann/Desktop/EDU CMS/scratch/design/verify';
fs.mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:3111/dev/fleet-mock';

const browser = await chromium.launch();
// 1440 wide (the operator's screenshot width). Tall enough that the whole
// Atlas section — header, stat cards, hero map — lands in one frame, which is
// how the mock is framed.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1160 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500);

// ─── 2) LIST MODE (default) ────────────────────────────────────────
await page.screenshot({ path: `${OUT}/rebuild3-list.png`, fullPage: true });
console.log('shot list');

// ─── 1) ATLAS MODE ─────────────────────────────────────────────────
await page.getByRole('tab', { name: 'map' }).click();
await page.waitForTimeout(3500); // tiles

console.log('pins rendered:', await page.locator('.venueos-locpin').count());
console.log('donut arcs:', await page.locator('.venueos-locpin svg circle').count());
console.log('name chips:', await page.locator('.venueos-locpin-chip').count());

// Select the location that has a real exception (inbox row click).
await page.getByRole('group', { name: 'Exception inbox' }).locator('button[aria-pressed]').first().click();
await page.waitForTimeout(1800);

// Frame the atlas: put the section heading at the very top of the viewport.
await page.evaluate(() => {
  const h = [...document.querySelectorAll('h3')].find((e) => e.textContent === 'Network Atlas');
  window.scrollBy(0, h.getBoundingClientRect().top - 16);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/rebuild3-atlas.png` });
console.log('shot atlas');

// ─── 3) DEVICE DRAWER ──────────────────────────────────────────────
await page.getByRole('button', { name: /Open screen/ }).first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/rebuild3-drawer.png` });
console.log('shot drawer');

const facts = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const r = (el) => (el ? Math.round(el.getBoundingClientRect().width) : null);
  return {
    inbox: r(q('[aria-label="Exception inbox"]')),
    panel: r(document.querySelector('[aria-label$="details"]')),
    map: {
      w: r(q('.leaflet-container')),
      h: Math.round(q('.leaflet-container')?.getBoundingClientRect().height ?? 0),
    },
    zoomPill: !!q('.leaflet-bottom .leaflet-control button[aria-label="Zoom in"]'),
    unmapped: !!q('[aria-label="Locations not on the map yet"]'),
    legend: !!q('[aria-label="Online ≠ current"]'),
    drawer: !!q('[role="dialog"]'),
  };
});
console.log('FACTS', JSON.stringify(facts));

await browser.close();
