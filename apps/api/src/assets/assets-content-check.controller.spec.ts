/**
 * POST /assets/complete-upload refuses what is not a playable file (2026-10-05).
 *
 * Drives the REAL handler with the REAL content check, the REAL upload optimizer
 * and tiny REAL files (made with the box's ffmpeg) served the way Supabase serves
 * them — the classes the media beta test uploaded and saw end "Ready"
 * (docs/research/2026-10-04-media-matrix/limits-findings.md PART A). Pins:
 *   1. every bad class is a 422 with a stable code and plain words; the stored
 *      object is DELETED and no Asset row is created (no debris);
 *   2. good JPEG / PNG / animated GIF / BMP / MP4 / audio / PDF are created;
 *   3. a check that could not run (storage answering 500) ACCEPTS — exactly as
 *      before — even a file that would have been refused;
 *   4. zero bytes says "This file is empty", at presign and at complete-upload.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { promises as fs } from 'fs';
import { MediaOptimizationService } from '../storage/media-optimization.service';
import { AssetsController } from './assets.controller';
import { UploadContentCheckService } from './upload-content-check.service';
import {
  buildUploadCorpus,
  CorpusServer,
  hasMediaTools,
  makeCorpusDir,
  type UploadCorpus,
} from './upload-corpus.fixture-spec';

const TENANT = 'tenant-1';
let uuidN = 0;
/** A fresh presign-shaped path: `<tenant>/<uuid><ext>`. */
const mintPath = (ext: string) =>
  `${TENANT}/0f6b1c2d-3e4f-4a5b-8c9d-${String(++uuidN).padStart(12, '0')}${ext}`;

function makePrisma() {
  return {
    client: {
      assetFolder: { findFirst: jest.fn(async () => null) },
      asset: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({
          id: 'asset-new',
          altText: null,
          createdAt: new Date(),
          ...data,
        })),
        update: jest.fn(async ({ data }: any) => ({
          id: 'asset-new',
          ...data,
        })),
      },
      auditLog: { create: jest.fn(async () => ({ id: 'audit-1' })) },
      notification: { createMany: jest.fn(async () => ({ count: 0 })) },
      user: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => null),
      },
      tenant: { findUnique: jest.fn(async () => null) },
    },
  } as any;
}

function makeStorage(server: CorpusServer) {
  return {
    toSafeBuffer: (b: any) => (Buffer.isBuffer(b) ? b : Buffer.from(b)),
    publicUrlForPath: (p: string) => server.publicUrlForPath(p),
    assetsBucketCap: () => 500 * 1024 * 1024,
    assertObjectExists: jest.fn(async () => undefined),
    getObjectInfo: jest.fn(async (p: string) => {
      const b = server.objects.get(p);
      return b ? { size: b.length, contentType: null } : null;
    }),
    download: jest.fn(async (p: string) =>
      server.mode === 'normal' ? (server.objects.get(p) ?? null) : null,
    ),
    readObjectRange: jest.fn(async (p: string, s: number, e: number) =>
      server.range(p, s, e),
    ),
    upload: jest.fn(async (p: string) => server.publicUrlForPath(p)),
    delete: jest.fn(async () => undefined),
    createSignedUploadUrl: jest.fn(),
  } as any;
}

function makeController(storage: any, withCheck = true, transcodes?: any) {
  const prisma = makePrisma();
  const controller = new AssetsController(
    prisma,
    storage,
    {} as any,
    new MediaOptimizationService(),
    { generateImageAltText: jest.fn(async () => null) } as any,
    { kickOff: jest.fn() } as any,
    transcodes,
    undefined,
    undefined,
    undefined,
    withCheck ? new UploadContentCheckService(storage) : undefined,
  );
  return { controller, prisma };
}

const req = { user: { tenantId: TENANT, id: 'user-1', role: 'SCHOOL_ADMIN' } };

async function caught(
  fn: () => Promise<unknown>,
): Promise<HttpException | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof HttpException) return e;
    throw e;
  }
}

describe('presign — zero bytes', () => {
  it('a 0-byte file is "empty", not "File size is required." — and no upload token is minted', async () => {
    const storage = {
      createSignedUploadUrl: jest.fn(),
      assetsBucketCap: () => null,
    } as any;
    const { controller } = makeController(storage, false);
    const err = await caught(() =>
      controller.presignUpload(req as any, {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        size: 0,
      }),
    );
    expect(err?.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(err?.getResponse()).toEqual(
      expect.objectContaining({
        code: 'ASSET_FILE_EMPTY',
        message: expect.stringMatching(/^This file is empty/),
      }),
    );
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('a missing size keeps its own refusal', async () => {
    const { controller } = makeController(
      { assetsBucketCap: () => null } as any,
      false,
    );
    const err = await caught(() =>
      controller.presignUpload(req as any, {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      }),
    );
    expect((err?.getResponse() as any)?.code).toBe('ASSET_FILE_SIZE_REQUIRED');
  });

  it('over the ceiling: the refusal carries the real limit, so the page can say it', async () => {
    const storage = {
      createSignedUploadUrl: jest.fn(),
      assetsBucketCap: () => 500 * 1024 * 1024,
    } as any;
    const { controller } = makeController(storage, false);
    const err = await caught(() =>
      controller.presignUpload(req as any, {
        filename: 'big.mp4',
        contentType: 'video/mp4',
        size: 700 * 1000 * 1000,
      }),
    );
    expect(err?.getStatus()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(err?.getResponse()).toEqual({
      code: 'ASSET_FILE_TOO_LARGE',
      message: 'File is too large. Max size is 500 MB.',
      maxFileSize: 500 * 1024 * 1024,
    });
  });
});

if (!hasMediaTools) {
  console.warn(
    '[assets-content-check.controller.spec] ffmpeg/ffprobe not found — the real-file cases are SKIPPED (the production image ships both).',
  );
}

(hasMediaTools ? describe : describe.skip)(
  'complete-upload against REAL files',
  () => {
    jest.setTimeout(120_000);
    let dir = '';
    let corpus: UploadCorpus;
    const server = new CorpusServer();

    beforeAll(async () => {
      dir = await makeCorpusDir();
      corpus = await buildUploadCorpus(dir);
      await server.start();
    });
    afterAll(async () => {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    });
    afterEach(() => {
      server.mode = 'normal';
    });

    /** Put the case's bytes at a fresh presign-shaped path, then finalize it. */
    async function finalize(
      name: string,
      opts: { withCheck?: boolean; bytes?: Buffer; transcodes?: any } = {},
    ) {
      const f = corpus[name];
      const storagePath = mintPath(f.ext);
      const bytes = opts.bytes ?? f.bytes;
      server.objects.set(storagePath, bytes);
      const storage = makeStorage(server);
      const { controller, prisma } = makeController(
        storage,
        opts.withCheck !== false,
        opts.transcodes,
      );
      const filename = `${name}${f.ext}`;
      let result: any = null;
      const err = await caught(async () => {
        result = await controller.completeUpload(req as any, {
          storagePath,
          filename,
          contentType: f.mime,
          size: bytes.length || 1,
        });
      });
      return { err, result, storage, prisma, storagePath };
    }

    it.each([
      ['good-mp4'],
      ['good-mp4-moov-last'],
      ['ts-as-mp4'],
      ['good-jpg'],
      ['good-png'],
      ['anim-gif'],
      ['good-bmp'],
      ['good-pdf'],
      ['good-m4a'],
    ])('ACCEPTS %s — the Asset row is created', async (name) => {
      const { err, result, storage, prisma, storagePath } =
        await finalize(name);
      expect(err).toBeNull();
      expect(prisma.client.asset.create).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('asset-new');
      // Nothing was deleted BEFORE the row existed (an optimized picture's old
      // path is removed only after its re-encode is uploaded and adopted).
      const created = prisma.client.asset.create.mock.invocationCallOrder[0];
      for (const [i, call] of storage.delete.mock.calls.entries()) {
        if (call[0] === storagePath)
          expect(storage.delete.mock.invocationCallOrder[i]).toBeGreaterThan(
            created,
          );
      }
    });

    it('ACCEPTS an animated GIF untouched — still every frame, never re-encoded', async () => {
      const { err, prisma, storage } = await finalize('anim-gif');
      expect(err).toBeNull();
      expect(storage.upload).not.toHaveBeenCalled();
      expect(prisma.client.asset.create.mock.calls[0][0].data.mimeType).toBe(
        'image/gif',
      );
    });

    it.each([
      ['text-as-mp4', 'ASSET_VIDEO_UNPLAYABLE'],
      ['zip-as-mp4', 'ASSET_VIDEO_UNPLAYABLE'],
      ['trunc50-moov-first', 'ASSET_VIDEO_UNPLAYABLE'],
      ['trunc90-moov-first', 'ASSET_VIDEO_UNPLAYABLE'],
      ['trunc97-moov-first', 'ASSET_VIDEO_UNPLAYABLE'],
      ['trunc50-moov-last', 'ASSET_VIDEO_UNPLAYABLE'],
      ['sound-only-as-mp4', 'ASSET_VIDEO_NO_PICTURE'],
      ['jpeg-as-mp4', 'ASSET_VIDEO_IS_PICTURE'],
      ['mp4-as-png', 'ASSET_IMAGE_UNREADABLE'],
      ['text-as-jpg', 'ASSET_IMAGE_UNREADABLE'],
      ['html-as-jpg', 'ASSET_IMAGE_UNREADABLE'],
      ['text-as-gif', 'ASSET_IMAGE_UNREADABLE'],
      ['html-as-pdf', 'ASSET_PDF_NOT_PDF'],
      ['mp4-as-pdf', 'ASSET_PDF_NOT_PDF'],
      ['trunc-pdf', 'ASSET_PDF_INCOMPLETE'],
      ['text-as-m4a', 'ASSET_AUDIO_UNPLAYABLE'],
      ['video-only-as-m4a', 'ASSET_AUDIO_UNPLAYABLE'],
    ])(
      'REFUSES %s: 422 %s, the object is deleted, no Asset row',
      async (name, code) => {
        const { err, storage, prisma, storagePath } = await finalize(name);
        expect(err?.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        const body = err?.getResponse() as any;
        expect(body.code).toBe(code);
        expect(body.message).toMatch(/upload/i);
        expect(body.message).not.toMatch(/ffmpeg|ffprobe|moov|codec/i);
        expect(storage.delete).toHaveBeenCalledWith(storagePath);
        expect(prisma.client.asset.create).not.toHaveBeenCalled();
        expect(storage.upload).not.toHaveBeenCalled();
      },
    );

    it('REFUSES a 0-byte stored object with "This file is empty" (a client that claimed a size and sent nothing)', async () => {
      const { err, storage, prisma, storagePath } = await finalize('good-mp4', {
        bytes: Buffer.alloc(0),
      });
      expect(err?.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect((err?.getResponse() as any).code).toBe('ASSET_FILE_EMPTY');
      expect(storage.delete).toHaveBeenCalledWith(storagePath);
      expect(prisma.client.asset.create).not.toHaveBeenCalled();
    });

    it.each([
      'text-as-mp4',
      'trunc90-moov-first',
      'text-as-jpg',
      'trunc-pdf',
      'text-as-m4a',
    ])(
      'storage answering 500 means the check could not run: %s is ACCEPTED exactly as before',
      async (name) => {
        server.mode = 'error500';
        const { err, prisma } = await finalize(name);
        expect(err).toBeNull();
        expect(prisma.client.asset.create).toHaveBeenCalledTimes(1);
      },
    );

    it('without the check (a build that does not wire it) nothing changes: a text file named .mp4 is created as before', async () => {
      const { err, prisma } = await finalize('text-as-mp4', {
        withCheck: false,
      });
      expect(err).toBeNull();
      expect(prisma.client.asset.create).toHaveBeenCalledTimes(1);
    });

    // ── 2026-10-05 — the screen-ready verdict exists from the moment of upload ──
    //
    // The REAL check's ffprobe of the REAL stored bytes decides it, and it is
    // written IN the create — the row never exists without it.
    describe('the screen-ready verdict is written in the create', () => {
      /** The signage transcode queue, as the controller sees it. */
      const queue = () => ({ enqueue: jest.fn(async () => true) });
      const createdMeta = (prisma: any) =>
        prisma.client.asset.create.mock.calls[0][0].data.processingMeta;

      afterEach(() => {
        delete process.env.VIDEO_TRANSCODE_DISABLED;
        delete process.env.UPLOAD_CONTENT_CHECK_DISABLED;
      });

      it('a screen-safe H.264 MP4 → { version: 1, ready: true, checkedAt }', async () => {
        const { err, prisma } = await finalize('good-mp4', { transcodes: queue() });
        expect(err).toBeNull();
        expect(createdMeta(prisma)).toEqual({
          screen: { version: 1, ready: true, checkedAt: expect.any(String) },
        });
      });

      it('a video that must be converted first (an MPEG-TS under a .mp4 name) → { ready: false, pending: true, issues } — and its conversion is queued', async () => {
        const transcodes = queue();
        const { err, prisma } = await finalize('ts-as-mp4', { transcodes });
        expect(err).toBeNull();
        expect(createdMeta(prisma)).toEqual({
          screen: {
            version: 1,
            ready: false,
            pending: true,
            issues: expect.arrayContaining(['container']),
            checkedAt: expect.any(String),
          },
        });
        expect(transcodes.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({ assetId: 'asset-new', tenantId: TENANT }),
        );
      });

      it('the probe could not run (storage answering 500) → NO stamp: unknown stays unknown', async () => {
        server.mode = 'error500';
        const { err, prisma } = await finalize('ts-as-mp4', { transcodes: queue() });
        expect(err).toBeNull();
        expect(createdMeta(prisma)).toBeUndefined();
      });

      it('no conversion would run (VIDEO_TRANSCODE_DISABLED=1) → no "pending" that nothing would ever settle; the file goes out as before', async () => {
        process.env.VIDEO_TRANSCODE_DISABLED = '1';
        const { err, prisma } = await finalize('ts-as-mp4', { transcodes: queue() });
        expect(err).toBeNull();
        expect(createdMeta(prisma)).toBeUndefined();
      });

      it('…and a build with no transcode queue at all behaves the same', async () => {
        const { err, prisma } = await finalize('ts-as-mp4');
        expect(err).toBeNull();
        expect(createdMeta(prisma)).toBeUndefined();
      });

      it('…while a screen-safe file is still stamped ready without a queue (nothing needs converting)', async () => {
        const { prisma } = await finalize('good-mp4');
        expect(createdMeta(prisma)?.screen).toMatchObject({ version: 1, ready: true });
      });

      it('UPLOAD_CONTENT_CHECK_DISABLED=1 → no check, no stamp: exactly the pre-check behaviour', async () => {
        process.env.UPLOAD_CONTENT_CHECK_DISABLED = '1';
        const { err, prisma } = await finalize('ts-as-mp4', { transcodes: queue() });
        expect(err).toBeNull();
        expect(createdMeta(prisma)).toBeUndefined();
      });

      it('pictures, audio and PDFs are never stamped', async () => {
        for (const name of ['good-jpg', 'good-png', 'good-m4a', 'good-pdf']) {
          const { err, prisma } = await finalize(name, { transcodes: queue() });
          expect(err).toBeNull();
          expect(createdMeta(prisma)?.screen).toBeUndefined();
        }
      });
    });
  },
);
