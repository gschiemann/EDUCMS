/**
 * BUILDER — the Brand tab, ACTION-FIRST (owner, 2026-10-12: "branding page is
 * still useless, I can't do anything but add a logo … Apply brand should only
 * be available if they've done branding; what does Apply branding actually
 * do?").
 *
 * Real builder route, API mocked (same harness as
 * builder-tile-click-adds-widget.spec.ts). Every test drives the real panel
 * with a real pointer and asserts the CANVAS changed — never the store:
 *   - no brand → only "Set up your brand", no "Brand this template"
 *   - blank template: Add logo, move it, a background tile, text style tiles,
 *     text colour on the selected box, Recolor all, Brand this template + Undo
 *   - widget template: Brand this template restyles the ticker and fills the
 *     logo; a selected Clock gets "Selected Clock: Background"
 *   - EXTERNAL_HTML board: Brand this template reaches INSIDE the sandboxed
 *     board (brand accent CSS var + the logo in its `brand.logo` slot)
 *
 *   E2E_BASE=http://localhost:3517 pnpm exec playwright test -c playwright.sandbox.config.ts tests/e2e/builder-brand-tab.spec.ts
 *
 * Screenshots (one per step) land in docs/research/2026-10-12-brand-tab/
 * (gitignored).
 */
import path from 'path';
import { test, expect, type Page, type Route } from '@playwright/test';

const SCHOOL_ID = 'e2e-school';
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const SHOTS = path.resolve(__dirname, '../../../../docs/research/2026-10-12-brand-tab');
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const FAKE_USER = { id: 'u1', email: 'e2e@example.com', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false };

const b64url = (v: string) => Buffer.from(v).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const FAKE_TOKEN = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub: 'u1', exp: 4102444800 }))}.e2e`;

const LOGO_URL = `${ORIGIN}/icons/venue-os-256.png`;
const ORG_BRAND = {
  displayName: 'Riverside Academy',
  logoUrl: LOGO_URL,
  palette: { primary: '#1d4ed8', accent: '#f59e0b', ink: '#0f172a', surface: '#f8fafc' },
  fontHeading: 'Georgia',
  fontBody: 'Verdana',
};

type ZoneSeed = { id: string; name: string; widgetType: string; x: number; y: number; width: number; height: number; defaultConfig?: Record<string, unknown> };

function template(id: string, zones: ZoneSeed[]) {
  return {
    id,
    name: `E2E ${id}`,
    tenantId: SCHOOL_ID,
    isSystem: false,
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#ffffff',
    brandKit: null,
    zones: zones.map((z, i) => ({ templateId: id, zIndex: i + 1, sortOrder: i, sceneId: null, defaultConfig: {}, ...z })),
    scenes: [],
  };
}

async function openBuilder(page: Page, tpl: ReturnType<typeof template>, orgBrand: unknown) {
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }) : respond();
  const okJson = (route: Route, body: unknown) =>
    cors(route, () => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) }));
  const empty = (route: Route) => cors(route, () => route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }));
  await page.route(/http:\/\/api\.invalid\/.*/, empty);
  await page.route('**/api/v1/**', empty);
  await page.route('**/auth/me', (r) => okJson(r, FAKE_USER));
  await page.route('**/tenants', (r) => okJson(r, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID, vertical: 'K12' }]));
  await page.route('**/tenants/accessible', (r) => okJson(r, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID }]));
  await page.route(`**/templates/${tpl.id}`, (r) => okJson(r, tpl));
  await page.route(`**/templates/${tpl.id}/**`, (r) => okJson(r, tpl));
  await page.route('**/templates', (r) => okJson(r, [tpl]));
  await page.route('**/api/v1/branding/me', (r) => okJson(r, orgBrand));
  await page.route('**/screens', (r) => okJson(r, []));
  await page.route('**/playlists', (r) => okJson(r, []));
  await page.route('**/assets**', (r) => okJson(r, []));
  // A signed-in tab: the UI store boots its user (and so the tenant whose
  // /branding/me the Brand tab reads) from sessionStorage. Unsigned JWT, far exp.
  await page.addInitScript(({ token, user }: { token: string; user: string }) => {
    try {
      localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
      sessionStorage.setItem('edu_cms_token', token);
      sessionStorage.setItem('edu_cms_user', user);
    } catch { /* ignore */ }
  }, { token: FAKE_TOKEN, user: JSON.stringify(FAKE_USER) });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${SCHOOL_ID}/templates/builder/${tpl.id}`, { waitUntil: 'domcontentloaded' });
  await openBrandTab(page);
}

async function openBrandTab(page: Page) {
  const tab = page.getByRole('tab', { name: /^brand$/i });
  await tab.waitFor({ state: 'visible', timeout: 90_000 });
  await tab.click();
}

const canvas = (page: Page) => page.locator('[data-template-canvas]').first();
const panel = (page: Page) => page.getByTestId('brand-panel');
const shot = async (page: Page, name: string, browserName: string) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${browserName}-${name}.png` });
};
const zoneWithText = (page: Page, text: string | RegExp) => page.locator('[data-zone-id]').filter({ hasText: text });

/** The zone box relative to the canvas, in percent. */
async function zoneBoxPct(page: Page, zone: ReturnType<Page['locator']>) {
  const c = await canvas(page).boundingBox();
  const z = await zone.boundingBox();
  if (!c || !z) throw new Error('not measurable');
  return { x: ((z.x - c.x) / c.width) * 100, y: ((z.y - c.y) / c.height) * 100, r: ((z.x + z.width - c.x) / c.width) * 100, b: ((z.y + z.height - c.y) / c.height) * 100 };
}

test.describe('builder — Brand tab', () => {
  test.setTimeout(180_000);

  test('no brand set up: only "Set up your brand", no Brand this template', async ({ page, browserName }) => {
    await openBuilder(page, template('brand-none', [{ id: 'z1', name: 'Text', widgetType: 'TEXT', x: 10, y: 10, width: 40, height: 15, defaultConfig: { content: 'Hello' } }]), {});
    await expect(page.getByRole('heading', { name: 'Set up your brand' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Open Brand & appearance' })).toHaveAttribute('href', `/${SCHOOL_ID}/settings/branding`);
    await expect(page.getByRole('button', { name: 'Brand this template' })).toHaveCount(0);
    await shot(page, '01-no-brand', browserName);
  });

  test('blank template: every action changes the canvas', async ({ page, browserName }) => {
    await openBuilder(page, template('brand-blank', [{ id: 'ph', name: 'Full Screen', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100 }]), ORG_BRAND);
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('brand-checklist')).toContainText('Headings and body text in Georgia + Verdana');
    await shot(page, '02-panel', browserName);

    // LOGO — add, then move to the bottom-right corner.
    await page.getByRole('button', { name: 'Add logo' }).click();
    const logo = page.locator('[data-zone-id]').filter({ has: page.locator(`img[src="${LOGO_URL}"]`) }).first();
    await expect(logo).toBeVisible({ timeout: 15_000 });
    let box = await zoneBoxPct(page, logo);
    expect(box.x).toBeLessThan(6);
    expect(box.y).toBeLessThan(8);
    await page.getByRole('button', { name: 'Bottom right' }).click();
    await expect.poll(async () => (await zoneBoxPct(page, logo)).r, { timeout: 5_000 }).toBeGreaterThan(94);
    box = await zoneBoxPct(page, logo);
    expect(box.b).toBeGreaterThan(92);
    await shot(page, '03-logo-bottom-right', browserName);

    // BACKGROUND — a gradient tile sets the TEMPLATE background (logo stays selected).
    await page.getByRole('button', { name: 'Background: Brand gradient' }).click();
    await expect.poll(() => canvas(page).evaluate((el) => getComputedStyle(el).backgroundImage), { timeout: 5_000 }).toContain('linear-gradient');
    await shot(page, '04-background-gradient', browserName);
    await page.getByRole('button', { name: 'Background: Dark brand' }).click();
    await expect.poll(() => canvas(page).evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
    const darkBg = await canvas(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(darkBg).not.toBe('rgb(255, 255, 255)');

    // TEXT — a Heading tile adds a centred box in the brand heading font, readable on dark.
    await page.getByRole('button', { name: 'Add Heading text box' }).click();
    const heading = zoneWithText(page, 'Your headline').first();
    await expect(heading).toBeVisible();
    const p = heading.locator('[data-field="content"]').first();
    await expect.poll(() => p.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Georgia');
    const hb = await zoneBoxPct(page, heading);
    expect(Math.abs((hb.x + hb.r) / 2 - 50)).toBeLessThan(2);
    await expect(panel(page)).toBeVisible(); // stayed on the Brand tab
    await shot(page, '05-heading-added', browserName);

    // Text colour applies to the selected (new) heading.
    const swatch = page.getByRole('button', { name: 'Text color Accent #f59e0b' });
    await expect(swatch).toBeEnabled();
    await swatch.click();
    await expect.poll(() => p.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(245, 158, 11)');

    // Call to action pill.
    await page.getByRole('button', { name: 'Add Call to action text box' }).click();
    const cta = zoneWithText(page, 'Learn more').first();
    await expect(cta).toBeVisible();
    const pill = cta.locator('[data-widget-content] div').first();
    await expect.poll(() => pill.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(29, 78, 216)');
    // A pill, not a square: the painted wrapper is rounded.
    await expect.poll(() => cta.locator('[data-widget-content]').first().evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThan(20);
    await shot(page, '06-cta-added', browserName);

    // Recolor all text → a heading made unreadable (dark ink on the dark
    // background) gets a brand colour that reads on it again.
    await zoneWithText(page, 'Your headline').first().click();
    await openBrandTab(page);
    await page.getByRole('button', { name: 'Text color Text #0f172a' }).click();
    await expect.poll(() => p.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(15, 23, 42)');
    await page.getByRole('button', { name: 'Recolor all text' }).click();
    await expect.poll(() => p.evaluate((el) => getComputedStyle(el).color)).not.toBe('rgb(15, 23, 42)');

    // BRAND THIS TEMPLATE — background becomes the brand gradient, Undo puts the dark one back.
    await page.getByRole('button', { name: 'Brand this template' }).click();
    await expect(page.getByText(/^Brand applied: /).first()).toBeVisible();
    await expect.poll(() => canvas(page).evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
    await shot(page, '07-brand-this-template', browserName);
    await panel(page).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => canvas(page).evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
  });

  test('widget template: Brand this template restyles widgets; a selected Clock gets its own background', async ({ page, browserName }) => {
    await openBuilder(page, template('brand-widgets', [
      { id: 'ticker', name: 'Ticker', widgetType: 'TICKER', x: 0, y: 88, width: 100, height: 12, defaultConfig: { messages: ['Welcome back'] } },
      { id: 'logo', name: 'Logo', widgetType: 'LOGO', x: 2, y: 2, width: 12, height: 18, defaultConfig: {} },
      { id: 'clock', name: 'Clock', widgetType: 'CLOCK', x: 70, y: 5, width: 25, height: 20, defaultConfig: {} },
      { id: 'text', name: 'Text', widgetType: 'TEXT', x: 20, y: 35, width: 60, height: 20, defaultConfig: { content: 'Big news today' } },
    ]), ORG_BRAND);
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Brand this template' }).click();
    await expect(page.locator('[data-zone-id="logo"] img').first()).toHaveAttribute('src', LOGO_URL, { timeout: 10_000 });
    const text = page.locator('[data-zone-id="text"] [data-field="content"]').first();
    await expect.poll(() => text.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Georgia');
    await expect.poll(() => canvas(page).evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
    await shot(page, '08-widgets-branded', browserName);

    // Select the clock on the canvas, come back to Brand: "Selected Clock: Background".
    await page.locator('[data-zone-id="clock"]').click();
    await openBrandTab(page);
    await expect(page.getByText('Selected Clock: Background')).toBeVisible();
    await page.getByRole('button', { name: 'Clock background Accent #f59e0b' }).click();
    await expect.poll(() => page.locator('[data-zone-id="clock"] [data-widget-content]').first().evaluate((el) => {
      const all = [el, ...Array.from(el.querySelectorAll('*'))] as HTMLElement[];
      return all.some((n) => getComputedStyle(n).backgroundColor === 'rgb(245, 158, 11)');
    }), { timeout: 5_000 }).toBe(true);
    // Text colour stays disabled with a non-text widget selected.
    await expect(page.getByRole('button', { name: 'Text color Accent #f59e0b' })).toBeDisabled();
    await shot(page, '09-clock-background', browserName);
  });

  test('EXTERNAL_HTML board: Brand this template reaches inside the board', async ({ page, browserName }) => {
    const url = '/templates/signage/corporate/01-lobby-welcome-flagship.html';
    await openBuilder(page, template('brand-board', [
      { id: 'board', name: 'Board', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, defaultConfig: { url } },
    ]), ORG_BRAND);
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    const frameSel = '[data-zone-id="board"] iframe';
    await page.locator(frameSel).first().waitFor({ state: 'attached', timeout: 30_000 });
    const boardFrame = () => page.frames().find((f) => f.url().includes('01-lobby-welcome-flagship'));
    await expect.poll(() => !!boardFrame(), { timeout: 30_000 }).toBe(true);
    const accentBefore = await boardFrame()!.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(accentBefore.toLowerCase()).not.toBe('#f59e0b');
    await shot(page, '10-board-before', browserName);

    await page.getByRole('button', { name: 'Brand this template' }).click();
    // The brand rides the iframe URL → the board reloads with it.
    await expect.poll(async () => {
      const f = boardFrame();
      if (!f) return '';
      try { return (await f.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toLowerCase(); } catch { return ''; }
    }, { timeout: 20_000 }).toBe('#f59e0b');
    await expect.poll(async () => {
      const f = boardFrame();
      if (!f) return '';
      try { return await f.evaluate(() => getComputedStyle(document.querySelector('[data-imgslot="brand.logo"]') as Element).backgroundImage); } catch { return ''; }
    }, { timeout: 20_000 }).toContain('venue-os-256.png');
    await shot(page, '11-board-branded', browserName);
  });
});
