/**
 * STREAMING widget — frames actually advance, in Chromium AND WebKit.
 *
 * 2026-11-07 flagship audit (docs/handoffs/2026-11-07-streaming-widget-audit.md).
 *
 * Player (the real /player route, fully mocked API, `bootMockPlayer`):
 *   1. a LIVE HLS stream (Akamai test channel) in a full-screen STREAMING
 *      zone → the frame counter (`data-stream-frames`, requestVideoFrameCallback)
 *      ADVANCES across a 3 s window, the engine reports `isLive`, and the LIVE
 *      badge is on the glass;
 *   2. two streams on one board (Mux VOD + Apple bipbop multi-bitrate) both
 *      advance — the low-end budget path (`capLevelToPlayerSize`) still plays;
 *   3. a dead stream host → the honest offline card, never a black box.
 *
 * Builder: paste → auto-detect chip → Test stream → frames counted.
 *
 * The three public test streams are third-party. When the runner cannot reach
 * them the network tests SKIP with that reason (a skip is not a pass) — the
 * offline-card test needs no network and always runs.
 *
 * Screenshots: STREAM_SHOTS=1 writes 1325×758 and 390×844 shots of the editor
 * and the player render to STREAM_SHOT_DIR (default
 * docs/research/2026-11-07-streaming-widget/, which is gitignored).
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import path from 'path';
import { bootMockPlayer, playerIds } from './helpers/mock-player';

// Live candidates, in order. The Akamai channel was the brief's pick; on
// 2026-11-07 its master answered 200 but its only level playlist 404'd — the
// widget correctly showed "Didn't play (levelLoadError)". So the spec picks the
// first candidate whose master AND first variant both answer.
const LIVE_CANDIDATES = [
  'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8',
  'https://demo.unified-streaming.com/k8s/live/stable/live.isml/.m3u8',
];
const MUX_VOD = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const BIPBOP = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8';

const SHOTS = process.env.STREAM_SHOTS === '1';
const SHOT_DIR = process.env.STREAM_SHOT_DIR || path.resolve(__dirname, '../../../../docs/research/2026-11-07-streaming-widget');
const VIEWPORTS = [
  { name: 'desktop-1325x758', width: 1325, height: 758 },
  { name: 'phone-390x844', width: 390, height: 844 },
];

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  const browser = page.context().browser()?.browserType().name() ?? 'browser';
  await page.screenshot({ path: path.join(SHOT_DIR, `${browser}-${name}.png`) });
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return false;
    const body = await res.text();
    // A master playlist: its first variant must answer too.
    const variant = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    if (!variant || !/#EXT-X-STREAM-INF/.test(body)) return true;
    const v = await fetch(new URL(variant, url).toString(), { signal: AbortSignal.timeout(8_000) });
    return v.ok;
  } catch {
    return false;
  }
}

let liveHls: string | null | undefined;
async function pickLive(): Promise<string | null> {
  if (liveHls !== undefined) return liveHls;
  for (const u of LIVE_CANDIDATES) if (await reachable(u)) return (liveHls = u);
  return (liveHls = null);
}

function streamingManifest(screenId: string, zones: Array<{ id: string; x: number; y: number; width: number; height: number; config: Record<string, unknown> }>) {
  return {
    tenantId: 'test-tenant-stream',
    tenantName: 'Stream Test',
    orientation: 'LANDSCAPE',
    screenId,
    playlists: [
      {
        id: 'pl-stream',
        name: 'Streaming board',
        template: {
          id: 'tpl-stream',
          name: 'Streaming board',
          screenWidth: 1920,
          screenHeight: 1080,
          bgColor: '#000000',
          zones: zones.map((z) => ({ ...z, name: z.id, widgetType: 'STREAMING', zIndex: 0, defaultConfig: z.config })),
        },
        items: [],
      },
    ],
  } as unknown as Parameters<typeof bootMockPlayer>[1]['manifest'];
}

/** Frames reported by every stream video on the page. */
async function frameCounts(page: Page): Promise<number[]> {
  return page.$$eval('video[data-stream-video]', (els) => els.map((e) => Number(e.getAttribute('data-stream-frames') || 0)));
}

async function expectFramesAdvance(page: Page, count: number) {
  // First frames (connect + first segment) — generous for a cold CDN.
  await expect.poll(async () => (await frameCounts(page)).filter((n) => n > 0).length, { timeout: 45_000, intervals: [500] }).toBe(count);
  const before = await frameCounts(page);
  await page.waitForTimeout(3_000);
  const after = await frameCounts(page);
  for (let i = 0; i < count; i++) expect(after[i], `stream ${i} frames advanced (${before[i]} → ${after[i]})`).toBeGreaterThan(before[i]);
}

test.describe('STREAMING widget on the player', () => {
  test.setTimeout(120_000);

  test('a live HLS stream plays: frames advance, LIVE badge shows', async ({ page }) => {
    const LIVE_HLS = await pickLive();
    test.skip(!LIVE_HLS, 'no live HLS test stream reachable from this runner');
    if (!LIVE_HLS) return;
    const id = playerIds('stream-live');
    await bootMockPlayer(page, {
      tag: 'stream-live', identity: id, kind: 'images',
      manifest: streamingManifest(id.screenId, [{ id: 'z-live', x: 0, y: 0, width: 100, height: 100, config: { playbackUrl: LIVE_HLS, muted: true } }]),
    });
    await expectFramesAdvance(page, 1);
    const proof = await page.evaluate(() => Object.values((window as unknown as { __eduStreams?: Record<string, { phase: string; isLive: boolean | null; engine: string }> }).__eduStreams || {}));
    expect(proof).toHaveLength(1);
    expect(proof[0].phase).toBe('playing');
    expect(proof[0].isLive).toBe(true);
    await expect(page.locator('[data-stream-pill="live"]')).toBeVisible();
    await expect(page.locator('[data-stream-kind="hls"]')).toHaveAttribute('data-stream-state', 'playing');
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(600);
      await shot(page, `player-live-${vp.name}`);
    }
  });

  test('two streams on one board both play (VOD + multi-bitrate)', async ({ page }) => {
    test.skip(!(await reachable(MUX_VOD)) || !(await reachable(BIPBOP)), 'Mux / Apple test streams unreachable from this runner');
    const id = playerIds('stream-two');
    await bootMockPlayer(page, {
      tag: 'stream-two', identity: id, kind: 'images',
      manifest: streamingManifest(id.screenId, [
        { id: 'z-mux', x: 0, y: 0, width: 50, height: 100, config: { playbackUrl: MUX_VOD, muted: true } },
        { id: 'z-bipbop', x: 50, y: 0, width: 50, height: 100, config: { playbackUrl: BIPBOP, muted: true, fitMode: 'contain' } },
      ]),
    });
    await expectFramesAdvance(page, 2);
    // VOD never shows a LIVE badge — the badge claims only what is true.
    await expect(page.locator('[data-stream-pill="live"]')).toHaveCount(0);
    await shot(page, 'player-two-streams-desktop-1325x758');
  });

  test('a dead stream shows the honest offline card, not a black box', async ({ page }) => {
    const id = playerIds('stream-dead');
    await bootMockPlayer(page, {
      tag: 'stream-dead', identity: id, kind: 'images',
      manifest: streamingManifest(id.screenId, [{ id: 'z-dead', x: 0, y: 0, width: 100, height: 100, config: { playbackUrl: 'https://stream.example.invalid/live/master.m3u8', muted: true } }]),
      extraRoutes: async (p) => {
        await p.route('https://stream.example.invalid/**', (route: Route) => route.fulfill({ status: 404, body: 'gone', headers: { 'Access-Control-Allow-Origin': '*' } }));
      },
    });
    const root = page.locator('[data-stream-kind="hls"]');
    await expect(root).toHaveAttribute('data-stream-state', 'offline', { timeout: 40_000 });
    await expect(page.locator('[data-stream-card="offline"]')).toBeVisible();
    await expect(page.getByText('Stream offline')).toBeVisible();
    await expect(page.getByText(/Next try in \d+s|Trying again now/)).toBeVisible();
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(500);
      await shot(page, `player-offline-${vp.name}`);
    }
  });

  test('an RTSP camera says it needs a gateway', async ({ page }) => {
    const id = playerIds('stream-rtsp');
    await bootMockPlayer(page, {
      tag: 'stream-rtsp', identity: id, kind: 'images',
      manifest: streamingManifest(id.screenId, [{ id: 'z-rtsp', x: 0, y: 0, width: 100, height: 100, config: { playbackUrl: 'rtsp://camera.example.com/stream1' } }]),
    });
    await expect(page.locator('[data-stream-kind="rtsp"]')).toHaveAttribute('data-stream-state', 'needs-gateway', { timeout: 40_000 });
    await expect(page.getByText('RTSP needs a gateway')).toBeVisible();
    await shot(page, 'player-rtsp-gateway-desktop-1325x758');
  });
});

// ─── Builder editor ─────────────────────────────────────────────────────
const SCHOOL_ID = 'e2e-school';
const TEMPLATE_ID = 'e2e-stream-template';
const ORIGIN = process.env.E2E_BASE || process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const TEMPLATE = {
  id: TEMPLATE_ID, name: 'Stream board', tenantId: SCHOOL_ID, isSystem: false,
  screenWidth: 1920, screenHeight: 1080, bgColor: '#0f172a', scenes: [],
  zones: [
    { id: 'zone-stream', templateId: TEMPLATE_ID, name: 'Live Stream', widgetType: 'STREAMING', x: 5, y: 8, width: 60, height: 60, zIndex: 1, sortOrder: 0, defaultConfig: {}, sceneId: null },
  ],
};

async function openBuilder(page: Page, viewport: { width: number; height: number }) {
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS, body: '' }) : respond();
  const okJson = (route: Route, body: unknown) =>
    cors(route, () => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) }));
  const empty = (route: Route) => cors(route, () => route.fulfill({ status: 204, headers: CORS, body: '' }));
  await page.route(/http:\/\/api\.invalid\/.*/, empty);
  await page.route('**/api/v1/**', empty);
  await page.route('**/auth/me', (r) => okJson(r, { id: 'u1', email: 'e2e@example.com', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false }));
  await page.route('**/tenants', (r) => okJson(r, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID, vertical: 'K12' }]));
  await page.route('**/tenants/accessible', (r) => okJson(r, [{ id: SCHOOL_ID, name: 'E2E School', slug: SCHOOL_ID }]));
  await page.route(`**/templates/${TEMPLATE_ID}`, (r) => okJson(r, TEMPLATE));
  await page.route(`**/templates/${TEMPLATE_ID}/**`, (r) => okJson(r, TEMPLATE));
  await page.route('**/templates', (r) => okJson(r, [TEMPLATE]));
  await page.route('**/branding/me', (r) => okJson(r, {}));
  await page.route('**/screens', (r) => okJson(r, []));
  await page.route('**/playlists', (r) => okJson(r, []));
  await page.route('**/assets**', (r) => okJson(r, []));
  await page.route('**/streaming/channels', (r) => okJson(r, []));
  await page.addInitScript(() => {
    try { localStorage.setItem('edu_cms_eula_accepted_v1.0', '1'); } catch { /* ignore */ }
  });
  await page.setViewportSize(viewport);
  await page.goto(`/${SCHOOL_ID}/templates/builder/${TEMPLATE_ID}`, { waitUntil: 'domcontentloaded' });
  const zone = page.locator('[data-zone-id][data-widget-type="STREAMING"]').first();
  await zone.waitFor({ state: 'visible', timeout: 90_000 });
  await zone.click();
  const props = page.getByRole('tab', { name: /^properties$/i });
  if (await props.isVisible().catch(() => false)) await props.click();
}

test.describe('STREAMING widget editor', () => {
  test.setTimeout(150_000);

  test('paste a live link → auto-detect → Test stream counts frames', async ({ page }) => {
    const LIVE_HLS = await pickLive();
    test.skip(!LIVE_HLS, 'no live HLS test stream reachable from this runner');
    if (!LIVE_HLS) return;
    await openBuilder(page, { width: 1325, height: 758 });
    const field = page.getByLabel('Stream link');
    await field.waitFor({ state: 'visible', timeout: 60_000 });
    await field.fill(LIVE_HLS);
    await field.press('Enter');
    const verdict = page.locator('[data-stream-verdict]');
    await expect(verdict).toHaveAttribute('data-stream-kind', 'hls');
    await expect(verdict).toHaveAttribute('data-stream-verdict', 'supported');
    await expect(verdict).toContainText('HLS stream');
    await expect(verdict).toContainText('Plays on every screen');
    // The canvas zone is the live preview.
    await expect(page.locator('[data-zone-id][data-widget-type="STREAMING"] video[data-stream-video]')).toHaveCount(1);
    await page.locator('[data-stream-test-button]').click();
    await expect(page.getByTestId('stream-test-status')).toContainText(/Playing live · \d+×\d+/, { timeout: 45_000 });
    await expect(page.locator('[data-stream-test]')).toContainText(/\d+ frames/);
    await page.waitForTimeout(1500);
    await shot(page, 'editor-live-test-desktop-1325x758');

    // A camera protocol is called out honestly.
    await field.fill('rtsp://192.168.1.20:554/stream1');
    await field.press('Enter');
    await expect(verdict).toHaveAttribute('data-stream-verdict', 'needs-gateway');
    await expect(verdict).toContainText('Needs an HLS gateway');
    await shot(page, 'editor-rtsp-desktop-1325x758');
  });

  test('editor at phone width (configured on desktop, then narrowed)', async ({ page }) => {
    const LIVE_HLS = await pickLive();
    test.skip(!LIVE_HLS, 'no live HLS test stream reachable from this runner');
    if (!LIVE_HLS) return;
    // The phone builder hides the canvas zone, so select + configure at
    // desktop width, then narrow to the phone viewport for the record.
    await openBuilder(page, { width: 1325, height: 758 });
    const field = page.getByLabel('Stream link');
    await field.waitFor({ state: 'visible', timeout: 60_000 });
    await field.fill(LIVE_HLS);
    await field.press('Enter');
    await page.locator('[data-stream-test-button]').click();
    await expect(page.getByTestId('stream-test-status')).toContainText(/Playing/, { timeout: 45_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1500);
    if (await field.isVisible().catch(() => false)) await field.scrollIntoViewIfNeeded();
    await shot(page, 'editor-phone-390x844');
  });
});
