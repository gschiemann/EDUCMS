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
  ingestFilePlayback,
  recordFromRow,
  sanitizeMediaCaps,
  webviewMajorFromUserAgent,
  type FilePlaybackDb,
} from './file-playback';
import { MANIFEST_FED_MODELS, resetManifestCacheForTests, shouldBumpManifestRev } from '../screens/manifest-hot-cache';

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
