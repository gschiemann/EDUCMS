/**
 * Product-truth lock on the license/pricing catalog (audit W0-07).
 *
 * On 2026-07-12 the audit found the pricing SURFACES conflicted: marketing
 * said $25/screen/month while this catalog — the single source both the
 * billing page and Stripe checkout read — charged $15/mo · $150/yr.
 *
 * Greg's decision (2026-07-13): $25/screen/month; $240/screen/year annual
 * ($20/mo effective, 20% off); 14-day / 3-screen free trial. These asserts
 * make a silent drift back to the old numbers fail CI instead of shipping a
 * lie to a customer. Change them only alongside a deliberate pricing change.
 */

import { LICENSE_TIERS, getLicenseTier } from './billing';

describe('license pricing catalog — product truth (W0-07)', () => {
  it('Monthly is $25 / screen / month', () => {
    const monthly = getLicenseTier('MONTHLY');
    expect(monthly?.monthlyPriceCents).toBe(2500);
  });

  it('Annual is $240 / screen / year (= $20/mo effective, 20% off monthly)', () => {
    const annual = getLicenseTier('ANNUAL');
    expect(annual?.annualPriceCents).toBe(24000);
    // 20% cheaper than 12 months at $25 ($300/yr).
    expect(24000).toBe(Math.round(2500 * 12 * 0.8));
  });

  it('Free trial is 14 days / 3 screens / no charge', () => {
    const trial = getLicenseTier('FREE_TRIAL');
    expect(trial?.seatLimit).toBe(3);
    expect(trial?.monthlyPriceCents).toBe(0);
    expect(trial?.blurb).toMatch(/14 days/i);
    expect(trial?.blurb).toMatch(/3 screens/i);
  });

  it('no public tier still advertises the retired $15/$150 prices', () => {
    for (const t of LICENSE_TIERS) {
      expect(t.monthlyPriceCents).not.toBe(1500);
      expect(t.annualPriceCents).not.toBe(15000);
    }
  });
});
