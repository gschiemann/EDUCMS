/** Real PostgreSQL race/isolation tests. Only run against an explicitly supplied local scratch DB. */
import { randomUUID } from 'crypto';
import { PrismaClient, Prisma } from '@cms/database';
import { CustomerBusinessService } from './customer-business.service';
import { CustomerConsoleService } from './customer-console.service';
import { LicenseService } from '../license/license.service';
import { withDbRetry } from '../prisma/with-db-retry';
import { parseListQuery } from './customer-console.policy';

const url = process.env.CUSTOMER_DOMAIN_TEST_DATABASE_URL;
if (url && !['localhost', '127.0.0.1'].includes(new URL(url).hostname))
  throw new Error('Customer tests require an isolated local scratch database.');
const suite = url ? describe : describe.skip;

suite('customer corporate pool — real Postgres serializable races', () => {
  let db: PrismaClient;
  let svc: CustomerBusinessService;
  let licenses: LicenseService;
  let console: CustomerConsoleService;
  let root: string;
  let a: string;
  let b: string;
  let foreign: string;
  beforeAll(() => {
    db = new PrismaClient({ datasources: { db: { url } } });
    const prisma = { client: db } as any;
    licenses = new LicenseService(prisma);
    console = new CustomerConsoleService(prisma, {} as any, licenses, {
      invalidate() {},
    } as any);
    svc = new CustomerBusinessService(
      prisma,
      console,
      licenses,
      {} as any,
      { assertReach: async () => null } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });
  beforeEach(async () => {
    root = randomUUID();
    a = randomUUID();
    b = randomUUID();
    foreign = randomUUID();
    await db.tenant.create({
      data: {
        id: root,
        name: 'Pool test',
        slug: `pool-${root}`,
        license: {
          create: {
            tier: 'ANNUAL',
            billingMode: 'INVOICE',
            seatLimit: 5,
            pooledSeats: true,
          },
        },
      },
    });
    await db.tenant.createMany({
      data: [
        { id: a, parentId: root, name: 'A', slug: a },
        { id: b, parentId: root, name: 'B', slug: b },
        { id: foreign, name: 'Foreign', slug: foreign },
      ],
    });
  });
  // Each test uses fresh UUIDs. Keep immutable audit rows and their tenant FK
  // targets intact; dispose of the explicit scratch database after the suite.
  afterAll(async () => {
    await db.$disconnect();
  });

  it('two allocations racing for the same remaining seats cannot over-reserve the pool', async () => {
    const results = await Promise.allSettled([
      svc.allocate(root, a, { seatLimit: 4 }, null),
      svc.allocate(root, b, { seatLimit: 4 }, null),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rows = await db.tenant.findMany({ where: { parentId: root } });
    expect(rows.reduce((n, t) => n + (t.allocatedSeats ?? 0), 0)).toBe(4);
    expect(
      await db.auditLog.count({
        where: { tenantId: root, action: 'CUSTOMER_ALLOCATION_UPDATED' },
      }),
    ).toBe(1);
  });

  it('two concurrent pairings cannot consume the same final corporate seat', async () => {
    await db.license.update({
      where: { tenantId: root },
      data: { seatLimit: 1 },
    });
    const pair = (tenantId: string) =>
      withDbRetry(() =>
        db.$transaction(
          async (tx) => {
            await licenses.assertSeatAvailable(tenantId, tx);
            return tx.screen.create({
              data: {
                name: 'Test',
                deviceFingerprint: randomUUID(),
                tenantId,
                pairedAt: new Date(),
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    const results = await Promise.allSettled([pair(a), pair(b)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.screen.count({ where: { tenantId: { in: [a, b] } } })).toBe(
      1,
    );
  });

  it('allocation and pairing races cannot steal the other operation’s committed capacity', async () => {
    await db.license.update({
      where: { tenantId: root },
      data: { seatLimit: 1 },
    });
    const pair = () =>
      withDbRetry(() =>
        db.$transaction(
          async (tx) => {
            await licenses.assertSeatAvailable(b, tx);
            await tx.screen.create({
              data: {
                name: 'Race',
                deviceFingerprint: randomUUID(),
                tenantId: b,
                pairedAt: new Date(),
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    const results = await Promise.allSettled([
      svc.allocate(root, a, { seatLimit: 1 }, null),
      pair(),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const reserved =
      (await db.tenant.findUniqueOrThrow({ where: { id: a } }))
        .allocatedSeats ?? 0;
    expect(reserved + (await db.screen.count({ where: { tenantId: b } }))).toBe(
      1,
    );
  });

  it('foreign locations and invoices return 404 without changing either tenant', async () => {
    await expect(
      svc.allocate(root, foreign, { seatLimit: 1 }, null),
    ).rejects.toMatchObject({ status: 404 });
    const invoice = await db.customerInvoice.create({
      data: { tenantId: foreign, number: randomUUID(), amountCents: 100 },
    });
    await expect(svc.invoiceDocument(root, invoice.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(svc.downloadPdf(root, invoice.id, null)).rejects.toMatchObject(
      { status: 404 },
    );
    expect(await db.auditLog.count({ where: { tenantId: root } })).toBe(0);
  });

  it('audit failure rolls back an allocation', async () => {
    await expect(
      svc.allocate(root, a, { seatLimit: 2 }, randomUUID()),
    ).rejects.toBeDefined();
    expect(
      (await db.tenant.findUniqueOrThrow({ where: { id: a } })).allocatedSeats,
    ).toBeNull();
  });
  it('cannot reserve fewer than paired usage or let an unallocated location take reserved seats', async () => {
    await db.screen.create({
      data: {
        name: 'Existing',
        deviceFingerprint: randomUUID(),
        tenantId: a,
        pairedAt: new Date(),
      },
    });
    await expect(
      svc.allocate(root, a, { seatLimit: 0 }, null),
    ).rejects.toMatchObject({ status: 409 });
    await svc.allocate(root, a, { seatLimit: 5 }, null);
    await expect(licenses.assertSeatAvailable(b, db)).rejects.toMatchObject({
      status: 402,
    });
    await expect(licenses.assertSeatAvailable(a, db)).resolves.toBeUndefined();
    await svc.allocate(root, a, { seatLimit: null }, null);
    await expect(licenses.assertSeatAvailable(b, db)).resolves.toBeUndefined();
  });

  it('rejects oversubscribed contract reductions and unsafe pool opt-out without an audit write', async () => {
    await svc.allocate(root, a, { seatLimit: 4 }, null);
    await expect(
      console.updateLicense(root, { seatLimit: 3 }, null),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      console.updateLicense(root, { pooledSeats: false }, null),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await db.license.findUniqueOrThrow({ where: { tenantId: root } }))
        .seatLimit,
    ).toBe(5);
    expect(
      await db.auditLog.count({
        where: { tenantId: root, action: 'CUSTOMER_LICENSE_UPDATED' },
      }),
    ).toBe(0);
  });

  it('refuses activating pools over independent child licenses or card billing', async () => {
    await db.license.update({
      where: { tenantId: root },
      data: { pooledSeats: false },
    });
    await db.license.create({
      data: { tenantId: a, tier: 'ANNUAL', seatLimit: 1 },
    });
    await expect(
      console.updateLicense(root, { pooledSeats: true }, null),
    ).rejects.toMatchObject({ status: 409 });
    await db.license.delete({ where: { tenantId: a } });
    await db.license.update({
      where: { tenantId: root },
      data: { billingMode: 'CARD' },
    });
    await expect(
      console.updateLicense(root, { pooledSeats: true }, null),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await db.license.findUniqueOrThrow({ where: { tenantId: root } }))
        .pooledSeats,
    ).toBe(false);
  });

  it('keeps a PDF attachment and immutable audit atomic and cleans a failed external upload', async () => {
    const storage = {
      upload: jest.fn(async () => 'new.pdf'),
      remove: jest.fn(async () => undefined),
    };
    const service = new CustomerBusinessService(
      { client: db } as any,
      console,
      licenses,
      {} as any,
      {} as any,
      {} as any,
      storage as any,
      {} as any,
    );
    const invoice = await db.customerInvoice.create({
      data: {
        tenantId: root,
        number: randomUUID(),
        amountCents: 100,
        pdfStoragePath: 'old.pdf',
      },
    });
    const file = {
      originalname: 'i.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from(
        '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n',
      ),
    } as Express.Multer.File;
    await expect(
      service.uploadPdf(root, invoice.id, file, randomUUID()),
    ).rejects.toBeDefined();
    expect(
      (
        await db.customerInvoice.findUniqueOrThrow({
          where: { id: invoice.id, tenantId: root },
        })
      ).pdfStoragePath,
    ).toBe('old.pdf');
    expect(storage.remove).toHaveBeenCalledWith('new.pdf');
    expect(storage.remove).not.toHaveBeenCalledWith('old.pdf');
    expect(
      await db.auditLog.count({
        where: { tenantId: root, action: 'CUSTOMER_INVOICE_PDF_ATTACHED' },
      }),
    ).toBe(0);
  });

  it('cannot disable a pool with paired descendant screens even when all reservations are cleared', async () => {
    await db.screen.create({
      data: {
        name: 'Existing',
        deviceFingerprint: randomUUID(),
        tenantId: a,
        pairedAt: new Date(),
      },
    });
    await expect(
      console.updateLicense(root, { pooledSeats: false }, null),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CUSTOMER_POOL_HAS_PAIRED_LOCATIONS' },
    });
    expect(
      (await db.license.findUniqueOrThrow({ where: { tenantId: root } }))
        .pooledSeats,
    ).toBe(true);
    expect(
      await db.auditLog.count({
        where: { tenantId: root, action: 'CUSTOMER_LICENSE_UPDATED' },
      }),
    ).toBe(0);
  });
  it('exposes fixed package billing and pool fields in list rows fetched by the real select', async () => {
    await db.license.update({
      where: { tenantId: root },
      data: {
        packageName: 'Enterprise',
        packagePriceCents: 12345,
        monthlyPriceCents: 2000,
      },
    });
    const result = await console.list(parseListQuery({ q: root }));
    expect(result.rows).toEqual([
      expect.objectContaining({
        id: root,
        packageName: 'Enterprise',
        packagePriceCents: 12345,
        monthlyPriceCents: 2000,
        pooledSeats: true,
      }),
    ]);
  });
});
