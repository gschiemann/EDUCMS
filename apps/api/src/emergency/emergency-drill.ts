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
 *   1. CONTENT — per screen (Greg, later the same day: "custom location
 *      content available for drills too — duplicate everything for live
 *      emergencies to drill ones"): the screen's own DRILL content for the
 *      type → the tenant's DRILL playlists (`Tenant.drill*PlaylistId`, if any
 *      has an item) → the exact LIVE precedence (screen live content → tenant
 *      live playlists). The screen shows the DRILL banner either way.
 *      `resolveScreenAlertContent` below is that one rule, used by every
 *      trigger path and by the manifest.
 *   2. PRECEDENCE — "LIVE ALERTS ALWAYS WIN" (Greg), organisation-wide:
 *      (a) a drill is REFUSED (409) while ANY live alert is active anywhere in
 *          the same organisation — the top-level customer and every location
 *          under it — regardless of which screens would overlap;
 *      (b) triggering ANY live alert anywhere in the organisation ENDS every
 *          running drill in it (tenant-wide drills, group / one-screen drill
 *          rows, inherited drills), audited `DRILL_ENDED_BY_LIVE_ALERT` per
 *          tenant, with a signed push so those screens move to the live
 *          content or back to normal content. That pass runs AFTER the live
 *          dispatch and the live writes — it can never delay the live alert;
 *      (c) a drill all-clear ends only drill rows — it can never end a live
 *          alert.
 *   3. IDENTITY — `isDrill` rides the Tenant row, the override row, the
 *      signed push, the manifest and the raise descriptor; audit rows use
 *      their own actions (`TRIGGER_EMERGENCY_DRILL` / `CLEAR_EMERGENCY_DRILL`
 *      / `DRILL_ENDED_BY_LIVE_ALERT`).
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
/**
 * A drill that a LIVE alert somewhere in the organisation ended. One row per
 * tenant whose drill state changed; `details.liveOverrideId` names the alert
 * that ended it and `details.endedDrillOverrideIds` the drills it ended (the
 * dashboard's drill log pairs on those).
 */
export const DRILL_ENDED_BY_LIVE_ACTION = 'DRILL_ENDED_BY_LIVE_ALERT';

/** The 409 a drill gets while a live alert is active anywhere in the organisation. */
export const DRILL_BLOCKED_CODE = 'EMERGENCY_DRILL_BLOCKED_BY_LIVE_ALERT';
export const DRILL_BLOCKED_MESSAGE =
  'A live emergency alert is active in your organization. End the live alert first — a drill never runs beside a real emergency.';

export interface ScreenContentPick {
  playlistId: string | null;
  mediaUrl: string | null;
}

/**
 * The screen's OWN drill content for an incident type — the mirror of the
 * controller's `pickScreenEmergencyContent` over the `drill*` columns.
 * Orientation-aware with the same both-ways fallback (a portrait screen
 * uses the landscape slot when no portrait slot is set, and vice-versa).
 */
export function pickScreenDrillContent(
  screen: any,
  typeKey: string | null | undefined,
  isPortrait: boolean,
): ScreenContentPick {
  const s = screen || {};
  const pick = (
    landscapePlaylist?: string | null,
    portraitPlaylist?: string | null,
    landscapeAsset?: string | null,
    portraitAsset?: string | null,
  ): ScreenContentPick => ({
    playlistId: isPortrait
      ? (portraitPlaylist || landscapePlaylist || null)
      : (landscapePlaylist || portraitPlaylist || null),
    mediaUrl: isPortrait
      ? (portraitAsset || landscapeAsset || null)
      : (landscapeAsset || portraitAsset || null),
  });
  switch (String(typeKey || '').toUpperCase()) {
    case 'LOCKDOWN':
      return pick(s.drillLockdownPlaylistId, s.drillLockdownPortraitPlaylistId, s.drillLockdownAssetUrl, s.drillLockdownPortraitAssetUrl);
    case 'EVACUATE':
      return pick(s.drillEvacuatePlaylistId, s.drillEvacuatePortraitPlaylistId, s.drillEvacuateAssetUrl, s.drillEvacuatePortraitAssetUrl);
    case 'WEATHER':
      return pick(s.drillWeatherPlaylistId, s.drillWeatherPortraitPlaylistId, s.drillWeatherAssetUrl, s.drillWeatherPortraitAssetUrl);
    case 'HOLD':
      return pick(s.drillHoldPlaylistId, s.drillHoldPortraitPlaylistId, s.drillHoldAssetUrl, s.drillHoldPortraitAssetUrl);
    case 'SECURE':
      return pick(s.drillSecurePlaylistId, s.drillSecurePortraitPlaylistId, s.drillSecureAssetUrl, s.drillSecurePortraitAssetUrl);
    case 'MEDICAL':
      return pick(s.drillMedicalPlaylistId, s.drillMedicalPortraitPlaylistId, s.drillMedicalAssetUrl, s.drillMedicalPortraitAssetUrl);
    default:
      return { playlistId: null, mediaUrl: null };
  }
}

/**
 * What ONE screen plays for an alert — the single precedence every trigger
 * path writes into the screen's override row.
 *
 * LIVE (`isDrill` false) — byte-for-byte the rule the live path always had:
 *   explicit operator playlist > the screen's live playlist for the type >
 *   (the screen's live media, else the tenant playlist); media only when no
 *   playlist resolves, the screen's before the payload's.
 *
 * DRILL — in front of that, and only in front of it:
 *   explicit operator playlist > the screen's DRILL playlist > the screen's
 *   DRILL media > the tenant's DRILL playlist (when the tenant pair came from
 *   the drill columns, `tenantSource === 'drill'`) > the live precedence.
 *
 * `tenantPlaylistId` is the orientation-resolved tenant pair the trigger
 * already picked (drill columns when they have content, else live), so a
 * drill with nothing of its own lands on exactly the live content.
 */
export function resolveScreenAlertContent(args: {
  isDrill: boolean;
  tenantSource: 'live' | 'drill';
  explicitPlaylistId?: string | null;
  screenLive: ScreenContentPick;
  screenDrill: ScreenContentPick;
  tenantPlaylistId: string | null;
  payloadMediaUrl?: string | null;
}): ScreenContentPick {
  const explicit = args.explicitPlaylistId || null;
  if (explicit) return { playlistId: explicit, mediaUrl: null };
  if (args.isDrill) {
    if (args.screenDrill.playlistId) return { playlistId: args.screenDrill.playlistId, mediaUrl: null };
    if (args.screenDrill.mediaUrl) return { playlistId: null, mediaUrl: args.screenDrill.mediaUrl };
    if (args.tenantSource === 'drill' && args.tenantPlaylistId) {
      return { playlistId: args.tenantPlaylistId, mediaUrl: null };
    }
  }
  const playlistId =
    args.screenLive.playlistId
    || (args.screenLive.mediaUrl ? null : args.tenantPlaylistId);
  const mediaUrl = playlistId
    ? null
    : (args.screenLive.mediaUrl || args.payloadMediaUrl || null);
  return { playlistId, mediaUrl };
}

/**
 * Does this tenant's ACTIVE alert point at its own drill columns? The manifest
 * uses it to tell, for a screen with no override row, whether the tenant
 * playlist it would fall back to is drill content (then it beats the screen's
 * live per-type content) or live content (then the screen's live content
 * comes first, as always). Only meaningful while `emergencyIsDrill` is true.
 */
export function tenantAlertPlaysDrillContent(tenant: any): boolean {
  if (!tenant || tenant.emergencyIsDrill !== true) return false;
  const drill = pickTenantDrillPlaylists(tenant, tenant.emergencyType);
  const ids = [drill.landscape, drill.portrait].filter(Boolean);
  if (ids.length === 0) return false;
  return (
    (!!tenant.emergencyPlaylistId && ids.includes(tenant.emergencyPlaylistId))
    || (!!tenant.emergencyPortraitPlaylistId && ids.includes(tenant.emergencyPortraitPlaylistId))
  );
}

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
 * Every live alert active in the ORGANISATION a drill belongs to: `tenants`
 * is the whole organisation (the top-level customer and every location under
 * it) and `overrideRows` every override row those tenants' screens hold.
 * Empty ⇒ the drill may go out. "Live alerts always win" (Greg): overlap is
 * irrelevant — a drill does not run anywhere in an organisation that has a
 * real emergency anywhere.
 *
 * Covered entries count too (a live alert underneath a newer one is still a
 * live alert). Expired entries do not — they are not on any glass.
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
