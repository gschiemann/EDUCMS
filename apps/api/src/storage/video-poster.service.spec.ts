/**
 * video-poster.service.spec.ts — extract → store → persist, and the far more
 * important half: what happens when any of those three fails.
 *
 * The binding rule from the task: poster extraction MUST NOT block or fail an
 * upload. These tests pin that the service swallows every failure mode and
 * leaves `posterUrl` NULL rather than propagating.
 */
import { VideoPosterService } from './video-poster.service';

jest.mock('./video-poster', () => {
  const actual = jest.requireActual('./video-poster');
  return {
    ...actual,
    extractVideoPosterFromBuffer: jest.fn(),
    extractVideoPosterFromUrl: jest.fn(),
  };
});

const posterModule = require('./video-poster');
const fromBuffer = posterModule.extractVideoPosterFromBuffer as jest.Mock;
const fromUrl = posterModule.extractVideoPosterFromUrl as jest.Mock;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const OK = {
  ok: true,
  buffer: JPEG,
  mimeType: 'image/jpeg',
  ext: '.jpg',
  bytes: JPEG.length,
  seekSeconds: 1,
};
const PREFIX = 'https://proj.supabase.co/storage/v1/object/public/assets/';

function makeStorage(overrides: Partial<any> = {}) {
  return {
    upload: jest.fn(async (p: string) => `${PREFIX}${p}`),
    delete: jest.fn(async () => undefined),
    download: jest.fn(async () => null),
    publicUrlForPath: (p: string) => `${PREFIX}${p}`,
    ...overrides,
  } as any;
}

function makePrisma(updateMany = jest.fn(async () => ({ count: 1 }))) {
  return { client: { asset: { updateMany } } } as any;
}

function make(overrides: { storage?: any; prisma?: any } = {}) {
  const storage = overrides.storage ?? makeStorage();
  const prisma = overrides.prisma ?? makePrisma();
  const service = new VideoPosterService(prisma, storage);
  // Silence the deliberate warn lines; a failing poster is expected noise here.
  jest
    .spyOn((service as any).logger, 'warn')
    .mockImplementation(() => undefined);
  jest
    .spyOn((service as any).logger, 'log')
    .mockImplementation(() => undefined);
  return { service, storage, prisma };
}

const JOB = { assetId: 'asset-1', tenantId: 'tenant-1', mimeType: 'video/mp4' };

beforeEach(() => {
  fromBuffer.mockReset();
  fromUrl.mockReset();
});

describe('poster on upload — the happy path', () => {
  it('extracts from in-memory bytes, stores under <tenant>/posters/, and persists the URL', async () => {
    fromBuffer.mockResolvedValue(OK);
    const { service, storage, prisma } = make();

    const url = await service.generateForAsset({
      ...JOB,
      buffer: Buffer.from('video'),
      ext: '.mp4',
    });

    expect(fromBuffer).toHaveBeenCalled();
    // Never re-downloads bytes it was handed.
    expect(storage.download).not.toHaveBeenCalled();
    const [posterPath, bytes, mime] = storage.upload.mock.calls[0];
    expect(posterPath).toMatch(/^tenant-1\/posters\/[0-9a-f-]{36}\.jpg$/);
    expect(bytes).toBe(JPEG);
    expect(mime).toBe('image/jpeg');
    expect(url).toBe(`${PREFIX}${posterPath}`);
    // Tenant-scoped write — an asset id alone is not a tenant boundary.
    expect(prisma.client.asset.updateMany).toHaveBeenCalledWith({
      where: { id: 'asset-1', tenantId: 'tenant-1' },
      data: { posterUrl: url },
    });
  });

  it('poster path is TWO segments under the tenant — un-mintable by complete-upload', async () => {
    // `isMintedUploadPath` only accepts `<tenantId>/<uuid><ext>`, so a poster
    // object can never be named by POST /assets/complete-upload and therefore
    // can never be reached by the UPLD-02 hijack-delete class.

    const { isMintedUploadPath } = require('../assets/upload-path');
    const { service } = make();
    const p = service.posterStoragePath('tenant-1');
    expect(p.startsWith('tenant-1/posters/')).toBe(true);
    expect(isMintedUploadPath(p, 'tenant-1')).toBe(false);
  });

  it('presign path: range-reads the object URL and never downloads the whole video', async () => {
    fromUrl.mockResolvedValue(OK);
    const { service, storage } = make();

    await service.generateForAsset({ ...JOB, storagePath: 'tenant-1/abc.mp4' });

    expect(fromUrl).toHaveBeenCalledWith(`${PREFIX}tenant-1/abc.mp4`, PREFIX);
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('falls back to downloading the bytes when the URL read fails', async () => {
    fromUrl.mockResolvedValue({ ok: false, reason: 'ffmpeg exited 1' });
    fromBuffer.mockResolvedValue(OK);
    const storage = makeStorage({
      download: jest.fn(async () => Buffer.from('video-bytes')),
    });
    const { service } = make({ storage });

    const url = await service.generateForAsset({
      ...JOB,
      storagePath: 'tenant-1/abc.mp4',
    });

    expect(storage.download).toHaveBeenCalledWith('tenant-1/abc.mp4');
    expect(url).toContain('/posters/');
  });

  it('does nothing at all for a non-video asset', async () => {
    const { service, storage, prisma } = make();
    expect(
      await service.generateForAsset({
        ...JOB,
        mimeType: 'image/png',
        buffer: JPEG,
      }),
    ).toBeNull();
    expect(fromBuffer).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.client.asset.updateMany).not.toHaveBeenCalled();
  });
});

describe('the failure path — an upload must survive all of it', () => {
  it('returns null (does not throw) when no frame could be extracted', async () => {
    fromBuffer.mockResolvedValue({ ok: false, reason: 'Invalid data found' });
    const { service, storage, prisma } = make();

    await expect(
      service.generateForAsset({ ...JOB, buffer: Buffer.from('junk') }),
    ).resolves.toBeNull();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.client.asset.updateMany).not.toHaveBeenCalled(); // posterUrl stays NULL
  });

  it('returns null when the extractor THROWS outright', async () => {
    fromBuffer.mockRejectedValue(new Error('ffmpeg exploded'));
    const { service, prisma } = make();
    await expect(
      service.generateForAsset({ ...JOB, buffer: JPEG }),
    ).resolves.toBeNull();
    expect(prisma.client.asset.updateMany).not.toHaveBeenCalled();
  });

  it('returns null when storage rejects the poster upload', async () => {
    fromBuffer.mockResolvedValue(OK);
    const storage = makeStorage({
      upload: jest.fn(async () => {
        throw new Error('502 from storage');
      }),
    });
    const { service, prisma } = make({ storage });
    await expect(
      service.generateForAsset({ ...JOB, buffer: JPEG }),
    ).resolves.toBeNull();
    expect(prisma.client.asset.updateMany).not.toHaveBeenCalled();
  });

  it('deletes the stored poster if the DB write throws — no orphan blob', async () => {
    fromBuffer.mockResolvedValue(OK);
    const storage = makeStorage();
    const prisma = makePrisma(
      jest.fn(async () => {
        throw new Error('pool timeout');
      }),
    );
    const { service } = make({ storage, prisma });

    await expect(
      service.generateForAsset({ ...JOB, buffer: JPEG }),
    ).resolves.toBeNull();
    expect(storage.delete).toHaveBeenCalledWith(
      storage.upload.mock.calls[0][0],
    );
  });

  it('deletes the poster when the asset was deleted mid-flight (0 rows updated)', async () => {
    fromBuffer.mockResolvedValue(OK);
    const storage = makeStorage();
    const prisma = makePrisma(jest.fn(async () => ({ count: 0 })));
    const { service } = make({ storage, prisma });

    await expect(
      service.generateForAsset({ ...JOB, buffer: JPEG }),
    ).resolves.toBeNull();
    expect(storage.delete).toHaveBeenCalledWith(
      storage.upload.mock.calls[0][0],
    );
  });

  it('returns null when there is neither a buffer nor a storage path', async () => {
    const { service } = make();
    await expect(service.generateForAsset({ ...JOB })).resolves.toBeNull();
  });

  it('kickOff is synchronous, returns void, and cannot produce an unhandled rejection', async () => {
    fromBuffer.mockRejectedValue(new Error('boom'));
    const { service } = make();
    const unhandled = jest.fn();
    process.once('unhandledRejection', unhandled);

    expect(service.kickOff({ ...JOB, buffer: JPEG })).toBeUndefined();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });

  it('kickOff skips non-video assets without touching the pipeline', () => {
    const { service, storage } = make();
    service.kickOff({ ...JOB, mimeType: 'application/pdf', buffer: JPEG });
    expect(fromBuffer).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
