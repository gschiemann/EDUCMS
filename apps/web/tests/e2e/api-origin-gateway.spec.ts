import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * SAME-ORIGIN GATEWAY FALLBACK — the Android-9 Goodview story, pinned live.
 *
 * THE FIELD FAILURE. The player shell loads from the WEB origin; its entire
 * control plane talks to a SEPARATE API origin. Specific OEM Android WebViews
 * load the shell fine and then cannot reach the API origin at all (TLS chain /
 * DNS / transparent proxy). The screen sat on "Connecting to your CMS…"
 * forever, with the operator seeing no error worth acting on.
 *
 * The unit suites pin the pure pieces (`apiOrigin.ts` decides WHEN to switch,
 * `gatewayPaths.ts` decides WHAT the gateway carries, `client-ip.spec.ts`
 * pins that the API still throttles per DEVICE). THIS test pins the WIRING:
 * the real page, with the direct origin failing at the TRANSPORT layer,
 * (a) tells the operator it cannot connect, (b) moves its control plane to
 * the page origin, and (c) completes registration AND the manifest fetch
 * there — the whole plane, not registration alone.
 *
 * Harness rules obeyed (CLAUDE.md player rule 14): the WS stub delegates
 * every non-`/realtime` URL to the real WebSocket (a wholesale replacement
 * stalls Next dev HMR and the entire page boot); mocks key on STATE, never
 * call counts (StrictMode double-fires mount effects in dev).
 */

const FAKE_SCREEN_ID = 'test-screen-000000gateway';
const FAKE_TENANT_ID = 'test-tenant-000000gateway';
const FAKE_FINGERPRINT = 'test-fp-gateway-story';
const DEVICE_TOKEN = 'gateway.device.token-not-real';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
// Served from the page origin so the image is not collateral damage of the
// direct-origin blackout (media is NOT part of the gateway allowlist).
const IMG_PATH = '/gateway-test-asset.png';

function playingManifest(origin: string) {
  return {
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Gateway Test Tenant',
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
            url: `${origin}${IMG_PATH}`,
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
  /** Control-plane calls that went to the DIRECT (API) origin — all blackholed. */
  directCalls: string[];
  /** Control-plane calls that came back through the SAME-ORIGIN gateway. */
  gatewayCalls: string[];
  gatewayRegisters: number;
  gatewayManifests: number;
};

const freshState = (): MockState => ({
  directCalls: [],
  gatewayCalls: [],
  gatewayRegisters: 0,
  gatewayManifests: 0,
});

/**
 * ONE handler for every `/api/v1/*` call, dispatching on the ORIGIN:
 *   • the direct API origin (`api.invalid`) → `route.abort('failed')`, which
 *     surfaces in the page exactly like the field failure: a TypeError
 *     ("Failed to fetch"), NOT an HTTP status. That distinction is the whole
 *     point — an HTTP error must never trigger the switch.
 *   • the page origin → the gateway, answered normally. In production Next
 *     middleware rewrites these to the API; here Playwright stands in for it,
 *     because what this test pins is the PLAYER's behaviour.
 */
async function installMocks(page: Page, state: MockState, baseOrigin: string) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });

  await page.route(`**${IMG_PATH}`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }),
  );

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    // ── THE BLACKOUT: the API origin is unreachable at the transport layer.
    if (url.host === 'api.invalid') {
      state.directCalls.push(path);
      return route.abort('failed');
    }

    // ── THE GATEWAY: same-origin, reachable.
    state.gatewayCalls.push(path);

    if (path === '/api/v1/screens/register') {
      state.gatewayRegisters += 1;
      return ok(route, {
        paired: true,
        screenId: FAKE_SCREEN_ID,
        name: 'Gateway Test Screen',
        deviceToken: DEVICE_TOKEN,
      });
    }
    if (path === `/api/v1/screens/${FAKE_SCREEN_ID}/manifest`) {
      state.gatewayManifests += 1;
      return ok(route, playingManifest(baseOrigin));
    }
    if (path.startsWith('/api/v1/screens/status/')) {
      return ok(route, {
        paired: true,
        screenId: FAKE_SCREEN_ID,
        name: 'Gateway Test Screen',
        tenantId: FAKE_TENANT_ID,
      });
    }
    if (path.endsWith('/emergency-assets')) return ok(route, { assets: [], setHash: 'empty' });
    if (path === '/api/v1/emergency/messages' || path === '/api/v1/emergency/status') {
      return ok(route, { active: [] });
    }
    if (path === '/api/v1/player/update-check') return ok(route, { available: false });
    // Everything else in the allowlist (cache-status, render-proof, help,
    // version metadata…) — accepted and ignored.
    return route.fulfill({ status: 204, body: '' });
  });
}

/**
 * ⚠️ Stub ONLY the player's `/realtime` socket and DELEGATE everything else
 * to the real constructor — Next dev's HMR socket is a real WebSocket, and a
 * wholesale replacement stalls the page boot with no error at all.
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
              idempotencyKey: 'auth-ok-gateway',
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

function seedIdentity(page: Page, opts: { gatewayFallback?: boolean } = {}) {
  return page.addInitScript(
    ({ fp, gatewayFallback }) => {
      try {
        localStorage.setItem('edu_device_fp', fp);
        localStorage.removeItem('edu_api_gateway_fallback');
        if (gatewayFallback) localStorage.setItem('edu_api_gateway_fallback', '1');
      } catch { /* unreachable in a real browser */ }
    },
    { fp: FAKE_FINGERPRINT, gatewayFallback: !!opts.gatewayFallback },
  );
}

const originMode = (page: Page) =>
  page.evaluate(() => (window as any).__eduApiOrigin?.mode ?? null);

const contentImg = (page: Page) => page.locator(`img[src*="gateway-test-asset"]`);

test.describe('same-origin gateway fallback — the Goodview story', () => {
  test('direct origin blackholed → operator told → whole control plane moves to the page origin', async ({
    page,
    baseURL,
  }) => {
    // Three backoff-spaced registration attempts (full-jitter, up to ~12s then
    // ~24s) plus the 15 s reconnect-toast grace, on a dev-compiling player.
    test.setTimeout(240_000);

    const state = freshState();
    const origin = baseURL ?? 'http://localhost:3000';
    await installWsStub(page);
    await seedIdentity(page);
    await installMocks(page, state, origin);

    await page.goto('/player?fp=' + FAKE_FINGERPRINT);

    // 1) It tries DIRECT first, exactly as before — no behaviour change for a
    //    healthy fleet.
    await expect
      .poll(() => state.directCalls.filter((p) => p.endsWith('/register')).length, {
        timeout: 60_000,
        message: 'the player never attempted the direct origin first',
      })
      .toBeGreaterThanOrEqual(1);
    expect(state.gatewayRegisters, 'it must not jump to the gateway on the first try').toBe(0);

    // 2) (a) THE OPERATOR IS TOLD. Not a silent "Connecting…" forever.
    await expect(
      page.locator('[data-edu-reconnect-toast]'),
      'the reconnect panel never appeared — this is the "Connecting to your CMS…" forever bug',
    ).toBeVisible({ timeout: 90_000 });

    // 3) (b) IT SWITCHES to the same origin after N network-class failures.
    await expect
      .poll(() => originMode(page), {
        timeout: 120_000,
        message: 'the player never moved its control plane to the same-origin gateway',
      })
      .toBe('gateway');

    // 4) (c) REGISTRATION COMPLETES through the gateway…
    await expect
      .poll(() => state.gatewayRegisters, { timeout: 60_000, message: 'no register reached the gateway' })
      .toBeGreaterThanOrEqual(1);

    // …AND SO DOES THE MANIFEST. This is the assertion that makes this a
    // control-plane fix rather than a registration-only one: a screen that
    // pairs on one path and then loses manifests (and therefore emergency
    // alerts) on another is WORSE than one that never paired.
    await expect
      .poll(() => state.gatewayManifests, { timeout: 90_000, message: 'the manifest never came through the gateway' })
      .toBeGreaterThanOrEqual(1);

    // …and content actually reaches the glass.
    await expect(contentImg(page), 'playlist content never rendered over the gateway').toBeVisible({
      timeout: 60_000,
    });

    // The decision is persisted so the next reconnect does not re-suffer the
    // outage from scratch.
    expect(
      await page.evaluate(() => localStorage.getItem('edu_api_gateway_fallback')),
    ).toBe('1');
  });

  test('a device with a persisted fallback re-probes direct, then switches on the FIRST failure', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    const state = freshState();
    const origin = baseURL ?? 'http://localhost:3000';
    await installWsStub(page);
    await seedIdentity(page, { gatewayFallback: true });
    await installMocks(page, state, origin);

    await page.goto('/player?fp=' + FAKE_FINGERPRINT);

    // THE SELF-HEAL PROBE: even remembering a bad direct path, boot still
    // tries direct once. (Without this a device would stay on the longer path
    // forever after one bad afternoon on the venue's WiFi.)
    await expect
      .poll(() => state.directCalls.filter((p) => p.endsWith('/register')).length, {
        timeout: 60_000,
        message: 'a remembered fallback must still re-probe the direct origin at boot',
      })
      .toBeGreaterThanOrEqual(1);

    // …and because direct is still dead, it switches immediately rather than
    // burning three backoff cycles before every boot.
    await expect
      .poll(() => state.gatewayManifests, {
        timeout: 90_000,
        message: 'a known-bad device did not switch on its first failure',
      })
      .toBeGreaterThanOrEqual(1);
    expect(await originMode(page)).toBe('gateway');
    await expect(contentImg(page)).toBeVisible({ timeout: 60_000 });
  });
});
