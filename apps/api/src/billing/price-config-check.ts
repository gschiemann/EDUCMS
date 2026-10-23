/**
 * PRICE CONFIGURATION CHECK — the pure rules (billing go-live, 2026-10-22).
 *
 * The dashboard, /pricing, the Terms and the Add-payment sheet all quote the prices in
 * ai-plan.ts PLAN_PRICES ($20 / $200 VenueOS, $25 / $250 VenueOS + AI). What a customer is
 * actually CHARGED is whatever Stripe Price the four `STRIPE_PRICE_*` env vars point at. Nothing
 * tied the two together: a Price typed as $2.00, a yearly price pasted into the monthly slot, a
 * test-mode price id beside a live key, or a "package" price that bills per 10 screens would all
 * have gone live silently and charged every customer the wrong amount.
 *
 * `checkPlanPrice` compares ONE retrieved Stripe Price with what we advertise for its slot;
 * `summarizePriceCheck` adds the slot-level rules (both AI prices or neither). No Stripe SDK, no
 * env, no clock — every shape is pinned in price-config-check.spec.ts. StripeService runs it once
 * after boot (a loud log line either way) and on demand at GET /billing/config-check.
 */
import { PLAN_PRICES } from './ai-plan';

export type PriceSlot = 'STRIPE_PRICE_MONTHLY' | 'STRIPE_PRICE_ANNUAL' | 'STRIPE_PRICE_MONTHLY_AI' | 'STRIPE_PRICE_ANNUAL_AI';

export interface PriceSlotSpec {
  slot: PriceSlot;
  /** What the dashboard and /pricing quote for this slot, in USD cents per screen. */
  unitAmountCents: number;
  interval: 'month' | 'year';
  /** VenueOS + AI slots are optional as a PAIR (see summarizePriceCheck). */
  optional: boolean;
}

export const PRICE_SLOTS: ReadonlyArray<PriceSlotSpec> = [
  { slot: 'STRIPE_PRICE_MONTHLY', unitAmountCents: PLAN_PRICES.monthlyCents, interval: 'month', optional: false },
  { slot: 'STRIPE_PRICE_ANNUAL', unitAmountCents: PLAN_PRICES.annualCents, interval: 'year', optional: false },
  { slot: 'STRIPE_PRICE_MONTHLY_AI', unitAmountCents: PLAN_PRICES.monthlyAiCents, interval: 'month', optional: true },
  { slot: 'STRIPE_PRICE_ANNUAL_AI', unitAmountCents: PLAN_PRICES.annualAiCents, interval: 'year', optional: true },
];

/** The slice of a Stripe Price this check reads (the SDK's Price type is wider). */
export interface StripePriceLike {
  id?: string;
  active?: boolean | null;
  livemode?: boolean | null;
  currency?: string | null;
  type?: string | null;
  billing_scheme?: string | null;
  unit_amount?: number | null;
  recurring?: {
    interval?: string | null;
    interval_count?: number | null;
    usage_type?: string | null;
    trial_period_days?: number | null;
  } | null;
}

export interface PriceSlotResult {
  slot: PriceSlot;
  priceId: string | null;
  /** 'missing' = env var unset; 'unreadable' = Stripe could not return the Price. */
  state: 'ok' | 'wrong' | 'missing' | 'unreadable';
  /** Plain-English problems, each one fixable in the Stripe dashboard. Empty when ok. */
  problems: string[];
  /** Advisory only — never fails the check. */
  warnings: string[];
  expected: { unitAmountCents: number; interval: 'month' | 'year'; currency: 'usd' };
  actual: { unitAmountCents: number | null; interval: string | null; currency: string | null; livemode: boolean | null } | null;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * One slot. `keyLivemode` is whether the SECRET KEY is live (sk_live_ / rk_live_) — a test-mode
 * price can never be charged under a live key, and the reverse.
 */
export function checkPlanPrice(
  spec: PriceSlotSpec,
  priceId: string | null,
  price: StripePriceLike | null,
  keyLivemode: boolean | null,
  readError?: string | null,
): PriceSlotResult {
  const base = {
    slot: spec.slot,
    priceId,
    expected: { unitAmountCents: spec.unitAmountCents, interval: spec.interval, currency: 'usd' as const },
  };
  if (!priceId) {
    return { ...base, state: 'missing', problems: spec.optional ? [] : [`${spec.slot} is not set.`], warnings: [], actual: null };
  }
  if (!price) {
    return {
      ...base,
      state: 'unreadable',
      problems: [`Stripe could not return price ${priceId}${readError ? ` (${readError})` : ''} — check the id and that it belongs to the same account and mode as STRIPE_SECRET_KEY.`],
      warnings: [],
      actual: null,
    };
  }
  const problems: string[] = [];
  const warnings: string[] = [];
  const r = price.recurring ?? null;
  if (price.active === false) problems.push('The price is archived (inactive) in Stripe.');
  if ((price.currency ?? '').toLowerCase() !== 'usd') problems.push(`Currency is ${String(price.currency ?? 'unknown').toUpperCase()}, expected USD.`);
  if (price.type !== 'recurring' || !r) problems.push('The price is one-time; it must be recurring.');
  if (r && r.interval !== spec.interval) problems.push(`Billing period is every ${r.interval ?? '?'}, expected every ${spec.interval}.`);
  if (r && (r.interval_count ?? 1) !== 1) problems.push(`Billing period is every ${r.interval_count} ${r.interval}s, expected every 1 ${spec.interval}.`);
  if (r && r.usage_type && r.usage_type !== 'licensed') problems.push(`Usage type is "${r.usage_type}", expected "licensed" (per-unit quantity).`);
  if (price.billing_scheme && price.billing_scheme !== 'per_unit') problems.push(`Pricing model is "${price.billing_scheme}", expected "standard / per unit" (one screen = one unit).`);
  if (price.unit_amount !== spec.unitAmountCents) {
    problems.push(
      `Amount is ${price.unit_amount == null ? 'not set' : usd(price.unit_amount)} per screen, but the dashboard and /pricing advertise ${usd(spec.unitAmountCents)}.`,
    );
  }
  if (keyLivemode != null && price.livemode != null && price.livemode !== keyLivemode) {
    problems.push(
      price.livemode
        ? 'This is a LIVE-mode price, but STRIPE_SECRET_KEY is a test key.'
        : 'This is a TEST-mode price, but STRIPE_SECRET_KEY is a live key.',
    );
  }
  if (r?.trial_period_days) {
    warnings.push(
      `The price carries a ${r.trial_period_days}-day trial. VenueOS sets each customer's trial end itself; remove the trial from the price.`,
    );
  }
  return {
    ...base,
    state: problems.length ? 'wrong' : 'ok',
    problems,
    warnings,
    actual: {
      unitAmountCents: price.unit_amount ?? null,
      interval: r?.interval ?? null,
      currency: price.currency ?? null,
      livemode: price.livemode ?? null,
    },
  };
}

export interface PriceCheckSummary {
  /** Every configured slot matches, the required pair is set, and the AI pair is all-or-nothing. */
  ok: boolean;
  keyMode: 'test' | 'live' | 'unknown';
  /** The VenueOS + AI plan will be offered at checkout (both AI prices set). */
  aiPlanOffered: boolean;
  slots: PriceSlotResult[];
  /** Problems that are about the slots together, not one price. */
  problems: string[];
}

/** Secret-key mode from its prefix. Never logs or returns the key itself. */
export function keyModeOf(secretKey: string | null | undefined): 'test' | 'live' | 'unknown' {
  const k = (secretKey ?? '').trim();
  if (/^(sk|rk)_live_/.test(k)) return 'live';
  if (/^(sk|rk)_test_/.test(k)) return 'test';
  return 'unknown';
}

export function summarizePriceCheck(slots: PriceSlotResult[], keyMode: 'test' | 'live' | 'unknown'): PriceCheckSummary {
  const problems: string[] = [];
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  const aiM = bySlot.get('STRIPE_PRICE_MONTHLY_AI');
  const aiY = bySlot.get('STRIPE_PRICE_ANNUAL_AI');
  const aiSet = [aiM, aiY].filter((s) => s && s.state !== 'missing').length;
  if (aiSet === 1) {
    problems.push(
      'Only one VenueOS + AI price is set. Set both STRIPE_PRICE_MONTHLY_AI and STRIPE_PRICE_ANNUAL_AI, or neither — with one, the AI plan is hidden.',
    );
  }
  const slotProblems = slots.some((s) => s.problems.length > 0);
  return {
    ok: !slotProblems && problems.length === 0,
    keyMode,
    aiPlanOffered: aiSet === 2,
    slots,
    problems,
  };
}
