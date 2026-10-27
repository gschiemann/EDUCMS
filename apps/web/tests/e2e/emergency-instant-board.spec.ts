import { test, expect, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { bootMockPlayer, ok, playerIds, playerManifest } from './helpers/mock-player';

/**
 * INSTANT EMERGENCY BOARDS (2026-10-26) — the live alerts at a launch site:
 * every screen showed the built-in typed surface ("MEDICAL") for ~8 s and only
 * then the location's board, because the board definition travelled only with
 * the committed manifest (the fan-out precedes the commit) while
 * `emergency-assets` had pre-delivered the FILES alone. The same alert also
 * carried TWO paint identities (the push says `medical`, the manifest
 * `MEDICAL`), so the APK restarted its paint ladder for a "new" alert.
 *
 * Under test, against the mocked APK / timeline of the drill spec:
 *   1. LIVE, board staged: the location's board (the `media` emergency root,
 *      not the typed `fallback`) is on the glass within 1 s of the signed
 *      push; the committed manifest 3.5 s later, with the same board, changes
 *      neither the identity nor the mounted element (no re-mount); one native
 *      episode throughout; the all-clear goes straight to content.
 *   2. No staged board for the type: the typed surface, exactly as before.
 *   3. DRILL, board staged: the drill board, drill-marked, never red.
 *   4. Raise-only: staged boards alone never put an alert on the glass.
 *
 * NEGATIVE CONTROL for (1): with the staged-board raise disabled the board is
 * not on the glass within 1 s (the typed surface is), so the first assertion
 * fails on the old code. Per CLAUDE.md the repo is PUBLIC: fake ids, fake
 * tokens, no customer names.
 */

const INDIGO = 'rgb(55, 48, 163)';
/** The real push shape: the dashboard's type, as the API signs it. */
const PUSH_TYPE = 'medical';
const BOARD_IMAGE = 'http://api.invalid/assets/board-slide.png';
const BOARD_ID = 'pl-board-medical';
const DRILL_BOARD_ID = 'pl-board-medical-drill';

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
function board(id: string, name: string) {
  return {
    id, name,
    items: [{ item_id: `${id}-item-1`, asset_id: `${id}-asset-1`, asset_hash: null, url: BOARD_IMAGE, duration_ms: 60_000, sequence: 0, mime_type: 'image/png', transition_type: null }],
  };
}
const BOARDS = { [BOARD_ID]: board(BOARD_ID, 'Medical board'), [DRILL_BOARD_ID]: board(DRILL_BOARD_ID, 'Medical drill board') };
const BOARD_FOR = { MEDICAL: { live: { playlistId: BOARD_ID, perScreen: false }, drill: { playlistId: DRILL_BOARD_ID, perScreen: false } } };

function emergencyManifest(base: ReturnType<typeof playerManifest>, drill: boolean) {
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
    playlists: [drill ? BOARDS[DRILL_BOARD_ID] : BOARDS[BOARD_ID]],
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
      const alert = roots[roots.length - 1];
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
      new MutationObserver(() => { if (scheduled) return; scheduled = true; requestAnimationFrame(record); })
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

async function bootUnderTest(page: Page, tag: string, manifestRef: { value: unknown }, staged: boolean) {
  const id = playerIds(tag);
  await installNativeMockAndTimeline(page);
  await bootMockPlayer(page, {
    tag,
    kind: 'images',
    identity: id,
    extraRoutes: async (p) => {
      await p.route(`**/api/v1/screens/${id.screenId}/manifest*`, (route) => ok(route, manifestRef.value));
      await p.route(`**/api/v1/screens/${id.screenId}/render-proof`, (route) => ok(route, { ok: true, emergencyPaintAccepted: true }));
      // The staged boards ride the same authenticated response as the files.
      await p.route(`**/api/v1/screens/${id.screenId}/emergency-assets`, (route) =>
        ok(route, staged ? { assets: [], setHash: 'boards-fake-hash', boards: BOARDS, boardFor: BOARD_FOR } : { assets: [], setHash: 'empty-fake-hash' }));
      await p.route(BOARD_IMAGE, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    },
  });
  return id;
}

const boardRoot = (page: Page) => page.locator('[data-edu-emergency-root="media"]');
const typedRoot = (page: Page) => page.locator('[data-edu-emergency-root="fallback"]');

test('LIVE with a staged board: the board is on the glass within 1 s of the push, the committed manifest re-mounts nothing, one identity, and the all-clear goes straight to content', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = 'instant-live';
  const id = playerIds(tag);
  const normal = playerManifest(id.screenId, 'images');
  const manifestRef: { value: unknown } = { value: normal };
  await bootUnderTest(page, tag, manifestRef, true);
  await expect.poll(async () => (await readTimeline(page)).at(-1)?.state, { timeout: 20_000 }).toBe('content');
  // The boards are staged (and persisted) before any alert — raise-only: no alert on the glass.
  await expect.poll(() => page.evaluate((k) => !!localStorage.getItem(k), `edu_emergency_boards_v1:${id.screenId}`), { timeout: 10_000 }).toBe(true);
  expect((await readTimeline(page)).some(e => e.state.startsWith('alert:') || e.state.startsWith('pending:'))).toBe(false);

  const pushedAt = Date.now();
  await push(page, {
    type: 'OVERRIDE', eventId: 'ovr-evt-instant-1', timestamp: Date.now(), signature: 'fake-local-test-signature',
    payload: { overrideId: 'ovr_instant_1', severity: 'CRITICAL', type: PUSH_TYPE, expiresAt: 0 },
  });
  // The commit race: the manifest keeps reading NORMAL for 3.5 s after the push.
  setTimeout(() => { manifestRef.value = emergencyManifest(normal, false); }, 3_500);

  // (1) THE BOARD, within 1 s — the location's content, not the typed surface.
  await expect(boardRoot(page)).toBeVisible({ timeout: 1_000 });
  const shownAt = Date.now();
  expect(shownAt - pushedAt).toBeLessThan(1_000 + 150);
  const img = boardRoot(page).locator('img').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await img.evaluate((el) => el.setAttribute('data-test-mounted-before-manifest', '1'));
  // The typed surface is not what the glass settles on.
  await expect(typedRoot(page)).toHaveCount(0);

  // (2) Paint proof for THIS board reached the APK before its 3 s native step.
  await expect.poll(async () => (await readMock(page)).episodes[0]?.paintedAt ?? null, { timeout: 10_000 }).not.toBeNull();
  expect((await readMock(page)).episodes).toHaveLength(1);

  // (3) The committed manifest lands with the same board: no identity change, no re-mount.
  await expect.poll(async () => (await readEmergencyCache(page))?.payload?.scope, { timeout: 15_000 }).toBe('screen');
  await page.waitForTimeout(800);
  await expect(page.locator('[data-edu-emergency-root="media"] img[data-test-mounted-before-manifest="1"]')).toBeVisible();
  const confirmed = await readMock(page);
  expect(confirmed.episodes).toHaveLength(1);
  expect(new Set(confirmed.receipts.map(r => r.identity)).size).toBe(1);
  // The push said `medical`, the manifest `MEDICAL`: ONE identity on the root throughout.
  expect(await boardRoot(page).getAttribute('data-edu-emergency-identity')).toBe(confirmed.receipts[0].identity);
  const sincePush = (await readTimeline(page)).filter(e => e.at >= pushedAt).map(e => e.state);
  expect(sincePush).not.toContain('content');
  expect(sincePush.filter(s => s.startsWith('pending:'))).toEqual([]);
  expect(sincePush).toContain('alert:media:live');

  // (4) ALL-CLEAR: straight to content — no typed surface, no pending, no second episode.
  const clearedAt = Date.now();
  manifestRef.value = normal;
  await push(page, {
    type: 'ALL_CLEAR', eventId: 'clear-evt-instant-1', timestamp: Date.now(), signature: 'fake-local-test-signature',
    payload: { overrideId: 'ovr_instant_1', clearedBy: 'test' },
  });
  await expect.poll(async () => (await readMock(page)).held, { timeout: 30_000 }).toBe(false);
  await expect.poll(async () => (await readTimeline(page)).at(-1)?.state, { timeout: 20_000 }).toBe('content');
  const sinceClear = (await readTimeline(page)).filter(e => e.at >= clearedAt).map(e => e.state);
  expect(sinceClear.filter(s => !['alert:media:live', 'content'].includes(s))).toEqual([]);
  expect((await readMock(page)).episodes).toHaveLength(1);
});

test('no staged board for the type: the typed surface, unchanged', async ({ page }) => {
  test.setTimeout(60_000);
  const tag = 'instant-none';
  const id = playerIds(tag);
  const normal = playerManifest(id.screenId, 'images');
  const manifestRef: { value: unknown } = { value: normal };
  await bootUnderTest(page, tag, manifestRef, true);
  await expect.poll(async () => (await readTimeline(page)).at(-1)?.state, { timeout: 20_000 }).toBe('content');
  await push(page, {
    type: 'OVERRIDE', eventId: 'ovr-evt-none-1', timestamp: Date.now(), signature: 'fake-local-test-signature',
    payload: { overrideId: 'ovr_none_1', severity: 'CRITICAL', type: 'secure', expiresAt: 0 },
  });
  await expect(typedRoot(page)).toBeVisible({ timeout: 3_000 });
  await expect(typedRoot(page)).toContainText('SECURE');
  await expect(boardRoot(page)).toHaveCount(0);
  await expect.poll(async () => (await readMock(page)).episodes[0]?.paintedAt ?? null, { timeout: 10_000 }).not.toBeNull();
});

test('DRILL with a staged drill board: the drill board, drill-marked, never red', async ({ page }) => {
  test.setTimeout(60_000);
  const tag = 'instant-drill';
  const id = playerIds(tag);
  const normal = playerManifest(id.screenId, 'images');
  const manifestRef: { value: unknown } = { value: normal };
  await bootUnderTest(page, tag, manifestRef, true);
  await expect.poll(async () => (await readTimeline(page)).at(-1)?.state, { timeout: 20_000 }).toBe('content');
  const pushedAt = Date.now();
  await push(page, {
    type: 'OVERRIDE', eventId: 'ovr-evt-drill-1', timestamp: Date.now(), signature: 'fake-local-test-signature',
    payload: { overrideId: 'ovr_drill_1', severity: 'CRITICAL', type: PUSH_TYPE, expiresAt: 0, isDrill: true },
  });
  setTimeout(() => { manifestRef.value = emergencyManifest(normal, true); }, 3_500);
  await expect(boardRoot(page)).toBeVisible({ timeout: 1_000 });
  await expect(boardRoot(page)).toHaveAttribute('data-edu-emergency-drill', 'true');
  // A drill BOARD is the operator's own drill content: nothing is painted over
  // it (owner, 2026-10-12) — exactly as the manifest-delivered drill board.
  await expect(typedRoot(page)).toHaveCount(0);
  await expect.poll(async () => (await readEmergencyCache(page))?.payload?.scope, { timeout: 15_000 }).toBe('screen');
  const since = (await readTimeline(page)).filter(e => e.at >= pushedAt).map(e => e.state);
  expect(since.filter(s => /:live$/.test(s))).toEqual([]);
  expect(since).not.toContain('content');
  // Whatever protective surface is up is indigo, never red.
  for (const sel of ['[data-edu-emergency-root="fallback"]', '[data-edu-emergency-transition="true"]']) {
    const el = page.locator(sel);
    if (await el.count()) await expect(el.first()).toHaveCSS('background-color', INDIGO);
  }
  expect((await readMock(page)).episodes).toHaveLength(1);
});
