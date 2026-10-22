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

const FAKE_SCREEN_ID = '00000000-0000-4000-8000-0000000000a1';
const FAKE_TENANT_ID = '00000000-0000-4000-8000-0000000000b1';
const FAKE_FINGERPRINT = 'test-fp-canvas-geometry';
const BOOT_TOKEN = `test.${Buffer.from(JSON.stringify({ kind: 'device', sub: FAKE_SCREEN_ID, tenantId: FAKE_TENANT_ID, exp: 4_102_444_800 })).toString('base64url')}.not-a-real-signature`;

type MockState = { manifestMode: 'template' | 'emergency'; emptyTemplate?: boolean; systemDefault?: boolean; drill?: boolean; orientation?: 'PORTRAIT' | 'LANDSCAPE'; message?: Record<string, unknown>; alertType?: string; failManifest?: boolean; proofs?: Array<any> };

/** A 1080×1920 portrait template with one full-bleed TEXT zone — the shape of
 *  the API's own synthetic emergency template (screens.controller.ts). */
function templatePlaylist(empty = false, systemDefault = false, drill = false) {
  return [{
    id: systemDefault ? 'DEFAULT_EMERGENCY' : 'pl-geometry',
    name: 'Geometry probe',
    contentRev: empty ? 'empty' : 'ready',
    template: {
      id: systemDefault ? undefined : 'tpl-geometry',
      name: systemDefault ? 'EMERGENCY OVERRIDE' : 'Geometry probe',
      bgColor: '#123456',
      screenWidth: 1080,
      screenHeight: 1920,
      zones: empty ? [] : [{
        id: 'z-full',
        x: 0, y: 0, width: 100, height: 100, zIndex: 1,
        widgetType: 'TEXT',
        defaultConfig: {
          sizeMode: 'absolute',
          content: systemDefault ? `${drill ? 'DRILL — THIS IS A DRILL\n\n' : ''}LOCKDOWN PROTOCOL ACTIVE\n\nMove inside. Stay away from windows. Follow standard procedures.` : 'GEOMETRY PROBE',
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
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest*`, (route) => state.failManifest ? ok(route, { error: 'offline test' }, 503) : ok(route, {
    screenId: FAKE_SCREEN_ID,
    screenName: 'Geometry Screen',
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Geometry Tenant',
    orientation: state.orientation || 'PORTRAIT',
    isDrill: !!state.drill,
    isEmergency: state.manifestMode === 'emergency',
    ...(state.manifestMode === 'emergency'
      ? { emergencyType: state.alertType || 'LOCKDOWN', emergencySeverity: 'CRITICAL', emergencyScopeNote: 'Drill — geometry test' }
      : {}),
    playlists: templatePlaylist(state.emptyTemplate, state.systemDefault, state.drill),
  }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/status`, (route) => ok(route, { ok: true }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/cache-status`, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/render-proof`, (route) => {
    state.proofs?.push(route.request().postDataJSON());
    return ok(route, { ok: true, emergencyPaintAccepted: true }, 201);
  });
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/telemetry`, (route) => ok(route, { ok: true }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/emergency-rev*`, (route) => ok(route, { rev: 'geometry' }));
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: state.message ? [state.message] : [] }));
  await page.route('**/api/v1/emergency/messages*', (route) => ok(route, { active: state.message ? [state.message] : [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
  await page.route('**/api/v1/realtime/time*', (route) => ok(route, { serverTime: Date.now() }));
}

/** Delegating WS stub — only `/realtime` is stubbed; HMR keeps the real one. */
async function installWsStub(page: Page) {
  await page.addInitScript(() => {
    const RealWS = window.WebSocket;
    const sockets: any[] = [];
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
      sockets.push(inst);
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
    (window as any).__geometryPush = (type: string, payload: unknown = {}) => {
      const socket = [...sockets].reverse().find(s => s.readyState === RealWS.OPEN && s.onmessage);
      if (!socket) return false;
      socket.onmessage({ data: JSON.stringify({ type, timestamp: Date.now(), eventId: `${type}-${Date.now()}`, signature: 'geometry-test-signature', payload }) });
      return true;
    };
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

async function reconcile(page: Page, type: 'SYNC' | 'OVERRIDE' | 'ALL_CLEAR') {
  await expect.poll(() => page.evaluate(t => (window as any).__geometryPush(t), type)).toBe(true);
}

async function expectVisibleEmergencyTemplate(page: Page, state: MockState) {
  const root = page.locator('[data-edu-player-root="template"]');
  await expect(root).toHaveAttribute('data-edu-emergency-root', 'template');
  await expect(root.getByText('GEOMETRY PROBE')).toBeVisible();
  await expect(page.locator('[data-edu-emergency-root="fallback"]')).toHaveCount(0);
  // Geometry alone passes when an opaque fallback still covers the template.
  await expect.poll(() => page.evaluate(() => {
    const hit = document.elementFromPoint(document.documentElement.clientWidth / 2, document.documentElement.clientHeight / 2);
    return hit?.closest('[data-edu-emergency-root]')?.getAttribute('data-edu-emergency-root');
  })).toBe('template');
  const identity = await root.getAttribute('data-edu-emergency-identity');
  await expect.poll(() => state.proofs?.some(p => p.emergencyProof?.painted === true && p.emergencyProof?.frames >= 2 && p.emergencyProof?.identity === identity), { timeout: 15_000 }).toBe(true);
}

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
      const state: MockState = { manifestMode: 'emergency', proofs: [] };
      await installWsStub(page);
      await installMocks(page, state);
      await page.goto(`/player?fp=${FAKE_FINGERPRINT}&client=android&w=${c.w}&h=${c.h}`);
      await expectVisibleEmergencyTemplate(page, state);
      await page.screenshot({ path: test.info().outputPath('emergency-template.png'), fullPage: true });
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

    test('the same template raises, rejects cached all-clear, and clears live without hiding alert content', async ({ page }) => {
      const state: MockState = { manifestMode: 'template', proofs: [] };
      await installWsStub(page);
      await installMocks(page, state);
      await page.goto(`/player?fp=${FAKE_FINGERPRINT}&client=android&w=${c.w}&h=${c.h}`);
      const root = page.locator('[data-edu-player-root="template"]');
      await expect(root.getByText('GEOMETRY PROBE')).toBeVisible();
      const cacheKey = `edu_manifest_cache_v2:${FAKE_SCREEN_ID}`;
      await expect.poll(() => page.evaluate(key => localStorage.getItem(`${key}:latest`), cacheKey)).not.toBeNull();
      const normalCache = await page.evaluate(key => localStorage.getItem(`${key}:latest`), cacheKey);
      state.manifestMode = 'emergency';
      await reconcile(page, 'OVERRIDE');
      await expectVisibleEmergencyTemplate(page, state);
      const alertIdentity = await root.getAttribute('data-edu-emergency-identity');
      // Cached normal data cannot replace/reclassify the active alert, with
      // either the same template signature OR a different stale template.
      let refusedCachedClears = 0;
      page.on('console', message => { if (message.text().includes('cached (offline) manifest carries no emergency')) refusedCachedClears++; });
      state.failManifest = true;
      for (const changedSignature of [false, true]) {
        const stale = JSON.parse(normalCache!);
        if (changedSignature) {
          stale.m.playlists[0].contentRev = 'stale-other-template';
          stale.m.playlists[0].template.zones[0].defaultConfig.content = 'STALE NORMAL CONTENT';
        }
        await page.evaluate(({ key, value }) => {
          localStorage.setItem(`${key}:latest`, value);
          localStorage.setItem(`${key}:playing`, value);
        }, { key: cacheKey, value: JSON.stringify(stale) });
        const previousRefusals = refusedCachedClears;
        await reconcile(page, 'SYNC');
        await expect.poll(() => refusedCachedClears).toBeGreaterThan(previousRefusals);
        await expectVisibleEmergencyTemplate(page, state);
        await expect(root).toHaveAttribute('data-edu-emergency-identity', alertIdentity!);
        await expect(page.getByText('STALE NORMAL CONTENT')).toHaveCount(0);
      }
      state.failManifest = false;
      state.manifestMode = 'template';
      await reconcile(page, 'ALL_CLEAR');
      await expect(root).not.toHaveAttribute('data-edu-emergency-root', 'template');
      await expect(root.getByText('GEOMETRY PROBE')).toBeVisible();
      await expect(page.locator('[data-edu-emergency-root], [data-edu-emergency-pending]')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => (window as any).__eduRenderProof?.().kind)).not.toBe('emergency');
      state.manifestMode = 'emergency';
      await reconcile(page, 'OVERRIDE');
      await expectVisibleEmergencyTemplate(page, state);
    });

    test('an unavailable emergency template keeps the fallback until content renders', async ({ page }) => {
      const state: MockState = { manifestMode: 'emergency', emptyTemplate: true, proofs: [] };
      await installWsStub(page);
      await installMocks(page, state);
      await page.goto(`/player?fp=${FAKE_FINGERPRINT}&client=android&w=${c.w}&h=${c.h}`);
      await expect(page.locator('[data-edu-emergency-root="fallback"]')).toBeVisible();
      await expect(page.locator('[data-edu-player-root="template"]')).not.toHaveAttribute('data-edu-emergency-root', 'template');
      state.emptyTemplate = false;
      await reconcile(page, 'SYNC');
      await expectVisibleEmergencyTemplate(page, state);
      // A quiet widget crash removes its output without changing the
      // manifest or template identity. The readiness check must notice it.
      await page.locator('[data-zone-id="z-full"]').evaluate(zone => zone.replaceChildren());
      await expect(page.locator('[data-edu-emergency-root="fallback"]')).toBeVisible();
      await expect(page.locator('[data-edu-player-root="template"]')).not.toHaveAttribute('data-edu-emergency-root', 'template');
    });
  });
}


for (const viewport of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 960, height: 540 }]) {
  test.describe(`secondary emergency layout ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });
    for (const drill of [false, true]) {
      test(`reflows the default alert at readable size (${drill ? 'drill' : 'live'})`, async ({ page }) => {
        const state: MockState = { manifestMode: 'emergency', systemDefault: true, drill, orientation: viewport.width === 960 || viewport.height > viewport.width ? 'PORTRAIT' : 'LANDSCAPE', proofs: [] };
        await installWsStub(page);
        await installMocks(page, state);
        await page.goto(`/player?fp=${FAKE_FINGERPRINT}&face=1&dpr=1`);
        const text = page.locator('[data-edu-emergency-text-floor]');
        await expect(text).toBeVisible();
        await expect(page.locator('[data-edu-player-root="template"]')).toHaveAttribute('data-edu-emergency-root', 'template');
        await expect.poll(() => page.locator('[data-edu-player-root="template"]').evaluate(el => [el.clientWidth, el.clientHeight]))
          .toEqual(viewport.width === 960 ? [540, 960] : [viewport.width, viewport.height]);
        await expect.poll(() => text.evaluate(el => ({ height: el.scrollHeight - el.clientHeight, width: el.scrollWidth - el.clientWidth })))
          .toEqual({ height: 0, width: 0 });
        const metrics = await text.evaluate(el => {
          const child = el.firstElementChild as HTMLElement;
          const parent = document.querySelector('[data-edu-player-root="template"]') as HTMLElement;
          return { font: parseFloat(getComputedStyle(child).fontSize), width: parent.offsetWidth, height: parent.offsetHeight,
            clipped: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1 };
        });
        expect(metrics.font).toBeGreaterThanOrEqual(32);
        expect(metrics.clipped).toBe(false);
        // Portrait fallback rotations belong to this face, including on a landscape OS viewport.
        expect(metrics.width).toBe(viewport.width === 960 ? 540 : viewport.width);
        expect(metrics.height).toBe(viewport.width === 960 ? 960 : viewport.height);
        if (drill) await expect(text).toContainText('DRILL — THIS IS A DRILL');
        await page.screenshot({ path: test.info().outputPath('face-emergency.png'), fullPage: true });
      });
    }
    for (const type of ['SOS', 'TEXT_BROADCAST', 'MEDIA_ALERT'] as const) {
      test(`${type} uses the same face viewport without text shrinking`, async ({ page }) => {
        const state: MockState = { manifestMode: 'template',
          orientation: viewport.width === 960 || viewport.height > viewport.width ? 'PORTRAIT' : 'LANDSCAPE',
          message: { id: 'synthetic-message', type, severity: type === 'TEXT_BROADCAST' ? 'WARN' : 'CRITICAL',
            textBlob: 'Move inside. Follow standard procedures.', mediaUrls: [], audioUrl: null, expiresAt: null, createdAt: '2026-10-21T12:00:00Z' } };
        await installWsStub(page);
        await installMocks(page, state);
        await page.goto(`/player?fp=${FAKE_FINGERPRINT}&face=1&dpr=1`);
        await expect.poll(() => page.evaluate(({ type, payload }) => (window as any).__geometryPush(type, payload), { type, payload: state.message })).toBe(true);
        const root = page.locator(`[data-edu-emergency-root="${type === 'TEXT_BROADCAST' ? 'banner' : 'full'}"]`);
        await expect(root).toBeVisible();
        await expect.poll(() => root.evaluate(el => (el as HTMLElement).offsetWidth)).toBe(viewport.width === 960 ? 540 : viewport.width);
        const copy = type === 'TEXT_BROADCAST' ? root.getByText('Move inside. Follow standard procedures.', { exact: true }) : root.locator('h1');
        const size = await copy.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        expect(size).toBeGreaterThanOrEqual(type === 'TEXT_BROADCAST' ? 20 : 32);
        const bounds = await copy.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(-1);
        expect(bounds!.y).toBeGreaterThanOrEqual(-1);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
      });
    }
    if (viewport.width === 960) test('normal, alert and all-clear retain the rotated face coverage', async ({ page }) => {
      const state: MockState = { manifestMode: 'template', orientation: 'PORTRAIT', proofs: [] };
      await installWsStub(page); await installMocks(page, state);
      await page.goto(`/player?fp=${FAKE_FINGERPRINT}&face=1&dpr=1`);
      const root = page.locator('[data-edu-player-root="template"]');
      const coverage = () => root.evaluate(el => [el.clientWidth, el.clientHeight]);
      await expect.poll(coverage).toEqual([540, 960]);
      state.manifestMode = 'emergency'; state.systemDefault = true;
      await reconcile(page, 'OVERRIDE');
      await expect(root).toHaveAttribute('data-edu-emergency-root', 'template');
      await expect.poll(coverage).toEqual([540, 960]);
      state.manifestMode = 'template'; state.systemDefault = false;
      await reconcile(page, 'ALL_CLEAR');
      await expect.poll(() => root.getAttribute('data-edu-emergency-root')).toBeNull();
      await expect.poll(coverage).toEqual([540, 960]);
    });
  });
}
