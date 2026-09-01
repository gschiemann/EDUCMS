/**
 * verify-templates-gallery — screenshot the Templates gallery against its
 * approved mock (Calm v1).
 *
 * The gallery is a design contract (scratch/design/templates-page/
 * templates-gallery-v1-calm.png) and CI cannot grade a design. This is the
 * repeatable way to put the real render next to the mock.
 *
 *   0. install the harness route (it lives OUTSIDE src/app because a
 *      compiled-in route costs real production bundle bytes — the bundle
 *      ratchet caught exactly that on 2026-08-31; the installed copy is
 *      .gitignored so it can never be committed):
 *        node apps/web/scripts/verify-templates-gallery.mjs --install
 *   1. build with the harness on:
 *        NEXT_PUBLIC_ENABLE_DEV_HARNESS=1 pnpm --filter web build
 *   2. serve the PRODUCTION build (never `next dev` — the dev server drops
 *      responsive CSS variants, which is how a layout ships looking right
 *      only on the author's machine):
 *        cd apps/web && pnpm exec next start -p 3112
 *   3. node apps/web/scripts/verify-templates-gallery.mjs
 *   4. remove the route again (and rebuild before shipping anything):
 *        node apps/web/scripts/verify-templates-gallery.mjs --remove
 *
 * Writes templates1-*.png into scratch/design/verify/ and prints the DOM
 * facts worth asserting (grid columns, card action counts, usage pills,
 * mounted card count vs catalog size). The staged data lives in
 * apps/web/scripts/harness/templates-mock.page.tsx.
 */
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_SRC = path.join(HERE, 'harness', 'templates-mock.page.tsx');
const ROUTE_DIR = path.join(HERE, '..', 'src', 'app', 'dev', 'templates-mock');
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
const PORT = process.env.VERIFY_PORT || '3112';
const URL = `http://localhost:${PORT}/dev/templates-mock`;

// VERIFY_BROWSER=webkit runs the same pass in WebKit. Non-negotiable per
// CLAUDE.md: "Works in Chrome" is not correct — the 2026-06-08 favicon
// crash and the 2026-05-09 minified-bridge SyntaxError were both
// Chromium-tolerated and WebKit-fatal. Screenshots from a webkit run are
// suffixed so they never overwrite the chromium set.
const ENGINE = process.env.VERIFY_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const SUFFIX = ENGINE === 'webkit' ? '-webkit' : '';
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
console.log(`engine: ${ENGINE}`);
// 1440 wide — the operator's screenshot width, and the breakpoint where
// §12.1's four-across desktop rhythm applies.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1250 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('h1:text-is("Templates")', { timeout: 20000 });
await page.waitForTimeout(1200);

const shot = async (name, opts = {}) => {
  const file = path.join(OUT, `templates1-${name}${SUFFIX}.png`);
  await page.screenshot({ path: file, ...opts });
  console.log('  wrote', path.relative(process.cwd(), file));
};

// ─── 1) DEFAULT GALLERY ───────────────────────────────────────────────
console.log('\n[1] default gallery');
await shot('default');

const facts = await page.evaluate(() => {
  const grid = document.querySelector('section [class*="grid-cols"]');
  const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
  const cards = document.querySelectorAll('[aria-label^="Preview of"]').length;
  const menus = document.querySelectorAll('[aria-label^="More actions for"]').length;
  const livePills = Array.from(document.querySelectorAll('[data-testid="template-usage-pill"]'))
    .map((n) => n.textContent.trim());
  const attention = Array.from(document.querySelectorAll('[data-testid="template-attention-pill"]'))
    .map((n) => n.textContent.trim());
  const reach = Array.from(document.querySelectorAll('[data-testid="template-usage-reach"]'))
    .map((n) => n.textContent.trim());
  const h1 = document.querySelector('h1')?.textContent?.trim();
  const summary = document.querySelector('h1')?.nextElementSibling?.textContent?.trim();
  const posters = document.querySelectorAll('[data-tpl-poster="1"]').length;
  const frozen = document.querySelectorAll('[data-tpl-frozen="1"]').length;
  const iframes = document.querySelectorAll('iframe').length;
  // Horizontal overflow is a §12 hard rule at every width.
  const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth;
  return { cols, cards, menus, livePills, attention, reach, h1, summary, posters, frozen, iframes, overflowX };
});
console.log('  h1                 :', facts.h1);
console.log('  summary            :', facts.summary);
console.log('  grid columns @1440 :', facts.cols, '(§5.4 expects 4)');
console.log('  preview surfaces   :', facts.cards, '(12 owned + 12 presets = 24 with paging on)');
console.log('  overflow menus     :', facts.menus);
console.log('  usage pills        :', facts.livePills.join(' | '));
console.log('  reach lines        :', facts.reach.join(' | '));
console.log('  needs-attention    :', facts.attention.join(' | '));
console.log('  frozen stages      :', facts.frozen, '· static posters:', facts.posters, '· iframes:', facts.iframes);
console.log('  horizontal overflow:', facts.overflowX ? 'YES — BUG' : 'no');

// ─── 2) ACTIVE CATEGORY FILTER ────────────────────────────────────────
console.log('\n[2] active category filter');
const chipGroup = page.getByRole('group', { name: 'Filter by category' });
const chipLabels = (await chipGroup.getByRole('button').allTextContents()).map((s) => s.trim());
console.log('  category chips     :', chipLabels.join(' | '));
const chip = chipGroup.getByRole('button', { name: /^Promo/ });
if (await chip.count()) {
  await chip.first().click();
  await page.waitForTimeout(700);
  await shot('filter-active');
  const n = await page.locator('[aria-label^="Preview of"]').count();
  console.log('  cards after Promo filter:', n);
  await chipGroup.getByRole('button', { name: /^All/ }).first().click();
  await page.waitForTimeout(400);
} else {
  console.log('  !! Promo chip not found');
}

// ─── 3) FULL-SCREEN PREVIEW OF A TENANT TEMPLATE (with usage) ─────────
console.log('\n[3] full-screen preview, tenant template with usage');
await page.getByRole('button', { name: 'Preview of Club Welcome template' }).click();
await page.waitForTimeout(900);
await shot('preview-usage');
const previewFacts = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"][aria-modal="true"]');
  if (!dlg) return null;
  return {
    label: dlg.getAttribute('aria-label'),
    actions: Array.from(dlg.querySelectorAll('button')).map((b) => b.textContent.trim()).filter(Boolean),
    usage: dlg.textContent.includes('Where this is used'),
  };
});
console.log('  dialog             :', previewFacts?.label);
console.log('  tray actions       :', previewFacts?.actions.join(' | '));
console.log('  usage summary shown:', previewFacts?.usage);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ─── 4a) THE CARD MENU + the honest delete confirmation ───────────────
console.log('\n[4a] card overflow menu + delete confirmation');
await page.getByRole('button', { name: 'More actions for Club Welcome' }).click();
await page.waitForTimeout(300);
const menuItems = (await page.locator('[role="menuitem"]').allTextContents()).map((s) => s.trim());
console.log('  card menu items    :', menuItems.join(' | '));
await shot('card-menu');
await page.getByRole('menuitem', { name: 'Delete template' }).click();
await page.waitForTimeout(700);
await shot('delete-confirm');
const confirmText = await page.evaluate(() => {
  const d = document.querySelector('[role="alertdialog"], [role="dialog"]');
  return d ? d.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) : null;
});
console.log('  confirmation copy  :', confirmText);
// §11.4 — there is no Trash behind this call, so the copy must not
// promise one. Match a PROMISE ("recoverable", "can be restored",
// "30 days", "move to trash") — never a denial ("can't be restored",
// which is the correct wording and must not read as a failure.)
const promisesRecovery =
  /(?:\bis\b|\bwill be\b|\bstays?\b)\s+recoverable|recoverable for|\b30\s*days\b|move to trash|can be restored|you can restore/i
    .test(confirmText || '');
console.log('  promises recovery? :', promisesRecovery ? 'YES — BUG (§11.4)' : 'no — correct');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ─── 4b) IN-USE IMPACT DIALOG (§11.3) ─────────────────────────────────
// The harness never calls an API, so it can't provoke a genuine 409.
// ?impact=1 renders the REAL exported dialog with a 409-shaped payload.
console.log('\n[4b] in-use impact dialog');
await page.goto(`${URL}?impact=1`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('[role="alertdialog"]', { timeout: 20000 });
await page.waitForTimeout(600);
await shot('impact-dialog');
const impactFacts = await page.evaluate(() => {
  const d = document.querySelector('[role="alertdialog"]');
  const buttons = Array.from(d.querySelectorAll('button')).map((b) => b.textContent.trim());
  return {
    buttons,
    text: d.textContent.replace(/\s+/g, ' ').trim().slice(0, 220),
    hasDestructive: buttons.some((b) => /delete|remove|anyway|trash/i.test(b)),
    focused: document.activeElement?.textContent?.trim(),
  };
});
console.log('  buttons            :', impactFacts.buttons.join(' | '));
console.log('  destructive button :', impactFacts.hasDestructive ? 'YES — BUG (§11.3)' : 'none — correct');
console.log('  focus lands on     :', impactFacts.focused);
console.log('  copy               :', impactFacts.text);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('h1:text-is("Templates")', { timeout: 20000 });
await page.waitForTimeout(600);

// ─── 5) MOBILE 375 ────────────────────────────────────────────────────
console.log('\n[5] mobile 375');
await page.setViewportSize({ width: 375, height: 900 });
await page.waitForTimeout(700);
await shot('mobile-375');
const mobileFacts = await page.evaluate(() => {
  const grid = document.querySelector('section [class*="grid-cols"]');
  return {
    cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    newTemplateVisible: !!Array.from(document.querySelectorAll('button'))
      .find((b) => /new template/i.test(b.textContent || '') && b.offsetParent !== null),
  };
});
console.log('  grid columns @375  :', mobileFacts.cols, '(§12.4 expects 1)');
console.log('  horizontal overflow:', mobileFacts.overflowX ? 'YES — BUG' : 'no');
console.log('  New template visible:', mobileFacts.newTemplateVisible);

await browser.close();
console.log('\nDone. Compare against scratch/design/templates-page/templates-gallery-v1-calm.png');
