/**
 * One select-all pattern across the dashboard (Greg, 2026-10-04: "select all
 * should be the same across the entire app… it looks best on the playlist
 * columns so make the assets the same and find a good solution for the tiled
 * views as well… i dont want some random button like you put that says select
 * all").
 *
 * jsdom has no layout and no media queries, so the things that make this pattern
 * work — WHERE the box sits, WHEN a tile's box shows, HOW BIG the target is —
 * can only be proven in a real browser. Driven through the real routes with every
 * API call mocked, in WebKit as well as Chromium (the operator runs Safari, in a
 * 1325 × 758 window, and an iPhone).
 *
 *   1. Switching list ⇄ tiles never moves the select-all box (same x), on the
 *      Media Library and on Playlists.
 *   2. A tile's own box is out of the way until the pointer is on it (or anything
 *      is selected) on a device that can hover — and ALWAYS drawn on a phone.
 *   3. On a touch screen every box is a 44 px target, in tables included.
 *   4. The Media Library toolbar fits the window with the old "Select all" pill
 *      gone — the sort menu and the grid/list toggle are on screen again.
 */
import { test, expect, type Page, type Route, type Locator } from '@playwright/test';

const SCHOOL_ID = 'e2e-school';
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const USER = { id: 'u1', email: 'e2e@example.com', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

const ASSETS = Array.from({ length: 12 }, (_, i) => ({
  id: `asset-${i}`, tenantId: SCHOOL_ID, originalName: `Demo photo ${i}.png`, mimeType: 'image/png', fileSize: 1_000_000 + i,
  fileUrl: 'https://files.example.test/image.png', createdAt: new Date(Date.UTC(2026, 9, 1, 10 - Math.floor(i / 2))).toISOString(),
  status: 'PUBLISHED', folderId: null, uploadedBy: { id: 'u1', email: 'marketing@example.test' },
  processingMeta: { processedDimensions: { w: 1920, h: 1080 } },
}));
const PLAYLISTS = ['Freese', 'Member Promotions', 'Fall Fundraiser', 'Lobby Welcome', 'Class Schedule', 'Holiday Hours'].map((name, i) => ({
  id: `p${i + 1}`, name,
  items: [{ id: `i${i}`, durationMs: 30_000, asset: { originalName: `${name}.jpg`, mimeType: 'image/jpeg' } }],
  updatedAt: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
  createdBy: { id: 'u1', email: 'e2e@example.com' },
}));

/** A signed-in operator, and every request either page makes answered here (no real ids or tokens — the repo is public). */
async function openAs(page: Page, route: 'assets' | 'playlists', viewport: { width: number; height: number }) {
  const cors = (r: Route, fn: () => unknown) =>
    r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: CORS, body: '' }) : fn();
  const json = (r: Route, body: unknown) =>
    cors(r, () => r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) }));

  await page.route('https://files.example.test/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/http:\/\/api\.invalid\/.*/, (r) => cors(r, () => r.fulfill({ status: 204, headers: CORS, body: '' })));
  await page.route('**/api/v1/**', (r) => cors(r, () => r.fulfill({ status: 204, headers: CORS, body: '' })));
  await page.route('**/api/v1/auth/me', (r) => json(r, USER));
  await page.route('**/api/v1/tenants', (r) => json(r, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID, vertical: 'K12' }]));
  await page.route('**/api/v1/tenants/accessible', (r) => json(r, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID }]));
  await page.route('**/api/v1/branding/me', (r) => json(r, {}));
  await page.route('**/api/v1/screens', (r) => json(r, [{ id: 's1', name: 'G43', status: 'ONLINE', screenGroupId: null, renderHealth: 'OK', lastRenderedAt: new Date().toISOString() }]));
  await page.route('**/api/v1/schedules', (r) => json(r, []));
  await page.route('**/api/v1/screen-groups', (r) => json(r, []));
  await page.route('**/api/v1/templates', (r) => json(r, []));
  await page.route('**/api/v1/assets/storage-summary', (r) => json(r, { totalBytes: 12_000_000, totalFiles: 12, images: { bytes: 12_000_000, files: 12 }, videos: { bytes: 0, files: 0 }, other: { bytes: 0, files: 0 } }));
  await page.route('**/api/v1/assets/folders', (r) => json(r, []));
  // The library is bigger than the first page, like the operator's own: until the whole library is
  // loaded the type chips carry no per-type counts, which is what the toolbar's width depends on.
  await page.route(/\/api\/v1\/assets(\?.*)?$/, (r) => json(r,
    // GET /assets is a bare array for wizard pickers; the library opts into
    // the paginated envelope with take. Model both actual API contracts.
    new URL(r.request().url()).searchParams.has('take') ? { assets: ASSETS, total: 112 } : ASSETS));
  await page.route('**/api/v1/playlists', (r) => json(r, PLAYLISTS));

  await page.addInitScript((user) => {
    try { localStorage.setItem('edu_cms_eula_accepted_v1.0', '1'); } catch { /* ignore */ }
    try {
      const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, tenantId: user.tenantId, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
      sessionStorage.setItem('edu_cms_token', token);
      sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    } catch { /* ignore */ }
  }, USER);

  await page.setViewportSize(viewport);
  await page.goto(`/${SCHOOL_ID}/${route}`, { waitUntil: 'domcontentloaded' });
  if (route === 'assets') await page.getByTestId('files-grid').waitFor({ state: 'visible', timeout: 90_000 });
  // The table shows from 1024 px; under it the card list does.
  else await page.getByTestId(viewport.width >= 1024 ? 'playlist-row' : 'playlist-card-compact').first().waitFor({ state: 'visible', timeout: 90_000 });
}

/** The viewport-relative left edge of a control. */
async function leftOf(loc: Locator): Promise<number> {
  const box = await loc.boundingBox();
  if (!box) throw new Error('control has no box');
  return box.x;
}

const OWNER_WINDOW = { width: 1325, height: 758 }; // the operator's own Safari window

test.describe('desktop (a mouse, the operator\'s 1325 × 758 window)', () => {
  test('Media Library: the select-all box sits at the same x in the list view and over the tiles', async ({ page }) => {
    test.setTimeout(120_000);
    await openAs(page, 'assets', OWNER_WINDOW);
    const tilesX = await leftOf(page.getByTestId('select-shown'));
    await page.getByRole('button', { name: 'List view' }).evaluate((el) => (el as HTMLElement).click());
    await page.getByRole('table').waitFor();
    const listX = await leftOf(page.getByTestId('select-shown'));
    expect(Math.abs(tilesX - listX)).toBeLessThanOrEqual(1);
    // …and in the list view it is the table header's FIRST column
    await expect(page.getByRole('table').getByRole('columnheader').first().getByTestId('select-shown')).toHaveCount(1);
  });

  test('Playlists: the select-all box sits at the same x in the table header and over the grid', async ({ page }) => {
    test.setTimeout(120_000);
    await openAs(page, 'playlists', OWNER_WINDOW);
    const tableX = await leftOf(page.getByTestId('select-page'));
    await page.getByRole('button', { name: 'Grid view' }).click();
    await page.getByTestId('playlist-card-grid').first().waitFor();
    const gridX = await leftOf(page.getByTestId('select-page-heading'));
    expect(Math.abs(tableX - gridX)).toBeLessThanOrEqual(1);
    // the heading line is the grid's; the table's header box is gone with the table
    await expect(page.getByTestId('select-page')).toHaveCount(0);
  });

  test('Playlists: at 1024 px and wider the card list\'s heading line is hidden — the table header carries the box', async ({ page }) => {
    test.setTimeout(120_000);
    await openAs(page, 'playlists', OWNER_WINDOW);
    await expect(page.getByTestId('select-page')).toBeVisible();
    await expect(page.getByTestId('select-page-heading')).toBeHidden();
  });

  test('Media Library: the toolbar fits the window — no stand-alone "Select all", and the sort menu and view toggle are on screen', async ({ page }) => {
    test.setTimeout(120_000);
    await openAs(page, 'assets', OWNER_WINDOW);
    await expect(page.getByRole('button', { name: /^Select all/ })).toHaveCount(0);
    const w = OWNER_WINDOW.width;
    for (const loc of [page.getByLabel('Sort files'), page.getByRole('button', { name: 'List view' })]) {
      const box = await loc.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(w);
    }
  });

  test('the box explains itself on hover: a native tooltip (title) that says what a click will do — in the tile view, the list view and Playlists', async ({ page }) => {
    test.setTimeout(120_000);
    await openAs(page, 'assets', OWNER_WINDOW);
    const hit = () => page.getByTestId('select-shown').locator('xpath=ancestor::label[1]');
    // tiles: the heading box
    await expect(hit()).toHaveAttribute('title', 'Select all files shown');
    await page.getByTestId('select-shown').check();
    await expect(hit()).toHaveAttribute('title', 'Clear selection');
    await expect(page.getByRole('checkbox', { name: 'Select Demo photo 0.png' }).locator('xpath=ancestor::label[1]')).toHaveAttribute('title', 'Select Demo photo 0.png');
    // list: the table header's box, same words in the same states
    await page.getByTestId('select-shown').uncheck();
    await page.getByRole('button', { name: 'List view' }).evaluate((el) => (el as HTMLElement).click());
    await page.getByRole('table').waitFor();
    await expect(hit()).toHaveAttribute('title', 'Select all files shown');
    await page.getByTestId('select-shown').check();
    await expect(hit()).toHaveAttribute('title', 'Clear selection');
  });

  test('Playlists: the table header\'s box says "Select all playlists shown", then "Clear selection"', async ({ page }) => {
    test.setTimeout(120_000);
    await openAs(page, 'playlists', OWNER_WINDOW);
    const hit = page.getByTestId('select-page').locator('xpath=ancestor::label[1]');
    await expect(hit).toHaveAttribute('title', 'Select all playlists shown');
    await page.getByTestId('select-page').check();
    await expect(hit).toHaveAttribute('title', 'Clear selection');
  });

  test('a tile\'s box waits for the pointer — hover or keyboard focus brings it — until anything is selected, then every tile shows one', async ({ page }) => {
    test.setTimeout(120_000);
    await openAs(page, 'assets', OWNER_WINDOW);
    const tiles = page.getByTestId('files-grid').locator('li');
    const chip = (i: number) => tiles.nth(i).locator('div.absolute').filter({ has: page.locator('input[type="checkbox"]') }).first();
    const opacity = async (i: number) => Number(await chip(i).evaluate((el) => getComputedStyle(el).opacity));

    await page.mouse.move(1, 1);
    await expect.poll(() => opacity(0)).toBe(0);
    await expect.poll(() => opacity(3)).toBe(0);
    // hover
    await tiles.nth(0).hover();
    await expect.poll(() => opacity(0)).toBe(1);
    await expect.poll(() => opacity(3)).toBe(0);
    // keyboard focus
    await page.mouse.move(1, 1);
    await tiles.nth(2).getByRole('checkbox').focus();
    await expect.poll(() => opacity(2)).toBe(1);
    // anything selected → every tile shows its box
    await page.mouse.move(1, 1);
    await tiles.nth(2).getByRole('checkbox').check();
    await page.mouse.move(1, 1);
    for (const i of [0, 3, 7]) await expect.poll(() => opacity(i)).toBe(1);
    // …and a selected tile wears the ring
    await expect(tiles.nth(2)).toHaveClass(/ring-indigo-200/);
  });
});

test.describe('a phone (390 × 844, touch)', () => {
  test.use({ hasTouch: true, isMobile: true });
  const PHONE = { width: 390, height: 844 };

  test('Media Library: every tile shows its own box with nothing selected, and every box is a 44 px target', async ({ page }) => {
    test.setTimeout(120_000);
    await openAs(page, 'assets', PHONE);
    const tiles = page.getByTestId('files-grid').locator('li');
    const boxes = tiles.getByRole('checkbox');
    await expect(boxes.first()).toBeVisible();
    for (const i of [0, 1, 5]) {
      const chip = boxes.nth(i).locator('xpath=ancestor::div[1]');
      expect(Number(await chip.evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
      const hit = await boxes.nth(i).locator('xpath=ancestor::label[1]').boundingBox();
      expect(hit!.width).toBeGreaterThanOrEqual(44);
      expect(hit!.height).toBeGreaterThanOrEqual(44);
    }
    // the select-all box over the tiles too (compact, but 44 px for a finger)
    const head = await page.getByTestId('select-shown').locator('xpath=ancestor::label[1]').boundingBox();
    expect(head!.width).toBeGreaterThanOrEqual(44);
    expect(head!.height).toBeGreaterThanOrEqual(44);
  });

  test('Media Library, list view: the header box and the row boxes are 44 px targets and the header row does not grow', async ({ page }) => {
    test.setTimeout(120_000);
    await openAs(page, 'assets', PHONE);
    await page.getByRole('button', { name: 'List view' }).evaluate((el) => (el as HTMLElement).click());
    const table = page.getByRole('table');
    await table.waitFor();
    for (const box of [page.getByTestId('select-shown'), table.getByRole('checkbox', { name: 'Select Demo photo 0.png' })]) {
      const hit = await box.locator('xpath=ancestor::label[1]').boundingBox();
      expect(hit!.width).toBeGreaterThanOrEqual(44);
      expect(hit!.height).toBeGreaterThanOrEqual(44);
    }
    // the extra reach is a negative margin, not extra height: the header row stays one text line plus its padding
    const headerRow = await table.locator('thead tr').boundingBox();
    expect(headerRow!.height).toBeLessThan(44);
  });

  test('Playlists: the card list has the heading box (the only select-all a phone has), 44 px, and ticking a card needs no hover', async ({ page }) => {
    test.setTimeout(120_000);
    await openAs(page, 'playlists', PHONE);
    const heading = page.getByTestId('select-page-heading');
    await expect(heading).toBeVisible();
    const hit = await heading.locator('xpath=ancestor::label[1]').boundingBox();
    expect(hit!.width).toBeGreaterThanOrEqual(44);
    expect(hit!.height).toBeGreaterThanOrEqual(44);
    await heading.tap();
    await expect(page.getByTestId('bulk-count')).toHaveText('6 selected');
  });
});
