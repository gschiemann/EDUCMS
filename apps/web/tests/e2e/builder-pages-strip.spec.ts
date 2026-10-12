/**
 * BUILDER — Pages (renamed Scenes), owner 2026-10-12: "build it like Canva /
 * PowerPoint / Intuiface — a page thumbnail strip under the canvas … '+ Add
 * page' creates AND switches the canvas to the new blank page with an
 * empty-state hint … every button/touch widget gets 'When tapped → Go to page'
 * … hide the Pages tab and strip unless the template is interactive."
 *
 * Real builder route, API mocked (same harness as
 * builder-tile-click-adds-widget.spec.ts) with a STATEFUL scenes API so add /
 * rename / reorder / delete round-trip exactly like the server.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const SCHOOL_ID = 'e2e-school';
const TEMPLATE_ID = 'e2e-pages-template';
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const FAKE_USER = { id: 'u1', email: 'e2e@example.com', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false };

type Scene = { id: string; templateId: string; name: string; sortOrder: number; isDefault: boolean };

function template(interactive: boolean, scenes: Scene[]) {
  return {
    id: TEMPLATE_ID,
    name: 'E2E kiosk',
    tenantId: SCHOOL_ID,
    isSystem: false,
    isTouchEnabled: interactive,
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#ffffff',
    zones: [
      {
        id: 'zone-button', templateId: TEMPLATE_ID, name: 'Menu button', widgetType: 'TOUCH_POINT',
        x: 40, y: 40, width: 20, height: 15, zIndex: 2, sortOrder: 0,
        defaultConfig: { variant: 'touch-hotspot' }, sceneId: 'scene-home', touchAction: null,
      },
    ],
    scenes,
  };
}

async function openBuilder(page: Page, interactive: boolean) {
  const scenes: Scene[] = [{ id: 'scene-home', templateId: TEMPLATE_ID, name: 'Home', sortOrder: 0, isDefault: true }];
  let seq = 0;
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' })
      : respond();
  const okJson = (route: Route, body: unknown, status = 200) =>
    cors(route, () => route.fulfill({ status, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) }));
  const empty = (route: Route) => cors(route, () => route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }));

  await page.route(/http:\/\/api\.invalid\/.*/, empty);
  await page.route('**/api/v1/**', empty);
  await page.route('**/auth/me', (route) => okJson(route, FAKE_USER));
  await page.route('**/tenants', (route) => okJson(route, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID, vertical: 'K12' }]));
  await page.route('**/tenants/accessible', (route) => okJson(route, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID }]));
  await page.route(`**/templates/${TEMPLATE_ID}`, (route) => okJson(route, template(interactive, scenes)));
  await page.route(`**/templates/${TEMPLATE_ID}/**`, (route) => okJson(route, template(interactive, scenes)));
  await page.route(`**/templates/${TEMPLATE_ID}/scenes`, async (route) => {
    const m = route.request().method();
    if (m === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      const made: Scene = { id: `scene-new-${++seq}`, templateId: TEMPLATE_ID, name: body.name || 'Page', sortOrder: scenes.length, isDefault: false };
      scenes.push(made);
      return okJson(route, made, 201);
    }
    return okJson(route, scenes);
  });
  await page.route(`**/templates/${TEMPLATE_ID}/scenes/*`, async (route) => {
    const m = route.request().method();
    const id = route.request().url().split('/').pop()!;
    const i = scenes.findIndex((s) => s.id === id);
    if (m === 'PUT' && i >= 0) {
      const patch = JSON.parse(route.request().postData() || '{}');
      if (patch.isDefault) scenes.forEach((s) => { s.isDefault = false; });
      Object.assign(scenes[i], patch);
      return okJson(route, scenes[i]);
    }
    if (m === 'DELETE' && i >= 0) { scenes.splice(i, 1); return okJson(route, { success: true }); }
    return cors(route, () => route.fulfill({ status: 404, headers: CORS_HEADERS, body: '' }));
  });
  await page.route('**/templates', (route) => okJson(route, [template(interactive, scenes)]));
  await page.route('**/branding/me', (route) => okJson(route, {}));
  await page.route('**/screens', (route) => okJson(route, []));
  await page.route('**/playlists', (route) => okJson(route, []));
  await page.route('**/assets**', (route) => okJson(route, []));
  await page.addInitScript(() => {
    try { localStorage.setItem('edu_cms_eula_accepted_v1.0', '1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${SCHOOL_ID}/templates/builder/${TEMPLATE_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: /^widgets$/i }).waitFor({ state: 'visible', timeout: 60_000 });
  return scenes;
}

const strip = (page: Page) => page.locator('[data-page-strip]');

test.describe('builder — Pages', () => {
  test('a plain signage template shows no Pages tab and no strip', async ({ page }) => {
    await openBuilder(page, false);
    await expect(page.getByRole('tab', { name: /^pages$/i })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^scenes$/i })).toHaveCount(0);
    await expect(strip(page)).toHaveCount(0);
  });

  test('add a page, see it empty, link a button to it, rename it', async ({ page }) => {
    const scenes = await openBuilder(page, true);
    await expect(page.getByRole('tab', { name: /^pages$/i })).toBeVisible();
    await expect(strip(page)).toBeVisible();
    await expect(strip(page).getByRole('button', { name: /Open page Home/i })).toBeVisible();

    // + Add page → created AND opened, with the empty-page hint.
    await strip(page).getByRole('button', { name: /Add page/i }).click();
    await expect(strip(page).locator('[data-page-active="true"]')).toContainText('Page 2');
    await expect(page.locator('[data-empty-page-hint]')).toBeVisible();
    await expect(page.locator('[data-empty-page-hint]')).toContainText('Home');
    expect(scenes.map((s) => s.name)).toEqual(['Home', 'Page 2']);

    // Back to Home; the button there gets "When tapped → Go to page".
    await strip(page).getByRole('button', { name: /Open page Home/i }).click();
    await expect(page.locator('[data-empty-page-hint]')).toHaveCount(0);
    await page.locator('[data-zone-id="zone-button"]').click();
    const goTo = page.locator('[data-when-tapped] select');
    await expect(goTo).toBeVisible();
    await goTo.selectOption({ label: 'Page 2' });
    await expect(page.locator('[data-zone-id="zone-button"]')).toContainText('→ Page 2');

    // Rename from the strip (the page being edited carries its controls).
    await strip(page).getByRole('button', { name: /Open page Page 2/i }).click();
    await strip(page).getByRole('button', { name: /^Rename page$/i }).click();
    const input = strip(page).getByLabel(/Rename page/i);
    await input.fill('Menu');
    await input.press('Enter');
    await expect(strip(page).locator('[data-page-active="true"]')).toContainText('Menu');
    expect(scenes.find((s) => s.id !== 'scene-home')?.name).toBe('Menu');
  });

  test('reorder and delete pages from the strip', async ({ page }) => {
    const scenes = await openBuilder(page, true);
    await strip(page).getByRole('button', { name: /Add page/i }).click();
    await expect(strip(page).locator('[data-page-active="true"]')).toContainText('Page 2');
    await strip(page).getByRole('button', { name: /^Move left$/i }).click();
    await expect(strip(page).locator('[data-page-id]').first()).toContainText('Page 2');
    await expect.poll(() => scenes.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.name)).toEqual(['Page 2', 'Home']);

    await strip(page).getByRole('button', { name: /^Delete page$/i }).click();
    await page.getByRole('button', { name: /^Delete page$/i }).last().click(); // the confirm dialog
    await expect(strip(page).locator('[data-page-id]')).toHaveCount(1);
    expect(scenes.map((s) => s.name)).toEqual(['Home']);
  });
});
