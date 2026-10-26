import { LICENSE_TIERS } from './billing';
import { licenseTierCopy } from './billing-copy';

describe('plan card words in every language', () => {
  it('English is the catalog itself, unchanged', () => {
    for (const tier of LICENSE_TIERS) {
      expect(licenseTierCopy(tier, 'en')).toEqual({ name: tier.name, blurb: tier.blurb, features: tier.features });
    }
  });

  it('every tier has Spanish and Chinese words, with the same number of features', () => {
    for (const locale of ['es', 'zh']) {
      for (const tier of LICENSE_TIERS) {
        const copy = licenseTierCopy(tier, locale);
        expect(copy.name).not.toBe(tier.name);
        expect(copy.blurb.trim()).not.toBe('');
        expect(copy.features).toHaveLength(tier.features.length);
      }
    }
  });

  it('prices come from the tier itself, never typed twice', () => {
    const monthly = LICENSE_TIERS.find((t) => t.id === 'MONTHLY')!;
    expect(licenseTierCopy(monthly, 'es').blurb).toContain('$20');
    expect(licenseTierCopy(monthly, 'es').blurb).toContain('$25');
    expect(licenseTierCopy({ ...monthly, monthlyPriceCents: 3000, aiMonthlyPriceCents: 3600 }, 'zh').blurb).toContain('$30');
    expect(licenseTierCopy({ ...monthly, monthlyPriceCents: 3000, aiMonthlyPriceCents: 3600 }, 'es').features.join(' ')).toContain('+$6');
  });

  it('no internal jargon reaches a customer', () => {
    for (const locale of ['es', 'zh']) {
      for (const tier of LICENSE_TIERS) {
        expect(JSON.stringify(licenseTierCopy(tier, locale))).not.toMatch(/SUPER_ADMIN|License\.notes/);
      }
    }
  });

  it('an unknown tier falls back to its own words', () => {
    const odd = { ...LICENSE_TIERS[0], id: 'NEW_THING' as never, name: 'New thing' };
    expect(licenseTierCopy(odd, 'es').name).toBe('New thing');
  });
});
