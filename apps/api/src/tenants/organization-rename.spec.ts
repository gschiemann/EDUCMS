import { AppRole } from '@cms/database';
import { ORGANIZATION_NAME_MAX_LENGTH } from '@cms/api-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { TenantsController } from './tenants.controller';

/**
 * PATCH /api/v1/tenants/me — saving the organization name also renames the
 * account URL (the tenant slug), in one transaction with its audit row.
 *
 * These specs run against an in-memory database that behaves like a real one
 * where it matters here, so they prove outcomes rather than that a mock was
 * called:
 *   - `$transaction` snapshots state and COMMITS only if the callback resolves;
 *     a throw discards everything the callback did (a real ROLLBACK).
 *   - the handle used OUTSIDE a transaction throws on any read or write, so a
 *     handler that wrote its audit row (or read the SSO config) through
 *     `this.prisma.client` instead of `tx` fails loudly — that write would
 *     survive the rollback it is meant to share.
 *   - `Tenant.slug` is unique: an update that collides with a row committed by
 *     someone else throws a Prisma-shaped P2002.
 */

const ME = 'abcdef12-0000-4000-8000-000000000001';
const OTHER = '99999999-0000-4000-8000-000000000002';

type TenantRow = { id: string; name: string; slug: string; vertical: string | null; address: string | null };
interface State { tenants: Map<string, TenantRow>; sso: Map<string, { enabled: boolean }>; audit: Array<Record<string, any>> }

const p2002 = (field: string) =>
  Object.assign(new Error(`Unique constraint failed on the fields: (\`${field}\`)`), { code: 'P2002', meta: { target: [field] } });

function pick<T extends Record<string, any>>(row: T, select?: Record<string, boolean>) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.entries(select).filter(([, on]) => on).map(([key]) => [key, row[key]]));
}

class FakeDatabase {
  committed: State = { tenants: new Map(), sso: new Map(), audit: [] };
  transactions = 0;
  slugReads = 0;
  ssoReads = 0;
  /** Thrown by the audit insert. */
  auditError: unknown = null;
  /** Thrown by the tenant update, per attempt (1-based). */
  updateError: ((attempt: number) => unknown) | null = null;
  /** Runs just before the tenant update — a "concurrent request" gets to commit first. */
  beforeUpdate: ((db: FakeDatabase, attempt: number) => void) | null = null;

  constructor() {
    this.addTenant({ id: ME, name: 'Harbor Demo', slug: 'harbor-demo', vertical: 'CORPORATE', address: null });
    this.addTenant({ id: OTHER, name: 'Unrelated Org', slug: 'unrelated-org', vertical: 'K12', address: null });
  }

  addTenant(row: TenantRow) { this.committed.tenants.set(row.id, { ...row }); }
  row(id: string) { return this.committed.tenants.get(id)!; }

  private handle(working: State, attempt: number, touched: Set<string>) {
    return {
      tenant: {
        findUnique: async ({ where, select }: any) => {
          if (where.slug !== undefined) this.slugReads += 1;
          const row = where.id !== undefined
            ? working.tenants.get(where.id)
            : [...working.tenants.values()].find((t) => t.slug === where.slug);
          return row ? pick(row, select) : null;
        },
        update: async ({ where, data, select }: any) => {
          this.beforeUpdate?.(this, attempt);
          const injected = this.updateError?.(attempt);
          if (injected) throw injected;
          if (data.slug !== undefined) {
            // The unique index sees this transaction's rows AND anything others have committed since.
            const clash = [...this.committed.tenants.values(), ...working.tenants.values()]
              .find((t) => t.id !== where.id && t.slug === data.slug);
            if (clash) throw p2002('slug');
          }
          const row = working.tenants.get(where.id)!;
          Object.assign(row, data);
          touched.add(where.id);
          return pick(row, select);
        },
      },
      tenantSSOConfig: {
        findUnique: async ({ where }: any) => {
          this.ssoReads += 1;
          const row = working.sso.get(where.tenantId);
          if (!row) return null;
          // Honour every filter the handler passes: filtering on `enabled` would hide a switched-off row.
          if (where.enabled !== undefined && where.enabled !== row.enabled) return null;
          return { id: 'sso-config' };
        },
      },
      auditLog: {
        create: async ({ data }: any) => {
          if (this.auditError) throw this.auditError;
          working.audit.push(JSON.parse(JSON.stringify(data)));
          return data;
        },
      },
    };
  }

  get client() {
    const outside = (what: string) => async () => { throw new Error(`${what} was used outside the transaction`); };
    return {
      tenant: { findUnique: outside('tenant.findUnique'), update: outside('tenant.update') },
      tenantSSOConfig: { findUnique: outside('tenantSSOConfig.findUnique') },
      auditLog: { create: outside('auditLog.create') },
      $transaction: async (callback: (tx: any) => Promise<unknown>) => {
        this.transactions += 1;
        const working: State = {
          tenants: new Map([...this.committed.tenants].map(([id, row]) => [id, { ...row }])),
          sso: new Map(this.committed.sso),
          audit: [],
        };
        const touched = new Set<string>();
        const result = await callback(this.handle(working, this.transactions, touched));
        // COMMIT — reached only when the callback resolved. Merge row-wise so a
        // concurrent committer's rows survive.
        for (const id of touched) this.committed.tenants.set(id, { ...working.tenants.get(id)! });
        this.committed.audit.push(...working.audit);
        return result;
      },
    };
  }
}

function setup(configure?: (db: FakeDatabase) => void) {
  const db = new FakeDatabase();
  configure?.(db);
  const controller = new TenantsController({ client: db.client } as any, {} as any, {} as any);
  // Production's JwtAuthGuard populates BOTH `id` and `userId` on req.user.
  const req: any = { user: { id: 'operator-1', userId: 'operator-1', tenantId: ME, role: AppRole.DISTRICT_ADMIN } };
  const patch = (body: Record<string, unknown>) => controller.updateMyTenant(req, body as any);
  return { db, controller, patch };
}

const auditDetails = (db: FakeDatabase) => JSON.parse(db.committed.audit[0].details);

describe('PATCH /tenants/me — a name change renames the account URL', () => {
  it('renames the organization and its URL together, with one audit row naming what it replaced', async () => {
    const { db, patch } = setup();
    const result = await patch({ name: ' Riverside Homes ' });

    expect(result).toEqual({
      id: ME, name: 'Riverside Homes', slug: 'riverside-homes', vertical: 'CORPORATE', address: null, urlKept: null,
    });
    expect(db.row(ME)).toMatchObject({ name: 'Riverside Homes', slug: 'riverside-homes' });
    expect(db.committed.audit).toHaveLength(1);
    expect(db.committed.audit[0]).toMatchObject({
      tenantId: ME, userId: 'operator-1', action: 'TENANT_UPDATED', targetType: 'Tenant', targetId: ME,
    });
    expect(auditDetails(db)).toMatchObject({
      name: 'Riverside Homes', slug: 'riverside-homes', previousName: 'Harbor Demo', previousSlug: 'harbor-demo',
    });
    expect(db.transactions).toBe(1);
  });

  it('leaves a URL that is not the name’s own alone when the same name is sent back', async () => {
    // A client that always posts name + address must not rename the URL on an address edit.
    const { db, patch } = setup((d) => d.addTenant({ id: ME, name: 'Riverside Homes', slug: 'legacy-label', vertical: 'CORPORATE', address: null }));
    const result: any = await patch({ name: 'Riverside Homes', address: '12 Quay Road' });

    expect(result).toMatchObject({ name: 'Riverside Homes', slug: 'legacy-label', address: '12 Quay Road', urlKept: null });
    expect(db.row(ME).slug).toBe('legacy-label');
    expect(db.slugReads).toBe(0);
    expect(auditDetails(db)).not.toHaveProperty('slug');
  });

  it('address-only and industry-only saves never touch the URL, never look for a free one', async () => {
    const { db, patch } = setup();
    await patch({ address: 'New address' });
    expect(db.row(ME)).toMatchObject({ address: 'New address', slug: 'harbor-demo', name: 'Harbor Demo' });
    await patch({ vertical: 'gym' });
    expect(db.row(ME)).toMatchObject({ vertical: 'GYM', slug: 'harbor-demo', name: 'Harbor Demo' });
    expect(db.slugReads).toBe(0);
    expect(db.ssoReads).toBe(0);
    expect(db.committed.audit.map((a) => JSON.parse(a.details))).toEqual([
      expect.not.objectContaining({ slug: expect.anything() }),
      expect.not.objectContaining({ slug: expect.anything() }),
    ]);
  });

  it('writes only the caller’s own organization and ignores any other id or slug in the body', async () => {
    const { db, patch } = setup();
    await patch({ name: 'Riverside Homes', slug: 'evil', id: OTHER, tenantId: OTHER });
    expect(db.row(ME)).toMatchObject({ name: 'Riverside Homes', slug: 'riverside-homes' });
    expect(db.row(OTHER)).toMatchObject({ name: 'Unrelated Org', slug: 'unrelated-org' });
    expect(db.committed.audit.every((a) => a.tenantId === ME && a.targetId === ME)).toBe(true);
  });

  it('never lets the body choose the URL: a slug there is ignored even when no new URL is being derived', async () => {
    // Address-only save: nothing derives a slug, so a mass-assigned one would land untouched.
    const plain = setup();
    await plain.patch({ address: 'New address', slug: 'evil' });
    expect(plain.db.row(ME).slug).toBe('harbor-demo');
    // Single-sign-on tenant: the URL is deliberately kept, so a body slug must not replace it either.
    const sso = setup((d) => d.committed.sso.set(ME, { enabled: true }));
    await sso.patch({ name: 'Riverside Homes', slug: 'evil' });
    expect(sso.db.row(ME).slug).toBe('harbor-demo');
  });

  it('answers 404 for a signed-in tenant that no longer exists, writing nothing', async () => {
    const { db, patch } = setup((d) => d.committed.tenants.delete(ME));
    await expect(patch({ name: 'Riverside Homes' })).rejects.toMatchObject({ status: 404, response: { code: 'TENANT_NOT_FOUND' } });
    expect(db.committed.audit).toHaveLength(0);
  });

  it('keeps its role guard: only SUPER_ADMIN and DISTRICT_ADMIN, behind the JWT and RBAC guards', () => {
    expect(Reflect.getMetadata('roles', TenantsController.prototype.updateMyTenant)).toEqual([
      AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN,
    ]);
    expect(Reflect.getMetadata('__guards__', TenantsController)).toEqual(expect.arrayContaining([JwtAuthGuard, RbacGuard]));
  });
});

describe('PATCH /tenants/me — single sign-on keeps the URL', () => {
  it('still renames the organization but keeps its URL, and says why', async () => {
    const { db, patch } = setup((d) => d.committed.sso.set(ME, { enabled: true }));
    const result: any = await patch({ name: 'Riverside Homes' });

    expect(result).toMatchObject({ name: 'Riverside Homes', slug: 'harbor-demo', urlKept: 'sso' });
    expect(db.row(ME)).toMatchObject({ name: 'Riverside Homes', slug: 'harbor-demo' });
    expect(db.ssoReads).toBe(1);
    expect(db.slugReads).toBe(0);
    expect(auditDetails(db)).toMatchObject({ name: 'Riverside Homes', previousSlug: 'harbor-demo', urlKept: 'sso' });
    expect(auditDetails(db)).not.toHaveProperty('slug');
  });

  it('keeps the URL even when the configuration row exists but is switched off', async () => {
    // The identity provider's registered URLs are still there; re-enabling must not find them dead.
    const { db, patch } = setup((d) => d.committed.sso.set(ME, { enabled: false }));
    await expect(patch({ name: 'Riverside Homes' })).resolves.toMatchObject({ slug: 'harbor-demo', urlKept: 'sso' });
    expect(db.row(ME).slug).toBe('harbor-demo');
  });

  it('reads the configuration inside the transaction (the handle outside it throws)', async () => {
    // FakeDatabase.client.tenantSSOConfig.findUnique throws; reaching urlKept proves the read used `tx`.
    const { patch } = setup((d) => d.committed.sso.set(ME, { enabled: true }));
    await expect(patch({ name: 'Riverside Homes' })).resolves.toMatchObject({ urlKept: 'sso' });
  });

  it('only another tenant’s configuration does not hold this one’s URL', async () => {
    const { db, patch } = setup((d) => d.committed.sso.set(OTHER, { enabled: true }));
    await expect(patch({ name: 'Riverside Homes' })).resolves.toMatchObject({ slug: 'riverside-homes', urlKept: null });
    expect(db.row(ME).slug).toBe('riverside-homes');
  });

  it('does not read the configuration, or report anything, when the name did not change', async () => {
    const { db, patch } = setup((d) => { d.committed.sso.set(ME, { enabled: true }); });
    await expect(patch({ address: 'New address' })).resolves.toMatchObject({ urlKept: null });
    expect(db.ssoReads).toBe(0);
  });
});

describe('PATCH /tenants/me — the unique constraint is the real guard', () => {
  it('a competing claim between the availability read and the write rolls back and retries with a suffix', async () => {
    const { db, patch } = setup((d) => {
      d.beforeUpdate = (database, attempt) => {
        // Another request commits the very label we were about to take, after our read saw it free.
        if (attempt === 1) database.addTenant({ id: 'racer', name: 'Riverside Homes', slug: 'riverside-homes', vertical: null, address: null });
      };
    });
    const result: any = await patch({ name: 'Riverside Homes' });

    expect(result.slug).toBe('riverside-homes-abcdef12');
    expect(db.row(ME).slug).toBe('riverside-homes-abcdef12');
    expect(db.row('racer').slug).toBe('riverside-homes');
    expect(db.transactions).toBe(2);
    // Exactly one audit row, from the attempt that committed — the failed one wrote nothing.
    expect(db.committed.audit).toHaveLength(1);
    expect(auditDetails(db)).toMatchObject({ slug: 'riverside-homes-abcdef12', previousSlug: 'harbor-demo' });
  });

  it('gives up with 409 TENANT_URL_BUSY after three lost races, leaving the organization exactly as it was', async () => {
    const { db, patch } = setup((d) => { d.updateError = () => p2002('slug'); });
    await expect(patch({ name: 'Riverside Homes' })).rejects.toMatchObject({ status: 409, response: { code: 'TENANT_URL_BUSY' } });
    expect(db.transactions).toBe(3);
    expect(db.row(ME)).toMatchObject({ name: 'Harbor Demo', slug: 'harbor-demo' });
    expect(db.committed.audit).toHaveLength(0);
  });

  it('retries a transaction write conflict (P2034) the same bounded way', async () => {
    const { db, patch } = setup((d) => { d.updateError = (attempt) => (attempt < 3 ? { code: 'P2034' } : null); });
    await expect(patch({ name: 'Riverside Homes' })).resolves.toMatchObject({ slug: 'riverside-homes' });
    expect(db.transactions).toBe(3);

    const busy = setup((d) => { d.updateError = () => ({ code: 'P2034' }); });
    await expect(busy.patch({ name: 'Riverside Homes' })).rejects.toMatchObject({ status: 409, response: { code: 'TENANT_URL_BUSY' } });
    expect(busy.db.transactions).toBe(3);
  });

  it('does not retry any other database error', async () => {
    const { db, patch } = setup((d) => { d.updateError = () => Object.assign(new Error('connection lost'), { code: 'P1001' }); });
    await expect(patch({ name: 'Riverside Homes' })).rejects.toThrow('connection lost');
    expect(db.transactions).toBe(1);
  });
});

describe('PATCH /tenants/me — the audit row is part of the save', () => {
  it('an audit failure rolls the rename back: no new name, no new URL, no audit row', async () => {
    const { db, patch } = setup((d) => { d.auditError = new Error('audit unavailable'); });
    await expect(patch({ name: 'Riverside Homes' })).rejects.toThrow('audit unavailable');

    expect(db.row(ME)).toMatchObject({ name: 'Harbor Demo', slug: 'harbor-demo' });
    expect(db.committed.audit).toHaveLength(0);
    expect(db.transactions).toBe(1);
  });

  it('an audit failure on an address-only save rolls that back too', async () => {
    const { db, patch } = setup((d) => { d.auditError = new Error('audit unavailable'); });
    await expect(patch({ address: 'New address' })).rejects.toThrow('audit unavailable');
    expect(db.row(ME).address).toBeNull();
  });

  it('an audit uniqueness failure is not mistaken for a URL collision and retried', async () => {
    const { db, patch } = setup((d) => { d.auditError = p2002('id'); });
    await expect(patch({ name: 'Riverside Homes' })).rejects.toMatchObject({ code: 'P2002' });
    expect(db.transactions).toBe(1);
    expect(db.row(ME).slug).toBe('harbor-demo');
  });
});

describe('PATCH /tenants/me — the name is bounded', () => {
  const invalid: Array<[string, unknown]> = [
    ['empty', ''],
    ['whitespace only', '   \n\t '],
    ['a number', 42],
    ['null', null],
    ['an object', { first: 'Riverside' }],
    ['an array', ['Riverside Homes']],
  ];
  it.each(invalid)('refuses a name that is %s with 400 before any transaction', async (_label, name) => {
    const { db, patch } = setup();
    await expect(patch({ name })).rejects.toMatchObject({ status: 400, response: { code: 'TENANT_NAME_REQUIRED' } });
    expect(db.transactions).toBe(0);
    expect(db.row(ME).name).toBe('Harbor Demo');
  });

  it(`refuses a name over ${ORGANIZATION_NAME_MAX_LENGTH} characters (counted after trimming) and accepts exactly ${ORGANIZATION_NAME_MAX_LENGTH}`, async () => {
    const { db, patch } = setup();
    await expect(patch({ name: 'a'.repeat(ORGANIZATION_NAME_MAX_LENGTH + 1) })).rejects.toMatchObject({
      status: 400, response: { code: 'TENANT_NAME_TOO_LONG' },
    });
    expect(db.transactions).toBe(0);

    // Padding does not count against the limit: it is trimmed first.
    const exact = 'a'.repeat(ORGANIZATION_NAME_MAX_LENGTH);
    const result: any = await patch({ name: `   ${exact}   ` });
    expect(result.name).toBe(exact);
    // The URL derived from a 120-character name is itself bounded.
    expect(result.slug.length).toBeLessThanOrEqual(60);
  });

  it('still refuses an unknown industry with 400', async () => {
    const { db, patch } = setup();
    await expect(patch({ vertical: 'not-a-vertical' })).rejects.toMatchObject({ status: 400, response: { code: 'TENANT_VERTICAL_INVALID' } });
    expect(db.transactions).toBe(0);
  });

  it('refuses an empty save with 400', async () => {
    const { patch } = setup();
    await expect(patch({})).rejects.toMatchObject({ status: 400, response: { code: 'TENANT_NOTHING_TO_UPDATE' } });
  });
});
