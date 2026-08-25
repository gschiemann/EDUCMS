import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import {
  EmergencyReadinessService,
  EmergencyReadinessReport,
  DistrictReadinessReport,
} from './emergency-readiness.service';

/**
 * GET /api/v1/emergency/readiness — the computed "are we actually ready
 * for a drill?" report for the caller's own tenant.
 * GET /api/v1/emergency/readiness/district — the same question asked across
 * every school a district runs, batched (2026-08-24).
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

  /**
   * District rollup — one row per school the caller's district runs.
   *
   * Declared BEFORE `readiness` is irrelevant here (both are literal, non-
   * parameterised paths and cannot shadow each other), but the scope rule
   * is: this reads the caller's OWN tenant and its DIRECT, non-archived
   * children — the same asymmetric, read-only parent→child window
   * `GET /screens/fleet` already opens. A leaf school calling this gets a
   * one-row report about itself, never a peer's data. DISTRICT_ADMIN /
   * SUPER_ADMIN only, matching the fleet endpoint.
   *
   * Query cost: 3 DB queries + 3 sub-second probes, FLAT in school count.
   * See EmergencyReadinessService.computeDistrict for what the per-school
   * verdict does and does not include.
   */
  @Get('readiness/district')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  async getDistrictReadiness(@Request() req: any): Promise<DistrictReadinessReport> {
    return this.readiness.computeDistrict(req.user.tenantId);
  }

  @Get('readiness')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getReadiness(@Request() req: any): Promise<EmergencyReadinessReport> {
    return this.readiness.compute(req.user.tenantId);
  }
}
