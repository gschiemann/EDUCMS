/**
 * Tenant-hierarchy walks — unit tests.
 *
 * These two functions decide the BLAST RADIUS of a district lockdown and who
 * is allowed to fire one. `Tenant.parentId` is an unconstrained self-FK, so
 * the properties pinned here (depth bound, cycle guard, archived exclusion,
 * one query per LEVEL not per tenant) are the difference between a life-safety
 * endpoint and a hang.
 */
import {
  collectDescendantTenantIds,
  isDescendantTenant,
  MAX_TENANT_TREE_DEPTH,
} from './tenant-hierarchy';

/** Tiny in-memory tenant delegate over an id → {parentId, archived} table. */
function makeDelegate(rows: Array<{ id: string; parentId: string | null; archived?: boolean }>) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const findMany = jest.fn(async ({ where }: any) => {
    const parents: string[] = where.parentId.in;
    return rows
      .filter((r) => r.parentId !== null && parents.includes(r.parentId))
      .filter((r) => (where.archivedAt === null ? !r.archived : true))
      .map((r) => ({ id: r.id }));
  });
  const findUnique = jest.fn(async ({ where }: any) => {
    const row = byId.get(where.id);
    return row ? { parentId: row.parentId } : null;
  });
  return { findMany, findUnique } as any;
}

describe('collectDescendantTenantIds', () => {
  it('returns every descendant, excluding the root itself', async () => {
    const d = makeDelegate([
      { id: 'district', parentId: null },
      { id: 'a', parentId: 'district' },
      { id: 'b', parentId: 'district' },
      { id: 'annex', parentId: 'a' },
      { id: 'elsewhere', parentId: null },
    ]);
    const out = await collectDescendantTenantIds(d, 'district');
    expect(out.sort()).toEqual(['a', 'annex', 'b']);
    expect(out).not.toContain('district');
    expect(out).not.toContain('elsewhere');
  });

  it('returns [] for a leaf school (the overwhelmingly common path)', async () => {
    const d = makeDelegate([
      { id: 'district', parentId: null },
      { id: 'a', parentId: 'district' },
    ]);
    expect(await collectDescendantTenantIds(d, 'a')).toEqual([]);
  });

  it('excludes ARCHIVED locations — a retired tenant is not part of the fan-out', async () => {
    const d = makeDelegate([
      { id: 'district', parentId: null },
      { id: 'live', parentId: 'district' },
      { id: 'retired', parentId: 'district', archived: true },
      // A child of an archived tenant is unreachable too: the archived node
      // never enters the frontier, so the walk never descends through it.
      { id: 'under-retired', parentId: 'retired' },
    ]);
    const out = await collectDescendantTenantIds(d, 'district');
    expect(out).toEqual(['live']);
  });

  it('issues ONE query per LEVEL, not one per tenant', async () => {
    const d = makeDelegate([
      { id: 'district', parentId: null },
      ...Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, parentId: 'district' })),
    ]);
    const out = await collectDescendantTenantIds(d, 'district');
    expect(out).toHaveLength(25);
    // level 1 (25 hits) + level 2 (empty, terminates the loop) = 2 queries.
    expect(d.findMany).toHaveBeenCalledTimes(2);
  });

  it('terminates on a parentId CYCLE instead of hanging', async () => {
    // A bad backfill: x → y → x. A life-safety path must never be what
    // discovers this by spinning forever.
    const d = makeDelegate([
      { id: 'root', parentId: null },
      { id: 'x', parentId: 'root' },
      { id: 'y', parentId: 'x' },
      { id: 'root-again', parentId: 'y' },
    ]);
    // Force the cycle: make the deepest node re-parent to an already-seen id.
    d.findMany = jest.fn(async ({ where }: any) => {
      const parents: string[] = where.parentId.in;
      if (parents.includes('root')) return [{ id: 'x' }];
      if (parents.includes('x')) return [{ id: 'y' }];
      if (parents.includes('y')) return [{ id: 'x' }]; // ← cycle back
      return [];
    });
    const out = await collectDescendantTenantIds(d, 'root');
    expect(out).toEqual(['x', 'y']);
  });

  it('stops at MAX_TENANT_TREE_DEPTH on a pathologically deep chain', async () => {
    const rows = [{ id: 't0', parentId: null as string | null }];
    for (let i = 1; i <= MAX_TENANT_TREE_DEPTH + 5; i++) {
      rows.push({ id: `t${i}`, parentId: `t${i - 1}` });
    }
    const out = await collectDescendantTenantIds(makeDelegate(rows), 't0');
    expect(out).toHaveLength(MAX_TENANT_TREE_DEPTH);
  });

  it('is a no-op for a falsy root id', async () => {
    const d = makeDelegate([]);
    expect(await collectDescendantTenantIds(d, '')).toEqual([]);
    expect(d.findMany).not.toHaveBeenCalled();
  });
});

describe('isDescendantTenant (the emergency scope gate)', () => {
  const tree = () =>
    makeDelegate([
      { id: 'district', parentId: null },
      { id: 'a', parentId: 'district' },
      { id: 'b', parentId: 'district' },
      { id: 'annex', parentId: 'a' },
      { id: 'other-district', parentId: null },
      { id: 'other-school', parentId: 'other-district' },
    ]);

  it('recognises a direct child and a grandchild', async () => {
    expect(await isDescendantTenant(tree(), 'a', 'district')).toBe(true);
    expect(await isDescendantTenant(tree(), 'annex', 'district')).toBe(true);
    expect(await isDescendantTenant(tree(), 'annex', 'a')).toBe(true);
  });

  it('is strictly DOWNWARD — a school is never an ancestor of its district', async () => {
    // This is the escalation the gate exists to stop: a SCHOOL_ADMIN must
    // not be able to reach district scope.
    expect(await isDescendantTenant(tree(), 'district', 'a')).toBe(false);
    expect(await isDescendantTenant(tree(), 'a', 'annex')).toBe(false);
  });

  it('rejects siblings and unrelated districts', async () => {
    expect(await isDescendantTenant(tree(), 'b', 'a')).toBe(false);
    expect(await isDescendantTenant(tree(), 'other-school', 'district')).toBe(false);
    expect(await isDescendantTenant(tree(), 'a', 'other-district')).toBe(false);
  });

  it('a tenant is NOT its own ancestor (identity is handled by the caller)', async () => {
    expect(await isDescendantTenant(tree(), 'a', 'a')).toBe(false);
  });

  it('handles missing rows and falsy ids without throwing', async () => {
    expect(await isDescendantTenant(tree(), 'ghost', 'district')).toBe(false);
    expect(await isDescendantTenant(tree(), '', 'district')).toBe(false);
    expect(await isDescendantTenant(tree(), 'a', '')).toBe(false);
  });

  it('costs one lookup per HOP, not one per tenant in the district', async () => {
    const d = tree();
    await isDescendantTenant(d, 'annex', 'district');
    // annex → a (miss), a → district (hit) = 2 lookups regardless of how
    // many schools the district has.
    expect(d.findUnique).toHaveBeenCalledTimes(2);
  });

  it('terminates on a parentId cycle', async () => {
    const d = makeDelegate([]);
    d.findUnique = jest.fn(async ({ where }: any) =>
      where.id === 'x' ? { parentId: 'y' } : { parentId: 'x' },
    );
    expect(await isDescendantTenant(d, 'x', 'unrelated')).toBe(false);
  });
});
