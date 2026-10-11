import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AiModule } from '../ai/ai.module';
import { EmailModule } from '../email/email.module';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing-webhook.controller';
import { BillingReadOnlyGate, BillingReadOnlyInterceptor } from './billing-gate.interceptor';
import { LicenseReconcileCron } from './license-reconcile.cron';
import { StripeService } from './stripe.service';
import { TrialReminderCron } from './trial-reminder.cron';

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
 *
 * 2026-09-23 — imports AiModule for AiAllowanceService (AI board packs: the organisation, whether a
 * pack may be bought, each pack's balance). One-way: AiModule never imports BillingModule.
 *
 * 2026-10-11 — SELF-SERVE TRIAL → PAID (trial-policy.ts): TrialReminderCron
 * (7-day / 1-day / ended emails, leader-leased) and the global
 * BillingReadOnlyInterceptor (an expired trial past its grace, or a cancelled
 * card plan, is view-only for PEOPLE — never for screens, never for
 * emergency). APP_INTERCEPTOR may be provided by any module; it runs after
 * each route's guards, so it sees the verified principal.
 */
@Module({
  imports: [AiModule, EmailModule],
  controllers: [BillingController, BillingWebhookController],
  providers: [
    StripeService,
    LicenseReconcileCron,
    TrialReminderCron,
    BillingReadOnlyGate,
    { provide: APP_INTERCEPTOR, useClass: BillingReadOnlyInterceptor },
  ],
  exports: [StripeService, BillingReadOnlyGate],
})
export class BillingModule {}
