/**
 * BUILDER — the APPS tab must put an app on the canvas.
 *
 * Owner, 2026-10-12: "I still can't add any apps to my templates." This
 * drives the real route with the API mocked (same harness as
 * builder-tile-click-adds-widget.spec.ts): click the YouTube tile, paste a
 * link, press Add to canvas, and assert a YouTube zone is on the CURRENT page
 * and visible. A second test drags the tile straight onto the canvas.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const SCHOOL_ID = 'e2e-school';
const TEMPLATE_ID = 'e2e-blank-template';
// The web origin the mocked API answers CORS for. playwright.sandbox.config.ts points the suite at the
// running dev server (3100) through E2E_BASE; the default is the prebuilt server playwright.config.ts boots.
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};

const FAKE_USER = {
  id: 'u1',
  email: 'e2e@example.com',
  role: 'SCHOOL_ADMIN',
  tenantId: SCHOOL_ID,
  canTriggerPanic: false,
};

// A "Start from blank" board: ONE full-canvas EMPTY placeholder — what
// "New template → Start from blank" really seeds.
const BLANK_TEMPLATE = {
  id: TEMPLATE_ID,
  name: 'E2E blank board',
  tenantId: SCHOOL_ID,
  isSystem: false,
  screenWidth: 3840,
  screenHeight: 2160,
  bgColor: '#ffffff',
  zones: [
    {
      id: 'zone-placeholder',
      templateId: TEMPLATE_ID,
      name: 'Full Screen',
      widgetType: 'EMPTY',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0,
      defaultConfig: {},
      sceneId: null,
    },
  ],
  scenes: [],
};

async function installApiMocks(page: Page) {
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
  await page.route('**/tenants', (route) => okJson(route, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID, vertical: 'K12' }]));
  await page.route('**/tenants/accessible', (route) => okJson(route, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID }]));
  await page.route(`**/templates/${TEMPLATE_ID}`, (route) => okJson(route, BLANK_TEMPLATE));
  await page.route(`**/templates/${TEMPLATE_ID}/**`, (route) => okJson(route, BLANK_TEMPLATE));
  await page.route('**/templates', (route) => okJson(route, [BLANK_TEMPLATE]));
  await page.route('**/branding/me', (route) => okJson(route, {}));
  await page.route('**/screens', (route) => okJson(route, []));
  await page.route('**/playlists', (route) => okJson(route, []));
  await page.route('**/assets**', (route) => okJson(route, []));
}

async function openBlankBuilder(page: Page) {
  await installApiMocks(page);
  await page.addInitScript(() => {
    // The builder route is authenticated: seed what the client reads.
    try { localStorage.setItem('edu_cms_eula_accepted_v1.0', '1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width: 1440, height: 900 }); // the builder sits behind a `lg:` wall
  await page.goto(`/${SCHOOL_ID}/templates/builder/${TEMPLATE_ID}`, { waitUntil: 'domcontentloaded' });
  // With one selectable zone the builder opens on the PROPERTIES tab (the
  // selection-subscription switches panels), so the picker is not on screen
  // until the operator — or this test — chooses Widgets.
  const appsTab = page.getByRole('tab', { name: /^apps$/i });
  await appsTab.waitFor({ state: 'visible', timeout: 60_000 });
  await appsTab.click();
  const card = page.getByRole('button', { name: /^YouTube/ }).first();
  await card.waitFor({ state: 'visible', timeout: 60_000 });
  return card;
}


const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const youtubeZones = (page: Page) => page.locator('[data-zone-id][data-widget-type="STREAMING"]');

const setupCards = (page: Page) => page.locator('[data-app-setup-card="youtube"]');

test.describe('builder — Apps tab → app on the board', () => {
  test('a CLICK puts the app on the canvas at once; setup opens in Properties; the link makes it live', async ({ page }) => {
    const card = await openBlankBuilder(page);
    await expect(youtubeZones(page)).toHaveCount(0);

    await card.click();

    // On the canvas immediately — a clear "Set up YouTube" card, not nothing.
    const zone = youtubeZones(page).first();
    await expect(zone).toBeVisible({ timeout: 15_000 });
    await expect(setupCards(page)).toBeVisible();
    await expect(setupCards(page).getByRole('button', { name: /Set up YouTube/i })).toBeVisible();

    // Properties opened on the app's own setup.
    await expect(page.getByRole('tab', { name: /^properties$/i })).toHaveAttribute('aria-selected', 'true');
    await page.getByLabel(/YouTube link/i).fill(YT);
    await page.getByRole('button', { name: /Show it on the board/i }).click();

    // Configured: the setup card is gone and the zone is still on THIS page.
    await expect(setupCards(page)).toHaveCount(0);
    await expect(zone).toBeVisible();
    await expect(page.locator('[data-app-change="youtube"]')).toBeVisible();
  });

  test('an app tile DRAGS onto the canvas like a widget and lands where it was dropped', async ({ page }) => {
    const card = await openBlankBuilder(page);
    await card.scrollIntoViewIfNeeded();
    const from = await card.boundingBox();
    const canvas = await page.locator('[data-template-canvas]').first().boundingBox();
    expect(from && canvas).toBeTruthy();
    // Cross the 8 px activation distance, pause, travel, drop (see
    // builder-tile-click-adds-widget.spec.ts for why each step is needed).
    await page.mouse.move(from!.x + 30, from!.y + 30);
    await page.mouse.down();
    await page.mouse.move(from!.x + 50, from!.y + 50, { steps: 5 });
    await page.waitForTimeout(300);
    const dropX = canvas!.x + canvas!.width * 0.7;
    const dropY = canvas!.y + canvas!.height * 0.6;
    await page.mouse.move(dropX, dropY, { steps: 30 });
    await page.waitForTimeout(400);
    await page.mouse.up();

    const zone = youtubeZones(page).first();
    await expect(zone).toBeVisible({ timeout: 15_000 });
    await expect(setupCards(page)).toBeVisible();
    // It landed on the right-hand side of the canvas, where it was let go —
    // not at the click-to-add default top-left slot.
    const box = await zone.boundingBox();
    expect(box!.x + box!.width / 2).toBeGreaterThan(canvas!.x + canvas!.width * 0.5);
    await expect(page.getByLabel(/YouTube link/i)).toBeVisible();
  });

  test('the canvas "Set up" button re-opens the setup from another tab', async ({ page }) => {
    const card = await openBlankBuilder(page);
    await card.click();
    await expect(setupCards(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('tab', { name: /^layers$/i }).click();
    await setupCards(page).getByRole('button', { name: /Set up YouTube/i }).click();
    await expect(page.getByLabel(/YouTube link/i)).toBeVisible();
  });
});
