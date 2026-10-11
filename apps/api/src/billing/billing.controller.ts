/**
 * BillingController — Stripe Checkout + Customer Portal + invoices.
 *
 * All real Stripe work lives in StripeService and is gated on
 * STRIPE_SECRET_KEY. When Stripe is not configured every endpoint
 * degrades gracefully — `checkout`/`portal` return `{ enabled: false }`
 * and `invoices` returns `[]` — so a deploy with no billing (the live
 * pilot) is untouched.
 *
 * The webhook lives in a SEPARATE, unauthenticated controller
 * (billing-webhook.controller.ts) — Stripe calls it with no JWT.
 *
 * 2026-09-23 — AI BOARD PACKS (ai/ai-board-credits.ts): `GET ai-packs` lists the packs and this
 * organisation's purchases (with what is left of each); `POST ai-packs/checkout` opens a
 * Stripe-hosted one-off payment for one pack. Both answer `{ enabled: false, reason, message }`
 * rather than failing when a pack cannot be bought: no platform AI key for board design
 * (NO_PLATFORM_KEY — a pack would buy nothing usable), the buyer runs on its own key (OWN_KEY), or
 * Stripe is not configured (STRIPE_NOT_CONFIGURED).
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { SeatChangeError, StripeService } from './stripe.service';
import {
  billingStateOf,
  cardBillingReady,
  PRICE_ANNUAL_CENTS,
  PRICE_MONTHLY_CENTS,
  TRIAL_SCREENS,
} from './trial-policy';
import { LicenseService } from '../license/license.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiAllowanceService } from '../ai/ai-allowance.service';
import { AI_BOARD_PACKS, BOARD_PACK_VALID_MONTHS, boardPackById } from '../ai/ai-board-credits';
import { cardCheckoutAllowed, isInvoiceBilled } from '../customers/customer-console.policy';

/**
 * CUSTOMER CONSOLE (2026-10-10): an organisation the owner bills by INVOICE /
 * PURCHASE_ORDER (through ARC — no card) or has comp'd never gets a Stripe
 * checkout, whatever an old tab or an API client asks for. The Billing page
 * hides the buttons (GET /billing/account); this is the server side of it.
 * CARD customers (and no-license self-serve tenants) are untouched.
 */
const notCardBilled = (mode: string | null | undefined) =>
  new HttpException(
    {
      code: 'BILLING_NOT_CARD',
      billingMode: mode ?? null,
      message:
        mode === 'COMP'
          ? 'Your account is complimentary — there is nothing to pay.'
          : 'Your account is billed by invoice. Contact your VenueOS account manager to change your plan.',
    },
    HttpStatus.CONFLICT,
  );

const BILLING_ROLES = [
  AppRole.SUPER_ADMIN,
  AppRole.DISTRICT_ADMIN,
  AppRole.SCHOOL_ADMIN,
] as const;

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/billing')
export class BillingController {
  constructor(
    private readonly stripe: StripeService,
    // LicenseService is exported by the @Global LicenseModule, so it
    // resolves here without listing it in BillingModule's providers.
    private readonly license: LicenseService,
    // Needed so billingUrl() can resolve a tenant slug when the caller's token
    // predates tenantSlug propagation — a Stripe return URL must never be wrong.
    private readonly prisma: PrismaService,
    // 2026-09-23 — board packs: the organisation, whether a pack may be bought, and each pack's balance.
    private readonly allowance: AiAllowanceService,
  ) {}

  /** The dashboard's billing return path for this tenant. */
  private async billingUrl(req: any): Promise<string> {
    const origin = req.headers.origin || `${req.protocol}://${req.headers.host}`;
    // Prefer the token's slug; fall back to a DB lookup so a token minted before
    // tenantSlug was propagated still returns a REAL url. Never emit the old
    // 'dashboard' literal — /dashboard/settings/billing is not a route, so a
    // customer returning from Stripe hit a 404.
    let slug: string | null = req.user?.tenantSlug || null;
    if (!slug && req.user?.tenantId) {
      const t = await this.prisma.client.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: { slug: true },
      });
      slug = t?.slug || null;
    }
    return `${origin}/${slug || req.user?.tenantId || ''}/settings/billing`.replace(/\/{2,}/g, '/').replace(':/', '://');
  }

  /**
   * Start a subscription. Returns `{ url }` — a Stripe-hosted Checkout
   * URL the client redirects to. `{ enabled: false }` when Stripe isn't
   * configured on this deploy.
   */
  @Post('checkout')
  @RequireRoles(...BILLING_ROLES)
  async checkout(
    @Request() req: any,
    @Body() body: { billingPeriod?: 'monthly' | 'annual' },
  ) {
    const account = await this.license.orgAccount(req.user.tenantId);
    if (!cardCheckoutAllowed(account.governing)) throw notCardBilled(account.governing?.billingMode);
    if (!this.stripe.enabled()) {
      return {
        enabled: false,
        message: 'Online payments are not set up on this deployment yet.',
      };
    }
    const period = body?.billingPeriod === 'annual' ? 'annual' : 'monthly';
    const base = await this.billingUrl(req);
    try {
      // Pre-fill Stripe's email with the person adding the card (first checkout only).
      const me = req.user?.id
        ? await this.prisma.client.user.findUnique({ where: { id: req.user.id }, select: { email: true } })
        : null;
      const email = me?.email && !me.email.endsWith('.invalid') ? me.email : null;
      const { url } = await this.stripe.checkoutForTenant({
        tenantId: req.user.tenantId,
        period,
        successUrl: `${base}?checkout=success`,
        cancelUrl: `${base}?checkout=cancelled`,
        customerEmail: email,
      });
      return { url };
    } catch (e) {
      throw new HttpException({ code: 'BILLING_CHECKOUT_FAILED', message: (e as Error).message }, HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Open the Stripe Customer Portal — manage card, plan, cancellation,
   * past invoices. Returns `{ url }`, or `{ noSubscription: true }` if
   * the tenant has never subscribed.
   */
  @Post('portal')
  @RequireRoles(...BILLING_ROLES)
  async portal(@Request() req: any) {
    if (!this.stripe.enabled()) {
      return {
        enabled: false,
        message: 'Online payments are not set up on this deployment yet.',
      };
    }
    try {
      return await this.stripe.portalForTenant(req.user.tenantId, await this.billingUrl(req));
    } catch (e) {
      throw new HttpException({ code: 'BILLING_PORTAL_FAILED', message: (e as Error).message }, HttpStatus.BAD_GATEWAY);
    }
  }

  /** The tenant's invoice history (newest first). */
  @Get('invoices')
  @RequireRoles(...BILLING_ROLES)
  async invoices(@Request() req: any) {
    // Self-healing backstop: each time the operator opens billing,
    // reconcile the Stripe subscription quantity with live screen
    // usage in case a pair/unpair sync was ever missed. Fire-and-
    // forget — it never blocks the invoice list.
    this.stripe.syncSubscriptionQuantity(req.user.tenantId).catch(() => {});
    const invoices = await this.stripe.invoicesForTenant(req.user.tenantId);
    return { stripeEnabled: this.stripe.enabled(), invoices };
  }

  /**
   * The AI board packs and this organisation's purchases, newest first, each with the boards it
   * still has (a pack is drawn on only after the month's included boards; it lapses 12 months after
   * purchase). The organisation comes from the session — there is no id to aim anywhere else.
   */
  @Get('ai-packs')
  @RequireRoles(...BILLING_ROLES)
  async aiPacks(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const [availability, boards] = await Promise.all([
      this.allowance.purchaseAvailabilityFor(tenantId),
      this.allowance.boards(tenantId),
    ]);
    return {
      enabled: availability.enabled,
      ...(availability.enabled ? {} : { reason: availability.reasonCode, message: availability.reason }),
      packs: AI_BOARD_PACKS.map(({ id, boards: n, usd }) => ({ id, boards: n, usd })),
      validMonths: BOARD_PACK_VALID_MONTHS,
      purchases: boards.packs,
    };
  }

  /**
   * Buy one pack of AI board credits: returns `{ url }` — a Stripe-hosted Checkout page (card entry
   * happens there, never here). The boards are credited by the verified webhook once Stripe says the
   * payment is PAID, never by this call. `{ enabled: false, reason, message }` when a pack cannot be
   * bought on this deploy / for this buyer; 400 AI_PACK_UNKNOWN for a pack id that does not exist.
   */
  @Post('ai-packs/checkout')
  @RequireRoles(...BILLING_ROLES)
  async aiPackCheckout(@Request() req: any, @Body() body: { pack?: unknown }) {
    const tenantId = req.user.tenantId;
    // Invoice / PO customers never enter a card (a comp'd customer may still buy a pack).
    const account = await this.license.orgAccount(tenantId);
    if (isInvoiceBilled(account.governing?.billingMode)) throw notCardBilled(account.governing?.billingMode);
    const availability = await this.allowance.purchaseAvailabilityFor(tenantId);
    if (!availability.enabled) {
      return { enabled: false, reason: availability.reasonCode, message: availability.reason };
    }
    const pack = boardPackById(body?.pack);
    if (!pack) {
      throw new HttpException(
        { code: 'AI_PACK_UNKNOWN', message: `Unknown board pack. Choose one of: ${AI_BOARD_PACKS.map((p) => p.id).join(', ')}.` },
        HttpStatus.BAD_REQUEST,
      );
    }
    const orgTenantId = await this.allowance.orgTenantIdFor(tenantId);
    const base = await this.billingUrl(req);
    try {
      return await this.stripe.checkoutBoardPack({
        tenantId,
        orgTenantId,
        userId: req.user.id ?? null,
        pack,
        successUrl: `${base}?boards=success`,
        cancelUrl: `${base}?boards=cancelled`,
      });
    } catch (e) {
      throw new HttpException({ code: 'BILLING_CHECKOUT_FAILED', message: (e as Error).message }, HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * 2026-10-11 — THE one billing read the dashboard chrome makes: the trial /
   * plan state for the trial banner, the Billing page's status card and the
   * pairing dialog. Any signed-in person may read it (a contributor sees "ask
   * an admin" instead of a button — `canManage`). One query per page load at
   * most (the web caches it for 10 minutes and never polls). The state comes
   * from trial-policy.ts — the same function that gates pairing and editing.
   */
  @Get('summary')
  async summary(@Request() req: any) {
    const ready = cardBillingReady();
    const role = req.user?.role;
    const canManage = (BILLING_ROLES as readonly string[]).includes(role);
    const prices = { monthlyCents: PRICE_MONTHLY_CENTS, annualCents: PRICE_ANNUAL_CENTS };
    if (req.user?.kind === 'device' || !req.user?.tenantId) {
      return { state: 'none', billingReady: ready, canManage: false, prices };
    }
    const tenantId = req.user.tenantId;
    const [account, own, seatsUsed] = await Promise.all([
      this.license.orgAccount(tenantId),
      this.prisma.client.license.findUnique({
        where: { tenantId },
        select: { tier: true, seatLimit: true, monthlyPriceCents: true, currentPeriodEnd: true, stripeSubscriptionId: true },
      }),
      this.license.usedSeats(tenantId),
    ]);
    const gov = account.governing as any;
    const b = billingStateOf(gov, new Date(), ready);
    const period = gov?.tier === 'ANNUAL' ? 'annual' : gov?.tier === 'MONTHLY' ? 'monthly' : null;
    return {
      state: b.state,
      billingReady: ready,
      canManage,
      // Card checkout is offered only to a CARD (or no-license) organisation on
      // a deploy where card billing is live — never to INVOICE / PO / COMP.
      canCheckout: ready && canManage && cardCheckoutAllowed(gov) && (!b.cardOnFile || b.state === 'cancelled'),
      cardOnFile: b.cardOnFile,
      trialEndsAt: b.trialEndsAt ? b.trialEndsAt.toISOString() : null,
      daysLeft: b.daysLeft,
      graceEndsAt: b.graceEndsAt ? b.graceEndsAt.toISOString() : null,
      pairingBlocked: b.pairingBlocked,
      readOnly: b.readOnly,
      period,
      seatsUsed,
      seatLimit: own?.seatLimit ?? (b.state === 'trial' ? TRIAL_SCREENS : null),
      renewsAt: own?.currentPeriodEnd ? own.currentPeriodEnd.toISOString() : null,
      prices,
    };
  }

  /**
   * 2026-10-11 — set the number of screens on the card plan (the pairing
   * dialog's "Add 1 screen ($25/mo)" sends `{ add: 1 }`; `{ quantity }` sets
   * it outright). Prorated onto the next invoice. Never below the screens
   * already paired. Audited (BILLING_SEATS_CHANGED).
   */
  @Post('seats')
  @RequireRoles(...BILLING_ROLES)
  async seats(@Request() req: any, @Body() body: { add?: unknown; quantity?: unknown }) {
    const tenantId = req.user.tenantId;
    const account = await this.license.orgAccount(tenantId);
    if (!cardCheckoutAllowed(account.governing)) throw notCardBilled(account.governing?.billingMode);
    if (!this.stripe.enabled()) {
      return { enabled: false, message: 'Online payments are not set up on this deployment yet.' };
    }
    let quantity: number;
    if (body?.quantity !== undefined) {
      quantity = Number(body.quantity);
    } else {
      const add = body?.add === undefined ? 1 : Number(body.add);
      if (!Number.isInteger(add) || add < 1 || add > 100) {
        throw new HttpException({ code: 'BILLING_SEATS_INVALID', message: 'Add between 1 and 100 screens.' }, HttpStatus.BAD_REQUEST);
      }
      const own = await this.prisma.client.license.findUnique({ where: { tenantId }, select: { seatLimit: true } });
      quantity = (own?.seatLimit ?? 0) + add;
    }
    try {
      const r = await this.stripe.setSeatQuantity({ tenantId, quantity, actorUserId: req.user.id ?? null });
      return { ok: true, seatLimit: r.seatLimit, previous: r.previous };
    } catch (e) {
      if (e instanceof SeatChangeError) {
        throw new HttpException({ code: e.code, message: e.message }, HttpStatus.CONFLICT);
      }
      throw new HttpException({ code: 'BILLING_SEATS_FAILED', message: (e as Error).message }, HttpStatus.BAD_GATEWAY);
    }
  }

  /** Smoke-test — whether Stripe is configured on this deploy. */
  @Get('status')
  status() {
    return {
      stripeEnabled: this.stripe.enabled(),
      message: this.stripe.enabled()
        ? 'Stripe is configured — checkout, portal and invoices are live.'
        : 'Stripe is not configured. Set STRIPE_SECRET_KEY to enable billing.',
    };
  }

  /**
   * Free-tier status. No card required, and — importantly — **no
   * transaction is committed here**: the free pilot tier is the
   * no-License *default* state, so there is nothing to "activate." This
   * endpoint is informational; it reports the tenant's real effective
   * tier + seat limit straight from LicenseService rather than the old
   * hardcoded `trialDays:14, seatLimit:3` placeholders, which wrote
   * nothing yet *looked* like a committed trial (§11 audit, 2026-05-30).
   *
   * When the real trial-to-paid Setup-Intent flow lands it can live in a
   * dedicated `POST /billing/start-trial` that actually upserts a License
   * row; this method intentionally stays a read-only status probe.
   */
  @Post('activate-trial')
  @RequireRoles(...BILLING_ROLES)
  async activateTrial(@Request() req: any) {
    const eff = await this.license.getEffective(req.user.tenantId);
    return {
      ok: true,
      // Honest: nothing was persisted. The free tier is already in effect
      // by default, so there's no row to create on "activate".
      committed: false,
      tier: eff.tier,
      seatLimit: eff.seatLimit,
      isPilot: eff.isPilot,
      // null expiry = perpetual (the pilot/free tier doesn't expire).
      expiresAt: eff.expiresAt,
      message: eff.isPilot
        ? `You're already on the free ${eff.tier} tier — pair up to ${eff.seatLimit} screen(s) with no card. ` +
          'Pick a paid plan above whenever you are ready.'
        : `Your tenant is on the ${eff.tier} plan (${eff.seatLimit} seats). Manage it via the Customer Portal above.`,
    };
  }
}
