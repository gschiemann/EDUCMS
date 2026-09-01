/**
 * verify-media-library — screenshot the Media Library against its approved mock.
 *
 * "Calm Assets v1" is a design contract (scratch/design/assets-menu/
 * media-library-v1-calm.png + MEDIA-LIBRARY-V1-DESIGN-HANDOFF.md) and CI
 * cannot grade a design. This is the repeatable way to put the real render
 * next to the mock.
 *
 *   0. install the harness route (it lives OUTSIDE src/app because a
 *      compiled-in route costs real production bundle bytes — the bundle
 *      ratchet caught exactly that on 2026-08-31; the installed copy is
 *      .gitignored so it can never be committed):
 *        node apps/web/scripts/verify-media-library.mjs --install
 *   1. build with the harness on:
 *        NEXT_PUBLIC_ENABLE_DEV_HARNESS=1 pnpm --filter web build
 *   2. serve the PRODUCTION build (never `next dev` — the dev server drops
 *      responsive CSS variants, which is how a layout ships looking right
 *      only on the author's machine):
 *        cd apps/web && pnpm exec next start -p 3112
 *   3. node apps/web/scripts/verify-media-library.mjs
 *   4. remove the route again (and rebuild before shipping anything):
 *        node apps/web/scripts/verify-media-library.mjs --remove
 *
 * Writes assets1-{library,selection,detail,inuse,mobile}.png into
 * scratch/design/verify/ and prints the DOM facts worth asserting (grid
 * column count, card control inventory, footer copy).
 * The staged data lives in apps/web/scripts/harness/assets-mock.page.tsx.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_SRC = path.join(HERE, 'harness', 'assets-mock.page.tsx');
const ROUTE_DIR = path.join(HERE, '..', 'src', 'app', 'dev', 'assets-mock');
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

const OUT = path.join(HERE, '..', '..', '..', 'scratch', 'design', 'verify');
fs.mkdirSync(OUT, { recursive: true });
const PORT = process.env.PORT || 3112;
const URL = `http://localhost:${PORT}/dev/assets-mock`;

// Same usage payload the harness seeds, served over the wire too — so the
// real fetch path is exercised even after the seeded cache goes stale.
const USAGE_IN_USE = {
  playlists: [
    { id: 'pl-1', name: 'Summer Strength', itemCount: 6, scheduled: true, activeNow: true, screensReached: 4 },
    { id: 'pl-2', name: 'Lobby Rotation', itemCount: 12, scheduled: true, activeNow: true, screensReached: 3 },
    { id: 'pl-3', name: 'Member Welcome', itemCount: 3, scheduled: false, activeNow: false, screensReached: 1 },
  ],
  totals: { playlists: 3, screensReached: 8, locations: 2 },
  protectedEmergency: false,
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await ctx.route('**/assets/*/usage', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(USAGE_IN_USE),
  }),
);
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('[data-testid="library-subtitle"]', { timeout: 20000 });
await page.waitForTimeout(1200);

// ─── 1) DEFAULT LIBRARY ────────────────────────────────────────────
await page.screenshot({ path: `${OUT}/assets1-library.png` });
console.log('shot library');

const facts = await page.evaluate(() => {
  const grid = document.querySelector('[data-testid="files-grid"]');
  const cards = grid ? grid.querySelectorAll(':scope > li') : [];
  const firstCard = cards[0];
  const cardButtons = firstCard ? [...firstCard.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')) : [];
  const cs = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
  return {
    subtitle: document.querySelector('[data-testid="library-subtitle"]')?.textContent,
    gridColumns: cs,
    cardCount: cards.length,
    firstCardControls: cardButtons,
    // §25 — no destructive control may exist on a default card.
    destructiveOnCard: cardButtons.some((l) => /delete|trash|remove/i.test(l || '')),
    footer: document.querySelector('[data-testid="library-footer"]')?.textContent,
    uploadStrip: document.querySelector('[data-testid="upload-strip"]')?.textContent,
    filterChips: [...document.querySelectorAll('[aria-label="Filter by media type"] button')].map((b) => b.textContent?.trim()),
    folderCards: [...document.querySelectorAll('section ul li')].length,
  };
});
console.log('FACTS', JSON.stringify(facts, null, 2));

// ─── 2) SELECTION BAR ──────────────────────────────────────────────
for (const name of ['Recovery-Lounge-August.jpg', 'Club-Floor-Hero.jpg', 'PEPF-Training.jpg']) {
  await page.getByRole('button', { name: `Select ${name}` }).click();
}
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/assets1-selection.png` });
console.log('shot selection —', await page.locator('[data-testid="asset-bulk-bar"]').innerText());
await page.getByRole('button', { name: /Clear selection/ }).click();

// ─── 3) DETAIL + USAGE ─────────────────────────────────────────────
await page.getByRole('button', { name: 'View details for Recovery-Lounge-August.jpg' }).click();
await page.waitForSelector('[data-testid="asset-usage"]');
await page.getByRole('button', { name: /Show the playlists/ }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/assets1-detail.png` });
console.log('shot detail — usage:', (await page.locator('[data-testid="asset-usage"]').innerText()).replace(/\n/g, ' | '));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ─── 4) IN-USE DELETION BLOCK ──────────────────────────────────────
await page.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' }).click();
await page.getByRole('menuitem', { name: 'Delete…' }).click();
await page.waitForSelector('[data-testid="asset-in-use-block"]', { timeout: 10000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/assets1-inuse.png` });
const blockButtons = await page.locator('[data-testid="asset-in-use-block"] button').allInnerTexts();
console.log('shot in-use — buttons:', JSON.stringify(blockButtons));
await page.locator('[data-testid="asset-in-use-block"]').getByRole('button', { name: 'Cancel' }).click();

// ─── 5) MOBILE ─────────────────────────────────────────────────────
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/assets1-mobile.png`, fullPage: false });
const mobile = await page.evaluate(() => {
  const grid = document.querySelector('[data-testid="files-grid"]');
  const strip = document.querySelector('[data-testid="upload-strip"]');
  return {
    gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    dropStripHidden: strip ? getComputedStyle(strip).display === 'none' : null,
    filtersScrollable: (() => {
      const f = document.querySelector('[aria-label="Filter by media type"]');
      return f ? f.scrollWidth > f.clientWidth : null;
    })(),
    smallestTapTarget: Math.min(
      ...[...document.querySelectorAll('button')]
        .filter((b) => b.offsetParent !== null)
        .map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))
        .filter((v) => v > 0),
    ),
  };
});
console.log('shot mobile', JSON.stringify(mobile));

await browser.close();
console.log(`\nScreenshots in ${OUT}`);
