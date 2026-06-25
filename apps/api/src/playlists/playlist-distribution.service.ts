import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * PlaylistDistributionService — Phase 2c "publish to locations".
 *
 * A parent ("Corporate") builds a playlist once and publishes it to screens
 * across its child locations. For each target child we COPY the playlist (and
 * the assets it references) down into that child's own library, then schedule
 * it on the selected screens there. Because the copy lives in the child, the
 * schedule is the child scheduling its OWN playlist — it works WITH the
 * cross-tenant guard (schedules.controller:64-88), not around it.
 *
 * Idempotent: re-publishing finds the existing copy via Playlist.sourcePlaylistId
 * and updates it in place (no duplicate playlists piling up per store).
 *
 * v1 scope: media playlists + null/system-template playlists. A custom
 * (tenant-scoped) template would dangle cross-tenant, so those are rejected with
 * a clear message (custom-template distribution is a fast-follow).
 *
 * Assets are copied as a METADATA row pointing at the same stored file (same
 * fileUrl) — no re-upload, no storage/egress duplication. Tradeoff documented:
 * the child copy references the parent's storage object.
 */
@Injectable()
export class PlaylistDistributionService {
  private readonly logger = new Logger(PlaylistDistributionService.name);
  constructor(private readonly prisma: PrismaService) {}

  async publishToFleet(params: {
    parentTenantId: string;
    actorUserId: string;
    sourcePlaylistId: string;
    screenIds: string[];
  }): Promise<{
    sourcePlaylistId: string;
    totalScreens: number;
    totalLocations: number;
    perLocation: Array<{
      tenantId: string;
      tenantName: string;
      playlistId: string;
      screensScheduled: number;
      isParent: boolean;
    }>;
  }> {
    const { parentTenantId, actorUserId, sourcePlaylistId, screenIds } = params;
    const ids = Array.from(new Set((screenIds || []).filter((s) => typeof s === 'string')));
    if (ids.length === 0) {
      throw new BadRequestException('Select at least one screen to publish to.');
    }

    // 1. Source playlist must belong to the caller (parent), with its items.
    const source = await this.prisma.client.playlist.findFirst({
      where: { id: sourcePlaylistId, tenantId: parentTenantId },
      include: {
        items: { orderBy: { sequenceOrder: 'asc' } },
        template: { select: { id: true, isSystem: true } },
      },
    });
    if (!source) throw new NotFoundException('Playlist not found');
    if ((source as any).isProtected) {
      throw new BadRequestException('Emergency/protected playlists cannot be fleet-published.');
    }
    // 2. Template safety — v1 supports null/system templates only.
    if (source.templateId && source.template && !source.template.isSystem) {
      throw new BadRequestException(
        'This playlist uses a custom template. Fleet publishing currently supports media playlists and ' +
          'system-template playlists; custom-template distribution is coming next.',
      );
    }

    // 3. Targets must be the parent itself or one of its DIRECT children
    //    (parent→child authority). Anything else is rejected.
    const children = await this.prisma.client.tenant.findMany({
      where: { parentId: parentTenantId },
      select: { id: true, name: true },
    });
    const parentRow = await this.prisma.client.tenant.findUnique({
      where: { id: parentTenantId },
      select: { name: true },
    });
    const allowed = new Set<string>([parentTenantId, ...children.map((c) => c.id)]);
    const nameByTenant = new Map<string, string>([
      [parentTenantId, parentRow?.name ?? 'Corporate'],
      ...children.map((c) => [c.id, c.name] as [string, string]),
    ]);

    const screens = await this.prisma.client.screen.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, tenantId: true },
    });
    if (screens.length !== ids.length) throw new NotFoundException('One or more screens not found.');
    if (screens.some((s) => !s.tenantId || !allowed.has(s.tenantId))) {
      throw new ForbiddenException('One or more screens are not in your locations.');
    }

    const byTenant = new Map<string, typeof screens>();
    for (const s of screens) {
      const arr = byTenant.get(s.tenantId as string) ?? [];
      arr.push(s);
      byTenant.set(s.tenantId as string, arr);
    }

    const perLocation: Array<{
      tenantId: string;
      tenantName: string;
      playlistId: string;
      screensScheduled: number;
      isParent: boolean;
    }> = [];

    for (const [tenantId, tScreens] of byTenant.entries()) {
      const isParent = tenantId === parentTenantId;
      const targetPlaylistId = isParent
        ? source.id // same tenant → schedule the source directly, no copy
        : await this.copyPlaylistIntoChild(source, tenantId, actorUserId);

      for (const sc of tScreens) {
        await this.scheduleLive(tenantId, targetPlaylistId, sc.id);
      }

      await this.audit(tenantId, actorUserId, targetPlaylistId, {
        sourcePlaylistId: source.id,
        sourceTenantId: parentTenantId,
        screenIds: tScreens.map((s) => s.id),
        isParent,
      });

      perLocation.push({
        tenantId,
        tenantName: nameByTenant.get(tenantId) ?? tenantId,
        playlistId: targetPlaylistId,
        screensScheduled: tScreens.length,
        isParent,
      });
    }

    return {
      sourcePlaylistId: source.id,
      totalScreens: screens.length,
      totalLocations: perLocation.length,
      perLocation,
    };
  }

  /** Find-or-create a child Asset mirroring a parent asset (same stored file). */
  private async ensureChildAsset(parentAsset: any, childTenantId: string, actorUserId: string): Promise<string> {
    const where: any = parentAsset.fileHash
      ? { tenantId: childTenantId, fileHash: parentAsset.fileHash }
      : { tenantId: childTenantId, fileUrl: parentAsset.fileUrl };
    const existing = await this.prisma.client.asset.findFirst({ where, select: { id: true } });
    if (existing) return existing.id;
    const created = await this.prisma.client.asset.create({
      data: {
        tenantId: childTenantId,
        uploadedByUserId: actorUserId,
        fileUrl: parentAsset.fileUrl,
        mimeType: parentAsset.mimeType,
        status: 'PUBLISHED', // corporate-pushed content is pre-approved (PUBLISHED is the ONLY status the manifest/playback serve; 'APPROVED' was an orphan value that silently never played)
        fileSize: parentAsset.fileSize ?? null,
        originalName: parentAsset.originalName ?? null,
        fileHash: parentAsset.fileHash ?? null,
        altText: parentAsset.altText ?? null,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Copy (or update the existing copy of) the source playlist into a child. */
  private async copyPlaylistIntoChild(source: any, childTenantId: string, actorUserId: string): Promise<string> {
    const assetIds = Array.from(new Set(source.items.map((i: any) => i.assetId)));
    const parentAssets = assetIds.length
      ? await this.prisma.client.asset.findMany({ where: { id: { in: assetIds as string[] } } })
      : [];
    const childAssetBySource = new Map<string, string>();
    for (const a of parentAssets) {
      childAssetBySource.set(a.id, await this.ensureChildAsset(a, childTenantId, actorUserId));
    }

    const itemsData = source.items
      .filter((i: any) => childAssetBySource.has(i.assetId))
      .map((i: any) => ({
        assetId: childAssetBySource.get(i.assetId) as string,
        durationMs: i.durationMs,
        sequenceOrder: i.sequenceOrder,
        daysOfWeek: i.daysOfWeek ?? null,
        timeStart: i.timeStart ?? null,
        timeEnd: i.timeEnd ?? null,
        transitionType: i.transitionType ?? 'FADE',
        muted: i.muted ?? true,
      }));

    const existing = await this.prisma.client.playlist.findFirst({
      where: { tenantId: childTenantId, sourcePlaylistId: source.id },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.client.$transaction([
        this.prisma.client.playlistItem.deleteMany({ where: { playlistId: existing.id } }),
        this.prisma.client.playlist.update({
          where: { id: existing.id },
          data: { name: source.name, templateId: source.templateId ?? null, items: { create: itemsData } },
        }),
      ]);
      return existing.id;
    }

    const created = await this.prisma.client.playlist.create({
      data: {
        tenantId: childTenantId,
        name: source.name,
        templateId: source.templateId ?? null, // null or SYSTEM template (global) — safe cross-tenant
        sourcePlaylistId: source.id,
        createdByUserId: actorUserId,
        items: { create: itemsData },
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Replace-mode schedule — make this playlist live on the screen now. */
  private async scheduleLive(tenantId: string, playlistId: string, screenId: string) {
    // Replace: stand down other active schedules on this screen, then ensure
    // exactly one (playlist, screen) row so re-publish stays idempotent.
    await this.prisma.client.schedule.updateMany({
      where: { tenantId, screenId, isActive: true },
      data: { isActive: false },
    });
    await this.prisma.client.schedule.deleteMany({ where: { tenantId, playlistId, screenId } });
    await this.prisma.client.schedule.create({
      data: {
        tenantId,
        playlistId,
        screenId,
        startTime: new Date(),
        endTime: null,
        priority: 0,
        mode: 'replace',
        isActive: true,
      },
    });
  }

  private async audit(tenantId: string, userId: string, targetId: string, details: any) {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'PLAYLIST_FLEET_PUBLISHED',
          targetType: 'Playlist',
          targetId,
          details: JSON.stringify(details),
        },
      });
    } catch (e: any) {
      this.logger.warn(`audit PLAYLIST_FLEET_PUBLISHED failed: ${e?.message ?? e}`);
    }
  }
}
