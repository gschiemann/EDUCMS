/**
 * verify-screens-v3 — screenshot the Calm Operations v3 Screens page against
 * its approved mock.
 *
 * The v3 surface is a design contract
 * (scratch/design/screens-menu/screen-operations-v3-calm.png) and CI cannot
 * grade a design. This is the repeatable way to put the real render next to it.
 *
 *   0. install the harness route (it lives OUTSIDE src/app because a
 *      compiled-in route costs real production bundle bytes — the bundle
 *      ratchet caught exactly that on 2026-08-31; the installed copy is
 *      .gitignored so it can never be committed):
 *        node apps/web/scripts/verify-screens-v3.mjs --install
 *   1. build with the harness on:
 *        NEXT_PUBLIC_ENABLE_DEV_HARNESS=1 pnpm --filter web build
 *   2. serve the PRODUCTION build (never `next dev` — the dev server drops
 *      responsive CSS variants, which is how a layout ships looking right
 *      only on the author's machine):
 *        cd apps/web && pnpm exec next start -p 3112
 *   3. node apps/web/scripts/verify-screens-v3.mjs
 *   4. remove the route again (and rebuild before shipping anything):
 *        node apps/web/scripts/verify-screens-v3.mjs --remove
 *
 * Writes screens3-*.png into scratch/design/verify/ and prints the DOM facts
 * worth asserting (which groups expanded, the dominant status per row, the
 * evidence-chain step labels). The staged data lives in
 * apps/web/scripts/harness/screens-mock.page.tsx.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_SRC = path.join(HERE, 'harness', 'screens-mock.page.tsx');
const ROUTE_DIR = path.join(HERE, '..', 'src', 'app', 'dev', 'screens-mock');
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
const URL = 'http://localhost:3112/dev/screens-mock';

const browser = await chromium.launch();
const shot = async (page, name, full = true) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log('shot', name);
};

// ── 1440px desktop ────────────────────────────────────────────────
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(600);

console.log('groups expanded:', await page.locator('tbody th button[aria-expanded="true"]').count());
console.log('groups collapsed:', await page.locator('tbody th button[aria-expanded="false"]').count());
console.log('rows visible:', await page.locator('table tbody tr td:first-child').count());
console.log('chips:', await page.locator('[role="group"][aria-label="Filter screens"] button').allInnerTexts());

// (1) full page, drawer closed
await shot(page, 'screens3-01-list-1440');

// (2) needs-attention filter + the problem drawer open on Overview
await page.getByRole('button', { name: /Needs attention/ }).click();
await page.waitForTimeout(250);
await page.locator('table').getByRole('button', { name: 'G43', exact: true }).click();
await page.waitForTimeout(400);
console.log('drawer tabs:', await page.locator('[role="dialog"] [role="tab"]').allInnerTexts());
console.log('evidence steps:', await page.locator('[role="dialog"] ol li p:first-of-type').allInnerTexts());
await shot(page, 'screens3-02-attention-drawer-1440', false);

// (3) drawer Actions tab
await page.locator('[role="dialog"]').getByRole('tab', { name: 'Actions' }).click();
await page.waitForTimeout(500);
await shot(page, 'screens3-03-drawer-actions-1440', false);

// (4) offline screen drawer
await page.locator('[role="dialog"]').getByRole('button', { name: 'Close details' }).click();
await page.getByRole('button', { name: /^All/ }).click();
await page.waitForTimeout(200);
const dtn = page.locator('table').getByRole('button', { name: 'Downtown Locker Hall', exact: true });
if (await dtn.count()) {
  await dtn.click();
} else {
  // Its group is healthy apart from this one screen, so it is already open;
  // if not, expand RIOT Downtown first.
  await page.getByRole('button', { name: /Expand RIOT Downtown/i }).click();
  await page.locator('table').getByRole('button', { name: 'Downtown Locker Hall', exact: true }).click();
}
await page.waitForTimeout(400);
await shot(page, 'screens3-04-offline-drawer-1440', false);
await page.locator('[role="dialog"]').getByRole('button', { name: 'Close details' }).click();
await ctx.close();

// ── tablet 768 ────────────────────────────────────────────────────
const tctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2 });
const tpage = await tctx.newPage();
await tpage.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await tpage.waitForTimeout(600);
await shot(tpage, 'screens3-05-tablet-768');
await tctx.close();

// ── mobile 375 ────────────────────────────────────────────────────
const mctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3 });
const mpage = await mctx.newPage();
await mpage.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await mpage.waitForTimeout(600);
console.log('mobile: table present?', await mpage.locator('table').isVisible());
console.log('mobile: horizontal overflow?', await mpage.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
));
await shot(mpage, 'screens3-06-mobile-375');
await mctx.close();

await browser.close();
console.log(`\nWrote screens3-*.png to ${OUT}`);
