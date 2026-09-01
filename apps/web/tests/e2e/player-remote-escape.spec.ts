import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * REMOTE-ESCAPE E2E — the 2026-08-30 field-install trap, pinned.
 *
 * Two brand-new units were bricked at install time: the screen sat on
 * "Connecting to your CMS" (either the registering splash or the post-pair
 * connecting hero — both use those words) and the remote's Back key did
 * NOTHING visible, because:
 *   - the `registering`/`pairing` early returns rendered nothing for
 *     `playbackStopped`, and
 *   - in the main return the `phase === 'connecting'` ternary arm BEAT the
 *     `playbackStopped` arm, so Back toggled state invisibly.
 * No exit, no retry, no way into device setup. These tests pin the fix:
 * Back (via the `edu-show-stop-overlay` event the APK dispatches) must
 * always reach an actionable surface on every pre-content phase.
 *
 * Harness rules (same as credential-lifecycle.spec.ts — the three lessons):
 * never replace window.WebSocket wholesale (delegate non-/realtime URLs);
 * mocks key on STATE, not call counts (StrictMode double-fires); fake API
 * base only, no production traffic.
 */

const FAKE_SCREEN_ID = 'test-screen-00000000escp';
const FAKE_TENANT_ID = 'test-tenant-00000000escp';
const FAKE_FINGERPRINT = 'test-fp-remote-escape';
const BOOT_TOKEN = 'boot.stored.token-not-real';

type MockState = {
  registerMode: 'ok-paired' | '500';
  manifestMode: 'ok-empty' | '401' | 'emergency';
};

async function installMocks(page: Page, state: MockState) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });

  // Catch-all FIRST (Playwright matches last-registered first).
  await page.route(/http:\/\/api\.invalid\/.*/, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );

  await page.route('**/api/v1/screens/register', async (route) => {
    if (state.registerMode === '500') {
      return route.fulfill({ status: 500, body: 'boom' });
    }
    return ok(route, {
      paired: true,
      screenId: FAKE_SCREEN_ID,
      name: 'Escape Test Screen',
      deviceToken: BOOT_TOKEN,
    });
  });

  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest*`, async (route) => {
    if (state.manifestMode === '401') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"expired"}' });
    }
    return ok(route, {
      tenantId: FAKE_TENANT_ID,
      tenantName: 'Escape Test Tenant',
      orientation: 'LANDSCAPE',
      // 'emergency' mode is the LIVE manifest raising a tenant alert — the
      // same field shape fetchContent reads (isEmergency/emergencyType/…).
      isEmergency: state.manifestMode === 'emergency',
      ...(state.manifestMode === 'emergency'
        ? { emergencyType: 'LOCKDOWN', emergencySeverity: 'CRITICAL' }
        : {}),
      playlists: [],
    });
  });

  await page.route(/\/api\/v1\/screens\/status\//, (route) =>
    ok(route, { paired: true, screenId: FAKE_SCREEN_ID, name: 'Escape Test Screen', tenantId: FAKE_TENANT_ID }),
  );
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/emergency-assets`, (route) =>
    ok(route, { assets: [], setHash: 'empty' }),
  );
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/cache-status`, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/render-proof`, (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' }),
  );
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/emergency/messages*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
}

/** Delegating WS stub — only `/realtime` is stubbed; HMR keeps the real one. */
async function installWsStub(page: Page) {
  await page.addInitScript(() => {
    const RealWS = window.WebSocket;
    function StubOrReal(this: unknown, url: string, protocols?: unknown) {
      if (!String(url).includes('/realtime')) {
        return new (RealWS as any)(url, protocols);
      }
      const listeners: Record<string, Array<(ev: any) => void>> = {};
      const inst: any = {
        url,
        readyState: RealWS.CONNECTING,
        onopen: null, onmessage: null, onerror: null, onclose: null,
        send() { /* swallow */ },
        close(code = 1000, reason = '') {
          inst.readyState = RealWS.CLOSED;
          emit('close', { code, reason });
        },
        addEventListener(type: string, fn: (ev: any) => void) {
          (listeners[type] ||= []).push(fn);
        },
        removeEventListener(type: string, fn: (ev: any) => void) {
          listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
        },
      };
      const emit = (type: string, ev: any) => {
        const prop = inst['on' + type];
        if (typeof prop === 'function') prop.call(inst, ev);
        for (const fn of listeners[type] || []) fn(ev);
      };
      setTimeout(() => {
        inst.readyState = RealWS.OPEN;
        emit('open', {});
        setTimeout(() => {
          emit('message', {
            data: JSON.stringify({
              type: 'AUTH_OK',
              payload: { serverTime: Date.now() },
              idempotencyKey: 'auth-ok-escape',
              timestamp: Date.now(),
            }),
          });
        }, 10);
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

const pressBack = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new CustomEvent('edu-show-stop-overlay')));

test.describe('remote escape — Back always reaches an actionable surface', () => {
  test('1. registering splash (register down) — Back opens Screen options with Exit + Retry', async ({ page }) => {
    test.setTimeout(120_000); // cold-compile payer — see emergency-path test 1
    const state: MockState = { registerMode: '500', manifestMode: 'ok-empty' };
    await installWsStub(page);
    await installMocks(page, state);

    await page.goto(`/player?fp=${FAKE_FINGERPRINT}`);
    // The registering splash is up (register 500s forever; the loop retries).
    await expect(page.getByText('Connecting to your CMS')).toBeVisible({ timeout: 30_000 });
    // ⚠️ HYDRATION GATE (webkit caught this): the splash text above exists in
    // the SSR HTML BEFORE React attaches the Back listener — dispatching the
    // event then is swallowed. The "Display" resolution chip is
    // bootMounted-gated, so its presence proves mount effects have run.
    await expect(page.getByText('Display', { exact: true })).toBeVisible({ timeout: 30_000 });

    // THE TRAP: Back used to change state invisibly. Now it opens the panel.
    await pressBack(page);
    await expect(page.getByRole('dialog', { name: 'Screen options' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'Exit to launcher' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry now' })).toBeVisible();
    // Browser boot (no Android bridge): Device setup must NOT be offered.
    await expect(page.getByRole('button', { name: 'Device setup' })).toHaveCount(0);
    // The failure reason surfaces once the register loop has been failing.
    await expect(page.getByText(/Not connected —/)).toBeVisible({ timeout: 45_000 });

    // Back again toggles the panel away (same toggle contract as playback).
    await pressBack(page);
    await expect(page.getByRole('dialog', { name: 'Screen options' })).toHaveCount(0);
  });

  test('2. post-pair connecting hero (manifest 401 loop) — Back reaches the paused action surface', async ({ page }) => {
    test.setTimeout(120_000);
    const state: MockState = { registerMode: 'ok-paired', manifestMode: '401' };
    await installWsStub(page);
    await installMocks(page, state);

    await page.goto(`/player?fp=${FAKE_FINGERPRINT}`);
    // Paired instantly, manifest 401s forever → the connecting hero.
    await expect(
      page.getByRole('heading', { name: 'Connecting to your CMS' }),
    ).toBeVisible({ timeout: 30_000 });

    // THE TRAP: `phase === 'connecting'` used to beat `playbackStopped` in
    // the ternary, so this surface was unreachable. Now the pause wins.
    await pressBack(page);
    await expect(page.getByRole('button', { name: /Resume/ })).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole('heading', { name: 'Connecting to your CMS' }),
    ).toHaveCount(0);

    // Back again resumes the connecting hero (toggle contract).
    await pressBack(page);
    await expect(
      page.getByRole('heading', { name: 'Connecting to your CMS' }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('3. emergency history sentinel — armed once while displayed, consumed on release, Back reaches escape in ONE press', async ({ page }) => {
    test.setTimeout(150_000);
    // 2026-09-01 (TC22 field find): the emergency Back-trap pushed a history
    // entry that OUTLIVED the alert — any transient emergency display (a
    // rule-11 cached-manifest raise at boot, corrected by the next live
    // manifest) left the WebView with back-history forever, so the NATIVE
    // Back handler's `canGoBack → goBack` branch ate the operator's first
    // press. It also re-pushed on every arm, one dead press per flap. This
    // test pins the whole lifecycle from the page's own history state.
    const state: MockState = { registerMode: 'ok-paired', manifestMode: 'ok-empty' };
    await installWsStub(page);
    await installMocks(page, state);

    await page.goto(`/player?fp=${FAKE_FINGERPRINT}`);
    await expect(
      page.getByRole('heading', { name: 'Screen Paired Successfully' }),
    ).toBeVisible({ timeout: 30_000 });
    // No separate hydration gate needed here: the first sentinel-arm poll
    // below only passes once a React effect has PUSHED — that is mount
    // proof by construction — and the lone synthetic Back at the end fires
    // after three full manifest-poll cycles, long past listener attach.
    const sentinel = () =>
      page.evaluate(() => (window.history.state as { eduEmergencyLock?: boolean } | null)?.eduEmergencyLock === true);
    const depth = () => page.evaluate(() => window.history.length);

    expect(await sentinel()).toBe(false);
    const baseDepth = await depth();

    // ── Alert raises (live manifest) → exactly ONE sentinel entry. ──
    state.manifestMode = 'emergency';
    await expect.poll(sentinel, { timeout: 45_000, message: 'lock never armed on emergency display' }).toBe(true);
    expect(await depth()).toBe(baseDepth + 1);

    // ── All-clear → sentinel consumed (this was the TC22 bug). ──
    state.manifestMode = 'ok-empty';
    await expect.poll(sentinel, { timeout: 45_000, message: 'sentinel outlived the alert — Back is poisoned again' }).toBe(false);

    // ── Re-arm after a clear must still cost exactly one entry, never
    //    stack (the pointer sits below the old forward entry; a fresh push
    //    replaces it — depth must not exceed the first arm's). ──
    state.manifestMode = 'emergency';
    await expect.poll(sentinel, { timeout: 45_000, message: 'lock did not re-arm on the second display' }).toBe(true);
    expect(await depth()).toBeLessThanOrEqual(baseDepth + 1);
    state.manifestMode = 'ok-empty';
    await expect.poll(sentinel, { timeout: 45_000 }).toBe(false);

    // ── The operator-visible truth: ONE Back reaches the escape surface. ──
    await pressBack(page);
    await expect(page.getByRole('button', { name: /Resume/ })).toBeVisible({ timeout: 5_000 });
  });
});
