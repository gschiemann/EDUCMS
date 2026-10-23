/**
 * Which EmergencyMessage rows a SCREEN may see, and which copies one clear
 * reaches (2026-10-22 — district broadcasts vanished from child screens).
 *
 * THE BUG THIS CLOSES
 * -------------------
 * `broadcastText` / `mediaAlert` fan a tenant-scoped message out as ONE ROW
 * PER DESCENDANT TENANT (EM-01, 2026-08-04): each copy is stored under the
 * child's own `tenantId`, with the row id `<rootId>_<childTenantId>`, but
 * `scopeType: 'tenant'` and `scopeId: <the tenant the operator aimed at>` —
 * the DISTRICT. The device poll (`GET /emergency/messages`, and the device
 * branch of `GET /emergency/status`) then filtered with
 *
 *     { tenantId: screen.tenantId, scopeType: 'tenant', scopeId: screen.tenantId }
 *
 * so a child copy — whose `scopeId` is the district, not the child — never
 * matched. The live push painted it; the player's 12 s reconcile
 * (`emergencyReconcile.ts`, two confirmed misses) then took it down after
 * ~24 s, and a screen that missed the push never showed it at all. Clearing
 * the district's row cleared only that one row (`where: { id, tenantId }`),
 * leaving every child copy live until expiry.
 *
 * THE RULE
 * --------
 * A tenant-scoped row is visible to a screen when the row is stored under
 * the screen's own tenant (that is what "fanned out to me" means — the
 * writer put it there because my tenant was inside the send's reach) AND
 * its `scopeId` is that tenant itself or one of its ANCESTORS (the send was
 * aimed at me or at an organisation above me). A sibling never has a row
 * under its own tenantId for a send aimed at me, and another organisation
 * is excluded by `tenantId` before anything else — so the two isolation
 * properties the old filter enforced still hold, just no longer by
 * accident of the copy's provenance field.
 *
 * Group- and device-scoped rows keep their exact membership match: a
 * per-room message for screen B must not show on screen A.
 *
 * COST — this is the HTTP emergency backstop, polled every ~10 s by EVERY
 * device, uncached by design. The `where` costs nothing extra; the ancestor
 * check runs only on rows the query already returned whose `scopeId` is not
 * the screen's own tenant, i.e. only while a parent-scoped message is live,
 * and the caller is expected to memoise the ancestor chain (see
 * `tenant-ancestors.ts`).
 *
 * PURE — no Prisma, no network — so every shape is unit-tested in
 * `message-visibility.spec.ts`.
 */

export interface DeviceMessageScope {
  /** The screen's LIVE tenant (from the Screen row, never a token claim). */
  tenantId: string;
  screenId: string;
  groupId?: string | null;
}

/** The minimal row shape the visibility check reads. */
export interface ScopedMessageRow {
  scopeType: string;
  scopeId: string;
}

/**
 * Prisma `where` for the active messages a device may read. Tenant-scoped
 * rows are matched by the row's `tenantId` (the fan-out copy) — see the
 * module header for why `scopeId` is deliberately NOT pinned here; it is
 * verified by `isMessageVisibleToTenant` against the ancestor chain.
 */
export function deviceMessagesWhere(scope: DeviceMessageScope, now: Date) {
  const scopeOr: Array<Record<string, unknown>> = [
    { scopeType: 'tenant' },
    { scopeType: 'device', scopeId: scope.screenId },
  ];
  if (scope.groupId) scopeOr.push({ scopeType: 'group', scopeId: scope.groupId });
  return {
    tenantId: scope.tenantId,
    clearedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    AND: [{ OR: scopeOr }],
  };
}

/**
 * Second half of the rule: a tenant-scoped row stored under `tenantId` is
 * visible when it was aimed at that tenant or at one of its ancestors.
 * Non-tenant scopes were pinned by the `where` already and pass through.
 *
 * `ancestorTenantIds` is the chain ABOVE `tenantId` (parent, grandparent,
 * …), without `tenantId` itself.
 */
export function isMessageVisibleToTenant(
  row: ScopedMessageRow,
  tenantId: string,
  ancestorTenantIds: ReadonlySet<string>,
): boolean {
  if (row.scopeType !== 'tenant') return true;
  if (row.scopeId === tenantId) return true;
  return ancestorTenantIds.has(row.scopeId);
}

/**
 * The fan-out ids one send produced: the operator-visible id for the
 * tenant the send was aimed at, `<rootId>_<tenantId>` for every descendant
 * (`broadcastText` / `mediaAlert`, `idForTenant`). Kept here so the clear
 * path derives the SAME ids the write path produced.
 */
export function fanoutMessageId(rootId: string, rootTenantId: string, tenantId: string): string {
  return tenantId === rootTenantId ? rootId : `${rootId}_${tenantId}`;
}

/**
 * Recover the send's root id from any copy of it. A copy's id is
 * `<rootId>_<itsTenantId>`; the root's own row carries the bare root id.
 * `tenantId` is the row's own `tenantId`, so this never guesses at a
 * delimiter — a tenant id that happened to contain `_` would still strip
 * exactly once, by its full value.
 */
export function rootMessageIdOf(messageId: string, tenantId: string): string {
  const suffix = `_${tenantId}`;
  return messageId.length > suffix.length && messageId.endsWith(suffix)
    ? messageId.slice(0, -suffix.length)
    : messageId;
}

/**
 * Every copy a clear at `tenantId` must take down: the row the operator
 * named plus the copies under every descendant tenant (`descendantTenantIds`,
 * the same subtree a tenant all-clear covers). Ids only — the caller still
 * pins each update to `tenantId IN (tenantId, ...descendants)` so an id
 * collision could never reach outside the subtree.
 */
export function clearTargetMessageIds(
  messageId: string,
  tenantId: string,
  descendantTenantIds: readonly string[],
): string[] {
  const rootId = rootMessageIdOf(messageId, tenantId);
  const ids = new Set<string>([messageId]);
  for (const tid of descendantTenantIds) ids.add(`${rootId}_${tid}`);
  return [...ids];
}
