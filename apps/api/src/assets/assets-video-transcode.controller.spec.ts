/**
 * Upload → signage-transcode wiring (2026-09-23). Both upload paths queue ONE
 * transcode for a video, with the URL the asset serves and its REAL size; an
 * image never queues; a queue that is missing or refuses leaves the original
 * serving and the VIDEO_WARN_SIZE_BYTES line tells ops a large original is
 * going to screens as-is. The endpoint that reports state is tenant-bound.
 */
import { AssetsController } from './assets.controller';

const MB = 1024 * 1024;
const TENANT = 'tenant-1';
const PATH = `${TENANT}/0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.mp4`;
const publicUrl = (p: string) =>
  `https://example.supabase.co/storage/v1/object/public/assets/${p}`;

function makeStorage(realSize: number, contentType = 'video/mp4') {
  return {
    toSafeBuffer: (b: any) => (Buffer.isBuffer(b) ? b : Buffer.from(b)),
    upload: jest.fn(async (p: string) => publicUrl(p)),
    delete: jest.fn(async () => undefined),
    publicUrlForPath: publicUrl,
    assertObjectExists: jest.fn(async () => undefined),
    getObjectInfo: jest.fn(async () => ({ size: realSize, contentType })),
    download: jest.fn(async () => null),
  } as any;
}

function makeController(storage: any, transcodes?: any) {
  const prisma = {
    client: {
      assetFolder: { findFirst: jest.fn(async () => null) },
      asset: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({
          id: 'asset-new',
          altText: null,
          ...data,
        })),
        update: jest.fn(async ({ data }: any) => ({
          id: 'asset-new',
          ...data,
        })),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    },
  } as any;
  const controller = new AssetsController(
    prisma,
    storage,
    {} as any,
    {
      isUploadOptimizableImage: () => false,
      optimizeImageForUpload: jest.fn(),
    } as any,
    { generateImageAltText: jest.fn(async () => null) } as any,
    { kickOff: jest.fn() } as any,
    transcodes,
  );
  const warn = jest
    .spyOn((controller as any).logger, 'warn')
    .mockImplementation(() => undefined);
  return { controller, prisma, warn };
}

const admin = {
  user: { tenantId: TENANT, id: 'user-1', role: 'SCHOOL_ADMIN' },
};
const flush = () => new Promise((r) => setImmediate(r));

describe('complete-upload queues the signage transcode for a video', () => {
  it('ONE job, with the URL the asset serves and the REAL stored size', async () => {
    const transcodes = { enqueue: jest.fn(async () => true) };
    const { controller } = makeController(makeStorage(1200 * MB), transcodes);
    await controller.completeUpload(admin as any, {
      storagePath: PATH,
      filename: 'gym.mp4',
      contentType: 'video/mp4',
      size: 5 * MB,
    });
    await flush();
    expect(transcodes.enqueue).toHaveBeenCalledTimes(1);
    expect(transcodes.enqueue).toHaveBeenCalledWith({
      tenantId: TENANT,
      assetId: 'asset-new',
      sourceUrl: publicUrl(PATH),
      sourceBytes: 1200 * MB, // the real size — not the 5 MB the client claimed
    });
  });

  it('an image never queues a transcode', async () => {
    const transcodes = { enqueue: jest.fn(async () => true) };
    const imagePath = `${TENANT}/0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.jpg`;
    const { controller } = makeController(
      makeStorage(2 * MB, 'image/jpeg'),
      transcodes,
    );
    await controller.completeUpload(admin as any, {
      storagePath: imagePath,
      filename: 'a.jpg',
      contentType: 'image/jpeg',
      size: 2 * MB,
    });
    await flush();
    expect(transcodes.enqueue).not.toHaveBeenCalled();
  });

  it('a queue that refuses (or is absent) keeps the original and logs the large-original line', async () => {
    const refusing = { enqueue: jest.fn(async () => false) };
    const a = makeController(makeStorage(900 * MB), refusing);
    await a.controller.completeUpload(admin as any, {
      storagePath: PATH,
      filename: 'gym.mp4',
      contentType: 'video/mp4',
      size: 900 * MB,
    });
    await flush();
    expect(
      a.warn.mock.calls.some(([m]) =>
        String(m).includes('NOT queued for the signage transcode'),
      ),
    ).toBe(true);

    const b = makeController(makeStorage(900 * MB), undefined);
    await b.controller.completeUpload(admin as any, {
      storagePath: PATH,
      filename: 'gym.mp4',
      contentType: 'video/mp4',
      size: 900 * MB,
    });
    expect(
      b.warn.mock.calls.some(([m]) =>
        String(m).includes('NOT queued for the signage transcode'),
      ),
    ).toBe(true);
  });

  it('a SMALL video that cannot be queued is not worth a warning', async () => {
    const b = makeController(makeStorage(10 * MB), undefined);
    await b.controller.completeUpload(admin as any, {
      storagePath: PATH,
      filename: 'gym.mp4',
      contentType: 'video/mp4',
      size: 10 * MB,
    });
    expect(
      b.warn.mock.calls.some(([m]) => String(m).includes('NOT queued')),
    ).toBe(false);
  });
});

describe('multipart upload queues it too', () => {
  it('a multipart video queues one job with its stored URL and byte length', async () => {
    const transcodes = { enqueue: jest.fn(async () => true) };
    const { controller } = makeController(makeStorage(0), transcodes);
    const file: any = {
      buffer: Buffer.alloc(3 * MB),
      mimetype: 'video/mp4',
      originalname: 'clip.mp4',
      size: 3 * MB,
    };
    const res: any = await controller.upload(admin as any, file, {});
    await flush();
    expect(transcodes.enqueue).toHaveBeenCalledWith({
      tenantId: TENANT,
      assetId: 'asset-new',
      sourceUrl: res.fileUrl,
      sourceBytes: 3 * MB,
    });
  });
});

describe('GET /assets/optimization', () => {
  it('asks the service for THIS tenant only, bounded to 100 ids', async () => {
    const transcodes = { statusForAssets: jest.fn(async () => []) };
    const { controller } = makeController(makeStorage(1), transcodes);
    const ids = Array.from({ length: 150 }, (_, i) => `a${i}`).join(',');
    await controller.optimizationStatus(admin as any, ids);
    const [tenant, list] = transcodes.statusForAssets.mock.calls[0];
    expect(tenant).toBe(TENANT);
    expect(list).toHaveLength(100);
  });

  it('answers an empty list with no ids or no service', async () => {
    const a = makeController(makeStorage(1), { statusForAssets: jest.fn() });
    expect(await a.controller.optimizationStatus(admin as any, '')).toEqual({
      items: [],
    });
    const b = makeController(makeStorage(1), undefined);
    expect(await b.controller.optimizationStatus(admin as any, 'a1')).toEqual({
      items: [],
    });
  });
});
