/**
 * UPLD-02 (2026-09-02, adversarial security re-audit) —
 * `POST /assets/complete-upload` let a CONTRIBUTOR destroy the stored bytes
 * of ANY asset in their tenant.
 *
 * `storagePath` arrived in the request BODY and was only shape-checked
 * (non-empty, no `..`, no `\`, starts with the tenant prefix, no
 * `/emergency/`). Nothing tied it to a `/presign` the caller performed and
 * nothing checked whether an existing `Asset` already pointed at that object.
 * Two paths then DELETE it:
 *
 *   (a) the real-size cap check — claim `size: 1000`, name a victim object
 *       whose REAL bytes are over cap, and the handler calls
 *       `storage.delete(storagePath)` and throws;
 *   (b) the image-optimization re-upload — a second-generation re-encode of
 *       an already-optimized image is reliably smaller, so the handler
 *       uploads the new copy and deletes the source path.
 *
 * Either destroys the victim's bytes while their `Asset` row keeps pointing
 * at a now-missing object: every screen showing it goes blank. `fileUrl`
 * comes straight out of `GET /api/v1/assets`, so the attacker needs nothing
 * but the lowest write role.
 *
 * These tests drive the real handler with the same lightweight fakes
 * `assets-upload-caps.controller.spec.ts` uses.
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { isMintedUploadPath } from './upload-path';

const MB = 1024 * 1024;
const TENANT = 'tenant-1';
const VICTIM_PATH = `${TENANT}/11111111-2222-4333-8444-555555555555.jpg`;
const FRESH_PATH = `${TENANT}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg`;
const publicUrl = (p: string) =>
  `https://example.supabase.co/storage/v1/object/public/assets/${p}`;

function makeStorage(overrides: Partial<any> = {}) {
  const deleted: string[] = [];
  return {
    deleted,
    toSafeBuffer: (b: any) => (Buffer.isBuffer(b) ? b : Buffer.from(b)),
    upload: jest.fn(async () => publicUrl('new')),
    delete: jest.fn(async (p: string) => { deleted.push(p); }),
    publicUrlForPath: publicUrl,
    assertObjectExists: jest.fn(async () => undefined),
    getObjectInfo: jest.fn(async () => ({ size: 120 * MB, contentType: 'image/jpeg' })),
    download: jest.fn(async () => Buffer.from('victim-bytes')),
    ...overrides,
  } as any;
}

/** Prisma fake whose asset table already holds the VICTIM's row. */
function makePrisma() {
  const rows = [
    { id: 'victim-asset', tenantId: TENANT, fileUrl: publicUrl(VICTIM_PATH) },
  ];
  return {
    rows,
    client: {
      assetFolder: { findFirst: jest.fn(async () => null) },
      asset: {
        // Mirrors the controller's ownership probe: exact canonical URL, or
        // a same-tenant suffix match.
        findFirst: jest.fn(async ({ where }: any) => {
          const or = where?.OR ?? [];
          for (const clause of or) {
            if (clause.fileUrl && typeof clause.fileUrl === 'string') {
              const hit = rows.find((r) => r.fileUrl === clause.fileUrl);
              if (hit) return { id: hit.id };
            }
            if (clause.AND) {
              const tenant = clause.AND[0]?.tenantId;
              const ends = clause.AND[1]?.fileUrl?.endsWith;
              const hit = rows.find((r) => r.tenantId === tenant && ends && r.fileUrl.endsWith(ends));
              if (hit) return { id: hit.id };
            }
          }
          return null;
        }),
        create: jest.fn(async ({ data }: any) => ({ id: 'asset-new', altText: null, ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 'asset-new', ...data })),
      },
      auditLog: { create: jest.fn(async () => ({ id: 'audit-1' })) },
    },
  } as any;
}

function makeController(storage: any, mediaOptOverrides: Partial<any> = {}) {
  const prisma = makePrisma();
  const mediaOpt = {
    isUploadOptimizableImage: () => false,
    optimizeImageForUpload: jest.fn(),
    ...mediaOptOverrides,
  } as any;
  const controller = new AssetsController(
    prisma,
    storage,
    {} as any,
    mediaOpt,
    { generateImageAltText: jest.fn(async () => null) } as any,
    { kickOff: () => {} } as any,
  );
  return { controller, prisma };
}

/** The lowest role that can reach the endpoint. */
const contributorReq = { user: { tenantId: TENANT, id: 'user-attacker', role: 'CONTRIBUTOR' } };

describe('UPLD-02 — complete-upload cannot hijack another asset’s object', () => {
  it('THE ATTACK: naming a victim asset’s storagePath is refused, and nothing is deleted', async () => {
    const storage = makeStorage();
    const { controller } = makeController(storage);

    await expect(
      controller.completeUpload(contributorReq as any, {
        storagePath: VICTIM_PATH,
        filename: 'x.jpg',
        contentType: 'image/jpeg',
        // The claimed size passes the presign-time cap; the REAL object is
        // 120 MB, which is what used to trigger the delete-then-throw path.
        size: 1000,
      }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

    // The bytes are the whole point.
    expect(storage.delete).not.toHaveBeenCalled();
    expect(storage.deleted).toEqual([]);
    // And we never even asked storage about the victim's object.
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('THE ATTACK, optimization variant: refused before the re-upload/delete pair', async () => {
    const storage = makeStorage({
      getObjectInfo: jest.fn(async () => ({ size: 2 * MB, contentType: 'image/jpeg' })),
    });
    const { controller } = makeController(storage, {
      isUploadOptimizableImage: () => true,
      optimizeImageForUpload: jest.fn(async () => ({
        optimized: true,
        buffer: Buffer.from('tiny'),
        finalBytes: 4,
        originalBytes: 2 * MB,
        mimeType: 'image/webp',
        ext: '.webp',
        originalDimensions: null,
        processedDimensions: null,
      })),
    });

    await expect(
      controller.completeUpload(contributorReq as any, {
        storagePath: VICTIM_PATH,
        filename: 'x.jpg',
        contentType: 'image/jpeg',
        size: 1000,
      }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

    expect(storage.delete).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('refuses a path outside the presign shape (another subsystem’s object)', async () => {
    const storage = makeStorage();
    const { controller } = makeController(storage);
    for (const path of [
      `${TENANT}/brand/logo.png`,          // a sub-directory — never minted here
      `${TENANT}/logo.png`,                // not a uuid basename
      `${TENANT}/`,                        // empty tail
      `other-tenant/${'a'.repeat(8)}-1111-4111-8111-111111111111.jpg`,
    ]) {
      await expect(
        controller.completeUpload(contributorReq as any, {
          storagePath: path,
          filename: 'x.jpg',
          contentType: 'image/jpeg',
          size: 1000,
        }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(storage.delete).not.toHaveBeenCalled();
    }
  });

  it('NO REGRESSION: a fresh, unclaimed presign path still finalizes', async () => {
    const storage = makeStorage({
      getObjectInfo: jest.fn(async () => ({ size: 2 * MB, contentType: 'image/jpeg' })),
    });
    const { controller, prisma } = makeController(storage);

    const res = await controller.completeUpload(contributorReq as any, {
      storagePath: FRESH_PATH,
      filename: 'x.jpg',
      contentType: 'image/jpeg',
      size: 2 * MB,
    });

    expect(prisma.client.asset.create).toHaveBeenCalled();
    expect(res).toBeTruthy();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('the shape helper accepts exactly what /presign mints', () => {
    expect(isMintedUploadPath(FRESH_PATH, TENANT)).toBe(true);
    expect(isMintedUploadPath(`${TENANT}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`, TENANT)).toBe(true);
    expect(isMintedUploadPath(`${TENANT}/brand/logo.png`, TENANT)).toBe(false);
    expect(isMintedUploadPath(`${TENANT}/../other/x.png`, TENANT)).toBe(false);
    expect(isMintedUploadPath(FRESH_PATH, 'tenant-2')).toBe(false);
    expect(isMintedUploadPath(undefined, TENANT)).toBe(false);
  });
});
