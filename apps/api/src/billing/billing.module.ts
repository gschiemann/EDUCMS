import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { StripeService } from './stripe.service';

/**
 * BillingModule — Stripe Checkout, Customer Portal, invoices.
 *
 * Everything is gated on STRIPE_SECRET_KEY (StripeService.enabled()),
 * so a deploy with no billing configured is unaffected. The Stripe
 * webhook is registered separately as an unauthenticated controller
 * (added in the webhook wave).
 */
@Module({
  controllers: [BillingController],
  providers: [StripeService],
  exports: [StripeService],
})
export class BillingModule {}
