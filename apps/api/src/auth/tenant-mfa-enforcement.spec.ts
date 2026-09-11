/**
 * The API-side reader for `Tenant.mfaEnforced` — and the one property that
 * matters about it: IT FAILS CLOSED.
 *
 * The recon for this change (docs/research/2026-09-11-mfa-optional/00-RECON.md)
 * named six ways per-tenant MFA fails OPEN, and five are the same mistake: a
 * gate evaluates a column its query never loaded, `undefined` reads as an
 * affirmative "this tenant does not enforce", and a privileged user walks out
 * with a password-only session and a 200. `tenantMfaEnforced` is the single
 * place that turns every one of those into ENFORCE instead.
 */
import { tenantMfaEnforced, loadTenantMfaEnforced } from './tenant-mfa-enforcement';

describe('tenantMfaEnforced — a missing answer is never permission', () => {
  it('reads an explicit true', () => {
    expect(tenantMfaEnforced({ mfaEnforced: true })).toBe(true);
  });

  it('reads an explicit false — the whole point of the feature', () => {
    expect(tenantMfaEnforced({ mfaEnforced: false })).toBe(false);
  });

  it('null ("never stated") rides the shared default: optional', () => {
    expect(tenantMfaEnforced({ mfaEnforced: null })).toBe(false);
  });

  it('a NULL tenant row fails CLOSED', () => {
    // Deleted, unreadable, or a query that returned nothing. We cannot prove
    // this organization opted out, so we do not act as though it did.
    expect(tenantMfaEnforced(null)).toBe(true);
    expect(tenantMfaEnforced(undefined)).toBe(true);
  });

  it('a row whose `mfaEnforced` was never SELECTED fails CLOSED', () => {
    // THE fail-open the recon ranked first. `validateUser` strips the joined
    // tenant; three other gates join it with narrow selects a new column is
    // not in. Every one of those arrives here as a row without the key.
    expect(tenantMfaEnforced({ slug: 'acme', vertical: 'K12' } as any)).toBe(true);
    expect(tenantMfaEnforced({ mfaEnforced: undefined } as any)).toBe(true);
  });

  it('is not fooled by falsy-but-absent — `undefined` is not `false`', () => {
    // The distinction this whole module exists for: `effectiveMfaEnforced`
    // treats undefined as "never stated" (optional), which is correct for a
    // COLUMN VALUE and catastrophic for a NEVER-LOADED column. Only this
    // wrapper knows which one it is looking at.
    expect(tenantMfaEnforced({} as any)).toBe(true);
  });
});

describe('loadTenantMfaEnforced — the id-only path', () => {
  function fakePrisma(impl: (args: any) => Promise<any>) {
    return { client: { tenant: { findUnique: jest.fn(impl) } } };
  }

  it('resolves the stored value', async () => {
    const prisma = fakePrisma(async () => ({ mfaEnforced: false }));
    await expect(loadTenantMfaEnforced(prisma, 't1')).resolves.toBe(false);
    expect(prisma.client.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: { mfaEnforced: true },
    });
  });

  it('a THROWN query fails CLOSED', async () => {
    const prisma = fakePrisma(async () => {
      throw new Error('pool exhausted');
    });
    await expect(loadTenantMfaEnforced(prisma, 't1')).resolves.toBe(true);
  });

  it('a missing row fails CLOSED', async () => {
    await expect(loadTenantMfaEnforced(fakePrisma(async () => null), 't1')).resolves.toBe(true);
  });

  it('a missing tenant id fails CLOSED without touching the database', async () => {
    const prisma = fakePrisma(async () => ({ mfaEnforced: false }));
    await expect(loadTenantMfaEnforced(prisma, null)).resolves.toBe(true);
    await expect(loadTenantMfaEnforced(prisma, undefined)).resolves.toBe(true);
    expect(prisma.client.tenant.findUnique).not.toHaveBeenCalled();
  });
});
