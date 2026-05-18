import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

@Controller('api/v1/playlists')
@UseGuards(JwtAuthGuard, RbacGuard)
export class PlaylistsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly signer: WebsocketSignerService
  ) {}

  private async notifySync(tenantId: string) {
    try {
      const message = this.signer.signMessage('SYNC', { source: 'playlist_update' });
      await this.redisService.publish(`tenant:${tenantId}`, message);
    } catch (e) {}
  }

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any) {
    await this.prisma.ensurePlaylistMetadataColumns();
    const tenantId = req.user.tenantId;
    return this.prisma.client.playlist.findMany({
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
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async create(@Request() req: any, @Body() body: { name: string; templateId?: string }) {
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
  async update(@Request() req: any, @Param('id') id: string, @Body() body: { name: string }) {
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
    @Body() body: { items: Array<{ assetId: string; durationMs: number; sequenceOrder: number; daysOfWeek?: string | null; timeStart?: string | null; timeEnd?: string | null; transitionType?: string | null; muted?: boolean }> },
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
    @Body() body: { active: boolean },
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
    return { count: result.count, active: !!body.active };
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
      if (attachedSchedules.length > 0) {
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
        }).catch(() => { /* non-fatal — primary delete still proceeds */ });
        await tx.schedule.deleteMany({ where: { playlistId: id } });
      }
      await tx.playlist.delete({ where: { id } });
    });
    this.notifySync(req.user.tenantId);
    return { deleted: true };
  }
}
