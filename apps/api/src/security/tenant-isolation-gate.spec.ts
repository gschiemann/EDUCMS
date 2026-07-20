// eslint-disable-next-line @typescript-eslint/no-var-requires
const gate = require('../../tools/check-tenant-isolation.cjs');

/**
 * TEN-001: the tenant-isolation static gate must flag a bare-id lookup on a
 * tenant-owned model and NOT flag one that is scoped by tenantId.
 * (The analyzer lives at apps/api/tool../../tools/check-tenant-isolation.cjs.)
 */
describe('check-tenant-isolation analyzer', () => {
  const accessors = new Set(['template', 'playlist', 'screen']);

  function scan(src: string) {
    return gate.scanSourceText(src, 'fixture.ts', accessors);
  }

  it('flags an UNSCOPED bare-id lookup on a tenant-owned model', () => {
    const hits = scan(`prisma.client.template.findUnique({ where: { id } });`);
    expect(hits).toHaveLength(1);
    expect(hits[0].model).toBe('template');
    expect(hits[0].method).toBe('findUnique');
  });

  it('flags update / delete / upsert by bare id too', () => {
    expect(scan(`prisma.client.playlist.update({ where: { id }, data: {} });`)).toHaveLength(1);
    expect(scan(`prisma.client.screen.delete({ where: { id } });`)).toHaveLength(1);
    expect(scan(`prisma.client.template.upsert({ where: { id }, create: {}, update: {} });`)).toHaveLength(1);
  });

  it('does NOT flag a lookup scoped by tenantId', () => {
    expect(scan(`prisma.client.template.findFirst({ where: { id, tenantId } });`)).toHaveLength(0);
    expect(scan(`prisma.client.template.update({ where: { id, tenantId }, data: {} });`)).toHaveLength(0);
  });

  it('does NOT flag a compound key that includes tenant', () => {
    expect(scan(`prisma.client.template.findUnique({ where: { id_tenantId: { id, tenantId } } });`)).toHaveLength(0);
  });

  it('does NOT flag a non-tenant-owned model', () => {
    expect(scan(`prisma.client.someOtherModel.findUnique({ where: { id } });`)).toHaveLength(0);
  });

  it('does NOT flag a non-id lookup (e.g. by slug+tenantId)', () => {
    expect(scan(`prisma.client.template.findFirst({ where: { slug, tenantId } });`)).toHaveLength(0);
  });

  it('reviewed-safe: a `ten-ok:` annotation WITH a reason suppresses (same line or line directly above) and is counted as reviewed', () => {
    const above = scan(
      `// ten-ok: ownership resolver — verified with 403 below\nprisma.client.template.findUnique({ where: { id } });`,
    );
    expect(above).toHaveLength(0);
    expect((above as any).reviewed).toHaveLength(1);
    const inline = scan(
      `prisma.client.template.findUnique({ where: { id } }); // ten-ok: verified against caller tenant right here`,
    );
    expect(inline).toHaveLength(0);
  });

  it('a `ten-ok:` with NO real reason does NOT suppress — the reason is mandatory', () => {
    expect(scan(`// ten-ok:\nprisma.client.template.findUnique({ where: { id } });`)).toHaveLength(1);
    expect(scan(`// ten-ok: ok\nprisma.client.template.findUnique({ where: { id } });`)).toHaveLength(1);
  });

  it('a `ten-ok:` two or more lines above does NOT suppress — the annotation must touch the call', () => {
    expect(
      scan(`// ten-ok: some plausible reason written far away\n\nprisma.client.template.findUnique({ where: { id } });`),
    ).toHaveLength(1);
  });

  it('derives 40+ tenant-owned accessors from the live schema', () => {
    const set = gate.tenantOwnedAccessors();
    expect(set.size).toBeGreaterThan(40);
    expect(set.has('template')).toBe(true);
    expect(set.has('asset')).toBe(true);
  });
});
