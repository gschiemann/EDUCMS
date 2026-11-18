/**
 * One POS merchant account, one tenant.
 *
 *   - findConnectionByMerchantId returns a stable answer (oldest row first);
 *   - upsertConnection refuses to bind a store id already connected to a
 *     different tenant, and the OAuth callback reports that clearly.
 */
import { PosService, PosStoreAlreadyConnectedError } from './pos.service';
import { sealCredentials } from '../streaming/creds-cipher';

function sealedRow(id: string, tenantId: string, providerId: string, creds: Record<string, string>, createdAt: Date) {
  const s = sealCredentials(creds);
  return {
    id,
    tenantId,
    providerId,
    encryptedCreds: s.encryptedCreds,
    encryptedDataKey: s.encryptedDataKey,
    createdAt,
    displayName: null,
  };
}

/** A Prisma double that honours providerId / NOT tenantId / orderBy createdAt. */
function makePrisma(rows: any[]) {
  const findMany = jest.fn(async ({ where, orderBy }: any) => {
    let out = rows.filter((r) => (where?.providerId ? r.providerId === where.providerId : true));
    if (where?.NOT?.tenantId) out = out.filter((r) => r.tenantId !== where.NOT.tenantId);
    const byCreated = Array.isArray(orderBy) && orderBy.some((o: any) => o.createdAt === 'asc');
    // Without an explicit order, return NEWEST first — the order a database
    // is free to choose, and the one that exposed the ambiguity.
    out = [...out].sort((a, b) =>
      byCreated ? a.createdAt.getTime() - b.createdAt.getTime() : b.createdAt.getTime() - a.createdAt.getTime(),
    );
    return out;
  });
  const create = jest.fn(async ({ data }: any) => ({ id: 'new', ...data }));
  const update = jest.fn(async ({ data }: any) => ({ id: 'upd', ...data }));
  const findFirst = jest.fn(async ({ where }: any) =>
    rows.find((r) => r.tenantId === where.tenantId && r.providerId === where.providerId) || null,
  );
  const client = {
    posProviderConnection: { findMany, create, update, findFirst },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  return { prisma: { client } as any, findMany, create, update };
}

describe('findConnectionByMerchantId', () => {
  it('is deterministic: the oldest connection for a merchant id wins', async () => {
    const rows = [
      sealedRow('older', 'tenant-a', 'square', { merchantId: 'M1' }, new Date('2026-01-01')),
      sealedRow('newer', 'tenant-b', 'square', { merchantId: 'M1' }, new Date('2026-06-01')),
    ];
    const { prisma, findMany } = makePrisma(rows);
    const svc = new PosService(prisma, {} as any);
    const hit = await svc.findConnectionByMerchantId('M1');
    expect(hit?.id).toBe('older');
    expect(findMany.mock.calls[0][0].orderBy).toEqual(expect.arrayContaining([{ createdAt: 'asc' }]));
  });
});

describe('upsertConnection — one store, one tenant', () => {
  const base = {
    userId: 'u',
    providerId: 'square',
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: null,
    scope: [],
  };

  it('refuses a merchant id already connected to another tenant', async () => {
    const rows = [sealedRow('a', 'tenant-a', 'square', { merchantId: 'M1', storeId: 'M1' }, new Date('2026-01-01'))];
    const { prisma, create, update } = makePrisma(rows);
    const svc = new PosService(prisma, {} as any);
    await expect(svc.upsertConnection({ ...base, tenantId: 'tenant-b', storeId: 'M1' })).rejects.toBeInstanceOf(
      PosStoreAlreadyConnectedError,
    );
    await expect(svc.upsertConnection({ ...base, tenantId: 'tenant-b', storeId: 'M1' })).rejects.toThrow(
      /already connected to another organization/,
    );
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('allows the same tenant to re-authorize its own merchant id', async () => {
    const rows = [sealedRow('a', 'tenant-a', 'square', { merchantId: 'M1', storeId: 'M1' }, new Date('2026-01-01'))];
    const { prisma, update } = makePrisma(rows);
    const svc = new PosService(prisma, {} as any);
    await svc.upsertConnection({ ...base, tenantId: 'tenant-a', storeId: 'M1' });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('allows a different merchant id for a new tenant', async () => {
    const rows = [sealedRow('a', 'tenant-a', 'square', { merchantId: 'M1', storeId: 'M1' }, new Date('2026-01-01'))];
    const { prisma, create } = makePrisma(rows);
    const svc = new PosService(prisma, {} as any);
    await svc.upsertConnection({ ...base, tenantId: 'tenant-b', storeId: 'M2' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
