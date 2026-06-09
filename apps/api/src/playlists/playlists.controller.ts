import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { PlaylistDistributionService } from './playlist-distribution.service';
import {
  PlaylistCreateSchema, type PlaylistCreateInput,
  PlaylistUpdateSchema, type PlaylistUpdateInput,
  PlaylistReorderItemsSchema, type PlaylistReorderItemsInput,
  PlaylistSetActiveSchema, type PlaylistSetActiveInput,
} from '@cms/api-types';

@Controller('api/v1/playlists')
@UseGuards(JwtAuthGuard, RbacGuard)
export class PlaylistsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly signer: WebsocketSignerService,
    private readonly distribution: PlaylistDistributionService,
  ) {}

  private async notifySync(tenantId: string) {
    try {
      const message = this.signer.signMessage('SYNC', { source: 'playlist_update' });
      await this.redisService.publish(`tenant:${tenantId}`, message);
    } catch (e) {}
  }

  // ─── Phase 2c — publish (distribute) this playlist to screens across child
  //     locations. Copies the playlist + its assets down into each child and
  //     schedules it live there (idempotent re-publish via sourcePlaylistId).
  //     Parent/corporate admins only; targets must be the caller's tenant or
  //     its direct children (enforced in the service).
  @Post(':id/publish-to-fleet')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  async publishToFleet(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { screenIds?: string[] },
  ) {
    const result = await this.distribution.publishToFleet({
      parentTenantId: req.user.tenantId,
      actorUserId: req.user.id,
      sourcePlaylistId: id,
      screenIds: Array.isArray(body?.screenIds) ? body.screenIds : [],
    });
    // Nudge each affected location's players to re-sync now (they'd otherwise
    // pick it up on the next 5-10s manifest poll).
    for (const loc of result.perLocation) this.notifySync(loc.tenantId);
    return result;
  }

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any) {
    await this.prisma.ensurePlaylistMetadataColumns();
    const tenantId = req.user.tenantId;
    const playlists = await this.prisma.client.playlist.findMany({
      // Hide protected (emergency) playlists from the regular /playlists
      // list so they can't be accidentally deleted. They surface only
      // through the panic-content settings card.
      where: { tenantId, isProtected: false },
      include: {
        items: {
          orderBy: { sequenceOrder: 'asc' },
          include: { asset: { select: { id: true, fileUrl: true, mimeType: true, originalName: true } } },
        },
        template: { select: { id: true, name: true, screenWidth: true, screenHeight: true, category: true } },
        createdBy: { select: { id: true, email: true } },
        _count: { select: { schedules: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    // Phase 2c — fleet-publish decoration. For each playlist that was published
    // to locations, how many child locations got a copy + how many of those
    // copies' schedules are active. Lets the card show "published to N
    // locations" and keep its on/off toggle working even when the SOURCE has
    // zero own schedules (the copies hold them). Best-effort; never blocks list.
    try {
      const ids = playlists.map((p) => p.id);
      const copies = ids.length
        ? await this.prisma.client.playlist.findMany({
            where: { sourcePlaylistId: { in: ids }, tenant: { parentId: tenantId } },
            select: { id: true, sourcePlaylistId: true, tenantId: true },
          })
        : [];
      if (copies.length) {
        const activeRows = await this.prisma.client.schedule.groupBy({
          by: ['playlistId'],
          where: { playlistId: { in: copies.map((c) => c.id) }, isActive: true },
          _count: { _all: true },
        });
        const activeByCopy = new Map<string, number>();
        for (const r of activeRows as any[]) activeByCopy.set(r.playlistId, r._count?._all ?? 0);
        const locsBySource = new Map<string, Set<string>>();
        const activeBySource = new Map<string, number>();
        for (const c of copies) {
          const src = c.sourcePlaylistId as string;
          (locsBySource.get(src) ?? locsBySource.set(src, new Set()).get(src)!).add(c.tenantId);
          activeBySource.set(src, (activeBySource.get(src) ?? 0) + (activeByCopy.get(c.id) ?? 0));
        }
        for (const p of playlists as any[]) {
          p.fleetLocations = locsBySource.get(p.id)?.size ?? 0;
          p.fleetActiveSchedules = activeBySource.get(p.id) ?? 0;
        }
      }
    } catch { /* fleet decoration is best-effort */ }

    return playlists;
  }

  @Get(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async get(@Request() req: any, @Param('id') id: string) {
    await this.prisma.ensurePlaylistMetadataColumns();
    return this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
      include: {
        items: {
          orderBy: { sequenceOrder: 'asc' },
          include: { asset: true },
        },
        template: { select: { id: true, name: true, screenWidth: true, screenHeight: true, category: true } },
        createdBy: { select: { id: true, email: true } },
      },
    });
  }

  @Post()
  // CONTRIBUTOR (the "Editor" tier) can CREATE a playlist to build content —
  // creating one does NOT publish it to any screen (publishing/scheduling is a
  // separate admin-only action the Editor reaches via Submit-for-Review).
  // Without this the editor role was half-crippled: it could edit existing
  // playlists but not start a new one. 2026-06-09 RBAC/reviewer rework.
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async create(@Request() req: any, @Body(new ZodValidationPipe(PlaylistCreateSchema)) body: PlaylistCreateInput) {
    await this.prisma.ensurePlaylistMetadataColumns();

    // auth-BUG-004: when the body provides a templateId, verify it's
    // either a system preset (isSystem: true, shared globally) or a
    // template belonging to the caller's tenant. Without this gate a
    // user could attach another tenant's custom template to their own
    // playlist and the player would render that tenant's layout.
    if (body.templateId) {
      const templateOwned = await this.prisma.client.template.findFirst({
        where: {
          id: body.templateId,
          OR: [
            { tenantId: req.user.tenantId },
            { isSystem: true },
          ],
        },
        select: { id: true },
      });
      if (!templateOwned) {
        throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
      }
    }

    const res = await this.prisma.client.playlist.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name,
        createdByUserId: req.user.id,
        ...(body.templateId ? { templateId: body.templateId } : {}),
      },
      include: {
        template: { select: { id: true, name: true, screenWidth: true, screenHeight: true, category: true } },
        createdBy: { select: { id: true, email: true } },
        items: {
          orderBy: { sequenceOrder: 'asc' },
          include: { asset: { select: { id: true, fileUrl: true, mimeType: true, originalName: true } } },
        },
        _count: { select: { schedules: true } },
      },
    });
    this.notifySync(req.user.tenantId);
    return res;
  }

  @Put(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async update(@Request() req: any, @Param('id') id: string, @Body(new ZodValidationPipe(PlaylistUpdateSchema)) body: PlaylistUpdateInput) {
    await this.prisma.ensurePlaylistMetadataColumns();
    const playlist = await this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!playlist) return { error: 'Not found' };

    const res = await this.prisma.client.playlist.update({
      where: { id },
      data: { name: body.name },
    });
    this.notifySync(req.user.tenantId);
    return res;
  }

  @Put(':id/items')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async reorderItems(
    @Request() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PlaylistReorderItemsSchema)) body: PlaylistReorderItemsInput,
  ) {
    await this.prisma.ensurePlaylistMetadataColumns();
    const playlist = await this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!playlist) return { error: 'Not found' };

    // HIGH-1 audit fix: validate every assetId in the body actually
    // belongs to the caller's tenant. Without this, a user could insert
    // another tenant's assetId into their own playlist (existence-leak +
    // potential cross-tenant rendering). Single COUNT query is cheap.
    const assetIds = Array.from(new Set(body.items.map(i => i.assetId).filter(Boolean)));
    if (assetIds.length > 0) {
      const ownedCount = await this.prisma.client.asset.count({
        where: { id: { in: assetIds }, tenantId: req.user.tenantId },
      });
      if (ownedCount !== assetIds.length) {
        throw new HttpException(
          { code: 'ASSET_TENANT_MISMATCH', message: 'One or more assets do not belong to this tenant.' },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // Replace all items in a transaction
    await this.prisma.client.$transaction([
      this.prisma.client.playlistItem.deleteMany({ where: { playlistId: id } }),
      ...body.items.map((item) =>
        this.prisma.client.playlistItem.create({
          data: {
            playlistId: id,
            assetId: item.assetId,
            durationMs: item.durationMs,
            sequenceOrder: item.sequenceOrder,
            daysOfWeek: item.daysOfWeek || null,
            timeStart: item.timeStart || null,
            timeEnd: item.timeEnd || null,
            transitionType: item.transitionType || 'FADE',
            // 2026-05-05 — default TRUE matches the previous always-
            // muted behavior. Operator flips per-item via the editor.
            muted: typeof item.muted === 'boolean' ? item.muted : true,
          },
        }),
      ),
      this.prisma.client.playlist.update({
        where: { id },
        data: { updatedAt: new Date() },
      }),
    ]);

    const updated = await this.prisma.client.playlist.findUnique({
      where: { id },
      include: {
        items: { orderBy: { sequenceOrder: 'asc' }, include: { asset: true } },
        template: { select: { id: true, name: true, screenWidth: true, screenHeight: true, category: true } },
        createdBy: { select: { id: true, email: true } },
        _count: { select: { schedules: true } },
      },
    });
    this.notifySync(req.user.tenantId);
    return updated;
  }

  /**
   * Flip every schedule attached to this playlist on or off in one
   * call. Powers the on/off toggle on the playlist card so an
   * operator doesn't have to drill into the playlist, hit Schedule,
   * then Publish just to turn content on or off for the day. Returns
   * the updated count so the UI can surface "N schedules activated".
   *
   * `active: true` with zero existing schedules is a soft no-op — the
   * frontend is expected to send the user through the publish flow in
   * that case. We don't silently create a schedule here because we
   * can't guess the correct screen target or time window.
   */
  @Put(':id/active')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setActive(
    @Request() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PlaylistSetActiveSchema)) body: PlaylistSetActiveInput,
  ) {
    await this.prisma.ensurePlaylistMetadataColumns();
    const playlist = await this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!playlist) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    // Protected (emergency / panic) playlists must not have their
    // schedules toggled from this generic operator endpoint — that
    // would silently disable a panic trigger. Same guard as `remove`
    // and `update`; managed from Settings → Panic Button Integrations.
    if (playlist.isProtected) {
      throw new HttpException(
        {
          code: 'PLAYLIST_PROTECTED',
          message: `This playlist holds ${playlist.protectedKind || 'emergency'} content — its schedules can't be toggled from here. Manage it from Settings → Panic Button Integrations.`,
        },
        HttpStatus.FORBIDDEN,
      );
    }
    const result = await this.prisma.client.schedule.updateMany({
      where: { playlistId: id, tenantId: req.user.tenantId },
      data: { isActive: !!body.active },
    });
    // Nudge the players so they re-fetch the manifest immediately
    // instead of waiting for the next 5-10s poll — same pattern as
    // schedule create.
    this.notifySync(req.user.tenantId);

    // Phase 2c — cascade to fleet copies. If this playlist was published to
    // locations, each child copy (Playlist.sourcePlaylistId === id) has its OWN
    // schedules in the child tenant, so turning the source off/on here must flip
    // those too — otherwise the copies keep playing. Scoped to DIRECT children
    // of this tenant (parent→child authority). Non-fatal: a cascade failure
    // never blocks the primary toggle.
    let cascadedLocations = 0;
    let cascadedSchedules = 0;
    try {
      const copies = await this.prisma.client.playlist.findMany({
        where: { sourcePlaylistId: id, tenant: { parentId: req.user.tenantId } },
        select: { id: true, tenantId: true },
      });
      if (copies.length) {
        const casc = await this.prisma.client.schedule.updateMany({
          where: { playlistId: { in: copies.map((c) => c.id) } },
          data: { isActive: !!body.active },
        });
        cascadedSchedules = casc.count;
        const tenantIds = Array.from(new Set(copies.map((c) => c.tenantId)));
        cascadedLocations = tenantIds.length;
        for (const tid of tenantIds) this.notifySync(tid);
      }
    } catch { /* cascade is best-effort; primary toggle already succeeded */ }

    return { count: result.count, active: !!body.active, cascadedLocations, cascadedSchedules };
  }

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    await this.prisma.ensurePlaylistMetadataColumns();
    const playlist = await this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!playlist) return { error: 'Not found' };

    // Refuse to delete a protected (emergency) playlist. The settings
    // page manages these; deleting one would silently break a future
    // panic trigger. The "BULLETPROOF FALLBACK" in screens/manifest
    // would still render a default red screen, but the operator's
    // configured content would be gone.
    if (playlist.isProtected) {
      throw new HttpException(
        {
          code: 'PLAYLIST_PROTECTED',
          message: `This playlist holds ${playlist.protectedKind || 'emergency'} content and cannot be deleted from here. Manage it from Settings → Panic Button Integrations.`,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // 2026-05-13 — Old behavior soft-disabled schedules (set
    // isActive=false) then tried to delete the playlist. That FAILED
    // with a Postgres foreign-key constraint because `Schedule.playlist`
    // has no `onDelete: Cascade` — every Schedule row still pointed at
    // the playlist, so the delete bounced and the client's optimistic
    // update rolled back ("deletes for 1s then pops right back in,"
    // reported verbatim by the operator).
    //
    // New behavior: write an AuditLog entry that captures the schedule
    // metadata first (audit trail preserved), THEN hard-delete the
    // schedules, THEN delete the playlist. PlaylistItems are removed by
    // their own onDelete: Cascade. Single transaction so a partial
    // failure rolls everything back.
    await this.prisma.client.$transaction(async (tx) => {
      const attachedSchedules = await tx.schedule.findMany({
        where: { playlistId: id },
        select: {
          id: true, screenId: true, screenGroupId: true,
          startTime: true, endTime: true, isActive: true,
        },
      });
      // 2026-05-23 launch audit P1: audit EVERY playlist delete, not
      // just deletes-with-attached-schedules. Operators were able to
      // ghost-delete an unscheduled draft with zero forensic trail.
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user.id,
          action: 'PLAYLIST_DELETED',
          targetType: 'Playlist',
          targetId: id,
          details: JSON.stringify({
            name: playlist.name,
            scheduleCount: attachedSchedules.length,
            schedules: attachedSchedules,
          }),
        },
      });
      // 2026-05-23 launch audit P1: removed the `.catch(() => {})`
      // that previously swallowed audit-write errors INSIDE this
      // $transaction. A failed audit MUST roll back the playlist +
      // schedule delete; a partial state with no forensic trail is
      // worse than rejecting and asking the operator to retry.
      if (attachedSchedules.length > 0) {
        await tx.schedule.deleteMany({ where: { playlistId: id } });
      }
      await tx.playlist.delete({ where: { id } });
    });
    this.notifySync(req.user.tenantId);
    return { deleted: true };
  }
}
