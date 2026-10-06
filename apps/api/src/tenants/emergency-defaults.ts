import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@cms/database';
import { effectiveEmergencyEnabled } from '@cms/api-types';

/** Initial copies only. Local edits, including an intentionally emptied bucket, win. */
export const EMERGENCY_DEFAULT_FIELDS = {
  panicLockdownPlaylistId: 'lockdown',
  panicLockdownPortraitPlaylistId: 'lockdown_portrait',
  panicWeatherPlaylistId: 'weather',
  panicWeatherPortraitPlaylistId: 'weather_portrait',
  panicEvacuatePlaylistId: 'evacuate',
  panicEvacuatePortraitPlaylistId: 'evacuate_portrait',
  panicHoldPlaylistId: 'hold',
  panicHoldPortraitPlaylistId: 'hold_portrait',
  panicSecurePlaylistId: 'secure',
  panicSecurePortraitPlaylistId: 'secure_portrait',
  panicMedicalPlaylistId: 'medical',
  panicMedicalPortraitPlaylistId: 'medical_portrait',
  emergencyPlaylistId: 'default',
  emergencyPortraitPlaylistId: 'default_portrait',
} as const;
const FIELDS = Object.keys(EMERGENCY_DEFAULT_FIELDS) as Array<
  keyof typeof EMERGENCY_DEFAULT_FIELDS
>;
const CONTENT_SELECT = Object.fromEntries(
  FIELDS.map((field) => [field, true]),
) as Record<(typeof FIELDS)[number], true>;
const TENANT_SELECT = {
  id: true,
  vertical: true,
  emergencyEnabled: true,
  emergencyStatus: true,
  ...CONTENT_SELECT,
} as const;

/** Caller supplies an authorized descendant set; never accepts target ids from a request body. */
export async function initializeEmergencyLocations(
  tx: Prisma.TransactionClient,
  sourceTenantId: string,
  locationIds: string[],
  actorUserId: string | null,
  reason:
    | 'corporate-enablement'
    | 'location-created'
    | 'maintenance' = 'corporate-enablement',
  options: { dryRun?: boolean } = {},
) {
  const result = {
    locationsEnabled: 0,
    locationsInitialized: 0,
    defaultBucketsLoaded: 0,
  };
  const ids = [...new Set(locationIds)].filter((id) => id !== sourceTenantId);
  if (!ids.length) return result;
  const source = await tx.tenant.findUnique({
    where: { id: sourceTenantId },
    select: TENANT_SELECT,
  });
  if (
    !source ||
    !effectiveEmergencyEnabled(source.vertical, source.emergencyEnabled)
  )
    return result;
  const locations = await tx.tenant.findMany({
    where: { id: { in: ids }, archivedAt: null },
    select: TENANT_SELECT,
  });
  if (!locations.length) return result;
  // Configuration must not swap the media behind an alert already in progress.
  if (
    [source, ...locations].some(
      (tenant) =>
        tenant.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE',
    )
  ) {
    throw new BadRequestException(
      'An emergency is active in this organization. Send the all-clear before initializing location content.',
    );
  }
  const sourceIds = FIELDS.flatMap((field) =>
    source[field] ? [source[field]] : [],
  );
  const defaults = sourceIds.length
    ? await tx.playlist.findMany({
        where: { tenantId: sourceTenantId, id: { in: sourceIds } },
        include: {
          items: {
            include: { asset: true },
            orderBy: { sequenceOrder: 'asc' },
          },
        },
      })
    : [];
  const sourceById = new Map(
    defaults.map((playlist) => [playlist.id, playlist]),
  );
  // Refuse a broken or foreign media reference rather than silently distributing it.
  for (const playlist of defaults)
    for (const item of playlist.items) {
      if (
        item.asset.tenantId !== sourceTenantId ||
        item.asset.status !== 'PUBLISHED'
      ) {
        throw new BadRequestException(
          'Emergency defaults contain media that is unavailable or belongs to another location. Review the corporate emergency content first.',
        );
      }
    }
  const ownIds = locations.flatMap((location) =>
    FIELDS.flatMap((field) => (location[field] ? [location[field]] : [])),
  );
  const existing = ownIds.length
    ? await tx.playlist.findMany({
        where: {
          tenantId: { in: locations.map((location) => location.id) },
          id: { in: ownIds },
        },
        select: {
          id: true,
          tenantId: true,
          isProtected: true,
          protectedKind: true,
          sourcePlaylistId: true,
          _count: { select: { items: true } },
        },
      })
    : [];
  const ownById = new Map(existing.map((playlist) => [playlist.id, playlist]));
  const edited = ownIds.length
    ? await tx.auditLog.findMany({
        where: {
          tenantId: { in: locations.map((location) => location.id) },
          targetType: 'Playlist',
          targetId: { in: ownIds },
          action: {
            in: ['PANIC_CONTENT_ASSET_ADDED', 'PANIC_CONTENT_ASSET_REMOVED'],
          },
        },
        select: { targetId: true },
      })
    : [];
  const editedIds = new Set(edited.map((event) => event.targetId));
  const assets: Prisma.AssetCreateManyInput[] = [];
  const playlists: Prisma.PlaylistCreateManyInput[] = [];
  const items: Prisma.PlaylistItemCreateManyInput[] = [];
  const audits: Prisma.AuditLogCreateManyInput[] = [];
  const assetCopies = new Map<string, string>();
  const wiring: Array<{
    id: string;
    fields: Partial<Record<(typeof FIELDS)[number], string>>;
  }> = [];

  for (const location of locations) {
    const fields: Partial<Record<(typeof FIELDS)[number], string>> = {};
    for (const field of FIELDS) {
      const original = sourceById.get(source[field] ?? '');
      if (!original?.items.length) continue;
      if (
        !original.isProtected ||
        original.protectedKind !== EMERGENCY_DEFAULT_FIELDS[field]
      ) {
        throw new BadRequestException(
          'Corporate emergency content is not in the expected protected alert bucket.',
        );
      }
      const own = ownById.get(location[field] ?? '');
      const belongsHere = own?.tenantId === location.id;
      if (
        belongsHere &&
        (own._count.items > 0 ||
          own.sourcePlaylistId ||
          editedIds.has(own.id) ||
          !own.isProtected ||
          own.protectedKind !== EMERGENCY_DEFAULT_FIELDS[field])
      )
        continue;
      const playlistId = belongsHere ? own.id : randomUUID();
      if (belongsHere && !options.dryRun) {
        // Guard again at the write boundary if a local administrator just added content.
        const claimed = await tx.playlist.updateMany({
          where: {
            id: own.id,
            tenantId: location.id,
            sourcePlaylistId: null,
            items: { none: {} },
          },
          data: { sourcePlaylistId: original.id },
        });
        if (!claimed.count) continue;
      } else if (!belongsHere) {
        playlists.push({
          id: playlistId,
          tenantId: location.id,
          name: original.name,
          createdByUserId: actorUserId,
          sourcePlaylistId: original.id,
          isProtected: true,
          protectedKind: EMERGENCY_DEFAULT_FIELDS[field],
        });
      }
      fields[field] = playlistId;
      for (const item of original.items) {
        const key = `${location.id}:${item.assetId}`;
        let assetId = assetCopies.get(key);
        if (!assetId) {
          assetId = randomUUID();
          assetCopies.set(key, assetId);
          const asset = item.asset;
          assets.push({
            id: assetId,
            tenantId: location.id,
            uploadedByUserId: actorUserId ?? asset.uploadedByUserId,
            fileUrl: asset.fileUrl,
            mimeType: asset.mimeType,
            status: 'PUBLISHED',
            fileSize: asset.fileSize,
            originalName: asset.originalName,
            fileHash: asset.fileHash,
            altText: asset.altText,
            processingMeta:
              asset.processingMeta === null
                ? Prisma.JsonNull
                : (asset.processingMeta as Prisma.InputJsonValue),
          });
        }
        items.push({
          id: randomUUID(),
          playlistId,
          assetId,
          durationMs: item.durationMs,
          sequenceOrder: item.sequenceOrder,
          transitionType: item.transitionType,
          muted: item.muted,
          daysOfWeek: item.daysOfWeek,
          timeStart: item.timeStart,
          timeEnd: item.timeEnd,
        });
      }
    }
    const seeded = Object.keys(fields).length;
    if (seeded) {
      wiring.push({ id: location.id, fields });
      result.locationsInitialized++;
      result.defaultBucketsLoaded += seeded;
    }
    if (location.emergencyEnabled !== true) result.locationsEnabled++;
    if (seeded || location.emergencyEnabled !== true)
      audits.push({
        tenantId: location.id,
        userId: actorUserId,
        action: seeded
          ? 'EMERGENCY_DEFAULTS_INITIALIZED'
          : 'EMERGENCY_ENABLED_CHANGED',
        targetType: 'Tenant',
        targetId: location.id,
        details: JSON.stringify({
          sourceTenantId,
          reason,
          previous: { emergencyEnabled: location.emergencyEnabled },
          next: { emergencyEnabled: true },
          initializedBuckets: fields,
          preservedLocalContent: true,
        }),
      });
  }
  if (options.dryRun) return result;
  if (assets.length) await tx.asset.createMany({ data: assets });
  if (playlists.length) await tx.playlist.createMany({ data: playlists });
  if (items.length) await tx.playlistItem.createMany({ data: items });
  for (const location of wiring)
    await tx.tenant.update({
      where: { id: location.id },
      data: location.fields,
    });
  await tx.tenant.updateMany({
    where: {
      id: { in: locations.map((location) => location.id) },
      archivedAt: null,
      OR: [{ emergencyEnabled: false }, { emergencyEnabled: null }],
    },
    data: { emergencyEnabled: true },
  });
  if (audits.length) await tx.auditLog.createMany({ data: audits });
  return result;
}
