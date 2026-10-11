/**
 * GET /billing/summary + POST /billing/seats + POST /billing/checkout (2026-10-11).
 *
 * The summary is what the dashboard's trial banner, Billing page and pairing
 * dialog read; it must never offer a card to an INVOICE / PO / COMP customer,
 * must say "billing isn't set up" (canCheckout false) while Stripe is off, and
 * must keep a contributor to "ask an admin". Seats and checkout refuse invoice
 * customers server-side (409 BILLING_NOT_CARD) whatever an old tab sends.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { BillingController } from './billing.controller';

const KEYS = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_MONTHLY: 'price_m', STRIPE_PRICE_ANNUAL: 'price_a' };
afterEach(() => {
  for (const k of Object.keys(KEYS)) delete process.env[k];
});

const req = (role: AppRole = AppRole.DISTRICT_ADMIN) => ({
  headers: { origin: 'https://app.example' },
  protocol: 'https',
  user: { id: 'u1', tenantId: 't1', tenantSlug: 'taco', role },
});

function build(governing: Record<string, any> | null, own: Record<string, any> | null = governing) {
  const license = {
    orgAccount: jest.fn(async () => ({ rootTenantId: 't1', governing, suspended: false })),
    usedSeats: jest.fn(async () => 2),
  };
  const prisma = {
    client: {
      license: { findUnique: jest.fn(async () => own) },
      user: { findUnique: jest.fn(async () => ({ email: 'owner@taco.test' })) },
      tenant: { findUnique: jest.fn(async () => ({ slug: 'taco' })) },
    },
  };
  const stripe = {
    enabled: () => !!process.env.STRIPE_SECRET_KEY,
    checkoutForTenant: jest.fn(async () => ({ url: 'https://checkout.stripe.test/x' })),
    setSeatQuantity: jest.fn(async (o: any) => ({ seatLimit: o.quantity, previous: o.quantity - 1 })),
  };
  const controller = new BillingController(stripe as any, license as any, prisma as any, {} as any);
  return { controller, stripe, license };
}

const trial = (days: number) => ({
  tier: 'FREE_TRIAL',
  status: 'ACTIVE',
  billingMode: 'CARD',
  seatLimit: 3,
  stripeSubscriptionId: null,
  trialEndsAt: new Date(Date.now() + days * 86_400_000),
});

describe('GET /billing/summary', () => {
  it('trial on a live deploy: days left, one-tap checkout, both prices', async () => {
    Object.assign(process.env, KEYS);
    const { controller } = build(trial(12));
    const s: any = await controller.summary(req());
    expect(s).toMatchObject({
      state: 'trial',
      daysLeft: 12,
      canCheckout: true,
      canManage: true,
      seatsUsed: 2,
      seatLimit: 3,
      prices: { monthlyCents: 2500, annualCents: 24000 },
    });
  });

  it('INVOICE customer: offline, never a card checkout', async () => {
    Object.assign(process.env, KEYS);
    const { controller } = build({ tier: 'ANNUAL', status: 'ACTIVE', billingMode: 'INVOICE', seatLimit: 50 });
    const s: any = await controller.summary(req());
    expect(s.state).toBe('offline');
    expect(s.canCheckout).toBe(false);
  });

  it('Stripe not configured: billingReady false, no checkout offered — the page says billing is not set up', async () => {
    const { controller } = build(trial(12));
    const s: any = await controller.summary(req());
    expect(s.billingReady).toBe(false);
    expect(s.canCheckout).toBe(false);
    expect(s.state).toBe('trial');
  });

  it('a contributor sees the state but cannot manage billing', async () => {
    Object.assign(process.env, KEYS);
    const { controller } = build(trial(3));
    const s: any = await controller.summary(req(AppRole.CONTRIBUTOR));
    expect(s.canManage).toBe(false);
    expect(s.canCheckout).toBe(false);
  });

  it('card on file during the trial: trial_card, no second checkout', async () => {
    Object.assign(process.env, KEYS);
    const { controller } = build({ ...trial(9), tier: 'ANNUAL', stripeSubscriptionId: 'sub_1' });
    const s: any = await controller.summary(req());
    expect(s).toMatchObject({ state: 'trial_card', cardOnFile: true, canCheckout: false, period: 'annual' });
  });
});

describe('GET /billing/summary — cancelled plan', () => {
  it('a cancelled card plan may restart through checkout', async () => {
    Object.assign(process.env, KEYS);
    const { controller } = build({ tier: 'MONTHLY', status: 'CANCELLED', billingMode: 'CARD', stripeSubscriptionId: 'sub_1', seatLimit: 3 });
    const s: any = await controller.summary(req());
    expect(s).toMatchObject({ state: 'cancelled', readOnly: true, canCheckout: true });
  });
});

describe('POST /billing/seats', () => {
  it('{ add: 1 } → seatLimit + 1 for the SESSION tenant', async () => {
    Object.assign(process.env, KEYS);
    const { controller, stripe } = build({ ...trial(-30), tier: 'MONTHLY', stripeSubscriptionId: 'sub_1', seatLimit: 3 });
    const r = await controller.seats(req(), { add: 1 });
    expect(r).toMatchObject({ ok: true, seatLimit: 4 });
    expect(stripe.setSeatQuantity).toHaveBeenCalledWith({ tenantId: 't1', quantity: 4, actorUserId: 'u1' });
  });

  it('invoice / PO / comp customers are refused (409 BILLING_NOT_CARD)', async () => {
    Object.assign(process.env, KEYS);
    for (const billingMode of ['INVOICE', 'PURCHASE_ORDER', 'COMP']) {
      const { controller, stripe } = build({ tier: 'ANNUAL', status: 'ACTIVE', billingMode, seatLimit: 5 });
      await expect(controller.seats(req(), { add: 1 })).rejects.toBeInstanceOf(HttpException);
      await expect(controller.checkout(req(), { billingPeriod: 'annual' })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'BILLING_NOT_CARD' }),
      });
      expect(stripe.setSeatQuantity).not.toHaveBeenCalled();
      expect(stripe.checkoutForTenant).not.toHaveBeenCalled();
    }
  });

  it('Stripe off: a friendly { enabled: false }, never a broken call', async () => {
    const { controller, stripe } = build({ ...trial(-30), tier: 'MONTHLY', stripeSubscriptionId: 'sub_1' });
    expect(await controller.seats(req(), { add: 1 })).toMatchObject({ enabled: false });
    expect(stripe.setSeatQuantity).not.toHaveBeenCalled();
  });
});

describe('POST /billing/checkout', () => {
  it('pre-fills the signed-in admin email and returns to Settings → Billing', async () => {
    Object.assign(process.env, KEYS);
    const { controller, stripe } = build(trial(10));
    const r = await controller.checkout(req(), { billingPeriod: 'annual' });
    expect(r).toEqual({ url: 'https://checkout.stripe.test/x' });
    expect(stripe.checkoutForTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        period: 'annual',
        customerEmail: 'owner@taco.test',
        successUrl: 'https://app.example/taco/settings/billing?checkout=success',
      }),
    );
  });
});
