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

/**
 * GATE-01 (2026-08-04) — two blind spots closed.
 *
 * STEP 2: the gate matched on argument SYNTAX, so `{ where: { id } } as any`
 * wrapped the object literal in an AsExpression and the call became invisible.
 * A cast is exactly what a developer writes when Prisma's types complain, which
 * made `as any` an accidental way to silence the gate. Live example:
 * users.controller.ts:145.
 *
 * STEP 3: the `ten-ok:` window was a single line, so a multi-line
 * justification — which is what a real one looks like — did not suppress. Once
 * step 2 made cast-wrapped calls visible, those sites would have failed CI
 * despite the reason sitting directly above them, and the practical response
 * would be cramming it onto one line or reaching for UPDATE_BASELINE.
 */
describe('GATE-01 — casts no longer hide a call, and a real justification is reachable', () => {
  // `scan` above is scoped to its own describe; re-declare against the same
  // accessor set so these cases are self-contained.
  const accessors = new Set(['template', 'playlist', 'screen']);
  const scan = (src: string) => gate.scanSourceText(src, 'fixture.ts', accessors);

  it('sees through `as any` on the args object', () => {
    expect(
      scan(`prisma.client.template.findUnique({ where: { id } } as any);`),
    ).toHaveLength(1);
  });

  it('sees through `as any` on the where value, and through parens', () => {
    expect(
      scan(`prisma.client.template.findUnique({ where: { id } as any });`),
    ).toHaveLength(1);
    expect(
      scan(`prisma.client.template.findUnique(({ where: { id } }));`),
    ).toHaveLength(1);
  });

  it('a cast does not defeat a legitimate tenant scope either (no false positive)', () => {
    expect(
      scan(`prisma.client.template.findUnique({ where: { id, tenantId } } as any);`),
    ).toHaveLength(0);
  });

  it('a MULTI-LINE comment block directly above the call suppresses', () => {
    // The shape a real justification actually takes — and the exact shape
    // living at users.controller.ts:141-145.
    const src = [
      '// ten-ok: resolve-then-verify — the tenant subtree is asserted a few lines',
      '// below (403 on miss) and SUPER_ADMIN is cross-tenant by design, so the',
      '// lookup cannot be pre-scoped without breaking district->school reach.',
      'prisma.client.template.findFirst({ where: { id, deletedAt: null } as any });',
    ].join('\n');
    const res = scan(src);
    expect(res).toHaveLength(0);
    expect((res as any).reviewed).toHaveLength(1);
  });

  it('the block must TOUCH the call — code in between breaks it', () => {
    // Guards against a stale annotation drifting onto an unrelated query below.
    const src = [
      '// ten-ok: a reason that belongs to the statement below it, not the query',
      'const somethingElse = 1;',
      'prisma.client.template.findUnique({ where: { id } });',
    ].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('still requires a real reason inside the block', () => {
    const src = ['// ten-ok:', '// (nothing useful here)', 'prisma.client.template.findUnique({ where: { id } });'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });
});
