/**
 * Per-organisation storage allowance (2026-09-24). The fake below EVALUATES
 * the tenant filters the service sends (the way tenant-isolation/
 * two-tenant-prisma.ts does), so "another organisation's bytes never count"
 * is proven about the QUERY, not about a fixture that returns a canned sum.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  StorageQuotaService,
  includedStorageBytesFor,
  formatStorageBytes,
  storageQuotaError,
  STORAGE_QUOTA_EXCEEDED,
  STORAGE_GB_FLOOR,
  STORAGE_GB_PER_SCREEN,
} from './storage-quota.service';
import { AssetsController } from './assets.controller';

const GiB = 1024 ** 3;
const MB = 1024 ** 2;

interface World {
  tenants: Array<{
    id: string;
    parentId: string | null;
    archivedAt?: Date | null;
  }>;
  assets: Array<{ tenantId: string; fileSize: number | null }>;
  screens: Array<{ tenantId: string; pairedAt: Date | null }>;
  jobs: Array<{
    tenantId: string;
    status: string;
    originalDeletedAt: Date | null;
    sourceBytes: number | null;
  }>;
}

// Faithful to Prisma: NO tenant filter matches EVERY row (that is the regression
// the negative control below has to catch), `{ in: [...] }` matches the list.
const inTenants = (where: any, v: string) =>
  where?.tenantId === undefined ||
  (Array.isArray(where.tenantId?.in) && where.tenantId.in.includes(v));

function fakePrisma(w: World) {
  const tenantSets: string[][] = [];
  return {
    tenantSets,
    client: {
      tenant: {
        findUnique: jest.fn(
          async ({ where }: any) =>
            w.tenants.find((t) => t.id === where.id) ?? null,
        ),
        findMany: jest.fn(async ({ where }: any) =>
          w.tenants
            .filter(
              (t) =>
                where.parentId.in.includes(t.parentId) &&
                (t.archivedAt ?? null) === null,
            )
            .map((t) => ({ id: t.id })),
        ),
      },
      screen: {
        count: jest.fn(async ({ where }: any) => {
          // The allowance counts PAIRED screens only.
          expect(where.pairedAt).toEqual({ not: null });
          return w.screens.filter(
            (s) => inTenants(where, s.tenantId) && s.pairedAt !== null,
          ).length;
        }),
      },
      asset: {
        aggregate: jest.fn(async ({ where }: any) => {
          tenantSets.push(
            where?.tenantId?.in ? [...where.tenantId.in] : ['<every tenant>'],
          );
          return {
            _sum: {
              fileSize: w.assets
                .filter((a) => inTenants(where, a.tenantId))
                .reduce((n, a) => n + (a.fileSize ?? 0), 0),
            },
          };
        }),
      },
      videoTranscodeJob: {
        aggregate: jest.fn(async ({ where }: any) => ({
          _sum: {
            sourceBytes: w.jobs
              .filter(
                (j) =>
                  inTenants(where, j.tenantId) &&
                  j.status === where.status &&
                  j.originalDeletedAt === where.originalDeletedAt,
              )
              .reduce((n, j) => n + (j.sourceBytes ?? 0), 0),
          },
        })),
      },
    },
  } as any;
}

/** District A (root) with two live schools and an archived one; district B is another organisation. */
function world(): World {
  return {
    tenants: [
      { id: 'dist-a', parentId: null },
      { id: 'school-a1', parentId: 'dist-a' },
      { id: 'school-a2', parentId: 'dist-a' },
      { id: 'school-a3-archived', parentId: 'dist-a', archivedAt: new Date() },
      { id: 'dist-b', parentId: null },
    ],
    assets: [
      { tenantId: 'dist-a', fileSize: 2 * GiB },
      { tenantId: 'school-a1', fileSize: 3 * GiB },
      { tenantId: 'school-a2', fileSize: null }, // a URL asset stores nothing
      { tenantId: 'dist-b', fileSize: 40 * GiB }, // ANOTHER organisation — must never count
    ],
    screens: [
      { tenantId: 'school-a1', pairedAt: new Date() },
      { tenantId: 'school-a2', pairedAt: new Date() },
      { tenantId: 'school-a2', pairedAt: null }, // never paired — not counted
      { tenantId: 'dist-b', pairedAt: new Date() },
    ],
    jobs: [
      // A swapped-out original still held by the transcode: it is stored, so it counts.
      {
        tenantId: 'school-a1',
        status: 'done',
        originalDeletedAt: null,
        sourceBytes: 1 * GiB,
      },
      // Already deleted: it no longer counts.
      {
        tenantId: 'school-a1',
        status: 'done',
        originalDeletedAt: new Date(),
        sourceBytes: 9 * GiB,
      },
      {
        tenantId: 'dist-b',
        status: 'done',
        originalDeletedAt: null,
        sourceBytes: 9 * GiB,
      },
    ],
  };
}

describe('allowance math', () => {
  it(`max(${STORAGE_GB_FLOOR} GB, ${STORAGE_GB_PER_SCREEN} GB × paired screens)`, () => {
    expect(includedStorageBytesFor(0)).toBe(10 * GiB);
    expect(includedStorageBytesFor(1)).toBe(10 * GiB);
    expect(includedStorageBytesFor(2)).toBe(10 * GiB);
    expect(includedStorageBytesFor(3)).toBe(15 * GiB);
    expect(includedStorageBytesFor(10)).toBe(50 * GiB);
  });

  it('the refusal is a 413 STORAGE_QUOTA_EXCEEDED that names the numbers', () => {
    const e = storageQuotaError(Math.round(0.9 * GiB), {
      orgTenantId: 'x',
      usedBytes: Math.round(49.6 * GiB),
      includedBytes: 50 * GiB,
      screens: 10,
      percent: 99,
      warn: true,
    });
    expect(e.getStatus()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    const body = e.getResponse() as any;
    expect(body.code).toBe(STORAGE_QUOTA_EXCEEDED);
    expect(body.message).toBe(
      'This file needs 0.9 GB; 0.4 GB of your 50 GB is left — delete unused media or add screens.',
    );
    expect(formatStorageBytes(40 * MB)).toBe('40 MB');
    expect(formatStorageBytes(2.3 * GiB)).toBe('2.3 GB');
    expect(formatStorageBytes(50 * GiB)).toBe('50 GB');
  });
});

describe('StorageQuotaService.usage — pooled per organisation', () => {
  it('a school sees its DISTRICT’s pool: every live tenant in the tree, plus originals still held', async () => {
    const svc = new StorageQuotaService(fakePrisma(world()));
    const u = await svc.usage('school-a2');
    expect(u.orgTenantId).toBe('dist-a');
    // 2 + 3 + 0 GB of assets + the 1 GB original the transcode still holds.
    expect(u.usedBytes).toBe(6 * GiB);
    expect(u.screens).toBe(2);
    expect(u.includedBytes).toBe(10 * GiB); // 2 × 5 GB = 10 GB = the floor
    expect(u.percent).toBe(60);
    expect(u.warn).toBe(false);
  });

  it('NEGATIVE CONTROL: another organisation’s bytes and screens never count', async () => {
    const prisma = fakePrisma(world());
    const svc = new StorageQuotaService(prisma);
    const a = await svc.usage('school-a1');
    const b = await svc.usage('dist-b');
    expect(a.usedBytes).toBe(6 * GiB);
    expect(a.screens).toBe(2);
    expect(b.usedBytes).toBe(49 * GiB); // its own 40 GB + its own 9 GB original
    expect(b.screens).toBe(1);
    expect([...prisma.tenantSets[0]].sort()).toEqual([
      'dist-a',
      'school-a1',
      'school-a2',
    ]);
    expect(prisma.tenantSets[1]).toEqual(['dist-b']);
  });

  it('the 80 % flag', async () => {
    const at80 = world();
    at80.assets = [{ tenantId: 'dist-a', fileSize: 8 * GiB }];
    at80.jobs = [];
    const u80 = await new StorageQuotaService(fakePrisma(at80)).usage('dist-a');
    expect([u80.percent, u80.warn]).toEqual([80, true]);

    const below = world();
    below.assets = [{ tenantId: 'dist-a', fileSize: Math.floor(7.9 * GiB) }];
    below.jobs = [];
    const u79 = await new StorageQuotaService(fakePrisma(below)).usage(
      'dist-a',
    );
    expect([u79.percent, u79.warn]).toEqual([79, false]);
  });
});

describe('StorageQuotaService.assertRoomFor', () => {
  it('refuses a file that does not fit and passes one that does (6 of 10 GB used)', async () => {
    const svc = new StorageQuotaService(fakePrisma(world()));
    await expect(
      svc.assertRoomFor('school-a1', 3 * GiB),
    ).resolves.toBeUndefined();
    await expect(
      svc.assertRoomFor('school-a1', 4 * GiB),
    ).resolves.toBeUndefined(); // exactly full is allowed
    const err = await svc
      .assertRoomFor('school-a1', 4 * GiB + 1)
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getResponse().code).toBe(STORAGE_QUOTA_EXCEEDED);
    expect(err.getResponse().message).toContain('4 GB of your 10 GB is left');
  });

  it('`fresh` bypasses the 30 s cache — the complete-upload decision reads live', async () => {
    const w = world();
    const svc = new StorageQuotaService(fakePrisma(w));
    await svc.usage('dist-a'); // caches 6 GB
    w.assets.push({ tenantId: 'dist-a', fileSize: Math.floor(3.5 * GiB) }); // someone just uploaded
    await expect(svc.assertRoomFor('dist-a', 1 * GiB)).resolves.toBeUndefined(); // cached view: 6 GB
    await expect(
      svc.assertRoomFor('dist-a', 1 * GiB, { fresh: true }),
    ).rejects.toBeInstanceOf(HttpException); // live: 9.5 GB
  });

  it('a usage read that fails never blocks an upload', async () => {
    const prisma = fakePrisma(world());
    prisma.client.asset.aggregate.mockRejectedValueOnce(new Error('db down'));
    const svc = new StorageQuotaService(prisma);
    await expect(
      svc.assertRoomFor('dist-a', 500 * GiB),
    ).resolves.toBeUndefined();
  });
});

// ── The upload entry points ──────────────────────────────────────────────────
const TENANT = 'school-a1';
const PATH = `${TENANT}/0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.mp4`;
const publicUrl = (p: string) =>
  `https://example.supabase.co/storage/v1/object/public/assets/${p}`;
const admin = {
  user: { tenantId: TENANT, id: 'user-1', role: 'SCHOOL_ADMIN' },
};

/** An organisation using `usedGiB` of its 10 GB. */
function worldUsing(usedGiB: number): World {
  const w = world();
  w.assets.push({
    tenantId: 'dist-a',
    fileSize: Math.round((usedGiB - 6) * GiB),
  });
  return w;
}

function controllerFor(w: World, opts: { realSize?: number } = {}) {
  const storage = {
    toSafeBuffer: (b: any) => (Buffer.isBuffer(b) ? b : Buffer.from(b)),
    upload: jest.fn(async (p: string) => publicUrl(p)),
    delete: jest.fn(async () => undefined),
    publicUrlForPath: publicUrl,
    bucketName: () => 'assets',
    resumableUploadEndpoint: () =>
      'https://example.supabase.co/storage/v1/upload/resumable/sign',
    assertObjectExists: jest.fn(async () => undefined),
    getObjectInfo: jest.fn(async () => ({
      size: opts.realSize ?? MB,
      contentType: 'video/mp4',
    })),
    download: jest.fn(async () => null),
    createSignedUploadUrl: jest.fn(async (p: string) => ({
      path: p,
      token: 't',
      signedUrl: `https://example.supabase.co/storage/v1/object/upload/sign/assets/${p}?token=t`,
      publicUrl: publicUrl(p),
    })),
  } as any;
  const quotaPrisma = fakePrisma(w);
  const prisma = {
    client: {
      ...quotaPrisma.client,
      assetFolder: { findFirst: jest.fn(async () => null) },
      asset: {
        ...quotaPrisma.client.asset,
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
      auditLog: { create: jest.fn(async () => ({})) },
    },
  } as any;
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
    { enqueue: jest.fn(async () => true) } as any,
    new StorageQuotaService(prisma),
  );
  return { controller, storage, prisma };
}

const quotaCode = (e: any) =>
  e instanceof HttpException
    ? (e.getResponse() as any)?.code
    : `not an HttpException: ${e}`;

describe('the upload entry points enforce the allowance', () => {
  it('presign: the DECLARED size is refused before any storage token is minted', async () => {
    const roomy = controllerFor(worldUsing(6)); // 4 GB left
    await roomy.controller.presignUpload(admin as any, {
      filename: 'big.mp4',
      contentType: 'video/mp4',
      size: Math.floor(1.9 * GiB),
    });
    expect(roomy.storage.createSignedUploadUrl).toHaveBeenCalledTimes(1);

    const tight = controllerFor(worldUsing(9)); // 1 GB left
    const err = await tight.controller
      .presignUpload(admin as any, {
        filename: 'big.mp4',
        contentType: 'video/mp4',
        size: Math.floor(1.9 * GiB),
      })
      .catch((e) => e);
    expect(quotaCode(err)).toBe(STORAGE_QUOTA_EXCEEDED);
    expect(tight.storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('complete-upload: the REAL stored size over the allowance → object deleted, no asset, 413', async () => {
    // The client CLAIMED 10 MB; storage holds 1.9 GB and only 1 GB is left.
    const tight = controllerFor(worldUsing(9), {
      realSize: Math.floor(1.9 * GiB),
    });
    const err = await tight.controller
      .completeUpload(admin as any, {
        storagePath: PATH,
        filename: 'big.mp4',
        contentType: 'video/mp4',
        size: 10 * MB,
      })
      .catch((e) => e);
    expect(quotaCode(err)).toBe(STORAGE_QUOTA_EXCEEDED);
    expect(tight.storage.delete).toHaveBeenCalledWith(PATH);
    expect(tight.prisma.client.asset.create).not.toHaveBeenCalled();

    // …while an organisation with room keeps the same upload.
    const roomy = controllerFor(worldUsing(6), {
      realSize: Math.floor(1.9 * GiB),
    });
    await roomy.controller.completeUpload(admin as any, {
      storagePath: PATH,
      filename: 'big.mp4',
      contentType: 'video/mp4',
      size: 10 * MB,
    });
    expect(roomy.prisma.client.asset.create).toHaveBeenCalledTimes(1);
    expect(roomy.storage.delete).not.toHaveBeenCalled();
  });

  it('multipart: refused on the real bytes BEFORE anything is stored', async () => {
    const w = worldUsing(10);
    w.assets.push({ tenantId: 'dist-a', fileSize: -5 * MB }); // 5 MB left
    const { controller, storage } = controllerFor(w);
    const file: any = {
      buffer: Buffer.alloc(8 * MB),
      mimetype: 'video/mp4',
      originalname: 'clip.mp4',
      size: 8 * MB,
    };
    const err = await controller.upload(admin as any, file, {}).catch((e) => e);
    expect(quotaCode(err)).toBe(STORAGE_QUOTA_EXCEEDED);
    expect(storage.upload).not.toHaveBeenCalled();

    const small: any = {
      buffer: Buffer.alloc(4 * MB),
      mimetype: 'video/mp4',
      originalname: 'clip.mp4',
      size: 4 * MB,
    };
    await controller.upload(admin as any, small, {});
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });

  it('emergency media is NEVER blocked by the allowance', async () => {
    const { controller, storage } = controllerFor(worldUsing(400)); // hopelessly over
    const file: any = {
      buffer: Buffer.alloc(2 * MB),
      mimetype: 'video/mp4',
      originalname: 'lockdown.mp4',
      size: 2 * MB,
    };
    await controller.uploadEmergencyAsset(admin as any, file);
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });

  it('GET /assets/storage answers the organisation pool for the caller’s tenant', async () => {
    const { controller } = controllerFor(world());
    expect(await controller.storageUsage(admin as any)).toEqual({
      usedBytes: 6 * GiB,
      includedBytes: 10 * GiB,
      screens: 2,
      percent: 60,
      warn: false,
    });
  });
});
