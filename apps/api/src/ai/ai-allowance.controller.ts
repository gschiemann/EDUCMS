/**
 * GET /api/v1/ai/allowance — how many AI boards this organisation has left (2026-09-23).
 *
 * The operator-facing unit of the AI Designer on our key is a BOARD (ai-board-credits.ts): the
 * dashboard shows "N boards left this month", offers the packs, and says why a pack cannot be
 * bought when it cannot. Every number is an exact count — boards included this month, drawn,
 * bought-and-unused, left — never an estimate.
 *
 *   source 'platform'  our key draws the boards → the counts, the packs, purchaseEnabled
 *   source 'tenant'    its own (or its organisation's) key → unlimited: true, boardsLeft: null
 *   source 'none'      neither → boardsLeft: null, purchaseEnabled: false, a `reason` to show
 *
 * The tenant comes from the SESSION only — there is no tenant, org or id parameter to aim at
 * another organisation. Roles: everyone who can make or edit a board (RESTRICTED_VIEWER may read it
 * through the RBAC guard's read rule, as for any CONTRIBUTOR-readable GET). Our cost per board is
 * included for SUPER_ADMIN only — it is margin data, never shown to an operator.
 */
import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AiAllowanceService } from './ai-allowance.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/ai')
export class AiAllowanceController {
  constructor(private readonly allowance: AiAllowanceService) {}

  @Get('allowance')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async allowanceForSession(@Request() req: any) {
    return this.allowance.operatorView(req.user.tenantId, { includeCost: req.user?.role === AppRole.SUPER_ADMIN });
  }
}
