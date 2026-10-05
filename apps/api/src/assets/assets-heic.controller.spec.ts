/**
 * A HEIC photo becomes a JPEG BEFORE the asset exists (2026-10-05) — on the
 * Media Library's direct path (complete-upload) and on /assets/upload.
 *
 * Drives the REAL handlers with the REAL content check, the REAL converter and
 * the REAL sharp; only heif-dec is a stand-in (a real child process that writes
 * the PNG heif-dec writes — Display-P3 numbers + the P3 profile — because this
 * box has no heif-dec; heif-convert.spec.ts runs the real one on Apple-written
 * HEICs through the production image). Pinned:
 *   1. called .heic, or HEIC bytes under a .jpg name: the JPEG is stored as a
 *      FRESH object, the HEIC is deleted after it, and the Asset row is created
 *      ONLY from the JPEG (image/jpeg, its size, its URL) — never HEIC;
 *   2. the stored JPEG is sRGB-correct and carries no EXIF;
 *   3. a HEIC that cannot be converted is refused: 422 ASSET_IMAGE_HEIC when the
 *      file is broken, 503 ASSET_IMAGE_HEIC_UNAVAILABLE when the conversion could
 *      not run (a hung decoder, storage refusing the JPEG) — and nothing is left;
 *   4. UPLOAD_CONTENT_CHECK_DISABLED does not turn the conversion off;
 *   5. a server without the converter refuses HEIC at presign, plainly.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { spawn as nodeSpawn, type SpawnOptions } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { MediaOptimizationService } from '../storage/media-optimization.service';
import { AssetsController } from './assets.controller';
import { UploadContentCheckService } from './upload-content-check.service';
import { CorpusServer } from './upload-corpus.fixture-spec';

const TENANT = 'tenant-1';
let uuidN = 0;
const mintPath = (ext: string) =>
  `${TENANT}/0f6b1c2d-3e4f-4a5b-8c9d-${String(++uuidN).padStart(12, '0')}${ext}`;
const req = { user: { tenantId: TENANT, id: 'user-1', role: 'SCHOOL_ADMIN' } };

/** The first bytes of every iPhone photo: an ISO-BMFF `ftyp` box, brand `heic`. */
function heicBytes(): Buffer {
  const brands = ['mif1', 'miaf', 'MiHB', 'heic'];
  const size = 16 + 4 * brands.length;
  const b = Buffer.alloc(size + 2048, 0x11);
  b.writeUInt32BE(size, 0);
  b.write('ftyp', 4, 'latin1');
  b.write('heic', 8, 'latin1');
  b.writeUInt32BE(0, 12);
  brands.forEach((x, i) => b.write(x, 16 + 4 * i, 'latin1'));
  return b;
}

/** A stand-in heif-dec: copies `png` to the output path heif-dec was given, prints `stderr`, exits — or hangs. */
function standIn(b: {
  png?: string;
  stderr?: string;
  exitCode?: number;
  hang?: boolean;
}) {
  return ((cmd: string, args: string[], opts: SpawnOptions) => {
    if (cmd !== 'heif-dec') throw new Error(`unexpected tool ${cmd}`);
    const script =
      "const fs=require('fs');const [png,out,stderr,code,hang]=process.argv.slice(1);" +
      'if(stderr)process.stderr.write(stderr);if(png)fs.copyFileSync(png,out);' +
      "if(hang==='1')setInterval(()=>{},1000);else process.exit(Number(code));";
    return nodeSpawn(
      process.execPath,
      [
        '-e',
        script,
        b.png ?? '',
        args[args.length - 1],
        b.stderr ?? '',
        String(b.exitCode ?? 0),
        b.hang ? '1' : '0',
      ],
      opts,
    );
  }) as unknown as typeof nodeSpawn;
}

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

function makeStorage(
  server: CorpusServer,
  opts: { storedType?: string; uploadFails?: boolean } = {},
) {
  const order: string[] = [];
  const uploads: Array<{ path: string; buffer: Buffer; mime: string }> = [];
  const storage = {
    order,
    uploads,
    toSafeBuffer: (b: any) => (Buffer.isBuffer(b) ? b : Buffer.from(b)),
    publicUrlForPath: (p: string) => server.publicUrlForPath(p),
    assetsBucketCap: () => 500 * 1024 * 1024,
    bucketName: () => 'assets',
    resumableUploadEndpoint: () =>
      `${server.base}/storage/v1/upload/resumable/sign`,
    assertObjectExists: jest.fn(async () => undefined),
    getObjectInfo: jest.fn(async (p: string) => {
      const b = server.objects.get(p);
      return b
        ? { size: b.length, contentType: opts.storedType ?? null }
        : null;
    }),
    download: jest.fn(async (p: string) => server.objects.get(p) ?? null),
    readObjectRange: jest.fn(async (p: string, s: number, e: number) =>
      server.range(p, s, e),
    ),
    upload: jest.fn(async (p: string, buffer: Buffer, mime: string) => {
      order.push(`upload ${p}`);
      if (opts.uploadFails) throw new Error('storage answered 503');
      uploads.push({ path: p, buffer, mime });
      return server.publicUrlForPath(p);
    }),
    delete: jest.fn(async (p: string) => {
      order.push(`delete ${p}`);
    }),
    createSignedUploadUrl: jest.fn(async (p: string) => ({
      path: p,
      token: 'tok',
      signedUrl: `${server.base}/u/${p}`,
      publicUrl: server.publicUrlForPath(p),
    })),
  };
  return storage as any;
}

function makeController(
  storage: any,
  check: UploadContentCheckService | undefined,
) {
  const prisma = makePrisma();
  const controller = new AssetsController(
    prisma,
    storage,
    {} as any,
    new MediaOptimizationService(),
    { generateImageAltText: jest.fn(async () => null) } as any,
    { kickOff: jest.fn() } as any,
    { enqueue: jest.fn(async () => true) } as any,
    undefined,
    undefined,
    undefined,
    check,
  );
  return { controller, prisma };
}

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

describe('HEIC at upload (complete-upload + /assets/upload)', () => {
  jest.setTimeout(60_000);
  const server = new CorpusServer();
  let dir = '';
  let p3Png = '';
  const PATCHES = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ];

  beforeAll(async () => {
    await server.start();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-heic-spec-'));
    // What heif-dec writes for an iPhone photo: P3 numbers + the P3 profile, 1200×800.
    const raw = Buffer.alloc(1200 * 800 * 3);
    for (let y = 0; y < 800; y++)
      for (let x = 0; x < 1200; x++)
        raw.set(PATCHES[Math.floor(x / 400)], (y * 1200 + x) * 3);
    p3Png = path.join(dir, 'p3.png');
    await sharp(raw, { raw: { width: 1200, height: 800, channels: 3 } })
      .withIccProfile('p3')
      .png()
      .toFile(p3Png);
  });
  afterAll(async () => {
    await server.stop();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  const checkWith = (b: Parameters<typeof standIn>[0]) => {
    const storageForCheck = {
      publicUrlForPath: (p: string) => server.publicUrlForPath(p),
    } as any;
    const check = new UploadContentCheckService(storageForCheck);
    check.spawnFn = standIn(b);
    return check;
  };

  async function finalize(o: {
    filename: string;
    declared: string;
    stored: string;
    heif?: Parameters<typeof standIn>[0];
    check?: UploadContentCheckService | null;
    uploadFails?: boolean;
  }) {
    const ext = path.extname(o.filename).toLowerCase();
    const storagePath = mintPath(ext);
    server.objects.set(storagePath, heicBytes());
    const storage = makeStorage(server, {
      storedType: o.stored,
      uploadFails: o.uploadFails,
    });
    const check =
      o.check === null
        ? undefined
        : (o.check ?? checkWith(o.heif ?? { png: p3Png }));
    const { controller, prisma } = makeController(storage, check);
    let result: any = null;
    const err = await caught(async () => {
      result = await controller.completeUpload(req as any, {
        storagePath,
        filename: o.filename,
        contentType: o.declared,
        size: 4096,
      });
    });
    return { err, result, storage, prisma, storagePath };
  }

  it.each([
    ['IMG_0042.HEIC', 'image/heic', 'image/heic'],
    ['IMG_0042.heif', '', 'image/heic'],
    // HEIC bytes under a .jpg name: the name is not the truth.
    ['holiday.jpg', 'image/jpeg', 'image/jpeg'],
  ])(
    '%s (%j, stored %s) → a JPEG asset; the HEIC deleted AFTER the JPEG is stored; no HEIC ever reaches the row',
    async (filename, declared, stored) => {
      const { err, result, storage, prisma, storagePath } = await finalize({
        filename,
        declared,
        stored,
      });
      expect(err).toBeNull();
      expect(storage.uploads).toHaveLength(1);
      const [up] = storage.uploads;
      expect(up.mime).toBe('image/jpeg');
      expect(up.path).toMatch(new RegExp(`^${TENANT}/[0-9a-f-]{36}\\.jpg$`));
      expect(storage.order).toEqual([
        `upload ${up.path}`,
        `delete ${storagePath}`,
      ]);
      const data = prisma.client.asset.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        mimeType: 'image/jpeg',
        fileSize: up.buffer.length,
        fileUrl: server.publicUrlForPath(up.path),
      });
      expect(result).toMatchObject({
        mimeType: 'image/jpeg',
        fileUrl: server.publicUrlForPath(up.path),
      });
      // Nothing a screen or the library reads names HEIC — only the operator's own
      // file name is kept, as the name they know it by (a download renames it .jpg).
      expect(prisma.client.asset.create).toHaveBeenCalledTimes(1);
      const { originalName, ...rest } = data;
      expect(originalName).toBe(filename);
      expect(JSON.stringify(rest)).not.toMatch(/heic|heif/i);
      // The forensic trail says what it was.
      const meta = prisma.client.asset.update.mock.calls
        .map(([a]: any) => a.data.processingMeta)
        .find(Boolean);
      expect(meta).toMatchObject({
        convertedFrom: 'heic',
        processedDimensions: { w: 1200, h: 800 },
      });
      expect(meta).not.toHaveProperty('skippedReason');
      // The stored JPEG itself: sRGB-correct, no EXIF.
      const m = await sharp(up.buffer).metadata();
      expect(m.format).toBe('jpeg');
      expect(m.exif).toBeUndefined();
      const { data: px, info } = await sharp(up.buffer)
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let i = 0; i < 3; i++) {
        const o = (400 * info.width + 200 + i * 400) * info.channels;
        for (let c = 0; c < 3; c++)
          expect(Math.abs(px[o + c] - PATCHES[i][c])).toBeLessThanOrEqual(6);
      }
    },
  );

  it('a BROKEN HEIC (decoded only partly — exit 0 + "Invalid input") is refused 422 with the plain words; nothing is left', async () => {
    const { err, storage, prisma, storagePath } = await finalize({
      filename: 'IMG_0042.HEIC',
      declared: 'image/heic',
      stored: 'image/heic',
      heif: {
        png: p3Png,
        stderr:
          'Warning: Invalid input: Unexpected end of file: Extent in iloc box references data outside of file bounds (points to file position 134339)\n',
      },
    });
    expect(err?.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(err?.getResponse()).toEqual({
      code: 'ASSET_IMAGE_HEIC',
      reason: 'heic',
      message:
        "This HEIC photo couldn't be converted. Export it as JPEG and upload it again.",
    });
    expect(storage.delete).toHaveBeenCalledWith(storagePath);
    expect(storage.uploads).toEqual([]);
    expect(prisma.client.asset.create).not.toHaveBeenCalled();
  });

  it('a conversion that could not RUN (the decoder hung past its budget) is a 503 that says to try again; nothing is left', async () => {
    const was = process.env.UPLOAD_HEIC_BUDGET_MS;
    process.env.UPLOAD_HEIC_BUDGET_MS = '1500';
    try {
      const { err, storage, prisma, storagePath } = await finalize({
        filename: 'IMG_0042.HEIC',
        declared: 'image/heic',
        stored: 'image/heic',
        heif: { hang: true },
      });
      expect(err?.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(err?.getResponse()).toEqual(
        expect.objectContaining({
          code: 'ASSET_IMAGE_HEIC_UNAVAILABLE',
          message: expect.stringMatching(
            /just now.*Upload it again in a minute/,
          ),
        }),
      );
      expect(storage.delete).toHaveBeenCalledWith(storagePath);
      expect(prisma.client.asset.create).not.toHaveBeenCalled();
    } finally {
      if (was === undefined) delete process.env.UPLOAD_HEIC_BUDGET_MS;
      else process.env.UPLOAD_HEIC_BUDGET_MS = was;
    }
  });

  it('storage refusing the JPEG is a 503 too — the half-stored JPEG AND the HEIC are both removed', async () => {
    const { err, storage, prisma, storagePath } = await finalize({
      filename: 'IMG_0042.HEIC',
      declared: 'image/heic',
      stored: 'image/heic',
      uploadFails: true,
    });
    expect(err?.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect((err?.getResponse() as any).code).toBe(
      'ASSET_IMAGE_HEIC_UNAVAILABLE',
    );
    const attempted = storage.order[0].replace('upload ', '');
    expect(storage.delete).toHaveBeenCalledWith(attempted);
    expect(storage.delete).toHaveBeenCalledWith(storagePath);
    expect(prisma.client.asset.create).not.toHaveBeenCalled();
  });

  it('UPLOAD_CONTENT_CHECK_DISABLED=1 switches the CHECK off — never the conversion (a HEIC is never stored as HEIC)', async () => {
    const was = process.env.UPLOAD_CONTENT_CHECK_DISABLED;
    process.env.UPLOAD_CONTENT_CHECK_DISABLED = '1';
    try {
      const { err, storage, prisma } = await finalize({
        filename: 'IMG_0042.HEIC',
        declared: 'image/heic',
        stored: 'image/heic',
      });
      expect(err).toBeNull();
      expect(storage.uploads[0].mime).toBe('image/jpeg');
      expect(prisma.client.asset.create.mock.calls[0][0].data.mimeType).toBe(
        'image/jpeg',
      );
    } finally {
      if (was === undefined) delete process.env.UPLOAD_CONTENT_CHECK_DISABLED;
      else process.env.UPLOAD_CONTENT_CHECK_DISABLED = was;
    }
  });

  it('a server without the converter refuses HEIC at presign — before a byte moves, in plain words', async () => {
    const storage = makeStorage(server);
    const { controller } = makeController(storage, undefined);
    const err = await caught(() =>
      controller.presignUpload(req as any, {
        filename: 'IMG_0042.HEIC',
        contentType: 'image/heic',
        size: 4096,
      }),
    );
    expect(err?.getStatus()).toBe(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    expect(err?.getResponse()).toEqual({
      code: 'ASSET_CONVERSION_UNAVAILABLE',
      message:
        "This HEIC photo can't be converted on this server. Export it as JPEG and upload it again.",
    });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('presign names the object .heic until it is converted (the bucket takes image/heic)', async () => {
    const storage = makeStorage(server);
    const { controller } = makeController(storage, checkWith({ png: p3Png }));
    const r: any = await controller.presignUpload(req as any, {
      filename: 'IMG_0042.HEIC',
      contentType: '',
      size: 4096,
    });
    expect(r.mimeType).toBe('image/heic');
    expect(r.storagePath).toMatch(/\.heic$/);
  });

  describe('/assets/upload (multipart — the alert-content editor)', () => {
    const multipart = async (heif: Parameters<typeof standIn>[0]) => {
      const storage = makeStorage(server);
      const { controller, prisma } = makeController(storage, checkWith(heif));
      const file: any = {
        buffer: heicBytes(),
        mimetype: 'image/heic',
        originalname: 'IMG_0042.HEIC',
        size: 4096,
      };
      let result: any = null;
      const err = await caught(async () => {
        result = await controller.upload(req as any, file, {});
      });
      return { err, result, storage, prisma };
    };

    it('a HEIC is converted BEFORE it is stored: only a JPEG is ever written, the row is image/jpeg', async () => {
      const { err, result, storage, prisma } = await multipart({ png: p3Png });
      expect(err).toBeNull();
      expect(storage.uploads).toHaveLength(1);
      expect(storage.uploads[0].mime).toBe('image/jpeg');
      expect(storage.uploads[0].path).toMatch(/\.jpg$/);
      const data = prisma.client.asset.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        mimeType: 'image/jpeg',
        fileSize: storage.uploads[0].buffer.length,
        processingMeta: expect.objectContaining({ convertedFrom: 'heic' }),
      });
      expect(result.mimeType).toBe('image/jpeg');
    });

    it('a broken HEIC is refused and nothing is written', async () => {
      const { err, storage, prisma } = await multipart({
        exitCode: 1,
        stderr:
          "Could not read HEIF/AVIF file: Invalid input: No 'meta' box: Cannot read full meta box\n",
      });
      expect(err?.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect((err?.getResponse() as any).code).toBe('ASSET_IMAGE_HEIC');
      expect(storage.uploads).toEqual([]);
      expect(prisma.client.asset.create).not.toHaveBeenCalled();
    });
  });
});
