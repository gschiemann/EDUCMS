/**
 * MOV, AVI, MKV, WMV, MPG, 3GP, TS / M2TS / MTS uploads — the whole road
 * (2026-10-05), with tiny REAL files made by this box's ffmpeg:
 *
 *   presign      → the type is decided as the browser would send it (a real
 *                  type, an alias like `video/avi`, an EMPTY one, a wrong one
 *                  like `model/vnd.mts`) and the object gets a matching name;
 *   complete     → the REAL content check probes the stored bytes over http
 *                  (the CorpusServer stands in for Supabase) and the asset is
 *                  created as the container it is, queued for the signage
 *                  transcode exactly like an MP4, with the poster/probe pass;
 *   transcode    → the REAL pipeline (real ffprobe + ffmpeg; Prisma and storage
 *                  faked) plans a REQUIRED conversion and swaps in an H.264 MP4:
 *                  the asset ends `video/mp4` at a `.mp4` URL, stamped ready.
 *
 * Plus the endpoints that must NOT take these containers (alert content is never
 * converted), and the switch: no transcode → refused at presign, in plain words.
 * Skipped, with the reason logged, on a box without ffmpeg (the production
 * image ships it; the Dockerfile fails the build without it).
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { withheldFromScreens } from '@cms/api-types';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { MediaOptimizationService } from '../storage/media-optimization.service';
import {
  buildProbeArgs,
  parseProbe,
  screenCompatibilityIssues,
} from '../storage/video-transcode/transcode-profile';
import {
  EMERGENCY_CONTENT_SQL,
  VideoTranscodePipeline,
} from '../storage/video-transcode/video-transcode.pipeline';
import { AssetsController, acceptMultipartFile } from './assets.controller';
import { UploadContentCheckService } from './upload-content-check.service';
import {
  CorpusServer,
  hasMediaTools,
  makeCorpusDir,
} from './upload-corpus.fixture-spec';

const TENANT = 'tenant-1';
let uuidN = 0;
const mintPath = (ext: string) =>
  `${TENANT}/0f6b1c2d-3e4f-4a5b-8c9d-${String(++uuidN).padStart(12, '0')}${ext}`;
const req = { user: { tenantId: TENANT, id: 'user-1', role: 'SCHOOL_ADMIN' } };

function hasEncoder(name: string): boolean {
  if (!hasMediaTools) return false;
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .split('\n')
      .some((line) => line.trim().split(/\s+/)[1] === name);
  } catch {
    return false;
  }
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
  storedType?: (p: string) => string | null,
) {
  return {
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
        ? { size: b.length, contentType: storedType ? storedType(p) : null }
        : null;
    }),
    download: jest.fn(async (p: string) => server.objects.get(p) ?? null),
    readObjectRange: jest.fn(async (p: string, s: number, e: number) =>
      server.range(p, s, e),
    ),
    upload: jest.fn(async (p: string) => server.publicUrlForPath(p)),
    delete: jest.fn(async () => undefined),
    createSignedUploadUrl: jest.fn(async (p: string) => ({
      path: p,
      token: 'tok',
      signedUrl: `${server.base}/upload/${p}`,
      publicUrl: server.publicUrlForPath(p),
    })),
  } as any;
}

function makeController(
  storage: any,
  opts: { transcodes?: any; check?: boolean } = {},
) {
  const prisma = makePrisma();
  const poster = { kickOff: jest.fn() };
  const transcodes = opts.transcodes ?? { enqueue: jest.fn(async () => true) };
  const check =
    opts.check === false ? undefined : new UploadContentCheckService(storage);
  // What the content check answered, per call — to tell a verdict read from the
  // file's own probe from one read off its type.
  const checkResults: any[] = [];
  if (check) {
    const real = check.check.bind(check);
    check.check = async (input) => {
      const r = await real(input);
      checkResults.push(r);
      return r;
    };
  }
  const controller = new AssetsController(
    prisma,
    storage,
    {} as any,
    new MediaOptimizationService(),
    { generateImageAltText: jest.fn(async () => null) } as any,
    poster as any,
    transcodes,
    undefined,
    undefined,
    undefined,
    check,
  );
  return { controller, prisma, poster, transcodes, checkResults };
}

interface ContainerCase {
  /** What the operator uploads. */
  file: string;
  /** The type the browser sends ('' = none). */
  declared: string;
  /** The type it is stored under. */
  stored: string;
  /** The extension the stored object is named with. */
  ext: string;
  /** ffmpeg output options (after the shared input + map). */
  out: string[];
  /** Encoders the case needs. */
  needs: string[];
}

const H264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
const CASES: ContainerCase[] = [
  {
    file: 'IMG_0001.MOV',
    declared: 'video/quicktime',
    stored: 'video/quicktime',
    ext: '.mov',
    out: [...H264, '-c:a', 'aac', '-f', 'mov'],
    needs: ['libx264', 'aac'],
  },
  // MP4 bytes saved as .mov (brand isom): screen-safe bytes, NOT an MP4 by name.
  {
    file: 'clip.mov',
    declared: 'video/quicktime',
    stored: 'video/quicktime',
    ext: '.mov',
    out: [...H264, '-c:a', 'aac', '-f', 'mp4'],
    needs: ['libx264', 'aac'],
  },
  {
    file: 'clip.avi',
    declared: 'video/x-msvideo',
    stored: 'video/x-msvideo',
    ext: '.avi',
    out: ['-c:v', 'mpeg4', '-c:a', 'pcm_s16le', '-f', 'avi'],
    needs: ['mpeg4'],
  },
  {
    file: 'windows.avi',
    declared: 'video/avi',
    stored: 'video/x-msvideo',
    ext: '.avi',
    out: ['-c:v', 'mpeg4', '-c:a', 'pcm_s16le', '-f', 'avi'],
    needs: ['mpeg4'],
  },
  {
    file: 'match.mkv',
    declared: '',
    stored: 'video/x-matroska',
    ext: '.mkv',
    out: [...H264, '-c:a', 'aac', '-f', 'matroska'],
    needs: ['libx264', 'aac'],
  },
  {
    file: 'talk.wmv',
    declared: 'video/x-ms-wmv',
    stored: 'video/x-ms-wmv',
    ext: '.wmv',
    out: ['-c:v', 'wmv2', '-c:a', 'wmav2', '-f', 'asf'],
    needs: ['wmv2', 'wmav2'],
  },
  {
    file: 'old.mpg',
    declared: 'video/mpeg',
    stored: 'video/mpeg',
    ext: '.mpg',
    out: ['-c:v', 'mpeg2video', '-c:a', 'mp2', '-f', 'mpeg'],
    needs: ['mpeg2video', 'mp2'],
  },
  {
    file: 'old.mpeg',
    declared: 'application/octet-stream',
    stored: 'video/mpeg',
    ext: '.mpeg',
    out: ['-c:v', 'mpeg2video', '-c:a', 'mp2', '-f', 'mpeg'],
    needs: ['mpeg2video', 'mp2'],
  },
  // H.264 + AAC in a 3GP (brand 3gp*) — scored already-optimal before 2026-10-05.
  {
    file: 'phone.3gp',
    declared: 'video/3gpp',
    stored: 'video/3gpp',
    ext: '.3gp',
    out: [...H264, '-profile:v', 'baseline', '-c:a', 'aac', '-f', '3gp'],
    needs: ['libx264', 'aac'],
  },
  {
    file: 'broadcast.ts',
    declared: 'video/mp2t',
    stored: 'video/mp2t',
    ext: '.ts',
    out: [...H264, '-c:a', 'aac', '-f', 'mpegts'],
    needs: ['libx264', 'aac'],
  },
  {
    file: 'camcorder.m2ts',
    declared: '',
    stored: 'video/mp2t',
    ext: '.m2ts',
    out: [...H264, '-c:a', 'ac3', '-f', 'mpegts', '-mpegts_m2ts_mode', '1'],
    needs: ['libx264', 'ac3'],
  },
  {
    file: '00012.MTS',
    declared: 'model/vnd.mts',
    stored: 'video/mp2t',
    ext: '.mts',
    out: [...H264, '-c:a', 'ac3', '-f', 'mpegts', '-mpegts_m2ts_mode', '1'],
    needs: ['libx264', 'ac3'],
  },
];

describe('presign — every container is taken, typed and named as storage will hold it', () => {
  const server = new CorpusServer();
  it.each(CASES)(
    '$file ($declared) → stored as $stored at <uuid>$ext',
    async (c) => {
      const { controller } = makeController(makeStorage(server), {
        check: false,
      });
      const r: any = await controller.presignUpload(req as any, {
        filename: c.file,
        contentType: c.declared,
        size: 1000,
      });
      expect(r.mimeType).toBe(c.stored);
      expect(r.storagePath).toMatch(
        new RegExp(`^${TENANT}/[0-9a-f-]{36}\\${c.ext}$`),
      );
    },
  );

  it('with the signage transcode switched off, a container that needs it is refused — plainly, before a byte moves', async () => {
    const was = process.env.VIDEO_TRANSCODE_DISABLED;
    process.env.VIDEO_TRANSCODE_DISABLED = '1';
    try {
      const storage = makeStorage(server);
      const { controller } = makeController(storage, { check: false });
      const err = await caught(() =>
        controller.presignUpload(req as any, {
          filename: 'IMG_0001.MOV',
          contentType: 'video/quicktime',
          size: 1000,
        }),
      );
      expect(err?.getStatus()).toBe(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
      expect(err?.getResponse()).toEqual({
        code: 'ASSET_CONVERSION_UNAVAILABLE',
        message: expect.stringMatching(
          /^This is a MOV video, which screens can play only once it is converted to MP4.*Export it as MP4 \(H\.264\)/,
        ),
      });
      expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
      // NEGATIVE CONTROL: an MP4 needs no conversion and is still taken.
      expect(
        (
          (await controller.presignUpload(req as any, {
            filename: 'a.mp4',
            contentType: 'video/mp4',
            size: 1000,
          })) as any
        ).mimeType,
      ).toBe('video/mp4');
    } finally {
      if (was === undefined) delete process.env.VIDEO_TRANSCODE_DISABLED;
      else process.env.VIDEO_TRANSCODE_DISABLED = was;
    }
  });

  it('an unknown kind of file is told what IS taken — the lists come from the shared table', async () => {
    const { controller } = makeController(makeStorage(server), {
      check: false,
    });
    const err = await caught(() =>
      controller.presignUpload(req as any, {
        filename: 'old.flv',
        contentType: 'video/x-flv',
        size: 1000,
      }),
    );
    expect((err?.getResponse() as any).code).toBe(
      'ASSET_FILE_TYPE_UNSUPPORTED',
    );
    expect((err?.getResponse() as any).message).toBe(
      "This kind of file can't be uploaded. Upload photos (JPG, PNG, WebP, GIF, BMP, ICO, HEIC), video (MP4, M4V, WebM, MOV, AVI, MKV, WMV, MPG, 3GP, TS), audio (MP3, OGG, WAV, M4A) or PDF.",
    );
  });
});

describe('the endpoints that must NOT take a container converted after upload', () => {
  it('/assets/upload (alert content — never converted): MOV and AVI refused, HEIC taken (converted before it is stored), types normalised', () => {
    for (const [name, type] of [
      ['IMG_0001.MOV', 'video/quicktime'],
      ['clip.avi', 'video/avi'],
      ['match.mkv', ''],
      ['x.ts', 'video/mp2t'],
    ]) {
      expect(acceptMultipartFile({ originalname: name, mimetype: type })).toBe(
        false,
      );
    }
    const heic = {
      originalname: 'IMG_0002.HEIC',
      mimetype: 'application/octet-stream',
    };
    expect(acceptMultipartFile(heic)).toBe(true);
    expect(heic.mimetype).toBe('image/heic');
    const wav = { originalname: 'tone.wav', mimetype: 'audio/x-wav' };
    expect(acceptMultipartFile(wav)).toBe(true);
    expect(wav.mimetype).toBe('audio/wav');
    expect(
      acceptMultipartFile({ originalname: 'clip.mp4', mimetype: 'video/mp4' }),
    ).toBe(true);
  });

  it('both say where to go instead when nothing was taken', async () => {
    const { controller } = makeController(makeStorage(new CorpusServer()), {
      check: false,
    });
    const multipart = await caught(() =>
      controller.upload(req as any, undefined as any, {}),
    );
    expect((multipart?.getResponse() as any).message).toMatch(
      /converted for screens in the Media Library — upload it there/,
    );
    const emergency = await caught(() =>
      controller.uploadEmergencyAsset(req as any, undefined as any),
    );
    expect((emergency?.getResponse() as any).message).toMatch(
      /Alert media must be ready to play.*upload them to the Media Library, which converts them/,
    );
    expect((emergency?.getResponse() as any).message).toMatch(
      /JPG, PNG, WebP, GIF, BMP, ICO\), video \(MP4, M4V, WebM\)/,
    );
  });
});

describe('when the content check could not read the file, a container is STILL held back from screens until it is converted', () => {
  // The upload's screen verdict normally comes from the check's own ffprobe.
  // With no clean probe there is none — and an MP4 then goes to screens exactly
  // as before. A MOV / AVI / MKV / … has no "before": its stored type alone says
  // the transcode converts it, so it is created "converting" all the same.
  const server = new CorpusServer(); // never started: nothing can be read from it
  const upload = async (
    c: { file: string; declared: string; stored: string; ext: string },
    opts: { check?: boolean } = {},
  ) => {
    const storagePath = mintPath(c.ext);
    server.objects.set(storagePath, Buffer.from('bytes nobody reads'));
    const storage = makeStorage(server, () => c.stored);
    const made = makeController(storage, opts);
    await made.controller.completeUpload(req as any, {
      storagePath,
      filename: c.file,
      contentType: c.declared,
      size: 18,
    });
    return {
      data: made.prisma.client.asset.create.mock.calls[0][0].data,
      checkResults: made.checkResults,
    };
  };
  const MP4 = {
    file: 'a.mp4',
    declared: 'video/mp4',
    stored: 'video/mp4',
    ext: '.mp4',
  };

  it.each(CASES)(
    '$file with no content check on this server → created "converting" ([container])',
    async (c) => {
      const { data } = await upload(c, { check: false });
      expect(data.processingMeta?.screen).toMatchObject({
        version: 1,
        ready: false,
        pending: true,
        issues: ['container'],
      });
      expect(withheldFromScreens(data)).toBe(true);
    },
  );

  it('UPLOAD_CONTENT_CHECK_DISABLED=1 → the same; an MP4 gets no stamp (unknown, delivered as before)', async () => {
    const was = process.env.UPLOAD_CONTENT_CHECK_DISABLED;
    process.env.UPLOAD_CONTENT_CHECK_DISABLED = '1';
    try {
      const avi = await upload(CASES.find((c) => c.ext === '.avi')!);
      expect(avi.checkResults).toHaveLength(0);
      expect(avi.data.processingMeta?.screen).toMatchObject({
        ready: false,
        pending: true,
        issues: ['container'],
      });
      const mp4 = await upload(MP4);
      expect(mp4.data.processingMeta).toBeUndefined();
      expect(withheldFromScreens(mp4.data)).toBe(false);
    } finally {
      if (was === undefined) delete process.env.UPLOAD_CONTENT_CHECK_DISABLED;
      else process.env.UPLOAD_CONTENT_CHECK_DISABLED = was;
    }
  });

  it('the check ran but could not read the object (storage unreachable) → accepted, no probe verdict — the MOV is still "converting", the MP4 unknown', async () => {
    const mov = await upload(CASES[0]);
    expect(mov.checkResults).toHaveLength(1);
    expect(mov.checkResults[0]).toMatchObject({ accept: true, screen: null });
    expect(mov.data.processingMeta?.screen).toMatchObject({
      ready: false,
      pending: true,
      issues: ['container'],
    });
    const mp4 = await upload(MP4);
    expect(mp4.checkResults[0]).toMatchObject({ accept: true, screen: null });
    expect(mp4.data.processingMeta).toBeUndefined();
  });

  it('no conversion will run (no transcode service) → a MOV gets no row at all, so no "converting" that nothing would finish; an MP4 is created unstamped', async () => {
    const storage = makeStorage(server, (p) =>
      p.endsWith('.mov') ? 'video/quicktime' : 'video/mp4',
    );
    const prisma = makePrisma();
    const controller = new AssetsController(
      prisma,
      storage,
      {} as any,
      new MediaOptimizationService(),
      { generateImageAltText: jest.fn(async () => null) } as any,
      { kickOff: jest.fn() } as any,
      undefined,
    );
    const movPath = mintPath('.mov');
    server.objects.set(movPath, Buffer.from('bytes nobody reads'));
    const err = await caught(() =>
      controller.completeUpload(req as any, {
        storagePath: movPath,
        filename: 'IMG_0001.MOV',
        contentType: 'video/quicktime',
        size: 18,
      }),
    );
    expect((err?.getResponse() as any).code).toBe(
      'ASSET_CONVERSION_UNAVAILABLE',
    );
    expect(prisma.client.asset.create).not.toHaveBeenCalled();
    // NEGATIVE CONTROL
    const mp4Path = mintPath('.mp4');
    server.objects.set(mp4Path, Buffer.from('bytes nobody reads'));
    await controller.completeUpload(req as any, {
      storagePath: mp4Path,
      filename: 'a.mp4',
      contentType: 'video/mp4',
      size: 18,
    });
    expect(
      prisma.client.asset.create.mock.calls[0][0].data.processingMeta,
    ).toBeUndefined();
  });
});

if (!hasMediaTools) {
  console.warn(
    '[assets-accept-containers.controller.spec] ffmpeg/ffprobe not found — the real-file cases are SKIPPED (the production image ships both).',
  );
}

(hasMediaTools ? describe : describe.skip)(
  'complete-upload → transcode with REAL files in every container',
  () => {
    jest.setTimeout(180_000);
    let dir = '';
    const server = new CorpusServer();
    const bytes = new Map<string, Buffer>();
    const skipped: string[] = [];

    beforeAll(async () => {
      dir = await makeCorpusDir();
      await server.start();
      for (const c of CASES) {
        const missing = c.needs.filter((e) => !hasEncoder(e));
        if (missing.length) {
          skipped.push(`${c.file} (this ffmpeg has no ${missing.join(', ')})`);
          continue;
        }
        const out = path.join(dir, `src-${c.file}`);
        execFileSync('ffmpeg', [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=320x240:rate=25',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=48000',
          '-t',
          '2',
          '-map',
          '0:v',
          '-map',
          '1:a',
          ...c.out,
          out,
        ]);
        bytes.set(c.file, await fs.readFile(out));
      }
      if (skipped.length)
        console.warn(
          `[assets-accept-containers.controller.spec] cases SKIPPED: ${skipped.join('; ')}`,
        );
    });
    afterAll(async () => {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    });

    it.each(CASES)(
      '$file: content-checked, created as $stored, queued like an MP4 — then converted to an H.264 MP4 asset',
      async (c) => {
        const src = bytes.get(c.file);
        if (!src) return; // logged above
        // ── upload ──
        const storagePath = mintPath(c.ext);
        server.objects.set(storagePath, src);
        const storage = makeStorage(server, () => c.stored);
        const { controller, prisma, poster, transcodes, checkResults } =
          makeController(storage);
        const created: any = await controller.completeUpload(req as any, {
          storagePath,
          filename: c.file,
          contentType: c.declared,
          size: src.length,
        });
        expect(created.mimeType).toBe(c.stored);
        const createdData = prisma.client.asset.create.mock.calls[0][0].data;
        expect(createdData).toMatchObject({
          mimeType: c.stored,
          fileSize: src.length,
        });
        expect(storage.delete).not.toHaveBeenCalled();
        // The screen-ready gate: the content check's OWN probe ran cleanly and
        // read the stored name too, so the row is created "converting" — the
        // manifest leaves it out until the MP4 exists. That includes MP4 bytes
        // saved as .mov, which only their name gives away.
        expect(checkResults).toHaveLength(1);
        expect(checkResults[0].screen).toEqual({
          ready: false,
          issues: expect.arrayContaining(['container']),
        });
        if (c.file === 'clip.mov') {
          expect(checkResults[0].screen.issues).toEqual(['container']);
        }
        expect(createdData.processingMeta?.screen).toMatchObject({
          version: 1,
          ready: false,
          pending: true,
          issues: checkResults[0].screen.issues,
        });
        expect(withheldFromScreens(createdData)).toBe(true);
        await new Promise((r) => setImmediate(r));
        expect(transcodes.enqueue).toHaveBeenCalledWith({
          tenantId: TENANT,
          assetId: 'asset-new',
          sourceUrl: server.publicUrlForPath(storagePath),
          sourceBytes: src.length,
        });
        expect(poster.kickOff).toHaveBeenCalledWith(
          expect.objectContaining({
            assetId: 'asset-new',
            storagePath,
            ext: c.ext,
          }),
        );

        // ── the queued transcode, run for real ──
        const sourceUrl = server.publicUrlForPath(storagePath);
        const asset: any = {
          id: 'asset-new',
          tenantId: TENANT,
          fileUrl: sourceUrl,
          mimeType: c.stored,
          status: 'PUBLISHED',
          fileHash: null,
          // the row as complete-upload created it: stamped "converting"
          processingMeta: createdData.processingMeta,
        };
        const uploaded = new Map<string, Buffer>();
        const pPrisma = {
          client: {
            asset: {
              findFirst: jest.fn(async ({ where }: any) =>
                where.id === asset.id &&
                where.tenantId === TENANT &&
                (where.fileUrl === undefined || where.fileUrl === asset.fileUrl)
                  ? asset
                  : null,
              ),
              updateMany: jest.fn(async ({ where, data }: any) => {
                if (where.id !== asset.id || where.tenantId !== TENANT)
                  return { count: 0 };
                if (
                  where.fileUrl !== undefined &&
                  where.fileUrl !== asset.fileUrl
                )
                  return { count: 0 };
                Object.assign(asset, data);
                return { count: 1 };
              }),
            },
            auditLog: { create: jest.fn(async () => ({})) },
            $queryRawUnsafe: jest.fn(async (sql: string) => {
              if (sql === EMERGENCY_CONTENT_SQL) return [{ emergency: false }];
              throw new Error('unexpected SQL');
            }),
          },
        } as any;
        const prefix = server.publicUrlForPath('');
        const pStorage = {
          extractPath: (url: string) =>
            url.startsWith(prefix) ? url.slice(prefix.length) : null,
          getObjectInfo: jest.fn(async () => ({
            size: src.length,
            contentType: c.stored,
          })),
          downloadObjectToFile: jest.fn(async (_p: string, dest: string) => {
            await fs.writeFile(dest, src);
            return {
              bytes: src.length,
              sha256: createHash('sha256').update(src).digest('hex'),
              contentType: c.stored,
            };
          }),
          uploadFileFromDisk: jest.fn(async (p: string, file: string) => {
            uploaded.set(p, await fs.readFile(file));
            return `${prefix}${p}`;
          }),
          delete: jest.fn(async () => undefined),
        } as any;
        const pipeline = new VideoTranscodePipeline(pPrisma, pStorage, {
          processVideo: jest.fn(async () => ({
            probed: true,
            posterUrl: null,
          })),
        } as any);
        const outcome = await pipeline.process({
          id: 'job-1',
          tenantId: TENANT,
          assetId: asset.id,
          sourceUrl,
          sourceBytes: src.length,
          attempts: 1,
        });

        expect(outcome).toMatchObject({ status: 'done', reason: 'swapped' });
        expect(asset.mimeType).toBe('video/mp4');
        expect(asset.fileUrl).toMatch(/\/optimized\/[0-9a-f-]{36}\.mp4$/);
        expect(asset.processingMeta.screen).toMatchObject({
          ready: true,
          convertedFrom: expect.arrayContaining(['container']),
        });
        expect(asset.processingMeta.screen.pending).toBeUndefined();
        // …and the gate hands screens the MP4 now.
        expect(withheldFromScreens(asset)).toBe(false);
        // The copy itself: H.264 4:2:0 in an MP4, screen-safe on every count.
        const [[, out]] = [...uploaded.entries()];
        const outFile = path.join(dir, `out-${c.file}.mp4`);
        await fs.writeFile(outFile, out);
        const probe = parseProbe(
          JSON.parse(
            execFileSync('ffprobe', buildProbeArgs(outFile), {
              encoding: 'utf8',
            }),
          ),
        );
        expect(probe).toMatchObject({
          videoCodec: 'h264',
          pixFmt: 'yuv420p',
          hasAudio: true,
          audioCodec: 'aac',
        });
        expect(probe.formatName).toContain('mp4');
        expect(probe.majorBrand).toBe('isom');
        expect(
          screenCompatibilityIssues(probe, {
            mimeType: asset.mimeType,
            extension: '.mp4',
          }),
        ).toEqual([]);
      },
    );
  },
);
