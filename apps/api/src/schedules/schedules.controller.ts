import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

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
    @Body() body: {
      playlistId: string;
      screenGroupId?: string;
      screenId?: string;
      startTime: string;
      endTime?: string;
      daysOfWeek?: string;   // "Mon,Tue,Wed,Thu,Fri"
      timeStart?: string;    // "08:00"
      timeEnd?: string;      // "15:00"
      priority?: number;
      mode?: 'append' | 'replace';
      // Save as a DRAFT (isActive = false). Lets operators stage
      // a schedule ahead of time — e.g. build a "Friday pep rally"
      // rotation on Monday — and flip it live with the on/off
      // toggle on the playlist card when the day comes. Defaults
      // to `true` (publish immediately) to preserve the old
      // behavior for any caller not passing this flag.
      isActive?: boolean;
    },
  ) {
    if (!body.screenGroupId && !body.screenId) {
      throw new HttpException('Either screenGroupId or screenId must be specified', HttpStatus.BAD_REQUEST);
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
    @Body() body: {
      screenGroupId?: string;
      screenId?: string;
      daysOfWeek?: string | null;
      timeStart?: string | null;
      timeEnd?: string | null;
      priority?: number;
    },
  ) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!schedule) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    const data: any = {};
    if (body.screenGroupId !== undefined) { data.screenGroupId = body.screenGroupId || null; data.screenId = null; }
    if (body.screenId !== undefined) { data.screenId = body.screenId || null; data.screenGroupId = null; }
    if (body.daysOfWeek !== undefined) data.daysOfWeek = body.daysOfWeek || null;
    if (body.timeStart !== undefined) data.timeStart = body.timeStart || null;
    if (body.timeEnd !== undefined) data.timeEnd = body.timeEnd || null;
    if (body.priority !== undefined) data.priority = body.priority;

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
