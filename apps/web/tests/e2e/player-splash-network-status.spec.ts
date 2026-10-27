import { test, expect, type Page, type Route, type TestInfo } from '@playwright/test';

/**
 * THE SPLASH TELLS THE TRUTH ABOUT THE NETWORK (2026-10-26, on site).
 *
 * The owner removed a panel's Wi-Fi and launched the app: "the splash screen
 * doesnt tell me the network is disconnected at all until i click into the
 * network page on the display". The chip was a hard-coded "Online" and
 * "Connecting to your CMS…" spun for ever.
 *
 * Pinned here, in Chromium and WebKit:
 *   1. offline → "No network connection", the button is focused, OK fires
 *      the APK's `openNetworkScreen`; back online → the card clears and the
 *      splash keeps connecting — no reload, no tap.
 *   2. a link but VenueOS silent → "Connected, but can't reach VenueOS"; Back
 *      still reaches Screen options; it clears by itself when VenueOS answers.
 *   3. a browser (no APK) gets the instruction, not a dead button.
 *   4. the post-pair "Connecting to your CMS" hero gets the same card.
 *
 * Harness rules (player rule 14): the WebSocket stub delegates every
 * non-/realtime socket to the real one; mocks key on STATE, never on call
 * counts; keys and synthetic remote events wait for a bootMounted-gated
 * element (the "Display" chip). `context.setOffline` does NOT stop
 * `route.fulfill` from answering (player-offline-lazy-renderer.spec.ts), so
 * "offline" also flips the mocks to abort: the network really is gone.
 */

const FAKE_FINGERPRINT = 'test-fp-splash-network';
const FAKE_SCREEN_ID = 'test-screen-0000splashnet';
const FAKE_TENANT_ID = 'test-tenant-0000splashnet';

type MockState = {
  /** 'up': VenueOS answers. 'down': every API request dies at transport. */
  api: 'up' | 'down';
  /** 'busy': register answers 503 (the splash keeps connecting). 'paired': it pairs. */
  register: 'busy' | 'paired';
  /** Take the whole API down the moment the screen has paired. */
  dieAfterPairing?: boolean;
};

async function installMocks(page: Page, state: MockState) {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });

  // ONE handler for the fake API origin AND the same-origin gateway
  // (apiOrigin.ts): after three transport failures the player moves its whole
  // control plane to the page origin, and a real outage takes that path down
  // too. Left to the real Next server, the gateway answers HTTP 500 — the
  // network working and VenueOS failing, which is correctly NOT this card.
  const handler = async (route: Route) => {
    if (state.api === 'down') return route.abort('failed');
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/health') return json(route, { status: 'ok' });
    if (path === '/api/v1/screens/register') {
      if (state.register === 'busy') return route.fulfill({ status: 503, body: 'busy' });
      if (state.dieAfterPairing) state.api = 'down';
      return json(route, {
        paired: true,
        screenId: FAKE_SCREEN_ID,
        name: 'Splash Network Screen',
        deviceToken: 'splash.network.token-not-real',
      });
    }
    if (path.startsWith(`/api/v1/screens/${FAKE_SCREEN_ID}/manifest`)) {
      return json(route, {
        tenantId: FAKE_TENANT_ID,
        tenantName: 'Splash Network Tenant',
        orientation: 'LANDSCAPE',
        isEmergency: false,
        playlists: [],
      });
    }
    if (path.startsWith('/api/v1/screens/status/')) {
      return json(route, { paired: true, screenId: FAKE_SCREEN_ID, name: 'Splash Network Screen', tenantId: FAKE_TENANT_ID });
    }
    if (path.endsWith('/emergency-assets')) return json(route, { assets: [], setHash: 'empty' });
    if (path.startsWith('/api/v1/emergency/')) return json(route, { active: [] });
    if (path === '/api/v1/player/update-check') return json(route, { available: false });
    return route.fulfill({ status: 204, body: '' });
  };
  await page.route(/http:\/\/api\.invalid\/.*/, handler);
  await page.route('**/api/v1/**', handler);
}

/** Delegating WS stub — only `/realtime` is stubbed; it opens and AUTH_OKs (rule 14). */
async function installWsStub(page: Page) {
  await page.addInitScript(() => {
    const RealWS = window.WebSocket;
    function StubOrReal(this: unknown, url: string, protocols?: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!String(url).includes('/realtime')) return new (RealWS as any)(url, protocols);
      const listeners: Record<string, Array<(ev: unknown) => void>> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inst: any = {
        url,
        readyState: RealWS.CONNECTING,
        onopen: null, onmessage: null, onerror: null, onclose: null,
        send() { /* swallow */ },
        close(code = 1000, reason = '') {
          inst.readyState = RealWS.CLOSED;
          emit('close', { code, reason });
        },
        addEventListener(type: string, fn: (ev: unknown) => void) {
          (listeners[type] ||= []).push(fn);
        },
        removeEventListener(type: string, fn: (ev: unknown) => void) {
          listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
        },
      };
      const emit = (type: string, ev: unknown) => {
        const prop = inst['on' + type];
        if (typeof prop === 'function') prop.call(inst, ev);
        for (const fn of listeners[type] || []) fn(ev);
      };
      setTimeout(() => {
        inst.readyState = RealWS.OPEN;
        emit('open', {});
        setTimeout(() => {
          emit('message', {
            data: JSON.stringify({ type: 'AUTH_OK', payload: { serverTime: Date.now() }, idempotencyKey: 'auth-ok-splash-net', timestamp: Date.now() }),
          });
        }, 10);
      }, 5);
      return inst;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = StubOrReal as any;
    s.CONNECTING = RealWS.CONNECTING; s.OPEN = RealWS.OPEN; s.CLOSING = RealWS.CLOSING; s.CLOSED = RealWS.CLOSED;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = StubOrReal;
  });
}

/** An APK ≥ 1.1.53 bridge: the method manifest names `openNetworkScreen`; posts are recorded. */
async function installApkBridge(page: Page) {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__nativeCalls = [];
    w.EduCmsNativeChannel = {
      postMessage: (raw: string) => {
        try { w.__nativeCalls.push(JSON.parse(raw)); } catch { /* not ours */ }
      },
    };
    w.__eduCmsNativeChannelMethods = ['openNetworkScreen', 'heartbeat', 'exitToDeviceHome', 'openSetupChecklist'];
  });
}

const networkCalls = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __nativeCalls?: Array<{ method: string }> }).__nativeCalls || [])
    .filter((m) => m.method === 'openNetworkScreen'));

const mounts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __eduPlayerMounts?: number }).__eduPlayerMounts ?? 0);

/** Two frames: the Back listener re-registers in an effect after each toggle (remote-escape spec). */
const settle = (page: Page) =>
  page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

const pressBack = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new CustomEvent('edu-show-stop-overlay')));

const chip = (page: Page) => page.locator('[data-edu-network-chip]');
const card = (page: Page) => page.locator('[data-edu-network-card]');
const openButton = (page: Page) => page.getByRole('button', { name: 'Open network settings' });
const screenOptions = (page: Page) => page.getByRole('dialog', { name: 'Screen options' });

async function bootToSplash(page: Page) {
  await page.goto(`/player?fp=${FAKE_FINGERPRINT}`);
  // SSR paints the splash text before listeners attach (rule 14): wait for
  // the bootMounted-gated resolution chip before any key or event.
  await expect(page.getByText('Display', { exact: true })).toBeVisible({ timeout: 60_000 });
}

async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}-${info.project.name}.png`), animations: 'disabled' });
}

// A 1080p TV — the glass this is read on, from across a room.
test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

test.describe('splash network status — the owner’s on-site case', () => {
  test('launched with no network → card + focused button → OK opens Network → back online → keeps connecting by itself', async ({ page, context }, info) => {
    test.setTimeout(120_000);
    // Never reached VenueOS, and the Wi-Fi is out.
    const state: MockState = { api: 'down', register: 'busy' };
    await installApkBridge(page);
    await installWsStub(page);
    await installMocks(page, state);
    await bootToSplash(page);
    const mountedOnce = await mounts(page);
    await context.setOffline(true);

    await expect(page.getByRole('heading', { name: 'No network connection' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("This screen isn't connected to Wi-Fi or Ethernet.")).toBeVisible();
    await expect(page.getByText('Connecting to your CMS…')).toHaveCount(0);
    await expect(chip(page)).toHaveText('Offline');
    await expect(openButton(page)).toBeFocused();
    await shot(page, info, '1-offline');

    // OK on the remote.
    await page.keyboard.press('Enter');
    await expect.poll(() => networkCalls(page)).toEqual([{ method: 'openNetworkScreen', args: [] }]);
    // The Back menu's path: Screen options stays open under the Network screen…
    await expect(screenOptions(page)).toBeVisible();

    // …the person joins a network there, and the APK closes the menu it was
    // opened over (MainActivity.returnAfterNetworkJoin).
    state.api = 'up';
    await context.setOffline(false);
    await settle(page);
    await pressBack(page);
    await expect(screenOptions(page)).toHaveCount(0);

    // No tap, no reload: the card is gone and the splash keeps connecting.
    await expect(card(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText('Connecting to your CMS…')).toBeVisible();
    await expect(chip(page)).toHaveText('Online', { timeout: 15_000 });
    expect(await mounts(page)).toBe(mountedOnce);
    await shot(page, info, '3-online');
  });

  test('a link but VenueOS silent → "can\'t reach VenueOS"; Back still escapes; it clears by itself', async ({ page }, info) => {
    test.setTimeout(150_000);
    const state: MockState = { api: 'down', register: 'busy' };
    await installApkBridge(page);
    await installWsStub(page);
    await installMocks(page, state);
    await bootToSplash(page);

    // navigator.onLine stays true; the probe and the register die at transport.
    await expect(page.getByRole('heading', { name: "Connected, but can't reach VenueOS" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Check this network's internet connection.")).toBeVisible();
    await expect(chip(page)).toHaveText('No internet');
    await expect(openButton(page)).toBeFocused();
    await shot(page, info, '2-unreachable');

    // Back reaches the escape; closing it parks the remote on the button again.
    await pressBack(page);
    await expect(screenOptions(page)).toBeVisible();
    await expect(openButton(page)).not.toBeFocused();
    await settle(page);
    await pressBack(page);
    await expect(screenOptions(page)).toHaveCount(0);
    await expect(openButton(page)).toBeFocused();

    // Past the reconnect panel's 15 s grace: the card already says it, so no
    // second, technical "Reconnecting… Failed to fetch" panel joins it.
    await page.waitForTimeout(16_000);
    await expect(card(page)).toBeVisible();
    await expect(page.locator('[data-edu-reconnect-toast]')).toHaveCount(0);

    // VenueOS answers again: the backoff probe or the next register clears it.
    state.api = 'up';
    await expect(card(page)).toHaveCount(0, { timeout: 45_000 });
    await expect(page.getByText('Connecting to your CMS…')).toBeVisible();
    await expect(chip(page)).toHaveText('Online');
  });

  test('a browser (no APK): the instruction, never a button that cannot work', async ({ page, context }) => {
    test.setTimeout(120_000);
    const state: MockState = { api: 'up', register: 'busy' };
    await installWsStub(page);
    await installMocks(page, state);
    await bootToSplash(page);
    await expect(chip(page)).toHaveText('Online', { timeout: 30_000 });

    state.api = 'down';
    await context.setOffline(true);
    await expect(page.getByRole('heading', { name: 'No network connection' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Check this device's Wi-Fi or network cable.")).toBeVisible();
    await expect(openButton(page)).toHaveCount(0);

    state.api = 'up';
    await context.setOffline(false);
    await expect(card(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText('Connecting to your CMS…')).toBeVisible();
  });

  test('the post-pair "Connecting to your CMS" hero gets the same card, and gives the screen back', async ({ page }, info) => {
    test.setTimeout(150_000);
    // Pairs at once; then the whole API dies before the first manifest.
    const state: MockState = { api: 'up', register: 'paired', dieAfterPairing: true };
    await installApkBridge(page);
    await installWsStub(page);
    await installMocks(page, state);
    await page.goto(`/player?fp=${FAKE_FINGERPRINT}`);
    await expect(page.getByRole('heading', { name: "Connected, but can't reach VenueOS" })).toBeVisible({ timeout: 60_000 });
    await expect(openButton(page)).toBeFocused();
    await shot(page, info, '4-connecting-hero-unreachable');

    state.dieAfterPairing = false;
    state.api = 'up';
    await expect(card(page)).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Screen Paired Successfully' })).toBeVisible({ timeout: 30_000 });
    await expect(chip(page)).toHaveText('Online');
  });
});
