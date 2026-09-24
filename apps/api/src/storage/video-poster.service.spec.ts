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
import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';
import type { SupabaseStorageService } from './supabase-storage.service';
import {
  extractVideoPosterFromBuffer,
  extractVideoPosterFromUrl,
} from './video-poster';
import { VideoPosterService } from './video-poster.service';
import {
  needsProbe,
  probeVideoFromBuffer,
  probeVideoFromUrl,
  type ProbeSuccess,
} from './video-probe';
import { remuxFastStart, type RemuxOutcome } from './video-remux';

// The fast-start re-mux's binary half is faked; its pure helpers stay real.
jest.mock('./video-remux', () => {
  const actual =
    jest.requireActual<typeof import('./video-remux')>('./video-remux');
  return { ...actual, remuxFastStart: jest.fn() };
});

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
      remux: 'not-needed',
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

    expect(result).toEqual({
      probed: true,
      posterUrl: null,
      remux: 'not-needed',
    });
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
    ).resolves.toEqual({ probed: true, posterUrl: null, remux: 'not-needed' });
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

describe('2026-09-23 — the download fallback is bounded (direct uploads reach 2 GB)', () => {
  // The bound sits on the ONE memoised download both jobs share (`sourceFor`),
  // so it protects the probe's byte fallback exactly as it protects the poster's.
  it('skips the in-memory fallback for an object above the multipart ceiling', async () => {
    fromUrl.mockResolvedValue({ ok: false, reason: 'ffmpeg exited 1' });
    const storage = makeStorage({
      download: jest.fn(async () => Buffer.from('video-bytes')),
      getObjectInfo: jest.fn(async () => ({
        size: 1536 * 1024 * 1024,
        contentType: 'video/mp4',
      })),
    });
    const { service } = make({ storage });
    const url = await service.generateForAsset({
      ...JOB,
      storagePath: 'tenant-1/big.mp4',
    });
    expect(url).toBeNull();
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('the probe shares the bound: over it, no download and the row is stamped with the size reason', async () => {
    probeFromUrl.mockResolvedValue({ ok: false, reason: 'ffprobe exited 1' });
    const storage = makeStorage({
      download: jest.fn(async () => Buffer.from('video-bytes')),
      getObjectInfo: jest.fn(async () => ({
        size: 1536 * 1024 * 1024,
        contentType: 'video/mp4',
      })),
    });
    const { service, prisma } = make({ storage });
    await expect(
      service.probeForAsset({ ...JOB, storagePath: 'tenant-1/big.mp4' }),
    ).resolves.toBe(false);
    expect(storage.download).not.toHaveBeenCalled();
    expect(probeFromBuffer).not.toHaveBeenCalled();
    expect(writtenMeta(prisma).probeFailed).toContain(
      'too-large-for-download-fallback (1536 MB)',
    );
  });

  it('a storage that cannot report a size falls through to the download as before', async () => {
    fromUrl.mockResolvedValue({ ok: false, reason: 'ffmpeg exited 1' });
    fromBuffer.mockResolvedValue(OK);
    const storage = makeStorage({
      download: jest.fn(async () => Buffer.from('video-bytes')),
    }); // no getObjectInfo
    const { service } = make({ storage });
    expect(
      await service.generateForAsset({
        ...JOB,
        storagePath: 'tenant-1/abc.mp4',
      }),
    ).toContain('/posters/');
    expect(storage.download).toHaveBeenCalledWith('tenant-1/abc.mp4');
  });

  it('still falls back for an object within it', async () => {
    fromUrl.mockResolvedValue({ ok: false, reason: 'ffmpeg exited 1' });
    fromBuffer.mockResolvedValue(OK);
    const storage = makeStorage({
      download: jest.fn(async () => Buffer.from('video-bytes')),
      getObjectInfo: jest.fn(async () => ({
        size: 40 * 1024 * 1024,
        contentType: 'video/mp4',
      })),
    });
    const { service } = make({ storage });
    await service.generateForAsset({ ...JOB, storagePath: 'tenant-1/abc.mp4' });
    expect(storage.download).toHaveBeenCalledWith('tenant-1/abc.mp4');
  });
});

// ── the fast-start re-mux ───────────────────────────────────────────────────
// An MP4 whose index sits at the tail is re-muxed (video-remux.ts, faked here)
// and the row moved onto the copy. Everything below uses TYPED fakes — no
// `any` — over an in-memory asset table that the fake Prisma really updates,
// so every test reads exactly what the swap left behind.

const remuxMock = jest.mocked(remuxFastStart);
const probeBufferMock = jest.mocked(probeVideoFromBuffer);
const probeUrlMock = jest.mocked(probeVideoFromUrl);
const posterBufferMock = jest.mocked(extractVideoPosterFromBuffer);
const posterUrlMock = jest.mocked(extractVideoPosterFromUrl);

const OLD_PATH = 'tenant-1/0c5e-clip.mp4';
const OLD_URL = `${PREFIX}${OLD_PATH}`;
/** The upload as it arrived: samples first, index at the tail. */
const ORIGINAL = Buffer.from('original bytes: mdat, then moov');
/** What the re-mux hands back: index first. */
const FIXED = Buffer.from('re-muxed bytes: moov, then mdat');
const TAIL_PROBE: ProbeSuccess = { ...PROBE_OK, ok: true, fastStart: false };
const FRONT_PROBE: ProbeSuccess = { ...PROBE_OK, ok: true, fastStart: true };
const REMUX_OK: RemuxOutcome = {
  ok: true,
  buffer: FIXED,
  bytesBefore: ORIGINAL.length,
  bytesAfter: FIXED.length,
};
/** The multipart upload: the bytes are in hand. */
const BYTES_JOB = { ...JOB, buffer: ORIGINAL, ext: '.mp4' };
/** Presign, the auto-heal cron and "Check this file": only the stored path. */
const PATH_JOB = { ...JOB, storagePath: OLD_PATH, ext: '.mp4' };

interface FakeRow {
  id: string;
  tenantId: string;
  fileUrl: string;
  fileSize: number | null;
  fileHash: string | null;
  processingMeta: unknown;
}
interface RowWhere {
  id: string;
  tenantId: string;
  fileUrl?: string;
}
interface Query {
  where: Record<string, unknown>;
}
interface Found {
  id: string;
}

const assetRow = (over: Partial<FakeRow> = {}): FakeRow => ({
  id: 'asset-1',
  tenantId: 'tenant-1',
  fileUrl: OLD_URL,
  fileSize: ORIGINAL.length,
  fileHash: 'sha-of-the-original',
  processingMeta: null,
  ...over,
});

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const orOf = (q: Query): unknown[] => (q.where as { OR: unknown[] }).OR;

describe('the fast-start re-mux — an MP4 whose index sits at the tail', () => {
  const spies: Array<{ mockRestore(): void }> = [];

  /**
   * One service over an in-memory asset table. `swap` makes the SWAP write
   * (the one that moves `fileUrl`) misbehave: throw before committing, throw
   * after committing (a dropped connection), or throw and leave every later
   * read failing too.
   */
  function remuxWorld(
    rows: FakeRow[] = [assetRow()],
    opts: {
      swap?: 'throws' | 'throws-after-commit' | 'throws-unreadable';
      /** The signage transcode's job row for the asset, if any ('throws' = the read fails). */
      transcode?: 'queued' | 'running' | 'done' | 'throws' | null;
    } = {},
  ) {
    let unreadable = false;
    let transcode = opts.transcode ?? null;
    const find = (w: RowWhere) =>
      rows.find(
        (r) =>
          r.id === w.id &&
          r.tenantId === w.tenantId &&
          (w.fileUrl === undefined || r.fileUrl === w.fileUrl),
      );
    const asset = {
      findFirst: jest.fn((args: { where: RowWhere }) => {
        if (unreadable) return Promise.reject(new Error('connection reset'));
        const row = find(args.where);
        return Promise.resolve(row ? { ...row } : null);
      }),
      updateMany: jest.fn(
        (args: { where: RowWhere; data: Record<string, unknown> }) => {
          const isSwap = 'fileUrl' in args.data;
          if (isSwap && opts.swap === 'throws')
            return Promise.reject(new Error('pool timeout'));
          if (isSwap && opts.swap === 'throws-unreadable') {
            unreadable = true;
            return Promise.reject(new Error('connection reset'));
          }
          const row = find(args.where);
          if (row) Object.assign(row, args.data);
          if (isSwap && opts.swap === 'throws-after-commit')
            return Promise.reject(new Error('connection reset after commit'));
          return Promise.resolve({ count: row ? 1 : 0 });
        },
      ),
      count: jest.fn(
        (args: { where: { fileUrl: string; id: { not: string } } }) =>
          Promise.resolve(
            rows.filter(
              (r) =>
                r.fileUrl === args.where.fileUrl && r.id !== args.where.id.not,
            ).length,
          ),
      ),
    };
    const none = () =>
      jest.fn<Promise<Found | null>, [Query]>().mockResolvedValue(null);
    const db = {
      asset,
      playlistItem: {
        findMany: jest
          .fn<Promise<Array<{ playlistId: string }>>, [Query]>()
          .mockResolvedValue([]),
      },
      playlist: { findFirst: none() },
      tenant: { findFirst: none() },
      screen: { findFirst: none() },
      screenEmergencyOverride: { findFirst: none() },
      emergencyMessage: { findFirst: none() },
      // The gate's read: `status IN (...)`, answered from the switch above.
      videoTranscodeJob: {
        findFirst: jest.fn(
          (args: { where: { assetId: string; status: { in: string[] } } }) => {
            if (transcode === 'throws')
              return Promise.reject(new Error('connection reset'));
            const hit = transcode && args.where.status.in.includes(transcode);
            return Promise.resolve(hit ? { status: transcode } : null);
          },
        ),
      },
    };
    const uploads: Array<{ path: string; bytes: Buffer; mime: string }> = [];
    const deleted: string[] = [];
    const storage = {
      upload: jest.fn((p: string, bytes: Buffer, mime: string) => {
        uploads.push({ path: p, bytes, mime });
        return Promise.resolve(`${PREFIX}${p}`);
      }),
      delete: jest.fn((p: string) => {
        deleted.push(p);
        return Promise.resolve();
      }),
      download: jest.fn((p: string) =>
        Promise.resolve(p === OLD_PATH ? ORIGINAL : null),
      ),
      publicUrlForPath: (p: string) => `${PREFIX}${p}`,
      extractPath: (u: string) =>
        u.startsWith(PREFIX) ? u.slice(PREFIX.length) : null,
    };
    const service = new VideoPosterService(
      { client: db } as unknown as PrismaService,
      storage as unknown as SupabaseStorageService,
    );
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    spies.push(log, warn);
    return {
      service,
      db,
      storage,
      rows,
      uploads,
      deleted,
      /** Every write that moved a row's file (the probe's writes never do). */
      swaps: () =>
        asset.updateMany.mock.calls
          .map((c) => c[0])
          .filter((a) => 'fileUrl' in a.data),
      /** Every log / warn line, as text. */
      lines: () =>
        [...log.mock.calls, ...warn.mock.calls].map((c: unknown[]) =>
          String(c[0]),
        ),
      /** Queue (or finish) a signage transcode for the asset mid-test. */
      setTranscode: (state: typeof transcode) => {
        transcode = state;
      },
    };
  }

  beforeEach(() => {
    remuxMock.mockReset();
    remuxMock.mockResolvedValue(REMUX_OK);
    posterBufferMock.mockResolvedValue({ ok: false, reason: 'no poster here' });
    posterUrlMock.mockResolvedValue({ ok: false, reason: 'no poster here' });
    // The ORIGINAL reads index-at-the-tail; the re-muxed copy, index-in-front.
    probeBufferMock.mockImplementation((bytes) =>
      Promise.resolve(bytes === FIXED ? FRONT_PROBE : TAIL_PROBE),
    );
    probeUrlMock.mockImplementation((url) =>
      Promise.resolve(url.includes('-faststart-') ? FRONT_PROBE : TAIL_PROBE),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
    delete process.env.VIDEO_FASTSTART_REMUX_DISABLED;
  });

  it('re-muxes after the probe reads the index at the tail, then moves the row onto the copy in ONE tenant-scoped write guarded by the old URL', async () => {
    const w = remuxWorld();

    const result = await w.service.processVideo(BYTES_JOB, { remux: 'sync' });

    expect(result).toEqual({ probed: true, posterUrl: null, remux: 'remuxed' });
    // A lossless re-mux of the bytes the upload already holds — no download.
    expect(remuxMock).toHaveBeenCalledWith({ buffer: ORIGINAL, ext: '.mp4' });
    expect(w.storage.download).not.toHaveBeenCalled();
    // The probe's facts were saved BEFORE the re-mux ran.
    expect(w.db.asset.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      remuxMock.mock.invocationCallOrder[0],
    );
    // The copy sits beside the original, under a fresh name, as an MP4.
    expect(w.uploads).toHaveLength(1);
    const copy = w.uploads[0];
    expect(copy.path).toMatch(
      /^tenant-1\/0c5e-clip-faststart-[0-9a-f]{8}\.mp4$/,
    );
    expect(copy.bytes).toBe(FIXED);
    expect(copy.mime).toBe('video/mp4');
    // ONE swap: tenant-scoped, and guarded by the URL the re-mux started from.
    const swaps = w.swaps();
    expect(swaps).toHaveLength(1);
    expect(swaps[0].where).toEqual({
      id: 'asset-1',
      tenantId: 'tenant-1',
      fileUrl: OLD_URL,
    });
    expect(swaps[0].data).toMatchObject({
      fileUrl: `${PREFIX}${copy.path}`,
      fileSize: FIXED.length,
      // The player's cache refuses bytes that do not match this digest.
      fileHash: createHash('sha256').update(FIXED).digest('hex'),
    });
    const row = w.rows[0];
    expect(row.fileUrl).toBe(`${PREFIX}${copy.path}`);
    expect(row.processingMeta).toMatchObject({
      originalDimensions: { w: 1920, h: 1080 },
      probe: { probeVersion: 2, fastStart: true, codec: 'h264' },
      remux: {
        reason: 'fast-start',
        previousStoragePath: OLD_PATH,
        bytesBefore: ORIGINAL.length,
        bytesAfter: FIXED.length,
      },
    });
    const { remux } = row.processingMeta as { remux: { at: string } };
    expect(Number.isNaN(Date.parse(remux.at))).toBe(false);
    // Stable: the auto-heal cron's predicate (needsProbe is its in-process
    // twin) never selects the swapped row again.
    expect(needsProbe(row.processingMeta)).toBe(false);
    expect(w.lines().some((l) => l.includes('index moved to the front'))).toBe(
      true,
    );
  });

  it('KEEPS the original object: widget configs, fleet rows and emergency columns hold copies of its URL', async () => {
    const w = remuxWorld();
    await w.service.processVideo(BYTES_JOB, { remux: 'sync' });
    expect(w.swaps()).toHaveLength(1);
    expect(w.storage.delete).not.toHaveBeenCalled();
  });

  it("a swap that matches no row (another replica moved it first) changes nothing and deletes ONLY this attempt's copy", async () => {
    const w = remuxWorld();
    const winner = `${PREFIX}tenant-1/0c5e-clip-faststart-0a0b0c0d.mp4`;
    remuxMock.mockImplementationOnce(() => {
      w.rows[0].fileUrl = winner; // the other replica's swap lands meanwhile
      return Promise.resolve(REMUX_OK);
    });

    const result = await w.service.processVideo(BYTES_JOB, { remux: 'sync' });

    expect(result.remux).toBe('skipped');
    expect(w.swaps()).toHaveLength(1); // attempted, guarded, matched nothing
    expect(w.rows[0].fileUrl).toBe(winner);
    // Never the original, never the winner's copy — only our own.
    expect(w.deleted).toEqual([w.uploads[0].path]);
  });

  it('an asset deleted during the re-mux gets no swap, and the copy is dropped', async () => {
    const w = remuxWorld();
    remuxMock.mockImplementationOnce(() => {
      w.rows.length = 0;
      return Promise.resolve(REMUX_OK);
    });
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'skipped' });
    expect(w.swaps()).toEqual([]);
    expect(w.deleted).toEqual([w.uploads[0].path]);
  });

  it.each([
    ['a protected (system-owned) emergency playlist', 'playlist'],
    ['a tenant emergency / panic playlist', 'tenant'],
    ['a per-screen emergency playlist', 'screen'],
  ] as const)('never re-muxes a video in %s', async (_label, model) => {
    const w = remuxWorld();
    w.db.playlistItem.findMany.mockResolvedValue([{ playlistId: 'pl-lock' }]);
    w.db[model].findFirst.mockResolvedValue({ id: `${model}-1` });

    const result = await w.service.processVideo(BYTES_JOB, { remux: 'sync' });

    expect(result.remux).toBe('skipped');
    expect(remuxMock).not.toHaveBeenCalled();
    expect(w.uploads).toEqual([]);
    expect(w.swaps()).toEqual([]);
    expect(w.rows[0].fileUrl).toBe(OLD_URL);
    expect(w.lines().some((l) => l.includes('emergency content'))).toBe(true);
  });

  it.each([
    ["a screen's emergency media (a raw URL copy)", 'screen'],
    ['the media of a live per-screen override', 'screenEmergencyOverride'],
    ['the media of a live emergency message', 'emergencyMessage'],
  ] as const)('never re-muxes a video that is %s', async (_label, model) => {
    const w = remuxWorld();
    w.db[model].findFirst.mockResolvedValue({ id: `${model}-1` });
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'skipped' });
    expect(remuxMock).not.toHaveBeenCalled();
    expect(w.rows[0].fileUrl).toBe(OLD_URL);
  });

  it('reads every column the never-evict cache tier is built from — across tenants, not just this one', async () => {
    const w = remuxWorld();
    w.db.playlistItem.findMany.mockResolvedValue([
      { playlistId: 'pl-1' },
      { playlistId: 'pl-1' },
    ]);

    await w.service.processVideo(BYTES_JOB, { remux: 'sync' });

    expect(w.db.playlistItem.findMany.mock.calls[0][0].where).toEqual({
      assetId: 'asset-1',
    });
    expect(w.db.playlist.findFirst.mock.calls[0][0].where).toEqual({
      id: { in: ['pl-1'] },
      isProtected: true,
    });
    const tenantQuery = w.db.tenant.findFirst.mock.calls[0][0];
    expect(orOf(tenantQuery)).toHaveLength(14);
    expect(orOf(tenantQuery)).toContainEqual({
      panicLockdownPlaylistId: { in: ['pl-1'] },
    });
    expect(orOf(tenantQuery)).toContainEqual({
      emergencyPortraitPlaylistId: { in: ['pl-1'] },
    });
    // A district playlist can hold a school's asset: no tenant filter here.
    expect(tenantQuery.where).not.toHaveProperty('id');
    const screenPlaylists = w.db.screen.findFirst.mock.calls[0][0];
    expect(orOf(screenPlaylists)).toHaveLength(12);
    expect(orOf(screenPlaylists)).toContainEqual({
      emergencyMedicalPortraitPlaylistId: { in: ['pl-1'] },
    });
    const screenMedia = w.db.screen.findFirst.mock.calls[1][0];
    expect(orOf(screenMedia)).toHaveLength(12);
    expect(orOf(screenMedia)).toContainEqual({
      emergencyLockdownAssetUrl: OLD_URL,
    });
  });

  it('fails CLOSED: an emergency check that cannot run leaves the file alone', async () => {
    const w = remuxWorld();
    w.db.playlistItem.findMany.mockRejectedValue(new Error('pool timeout'));
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'skipped' });
    expect(remuxMock).not.toHaveBeenCalled();
    expect(
      w.lines().some((l) => l.includes('the emergency check could not run')),
    ).toBe(true);
  });

  it('looks again right before the swap: a video that became emergency content during the re-mux is left alone', async () => {
    const w = remuxWorld();
    w.db.screen.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'gym-wing' });

    const result = await w.service.processVideo(BYTES_JOB, { remux: 'sync' });

    expect(result.remux).toBe('skipped');
    expect(w.uploads).toHaveLength(1);
    expect(w.deleted).toEqual([w.uploads[0].path]);
    expect(w.swaps()).toEqual([]);
    expect(w.rows[0].fileUrl).toBe(OLD_URL);
  });

  it('never re-muxes a file another asset row also points at — fleet distribution: one object, a row per location', async () => {
    const w = remuxWorld([
      assetRow(),
      assetRow({ id: 'asset-school-2', tenantId: 'school-2' }),
    ]);
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'skipped' });
    expect(remuxMock).not.toHaveBeenCalled();
    // A GLOBAL count: the other row lives in another tenant.
    expect(w.db.asset.count).toHaveBeenCalledWith({
      where: { fileUrl: OLD_URL, id: { not: 'asset-1' } },
    });
  });

  it.each([
    ['a linked URL', 'https://cdn.example.com/clip.mp4'],
    ["a file in another tenant's folder", `${PREFIX}district-1/0c5e-clip.mp4`],
  ])('never re-muxes %s', async (_label, fileUrl) => {
    const w = remuxWorld([assetRow({ fileUrl })]);
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'skipped' });
    expect(remuxMock).not.toHaveBeenCalled();
    expect(w.rows[0].fileUrl).toBe(fileUrl);
  });

  it('DEFERS to a signage transcode queued or running for the asset — its swap must find the row unchanged, and its output is fast-start', async () => {
    for (const status of ['queued', 'running'] as const) {
      const w = remuxWorld([assetRow()], { transcode: status });
      await expect(
        w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
      ).resolves.toMatchObject({ probed: true, remux: 'skipped' });
      expect(remuxMock).not.toHaveBeenCalled();
      expect(w.swaps()).toHaveLength(0);
      expect(
        w.lines().some((l) => l.includes(`a signage transcode is ${status}`)),
      ).toBe(true);
      // The facts still landed — only the fix waits.
      expect(w.rows[0].processingMeta).toMatchObject({
        probe: { fastStart: false },
      });
    }
  });

  it('a transcode that already finished (kept the original) does not stand in the way', async () => {
    const w = remuxWorld([assetRow()], { transcode: 'done' });
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'remuxed' });
    expect(w.swaps()).toHaveLength(1);
  });

  it('fails CLOSED: a transcode-queue read that cannot run leaves the file alone', async () => {
    const w = remuxWorld([assetRow()], { transcode: 'throws' });
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'skipped' });
    expect(remuxMock).not.toHaveBeenCalled();
    expect(
      w
        .lines()
        .some((l) =>
          l.includes('could not confirm that no signage transcode is queued'),
        ),
    ).toBe(true);
  });

  it('looks again right before the swap: a transcode queued during the re-mux wins, and the copy is dropped', async () => {
    const w = remuxWorld();
    remuxMock.mockImplementation(() => {
      w.setTranscode('queued');
      return Promise.resolve(REMUX_OK);
    });
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'skipped' });
    expect(w.swaps()).toHaveLength(0);
    expect(w.uploads).toHaveLength(1);
    expect(w.deleted).toEqual([w.uploads[0].path]);
    expect(w.rows[0].fileUrl).toBe(OLD_URL);
  });

  it('poster: false runs the probe and the fast-start step without cutting a poster (the transcode worker’s pass)', async () => {
    const w = remuxWorld();
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync', poster: false }),
    ).resolves.toEqual({ probed: true, posterUrl: null, remux: 'remuxed' });
    expect(posterBufferMock).not.toHaveBeenCalled();
    expect(posterUrlMock).not.toHaveBeenCalled();
    expect(w.swaps()).toHaveLength(1);
  });

  it('skips when the row no longer points at the file that was probed', async () => {
    const w = remuxWorld();
    await expect(
      w.service.processVideo(
        { ...JOB, storagePath: 'tenant-1/some-other.mp4', ext: '.mp4' },
        { remux: 'sync' },
      ),
    ).resolves.toMatchObject({ remux: 'skipped' });
    expect(remuxMock).not.toHaveBeenCalled();
  });

  it("never re-muxes a row twice — and a late probe of the ORIGINAL never overwrites the copy's facts", async () => {
    const w = remuxWorld();
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'remuxed' });
    const settled = JSON.stringify(w.rows[0]);

    // The original's bytes again (a retried upload job) and the original's
    // path (a "Check this file" that read the old URL just before the swap):
    // their facts describe a file the row no longer plays — nothing written.
    for (const job of [BYTES_JOB, PATH_JOB]) {
      await expect(
        w.service.processVideo(job, { remux: 'sync' }),
      ).resolves.toMatchObject({ probed: false, remux: 'not-needed' });
    }
    expect(JSON.stringify(w.rows[0])).toBe(settled);

    // The copy itself (the cron, a later check): fast-start, nothing to do.
    await expect(
      w.service.processVideo(
        { ...JOB, storagePath: w.uploads[0].path, ext: '.mp4' },
        { remux: 'sync' },
      ),
    ).resolves.toMatchObject({ probed: true, remux: 'not-needed' });

    expect(remuxMock).toHaveBeenCalledTimes(1);
    expect(w.uploads).toHaveLength(1);
    expect(w.swaps()).toHaveLength(1);
    expect(w.rows[0].processingMeta).toMatchObject({
      probe: { fastStart: true },
      remux: { previousStoragePath: OLD_PATH },
    });
  });

  it('a row that carries a remux record is never re-muxed again, whatever a probe says', async () => {
    const w = remuxWorld([
      assetRow({
        processingMeta: {
          remux: {
            reason: 'fast-start',
            previousStoragePath: 'tenant-1/older.mp4',
          },
        },
      }),
    ]);
    await expect(
      w.service.processVideo(PATH_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ probed: true, remux: 'skipped' });
    expect(remuxMock).not.toHaveBeenCalled();
    expect(w.lines().some((l) => l.includes('already fast-start'))).toBe(true);
  });

  it('VIDEO_FASTSTART_REMUX_DISABLED=1 leaves every file exactly as it is', async () => {
    process.env.VIDEO_FASTSTART_REMUX_DISABLED = '1';
    const w = remuxWorld();
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toEqual({ probed: true, posterUrl: null, remux: 'skipped' });
    expect(remuxMock).not.toHaveBeenCalled();
    expect(w.rows[0].fileUrl).toBe(OLD_URL);
    expect(
      w.lines().some((l) => l.includes('VIDEO_FASTSTART_REMUX_DISABLED=1')),
    ).toBe(true);
  });

  it("'skip' probes and grabs the poster but never re-muxes", async () => {
    const w = remuxWorld();
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'skip' }),
    ).resolves.toEqual({ probed: true, posterUrl: null, remux: 'skipped' });
    expect(remuxMock).not.toHaveBeenCalled();
    expect(w.rows[0].processingMeta).toMatchObject({
      probe: { fastStart: false },
    });
  });

  it('a re-mux that fails leaves fileUrl AND meta exactly as the probe left them — no failure stamp, never a throw', async () => {
    const w = remuxWorld();
    remuxMock.mockResolvedValue({
      ok: false,
      reason: 'ffmpeg exited 1: Invalid data found',
    });

    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toEqual({ probed: true, posterUrl: null, remux: 'failed' });

    const row = w.rows[0];
    expect(row.fileUrl).toBe(OLD_URL);
    expect(row.fileHash).toBe('sha-of-the-original');
    expect(row.processingMeta).toMatchObject({ probe: { fastStart: false } });
    expect(row.processingMeta).not.toHaveProperty('remux');
    expect(row.processingMeta).not.toHaveProperty('probeFailed');
    expect(w.uploads).toEqual([]);
    expect(w.swaps()).toEqual([]);
    expect(
      w
        .lines()
        .some((l) =>
          l.includes('re-mux failed, file left as it was: ffmpeg exited 1'),
        ),
    ).toBe(true);
  });

  it('a re-mux that THROWS is swallowed the same way', async () => {
    const w = remuxWorld();
    remuxMock.mockRejectedValue(new Error('ffmpeg exploded'));
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'failed' });
    expect(w.rows[0].fileUrl).toBe(OLD_URL);
    expect(w.uploads).toEqual([]);
  });

  it('a copy that does not probe as the same media is never stored', async () => {
    const w = remuxWorld();
    probeBufferMock.mockImplementation((bytes) =>
      Promise.resolve(
        bytes === FIXED ? { ...FRONT_PROBE, audio: null } : TAIL_PROBE,
      ),
    );
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'failed' });
    expect(w.uploads).toEqual([]);
    expect(w.swaps()).toEqual([]);
    expect(w.lines().some((l) => l.includes('audio aac/2ch → none'))).toBe(
      true,
    );
  });

  it('an upload that fails swaps nothing, and drops whatever may have landed', async () => {
    const w = remuxWorld();
    w.storage.upload.mockRejectedValueOnce(new Error('upload failed (502)'));
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'failed' });
    expect(w.swaps()).toEqual([]);
    expect(w.rows[0].fileUrl).toBe(OLD_URL);
    expect(w.deleted).toHaveLength(1);
    expect(w.deleted[0]).toMatch(/-faststart-[0-9a-f]{8}\.mp4$/);
  });

  it('a swap that throws before committing: a read proves the row untouched, so the copy is dropped', async () => {
    const w = remuxWorld([assetRow()], { swap: 'throws' });
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'failed' });
    expect(w.rows[0].fileUrl).toBe(OLD_URL);
    expect(w.deleted).toEqual([w.uploads[0].path]);
  });

  it('a swap that throws AFTER committing (a dropped connection) counts: a read proves it landed', async () => {
    const w = remuxWorld([assetRow()], { swap: 'throws-after-commit' });
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'remuxed' });
    expect(w.rows[0].fileUrl).toBe(`${PREFIX}${w.uploads[0].path}`);
    expect(w.deleted).toEqual([]);
  });

  it('a swap whose outcome cannot be read KEEPS the copy — nothing is deleted on a guess', async () => {
    const w = remuxWorld([assetRow()], { swap: 'throws-unreadable' });
    await expect(
      w.service.processVideo(BYTES_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ remux: 'failed' });
    expect(w.deleted).toEqual([]);
    expect(w.lines().some((l) => l.includes(`kept ${w.uploads[0].path}`))).toBe(
      true,
    );
  });

  it("'async' — the default, and what the upload path, the cron and check-playback use — answers 'scheduled' at once; the swap lands after", async () => {
    const w = remuxWorld();
    await expect(w.service.processVideo(BYTES_JOB)).resolves.toEqual({
      probed: true,
      posterUrl: null,
      remux: 'scheduled',
    });
    await w.service.whenRemuxIdle();
    expect(w.swaps()).toHaveLength(1);
    expect(w.rows[0].fileUrl).toBe(`${PREFIX}${w.uploads[0].path}`);
  });

  it('kickOff (the upload path) queues it too', async () => {
    const w = remuxWorld();
    w.service.kickOff(BYTES_JOB);
    for (let i = 0; i < 50 && remuxMock.mock.calls.length === 0; i++)
      await tick();
    await w.service.whenRemuxIdle();
    expect(w.swaps()).toHaveLength(1);
  });

  it('presign / cron / check-playback: re-muxes the stored object, downloaded ONCE and shared with the poster', async () => {
    const w = remuxWorld();
    await expect(
      w.service.processVideo(PATH_JOB, { remux: 'sync' }),
    ).resolves.toMatchObject({ probed: true, remux: 'remuxed' });
    expect(probeUrlMock).toHaveBeenCalledWith(OLD_URL, PREFIX);
    expect(w.storage.download).toHaveBeenCalledTimes(1);
    expect(w.storage.download).toHaveBeenCalledWith(OLD_PATH);
    expect(remuxMock).toHaveBeenCalledWith({ buffer: ORIGINAL, ext: '.mp4' });
  });

  it('runs ONE re-mux at a time per replica, and never queues the same asset twice', async () => {
    const w = remuxWorld([
      assetRow(),
      assetRow({ id: 'asset-2', fileUrl: `${PREFIX}tenant-1/second.mp4` }),
    ]);
    let release: () => void = () => undefined;
    remuxMock.mockImplementationOnce(
      () =>
        new Promise<RemuxOutcome>((resolve) => {
          release = () => resolve(REMUX_OK);
        }),
    );

    await expect(w.service.processVideo(BYTES_JOB)).resolves.toMatchObject({
      remux: 'scheduled',
    });
    for (let i = 0; i < 50 && remuxMock.mock.calls.length === 0; i++)
      await tick();
    expect(remuxMock).toHaveBeenCalledTimes(1);

    // The same asset again while its re-mux runs: not queued twice.
    await expect(w.service.processVideo(BYTES_JOB)).resolves.toMatchObject({
      remux: 'skipped',
    });
    // Another asset: queued BEHIND the running one, never beside it.
    await expect(
      w.service.processVideo({ ...BYTES_JOB, assetId: 'asset-2' }),
    ).resolves.toMatchObject({ remux: 'scheduled' });
    for (let i = 0; i < 10; i++) await tick();
    expect(remuxMock).toHaveBeenCalledTimes(1);

    release();
    await w.service.whenRemuxIdle();
    expect(remuxMock).toHaveBeenCalledTimes(2);
    expect(w.swaps()).toHaveLength(2);
  });
});
