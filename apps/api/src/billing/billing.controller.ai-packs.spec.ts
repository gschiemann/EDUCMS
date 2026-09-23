/**
 * GET /billing/ai-packs + POST /billing/ai-packs/checkout (2026-09-23).
 *
 * A pack may be bought only when it can buy something usable: a platform design route (our
 * OpenAI/Google key), a buyer on our key, and Stripe configured — otherwise `{ enabled: false,
 * reason, message }`, never a thrown error. The organisation always comes from the session.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { ROLES_KEY } from '../auth/roles.decorator';
import { BillingController } from './billing.controller';
import { AiAllowanceService } from '../ai/ai-allowance.service';
import { setCatalogState } from '../ai/ai-model-catalog';

const req = (over: any = {}) => ({
  headers: { origin: 'https://app.example' },
  protocol: 'https',
  user: { id: 'user_1', tenantId: 'school_A1', tenantSlug: 'lincoln', role: AppRole.SCHOOL_ADMIN },
  ...over,
});

function build(opts: { availability?: any; checkout?: jest.Mock } = {}) {
  const stripe = {
    enabled: () => true,
    checkoutBoardPack: opts.checkout ?? jest.fn(async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_x' })),
  };
  const allowance = {
    purchaseAvailabilityFor: jest.fn(async () => opts.availability ?? { enabled: true }),
    orgTenantIdFor: jest.fn(async () => 'org_A'),
    boards: jest.fn(async () => ({ packs: [{ id: 'pur_1', pack: 'standard', boards: 30, remaining: 24, usd: 19, purchasedAt: '2026-09-02T00:00:00.000Z', expiresAt: '2027-09-02T00:00:00.000Z', expired: false }] })),
  };
  const controller = new BillingController(stripe as any, {} as any, {} as any, allowance as any);
  return { controller, stripe, allowance };
}

describe('POST /billing/ai-packs/checkout', () => {
  it('opens a Stripe-hosted checkout for the SESSION\'s organisation — never one named in the body', async () => {
    const { controller, stripe, allowance } = build();
    const out = await controller.aiPackCheckout(req(), { pack: 'standard', tenantId: 'org_EVIL', orgTenantId: 'org_EVIL' } as any);
    expect(out).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_x' });
    expect(allowance.purchaseAvailabilityFor).toHaveBeenCalledWith('school_A1');
    expect(allowance.orgTenantIdFor).toHaveBeenCalledWith('school_A1');
    expect(stripe.checkoutBoardPack).toHaveBeenCalledWith({
      tenantId: 'school_A1',
      orgTenantId: 'org_A',
      userId: 'user_1',
      pack: { id: 'standard', boards: 30, usd: 19 },
      successUrl: 'https://app.example/lincoln/settings/billing?boards=success',
      cancelUrl: 'https://app.example/lincoln/settings/billing?boards=cancelled',
    });
  });

  it.each([
    ['NO_PLATFORM_KEY', 'AI runs on your own key — add it in Settings → AI provider.'],
    ['OWN_KEY', 'Your boards run on your own AI key, with no limit here — there is nothing to buy.'],
    ['STRIPE_NOT_CONFIGURED', "Buying more boards isn't set up on this deployment yet."],
  ])('%s → { enabled: false, reason, message } and Stripe is never called', async (reasonCode, reason) => {
    const { controller, stripe } = build({ availability: { enabled: false, reasonCode, reason } });
    await expect(controller.aiPackCheckout(req(), { pack: 'standard' })).resolves.toEqual({ enabled: false, reason: reasonCode, message: reason });
    expect(stripe.checkoutBoardPack).not.toHaveBeenCalled();
  });

  it('an unknown pack is a 400 AI_PACK_UNKNOWN — never a Stripe call', async () => {
    const { controller, stripe } = build();
    for (const pack of ['mega', '', undefined, 7, { id: 'bulk' }]) {
      const err = await controller.aiPackCheckout(req(), { pack }).catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(400);
      expect(err.getResponse()).toMatchObject({ code: 'AI_PACK_UNKNOWN' });
    }
    expect(stripe.checkoutBoardPack).not.toHaveBeenCalled();
  });

  it('a Stripe failure is a 502 BILLING_CHECKOUT_FAILED', async () => {
    const { controller } = build({ checkout: jest.fn(async () => { throw new Error('card_declined? no — api down'); }) });
    const err = await controller.aiPackCheckout(req(), { pack: 'bulk' }).catch((e) => e);
    expect(err.getStatus()).toBe(502);
    expect(err.getResponse()).toMatchObject({ code: 'BILLING_CHECKOUT_FAILED' });
  });

  it('with the REAL rule: no platform design key on this deploy → NO_PLATFORM_KEY (production today)', async () => {
    const saved = { ...process.env };
    try {
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-ant'; // a fast key alone never draws a board
      process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
      setCatalogState({});
      const prisma: any = { client: { tenant: { findUnique: jest.fn(async () => ({ parentId: null, aiKeyEncrypted: null })) } } };
      const allowance = new AiAllowanceService(prisma);
      const stripe = { checkoutBoardPack: jest.fn() };
      const controller = new BillingController(stripe as any, {} as any, {} as any, allowance);
      await expect(controller.aiPackCheckout(req(), { pack: 'starter' })).resolves.toMatchObject({ enabled: false, reason: 'NO_PLATFORM_KEY' });
      expect(stripe.checkoutBoardPack).not.toHaveBeenCalled();
      // …and the moment our OpenAI key exists, the same buyer can buy
      process.env.OPENAI_API_KEY = 'sk-openai';
      await controller.aiPackCheckout(req(), { pack: 'starter' });
      expect(stripe.checkoutBoardPack).toHaveBeenCalled();
    } finally {
      process.env = saved;
      setCatalogState({});
    }
  });
});

describe('GET /billing/ai-packs', () => {
  it('the packs, whether they can be bought, and the session organisation\'s purchases with what is left', async () => {
    const { controller, allowance } = build();
    await expect(controller.aiPacks(req({ query: { tenantId: 'org_EVIL' } }))).resolves.toEqual({
      enabled: true,
      packs: [
        { id: 'starter', boards: 10, usd: 9 },
        { id: 'standard', boards: 30, usd: 19 },
        { id: 'bulk', boards: 100, usd: 49 },
      ],
      validMonths: 12,
      purchases: [{ id: 'pur_1', pack: 'standard', boards: 30, remaining: 24, usd: 19, purchasedAt: '2026-09-02T00:00:00.000Z', expiresAt: '2027-09-02T00:00:00.000Z', expired: false }],
    });
    expect(allowance.boards).toHaveBeenCalledWith('school_A1');
  });

  it('says why a pack cannot be bought, and still shows the history', async () => {
    const { controller } = build({ availability: { enabled: false, reasonCode: 'STRIPE_NOT_CONFIGURED', reason: "Buying more boards isn't set up on this deployment yet." } });
    await expect(controller.aiPacks(req())).resolves.toMatchObject({
      enabled: false,
      reason: 'STRIPE_NOT_CONFIGURED',
      message: "Buying more boards isn't set up on this deployment yet.",
      purchases: [expect.objectContaining({ id: 'pur_1' })],
    });
  });
});

describe('roles', () => {
  it('only the billing roles may buy or see purchases (never CONTRIBUTOR, never a viewer)', () => {
    for (const handler of ['aiPacks', 'aiPackCheckout'] as const) {
      const roles: AppRole[] = Reflect.getMetadata(ROLES_KEY, BillingController.prototype[handler]);
      expect([...roles].sort()).toEqual([AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN].sort());
    }
  });
});
