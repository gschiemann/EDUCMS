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
        // UPLD-02 — complete-upload now checks that no existing Asset already
        // owns the incoming storagePath before it can ever delete it.
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 'asset-1', altText: null, ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 'asset-1', ...data })),
      },
      // /assets/emergency-upload writes an AuditLog row (UPLD-01 tests below
      // exercise that handler). Additive — the pre-existing tests never reach it.
      auditLog: { create: jest.fn(async () => ({ id: 'audit-1' })) },
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
  // Poster generation is fire-and-forget; a recording no-op keeps these tests
  // about the size CAP, not ffmpeg.
  const videoPoster = { kickOff: jest.fn() } as any;
  const controller = new AssetsController(prisma, storage, email, mediaOpt, aiAltText, videoPoster);
  return { controller, prisma, videoPoster };
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
    // UPLD-02: complete-upload now requires the exact shape /presign mints
    // (`<tenantId>/<uuid><ext>`), so the fixture uses a real one.
    storagePath: 'tenant-1/0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.mp4',
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
    expect(storage.delete).toHaveBeenCalledWith(base.storagePath);
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

describe('UPLD-01 — /assets/emergency-upload enforces the same caps as the media library', () => {
  // This handler had NO size enforcement: only multer's blanket 500 MB limit
  // and the ALLOWED_TYPES mimetype filter. A "lockdown video" the library
  // rejects with ASSET_VIDEO_TOO_LARGE was accepted here — and emergency media
  // is precached onto every screen in the fleet, so one oversized asset is
  // 400 MB x N screens of egress off a single config change, discovered at
  // incident time rather than config time.
  const emergencyFile = (mimetype: string, bytes: number, originalname: string) =>
    ({ buffer: Buffer.alloc(bytes), mimetype, originalname, size: bytes }) as any;

  it('REJECTS a 60 MB emergency video against the shared 50 MB video cap', async () => {
    const storage = makeStorage();
    const { controller, prisma } = makeController(storage);

    await expectHttp(
      () => controller.uploadEmergencyAsset(adminReq as any, emergencyFile('video/mp4', 60 * MB, 'lockdown.mp4')),
      'ASSET_VIDEO_TOO_LARGE',
      HttpStatus.PAYLOAD_TOO_LARGE,
    );

    // Rejected BEFORE the bytes reach storage — no orphan object, no egress.
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.client.asset.create).not.toHaveBeenCalled();
  });

  it('still accepts an in-spec emergency video', async () => {
    const storage = makeStorage();
    const { controller } = makeController(storage);
    await controller.uploadEmergencyAsset(adminReq as any, emergencyFile('video/mp4', 10 * MB, 'lockdown.mp4'));
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });

  it('derives the stored extension from the validated MIME, not the filename', async () => {
    // The extension is load-bearing: screens.controller.ts derives the
    // manifest mime from the URL extension, and an extension-less URL yields a
    // null mime — at which point the player classifies an https:// URL with no
    // image extension as text/html and hands a lockdown VIDEO to the iframe
    // render path. A file picked up without an extension must still land as .mp4.
    const storage = makeStorage();
    const { controller } = makeController(storage);

    await controller.uploadEmergencyAsset(adminReq as any, emergencyFile('video/mp4', 1 * MB, 'lockdown'));

    const storagePath = storage.upload.mock.calls[0][0] as string;
    expect(storagePath).toMatch(/^tenant-1\/emergency\/[0-9a-f-]+\.mp4$/);
  });

  it('keeps the per-type cap boundaries aligned with the library (no second policy)', async () => {
    // If someone changes one cap and not the other, this fails.
    const storage = makeStorage();
    const { controller } = makeController(storage);
    await expectHttp(
      () => controller.uploadEmergencyAsset(adminReq as any, emergencyFile('image/png', 30 * MB, 'alert.png')),
      'ASSET_IMAGE_TOO_LARGE',
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
