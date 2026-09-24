/**
 * assets-video-poster.controller.spec.ts — poster + dimensions on upload, wired.
 *
 * THE OPERATOR-VISIBLE BUGS: the asset picker drew every video tile as
 * `<video preload="none">` — a blank grey rectangle — because `Asset` had no
 * poster column at all (2026-09-11); and the detail panel's RESOLUTION tile
 * said "—" for a 257 MB, 1920×1080 video because `processingMeta` was only
 * ever written by the sharp IMAGE optimizer (2026-09-24). These tests pin the
 * things that make the data exist, and the one thing that matters more than
 * either:
 *
 *   1. BOTH upload paths kick off the video job for a video (and only for a
 *      video), with the cheapest source each path has in hand.
 *   2. That ONE kick-off reaches BOTH the poster grab and the ffprobe
 *      dimensions probe — proven through the REAL VideoPosterService, not a
 *      stub, so a wiring regression in the service cannot hide behind a
 *      green `kickOff` assertion.
 *   3. `posterUrl` is present in the upload responses (NULL at first —
 *      generation is background — so the field's shape never appears later).
 *   4. ⚠️ A FAILING POSTER OR PROBE NEVER FAILS AN UPLOAD. A video that
 *      uploads fine with no poster and no dimensions is a cosmetic gap; an
 *      upload that 500s because ffmpeg/ffprobe choked is a broken product.
 */
import { AssetsController } from './assets.controller';
import { VideoPosterService } from '../storage/video-poster.service';

// The real service is exercised below; only the two binaries are faked.
jest.mock('../storage/video-poster', () => {
  const actual = jest.requireActual('../storage/video-poster');
  return {
    ...actual,
    extractVideoPosterFromBuffer: jest.fn(),
    extractVideoPosterFromUrl: jest.fn(),
  };
});
jest.mock('../storage/video-probe', () => {
  const actual = jest.requireActual('../storage/video-probe');
  return {
    ...actual,
    probeVideoFromBuffer: jest.fn(),
    probeVideoFromUrl: jest.fn(),
  };
});
const posterModule = require('../storage/video-poster');
const extractFromBuffer =
  posterModule.extractVideoPosterFromBuffer as jest.Mock;
const extractFromUrl = posterModule.extractVideoPosterFromUrl as jest.Mock;
const probeModule = require('../storage/video-probe');
const probeFromBuffer = probeModule.probeVideoFromBuffer as jest.Mock;
const probeFromUrl = probeModule.probeVideoFromUrl as jest.Mock;

const PREFIX = 'https://proj.supabase.co/storage/v1/object/public/assets/';
const UUID = 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';

const PROBE_OK = {
  ok: true,
  width: 1920,
  height: 1080,
  displayWidth: 1920,
  displayHeight: 1080,
  durationMs: 75_400,
  codec: 'h264',
  fps: 29.97,
  rotation: 0,
};
const FAIL = { ok: false, reason: 'stubbed' };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const POSTER_OK = {
  ok: true,
  buffer: JPEG,
  mimeType: 'image/jpeg',
  ext: '.jpg',
  bytes: JPEG.length,
  seekSeconds: 1,
};

function makeStorage(overrides: Partial<any> = {}) {
  return {
    toSafeBuffer: (b: any) => (Buffer.isBuffer(b) ? b : Buffer.from(b)),
    upload: jest.fn(async (p: string) => `${PREFIX}${p}`),
    delete: jest.fn(async () => undefined),
    download: jest.fn(async () => null),
    publicUrlForPath: (p: string) => `${PREFIX}${p}`,
    extractPath: (u: string) =>
      u.startsWith(PREFIX) ? u.slice(PREFIX.length) : null,
    assertObjectExists: jest.fn(async () => undefined),
    getObjectInfo: jest.fn(async () => ({
      size: 2 * 1024 * 1024,
      contentType: 'video/mp4',
    })),
    ...overrides,
  } as any;
}

function makeController(
  opts: {
    videoPoster?: any;
    storage?: any;
    asset?: any;
    /** Wire the REAL VideoPosterService (binaries faked) instead of a stub. */
    realVideoPoster?: boolean;
  } = {},
) {
  const storage = opts.storage ?? makeStorage();
  const created = {
    id: 'asset-1',
    altText: null,
    posterUrl: null,
    ...(opts.asset ?? {}),
  };
  const prisma = {
    client: {
      assetFolder: { findFirst: jest.fn(async () => null) },
      playlistItem: {
        findMany: jest.fn(async () => []),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      playlist: { findMany: jest.fn(async () => []) },
      screen: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null),
      },
      auditLog: { create: jest.fn(async () => ({ id: 'a' })) },
      asset: {
        // The controller's own reads (e.g. the presign "already claimed"
        // check) expect null; the probe's persist reads the row's
        // processingMeta back before merging — told apart by the select.
        findFirst: jest.fn(async (args: any) =>
          args?.select?.processingMeta ? { processingMeta: null } : null,
        ),
        create: jest.fn(async ({ data }: any) => ({ ...created, ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 'asset-1', ...data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        delete: jest.fn(async () => ({ id: 'asset-1' })),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          asset: { delete: jest.fn(async () => ({})) },
          auditLog: { create: jest.fn(async () => ({})) },
        }),
      ),
    },
  } as any;
  const mediaOpt = {
    isUploadOptimizableImage: () => false,
    optimizeImageForUpload: jest.fn(),
  } as any;
  const aiAltText = { generateImageAltText: jest.fn(async () => null) } as any;
  let videoPoster = opts.videoPoster ?? { kickOff: jest.fn() };
  if (opts.realVideoPoster) {
    const real = new VideoPosterService(prisma, storage);
    // Silence the deliberate warn/log lines; a failing job is expected here.
    jest
      .spyOn((real as any).logger, 'warn')
      .mockImplementation(() => undefined);
    jest.spyOn((real as any).logger, 'log').mockImplementation(() => undefined);
    videoPoster = real;
  }
  const controller = new AssetsController(
    prisma,
    storage,
    {} as any,
    mediaOpt,
    aiAltText,
    videoPoster,
  );
  return { controller, prisma, storage, videoPoster };
}

const adminReq = {
  user: { tenantId: 'tenant-1', id: 'user-1', role: 'SCHOOL_ADMIN' },
};

const videoFile = (name = 'promo.mp4'): any => ({
  originalname: name,
  mimetype: 'video/mp4',
  buffer: Buffer.from('fake video bytes'),
  size: 16,
});

const presignBody = {
  storagePath: `tenant-1/${UUID}.mp4`,
  filename: 'promo.mp4',
  contentType: 'video/mp4',
  size: 2 * 1024 * 1024,
  folderId: null,
};

/** The background job runs after the response; poll (bounded) for its write. */
async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms)
      throw new Error('timed out waiting for the background job');
    await new Promise((r) => setImmediate(r));
  }
}
const metaWrite = (prisma: any) =>
  (prisma.client.asset.updateMany.mock.calls as any[][]).find(
    (c) => 'processingMeta' in c[0].data,
  )?.[0];

beforeEach(() => {
  extractFromBuffer.mockReset().mockResolvedValue(FAIL);
  extractFromUrl.mockReset().mockResolvedValue(FAIL);
  probeFromBuffer.mockReset().mockResolvedValue(FAIL);
  probeFromUrl.mockReset().mockResolvedValue(FAIL);
});

describe('POST /assets/upload (multipart) — poster generation', () => {
  it('kicks off poster generation with the BYTES IT ALREADY HAS (no re-download)', async () => {
    const { controller, videoPoster } = makeController();

    const res: any = await controller.upload(adminReq as any, videoFile(), {});

    expect(videoPoster.kickOff).toHaveBeenCalledTimes(1);
    const job = videoPoster.kickOff.mock.calls[0][0];
    expect(job).toMatchObject({
      assetId: 'asset-1',
      tenantId: 'tenant-1',
      mimeType: 'video/mp4',
      ext: '.mp4',
    });
    expect(Buffer.isBuffer(job.buffer)).toBe(true);
    expect(job.buffer.toString()).toBe('fake video bytes');
    // The field is in the response shape from the very first byte, NULL until
    // the background job lands — the client reads the real value on refetch.
    expect(res.posterUrl).toBeNull();
    expect('posterUrl' in res).toBe(true);
  });

  it('does NOT kick off poster generation for an image', async () => {
    const { controller, videoPoster } = makeController();
    await controller.upload(
      adminReq as any,
      {
        originalname: 'photo.png',
        mimetype: 'image/png',
        buffer: Buffer.from('png'),
        size: 3,
      } as any,
      {},
    );
    expect(videoPoster.kickOff).not.toHaveBeenCalled();
  });

  it('⚠️ the upload SUCCEEDS even when poster generation throws synchronously', async () => {
    const videoPoster = {
      kickOff: jest.fn(() => {
        throw new Error('ffmpeg is not installed');
      }),
    };
    const { controller } = makeController({ videoPoster });

    // The service's own contract is never-throws; this proves the upload is
    // safe even if a future edit breaks that contract at the call site.
    let res: any;
    let err: any;
    try {
      res = await controller.upload(adminReq as any, videoFile(), {});
    } catch (e) {
      err = e;
    }

    // If this ever starts failing, a cosmetic thumbnail has been allowed to
    // break content upload — the exact inversion this feature must not make.
    expect(err).toBeUndefined();
    expect(res.id).toBe('asset-1');
    expect(res.fileUrl).toContain('/object/public/assets/tenant-1/');
    expect(res.posterUrl).toBeNull();
  });
});

describe('POST /assets/complete-upload (presign) — poster generation', () => {
  const body = presignBody;

  it('kicks off poster generation with the STORAGE PATH (bytes were never here)', async () => {
    const { controller, videoPoster, storage } = makeController();

    const res: any = await controller.completeUpload(adminReq as any, body);

    expect(videoPoster.kickOff).toHaveBeenCalledTimes(1);
    expect(videoPoster.kickOff.mock.calls[0][0]).toMatchObject({
      assetId: 'asset-1',
      tenantId: 'tenant-1',
      mimeType: 'video/mp4',
      storagePath: body.storagePath,
      ext: '.mp4',
    });
    // Crucially: the handler itself never pulled the video back.
    expect(storage.download).not.toHaveBeenCalled();
    expect(res.posterUrl).toBeNull();
    expect('posterUrl' in res).toBe(true);
  });

  it('⚠️ the finalize SUCCEEDS even when poster generation throws synchronously', async () => {
    const videoPoster = {
      kickOff: jest.fn(() => {
        throw new Error('boom');
      }),
    };
    const { controller } = makeController({ videoPoster });

    let res: any;
    let err: any;
    try {
      res = await controller.completeUpload(adminReq as any, body);
    } catch (e) {
      err = e;
    }

    expect(err).toBeUndefined();
    expect(res.id).toBe('asset-1');
  });

  it('uses the REAL mime storage reports, not the client claim', async () => {
    // Client says mp4; storage says webm. The poster job must follow storage.
    const storage = makeStorage({
      getObjectInfo: jest.fn(async () => ({
        size: 1024,
        contentType: 'video/webm',
      })),
    });
    const { controller, videoPoster } = makeController({ storage });

    await controller.completeUpload(adminReq as any, body);

    expect(videoPoster.kickOff.mock.calls[0][0].mimeType).toBe('video/webm');
  });
});

describe('the dimensions probe rides the SAME kick-off — through the REAL service', () => {
  it('multipart: the bytes in hand are probed and DISPLAY dims land in processingMeta, tenant-scoped', async () => {
    probeFromBuffer.mockResolvedValue(PROBE_OK);
    const { controller, prisma, storage } = makeController({
      realVideoPoster: true,
    });

    const res: any = await controller.upload(adminReq as any, videoFile(), {});
    expect(res.id).toBe('asset-1'); // the response never waited on the probe
    await waitFor(() => !!metaWrite(prisma));

    // The very buffer the upload held — no re-download, no second copy fetched.
    expect(probeFromBuffer).toHaveBeenCalledTimes(1);
    expect(probeFromBuffer.mock.calls[0][0].toString()).toBe(
      'fake video bytes',
    );
    expect(probeFromBuffer.mock.calls[0][1]).toBe('.mp4');
    expect(storage.download).not.toHaveBeenCalled();
    const write = metaWrite(prisma);
    expect(write.where).toEqual({ id: 'asset-1', tenantId: 'tenant-1' });
    expect(write.data.processingMeta).toMatchObject({
      originalDimensions: { w: 1920, h: 1080 },
      processedDimensions: null,
      durationMs: 75_400,
      probe: { codec: 'h264', fps: 29.97, rotation: 0 },
    });
  });

  it('presign: the object URL WE built (trusted prefix) is probed — nothing downloaded', async () => {
    probeFromUrl.mockResolvedValue(PROBE_OK);
    // The poster half reads the same URL; it must succeed here too, because
    // its OWN fallback is a full download and this test proves the
    // range-read path costs zero egress when both tools can read the object.
    extractFromUrl.mockResolvedValue(POSTER_OK);
    const { controller, prisma, storage } = makeController({
      realVideoPoster: true,
    });

    const res: any = await controller.completeUpload(
      adminReq as any,
      presignBody,
    );
    expect(res.id).toBe('asset-1');
    await waitFor(() => !!metaWrite(prisma));

    expect(probeFromUrl).toHaveBeenCalledWith(
      `${PREFIX}${presignBody.storagePath}`,
      PREFIX,
    );
    expect(probeFromBuffer).not.toHaveBeenCalled();
    expect(storage.download).not.toHaveBeenCalled();
    expect(metaWrite(prisma).data.processingMeta.originalDimensions).toEqual({
      w: 1920,
      h: 1080,
    });
  });

  it('an image upload never reaches ffprobe', async () => {
    const { controller, prisma } = makeController({ realVideoPoster: true });
    await controller.upload(
      adminReq as any,
      {
        originalname: 'photo.png',
        mimetype: 'image/png',
        buffer: Buffer.from('png'),
        size: 3,
      } as any,
      {},
    );
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    expect(probeFromBuffer).not.toHaveBeenCalled();
    expect(probeFromUrl).not.toHaveBeenCalled();
    expect(metaWrite(prisma)).toBeUndefined();
  });

  it('⚠️ a probe AND a poster that both fail leave the upload intact and write nothing', async () => {
    probeFromBuffer.mockRejectedValue(new Error('ffprobe exploded'));
    extractFromBuffer.mockRejectedValue(new Error('ffmpeg exploded'));
    const { controller, prisma } = makeController({ realVideoPoster: true });

    const res: any = await controller.upload(adminReq as any, videoFile(), {});
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));

    expect(res.id).toBe('asset-1');
    expect(res.posterUrl).toBeNull();
    expect(prisma.client.asset.updateMany).not.toHaveBeenCalled();
  });
});

describe('DELETE /assets/:id — the poster goes with the asset', () => {
  it('removes the poster object too, so it does not orphan in the bucket', async () => {
    const posterUrl = `${PREFIX}tenant-1/posters/${UUID}.jpg`;
    const storage = makeStorage();
    const { controller, prisma } = makeController({ storage });
    prisma.client.asset.findFirst = jest.fn(async () => ({
      id: 'asset-1',
      tenantId: 'tenant-1',
      fileUrl: `${PREFIX}tenant-1/${UUID}.mp4`,
      mimeType: 'video/mp4',
      posterUrl,
    }));

    await controller.remove(adminReq as any, 'asset-1');

    expect(storage.delete).toHaveBeenCalledWith(`tenant-1/${UUID}.mp4`);
    expect(storage.delete).toHaveBeenCalledWith(`tenant-1/posters/${UUID}.jpg`);
  });

  it('deletes fine when there is no poster (every pre-existing asset)', async () => {
    const storage = makeStorage();
    const { controller, prisma } = makeController({ storage });
    prisma.client.asset.findFirst = jest.fn(async () => ({
      id: 'asset-1',
      tenantId: 'tenant-1',
      fileUrl: `${PREFIX}tenant-1/${UUID}.mp4`,
      mimeType: 'video/mp4',
      posterUrl: null,
    }));

    await expect(
      controller.remove(adminReq as any, 'asset-1'),
    ).resolves.toEqual({ deleted: true });
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });
});
