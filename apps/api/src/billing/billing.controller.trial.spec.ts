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
    setAiPlan: jest.fn(async (o: any) => ({ aiIncluded: o.ai, changed: true })),
  };
  const allowance = { invalidateEntitlement: jest.fn() };
  const controller = new BillingController(stripe as any, license as any, prisma as any, allowance as any);
  return { controller, stripe, license, allowance };
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
      prices: { monthlyCents: 2000, annualCents: 20000 },
      // 2026-10-12 — a trial gets AI (at the trial limits) whatever plan it will pick
      aiPlan: 'trial',
      aiIncluded: false,
      aiAddonMonthlyCents: 500,
    });
  });

  it('the AI plan prices appear ONLY when both AI price ids are configured', async () => {
    Object.assign(process.env, KEYS);
    delete process.env.STRIPE_PRICE_MONTHLY_AI;
    delete process.env.STRIPE_PRICE_ANNUAL_AI;
    const { controller } = build(trial(12));
    expect(((await controller.summary(req())) as any).aiPrices).toBeNull();
    process.env.STRIPE_PRICE_MONTHLY_AI = 'price_m_ai';
    process.env.STRIPE_PRICE_ANNUAL_AI = 'price_y_ai';
    expect(((await controller.summary(req())) as any).aiPrices).toEqual({ monthlyCents: 2500, annualCents: 25000 });
    delete process.env.STRIPE_PRICE_MONTHLY_AI;
    delete process.env.STRIPE_PRICE_ANNUAL_AI;
  });

  it('a paid plan reports whether AI is included (aiPlan ai vs none)', async () => {
    Object.assign(process.env, KEYS);
    const paid = { tier: 'MONTHLY', status: 'ACTIVE', billingMode: 'CARD', seatLimit: 5, stripeSubscriptionId: 'sub_1', trialEndsAt: null };
    let { controller } = build({ ...paid, aiIncluded: true });
    expect(await controller.summary(req())).toMatchObject({ state: 'active', aiIncluded: true, aiPlan: 'ai' });
    ({ controller } = build({ ...paid, aiIncluded: false }));
    expect(await controller.summary(req())).toMatchObject({ state: 'active', aiIncluded: false, aiPlan: 'none' });
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

  it('2026-10-12 — `ai: true` checks out the VenueOS + AI plan; without the AI prices it is a clear 400', async () => {
    Object.assign(process.env, KEYS);
    const { controller, stripe } = build(trial(10));
    await expect(controller.checkout(req(), { billingPeriod: 'monthly', ai: true })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BILLING_AI_PLAN_UNAVAILABLE' }),
    });
    expect(stripe.checkoutForTenant).not.toHaveBeenCalled();
    process.env.STRIPE_PRICE_MONTHLY_AI = 'price_m_ai';
    process.env.STRIPE_PRICE_ANNUAL_AI = 'price_y_ai';
    try {
      await controller.checkout(req(), { billingPeriod: 'monthly', ai: true });
      expect(stripe.checkoutForTenant).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'monthly', ai: true }));
      // anything but a literal `true` is the plan without AI
      await controller.checkout(req(), { billingPeriod: 'annual', ai: 'yes' });
      expect(stripe.checkoutForTenant).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'annual', ai: false }));
    } finally {
      delete process.env.STRIPE_PRICE_MONTHLY_AI;
      delete process.env.STRIPE_PRICE_ANNUAL_AI;
    }
  });
});

describe('POST /billing/ai-plan — switch AI on / off (2026-10-12)', () => {
  const card = { tier: 'MONTHLY', status: 'ACTIVE', billingMode: 'CARD', seatLimit: 4, stripeSubscriptionId: 'sub_1', trialEndsAt: null };
  afterEach(() => {
    delete process.env.STRIPE_PRICE_MONTHLY_AI;
    delete process.env.STRIPE_PRICE_ANNUAL_AI;
  });

  it('a card customer switches AI on: the subscription moves, the plan cache is dropped', async () => {
    Object.assign(process.env, KEYS, { STRIPE_PRICE_MONTHLY_AI: 'price_m_ai', STRIPE_PRICE_ANNUAL_AI: 'price_y_ai' });
    const { controller, stripe, allowance } = build(card);
    expect(await controller.aiPlan(req(), { ai: true })).toEqual({ ok: true, aiIncluded: true, changed: true });
    expect(stripe.setAiPlan).toHaveBeenCalledWith({ tenantId: 't1', ai: true, actorUserId: 'u1' });
    expect(allowance.invalidateEntitlement).toHaveBeenCalled();
    // and off again — always possible, even if the AI prices were later removed
    delete process.env.STRIPE_PRICE_MONTHLY_AI;
    expect(await controller.aiPlan(req(), { ai: false })).toMatchObject({ aiIncluded: false });
  });

  it('switching ON without the AI prices configured is a clear 400, nothing changes', async () => {
    Object.assign(process.env, KEYS);
    const { controller, stripe } = build(card);
    await expect(controller.aiPlan(req(), { ai: true })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BILLING_AI_PLAN_UNAVAILABLE' }),
    });
    expect(stripe.setAiPlan).not.toHaveBeenCalled();
  });

  it('an invoice / PO / comp customer is switched by VenueOS, never here (409 BILLING_NOT_CARD)', async () => {
    Object.assign(process.env, KEYS, { STRIPE_PRICE_MONTHLY_AI: 'price_m_ai', STRIPE_PRICE_ANNUAL_AI: 'price_y_ai' });
    const { controller, stripe } = build({ ...card, billingMode: 'INVOICE', stripeSubscriptionId: null });
    await expect(controller.aiPlan(req(), { ai: true })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BILLING_NOT_CARD' }),
    });
    expect(stripe.setAiPlan).not.toHaveBeenCalled();
  });

  it('a body without a boolean `ai` is a 400', async () => {
    Object.assign(process.env, KEYS);
    const { controller } = build(card);
    await expect(controller.aiPlan(req(), { ai: 'on' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BILLING_AI_PLAN_INVALID' }),
    });
  });
});
