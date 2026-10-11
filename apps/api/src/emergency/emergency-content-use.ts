/**
 * "Is this asset / playlist emergency content by ANY path the alert pipeline
 * reads?" — ONE answer for every place that must not touch alert media.
 *
 * Why this module exists (2026-09-26 review of the deletion change ba1a8ed):
 * asset deletion used to refuse ANY in-use asset (409 ASSET_IN_USE), and that
 * blanket block was the only thing protecting emergency playlists that are not
 * flagged `isProtected` — `PUT /screens/:id/emergency-content`,
 * `PUT /tenants/panic-settings` and the trigger's `overridePayload.playlistId`
 * all accept an ordinary playlist. The warned-deletion change narrowed the
 * guard to `isProtected` + the per-screen media URL columns, so an admin could
 * delete the only clip in a screen's lockdown playlist and the next lockdown
 * would find an empty playlist. The fast-start re-mux already carried the
 * complete check (VideoPosterService.emergencyUse); it now lives here so the
 * delete paths and the re-mux read the same columns — the same lists
 * `GET /screens/:id/emergency-assets` builds the never-evict cache tier from.
 *
 * Deliberately NOT tenant-scoped: a district playlist can hold a school's
 * asset, and a wider look only makes the guard stricter. Nothing here is
 * returned to a caller except a short label used to REFUSE a write; nothing
 * is written. FAILS CLOSED — a check that cannot run is a reason to leave the
 * content alone. Callers may pass the client or an interactive transaction.
 */
import type { Prisma } from '@cms/database';

export const TENANT_EMERGENCY_PLAYLIST_FIELDS = [
  'emergencyPlaylistId',
  'emergencyPortraitPlaylistId',
  'panicLockdownPlaylistId',
  'panicEvacuatePlaylistId',
  'panicWeatherPlaylistId',
  'panicHoldPlaylistId',
  'panicSecurePlaylistId',
  'panicMedicalPlaylistId',
  'panicLockdownPortraitPlaylistId',
  'panicEvacuatePortraitPlaylistId',
  'panicWeatherPortraitPlaylistId',
  'panicHoldPortraitPlaylistId',
  'panicSecurePortraitPlaylistId',
  'panicMedicalPortraitPlaylistId',
  // 2026-10-10 — drill content. Deleting the only clip in a drill playlist
  // would blank the next drill (which then falls back to live content and
  // still needs its own never-evict copy), so the guard reads them too.
  'drillLockdownPlaylistId',
  'drillEvacuatePlaylistId',
  'drillWeatherPlaylistId',
  'drillHoldPlaylistId',
  'drillSecurePlaylistId',
  'drillMedicalPlaylistId',
  'drillLockdownPortraitPlaylistId',
  'drillEvacuatePortraitPlaylistId',
  'drillWeatherPortraitPlaylistId',
  'drillHoldPortraitPlaylistId',
  'drillSecurePortraitPlaylistId',
  'drillMedicalPortraitPlaylistId',
] as const satisfies readonly (keyof Prisma.TenantWhereInput)[];

/** The twelve drill columns alone — what `GET /screens/:id/emergency-assets` adds to the never-evict tier. */
export const TENANT_DRILL_PLAYLIST_FIELDS = TENANT_EMERGENCY_PLAYLIST_FIELDS.filter((f) =>
  f.startsWith('drill'),
) as ReadonlyArray<(typeof TENANT_EMERGENCY_PLAYLIST_FIELDS)[number]>;

/**
 * The twelve per-screen DRILL playlist columns (2026-10-10, "custom location
 * content for drills too"). Drill content is emergency content: it rides the
 * never-evict tier, the deletion guard and the re-mux guard exactly like the
 * live columns below. Kept as their own list so the precache and the
 * manifest can name them without filtering.
 */
export const SCREEN_DRILL_PLAYLIST_FIELDS = [
  'drillLockdownPlaylistId',
  'drillEvacuatePlaylistId',
  'drillWeatherPlaylistId',
  'drillHoldPlaylistId',
  'drillSecurePlaylistId',
  'drillMedicalPlaylistId',
  'drillLockdownPortraitPlaylistId',
  'drillEvacuatePortraitPlaylistId',
  'drillWeatherPortraitPlaylistId',
  'drillHoldPortraitPlaylistId',
  'drillSecurePortraitPlaylistId',
  'drillMedicalPortraitPlaylistId',
] as const satisfies readonly (keyof Prisma.ScreenWhereInput)[];

/** The twelve per-screen DRILL media-URL columns — same reasoning. */
export const SCREEN_DRILL_MEDIA_URL_FIELDS = [
  'drillLockdownAssetUrl',
  'drillEvacuateAssetUrl',
  'drillWeatherAssetUrl',
  'drillHoldAssetUrl',
  'drillSecureAssetUrl',
  'drillMedicalAssetUrl',
  'drillLockdownPortraitAssetUrl',
  'drillEvacuatePortraitAssetUrl',
  'drillWeatherPortraitAssetUrl',
  'drillHoldPortraitAssetUrl',
  'drillSecurePortraitAssetUrl',
  'drillMedicalPortraitAssetUrl',
] as const satisfies readonly (keyof Prisma.ScreenWhereInput)[];

/** The 24 per-screen drill columns as one list, a key type, and a Prisma `select` of them. */
export const SCREEN_DRILL_CONTENT_FIELDS = [
  ...SCREEN_DRILL_PLAYLIST_FIELDS,
  ...SCREEN_DRILL_MEDIA_URL_FIELDS,
] as const;
export type ScreenDrillContentField = (typeof SCREEN_DRILL_CONTENT_FIELDS)[number];
export const SCREEN_DRILL_CONTENT_SELECT = Object.fromEntries(
  SCREEN_DRILL_CONTENT_FIELDS.map((f) => [f, true]),
) as Record<ScreenDrillContentField, true>;

/** Every per-screen playlist column the alert pipeline reads: the 12 live + the 12 drill. */
export const SCREEN_EMERGENCY_PLAYLIST_FIELDS = [
  'emergencyLockdownPlaylistId',
  'emergencyEvacuatePlaylistId',
  'emergencyWeatherPlaylistId',
  'emergencyHoldPlaylistId',
  'emergencySecurePlaylistId',
  'emergencyMedicalPlaylistId',
  'emergencyLockdownPortraitPlaylistId',
  'emergencyEvacuatePortraitPlaylistId',
  'emergencyWeatherPortraitPlaylistId',
  'emergencyHoldPortraitPlaylistId',
  'emergencySecurePortraitPlaylistId',
  'emergencyMedicalPortraitPlaylistId',
  ...SCREEN_DRILL_PLAYLIST_FIELDS,
] as const satisfies readonly (keyof Prisma.ScreenWhereInput)[];

/** Every per-screen media-URL column the alert pipeline reads: the 12 live + the 12 drill. */
export const SCREEN_EMERGENCY_MEDIA_URL_FIELDS = [
  'emergencyLockdownAssetUrl',
  'emergencyEvacuateAssetUrl',
  'emergencyWeatherAssetUrl',
  'emergencyHoldAssetUrl',
  'emergencySecureAssetUrl',
  'emergencyMedicalAssetUrl',
  'emergencyLockdownPortraitAssetUrl',
  'emergencyEvacuatePortraitAssetUrl',
  'emergencyWeatherPortraitAssetUrl',
  'emergencyHoldPortraitAssetUrl',
  'emergencySecurePortraitAssetUrl',
  'emergencyMedicalPortraitAssetUrl',
  ...SCREEN_DRILL_MEDIA_URL_FIELDS,
] as const satisfies readonly (keyof Prisma.ScreenWhereInput)[];

/** The slice of a Prisma client (or interactive transaction) these checks read. */
export interface EmergencyUseDb {
  playlistItem: {
    findMany: (args: any) => Promise<Array<{ playlistId: string }>>;
  };
  playlist: { findFirst: (args: any) => Promise<{ id: string } | null> };
  tenant: { findFirst: (args: any) => Promise<{ id: string } | null> };
  screen: { findFirst: (args: any) => Promise<{ id: string } | null> };
  screenEmergencyOverride: {
    findFirst: (args: any) => Promise<{ id: string } | null>;
  };
  emergencyMessage: {
    findFirst: (args: any) => Promise<{ id: string } | null>;
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Where these playlists are wired into the alert pipeline: a protected flag,
 * a tenant default, a per-screen assignment or a live override. A short label,
 * or null when none of them is.
 */
export async function playlistEmergencyUse(
  db: EmergencyUseDb,
  playlistIds: readonly string[],
): Promise<string | null> {
  const ids = [...new Set(playlistIds)].filter(Boolean);
  if (ids.length === 0) return null;
  try {
    const inIds = { in: ids };
    // ten-ok: a system guard over the caller's OWN playlist ids, looked up across tenants on purpose; the answer only REFUSES a write and nothing is returned to the caller
    const guarded = await db.playlist.findFirst({
      where: { id: inIds, isProtected: true },
      select: { id: true },
    });
    if (guarded) return `protected playlist ${guarded.id}`;
    const tenant = await db.tenant.findFirst({
      where: {
        OR: TENANT_EMERGENCY_PLAYLIST_FIELDS.map(
          (f) => ({ [f]: inIds }) as Prisma.TenantWhereInput,
        ),
      },
      select: { id: true },
    });
    if (tenant) return `an emergency playlist of tenant ${tenant.id}`;
    const screen = await db.screen.findFirst({
      where: {
        OR: SCREEN_EMERGENCY_PLAYLIST_FIELDS.map(
          (f) => ({ [f]: inIds }) as Prisma.ScreenWhereInput,
        ),
      },
      select: { id: true },
    });
    if (screen) return `an emergency playlist of screen ${screen.id}`;
    const override = await db.screenEmergencyOverride.findFirst({
      where: { playlistId: inIds },
      select: { id: true },
    });
    if (override) return `live screen override ${override.id}`;
    return null;
  } catch (err) {
    return `the emergency check could not run: ${errorMessage(err)}`;
  }
}

/**
 * Is this asset emergency content by ANY path the alert pipeline reads? Its
 * playlists (see playlistEmergencyUse), the 24 per-screen media URL columns
 * (12 live + 12 drill),
 * live overrides pointing at the file, and live emergency messages carrying
 * it. A short label, or null.
 */
export async function emergencyContentUse(
  db: EmergencyUseDb,
  assetId: string,
  fileUrl: string,
): Promise<string | null> {
  try {
    const items = await db.playlistItem.findMany({
      where: { assetId },
      select: { playlistId: true },
    });
    const ids = [...new Set(items.map((i) => i.playlistId))];
    const viaPlaylists = await playlistEmergencyUse(db, ids);
    if (viaPlaylists) return viaPlaylists;
    if (fileUrl) {
      const screenMedia = await db.screen.findFirst({
        where: {
          OR: SCREEN_EMERGENCY_MEDIA_URL_FIELDS.map(
            (f) => ({ [f]: fileUrl }) as Prisma.ScreenWhereInput,
          ),
        },
        select: { id: true },
      });
      if (screenMedia) return `the emergency media of screen ${screenMedia.id}`;
      const override = await db.screenEmergencyOverride.findFirst({
        where: { mediaUrl: fileUrl },
        select: { id: true },
      });
      if (override) return `live screen override ${override.id}`;
      const message = await db.emergencyMessage.findFirst({
        where: {
          clearedAt: null,
          OR: [{ audioUrl: fileUrl }, { mediaUrls: { contains: fileUrl } }],
        },
        select: { id: true },
      });
      if (message) return `live emergency message ${message.id}`;
    }
    return null;
  } catch (err) {
    return `the emergency check could not run: ${errorMessage(err)}`;
  }
}
