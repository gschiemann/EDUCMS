/**
 * The "system" sentinel tenant.
 *
 * `AuditLog.tenantId` is NOT NULL with an FK to `Tenant.id`, so every audit
 * row needs a real tenant to attribute it to. Most privileged actions happen
 * inside a known tenant — but some security-relevant events have NO natural
 * tenant:
 *
 *   - a failed login against an **unknown email** (credential-stuffing recon
 *     against accounts that don't exist) — there is no tenant for an email
 *     that maps to no user.
 *
 * Fabricating a *real* tenant id for these rows would corrupt that tenant's
 * audit trail; dropping the row (the old behavior) makes the recon invisible
 * in the durable, queryable trail. The fix is this dedicated sentinel tenant:
 * a single well-known row that owns nothing operationally and exists only so
 * cross-tenant / no-tenant security events have a stable, queryable home.
 *
 * This is intentionally NOT a schema change — it's a normal `Tenant` row with
 * a fixed nil-style UUID, created idempotently at runtime (see
 * `ensureSystemTenant`). Forensics query it directly:
 *   SELECT * FROM audit_logs WHERE tenant_id = '00000000-0000-0000-0000-000000000000';
 */

/** Fixed nil-style UUID. Distinct from the seed's demo tenants
 *  (`…0001` district, `…0002` school) so it never collides with real data. */
export const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/** Human-readable name shown anywhere the system tenant surfaces (audit UI). */
export const SYSTEM_TENANT_NAME = 'System (security events)';

/** Unique slug for the system tenant row. */
export const SYSTEM_TENANT_SLUG = '__system__';

/**
 * Idempotently ensure the sentinel tenant row exists, so an `AuditLog` insert
 * attributed to it satisfies the FK. Safe to call repeatedly — it's an upsert
 * with an empty `update`, so after the first call it's a no-op SELECT/INSERT.
 *
 * `client` is duck-typed (`{ tenant: { upsert } }`) so this can be called with
 * a `PrismaService.client`, a bare `PrismaClient`, or a `$transaction` tx
 * handle without importing Nest into a leaf constants file.
 */
export async function ensureSystemTenant(client: {
  tenant: { upsert: (args: any) => Promise<unknown> };
}): Promise<void> {
  await client.tenant.upsert({
    where: { id: SYSTEM_TENANT_ID },
    update: {},
    create: {
      id: SYSTEM_TENANT_ID,
      name: SYSTEM_TENANT_NAME,
      slug: SYSTEM_TENANT_SLUG,
    },
  });
}
