/**
 * The VenueOS + AI plan — pure rules (owner pricing decision, 2026-10-12).
 *
 * Pinned shape by shape: which Stripe price is which plan, who may spend OUR AI keys (the gate
 * matrix: AI plan / no AI / trial / enterprise toggle / suspended / cancelled / past due), and the
 * limits a plan includes.
 */
import {
  AI_ADDON_MONTHLY_CENTS,
  aiEntitlementOf,
  aiLimitMessage,
  aiPlanLimits,
  aiPlanOffered,
  aiPlanRequiredMessage,
  includedFor,
  planOfPriceId,
  planPriceIds,
  PLAN_PRICES,
  platformImageCostMicros,
  priceIdForPlan,
  switchedPriceId,
} from './ai-plan';
import { LICENSE_TIERS } from '@cms/api-types';

const ENV = {
  STRIPE_PRICE_MONTHLY: 'price_m',
  STRIPE_PRICE_ANNUAL: 'price_y',
  STRIPE_PRICE_MONTHLY_AI: 'price_m_ai',
  STRIPE_PRICE_ANNUAL_AI: 'price_y_ai',
} as unknown as NodeJS.ProcessEnv;
const NO_AI_ENV = { STRIPE_PRICE_MONTHLY: 'price_m', STRIPE_PRICE_ANNUAL: 'price_y' } as unknown as NodeJS.ProcessEnv;

const NOW = new Date('2026-10-12T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('prices', () => {
  it('are the owner’s four numbers, and AI adds $5/screen/month', () => {
    expect(PLAN_PRICES).toEqual({ monthlyCents: 2000, annualCents: 20000, monthlyAiCents: 2500, annualAiCents: 25000 });
    expect(AI_ADDON_MONTHLY_CENTS).toBe(500);
    expect(aiPlanRequiredMessage()).toContain('$5/screen/month');
    expect(aiPlanRequiredMessage()).toContain('Add VenueOS AI for $5/screen/month');
    expect(aiPlanRequiredMessage()).toContain('connect your own AI key for free (Settings → AI)');
  });

  it('reads the four price ids from env (trimmed; empty = unset)', () => {
    expect(planPriceIds(ENV)).toEqual({ monthly: 'price_m', annual: 'price_y', monthlyAi: 'price_m_ai', annualAi: 'price_y_ai' });
    expect(planPriceIds({ STRIPE_PRICE_MONTHLY_AI: '   ' } as any).monthlyAi).toBeNull();
  });

  it('offers the AI plan only when BOTH AI prices are configured', () => {
    expect(aiPlanOffered(ENV)).toBe(true);
    expect(aiPlanOffered(NO_AI_ENV)).toBe(false);
    expect(aiPlanOffered({ ...NO_AI_ENV, STRIPE_PRICE_MONTHLY_AI: 'price_m_ai' } as any)).toBe(false);
  });

  it('picks the checkout price for each plan + interval', () => {
    expect(priceIdForPlan('monthly', false, ENV)).toBe('price_m');
    expect(priceIdForPlan('annual', false, ENV)).toBe('price_y');
    expect(priceIdForPlan('monthly', true, ENV)).toBe('price_m_ai');
    expect(priceIdForPlan('annual', true, ENV)).toBe('price_y_ai');
    expect(priceIdForPlan('annual', true, NO_AI_ENV)).toBeNull();
  });
});

describe('plan resolution from a price id (what the webhook stamps)', () => {
  it.each([
    ['price_m', { ai: false, period: 'monthly' }],
    ['price_y', { ai: false, period: 'annual' }],
    ['price_m_ai', { ai: true, period: 'monthly' }],
    ['price_y_ai', { ai: true, period: 'annual' }],
  ])('%s → %j', (id, plan) => {
    expect(planOfPriceId(id, ENV)).toEqual(plan);
  });

  it('an unknown or missing price is null (the webhook leaves aiIncluded alone)', () => {
    expect(planOfPriceId('price_legacy_25', ENV)).toBeNull();
    expect(planOfPriceId(null, ENV)).toBeNull();
    // An AI price id is never mistaken for AI when the AI env is not set.
    expect(planOfPriceId('price_m_ai', NO_AI_ENV)).toBeNull();
  });

  it('switching AI keeps the interval', () => {
    expect(switchedPriceId('price_m', true, ENV)).toBe('price_m_ai');
    expect(switchedPriceId('price_y_ai', false, ENV)).toBe('price_y');
    expect(switchedPriceId('price_y', true, NO_AI_ENV)).toBeNull();
    expect(switchedPriceId('price_custom', true, ENV)).toBeNull();
  });
});

describe('the gate matrix — who may spend OUR AI keys', () => {
  const trial = (daysLeft: number, extra: Record<string, unknown> = {}) => ({
    tier: 'FREE_TRIAL',
    status: 'ACTIVE',
    billingMode: 'CARD',
    trialEndsAt: new Date(NOW.getTime() + daysLeft * DAY),
    ...extra,
  });

  it('no license at all → none', () => {
    expect(aiEntitlementOf(null, NOW, true).plan).toBe('none');
  });

  it('a card plan WITHOUT AI → none', () => {
    expect(aiEntitlementOf({ tier: 'MONTHLY', status: 'ACTIVE', billingMode: 'CARD', stripeSubscriptionId: 'sub', aiIncluded: false }, NOW, true).plan).toBe('none');
  });

  it('a card plan WITH AI → ai (and past-due keeps it while Stripe retries)', () => {
    const lic = { tier: 'ANNUAL', status: 'ACTIVE', billingMode: 'CARD', stripeSubscriptionId: 'sub', aiIncluded: true };
    expect(aiEntitlementOf(lic, NOW, true).plan).toBe('ai');
    expect(aiEntitlementOf({ ...lic, status: 'PAST_DUE' }, NOW, true).plan).toBe('ai');
  });

  it('cancelled or suspended → none, whatever aiIncluded says', () => {
    const lic = { tier: 'ANNUAL', billingMode: 'CARD', stripeSubscriptionId: 'sub', aiIncluded: true };
    expect(aiEntitlementOf({ ...lic, status: 'CANCELLED' }, NOW, true).plan).toBe('none');
    expect(aiEntitlementOf({ ...lic, status: 'SUSPENDED' }, NOW, true).plan).toBe('none');
  });

  it('a free trial (no card, or a card added during it) → trial, with its window', () => {
    const e = aiEntitlementOf(trial(5), NOW, true);
    expect(e.plan).toBe('trial');
    expect(e.trialEndsAt?.getTime()).toBe(NOW.getTime() + 5 * DAY);
    expect(e.trialStartsAt?.getTime()).toBe(NOW.getTime() + 5 * DAY - 14 * DAY);
    expect(aiEntitlementOf(trial(5, { stripeSubscriptionId: 'sub', aiIncluded: false }), NOW, true).plan).toBe('trial');
  });

  it('a trial that ended with no card → none (even inside the grace period)', () => {
    expect(aiEntitlementOf(trial(-2), NOW, true).plan).toBe('none');
    expect(aiEntitlementOf(trial(-2), NOW, false).plan).toBe('none');
  });

  it('enterprise / invoice / PO / comp: the console toggle decides', () => {
    for (const billingMode of ['INVOICE', 'PURCHASE_ORDER', 'COMP']) {
      expect(aiEntitlementOf({ tier: 'ANNUAL', status: 'ACTIVE', billingMode, aiIncluded: true }, NOW, true).plan).toBe('ai');
      expect(aiEntitlementOf({ tier: 'ANNUAL', status: 'ACTIVE', billingMode, aiIncluded: false }, NOW, true).plan).toBe('none');
    }
  });
});

describe('limits', () => {
  it('defaults: 10 boards + 20 images per AI screen; trial 2 + 2', () => {
    expect(aiPlanLimits({} as any)).toEqual({ boardsPerScreen: 10, imagesPerScreen: 20, trialBoards: 2, trialImages: 2 });
  });

  it('the public trial claim (catalog) states the enforced trial allowance (2026-10-22: it said 10 + 10)', () => {
    const { trialBoards, trialImages } = aiPlanLimits({} as any);
    const trial = LICENSE_TIERS.find((t) => t.id === 'FREE_TRIAL');
    expect(trial?.features).toContain(`AI included (${trialBoards} board designs + ${trialImages} images)`);
  });

  it('are env-tunable, and a bad value falls back to the default', () => {
    expect(aiPlanLimits({ AI_BOARDS_PER_SCREEN: '15', AI_IMAGES_PER_SCREEN: 'lots', AI_TRIAL_BOARDS: '-1', AI_TRIAL_IMAGES: '3' } as any)).toEqual({
      boardsPerScreen: 15,
      imagesPerScreen: 20,
      trialBoards: 2,
      trialImages: 3,
    });
  });

  it('scale with paired screens on the AI plan (at least one), are flat on a trial, and zero without AI', () => {
    const l = aiPlanLimits({} as any);
    expect(includedFor('boards', 'ai', 4, l)).toBe(40);
    expect(includedFor('images', 'ai', 4, l)).toBe(80);
    expect(includedFor('boards', 'ai', 0, l)).toBe(10);
    expect(includedFor('boards', 'trial', 3, l)).toBe(2);
    expect(includedFor('images', 'trial', 3, l)).toBe(2);
    expect(includedFor('boards', 'none', 40, l)).toBe(0);
    expect(includedFor('images', 'none', 40, l)).toBe(0);
  });

  it('the image price the dollar meter uses: $0.08 by default, env-tunable', () => {
    expect(platformImageCostMicros({} as any)).toBe(80_000);
    expect(platformImageCostMicros({ AI_IMAGE_COST_USD: '0.05' } as any)).toBe(50_000);
    expect(platformImageCostMicros({ AI_IMAGE_COST_USD: 'free' } as any)).toBe(80_000);
  });

  it('the limit message offers the two ways forward', () => {
    const m = aiLimitMessage({ unit: 'images', plan: 'ai', resetAt: '2026-11-01T00:00:00.000Z' });
    expect(m).toContain('AI images this month');
    expect(m).toContain('November 1');
    expect(m).toContain('your own AI key');
    expect(m).toContain('contact us for more');
    expect(aiLimitMessage({ unit: 'boards', plan: 'trial', resetAt: null })).toContain('for your free trial');
  });
});
