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
}
