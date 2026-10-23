/**
 * Billing go-live (2026-10-22): the configured Stripe Prices must charge what the dashboard and
 * /pricing advertise. One case per way a price can be set up wrong in the Stripe dashboard.
 */
import {
  checkPlanPrice,
  keyModeOf,
  PRICE_SLOTS,
  summarizePriceCheck,
  type StripePriceLike,
} from './price-config-check';
import { PLAN_PRICES } from './ai-plan';

const spec = (slot: string) => PRICE_SLOTS.find((s) => s.slot === slot)!;

const good = (over: Partial<StripePriceLike> = {}, rec: Partial<NonNullable<StripePriceLike['recurring']>> = {}): StripePriceLike => ({
  id: 'price_x',
  active: true,
  livemode: false,
  currency: 'usd',
  type: 'recurring',
  billing_scheme: 'per_unit',
  unit_amount: 2000,
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed', trial_period_days: null, ...rec },
  ...over,
});

describe('price-config-check — the four slots are the advertised prices', () => {
  it('slots carry exactly the PLAN_PRICES numbers ($20/mo, $200/yr, $25/mo, $250/yr)', () => {
    expect(PRICE_SLOTS.map((s) => [s.slot, s.unitAmountCents, s.interval])).toEqual([
      ['STRIPE_PRICE_MONTHLY', 2000, 'month'],
      ['STRIPE_PRICE_ANNUAL', 20000, 'year'],
      ['STRIPE_PRICE_MONTHLY_AI', 2500, 'month'],
      ['STRIPE_PRICE_ANNUAL_AI', 25000, 'year'],
    ]);
    expect(PLAN_PRICES).toEqual({ monthlyCents: 2000, annualCents: 20000, monthlyAiCents: 2500, annualAiCents: 25000 });
  });
});

describe('checkPlanPrice', () => {
  const M = spec('STRIPE_PRICE_MONTHLY');
  const Y = spec('STRIPE_PRICE_ANNUAL');

  it('a correctly set up $20/month per-screen USD test price passes', () => {
    const r = checkPlanPrice(M, 'price_m', good(), false);
    expect(r.state).toBe('ok');
    expect(r.problems).toEqual([]);
  });

  it('the annual $200/year price passes in its own slot', () => {
    const r = checkPlanPrice(Y, 'price_y', good({ unit_amount: 20000 }, { interval: 'year' }), false);
    expect(r.state).toBe('ok');
  });

  it('a wrong amount fails and names both numbers', () => {
    const r = checkPlanPrice(M, 'price_m', good({ unit_amount: 200 }), false);
    expect(r.state).toBe('wrong');
    expect(r.problems.join(' ')).toMatch(/\$2\.00 per screen.*\$20\.00/);
  });

  it('a yearly price pasted into the monthly slot fails', () => {
    const r = checkPlanPrice(M, 'price_m', good({ unit_amount: 2000 }, { interval: 'year' }), false);
    expect(r.state).toBe('wrong');
    expect(r.problems.join(' ')).toMatch(/every year, expected every month/);
  });

  it('every-3-months fails', () => {
    expect(checkPlanPrice(M, 'p', good({}, { interval_count: 3 }), false).state).toBe('wrong');
  });

  it('a one-time price fails', () => {
    const r = checkPlanPrice(M, 'p', good({ type: 'one_time', recurring: null }), false);
    expect(r.problems.join(' ')).toMatch(/one-time/);
  });

  it('a metered or package/tiered price fails (quantity would not be screens)', () => {
    expect(checkPlanPrice(M, 'p', good({}, { usage_type: 'metered' }), false).state).toBe('wrong');
    expect(checkPlanPrice(M, 'p', good({ billing_scheme: 'tiered', unit_amount: null }), false).state).toBe('wrong');
  });

  it('a non-USD price fails', () => {
    expect(checkPlanPrice(M, 'p', good({ currency: 'eur' }), false).problems.join(' ')).toMatch(/EUR/);
  });

  it('an archived price fails', () => {
    expect(checkPlanPrice(M, 'p', good({ active: false }), false).state).toBe('wrong');
  });

  it('a test-mode price under a live key fails, and the reverse', () => {
    expect(checkPlanPrice(M, 'p', good({ livemode: false }), true).problems.join(' ')).toMatch(/TEST-mode price.*live key/);
    expect(checkPlanPrice(M, 'p', good({ livemode: true }), false).problems.join(' ')).toMatch(/LIVE-mode price.*test key/);
  });

  it('a trial on the price is a warning, not a failure', () => {
    const r = checkPlanPrice(M, 'p', good({}, { trial_period_days: 14 }), false);
    expect(r.state).toBe('ok');
    expect(r.warnings[0]).toMatch(/14-day trial/);
  });

  it('an id Stripe cannot return is "unreadable" with the reason', () => {
    const r = checkPlanPrice(M, 'price_typo', null, false, 'No such price');
    expect(r.state).toBe('unreadable');
    expect(r.problems[0]).toMatch(/price_typo.*No such price/);
  });

  it('a missing required slot is a problem; a missing AI slot is not', () => {
    expect(checkPlanPrice(M, null, null, false).problems).toHaveLength(1);
    expect(checkPlanPrice(spec('STRIPE_PRICE_MONTHLY_AI'), null, null, false).problems).toEqual([]);
  });
});

describe('summarizePriceCheck', () => {
  const ok = (slot: string, cents: number, interval: 'month' | 'year') =>
    checkPlanPrice(spec(slot), 'price_' + slot, good({ unit_amount: cents }, { interval }), false);

  it('all four correct → ok, AI plan offered', () => {
    const r = summarizePriceCheck(
      [ok('STRIPE_PRICE_MONTHLY', 2000, 'month'), ok('STRIPE_PRICE_ANNUAL', 20000, 'year'), ok('STRIPE_PRICE_MONTHLY_AI', 2500, 'month'), ok('STRIPE_PRICE_ANNUAL_AI', 25000, 'year')],
      'test',
    );
    expect(r).toMatchObject({ ok: true, aiPlanOffered: true, problems: [] });
  });

  it('no AI prices → still ok, AI plan not offered', () => {
    const r = summarizePriceCheck(
      [
        ok('STRIPE_PRICE_MONTHLY', 2000, 'month'),
        ok('STRIPE_PRICE_ANNUAL', 20000, 'year'),
        checkPlanPrice(spec('STRIPE_PRICE_MONTHLY_AI'), null, null, false),
        checkPlanPrice(spec('STRIPE_PRICE_ANNUAL_AI'), null, null, false),
      ],
      'live',
    );
    expect(r).toMatchObject({ ok: true, aiPlanOffered: false });
  });

  it('only one AI price → not ok (the AI plan would be silently hidden)', () => {
    const r = summarizePriceCheck(
      [
        ok('STRIPE_PRICE_MONTHLY', 2000, 'month'),
        ok('STRIPE_PRICE_ANNUAL', 20000, 'year'),
        ok('STRIPE_PRICE_MONTHLY_AI', 2500, 'month'),
        checkPlanPrice(spec('STRIPE_PRICE_ANNUAL_AI'), null, null, false),
      ],
      'test',
    );
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/Only one VenueOS \+ AI price/);
  });

  it('one wrong slot fails the whole check', () => {
    const r = summarizePriceCheck([ok('STRIPE_PRICE_MONTHLY', 2500, 'month'), ok('STRIPE_PRICE_ANNUAL', 20000, 'year')], 'test');
    expect(r.ok).toBe(false);
  });
});

describe('keyModeOf', () => {
  it('reads the mode from the prefix only', () => {
    expect(keyModeOf('sk_live_abc')).toBe('live');
    expect(keyModeOf('rk_live_abc')).toBe('live');
    expect(keyModeOf('sk_test_abc')).toBe('test');
    expect(keyModeOf('')).toBe('unknown');
    expect(keyModeOf(undefined)).toBe('unknown');
  });
});
