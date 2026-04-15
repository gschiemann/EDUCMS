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

    const totalScreens = await this.prisma.client.screen.count({ where: { tenantId } });
    const onlineScreens = await this.prisma.client.screen.count({ where: { tenantId, status: 'ONLINE' } });
    const offlineScreens = totalScreens - onlineScreens;
    const activePlaylists = await this.prisma.client.playlist.count({ where: { tenantId } });

    // Query actual emergency status from the tenant record
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { emergencyStatus: true }
    });
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
