import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

@Controller('api/v1/screen-groups')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ScreenGroupsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.prisma.client.screenGroup.findMany({
      where: { tenantId },
      include: {
        screens: {
          select: { id: true, name: true, location: true, status: true, lastPingAt: true, resolution: true, osInfo: true, browserInfo: true, ipAddress: true, pairedAt: true, deviceFingerprint: true },
        },
        schedules: {
          where: { isActive: true },
          include: { playlist: { select: { id: true, name: true } } },
          orderBy: { startTime: 'desc' },
        },
        _count: { select: { schedules: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async create(@Request() req: any, @Body() body: { name: string; description?: string }) {
    return this.prisma.client.screenGroup.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name,
        description: body.description,
      },
    });
  }

  @Put(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async update(@Request() req: any, @Param('id') id: string, @Body() body: { name?: string; description?: string }) {
    const group = await this.prisma.client.screenGroup.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!group) return { error: 'Not found' };

    return this.prisma.client.screenGroup.update({
      where: { id },
      data: { name: body.name, description: body.description },
    });
  }

  @Put(':id/screens')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async assignScreens(@Request() req: any, @Param('id') id: string, @Body() body: { screenIds: string[] }) {
    const group = await this.prisma.client.screenGroup.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!group) return { error: 'Not found' };

    // Assign screens to this group (tenant-scoped)
    await this.prisma.client.screen.updateMany({
      where: { id: { in: body.screenIds }, tenantId: req.user.tenantId },
      data: { screenGroupId: id },
    });

    return this.prisma.client.screenGroup.findUnique({
      where: { id },
      include: { screens: true },
    });
  }

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const group = await this.prisma.client.screenGroup.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!group) return { error: 'Not found' };

    // Unassign screens first, then delete group
    await this.prisma.client.screen.updateMany({
      where: { screenGroupId: id },
      data: { screenGroupId: null },
    });

    await this.prisma.client.screenGroup.delete({ where: { id } });
    return { deleted: true };
  }
}
