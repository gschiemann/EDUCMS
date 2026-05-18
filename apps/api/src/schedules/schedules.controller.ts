import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import {
  ScheduleCreateSchema, type ScheduleCreateInput,
  ScheduleUpdateSchema, type ScheduleUpdateInput,
} from '@cms/api-types';

@Controller('api/v1/schedules')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SchedulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly signer: WebsocketSignerService
  ) {}

  private async notifySync(tenantId: string) {
    try {
      const message = this.signer.signMessage('SYNC', { source: 'schedule_update' });
      await this.redisService.publish(`tenant:${tenantId}`, message);
    } catch (e) {}
  }

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.prisma.client.schedule.findMany({
      where: { tenantId },
      include: {
        playlist: { select: { id: true, name: true } },
        screenGroup: { select: { id: true, name: true } },
        screen: { select: { id: true, name: true } },
      },
      orderBy: { startTime: 'desc' },
    });
  }

  @Post()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async create(
    @Request() req: any,
    @Body(new ZodValidationPipe(ScheduleCreateSchema)) body: ScheduleCreateInput,
  ) {
    if (!body.screenGroupId && !body.screenId) {
      throw new HttpException('Either screenGroupId or screenId must be specified', HttpStatus.BAD_REQUEST);
    }

    // auth-BUG-003: validate every foreign id in the body actually
    // belongs to the caller's tenant before writing. Without these
    // checks Prisma would happily insert a Schedule referencing
    // another tenant's playlist/screen/screenGroup, leaking content
    // across tenants. Mirrors submissions.controller.ts:78-89 pattern.
    if (!body.playlistId) {
      throw new HttpException('playlistId is required', HttpStatus.BAD_REQUEST);
    }
    const playlistOwned = await this.prisma.client.playlist.findFirst({
      where: { id: body.playlistId, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!playlistOwned) {
      throw new HttpException('Playlist not found', HttpStatus.NOT_FOUND);
    }
    if (body.screenId) {
      const screenOwned = await this.prisma.client.screen.findFirst({
        where: { id: body.screenId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!screenOwned) {
        throw new HttpException('Screen not found', HttpStatus.NOT_FOUND);
      }
    }
    if (body.screenGroupId) {
      const groupOwned = await this.prisma.client.screenGroup.findFirst({
        where: { id: body.screenGroupId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!groupOwned) {
        throw new HttpException('Screen group not found', HttpStatus.NOT_FOUND);
      }
    }

    const willBeActive = body.isActive !== false;

    // Only displace other active schedules when THIS schedule is going
    // live. A saved-draft schedule should not knock the currently-
    // running one off the screen; it's a plan, not a go-live.
    if (willBeActive && body.mode !== 'append') {
       // Replace mode: disable all existing active schedules for this target
       await this.prisma.client.schedule.updateMany({
         where: {
           tenantId: req.user.tenantId,
           isActive: true,
           OR: [
             body.screenId ? { screenId: body.screenId } : {},
             body.screenGroupId ? { screenGroupId: body.screenGroupId } : {},
           ].filter(x => Object.keys(x).length > 0)
         },
         data: { isActive: false }
       });
    }

    // Validate and normalize mode
    const mode = body.mode || 'replace';
    if (!['append', 'replace'].includes(mode)) {
      throw new HttpException('Mode must be "append" or "replace"', HttpStatus.BAD_REQUEST);
    }

    // 2026-05-05 — operator: "i only selected 2 displays and it
    // created 4 different schedules for some reason".
    //
    // Each (playlistId, target) combination should resolve to at
    // most ONE Schedule row. The previous deactivate-only logic
    // soft-disabled OTHER playlists' schedules but appended a fresh
    // row for THIS playlist on every republish — leaving stale
    // inactive duplicates piling up in the schedule list every
    // time the operator hit Publish.
    //
    // Hard-delete prior (playlist, target) rows so a republish
    // becomes a true upsert. The Schedule row itself has no audit
    // value — the AuditLog table records "operator scheduled
    // playlist X on screen Y" separately and survives this delete.
    //
    // Applies to BOTH replace and append modes: today's UI has one
    // time-window-per-schedule, so multi-window-on-same-target
    // isn't a supported workflow; collapsing to a single row is
    // strictly cleaner.
    if (body.playlistId && (body.screenId || body.screenGroupId)) {
      await this.prisma.client.schedule.deleteMany({
        where: {
          tenantId: req.user.tenantId,
          playlistId: body.playlistId,
          ...(body.screenId
            ? { screenId: body.screenId }
            : { screenId: null }),
          ...(body.screenGroupId
            ? { screenGroupId: body.screenGroupId }
            : { screenGroupId: null }),
        },
      });
    }

    const res = await this.prisma.client.schedule.create({
      data: {
        tenantId: req.user.tenantId,
        playlistId: body.playlistId,
        screenGroupId: body.screenGroupId || undefined,
        screenId: body.screenId || undefined,
        startTime: new Date(body.startTime),
        endTime: body.endTime ? new Date(body.endTime) : null,
        daysOfWeek: body.daysOfWeek || null,
        timeStart: body.timeStart || null,
        timeEnd: body.timeEnd || null,
        priority: body.priority ?? 0,
        mode: mode,
        // 2026-05-05 — accept null/true/false; null = honor item-level.
        mutedOverride: body.mutedOverride === undefined ? null : body.mutedOverride,
        isActive: willBeActive,
      },
      include: {
        playlist: { select: { id: true, name: true } },
        screenGroup: { select: { id: true, name: true } },
        screen: { select: { id: true, name: true } },
      },
    });
    // Only nudge players when the new schedule is actually live.
    // Drafts don't affect the running fleet so there's no reason to
    // wake every player up to re-sync.
    if (willBeActive) {
      this.notifySync(req.user.tenantId);
    }
    return res;
  }

  @Put(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ScheduleUpdateSchema)) body: ScheduleUpdateInput,
  ) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!schedule) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    // auth-BUG-003: same cross-tenant validation as create — when a
    // PUT body re-targets the schedule at a different screen or group
    // we must confirm the new id belongs to this tenant. A bare string
    // (with no truthy id) clears the field and is fine.
    if (body.playlistId) {
      const playlistOwned = await this.prisma.client.playlist.findFirst({
        where: { id: body.playlistId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!playlistOwned) {
        throw new HttpException('Playlist not found', HttpStatus.NOT_FOUND);
      }
    }
    if (body.screenId) {
      const screenOwned = await this.prisma.client.screen.findFirst({
        where: { id: body.screenId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!screenOwned) {
        throw new HttpException('Screen not found', HttpStatus.NOT_FOUND);
      }
    }
    if (body.screenGroupId) {
      const groupOwned = await this.prisma.client.screenGroup.findFirst({
        where: { id: body.screenGroupId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!groupOwned) {
        throw new HttpException('Screen group not found', HttpStatus.NOT_FOUND);
      }
    }

    const data: any = {};
    if (body.playlistId !== undefined && body.playlistId) data.playlistId = body.playlistId;
    if (body.screenGroupId !== undefined) { data.screenGroupId = body.screenGroupId || null; data.screenId = null; }
    if (body.screenId !== undefined) { data.screenId = body.screenId || null; data.screenGroupId = null; }
    if (body.daysOfWeek !== undefined) data.daysOfWeek = body.daysOfWeek || null;
    if (body.timeStart !== undefined) data.timeStart = body.timeStart || null;
    if (body.timeEnd !== undefined) data.timeEnd = body.timeEnd || null;
    if (body.priority !== undefined) data.priority = body.priority;
    // 2026-05-05 — explicit undefined check so a caller passing null
    // can CLEAR the override (back to per-item behavior). Without the
    // explicit check `body.mutedOverride || null` would coerce false
    // to null and lose the "force unmuted" state.
    if (body.mutedOverride !== undefined) data.mutedOverride = body.mutedOverride;

    const res = await this.prisma.client.schedule.update({
      where: { id },
      data,
      include: {
        playlist: { select: { id: true, name: true } },
        screenGroup: { select: { id: true, name: true } },
        screen: { select: { id: true, name: true } },
      },
    });
    this.notifySync(req.user.tenantId);
    return res;
  }

  @Put(':id/toggle')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async toggle(@Request() req: any, @Param('id') id: string) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!schedule) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    const res = await this.prisma.client.schedule.update({
      where: { id },
      data: { isActive: !schedule.isActive },
      include: {
        playlist: { select: { id: true, name: true } },
        screenGroup: { select: { id: true, name: true } },
      },
    });
    this.notifySync(req.user.tenantId);
    return res;
  }

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!schedule) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    await this.prisma.client.schedule.delete({ where: { id } });
    this.notifySync(req.user.tenantId);
    return { deleted: true };
  }
}
