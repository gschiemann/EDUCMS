/**
 * Direct-to-storage uploads, 2026-09-23 (4K video): the presign → TUS/PUT →
 * complete-upload chain now carries files up to 2 GB without the API ever
 * holding the bytes. These drive the REAL handlers with the same lightweight
 * fakes the caps + hijack suites use, and pin:
 *
 *   1. presign hands out a RESUMABLE (TUS) descriptor bound to the minted
 *      path, a renew ticket, and the per-type ceiling — and never anything
 *      broader than the one-object signed token;
 *   2. `POST /assets/presign/renew` re-signs ONLY the caller's own in-flight
 *      path: another user, another tenant, another path, an expired or forged
 *      ticket, a finalized path and a non-presign path are all refused;
 *   3. complete-upload refuses (and deletes) an object whose STORED content
 *      type is outside the allowlist — the hole a TUS upload that omits its
 *      `contentType` metadata would otherwise open;
 *   4. complete-upload is an idempotent replay for the uploader's own retry,
 *      and still a 409 for anyone else.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  AssetsController,
  COMPLETE_UPLOAD_REPLAY_WINDOW_MS,
} from './assets.controller';
import {
  mintUploadRenewTicket,
  UPLOAD_RENEW_TICKET_TTL_MS,
} from './upload-renew-ticket';

const MB = 1024 * 1024;
const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const PATH = `${TENANT}/0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.mp4`;
const OTHER_PATH = `${TENANT}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.mp4`;
const SUPA = 'https://example.supabase.co';
const publicUrl = (p: string) => `${SUPA}/storage/v1/object/public/assets/${p}`;

function makeStorage(overrides: Partial<any> = {}) {
  const deleted: string[] = [];
  let n = 0;
  return {
    deleted,
    toSafeBuffer: (b: any) => (Buffer.isBuffer(b) ? b : Buffer.from(b)),
    upload: jest.fn(async () => publicUrl('x')),
    delete: jest.fn(async (p: string) => {
      deleted.push(p);
    }),
    publicUrlForPath: publicUrl,
    bucketName: () => 'assets',
    resumableUploadEndpoint: () => `${SUPA}/storage/v1/upload/resumable/sign`,
    assetsBucketCap: () => 2 * 1024 * MB,
    assertObjectExists: jest.fn(async () => undefined),
    getObjectInfo: jest.fn(async () => ({
      size: 900 * MB,
      contentType: 'video/mp4',
    })),
    download: jest.fn(async () => null),
    createSignedUploadUrl: jest.fn(async (p: string) => ({
      path: p,
      token: `tok-${++n}`,
      signedUrl: `${SUPA}/storage/v1/object/upload/sign/assets/${p}?token=tok-${n}`,
      publicUrl: publicUrl(p),
    })),
    ...overrides,
  } as any;
}

function makePrisma(rows: any[] = []) {
  return {
    rows,
    client: {
      assetFolder: { findFirst: jest.fn(async () => null) },
      asset: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const clause of where?.OR ?? []) {
            if (typeof clause.fileUrl === 'string') {
              const hit = rows.find((r) => r.fileUrl === clause.fileUrl);
              if (hit) return hit;
            }
            if (clause.AND) {
              const tenant = clause.AND[0]?.tenantId;
              const ends = clause.AND[1]?.fileUrl?.endsWith;
              const hit = rows.find(
                (r) =>
                  r.tenantId === tenant && ends && r.fileUrl.endsWith(ends),
              );
              if (hit) return hit;
            }
          }
          return null;
        }),
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

function makeController(storage: any, rows: any[] = []) {
  const prisma = makePrisma(rows);
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
  );
  return { controller, prisma };
}

const req = (
  over: Partial<{ tenantId: string; id: string; role: string }> = {},
) => ({
  user: { tenantId: TENANT, id: 'user-1', role: 'CONTRIBUTOR', ...over },
});

async function expectHttp(
  fn: () => Promise<any>,
  status: HttpStatus,
  code?: string,
) {
  let err: any;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(HttpException);
  expect(err.getStatus()).toBe(status);
  if (code) expect(err.getResponse().code).toBe(code);
  return err;
}

describe('presign — resumable descriptor + renew ticket + per-type ceiling', () => {
  it('a 1.5 GB video is accepted and gets a TUS descriptor bound to the minted path', async () => {
    const storage = makeStorage();
    const { controller } = makeController(storage);
    const res: any = await controller.presignUpload(req() as any, {
      filename: 'gym-4k.mp4',
      contentType: 'video/mp4',
      size: 1536 * MB,
    });
    expect(res.storagePath).toMatch(
      new RegExp(`^${TENANT}/[0-9a-f-]{36}\\.mp4$`),
    );
    expect(res.resumable).toEqual({
      endpoint: `${SUPA}/storage/v1/upload/resumable/sign`,
      bucketName: 'assets',
      objectName: res.storagePath,
      chunkSize: 6 * MB,
      cacheControl: '31536000',
    });
    // The per-type ceiling for THIS file (video on the direct path).
    expect(res.maxFileSize).toBe(2 ** 31 - 1);
    expect(typeof res.renewTicket).toBe('string');
    // The browser gets the one-object token — never a key.
    expect(JSON.stringify(res)).not.toMatch(/service_role|SUPABASE_SERVICE/i);
  });

  it('an image keeps its 25 MB ceiling in the response', async () => {
    const { controller } = makeController(makeStorage());
    const res: any = await controller.presignUpload(req() as any, {
      filename: 'a.jpg',
      contentType: 'image/jpeg',
      size: 3 * MB,
    });
    expect(res.maxFileSize).toBe(25 * MB);
  });

  it('a claimed 3 GB video is refused before any token is minted', async () => {
    const storage = makeStorage();
    const { controller } = makeController(storage);
    await expectHttp(
      () =>
        controller.presignUpload(req() as any, {
          filename: 'huge.mp4',
          contentType: 'video/mp4',
          size: 3 * 1024 * MB,
        }),
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('when storage still caps the bucket at 500 MB, a 600 MB video is refused up front with the REAL limit', async () => {
    const storage = makeStorage({ assetsBucketCap: () => 500 * MB });
    const { controller } = makeController(storage);
    const err = await expectHttp(
      () =>
        controller.presignUpload(req() as any, {
          filename: 'v.mp4',
          contentType: 'video/mp4',
          size: 600 * MB,
        }),
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
    expect(err.getResponse().message).toContain('500 MB');
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('the upload gates are unchanged: .mov and .svg are still refused at presign', async () => {
    const { controller } = makeController(makeStorage());
    await expectHttp(
      () =>
        controller.presignUpload(req() as any, {
          filename: 'IMG_1.mov',
          contentType: 'video/quicktime',
          size: 10 * MB,
        }),
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'ASSET_FILE_TYPE_REJECTED',
    );
    await expectHttp(
      () =>
        controller.presignUpload(req() as any, {
          filename: 'logo.svg',
          contentType: 'image/svg+xml',
          size: 1000,
        }),
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'ASSET_SVG_NOT_SUPPORTED',
    );
  });
});

describe('presign/renew — a fresh token for the caller’s OWN in-flight path, nothing else', () => {
  const ticketFor = (
    over: Partial<{
      tenantId: string;
      userId: string;
      storagePath: string;
    }> = {},
    now = Date.now(),
  ) =>
    mintUploadRenewTicket(
      { tenantId: TENANT, userId: 'user-1', storagePath: PATH, ...over },
      now,
    ).ticket;

  it('re-signs the same path for the user, tenant and path the ticket names', async () => {
    const storage = makeStorage();
    const { controller } = makeController(storage);
    const res: any = await controller.renewPresign(req() as any, {
      storagePath: PATH,
      renewTicket: ticketFor(),
    });
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(PATH);
    expect(res.token).toBe('tok-1');
    expect(res.storagePath).toBe(PATH);
  });

  it.each([
    [
      'another user of the same tenant',
      () => ({ r: req({ id: 'user-2' }), t: ticketFor() }),
    ],
    [
      'another tenant',
      () => ({ r: req({ tenantId: OTHER_TENANT }), t: ticketFor() }),
    ],
    [
      'a different path than the ticket names',
      () => ({ r: req(), t: ticketFor({ storagePath: OTHER_PATH }) }),
    ],
    [
      'an expired ticket',
      () => ({
        r: req(),
        t: ticketFor({}, Date.now() - UPLOAD_RENEW_TICKET_TTL_MS - 1000),
      }),
    ],
    [
      'a forged ticket',
      () => ({ r: req(), t: `${ticketFor().slice(0, -4)}AAAA` }),
    ],
    ['no ticket at all', () => ({ r: req(), t: undefined as any })],
  ])('REFUSES %s (403) and mints nothing', async (_name, make) => {
    const storage = makeStorage();
    const { controller } = makeController(storage);
    const { r, t } = make();
    await expectHttp(
      () =>
        controller.renewPresign(r as any, {
          storagePath: PATH,
          renewTicket: t,
        }),
      HttpStatus.FORBIDDEN,
      'ASSET_UPLOAD_RENEW_REFUSED',
    );
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('REFUSES a path an Asset already owns (a finalized upload is never re-opened)', async () => {
    const storage = makeStorage();
    const { controller } = makeController(storage, [
      {
        id: 'a-done',
        tenantId: TENANT,
        uploadedByUserId: 'user-1',
        fileUrl: publicUrl(PATH),
        createdAt: new Date(),
      },
    ]);
    await expectHttp(
      () =>
        controller.renewPresign(req() as any, {
          storagePath: PATH,
          renewTicket: ticketFor(),
        }),
      HttpStatus.CONFLICT,
      'ASSET_UPLOAD_PATH_ALREADY_CLAIMED',
    );
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('REFUSES a ticket-bound path that is not the presign shape', async () => {
    const storage = makeStorage();
    const { controller } = makeController(storage);
    const bad = `${TENANT}/posters/0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.jpg`;
    await expectHttp(
      () =>
        controller.renewPresign(req() as any, {
          storagePath: bad,
          renewTicket: ticketFor({ storagePath: bad }),
        }),
      HttpStatus.BAD_REQUEST,
      'ASSET_UPLOAD_PATH_INVALID',
    );
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe('complete-upload — the STORED content type must be allowed', () => {
  const body = {
    storagePath: PATH,
    filename: 'clip.mp4',
    contentType: 'video/mp4',
    size: 900 * MB,
  };

  it.each([
    'application/octet-stream',
    'text/html',
    'image/svg+xml',
    'video/quicktime',
  ])('REFUSES (415) and DELETES an object stored as %s', async (storedType) => {
    const storage = makeStorage({
      getObjectInfo: jest.fn(async () => ({
        size: 900 * MB,
        contentType: storedType,
      })),
    });
    const { controller, prisma } = makeController(storage);
    await expectHttp(
      () => controller.completeUpload(req() as any, { ...body }),
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'ASSET_STORED_TYPE_REJECTED',
    );
    expect(storage.delete).toHaveBeenCalledWith(PATH);
    expect(prisma.client.asset.create).not.toHaveBeenCalled();
  });

  it('accepts an allowed stored type with parameters (video/mp4; codecs=…)', async () => {
    const storage = makeStorage({
      getObjectInfo: jest.fn(async () => ({
        size: 900 * MB,
        contentType: 'video/mp4; codecs="avc1.640028"',
      })),
    });
    const { controller, prisma } = makeController(storage);
    const res: any = await controller.completeUpload(req() as any, { ...body });
    expect(prisma.client.asset.create).toHaveBeenCalledTimes(1);
    expect(res.mimeType).toBe('video/mp4');
    expect(storage.delete).not.toHaveBeenCalled();
  });
});

describe('complete-upload — idempotent replay for the uploader’s own retry', () => {
  const body = {
    storagePath: PATH,
    filename: 'clip.mp4',
    contentType: 'video/mp4',
    size: 900 * MB,
  };
  const existing = (over: Record<string, unknown> = {}) => ({
    id: 'asset-made',
    tenantId: TENANT,
    uploadedByUserId: 'user-1',
    createdAt: new Date(),
    fileUrl: publicUrl(PATH),
    mimeType: 'video/mp4',
    fileSize: 900 * MB,
    fileHash: null,
    originalName: 'clip.mp4',
    status: 'PENDING_APPROVAL',
    altText: null,
    posterUrl: null,
    ...over,
  });

  it('the SAME user re-sending the same finalize gets the asset it already made — nothing re-runs', async () => {
    const storage = makeStorage();
    const { controller, prisma } = makeController(storage, [existing()]);
    const res: any = await controller.completeUpload(req() as any, { ...body });
    expect(res.id).toBe('asset-made');
    expect(prisma.client.asset.create).not.toHaveBeenCalled();
    expect(storage.getObjectInfo).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('ANOTHER user naming that path still gets the UPLD-02 409', async () => {
    const storage = makeStorage();
    const { controller } = makeController(storage, [existing()]);
    await expectHttp(
      () =>
        controller.completeUpload(req({ id: 'user-2' }) as any, { ...body }),
      HttpStatus.CONFLICT,
    );
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('the same user AFTER the replay window gets the 409 too', async () => {
    const storage = makeStorage();
    const old = new Date(Date.now() - COMPLETE_UPLOAD_REPLAY_WINDOW_MS - 1000);
    const { controller } = makeController(storage, [
      existing({ createdAt: old }),
    ]);
    await expectHttp(
      () => controller.completeUpload(req() as any, { ...body }),
      HttpStatus.CONFLICT,
    );
  });

  it('a row of ANOTHER tenant on the canonical URL is never replayed', async () => {
    const storage = makeStorage();
    const { controller } = makeController(storage, [
      existing({ tenantId: OTHER_TENANT }),
    ]);
    await expectHttp(
      () => controller.completeUpload(req() as any, { ...body }),
      HttpStatus.CONFLICT,
    );
  });
});
