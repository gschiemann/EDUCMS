/**
 * Per-(screen, file) playback evidence — ingest (video guarantee step 1,
 * 2026-10-11). What these pin:
 *
 *   1. The telemetry body accepts the new `video` keys and `mediaCaps`, and a
 *      body WITHOUT them behaves exactly as before (no evidence write).
 *   2. A sample that names its file by digest is folded into ONE row per
 *      screen × file, with tenant scope from the LIVE row and the unit's
 *      concurrency (own count + sibling faces playing video).
 *   3. Uncached / first-stretch samples never move the decode counters.
 *   4. Evidence is best-effort: a failing write never turns the report into a 500.
 *   5. Neither new model is manifest-fed — a write never busts the hot cache.
 */

import { TelemetryController, resetTelemetryStateForTests, sanitizeVideoReport } from './telemetry.controller';
import { screenTelemetrySchema } from './telemetry.schema';
import {
  expectedPlaybackEngine,
  ingestFilePlayback,
  recordFromRow,
  sanitizeMediaCaps,
  webviewMajorFromUserAgent,
  type FilePlaybackDb,
} from './file-playback';
import { MANIFEST_FED_MODELS, resetManifestCacheForTests, setManifestCache, shouldBumpManifestRev } from '../screens/manifest-hot-cache';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));
jest.mock('../screens/device-auth', () => ({ verifyDeviceForScreen: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const deviceAuth = require('../screens/device-auth') as { verifyDeviceForScreen: jest.Mock };

const SHA = 'a'.repeat(64);
const NOW = new Date('2026-10-11T20:00:00.000Z');

function fakeDb(over: { existing?: any; siblings?: number; build?: unknown } = {}) {
  let row: any = over.existing ?? null;
  const db = {
    $queryRaw: jest.fn(async () => [{ build: over.build ?? { manufacturer: 'rockchip', model: 'rk3288', sdk: 25 }, siblings: over.siblings ?? 0 }]),
    screenFilePlayback: {
      findUnique: jest.fn(async () => row),
      upsert: jest.fn(async (args: any) => {
        row = row ? { ...row, ...args.update } : { ...args.create };
        return { screenId: args.create.screenId };
      }),
    },
  };
  return { db: db as unknown as FilePlaybackDb & typeof db, current: () => row };
}

const sample = (over: Record<string, unknown> = {}) => ({
  url: 'https://cdn.example/clip-1080.mp4',
  sha256: SHA,
  totalFrames: 1800,
  droppedFrames: 900,
  stalls: 0,
  stalledMs: 0,
  width: 1080,
  height: 1668,
  cached: true,
  concurrent: 1,
  engine: 'continuous',
  ...over,
});

describe('ingestFilePlayback', () => {
  it('folds a digest-named sample into one row; tenant from the caller (the live row), class from build', async () => {
    const { db, current } = fakeDb({ siblings: 1 });
    const rec = await ingestFilePlayback(db, { screenId: 's1', tenantId: 't1', sample: sample() as any, playerVersionCode: 27, webviewMajor: 120, now: NOW });
    expect(rec).toMatchObject({ samples: 1, settledSamples: 1, unitConcurrentMax: 2, concurrentMax: 1 });
    const args = (db.screenFilePlayback.upsert as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ screenId_fileSha256: { screenId: 's1', fileSha256: SHA } });
    expect(args.create).toMatchObject({ screenId: 's1', fileSha256: SHA, tenantId: 't1', deviceClass: 'rockchip/rk3288/unknown/sdk25', playerVersionCode: 27, webviewMajor: 120, firstAt: NOW, lastAt: NOW });
    expect(typeof args.create.frames).toBe('bigint');
    expect(current().settledSamples).toBe(1);
  });

  it('three stuttering minutes with the other face playing video → stuttering at unit concurrency 2 (DH43)', async () => {
    const { db, current } = fakeDb({ siblings: 1 });
    for (let i = 0; i < 3; i += 1) {
      await ingestFilePlayback(db, { screenId: 's1', tenantId: 't1', sample: sample() as any, playerVersionCode: 27, webviewMajor: 120, now: NOW });
    }
    expect(recordFromRow(current())).toMatchObject({ verdict: 'stuttering', consecutiveBad: 3, unitConcurrentMax: 2, frames: 5400, dropped: 2700 });
  });

  it('an uncached sample is counted but never graded as decode stutter', async () => {
    const { db, current } = fakeDb();
    await ingestFilePlayback(db, { screenId: 's1', tenantId: 't1', sample: sample({ cached: false, stalls: 9, stalledMs: 30000 }) as any, playerVersionCode: null, webviewMajor: null, now: NOW });
    expect(recordFromRow(current())).toMatchObject({ samples: 1, settledSamples: 0, frames: 0, stalls: 0, verdict: 'insufficient' });
  });

  it('no digest or no tenant → no read, no write', async () => {
    const { db } = fakeDb();
    expect(await ingestFilePlayback(db, { screenId: 's1', tenantId: 't1', sample: sample({ sha256: undefined }) as any, playerVersionCode: null, webviewMajor: null, now: NOW })).toBeNull();
    expect(await ingestFilePlayback(db, { screenId: 's1', tenantId: null, sample: sample() as any, playerVersionCode: null, webviewMajor: null, now: NOW })).toBeNull();
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.screenFilePlayback.upsert).not.toHaveBeenCalled();
  });

  it('BigInt counters round-trip through recordFromRow', () => {
    expect(recordFromRow({ samples: 4, settledSamples: 3, frames: BigInt(5400), dropped: BigInt(3), stalls: 0, stalledMs: BigInt(0), consecutiveGood: 3, consecutiveBad: 0, concurrentMax: 1, unitConcurrentMax: 1, verdict: 'smooth' }))
      .toMatchObject({ frames: 5400, dropped: 3, verdict: 'smooth' });
    expect(recordFromRow(null)).toMatchObject({ samples: 0, verdict: 'insufficient' });
  });
});

/**
 * The demotion sample guard (2026-10-17, player rock-solid §4B). A sample in
 * the warm-up of a page load, an engine change, a hand-off or a player update,
 * or one the browser took of a file the hardware engine owns, is recorded and
 * never graded — so it can never move the visible-stutter streak toward a
 * demotion. M43 (2026-10-17) was one such minute away from its second one.
 */
describe('ingestFilePlayback — the demotion sample guard', () => {
  const MIN = 60_000;
  const at = (ms: number) => new Date(NOW.getTime() + ms);
  const bad = (over: Record<string, unknown> = {}) => sample({ totalFrames: 1580, droppedFrames: 184, elapsedMs: 60_000, ...over });
  const ingest = (db: FilePlaybackDb, s: unknown, now: Date, guard: Record<string, unknown> = {}, vc = 10140) =>
    ingestFilePlayback(db, { screenId: 's1', tenantId: 't1', sample: s as any, playerVersionCode: vc, webviewMajor: 101, now, guard });

  it('M43: two bad minutes, the nightly reload, a bad minute inside its warm-up → streak stays at 2', async () => {
    const { db, current } = fakeDb();
    const reload = at(2 * MIN + 30_000);
    let r = await ingest(db, bad(), at(0), { pageLoadAt: at(-60 * MIN) });
    expect(r).toMatchObject({ visibleClass: 'bad', visibleBadStreak: 1, excludedReason: null });
    r = await ingest(db, bad(), at(MIN), { pageLoadAt: at(-60 * MIN) });
    expect(r).toMatchObject({ visibleClass: 'bad', visibleBadStreak: 2 });
    // 11.6 % in the first minute after the page load: recorded, never graded.
    r = await ingest(db, bad(), at(3 * MIN + 31_000), { pageLoadAt: reload });
    expect(r).toMatchObject({ visibleClass: 'ignored', visibleBadStreak: 2, excludedReason: 'page-load', settledSamples: 2 });
    expect(current()).toMatchObject({ excludedReason: 'page-load', excludedAt: at(3 * MIN + 31_000), excludedSamples: 1, visibleBadStreak: 2, consecutiveBad: 2, samples: 3 });
    // A minute that STARTED inside the warm-up is still excluded…
    r = await ingest(db, bad(), at(6 * MIN), { pageLoadAt: reload });
    expect(r).toMatchObject({ excludedReason: 'page-load', visibleBadStreak: 2 });
    // …a real bad minute after it still counts — the feature stays.
    r = await ingest(db, bad(), at(7 * MIN), { pageLoadAt: reload });
    expect(r).toMatchObject({ visibleClass: 'bad', visibleBadStreak: 3, excludedReason: null });
    // The last exclusion stays on the row for the dashboard.
    expect(current()).toMatchObject({ excludedReason: 'page-load', excludedSamples: 2 });
  });

  it('an engine change opens a 3-minute window the next minutes of the file inherit', async () => {
    const { db, current } = fakeDb();
    await ingest(db, sample({ droppedFrames: 0, engine: 'native', elapsedMs: 60_000 }), at(0));
    const r1 = await ingest(db, bad({ engine: 'continuous' }), at(MIN));
    expect(r1).toMatchObject({ excludedReason: 'engine-change', visibleClass: 'ignored' });
    expect(current().excludedUntil).toEqual(at(3 * MIN)); // the new engine took over at +0:00 → +3:00
    const r2 = await ingest(db, bad({ engine: 'continuous' }), at(2 * MIN));
    expect(r2).toMatchObject({ excludedReason: 'engine-change', visibleBadStreak: 0 });
    const r3 = await ingest(db, bad({ engine: 'continuous' }), at(4 * MIN));
    expect(r3).toMatchObject({ excludedReason: null, visibleClass: 'bad', visibleBadStreak: 1 });
    expect(current()).toMatchObject({ excludedUntil: null, excludedSamples: 2 });
  });

  it('a native hand-off (new session) and a first-on-glass sample are hand-offs', async () => {
    const { db } = fakeDb();
    expect(await ingest(db, bad(), at(0), { nativeSessionChanged: true })).toMatchObject({ excludedReason: 'handoff', visibleClass: 'ignored' });
    expect(await ingest(db, bad({ first: true }), at(5 * MIN))).toMatchObject({ excludedReason: 'handoff' });
  });

  it('a player update between two samples of the file is excluded for 3 minutes', async () => {
    const { db } = fakeDb();
    await ingest(db, sample({ droppedFrames: 0, elapsedMs: 60_000 }), at(0), {}, 10139);
    expect(await ingest(db, bad(), at(MIN), {}, 10140)).toMatchObject({ excludedReason: 'player-update' });
    expect(await ingest(db, bad(), at(2 * MIN), {}, 10140)).toMatchObject({ excludedReason: 'player-update' });
    expect(await ingest(db, bad(), at(5 * MIN), {}, 10140)).toMatchObject({ excludedReason: null, visibleClass: 'bad' });
  });

  it('a screen the manifest hands the hardware engine never grades a browser sample of that file', async () => {
    const { db, current } = fakeDb();
    for (let i = 0; i < 5; i += 1) {
      const r = await ingest(db, bad(), at(i * MIN + 10 * MIN), { expectedEngine: 'native' });
      expect(r).toMatchObject({ excludedReason: 'fallback-engine', visibleClass: 'ignored', visibleBadStreak: 0 });
    }
    expect(recordFromRow(current())).toMatchObject({ samples: 5, settledSamples: 0, verdict: 'insufficient' });
    expect(current().excludedSamples).toBe(5);
  });

  it('no guard context grades exactly as before', async () => {
    const { db } = fakeDb();
    const r = await ingestFilePlayback(db, { screenId: 's1', tenantId: 't1', sample: bad() as any, playerVersionCode: 27, webviewMajor: 120, now: NOW });
    expect(r).toMatchObject({ visibleClass: 'bad', visibleBadStreak: 1, excludedReason: null, settledSamples: 1 });
  });
});

describe('expectedPlaybackEngine', () => {
  const OTHER = 'b'.repeat(64);
  const manifest = { nativeVideo: { version: 2, asset: { sha256: SHA } } };

  it('native whenever the manifest hands the hardware engine THIS file (owner rule: native is the target on every class)', () => {
    expect(expectedPlaybackEngine({ sha256: SHA, manifest, evidenceSha: null })).toBe('native');
    expect(expectedPlaybackEngine({ sha256: SHA.toUpperCase(), manifest, evidenceSha: null })).toBe('native');
    expect(expectedPlaybackEngine({ sha256: SHA, manifest: { nativeSharedVideo: { version: 1, asset: { sha256: SHA } } }, evidenceSha: null })).toBe('native');
  });

  it('web for another file, or a manifest without the engine — even when the APK reported this file before', () => {
    expect(expectedPlaybackEngine({ sha256: OTHER, manifest, evidenceSha: null })).toBe('web');
    expect(expectedPlaybackEngine({ sha256: SHA, manifest: { playlists: [] }, evidenceSha: SHA })).toBe('web');
  });

  it('with no cached manifest, the hardware engine\'s own report for this file is the evidence', () => {
    expect(expectedPlaybackEngine({ sha256: SHA, manifest: null, evidenceSha: SHA })).toBe('native');
    expect(expectedPlaybackEngine({ sha256: SHA, manifest: null, evidenceSha: OTHER })).toBe('web');
    expect(expectedPlaybackEngine({ sha256: SHA, manifest: null, evidenceSha: null })).toBe('web');
  });
});

describe('sanitizers', () => {
  it('sanitizeVideoReport keeps the new keys only when well-formed, never defaults them', () => {
    const out = sanitizeVideoReport({ url: 'u', totalFrames: 10, droppedFrames: 1, sha256: SHA.toUpperCase(), engine: 'deck', cached: true, first: false, concurrent: 2 });
    expect(out).toMatchObject({ sha256: SHA, engine: 'deck', cached: true, first: false, concurrent: 2 });
    const bare = sanitizeVideoReport({ url: 'u', totalFrames: 10, droppedFrames: 1, sha256: 'nope', engine: 'vlc' })!;
    expect('sha256' in bare || 'engine' in bare || 'cached' in bare || 'concurrent' in bare).toBe(false);
  });

  it('sanitizeMediaCaps: only the four canonical configs, each once, booleans only', () => {
    expect(sanitizeMediaCaps({ webviewMajor: 120.7, configs: [
      { id: '1080p30-landscape', supported: true, smooth: true, powerEfficient: 'yes' },
      { id: '1080p30-landscape', supported: false, smooth: false, powerEfficient: false },
      { id: 'evil', supported: true, smooth: true, powerEfficient: true },
    ] })).toEqual({ webviewMajor: 120, configs: [{ id: '1080p30-landscape', supported: true, smooth: true, powerEfficient: false }] });
    expect(sanitizeMediaCaps({ configs: [] })).toBeNull();
    expect(sanitizeMediaCaps(null)).toBeNull();
  });

  it('webviewMajorFromUserAgent', () => {
    expect(webviewMajorFromUserAgent('Mozilla/5.0 (Linux; Android 11; wv) AppleWebKit/537.36 Chrome/95.0.4638.74 Mobile Safari/537.36')).toBe(95);
    expect(webviewMajorFromUserAgent('Mozilla/5.0 (Macintosh) Safari/605.1.15')).toBeNull();
    expect(webviewMajorFromUserAgent(undefined)).toBeNull();
  });

  it('the strict telemetry schema accepts the new keys and still refuses garbage in them', () => {
    expect(screenTelemetrySchema.safeParse({
      video: { url: 'u', totalFrames: 1800, droppedFrames: 0, sha256: SHA, engine: 'continuous', cached: true, first: false, concurrent: 1 },
      mediaCaps: { webviewMajor: 95, configs: [{ id: '2160p30-portrait', supported: true, smooth: false, powerEfficient: false }] },
    }).success).toBe(true);
    expect(screenTelemetrySchema.safeParse({ video: { url: 'u', totalFrames: 1, droppedFrames: 0, engine: 'vlc' } }).success).toBe(false);
    expect(screenTelemetrySchema.safeParse({ mediaCaps: { configs: [{ id: '8k', supported: true, smooth: true, powerEfficient: true }] } }).success).toBe(false);
  });
});

describe('neither new model is manifest-fed', () => {
  it.each(['ScreenFilePlayback', 'ScreenMediaCapabilities'])('%s', (model) => {
    expect(MANIFEST_FED_MODELS.has(model)).toBe(false);
    expect(shouldBumpManifestRev(model, 'upsert', null)).toBe(false);
    expect(shouldBumpManifestRev(model, 'create', null)).toBe(false);
  });
});

describe('POST /screens/:id/telemetry → evidence', () => {
  let seq = 0;
  let screenId = '';
  let prisma: any;
  let controller: TelemetryController;
  const redis: any = { sismember: jest.fn(async () => false) };
  const req = { headers: { authorization: 'Bearer x', 'user-agent': 'Mozilla/5.0 (Linux; Android 11; wv) Chrome/95.0.1 Safari' } } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    screenId = `fp-screen-${++seq}`;
    resetManifestCacheForTests();
    resetTelemetryStateForTests();
    deviceAuth.verifyDeviceForScreen.mockResolvedValue({ ok: true, sub: screenId, screen: { id: screenId, tenantId: 'tenant-1' }, tenantId: 'tenant-1', token: 'x' });
    prisma = {
      client: {
        screen: {
          findUnique: jest.fn(async () => ({ id: screenId, tenantId: 'tenant-1', name: 'S', playerVersion: '1.1.26', playerVersionCode: 1126, managerVersion: null, forceApkUpdatePendingAt: null, pendingRefreshAt: null, lastOtaState: null, displayCapabilitiesAt: new Date(), lastVideoReport: null, faceIndex: null })),
          update: jest.fn(async () => ({ id: screenId })),
        },
        screenEvent: { create: jest.fn(async () => ({})) },
        $queryRaw: jest.fn(async () => [{ build: { manufacturer: 'Goodview', model: 'M65GUQ-BOP382D-C', sdk: 30 }, siblings: 0 }]),
        screenFilePlayback: { findUnique: jest.fn(async () => null), upsert: jest.fn(async () => ({})) },
        screenMediaCapabilities: { upsert: jest.fn(async () => ({})) },
      },
    };
    controller = new TelemetryController(prisma, redis);
  });

  it('a digest-named sample writes one evidence row; the Screen write stays telemetry-only', async () => {
    await controller.report(screenId, req, { video: sample({ droppedFrames: 0, width: 2160, height: 3338 }) });
    const up = prisma.client.screenFilePlayback.upsert.mock.calls[0][0];
    expect(up.create).toMatchObject({ screenId, tenantId: 'tenant-1', fileSha256: SHA, deviceClass: 'goodview/m65guq-bop382d-c/unknown/sdk30', webviewMajor: 95, playerVersionCode: 1126 });
    const keys = Object.keys(prisma.client.screen.update.mock.calls[0][0].data);
    expect(shouldBumpManifestRev('Screen', 'update', keys)).toBe(false);
  });

  it('a body without the new keys is handled exactly as before (no evidence write)', async () => {
    await controller.report(screenId, req, { video: { url: 'u', totalFrames: 1800, droppedFrames: 0 } });
    expect(prisma.client.screenFilePlayback.upsert).not.toHaveBeenCalled();
    expect(prisma.client.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.client.screen.update).toHaveBeenCalled();
  });

  it('mediaCaps lands in its own row, replaced whole', async () => {
    await controller.report(screenId, req, { mediaCaps: { configs: [{ id: '2160p30-portrait', supported: true, smooth: true, powerEfficient: true }] } });
    const up = prisma.client.screenMediaCapabilities.upsert.mock.calls[0][0];
    expect(up.where).toEqual({ screenId });
    expect(up.create).toMatchObject({ screenId, tenantId: 'tenant-1', webviewMajor: 95 });
  });

  it('an evidence failure never fails the report', async () => {
    prisma.client.screenFilePlayback.upsert.mockRejectedValue(new Error('db down'));
    prisma.client.screenMediaCapabilities.upsert.mockRejectedValue(new Error('db down'));
    await expect(controller.report(screenId, req, {
      video: sample(),
      mediaCaps: { configs: [{ id: '1080p30-landscape', supported: true, smooth: true, powerEfficient: true }] },
    })).resolves.toMatchObject({ ok: true });
  });

  describe('the demotion sample guard (2026-10-17)', () => {
    const evaluate = jest.fn(async () => ({ kind: 'none', why: 'below-threshold' }));
    const screenRow = (over: Record<string, unknown> = {}) => ({
      id: screenId, tenantId: 'tenant-1', name: 'M43', playerVersion: '1.1.40-field.1', playerVersionCode: 10140,
      managerVersion: null, forceApkUpdatePendingAt: null, pendingRefreshAt: null, lastOtaState: null,
      displayCapabilitiesAt: new Date(), lastVideoReport: null, faceIndex: null,
      credentialEpochRotatedAt: new Date(Date.now() - 6 * 60 * 60_000), ...over,
    });
    // Two bad minutes already on record: one more graded BAD minute reaches the threshold.
    const twoBad = { screenId: 'x', fileSha256: SHA, samples: 40, settledSamples: 40, frames: BigInt(60000), dropped: BigInt(3000),
      stalls: 0, stalledMs: BigInt(0), consecutiveGood: 0, consecutiveBad: 2, concurrentMax: 1, unitConcurrentMax: 1,
      verdict: 'hitching', engine: 'continuous', playerVersionCode: 10140, visibleBadStreak: 2, excludedSamples: 0 };
    const badMinute = () => sample({ totalFrames: 1580, droppedFrames: 184, elapsedMs: 60_377, width: 2160, height: 3338 });

    beforeEach(() => {
      evaluate.mockClear();
      controller = new TelemetryController(prisma, redis, { evaluate } as any);
      prisma.client.screenFilePlayback.findUnique.mockResolvedValue(twoBad);
    });

    it('control: a graded third bad minute reaches the closed loop', async () => {
      prisma.client.screen.findUnique.mockResolvedValue(screenRow());
      await controller.report(screenId, req, { video: badMinute() });
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect((evaluate.mock.calls[0] as any[])[0]).toMatchObject({ sampleClass: 'bad', visibleBadStreak: 3, excludedReason: null });
    });

    it('M43 shape: the minute after the nightly page load is recorded, never evaluated', async () => {
      prisma.client.screen.findUnique.mockResolvedValue(screenRow({ credentialEpochRotatedAt: new Date(Date.now() - 61_367) }));
      await controller.report(screenId, req, { video: badMinute() });
      expect(evaluate).not.toHaveBeenCalled();
      const up = prisma.client.screenFilePlayback.upsert.mock.calls[0][0];
      expect(up.update).toMatchObject({ excludedReason: 'page-load', excludedSamples: 1, visibleBadStreak: 2, consecutiveBad: 2 });
    });

    it('a browser minute of a file the manifest hands the hardware engine is never evaluated', async () => {
      prisma.client.screen.findUnique.mockResolvedValue(screenRow());
      setManifestCache(screenId, { kind: 'full', hashablePayload: { nativeVideo: { version: 2, asset: { sha256: SHA } } }, etag: 'e', boundaryAt: null }, 0);
      await controller.report(screenId, req, { video: badMinute() });
      expect(evaluate).not.toHaveBeenCalled();
      expect(prisma.client.screenFilePlayback.upsert.mock.calls[0][0].update).toMatchObject({ excludedReason: 'fallback-engine' });
    });

    it('…whatever the APK version: the descriptor alone names the intended engine (owner rule 2026-10-17)', async () => {
      prisma.client.screen.findUnique.mockResolvedValue(screenRow({ playerVersion: '1.1.23', playerVersionCode: 10123 }));
      prisma.client.screenFilePlayback.findUnique.mockResolvedValue({ ...twoBad, playerVersionCode: 10123 });
      setManifestCache(screenId, { kind: 'full', hashablePayload: { nativeVideo: { version: 2, asset: { sha256: SHA } } }, etag: 'e', boundaryAt: null }, 0);
      await controller.report(screenId, req, { video: badMinute() });
      expect(evaluate).not.toHaveBeenCalled();
      expect(prisma.client.screenFilePlayback.upsert.mock.calls[0][0].update).toMatchObject({ excludedReason: 'fallback-engine' });
    });

    it('a manifest without the hardware engine leaves the browser as the intended engine — graded as before', async () => {
      prisma.client.screen.findUnique.mockResolvedValue(screenRow());
      setManifestCache(screenId, { kind: 'full', hashablePayload: { playlists: [] }, etag: 'e', boundaryAt: null }, 0);
      await controller.report(screenId, req, { video: badMinute() });
      expect(evaluate).toHaveBeenCalledTimes(1);
    });

    it('a new hardware-engine session in the same report is a hand-off', async () => {
      prisma.client.screen.findUnique.mockResolvedValue(screenRow({
        lastVideoReport: { native: { sessionId: '11111111-1111-4111-8111-111111111111', sha256: 'c'.repeat(64) } },
      }));
      await controller.report(screenId, req, {
        video: badMinute(),
        nativeVideo: {
          version: 1, state: 'preparing', sessionId: '22222222-2222-4222-8222-222222222222', revision: 'r1',
          sha256: 'c'.repeat(64), faceIndex: 0,
        },
      });
      expect(evaluate).not.toHaveBeenCalled();
      expect(prisma.client.screenFilePlayback.upsert.mock.calls[0][0].update).toMatchObject({ excludedReason: 'handoff' });
    });
  });
});

describe('emergency is never evaluated by the playback capability (design §4.6)', () => {
  // Only the evidence ingest, the capability loader / read endpoint, the
  // publish gate (step 5) and the closed loop (steps 6/7) may touch the
  // capability functions. The emergency path and the manifest builder never
  // do — the manifest reads ONLY the demotion rows (playback-demotions.ts).
  // Widen this list deliberately — and never to an emergency file.
  it('only the sanctioned files use the capability functions', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path') as typeof import('path');
    const root = path.resolve(__dirname, '..');
    const allowed = new Set([
      'telemetry/file-playback.ts',
      'telemetry/playback-capability.controller.ts',
      'telemetry/playback-capability.loader.ts',
      'telemetry/playback-demotion.service.ts',
      'schedules/playback-gate.service.ts',
    ]);
    const uses = /\b(computePlaybackCapability|decidePlayback|decideStutterAction|foldPlaybackSample|ingestFilePlayback|loadPlaybackCapability|unitConcurrentVideos)\b/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) {
          const rel = path.relative(root, p).split(path.sep).join('/');
          if (!allowed.has(rel) && uses.test(fs.readFileSync(p, 'utf8').replace(/\/\/.*$/gm, ''))) offenders.push(rel);
        }
      }
    };
    walk(root);
    // telemetry.controller.ts calls ingestFilePlayback — the one sanctioned caller.
    expect(offenders).toEqual(['telemetry/telemetry.controller.ts']);
  });

  it('no emergency module imports the gate, the closed loop or the demotion read', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path') as typeof import('path');
    const dir = path.resolve(__dirname, '..', 'emergency');
    const bad = /playback-gate|playback-demotion|playback-demotions|playback-capability/;
    const offenders = fs.readdirSync(dir).filter((f) => /\.ts$/.test(f) && !/\.spec\.ts$/.test(f) && bad.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
