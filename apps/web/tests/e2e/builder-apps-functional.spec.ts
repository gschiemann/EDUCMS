/**
 * BUILDER — every App works end to end (owner, 2026-10-12: "i click setup and
 * nothing happens, i see i can paste a url, is that all people do for vimeo?
 * also what are the full bleed settings in the side bar they dont do
 * anything, get the apps to be fully functional").
 *
 * Same mocked-API harness as builder-apps-add-to-canvas.spec.ts. Covers:
 *   1. "Set up Vimeo" on the canvas puts the caret in the link field, even
 *      while Properties is already showing that form;
 *   2. an UNLISTED Vimeo link keeps its hash all the way to the iframe;
 *   3. each finished layout builds what its card shows, with or without a
 *      link, and Undo takes it back in one step;
 *   4. a sweep over EVERY app in the registry: click its tile, fill its
 *      setup, save, and the zone goes live — or, for an app whose server
 *      keys are missing, the form says so instead of offering a dead button;
 *   5. the configured app renders in the Preview modal too.
 *
 * Screenshots land in docs/research/2026-10-12-apps-functional/ when
 * APPS_SHOTS=1 (the report's evidence), and are skipped otherwise.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import path from 'path';

const SCHOOL_ID = 'e2e-school';
const TEMPLATE_ID = 'e2e-blank-template';
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const FAKE_USER = { id: 'u1', email: 'e2e@example.com', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false };
const BLANK_TEMPLATE = {
  id: TEMPLATE_ID,
  name: 'E2E blank board',
  tenantId: SCHOOL_ID,
  isSystem: false,
  screenWidth: 3840,
  screenHeight: 2160,
  bgColor: '#ffffff',
  zones: [
    { id: 'zone-placeholder', templateId: TEMPLATE_ID, name: 'Full Screen', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {}, sceneId: null },
  ],
  scenes: [],
};

const SHOTS = process.env.APPS_SHOTS === '1';
const SHOT_DIR = path.resolve(__dirname, '../../../../docs/research/2026-10-12-apps-functional');
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  const browser = page.context().browser()?.browserType().name() ?? 'browser';
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOT_DIR, `${browser}-${name}.png` ) });
}

async function installApiMocks(page: Page) {
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
  await page.route(`**/templates/${TEMPLATE_ID}`, (route) => okJson(route, BLANK_TEMPLATE));
  await page.route(`**/templates/${TEMPLATE_ID}/**`, (route) => okJson(route, BLANK_TEMPLATE));
  await page.route('**/templates', (route) => okJson(route, [BLANK_TEMPLATE]));
  await page.route('**/branding/me', (route) => okJson(route, {}));
  await page.route('**/screens', (route) => okJson(route, []));
  await page.route('**/playlists', (route) => okJson(route, []));
  await page.route('**/assets**', (route) => okJson(route, []));
  // A deploy with no Meta / Google keys — the apps must SAY so.
  await page.route('**/integrations/social/status', (route) =>
    okJson(route, {
      providers: [
        { id: 'instagram', enabled: false, missing: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'] },
        { id: 'facebook', enabled: false, missing: ['META_APP_ID', 'META_APP_SECRET'] },
      ],
    }),
  );
  await page.route('**/integrations/google-reviews/status', (route) => okJson(route, { enabled: false }));
}

async function openBuilderOnApps(page: Page) {
  await installApiMocks(page);
  await page.addInitScript(() => {
    try { localStorage.setItem('edu_cms_eula_accepted_v1.0', '1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${SCHOOL_ID}/templates/builder/${TEMPLATE_ID}`, { waitUntil: 'domcontentloaded' });
  await openAppsTab(page);
}

async function openAppsTab(page: Page) {
  const appsTab = page.getByRole('tab', { name: /^apps$/i });
  await appsTab.waitFor({ state: 'visible', timeout: 90_000 });
  await appsTab.click();
  await page.getByRole('button', { name: /^YouTube/ }).first().waitFor({ state: 'visible', timeout: 60_000 });
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
async function clickAppTile(page: Page, name: string) {
  await openAppsTab(page);
  // `^Name\s`: a category chip is called just "Weather" / "Calendar".
  await page.getByRole('button', { name: new RegExp(`^${esc(name)}\\s`) }).first().click();
}

const VIMEO_UNLISTED = 'https://vimeo.com/76979871/8272103f6e';

test.describe('builder — apps are fully functional', () => {
  test('"Set up Vimeo" focuses the link field; an unlisted link keeps its hash on the canvas', async ({ page }) => {
    await openBuilderOnApps(page);
    await clickAppTile(page, 'Vimeo');
    const card = page.locator('[data-app-setup-card="vimeo"]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    const link = page.getByLabel(/Vimeo link/i);
    await expect(link).toBeVisible();
    // The operator's help, in their language.
    await expect(page.getByText(/Private videos: use an unlisted link/i)).toBeVisible();
    await shot(page, '01-vimeo-setup-before');

    // Move focus away, then press "Set up Vimeo" — Properties is ALREADY on
    // this form, which is exactly when the old button visibly did nothing.
    await page.getByRole('tab', { name: /^properties$/i }).focus();
    await expect(link).not.toBeFocused();
    await card.getByRole('button', { name: /Set up Vimeo/i }).click();
    await expect(link).toBeFocused();
    await shot(page, '02-vimeo-setup-button-focuses-link');

    // From another tab too.
    await page.getByRole('tab', { name: /^layers$/i }).click();
    await card.getByRole('button', { name: /Set up Vimeo/i }).click();
    await expect(page.getByLabel(/Vimeo link/i)).toBeFocused();

    await page.getByLabel(/Vimeo link/i).fill(VIMEO_UNLISTED);
    await page.getByRole('button', { name: /Show it on the board/i }).click();
    await expect(card).toHaveCount(0);
    const frame = page.locator('[data-zone-id][data-widget-type="STREAMING"] iframe').first();
    await expect(frame).toHaveAttribute('src', /player\.vimeo\.com\/video\/76979871\?h=8272103f6e/);
    await shot(page, '03-vimeo-configured-after');
  });

  test('finished layouts: "Full-bleed + branded title" and "clock rail" build what the card shows; Undo takes it back', async ({ page }) => {
    await openBuilderOnApps(page);
    await clickAppTile(page, 'Vimeo');
    await expect(page.locator('[data-app-setup-card="vimeo"]')).toBeVisible({ timeout: 15_000 });
    const zones = page.locator('[data-zone-id]');
    await expect(zones).toHaveCount(1);

    // 1. BEFORE a link: the layout still builds; its app slot asks for setup.
    await page.locator('[data-app-layout="full-bleed-titled"]').click();
    await expect(page.locator('[data-zone-id][data-widget-type="TEXT"]')).toHaveCount(1);
    await expect(page.locator('[data-zone-id][data-widget-type="STREAMING"]')).toHaveCount(1);
    await expect(page.locator('[data-app-setup-card="vimeo"]')).toBeVisible();
    await expect(page.getByLabel(/Vimeo link/i)).toBeFocused();
    await expect(page.locator('[data-zone-id][data-widget-type="TEXT"]')).toContainText('Now Playing');
    await shot(page, '04-layout-full-bleed-titled-no-link');

    // Undo — one step back to the single pending zone.
    await page.keyboard.press('Escape');
    await page.locator('body').click({ position: { x: 5, y: 890 } }).catch(() => {});
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(page.locator('[data-zone-id][data-widget-type="TEXT"]')).toHaveCount(0);
    await expect(page.locator('[data-zone-id]')).toHaveCount(1);

    // 2. WITH a link: the clock rail — the video live on the left, clock right.
    await page.locator('[data-zone-id][data-widget-type="STREAMING"]').first().click();
    await page.getByLabel(/Vimeo link/i).fill(VIMEO_UNLISTED);
    await page.locator('[data-app-layout="clock-rail"]').click();
    await expect(page.locator('[data-zone-id][data-widget-type="CLOCK"]')).toHaveCount(1);
    await expect(page.locator('[data-app-setup-card="vimeo"]')).toHaveCount(0);
    await expect(page.locator('[data-zone-id][data-widget-type="STREAMING"] iframe').first()).toHaveAttribute('src', /player\.vimeo\.com/);
    await shot(page, '05-layout-clock-rail-with-link');

    // 3. And the full-bleed one with the link, for the record.
    await page.locator('[data-zone-id][data-widget-type="STREAMING"]').first().click();
    await page.locator('[data-app-change="vimeo"]').click();
    await page.locator('[data-app-layout="full-bleed-titled"]').click();
    await expect(page.locator('[data-zone-id][data-widget-type="TEXT"]')).toHaveCount(1);
    await shot(page, '06-layout-full-bleed-titled-with-link');

    // The Preview modal renders the configured app too.
    await page.getByRole('button', { name: /fullscreen preview/i }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal.locator('iframe[src*="player.vimeo.com"]').first()).toBeAttached();
    await shot(page, '07-preview-modal-vimeo-layout');
  });

  // ── The sweep ────────────────────────────────────────────────────────
  // Tile name → what to type → the widget the zone must become. Every app in
  // APP_REGISTRY is covered: the link/text apps here, Clock and the three
  // server-keyed apps below. The jest twin (registry-sweep.test.ts) fails if
  // an app is added to the registry without sample input.
  type Fill = { label: RegExp; value: string; kind?: 'fill' };
  const SWEEP: Array<{ id: string; tile: string; fills: Fill[]; widget: string; renders?: string }> = [
    { id: 'youtube', tile: 'YouTube', fills: [{ label: /YouTube link/i, value: 'https://youtu.be/dQw4w9WgXcQ' }], widget: 'STREAMING', renders: 'iframe[src*="youtube.com/embed/dQw4w9WgXcQ"]' },
    { id: 'vimeo', tile: 'Vimeo', fills: [{ label: /Vimeo link/i, value: 'https://vimeo.com/channels/staffpicks/76979871' }], widget: 'STREAMING', renders: 'iframe[src*="player.vimeo.com/video/76979871"]' },
    { id: 'twitch', tile: 'Twitch', fills: [{ label: /Twitch channel/i, value: 'venueos' }], widget: 'STREAMING', renders: 'iframe[src*="player.twitch.tv"]' },
    { id: 'google-slides', tile: 'Google Slides', fills: [{ label: /Google Slides link/i, value: 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQr/edit' }], widget: 'WEBPAGE' },
    { id: 'powerpoint-onedrive', tile: 'PowerPoint / OneDrive', fills: [{ label: /PowerPoint share link/i, value: 'https://onedrive.live.com/embed?resid=ABC123&authkey=XYZ' }], widget: 'WEBPAGE' },
    { id: 'canva', tile: 'Canva', fills: [{ label: /Canva share link/i, value: 'https://www.canva.com/design/DAF123abc/view' }], widget: 'WEBPAGE' },
    { id: 'google-sheets', tile: 'Google Sheets', fills: [{ label: /Google Sheets link/i, value: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIj/edit' }], widget: 'WEBPAGE' },
    { id: 'web-url', tile: 'Web Page / URL', fills: [{ label: /Web page link/i, value: 'https://example.com' }], widget: 'WEBPAGE' },
    { id: 'google-maps', tile: 'Google Maps', fills: [{ label: /Address or place name/i, value: '1 Main St, Springfield, IL' }], widget: 'WEBPAGE' },
    { id: 'qr-code', tile: 'QR Code', fills: [{ label: /Link or text to encode/i, value: 'https://example.com/menu' }], widget: 'TOUCH_POINT', renders: 'svg, canvas, img' },
    { id: 'countdown', tile: 'Countdown', fills: [{ label: /Count down to/i, value: '2026-12-25' }], widget: 'COUNTDOWN' },
    { id: 'weather', tile: 'Weather', fills: [{ label: /City or ZIP code/i, value: 'Chicago, IL' }], widget: 'WEATHER' },
    { id: 'news-rss', tile: 'News / RSS', fills: [{ label: /news feed link/i, value: 'https://example.com/feed.xml' }], widget: 'RSS_FEED' },
    { id: 'calendar', tile: 'Calendar', fills: [{ label: /Google Calendar link/i, value: 'https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com' }], widget: 'WEBPAGE' },
    { id: 'social-wall', tile: 'Social Wall', fills: [{ label: /social wall link/i, value: 'https://my.walls.io/venueos' }], widget: 'WEBPAGE' },
  ];

  test('sweep: every link/text app sets up, saves, and goes live on the canvas', async ({ page }) => {
    test.setTimeout(240_000);
    await openBuilderOnApps(page);
    for (const app of SWEEP) {
      await clickAppTile(page, app.tile);
      const card = page.locator(`[data-app-setup-card="${app.id}"]`);
      await expect(card, `${app.id}: Set up card on the canvas`).toBeVisible({ timeout: 15_000 });
      const save = page.getByRole('button', { name: /Show it on the board/i });
      // Not valid yet → the primary button is off and names what is missing.
      await expect(page.locator(`[data-app-setup="${app.id}"]`)).toBeVisible();
      for (const f of app.fills) await page.getByLabel(f.label).first().fill(f.value);
      await expect(save, `${app.id}: Save enables once valid`).toBeEnabled();
      await save.click();
      await expect(card, `${app.id}: setup card closes`).toHaveCount(0);
      await expect(page.locator(`[data-app-change="${app.id}"]`), `${app.id}: Properties shows the finished app`).toBeVisible();
      const zone = page.locator(`[data-zone-id][data-widget-type="${app.widget}"]`).last();
      await expect(zone, `${app.id}: zone is the ${app.widget} widget`).toBeVisible();
      if (app.renders) await expect(zone.locator(app.renders).first(), `${app.id}: renders`).toBeAttached();
      if (app.id === 'qr-code' || app.id === 'youtube') await shot(page, `08-sweep-${app.id}-configured`);
    }
  });

  test('sweep: Clock needs no setup — it lands live', async ({ page }) => {
    await openBuilderOnApps(page);
    await clickAppTile(page, 'Clock');
    await expect(page.locator('[data-zone-id][data-widget-type="CLOCK"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-app-setup-card="clock"]')).toHaveCount(0);
  });

  test('sweep: Instagram, Facebook and Google Reviews say what is missing instead of offering a dead button', async ({ page }) => {
    await openBuilderOnApps(page);
    for (const [tile, id, msg] of [
      ['Instagram', 'instagram', /Ask your admin to add the Meta app keys/i],
      ['Facebook Page', 'facebook-page', /Ask your admin to add the Meta app keys/i],
      ['Google Reviews', 'google-reviews', /Ask your admin to add a Google Maps API key/i],
    ] as const) {
      await clickAppTile(page, tile);
      await expect(page.locator(`[data-app-setup-card="${id}"]`)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(msg).first()).toBeVisible();
      // No Connect button that would 503.
      await expect(page.getByRole('button', { name: /^Connect/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Show it on the board|to continue/i })).toBeDisabled();
      await shot(page, `09-unconfigured-${id}`);
    }
  });
});
