/**
 * Memoised ancestor chain for the device message poll (2026-10-22).
 *
 * `GET /emergency/messages` runs every ~10 s on EVERY paired device and is
 * uncached by design (it is the emergency HTTP backstop). The visibility
 * rule in `message-visibility.ts` needs a screen's ancestor tenants only
 * while a PARENT-scoped message is live under that screen's tenant — but in
 * that moment every screen in the district asks at once, and a bare walk is
 * one round trip per hierarchy level per poll. A short per-process memo
 * turns that into one walk per tenant per TTL per replica.
 *
 * Staleness is bounded and benign: a re-parented location keeps reading its
 * OLD parent's chain for at most `TTL_MS`. The row it would be deciding on
 * was written under its own tenantId by a sender who was authorised for it
 * at send time, so the worst case is a copy that stays visible for ≤ 30 s
 * after a move — never a leak into another organisation (the `tenantId`
 * pin in the `where` is not subject to this memo).
 */
import { collectAncestorTenantIds, type TenantHierarchyDelegate } from './tenant-hierarchy';

const TTL_MS = 30_000;
/** Hard cap so a tenant-enumeration mistake can never grow this unbounded. */
const MAX_ENTRIES = 5_000;

const memo = new Map<string, { at: number; ids: ReadonlySet<string> }>();

export async function ancestorTenantIdsCached(
  tenant: TenantHierarchyDelegate,
  tenantId: string,
  now = Date.now(),
): Promise<ReadonlySet<string>> {
  const hit = memo.get(tenantId);
  if (hit && now - hit.at <= TTL_MS) return hit.ids;
  const ids: ReadonlySet<string> = new Set(await collectAncestorTenantIds(tenant, tenantId));
  if (memo.size >= MAX_ENTRIES) memo.clear();
  memo.set(tenantId, { at: now, ids });
  return ids;
}

/** Drop a tenant's memo (a re-parent) or everything (tests). */
export function invalidateAncestorTenantIds(tenantId?: string): void {
  if (tenantId) memo.delete(tenantId);
  else memo.clear();
}
