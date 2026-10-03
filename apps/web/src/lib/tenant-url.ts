import { isReservedTenantSlug } from '@cms/api-types';

export interface TenantUrlIdentity {
  id?: string;
  slug?: string;
}

/**
 * Re-label the signed-in organization's OWN stale URL, and nothing else.
 *
 * Renaming an organization changes its slug (the first path segment), so every
 * bookmark, email link and open tab that still carries the old label points at
 * a label no organization holds. For a signed-in member this returns the same
 * page under the current label, keeping the whole deep link (path, query,
 * anchor). It never switches accounts, mints a token or treats a URL as
 * authorization.
 *
 * `[schoolId]` is NOT always the signed-in tenant. Switching accounts re-mints
 * the token before navigating, so after a switch the two agree; but a
 * district / super-admin can also arrive on another tenant's URL while the
 * token still names their own (the launch chooser and the mobile fleet cards
 * link to `/<location>/…` without a switch). That is a legitimate place to be,
 * so a first segment that names ANOTHER tenant the user may open — or is a
 * route the app serves — is never touched. Only a label that belongs to no one
 * the user can see is treated as the old name of their own organization.
 *
 * Returns the destination, or `null` to leave the URL alone:
 *   - `tenant` (GET /tenants — the TOKEN's tenant, never the URL's) must be the
 *     authenticated tenant, and its slug a label we can safely write;
 *   - until the accessible list has loaded we cannot tell "another tenant" from
 *     "an old label", so we wait rather than guess;
 *   - already canonical, a reserved route, or another accessible tenant → null.
 *
 * Idempotent by construction: the destination begins with `tenant.slug`, which
 * the first check refuses, so a canonical path can never be rewritten again.
 */
export function canonicalTenantPath(
  path: string,
  tenant: TenantUrlIdentity | undefined,
  authenticatedTenantId: string | undefined,
  accessibleTenants: readonly TenantUrlIdentity[] | undefined,
): string | null {
  if (!tenant?.id || tenant.id !== authenticatedTenantId || !tenant.slug || !/^[a-z0-9-]+$/.test(tenant.slug)) return null;
  if (!accessibleTenants) return null;
  const match = /^\/([^/?#]+)(.*)$/.exec(path);
  if (!match) return null;
  const segment = match[1];
  if (segment === tenant.slug) return null;
  if (isReservedTenantSlug(segment)) return null;
  // The user's OWN row is skipped: a list fetched before a rename still carries
  // the old label for it, and that must not shield the old label from this.
  if (accessibleTenants.some((other) => other.id !== tenant.id && (other.slug === segment || other.id === segment))) return null;
  return `/${tenant.slug}${match[2]}`;
}
