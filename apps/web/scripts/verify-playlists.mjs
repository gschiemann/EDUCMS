/**
 * verify-playlists — screenshot Playlists Operations v1 against its approved
 * mock.
 *
 * The library is a design contract (scratch/design/playlists-page/
 * playlists-operations-v1.png) and CI cannot grade a design. This is the
 * repeatable way to put the real render next to it.
 *
 *   0. install the harness route (it lives OUTSIDE src/app because a
 *      compiled-in route costs real production bundle bytes — the bundle
 *      ratchet caught exactly that on 2026-08-31; the installed copy is
 *      .gitignored so it can never be committed):
 *        node apps/web/scripts/verify-playlists.mjs --install
 *   1. build with the harness on:
 *        NEXT_PUBLIC_ENABLE_DEV_HARNESS=1 pnpm --filter web build
 *   2. serve the PRODUCTION build (never `next dev` — the dev server drops
 *      responsive CSS variants, which is how a layout ships looking right
 *      only on the author's machine):
 *        cd apps/web && pnpm exec next start -p 3112
 *   3. node apps/web/scripts/verify-playlists.mjs
 *   4. remove the route again (and rebuild before shipping anything):
 *        node apps/web/scripts/verify-playlists.mjs --remove
 *
 * Writes playlists1-*.png into scratch/design/verify/ and prints the DOM facts
 * worth asserting (tab counts, row count, delivery wording, column headers).
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_SRC = path.join(HERE, 'harness', 'playlists-mock.page.tsx');
const ROUTE_DIR = path.join(HERE, '..', 'src', 'app', 'dev', 'playlists-mock');
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
const PORT = process.env.VERIFY_PORT || '3112';
const URL = `http://localhost:${PORT}/dev/playlists-mock`;

const browser = await chromium.launch();

// ── 1440px: the operator's screenshot width and the mock's framing. ──
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForSelector('[data-testid="playlist-table"]', { timeout: 20_000 });
await page.waitForTimeout(600);

// (1) DEFAULT LIBRARY — the side-by-side against the mock.
await page.screenshot({ path: `${OUT}/playlists1-library.png`, fullPage: true });
console.log('shot library');

const facts = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
  const table = document.querySelector('[data-testid="playlist-table"]');
  const headers = [...(table?.querySelectorAll('th') ?? [])].map((t) => t.textContent.trim());
  const rows = [...(table?.querySelectorAll('[data-testid="playlist-row"]') ?? [])];
  const delivery = rows.map((r) => r.querySelector('[data-testid="delivery-cell"]')?.textContent?.trim());
  const primary = rows.map((r) => {
    const btns = [...r.querySelectorAll('td:last-child button')].map((b) => b.textContent.trim());
    return btns.filter((b) => b === 'Open' || b === 'Review');
  });
  return {
    summary: document.querySelector('[data-testid="library-summary"]')?.textContent,
    tabs,
    headers,
    rowsOnPage: rows.length,
    attentionRows: rows.filter((r) => r.dataset.attention === 'true').length,
    delivery: [...new Set(delivery)],
    onePrimaryPerRow: primary.every((p) => p.length === 1),
    banner: document.querySelector('[data-testid="exception-banner"]')?.textContent?.replace(/\s+/g, ' ').trim(),
    // The claim that must NOT appear anywhere on the page.
    saysConfirmedFraction: /Confirmed \d+\/\d+/.test(document.body.innerText),
    saysLive: /\bLIVE\b/.test(document.body.innerText),
    powerSwitches: document.querySelectorAll('[data-testid="playlist-table"] [role="switch"]').length,
  };
});
console.log('FACTS/library', JSON.stringify(facts, null, 2));

// (2) NEEDS-ATTENTION FILTER + the exception banner.
await page.getByRole('tab', { name: /Needs attention/ }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/playlists1-needs-attention.png`, fullPage: true });
console.log('shot needs-attention');

// (3) WORKSPACE — Content tab.
await page.click('[data-harness-view="workspace"]');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/playlists1-workspace-content.png`, fullPage: true });
console.log('shot workspace-content');

// (4) WORKSPACE — Delivery tab, with the G43 partial state.
await page.click('[data-harness-tab="delivery"]');
await page.waitForSelector('[data-testid="delivery-table"]', { timeout: 10_000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/playlists1-workspace-delivery.png`, fullPage: true });
console.log('shot workspace-delivery');

const delivery = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-testid="delivery-row"]')];
  return {
    headers: [...document.querySelectorAll('[data-testid="delivery-table"] th')].map((t) => t.textContent.trim()),
    states: rows.map((r) => [r.querySelector('td')?.textContent?.trim(), r.dataset.state]),
    signature: [...new Set(rows.map((r) => r.children[4]?.textContent?.trim()))],
    summary: document.querySelector('[data-testid="workspace-exception"]')?.textContent?.replace(/\s+/g, ' ').trim(),
  };
});
console.log('FACTS/delivery', JSON.stringify(delivery, null, 2));

// (5) PAUSE EVERYWHERE confirmation — the exact reach, before anything moves.
await page.getByRole('button', { name: /Pause everywhere/ }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/playlists1-pause-everywhere.png` });
console.log('shot pause-everywhere');
const confirmText = await page.evaluate(
  () => document.querySelector('[role="dialog"], [role="alertdialog"]')?.textContent?.replace(/\s+/g, ' ').trim(),
);
console.log('FACTS/pause', JSON.stringify(confirmText));
await page.keyboard.press('Escape');

// (6) MOBILE, 375px — one operational card per playlist, no horizontal scroll.
const mob = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const mpage = await mob.newPage();
await mpage.goto(URL, { waitUntil: 'networkidle', timeout: 60_000 });
await mpage.waitForSelector('[data-testid="playlist-card-compact"]', { timeout: 20_000 });
await mpage.waitForTimeout(600);
await mpage.screenshot({ path: `${OUT}/playlists1-mobile.png`, fullPage: true });
console.log('shot mobile');
const mobileFacts = await mpage.evaluate(() => ({
  cards: document.querySelectorAll('[data-testid="playlist-card-compact"]').length,
  // §23.4 — the page itself must never scroll sideways.
  horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
console.log('FACTS/mobile', JSON.stringify(mobileFacts));

await browser.close();
