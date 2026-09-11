/**
 * THE ONE WAY THE API READS `Tenant.mfaEnforced` (2026-09-11).
 *
 * WHY THIS FILE EXISTS AT ALL — the recon
 * (docs/research/2026-09-11-mfa-optional/00-RECON.md) named six ways a
 * per-tenant MFA setting fails OPEN, and five of them are the same mistake
 * wearing different clothes: a gate evaluates a tenant column that its query
 * never loaded, `undefined` reads as an affirmative "this tenant does not
 * enforce", and the user gets a full session on a password alone with a 200
 * and no log line. That is byte-for-byte the 7a14ce38 setup-bypass shape.
 *
 * The worst instance is a single line — `auth.service.ts` `validateUser`
 * DELETES the joined tenant (`const { passwordHash, tenant, ...result }`)
 * before the object reaches the login gate. Three more gates join the tenant
 * with narrow `select`s that a new column is simply not in.
 *
 * So this module makes "I forgot to load it" impossible to miss TWICE:
 *
 *  1. COMPILE TIME — {@link TenantMfaPolicyRow} declares `mfaEnforced` as a
 *     REQUIRED key. Prisma types a `select` exactly, so a call site that drops
 *     the column from its select fails `tsc` right here instead of silently
 *     evaluating `undefined`.
 *  2. RUN TIME — {@link tenantMfaEnforced} FAILS CLOSED. No row, no column,
 *     an `as any` row, a stale mock, an older cached payload: every one of
 *     them resolves to ENFORCED, never to "optional". A missing input is not
 *     permission; it is an unanswered question, and the fail-safe answer on a
 *     life-safety platform is the strict one. (Same direction
 *     `resolveMfaEnforceAfter` takes on an unparseable env value: fall back to
 *     the deadline, never to "off".)
 *
 * The one cost of failing closed is a transient DB problem pushing a
 * privileged user into forced enrollment. That is survivable and self-
 * consistent: the enrollment escape hatch reads this SAME helper, so it opens
 * in exactly the cases login closes, and the user always has a door. The
 * reverse bias — fail open — hands out an unenforced admin session instead.
 */
import { effectiveMfaEnforced } from '@cms/api-types';

/**
 * A tenant row loaded for an MFA gate.
 *
 * `mfaEnforced` is a REQUIRED key on purpose — see (1) in the header. If your
 * query does not select it, do not widen this type; widen the query.
 */
export interface TenantMfaPolicyRow {
  mfaEnforced: boolean | null;
}

/**
 * Does this tenant enforce the derived MFA policy?
 *
 * FAILS CLOSED (returns `true`) when the answer cannot be established:
 *   - the tenant row is null/undefined (deleted, unreadable, never fetched);
 *   - the row exists but `mfaEnforced` was never SELECTed.
 *
 * Only a row that genuinely carries `false` (or `null`, "never stated", which
 * resolves through the shared `effectiveMfaEnforced` default) yields optional.
 */
export function tenantMfaEnforced(
  tenant: TenantMfaPolicyRow | null | undefined,
): boolean {
  if (!tenant) return true;
  // Deliberately read through a widened type: the declared shape says this is
  // always present, and this line is the backstop for every caller that
  // reached us through an `as any`, a hand-built object or a test double.
  const stored = (tenant as { mfaEnforced?: boolean | null }).mfaEnforced;
  if (stored === undefined) return true;
  return effectiveMfaEnforced(stored);
}

/**
 * Load the policy for a tenant we only have an id for (the MFA-disable route,
 * the tenant-switch mint). Fails CLOSED on a missing row OR a thrown query —
 * same rule as {@link tenantMfaEnforced}, which it delegates to.
 *
 * Prefer selecting `mfaEnforced` alongside a tenant read the caller is already
 * making; reach for this only when there is no such read to piggyback on.
 */
export async function loadTenantMfaEnforced(
  prisma: {
    client: {
      tenant: {
        findUnique: (args: unknown) => Promise<TenantMfaPolicyRow | null>;
      };
    };
  },
  tenantId: string | null | undefined,
): Promise<boolean> {
  if (!tenantId) return true;
  try {
    // ten-ok: the id IS the tenant scope being resolved — this is the
    // ownership resolver itself, not a tenant-owned row lookup.
    const row = await prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { mfaEnforced: true },
    });
    return tenantMfaEnforced(row);
  } catch {
    return true;
  }
}
