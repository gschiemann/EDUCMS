/**
 * Unified player telemetry endpoint (2026-09-02, efficiency program P0-1).
 *
 * What these tests pin, in priority order:
 *
 *   1. AUTH. A caller that cannot prove it is this screen gets 401 — the
 *      same posture /cache-status and /render-proof have, and for the same
 *      reason: a spoofable telemetry channel can mask a real outage for any
 *      screen in the fleet.
 *   2. THE HOT-CACHE RULE. Every key this handler writes on the routine
 *      path must be in `SCREEN_TELEMETRY_ONLY_FIELDS`, so `shouldBumpManifestRev`
 *      answers FALSE and the per-screen manifest cache survives. Off that
 *      list, the fleet's own telemetry re-creates the 25 GB/mo Supabase
 *      egress the cache exists to kill.
 *      The ONE deliberate exception is the durable-REFRESH ack, which
 *      clears `pendingRefreshAt` — that IS manifest content and MUST bust,
 *      exactly as /render-proof does today.
 *   3. COLUMN PARITY. The columns the three retired endpoints wrote are all
 *      still written, with the same debounce semantics.
 *   4. NEVER SYNTHESIZE A PAINT. Omitting `render` must leave
 *      `lastRenderedAt` untouched — a wedged compositor has to go STALE.
 */

import {
  TelemetryController,
  resetTelemetryStateForTests,
  sanitizeVideoReport,
  sanitizeLoopBoundary,
  carriedLoopBlock,
  TELEMETRY_COLUMNS,
  TELEMETRY_MIN_ACCEPT_INTERVAL_MS,
  REFRESH_ACK_MIN_ACCEPT_INTERVAL_MS,
} from './telemetry.controller';
import { TELEMETRY_MAX_BODY_BYTES } from './telemetry.schema';
import { SCREEN_ONLINE_GRACE_MS } from './online-grace';
import { TELEMETRY_INTERVAL_MS } from './telemetry.types';
import {
  SCREEN_TELEMETRY_ONLY_FIELDS,
  shouldBumpManifestRev,
  resetManifestCacheForTests,
} from '../screens/manifest-hot-cache';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

// The device-auth gate is exercised by its own suite (device-auth.spec.ts);
// here we only need to steer its verdict.
jest.mock('../screens/device-auth', () => ({
  verifyDeviceForScreen: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const deviceAuth = require('../screens/device-auth') as {
  verifyDeviceForScreen: jest.Mock;
};

const NOW = 1_700_000_000_000;

/**
 * A FRESH screen id per test. The write debounces this handler reuses
 * (`shouldSkipLastPingWrite`, `shouldSkipCacheReportWrite`,
 * `shouldSkipRenderProofWrite`) live in module-level maps keyed by screen
 * id, and `resetManifestCacheForTests` deliberately does not clear them —
 * they belong to the manifest hot cache, not to us. With fake timers
 * pinning every test to the same instant, a shared id would let one test's
 * debounce silently suppress the next test's write. A unique id per test is
 * the isolation, and it costs nothing.
 */
let SCREEN_ID = 'screen-0';
let screenSeq = 0;

function makeReq(over: Record<string, string> = {}): any {
  return { headers: { authorization: 'Bearer fake', ...over } };
}

describe('POST /screens/:id/telemetry', () => {
  let controller: TelemetryController;
  let prisma: any;
  const redis: any = { sismember: jest.fn(async () => false) };

  const baseRow = (over: Record<string, unknown> = {}) => ({
    id: SCREEN_ID,
    tenantId: 'tenant-xyz',
    name: 'Lobby',
    playerVersion: '1.1.16',
    playerVersionCode: 11160,
    managerVersion: null,
    forceApkUpdatePendingAt: null,
    pendingRefreshAt: null,
    lastOtaState: null,
    lastOtaProgress: null,
    lastOtaMessage: null,
    lastOtaAt: null,
    displayCapabilitiesAt: new Date(NOW - 60_000),
    ...over,
  });

  /** The `data` object of the single screen.update this handler performs. */
  const writtenData = (): Record<string, unknown> | null => {
    const call = prisma.client.screen.update.mock.calls[0];
    return call ? call[0].data : null;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    SCREEN_ID = `screen-${++screenSeq}`;
    resetManifestCacheForTests();
    resetTelemetryStateForTests();
    deviceAuth.verifyDeviceForScreen.mockResolvedValue({
      ok: true,
      sub: SCREEN_ID,
      screen: { id: SCREEN_ID, tenantId: 'tenant-xyz' },
      tenantId: 'tenant-xyz',
      token: 'fake',
    });
    prisma = {
      client: {
        screen: {
          findUnique: jest.fn(async () => baseRow()),
          update: jest.fn(async () => ({ id: SCREEN_ID })),
        },
        screenEvent: { create: jest.fn(async () => ({ id: 'ev-1' })) },
      },
    };
    controller = new TelemetryController(prisma, redis);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── 1. AUTH ───────────────────────────────────────────────────────────
  it('401s when the caller cannot prove it is this screen', async () => {
    deviceAuth.verifyDeviceForScreen.mockResolvedValue({ ok: false, reason: 'no_auth' });
    await expect(controller.report(SCREEN_ID, makeReq(), {})).rejects.toMatchObject({
      status: 401,
    });
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('404s on an unknown screen', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(null);
    await expect(controller.report(SCREEN_ID, makeReq(), {})).rejects.toMatchObject({
      status: 404,
    });
  });

  // ── 2. THE HOT-CACHE RULE ─────────────────────────────────────────────
  it('a full routine report writes ONLY telemetry columns — the manifest cache is not busted', async () => {
    await controller.report(SCREEN_ID, makeReq(), {
      versions: { player: '1.1.17', playerCode: 11170, manager: '1.0.4', bundleSha: 'ABCDEF012345' },
      cache: { playlist: { count: 12, bytes: 4_000_000 }, emergency: { count: 3, bytes: 900_000 } },
      render: {
        frames: 900_000,
        hash: 'pl:sig-1',
        contentKind: 'playlist',
        sync: { locked: true, errMs: 4.2, rttMs: 30, contentSig: 'abc' },
      },
      video: {
        url: 'https://cdn/x/Pro%20Series.mp4',
        totalFrames: 1830,
        droppedFrames: 12,
        elapsedMs: 61_000,
        width: 1920,
        height: 1080,
        stalls: 4,
        stalledMs: 9_000,
      },
    });

    const data = writtenData();
    expect(data).not.toBeNull();
    const keys = Object.keys(data as Record<string, unknown>);
    expect(keys).toEqual(
      expect.arrayContaining(['lastVideoReport', 'lastVideoReportAt']),
    );
    // Every key is on the telemetry-only list…
    expect(keys.filter((k) => !SCREEN_TELEMETRY_ONLY_FIELDS.has(k))).toEqual([]);
    // …so the Prisma $use hook's decision function says "do not bust".
    expect(shouldBumpManifestRev('Screen', 'update', keys)).toBe(false);
  });

  // ── 2b. VIDEO PLAYBACK QUALITY (2026-09-24) ─────────────────────────
  it('stores the dropped-frame sample rebuilt field by field, dated by the server clock', async () => {
    await controller.report(SCREEN_ID, makeReq(), {
      video: {
        url: '  https://cdn/x/clip.mp4  ',
        totalFrames: 1830.9,
        droppedFrames: 12.2,
        elapsedMs: 61_000.5,
        width: 1920,
        height: 1080,
        stalls: 4.7,
        stalledMs: 9_000.9,
      },
    });
    const data = writtenData() as Record<string, unknown>;
    expect(data.lastVideoReport).toEqual({
      url: 'https://cdn/x/clip.mp4',
      totalFrames: 1830,
      droppedFrames: 12,
      elapsedMs: 61_000,
      width: 1920,
      height: 1080,
      stalls: 4,
      stalledMs: 9_000,
      at: new Date(NOW).toISOString(),
    });
    expect(data.lastVideoReportAt).toEqual(new Date(NOW));
  });

  it('never lets dropped exceed total, and a report with no video leaves the last sample alone', async () => {
    await controller.report(SCREEN_ID, makeReq(), {
      video: {
        url: 'https://cdn/x/clip.mp4',
        totalFrames: 100,
        droppedFrames: 500,
      },
    });
    const first = writtenData() as Record<string, unknown>;
    expect(
      (first.lastVideoReport as Record<string, unknown>).droppedFrames,
    ).toBe(100);
    expect(first.lastVideoReport).not.toHaveProperty('width');
    // A player that predates the rebuffer counter sends neither key, and
    // none is invented — absent means "not counted", never "no pauses".
    expect(first.lastVideoReport).not.toHaveProperty('stalls');
    expect(first.lastVideoReport).not.toHaveProperty('stalledMs');

    jest.clearAllMocks();
    jest.setSystemTime(NOW + 35_000); // past the per-screen accept window
    await controller.report(SCREEN_ID, makeReq(), { refreshAckMs: 1 });
    const second = writtenData();
    expect(second === null || !('lastVideoReport' in second)).toBe(true);
  });

  it('rejects a sample that is not the documented shape (strict schema)', async () => {
    await expect(
      controller.report(SCREEN_ID, makeReq(), {
        video: {
          url: 'https://cdn/x/clip.mp4',
          totalFrames: 10,
          droppedFrames: 0,
          extra: 1,
        } as never,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      controller.report(SCREEN_ID, makeReq(), {
        video: { url: 'x', totalFrames: -1, droppedFrames: 0 },
      }),
    ).rejects.toMatchObject({ status: 400 });
    // The rebuffer counters are bounded like every other number here.
    const req = makeReq() as Parameters<TelemetryController['report']>[1];
    for (const bad of [
      { stalls: -1 },
      { stalls: 1_000_001 },
      { stalledMs: -1 },
      { stalledMs: 86_400_001 },
    ]) {
      await expect(
        controller.report(SCREEN_ID, req, {
          video: { url: 'x', totalFrames: 10, droppedFrames: 0, ...bad },
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(writtenData()).toBeNull();
  });

  // ── 4c. LOOP BOUNDARY (2026-09-29) ────────────────────────────────────
  describe('loop boundary', () => {
    const loop = {
      backend: 'native',
      evidence: 'rvfc',
      boundaries: 7,
      maxHoldMs: 412.9,
      p95HoldMs: 380.2,
      lastHoldMs: 301,
      maxSkipMs: 0,
    };

    it('is stored inside lastVideoReport.loop next to this tick\'s frame sample, with its own `at`', async () => {
      await controller.report(SCREEN_ID, makeReq(), {
        video: { url: 'https://cdn/x/clip.mp4', totalFrames: 2249, droppedFrames: 6 },
        loop,
      });
      const data = writtenData() as Record<string, any>;
      expect(data.lastVideoReport).toMatchObject({ url: 'https://cdn/x/clip.mp4', totalFrames: 2249 });
      expect(data.lastVideoReport.loop).toEqual({
        backend: 'native',
        evidence: 'rvfc',
        boundaries: 7,
        maxHoldMs: 412,
        p95HoldMs: 380,
        lastHoldMs: 301,
        maxSkipMs: 0,
        at: new Date(NOW).toISOString(),
      });
    });

    it('a seam-only report (a short clip never reaches the 150-frame sample) merges into the STORED sample and leaves its age alone', async () => {
      prisma.client.screen.findUnique.mockResolvedValue(
        baseRow({ lastVideoReport: { url: 'https://cdn/x/clip.mp4', totalFrames: 2249, droppedFrames: 6, at: '2026-09-29T12:00:00.000Z' } }),
      );
      await controller.report(SCREEN_ID, makeReq(), { loop });
      const data = writtenData() as Record<string, any>;
      expect(data.lastVideoReport).toMatchObject({ url: 'https://cdn/x/clip.mp4', totalFrames: 2249, at: '2026-09-29T12:00:00.000Z' });
      expect(data.lastVideoReport.loop.boundaries).toBe(7);
      // It dates the FRAME sample; a seam-only tick must not make that look fresh.
      expect(data).not.toHaveProperty('lastVideoReportAt');
    });

    it('a report with neither a frame sample nor a seam does not touch lastVideoReport at all', async () => {
      await controller.report(SCREEN_ID, makeReq(), { refreshAckMs: 1 });
      const d = writtenData();
      expect(d === null || !('lastVideoReport' in d)).toBe(true);
    });

    // The sample lands every minute of playback, the seam once a lap. Replacing
    // the stored JSON whole (the first version) erased the seam within a minute
    // on every screen that kept playing — the field showed `loop: null` for a
    // player that had measured a dozen laps.
    describe('a fresh frame sample does not erase the stored seam', () => {
      const CLIP = 'https://cdn/x/clip.mp4';
      const storedLoop = { backend: 'native', evidence: 'rvfc', boundaries: 5, maxHoldMs: 300, at: '2026-09-29T12:05:00.000Z' };
      const stored = (over: Record<string, unknown> = {}) =>
        baseRow({ lastVideoReport: { url: CLIP, totalFrames: 2000, droppedFrames: 5, at: '2026-09-29T12:04:00.000Z', loop: storedLoop, ...over } });

      it('the SAME clip keeps it, with its own `at` untouched', async () => {
        prisma.client.screen.findUnique.mockResolvedValue(stored());
        await controller.report(SCREEN_ID, makeReq(), { video: { url: CLIP, totalFrames: 2100, droppedFrames: 6 } });
        const data = writtenData() as Record<string, any>;
        expect(data.lastVideoReport).toMatchObject({ url: CLIP, totalFrames: 2100, at: new Date(NOW).toISOString() });
        expect(data.lastVideoReport.loop).toEqual(storedLoop);
      });

      it('a DIFFERENT clip drops it — the old file\'s seam is never attributed to the new one', async () => {
        prisma.client.screen.findUnique.mockResolvedValue(stored());
        await controller.report(SCREEN_ID, makeReq(), { video: { url: 'https://cdn/x/other.mp4', totalFrames: 2100, droppedFrames: 6 } });
        expect(writtenData()!.lastVideoReport).not.toHaveProperty('loop');
      });

      it('a seam in the SAME report wins over the carried one', async () => {
        prisma.client.screen.findUnique.mockResolvedValue(stored());
        await controller.report(SCREEN_ID, makeReq(), { video: { url: CLIP, totalFrames: 2100, droppedFrames: 6 }, loop });
        const data = writtenData() as Record<string, any>;
        expect(data.lastVideoReport.loop).toMatchObject({ boundaries: 7, at: new Date(NOW).toISOString() });
      });

      it('a screen that never measured a seam gets no loop key invented', async () => {
        prisma.client.screen.findUnique.mockResolvedValue(baseRow({ lastVideoReport: { url: CLIP, totalFrames: 2000, droppedFrames: 5 } }));
        await controller.report(SCREEN_ID, makeReq(), { video: { url: CLIP, totalFrames: 2100, droppedFrames: 6 } });
        expect(writtenData()!.lastVideoReport).not.toHaveProperty('loop');
      });

      it('carriedLoopBlock: only a real object survives; a missing url on either side cannot contradict it', () => {
        expect(carriedLoopBlock(null, CLIP)).toBeNull();
        expect(carriedLoopBlock('junk', CLIP)).toBeNull();
        expect(carriedLoopBlock([], CLIP)).toBeNull();
        expect(carriedLoopBlock({ url: CLIP, loop: 'x' }, CLIP)).toBeNull();
        expect(carriedLoopBlock({ url: CLIP, loop: [1] }, CLIP)).toBeNull();
        expect(carriedLoopBlock({ url: CLIP, loop: storedLoop }, CLIP)).toBe(storedLoop);
        expect(carriedLoopBlock({ loop: storedLoop }, CLIP)).toBe(storedLoop); // stored sample names no file
        expect(carriedLoopBlock({ url: CLIP, loop: storedLoop }, undefined)).toBe(storedLoop); // fresh names none
        expect(carriedLoopBlock({ url: CLIP, loop: storedLoop }, 'https://cdn/x/other.mp4')).toBeNull();
      });
    });

    it('the schema is strict: an unknown key, a bad backend or an out-of-range number is a 400', async () => {
      for (const bad of [
        { ...loop, extra: 1 },
        { ...loop, backend: 'mse' },
        { ...loop, maxHoldMs: 700_000 },
        { ...loop, boundaries: -1 },
        { ...loop, evidence: 'camera' },
        { backend: 'native' },
      ]) {
        jest.clearAllMocks();
        await expect(controller.report(SCREEN_ID, makeReq(), { loop: bad as never })).rejects.toMatchObject({ status: 400 });
      }
    });

    it('sanitizeLoopBoundary floors, clamps and drops what it cannot use', () => {
      expect(sanitizeLoopBoundary({ ...loop, fallbackReason: '  decoder-limit  ', swaps: 12.7, fallbacks: 1 })).toEqual({
        backend: 'native', evidence: 'rvfc', boundaries: 7,
        maxHoldMs: 412, p95HoldMs: 380, lastHoldMs: 301, maxSkipMs: 0,
        swaps: 12, fallbacks: 1, fallbackReason: 'decoder-limit',
      });
      expect(sanitizeLoopBoundary({ ...loop, maxHoldMs: 9e9 })).toMatchObject({ maxHoldMs: 600_000 });
      const junk = sanitizeLoopBoundary({ ...loop, maxHoldMs: Number.NaN, p95HoldMs: -3, lastHoldMs: '9' }) as Record<string, unknown>;
      for (const k of ['maxHoldMs', 'p95HoldMs', 'lastHoldMs']) expect(junk).not.toHaveProperty(k);
      expect(sanitizeLoopBoundary(null)).toBeNull();
      expect(sanitizeLoopBoundary({ ...loop, backend: 'x' })).toBeNull();
      expect(sanitizeLoopBoundary({ backend: 'twodeck', boundaries: 'many' })).toBeNull();
    });
  });

  it('sanitizeVideoReport keeps the rebuffer counters only as bounded non-negative ints, and only when sent', () => {
    const base = { url: 'x', totalFrames: 1830, droppedFrames: 0 };
    expect(sanitizeVideoReport({ ...base, stalls: 0, stalledMs: 0 })).toEqual({
      ...base,
      stalls: 0,
      stalledMs: 0,
    });
    // The schema bounds these first; the sanitizer never trusts that it did.
    expect(
      sanitizeVideoReport({ ...base, stalls: 2e6, stalledMs: 1e9 }),
    ).toEqual({ ...base, stalls: 1_000_000, stalledMs: 86_400_000 });
    for (const junk of [-1, Number.NaN, Infinity, '3', null]) {
      const out = sanitizeVideoReport({
        ...base,
        stalls: junk,
        stalledMs: junk,
      });
      expect(out).not.toHaveProperty('stalls');
      expect(out).not.toHaveProperty('stalledMs');
    }
  });

  it('the ONE write that must bust is the durable-REFRESH ack (pendingRefreshAt clear)', async () => {
    const requestedAt = new Date(NOW - 30_000);
    prisma.client.screen.findUnique.mockResolvedValue(
      baseRow({ pendingRefreshAt: requestedAt }),
    );

    const out = await controller.report(SCREEN_ID, makeReq(), {
      refreshAckMs: requestedAt.getTime(),
    });

    expect(out.refreshAcked).toBe(true);
    const keys = Object.keys(writtenData() as Record<string, unknown>);
    expect(keys).toContain('pendingRefreshAt');
    // Deliberate: clearing the command IS manifest content, so this write
    // MUST invalidate — identical to /render-proof's behaviour today.
    expect(shouldBumpManifestRev('Screen', 'update', keys)).toBe(true);
    // …and the ack is recorded on the timeline before the evidence is gone.
    expect(prisma.client.screenEvent.create).toHaveBeenCalledTimes(1);
  });

  it('a NON-matching ack value never clears the flag (value identity, never a clock compare)', async () => {
    const requestedAt = new Date(NOW - 30_000);
    prisma.client.screen.findUnique.mockResolvedValue(
      baseRow({ pendingRefreshAt: requestedAt }),
    );
    // A device whose clock is minutes ahead reports a LATER value. A
    // timestamp inequality would treat that as "newer, therefore done" and
    // reload-loop the screen; value identity refuses it.
    const out = await controller.report(SCREEN_ID, makeReq(), {
      refreshAckMs: requestedAt.getTime() + 120_000,
    });
    expect(out.refreshAcked).toBe(false);
    expect(Object.keys(writtenData() as Record<string, unknown>)).not.toContain(
      'pendingRefreshAt',
    );
    expect(prisma.client.screenEvent.create).not.toHaveBeenCalled();
  });

  // ── 3. COLUMN PARITY with the endpoints this replaces ─────────────────
  it('writes the liveness columns the status heartbeat wrote', async () => {
    await controller.report(SCREEN_ID, makeReq(), {});
    const data = writtenData() as Record<string, unknown>;
    expect(data.lastPingAt).toEqual(new Date(NOW));
    expect(data.status).toBe('ONLINE');
  });

  it('an UNPAIRED screen reports PENDING, not ONLINE', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(baseRow({ tenantId: null }));
    await controller.report(SCREEN_ID, makeReq(), {});
    expect((writtenData() as Record<string, unknown>).status).toBe('PENDING');
  });

  it('writes the cache-status columns and debounces an identical report', async () => {
    const cache = { playlist: { count: 2, bytes: 10 }, emergency: { count: 1, bytes: 5 } };
    await controller.report(SCREEN_ID, makeReq(), { cache });
    expect((writtenData() as Record<string, unknown>).lastCacheReport).toEqual(cache);
    expect((writtenData() as Record<string, unknown>).lastCacheReportAt).toEqual(new Date(NOW));

    // Second identical report 60 s later — inside the 120 s window.
    prisma.client.screen.update.mockClear();
    jest.setSystemTime(NOW + 60_000);
    await controller.report(SCREEN_ID, makeReq(), { cache });
    const second = writtenData() as Record<string, unknown>;
    expect(second).not.toHaveProperty('lastCacheReport');
    // …but liveness still wrote, so the row is still fresh.
    expect(second.lastPingAt).toEqual(new Date(NOW + 60_000));
  });

  it('a CHANGED cache report writes through immediately', async () => {
    await controller.report(SCREEN_ID, makeReq(), {
      cache: { playlist: { count: 2, bytes: 10 } },
    });
    prisma.client.screen.update.mockClear();
    // Past the 30 s per-screen accept floor (the debounce under test is the
    // 120 s cache-signature one, which a CHANGED report must beat).
    jest.setSystemTime(NOW + 35_000);
    await controller.report(SCREEN_ID, makeReq(), {
      cache: { playlist: { count: 3, bytes: 20 } },
    });
    expect((writtenData() as Record<string, unknown>).lastCacheReport).toEqual({
      playlist: { count: 3, bytes: 20 },
      emergency: undefined,
    });
  });

  // ── 3a. THE DOWNLOAD SNAPSHOT (2026-09-27) ────────────────────────────
  //
  // A file ≥ 8 MiB plays only once it is completely on the screen (player
  // rule 17). While it downloads the screen shows its own splash, or keeps
  // the previous content on glass — and the dashboard had no way to tell
  // either from "nothing scheduled". The player now says so inside the cache
  // report it already sends; these pin how the server stores it.
  describe('cache.downloading', () => {
    const tiers = {
      playlist: { count: 2, bytes: 10 },
      emergency: { count: 1, bytes: 5 },
    };
    const snapshot = {
      file: 'RIOT%20promo%204K.mp4',
      bytesLoaded: 87_000_000,
      bytesTotal: 141_000_000,
      deferredCommit: true,
    };

    it('stores the snapshot inside lastCacheReport, rebuilt field by field — and busts no manifest cache', async () => {
      await controller.report(SCREEN_ID, makeReq(), {
        cache: { ...tiers, downloading: snapshot },
      });
      const data = writtenData() as Record<string, unknown>;
      expect(data.lastCacheReport).toEqual({ ...tiers, downloading: snapshot });
      expect(data.lastCacheReportAt).toEqual(new Date(NOW));
      // No new column: the snapshot rides lastCacheReport, which is on the
      // telemetry-only list, so the fleet's downloads never thrash the cache.
      const keys = Object.keys(data);
      expect(keys.filter((k) => !SCREEN_TELEMETRY_ONLY_FIELDS.has(k))).toEqual(
        [],
      );
      expect(shouldBumpManifestRev('Screen', 'update', keys)).toBe(false);
    });

    it('bounds what it keeps: control characters stripped, the name capped, bytes clamped to the size', async () => {
      await controller.report(SCREEN_ID, makeReq(), {
        cache: {
          ...tiers,
          downloading: {
            file: `\u0007clip\u001b[31m${'x'.repeat(200)}`,
            bytesLoaded: 9_000.9,
            bytesTotal: 5_000,
          },
        },
      });
      const stored = (writtenData() as Record<string, unknown>)
        .lastCacheReport as Record<string, any>;
      expect(stored.downloading.file).toBe(
        `clip[31m${'x'.repeat(200)}`.slice(0, 120),
      );
      expect(stored.downloading.file).toHaveLength(120);
      expect(stored.downloading.bytesLoaded).toBe(5_000);
      expect(stored.downloading.bytesTotal).toBe(5_000);
      // Absent means "not held" — never invented into a hold.
      expect(stored.downloading.deferredCommit).toBe(false);
    });

    it('a size the player does not know yet is stored as null, never as 0', async () => {
      for (const bytesTotal of [null, undefined, 0]) {
        jest.clearAllMocks();
        SCREEN_ID = `screen-${++screenSeq}`;
        deviceAuth.verifyDeviceForScreen.mockResolvedValue({
          ok: true,
          sub: SCREEN_ID,
          screen: { id: SCREEN_ID, tenantId: 'tenant-xyz' },
          tenantId: 'tenant-xyz',
          token: 'fake',
        });
        const downloading: Record<string, unknown> = {
          file: 'a.mp4',
          bytesLoaded: 1_000,
        };
        if (bytesTotal !== undefined) downloading.bytesTotal = bytesTotal;
        await controller.report(SCREEN_ID, makeReq(), {
          cache: { ...tiers, downloading },
        } as never);
        const stored = (writtenData() as Record<string, unknown>)
          .lastCacheReport as Record<string, any>;
        expect(stored.downloading).toEqual({
          file: 'a.mp4',
          bytesLoaded: 1_000,
          bytesTotal: null,
          deferredCommit: false,
        });
      }
    });

    it('a report that carries a download ALWAYS writes — an identical one inside the 120 s debounce too', async () => {
      // A slow link can take longer than a tick to finish one chunk, so two
      // reports in a row can be byte-identical. Debounced, lastCacheReportAt
      // would lag up to 120 s and the dashboard would call a live download
      // stale. The 30 s accept floor still bounds the write rate.
      const body = { cache: { ...tiers, downloading: snapshot } };
      await controller.report(SCREEN_ID, makeReq(), body);
      prisma.client.screen.update.mockClear();
      jest.setSystemTime(NOW + 60_000);
      await controller.report(SCREEN_ID, makeReq(), body);
      const second = writtenData() as Record<string, unknown>;
      expect(second.lastCacheReport).toEqual({
        ...tiers,
        downloading: snapshot,
      });
      expect(second.lastCacheReportAt).toEqual(new Date(NOW + 60_000));
    });

    it('when the download ends, the next report writes through at once WITHOUT the snapshot', async () => {
      await controller.report(SCREEN_ID, makeReq(), {
        cache: { ...tiers, downloading: snapshot },
      });
      prisma.client.screen.update.mockClear();
      jest.setSystemTime(NOW + 35_000);
      await controller.report(SCREEN_ID, makeReq(), { cache: tiers });
      const data = writtenData() as Record<string, unknown>;
      expect(data.lastCacheReport).toEqual(tiers);
      expect(data.lastCacheReport).not.toHaveProperty('downloading');
      expect(data.lastCacheReportAt).toEqual(new Date(NOW + 35_000));
    });

    it('a report with no download still serializes exactly as before — the fleet keeps debouncing', async () => {
      await controller.report(SCREEN_ID, makeReq(), { cache: tiers });
      expect(
        JSON.stringify(
          (writtenData() as Record<string, unknown>).lastCacheReport,
        ),
      ).toBe(JSON.stringify(tiers));
      prisma.client.screen.update.mockClear();
      jest.setSystemTime(NOW + 60_000);
      await controller.report(SCREEN_ID, makeReq(), { cache: tiers });
      expect(writtenData()).not.toHaveProperty('lastCacheReport');
    });

    it.each([
      ['an unknown key inside the snapshot', { ...snapshot, eta: 30 }],
      [
        'a name past the 256-char bound',
        { ...snapshot, file: 'x'.repeat(257) },
      ],
      ['a negative byte count', { ...snapshot, bytesLoaded: -1 }],
      [
        'a byte count that is a string',
        { ...snapshot, bytesLoaded: '87000000' },
      ],
      [
        'a hold flag that is not a boolean',
        { ...snapshot, deferredCommit: 'yes' },
      ],
      ['no byte count at all', { file: 'a.mp4', bytesTotal: 10 }],
    ])(
      '400s on %s with ZERO database writes (strict schema)',
      async (_label, downloading) => {
        await expect(
          controller.report(SCREEN_ID, makeReq(), {
            cache: { ...tiers, downloading },
          } as never),
        ).rejects.toMatchObject({ status: 400 });
        expect(prisma.client.screen.findUnique).not.toHaveBeenCalled();
        expect(prisma.client.screen.update).not.toHaveBeenCalled();
      },
    );
  });
  it('writes the render-proof columns, including the page-bundle SHA and sync report', async () => {
    await controller.report(SCREEN_ID, makeReq(), {
      versions: { bundleSha: 'DEADBEEF0123456789' },
      render: { frames: 42, hash: 'pl:x', sync: { locked: true, errMs: 3 } },
    });
    const data = writtenData() as Record<string, unknown>;
    expect(data.lastRenderedAt).toEqual(new Date(NOW));
    expect(data.lastRenderedFrames).toBe(42);
    expect(data.lastRenderedHash).toBe('pl:x');
    // Normalized exactly as /render-proof normalizes: lowercased, 12 chars.
    expect(data.lastBundleSha).toBe('deadbeef0123');
    expect((data.lastSyncReport as Record<string, unknown>).locked).toBe(true);
  });

  // ── 3b. BUNDLE ID — the identity the player actually reloads on ───────
  //
  // 2026-09-21. The player reports this so the dashboard can grade skew on
  // the value the reload decision is made on; grading on the commit SHA made
  // every online screen read "behind" after any commit that could not change
  // a downloaded byte ("App current 5/18" on a healthy fleet).
  describe('versions.bundleId', () => {
    it('persists the reported bundleId, normalized like the SHA', async () => {
      await controller.report(SCREEN_ID, makeReq(), {
        versions: { bundleSha: 'deadbeef0123', bundleId: '1F2E3D4C5B6A9999' },
        render: { frames: 1, hash: 'pl:x' },
      });
      const data = writtenData() as Record<string, unknown>;
      expect(data.lastBundleId).toBe('1f2e3d4c5b6a');
      // Dated by the SHA's timestamp — one instant, one column.
      expect(data.lastBundleShaAt).toEqual(new Date(NOW));
    });

    it('a build that reports no bundleId writes no column at all', async () => {
      // The whole fleet is on such a build the moment this ships. Writing a
      // null would look like a probe that ran and found nothing.
      await controller.report(SCREEN_ID, makeReq(), {
        versions: { bundleSha: 'deadbeef0123' },
        render: { frames: 1, hash: 'pl:x' },
      });
      expect(writtenData()).not.toHaveProperty('lastBundleId');
    });

    it('a garbage bundleId is IGNORED without failing the request', async () => {
      // A bad build identifier must never be able to stop a screen reporting.
      // (Everything here is inside the schema's 64-char bound — see the
      // overlong case below, which is a different situation. Note a long but
      // WELL-FORMED token is not garbage: the rule is bounded, not hex-only,
      // so `'a'.repeat(64)` is a legal build identifier and truncates.)
      for (const evil of ['<script>alert(1)</script>', 'not an id', '../../etc/passwd', '', '   ']) {
        SCREEN_ID = `screen-evil-${++screenSeq}`;
        deviceAuth.verifyDeviceForScreen.mockResolvedValue({
          ok: true, sub: SCREEN_ID,
          screen: { id: SCREEN_ID, tenantId: 'tenant-xyz' },
          tenantId: 'tenant-xyz', token: 'fake',
        });
        prisma.client.screen.findUnique.mockResolvedValue(baseRow());
        prisma.client.screen.update.mockClear();

        const out = await controller.report(SCREEN_ID, makeReq(), {
          versions: { bundleSha: 'deadbeef0123', bundleId: evil },
          render: { frames: 1, hash: 'pl:x' },
        });
        expect(out.ok).toBe(true); // never a 400
        expect(writtenData()).not.toHaveProperty('lastBundleId');
        // …and the rest of the report still landed.
        expect((writtenData() as Record<string, unknown>).lastBundleSha).toBe('deadbeef0123');
      }
    });

    it('an OVERLONG bundleId is rejected by the schema, not silently truncated', async () => {
      // >64 chars fails the strict zod bound, so the WHOLE report 400s rather
      // than the field being dropped. That is pre-existing, deliberate and
      // identical to `bundleSha`'s treatment: the length bound is the
      // row-bloat defence and it sits at the boundary, ahead of the
      // normalizer. Recorded here so the difference from the case above is a
      // decision, not a surprise.
      await expect(
        controller.report(SCREEN_ID, makeReq(), {
          versions: { bundleId: 'a'.repeat(65) },
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('an UNCHANGED sha but a CHANGED bundleId is NOT debounced away', async () => {
      // The two identities move independently. If only the SHA were watched,
      // a screen that just reloaded onto a new bundle would keep reading
      // "behind" for up to 40 s after it was already current.
      await controller.report(SCREEN_ID, makeReq(), {
        versions: { bundleSha: 'deadbeef0123', bundleId: '1f2e3d4c5b6a' },
        render: { frames: 1, hash: 'pl:x' },
      });
      expect(prisma.client.screen.update).toHaveBeenCalledTimes(1);

      jest.setSystemTime(NOW + 35_000); // past the 30 s accept floor, inside the 40 s debounce
      await controller.report(SCREEN_ID, makeReq(), {
        versions: { bundleSha: 'deadbeef0123', bundleId: '9988776655ff' },
        render: { frames: 2, hash: 'pl:x' },
      });
      expect(prisma.client.screen.update).toHaveBeenCalledTimes(2);
      expect(prisma.client.screen.update.mock.calls[1][0].data.lastBundleId).toBe('9988776655ff');
    });

    it('both identities unchanged still debounces — the DB-efficiency win survives', async () => {
      await controller.report(SCREEN_ID, makeReq(), {
        versions: { bundleSha: 'deadbeef0123', bundleId: '1f2e3d4c5b6a' },
        render: { frames: 1, hash: 'pl:x' },
      });
      prisma.client.screen.update.mockClear();
      jest.setSystemTime(NOW + 35_000);
      await controller.report(SCREEN_ID, makeReq(), {
        versions: { bundleSha: 'deadbeef0123', bundleId: '1f2e3d4c5b6a' },
        render: { frames: 2, hash: 'pl:x' },
      });
      // Liveness may still write; the render-proof columns must not.
      const data = writtenData();
      if (data) expect(data).not.toHaveProperty('lastBundleId');
    });

    it('THE 25 GB/mo RULE: lastBundleId is telemetry-only', async () => {
      // A high-frequency column missing from SCREEN_TELEMETRY_ONLY_FIELDS
      // busts the per-screen manifest cache on every render proof, fleet-wide.
      expect(SCREEN_TELEMETRY_ONLY_FIELDS.has('lastBundleId')).toBe(true);
      expect(shouldBumpManifestRev('Screen', 'update', ['lastBundleId'])).toBe(false);
      expect(
        shouldBumpManifestRev('Screen', 'update', [
          'lastRenderedAt', 'lastRenderedFrames', 'lastRenderedHash',
          'lastBundleSha', 'lastBundleShaAt', 'lastBundleId',
        ]),
      ).toBe(false);
      // Polarity intact — this was not widened into "any Screen update is free".
      expect(shouldBumpManifestRev('Screen', 'update', ['lastBundleId', 'orientation'])).toBe(true);
    });

    it('lastBundleId is in the controller column allowlist', () => {
      expect(TELEMETRY_COLUMNS.has('lastBundleId')).toBe(true);
    });
  });

  // ── 4. NEVER SYNTHESIZE A PAINT ───────────────────────────────────────
  it('omitting `render` leaves lastRenderedAt untouched — a frozen screen must go STALE', async () => {
    await controller.report(SCREEN_ID, makeReq(), {
      versions: { player: '1.1.17' },
      cache: { playlist: { count: 1, bytes: 1 } },
    });
    const data = writtenData() as Record<string, unknown>;
    expect(data).not.toHaveProperty('lastRenderedAt');
    expect(data).not.toHaveProperty('lastRenderedFrames');
  });

  // ── 5. RESPONSE the player acts on ────────────────────────────────────
  it('surfaces a pending force-update the same way the status heartbeat did', async () => {
    const pendingAt = new Date(NOW - 60_000);
    prisma.client.screen.findUnique.mockResolvedValue(
      baseRow({ forceApkUpdatePendingAt: pendingAt }),
    );
    const out = await controller.report(SCREEN_ID, makeReq(), {});
    expect(out.forceUpdatePending).toBe(true);
    expect(out.forceUpdatePendingAt).toBe(pendingAt.toISOString());
  });

  it('a stale (>24 h) pending flag does NOT fire — same freshness window as before', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(
      baseRow({ forceApkUpdatePendingAt: new Date(NOW - 25 * 60 * 60 * 1000) }),
    );
    const out = await controller.report(SCREEN_ID, makeReq(), {});
    expect(out.forceUpdatePending).toBe(false);
  });

  it('a version-code increase clears the pending push and stamps INSTALLED', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(
      baseRow({ forceApkUpdatePendingAt: new Date(NOW - 60_000), playerVersionCode: 11160 }),
    );
    const out = await controller.report(SCREEN_ID, makeReq(), {
      versions: { player: '1.1.17', playerCode: 11170 },
    });
    const data = writtenData() as Record<string, unknown>;
    expect(data.forceApkUpdatePendingAt).toBeNull();
    expect(data.lastOtaState).toBe('INSTALLED');
    expect(out.forceUpdatePending).toBe(false);
    expect(out.ota).toMatchObject({ state: 'INSTALLED', progress: 100 });
    // Still telemetry-only — the OTA columns are all on the list.
    expect(shouldBumpManifestRev('Screen', 'update', Object.keys(data))).toBe(false);
  });

  it('an empty manager string is the explicit "Manager uninstalled" signal', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(baseRow({ managerVersion: '1.0.3' }));
    await controller.report(SCREEN_ID, makeReq(), { versions: { manager: '' } });
    const data = writtenData() as Record<string, unknown>;
    expect(data.managerVersion).toBeNull();
    expect(data.managerVersionAt).toBeNull();
  });

  it('an ABSENT manager field leaves the column alone (old build with no opinion)', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(baseRow({ managerVersion: '1.0.3' }));
    await controller.report(SCREEN_ID, makeReq(), { versions: { player: '1.1.17' } });
    expect(writtenData() as Record<string, unknown>).not.toHaveProperty('managerVersion');
  });

  it('asks for a capability report when the server has never had one', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(
      baseRow({ displayCapabilitiesAt: null }),
    );
    const out = await controller.report(SCREEN_ID, makeReq(), {});
    expect(out.capabilitiesReportRequested).toBe(true);
  });

  it('asks again only when the device says its probe hash MOVED', async () => {
    const first = await controller.report(SCREEN_ID, makeReq(), { capsHash: 'h1' });
    expect(first.capabilitiesReportRequested).toBe(false); // first sighting
    jest.setSystemTime(NOW + 60_000);
    const same = await controller.report(SCREEN_ID, makeReq(), { capsHash: 'h1' });
    expect(same.capabilitiesReportRequested).toBe(false);
    jest.setSystemTime(NOW + 120_000);
    const moved = await controller.report(SCREEN_ID, makeReq(), { capsHash: 'h2' });
    expect(moved.capabilitiesReportRequested).toBe(true);
  });

  it('tells the client the cadence the server wants', async () => {
    const out = await controller.report(SCREEN_ID, makeReq(), {});
    expect(out.nextTelemetryInMs).toBe(60_000);
  });

  // ── 6. ONE READ, ONE WRITE ────────────────────────────────────────────
  it('does at most two DB round-trips on the routine path', async () => {
    await controller.report(SCREEN_ID, makeReq(), {
      versions: { player: '1.1.16' },
      cache: { playlist: { count: 1, bytes: 1 } },
      render: { frames: 1, hash: 'pl:x' },
    });
    expect(prisma.client.screen.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.client.screen.update).toHaveBeenCalledTimes(1);
    // …and the write never RETURNINGs the 88-column row.
    expect(prisma.client.screen.update.mock.calls[0][0].select).toEqual({ id: true });
  });

  // ── 7. HOSTILE-INPUT POSTURE (lead security addendum) ────────────────
  it('refuses a second post inside the 30 s per-screen floor with ZERO database work', async () => {
    await controller.report(SCREEN_ID, makeReq(), {});
    prisma.client.screen.findUnique.mockClear();
    prisma.client.screen.update.mockClear();
    jest.setSystemTime(NOW + TELEMETRY_MIN_ACCEPT_INTERVAL_MS - 1);
    await expect(controller.report(SCREEN_ID, makeReq(), {})).rejects.toMatchObject({
      status: 429,
    });
    // The point of the limit: a looping device cannot amplify DB load.
    expect(prisma.client.screen.findUnique).not.toHaveBeenCalled();
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('accepts again once the floor has elapsed', async () => {
    await controller.report(SCREEN_ID, makeReq(), {});
    jest.setSystemTime(NOW + TELEMETRY_MIN_ACCEPT_INTERVAL_MS);
    await expect(controller.report(SCREEN_ID, makeReq(), {})).resolves.toMatchObject({
      ok: true,
    });
  });

  it('413s on an oversized Content-Length before auth or any database work', async () => {
    const req = makeReq({ 'content-length': String(TELEMETRY_MAX_BODY_BYTES + 1) });
    await expect(controller.report(SCREEN_ID, req, {})).rejects.toMatchObject({
      status: 413,
    });
    expect(deviceAuth.verifyDeviceForScreen).not.toHaveBeenCalled();
    expect(prisma.client.screen.findUnique).not.toHaveBeenCalled();
  });

  it('400s on an UNKNOWN field — strict schema, never silently dropped', async () => {
    await expect(
      controller.report(SCREEN_ID, makeReq(), { somethingNew: 1 } as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('400s on a wrong-typed field rather than coercing it', async () => {
    await expect(
      controller.report(SCREEN_ID, makeReq(), {
        render: { frames: 'lots' },
      } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('uses the CREDENTIAL\'s screen id, never the path parameter', async () => {
    // The verifier already refuses a `sub` that differs from the path id, so
    // this pins the belt: every read and write below keys on `auth.sub`.
    deviceAuth.verifyDeviceForScreen.mockResolvedValue({
      ok: true,
      sub: SCREEN_ID,
      screen: { id: SCREEN_ID, tenantId: 'tenant-xyz' },
      tenantId: 'tenant-xyz',
      token: 'fake',
    });
    await controller.report(SCREEN_ID, makeReq(), {});
    expect(prisma.client.screen.findUnique.mock.calls[0][0].where).toEqual({
      id: SCREEN_ID,
    });
    expect(prisma.client.screen.update.mock.calls[0][0].where).toEqual({ id: SCREEN_ID });
  });

  // ── 8. THE CADENCE / ONLINE-GRACE INVARIANT ──────────────────────────
  it('the ONLINE grace outlives a cadence tick PLUS a retry — or the whole fleet reads OFFLINE', () => {
    // These two numbers are ONE decision. The grace was 35 s because the
    // heartbeat was 30 s; a screen now reports once a minute, so a 35 s
    // grace would flip every healthy screen in the fleet to OFFLINE roughly
    // half the time. The client's fast retry (15 s, telemetry.ts) is what
    // keeps a single dropped post from doing the same, so the grace has to
    // clear cadence + retry with real slack.
    const RETRY_MS = 15_000; // TELEMETRY_RETRY_MS, apps/web/.../telemetry.ts
    expect(SCREEN_ONLINE_GRACE_MS).toBeGreaterThan(TELEMETRY_INTERVAL_MS + RETRY_MS);
    // …and by enough that jitter and clock skew cannot eat the margin.
    expect(SCREEN_ONLINE_GRACE_MS - (TELEMETRY_INTERVAL_MS + RETRY_MS)).toBeGreaterThanOrEqual(
      20_000,
    );
    // The wedge detector's own ping-freshness window (90 s) must still be
    // clear of the cadence, or it would start "rescuing" healthy screens.
    expect(90_000).toBeGreaterThan(TELEMETRY_INTERVAL_MS);
  });

  it('the explicit column map covers every key the handler can write', async () => {
    // Belt for the column map itself: everything on it must be a real
    // telemetry column, and the ONLY member allowed to bust the manifest
    // cache is the durable-REFRESH ack.
    const bustable = [...TELEMETRY_COLUMNS].filter(
      (k) => !SCREEN_TELEMETRY_ONLY_FIELDS.has(k),
    );
    expect(bustable).toEqual(['pendingRefreshAt']);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// POST /screens/:id/refresh-ack — the immediate confirmation (2026-09-28)
// ═══════════════════════════════════════════════════════════════════════════
//
// Greg pressed Resync: the screen reloaded in 8 s, the dashboard said "Content
// behind" for 72. The confirmation rode the routine telemetry post, which the
// server refuses inside 30 s per screen — and a just-reloaded page always posts
// first thing. These tests pin the dedicated route that cannot be starved.
describe('POST /screens/:id/refresh-ack', () => {
  let controller: TelemetryController;
  let prisma: any;
  const redis: any = { sismember: jest.fn(async () => false) };
  let screenId = 'ack-0';
  let seq = 0;
  const pendingAt = new Date(NOW - 20_000);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    screenId = `ack-${++seq}`;
    resetManifestCacheForTests();
    resetTelemetryStateForTests();
    deviceAuth.verifyDeviceForScreen.mockResolvedValue({
      ok: true,
      sub: screenId,
      screen: { id: screenId, tenantId: 'tenant-xyz' },
      tenantId: 'tenant-xyz',
      token: 'fake',
    });
    prisma = {
      client: {
        screen: {
          findUnique: jest.fn(async () => ({ id: screenId, tenantId: 'tenant-xyz', pendingRefreshAt: pendingAt })),
          update: jest.fn(async () => ({ id: screenId })),
        },
        screenEvent: { create: jest.fn(async () => ({ id: 'ev-1' })) },
      },
    };
    controller = new TelemetryController(prisma, redis);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a matching value clears the pending refresh at once, busts the manifest cache, and records the timeline row', async () => {
    const out = await controller.refreshAck(screenId, makeReq(), { refreshAckMs: pendingAt.getTime() });
    expect(out).toEqual({ ok: true, refreshAcked: true });
    expect(prisma.client.screen.update).toHaveBeenCalledTimes(1);
    const { data, where } = prisma.client.screen.update.mock.calls[0][0];
    expect(where).toEqual({ id: screenId });
    expect(data).toEqual({ pendingRefreshAt: null });
    // Clearing the command IS manifest content: it must invalidate.
    expect(shouldBumpManifestRev('Screen', 'update', Object.keys(data))).toBe(true);
    expect(prisma.client.screenEvent.create).toHaveBeenCalledWith({
      data: { screenId, tenantId: 'tenant-xyz', kind: 'refresh-acked', detail: { valueMs: pendingAt.getTime() } },
    });
  });

  it('a NON-matching value never clears it — value identity, not a clock comparison', async () => {
    // A device whose clock runs minutes ahead reports a LATER value; an
    // inequality would call that "newer, therefore done".
    for (const off of [120_000, -120_000, 1]) {
      const out = await controller.refreshAck(screenId, makeReq(), { refreshAckMs: pendingAt.getTime() + off });
      expect(out).toEqual({ ok: true, refreshAcked: false });
      jest.setSystemTime(Date.now() + REFRESH_ACK_MIN_ACCEPT_INTERVAL_MS + 1);
    }
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
    expect(prisma.client.screenEvent.create).not.toHaveBeenCalled();
  });

  it('nothing pending → no write (a repeated ack is harmless)', async () => {
    prisma.client.screen.findUnique.mockResolvedValue({ id: screenId, tenantId: 'tenant-xyz', pendingRefreshAt: null });
    const out = await controller.refreshAck(screenId, makeReq(), { refreshAckMs: pendingAt.getTime() });
    expect(out).toEqual({ ok: true, refreshAcked: false });
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('401s a caller that cannot prove it is this screen — before any database work', async () => {
    deviceAuth.verifyDeviceForScreen.mockResolvedValue({ ok: false, reason: 'no_auth' });
    await expect(controller.refreshAck(screenId, makeReq(), { refreshAckMs: 1 })).rejects.toMatchObject({ status: 401 });
    expect(prisma.client.screen.findUnique).not.toHaveBeenCalled();
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('400s a body that is not exactly { refreshAckMs: number }', async () => {
    for (const bad of [{}, { refreshAckMs: 'soon' }, { refreshAckMs: -1 }, { refreshAckMs: 1, extra: true }, null]) {
      await expect(controller.refreshAck(screenId, makeReq(), bad)).rejects.toMatchObject({ status: 400 });
    }
    await expect(
      controller.refreshAck(screenId, makeReq({ 'content-length': '5000' }), { refreshAckMs: 1 }),
    ).rejects.toMatchObject({ status: 413 });
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('is NOT starved by the 30 s telemetry floor: an ack right after an accepted telemetry post still lands', async () => {
    // The whole bug: a reloaded page posts telemetry first (accepted), then its
    // confirmation moments later — under the old design that second thing was a
    // 429 on the same 30 s floor. The dedicated route has its own spacing.
    await controller.report(screenId, makeReq(), {});
    jest.setSystemTime(NOW + 3_000); // 3 s later, far inside the 30 s telemetry floor
    await expect(controller.report(screenId, makeReq(), {})).rejects.toMatchObject({ status: 429 });
    const out = await controller.refreshAck(screenId, makeReq(), { refreshAckMs: pendingAt.getTime() });
    expect(out.refreshAcked).toBe(true);
  });

  it('bounds a looping device: a second ack inside the spacing is a 429, and lands again after it', async () => {
    await controller.refreshAck(screenId, makeReq(), { refreshAckMs: 1 });
    await expect(controller.refreshAck(screenId, makeReq(), { refreshAckMs: 1 })).rejects.toMatchObject({ status: 429 });
    jest.setSystemTime(NOW + REFRESH_ACK_MIN_ACCEPT_INTERVAL_MS + 1);
    await expect(controller.refreshAck(screenId, makeReq(), { refreshAckMs: 1 })).resolves.toMatchObject({ ok: true });
  });

  it('404s an unknown screen', async () => {
    prisma.client.screen.findUnique.mockResolvedValue(null);
    await expect(controller.refreshAck(screenId, makeReq(), { refreshAckMs: 1 })).rejects.toMatchObject({ status: 404 });
  });

  it('a failed timeline row never turns a completed ack into an error', async () => {
    prisma.client.screenEvent.create.mockRejectedValue(new Error('timeline down'));
    await expect(
      controller.refreshAck(screenId, makeReq(), { refreshAckMs: pendingAt.getTime() }),
    ).resolves.toEqual({ ok: true, refreshAcked: true });
  });
});
