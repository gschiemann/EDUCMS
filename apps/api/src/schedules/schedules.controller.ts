import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

@Controller('api/v1/schedules')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SchedulesController {
  constructor(private readonly prisma: PrismaService) {}

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
    },
  ) {
    if (!body.screenGroupId && !body.screenId) {
      throw new HttpException('Either screenGroupId or screenId must be specified', HttpStatus.BAD_REQUEST);
    }

    return this.prisma.client.schedule.create({
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
      },
      include: {
        playlist: { select: { id: true, name: true } },
        screenGroup: { select: { id: true, name: true } },
        screen: { select: { id: true, name: true } },
      },
    });
  }

  @Put(':id/toggle')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async toggle(@Request() req: any, @Param('id') id: string) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!schedule) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    return this.prisma.client.schedule.update({
      where: { id },
      data: { isActive: !schedule.isActive },
      include: {
        playlist: { select: { id: true, name: true } },
        screenGroup: { select: { id: true, name: true } },
      },
    });
  }

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!schedule) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    await this.prisma.client.schedule.delete({ where: { id } });
    return { deleted: true };
  }
}
