/**
 * assets-video-poster.controller.spec.ts — poster-on-upload, wired.
 *
 * THE OPERATOR-VISIBLE BUG: the asset picker drew every video tile as
 * `<video preload="none">` — a blank grey rectangle — because `Asset` had no
 * poster column at all. These tests pin the two things that make the data
 * exist, and the one thing that matters more than either:
 *
 *   1. BOTH upload paths kick off poster generation for a video (and only for
 *      a video), with the cheapest source each path has in hand.
 *   2. `posterUrl` is present in the upload responses (NULL at first —
 *      generation is background — so the field's shape never appears later).
 *   3. ⚠️ A FAILING POSTER NEVER FAILS AN UPLOAD. A video that uploads fine
 *      with no poster is a cosmetic gap; an upload that 500s because ffmpeg
 *      choked is a broken product.
 */
import { AssetsController } from './assets.controller';

const PREFIX = 'https://proj.supabase.co/storage/v1/object/public/assets/';
const UUID = 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';

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
  opts: { videoPoster?: any; storage?: any; asset?: any } = {},
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
        findFirst: jest.fn(async () => null),
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
  const videoPoster = opts.videoPoster ?? { kickOff: jest.fn() };
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
  const body = {
    storagePath: `tenant-1/${UUID}.mp4`,
    filename: 'promo.mp4',
    contentType: 'video/mp4',
    size: 2 * 1024 * 1024,
    folderId: null,
  };

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
