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
 *  well-known fields of `data.object`. */
export interface StripeWebhookEvent {
  type: string;
  data: { object: Record<string, any> };
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
   */
  async handleWebhookEvent(event: StripeWebhookEvent): Promise<void> {
    const stripe = this.getClient();
    if (!stripe) return;
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await this.syncLicenseFromSubscription(
            sub,
            session.client_reference_id || session.metadata?.tenantId || null,
          );
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await this.syncLicenseFromSubscription(event.data.object);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await this.prisma.client.license.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { status: 'CANCELLED' },
        });
        this.logger.log(`webhook: subscription ${sub.id} cancelled`);
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        const customerId =
          typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
        if (customerId) {
          await this.prisma.client.license.updateMany({
            where: { stripeCustomerId: customerId },
            data: { status: 'PAST_DUE' },
          });
          this.logger.warn(`webhook: payment failed for customer ${customerId}`);
        }
        break;
      }
      default:
        this.logger.debug(`webhook: ignoring ${event.type}`);
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

  /** Upsert the License row from a Stripe subscription — the single
   *  place a subscription's state becomes license state. */
  private async syncLicenseFromSubscription(
    sub: Record<string, any>,
    fallbackTenantId?: string | null,
  ): Promise<void> {
    const tenantId = sub.metadata?.tenantId || fallbackTenantId || null;
    if (!tenantId) {
      this.logger.warn(`webhook: subscription ${sub.id} carries no tenantId — skipped`);
      return;
    }
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
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

    await this.prisma.client.license.upsert({
      where: { tenantId },
      create: {
        tenantId,
        tier,
        billingMode: 'CARD',
        status,
        seatLimit: PAID_SEAT_LIMIT,
        monthlyPriceCents,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
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
      },
    });
    this.logger.log(`webhook: License synced for tenant ${tenantId} → ${tier} / ${status}`);
  }
}
