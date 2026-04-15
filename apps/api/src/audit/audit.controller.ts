import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

@Controller('api/v1/audit')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('recent')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getRecentActivity(@Request() req: any) {
    const tenantId = req.user.tenantId;

    return this.prisma.client.auditLog.findMany({
      where: { tenantId },
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, role: true } } },
    });
  }
}
