import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing-webhook.controller';
import { LicenseReconcileCron } from './license-reconcile.cron';
import { StripeService } from './stripe.service';

/**
 * BillingModule — Stripe Checkout, Customer Portal, invoices, webhook.
 *
 * Everything is gated on STRIPE_SECRET_KEY (StripeService.enabled()),
 * so a deploy with no billing configured is unaffected. The webhook
 * is its own unauthenticated controller — Stripe calls it with no JWT.
 *
 * LicenseReconcileCron runs as a background service (process-internal
 * interval, no @nestjs/schedule dep) — the daily safety net that
 * re-syncs any Stripe-quantity↔seat-count drift the event-driven
 * pair/unpair/delete sync may have silently missed (P1-5 audit fix).
 */
@Module({
  controllers: [BillingController, BillingWebhookController],
  providers: [StripeService, LicenseReconcileCron],
  exports: [StripeService],
})
export class BillingModule {}
