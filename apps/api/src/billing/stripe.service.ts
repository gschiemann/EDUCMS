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
import { withDbRetry } from '../prisma/with-db-retry';
import {
  AI_BOARD_PACK_KIND,
  BOARD_PACK_VALID_MONTHS,
  addMonthsUtc,
  boardPackById,
  type AiBoardPack,
} from '../ai/ai-board-credits';

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
  /** A board-pack session that was already credited (the same session via another event). */
  alreadyCredited?: boolean;
  /** A board-pack session that completed before its payment did — credited on async success. */
  notPaid?: boolean;
  /** A board-pack session whose metadata cannot be credited (logged loudly — refund or credit by hand). */
  ignored?: boolean;
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
  }): Promise<{ url: string; existing?: boolean }> {
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

    // IDEMPOTENCY (2026-07-04): if the tenant already has a LIVE (non-cancelled)
    // subscription, do NOT create a second one. A duplicate Checkout would mint
    // a second Stripe subscription that double-bills the customer AND orphans
    // the first when the webhook overwrites the License's single
    // `stripeSubscriptionId`. Instead, send them to the Customer Portal to
    // manage the existing subscription (change plan / update card / cancel). A
    // CANCELLED license may freely re-subscribe (falls through to Checkout).
    if (
      license?.stripeSubscriptionId &&
      license.status &&
      license.status !== 'CANCELLED'
    ) {
      const portal = await this.portalForTenant(opts.tenantId, opts.successUrl);
      if ('url' in portal) {
        this.logger.warn(
          `checkout: tenant ${opts.tenantId} already has a ${license.status} ` +
            `subscription (${license.stripeSubscriptionId}) — routing to the ` +
            `Customer Portal instead of creating a duplicate`,
        );
        return { url: portal.url, existing: true };
      }
      // Portal unexpectedly unavailable (no stripeCustomerId) — fall through to
      // Checkout as a last resort rather than blocking the operator entirely.
    }

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
   * BOARD PACKS (2026-09-23) — a Stripe-hosted Checkout Session in `payment` mode for one pack of AI
   * board credits (ai-board-credits.ts). Inline `price_data`, so no Stripe dashboard product is
   * needed and the price comes from the one AI_BOARD_PACKS constant. Card only: a card payment is
   * complete when the session is, so the credit lands on `checkout.session.completed` (a delayed
   * method would complete unpaid and credit on `checkout.session.async_payment_succeeded`, which the
   * webhook also handles). Card entry happens on Stripe's page only.
   *
   * The metadata (on the session AND its PaymentIntent) is what the webhook credits from: the
   * organisation the boards are pooled under, the pack, and the boards/price it was sold at — so a
   * later change to the pack list never changes what this purchase bought.
   */
  async checkoutBoardPack(opts: {
    tenantId: string;
    orgTenantId: string;
    userId?: string | null;
    pack: AiBoardPack;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    const stripe = this.getClient();
    if (!stripe) throw new Error('Stripe is not configured on this deployment.');
    // Reuse a Stripe customer we already have (the buyer's, else its organisation's) so receipts and
    // the Customer Portal show the pack beside the plan. Optional — Checkout creates a guest otherwise.
    const license =
      (await this.prisma.client.license.findUnique({ where: { tenantId: opts.tenantId } })) ??
      (opts.orgTenantId !== opts.tenantId
        ? await this.prisma.client.license.findUnique({ where: { tenantId: opts.orgTenantId } })
        : null);
    const metadata: Record<string, string> = {
      kind: AI_BOARD_PACK_KIND,
      orgTenantId: opts.orgTenantId,
      tenantId: opts.tenantId,
      userId: opts.userId || '',
      pack: opts.pack.id,
      boards: String(opts.pack.boards),
      usdMicros: String(Math.round(opts.pack.usd * 1_000_000)),
    };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(opts.pack.usd * 100),
            product_data: {
              name: `${opts.pack.boards} AI board credits`,
              description: `VenueOS AI Designer — ${opts.pack.boards} boards, good for ${BOARD_PACK_VALID_MONTHS} months after purchase.`,
            },
          },
        },
      ],
      client_reference_id: opts.orgTenantId,
      ...(license?.stripeCustomerId ? { customer: license.stripeCustomerId } : {}),
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      metadata,
      payment_intent_data: { metadata },
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

    // ── BILL-01 (2026-08-04): release the claim if the work fails ──────
    //
    // The ledger row above is INSERTed and COMMITTED on its own connection
    // before any work happens. That is what makes the dedup atomic across
    // pods — but it also meant a throw anywhere below permanently ATE the
    // event: we 500, Stripe re-delivers the same event.id, the P2002 branch
    // sees the committed row and acks it as a duplicate with a silent 200.
    // The event is then gone forever, and the only trace is one log line.
    //
    // For billing that is not a wash. A dropped `customer.subscription.deleted`
    // leaves a cancelled tenant billed and licensed; a dropped
    // `invoice.payment_failed` leaves a delinquent tenant looking healthy.
    //
    // So on failure we best-effort DELETE the claim and rethrow. Stripe's
    // retry then finds no ledger row and does real work instead of being
    // swallowed.
    //
    // Safe to re-run, which is what makes this correct rather than merely
    // hopeful: every handler's writes live in a single $transaction (so a
    // failure leaves nothing half-applied), each is idempotent on replay
    // (upsert + `stripeLastEventCreatedAt` watermark in
    // syncLicenseFromSubscription, updateMany + watermark in
    // applySubscriptionDeleted, updateMany + advance-only watermark in
    // applyInvoicePaymentStatus), and no webhook handler writes back to
    // Stripe — so a replay cannot double-charge or double-cancel.
    //
    // If the compensating delete itself fails we are exactly where we were
    // before this change: strictly no worse, and it is logged.
    try {
      return await this.dispatchWebhookEvent(event, stripe);
    } catch (err) {
      try {
        await this.prisma.client.processedStripeEvent.delete({ where: { id: event.id } });
        this.logger.warn(
          `webhook: released idempotency claim for ${event.id} (${event.type}) after failure — Stripe will retry`,
        );
      } catch (delErr: any) {
        this.logger.error(
          `webhook: FAILED to release idempotency claim for ${event.id} (${event.type}) — ` +
          `this event will be acked as a duplicate on retry and LOST: ${delErr?.message}`,
        );
      }
      throw err;
    }
  }

  /**
   * The actual per-type webhook work. Split out of `handleWebhookEvent` so the
   * idempotency claim above can be released around it (BILL-01) without
   * wrapping the ledger INSERT itself — releasing on a P2002 would defeat the
   * dedup it exists for.
   */
  private async dispatchWebhookEvent(event: any, stripe: any): Promise<any> {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        // 2026-09-23 — a board-pack purchase (a one-off payment, never a subscription).
        if (session?.metadata?.kind === AI_BOARD_PACK_KIND) {
          return await this.creditBoardPack(session, event);
        }
        // Subscriptions complete synchronously; their async-success event has nothing for us.
        if (event.type !== 'checkout.session.completed') return {};
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
      case 'invoice.payment_failed':
      case 'invoice.payment_succeeded':
      case 'invoice.paid': {
        // All three ride the SAME ordering-immune, live-refetch path so that
        // (a) a decline can't be swallowed by a benign quantity-sync's
        // watermark and (b) a successful payment actually RECOVERS PAST_DUE →
        // ACTIVE (there was previously no success handler at all).
        return await this.applyInvoicePaymentStatus(event, stripe);
      }
      default:
        this.logger.debug(`webhook: ignoring ${event.type}`);
        return {};
    }
  }

  /**
   * Credit ONE paid board-pack Checkout Session to its organisation (2026-09-23).
   *
   * Idempotent twice over: the processed_stripe_events ledger already dedups the EVENT id, and the
   * purchase row's UNIQUE stripe_session_id dedups the SESSION — a Stripe re-delivery under a new
   * event id, or the same session arriving as both `completed` and `async_payment_succeeded`, lands
   * on P2002 and is acknowledged as already credited (never a 500, which would have Stripe retry a
   * success forever). The purchase row and its AuditLog row are one transaction.
   *
   * Never credits: an unpaid session (it credits on async success), a session that is not a
   * one-off payment, metadata that names no known pack / no organisation (logged loudly — the money
   * was taken, so a human refunds or credits it), or an organisation that no longer exists.
   */
  private async creditBoardPack(session: Record<string, any>, event: StripeWebhookEvent): Promise<WebhookHandlerResult> {
    const sessionId = typeof session.id === 'string' ? session.id : '';
    if (session.mode !== 'payment' || !sessionId) {
      this.logger.warn(`webhook: board-pack metadata on a ${session.mode} session ${sessionId || '(no id)'} — ignored`);
      return { ignored: true };
    }
    if (session.payment_status !== 'paid') {
      this.logger.log(
        `webhook: board-pack session ${sessionId} ${event.type} with payment_status=${session.payment_status} — credited once the payment succeeds`,
      );
      return { notPaid: true };
    }
    const md = (session.metadata || {}) as Record<string, string>;
    const pack = boardPackById(md.pack);
    const boards = Number(md.boards);
    const orgTenantId = typeof md.orgTenantId === 'string' ? md.orgTenantId : '';
    if (!pack || !orgTenantId || !Number.isInteger(boards) || boards <= 0 || boards > 100_000) {
      this.logger.error(
        `webhook: PAID board-pack session ${sessionId} carries unusable metadata (pack=${md.pack}, boards=${md.boards}, ` +
          `org=${orgTenantId || 'none'}) — NOT credited; refund or credit it by hand`,
      );
      return { ignored: true };
    }
    const org = await withDbRetry(() =>
      this.prisma.client.tenant.findUnique({ where: { id: orgTenantId }, select: { id: true } }),
    );
    if (!org) {
      this.logger.error(`webhook: PAID board-pack session ${sessionId} names organisation ${orgTenantId}, which does not exist — NOT credited; refund it`);
      return { noTenantId: true };
    }
    // What was actually charged (Stripe's amount_total, in cents) — the metadata's price is only the
    // fallback for a payload without it. Boards are credited as SOLD (the metadata), never from
    // today's pack list.
    const paidCents = Number.isInteger(session.amount_total)
      ? Number(session.amount_total)
      : Math.round((Number(md.usdMicros) || 0) / 10_000);
    const createdAt = new Date();
    const expiresAt = addMonthsUtc(createdAt, BOARD_PACK_VALID_MONTHS);
    const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
    try {
      await withDbRetry(
        () =>
          this.prisma.client.$transaction(async (tx) => {
            const row = await tx.aiCreditPurchase.create({
              data: { orgTenantId, stripeSessionId: sessionId, pack: pack.id, boards, usdMicros: paidCents * 10_000, createdAt, expiresAt },
            });
            await tx.auditLog.create({
              data: {
                tenantId: orgTenantId,
                userId: null,
                action: 'AI_BOARD_PACK_PURCHASED',
                targetType: 'AiCreditPurchase',
                targetId: row.id,
                details: JSON.stringify({
                  eventId: event.id,
                  eventType: event.type,
                  sessionId,
                  paymentIntent,
                  pack: pack.id,
                  boards,
                  amountPaidCents: paidCents,
                  currency: session.currency ?? null,
                  expiresAt: expiresAt.toISOString(),
                  purchaserTenantId: md.tenantId || null,
                  purchaserUserId: md.userId || null,
                }),
              },
            });
          }),
        { label: 'stripe.creditBoardPack' },
      );
    } catch (e: any) {
      if (e?.code === 'P2002') {
        this.logger.log(`webhook: board-pack session ${sessionId} already credited — ${event.type} ${event.id} acked`);
        return { alreadyCredited: true };
      }
      throw e;
    }
    this.logger.log(`webhook: ${boards} AI board credits (${pack.id}) credited to org ${orgTenantId} (session ${sessionId}, event ${event.id})`);
    return {};
  }

  /** Map a Stripe subscription status onto the License status enum. */
  private mapSubscriptionStatus(s: string): string {
    if (s === 'active' || s === 'trialing') return 'ACTIVE';
    if (s === 'past_due' || s === 'incomplete') return 'PAST_DUE';
    if (s === 'unpaid' || s === 'paused') return 'SUSPENDED';
    if (s === 'canceled' || s === 'incomplete_expired') return 'CANCELLED';
    return 'ACTIVE';
  }

  /**
   * Read the current billing period off a Stripe subscription.
   *
   * As of the pinned API version (`stripe` SDK 22.1.1 bakes in
   * `2026-04-22.dahlia`), `current_period_start` / `current_period_end`
   * no longer exist on the top-level `Subscription` object — Stripe
   * moved them to the SUBSCRIPTION ITEM level (each item can have its
   * own billing cycle since multi-price subscriptions can bill items
   * independently). VenueOS subscriptions are always single-price
   * (one recurring per-screen Price), so the first item's period is
   * the subscription's period. Guarded for an empty/missing items
   * array — returns nulls rather than throwing, matching the old
   * behavior when the fields were absent. */
  private subscriptionPeriod(sub: Record<string, any>): {
    start: Date | null;
    end: Date | null;
  } {
    const item = sub.items?.data?.[0];
    const start = item?.current_period_start;
    const end = item?.current_period_end;
    return {
      start: start ? new Date(start * 1000) : null,
      end: end ? new Date(end * 1000) : null,
    };
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
    // current_period_start/end moved off the top-level Subscription onto
    // each SubscriptionItem in the pinned API version — see
    // subscriptionPeriod() for why.
    const { start: periodStart, end: periodEnd } = this.subscriptionPeriod(sub);
    const eventCreatedAt = new Date(event.created * 1000);

    // Out-of-order protection. Read the current License (if any) and
    // refuse to apply a state-flipping event older than the most-recent
    // one we already processed. `eventCreated == stored` is allowed —
    // duplicate event ids are already rejected upstream by the
    // idempotency ledger, so an equal timestamp here only happens
    // when two events were minted within the same second (Stripe's
    // resolution); applying both is fine.
    // TOCTOU FIX (2026-07-04): the out-of-order freshness check must be ATOMIC
    // with the write. The watermark was previously read OUTSIDE the transaction,
    // so two concurrent events for the same tenant could both pass the check and
    // the older one commit last, silently corrupting License state. The read +
    // check + upsert now run in a single SERIALIZABLE transaction, retried on the
    // 40001/P2034 serialization conflict via withDbRetry (the exact pattern the
    // seat-claim tx uses in screens.controller.ts pair()).
    let staleOutOfOrder = false;
    await withDbRetry(
      () =>
        this.prisma.client.$transaction(
          async (tx) => {
            const existing = await tx.license.findUnique({
              where: { tenantId: tenantId! },
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
              staleOutOfOrder = true;
              return;
            }
            const fromStatus = existing?.status ?? null;
            const fromTier = existing?.tier ?? null;
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
          },
          { isolationLevel: 'Serializable', timeout: 20000, maxWait: 10000 },
        ),
      { label: 'stripe.syncLicenseFromSubscription' },
    );
    if (staleOutOfOrder) {
      this.logger.warn(
        `webhook: event ${event.id} (${event.type}) for tenant ${tenantId} ` +
          `created ${eventCreatedAt.toISOString()} is older than the last-applied ` +
          `watermark — skipped (out-of-order)`,
      );
      return { staleOutOfOrder: true };
    }
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
    // BILL-01 (2026-08-04) — retry the read too. `customer.subscription.deleted`
    // is TERMINAL: Stripe emits nothing after it, so unlike the other handlers
    // there is no later event to correct a miss. A transient pool blip here
    // used to surface as "no matching License row" and ack a cancellation that
    // never got applied, leaving a cancelled tenant billed and licensed.
    const license = await withDbRetry(() =>
      this.prisma.client.license.findFirst({
        where: { stripeSubscriptionId: sub.id as string },
      }),
    );
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
    // BILL-01 — mirror the invoice path (which already wraps its tx): this was
    // the last bare $transaction in the webhook handlers, and it belongs to the
    // one event type with no successor to fix it up.
    await withDbRetry(() =>
      this.prisma.client.$transaction(async (tx) => {
      await tx.license.updateMany({
        where: { id: license.id, tenantId: license.tenantId },
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
      }),
    );
    this.logger.log(
      `webhook: subscription ${sub.id} cancelled for tenant ${license.tenantId} ` +
        `(event ${event.id})`,
    );
    return {};
  }

  /**
   * Invoice payment-status handler — `invoice.payment_failed` /
   * `invoice.payment_succeeded` / `invoice.paid`.
   *
   * 2026-07-04 — ORDERING-IMMUNE rewrite (was `applyPaymentFailed`).
   *
   * The prior handler gated on the shared `License.stripeLastEventCreatedAt`
   * watermark, which EVERY benign `customer.subscription.updated` advances
   * (our own `syncSubscriptionQuantity` fires one on each screen pair/unpair).
   * Stripe does not guarantee cross-object event ordering and delivers out of
   * order, so a genuinely-newer-in-INTENT but older-in-TIMESTAMP
   * `invoice.payment_failed` was rejected as "stale" — the unpaid tenant was
   * NEVER downgraded and kept full paid service. And there was no
   * `payment_succeeded`/`paid` handler, so PAST_DUE never recovered via the
   * invoice path either.
   *
   * Fix: don't trust event ordering for payment status. Re-fetch the LIVE
   * subscription from Stripe and set `License.status` from its real current
   * status (`mapSubscriptionStatus`). This is ordering-immune — a stale or
   * late invoice event still resolves to the truth, and a payment that was
   * already recovered by the time we process a late failure correctly stays
   * ACTIVE. It needs NO schema change.
   *
   * Watermark asymmetry (the key correctness property): an invoice event NEVER
   * READ-gates on `stripeLastEventCreatedAt` (so a benign quantity-sync's
   * watermark can't block a decline), but it DOES ADVANCE it to max(current,
   * event.created). That forward-bump means a genuinely-stale (older-created)
   * `customer.subscription.updated` — delivered out of order after the payment
   * event — is still refused by the sub handler's watermark check and can't undo
   * the payment-driven status. Still writes the AuditLog row.
   */
  private async applyInvoicePaymentStatus(
    event: StripeWebhookEvent,
    stripe: StripeClient,
  ): Promise<WebhookHandlerResult> {
    const inv = event.data.object;
    const customerId =
      typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
    if (!customerId) {
      this.logger.warn(
        `webhook: invoice ${inv.id} ${event.type} but no customer id — skipped`,
      );
      return { noTenantId: true };
    }
    const license = await this.prisma.client.license.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!license) {
      this.logger.warn(
        `webhook: ${event.type} for customer ${customerId} but no License row matches`,
      );
      return { noTenantId: true };
    }

    // Ordering-immune status: read LIVE Stripe truth, not the (possibly stale /
    // out-of-order) event. Fall back to the event-implied status only when the
    // subscription can't be re-fetched — a real failure must never go unrecorded.
    // 2026-07-25 — VERSION-AGNOSTIC subscription id. `invoice.subscription` was
    // removed in the 2025-xx Stripe API versions (the SDK pins its own default;
    // we pin none), where it moved to
    // `invoice.parent.subscription_details.subscription`. Reading only the legacy
    // field silently yields undefined, which skips the LIVE status re-fetch below
    // and falls back to the event-implied status — exactly the ordering bug that
    // re-fetch exists to prevent. Read every known shape.
    const anyInv = inv as any;
    const pick = (v: unknown): string | undefined =>
      typeof v === 'string' ? v : (v as { id?: string } | null | undefined)?.id;
    const subId =
      pick(anyInv.subscription) ??
      pick(anyInv.parent?.subscription_details?.subscription) ??
      pick(anyInv.lines?.data?.find((l: any) => l?.subscription)?.subscription);
    let status: string | null = null;
    let liveStatusUsed = false;
    if (subId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        status = this.mapSubscriptionStatus(sub.status);
        liveStatusUsed = true;
      } catch (e: any) {
        this.logger.warn(
          `webhook: ${event.type} — could not re-fetch subscription ${subId} ` +
            `(${e?.message ?? e}); falling back to the event-implied status`,
        );
      }
    }
    if (!status) {
      status = event.type === 'invoice.payment_failed' ? 'PAST_DUE' : 'ACTIVE';
    }

    const fromStatus = license.status;
    const eventCreatedAt = new Date(event.created * 1000);
    // Advance-only watermark (never read-gated — see docblock): keep the newer
    // of the current watermark and this event, so a later stale subscription
    // event can't roll the payment status back.
    const nextWatermark =
      license.stripeLastEventCreatedAt &&
      license.stripeLastEventCreatedAt.getTime() > eventCreatedAt.getTime()
        ? license.stripeLastEventCreatedAt
        : eventCreatedAt;
    // withDbRetry to match the sibling syncLicenseFromSubscription tx (same
    // commit wrapped that one but left this invoice path bare). Without it a
    // transient pgbouncer blip here bubbles → the webhook controller returns
    // 500 → Stripe retries the SAME event.id → the commit-before-work
    // idempotency gate (processedStripeEvent) short-circuits the retry as a
    // duplicate → a real payment_failed downgrade or payment_succeeded recovery
    // is permanently lost (unpaid tenant stays ACTIVE / paying customer stuck
    // PAST_DUE). Retrying the transient failure closes that window.
    await withDbRetry(() =>
      this.prisma.client.$transaction(async (tx) => {
        await tx.license.updateMany({
          where: { id: license.id, tenantId: license.tenantId },
          data: { status, stripeLastEventCreatedAt: nextWatermark },
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
              subscriptionId: subId ?? null,
              stripeCustomerId: customerId,
              fromStatus,
              toStatus: status,
              liveStatusUsed,
            }),
          },
        });
      }),
    );
    this.logger[status === 'PAST_DUE' || status === 'SUSPENDED' ? 'warn' : 'log'](
      `webhook: ${event.type} for customer ${customerId} → tenant ` +
        `${license.tenantId} ${fromStatus ?? 'none'} → ${status} ` +
        `(event ${event.id}, ${liveStatusUsed ? 'live-refetch' : 'event-implied'})`,
    );
    return {};
  }
}
