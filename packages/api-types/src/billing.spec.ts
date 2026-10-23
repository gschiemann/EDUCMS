/**
 * Product-truth lock on the license/pricing catalog (audit W0-07).
 *
 * On 2026-07-12 the audit found the pricing SURFACES conflicted: marketing
 * said $25/screen/month while this catalog — the single source both the
 * billing page and Stripe checkout read — charged $15/mo · $150/yr.
 *
 * Greg's decision (2026-10-12, replacing 2026-07-13's $25/$240): every paid
 * plan is sold with or without AI —
 *   VenueOS        $20 / screen / month · $200 / screen / year
 *   VenueOS + AI   $25 / screen / month · $250 / screen / year
 * 14-day / 3-screen free trial (with AI). These asserts make a silent drift
 * back to old numbers fail CI instead of shipping a lie to a customer. Change
 * them only alongside a deliberate pricing change.
 */

import { LICENSE_TIERS, getLicenseTier } from './billing';
import { CAPABILITY_REGISTRY } from './capability-registry';

describe('license pricing catalog — product truth (W0-07, repriced 2026-10-12)', () => {
  it('Monthly is $20 / screen / month, $25 with AI', () => {
    const monthly = getLicenseTier('MONTHLY');
    expect(monthly?.monthlyPriceCents).toBe(2000);
    expect(monthly?.aiMonthlyPriceCents).toBe(2500);
  });

  it('Annual is $200 / screen / year, $250 with AI (two months free vs monthly)', () => {
    const annual = getLicenseTier('ANNUAL');
    expect(annual?.annualPriceCents).toBe(20000);
    expect(annual?.aiAnnualPriceCents).toBe(25000);
    expect(20000).toBe(2000 * 10);
    expect(25000).toBe(2500 * 10);
  });

  it('Free trial is 14 days / 3 screens / no charge, AI included', () => {
    const trial = getLicenseTier('FREE_TRIAL');
    expect(trial?.seatLimit).toBe(3);
    expect(trial?.monthlyPriceCents).toBe(0);
    expect(trial?.blurb).toMatch(/14 days/i);
    expect(trial?.blurb).toMatch(/3 screens/i);
    expect(trial?.blurb).toMatch(/AI/);
  });

  it('no public tier still advertises a retired price ($15/$150, $25/$240 without AI)', () => {
    for (const t of LICENSE_TIERS) {
      expect(t.monthlyPriceCents).not.toBe(1500);
      expect(t.annualPriceCents).not.toBe(15000);
      expect(t.annualPriceCents).not.toBe(24000);
      if (t.id === 'MONTHLY') expect(t.monthlyPriceCents).not.toBe(2500);
      expect(t.blurb).not.toMatch(/\$240/);
    }
  });
});

describe('pricing claims elsewhere in the catalog (billing go-live, 2026-10-22)', () => {
  it('the pricing capability claim states the current prices, not the retired $25/$240', () => {
    const cap = CAPABILITY_REGISTRY.find((c) => c.id === 'pricing-plan-truth');
    expect(cap?.publicClaim).toMatch(/\$20 per screen \/ month/);
    expect(cap?.publicClaim).toMatch(/\$200/);
    expect(cap?.publicClaim).toMatch(/\$25 /);
    expect(cap?.publicClaim).toMatch(/\$250/);
    expect(cap?.publicClaim).not.toMatch(/\$240/);
  });

  it('the free trial advertises the trial AI allowance the API enforces (AI_TRIAL_BOARDS / _IMAGES default 2 / 2)', () => {
    const trial = getLicenseTier('FREE_TRIAL');
    expect(trial?.features).toContain('AI included (2 board designs + 2 images)');
  });
});
