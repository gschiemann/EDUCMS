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
    // 2026-10-12 — a VenueOS + AI license shows the "with AI" price of its tier.
    const account = await this.license.orgAccount(req.user.tenantId).catch(() => null);
    const aiIncluded = (account?.governing as any)?.aiIncluded === true;
    const aiPrice = aiIncluded ? tierDef?.aiMonthlyPriceCents ?? null : null;
    return {
      ...summary,
      tierName: tierDef?.name || summary.tier,
      monthlyPriceCents: aiPrice ?? tierDef?.monthlyPriceCents ?? summary.monthlyPriceCents,
      aiIncluded,
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
        // 2026-10-12 — the same tier with AI (VenueOS + AI); the Billing page shows these when the
        // AI option is on and the deploy offers it.
        aiMonthlyPriceCents: t.aiMonthlyPriceCents ?? null,
        aiAnnualPriceCents: t.aiAnnualPriceCents ?? null,
        seatLimit: t.seatLimit,
        features: t.features,
        selfServe: t.selfServe,
        isAddon: t.isAddon,
        recommended: t.id === 'ANNUAL',
      }));
  }
}
