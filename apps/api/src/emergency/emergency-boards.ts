/**
 * Emergency BOARDS — the per-type emergency playlists a trigger can select
 * for one screen, pre-staged on the player (2026-10-26, the live alerts at a
 * launch site: every screen showed the built-in typed surface for ~8 s and
 * only then the location's board, because the board definition arrived only
 * with the committed manifest while `emergency-assets` had pre-delivered the
 * FILES alone).
 *
 * Two things live here and nowhere else:
 *   1. `emergencyBoardPayload` — THE builder of the manifest's emergency
 *      playlist shape. The manifest's emergency branch and the staged boards
 *      both call it, so a staged board is byte-for-byte what the manifest
 *      will deliver and the player's apply signature matches (no re-mount).
 *   2. `resolveEmergencyBoardSelection` — which board a tenant-scope trigger
 *      WOULD select for this screen, per incident type × live/drill, with the
 *      trigger's own precedence (`resolveScreenAlertContent`): the screen's
 *      own content in location mode, else the tenant pair, by the screen's
 *      emergency orientation (`emergencyLayoutIsPortrait`).
 *
 * Pure: no Prisma, no clock, so it is unit-tested per shape.
 */
import {
  pickScreenDrillContent,
  pickTenantDrillPlaylists,
  resolveScreenAlertContent,
  type ScreenContentPick,
} from './emergency-drill';

export const EMERGENCY_BOARD_TYPES = [
  'LOCKDOWN',
  'EVACUATE',
  'WEATHER',
  'HOLD',
  'SECURE',
  'MEDICAL',
] as const;
export type EmergencyBoardType = (typeof EMERGENCY_BOARD_TYPES)[number];

export interface EmergencyBoardItem {
  item_id: string;
  asset_id: string | null;
  asset_hash: string | null;
  url: string;
  duration_ms: number;
  sequence: number;
  mime_type: string | null;
  transition_type: string | null;
}

export interface EmergencyBoard {
  id: string;
  name: string;
  items: EmergencyBoardItem[];
}

export interface EmergencyBoardSourceItem {
  id: string;
  assetId: string | null;
  durationMs: number;
  sequenceOrder: number;
  transitionType?: string | null;
  asset: {
    fileUrl: string;
    fileHash?: string | null;
    mimeType?: string | null;
  };
}

/** The manifest's emergency playlist payload — the ONE builder (see header). */
export function emergencyBoardPayload(playlist: {
  id: string;
  name: string;
  items: EmergencyBoardSourceItem[];
}): EmergencyBoard {
  return {
    id: playlist.id,
    name: playlist.name,
    items: playlist.items.map((item) => ({
      item_id: item.id,
      asset_id: item.assetId,
      asset_hash: item.asset.fileHash ?? null,
      url: item.asset.fileUrl,
      duration_ms: item.durationMs,
      sequence: item.sequenceOrder,
      mime_type: item.asset.mimeType ?? null,
      transition_type: item.transitionType ?? null,
    })),
  };
}

/**
 * The screen's OWN live content for an incident type (the `emergency*`
 * columns) — moved here from the trigger so the staged selection and the
 * trigger's override rows read one function. Orientation-aware with the same
 * both-ways fallback as the drill picker.
 */
export function pickScreenLiveContent(
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
      ? portraitPlaylist || landscapePlaylist || null
      : landscapePlaylist || portraitPlaylist || null,
    mediaUrl: isPortrait
      ? portraitAsset || landscapeAsset || null
      : landscapeAsset || portraitAsset || null,
  });
  switch (String(typeKey || '').toUpperCase()) {
    case 'LOCKDOWN':
      return pick(
        s.emergencyLockdownPlaylistId,
        s.emergencyLockdownPortraitPlaylistId,
        s.emergencyLockdownAssetUrl,
        s.emergencyLockdownPortraitAssetUrl,
      );
    case 'EVACUATE':
      return pick(
        s.emergencyEvacuatePlaylistId,
        s.emergencyEvacuatePortraitPlaylistId,
        s.emergencyEvacuateAssetUrl,
        s.emergencyEvacuatePortraitAssetUrl,
      );
    case 'WEATHER':
      return pick(
        s.emergencyWeatherPlaylistId,
        s.emergencyWeatherPortraitPlaylistId,
        s.emergencyWeatherAssetUrl,
        s.emergencyWeatherPortraitAssetUrl,
      );
    case 'HOLD':
      return pick(
        s.emergencyHoldPlaylistId,
        s.emergencyHoldPortraitPlaylistId,
        s.emergencyHoldAssetUrl,
        s.emergencyHoldPortraitAssetUrl,
      );
    case 'SECURE':
      return pick(
        s.emergencySecurePlaylistId,
        s.emergencySecurePortraitPlaylistId,
        s.emergencySecureAssetUrl,
        s.emergencySecurePortraitAssetUrl,
      );
    case 'MEDICAL':
      return pick(
        s.emergencyMedicalPlaylistId,
        s.emergencyMedicalPortraitPlaylistId,
        s.emergencyMedicalAssetUrl,
        s.emergencyMedicalPortraitAssetUrl,
      );
    default:
      return { playlistId: null, mediaUrl: null };
  }
}

/**
 * The tenant's LIVE pair for an incident type (the `panic*` columns) — moved
 * here from the trigger. The dashboard sends the type in lower case
 * (`medical`); the manifest keys it upper case — both are accepted.
 */
export function pickTenantPanicPlaylists(
  tenantInfo: any,
  type?: string | null,
): { landscape: string | null; portrait: string | null } {
  const t = tenantInfo || {};
  switch (String(type || '').toLowerCase()) {
    case 'lockdown':
      return {
        landscape: t.panicLockdownPlaylistId ?? null,
        portrait: t.panicLockdownPortraitPlaylistId ?? null,
      };
    case 'weather':
      return {
        landscape: t.panicWeatherPlaylistId ?? null,
        portrait: t.panicWeatherPortraitPlaylistId ?? null,
      };
    case 'evacuate':
      return {
        landscape: t.panicEvacuatePlaylistId ?? null,
        portrait: t.panicEvacuatePortraitPlaylistId ?? null,
      };
    case 'hold':
      return {
        landscape: t.panicHoldPlaylistId ?? null,
        portrait: t.panicHoldPortraitPlaylistId ?? null,
      };
    case 'secure':
      return {
        landscape: t.panicSecurePlaylistId ?? null,
        portrait: t.panicSecurePortraitPlaylistId ?? null,
      };
    case 'medical':
      return {
        landscape: t.panicMedicalPlaylistId ?? null,
        portrait: t.panicMedicalPortraitPlaylistId ?? null,
      };
    default:
      return { landscape: null, portrait: null };
  }
}

export interface BoardSelection {
  /** The playlist a tenant-scope trigger of this type would resolve for this screen; null = media or the system board. */
  playlistId: string | null;
  /**
   * The pick came from THIS screen's own columns (location mode). An explicit
   * operator playlist on the trigger never displaces it — the trigger's rule.
   */
  perScreen: boolean;
}

export type EmergencyBoardSelection = Record<
  EmergencyBoardType,
  { live: BoardSelection; drill: BoardSelection }
>;

const NONE: ScreenContentPick = { playlistId: null, mediaUrl: null };

export function resolveEmergencyBoardSelection(input: {
  screen: any;
  tenant: any;
  isPortrait: boolean;
  /** `Tenant.locationBasedEmergencyEnabled` — per-screen columns count only then (the trigger's gate). */
  locationModeOn: boolean;
  /** The trigger's drill rule: the drill pair is used only when it has at least one item. */
  drillPairHasItems: (ids: string[]) => boolean;
}): EmergencyBoardSelection {
  const { screen, tenant, isPortrait, locationModeOn } = input;
  const byOrientation = (pair: {
    landscape: string | null;
    portrait: string | null;
  }): string | null =>
    isPortrait
      ? pair.portrait || pair.landscape || null
      : pair.landscape || pair.portrait || null;
  const out = {} as EmergencyBoardSelection;
  for (const type of EMERGENCY_BOARD_TYPES) {
    const screenLive = locationModeOn
      ? pickScreenLiveContent(screen, type, isPortrait)
      : NONE;
    const livePair = pickTenantPanicPlaylists(tenant, type);
    const live = resolveScreenAlertContent({
      isDrill: false,
      tenantSource: 'live',
      screenLive,
      screenDrill: NONE,
      tenantPlaylistId: byOrientation(livePair),
    });
    // Drill: the tenant's drill pair when it has content, else the live pair
    // (`resolveTriggerPlaylists`); the screen's own drill content first.
    const drillPairRaw = pickTenantDrillPlaylists(tenant, type);
    const drillIds = [drillPairRaw.landscape, drillPairRaw.portrait].filter(
      (x): x is string => !!x,
    );
    const drillSource: 'live' | 'drill' =
      drillIds.length > 0 && input.drillPairHasItems(drillIds)
        ? 'drill'
        : 'live';
    const drillPair =
      drillSource === 'drill'
        ? {
            landscape: drillPairRaw.landscape || drillPairRaw.portrait,
            portrait: drillPairRaw.portrait || drillPairRaw.landscape,
          }
        : livePair;
    const screenDrill = locationModeOn
      ? pickScreenDrillContent(screen, type, isPortrait)
      : NONE;
    const drill = resolveScreenAlertContent({
      isDrill: true,
      tenantSource: drillSource,
      screenLive,
      screenDrill,
      tenantPlaylistId: byOrientation(drillPair),
    });
    const perScreen = (pick: ScreenContentPick) =>
      locationModeOn &&
      !!pick.playlistId &&
      (pick.playlistId === screenLive.playlistId ||
        pick.playlistId === screenDrill.playlistId);
    out[type] = {
      live: { playlistId: live.playlistId, perScreen: perScreen(live) },
      drill: { playlistId: drill.playlistId, perScreen: perScreen(drill) },
    };
  }
  return out;
}
