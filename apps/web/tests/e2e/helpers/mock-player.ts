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
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

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

export type MockKind = 'images' | 'website' | 'video';

export function playerManifest(screenId: string, kind: MockKind, playback?: { loopMode: string }, copies = 1, mp4 = false, mp4Fixture = 'loop-clip.mp4') {
  const items =
    kind === 'video'
      ? // `copies` > 1 is the same clip added several times (RIOT Cleveland's playlist).
        Array.from({ length: Math.max(1, copies) }, (_, i) => ({
          item_id: i === 0 ? 'item-video' : `item-video-${i + 1}`,
          asset_id: 'asset-video',
          url: 'http://api.invalid/assets/loop-clip.' + (mp4 ? 'mp4' : 'webm'),
          ...(mp4 ? { asset_hash: createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', 'fixtures', mp4Fixture))).digest('hex') } : {}),
          duration_ms: 2500,
          sequence: i,
          mime_type: mp4 ? 'video/mp4' : 'video/webm',
          transition_type: i === 0 ? 'NONE' : 'FADE',
          muted: true,
        }))
      : kind === 'images'
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
    ...(playback ? { playback } : {}),
    canvasW: null,
    canvasH: null,
    repeats: 1,
    playlists: [
      {
        id: 'pl-proof',
        name: kind === 'images' ? 'Scan slideshow' : kind === 'video' ? 'Solo video' : 'Website',
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
  kind: MockKind;
  /** The manifest's `playback` block (per-screen switches), e.g. `{ loopMode: 'twodeck' }`. */
  playback?: { loopMode: string };
  /** For kind 'video': answer every request for the clip AFTER the first with this status (a standby that cannot load). */
  videoFailAfterFirst?: number;
  /** For kind 'video': how many requests the clip has had. */
  videoRequests?: { count: number };
  /** For kind 'video': the SAME clip added this many times (default 1). */
  videoCopies?: number;
  videoMp4?: boolean;
  /** A synthetic MP4 fixture, used consistently for its manifest digest and bytes. */
  videoMp4Fixture?: string;
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
  await page.route(`**/api/v1/screens/${id.screenId}/manifest`, (route) => ok(route, playerManifest(id.screenId, kind, opts.playback, opts.videoCopies, opts.videoMp4, opts.videoMp4Fixture)));
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

  // The clip, served with Range support (a <video> seeks and re-requests).
  if (kind === 'video') {
    const clip = fs.readFileSync(path.join(__dirname, '..', 'fixtures', opts.videoMp4 ? (opts.videoMp4Fixture ?? 'loop-clip.mp4') : 'loop-clip.webm'));
    await page.route('**/assets/loop-clip.' + (opts.videoMp4 ? 'mp4' : 'webm'), (route) => {
      const n = (opts.videoRequests ? ++opts.videoRequests.count : 0);
      if (opts.videoFailAfterFirst && opts.videoRequests && n > 1) {
        return route.fulfill({ status: opts.videoFailAfterFirst, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
      }
      const range = /^bytes=(\d*)-(\d*)$/.exec(route.request().headers()['range'] || '');
      const cors = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Type': opts.videoMp4 ? 'video/mp4' : 'video/webm' };
      if (!range) return route.fulfill({ status: 200, headers: { ...cors, 'Content-Length': String(clip.length) }, body: clip });
      const start = range[1] === '' ? 0 : Number(range[1]);
      const end = range[2] === '' ? clip.length - 1 : Math.min(Number(range[2]), clip.length - 1);
      return route.fulfill({
        status: 206,
        headers: { ...cors, 'Content-Range': `bytes ${start}-${end}/${clip.length}`, 'Content-Length': String(end - start + 1) },
        body: clip.subarray(start, end + 1),
      });
    });
  }

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
