/** Real PostgreSQL race/isolation tests. Only run against an explicitly supplied local scratch DB. */
import { randomUUID } from 'crypto';
import { PrismaClient, Prisma } from '@cms/database';
import { CustomerBusinessService } from './customer-business.service';
import { CustomerConsoleService } from './customer-console.service';
import { LicenseService } from '../license/license.service';
import { withDbRetry } from '../prisma/with-db-retry';

const url = process.env.CUSTOMER_DOMAIN_TEST_DATABASE_URL;
if (url && !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Customer tests require an isolated local scratch database.');
const suite = url ? describe : describe.skip;

suite('customer corporate pool — real Postgres serializable races', () => {
  let db: PrismaClient;
  let svc: CustomerBusinessService;
  let licenses: LicenseService;
  let root: string;
  let a: string;
  let b: string;
  let foreign: string;
  beforeAll(() => {
    db = new PrismaClient({ datasources: { db: { url } } });
    const prisma = { client: db } as any;
    licenses = new LicenseService(prisma);
    const console = new CustomerConsoleService(prisma, {} as any, licenses, { invalidate() {} } as any);
    svc = new CustomerBusinessService(prisma, console, licenses, {} as any, { assertReach: async () => null } as any, {} as any, {} as any, {} as any);
  });
  beforeEach(async () => {
    root = randomUUID(); a = randomUUID(); b = randomUUID(); foreign = randomUUID();
    await db.tenant.create({ data: { id: root, name: 'Pool test', slug: `pool-${root}`, license: { create: { tier: 'ANNUAL', billingMode: 'INVOICE', seatLimit: 5, pooledSeats: true } } } });
    await db.tenant.createMany({ data: [{ id: a, parentId: root, name: 'A', slug: a }, { id: b, parentId: root, name: 'B', slug: b }, { id: foreign, name: 'Foreign', slug: foreign }] });
  });
  afterEach(async () => { await db.tenant.deleteMany({ where: { id: { in: [a, b, root, foreign] } } }); });
  afterAll(async () => { await db.$disconnect(); });

  it('two allocations racing for the same remaining seats cannot over-reserve the pool', async () => {
    const results = await Promise.allSettled([svc.allocate(root, a, { seatLimit: 4 }, null), svc.allocate(root, b, { seatLimit: 4 }, null)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rows = await db.tenant.findMany({ where: { parentId: root } });
    expect(rows.reduce((n, t) => n + (t.allocatedSeats ?? 0), 0)).toBe(4);
    expect(await db.auditLog.count({ where: { tenantId: root, action: 'CUSTOMER_ALLOCATION_UPDATED' } })).toBe(1);
  });

  it('two concurrent pairings cannot consume the same final corporate seat', async () => {
    await db.license.update({ where: { tenantId: root }, data: { seatLimit: 1 } });
    const pair = (tenantId: string) => withDbRetry(() => db.$transaction(async (tx) => {
      await licenses.assertSeatAvailable(tenantId, tx);
      return tx.screen.create({ data: { name: 'Test', deviceFingerprint: randomUUID(), tenantId, pairedAt: new Date() } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    const results = await Promise.allSettled([pair(a), pair(b)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.screen.count({ where: { tenantId: { in: [a, b] } } })).toBe(1);
  });

  it('allocation and pairing races cannot steal the other operation’s committed capacity', async () => {
    await db.license.update({ where: { tenantId: root }, data: { seatLimit: 1 } });
    const pair = () => withDbRetry(() => db.$transaction(async (tx) => {
      await licenses.assertSeatAvailable(b, tx);
      await tx.screen.create({ data: { name: 'Race', deviceFingerprint: randomUUID(), tenantId: b, pairedAt: new Date() } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    const results = await Promise.allSettled([svc.allocate(root, a, { seatLimit: 1 }, null), pair()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const reserved = (await db.tenant.findUniqueOrThrow({ where: { id: a } })).allocatedSeats ?? 0;
    expect(reserved + await db.screen.count({ where: { tenantId: b } })).toBe(1);
  });

  it('foreign locations and invoices return 404 without changing either tenant', async () => {
    await expect(svc.allocate(root, foreign, { seatLimit: 1 }, null)).rejects.toMatchObject({ status: 404 });
    const invoice = await db.customerInvoice.create({ data: { tenantId: foreign, number: randomUUID(), amountCents: 100 } });
    await expect(svc.invoiceDocument(root, invoice.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.downloadPdf(root, invoice.id, null)).rejects.toMatchObject({ status: 404 });
    expect(await db.auditLog.count({ where: { tenantId: root } })).toBe(0);
  });

  it('audit failure rolls back an allocation', async () => {
    await expect(svc.allocate(root, a, { seatLimit: 2 }, randomUUID())).rejects.toBeDefined();
    expect((await db.tenant.findUniqueOrThrow({ where: { id: a } })).allocatedSeats).toBeNull();
  });
});
