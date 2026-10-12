/**
 * The VenueOS + AI plan as the dashboard words it (2026-10-12) — pure helpers, real en messages.
 */
import en from '@/i18n/messages/en.json';
import {
  aiAddonPrice,
  aiPaywallText,
  billingPlansHref,
  formatCents,
  imagesLine,
  isAiPlanRequired,
  needsAiPlan,
} from '../ai-plan';
import { boardsLine, isAiCapError } from '../ai-boards';

/** A tiny ICU-ish translator over the real catalog (plain {name} substitution is all these use). */
function tFor(ns: string) {
  return (key: string, values: Record<string, string | number> = {}) => {
    let node: any = (en as any)[ns];
    for (const part of key.split('.')) node = node?.[part];
    if (typeof node !== 'string') throw new Error(`missing ${ns}.${key}`);
    return node.replace(/\{(\w+)\}/g, (_m: string, k: string) => String(values[k] ?? `{${k}}`));
  };
}
const tPlan = tFor('aiPlan');
const tBoards = tFor('aiBoards');

const allowance = (over: Record<string, unknown> = {}) =>
  ({
    source: 'platform',
    unlimited: false,
    boardsIncluded: 30,
    boardsUsed: 4,
    boardsPurchasedRemaining: 0,
    boardsLeft: 26,
    resetAt: '2026-11-01T00:00:00.000Z',
    screens: 3,
    packs: [],
    purchaseEnabled: true,
    plan: 'ai',
    period: 'month',
    imagesIncluded: 60,
    imagesUsed: 5,
    imagesLeft: 55,
    aiAddonMonthlyCents: 500,
    ...over,
  }) as any;

describe('the AI plan upsell', () => {
  it('recognises the 402 AI_PLAN_REQUIRED (and never calls it "used up")', () => {
    const e = { code: 'AI_PLAN_REQUIRED', status: 402, body: { code: 'AI_PLAN_REQUIRED', aiAddonMonthlyCents: 500 } };
    expect(isAiPlanRequired(e)).toBe(true);
    expect(isAiCapError(e)).toBe(false);
    expect(isAiCapError({ code: 'AI_CAP_REACHED', status: 402 })).toBe(true);
    expect(aiPaywallText(tPlan, e)).toBe('Add VenueOS AI for $5/screen/month — or connect your own AI key for free (Settings → AI).');
  });

  it('the allowance says when to show it', () => {
    expect(needsAiPlan(allowance({ source: 'none', reasonCode: 'AI_PLAN_REQUIRED' }))).toBe(true);
    expect(needsAiPlan(allowance({ source: 'none', reasonCode: 'NO_PLATFORM_KEY' }))).toBe(false);
    expect(needsAiPlan(allowance())).toBe(false);
    expect(aiAddonPrice(allowance())).toBe('$5');
    expect(aiAddonPrice(null)).toBe('$5');
    expect(formatCents(2500)).toBe('$25');
    expect(billingPlansHref('taco')).toBe('/taco/settings/billing#bill-plans');
  });

  it('the boards line becomes the upsell line (with the Add AI flag) without the AI plan', () => {
    const line = boardsLine(tBoards, 'en-US', allowance({ source: 'none', reasonCode: 'AI_PLAN_REQUIRED', boardsLeft: null }));
    expect(line).toMatchObject({ upsell: true, canBuy: false });
    expect(line!.text).toContain('connect your own AI key for free (Settings → AI)');
  });
});

describe('X of Y left', () => {
  it('images this month on the AI plan', () => {
    expect(imagesLine(tPlan, 'en-US', allowance())).toEqual({ text: '55 of 60 AI images left this month · resets Nov 1', out: false });
    expect(imagesLine(tPlan, 'en-US', allowance({ imagesLeft: 0, imagesUsed: 60 }))!.out).toBe(true);
  });

  it('a trial counts the whole trial, not the month — boards and images', () => {
    const trial = allowance({ plan: 'trial', period: 'trial', boardsIncluded: 10, boardsUsed: 3, boardsLeft: 7, imagesIncluded: 10, imagesUsed: 1, imagesLeft: 9, purchaseEnabled: false, reasonCode: 'TRIAL' });
    expect(imagesLine(tPlan, 'en-US', trial)!.text).toBe('9 of 10 AI images left in your free trial');
    const b = boardsLine(tBoards, 'en-US', trial)!;
    expect(b.text).toBe('7 of 10 AI boards left in your free trial');
    expect(b.note).toBeNull();
  });

  it('nothing on the tenant\'s own key', () => {
    expect(imagesLine(tPlan, 'en-US', allowance({ source: 'tenant', imagesLeft: null }))).toBeNull();
  });
});

describe('limits reached, in the operator\'s words', () => {
  it('images (month / trial) and trial boards', () => {
    expect(aiPaywallText(tPlan, { code: 'AI_CAP_REACHED', body: { unit: 'images', plan: 'ai' } })).toContain('contact us for more');
    expect(aiPaywallText(tPlan, { code: 'AI_CAP_REACHED', body: { unit: 'images', plan: 'trial' } })).toContain('free trial');
    expect(aiPaywallText(tPlan, { code: 'AI_CAP_REACHED', body: { unit: 'boards', plan: 'trial' } })).toContain('board designs');
    // the AI plan's monthly boards keep the server's own numbered message
    expect(aiPaywallText(tPlan, { code: 'AI_CAP_REACHED', body: { unit: 'boards', plan: 'ai' } })).toBeNull();
    expect(aiPaywallText(tPlan, { code: 'SOMETHING_ELSE' })).toBeNull();
  });
});
