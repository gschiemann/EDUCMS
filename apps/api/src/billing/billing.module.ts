import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing-webhook.controller';
import { StripeService } from './stripe.service';

/**
 * BillingModule — Stripe Checkout, Customer Portal, invoices, webhook.
 *
 * Everything is gated on STRIPE_SECRET_KEY (StripeService.enabled()),
 * so a deploy with no billing configured is unaffected. The webhook
 * is its own unauthenticated controller — Stripe calls it with no JWT.
 */
@Module({
  controllers: [BillingController, BillingWebhookController],
  providers: [StripeService],
  exports: [StripeService],
})
export class BillingModule {}
