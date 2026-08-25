import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { EmergencyReadinessService, EmergencyReadinessReport } from './emergency-readiness.service';

/**
 * GET /api/v1/emergency/readiness — the computed "are we actually ready
 * for a drill?" report for the caller's own tenant.
 *
 * READ-ONLY. Deliberately a separate controller from EmergencyController:
 * the trigger/all-clear path is under change-control (CLAUDE.md — never
 * weaken safeguards), and this file provably cannot touch it. Admins only —
 * the report enumerates operational posture (staff counts, screen health),
 * which is not viewer-tier information.
 */
@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/emergency')
export class EmergencyReadinessController {
  constructor(private readonly readiness: EmergencyReadinessService) {}

  @Get('readiness')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getReadiness(@Request() req: any): Promise<EmergencyReadinessReport> {
    return this.readiness.compute(req.user.tenantId);
  }
}
