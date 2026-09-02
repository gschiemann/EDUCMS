import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * CHROMIUM-83 RUNTIME FLOOR — the Android-9 Taurus field find (2026-09-01).
 *
 * The original NovaStar Taurus (Android 9, UA "Taurus … Chrome/83.0.0.0") and
 * the TB posters (Chromium 83 WebView) sat on "Connecting to your CMS…" for
 * ever, never sending /screens/register. Those words are SERVER-RENDERED: a
 * kiosk whose player script never boots shows them with no error at all. The
 * live bundle needs runtime APIs Chromium 83 does not have — Next's own
 * router uses `Object.hasOwn` (Chrome 93) at hydration, a layout effect uses
 * `Element.replaceChildren` (86), the touch store `crypto.randomUUID` (92),
 * the router `URL.canParse` (120) — and Next 16 ships its polyfills in an
 * `async` chunk that races the runtime, or not at all for a modules-capable
 * engine. CLAUDE.md #10 guards CSS for this floor; nothing guarded JS.
 *
 * The player layout now carries an inline, feature-detected shim that runs
 * before any chunk. This test proves it covers what the bundle actually uses:
 * every post-83 API is DELETED before the page's first script (the shape of
 * that WebView), and the player must still boot to its pairing code / paired
 * splash and stamp `data-edu-booted`. If a future dependency starts calling a
 * newer API on the boot path, this test is what catches it.
 */

const TAURUS_A9_UA =
  'Mozilla/5.0 (Linux; Android 9; Taurus) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.0.0 Safari/537.36';

const FAKE_SCREEN_ID = 'test-screen-00000000cr83';
const FAKE_TENANT_ID = 'test-tenant-00000000cr83';
const FAKE_FINGERPRINT = 'test-fp-chromium83';
const BOOT_TOKEN = 'boot.stored.token-not-real';
const PAIRING_CODE = 'ADJBSQ';

/** Remove every API that shipped after Chromium 83, before any page script. */
async function stripPost83Apis(page: Page) {
  await page.addInitScript(() => {
    const kill = (o: any, k: string) => { try { if (o && k in o) { delete o[k]; if (k in o) o[k] = undefined; } } catch { /* ignore */ } };
    kill(Object, 'hasOwn');            // 93
    kill(Object, 'groupBy');           // 117
    kill(Array.prototype, 'at');       // 92
    kill(String.prototype, 'at');      // 92
    kill(Array.prototype, 'findLast'); // 97
    kill(Array.prototype, 'findLastIndex');
    kill(Array.prototype, 'toSorted'); // 110
    kill(Array.prototype, 'toReversed');
    kill(Array.prototype, 'with');
    kill(String.prototype, 'replaceAll'); // 85
    kill(Promise, 'any');              // 85
    kill(Promise, 'withResolvers');    // 119
    kill(URL, 'canParse');             // 120
    kill(window, 'structuredClone');   // 98
    kill(window, 'reportError');       // 95
    kill(Element.prototype, 'replaceChildren'); // 86
    kill(AbortSignal, 'timeout');      // 103
    kill(AbortSignal, 'any');          // 116
    try { kill(crypto, 'randomUUID'); } catch { /* ignore */ } // 92
    (window as any).__post83Stripped = true;
  });
}

async function installMocks(page: Page, paired: boolean) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.addInitScript(({ token }) => {
    try { localStorage.setItem('edu_device_token', token); } catch { /* ignore */ }
  }, { token: BOOT_TOKEN });
  await page.route('**/api/v1/screens/register', (route) =>
    paired
      ? ok(route, { paired: true, screenId: FAKE_SCREEN_ID, deviceToken: BOOT_TOKEN, tenantId: FAKE_TENANT_ID, tenantName: 'T', status: 'ONLINE' })
      : ok(route, { paired: false, screenId: FAKE_SCREEN_ID, pairingCode: PAIRING_CODE }),
  );
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest*`, (route) => ok(route, {
    screenId: FAKE_SCREEN_ID, screenName: 'T', tenantId: FAKE_TENANT_ID, tenantName: 'T',
    orientation: 'LANDSCAPE', isEmergency: false, canvasW: null, canvasH: null, playlists: [],
  }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/status`, (route) => ok(route, { ok: true }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/pairing-status*`, (route) => ok(route, { paired: false }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/cache-status`, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/render-proof`, (route) => ok(route, { ok: true }, 201));
  await page.route('**/api/v1/emergency/**', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/**', (route) => ok(route, {}));
  await page.route('**/api/v1/realtime/time*', (route) => ok(route, { serverTime: Date.now() }));
}

async function installWsStub(page: Page) {
  await page.addInitScript(() => {
    const RealWS = window.WebSocket;
    function StubOrReal(this: unknown, url: string, protocols?: unknown) {
      if (!String(url).includes('/realtime')) return new (RealWS as any)(url, protocols);
      const inst: any = { url, readyState: RealWS.CONNECTING, onopen: null, onmessage: null, onerror: null, onclose: null,
        send() { /* swallow */ }, close() { inst.readyState = RealWS.CLOSED; }, addEventListener() { /* noop */ }, removeEventListener() { /* noop */ } };
      setTimeout(() => { inst.readyState = RealWS.OPEN; inst.onopen?.({}); }, 5);
      return inst;
    }
    (StubOrReal as any).CONNECTING = RealWS.CONNECTING; (StubOrReal as any).OPEN = RealWS.OPEN;
    (StubOrReal as any).CLOSING = RealWS.CLOSING; (StubOrReal as any).CLOSED = RealWS.CLOSED;
    (window as any).WebSocket = StubOrReal;
  });
}

test.describe('Chromium-83 runtime floor — the player boots with every post-83 API missing', () => {
  test.use({ userAgent: TAURUS_A9_UA, viewport: { width: 1920, height: 1080 } });

  test('unpaired: the pairing code renders and the boot proof is stamped', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e?.message || e).slice(0, 160)));
    await stripPost83Apis(page);
    await installWsStub(page);
    await installMocks(page, false);
    await page.goto(`/player?fp=${FAKE_FINGERPRINT}&client=android&w=320&h=1080`);
    expect(await page.evaluate(() => (window as any).__post83Stripped)).toBe(true);
    await expect(page.locator('.kiosk-code-row')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-edu-booted')), { timeout: 15_000 }).toBe('1');
    expect(errors.filter((e) => /is not a function|is not defined|undefined/.test(e))).toEqual([]);
  });

  test('paired: the connected splash renders and the boot proof is stamped', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e?.message || e).slice(0, 160)));
    await stripPost83Apis(page);
    await installWsStub(page);
    await installMocks(page, true);
    await page.goto(`/player?fp=${FAKE_FINGERPRINT}&client=android&w=1920&h=1080`);
    await expect(page.getByRole('heading', { name: 'Screen Paired Successfully' })).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-edu-booted')), { timeout: 15_000 }).toBe('1');
    expect(errors.filter((e) => /is not a function|is not defined|undefined/.test(e))).toEqual([]);
  });

  test('register unreachable on a 320-wide LED: the reconnect toast draws INSIDE the canvas', async ({ page }) => {
    // The Android-9 Taurus photo: a clean "Connecting to your CMS…" and no
    // error, although the register call was failing. The toast was placed
    // against the layout viewport and centred at x≈960 — off a 320 LED.
    test.setTimeout(120_000);
    await stripPost83Apis(page);
    await installWsStub(page);
    await installMocks(page, false);
    await page.route('**/api/v1/screens/register', (route) => route.abort('failed'));
    await page.goto(`/player?fp=${FAKE_FINGERPRINT}&client=android&w=320&h=1080`);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-edu-booted')), { timeout: 60_000 }).toBe('1');
    const toast = page.locator('[data-edu-reconnect-toast]');
    await expect(toast).toBeVisible({ timeout: 40_000 }); // 15 s grace + retries
    const r = await toast.evaluate((el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; });
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(320);
    expect(r.bottom).toBeLessThanOrEqual(1080);
    expect(r.top).toBeGreaterThan(0);
    await expect(toast).toContainText(/Reconnecting/);
  });
});
