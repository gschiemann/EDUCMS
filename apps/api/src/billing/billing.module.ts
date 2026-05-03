import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';

/**
 * BillingModule — Sprint 8c. Stripe Checkout + Customer Portal
 * scaffolding. Behind STRIPE_SECRET_KEY env var (501 fallback when
 * unset).
 */
@Module({
  controllers: [BillingController],
})
export class BillingModule {}
