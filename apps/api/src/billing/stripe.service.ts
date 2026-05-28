/**
 * StripeService — the one place the Stripe SDK is touched.
 *
 * Stripe is OPTIONAL on any given deploy. Everything keys off
 * STRIPE_SECRET_KEY: when it is unset, `enabled()` is false and every
 * method degrades gracefully (checkout/portal report "not configured",
 * invoices return []), so a deployment with no billing — like the live
 * pilot — is completely unaffected.
 *
 * Card entry happens entirely on Stripe's hosted Checkout + Customer
 * Portal — a card number never reaches our servers (PCI-SAQ-A).
 *
 * Env vars (all set by the operator from their Stripe dashboard —
 * test keys first, live keys at go-live):
 *   STRIPE_SECRET_KEY      sk_test_… / sk_live_…
 *   STRIPE_PRICE_MONTHLY   the $15/screen/mo recurring Price id
 *   STRIPE_PRICE_ANNUAL    the $150/screen/yr recurring Price id
 *   STRIPE_WEBHOOK_SECRET  whsec_…  (used by the webhook controller)
 */
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

/** The Stripe SDK client instance type. `Stripe` is a value + a merged
 *  namespace, so the instance type must be taken via InstanceType. */
type StripeClient = InstanceType<typeof Stripe>;

/** A billing invoice, flattened for the dashboard. */
export interface BillingInvoice {
  id: string;
  number: string | null;
  status: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  created: number; // epoch seconds
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

/** The slice of a Stripe webhook event this service consumes. The full
 *  payload's authenticity is verified by signature in
 *  constructWebhookEvent; the handler then only reads `type` and the
 *  well-known fields of `data.object`.
 *
 *  `id` and `created` were added on the 2026-05-26 P0-7 audit fix:
 *    - `id` (evt_*) keys the idempotency ledger (processed_stripe_events)
 *      so a Stripe retry of the same event is a 200 no-op.
 *    - `created` (UNIX seconds) is compared against the License's
 *      `stripeLastEventCreatedAt` so a stale, out-of-order subscription
 *      update can't flip status back from PAST_DUE → ACTIVE. */
export interface StripeWebhookEvent {
  id: string;
  type: string;
  created: number; // UNIX seconds, when Stripe minted the event
  data: { object: Record<string, any> };
}

/** Webhook handler result. `duplicate: true` means the event id was
 *  already processed — caller still returns 200 (Stripe must not retry)
 *  but logs / observability can distinguish replays from new work. */
export interface WebhookHandlerResult {
  duplicate?: boolean;
  staleOutOfOrder?: boolean;
  noTenantId?: boolean;
}

/** Outcome of a `syncSubscriptionQuantity` call.
 *
 *  `status` tells the caller what happened so the daily reconcile cron
 *  can decide whether to write a `LICENSE_RECONCILED` audit row (only on
 *  an actual `corrected` drift). The event-driven pair/unpair/delete
 *  callers ignore this return value entirely — they keep firing it
 *  `.catch(() => {})` and never await, so this richer return is purely
 *  additive and changes nothing for them. */
export interface SyncQuantityResult {
  /** `corrected`  → Stripe quantity differed from live seats; we updated it.
   *  `in-sync`    → quantity already matched; no Stripe write.
   *  `skipped`    → not applicable (no Stripe, no card sub, PO/INVOICE,
   *                 cancelled, or subscription not retrievable). */
  status: 'corrected' | 'in-sync' | 'skipped';
  /** Reason, when `skipped`. */
  reason?:
    | 'stripe-disabled'
    | 'no-subscription'
    | 'non-card-billing'
    | 'cancelled'
    | 'subscription-unretrievable'
    | 'no-subscription-item';
  /** Stripe subscription-item quantity before the sync (when known). */
  from?: number;
  /** Live paired-screen count we synced to (when known). */
  to?: number;
}

/** A paid per-screen subscription has no hard seat cap — the tenant
 *  pays for whatever they pair. Set the License seatLimit far above
 *  any real fleet so seat enforcement never blocks a paying tenant.
 *  (Keeping the subscription quantity in lockstep with live usage —
 *  auto-prorate on add/remove — is a tracked follow-up.) */
const PAID_SEAT_LIMIT = 100_000;

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private client: StripeClient | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** True only when STRIPE_SECRET_KEY is set — i.e. billing is live. */
  enabled(): boolean {
    return !!process.env.STRIPE_SECRET_KEY;
  }

  /** Lazily build the Stripe client; null when the deploy has no key. */
  getClient(): StripeClient | null {
    if (this.client) return this.client;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    this.client = new Stripe(key);
    return this.client;
  }

  /** The Stripe Price id for a billing period — from env, never hard-
   *  coded, so test keys pair with test prices and live with live. */
  private priceIdFor(period: 'monthly' | 'annual'): string | null {
    return (
      (period === 'annual'
        ? process.env.STRIPE_PRICE_ANNUAL
        : process.env.STRIPE_PRICE_MONTHLY) || null
    );
  }

  /** Paired-screen count — the per-screen subscription quantity.
   *  Mirrors LicenseService.usedSeats. */
  private async seatCount(tenantId: string): Promise<number> {
    return this.prisma.client.screen.count({
      where: { tenantId, pairedAt: { not: null } },
    });
  }

  /**
   * Re-sync a tenant's Stripe subscription quantity to its live
   * paired-screen count. Stripe prorates the change automatically, so
   * the bill always tracks real usage — add a screen, the next
   * invoice reflects it; unpair one, a proration credit lands.
   *
   * Best-effort and idempotent. It is a NO-OP when:
   *   - Stripe is unconfigured on this deploy,
   *   - the tenant has no card subscription yet,
   *   - the License is INVOICE / PURCHASE_ORDER billed (those are a
   *     contracted seat count — never auto-adjusted),
   *   - the subscription is cancelled,
   *   - the quantity already matches (no Stripe write at all).
   *
   * Callers fire this AFTER a screen is paired / unpaired / deleted
   * and MUST NOT await it — a Stripe hiccup can never block pairing.
   *
   * Returns a `SyncQuantityResult` so the daily reconcile cron can
   * distinguish a real drift correction from a no-op. Event-driven
   * callers ignore the return value (they fire-and-forget), so the
   * richer return type is purely additive.
   */
  async syncSubscriptionQuantity(tenantId: string): Promise<SyncQuantityResult> {
    const stripe = this.getClient();
    if (!stripe) return { status: 'skipped', reason: 'stripe-disabled' };
    const license = await this.prisma.client.license.findUnique({ where: { tenantId } });
    if (!license?.stripeSubscriptionId) {
      return { status: 'skipped', reason: 'no-subscription' };
    }
    // Invoice / PO tenants are billed on a contracted seat count — the
    // operator tops them up by hand; never auto-adjust their plan.
    if (license.billingMode && license.billingMode !== 'CARD') {
      return { status: 'skipped', reason: 'non-card-billing' };
    }
    if (license.status === 'CANCELLED') {
      return { status: 'skipped', reason: 'cancelled' };
    }

    let sub: Record<string, any>;
    try {
      sub = await stripe.subscriptions.retrieve(license.stripeSubscriptionId);
    } catch (e) {
      this.logger.warn(
        `quantity sync skipped: subscription ${license.stripeSubscriptionId} ` +
          `not retrievable — ${(e as Error).message}`,
      );
      return { status: 'skipped', reason: 'subscription-unretrievable' };
    }
    const item = sub.items?.data?.[0];
    if (!item?.id) return { status: 'skipped', reason: 'no-subscription-item' };
    const quantity = Math.max(1, await this.seatCount(tenantId));
    const current: number = item.quantity ?? 0;
    if (current === quantity) {
      return { status: 'in-sync', from: current, to: quantity }; // already in lockstep
    }

    await stripe.subscriptionItems.update(item.id, {
      quantity,
      proration_behavior: 'create_prorations',
    });
    this.logger.log(
      `billing: tenant ${tenantId} subscription quantity ${current} → ${quantity}`,
    );
    return { status: 'corrected', from: current, to: quantity };
  }

  /**
   * Create a Stripe-hosted Checkout Session for a per-screen
   * subscription. Quantity = the tenant's current paired-screen count.
   * Reuses the existing Stripe customer if the License row already
   * has one, so a re-subscribe never spawns a duplicate customer.
   */
  async checkoutForTenant(opts: {
    tenantId: string;
    period: 'monthly' | 'annual';
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    const stripe = this.getClient();
    if (!stripe) throw new Error('Stripe is not configured on this deployment.');
    const price = this.priceIdFor(opts.period);
    if (!price) {
      throw new Error(
        `No Stripe Price id configured for the ${opts.period} plan — ` +
          `set STRIPE_PRICE_${opts.period.toUpperCase()}.`,
      );
    }
    const license = await this.prisma.client.license.findUnique({
      where: { tenantId: opts.tenantId },
    });
    const quantity = Math.max(1, await this.seatCount(opts.tenantId));
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity }],
      client_reference_id: opts.tenantId,
      ...(license?.stripeCustomerId ? { customer: license.stripeCustomerId } : {}),
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      metadata: { tenantId: opts.tenantId, period: opts.period },
      subscription_data: { metadata: { tenantId: opts.tenantId, period: opts.period } },
      allow_promotion_codes: true,
    });
    if (!session.url) throw new Error('Stripe did not return a Checkout URL.');
    return { url: session.url };
  }

  /**
   * Create a Customer Portal session — the tenant manages their card,
   * plan, cancellation and downloads past invoices, all on Stripe's
   * hosted portal. Returns { noSubscription: true } if the tenant has
   * never checked out (no Stripe customer yet).
   */
  async portalForTenant(
    tenantId: string,
    returnUrl: string,
  ): Promise<{ url: string } | { noSubscription: true }> {
    const stripe = this.getClient();
    if (!stripe) throw new Error('Stripe is not configured on this deployment.');
    const license = await this.prisma.client.license.findUnique({ where: { tenantId } });
    if (!license?.stripeCustomerId) return { noSubscription: true };
    const session = await stripe.billingPortal.sessions.create({
      customer: license.stripeCustomerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  /** The tenant's invoices, newest first. Empty when Stripe is off or
   *  the tenant has no Stripe customer yet. */
  async invoicesForTenant(tenantId: string): Promise<BillingInvoice[]> {
    const stripe = this.getClient();
    if (!stripe) return [];
    const license = await this.prisma.client.license.findUnique({ where: { tenantId } });
    if (!license?.stripeCustomerId) return [];
    const res = await stripe.invoices.list({ customer: license.stripeCustomerId, limit: 24 });
    return res.data.map((inv) => ({
      id: inv.id ?? '',
      number: inv.number ?? null,
      status: inv.status ?? null,
      amountDueCents: inv.amount_due ?? 0,
      amountPaidCents: inv.amount_paid ?? 0,
      currency: (inv.currency || 'usd').toUpperCase(),
      created: inv.created ?? 0,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
    }));
  }

  // ── webhook ───────────────────────────────────────────────────

  /**
   * Verify a Stripe webhook's signature and return the typed event.
   * Throws when STRIPE_WEBHOOK_SECRET is unset or the signature fails —
   * the caller maps that to a 400 (never retryable).
   */
  constructWebhookEvent(rawBody: Buffer, signature: string): StripeWebhookEvent {
    const stripe = this.getClient();
    if (!stripe) throw new Error('Stripe is not configured on this deployment.');
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set.');
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  }

  /**
   * Apply a verified webhook event to the tenant's License row.
   * Unhandled event types are a no-op (acknowledged with 200). A DB
   * failure bubbles so the caller returns 500 and Stripe retries.
   *
   * 2026-05-26 P0-7 audit hardening:
   *   1. IDEMPOTENCY — every handler entry inserts the event.id into
   *      `processed_stripe_events`. Stripe retries on any 5xx and may
   *      re-deliver the same event; a unique-key collision (P2002) here
   *      means we've already done the work, so we ack and return without
   *      side effects. This is the standard Stripe-recommended pattern.
   *      https://docs.stripe.com/webhooks#handle-duplicate-events
   *   2. OUT-OF-ORDER PROTECTION — Stripe does NOT guarantee event
   *      ordering. A stale `customer.subscription.updated` (status=active)
   *      can land AFTER an `invoice.payment_failed` (status=past_due)
   *      and undo the past-due state. License-mutating handlers compare
   *      `event.created` against `License.stripeLastEventCreatedAt` and
   *      skip when the incoming event is older.
   *   3. AUDIT LOG — every License mutation now writes an AuditLog row
   *      in the same $transaction. SUPER_ADMIN gets a forensic trail of
   *      every webhook-driven status / tier change.
   */
  async handleWebhookEvent(event: StripeWebhookEvent): Promise<WebhookHandlerResult> {
    const stripe = this.getClient();
    if (!stripe) return {};

    // ── Idempotency gate ─────────────────────────────────────────
    // INSERT-first dedup: the unique primary key on event.id makes
    // this atomic at the database — no race between two pods
    // processing concurrent retries.
    try {
      await this.prisma.client.processedStripeEvent.create({
        data: { id: event.id, type: event.type },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        this.logger.log(
          `webhook: duplicate event ${event.id} (${event.type}) — already processed, acked`,
        );
        return { duplicate: true };
      }
      throw e;
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          return await this.syncLicenseFromSubscription(
            sub,
            event,
            session.client_reference_id || session.metadata?.tenantId || null,
          );
        }
        return {};
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        return await this.syncLicenseFromSubscription(event.data.object, event);
      }
      case 'customer.subscription.deleted': {
        return await this.applySubscriptionDeleted(event);
      }
      case 'invoice.payment_failed': {
        return await this.applyPaymentFailed(event);
      }
      default:
        this.logger.debug(`webhook: ignoring ${event.type}`);
        return {};
    }
  }

  /** Map a Stripe subscription status onto the License status enum. */
  private mapSubscriptionStatus(s: string): string {
    if (s === 'active' || s === 'trialing') return 'ACTIVE';
    if (s === 'past_due' || s === 'incomplete') return 'PAST_DUE';
    if (s === 'unpaid' || s === 'paused') return 'SUSPENDED';
    if (s === 'canceled' || s === 'incomplete_expired') return 'CANCELLED';
    return 'ACTIVE';
  }

  /** AuditLog action name for a Stripe-driven mutation, e.g.
   *  `customer.subscription.updated` → `STRIPE_WEBHOOK_CUSTOMER_SUBSCRIPTION_UPDATED`.
   *  Mirrors the SUPER_ADMIN-visible audit pattern used by
   *  super-license.controller.ts so the /audit page renders consistently. */
  private auditActionFor(eventType: string): string {
    return 'STRIPE_WEBHOOK_' + eventType.toUpperCase().replace(/\./g, '_');
  }

  /**
   * Upsert the License row from a Stripe subscription — the single
   * place a subscription's state becomes license state.
   *
   * 2026-05-26 P0-7 audit hardening:
   *   - Tenant fallback by `stripeCustomerId` when `metadata.tenantId`
   *     is absent. Customer Portal-driven changes don't always
   *     propagate the original Checkout `subscription_data.metadata`
   *     onto every event payload — without this fallback, portal
   *     plan changes silently fail to sync and the License row goes
   *     stale forever.
   *   - Out-of-order rejection. If `event.created` is older than
   *     the License's stored `stripeLastEventCreatedAt`, we skip:
   *     a stale ACTIVE update can't undo a fresher PAST_DUE.
   *   - AuditLog row written in the same $transaction as the upsert.
   */
  private async syncLicenseFromSubscription(
    sub: Record<string, any>,
    event: StripeWebhookEvent,
    fallbackTenantId?: string | null,
  ): Promise<WebhookHandlerResult> {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    let tenantId: string | null =
      sub.metadata?.tenantId || fallbackTenantId || null;

    // Fallback for Customer Portal-driven events that arrive without
    // the original Checkout `subscription_data.metadata`. We look the
    // License up by stripeCustomerId (which we DID record at Checkout
    // time) and reuse its tenantId. Warn-log so this is visible in
    // observability — it should be rare except for portal flows.
    if (!tenantId && customerId) {
      const existing = await this.prisma.client.license.findFirst({
        where: { stripeCustomerId: customerId },
        select: { tenantId: true },
      });
      if (existing?.tenantId) {
        tenantId = existing.tenantId;
        this.logger.warn(
          `webhook: subscription ${sub.id} carried no metadata.tenantId — ` +
            `recovered tenant ${tenantId} via stripeCustomerId=${customerId}`,
        );
      }
    }

    if (!tenantId) {
      this.logger.warn(
        `webhook: subscription ${sub.id} carries no tenantId and no License ` +
          `row matches stripeCustomerId=${customerId ?? 'unknown'} — skipped`,
      );
      return { noTenantId: true };
    }
    const price = sub.items?.data?.[0]?.price;
    const interval = price?.recurring?.interval;
    const unit = price?.unit_amount ?? null;
    const tier = interval === 'year' ? 'ANNUAL' : 'MONTHLY';
    const monthlyPriceCents =
      unit == null ? null : interval === 'year' ? Math.round(unit / 12) : unit;
    const status = this.mapSubscriptionStatus(sub.status);
    const periodStart = sub.current_period_start
      ? new Date(sub.current_period_start * 1000)
      : null;
    const periodEnd = sub.current_period_end
      ? new Date(sub.current_period_end * 1000)
      : null;
    const eventCreatedAt = new Date(event.created * 1000);

    // Out-of-order protection. Read the current License (if any) and
    // refuse to apply a state-flipping event older than the most-recent
    // one we already processed. `eventCreated == stored` is allowed —
    // duplicate event ids are already rejected upstream by the
    // idempotency ledger, so an equal timestamp here only happens
    // when two events were minted within the same second (Stripe's
    // resolution); applying both is fine.
    const existing = await this.prisma.client.license.findUnique({
      where: { tenantId },
      select: {
        id: true,
        status: true,
        tier: true,
        stripeLastEventCreatedAt: true,
      },
    });
    if (
      existing?.stripeLastEventCreatedAt &&
      existing.stripeLastEventCreatedAt.getTime() > eventCreatedAt.getTime()
    ) {
      this.logger.warn(
        `webhook: event ${event.id} (${event.type}) for tenant ${tenantId} ` +
          `created ${eventCreatedAt.toISOString()} is older than last-applied ` +
          `${existing.stripeLastEventCreatedAt.toISOString()} — skipped (out-of-order)`,
      );
      return { staleOutOfOrder: true };
    }

    const fromStatus = existing?.status ?? null;
    const fromTier = existing?.tier ?? null;

    await this.prisma.client.$transaction(async (tx) => {
      const license = await tx.license.upsert({
        where: { tenantId: tenantId! },
        create: {
          tenantId: tenantId!,
          tier,
          billingMode: 'CARD',
          status,
          seatLimit: PAID_SEAT_LIMIT,
          monthlyPriceCents,
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          stripeLastEventCreatedAt: eventCreatedAt,
        },
        update: {
          tier,
          billingMode: 'CARD',
          status,
          monthlyPriceCents,
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          stripeLastEventCreatedAt: eventCreatedAt,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: tenantId!,
          userId: null,
          action: this.auditActionFor(event.type),
          targetType: 'License',
          targetId: license.id,
          details: JSON.stringify({
            eventId: event.id,
            eventType: event.type,
            eventCreated: event.created,
            subscriptionId: sub.id,
            stripeCustomerId: customerId,
            fromStatus,
            toStatus: status,
            fromTier,
            toTier: tier,
            monthlyPriceCents,
          }),
        },
      });
    });
    this.logger.log(
      `webhook: License synced for tenant ${tenantId} → ${tier} / ${status} ` +
        `(event ${event.id})`,
    );
    return {};
  }

  /**
   * `customer.subscription.deleted` handler.
   *
   * 2026-05-26 P0-7 audit: was `updateMany` + log line, no audit row,
   * no out-of-order protection. Now matches the License row by
   * stripeSubscriptionId (still a single row in practice — the column
   * isn't unique in schema but Stripe guarantees one subscription per
   * License), respects out-of-order ordering, and writes an AuditLog
   * row in the same $transaction.
   */
  private async applySubscriptionDeleted(
    event: StripeWebhookEvent,
  ): Promise<WebhookHandlerResult> {
    const sub = event.data.object;
    const license = await this.prisma.client.license.findFirst({
      where: { stripeSubscriptionId: sub.id as string },
    });
    if (!license) {
      this.logger.log(
        `webhook: subscription ${sub.id} cancelled — no matching License row`,
      );
      return { noTenantId: true };
    }
    const eventCreatedAt = new Date(event.created * 1000);
    if (
      license.stripeLastEventCreatedAt &&
      license.stripeLastEventCreatedAt.getTime() > eventCreatedAt.getTime()
    ) {
      this.logger.warn(
        `webhook: event ${event.id} (${event.type}) for License ${license.id} ` +
          `created ${eventCreatedAt.toISOString()} is older than last-applied ` +
          `${license.stripeLastEventCreatedAt.toISOString()} — skipped (out-of-order)`,
      );
      return { staleOutOfOrder: true };
    }
    const fromStatus = license.status;
    await this.prisma.client.$transaction(async (tx) => {
      await tx.license.update({
        where: { id: license.id },
        data: {
          status: 'CANCELLED',
          stripeLastEventCreatedAt: eventCreatedAt,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: license.tenantId,
          userId: null,
          action: this.auditActionFor(event.type),
          targetType: 'License',
          targetId: license.id,
          details: JSON.stringify({
            eventId: event.id,
            eventType: event.type,
            eventCreated: event.created,
            subscriptionId: sub.id,
            stripeCustomerId: license.stripeCustomerId,
            fromStatus,
            toStatus: 'CANCELLED',
            fromTier: license.tier,
            toTier: license.tier,
          }),
        },
      });
    });
    this.logger.log(
      `webhook: subscription ${sub.id} cancelled for tenant ${license.tenantId} ` +
        `(event ${event.id})`,
    );
    return {};
  }

  /**
   * `invoice.payment_failed` handler.
   *
   * 2026-05-26 P0-7 audit: was `updateMany` keyed on stripeCustomerId
   * with no audit + no out-of-order protection. Re-shaped here to
   * (a) refuse to overwrite a fresher event's state and (b) leave an
   * AuditLog row so the operator can answer "why did this tenant
   * get downgraded to PAST_DUE Tuesday?".
   */
  private async applyPaymentFailed(
    event: StripeWebhookEvent,
  ): Promise<WebhookHandlerResult> {
    const inv = event.data.object;
    const customerId =
      typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
    if (!customerId) {
      this.logger.warn(
        `webhook: invoice ${inv.id} payment_failed but no customer id — skipped`,
      );
      return { noTenantId: true };
    }
    const license = await this.prisma.client.license.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!license) {
      this.logger.warn(
        `webhook: payment failed for customer ${customerId} but no License row matches`,
      );
      return { noTenantId: true };
    }
    const eventCreatedAt = new Date(event.created * 1000);
    if (
      license.stripeLastEventCreatedAt &&
      license.stripeLastEventCreatedAt.getTime() > eventCreatedAt.getTime()
    ) {
      this.logger.warn(
        `webhook: event ${event.id} (${event.type}) for License ${license.id} ` +
          `created ${eventCreatedAt.toISOString()} is older than last-applied ` +
          `${license.stripeLastEventCreatedAt.toISOString()} — skipped (out-of-order)`,
      );
      return { staleOutOfOrder: true };
    }
    const fromStatus = license.status;
    await this.prisma.client.$transaction(async (tx) => {
      await tx.license.update({
        where: { id: license.id },
        data: {
          status: 'PAST_DUE',
          stripeLastEventCreatedAt: eventCreatedAt,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: license.tenantId,
          userId: null,
          action: this.auditActionFor(event.type),
          targetType: 'License',
          targetId: license.id,
          details: JSON.stringify({
            eventId: event.id,
            eventType: event.type,
            eventCreated: event.created,
            invoiceId: inv.id,
            stripeCustomerId: customerId,
            fromStatus,
            toStatus: 'PAST_DUE',
            fromTier: license.tier,
            toTier: license.tier,
          }),
        },
      });
    });
    this.logger.warn(
      `webhook: payment failed for customer ${customerId} → tenant ` +
        `${license.tenantId} PAST_DUE (event ${event.id})`,
    );
    return {};
  }
}
