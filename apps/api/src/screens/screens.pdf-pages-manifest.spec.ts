/**
 * PDF pages in the manifest — what `GET /screens/:id/manifest` hands a screen
 * for a PDF item (2026-10-05, media beta test M2-02 / L3).
 *
 * Android players have no PDF viewer, so a PDF with pages
 * (`processingMeta.pdfPages`, storage/pdf-pages) is handed to screens as one
 * IMAGE item per page. Pinned here against the REAL manifest handler:
 *
 *   1. NORMAL branch, ready: one item per page — ids `${item}#p<n>`, the same
 *      asset id, the frame of the screen's orientation (1080 frame on a 1080p
 *      screen), the item's duration on EVERY page, image/webp.
 *   2. Pending, or a NEW PDF whose pages failed: left out. A PDF with no record
 *      (uploaded before pages existed), or a LEGACY one whose pages failed: as
 *      before — the PDF itself, byte-for-byte.
 *   3. THE FLIP: the pages' write busts the hot cache through the real Prisma
 *      hook; the next poll carries the pages under a new ETag. Negative control:
 *      no write → 304.
 *   4. EMERGENCY branch: an alert playlist holding a PDF is delivered unchanged.
 */
import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import {
  currentManifestContentRev,
  getManifestCache,
  resetManifestCacheForTests,
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
const TENANT = 'tenant-pdf';
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

function asset(id: string, over: Row = {}): Row {
  return {
    id,
    tenantId: TENANT,
    fileUrl: `${SUPA}${TENANT}/${id}.png`,
    mimeType: 'image/png',
    fileSize: 1_000_000,
    fileHash: HASH('a'),
    status: 'PUBLISHED',
    processingMeta: null,
    ...over,
  };
}

const BASE = `${SUPA}${TENANT}/pdf-pages/doc/k1/`;
const FRAME_HASH: Record<string, string> = { landscape: 'b', 'landscape-1080': 'c', portrait: 'd', 'portrait-1080': 'e' };
function pagesRecord(pages: number, over: Row = {}): Row {
  return {
    version: 1,
    state: 'ready',
    count: pages,
    base: BASE,
    pages: Array.from({ length: pages }, (_, i) => ({
      n: i + 1,
      w: 2160,
      h: 2795,
      frames: Object.fromEntries(
        Object.entries(FRAME_HASH).map(([k, c]) => [k, { sha256: HASH(String(i + 1) + c).replace(/[^0-9a-f]/g, 'f').slice(0, 64), size: 1000 * (i + 1) + k.length }]),
      ),
    })),
    updatedAt: '2026-10-05T10:00:00.000Z',
    ...over,
  };
}
function pdf(id: string, pdfPages: Row | null, over: Row = {}): Row {
  return asset(id, {
    fileUrl: `${SUPA}${TENANT}/${id}.pdf`,
    mimeType: 'application/pdf',
    fileSize: 200_000,
    processingMeta: pdfPages ? { pdfPages } : null,
    ...over,
  });
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
async function makeHarness(world: World, screenOver: Row = {}) {
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
    ...screenOver,
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


describe('NORMAL manifest: a PDF with pages is one picture per page', () => {
  it('ids, asset, frame, hash, size, duration and type — on a 1080p landscape screen', async () => {
    const h = await makeHarness({
      assets: { photo: asset('photo'), doc: pdf('doc', pagesRecord(3)), clip: asset('clip', { mimeType: 'video/mp4', fileUrl: `${SUPA}${TENANT}/clip.mp4` }) },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['photo', 'doc', 'clip'] }],
    });
    const res = await poll(h);
    expect(res.statusCode).toBe(200);
    const items = res.body.playlists[0].items;
    expect(items.map((i: any) => i.item_id)).toEqual([
      'item-photo', 'item-doc#p1', 'item-doc#p2', 'item-doc#p3', 'item-clip',
    ]);
    const page2 = items[2];
    expect(page2).toEqual({
      item_id: 'item-doc#p2',
      asset_id: 'doc',
      asset_hash: pagesRecord(3).pages[1].frames['landscape-1080'].sha256,
      asset_size: pagesRecord(3).pages[1].frames['landscape-1080'].size,
      url: `${BASE}p2-landscape-1080.webp`,
      duration_ms: 10_000,
      sequence: 1,
      mime_type: 'image/webp',
      transition_type: null,
      muted: true,
    });
    // Every page gets the item's duration — "10 seconds per page".
    expect(items.slice(1, 4).map((i: any) => i.duration_ms)).toEqual([10_000, 10_000, 10_000]);
    // The PDF itself is nowhere in the payload.
    expect(JSON.stringify(res.body)).not.toContain('doc.pdf');
    // totalBytes counts the frames this screen downloads, not the PDF.
    const pageBytes = pagesRecord(3).pages.reduce((s: number, p: any) => s + p.frames['landscape-1080'].size, 0);
    expect(res.body.playlists[0].totalBytes).toBe(2 * 1_000_000 + pageBytes);
  });

  it.each([
    ['a 4K landscape screen', { resolution: '3840x2160', orientation: 'LANDSCAPE' }, 'landscape'],
    ['a 4K portrait panel (AUTO, 2160x3840)', { resolution: '2160x3840', orientation: 'AUTO' }, 'portrait'],
    ['a 1080 panel mounted portrait (PORTRAIT, 1920x1080)', { resolution: '1920x1080', orientation: 'PORTRAIT' }, 'portrait-1080'],
    ['a pinned LED poster canvas 320x1080', { resolution: '1920x1080', orientation: 'AUTO', canvasW: 320, canvasH: 1080 }, 'portrait-1080'],
    ['a screen that never reported its size', { resolution: null, orientation: 'LANDSCAPE' }, 'landscape'],
  ])('%s is handed the %s frame… (%s)', async (_label, screen, frame) => {
    const h = await makeHarness(
      { assets: { doc: pdf('doc', pagesRecord(2)) }, playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['doc'] }] },
      screen,
    );
    const res = await poll(h);
    expect(res.body.playlists[0].items.map((i: any) => i.url)).toEqual([
      `${BASE}p1-${frame}.webp`,
      `${BASE}p2-${frame}.webp`,
    ]);
    expect(res.body.playlists[0].items[0].asset_hash).toBe(pagesRecord(2).pages[0].frames[frame].sha256);
  });

  it('shows the first N of a capped document (the record carries only what was made)', async () => {
    const h = await makeHarness({
      assets: { doc: pdf('doc', pagesRecord(2, { count: 214, truncatedAt: 2 })) },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['doc'] }],
    });
    const res = await poll(h);
    expect(res.body.playlists[0].items).toHaveLength(2);
  });
});

describe('NORMAL manifest: a PDF without ready pages', () => {
  it('pending and a NEW failure are left out; no record and a LEGACY failure are the PDF, as before', async () => {
    const h = await makeHarness({
      assets: {
        preparing: pdf('preparing', { version: 1, state: 'pending', count: 12, done: 7, updatedAt: 'x' }),
        broken: pdf('broken', { version: 1, state: 'failed', error: 'pdf-unreadable', updatedAt: 'x' }),
        old: pdf('old', null),
        oldBroken: pdf('oldBroken', { version: 1, state: 'failed', error: 'page-render-failed', legacy: true, updatedAt: 'x' }),
        halfWritten: pdf('halfWritten', pagesRecord(2, { base: 'http://not-https/' })),
      },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['preparing', 'broken', 'old', 'oldBroken', 'halfWritten'] }],
    });
    const res = await poll(h);
    const items = res.body.playlists[0].items;
    expect(items.map((i: any) => i.asset_id)).toEqual(['old', 'oldBroken']);
    expect(items[0]).toMatchObject({ item_id: 'item-old', url: `${SUPA}${TENANT}/old.pdf`, mime_type: 'application/pdf' });
    expect(JSON.stringify(res.body)).not.toContain('preparing.pdf');
    expect(JSON.stringify(res.body)).not.toContain('broken.pdf"');
  });

  it('a PDF with no record changes NOTHING: same body and ETag as before pages existed', async () => {
    const world = (): World => ({
      assets: { old: pdf('old', null), photo: asset('photo') },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['old', 'photo'] }],
    });
    const first = await poll(await makeHarness(world()));
    resetManifestCacheForTests();
    // A record of another version reads as "no record" — identical payload.
    const w2 = world();
    w2.assets.old.processingMeta = { pdfPages: { version: 2, state: 'ready' } };
    const second = await poll(await makeHarness(w2));
    expect(stable(second.body)).toEqual(stable(first.body));
    expect(second.headers.etag).toBe(first.headers.etag);
    expect(first.body.playlists[0].items[0]).toMatchObject({ url: `${SUPA}${TENANT}/old.pdf`, mime_type: 'application/pdf' });
  });
});

describe('the pages write busts the manifest cache — no publish needed', () => {
  it('pending → ready: the next poll carries the pages under a new ETag', async () => {
    const h = await makeHarness({
      assets: { photo: asset('photo'), doc: pdf('doc', { version: 1, state: 'pending', updatedAt: 'x' }) },
      playlists: [{ id: 'pl', name: 'Lobby', assetIds: ['photo', 'doc'] }],
    });
    const first = await poll(h);
    expect(first.body.playlists[0].items.map((i: any) => i.asset_id)).toEqual(['photo']);
    expect(getManifestCache(SCREEN)).toBeDefined();

    // NEGATIVE CONTROL — nothing written: served from the cache, 304.
    const unchanged = await poll(h, first.headers.etag);
    expect(unchanged.statusCode).toBe(304);
    expect(h.client.schedule.findMany).toHaveBeenCalledTimes(1);

    // The pages service's final write, exactly as it writes it: through
    // prisma.client (the production mutation hook), guarded by the file URL.
    const rev = currentManifestContentRev();
    await h.client.asset.updateMany({
      where: { id: 'doc', tenantId: TENANT, fileUrl: `${SUPA}${TENANT}/doc.pdf` },
      data: { processingMeta: { pdfPages: pagesRecord(2) } },
    });
    expect(currentManifestContentRev()).toBe(rev + 1);
    expect(getManifestCache(SCREEN)).toBeUndefined();

    const second = await poll(h, first.headers.etag);
    expect(second.statusCode).toBe(200);
    expect(second.headers.etag).not.toBe(first.headers.etag);
    expect(second.body.playlists[0].items.map((i: any) => i.item_id)).toEqual(['item-photo', 'item-doc#p1', 'item-doc#p2']);
    expect(second.body.playlists[0].contentRev).not.toBe(first.body.playlists[0].contentRev);
  });
});

describe('EMERGENCY manifest: alert media never reads the pages record', () => {
  it('a lockdown playlist holding a PDF with ready pages is delivered unchanged — the PDF itself', async () => {
    const h = await makeHarness({
      assets: { notice: pdf('notice', pagesRecord(2)), preparing: pdf('preparing', { version: 1, state: 'pending', updatedAt: 'x' }) },
      playlists: [{ id: 'pl-lobby', name: 'Lobby', assetIds: ['notice'] }],
      emergency: { playlistId: 'pl-lockdown', assetIds: ['notice', 'preparing'] },
    });
    const res = await poll(h);
    expect(res.body.isEmergency).toBe(true);
    expect(res.body.playlists[0].id).toBe('pl-lockdown');
    expect(res.body.playlists[0].items.map((i: any) => i.url)).toEqual([
      `${SUPA}${TENANT}/notice.pdf`,
      `${SUPA}${TENANT}/preparing.pdf`,
    ]);
    expect(JSON.stringify(res.body)).not.toContain('pdf-pages/');
  });

  it('NEGATIVE CONTROL: the same PDF without the alert is handed to screens as pages', async () => {
    const h = await makeHarness({
      assets: { notice: pdf('notice', pagesRecord(2)) },
      playlists: [{ id: 'pl-lobby', name: 'Lobby', assetIds: ['notice'] }],
    });
    const res = await poll(h);
    expect(res.body.isEmergency).toBe(false);
    expect(res.body.playlists[0].items.map((i: any) => i.item_id)).toEqual(['item-notice#p1', 'item-notice#p2']);
  });
});
