/**
 * "Loading content" on a screen that is playing — the render-proof regression
 * (Greg, 2026-09-28: "why do all the screens saying loading content?").
 *
 * The player tells the dashboard what is on its glass in the `render.hash` of
 * every telemetry POST. `pl:…` means "operator content is playing";
 * `idle:content-loading` means "a playlist is applied and its first item has
 * not reported loaded yet" and the dashboard says "Loading content".
 *
 * Commit 12d65e8dd (2026-09-24, "honest playback readiness") made that verdict
 * depend on a `mediaReady` flag that is reset to false at EVERY slide change
 * and set true only by a media element's load event. Two kinds of slide can
 * never fire one again:
 *
 *   1. An IMAGE slideshow. Every image is mounted at once and only its opacity
 *      changes, so after the first advance each `<img>` is already loaded — no
 *      new `load` event — and the flag stays false for the rest of the show.
 *   2. A WEBSITE slide shown by the APK's native viewer. The page renders only
 *      a black placeholder; nothing on the page ever reports "loaded".
 *
 * Both read "Loading content" on the dashboard for as long as they play. This
 * spec boots a fully mocked player (every request intercepted — no real ids or
 * tokens, the repo is public) and asserts the proof becomes `pl:…`.
 *
 * Telemetry posts at load and again ≥ 30 s later (TELEMETRY_MIN_INTERVAL_MS),
 * so each case waits for a `render.hash` that says `pl:`.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const SLOT_MS = 1_200;

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const ok = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });

function ids(tag: string) {
  return {
    screenId: `test-screen-proof-${tag}`,
    fingerprint: `test-fp-proof-${tag}`,
    deviceToken: `fake.device.token.proof.${tag}`,
  };
}

function manifest(screenId: string, kind: 'images' | 'website') {
  const items =
    kind === 'images'
      ? Array.from({ length: 3 }, (_, i) => ({
          item_id: `item-${i}`,
          asset_id: `asset-${i}`,
          url: `http://api.invalid/assets/slide-${i}.png`,
          duration_ms: SLOT_MS,
          sequence: i,
          mime_type: 'image/png',
          transition_type: 'NONE',
          muted: true,
        }))
      : [
          {
            item_id: 'item-web',
            asset_id: 'asset-web',
            url: 'https://site.invalid/menu',
            duration_ms: 60_000,
            sequence: 0,
            mime_type: 'text/html',
            transition_type: 'NONE',
            muted: true,
          },
        ];
  return {
    version: '1.0',
    screenId,
    tenantId: 'test-tenant-proof',
    tenantName: 'Proof Test Tenant',
    generatedAt: new Date().toISOString(),
    isEmergency: false,
    orientation: 'LANDSCAPE',
    canvasW: null,
    canvasH: null,
    repeats: 1,
    playlists: [
      {
        id: 'pl-proof',
        name: kind === 'images' ? 'Scan slideshow' : 'Website',
        schedule: { daysOfWeek: null, timeStart: null, timeEnd: null, mutedOverride: null },
        items,
      },
    ],
  };
}

interface Posted {
  render?: { hash?: string } | null;
}

async function boot(page: Page, tag: string, kind: 'images' | 'website') {
  const id = ids(tag);
  const telemetry: Posted[] = [];

  await page.addInitScript(
    ({ deviceToken, fingerprint, native }) => {
      try {
        localStorage.setItem('edu_device_token', deviceToken);
        localStorage.setItem('edu_device_fp', fingerprint);
      } catch { /* ignore */ }

      // The APK's native channel: only the website case needs it. The player asks
      // `nativeHas('showUrlOverlay')` and hands the URL to the app's own WebView.
      if (native) {
        const w = window as unknown as Record<string, unknown>;
        w.EduCmsNativeChannel = { postMessage: () => undefined };
        w.__eduCmsNativeChannelMethods = ['showUrlOverlay', 'hideUrlOverlay', 'heartbeat'];
      }

      // Delegate every non-/realtime socket to the real WebSocket (Next dev HMR
      // uses one); auto-AUTH_OK the realtime one.
      const RealWS = window.WebSocket;
      function StubWebSocket(this: unknown, url: string, protocols?: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!url.includes('/realtime')) return new (RealWS as any)(url, protocols);
        const inst: Record<string, unknown> = {
          url,
          readyState: RealWS.CONNECTING,
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          send() { /* nothing to answer */ },
          close() { inst.readyState = RealWS.CLOSED; },
          addEventListener() { /* unused */ },
          removeEventListener() { /* unused */ },
        };
        setTimeout(() => {
          inst.readyState = RealWS.OPEN;
          (inst.onopen as ((e: Event) => void) | null)?.call(null, new Event('open'));
          setTimeout(() => {
            (inst.onmessage as ((e: MessageEvent) => void) | null)?.call(
              null,
              new MessageEvent('message', {
                data: JSON.stringify({
                  type: 'AUTH_OK',
                  payload: { deviceId: 'fake-device', expiresAt: Date.now() + 3_600_000, serverTime: Date.now() },
                  idempotencyKey: 'auth-ok-1',
                  timestamp: Date.now(),
                }),
              }),
            );
          }, 10);
        }, 5);
        return inst;
      }
      Object.assign(StubWebSocket, {
        CONNECTING: RealWS.CONNECTING,
        OPEN: RealWS.OPEN,
        CLOSING: RealWS.CLOSING,
        CLOSED: RealWS.CLOSED,
      });
      try {
        Object.defineProperty(window, 'WebSocket', { value: StubWebSocket, writable: true, configurable: true });
      } catch {
        (window as unknown as { WebSocket: unknown }).WebSocket = StubWebSocket;
      }
      class StubEventSource {
        url: string;
        readyState = 0;
        constructor(url: string) { this.url = url; }
        addEventListener() { /* no-op */ }
        close() { /* no-op */ }
      }
      (window as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    },
    { deviceToken: id.deviceToken, fingerprint: id.fingerprint, native: kind === 'website' },
  );

  // Catch-all FIRST (Playwright matches last-registered first).
  await page.route(/http:\/\/api\.invalid\/.*/, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/screens/register', (route) =>
    ok(route, { paired: true, screenId: id.screenId, name: `Proof ${tag}`, deviceToken: id.deviceToken }),
  );
  await page.route(`**/api/v1/screens/${id.screenId}/manifest`, (route) => ok(route, manifest(id.screenId, kind)));
  await page.route(`**/api/v1/screens/${id.screenId}/emergency-assets`, (route) =>
    ok(route, { assets: [], setHash: 'empty-fake-hash' }),
  );
  await page.route(`**/api/v1/screens/${id.screenId}/cache-status`, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(`**/api/v1/screens/${id.screenId}/render-proof`, (route) => ok(route, { ok: true }));
  await page.route(`**/api/v1/screens/${id.screenId}/telemetry`, async (route) => {
    try {
      telemetry.push(route.request().postDataJSON() as Posted);
    } catch { /* malformed body — ignore */ }
    // The floor is 30 s (TELEMETRY_MIN_INTERVAL_MS); ask for exactly that.
    await ok(route, { ok: true, nextTelemetryInMs: 30_000 });
  });
  await page.route(/\/api\/v1\/screens\/status\//, (route) =>
    ok(route, { paired: true, screenId: id.screenId, name: 'Proof Screen', tenantId: 'test-tenant-proof' }),
  );
  await page.route('**/api/v1/emergency/status*', (route) => ok(route, { active: [] }));
  await page.route('**/api/v1/notifications/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/analytics/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/player/latest-version-public', (route) => ok(route, {}));
  await page.route('**/api/v1/player/update-check', (route) => ok(route, { available: false }));
  await page.route('**/api/v1/security/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/realtime/time*', (route) => ok(route, { serverNow: Date.now() }));
  // Tiny real PNGs so every <img> decodes instantly.
  await page.route('**/assets/slide-*.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }),
  );

  await page.goto('/player?fp=' + id.fingerprint);
  return telemetry;
}

/** Every proof string the player has reported so far. */
const hashes = (posted: Posted[]) => posted.map((p) => p.render?.hash).filter((h): h is string => typeof h === 'string');

test.describe('render proof: a playing screen must not read "Loading content"', () => {
  test('an IMAGE slideshow reports pl:, not idle:content-loading, after its slides advance', async ({ page }) => {
    test.setTimeout(90_000);
    page.on('pageerror', (err) => {
      if (!/Hydration failed|hydration/i.test(err.message)) throw new Error(`pageerror: ${err.message}`);
    });
    const telemetry = await boot(page, 'images', 'images');

    // Sanity: the slideshow really is mounted (all three images at once), so a
    // failure below is the proof verdict — not a page that never reached content.
    await expect(page.locator('img[data-slide-id]')).toHaveCount(3, { timeout: 30_000 });

    // Several slides have advanced long before the second post (≥ 30 s).
    await expect
      .poll(() => hashes(telemetry).some((h) => h.startsWith('pl:')), {
        timeout: 60_000,
        intervals: [1_000],
        message: `proofs seen: ${JSON.stringify(hashes(telemetry))}`,
      })
      .toBe(true);
    expect(hashes(telemetry).filter((h) => h === 'idle:content-loading')).toHaveLength(0);
  });

  test('a WEBSITE slide on the native viewer reports pl:, not idle:content-loading', async ({ page }) => {
    test.setTimeout(90_000);
    page.on('pageerror', (err) => {
      if (!/Hydration failed|hydration/i.test(err.message)) throw new Error(`pageerror: ${err.message}`);
    });
    const telemetry = await boot(page, 'website', 'website');

    // Sanity: the page handed the site to the native viewer (its placeholder is
    // all that renders here).
    await expect(page.locator('[aria-label="Native URL overlay active"]')).toHaveCount(1, { timeout: 30_000 });

    await expect
      .poll(() => hashes(telemetry).some((h) => h.startsWith('pl:')), {
        timeout: 60_000,
        intervals: [1_000],
        message: `proofs seen: ${JSON.stringify(hashes(telemetry))}`,
      })
      .toBe(true);
    expect(hashes(telemetry).filter((h) => h === 'idle:content-loading')).toHaveLength(0);
  });
});
