import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * LED POSTER CANVAS — the NovaStar TB poster rule, in a real browser
 * (2026-09-01, LED poster field install).
 *
 * A TB poster (Rockchip rk356x_box WebView on Chromium 83) shows the TOP-LEFT
 * of its Android OS canvas on the LED, point-to-point. ViPlex floors the OS
 * width at 600 and ships at 1920; a single 1.86 mm poster is 320×1080 and
 * other pitches differ (1.56 mm ≈ 360×1200). Before pairing there is no
 * tenant and no dashboard value, so the pairing code used to draw centred on
 * a 600 or 1920 canvas — off the LED ("i was able to connect a keyboard and
 * mouse and just guess at where to hit enter"). Chains are set by the
 * operator as the OS width in ViPlex ("960x1080 for 3 screens … auto detect
 * and presents perfectly") and must keep working untouched.
 *
 * Pinned here, per the reference rule in apps/web/src/app/player/posterCanvas.ts:
 *   • unpaired, OS 600 or 1920 → the document is 320×1080 and the whole
 *     pairing code sits inside x < 320 (the visible column);
 *   • unpaired, OS 960 → a 3-panel chain: the document is 960 wide;
 *   • paired with no canvas set → the tenant standard sizes a single poster
 *     (320 on OS 1920; 360×1200 on a 1.56 mm tenant with OS 1080×1200 = chain);
 *   • paired with an explicit dashboard canvas → that canvas, persisted to
 *     storage — a derived size is never persisted;
 *   • a non-poster box on the same code path is untouched (2160×3840 GUQ).
 *
 * Harness rules as in player-remote-escape.spec.ts (delegating WS stub, mocks
 * keyed on state, fake API base only).
 */

const POSTER_UA =
  'Mozilla/5.0 (Linux; Android 11; rk356x_box Build/RQ2A.210505.003; wv) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.120 Safari/537.36 EduC';
const GUQ_UA =
  'Mozilla/5.0 (Linux; Android 11; M55GUQ-CS1382D-C Build/RD2A.211001.002; wv) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Safari/537.36';

const FAKE_SCREEN_ID = 'test-screen-00000000post';
const FAKE_TENANT_ID = 'test-tenant-00000000post';
const FAKE_FINGERPRINT = 'test-fp-poster-canvas';
const BOOT_TOKEN = 'boot.stored.token-not-real';
const PAIRING_CODE = '751234';

type MockState = {
  paired: boolean;
  canvas: { w: number; h: number } | null;
  standard: { w: number; h: number } | null;
};

async function installMocks(page: Page, state: MockState) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.addInitScript(({ token }) => {
    try {
      localStorage.setItem('edu_device_token', token);
      // A fresh box: no canvas pin, no cached standard.
      localStorage.removeItem('edu_canvasW');
      localStorage.removeItem('edu_canvasH');
      localStorage.removeItem('edu_posterStandard');
    } catch { /* ignore */ }
  }, { token: BOOT_TOKEN });

  await page.route('**/api/v1/screens/register', (route) =>
    state.paired
      ? ok(route, { paired: true, screenId: FAKE_SCREEN_ID, deviceToken: BOOT_TOKEN, tenantId: FAKE_TENANT_ID, tenantName: 'Poster Tenant', status: 'ONLINE' })
      : ok(route, { paired: false, screenId: FAKE_SCREEN_ID, pairingCode: PAIRING_CODE }),
  );
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest*`, (route) => ok(route, {
    screenId: FAKE_SCREEN_ID,
    screenName: 'Poster',
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Poster Tenant',
    orientation: 'PORTRAIT',
    isEmergency: false,
    canvasW: state.canvas?.w ?? null,
    canvasH: state.canvas?.h ?? null,
    posterStandard: state.standard ?? { w: 320, h: 1080 },
    hardwareModel: 'novastar-taurus',
    playlists: [],
  }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/status`, (route) => ok(route, { ok: true }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/pairing-status*`, (route) => ok(route, { paired: false }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/cache-status`, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/render-proof`, (route) => ok(route, { ok: true }, 201));
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/emergency/messages*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
  await page.route('**/api/v1/realtime/time*', (route) => ok(route, { serverTime: Date.now() }));
}

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
          type: 'AUTH_OK', payload: { serverTime: Date.now() }, idempotencyKey: 'auth-ok-poster', timestamp: Date.now(),
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

const ledVars = (page: Page) =>
  page.evaluate(() => {
    const st = document.documentElement.style;
    const px = (v: string) => parseInt(v.trim().replace('px', ''), 10) || 0;
    return {
      w: px(st.getPropertyValue('--led-w')),
      h: px(st.getPropertyValue('--led-h')),
      htmlW: Math.round(document.documentElement.getBoundingClientRect().width),
      htmlH: Math.round(document.documentElement.getBoundingClientRect().height),
      poster: document.documentElement.getAttribute('data-led-poster'),
      narrow: document.documentElement.getAttribute('data-led-narrow'),
      storedW: (() => { try { return localStorage.getItem('edu_canvasW'); } catch { return null; } })(),
    };
  });

/** Right edge (px) of the pairing-code row, in document coordinates. */
const codeRightEdge = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector('.kiosk-code-row') as HTMLElement | null;
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
  });

const boot = (page: Page, w: number, h: number) =>
  page.goto(`/player?fp=${FAKE_FINGERPRINT}&client=android&w=${w}&h=${h}`);

test.describe('LED poster — the pairing code lands in the visible column', () => {
  test.use({ userAgent: POSTER_UA, viewport: { width: 1920, height: 1080 } });

  for (const osW of [600, 1920]) {
    test(`unpaired at OS ${osW}×1080 → a single 320×1080 poster, code inside x<320`, async ({ page }) => {
      test.setTimeout(120_000);
      await installWsStub(page);
      await installMocks(page, { paired: false, canvas: null, standard: null });
      await boot(page, osW, 1080);
      await expect(page.locator('.kiosk-code-row')).toBeVisible({ timeout: 60_000 });
      const v = await ledVars(page);
      expect(v.w).toBe(320);
      expect(v.h).toBe(1080);
      expect(v.htmlW).toBe(320);
      expect(v.poster).toBe('auto');
      expect(v.narrow).toBe('1');
      const code = await codeRightEdge(page);
      expect(code).not.toBeNull();
      expect(code!.right).toBeLessThanOrEqual(320);
      expect(code!.width).toBeGreaterThan(0);
      // The derived size is never written to storage.
      expect(v.storedW).toBeNull();
      await page.screenshot({ path: `test-results/poster-unpaired-os${osW}.png`, clip: { x: 0, y: 0, width: 320, height: 1080 } });
    });
  }

  test('unpaired at OS 960×1080 (a 3-panel chain set in ViPlex) → the document is 960 wide', async ({ page }) => {
    test.setTimeout(120_000);
    await installWsStub(page);
    await installMocks(page, { paired: false, canvas: null, standard: null });
    await boot(page, 960, 1080);
    await expect(page.locator('.kiosk-code-row')).toBeVisible({ timeout: 60_000 });
    const v = await ledVars(page);
    expect(v.w).toBe(960);
    expect(v.htmlW).toBe(960);
    expect(v.poster).toBe('auto');
  });
});

test.describe('LED poster — paired, the tenant standard and explicit canvases', () => {
  test.use({ userAgent: POSTER_UA, viewport: { width: 1920, height: 1080 } });

  test('no canvas set, OS 1920 → one standard poster (320×1080), not persisted', async ({ page }) => {
    test.setTimeout(120_000);
    await installWsStub(page);
    await installMocks(page, { paired: true, canvas: null, standard: { w: 320, h: 1080 } });
    await boot(page, 1920, 1080);
    await expect(page.getByRole('heading', { name: 'Screen Paired Successfully' })).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await ledVars(page)).w, { timeout: 30_000 }).toBe(320);
    const v = await ledVars(page);
    expect(v.h).toBe(1080);
    expect(v.storedW).toBeNull();
  });

  test('a 1.56 mm tenant (360×1200) with OS 1080×1200 → a 3-panel chain at 1080×1200', async ({ page }) => {
    test.setTimeout(120_000);
    await installWsStub(page);
    await installMocks(page, { paired: true, canvas: null, standard: { w: 360, h: 1200 } });
    await boot(page, 1080, 1200);
    await expect(page.getByRole('heading', { name: 'Screen Paired Successfully' })).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await ledVars(page)).w, { timeout: 30_000 }).toBe(1080);
    expect((await ledVars(page)).h).toBe(1200);
  });

  test('an explicit dashboard canvas (2 panels = 640×1080) wins over the OS width and is persisted', async ({ page }) => {
    test.setTimeout(120_000);
    await installWsStub(page);
    await installMocks(page, { paired: true, canvas: { w: 640, h: 1080 }, standard: { w: 320, h: 1080 } });
    await boot(page, 600, 1080);
    await expect(page.getByRole('heading', { name: 'Screen Paired Successfully' })).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await ledVars(page)).w, { timeout: 30_000 }).toBe(640);
    await expect.poll(async () => (await ledVars(page)).storedW, { timeout: 10_000 }).toBe('640');
  });
});

test.describe('not a poster — untouched', () => {
  test.use({ userAgent: GUQ_UA, viewport: { width: 720, height: 1280 }, deviceScaleFactor: 3 });

  test('a 2160×3840 GUQ panel keeps its OS canvas', async ({ page }) => {
    test.setTimeout(120_000);
    await installWsStub(page);
    await installMocks(page, { paired: true, canvas: null, standard: { w: 320, h: 1080 } });
    await boot(page, 2160, 3840);
    await expect(page.getByRole('heading', { name: 'Screen Paired Successfully' })).toBeVisible({ timeout: 60_000 });
    const v = await ledVars(page);
    expect(v.w).toBe(2160);
    expect(v.h).toBe(3840);
    expect(v.poster).toBeNull();
    expect(v.storedW).toBeNull();
  });
});
