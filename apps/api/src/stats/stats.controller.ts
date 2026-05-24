import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

@Controller('api/v1/stats')
@UseGuards(JwtAuthGuard, RbacGuard)
export class StatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getOverview(@Request() req: any) {
    const tenantId = req.user.tenantId;

    // 2026-05-23 launch audit P1: this endpoint is polled every 60s
    // by every open dashboard tab (use-dashboard-data.ts). Previously
    // four DB round-trips ran sequentially — each await blocking the
    // next. They have no inter-dependency, so Promise.all collapses
    // it to 1 round-trip's worth of latency (~5ms vs ~80ms at typical
    // Supabase pooler RTT).
    const [totalScreens, onlineScreens, activePlaylists, tenant] = await Promise.all([
      this.prisma.client.screen.count({ where: { tenantId } }),
      this.prisma.client.screen.count({ where: { tenantId, status: 'ONLINE' } }),
      this.prisma.client.playlist.count({ where: { tenantId } }),
      this.prisma.client.tenant.findUnique({
        where: { id: tenantId },
        select: { emergencyStatus: true },
      }),
    ]);

    const offlineScreens = totalScreens - onlineScreens;
    const emergencyStatus = tenant?.emergencyStatus === 'INACTIVE' ? 'CLEAR' : tenant?.emergencyStatus || 'CLEAR';

    return {
      totalScreens,
      onlineScreens,
      offlineScreens,
      activePlaylists,
      emergencyStatus
    };
  }
}
