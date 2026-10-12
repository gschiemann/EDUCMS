/**
 * Video guarantee steps 6/7 (2026-10-12, owner decision A) — what the REAL
 * manifest handler hands a screen with an active playback DEMOTION.
 *
 *   1. No demotion anywhere: body and ETag are byte-for-byte what a build with
 *      no demotion table at all produces (unaffected screens never move).
 *   2. A demoted 4K screen gets the validated 1080p copy of THAT file — URL,
 *      hash and size as one unit; other files keep their original.
 *   3. A demotion whose file has no valid copy changes nothing.
 *   4. Creating / clearing a demotion goes through the production Prisma
 *      mutation hook (the model is manifest-fed): the cache busts, the next
 *      poll is a 200 under a new ETag. Negative control: no write → 304.
 *   5. EMERGENCY branch: an alert playlist holding a demoted file is
 *      delivered with its ORIGINAL file — the emergency branch never reads
 *      demotions.
 */
import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import {
  currentManifestContentRev,
  getManifestCache,
  resetManifestCacheForTests,
  shouldBumpManifestRev,
} from './manifest-hot-cache';
import { resetEmergencyRevForTests } from './emergency-rev';
import { invalidateDeviceCredentialCache, setDeviceCredentialSharedStore } from './device-auth';
import { clearDisplayManifestCache } from '../display/display-manifest';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const TENANT = 'tenant-demote';
const SCREEN = 'screen-lobby';
const SUPA = 'https://example.supabase.co/storage/v1/object/public/assets/';
const HASH = (c: string) => c.repeat(64).slice(0, 64);

let nowMs = 1_790_000_000_000;
beforeAll(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});
afterAll(() => {
  jest.restoreAllMocks();
});

type Row = Record<string, any>;

const STAMP = {
  ready: { version: 1, ready: true, checkedAt: '2026-10-05T09:00:00.000Z' },
  pending: {
    version: 1,
    ready: false,
    pending: true,
    issues: ['codec', 'pixel-format', 'hdr'],
    checkedAt: '2026-10-05T09:00:00.000Z',
  },
  failed: {
    version: 1,
    ready: false,
    issues: ['codec'],
    error: 'ffmpeg-failed',
    checkedAt: '2026-10-05T09:00:00.000Z',
  },
};

function asset(id: string, over: Row = {}): Row {
  return {
    id,
    tenantId: TENANT,
    fileUrl: `${SUPA}${TENANT}/${id}.mp4`,
    mimeType: 'video/mp4',
    fileSize: 1_000_000,
    fileHash: HASH('a'),
    status: 'PUBLISHED',
    processingMeta: null,
    ...over,
  };
}

interface World {
  assets: Record<string, Row>;
  /** Normal schedules: one playlist each, its items by asset id. */
  playlists: Array<{ id: string; name: string; assetIds: string[] }>;
  emergency?: { playlistId: string; assetIds: string[] };
  /** Rows of screen_playback_demotions. Undefined = a client with NO such model (pre-feature). */
  demotions?: Row[];
  resolution?: string;
}

/**
 * A fake database behind a REAL PrismaService: `onModuleInit` installs the
 * production `$use` mutation hook on it, and the fake routes Asset writes
 * through that hook exactly as Prisma's middleware chain does.
 */
async function makeHarness(world: World) {
  let middleware: ((params: any, next: (p: any) => Promise<any>) => Promise<any>) | null = null;
  const viaHook =
    (model: string, action: string, impl: (args: any) => Promise<any>) =>
    (args: any) =>
      middleware ? middleware({ model, action, args }, (p: any) => impl(p.args)) : impl(args);

  const screenRow: Row = {
    id: SCREEN,
    tenantId: TENANT,
    screenGroupId: null,
    status: 'ONLINE',
    name: 'Lobby',
    orientation: 'LANDSCAPE',
    resolution: world.resolution ?? '3840x2160',
    canvasW: null,
    canvasH: null,
    repeats: 1,
    config: null,
    hardwareModel: null,
    displayCapabilities: null,
    activeBoardGameId: null,
    syncOffsetMs: 0,
    pendingRefreshAt: null,
    credentialEpoch: 0,
    credentialEpochRotatedAt: null,
    faceOfScreenId: null,
    faceIndex: null,
    faceContentMode: null,
  };

  const itemsOf = (assetIds: string[]) =>
    assetIds.map((assetId, i) => ({
      id: `item-${assetId}`,
      assetId,
      durationMs: 10_000,
      sequenceOrder: i,
      transitionType: null,
      muted: true,
      // A COPY: the manifest must see the row as it is at read time.
      asset: { ...world.assets[assetId] },
    }));

  const client: Record<string, any> = {
    $use: (fn: any) => {
      middleware = fn;
    },
    $connect: async () => undefined,
    $executeRawUnsafe: async () => 0,
    $transaction: async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg)),
    asset: {
      updateMany: jest.fn(
        viaHook('Asset', 'updateMany', async ({ where, data }: any) => {
          const row = world.assets[where.id];
          if (!row || row.tenantId !== where.tenantId) return { count: 0 };
          if (where.fileUrl !== undefined && where.fileUrl !== row.fileUrl) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      ),
    },
    screen: {
      findUnique: jest.fn(async (args: any) => (args?.where?.id === SCREEN ? screenRow : null)),
      update: jest.fn(async () => ({ id: SCREEN })),
      findMany: jest.fn(async () => []),
    },
    screenGroup: { findUnique: jest.fn(async () => null) },
    tenant: {
      findUnique: jest.fn(async (args: any) => {
        if (args?.select?.emergencyStatus) {
          const active = !!world.emergency;
          return {
            id: TENANT,
            parentId: null,
            archivedAt: null,
            emergencyStatus: active ? 'CRITICAL' : 'INACTIVE',
            emergencyType: active ? 'LOCKDOWN' : null,
            emergencyPlaylistId: world.emergency?.playlistId ?? null,
            emergencyPortraitPlaylistId: null,
            locationBasedEmergencyEnabled: false,
          };
        }
        return { name: 'Riverside', posterStandardW: null, posterStandardH: null };
      }),
    },
    screenEmergencyOverride: { findUnique: jest.fn(async () => null) },
    game: { findFirst: jest.fn(async () => null) },
    playlist: {
      findUnique: jest.fn(async (args: any) =>
        world.emergency && args?.where?.id === world.emergency.playlistId
          ? { id: world.emergency.playlistId, name: 'Lockdown', items: itemsOf(world.emergency.assetIds) }
          : null,
      ),
    },
    schedule: {
      findMany: jest.fn(async () =>
        world.playlists.map((p, i) => ({
          id: `sch-${p.id}`,
          playlistId: p.id,
          screenId: SCREEN,
          screenGroupId: null,
          priority: 0,
          mode: 'replace',
          startTime: new Date(nowMs - 60_000 - i),
          endTime: null,
          daysOfWeek: null,
          timeStart: null,
          timeEnd: null,
          mutedOverride: null,
          playlist: { id: p.id, name: p.name, template: null, syncPlayback: false, items: itemsOf(p.assetIds) },
        })),
      ),
      findFirst: jest.fn(async () => null),
    },
    ...(world.demotions
      ? {
          screenPlaybackDemotion: {
            findMany: jest.fn(async ({ where }: any) =>
              world.demotions!.filter(
                (d) => d.screenId === where.screenId && d.tenantId === where.tenantId && (where.clearedAt === null ? !d.clearedAt : true),
              ),
            ),
            create: jest.fn(
              viaHook('ScreenPlaybackDemotion', 'create', async ({ data }: any) => {
                const row = { id: `dem-${world.demotions!.length + 1}`, clearedAt: null, ...data };
                world.demotions!.push(row);
                return row;
              }),
            ),
            updateMany: jest.fn(
              viaHook('ScreenPlaybackDemotion', 'updateMany', async ({ where, data }: any) => {
                let count = 0;
                for (const d of world.demotions!) {
                  if (d.id === where.id && d.tenantId === where.tenantId && !d.clearedAt) {
                    Object.assign(d, data);
                    count += 1;
                  }
                }
                return { count };
              }),
            ),
          },
        }
      : {}),
    displaySchedule: { findMany: jest.fn(async () => []) },
    displayVendorRecipe: { findMany: jest.fn(async () => []) },
    auditLog: { create: jest.fn(async () => ({})) },
  };

  // The PRODUCTION hook, installed by the production lifecycle method. Its
  // 5-second connect guard is a plain setTimeout; unref it so the suite exits.
  const prismaService = new PrismaService();
  (prismaService as any).client = client;
  const realSetTimeout = global.setTimeout;
  const unref = jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any, ms?: number, ...rest: any[]) => {
    const timer = realSetTimeout(fn, ms, ...rest);
    (timer as any).unref?.();
    return timer;
  }) as any);
  try {
    await prismaService.onModuleInit();
  } finally {
    unref.mockRestore();
  }
  expect(middleware).not.toBeNull();

  const redis = {
    isConnected: () => false,
    getString: jest.fn(async () => null),
    setString: jest.fn(async () => true),
    delKey: jest.fn(async () => true),
    publish: jest.fn(async () => undefined),
  };
  const controller = new ScreensController(
    prismaService as any,
    redis as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { controller, client, world };
}

function makeRes() {
  const res: any = { statusCode: null, body: undefined, headers: {} };
  res.setHeader = (k: string, v: string) => {
    res.headers[k.toLowerCase()] = v;
    return res;
  };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (p: any) => {
    res.body = p;
    return res;
  };
  res.send = () => res;
  res.end = () => res;
  return res;
}

function makeReq(ifNoneMatch?: string) {
  return {
    headers: {
      authorization: `Bearer ${jwt.sign({ sub: SCREEN, kind: 'device', ep: 0, fp: 'fp-test' }, DEVICE_JWT_SECRET, {
        expiresIn: '180d',
      })}`,
      ...(ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {}),
    },
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
    user: { id: SCREEN, sub: SCREEN, kind: 'device', tenantId: TENANT },
  } as any;
}

async function poll(h: Awaited<ReturnType<typeof makeHarness>>, ifNoneMatch?: string) {
  const res = makeRes();
  await h.controller.getManifest(SCREEN, makeReq(ifNoneMatch), res as any);
  return res;
}

/** The body with its one per-request field removed, for whole-body comparisons. */
const stable = (body: any) => {
  const { generatedAt: _ts, ...rest } = body;
  return rest;
};

beforeEach(() => {
  nowMs += 3_600_000; // monotonic: TTL caches must never see a rewound clock
  resetManifestCacheForTests();
  resetEmergencyRevForTests();
  clearDisplayManifestCache();
  invalidateDeviceCredentialCache();
  setDeviceCredentialSharedStore(null);
});

const SRC = HASH('a');
const COPY = { url: 'https://example.supabase.co/storage/v1/object/public/assets/tenant-demote/r/1080.mp4', sha256: HASH('b'), size: 4_000_000, width: 1920, height: 1080 };
const fourK = (id: string, over: Row = {}) =>
  asset(id, { fileSize: 40_000_000, processingMeta: { processedDimensions: { w: 3840, h: 2160 }, renditions: { '1080p': COPY } }, ...over });
const demotion = (over: Row = {}): Row => ({ id: 'dem-1', tenantId: TENANT, screenId: SCREEN, sourceSha256: SRC, clearedAt: null, ...over });

describe('no demotion → nothing changes', () => {
  it('same body and ETag as a client with no demotion model at all', async () => {
    const world = (demotions?: Row[]): World => ({
      assets: { clip: fourK('clip'), other: fourK('other', { fileHash: HASH('d') }) },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['clip', 'other'] }],
      demotions,
    });
    const before = await poll(await makeHarness(world(undefined)));
    resetManifestCacheForTests();
    const withTable = await poll(await makeHarness(world([])));
    resetManifestCacheForTests();
    const otherScreen = await poll(await makeHarness(world([demotion({ screenId: 'some-other-screen' })])));
    expect(stable(withTable.body)).toEqual(stable(before.body));
    expect(withTable.headers.etag).toBe(before.headers.etag);
    expect(otherScreen.headers.etag).toBe(before.headers.etag);
    // a 4K screen with no demotion plays the ORIGINAL (no stand-in)
    expect(before.body.playlists[0].items[0]).toMatchObject({ url: `${SUPA}${TENANT}/clip.mp4`, asset_hash: SRC, asset_size: 40_000_000 });
  });
});

describe('a demoted 4K screen', () => {
  it('gets the validated 1080p copy of THAT file only — URL, hash and size together', async () => {
    const res = await poll(await makeHarness({
      assets: { clip: fourK('clip'), other: fourK('other', { fileHash: HASH('d') }) },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['clip', 'other'] }],
      demotions: [demotion()],
    }));
    const [clip, other] = res.body.playlists[0].items;
    expect(clip).toMatchObject({ url: COPY.url, asset_hash: COPY.sha256, asset_size: COPY.size, item_id: 'item-clip' });
    expect(other).toMatchObject({ url: `${SUPA}${TENANT}/other.mp4`, asset_hash: HASH('d') });
    expect(res.body.playlists[0].totalBytes).toBe(COPY.size + 40_000_000);
  });

  it('a cleared demotion, or one for a file with no valid copy, changes nothing', async () => {
    const cleared = await poll(await makeHarness({
      assets: { clip: fourK('clip') },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['clip'] }],
      demotions: [demotion({ clearedAt: new Date() })],
    }));
    expect(cleared.body.playlists[0].items[0].url).toBe(`${SUPA}${TENANT}/clip.mp4`);
    resetManifestCacheForTests();
    const noCopy = await poll(await makeHarness({
      assets: { clip: asset('clip', { processingMeta: { renditions: { '1080p': { url: 'http://insecure/x.mp4', sha256: 'zz', size: 0 } } } }) },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['clip'] }],
      demotions: [demotion()],
    }));
    expect(noCopy.body.playlists[0].items[0].url).toBe(`${SUPA}${TENANT}/clip.mp4`);
  });

  it('creating and clearing a demotion busts the cache through the production hook; no write → 304', async () => {
    const h = await makeHarness({
      assets: { clip: fourK('clip') },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['clip'] }],
      demotions: [],
    });
    const first = await poll(h);
    expect(first.body.playlists[0].items[0].url).toBe(`${SUPA}${TENANT}/clip.mp4`);
    const unchanged = await poll(h, first.headers.etag);
    expect(unchanged.statusCode).toBe(304);

    const rev = currentManifestContentRev();
    await h.client.screenPlaybackDemotion.create({ data: { tenantId: TENANT, screenId: SCREEN, sourceSha256: SRC, fromRung: 'native', toRung: '1080p', reason: 'visible-stutter' } });
    expect(currentManifestContentRev()).toBe(rev + 1);
    const demoted = await poll(h, first.headers.etag);
    expect(demoted.statusCode).toBe(200);
    expect(demoted.headers.etag).not.toBe(first.headers.etag);
    expect(demoted.body.playlists[0].items[0].url).toBe(COPY.url);

    await h.client.screenPlaybackDemotion.updateMany({ where: { id: 'dem-1', tenantId: TENANT, clearedAt: null }, data: { clearedAt: new Date() } });
    const restored = await poll(h, demoted.headers.etag);
    expect(restored.statusCode).toBe(200);
    expect(restored.body.playlists[0].items[0].url).toBe(`${SUPA}${TENANT}/clip.mp4`);
    expect(restored.headers.etag).toBe(first.headers.etag);
  });

  it('the hook treats the model as manifest-fed', () => {
    expect(shouldBumpManifestRev('ScreenPlaybackDemotion', 'create', null)).toBe(true);
    expect(shouldBumpManifestRev('ScreenPlaybackDemotion', 'updateMany', ['clearedAt', 'clearedByUserId'])).toBe(true);
    // the per-file evidence row stays telemetry: never busts
    expect(shouldBumpManifestRev('ScreenFilePlayback', 'updateMany', ['visibleBadStreak'])).toBe(false);
  });
});

describe('EMERGENCY manifest never reads demotions', () => {
  it('an alert playlist holding a demoted file is delivered with its ORIGINAL file', async () => {
    const h = await makeHarness({
      assets: { clip: fourK('clip') },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['clip'] }],
      emergency: { playlistId: 'pl-lockdown', assetIds: ['clip'] },
      demotions: [demotion()],
    });
    const res = await poll(h);
    expect(res.body.isEmergency).toBe(true);
    expect(res.body.playlists[0].items.map((i: any) => i.url)).toEqual([`${SUPA}${TENANT}/clip.mp4`]);
    expect(h.client.screenPlaybackDemotion.findMany).not.toHaveBeenCalled();
  });
});
