/**
 * EMERGENCY DRILLS — the pure rules (2026-10-10).
 *
 * Greg's ask: "trigger emergency drills where different content plays vs a
 * live emergency … live and drill section in settings … an easy switch in the
 * web and mobile app to flip between drill and live emergency."
 *
 * A drill is an ordinary alert in every mechanical respect — same scopes,
 * same signed push, same manifest, same never-evict cache tier, same native
 * wake (the player's `isEmergency` is still `true`) — with four differences,
 * all decided here so each is a microsecond unit test and the LIVE path in
 * emergency.controller.ts stays byte-for-byte what it was:
 *
 *   1. CONTENT — the type's DRILL playlists (`Tenant.drill*PlaylistId`), if
 *      any of them has an item; else the type's LIVE playlists. The screen
 *      shows the DRILL banner either way.
 *   2. PRECEDENCE — a live alert ALWAYS wins. A drill is REFUSED (409) while a
 *      live alert is active anywhere it would reach; a live trigger over a
 *      running drill simply replaces it (the controller's existing
 *      same-target rule); a drill all-clear ends only drill rows.
 *   3. IDENTITY — `isDrill` rides the Tenant row, the override row, the
 *      signed push, the manifest and the raise descriptor; audit rows use
 *      their own actions (`TRIGGER_EMERGENCY_DRILL` / `CLEAR_EMERGENCY_DRILL`).
 *   4. WORDS — the alert text is prefixed "DRILL — " server-side, so an old
 *      cached player bundle that knows nothing about `isDrill` still says so
 *      on the glass.
 *
 * PURE AND PRISMA-FREE, like alert-stack.ts.
 */
import { entriesOfRow, isEntryExpired } from './alert-stack';

/** Audit actions — separate from the live ones so drills report separately. */
export const DRILL_TRIGGER_ACTION = 'TRIGGER_EMERGENCY_DRILL';
export const DRILL_CLEAR_ACTION = 'CLEAR_EMERGENCY_DRILL';

/** The 409 a drill gets while a live alert is active where it would reach. */
export const DRILL_BLOCKED_CODE = 'EMERGENCY_DRILL_BLOCKED_BY_LIVE_ALERT';
export const DRILL_BLOCKED_MESSAGE =
  'A live emergency alert is active. End the live alert first — a drill never replaces a real emergency.';

/** The words an old player bundle will show — the belt-and-braces drill mark. */
export const DRILL_TEXT_PREFIX = 'DRILL — ';

export interface TriggerPlaylists {
  landscape: string | null;
  portrait: string | null;
  /** Which columns the pair came from. */
  source: 'live' | 'drill';
}

/** The tenant's DRILL playlists for an incident type — the mirror of `pickTenantPanicPlaylists`. */
export function pickTenantDrillPlaylists(
  tenantInfo: any,
  type?: string | null,
): { landscape: string | null; portrait: string | null } {
  const t = tenantInfo || {};
  switch (String(type || '').toLowerCase()) {
    case 'lockdown':
      return { landscape: t.drillLockdownPlaylistId ?? null, portrait: t.drillLockdownPortraitPlaylistId ?? null };
    case 'weather':
      return { landscape: t.drillWeatherPlaylistId ?? null, portrait: t.drillWeatherPortraitPlaylistId ?? null };
    case 'evacuate':
      return { landscape: t.drillEvacuatePlaylistId ?? null, portrait: t.drillEvacuatePortraitPlaylistId ?? null };
    case 'hold':
      return { landscape: t.drillHoldPlaylistId ?? null, portrait: t.drillHoldPortraitPlaylistId ?? null };
    case 'secure':
      return { landscape: t.drillSecurePlaylistId ?? null, portrait: t.drillSecurePortraitPlaylistId ?? null };
    case 'medical':
      return { landscape: t.drillMedicalPlaylistId ?? null, portrait: t.drillMedicalPortraitPlaylistId ?? null };
    default:
      return { landscape: null, portrait: null };
  }
}

/**
 * Prefix the operator's text with "DRILL — " exactly once. A drill with no
 * text gets no text (the manifest's system-default template says DRILL on its
 * own); a live alert's text is returned untouched.
 */
export function drillTextBlob(textBlob: string | null | undefined, isDrill: boolean): string | null {
  const text = typeof textBlob === 'string' && textBlob.trim().length > 0 ? textBlob : null;
  if (!isDrill || !text) return text;
  return text.startsWith(DRILL_TEXT_PREFIX) ? text : `${DRILL_TEXT_PREFIX}${text}`;
}

/** Is this Tenant row in a LIVE (not drill) tenant-wide alert? */
export function tenantHasLiveAlert(tenant: {
  emergencyStatus?: string | null;
  emergencyIsDrill?: boolean | null;
} | null | undefined): boolean {
  if (!tenant) return false;
  const active = !!tenant.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE';
  return active && tenant.emergencyIsDrill !== true;
}

export interface BlockingLiveAlert {
  kind: 'tenant' | 'screen';
  /** The tenant in a live alert, or the screen carrying one. */
  id: string;
  /** For a screen: the alert's id when known. */
  alertId?: string | null;
}

/**
 * Every live alert that would be overwritten or covered by a drill reaching
 * `tenants` (the targeted rows plus their ancestors) and the screens whose
 * override rows are `overrideRows`. Empty ⇒ the drill may go out.
 *
 * Covered entries count too: a drill placed over a live entry would be the
 * newest alert on that screen and would take the glass from the live one.
 * Expired entries do not count — they are not on any glass.
 */
export function liveAlertsBlockingDrill(input: {
  tenants: Array<{ id: string; emergencyStatus?: string | null; emergencyIsDrill?: boolean | null }>;
  overrideRows: any[];
  now?: number;
}): BlockingLiveAlert[] {
  const now = input.now ?? Date.now();
  const out: BlockingLiveAlert[] = [];
  for (const t of input.tenants) {
    if (tenantHasLiveAlert(t)) out.push({ kind: 'tenant', id: t.id });
  }
  for (const row of input.overrideRows) {
    const live = entriesOfRow(row).find((e) => !e.isDrill && !isEntryExpired(e, now));
    if (live) out.push({ kind: 'screen', id: String(row.screenId), alertId: live.alertId });
  }
  return out;
}
