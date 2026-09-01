/**
 * verify-mobile-home — screenshot the §M04 phone home at every frame width
 * the design package's §7 table names, and assert the facts a screenshot
 * cannot show on its own.
 *
 *   0. install the harness route (it lives OUTSIDE src/app because a
 *      compiled-in route costs real production bundle bytes — the bundle
 *      ratchet caught exactly that on 2026-08-31; the installed copy is
 *      .gitignored so it can never be committed):
 *        node apps/web/scripts/verify-mobile-home.mjs --install
 *   1. build with the harness on:
 *        NEXT_PUBLIC_ENABLE_DEV_HARNESS=1 pnpm --filter web build
 *   2. serve the PRODUCTION build (never `next dev` — the dev server drops
 *      responsive CSS variants, which is how a layout ships looking right
 *      only on the author's machine):
 *        cd apps/web && pnpm exec next start -p 3112
 *   3. node apps/web/scripts/verify-mobile-home.mjs
 *   4. remove the route again (and rebuild before shipping anything):
 *        node apps/web/scripts/verify-mobile-home.mjs --remove
 *
 * Writes mobile-home-{360,390,430}.png into scratch/design/verify/ and fails
 * loudly on the two things that are invisible in a screenshot: a page that
 * scrolls sideways (§20 "No ordinary page has horizontal page scrolling")
 * and any tap target under 44px (§15).
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_SRC = path.join(HERE, 'harness', 'mobile-home-mock.page.tsx');
const ROUTE_DIR = path.join(HERE, '..', 'src', 'app', 'dev', 'mobile-home-mock');
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
const URL = 'http://localhost:3112/dev/mobile-home-mock';

/** §7's phone frames. 360 is the stress width — everything must survive it. */
const FRAMES = [
  { w: 360, h: 800, name: 'Small Android baseline' },
  { w: 390, h: 844, name: 'iPhone 14/15 baseline' },
  { w: 430, h: 932, name: 'Large iPhone baseline' },
];

const browser = await chromium.launch();
let failures = 0;

for (const frame of FRAMES) {
  const ctx = await browser.newContext({
    viewport: { width: frame.w, height: frame.h },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
  page.on('pageerror', (e) => { console.log('PAGE ERROR:', e.message); failures++; });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(600);

  const shot = `${OUT}/mobile-home-${frame.w}.png`;
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`\n── ${frame.w}×${frame.h} (${frame.name}) → ${shot}`);

  // The surface actually rendered (three staged variants).
  const homes = await page.locator('[data-testid="mobile-fleet-command"]').count();
  console.log(`   homes rendered:        ${homes}${homes === 3 ? '' : '   ← expected 3'}`);
  if (homes !== 3) failures++;

  // §20 — no ordinary page scrolls sideways. This is the check that catches a
  // fixed-width child at 360 that looked fine at 430.
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`   horizontal overflow:   ${overflow}px${overflow > 0 ? '   ← §20 VIOLATION' : ''}`);
  if (overflow > 0) failures++;

  // §15 — 44px minimum on every tap target, measured on the real box rather
  // than trusted from a class name.
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of Array.from(document.querySelectorAll('a, button'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < 44) out.push(`${el.tagName} "${(el.textContent || '').trim().slice(0, 32)}" h=${Math.round(r.height)}`);
    }
    return out;
  });
  console.log(`   targets under 44px:    ${small.length}`);
  for (const s of small) console.log(`      ← §15 VIOLATION: ${s}`);
  failures += small.length;

  // The assurance labels must be the desktop's words, on screen, unclipped.
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="assurance-row"]'))
      .slice(0, 1)
      .flatMap((row) => Array.from(row.children).map((c) => (c.textContent || '').trim())));
  console.log(`   assurance tiles:       ${labels.map((l) => JSON.stringify(l)).join('  ')}`);

  // §M04: healthy locations collapse rather than filling the viewport.
  const collapsed = await page.locator('[data-testid="healthy-collapsed"]').first().textContent().catch(() => null);
  console.log(`   healthy collapse line: ${collapsed ? JSON.stringify(collapsed.trim()) : '(none)'}`);

  await ctx.close();
}

await browser.close();
console.log(failures === 0
  ? '\nOK — every frame clean (no overflow, no sub-44px target, no page error).'
  : `\nFAILED — ${failures} problem(s) above.`);
process.exit(failures === 0 ? 0 : 1);
