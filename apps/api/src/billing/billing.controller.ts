/**
 * BillingController — Stripe Checkout + Customer Portal + invoices.
 *
 * All real Stripe work lives in StripeService and is gated on
 * STRIPE_SECRET_KEY. When Stripe is not configured every endpoint
 * degrades gracefully — `checkout`/`portal` return `{ enabled: false }`
 * and `invoices` returns `[]` — so a deploy with no billing (the live
 * pilot) is untouched.
 *
 * The webhook lives in a SEPARATE, unauthenticated controller
 * (billing-webhook.controller.ts) — Stripe calls it with no JWT.
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { StripeService } from './stripe.service';
import { LicenseService } from '../license/license.service';

const BILLING_ROLES = [
  AppRole.SUPER_ADMIN,
  AppRole.DISTRICT_ADMIN,
  AppRole.SCHOOL_ADMIN,
] as const;

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/billing')
export class BillingController {
  constructor(
    private readonly stripe: StripeService,
    // LicenseService is exported by the @Global LicenseModule, so it
    // resolves here without listing it in BillingModule's providers.
    private readonly license: LicenseService,
  ) {}

  /** The dashboard's billing return path for this tenant. */
  private billingUrl(req: any): string {
    const origin = req.headers.origin || `${req.protocol}://${req.headers.host}`;
    return `${origin}/${req.user.tenantSlug || 'dashboard'}/settings/billing`;
  }

  /**
   * Start a subscription. Returns `{ url }` — a Stripe-hosted Checkout
   * URL the client redirects to. `{ enabled: false }` when Stripe isn't
   * configured on this deploy.
   */
  @Post('checkout')
  @RequireRoles(...BILLING_ROLES)
  async checkout(
    @Request() req: any,
    @Body() body: { billingPeriod?: 'monthly' | 'annual' },
  ) {
    if (!this.stripe.enabled()) {
      return {
        enabled: false,
        message: 'Online payments are not set up on this deployment yet.',
      };
    }
    const period = body?.billingPeriod === 'annual' ? 'annual' : 'monthly';
    const base = this.billingUrl(req);
    try {
      const { url } = await this.stripe.checkoutForTenant({
        tenantId: req.user.tenantId,
        period,
        successUrl: `${base}?checkout=success`,
        cancelUrl: `${base}?checkout=cancelled`,
      });
      return { url };
    } catch (e) {
      throw new HttpException((e as Error).message, HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Open the Stripe Customer Portal — manage card, plan, cancellation,
   * past invoices. Returns `{ url }`, or `{ noSubscription: true }` if
   * the tenant has never subscribed.
   */
  @Post('portal')
  @RequireRoles(...BILLING_ROLES)
  async portal(@Request() req: any) {
    if (!this.stripe.enabled()) {
      return {
        enabled: false,
        message: 'Online payments are not set up on this deployment yet.',
      };
    }
    try {
      return await this.stripe.portalForTenant(req.user.tenantId, this.billingUrl(req));
    } catch (e) {
      throw new HttpException((e as Error).message, HttpStatus.BAD_GATEWAY);
    }
  }

  /** The tenant's invoice history (newest first). */
  @Get('invoices')
  @RequireRoles(...BILLING_ROLES)
  async invoices(@Request() req: any) {
    // Self-healing backstop: each time the operator opens billing,
    // reconcile the Stripe subscription quantity with live screen
    // usage in case a pair/unpair sync was ever missed. Fire-and-
    // forget — it never blocks the invoice list.
    this.stripe.syncSubscriptionQuantity(req.user.tenantId).catch(() => {});
    const invoices = await this.stripe.invoicesForTenant(req.user.tenantId);
    return { stripeEnabled: this.stripe.enabled(), invoices };
  }

  /** Smoke-test — whether Stripe is configured on this deploy. */
  @Get('status')
  status() {
    return {
      stripeEnabled: this.stripe.enabled(),
      message: this.stripe.enabled()
        ? 'Stripe is configured — checkout, portal and invoices are live.'
        : 'Stripe is not configured. Set STRIPE_SECRET_KEY to enable billing.',
    };
  }

  /**
   * Free-tier status. No card required, and — importantly — **no
   * transaction is committed here**: the free pilot tier is the
   * no-License *default* state, so there is nothing to "activate." This
   * endpoint is informational; it reports the tenant's real effective
   * tier + seat limit straight from LicenseService rather than the old
   * hardcoded `trialDays:14, seatLimit:3` placeholders, which wrote
   * nothing yet *looked* like a committed trial (§11 audit, 2026-05-30).
   *
   * When the real trial-to-paid Setup-Intent flow lands it can live in a
   * dedicated `POST /billing/start-trial` that actually upserts a License
   * row; this method intentionally stays a read-only status probe.
   */
  @Post('activate-trial')
  @RequireRoles(...BILLING_ROLES)
  async activateTrial(@Request() req: any) {
    const eff = await this.license.getEffective(req.user.tenantId);
    return {
      ok: true,
      // Honest: nothing was persisted. The free tier is already in effect
      // by default, so there's no row to create on "activate".
      committed: false,
      tier: eff.tier,
      seatLimit: eff.seatLimit,
      isPilot: eff.isPilot,
      // null expiry = perpetual (the pilot/free tier doesn't expire).
      expiresAt: eff.expiresAt,
      message: eff.isPilot
        ? `You're already on the free ${eff.tier} tier — pair up to ${eff.seatLimit} screen(s) with no card. ` +
          'Pick a paid plan above whenever you are ready.'
        : `Your tenant is on the ${eff.tier} plan (${eff.seatLimit} seats). Manage it via the Customer Portal above.`,
    };
  }
}
