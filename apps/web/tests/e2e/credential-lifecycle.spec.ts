import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * CREDENTIAL-LIFECYCLE E2E — the live stories behind the 2026-08-28 player
 * 1.1.6 audit (P0-1/P0-2) and the 2026-08-30 fix wave. The unit suites pin
 * the pure modules (deviceCredential / pairingLoop / wsAuthPolicy /
 * manifestGate); THESE tests pin the wiring — the actual page recovering a
 * dead credential, refusing a stale URL token, keeping content on glass
 * through an auth outage, and never letting pairing polling die.
 *
 * Modeled 1:1 on emergency-path.spec.ts: every API call intercepted, fake
 * identities only, the fake API base (http://api.invalid) NXDOMAINs if a
 * route is missing. No production traffic, no real secrets (repo is public).
 *
 * THE FOUR CONTRACTS WITH THE FUTURE:
 *   1. THE G43 STORY: a manifest 401 triggers ONE re-register with the
 *      stored prior token, the fresh credential is persisted, playback
 *      resumes, and `requiresRePair: true` surfaces as the on-glass
 *      "Re-pair required" chip. (Old code: decremented a counter, retried
 *      into the same 401 forever, told nobody — 37 h dark.)
 *   2. STORED TOKEN BEATS URL TOKEN: a stale native `?token=` injection
 *      can no longer clobber the fresh stored credential (the downgrade
 *      loop's root mechanism), and the token is scrubbed from the URL.
 *   3. PAIRING POLLING NEVER DIES: endpoint failures back off but polling
 *      always continues, and recovery completes the pair → exchange →
 *      connect chain. (Old code: 3 failures + 1 success-while-unpaired
 *      stopped polling forever.)
 *   4. NEVER BLANK WHILE PLAYING: a total auth outage (manifest 401 +
 *      register 500) leaves the current content on glass — no reload
 *      loop, no pairing splash, no blank.
 */

const FAKE_SCREEN_ID = 'test-screen-00000000cred';
const FAKE_TENANT_ID = 'test-tenant-00000000cred';
const FAKE_FINGERPRINT = 'test-fp-credential-story';
const BOOT_TOKEN = 'boot.stored.token-not-real';
const RENEWED_TOKEN = 'renewed.fresh.token-not-real';
const STALE_URL_TOKEN = 'stale.native.fossil-not-real';

// 1×1 transparent PNG — the playlist's single image item.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const IMG_URL = 'http://api.invalid/assets/one.png';

function playingManifest() {
  return {
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Cred Test Tenant',
    orientation: 'LANDSCAPE',
    isEmergency: false,
    playlists: [
      {
        id: 'pl-1',
        name: 'One Image',
        schedule: { daysOfWeek: null, timeStart: null, timeEnd: null, mode: 'replace', pin: 'screen', priority: 0 },
        items: [
          {
            item_id: 'item-1',
            asset_id: 'asset-1',
            asset_hash: null,
            url: IMG_URL,
            duration_ms: 60_000,
            sequence: 0,
            mime_type: 'image/png',
            muted: true,
          },
        ],
      },
    ],
  };
}

type MockState = {
  manifestMode: 'ok' | '401';
  registerMode: 'ok' | 'repair' | '500';
  counters: {
    manifestCalls: number;
    manifest401s: number;
    registerCalls: number;
    statusCalls: number;
    statusFailuresServed: number;
  };
  registerBodies: Array<Record<string, unknown>>;
  /** What the status (pairing heartbeat) route should do, per call index. */
  statusScript: Array<'500' | 'unpaired' | 'paired'>;
};

function freshState(): MockState {
  return {
    manifestMode: 'ok',
    registerMode: 'ok',
    counters: { manifestCalls: 0, manifest401s: 0, registerCalls: 0, statusCalls: 0, statusFailuresServed: 0 },
    registerBodies: [],
    statusScript: [],
  };
}

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

  await page.route(IMG_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }),
  );

  await page.route('**/api/v1/screens/register', async (route) => {
    state.counters.registerCalls += 1;
    let parsed: Record<string, unknown> = {};
    try { parsed = route.request().postDataJSON() as Record<string, unknown>; } catch { /* keep {} */ }
    state.registerBodies.push(parsed);
    if (state.registerMode === '500') {
      return route.fulfill({ status: 500, body: 'boom' });
    }
    // ⚠️ STATE-KEYED, NEVER CALL-COUNT-KEYED (2026-08-30 debug lesson):
    // React StrictMode in `next dev` double-invokes mount effects, so the
    // boot registration fires TWICE — a count-keyed mock handed the
    // "renewed" token to the second boot call and every token-identity
    // assertion downstream lied. The mode flag is what the test flips.
    return ok(route, {
      paired: true,
      screenId: FAKE_SCREEN_ID,
      name: 'Cred Test Screen',
      deviceToken: state.registerMode === 'repair' ? RENEWED_TOKEN : BOOT_TOKEN,
      ...(state.registerMode === 'repair' ? { requiresRePair: true } : {}),
    });
  });

  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest*`, async (route) => {
    state.counters.manifestCalls += 1;
    if (state.manifestMode === '401') {
      state.counters.manifest401s += 1;
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"expired"}' });
    }
    return ok(route, playingManifest());
  });

  await page.route(/\/api\/v1\/screens\/status\//, async (route) => {
    state.counters.statusCalls += 1;
    const step = state.statusScript.length
      ? state.statusScript[Math.min(state.counters.statusCalls - 1, state.statusScript.length - 1)]
      : 'paired';
    if (step === '500') {
      state.counters.statusFailuresServed += 1;
      return route.fulfill({ status: 500, body: 'down' });
    }
    return ok(route, {
      paired: step === 'paired',
      screenId: FAKE_SCREEN_ID,
      name: 'Cred Test Screen',
      tenantId: FAKE_TENANT_ID,
    });
  });

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

/**
 * Stub the PLAYER's realtime WS so that layer settles instead of
 * reconnect-looping — while DELEGATING every other URL to the real
 * WebSocket.
 *
 * ⚠️ THE LESSON THIS ENCODES (cost me a full debug cycle, 2026-08-30, and
 * it was already written down in emergency-path.spec.ts:247-251 twenty
 * lines past where I stopped reading): Next.js dev mode opens its HMR
 * socket via the real `window.WebSocket`. Replacing the constructor
 * WHOLESALE hands HMR a dead stub and STALLS THE PAGE BOOT ENTIRELY — no
 * register call, no manifest call, one console line, no errors. Only the
 * player's `/realtime` endpoint may be stubbed.
 */
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
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
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
              idempotencyKey: 'auth-ok-cred',
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

function seedIdentity(page: Page, opts: { token?: string | null } = {}) {
  return page.addInitScript(
    ({ token, fp }) => {
      try {
        localStorage.setItem('edu_device_fp', fp);
        if (token) localStorage.setItem('edu_device_token', token);
      } catch { /* jsdomless env — unreachable in practice */ }
    },
    { token: opts.token ?? null, fp: FAKE_FINGERPRINT },
  );
}

const contentImg = (page: Page) => page.locator(`img[src*="one.png"]`);

// ── DEBUGGED GREEN 2026-08-30, chromium + webkit — the three harness
// lessons, so nobody re-learns them: (1) never replace window.WebSocket
// wholesale (Next dev HMR uses it — a dead stub stalls the whole page
// boot); (2) StrictMode double-fires mount effects in dev, so mocks must
// key on STATE, never call counts; (3) the "Hydration failed" spam was a
// REAL product bug (splash rendered window.location/userAgent inline) —
// fixed with the bootMounted two-pass gate in page.tsx, which also ends
// the throw-away-the-tree re-render on every real kiosk boot.
test.describe('credential lifecycle — the G43 stories, pinned live', () => {
  test('1. manifest 401 → one recovery re-register → playback resumes + Re-pair chip', async ({ page }) => {
    test.setTimeout(120_000); // cold-compile payer — see emergency-path test 1

    const state = freshState();
    await installWsStub(page);
    await seedIdentity(page, { token: BOOT_TOKEN });
    await installMocks(page, state);

    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await expect(contentImg(page), 'baseline: the playlist image reaches the glass').toBeVisible({ timeout: 45_000 });
    const registersAtBaseline = state.counters.registerCalls;

    // The credential dies server-side. Every manifest is now 401 until a
    // NEW register happens; the mock then flags requiresRePair (the 1-hour
    // unproven holding pattern) and manifests work again.
    state.registerMode = 'repair';
    state.manifestMode = '401';
    await expect
      .poll(() => state.counters.manifest401s, { timeout: 30_000, message: 'player never re-polled into the 401' })
      .toBeGreaterThanOrEqual(1);

    // RECOVERY: exactly the re-register the old code never made.
    await expect
      .poll(() => state.counters.registerCalls, { timeout: 30_000, message: 'no recovery re-register happened — the 401 deadlock is back' })
      .toBeGreaterThan(registersAtBaseline);
    const recoveryBody = state.registerBodies[state.registerBodies.length - 1];
    expect(recoveryBody.priorDeviceToken, 'recovery presents the stored prior token as proof').toBe(BOOT_TOKEN);

    // Server accepted → manifests flow again → content stays/resumes.
    state.manifestMode = 'ok';
    await expect(contentImg(page), 'playback after recovery').toBeVisible({ timeout: 30_000 });

    // The fresh credential was persisted atomically (localStorage is the
    // credential of record — the old code left the dead one in place).
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('edu_device_token')), { timeout: 15_000 })
      .toBe(RENEWED_TOKEN);

    // And the trust state is VISIBLE, not swallowed: requiresRePair:true
    // renders the on-glass chip.
    await expect(
      page.getByText('Re-pair required', { exact: false }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('2. a stale native ?token= no longer clobbers the stored credential, and is scrubbed', async ({ page }) => {
    test.setTimeout(90_000);
    const state = freshState();
    await installWsStub(page);
    await seedIdentity(page, { token: BOOT_TOKEN });
    await installMocks(page, state);

    await page.goto(`/player?fp=${FAKE_FINGERPRINT}&token=${STALE_URL_TOKEN}`);
    await expect(contentImg(page)).toBeVisible({ timeout: 45_000 });

    // Register was fed the STORED token, not the URL fossil.
    expect(state.registerBodies[0]?.priorDeviceToken).toBe(BOOT_TOKEN);
    // The URL fossil never reached storage (the server-minted token did).
    const stored = await page.evaluate(() => localStorage.getItem('edu_device_token'));
    expect(stored).toBe(BOOT_TOKEN); // register #1 minted BOOT_TOKEN back
    expect(stored).not.toBe(STALE_URL_TOKEN);
    // The credential is gone from the visible URL.
    await expect.poll(() => page.url()).not.toContain('token=');
  });

  test('3. pairing polling survives endpoint failures and completes the pair', async ({ page }) => {
    test.setTimeout(120_000);
    const state = freshState();
    // Boot UNPAIRED: register says not paired; the status poll fails twice,
    // then answers unpaired twice, then paired — polling must survive all
    // of it (the 1.1.6 code died after failures + one unpaired success).
    state.statusScript = ['500', '500', 'unpaired', 'unpaired', 'paired'];
    await installWsStub(page);
    await seedIdentity(page, { token: null });
    await installMocks(page, state);

    // Unpaired register: hand back a pairing code UNTIL the status script
    // has actually served its 'paired' step — STATE-keyed, not call-count-
    // keyed, because StrictMode double-fires the boot registration (see the
    // register mock in installMocks). The exchange register that follows
    // the paired heartbeat then completes the pair.
    await page.unroute('**/api/v1/screens/register');
    const pairedStepIndex = state.statusScript.indexOf('paired'); // 0-based
    await page.route('**/api/v1/screens/register', (route) => {
      state.counters.registerCalls += 1;
      const operatorHasPaired =
        pairedStepIndex >= 0 && state.counters.statusCalls > pairedStepIndex;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(
          operatorHasPaired
            ? { paired: true, screenId: FAKE_SCREEN_ID, name: 'Cred Test Screen', deviceToken: RENEWED_TOKEN }
            : { paired: false, pairingCode: 'CRED42', screenId: FAKE_SCREEN_ID, name: 'Cred Test Screen' },
        ),
      });
    });

    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await expect(page.getByText('CRED42'), 'pairing code shows').toBeVisible({ timeout: 30_000 });

    // Polling outlives the failure burst AND the unpaired responses…
    await expect
      .poll(() => state.counters.statusCalls, { timeout: 90_000, message: 'pairing poll died — the silent-stop bug is back' })
      .toBeGreaterThanOrEqual(5);
    // …and the paired answer completes exchange → connect → content.
    await expect(contentImg(page), 'paired screen reaches content').toBeVisible({ timeout: 45_000 });
  });

  test('4. total auth outage while playing: content stays on glass, no reload storm', async ({ page }) => {
    test.setTimeout(90_000);
    const state = freshState();
    await installWsStub(page);
    await seedIdentity(page, { token: BOOT_TOKEN });
    await installMocks(page, state);

    await page.goto('/player?fp=' + FAKE_FINGERPRINT);
    await expect(contentImg(page)).toBeVisible({ timeout: 45_000 });

    // Everything auth-shaped dies: manifests 401, register 500.
    state.manifestMode = '401';
    state.registerMode = '500';

    // Ride through ~20s of failures (multiple poll+recovery cycles).
    await expect
      .poll(() => state.counters.manifest401s, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(8_000);

    // The operator rule: once content is live, it STAYS live.
    await expect(contentImg(page), 'content survived the auth outage').toBeVisible();
    await expect(page.getByText('CRED42')).toHaveCount(0); // never regressed to pairing splash
  });
});
