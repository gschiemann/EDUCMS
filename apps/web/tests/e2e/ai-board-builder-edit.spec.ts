/**
 * AI BOARD IN THE BUILDER — edit mode, click-to-edit and live edits still work
 * now that the board's runtimes take messages from their PARENT only
 * (2026-09-23, EDUCMS-SHIM-V7 + VOS-LIVE-MENU check `e.source`).
 *
 * The builder is the one surface that talks to an AI board in both directions:
 *   • PropertiesPanel arms `educms-edit-mode` (and re-arms on `educms-ready`),
 *   • the board reports `educms-field-click` → the panel jumps to that field,
 *   • every text edit re-posts `educms-overrides` from the builder window.
 * Every one of those must still land. The builder window is the board frame's
 * parent (ExternalHtmlWidget renders the iframe in the builder's own
 * document), so nothing about the builder may change — this spec is the proof,
 * on the REAL builder route with the API mocked, in chromium and webkit, for:
 *   • a board kept TODAY — the producer bakes EDUCMS-SHIM-V7, and
 *   • a board kept BEFORE V7 — its saved EDUCMS-SHIM-V6 block (the exact bytes
 *     boards carry, tests/fixtures/educms-shim-v6-bodies.json) is swapped to
 *     V7 at render by buildSafeDesignerSrcdoc.
 */
import { test, expect, type Page, type Route, type FrameLocator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { keptPosBoardHtml } from '../fixtures/kept-pos-board';

const SCHOOL_ID = 'e2e-school';
const TEMPLATE_ID = 'e2e-ai-board';
// The web origin the mocked API answers CORS for (see builder-tile-click-adds-widget.spec.ts).
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const FAKE_USER = { id: 'u1', email: 'e2e@example.com', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false };

/** A board kept today: the Super Taco board exactly as the API producer bakes it. */
const KEPT_TODAY = keptPosBoardHtml();

/** The same board as it was saved before V7: its shim block is the last V6 ever baked. */
const V6_BODIES = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../fixtures/educms-shim-v6-bodies.json'), 'utf8'),
) as { bodies: Array<{ commit: string; body: string }> };
const LAST_V6 = V6_BODIES.bodies[V6_BODIES.bodies.length - 1].body;
const KEPT_BEFORE_V7 = KEPT_TODAY.replace(/<script>\/\*EDUCMS-SHIM-V\d+\*\/[\s\S]*?<\/script>/, () => `<script>${LAST_V6}</script>`);

function template(html: string) {
  return {
    id: TEMPLATE_ID,
    name: 'E2E AI board',
    tenantId: SCHOOL_ID,
    isSystem: false,
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#000000',
    zones: [{
      id: 'zone-board', templateId: TEMPLATE_ID, name: 'board', widgetType: 'EXTERNAL_HTML',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0,
      defaultConfig: { html }, sceneId: null,
    }],
    scenes: [],
  };
}

async function installApiMocks(page: Page, tpl: unknown) {
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' })
      : respond();
  const okJson = (route: Route, body: unknown, status = 200) =>
    cors(route, () => route.fulfill({ status, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) }));
  const empty = (route: Route) => cors(route, () => route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }));

  // Broadest catch-alls FIRST (Playwright matches last-registered first).
  await page.route(/http:\/\/api\.invalid\/.*/, empty);
  await page.route('**/api/v1/**', empty);
  await page.route('**/auth/me', (route) => okJson(route, FAKE_USER));
  await page.route('**/tenants', (route) => okJson(route, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID, vertical: 'RESTAURANT' }]));
  await page.route('**/tenants/accessible', (route) => okJson(route, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID }]));
  await page.route(`**/templates/${TEMPLATE_ID}`, (route) => okJson(route, tpl));
  await page.route(`**/templates/${TEMPLATE_ID}/**`, (route) => okJson(route, tpl));
  await page.route('**/templates', (route) => okJson(route, [tpl]));
  await page.route('**/branding/me', (route) => okJson(route, {}));
  await page.route('**/screens', (route) => okJson(route, []));
  await page.route('**/playlists', (route) => okJson(route, []));
  await page.route('**/assets**', (route) => okJson(route, []));
}

async function openBuilder(page: Page, html: string): Promise<FrameLocator> {
  await installApiMocks(page, template(html));
  await page.addInitScript(() => {
    try { localStorage.setItem('edu_cms_eula_accepted_v1.0', '1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width: 1440, height: 900 }); // the builder sits behind a `lg:` wall
  await page.goto(`/${SCHOOL_ID}/templates/builder/${TEMPLATE_ID}`, { waitUntil: 'domcontentloaded' });
  const frame = page.locator('[data-zone-id="zone-board"] iframe[title="AI-designed signage board"]');
  await frame.waitFor({ state: 'attached', timeout: 60_000 });
  const board = frame.contentFrame();
  await expect(board.locator('[data-field="menu.title"]')).toBeAttached({ timeout: 30_000 });
  return board;
}

const CASES: Array<{ name: string; html: string; marker: string }> = [
  { name: 'a board kept today (EDUCMS-SHIM-V7 baked)', html: KEPT_TODAY, marker: 'EDUCMS-SHIM-V7' },
  { name: 'a board kept before V7 (its saved V6 swapped at render)', html: KEPT_BEFORE_V7, marker: 'EDUCMS-SHIM-V6' },
];

test.describe('an AI board in the builder — the parent still drives it', () => {
  test.setTimeout(120_000);

  for (const c of CASES) {
    test(`edit mode, click-to-edit and a live edit all land: ${c.name}`, async ({ page }) => {
      // The case really is the shape it claims (a boolean, so a failure does not print the board).
      expect(c.html.includes(`/*${c.marker}*/`), `the board carries /*${c.marker}*/`).toBe(true);
      const board = await openBuilder(page, c.html);
      const title = board.locator('[data-field="menu.title"]');
      const own = ((await title.textContent()) || '').trim();
      expect(own).toBeTruthy();

      // 0. What actually runs in the frame is V7 in BOTH cases — a saved V6 is
      //    swapped at render — and no V6 survives.
      const shims = await board.locator('script').evaluateAll((els) =>
        els.map((e) => (e.textContent || '').slice(0, 18)).filter((s) => s.indexOf('/*EDUCMS-SHIM-') === 0));
      expect(shims).toEqual(['/*EDUCMS-SHIM-V7*/']);

      // 1. EDIT MODE — PropertiesPanel posts `educms-edit-mode` from the builder
      //    window; the shim arms every hot zone (armEdit sets the cursor).
      await expect.poll(() => title.evaluate((el) => (el as HTMLElement).style.cursor), {
        message: 'the builder never armed edit mode on the board', timeout: 20_000,
      }).toBe('pointer');

      // 2. CLICK-TO-EDIT — a click on the board posts `educms-field-click`; the
      //    panel jumps to that field's row and focuses it.
      await title.click();
      await expect.poll(() => page.evaluate(() => {
        const a = document.activeElement;
        return !!(a && a.closest && a.closest('[data-edit-field="menu.title"]'));
      }), { message: 'the click on the board never reached the field row', timeout: 15_000 }).toBe(true);

      // 3. A LIVE EDIT — typing in the row re-posts `educms-overrides` from the
      //    builder window; the board shows the new words.
      const input = page.locator('[data-edit-field="menu.title"]').locator('input, textarea').first();
      await input.fill('Weekend Specials');
      await expect(title).toHaveText('Weekend Specials', { timeout: 15_000 });
      expect(own).not.toBe('Weekend Specials');
    });
  }
});
