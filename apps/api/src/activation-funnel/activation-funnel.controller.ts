import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { ActivationFunnelService } from './activation-funnel.service';

/**
 * GET /api/v1/super/activation-funnel — SUPER_ADMIN only.
 *
 * Read-only. Derives a per-tenant activation funnel (signup -> board
 * created -> screen paired -> published -> render-proven) entirely from
 * rows that already exist elsewhere in the schema — zero new event
 * writes, zero schema changes, zero new instrumentation calls. See the
 * large definition comment at the top of ActivationFunnelService for the
 * full metric definition and exclusion rules; keep that comment in sync
 * if this endpoint's shape ever changes.
 *
 * Guard pattern matches every other /super/* controller
 * (SuperLicenseController, EfficiencyController): JwtAuthGuard + RbacGuard
 * + @RequireRoles(SUPER_ADMIN).
 */
@Controller('api/v1/super')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
export class ActivationFunnelController {
  constructor(private readonly funnel: ActivationFunnelService) {}

  @Get('activation-funnel')
  async getActivationFunnel() {
    return this.funnel.getFunnel();
  }
}
