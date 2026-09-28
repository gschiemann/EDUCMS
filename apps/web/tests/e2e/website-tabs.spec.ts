/**
 * WEBSITE TABS — the 30-second happy path and the three screens it lands on
 * (2026-09-28), in a real browser, chromium + webkit.
 *
 * Greg: "customers want to push multiple sites and give tabs to flip thru but
 * still lock those sites on the screen … make it dumb simple."
 *
 *   1. BUILDER — Widgets → "Add Website Tabs" → paste a URL → Enter. The tab
 *      names + icons itself from the (mocked) site check and shows its
 *      verdict; the canvas tab bar shows the named tab. The test times it.
 *   2. BROWSER PLAYER — the template plays as a tab bar over a sandboxed
 *      frame; a tap switches sites; a site that blocks framing gets the
 *      honest card; Home returns to the first site.
 *   3. OUR APP — with a native channel that advertises `webTabsShow`, the
 *      player posts the URL + device-pixel bounds + default-deny allowlist
 *      to the APK and mounts no frame at all.
 *   4. NO ESCAPE — a Touch Button `url` action opens the in-place overlay
 *      (Close button focus-parked); it never opens a second page.
 *
 * Harness rules (credential-lifecycle / remote-escape specs): every API call
 * is mocked on the api.invalid base; the WS stub delegates non-/realtime
 * URLs; mocks key on state.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};

// ─── the sites the kiosk shows (served by the test, never the network) ────
const SITE_HTML = (title: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body style="font:32px sans-serif;padding:40px"><h1 id="site">${title}</h1><a href="/more">More</a></body></html>`;

async function serveSites(page: Page) {
  await page.route(/https:\/\/(www\.)?district\.example\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: SITE_HTML('District site') }),
  );
  await page.route(/https:\/\/(www\.)?lunch\.example\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: SITE_HTML('Lunch menu') }),
  );
  await page.route(/https:\/\/(www\.)?google\.com\/.*/, (route) => route.fulfill({ status: 204, body: '' }));
}

// ═══════════════════════════════════════════════════════════════════════
// 1. BUILDER
// ═══════════════════════════════════════════════════════════════════════

const SCHOOL_ID = 'e2e-school';
const TEMPLATE_ID = 'e2e-blank-template';
const FAKE_USER = { id: 'u1', email: 'e2e@example.com', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false };
const BLANK_TEMPLATE = {
  id: TEMPLATE_ID,
  name: 'E2E blank board',
  tenantId: SCHOOL_ID,
  isSystem: false,
  screenWidth: 1920,
  screenHeight: 1080,
  bgColor: '#ffffff',
  zones: [
    { id: 'zone-placeholder', templateId: TEMPLATE_ID, name: 'Full Screen', widgetType: 'TEXT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {}, sceneId: null },
  ],
  scenes: [],
};

async function installBuilderMocks(page: Page) {
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }) : respond();
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
  // THE ONE CALL THE PANEL MAKES: the site check.
  await page.route('**/api/v1/proxy/site-check', (route) =>
    okJson(route, {
      ok: true,
      url: 'https://district.example/',
      finalUrl: 'https://district.example/',
      status: 200,
      name: 'Lincoln High',
      iconUrl: 'https://district.example/icon.png',
      embed: 'ok',
      reason: null,
      contentType: 'text/html',
    }),
  );
  await page.route(/https:\/\/(www\.)?district\.example\/.*/, (route) => route.fulfill({ status: 204, body: '' }));
}

test.describe('Website Tabs — builder happy path', () => {
  test('Widgets → Add Website Tabs → paste a URL → the tab names itself, in well under 30 s', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await installBuilderMocks(page);
    await page.addInitScript(() => {
      try { localStorage.setItem('edu_cms_eula_accepted_v1.0', '1'); } catch { /* ignore */ }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${SCHOOL_ID}/templates/builder/${TEMPLATE_ID}`, { waitUntil: 'domcontentloaded' });

    const widgetsTab = page.getByRole('tab', { name: /^widgets$/i });
    await widgetsTab.waitFor({ state: 'visible', timeout: 60_000 });
    await widgetsTab.click();
    const card = page.getByRole('button', { name: /Add Website Tabs/i }).first();
    await card.waitFor({ state: 'visible', timeout: 60_000 });

    const started = Date.now();
    await card.click();

    // The canvas now carries the widget's own "paste your first website".
    await expect(page.getByText('Paste your first website').first()).toBeVisible({ timeout: 15_000 });

    // The panel for the filled zone: paste, Enter.
    const paste = page.getByTestId('wt-paste');
    if (!(await paste.isVisible().catch(() => false))) {
      await page.locator('[data-zone-id]').first().click();
      await page.getByRole('tab', { name: /^properties$/i }).click();
    }
    await paste.waitFor({ state: 'visible', timeout: 15_000 });
    await paste.fill('district.example');
    await paste.press('Enter');

    // The tab filled itself in from the site check.
    await expect(page.getByTestId('wt-status')).toHaveAttribute('data-embed', 'ok', { timeout: 15_000 });
    await expect(page.getByTestId('wt-status')).toHaveText(/Loads/);
    await expect(page.locator('input[aria-label="Tab name"]').first()).toHaveValue('Lincoln High');
    // …and the canvas tab bar shows the named tab (the canvas preview never
    // mounts a live frame).
    await expect(page.locator('[data-testid^="website-tab-"]').first()).toHaveText(/Lincoln High/);
    expect(await page.locator('iframe[data-testid="website-tabs-frame"]').count()).toBe(0);

    const elapsedMs = Date.now() - started;
    // eslint-disable-next-line no-console
    console.log(`[website-tabs] builder happy path: tile click → named tab in ${elapsedMs} ms`);
    expect(elapsedMs).toBeLessThan(30_000);
    await page.screenshot({ path: testInfo.outputPath('builder-website-tabs-panel.png') });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2–4. PLAYER
// ═══════════════════════════════════════════════════════════════════════

const FAKE_SCREEN_ID = 'test-screen-000000webtabs';
const FAKE_TENANT_ID = 'test-tenant-000000webtabs';
const FAKE_FINGERPRINT = 'test-fp-website-tabs';
const BOOT_TOKEN = 'boot.stored.token-not-real';

type TemplateShape = 'tabs' | 'touch-button';

function templatePlaylist(shape: TemplateShape) {
  const zones =
    shape === 'tabs'
      ? [
          {
            id: 'z-tabs',
            x: 0, y: 0, width: 100, height: 100, zIndex: 1,
            widgetType: 'WEBSITE_TABS',
            defaultConfig: {
              tabs: [
                { id: 'district', name: 'District', url: 'https://www.district.example/', embed: 'ok' },
                { id: 'lunch', name: 'Lunch', url: 'https://lunch.example/menu', embed: 'ok' },
                { id: 'google', name: 'Google', url: 'https://www.google.com/', embed: 'blocked' },
              ],
              barPosition: 'top',
              showHome: true,
              idleReturnSec: 120,
              idleWarnSec: 10,
              incognito: true,
            },
          },
        ]
      : [
          {
            id: 'z-btn',
            x: 30, y: 30, width: 40, height: 20, zIndex: 1,
            widgetType: 'TOUCH_BUTTON',
            defaultConfig: { label: 'Menu', action: { type: 'url', target: 'https://www.district.example/' } },
          },
        ];
  return [{
    id: 'pl-webtabs',
    name: 'Website Tabs probe',
    template: {
      id: 'tpl-webtabs',
      name: 'Website Tabs probe',
      bgColor: '#0f172a',
      screenWidth: 1920,
      screenHeight: 1080,
      isTouchEnabled: true,
      zones,
    },
    items: [],
  }];
}

async function installPlayerMocks(page: Page, shape: TemplateShape) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

  await page.addInitScript(({ token }) => {
    try { localStorage.setItem('edu_device_token', token); } catch { /* ignore */ }
  }, { token: BOOT_TOKEN });

  await page.route(/http:\/\/api\.invalid\/.*/, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/screens/register', (route) => ok(route, {
    screenId: FAKE_SCREEN_ID, deviceToken: BOOT_TOKEN, paired: true,
    tenantId: FAKE_TENANT_ID, tenantName: 'Website Tabs Tenant', status: 'ONLINE',
  }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest*`, (route) => ok(route, {
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Website Tabs Tenant',
    orientation: 'LANDSCAPE',
    isEmergency: false,
    playlists: templatePlaylist(shape),
  }));
  await page.route(/\/api\/v1\/screens\/status\//, (route) => ok(route, { paired: true, screenId: FAKE_SCREEN_ID, name: 'Website Tabs Screen', tenantId: FAKE_TENANT_ID }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/status`, (route) => ok(route, { ok: true }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/emergency-assets`, (route) => ok(route, { assets: [], setHash: 'empty' }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/cache-status`, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/render-proof`, (route) => ok(route, { ok: true }, 201));
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/emergency/messages*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
  await page.route('**/api/v1/realtime/time*', (route) => ok(route, { serverTime: Date.now() }));
  await serveSites(page);
}

/** Delegating WS stub — only `/realtime` is stubbed; HMR keeps the real one. */
async function installWsStub(page: Page) {
  await page.addInitScript(() => {
    const RealWS = window.WebSocket;
    function StubOrReal(this: unknown, url: string, protocols?: unknown) {
      if (!String(url).includes('/realtime')) return new (RealWS as any)(url, protocols);
      const listeners: Record<string, Array<(ev: any) => void>> = {};
      const inst: any = {
        url, readyState: RealWS.CONNECTING,
        onopen: null, onmessage: null, onerror: null, onclose: null,
        send() { /* swallow */ },
        close(code = 1000, reason = '') { inst.readyState = RealWS.CLOSED; emit('close', { code, reason }); },
        addEventListener(type: string, fn: (ev: any) => void) { (listeners[type] ||= []).push(fn); },
        removeEventListener(type: string, fn: (ev: any) => void) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
      };
      const emit = (type: string, ev: any) => {
        const prop = inst['on' + type];
        if (typeof prop === 'function') prop.call(inst, ev);
        for (const fn of listeners[type] || []) fn(ev);
      };
      setTimeout(() => {
        inst.readyState = RealWS.OPEN; emit('open', {});
        setTimeout(() => emit('message', { data: JSON.stringify({
          type: 'AUTH_OK', payload: { serverTime: Date.now() }, idempotencyKey: 'auth-ok-webtabs', timestamp: Date.now(),
        }) }), 10);
      }, 5);
      return inst;
    }
    (StubOrReal as any).CONNECTING = RealWS.CONNECTING;
    (StubOrReal as any).OPEN = RealWS.OPEN;
    (StubOrReal as any).CLOSING = RealWS.CLOSING;
    (StubOrReal as any).CLOSED = RealWS.CLOSED;
    (window as any).WebSocket = StubOrReal;
  });
}

test.describe('Website Tabs — browser player (the fallback)', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('tabs over a sandboxed frame; a tap switches; a blocked site gets the honest card; Home returns', async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    await installWsStub(page);
    await installPlayerMocks(page, 'tabs');
    await page.goto(`/player?fp=${FAKE_FINGERPRINT}&w=1920&h=1080`);

    const bar = page.getByTestId('website-tabs-bar');
    await bar.waitFor({ state: 'visible', timeout: 60_000 });
    const frame = page.getByTestId('website-tabs-frame');
    await expect(frame).toHaveAttribute('src', 'https://www.district.example/');
    const sandbox = (await frame.getAttribute('sandbox')) || '';
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-top-navigation');
    expect(sandbox).not.toContain('allow-popups');
    // The site really rendered inside the frame.
    await expect(page.frameLocator('[data-testid="website-tabs-frame"]').locator('#site')).toHaveText('District site', { timeout: 20_000 });
    await page.screenshot({ path: testInfo.outputPath('player-fallback-tabs.png') });

    // Tabs are finger-sized.
    const box = await page.getByTestId('website-tab-lunch').boundingBox();
    expect(box && box.height).toBeGreaterThanOrEqual(64);

    await page.getByTestId('website-tab-lunch').click();
    await expect(page.getByTestId('website-tabs-frame')).toHaveAttribute('src', 'https://lunch.example/menu');
    await expect(page.getByTestId('website-tab-lunch')).toHaveAttribute('aria-selected', 'true');

    await page.getByTestId('website-tab-google').click();
    await expect(page.getByTestId('website-tabs-blocked')).toContainText('This site can only be shown on screens running the VenueOS app');
    expect(await page.locator('[data-testid="website-tabs-frame"]').count()).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('player-fallback-blocked-card.png') });

    await page.getByTestId('website-tabs-home').click();
    await expect(page.getByTestId('website-tab-district')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('website-tabs-frame')).toHaveAttribute('src', 'https://www.district.example/');

    // Nothing ever left the kiosk page.
    expect(context.pages().length).toBe(1);
  });
});

test.describe('Website Tabs — our app (native channel)', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('posts webTabsShow with bounds + allowlist to the APK and mounts no frame', async ({ page }) => {
    test.setTimeout(120_000);
    await installWsStub(page);
    await page.addInitScript(() => {
      (window as any).__posted = [];
      (window as any).EduCmsNativeChannel = { postMessage: (m: string) => { (window as any).__posted.push(m); } };
      (window as any).__eduCmsNativeChannelMethods = ['webTabsShow', 'webTabsHide', 'heartbeat', 'showUrlOverlay', 'hideUrlOverlay'];
    });
    await installPlayerMocks(page, 'tabs');
    await page.goto(`/player?fp=${FAKE_FINGERPRINT}&client=android&w=1920&h=1080`);

    await page.getByTestId('website-tabs-bar').waitFor({ state: 'visible', timeout: 60_000 });
    await expect(page.getByTestId('website-tabs-content')).toHaveAttribute('data-native', '1');
    expect(await page.locator('iframe[data-testid="website-tabs-frame"]').count()).toBe(0);

    await expect.poll(async () =>
      page.evaluate(() => ((window as any).__posted as string[]).filter((m) => JSON.parse(m).method === 'webTabsShow').length),
      { timeout: 15_000 },
    ).toBeGreaterThan(0);
    const last = await page.evaluate(() => {
      const shows = ((window as any).__posted as string[]).map((m) => JSON.parse(m)).filter((m) => m.method === 'webTabsShow');
      return JSON.parse(shows[shows.length - 1].args[0]);
    });
    expect(last.v).toBe(1);
    expect(last.url).toBe('https://www.district.example/');
    expect(last.allowHosts).toEqual(['district.example', 'lunch.example', 'google.com']);
    expect(last.incognito).toBe(true);
    // The site area sits BELOW the top tab bar: a real, non-empty rectangle
    // in DEVICE pixels (Desktop Safari runs at deviceScaleFactor 2, the
    // G-fleet at 3) that starts under the bar and reaches the bottom of
    // the canvas.
    const dpr: number = await page.evaluate(() => window.devicePixelRatio || 1);
    expect(last.bounds.top).toBeGreaterThan(40 * dpr);
    expect(last.bounds.width).toBeGreaterThan(1000 * dpr);
    expect(last.bounds.height).toBeGreaterThan(500 * dpr);
    expect(last.bounds.top + last.bounds.height).toBeLessThanOrEqual(1080 * dpr + 1);

    // A tap re-shows with the new URL — no frame, the APK switches the site.
    await page.getByTestId('website-tab-google').click();
    await expect.poll(async () =>
      page.evaluate(() => {
        const shows = ((window as any).__posted as string[]).map((m) => JSON.parse(m)).filter((m) => m.method === 'webTabsShow');
        return JSON.parse(shows[shows.length - 1].args[0]).url;
      }),
    ).toBe('https://www.google.com/');
    expect(await page.locator('[data-testid="website-tabs-blocked"]').count()).toBe(0);
  });
});

test.describe('Touch Button / Touch Menu links never leave the kiosk', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('a `url` action opens the in-place overlay with a focus-parked Close, not a new page', async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    await installWsStub(page);
    await installPlayerMocks(page, 'touch-button');
    await page.goto(`/player?fp=${FAKE_FINGERPRINT}&w=1920&h=1080`);

    const button = page.getByRole('button', { name: 'Menu' });
    await button.waitFor({ state: 'visible', timeout: 60_000 });
    await button.click();

    const close = page.getByRole('button', { name: 'Close' });
    await expect(close).toBeVisible({ timeout: 15_000 });
    await expect(close).toBeFocused();
    await expect(page.locator('iframe[title="Tap-action overlay"]')).toHaveAttribute('src', /\/api\/v1\/proxy\/web\?url=https%3A%2F%2Fwww\.district\.example/);
    expect(context.pages().length).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('touch-url-in-place-overlay.png') });

    await close.click();
    await expect(close).toBeHidden();
    await expect(button).toBeVisible();
  });
});
