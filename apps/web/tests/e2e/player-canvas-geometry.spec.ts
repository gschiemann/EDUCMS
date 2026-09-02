import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * PLAYER CANVAS GEOMETRY — the 2026-09-01 G-fleet P0, pinned in a real browser.
 *
 * On the 3× Android WebViews of the 2160×3840 portrait fleet (G43 / M43 /
 * GUQ55 / GUQ65 / M86 / L55VEC) the layout viewport is ~720×1280 CSS px while
 * the pin script in player/layout.tsx sizes the DOCUMENT to the panel's real
 * 2160×3840 (from `?w=&h=`). Every player root that sized itself with
 * `100vw × 100vh` — or with a `position: fixed` box whose four sides are 0 —
 * therefore covered ONE THIRD of the glass: templates drew in the top-left
 * corner with the rest black, and an emergency drill photographed "tiny
 * emergency images" on every G screen. The media branch was already sized
 * from `--led-w/--led-h`; the template wrapper, the ribbon-tile grid, the
 * emergency takeover + banner, the soft blank and the stopped overlay were
 * not. (Codex root-cause, 2026-09-01; exposed fleet-wide by the 08-24
 * AUTO→PORTRAIT orientation change. The stale-canvas-pin diagnosis that
 * preceded it was wrong — server canvas null, devices on the current bundle,
 * many templates affected.)
 *
 * The test reproduces the device geometry exactly — CSS viewport 720×1280,
 * deviceScaleFactor 3, `?w=2160&h=3840` — and asserts every root covers the
 * pinned canvas. A 1080p DPR-1 landscape pass guards the common case.
 *
 * Harness rules (same as player-remote-escape.spec.ts): never replace
 * window.WebSocket wholesale (delegate non-/realtime URLs); mocks key on
 * STATE; fake API base only.
 */

const FAKE_SCREEN_ID = 'test-screen-00000000geom';
const FAKE_TENANT_ID = 'test-tenant-00000000geom';
const FAKE_FINGERPRINT = 'test-fp-canvas-geometry';
const BOOT_TOKEN = 'boot.stored.token-not-real';

type MockState = { manifestMode: 'template' | 'emergency' };

/** A 1080×1920 portrait template with one full-bleed TEXT zone — the shape of
 *  the API's own synthetic emergency template (screens.controller.ts). */
function templatePlaylist() {
  return [{
    id: 'pl-geometry',
    name: 'Geometry probe',
    template: {
      id: 'tpl-geometry',
      name: 'Geometry probe',
      bgColor: '#123456',
      screenWidth: 1080,
      screenHeight: 1920,
      zones: [{
        id: 'z-full',
        x: 0, y: 0, width: 100, height: 100, zIndex: 1,
        widgetType: 'TEXT',
        defaultConfig: {
          sizeMode: 'absolute',
          content: 'GEOMETRY PROBE',
          fontSize: 140,
          fontWeight: 800,
          color: 'white',
          alignment: 'center',
          lineHeight: 1.15,
        },
      }],
    },
    items: [],
  }];
}

async function installMocks(page: Page, state: MockState) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.addInitScript(({ token }) => {
    try { localStorage.setItem('edu_device_token', token); } catch { /* ignore */ }
  }, { token: BOOT_TOKEN });

  await page.route('**/api/v1/screens/register', (route) => ok(route, {
    screenId: FAKE_SCREEN_ID, deviceToken: BOOT_TOKEN, paired: true,
    tenantId: FAKE_TENANT_ID, tenantName: 'Geometry Tenant', status: 'ONLINE',
  }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest*`, (route) => ok(route, {
    screenId: FAKE_SCREEN_ID,
    screenName: 'Geometry Screen',
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Geometry Tenant',
    orientation: 'PORTRAIT',
    isEmergency: state.manifestMode === 'emergency',
    ...(state.manifestMode === 'emergency'
      ? { emergencyType: 'LOCKDOWN', emergencySeverity: 'CRITICAL', emergencyScopeNote: 'Drill — geometry test' }
      : {}),
    playlists: templatePlaylist(),
  }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/status`, (route) => ok(route, { ok: true }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/cache-status`, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/render-proof`, (route) => ok(route, { ok: true }, 201));
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/emergency/messages*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
  await page.route('**/api/v1/realtime/time*', (route) => ok(route, { serverTime: Date.now() }));
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
          type: 'AUTH_OK', payload: { serverTime: Date.now() }, idempotencyKey: 'auth-ok-geom', timestamp: Date.now(),
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

type Rect = { w: number; h: number };
const rectOf = (page: Page, selector: string): Promise<Rect | null> =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  }, selector);

/** The template stage is the TemplateScaler child: the one scaled box inside the wrapper. */
const stageRect = (page: Page): Promise<Rect | null> =>
  page.evaluate(() => {
    const root = document.querySelector('[data-edu-player-root="template"]') as HTMLElement | null;
    if (!root) return null;
    // The largest positioned descendant with a transform is the scaled stage.
    // (Held in an object: TS narrows a closure-assigned `let` to `never`.)
    const found: { best: DOMRect | null } = { best: null };
    root.querySelectorAll<HTMLElement>('div').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.transform === 'none') return;
      const r = el.getBoundingClientRect();
      if (!found.best || r.width * r.height > found.best.width * found.best.height) found.best = r;
    });
    return found.best ? { w: Math.round(found.best.width), h: Math.round(found.best.height) } : null;
  });

function geometryCases() {
  return [
    {
      name: '3× portrait 4K (the G fleet): CSS viewport 720×1280, panel 2160×3840',
      viewport: { width: 720, height: 1280 }, dpr: 3, w: 2160, h: 3840,
    },
    {
      name: '1× landscape 1080p: CSS viewport 1920×1080, panel 1920×1080',
      viewport: { width: 1920, height: 1080 }, dpr: 1, w: 1920, h: 1080,
    },
  ];
}

for (const c of geometryCases()) {
  test.describe(`canvas geometry — ${c.name}`, () => {
    test.use({ viewport: c.viewport, deviceScaleFactor: c.dpr });

    test('the template wrapper, its scaled stage, and the paused overlay cover the pinned canvas', async ({ page }) => {
      test.setTimeout(120_000);
      const state: MockState = { manifestMode: 'template' };
      await installWsStub(page);
      await installMocks(page, state);
      await page.goto(`/player?fp=${FAKE_FINGERPRINT}&client=android&w=${c.w}&h=${c.h}`);

      await expect.poll(() => rectOf(page, '[data-edu-player-root="template"]'), { timeout: 60_000 })
        .not.toBeNull();
      // The document is pinned to the panel by the layout.tsx pin script.
      expect(await rectOf(page, 'html')).toEqual({ w: c.w, h: c.h });
      // THE BUG: this wrapper used to be 100vw×100vh = the layout viewport.
      expect(await rectOf(page, '[data-edu-player-root="template"]')).toEqual({ w: c.w, h: c.h });
      // The scaled stage fills ≥98% of the canvas on its cover axis (a
      // 1080×1920 design on 2160×3840 is an exact 2× fit).
      await expect.poll(async () => {
        const s = await stageRect(page);
        return s ? Math.max(s.w / c.w, s.h / c.h) : 0;
      }, { timeout: 15_000 }).toBeGreaterThanOrEqual(0.98);

      // The remote's Stop surface must cover the same canvas — an operator
      // pressing Back on a 3× panel used to get a third-of-glass dialog.
      // Stopped playback leaves the template branch and renders the media
      // root's diagnostics card; that root is sized from --led-w/--led-h.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('edu-show-stop-overlay')));
      await expect(page.getByRole('button', { name: /Resume/ })).toBeVisible({ timeout: 5_000 });
      expect(await rectOf(page, '[data-edu-player-root="media"]')).toEqual({ w: c.w, h: c.h });
    });

    test('the emergency takeover covers the pinned canvas', async ({ page }) => {
      test.setTimeout(120_000);
      const state: MockState = { manifestMode: 'emergency' };
      await installWsStub(page);
      await installMocks(page, state);
      await page.goto(`/player?fp=${FAKE_FINGERPRINT}&client=android&w=${c.w}&h=${c.h}`);
      // The tenant alert renders as the manifest's emergency template through
      // the same wrapper — that is the surface the drill photographed.
      await expect.poll(() => rectOf(page, '[data-edu-player-root="template"]'), { timeout: 60_000 })
        .not.toBeNull();
      expect(await rectOf(page, '[data-edu-player-root="template"]')).toEqual({ w: c.w, h: c.h });
      await expect.poll(async () => {
        const s = await stageRect(page);
        return s ? Math.max(s.w / c.w, s.h / c.h) : 0;
      }, { timeout: 15_000 }).toBeGreaterThanOrEqual(0.98);
    });
  });
}
