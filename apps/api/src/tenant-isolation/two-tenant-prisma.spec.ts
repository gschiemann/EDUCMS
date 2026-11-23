/**
 * The two-tenant Prisma double (`two-tenant-prisma.ts`) evaluates a `where`
 * clause with Prisma's semantics. The suites in this directory assert on what
 * a query returns and touches, so they are only as good as this evaluation.
 */
import {
  makeTwoTenantPrisma,
  matchWhere,
  UnsupportedWhereError,
  type Dataset,
} from './two-tenant-prisma';

function dataset(): Dataset {
  return {
    note: [
      { id: 'note-a', tenantId: 'tenant-a', status: 'OPEN', archivedAt: null },
      {
        id: 'note-b',
        tenantId: 'tenant-b',
        status: 'CLOSED',
        archivedAt: null,
      },
    ],
  };
}

describe('two-tenant Prisma double: where semantics', () => {
  it('a plain value filters, and null matches a null column', async () => {
    const prisma = makeTwoTenantPrisma(dataset());
    const open = await prisma.client.note.findMany({
      where: { status: 'OPEN' },
    });
    expect(open.map((r: any) => r.id)).toEqual(['note-a']);
    const live = await prisma.client.note.findMany({
      where: { archivedAt: null },
    });
    expect(live.map((r: any) => r.id).sort()).toEqual(['note-a', 'note-b']);
  });

  it('a key whose value is undefined adds no constraint, as in Prisma', async () => {
    const [row] = dataset().note;
    expect(matchWhere(row, { status: undefined })).toBe(true);
    const prisma = makeTwoTenantPrisma(dataset());
    const all = await prisma.client.note.findMany({
      where: { status: undefined },
    });
    expect(all.map((r: any) => r.id).sort()).toEqual(['note-a', 'note-b']);
  });

  it('a filter it does not model throws instead of matching', () => {
    const [row] = dataset().note;
    expect(() => matchWhere(row, { status: { search: 'OPEN' } })).toThrow(
      UnsupportedWhereError,
    );
  });

  it('every row a read returns is recorded with its tenant', async () => {
    const prisma = makeTwoTenantPrisma(dataset());
    await prisma.client.note.findMany({ where: {} });
    expect(prisma.touched.map((t) => [t.rowId, t.tenantId])).toEqual([
      ['note-a', 'tenant-a'],
      ['note-b', 'tenant-b'],
    ]);
    expect(prisma.foreignTouches('tenant-a').map((t) => t.rowId)).toEqual([
      'note-b',
    ]);
  });
});
