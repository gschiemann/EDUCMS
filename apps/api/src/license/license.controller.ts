import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { LicenseService } from './license.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { LICENSE_TIERS, getLicenseTier, recommendedTiersForVertical } from '@cms/api-types';

/** Tenant-facing license endpoint — current tier, seats used, expiry. */
@Controller('api/v1/license')
@UseGuards(JwtAuthGuard, RbacGuard)
export class LicenseController {
  constructor(private readonly license: LicenseService) {}

  @Get('me')
  async me(@Request() req: any) {
    return this.license.summary(req.user.tenantId);
  }

  /**
   * Current license — tier metadata + seat usage. Mirrors `me` but
   * returns the canonical CurrentLicense DTO the billing UI expects.
   */
  @Get('current')
  async current(@Request() req: any) {
    const summary: any = await this.license.summary(req.user.tenantId);
    if (!summary) return null;
    const tierDef = getLicenseTier(summary.tier);
    return {
      ...summary,
      tierName: tierDef?.name || summary.tier,
      monthlyPriceCents: tierDef?.monthlyPriceCents ?? summary.monthlyPriceCents,
    };
  }

  /**
   * License tier catalog — returned with per-vertical recommendation
   * (the tier flagged for this vertical gets `recommended:true` so
   * the upgrade UI can highlight it).
   */
  @Get('tiers')
  tiers() {
    // 2026-05-03 — pricing simplified to FREE_TRIAL / MONTHLY / ANNUAL.
    // No vertical filtering, no add-ons. Annual is recommended for the
    // 17% savings call-out.
    return LICENSE_TIERS
      .filter((t) => t.id !== 'COMP' && t.id !== 'CUSTOM')
      .map((t) => ({
        id: t.id,
        name: t.name,
        blurb: t.blurb,
        monthlyPriceCents: t.monthlyPriceCents,
        annualPriceCents: t.annualPriceCents,
        seatLimit: t.seatLimit,
        features: t.features,
        selfServe: t.selfServe,
        isAddon: t.isAddon,
        recommended: t.id === 'ANNUAL',
      }));
  }
}
