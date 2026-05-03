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
  tiers(@Query('vertical') vertical?: string) {
    const all = LICENSE_TIERS;
    const recommended = vertical ? recommendedTiersForVertical(vertical) : all;
    const recIds = new Set(recommended.map((t) => t.id));
    // Return only tiers shown to this vertical, plus add-ons (which are
    // universal across verticals — operator decides if they want them).
    return all
      .filter((t) => recIds.has(t.id) || t.isAddon || t.id === 'PILOT' || t.id === 'CMS_CORE')
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
        // Mark the most relevant tier per vertical as the recommended
        // one. Pick the first non-PILOT, non-add-on tier in `bestFor`.
        recommended: vertical ? (t.bestFor as readonly string[]).includes(vertical) && !t.isAddon : false,
      }));
  }
}
