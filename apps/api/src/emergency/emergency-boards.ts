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
  systemEmergencyBoardColor,
  systemEmergencyBoardText,
} from '@cms/api-types';
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

/**
 * The manifest's SINGLE-FILE board — a per-screen emergency asset URL
 * (Sprint 8b scoped media) wrapped in a one-item playlist. Moved here from
 * the manifest branch (2026-10-31) so the staged copy is byte-identical.
 */
export function screenAssetBoard(args: {
  screenId: string;
  typeKey: string;
  url: string;
}): EmergencyBoard {
  const typeLower = args.typeKey.toLowerCase();
  const ext = (
    args.url.split('?')[0].split('#')[0].split('.').pop() || ''
  ).toLowerCase();
  const mime = ['mp4', 'mov', 'webm', 'm4v'].includes(ext)
    ? `video/${ext === 'mov' ? 'quicktime' : ext}`
    : ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'].includes(ext)
      ? `image/${ext === 'jpg' ? 'jpeg' : ext}`
      : ext === 'pdf'
        ? 'application/pdf'
        : null;
  return {
    id: `screen-asset-${typeLower}`,
    name: `${args.typeKey} (custom asset)`,
    items: [
      {
        item_id: `screen-asset-${args.screenId}-${typeLower}`,
        asset_id: null,
        asset_hash: null,
        url: args.url,
        duration_ms: 60_000, // 60s default for a single-asset emergency loop
        sequence: 0,
        mime_type: mime,
        transition_type: null,
      },
    ],
  };
}

export const SYSTEM_EMERGENCY_BOARD_ID = 'DEFAULT_EMERGENCY';

/** A template-shaped emergency playlist (the system board); `items` is always empty. */
export interface SystemEmergencyBoard {
  id: typeof SYSTEM_EMERGENCY_BOARD_ID;
  name: string;
  /**
   * The player's template apply signature is `tpl:<template name>:<contentRev>`
   * — without a rev every system board was ONE signature, so a LOCKDOWN that
   * replaced a HOLD system board kept HOLD's words on the glass. The rev is a
   * hash of exactly what is painted (words, colour, canvas).
   */
  contentRev: string;
  template: {
    name: string;
    bgColor: string;
    screenWidth: number;
    screenHeight: number;
    zones: Array<Record<string, unknown>>;
  };
  items: [];
}

function fnv1a(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * THE builder of the manifest's bulletproof system board (the text template a
 * screen plays when no content resolved for the alert). Moved verbatim from the
 * manifest branch (2026-10-31) so `emergency-assets` can stage the identical
 * board and the player can raise it from the signed push. Words and colour
 * are the shared rule in `@cms/api-types` (`systemEmergencyBoardText` /
 * `systemEmergencyBoardColor`), which the player's protective surface reads
 * too. ⚠️ Emergency content: the layout numbers below are what every screen
 * with no board of its own shows — change them only with sign-off.
 */
export function systemEmergencyBoard(args: {
  type: string;
  severity: string | null | undefined;
  isDrill: boolean;
  isPortrait: boolean;
  canvasW?: number | null;
  canvasH?: number | null;
  textBlob?: string | null;
  scopeNote?: string | null;
}): SystemEmergencyBoard {
  const canvasW =
    args.canvasW && args.canvasW > 0
      ? args.canvasW
      : args.isPortrait
        ? 1080
        : 1920;
  const canvasH =
    args.canvasH && args.canvasH > 0
      ? args.canvasH
      : args.isPortrait
        ? 1920
        : 1080;
  const content = systemEmergencyBoardText({
    type: args.type,
    isDrill: args.isDrill,
    textBlob: args.textBlob ?? null,
    scopeNote: args.scopeNote ?? null,
  });
  const bgColor = systemEmergencyBoardColor(args.severity, args.isDrill);
  const fontSize = args.isPortrait ? 140 : 100;
  return {
    id: SYSTEM_EMERGENCY_BOARD_ID,
    name: `SYSTEM DEFAULT - ${args.type}`,
    contentRev: fnv1a(
      JSON.stringify([content, bgColor, canvasW, canvasH, fontSize]),
    ),
    template: {
      name: 'EMERGENCY OVERRIDE',
      bgColor,
      screenWidth: canvasW,
      screenHeight: canvasH,
      zones: [
        {
          id: 'emergency-zone',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 1,
          widgetType: 'TEXT',
          // Routed through the signage-design ENGINE text path
          // (`sizeMode: 'absolute'`) so the message ALWAYS fits its zone via
          // FitScaler (measure + transform:scale, Chromium-83/Taurus-safe),
          // never clipping. `fontSize` is the INTENDED size; FitScaler shrinks
          // it to fit. fontWeight 800 replaces the legacy `bold` flag.
          defaultConfig: {
            sizeMode: 'absolute',
            content,
            fontSize,
            fontWeight: 800,
            color: 'white',
            alignment: 'center',
            lineHeight: 1.15,
          },
        },
      ],
    },
    items: [],
  };
}

/** The staging key of the system board for (type, live|drill) in the `boards` map. */
export function systemBoardStagingKey(
  type: EmergencyBoardType,
  drill: boolean,
): string {
  return `system:${type}:${drill ? 'drill' : 'live'}`;
}
/** The staging key of the per-screen single-file board for (type, live|drill). */
export function screenAssetBoardStagingKey(
  type: EmergencyBoardType,
  drill: boolean,
): string {
  return `asset:${type}:${drill ? 'drill' : 'live'}`;
}

export interface BoardSelection {
  /** The playlist a tenant-scope trigger of this type would resolve for this screen; null = media or the system board. */
  playlistId: string | null;
  /**
   * The pick came from THIS screen's own columns (location mode). An explicit
   * operator playlist on the trigger never displaces it — the trigger's rule.
   */
  perScreen: boolean;
  /**
   * The key in the staged `boards` map of what the manifest WILL play for this
   * alert (2026-10-31): the resolved playlist when it has content, else the
   * screen's single-file board, else the system board. `playlistId` alone
   * named a playlist with no items for every landscape screen at the launch
   * site (its live landscape playlists are empty), so nothing was staged and
   * the player showed its typed surface until the manifest brought the
   * system board. Null only when nothing could be built.
   */
  boardKey: string | null;
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
  /**
   * Is this playlist id a staged board with content? The manifest plays an
   * EMPTY resolved playlist as "no playlist" and falls through to the
   * screen's file, then the system board — so must the selection.
   */
  boardHasItems?: (playlistId: string) => boolean;
}): EmergencyBoardSelection {
  const { screen, tenant, isPortrait, locationModeOn } = input;
  const hasItems = input.boardHasItems ?? (() => true);
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
    // What the manifest will play — its own precedence after the override
    // row is read: the row's playlist when it has PUBLISHED items; else the
    // row's media, the screen's drill media (drill), the screen's live media;
    // else the system board.
    const boardKey = (pick: ScreenContentPick, isDrill: boolean): string => {
      if (pick.playlistId && hasItems(pick.playlistId)) return pick.playlistId;
      const media =
        pick.mediaUrl ||
        (isDrill ? screenDrill.mediaUrl : null) ||
        screenLive.mediaUrl;
      if (media) return screenAssetBoardStagingKey(type, isDrill);
      return systemBoardStagingKey(type, isDrill);
    };
    out[type] = {
      live: {
        playlistId: live.playlistId,
        perScreen: perScreen(live),
        boardKey: boardKey(live, false),
      },
      drill: {
        playlistId: drill.playlistId,
        perScreen: perScreen(drill),
        boardKey: boardKey(drill, true),
      },
    };
  }
  return out;
}

/**
 * The URL behind a staging key of the `asset:` kind — the same precedence the
 * manifest applies (`effectiveAsset`): the drill media first on a drill, then
 * the screen's live media for the type. Null when the screen has none.
 */
export function screenAssetUrlFor(
  screen: any,
  type: EmergencyBoardType,
  isDrill: boolean,
  isPortrait: boolean,
): string | null {
  const drill = isDrill
    ? pickScreenDrillContent(screen, type, isPortrait).mediaUrl
    : null;
  return (
    drill || pickScreenLiveContent(screen, type, isPortrait).mediaUrl || null
  );
}
