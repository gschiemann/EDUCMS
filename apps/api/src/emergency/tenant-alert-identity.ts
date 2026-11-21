/**
 * EMG-01 (2026-11-21) — the IDENTITY of the tenant-wide ("All screens") alert.
 *
 * THE DEFECT. The tenant-wide alert lived on the Tenant row as a status and a
 * type, with no id. A tenant all-clear therefore ended whatever the tenant
 * held when it arrived: operator A, looking at a Hold, types CLEAR a moment
 * after operator B escalated the same tenant to a Lockdown, and the Lockdown
 * ends on every screen.
 *
 * THE RULE. The trigger writes its overrideId to `Tenant.emergencyAlertId` in
 * the same update that sets `emergencyStatus` (and on every descendant of a
 * district alert), and every write that clears the tenant nulls it. The
 * tenant all-clear is then a compare-and-set on it:
 *
 *   • the request names a REAL alert id, the tenant holds an ACTIVE alert
 *     with a DIFFERENT non-null id  →  refused, 409 `ALERT_CHANGED`, nothing
 *     dispatched, nothing written but the refusal's own audit row;
 *   • anything else is exactly today's all-clear. In particular, the request
 *     carries no id, or the `clear_<uuid>` an older client mints when it does
 *     not know the id, or the legacy `global_clear` literal, or the tenant's
 *     stored id is NULL (an alert raised before this column existed) — never
 *     leave an operator unable to clear.
 *
 * The pre-dispatch read decides the common case before any ALL_CLEAR is
 * pushed. The write itself carries the same condition (`tenantClearGuard`) so
 * a trigger that lands between that read and the commit still wins: the
 * root's `tenant.update` then matches no row, Prisma throws P2025, and the
 * whole batch — descendants, override rows, audit rows — rolls back.
 *
 * THE DISTRICT PATH (review round 1). A district alert writes its one id on
 * every school; a school whose row holds a DIFFERENT identified alert raised
 * its own afterwards. A district all-clear naming the district's alert leaves
 * that school alone (its row, its override rows, its push, its CLEAR row), and
 * the descendants' write carries the same `tenantClearGuard` as the root's.
 *
 * THE KILL SWITCH. `EMERGENCY_ALERT_IDENTITY_DISABLED` (below) turns all of
 * this off without a code change: every tenant all-clear then takes the
 * pre-EMG-01 path.
 *
 * Pure: no Prisma, no Nest. Unit-tested in tenant-alert-identity.spec.ts and
 * end to end in emergency.alert-identity.spec.ts.
 */

/** The 409 code the dashboard and /panic route on. */
export const ALERT_CHANGED_CODE = 'ALERT_CHANGED';

/** Audit action of an all-clear refused because the alert changed. */
export const CLEAR_REFUSED_ACTION = 'CLEAR_EMERGENCY_REFUSED';

/** Prefix of the id a client mints when it does not know the alert (apps/web/src/actions/trigger-emergency.ts). */
const SYNTHETIC_CLEAR_PREFIX = 'clear_';
/** The literal every all-clear carried before emergency-002 (2026-05). */
const LEGACY_GLOBAL_CLEAR = 'global_clear';

/**
 * The alert id an all-clear request names, or null when the caller does not
 * know it (no id, a synthetic `clear_<uuid>`, the legacy `global_clear`).
 * Null always means "today's behaviour".
 */
export function namedAlertId(overrideId: unknown): string | null {
  if (typeof overrideId !== 'string') return null;
  const v = overrideId.trim();
  if (v.length === 0) return null;
  if (v.startsWith(SYNTHETIC_CLEAR_PREFIX)) return null;
  if (v === LEGACY_GLOBAL_CLEAR) return null;
  return v;
}

/** The Tenant columns this rule reads. */
export interface TenantAlertState {
  emergencyStatus?: string | null;
  emergencyType?: string | null;
  emergencyIsDrill?: boolean | null;
  emergencyAlertId?: string | null;
  emergencyTriggeredAt?: Date | string | null;
}

export function isTenantAlertActive(
  t: TenantAlertState | null | undefined,
): boolean {
  return !!t && !!t.emergencyStatus && t.emergencyStatus !== 'INACTIVE';
}

/**
 * True only when the all-clear names a real alert and the tenant now holds a
 * DIFFERENT, identified, active alert. Unknown state (no row, a failed read),
 * an inactive tenant, or a stored NULL id is never "changed".
 */
export function tenantAlertChanged(
  current: TenantAlertState | null | undefined,
  expectedAlertId: string | null,
): boolean {
  if (!expectedAlertId) return false;
  if (!isTenantAlertActive(current)) return false;
  const stored = current?.emergencyAlertId;
  if (typeof stored !== 'string' || stored.length === 0) return false;
  return stored !== expectedAlertId;
}

/**
 * The extra where-clause of the ROOT tenant's all-clear write: the row is
 * written only if it still holds the named alert, or an unidentified one, or
 * none. Empty (no condition at all) when the request names no real id, so
 * that request's write is exactly the one it always was.
 */
export function tenantClearGuard(
  expectedAlertId: string | null,
): Record<string, unknown> {
  if (!expectedAlertId) return {};
  return {
    OR: [
      { emergencyAlertId: expectedAlertId },
      { emergencyAlertId: null },
      { emergencyStatus: 'INACTIVE' },
    ],
  };
}

/** The current tenant-wide alert, as the 409 body and the audit row describe it. */
export function describeTenantAlert(
  scopeId: string,
  t: TenantAlertState | null | undefined,
) {
  const at = t?.emergencyTriggeredAt;
  return {
    alertId: t?.emergencyAlertId ?? null,
    scopeType: 'tenant' as const,
    scopeId,
    type: t?.emergencyType ?? null,
    severity: t?.emergencyStatus ?? null,
    isDrill: t?.emergencyIsDrill === true,
    triggeredAt:
      at instanceof Date
        ? at.toISOString()
        : typeof at === 'string'
          ? at
          : null,
  };
}

/**
 * The 409 body. `message` is plain English for API callers; the dashboard and
 * /panic route on `code` and say it in the operator's language with
 * `currentAlert.type`.
 */
export function alertChangedBody(
  scopeId: string,
  current: TenantAlertState | null | undefined,
  requestedAlertId: string,
) {
  const currentAlert = describeTenantAlert(scopeId, current);
  const kind = currentAlert.type
    ? `${String(currentAlert.type).toUpperCase()} `
    : '';
  return {
    code: ALERT_CHANGED_CODE,
    message: `A newer ${kind}alert is active. This all-clear named an earlier alert, so nothing was cleared. Review the current alert, then clear it with its own confirmation.`,
    requestedAlertId,
    currentAlert,
  };
}

/** Prisma's "record to update not found" — the root compare-and-set matched no row. */
export function isRecordNotFound(e: unknown): boolean {
  return (
    !!e && typeof e === 'object' && (e as { code?: unknown }).code === 'P2025'
  );
}

/**
 * `EMERGENCY_ALERT_IDENTITY_DISABLED` — the owner's kill switch for this rule
 * (EMG-01 review round 1). SUBTRACTIVE: unset (or any value but the three
 * below) = the rule applies. Set = every tenant all-clear is treated as one
 * that names no alert, i.e. exactly the pre-EMG-01 all-clear: never refused,
 * no compare-and-set on any row, the whole subtree cleared. The trigger keeps
 * writing the id and /emergency/active keeps listing it, so unsetting it
 * restores the rule with nothing lost. Read on every request.
 */
export function alertIdentityDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(env.EMERGENCY_ALERT_IDENTITY_DISABLED ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}
