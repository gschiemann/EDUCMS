/**
 * The screen-ready gate — what `GET /screens/:id/manifest` hands a screen for a
 * video stamped NOT screen-ready (2026-10-05).
 *
 * `processingMeta.screen` says whether the file a video serves is something
 * every player decodes. Pinned here, against the REAL manifest handler:
 *
 *   1. NORMAL branch: a video stamped `ready: false` — still converting
 *      (`pending`), or its conversion failed — is LEFT OUT; no stamp or
 *      `ready: true` is delivered exactly as before (same body, same ETag).
 *   2. A playlist that loses EVERY item is byte-for-byte a playlist with no
 *      items (body AND ETag) — the state the approval gate already produces.
 *   3. EMERGENCY branch: an alert playlist holding a `ready: false` video is
 *      delivered UNCHANGED — alert media never reads the verdict.
 *   4. THE FLIP: the transcode's write (an `asset.updateMany` of
 *      `processingMeta` — the swap or a stamp) goes through the REAL Prisma
 *      mutation hook (`PrismaService.onModuleInit`), which busts the manifest
 *      hot cache; the next poll carries the converted file under a NEW ETag,
 *      with no publish. Negative control: with no write, the cached manifest
 *      answers 304.
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
const TENANT = 'tenant-gate';
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
    resolution: '1920x1080',
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

// ═══ 1. The normal branch leaves a not-ready video out ═══════════════════

describe('NORMAL manifest: a video stamped not screen-ready is left out', () => {
  it('ready:false (pending AND failed) are left out; no stamp and ready:true are delivered', async () => {
    const h = await makeHarness({
      assets: {
        legacy: asset('legacy'), // no stamp: every asset from before the verdict existed
        ready: asset('ready', { processingMeta: { screen: STAMP.ready } }),
        converting: asset('converting', { processingMeta: { screen: STAMP.pending } }),
        failed: asset('failed', { processingMeta: { screen: STAMP.failed } }),
        photo: asset('photo', { mimeType: 'image/png', fileUrl: `${SUPA}${TENANT}/photo.png` }),
      },
      playlists: [{ id: 'pl-lobby', name: 'Lobby', assetIds: ['legacy', 'converting', 'ready', 'failed', 'photo'] }],
    });
    const res = await poll(h);
    expect(res.statusCode).toBe(200);
    const [pl] = res.body.playlists;
    expect(pl.items.map((i: any) => i.asset_id)).toEqual(['legacy', 'ready', 'photo']);
    // The withheld files are nowhere in the payload — not even as a byte count.
    expect(JSON.stringify(res.body)).not.toContain('converting.mp4');
    expect(JSON.stringify(res.body)).not.toContain('failed.mp4');
    expect(pl.totalBytes).toBe(3 * 1_000_000);
  });

  it('NOTHING changes for a playlist with no stamp anywhere: same body, same ETag as a build that never had the gate', async () => {
    const world = (): World => ({
      assets: { a: asset('a'), b: asset('b', { processingMeta: { probe: { codec: 'h264' } } }) },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['a', 'b'] }],
    });
    const gated = await poll(await makeHarness(world()));
    expect(gated.body.playlists[0].items.map((i: any) => i.asset_id)).toEqual(['a', 'b']);
    // The same world with `ready: true` stamps reads identically.
    resetManifestCacheForTests();
    const stamped = world();
    stamped.assets.a.processingMeta = { screen: STAMP.ready };
    stamped.assets.b.processingMeta = { probe: { codec: 'h264' }, screen: STAMP.ready };
    const withReady = await poll(await makeHarness(stamped));
    expect(withReady.body.playlists[0].items).toEqual(gated.body.playlists[0].items);
  });

  it('a stamp the reader does not understand (another version) is UNKNOWN, so delivered — never an invented verdict', async () => {
    const h = await makeHarness({
      assets: { odd: asset('odd', { processingMeta: { screen: { version: 2, ready: false } } }) },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['odd'] }],
    });
    const res = await poll(h);
    expect(res.body.playlists[0].items.map((i: any) => i.asset_id)).toEqual(['odd']);
  });
});

// ═══ 2. All left out === an empty playlist ═══════════════════════════════

describe('a playlist whose every item is left out is EXACTLY a playlist with no items', () => {
  it('same body, same ETag — the schedule keeps its place, with items: []', async () => {
    const withheld = await poll(
      await makeHarness({
        assets: {
          hevc: asset('hevc', { processingMeta: { screen: STAMP.pending } }),
          broken: asset('broken', { processingMeta: { screen: STAMP.failed } }),
        },
        playlists: [{ id: 'pl-promo', name: 'Promo', assetIds: ['hevc', 'broken'] }],
      }),
    );
    resetManifestCacheForTests();
    const empty = await poll(
      await makeHarness({ assets: {}, playlists: [{ id: 'pl-promo', name: 'Promo', assetIds: [] }] }),
    );

    expect(withheld.statusCode).toBe(200);
    expect(withheld.body.playlists).toHaveLength(1);
    expect(withheld.body.playlists[0]).toMatchObject({ id: 'pl-promo', items: [], totalBytes: 0 });
    expect(stable(withheld.body)).toEqual(stable(empty.body));
    expect(withheld.headers.etag).toBe(empty.headers.etag);
    // NOT the "no schedule" body: the playlist is still this screen's scheduled content.
    expect(withheld.body.emptyReason).toBeUndefined();
  });
});

// ═══ 3. The emergency branch is untouched ═════════════════════════════════

describe('EMERGENCY manifest: alert media is delivered whatever its verdict', () => {
  it('a lockdown playlist holding a ready:false video is delivered unchanged', async () => {
    const h = await makeHarness({
      assets: {
        alertVideo: asset('alertVideo', { processingMeta: { screen: STAMP.pending } }),
        alertFailed: asset('alertFailed', { processingMeta: { screen: STAMP.failed } }),
      },
      playlists: [{ id: 'pl-lobby', name: 'Lobby', assetIds: ['alertVideo'] }],
      emergency: { playlistId: 'pl-lockdown', assetIds: ['alertVideo', 'alertFailed'] },
    });
    const res = await poll(h);
    expect(res.body.isEmergency).toBe(true);
    expect(res.body.playlists[0].id).toBe('pl-lockdown');
    expect(res.body.playlists[0].items.map((i: any) => i.url)).toEqual([
      `${SUPA}${TENANT}/alertVideo.mp4`,
      `${SUPA}${TENANT}/alertFailed.mp4`,
    ]);
  });

  it('NEGATIVE CONTROL: the same video in the same world without the alert is left out', async () => {
    const h = await makeHarness({
      assets: { alertVideo: asset('alertVideo', { processingMeta: { screen: STAMP.pending } }) },
      playlists: [{ id: 'pl-lobby', name: 'Lobby', assetIds: ['alertVideo'] }],
    });
    const res = await poll(h);
    expect(res.body.isEmergency).toBe(false);
    expect(res.body.playlists[0].items).toEqual([]);
  });
});

// ═══ 4. The flip reaches the screen on its next poll ═════════════════════

describe('the stamp flip busts the manifest cache and changes the ETag — no publish needed', () => {
  it('every write the transcode and the upload make to the verdict is one the hook busts on', () => {
    // markScreenReadiness / recordRendition / the settle step / the refused-enqueue settle:
    expect(shouldBumpManifestRev('Asset', 'updateMany', ['processingMeta'])).toBe(true);
    // the swap (video-transcode.pipeline.ts step 8):
    expect(
      shouldBumpManifestRev('Asset', 'updateMany', ['fileUrl', 'mimeType', 'fileSize', 'fileHash', 'processingMeta']),
    ).toBe(true);
    // the upload's create:
    expect(shouldBumpManifestRev('Asset', 'create', null)).toBe(true);
  });

  it('converting → converted: the next poll carries the converted file under a new ETag', async () => {
    const h = await makeHarness({
      assets: {
        intro: asset('intro', { processingMeta: { screen: STAMP.ready } }),
        hevc: asset('hevc', {
          fileUrl: `${SUPA}${TENANT}/phone-clip.mov`,
          mimeType: 'video/quicktime',
          fileHash: null,
          processingMeta: { probe: { codec: 'hevc' }, screen: STAMP.pending },
        }),
      },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['intro', 'hevc'] }],
    });

    // Poll 1 — still converting: left out; the manifest is cached under its ETag.
    const first = await poll(h);
    const etag1 = first.headers.etag;
    expect(first.body.playlists[0].items.map((i: any) => i.asset_id)).toEqual(['intro']);
    expect(getManifestCache(SCREEN)).toBeDefined();

    // NEGATIVE CONTROL — nothing written: the cache answers, the screen gets a 304.
    const unchanged = await poll(h, etag1);
    expect(unchanged.statusCode).toBe(304);
    expect(h.client.schedule.findMany).toHaveBeenCalledTimes(1); // served from the cache

    // The transcode's swap, exactly as video-transcode.pipeline.ts writes it —
    // through prisma.client, i.e. through the production mutation hook.
    const rev = currentManifestContentRev();
    const converted = `${SUPA}${TENANT}/optimized/0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.mp4`;
    await h.client.asset.updateMany({
      where: { id: 'hevc', tenantId: TENANT, fileUrl: `${SUPA}${TENANT}/phone-clip.mov` },
      data: {
        fileUrl: converted,
        mimeType: 'video/mp4',
        fileSize: 4_000_000,
        fileHash: HASH('c'),
        processingMeta: {
          transcode: { codecIn: 'hevc', profile: '2160p' },
          screen: { version: 1, ready: true, convertedFrom: ['codec', 'pixel-format', 'hdr'], checkedAt: '2026-10-05T09:07:00.000Z' },
        },
      },
    });
    expect(currentManifestContentRev()).toBe(rev + 1);
    expect(getManifestCache(SCREEN)).toBeUndefined();

    // Poll 2 — with the OLD ETag: a full 200, the converted file in it, a new ETag.
    const second = await poll(h, etag1);
    expect(second.statusCode).toBe(200);
    expect(second.headers.etag).not.toBe(etag1);
    const item = second.body.playlists[0].items.find((i: any) => i.asset_id === 'hevc');
    expect(item).toMatchObject({ url: converted, asset_hash: HASH('c'), mime_type: 'video/mp4' });
    expect(second.body.playlists[0].contentRev).not.toBe(first.body.playlists[0].contentRev);
  });

  it('converting → FAILED (a stamp-only write) also busts, and the screen keeps not being handed the file', async () => {
    const h = await makeHarness({
      assets: { hevc: asset('hevc', { processingMeta: { screen: STAMP.pending } }) },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['hevc'] }],
    });
    const first = await poll(h);
    expect(first.body.playlists[0].items).toEqual([]);
    const rev = currentManifestContentRev();
    await h.client.asset.updateMany({
      where: { id: 'hevc', tenantId: TENANT, fileUrl: `${SUPA}${TENANT}/hevc.mp4` },
      data: { processingMeta: { screen: STAMP.failed } },
    });
    expect(currentManifestContentRev()).toBe(rev + 1);
    const second = await poll(h, first.headers.etag);
    // Same content (still nothing to play) — the rebuild proves it: 304 on the same ETag.
    expect(h.client.schedule.findMany).toHaveBeenCalledTimes(2);
    expect(second.statusCode).toBe(304);
  });

  it('a video already on screens that is flipped to not-ready leaves on the next poll', async () => {
    const h = await makeHarness({
      assets: { clip: asset('clip', { processingMeta: { screen: STAMP.ready } }) },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['clip'] }],
    });
    const first = await poll(h);
    expect(first.body.playlists[0].items).toHaveLength(1);
    await h.client.asset.updateMany({
      where: { id: 'clip', tenantId: TENANT },
      data: { processingMeta: { screen: STAMP.failed } },
    });
    const second = await poll(h, first.headers.etag);
    expect(second.statusCode).toBe(200);
    expect(second.body.playlists[0].items).toEqual([]);
    expect(second.headers.etag).not.toBe(first.headers.etag);
  });
});
