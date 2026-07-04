/**
 * Upload per-type size-cap enforcement (BUG #6 + BUG #7).
 *
 * These tests pin the fix for two egress-cap bypasses:
 *
 *   #7 — Legacy multipart POST /assets/upload NEVER enforced the tighter
 *        per-type caps (video 50 MB, image/audio/pdf 25 MB) — only the
 *        blanket 500 MB multer limit applied. The real bytes are in-process
 *        (`file.buffer`), so an oversize file for a type must now be rejected
 *        with the existing error-envelope shape.
 *
 *   #6 — Presigned finalize POST /assets/complete-upload enforced the caps
 *        only against the CLIENT-CLAIMED size at presign time (trivially
 *        spoofable). The real stored size becomes known here via
 *        `storage.getObjectInfo`; an object whose REAL size exceeds the cap
 *        must be rejected AND deleted from storage (no orphan).
 *
 * We instantiate the controller directly with lightweight fakes for its
 * dependencies and call the handler methods — this exercises the exact
 * enforcement code path without standing up the full Nest DI graph / HTTP
 * stack.
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { AssetsController, perTypeSizeCapError } from './assets.controller';

const MB = 1024 * 1024;

// A minimal fake storage service. Records deletes so we can assert the
// over-cap presigned object is cleaned up. `getObjectInfo` is overridable
// per-test to simulate the real stored size the client can't lie about.
function makeStorage(overrides: Partial<any> = {}) {
  const deleted: string[] = [];
  return {
    deleted,
    toSafeBuffer: (b: any) => (Buffer.isBuffer(b) ? b : Buffer.from(b)),
    upload: jest.fn(async () => 'https://example.supabase.co/storage/v1/object/public/assets/x'),
    delete: jest.fn(async (p: string) => { deleted.push(p); }),
    publicUrlForPath: (p: string) => `https://example.supabase.co/storage/v1/object/public/assets/${p}`,
    assertObjectExists: jest.fn(async () => undefined),
    getObjectInfo: jest.fn(async () => ({ size: null, contentType: null })),
    download: jest.fn(async () => null),
    ...overrides,
  } as any;
}

// Prisma fake — only the calls the upload paths make. `asset.create` echoes
// the row so the handler's response mapping works.
function makePrisma() {
  return {
    client: {
      assetFolder: { findFirst: jest.fn(async () => null) },
      asset: {
        create: jest.fn(async ({ data }: any) => ({ id: 'asset-1', altText: null, ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 'asset-1', ...data })),
      },
    },
  } as any;
}

function makeController(storage: any) {
  const prisma = makePrisma();
  const email = {} as any;
  // mediaOpt: never treat anything as optimizable so the upload paths take
  // the simple "store the bytes as-is" branch (keeps the test about the CAP,
  // not sharp).
  const mediaOpt = {
    isUploadOptimizableImage: () => false,
    optimizeImageForUpload: jest.fn(),
  } as any;
  const aiAltText = { generateImageAltText: jest.fn(async () => null) } as any;
  const controller = new AssetsController(prisma, storage, email, mediaOpt, aiAltText);
  return { controller, prisma };
}

const adminReq = { user: { tenantId: 'tenant-1', id: 'user-1', role: 'SCHOOL_ADMIN' } };

async function expectHttp(fn: () => Promise<any>, code: string, status: HttpStatus) {
  let err: any;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(HttpException);
  expect(err.getStatus()).toBe(status);
  expect((err.getResponse() as any).code).toBe(code);
  return err;
}

describe('perTypeSizeCapError (shared helper)', () => {
  it('flags an over-cap video (>50 MB) with the video envelope', () => {
    const e = perTypeSizeCapError('video/mp4', 60 * MB);
    expect(e).toBeInstanceOf(HttpException);
    expect(e!.getStatus()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect((e!.getResponse() as any).code).toBe('ASSET_VIDEO_TOO_LARGE');
  });
  it('flags an over-cap image / audio / pdf (>25 MB)', () => {
    expect((perTypeSizeCapError('image/png', 30 * MB)!.getResponse() as any).code).toBe('ASSET_IMAGE_TOO_LARGE');
    expect((perTypeSizeCapError('audio/mpeg', 30 * MB)!.getResponse() as any).code).toBe('ASSET_AUDIO_TOO_LARGE');
    expect((perTypeSizeCapError('application/pdf', 30 * MB)!.getResponse() as any).code).toBe('ASSET_PDF_TOO_LARGE');
  });
  it('passes an in-spec file (null = no error)', () => {
    expect(perTypeSizeCapError('video/mp4', 40 * MB)).toBeNull();
    expect(perTypeSizeCapError('image/png', 10 * MB)).toBeNull();
    expect(perTypeSizeCapError('image/png', 0)).toBeNull(); // unknown/zero → no rejection
  });
});

describe('BUG #7 — legacy multipart /assets/upload enforces per-type caps', () => {
  it('REJECTS a 60 MB video against the 50 MB video cap (real in-process bytes)', async () => {
    const storage = makeStorage();
    const { controller } = makeController(storage);
    const file: any = {
      buffer: Buffer.alloc(60 * MB),
      mimetype: 'video/mp4',
      originalname: 'big.mp4',
      size: 60 * MB,
    };
    await expectHttp(
      () => controller.upload(adminReq as any, file, {}),
      'ASSET_VIDEO_TOO_LARGE',
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
    // The over-cap file must NEVER reach storage.
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('REJECTS a 30 MB image against the 25 MB image cap', async () => {
    const storage = makeStorage();
    const { controller } = makeController(storage);
    const file: any = {
      buffer: Buffer.alloc(30 * MB),
      mimetype: 'image/png',
      originalname: 'huge.png',
      size: 30 * MB,
    };
    await expectHttp(
      () => controller.upload(adminReq as any, file, {}),
      'ASSET_IMAGE_TOO_LARGE',
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('ALLOWS an in-spec 10 MB video (stores it, returns the asset)', async () => {
    const storage = makeStorage();
    const { controller } = makeController(storage);
    const file: any = {
      buffer: Buffer.alloc(10 * MB),
      mimetype: 'video/mp4',
      originalname: 'ok.mp4',
      size: 10 * MB,
    };
    const res = await controller.upload(adminReq as any, file, {});
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(res.id).toBe('asset-1');
    expect(res.mimeType).toBe('video/mp4');
  });
});

describe('BUG #6 — presigned /assets/complete-upload enforces the cap against REAL stored size', () => {
  const base = {
    storagePath: 'tenant-1/abc.mp4',
    filename: 'clip.mp4',
    contentType: 'video/mp4',
    // Client LIES about the size at finalize: claims 5 MB (in-spec)…
    size: 5 * MB,
    folderId: null,
  };

  it('REJECTS + DELETES when the real stored size (300 MB) blows the video cap despite a small claimed size', async () => {
    // …but storage reports the REAL object is 300 MB.
    const storage = makeStorage({
      getObjectInfo: jest.fn(async () => ({ size: 300 * MB, contentType: 'video/mp4' })),
    });
    const { controller, prisma } = makeController(storage);

    await expectHttp(
      () => controller.completeUpload(adminReq as any, { ...base }),
      'ASSET_VIDEO_TOO_LARGE',
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
    // No Asset row is created for an over-cap object.
    expect(prisma.client.asset.create).not.toHaveBeenCalled();
    // The orphaned over-cap object is deleted from storage.
    expect(storage.delete).toHaveBeenCalledWith('tenant-1/abc.mp4');
  });

  it('ALLOWS finalize when the real stored size is in-spec (30 MB video)', async () => {
    const storage = makeStorage({
      getObjectInfo: jest.fn(async () => ({ size: 30 * MB, contentType: 'video/mp4' })),
    });
    const { controller, prisma } = makeController(storage);
    const res = await controller.completeUpload(adminReq as any, { ...base });
    expect(prisma.client.asset.create).toHaveBeenCalledTimes(1);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(res.id).toBe('asset-1');
    expect(res.fileSize).toBe(30 * MB);
  });

  it('does NOT newly reject when storage-info is unavailable (graceful degrade to claimed-size)', async () => {
    // getObjectInfo returns null → we fall back to the claimed (in-spec) size
    // and do not block; this is the documented enforcement limit.
    const storage = makeStorage({ getObjectInfo: jest.fn(async () => null) });
    const { controller, prisma } = makeController(storage);
    const res = await controller.completeUpload(adminReq as any, { ...base });
    expect(prisma.client.asset.create).toHaveBeenCalledTimes(1);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(res.id).toBe('asset-1');
  });
});
