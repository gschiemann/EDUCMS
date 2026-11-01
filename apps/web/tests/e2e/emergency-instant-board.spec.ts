import { test, expect, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { bootMockPlayer, ok, playerIds, playerManifest } from './helpers/mock-player';

/**
 * INSTANT EMERGENCY BOARDS — "the first frame is the final board" (2026-10-26,
 * strengthened 2026-10-31 after three field rounds still showed "a short
 * built-in alert screen first, then the real board").
 *
 * What the field saw, and what each case here pins:
 *   • a board's picture is DECODED at staging, so the board raised from the
 *     signed push paints on its first frame — the image is served slowly here
 *     (a stand-in for a 4K PNG decoding on a slow panel) and cached, so a page
 *     that did not pre-decode shows its protective surface first;
 *   • a LANDSCAPE screen whose own live playlist is EMPTY (the launch site's
 *     live landscape playlists have no items) opens on the staged SYSTEM board
 *     — the manifest's own text template, same signature — not on a typed
 *     surface that the manifest then replaces;
 *   • a DRILL opens on the DRILL board, indigo, never the live board;
 *   • the BACK FACE of a double-sided unit (`?face=1`, a landscape panel mode,
 *     a PORTRAIT screen) opens on the portrait board;
 *   • a screen with only a single FILE for the type opens on that file;
 *   • with nothing staged at all, the typed surface is the system board's own
 *     words on the system board's own colour.
 * In every case: nothing paints between the push and the board (no pending
 * surface, no normal content, no other board), the committed manifest 3.5 s
 * later re-mounts nothing, one native episode, one identity.
 *
 * NEGATIVE CONTROL (run by hand against the previous page, 2026-10-31): the
 * first-frame assertions of the live, drill, back-face and single-file cases
 * fail there (the protective surface is the first frame while the picture
 * loads), and the empty-landscape case fails on "no board staged". Per
 * CLAUDE.md the repo is PUBLIC: fake ids, fake tokens, no customer names.
 */

const INDIGO = 'rgb(55, 48, 163)';
/** The system board's live colour (`systemEmergencyBoardColor('CRITICAL', false)`). */
const SYSTEM_RED = 'rgb(220, 38, 38)';
/** The real push shape: the dashboard's type, as the API signs it. */
const PUSH_TYPE = 'medical';
const BOARD_ID = 'pl-board-medical-port';
const DRILL_BOARD_ID = 'pl-board-medical-drill';
/** How slowly the board's picture arrives from "storage" — a decode-sized gap. */
const IMAGE_DELAY_MS = 400;

type Episode = { challenge: string; identity: string | null; paintedAt: number | null; status: 'pending' | 'painted' };
type MockState = { held: boolean; episodes: Episode[]; receipts: Array<{ at: number; painted: boolean; identity: string }> };
type TimelineEntry = { at: number; state: string };

/** A real, decodable PNG (solid colour) so the board's image proves its paint. */
function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + width * 3); for (let x = 0; x < width; x += 1) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = solidPng(640, 360, [20, 90, 200]);

/** The API's `emergencyBoardPayload` shape — what the manifest's emergency branch emits. */
function board(id: string, name: string, image: string) {
  return {
    id, name,
    items: [{ item_id: `${id}-item-1`, asset_id: `${id}-asset-1`, asset_hash: null, url: image, duration_ms: 60_000, sequence: 0, mime_type: 'image/png', transition_type: null }],
  };
}
/** The API's `screenAssetBoard` shape — a screen's single file for the type. */
function assetBoard(screenId: string, image: string) {
  return {
    id: 'screen-asset-medical', name: 'MEDICAL (custom asset)',
    items: [{ item_id: `screen-asset-${screenId}-medical`, asset_id: null, asset_hash: null, url: image, duration_ms: 60_000, sequence: 0, mime_type: 'image/png', transition_type: null }],
  };
}
/** The API's `systemEmergencyBoard` shape — the manifest's own DEFAULT_EMERGENCY text template. */
const SYSTEM_LIVE_TEXT = 'MEDICAL EMERGENCY\n\nKeep this area clear.\nFollow staff directions.';
function systemBoard() {
  return {
    id: 'DEFAULT_EMERGENCY', name: 'SYSTEM DEFAULT - MEDICAL', contentRev: 'rev-fake-medical-live', items: [],
    template: {
      name: 'EMERGENCY OVERRIDE', bgColor: '#dc2626', screenWidth: 1920, screenHeight: 1080,
      zones: [{ id: 'emergency-zone', x: 0, y: 0, width: 100, height: 100, zIndex: 1, widgetType: 'TEXT',
        defaultConfig: { sizeMode: 'absolute', content: SYSTEM_LIVE_TEXT, fontSize: 100, fontWeight: 800, color: 'white', alignment: 'center', lineHeight: 1.15 } }],
    },
  };
}

type Staging = { boards: Record<string, unknown>; boardFor: Record<string, unknown>; manifestBoard: unknown; drillManifestBoard?: unknown };

/** A portrait (or back-face) screen: its own live and drill boards have content. */
function stagingWithBoards(image: string): Staging {
  const live = board(BOARD_ID, 'Medical board (portrait)', image);
  const drill = board(DRILL_BOARD_ID, 'Medical drill board (portrait)', image);
  return {
    boards: { [BOARD_ID]: live, [DRILL_BOARD_ID]: drill },
    boardFor: { MEDICAL: { live: { playlistId: BOARD_ID, perScreen: false, boardKey: BOARD_ID }, drill: { playlistId: DRILL_BOARD_ID, perScreen: false, boardKey: DRILL_BOARD_ID } } },
    manifestBoard: live, drillManifestBoard: drill,
  };
}
/** A landscape screen at the launch site: the live landscape playlist resolved but is EMPTY → the system board. */
function stagingEmptyLandscape(): Staging {
  const sys = systemBoard();
  return {
    boards: { 'system:MEDICAL:live': sys },
    boardFor: { MEDICAL: { live: { playlistId: 'pl-landscape-empty', perScreen: false, boardKey: 'system:MEDICAL:live' }, drill: { playlistId: 'pl-landscape-empty', perScreen: false, boardKey: 'system:MEDICAL:drill' } } },
    manifestBoard: sys,
  };
}
/** A screen with only a single file for the type (location mode). */
function stagingSingleFile(screenId: string, image: string): Staging {
  const asset = assetBoard(screenId, image);
  return {
    boards: { 'asset:MEDICAL:live': asset },
    boardFor: { MEDICAL: { live: { playlistId: null, perScreen: false, boardKey: 'asset:MEDICAL:live' }, drill: { playlistId: null, perScreen: false, boardKey: 'asset:MEDICAL:live' } } },
    manifestBoard: asset,
  };
}

function emergencyManifest(base: ReturnType<typeof playerManifest>, drill: boolean, playlist: unknown) {
  return {
    ...base,
    isEmergency: true,
    emergencyType: 'MEDICAL',
    emergencySeverity: 'CRITICAL',
    emergencyScopeNote: null,
    emergencyScope: 'screen',
    emergencyExpiresAt: Math.floor(Date.now() / 1000) + 3_600,
    isDrill: drill,
    // The committed manifest carries the SAME board the player staged.
    playlists: [playlist],
  };
}

async function installNativeMockAndTimeline(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const load = (): MockState | null => { try { return JSON.parse(sessionStorage.getItem('__eduNativeMock') || 'null'); } catch { return null; } };
    const state: MockState = load() || { held: false, episodes: [], receipts: [] };
    const save = () => { try { sessionStorage.setItem('__eduNativeMock', JSON.stringify(state)); } catch { /* ignore */ } };
    const uuid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const current = () => state.episodes[state.episodes.length - 1] || null;
    w.__eduNativeMock = state;
    w.EduCmsNative = {
      heartbeat() { /* liveness only */ },
      displayEmergencyHold(active: boolean) {
        if (active) {
          if (!state.held) { state.held = true; state.episodes.push({ challenge: uuid(), identity: null, paintedAt: null, status: 'pending' }); }
        } else state.held = false;
        save();
        return JSON.stringify({ ok: true });
      },
      sharedVideoState() {
        const ep = current();
        const proof = state.held && ep
          ? (ep.status === 'painted' ? { challenge: ep.challenge, status: 'painted', identity: ep.identity } : { challenge: ep.challenge, status: 'pending' })
          : undefined;
        return JSON.stringify({ version: 1, state: 'idle', ...(proof ? { emergencyProof: proof } : {}) });
      },
      heartbeatV2(json: string) {
        let p: { painted?: boolean; identity?: string; challenge?: string; frames?: number } | undefined;
        try { p = JSON.parse(json).emergencyPaint; } catch { return; }
        if (!p || !state.held) return;
        const ep = current();
        if (!ep || typeof p.identity !== 'string') return;
        state.receipts.push({ at: Date.now(), painted: p.painted === true, identity: p.identity });
        if (p.painted === false) {
          if (ep.identity === p.identity) { save(); return; }
          if (ep.identity === null) ep.identity = p.identity;
          else state.episodes.push({ challenge: uuid(), identity: p.identity, paintedAt: null, status: 'pending' }); // a DIFFERENT identity = a NEW alert
          save();
          return;
        }
        if (p.challenge === ep.challenge && (ep.identity === null || ep.identity === p.identity) && (p.frames ?? 0) >= 2 && ep.status !== 'painted') {
          ep.status = 'painted'; ep.identity = p.identity; ep.paintedAt = Date.now();
        }
        save();
      },
    };
    const loadTimeline = (): TimelineEntry[] => { try { return JSON.parse(sessionStorage.getItem('__eduGlassTimeline') || '[]'); } catch { return []; } };
    const timeline: TimelineEntry[] = loadTimeline();
    w.__eduGlassTimeline = timeline;
    const classify = (): string => {
      const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-edu-emergency-root]')).filter(r => {
        const cs = getComputedStyle(r);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.getBoundingClientRect().width > 0;
      });
      // The protective surface overlays the board (zIndex 9998): when it is up, IT is what the glass shows.
      const alert = roots.find(r => r.getAttribute('data-edu-emergency-root') === 'fallback') ?? roots[roots.length - 1];
      if (alert) return `alert:${alert.getAttribute('data-edu-emergency-root')}:${alert.getAttribute('data-edu-emergency-drill') === 'true' ? 'drill' : 'live'}`;
      if (document.querySelector('[data-edu-emergency-hold="true"]')) return 'hold';
      const transition = document.querySelector('[data-edu-emergency-transition="true"]');
      if (transition) return `pending:${transition.getAttribute('data-edu-emergency-drill') === 'true' ? 'drill' : 'live'}`;
      const content = Array.from(document.querySelectorAll<HTMLElement>('[data-edu-player-root]')).some(el => el.getBoundingClientRect().width > 0);
      return content ? 'content' : 'none';
    };
    let scheduled = false;
    const record = () => {
      scheduled = false;
      const s = classify();
      if (timeline.length && timeline[timeline.length - 1].state === s) return;
      timeline.push({ at: Date.now(), state: s });
      try { sessionStorage.setItem('__eduGlassTimeline', JSON.stringify(timeline)); } catch { /* ignore */ }
    };
    const observe = () => {
      // Every DOM mutation is classified in the SAME task (a microtask), before
      // the browser can paint it — so a surface that was up for one frame is
      // in the timeline even if React removed it a frame later.
      new MutationObserver(() => { if (scheduled) return; scheduled = true; queueMicrotask(record); })
        .observe(document.documentElement, { subtree: true, childList: true, attributes: true });
      record();
    };
    if (document.documentElement) observe(); else document.addEventListener('DOMContentLoaded', observe);
  });
}

async function readMock(page: Page): Promise<MockState> {
  return page.evaluate(() => (window as unknown as { __eduNativeMock: MockState }).__eduNativeMock);
}
async function readTimeline(page: Page): Promise<TimelineEntry[]> {
  return page.evaluate(() => (window as unknown as { __eduGlassTimeline: TimelineEntry[] }).__eduGlassTimeline);
}
async function readEmergencyCache(page: Page): Promise<{ payload?: Record<string, unknown> } | null> {
  return page.evaluate(() => { try { return JSON.parse(localStorage.getItem('edu_emergency_cache_v1') || 'null'); } catch { return null; } });
}
async function push(page: Page, message: Record<string, unknown>) {
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __eduTestRealtime?: unknown }).__eduTestRealtime)).toBe(true);
  await page.waitForTimeout(100);
  await page.evaluate((m) => (window as unknown as { __eduTestRealtime: { deliver: (x: unknown) => void } }).__eduTestRealtime.deliver(m), message);
}

type Booted = { id: ReturnType<typeof playerIds>; image: string; imageRequests: { count: number; done: number } };

async function bootUnderTest(page: Page, tag: string, manifestRef: { value: unknown }, staging: Staging | null, opts: { query?: string; orientation?: 'LANDSCAPE' | 'PORTRAIT' } = {}): Promise<Booted> {
  const id = playerIds(tag);
  const image = `http://api.invalid/assets/board-${tag}.png`;
  const imageRequests = { count: 0, done: 0 };
  await installNativeMockAndTimeline(page);
  const normal = { ...playerManifest(id.screenId, 'images'), orientation: opts.orientation ?? 'LANDSCAPE' };
  manifestRef.value = normal;
  await bootMockPlayer(page, {
    tag,
    kind: 'images',
    identity: id,
    manifest: normal,
    query: opts.query,
    extraRoutes: async (p) => {
      await p.route(`**/api/v1/screens/${id.screenId}/manifest*`, (route) => ok(route, manifestRef.value));
      await p.route(`**/api/v1/screens/${id.screenId}/render-proof`, (route) => ok(route, { ok: true, emergencyPaintAccepted: true }));
      // The staged boards ride the same authenticated response as the files.
      await p.route(`**/api/v1/screens/${id.screenId}/emergency-assets`, (route) =>
        ok(route, staging ? { assets: [], setHash: `boards-fake-${tag}`, boards: staging.boards, boardFor: staging.boardFor } : { assets: [], setHash: 'empty-fake-hash' }));
      // The board's picture: SLOW (a decode-sized gap) and cacheable, like storage.
      await p.route(image, async (route) => {
        imageRequests.count += 1;
        await new Promise((r) => setTimeout(r, IMAGE_DELAY_MS));
        await route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Cache-Control': 'public, max-age=600', 'Access-Control-Allow-Origin': '*' }, body: PNG });
        imageRequests.done += 1;
      });
    },
  });
  return { id, image, imageRequests };
}

const boardRoot = (page: Page) => page.locator('[data-edu-emergency-root="media"]');
const templateRoot = (page: Page) => page.locator('[data-edu-emergency-root="template"]');
const typedRoot = (page: Page) => page.locator('[data-edu-emergency-root="fallback"]');

/** Everything the glass showed since `sinceAt`, oldest first. */
async function statesSince(page: Page, sinceAt: number): Promise<string[]> {
  return (await readTimeline(page)).filter(e => e.at >= sinceAt).map(e => e.state);
}

/** THE assertion: from the push on, the glass showed the board and nothing else. */
async function expectOnlyTheBoard(page: Page, pushedAt: number, expected: string) {
  const since = await statesSince(page, pushedAt);
  expect(since.length).toBeGreaterThan(0);
  expect(since[0]).toBe(expected);
  expect(since.filter(s => s !== expected)).toEqual([]);
}

async function waitForContentAndStaging(page: Page, booted: Booted, hasPicture = true) {
  await expect.poll(async () => (await readTimeline(page)).at(-1)?.state, { timeout: 20_000 }).toBe('content');
  // The boards are staged (and persisted) before any alert — raise-only: no alert on the glass.
  await expect.poll(() => page.evaluate((k) => !!localStorage.getItem(k), `edu_emergency_boards_v1:${booted.id.screenId}`), { timeout: 10_000 }).toBe(true);
  // The board's picture was fetched ONCE, at staging, and has ARRIVED (pre-decoded);
  // a trigger comes minutes after staging on a real screen, never mid-download.
  if (hasPicture) await expect.poll(() => booted.imageRequests.done, { timeout: 10_000 }).toBe(1);
  await page.waitForTimeout(250);
  expect((await readTimeline(page)).some(e => e.state.startsWith('alert:') || e.state.startsWith('pending:'))).toBe(false);
}

function pushOverride(page: Page, tag: string, drill = false) {
  return push(page, {
    type: 'OVERRIDE', eventId: `ovr-evt-${tag}`, timestamp: Date.now(), signature: 'fake-local-test-signature',
    payload: { overrideId: `ovr_${tag}`, severity: 'CRITICAL', type: PUSH_TYPE, expiresAt: 0, ...(drill ? { isDrill: true } : {}) },
  });
}

async function expectManifestChangedNothing(page: Page, manifestRef: { value: unknown }, committed: unknown, rootSel: string, pushedAt: number, expected: string) {
  // The commit race: the manifest keeps reading NORMAL for 3.5 s after the push.
  setTimeout(() => { manifestRef.value = committed; }, 3_500);
  const root = page.locator(rootSel).first();
  await expect(root).toBeVisible({ timeout: 1_500 });
  await root.evaluate((el) => el.setAttribute('data-test-mounted-before-manifest', '1'));
  // The committed manifest lands with the same board: no identity change, no re-mount.
  await expect.poll(async () => (await readEmergencyCache(page))?.payload?.scope, { timeout: 15_000 }).toBe('screen');
  await page.waitForTimeout(800);
  await expect(page.locator(`${rootSel}[data-test-mounted-before-manifest="1"]`)).toBeVisible();
  const confirmed = await readMock(page);
  expect(confirmed.episodes).toHaveLength(1);
  expect(new Set(confirmed.receipts.map(r => r.identity)).size).toBe(1);
  expect(await root.getAttribute('data-edu-emergency-identity')).toBe(confirmed.receipts[0].identity);
  await expectOnlyTheBoard(page, pushedAt, expected);
}

test('PORTRAIT LIVE with a staged board: the FIRST frame after the push is the board, nothing else ever paints, the manifest re-mounts nothing, the all-clear goes straight to content', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = 'instant-live';
  const manifestRef: { value: unknown } = { value: null };
  const id = playerIds(tag);
  const staging = stagingWithBoards(`http://api.invalid/assets/board-${tag}.png`);
  const booted = await bootUnderTest(page, tag, manifestRef, staging, { orientation: 'PORTRAIT' });
  await waitForContentAndStaging(page, booted);

  const pushedAt = Date.now();
  await pushOverride(page, tag);
  await expect(boardRoot(page)).toBeVisible({ timeout: 1_000 });
  expect(Date.now() - pushedAt).toBeLessThan(1_000 + 150);
  const img = boardRoot(page).locator('img').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(typedRoot(page)).toHaveCount(0);
  await expect.poll(async () => (await readMock(page)).episodes[0]?.paintedAt ?? null, { timeout: 10_000 }).not.toBeNull();
  await expectManifestChangedNothing(page, manifestRef, emergencyManifest(manifestRef.value as ReturnType<typeof playerManifest>, false, staging.manifestBoard), '[data-edu-emergency-root="media"]', pushedAt, 'alert:media:live');

  // ALL-CLEAR: straight to content — no typed surface, no pending, no second episode.
  const clearedAt = Date.now();
  manifestRef.value = { ...playerManifest(id.screenId, 'images'), orientation: 'PORTRAIT' };
  await push(page, {
    type: 'ALL_CLEAR', eventId: 'clear-evt-instant-1', timestamp: Date.now(), signature: 'fake-local-test-signature',
    payload: { overrideId: `ovr_${tag}`, clearedBy: 'test' },
  });
  await expect.poll(async () => (await readMock(page)).held, { timeout: 30_000 }).toBe(false);
  await expect.poll(async () => (await readTimeline(page)).at(-1)?.state, { timeout: 20_000 }).toBe('content');
  const sinceClear = await statesSince(page, clearedAt);
  expect(sinceClear.filter(s => !['alert:media:live', 'content'].includes(s))).toEqual([]);
  expect((await readMock(page)).episodes).toHaveLength(1);
});

test('LANDSCAPE LIVE whose own live playlist is EMPTY: opens on the staged SYSTEM board — the manifest\'s own text template — and the manifest changes nothing', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = 'instant-landscape-empty';
  const manifestRef: { value: unknown } = { value: null };
  const staging = stagingEmptyLandscape();
  const booted = await bootUnderTest(page, tag, manifestRef, staging, { orientation: 'LANDSCAPE' });
  await waitForContentAndStaging(page, booted, false);

  const pushedAt = Date.now();
  await pushOverride(page, tag);
  setTimeout(() => { manifestRef.value = emergencyManifest(manifestRef.value as ReturnType<typeof playerManifest>, false, staging.manifestBoard); }, 3_500);
  // The system board is a TEXT template; it is "the board" once its text is on
  // the glass. Until then the typed surface shows — the SAME words on the SAME
  // colour (one rule, @cms/api-types), so nothing visibly changes.
  await expect(templateRoot(page)).toBeVisible({ timeout: 2_500 });
  const template = templateRoot(page).first();
  await expect(template).toContainText('Keep this area clear.');
  await template.evaluate((el) => el.setAttribute('data-test-mounted-before-manifest', '1'));
  const since = await statesSince(page, pushedAt);
  expect(since[0] === 'alert:fallback:live' || since[0] === 'alert:template:live').toBe(true);
  expect(since.filter(s => !['alert:fallback:live', 'alert:template:live'].includes(s))).toEqual([]);
  // The bridge, if it was up, was the system board's colour and words.
  const typedSeen = since.includes('alert:fallback:live');
  if (typedSeen) {
    const typed = typedRoot(page);
    if (await typed.count()) {
      await expect(typed.first()).toHaveCSS('background-color', SYSTEM_RED);
      await expect(typed.first()).toContainText('MEDICAL EMERGENCY');
    }
  }
  await expect.poll(async () => (await readMock(page)).episodes[0]?.paintedAt ?? null, { timeout: 10_000 }).not.toBeNull();
  // The committed manifest lands with the same template (same contentRev): no re-mount, no new state.
  await expect.poll(async () => (await readEmergencyCache(page))?.payload?.scope, { timeout: 15_000 }).toBe('screen');
  await page.waitForTimeout(800);
  await expect(page.locator('[data-edu-emergency-root="template"][data-test-mounted-before-manifest="1"]')).toBeVisible();
  expect((await statesSince(page, pushedAt)).at(-1)).toBe('alert:template:live');
  expect((await statesSince(page, pushedAt)).filter(s => !['alert:fallback:live', 'alert:template:live'].includes(s))).toEqual([]);
  const confirmed = await readMock(page);
  expect(confirmed.episodes).toHaveLength(1);
  expect(new Set(confirmed.receipts.map(r => r.identity)).size).toBe(1);
  await expect(typedRoot(page)).toHaveCount(0);
});

test('DRILL with a staged drill board: the first frame is the DRILL board, drill-marked, indigo, never the live board', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = 'instant-drill';
  const manifestRef: { value: unknown } = { value: null };
  const staging = stagingWithBoards(`http://api.invalid/assets/board-${tag}.png`);
  const booted = await bootUnderTest(page, tag, manifestRef, staging, { orientation: 'PORTRAIT' });
  await waitForContentAndStaging(page, booted);
  const pushedAt = Date.now();
  await pushOverride(page, tag, true);
  await expect(boardRoot(page)).toBeVisible({ timeout: 1_000 });
  await expect(boardRoot(page)).toHaveAttribute('data-edu-emergency-drill', 'true');
  // The drill board, not the live one: its item id names the drill playlist.
  await expect(boardRoot(page).locator(`img[data-slide-id^="${DRILL_BOARD_ID}:"]`)).toHaveCount(1);
  await expect(typedRoot(page)).toHaveCount(0);
  await expectManifestChangedNothing(page, manifestRef, emergencyManifest(manifestRef.value as ReturnType<typeof playerManifest>, true, staging.drillManifestBoard), '[data-edu-emergency-root="media"]', pushedAt, 'alert:media:drill');
  for (const sel of ['[data-edu-emergency-root="fallback"]', '[data-edu-emergency-transition="true"]']) {
    const el = page.locator(sel);
    if (await el.count()) await expect(el.first()).toHaveCSS('background-color', INDIGO);
  }
});

test('BACK FACE of a double-sided unit (?face=1, landscape panel mode, PORTRAIT screen): the first frame is its portrait board', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 960, height: 540 });
  const tag = 'instant-back-face';
  const manifestRef: { value: unknown } = { value: null };
  const staging = stagingWithBoards(`http://api.invalid/assets/board-${tag}.png`);
  const booted = await bootUnderTest(page, tag, manifestRef, staging, { orientation: 'PORTRAIT', query: '&face=1' });
  await waitForContentAndStaging(page, booted);
  const pushedAt = Date.now();
  await pushOverride(page, tag);
  await expect(boardRoot(page)).toBeVisible({ timeout: 1_000 });
  await expect(boardRoot(page).locator(`img[data-slide-id^="${BOARD_ID}:"]`)).toHaveCount(1);
  await expect(typedRoot(page)).toHaveCount(0);
  await expectManifestChangedNothing(page, manifestRef, emergencyManifest(manifestRef.value as ReturnType<typeof playerManifest>, false, staging.manifestBoard), '[data-edu-emergency-root="media"]', pushedAt, 'alert:media:live');
});

test('a screen with only a single FILE for the type: the first frame is that file, as the manifest will play it', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = 'instant-single-file';
  const manifestRef: { value: unknown } = { value: null };
  const id = playerIds(tag);
  const staging = stagingSingleFile(id.screenId, `http://api.invalid/assets/board-${tag}.png`);
  const booted = await bootUnderTest(page, tag, manifestRef, staging, { orientation: 'LANDSCAPE' });
  await waitForContentAndStaging(page, booted);
  const pushedAt = Date.now();
  await pushOverride(page, tag);
  await expect(boardRoot(page)).toBeVisible({ timeout: 1_000 });
  await expect(boardRoot(page).locator('img[data-slide-id^="screen-asset-medical:"]')).toHaveCount(1);
  await expectManifestChangedNothing(page, manifestRef, emergencyManifest(manifestRef.value as ReturnType<typeof playerManifest>, false, staging.manifestBoard), '[data-edu-emergency-root="media"]', pushedAt, 'alert:media:live');
});

test('nothing staged for the type: the typed surface is the system board\'s words on the system board\'s colour (what the manifest brings next looks the same)', async ({ page }) => {
  test.setTimeout(60_000);
  const tag = 'instant-none';
  const manifestRef: { value: unknown } = { value: null };
  await bootUnderTest(page, tag, manifestRef, null, { orientation: 'LANDSCAPE' });
  await expect.poll(async () => (await readTimeline(page)).at(-1)?.state, { timeout: 20_000 }).toBe('content');
  const pushedAt = Date.now();
  await push(page, {
    type: 'OVERRIDE', eventId: 'ovr-evt-none-1', timestamp: Date.now(), signature: 'fake-local-test-signature',
    payload: { overrideId: 'ovr_none_1', severity: 'CRITICAL', type: 'secure', expiresAt: 0 },
  });
  await expect(typedRoot(page)).toBeVisible({ timeout: 3_000 });
  await expect(typedRoot(page)).toContainText('SECURE');
  await expect(typedRoot(page)).toContainText('Get inside. Lock outside doors.');
  await expect(typedRoot(page)).toHaveCSS('background-color', SYSTEM_RED);
  await expect(boardRoot(page)).toHaveCount(0);
  // Never a pending surface and never normal content between the push and the typed surface.
  const since = await statesSince(page, pushedAt);
  expect(since[0]).toBe('alert:fallback:live');
  expect(since.filter(s => s !== 'alert:fallback:live')).toEqual([]);
  await expect.poll(async () => (await readMock(page)).episodes[0]?.paintedAt ?? null, { timeout: 10_000 }).not.toBeNull();
});
