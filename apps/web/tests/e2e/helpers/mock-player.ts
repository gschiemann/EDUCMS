/**
 * A fully mocked player, shared by the render-proof and refresh-ack specs.
 *
 * Every request is intercepted (a catch-all on the fake `api.invalid` origin
 * NXDOMAINs anything unmocked) — no real ids or tokens, the repo is public. The
 * WebSocket is stubbed the way emergency-path.spec.ts does it: non-/realtime
 * sockets go to the real one (Next dev HMR uses one — replacing it wholesale
 * stalls the page boot with no errors), the realtime one auto-AUTH_OKs.
 */
import type { Page, Route } from '@playwright/test';

const SLOT_MS = 1_200;

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const ok = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });

export function playerIds(tag: string) {
  return {
    screenId: `test-screen-proof-${tag}`,
    fingerprint: `test-fp-proof-${tag}`,
    deviceToken: `fake.device.token.proof.${tag}`,
  };
}

export function playerManifest(screenId: string, kind: 'images' | 'website') {
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

export interface Posted {
  render?: { hash?: string } | null;
}

export interface BootOptions {
  tag: string;
  kind: 'images' | 'website';
  /** localStorage seeded BEFORE the page's scripts run (e.g. a persisted refresh ack). */
  storage?: Record<string, string>;
  /** HTTP statuses `POST …/refresh-ack` answers with, in order; the last one repeats. Default [200]. */
  refreshAckStatuses?: number[];
}

export interface BootedPlayer {
  /** Every telemetry POST body the page made. */
  telemetry: Posted[];
  /** Every `refresh-ack` POST: its parsed body and whether it carried a bearer token. */
  refreshAcks: Array<{ body: unknown; hasBearer: boolean; at: number }>;
}

export async function bootMockPlayer(page: Page, opts: BootOptions): Promise<BootedPlayer> {
  const { tag, kind } = opts;
  const id = playerIds(tag);
  const telemetry: Posted[] = [];
  const refreshAcks: BootedPlayer['refreshAcks'] = [];

  await page.addInitScript(
    ({ deviceToken, fingerprint, native, storage }) => {
      try {
        localStorage.setItem('edu_device_token', deviceToken);
        localStorage.setItem('edu_device_fp', fingerprint);
        // Seed only what is not already there, so a page.reload() keeps the
        // page's own writes (e.g. the "already reported" marker).
        for (const [k, v] of Object.entries(storage || {})) {
          if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
        }
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
    { deviceToken: id.deviceToken, fingerprint: id.fingerprint, native: kind === 'website', storage: opts.storage || {} },
  );

  // Catch-all FIRST (Playwright matches last-registered first).
  await page.route(/http:\/\/api\.invalid\/.*/, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/screens/register', (route) =>
    ok(route, { paired: true, screenId: id.screenId, name: `Proof ${tag}`, deviceToken: id.deviceToken }),
  );
  await page.route(`**/api/v1/screens/${id.screenId}/manifest`, (route) => ok(route, playerManifest(id.screenId, kind)));
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

  const statuses = opts.refreshAckStatuses && opts.refreshAckStatuses.length ? opts.refreshAckStatuses : [200];
  await page.route(`**/api/v1/screens/${id.screenId}/refresh-ack`, async (route) => {
    const req = route.request();
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { /* malformed */ }
    refreshAcks.push({ body, hasBearer: /^Bearer\s+\S+/.test(req.headers()['authorization'] || ''), at: Date.now() });
    const status = statuses[Math.min(refreshAcks.length - 1, statuses.length - 1)];
    await ok(route, status < 300 ? { ok: true, refreshAcked: true } : { code: 'X' }, status);
  });

  await page.goto('/player?fp=' + id.fingerprint);
  return { telemetry, refreshAcks };
}

