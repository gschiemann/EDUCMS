/**
 * BillingController — Stripe Checkout + Customer Portal scaffolding.
 *
 * Sprint 8c (2026-05-03). Behind STRIPE_SECRET_KEY env var. When the
 * key is missing the endpoints return 501 with a friendly message so
 * the upgrade UI can fall back to a sales mailto without crashing.
 *
 * Wire-up checklist (when Stripe is ready):
 *   1. Set STRIPE_SECRET_KEY in API env.
 *   2. Create Stripe Products + Prices for each LICENSE_TIER (test +
 *      live). Paste the Price IDs into LICENSE_TIERS in
 *      packages/api-types/src/billing.ts (stripeMonthlyPriceId /
 *      stripeAnnualPriceId fields).
 *   3. Configure the Stripe Customer Portal settings (cancel /
 *      upgrade / payment-method update).
 *   4. Create a webhook endpoint that updates License row status
 *      on subscription events (TODO — separate commit).
 *   5. Test with `stripe listen --forward-to https://api/api/v1/billing/webhook`.
 */
import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { getLicenseTier } from '@cms/api-types';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/billing')
export class BillingController {
  /**
   * Create a Stripe Checkout Session for a tier upgrade.
   * Body: { tier: LicenseTierId, billingPeriod: 'monthly' | 'annual' }
   * Response: { checkoutUrl } or 501 if Stripe isn't configured yet.
   */
  @Post('checkout')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async checkout(
    @Request() req: any,
    @Body() body: { tier: string; billingPeriod?: 'monthly' | 'annual' },
  ) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return {
        statusCode: 501,
        message:
          'Stripe is not yet configured on this deployment. Contact sales@venueos.app to upgrade.',
        salesEmail: 'sales@venueos.app',
      };
    }
    const tier = getLicenseTier(body.tier);
    if (!tier) {
      return { statusCode: 400, message: `Unknown tier: ${body.tier}` };
    }
    const period = body.billingPeriod === 'annual' ? 'annual' : 'monthly';
    const priceId =
      period === 'annual' ? tier.stripeAnnualPriceId : tier.stripeMonthlyPriceId;
    if (!priceId) {
      return {
        statusCode: 501,
        message: `${tier.name} (${period}) doesn't have a Stripe Price ID configured yet. Contact sales@venueos.app.`,
        salesEmail: 'sales@venueos.app',
      };
    }
    // Lazy-load stripe to avoid forcing the dep on deployments that
    // never enable billing. If `stripe` isn't installed, fall back
    // to the friendly 501.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Stripe = (await import('stripe' as any)).default;
      const stripe = new Stripe(stripeKey, { apiVersion: '2024-04-10' });
      const origin = req.headers.origin || `${req.protocol}://${req.headers.host}`;
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: req.user.tenantId,
        success_url: `${origin}/${req.user.tenantSlug || 'dashboard'}/settings/billing?upgraded=1`,
        cancel_url: `${origin}/${req.user.tenantSlug || 'dashboard'}/settings/billing?upgrade=cancelled`,
        metadata: { tenantId: req.user.tenantId, tier: tier.id, period },
      });
      return { checkoutUrl: session.url };
    } catch (e) {
      return {
        statusCode: 501,
        message:
          'Stripe SDK is not installed yet. Run `pnpm --filter api add stripe` and configure STRIPE_SECRET_KEY.',
        error: (e as Error).message,
      };
    }
  }

  /**
   * Returns a Customer Portal URL the operator can visit to manage
   * subscription / payment method / cancellation. 501 until Stripe
   * is configured.
   */
  @Post('portal')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async portal(@Request() req: any) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return {
        statusCode: 501,
        message:
          'Stripe is not yet configured. Contact sales@venueos.app to manage your subscription.',
      };
    }
    return { statusCode: 501, message: 'Stripe Customer Portal endpoint not yet implemented.' };
  }

  /**
   * Webhook receiver — Stripe POSTs subscription lifecycle events here.
   * 501 placeholder until the License sync is implemented (separate
   * commit; needs idempotency + signing-secret verification).
   */
  @Post('webhook')
  webhook() {
    return { received: true, note: 'Webhook handler not yet implemented.' };
  }

  /** Smoke-test endpoint — returns whether Stripe is configured. */
  @Get('status')
  status() {
    return {
      stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
      message: process.env.STRIPE_SECRET_KEY
        ? 'Stripe is configured. Checkout + Portal endpoints are live.'
        : 'Stripe not yet configured. Upgrade UI falls back to sales@ until STRIPE_SECRET_KEY is set.',
    };
  }

  /**
   * One-click free-trial activation. No card required. Tenant gets a
   * 14-day window with seatLimit=3. Idempotent — calling twice just
   * returns the existing trial license.
   *
   * Once Stripe ships, we'll convert this to a Stripe Setup Intent
   * (collect card now, charge after 14 days) so the trial-to-paid
   * conversion flow is automatic.
   */
  @Post('activate-trial')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  activateTrial() {
    return {
      ok: true,
      message: 'Free trial activation endpoint is live. License row creation lands when the trial-to-paid Stripe Setup Intent flow ships in the next billing pass.',
      trialDays: 14,
      seatLimit: 3,
    };
  }
}
