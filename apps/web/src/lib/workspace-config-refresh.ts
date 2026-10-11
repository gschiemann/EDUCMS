/**
 * Workspace config refresh — pure policy for ProfileHydrator
 * (Muse beta DEV-005 / S-01, 2026-10-07).
 *
 * An admin changed the industry in one session; a second session that was
 * already open kept the old industry (and module set) until it logged out,
 * because the dashboard reconciled with `/users/me` exactly once per session.
 *
 * Now: re-check on focus / visibility return / navigation, never more often
 * than WORKSPACE_RECHECK_MIN_MS, and NEVER while the page is hidden (mobile
 * perf rule 1 — a backgrounded phone runs no timers and no fetches). The API's
 * `workspaceConfigVersion` fingerprint says whether the workspace config
 * moved; only then are the tenant queries re-read.
 */

export const WORKSPACE_RECHECK_MIN_MS = 60_000;

export function shouldRecheckWorkspace(input: {
  now: number;
  lastCheckedAt: number;
  visible: boolean;
  inFlight: boolean;
}): boolean {
  if (!input.visible || input.inFlight) return false;
  return input.now - input.lastCheckedAt >= WORKSPACE_RECHECK_MIN_MS;
}

/** True only when BOTH versions are known and differ — the first sighting is a baseline, not a change. */
export function workspaceConfigChanged(previous: string | null | undefined, next: string | null | undefined): boolean {
  return !!previous && !!next && previous !== next;
}

type CachedUser = {
  firstName?: string | null;
  lastName?: string | null;
  tenantVertical?: string | null;
  tenantName?: string | null;
  tenantSlug?: string | null;
  mustSetupCredentials?: boolean | null;
};

/**
 * Fields the server has that the cached blob got wrong. Never clobbers a
 * present value with a server null (except the boolean setup flag, which is
 * synced both ways).
 */
export function profilePatch(cur: CachedUser, me: Record<string, any>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (me.firstName != null && me.firstName !== cur.firstName) patch.firstName = me.firstName;
  if (me.lastName != null && me.lastName !== cur.lastName) patch.lastName = me.lastName;
  if (me.tenantVertical && me.tenantVertical !== cur.tenantVertical) patch.tenantVertical = me.tenantVertical;
  if (me.tenantName != null && me.tenantName !== cur.tenantName) patch.tenantName = me.tenantName;
  if (me.tenantSlug && me.tenantSlug !== cur.tenantSlug) patch.tenantSlug = me.tenantSlug;
  if (typeof me.mustSetupCredentials === 'boolean' && me.mustSetupCredentials !== !!cur.mustSetupCredentials) {
    patch.mustSetupCredentials = me.mustSetupCredentials;
  }
  return patch;
}

/** Queries that hold workspace-level configuration; re-read when the fingerprint moves. */
export const WORKSPACE_CONFIG_QUERY_KEYS: ReadonlyArray<readonly string[]> = [
  ['tenant'],
  ['usb-ingest-config'],
  ['emergency-readiness'],
];
