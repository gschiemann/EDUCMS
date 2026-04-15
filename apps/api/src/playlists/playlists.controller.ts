import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

@Controller('api/v1/playlists')
@UseGuards(JwtAuthGuard, RbacGuard)
export class PlaylistsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.prisma.client.playlist.findMany({
      where: { tenantId },
      include: {
        items: {
          orderBy: { sequenceOrder: 'asc' },
          include: { asset: { select: { id: true, fileUrl: true, mimeType: true } } },
        },
        template: { select: { id: true, name: true, screenWidth: true, screenHeight: true, category: true } },
        _count: { select: { schedules: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Get(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async get(@Request() req: any, @Param('id') id: string) {
    return this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
      include: {
        items: {
          orderBy: { sequenceOrder: 'asc' },
          include: { asset: true },
        },
      },
    });
  }

  @Post()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async create(@Request() req: any, @Body() body: { name: string; templateId?: string }) {
    return this.prisma.client.playlist.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name,
        ...(body.templateId ? { templateId: body.templateId } : {}),
      },
    });
  }

  @Put(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async update(@Request() req: any, @Param('id') id: string, @Body() body: { name: string }) {
    const playlist = await this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!playlist) return { error: 'Not found' };

    return this.prisma.client.playlist.update({
      where: { id },
      data: { name: body.name },
    });
  }

  @Put(':id/items')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async reorderItems(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { items: Array<{ assetId: string; durationMs: number; sequenceOrder: number }> },
  ) {
    const playlist = await this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!playlist) return { error: 'Not found' };

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
          },
        }),
      ),
    ]);

    return this.prisma.client.playlist.findUnique({
      where: { id },
      include: { items: { orderBy: { sequenceOrder: 'asc' }, include: { asset: true } } },
    });
  }

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const playlist = await this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!playlist) return { error: 'Not found' };

    await this.prisma.client.playlist.delete({ where: { id } });
    return { deleted: true };
  }
}
