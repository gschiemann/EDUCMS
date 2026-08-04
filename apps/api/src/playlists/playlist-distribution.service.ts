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
    // NEW (2026-07-03, P1 fix): the publish is per-location transactional and
    // NEVER goes dark. These roll-ups let the UI report an HONEST partial
    // result ("published to N of M, these failed: …") instead of the old
    // blanket throw that read as total failure even when some locations went
    // live. `ok` is true only when every targeted location succeeded.
    ok: boolean;
    locationsSucceeded: number;
    locationsFailed: number;
    screensScheduled: number;
    failures: Array<{ tenantId: string; tenantName: string; error: string }>;
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
      where: { parentId: parentTenantId, archivedAt: null }, // never cascade fleet content into an archived location
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
    const failures: Array<{ tenantId: string; tenantName: string; error: string }> = [];

    // Each location is published INDEPENDENTLY and is all-or-nothing. A single
    // location failing (copy error, DB hiccup) MUST NOT abort the whole publish
    // — the locations that already went live stay live, the failed location
    // keeps its PREVIOUS working schedule (see scheduleLive: activate-then-
    // deactivate + per-location transaction, so it never goes dark), and we
    // report an HONEST partial result. The old code threw on the first error,
    // which (a) read as "Publish failed" in the UI even though earlier
    // locations had already committed live, and (b) could leave a screen dark.
    for (const [tenantId, tScreens] of byTenant.entries()) {
      const isParent = tenantId === parentTenantId;
      const tenantName = nameByTenant.get(tenantId) ?? tenantId;
      try {
        const targetPlaylistId = isParent
          ? source.id // same tenant → schedule the source directly, no copy
          : await this.copyPlaylistIntoChild(source, tenantId, actorUserId);

        // Per-screen swap is atomic (activate the new schedule BEFORE standing
        // down the old one), so a mid-swap failure rolls the whole screen back
        // to its previous working schedule — never a dark window.
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
          tenantName,
          playlistId: targetPlaylistId,
          screensScheduled: tScreens.length,
          isParent,
        });
      } catch (e: any) {
        this.logger.error(
          `publishToFleet: location ${tenantName} (${tenantId}) failed: ${e?.message ?? e}`,
        );
        failures.push({ tenantId, tenantName, error: e?.message ?? String(e) });
      }
    }

    const screensScheduled = perLocation.reduce((n, l) => n + l.screensScheduled, 0);

    // Every targeted location failed → this genuinely IS a total failure, so
    // throw the way the caller/UI expects (nothing went live, nothing to keep).
    // A PARTIAL success returns 200 with the honest breakdown below.
    if (perLocation.length === 0 && failures.length > 0) {
      throw new BadRequestException(
        `Publish failed for all ${failures.length} location(s): ${failures
          .map((f) => `${f.tenantName} (${f.error})`)
          .join('; ')}`,
      );
    }

    return {
      sourcePlaylistId: source.id,
      totalScreens: screens.length,
      totalLocations: byTenant.size,
      ok: failures.length === 0,
      locationsSucceeded: perLocation.length,
      locationsFailed: failures.length,
      screensScheduled,
      failures,
      perLocation,
    };
  }

  /** Find-or-create a child Asset mirroring a parent asset (same stored file). */
  private async ensureChildAsset(parentAsset: any, childTenantId: string, actorUserId: string): Promise<string> {
    // INTEG-02 (2026-08-04) — match on fileUrl ONLY. Never on fileHash.
    //
    // This used to prefer `{ tenantId: childTenantId, fileHash }` and fall back
    // to fileUrl. That made a corporate push resolve to whatever child-tenant
    // row happened to carry a matching hash — and `Asset.fileHash` is not
    // trustworthy enough to key on: POST /assets/complete-upload accepted the
    // hash from the request body and only checked it was 64 hex characters
    // (see INTEG-01, fixed alongside this). So anyone who could upload in a
    // CHILD tenant — CONTRIBUTOR is enough — could pre-create a row claiming
    // the hash of content the district was about to push, pointing fileUrl at
    // anything they liked. The district publishes, this lookup finds their row
    // first, and their file plays on that school's screens under the
    // district's playlist. Content substitution, no district access required.
    //
    // fileUrl is the right key and needs no trust: it is server-generated from
    // the storage path (`publicUrlForPath`), and every child row this method
    // creates copies the parent's fileUrl verbatim (below), so the find-or-
    // create round-trip still works exactly as before. What is lost is only
    // the incidental dedupe against a *separately uploaded* child asset that
    // happened to share bytes — which was never required for correctness, and
    // was precisely the substitution vector.
    const existing = await this.prisma.client.asset.findFirst({
      where: { tenantId: childTenantId, fileUrl: parentAsset.fileUrl },
      select: { id: true },
    });
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

  /**
   * Replace-mode schedule — make this playlist live on the screen now.
   *
   * NO DARK WINDOW (2026-07-03, P1 fix): the swap is ordered activate-THEN-
   * deactivate and wrapped in a single interactive transaction, so the screen
   * always has ≥1 active schedule at every committed point:
   *   1. Remove any stale (this playlist, this screen) rows so re-publish stays
   *      idempotent — this playlist is what we're about to (re)activate, so
   *      removing its own prior rows can't leave the screen uncovered.
   *   2. CREATE the new schedule active FIRST. The screen is now covered by the
   *      new content.
   *   3. Deactivate every OTHER active schedule on this screen (the previous
   *      content) — only after the replacement is live.
   * The old code did (deactivate-all) → (delete) → (create): a failure between
   * the deactivate and the create left the screen with NO active schedule —
   * dark. The transaction also makes the whole swap all-or-nothing, so a
   * mid-swap error rolls the screen back to its PREVIOUS working schedule.
   */
  private async scheduleLive(tenantId: string, playlistId: string, screenId: string) {
    await this.prisma.client.$transaction(async (tx) => {
      // 1. Clear this playlist's own prior rows for this screen (idempotent
      //    re-publish). Safe because we immediately re-create it active below.
      await tx.schedule.deleteMany({ where: { tenantId, playlistId, screenId } });
      // 2. Activate the new content BEFORE standing down the old — the screen is
      //    covered at every intermediate, committed state.
      const created = await tx.schedule.create({
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
        select: { id: true },
      });
      // 3. Now stand down every OTHER active schedule on this screen (the
      //    previous content). Excludes the row we just created.
      await tx.schedule.updateMany({
        where: { tenantId, screenId, isActive: true, id: { not: created.id } },
        data: { isActive: false },
      });
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
