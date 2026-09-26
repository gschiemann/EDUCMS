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
] as const satisfies readonly (keyof Prisma.TenantWhereInput)[];

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
] as const satisfies readonly (keyof Prisma.ScreenWhereInput)[];

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
 * playlists (see playlistEmergencyUse), the 12 per-screen media URL columns,
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
