import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { CapacityWatchService } from './capacity-watch.service';

/**
 * GET /api/v1/super/capacity — SUPER_ADMIN only. Feeds the "Capacity" card on /super/efficiency.
 * Read-only diagnostic (no AuditLog row, same as /super/efficiency). Not customer-facing.
 */
@Controller('api/v1/super')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
export class CapacityController {
  constructor(private readonly watch: CapacityWatchService) {}

  @Get('capacity')
  async getCapacity() {
    return this.watch.getReport();
  }
}
