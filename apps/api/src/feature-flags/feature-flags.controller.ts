import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * GET /api/v1/feature-flags — returns the resolved boolean map of every
 * declared flag for the authenticated tenant.
 *
 * 2026-05-08 — auth-gated.
 *
 * Previously unauthenticated. The web client doesn't actually call this
 * endpoint (it goes through OpenFeature/GrowthBook SDK directly via
 * NEXT_PUBLIC_GROWTHBOOK_* env vars), so locking it down doesn't break
 * any known caller. The risk it closed: leaking the full set of flag
 * names to anyone on the public internet — useful for an attacker
 * profiling staff-only / experimental capabilities. Today the FLAGS map
 * is all user-facing UI gates (EMERGENCY_NEW_UI, TEMPLATE_BUILDER_V2,
 * SIS_INTEGRATION, AUTO_BRANDING), but the architecture lets future
 * internal flags slip through automatically — guarding now stops that
 * regression class.
 */
@Controller('api/v1/feature-flags')
@UseGuards(JwtAuthGuard)
export class FeatureFlagsController {
  constructor(private readonly ff: FeatureFlagsService) {}

  @Get()
  all(): Record<string, boolean> {
    return this.ff.allFlags();
  }
}
