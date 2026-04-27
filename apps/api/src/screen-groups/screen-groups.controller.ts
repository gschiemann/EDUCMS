import { Controller, Get, Post, Put, Delete, Body, Param, Res, UseGuards, Request } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

// Same staleness threshold as screens.controller.ts list() — keep in
// sync. Source of truth is the screens controller; this duplicate
// exists because the dashboard's Screens page renders from
// /screen-groups (not /screens), and the stored `status` column only
// updates on register/pair/ping and never back to OFFLINE. Without
// this derivation a screen that silently dies shows ONLINE forever in
// the grouped list.
const STALE_MS = 35 * 1000;

@Controller('api/v1/screen-groups')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ScreenGroupsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any, @Res({ passthrough: true }) res?: any) {
    // Force-no-cache — fleet state is live. Without this some
    // intermediaries / service workers held the previous payload for
    // minutes after the screens actually went down.
    if (res?.setHeader) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    const tenantId = req.user.tenantId;
    const groups = await this.prisma.client.screenGroup.findMany({
      where: { tenantId },
      include: {
        screens: {
          // BUG FIX 2026-04-27: this `select` was missing
          // `playerVersion` / `playerVersionCode` / `playerVersionAt`
          // / `forceApkUpdatePendingAt` / `userAgent`. Dashboard
          // renders from `group.screens` (NOT useScreens()), so the
          // PlayerKindChip read `screen.playerVersion`, got undefined,
          // and fell back to "—" forever even though the field WAS
          // populated in Postgres + the /screens list endpoint
          // (different code path) returned it correctly. Operator
          // burned ~3 hours debugging a phantom kiosk-side bug
          // because of one missing field in this select.
          select: {
            id: true, name: true, location: true, status: true,
            lastPingAt: true, resolution: true, osInfo: true,
            browserInfo: true, userAgent: true, ipAddress: true,
            pairedAt: true, deviceFingerprint: true, tenantId: true,
            screenGroupId: true, latitude: true, longitude: true,
            address: true, lastCacheReport: true, lastCacheReportAt: true,
            playerVersion: true, playerVersionCode: true, playerVersionAt: true,
            forceApkUpdatePendingAt: true,
          },
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
    // Apply the same live-derive logic as screens.controller.ts list().
    // A paired screen whose lastPingAt is stale flips to OFFLINE; a
    // screen with fresh ping stays ONLINE. Unpaired/REVOKED states
    // pass through unchanged.
    const now = Date.now();
    return groups.map((g) => ({
      ...g,
      screens: g.screens.map((s) => {
        let liveStatus: string = s.status;
        if (s.status !== 'REVOKED') {
          const last = s.lastPingAt ? new Date(s.lastPingAt).getTime() : 0;
          const isAlive = last && (now - last) < STALE_MS;
          if (isAlive && s.tenantId) liveStatus = 'ONLINE';
          else if (s.status === 'ONLINE' || s.tenantId) liveStatus = 'OFFLINE';
        }
        return { ...s, status: liveStatus };
      }),
    }));
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
