/**
 * AiController — REST surface for the AI content generator.
 *
 *   POST /api/v1/ai/generate
 *     body: { intent, context, tone?, count?, vertical? }
 *     returns: { options: [{ text }], intent }
 *
 * Sprint top-tier (2026-05-03). All ADMIN+ + CONTRIBUTOR — gated below
 * RESTRICTED_VIEWER so read-only roles can't burn AI budget.
 */

import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { AiService } from './ai.service';
import type { AiGenerateRequest } from './ai.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('generate')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async generate(@Request() req: any, @Body() body: AiGenerateRequest) {
    return this.ai.generate({
      ...body,
      tenantId: req.user.tenantId,
    });
  }
}
