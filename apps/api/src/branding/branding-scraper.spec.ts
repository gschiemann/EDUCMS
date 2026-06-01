/**
 * pickBrandSegment — brand-name extraction from SEO <title> strings.
 *
 * Regression coverage for the recurring "can't brand Domino's" report
 * (2026-06-01): dominos.com has no og:site_name, so the scraper landed the
 * full SEO title "Pizza Delivery & Carryout, Pasta, Wings & More | Domino's"
 * as the display name. The brand is the short trailing segment.
 */
import { pickBrandSegment } from './branding-scraper.service';

describe('pickBrandSegment', () => {
  it('pulls the brand out of a "<SEO phrase> | Brand" title (Domino\'s)', () => {
    expect(
      pickBrandSegment("Pizza Delivery & Carryout, Pasta, Wings & More | Domino's"),
    ).toBe("Domino's");
  });

  it('keeps the team name and drops the domain segment', () => {
    expect(pickBrandSegment('Los Angeles Dodgers | MLB.com')).toBe('Los Angeles Dodgers');
  });

  it('prefers an exact og:site_name match among brand-like segments', () => {
    expect(pickBrandSegment('Order Online | Acme Pizza Co', 'Acme Pizza Co')).toBe('Acme Pizza Co');
  });

  it('leaves a single-segment name untouched', () => {
    expect(pickBrandSegment("Domino's")).toBe("Domino's");
    expect(pickBrandSegment('The Home Depot')).toBe('The Home Depot');
  });

  it('does not split a hyphenated brand name', () => {
    expect(pickBrandSegment('Coca-Cola')).toBe('Coca-Cola');
  });

  it('leaves it unchanged when NO segment is clearly brand-like (no bad guesses)', () => {
    const t = 'Big Long Marketing Phrase, With Commas | Another Long Descriptive Phrase Here Too';
    expect(pickBrandSegment(t)).toBe(t);
  });

  // Real titles observed in a 2026-06-01 sweep of live brand sites.
  it('splits on colon+space and takes the brand (McDonald\'s)', () => {
    expect(pickBrandSegment("McDonald's: Burgers, Fries & More. Quality Ingredients.")).toBe("McDonald's");
  });

  it('handles "Target : Expect More. Pay Less." → "Target"', () => {
    expect(pickBrandSegment('Target : Expect More. Pay Less.')).toBe('Target');
  });

  it('strips a bare-domain TLD (Nike.com → Nike)', () => {
    expect(pickBrandSegment('Nike.com')).toBe('Nike');
  });

  it('does NOT split a time-like "10:30 Diner" (no space after colon)', () => {
    expect(pickBrandSegment('10:30 Diner')).toBe('10:30 Diner');
  });

  it('handles null safely', () => {
    expect(pickBrandSegment(null)).toBeNull();
    expect(pickBrandSegment(undefined)).toBeNull();
  });
});
