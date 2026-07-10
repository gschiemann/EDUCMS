import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * URL-ASSET LED AUTO-FIT — regression gate for the 2026-07-10 operator
 * report: "i pushed a web url to the LED score board and it didnt auto fit
 * in to the 960x1080 that the 3 posters create."
 *
 * Root cause: the playlist iframe filled the canvas region 1:1, so on a
 * 960-wide LED canvas the site laid out at a 960px viewport (squeezed
 * tablet layout / cut off) instead of reading like a desktop page fitted
 * to the wall. Fix: ScaledWebFrame (player/page.tsx) renders text/html
 * assets at a VIRTUAL 1280-wide viewport and transform:scales down to the
 * canvas whenever --led-w < 1280. Canvases ≥1280 keep the pre-fix direct
 * iframe.
 *
 * This spec boots the REAL /player route (chromium + webkit) with a fully
 * mocked API serving an ASSET playlist containing one text/html item, and
 * asserts both behaviors:
 *   1. canvasW=960&canvasH=1080 → iframe laid out at 1280×1440 with
 *      transform scale(0.75) inside a 960-wide clipping wrapper.
 *   2. no canvas pin (normal TV) → direct full-size iframe, no scaling.
 *
 * All API calls intercepted; repo is PUBLIC — no real identities.
 */

const FAKE_SCREEN_ID = 'test-screen-000000000000';
const FAKE_TENANT_ID = 'test-tenant-000000000000';
const FAKE_DEVICE_TOKEN = 'fake.device.token.not.real';
const FAKE_FINGERPRINT = 'test-fp-url-ledfit';

// Manifest whose single playlist is an ASSET playlist (no template) with
// one web-URL item. Items use the API's FLAT manifest shape — the player's
// combinedItems mapper (page.tsx ~L3525) reads item_id / url / mime_type /
// duration_ms / sequence, NOT a nested asset object.
function urlAssetManifest() {
  return {
    tenantId: FAKE_TENANT_ID,
    tenantName: 'Test Tenant',
    orientation: 'LANDSCAPE',
    playlists: [
      {
        id: 'pl-url-asset',
        name: 'URL Asset Playlist',
        items: [
          {
            item_id: 'item-web-1',
            asset_id: 'asset-web-1',
            sequence: 0,
            duration_ms: 60_000,
            url: 'https://example.com/scoreboard',
            mime_type: 'text/html',
          },
        ],
      },
    ],
  };
}

async function installApiMocks(page: Page) {
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });

  // Broad catch-alls FIRST (Playwright matches in reverse registration
  // order); specific endpoints after so they win.
  await page.route(/http:\/\/api\.invalid\/.*/, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 204, body: '' }));

  await page.route('**/api/v1/screens/register', (route) =>
    ok(route, { paired: true, screenId: FAKE_SCREEN_ID, name: 'Test Screen', deviceToken: FAKE_DEVICE_TOKEN }),
  );
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest`, (route) => ok(route, urlAssetManifest()));
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/emergency-assets`, (route) =>
    ok(route, { assets: [], setHash: 'empty-fake-hash' }),
  );
  await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/cache-status`, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await page.route(/\/api\/v1\/screens\/status\//, (route) =>
    ok(route, { paired: true, screenId: FAKE_SCREEN_ID, name: 'Test Screen', tenantId: FAKE_TENANT_ID }),
  );
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));

  // The player routes text/html assets through the server proxy — serve a
  // tiny page so the iframe actually loads.
  await page.route('**/api/v1/proxy/web*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body style="margin:0;background:#123;color:#fff"><h1>proxied page</h1></body></html>',
    }),
  );
}

// Pairing seed + selective WS/SSE stub — copied VERBATIM from the proven
// widget-render.spec.ts harness (delegating non-/realtime URLs to the real
// WebSocket so Next's HMR socket stays live, auto-AUTH_OK on the player's
// realtime endpoint so boot never enters reconnect backoff).
async function installPlayerTestHarness(page: Page) {
  await page.addInitScript(
    ({ deviceToken, fingerprint }) => {
      try {
        localStorage.setItem('edu_device_token', deviceToken);
        localStorage.setItem('edu_device_fp', fingerprint);
      } catch {
        /* ignore */
      }

      const RealWS = window.WebSocket;
      function StubWebSocket(this: unknown, url: string, protocols?: unknown) {
        if (!url.includes('/realtime')) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return new (RealWS as any)(url, protocols);
        }
        const inst: Record<string, unknown> = {
          url,
          readyState: RealWS.CONNECTING,
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          send() {},
          close() {
            (this as { readyState: number }).readyState = RealWS.CLOSED;
          },
          addEventListener() {},
          removeEventListener() {},
        };
        setTimeout(() => {
          inst.readyState = RealWS.OPEN;
          if (typeof inst.onopen === 'function') (inst.onopen as (e: Event) => void).call(null, new Event('open'));
          setTimeout(() => {
            const authOk = {
              type: 'AUTH_OK',
              data: { deviceId: 'fake-device', expiresAt: Date.now() + 3600_000, serverTime: Date.now() },
              idempotencyKey: 'auth-ok-1',
              timestamp: Date.now(),
            };
            if (typeof inst.onmessage === 'function') {
              (inst.onmessage as (e: MessageEvent) => void).call(
                null,
                new MessageEvent('message', { data: JSON.stringify(authOk) }),
              );
            }
          }, 10);
        }, 5);
        return inst;
      }
      (StubWebSocket as unknown as Record<string, number>).CONNECTING = RealWS.CONNECTING;
      (StubWebSocket as unknown as Record<string, number>).OPEN = RealWS.OPEN;
      (StubWebSocket as unknown as Record<string, number>).CLOSING = RealWS.CLOSING;
      (StubWebSocket as unknown as Record<string, number>).CLOSED = RealWS.CLOSED;
      try {
        Object.defineProperty(window, 'WebSocket', { value: StubWebSocket, writable: true, configurable: true });
      } catch {
        (window as unknown as { WebSocket: unknown }).WebSocket = StubWebSocket;
      }

      class StubEventSource {
        url: string;
        readyState = 0;
        onopen: ((e: Event) => void) | null = null;
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: Event) => void) | null = null;
        constructor(url: string) {
          this.url = url;
        }
        addEventListener() {}
        close() {}
      }
      (window as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    },
    { deviceToken: FAKE_DEVICE_TOKEN, fingerprint: FAKE_FINGERPRINT },
  );
}

test.describe('URL asset auto-fit on LED canvases', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await installPlayerTestHarness(page);
  });

  test('960×1080 canvas: web page renders at virtual 1280 viewport scaled 0.75', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/player?fp=${FAKE_FINGERPRINT}&canvasW=960&canvasH=1080`, {
      waitUntil: 'domcontentloaded',
    });

    // The proxied web iframe must appear (playlist reached the web item).
    const iframe = page.locator('iframe[src*="proxy/web"]');
    await expect(iframe).toBeVisible({ timeout: 60_000 });

    // Diagnostic (kept: cheap, and invaluable when this gate ever reds)
    const diag = await page.evaluate(() => ({
      ledW: getComputedStyle(document.documentElement).getPropertyValue('--led-w'),
      ledH: getComputedStyle(document.documentElement).getPropertyValue('--led-h'),
      docStyle: document.documentElement.getAttribute('style')?.slice(0, 200),
      iframeParentClass: document.querySelector('iframe[src*="proxy/web"]')?.parentElement?.className?.slice(0, 120),
    }));
    console.log('[ledfit-diag]', JSON.stringify(diag));

    // ScaledWebFrame contract: virtual 1280-wide viewport, scale = 960/1280
    // = 0.75, virtual height = 1080/0.75 = 1440, origin top-left.
    await expect
      .poll(async () =>
        iframe.evaluate((el) => {
          const cs = getComputedStyle(el);
          return {
            width: cs.width,
            height: cs.height,
            transform: cs.transform,
            origin: cs.transformOrigin,
          };
        }),
      )
      .toEqual({
        width: '1280px',
        height: '1440px',
        transform: 'matrix(0.75, 0, 0, 0.75, 0, 0)',
        origin: '0px 0px',
      });

    // The wrapper clips to the canvas region: the iframe's VISUAL box
    // (bounding rect after transform) must be exactly the 960×1080 canvas.
    const rect = await iframe.boundingBox();
    expect(Math.round(rect!.width)).toBe(960);
    expect(Math.round(rect!.height)).toBe(1080);
  });

  test('no canvas pin (normal TV): direct iframe, no virtual scaling', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/player?fp=${FAKE_FINGERPRINT}`, { waitUntil: 'domcontentloaded' });

    const iframe = page.locator('iframe[src*="proxy/web"]');
    await expect(iframe).toBeVisible({ timeout: 60_000 });

    // Pre-fix behavior preserved: fills the viewport, no transform scale.
    await expect
      .poll(async () => iframe.evaluate((el) => getComputedStyle(el).transform))
      .toBe('none');
    const rect = await iframe.boundingBox();
    const viewport = page.viewportSize()!;
    expect(Math.round(rect!.width)).toBe(viewport.width);
  });
});
