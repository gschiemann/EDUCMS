/**
 * video-poster.service.spec.ts — extract → store → persist (poster) and
 * probe → merge → persist (dimensions), and the far more important half:
 * what happens when any of those fails.
 *
 * The binding rule from the task: neither job may block or fail an upload.
 * These tests pin that the service swallows every failure mode, leaves
 * `posterUrl` NULL / `processingMeta` untouched rather than propagating, and
 * that a failure in ONE job never skips the OTHER.
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

jest.mock('./video-probe', () => {
  const actual = jest.requireActual('./video-probe');
  return {
    ...actual,
    probeVideoFromBuffer: jest.fn(),
    probeVideoFromUrl: jest.fn(),
  };
});

const posterModule = require('./video-poster');
const fromBuffer = posterModule.extractVideoPosterFromBuffer as jest.Mock;
const fromUrl = posterModule.extractVideoPosterFromUrl as jest.Mock;
const probeModule = require('./video-probe');
const probeFromBuffer = probeModule.probeVideoFromBuffer as jest.Mock;
const probeFromUrl = probeModule.probeVideoFromUrl as jest.Mock;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const OK = {
  ok: true,
  buffer: JPEG,
  mimeType: 'image/jpeg',
  ext: '.jpg',
  bytes: JPEG.length,
  seekSeconds: 1,
};
const PROBE_OK = {
  ok: true,
  width: 1920,
  height: 1080,
  displayWidth: 1920,
  displayHeight: 1080,
  durationMs: 75_400,
  codec: 'h264',
  profile: 'High',
  level: 41,
  pixFmt: 'yuv420p',
  fps: 29.97,
  nominalFps: 30,
  variableFrameRate: false,
  bitrateKbps: 4523,
  rotation: 0,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  fastStart: true,
  audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
};
const PROBE_PORTRAIT = {
  ...PROBE_OK,
  displayWidth: 1080,
  displayHeight: 1920,
  rotation: 90,
};
const PROBE_FAIL = { ok: false, reason: 'no-video-dimensions' };
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

// Typed as plain `jest.Mock`, not off the defaults: a test hands in a mock that
// resolves a populated processingMeta (or null), and inferring the parameter
// type from the default value made the full `tsc` reject exactly those.
function makePrisma(
  updateMany: jest.Mock = jest.fn(async () => ({ count: 1 })),
  findFirst: jest.Mock = jest.fn(async () => ({ processingMeta: null })),
) {
  return { client: { asset: { updateMany, findFirst } } } as any;
}

function make(overrides: { storage?: any; prisma?: any } = {}) {
  const storage = overrides.storage ?? makeStorage();
  const prisma = overrides.prisma ?? makePrisma();
  const service = new VideoPosterService(prisma, storage);
  // Silence the deliberate warn lines; a failing job is expected noise here.
  jest
    .spyOn((service as any).logger, 'warn')
    .mockImplementation(() => undefined);
  jest
    .spyOn((service as any).logger, 'log')
    .mockImplementation(() => undefined);
  return { service, storage, prisma };
}

/** The processingMeta the LAST updateMany wrote, or undefined. */
function writtenMeta(prisma: any): any {
  const calls = prisma.client.asset.updateMany.mock.calls as any[][];
  const hit = [...calls].reverse().find((c) => 'processingMeta' in c[0].data);
  return hit?.[0].data.processingMeta;
}

const JOB = { assetId: 'asset-1', tenantId: 'tenant-1', mimeType: 'video/mp4' };

beforeEach(() => {
  fromBuffer.mockReset();
  fromUrl.mockReset();
  probeFromBuffer.mockReset();
  probeFromUrl.mockReset();
  // Default: the probe half quietly fails, so the poster-only tests below read
  // exactly as they did before the probe existed.
  probeFromBuffer.mockResolvedValue(PROBE_FAIL);
  probeFromUrl.mockResolvedValue(PROBE_FAIL);
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
    probeFromBuffer.mockRejectedValue(new Error('boom too'));
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
    expect(probeFromBuffer).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

describe('dimensions probe on upload — the happy path', () => {
  it('multipart: probes the bytes it was handed and merges DISPLAY dims into processingMeta, tenant-scoped', async () => {
    probeFromBuffer.mockResolvedValue(PROBE_OK);
    const { service, storage, prisma } = make();

    const ok = await service.probeForAsset({
      ...JOB,
      buffer: Buffer.from('video'),
      ext: '.mp4',
    });

    expect(ok).toBe(true);
    expect(probeFromBuffer).toHaveBeenCalledWith(expect.any(Buffer), '.mp4');
    expect(storage.download).not.toHaveBeenCalled();
    // The read AND the write are tenant-scoped.
    expect(prisma.client.asset.findFirst).toHaveBeenCalledWith({
      where: { id: 'asset-1', tenantId: 'tenant-1' },
      select: { processingMeta: true },
    });
    const call = prisma.client.asset.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'asset-1', tenantId: 'tenant-1' });
    // The exact shape the media library's metaDims reads.
    expect(call.data.processingMeta).toMatchObject({
      originalDimensions: { w: 1920, h: 1080 },
      processedDimensions: null,
      durationMs: 75_400,
      probe: {
        codec: 'h264',
        fps: 29.97,
        rotation: 0,
        codedWidth: 1920,
        codedHeight: 1080,
      },
    });
    expect(typeof call.data.processingMeta.probedAt).toBe('string');
  });

  it('a rotated (portrait) clip persists the DISPLAY size, not the coded one', async () => {
    probeFromBuffer.mockResolvedValue(PROBE_PORTRAIT);
    const { service, prisma } = make();
    await service.probeForAsset({ ...JOB, buffer: JPEG });
    expect(writtenMeta(prisma)).toMatchObject({
      originalDimensions: { w: 1080, h: 1920 },
      probe: { rotation: 90, codedWidth: 1920, codedHeight: 1080 },
    });
  });

  it('MERGES: every key already in processingMeta survives the write', async () => {
    probeFromBuffer.mockResolvedValue(PROBE_OK);
    const prisma = makePrisma(
      undefined,
      jest.fn(async () => ({
        processingMeta: { originalSize: 9_000_000, skippedReason: 'legacy' },
      })),
    );
    const { service } = make({ prisma });
    await service.probeForAsset({ ...JOB, buffer: JPEG });
    const meta = writtenMeta(prisma);
    expect(meta.originalSize).toBe(9_000_000);
    expect(meta.skippedReason).toBe('legacy');
    expect(meta.originalDimensions).toEqual({ w: 1920, h: 1080 });
  });

  it('presign path: probes the object URL WE built (trusted prefix) and never downloads', async () => {
    probeFromUrl.mockResolvedValue(PROBE_OK);
    const { service, storage, prisma } = make();

    const ok = await service.probeForAsset({
      ...JOB,
      storagePath: 'tenant-1/abc.mp4',
      ext: '.mp4',
    });

    expect(ok).toBe(true);
    expect(probeFromUrl).toHaveBeenCalledWith(
      `${PREFIX}tenant-1/abc.mp4`,
      PREFIX,
    );
    expect(probeFromBuffer).not.toHaveBeenCalled();
    expect(storage.download).not.toHaveBeenCalled();
    expect(writtenMeta(prisma).originalDimensions).toEqual({
      w: 1920,
      h: 1080,
    });
  });

  it('falls back to a download when the URL probe fails — and both jobs share that ONE download', async () => {
    probeFromUrl.mockResolvedValue({ ok: false, reason: 'ffprobe exited 1' });
    probeFromBuffer.mockResolvedValue(PROBE_OK);
    fromUrl.mockResolvedValue({ ok: false, reason: 'ffmpeg exited 1' });
    fromBuffer.mockResolvedValue(OK);
    const bytes = Buffer.from('video-bytes');
    const storage = makeStorage({ download: jest.fn(async () => bytes) });
    const { service, prisma } = make({ storage });

    const result = await service.processVideo({
      ...JOB,
      storagePath: 'tenant-1/abc.mp4',
      ext: '.mp4',
    });

    expect(result).toEqual({
      probed: true,
      posterUrl: expect.stringContaining('/posters/'),
    });
    expect(storage.download).toHaveBeenCalledTimes(1); // memoised across probe + poster
    expect(probeFromBuffer).toHaveBeenCalledWith(bytes, '.mp4');
    expect(fromBuffer).toHaveBeenCalledWith(bytes, '.mp4');
    expect(writtenMeta(prisma).originalDimensions).toEqual({
      w: 1920,
      h: 1080,
    });
  });

  it('does nothing at all for a non-video asset', async () => {
    const { service, prisma } = make();
    expect(
      await service.probeForAsset({
        ...JOB,
        mimeType: 'image/png',
        buffer: JPEG,
      }),
    ).toBe(false);
    expect(probeFromBuffer).not.toHaveBeenCalled();
    expect(prisma.client.asset.updateMany).not.toHaveBeenCalled();
  });
});

describe('dimensions probe — the failure path STAMPS the row, never facts', () => {
  // Without a stamp the dashboard reads "Checking the encoding…" and polls for
  // facts that are not coming, for ten minutes: a failure must say so.
  const isIso = (v: unknown) =>
    typeof v === 'string' && !Number.isNaN(Date.parse(v));

  it('a probe with no dimensions writes probedAt + probeFailed (+ version), nothing else, and returns false', async () => {
    probeFromBuffer.mockResolvedValue({ ok: false, reason: 'no-video-stream' });
    const { service, prisma } = make();
    await expect(service.probeForAsset({ ...JOB, buffer: JPEG })).resolves.toBe(
      false,
    );
    // The same tenant-scoped read → merge → write path a success uses.
    expect(prisma.client.asset.findFirst).toHaveBeenCalledWith({
      where: { id: 'asset-1', tenantId: 'tenant-1' },
      select: { processingMeta: true },
    });
    const call = prisma.client.asset.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'asset-1', tenantId: 'tenant-1' });
    expect(call.data.processingMeta).toEqual({
      probedAt: expect.any(String),
      probeFailed: 'no-video-stream',
      probeFailedVersion: 2,
    });
    expect(isIso(call.data.processingMeta.probedAt)).toBe(true);
  });

  it('a THROWING probe returns false, never rejects — and stamps the row with every other key intact', async () => {
    probeFromBuffer.mockRejectedValue(new Error('ffprobe exploded'));
    const prisma = makePrisma(
      undefined,
      jest.fn(async () => ({
        processingMeta: {
          originalSize: 9_000_000,
          skippedReason: 'legacy',
          originalDimensions: { w: 1280, h: 720 },
        },
      })),
    );
    const { service } = make({ prisma });
    await expect(service.probeForAsset({ ...JOB, buffer: JPEG })).resolves.toBe(
      false,
    );
    const meta = writtenMeta(prisma);
    expect(meta).toEqual({
      originalSize: 9_000_000,
      skippedReason: 'legacy',
      originalDimensions: { w: 1280, h: 720 }, // untouched
      probedAt: expect.any(String),
      probeFailed: 'threw: ffprobe exploded',
      probeFailedVersion: 2,
    });
    expect(isIso(meta.probedAt)).toBe(true);
  });

  it('the stamp never contradicts facts: a row that already carries a current probe is left alone', async () => {
    probeFromBuffer.mockResolvedValue({ ok: false, reason: 'no-video-stream' });
    const { mergeProbeMeta } = probeModule;
    const prisma = makePrisma(
      undefined,
      jest.fn(async () => ({ processingMeta: mergeProbeMeta(null, PROBE_OK) })),
    );
    const { service } = make({ prisma });
    await expect(service.probeForAsset({ ...JOB, buffer: JPEG })).resolves.toBe(
      false,
    );
    expect(prisma.client.asset.updateMany).not.toHaveBeenCalled();
  });

  it('a stamp that cannot be written (row gone, DB error) is swallowed — still false, never a throw', async () => {
    probeFromBuffer.mockResolvedValue({ ok: false, reason: 'no-video-stream' });
    const gone = makePrisma(
      undefined,
      jest.fn(async () => null),
    );
    await expect(
      make({ prisma: gone }).service.probeForAsset({ ...JOB, buffer: JPEG }),
    ).resolves.toBe(false);
    expect(gone.client.asset.updateMany).not.toHaveBeenCalled();

    const broken = makePrisma(
      jest.fn(async () => {
        throw new Error('pool timeout');
      }),
    );
    await expect(
      make({ prisma: broken }).service.probeForAsset({ ...JOB, buffer: JPEG }),
    ).resolves.toBe(false);
  });

  it('asset deleted before the read → no write, false', async () => {
    probeFromBuffer.mockResolvedValue(PROBE_OK);
    const prisma = makePrisma(
      undefined,
      jest.fn(async () => null),
    );
    const { service } = make({ prisma });
    await expect(service.probeForAsset({ ...JOB, buffer: JPEG })).resolves.toBe(
      false,
    );
    expect(prisma.client.asset.updateMany).not.toHaveBeenCalled();
  });

  it('asset deleted between read and write (0 rows) → false, no throw', async () => {
    probeFromBuffer.mockResolvedValue(PROBE_OK);
    const prisma = makePrisma(jest.fn(async () => ({ count: 0 })));
    const { service } = make({ prisma });
    await expect(service.probeForAsset({ ...JOB, buffer: JPEG })).resolves.toBe(
      false,
    );
  });

  it('a DB error on persist → false, no throw', async () => {
    probeFromBuffer.mockResolvedValue(PROBE_OK);
    const prisma = makePrisma(
      jest.fn(async () => {
        throw new Error('pool timeout');
      }),
    );
    const { service } = make({ prisma });
    await expect(service.probeForAsset({ ...JOB, buffer: JPEG })).resolves.toBe(
      false,
    );
  });

  it('returns false when there is neither a buffer nor a storage path', async () => {
    const { service, prisma } = make();
    await expect(service.probeForAsset({ ...JOB })).resolves.toBe(false);
    expect(probeFromBuffer).not.toHaveBeenCalled();
    expect(probeFromUrl).not.toHaveBeenCalled();
    // Nothing could be probed, so the row is stamped: the dashboard must not
    // wait ten minutes for facts no probe will ever produce.
    expect(writtenMeta(prisma)).toMatchObject({
      probeFailed: 'no-source',
      probeFailedVersion: 2,
    });
  });
});

describe('poster and probe are independent — one failing never skips the other', () => {
  it('a poster that cannot be extracted does not skip the probe', async () => {
    fromBuffer.mockResolvedValue({ ok: false, reason: 'Invalid data found' });
    probeFromBuffer.mockResolvedValue(PROBE_OK);
    const { service, prisma } = make();

    const result = await service.processVideo({
      ...JOB,
      buffer: JPEG,
      ext: '.mp4',
    });

    expect(result).toEqual({ probed: true, posterUrl: null });
    expect(writtenMeta(prisma).originalDimensions).toEqual({
      w: 1920,
      h: 1080,
    });
  });

  it('a poster that THROWS does not skip the probe', async () => {
    fromBuffer.mockRejectedValue(new Error('ffmpeg exploded'));
    probeFromBuffer.mockResolvedValue(PROBE_OK);
    const { service } = make();
    await expect(
      service.processVideo({ ...JOB, buffer: JPEG }),
    ).resolves.toEqual({ probed: true, posterUrl: null });
  });

  it('a probe that fails (or throws) does not skip the poster', async () => {
    fromBuffer.mockResolvedValue(OK);
    probeFromBuffer.mockRejectedValue(new Error('ffprobe exploded'));
    const { service, prisma } = make();

    const result = await service.processVideo({ ...JOB, buffer: JPEG });

    expect(result.probed).toBe(false);
    expect(result.posterUrl).toContain('/posters/');
    // Two writes: the probe's FAILURE STAMP (no facts), then the poster URL.
    const datas = prisma.client.asset.updateMany.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    expect(datas).toHaveLength(2);
    expect(datas[0].processingMeta).toMatchObject({
      probeFailed: 'threw: ffprobe exploded',
      probeFailedVersion: 2,
    });
    expect(datas[0].processingMeta.originalDimensions).toBeUndefined();
    expect(datas[1]).toEqual({ posterUrl: result.posterUrl });
  });

  it('kickOff runs BOTH jobs for one video', async () => {
    fromBuffer.mockResolvedValue(OK);
    probeFromBuffer.mockResolvedValue(PROBE_OK);
    const { service, prisma } = make();

    service.kickOff({ ...JOB, buffer: JPEG, ext: '.mp4' });
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));

    const datas = prisma.client.asset.updateMany.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    expect(datas).toHaveLength(2);
    expect(datas.some((d: any) => 'processingMeta' in d)).toBe(true);
    expect(datas.some((d: any) => 'posterUrl' in d)).toBe(true);
  });
});
