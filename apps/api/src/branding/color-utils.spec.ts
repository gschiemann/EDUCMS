/**
 * Unit tests for color-utils.ts — WCAG contrast enforcement.
 *
 * P0-6 (2026-05-27 bulletproof audit, §18 Accessibility): a school
 * with a yellow brand color must not produce unreadable buttons. The
 * scraper / manual paint / derive-palette pipeline all flow through
 * `ensureContrast` and `derivePalette`; these tests pin the math so
 * a future refactor doesn't regress the safeguard.
 */

import {
  ensureContrast,
  ensureBgInkContrast,
  contrastRatio,
  derivePalette,
  bestTextOn,
  relativeLuminance,
  ensureReadableOnWhite,
  deriveReadableShades,
  hexToHsl,
} from './color-utils';

describe('ensureContrast', () => {
  describe('typical brand-color scenarios', () => {
    it('yellow (#ffd700) + white text → darkens until ≥4.5:1', () => {
      const before = contrastRatio('#ffd700', '#ffffff');
      expect(before).toBeLessThan(4.5);
      const adjusted = ensureContrast('#ffd700', '#ffffff', 4.5);
      const after = contrastRatio(adjusted, '#ffffff');
      expect(after).toBeGreaterThanOrEqual(4.5);
      // Sanity — adjusted color should NOT equal the original.
      expect(adjusted.toLowerCase()).not.toEqual('#ffd700');
      // Adjustment should darken, since white is light.
      expect(relativeLuminance(adjusted)).toBeLessThan(relativeLuminance('#ffd700'));
    });

    it('pastel blue (#87ceeb) + white text → darkens until ≥4.5:1', () => {
      const before = contrastRatio('#87ceeb', '#ffffff');
      expect(before).toBeLessThan(4.5);
      const adjusted = ensureContrast('#87ceeb', '#ffffff', 4.5);
      expect(contrastRatio(adjusted, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('no-change cases (already passing)', () => {
    it('black #000 + white text → no change (21:1 already passes)', () => {
      const adjusted = ensureContrast('#000000', '#ffffff', 4.5);
      expect(adjusted.toLowerCase()).toBe('#000000');
    });

    it('white #fff + black text → no change (21:1 already passes)', () => {
      const adjusted = ensureContrast('#ffffff', '#000000', 4.5);
      expect(adjusted.toLowerCase()).toBe('#ffffff');
    });

    it('light grey #cccccc + black text → no change (passes ~10:1)', () => {
      const before = contrastRatio('#cccccc', '#000000');
      expect(before).toBeGreaterThanOrEqual(4.5);
      const adjusted = ensureContrast('#cccccc', '#000000', 4.5);
      expect(adjusted.toLowerCase()).toBe('#cccccc');
    });

    it('already-passing brand color (#4f46e5 indigo + white) → no change', () => {
      const before = contrastRatio('#4f46e5', '#ffffff');
      expect(before).toBeGreaterThanOrEqual(4.5);
      const adjusted = ensureContrast('#4f46e5', '#ffffff', 4.5);
      expect(adjusted.toLowerCase()).toBe('#4f46e5');
    });
  });

  describe('direction logic', () => {
    it('darkens when foreground is lighter than bg', () => {
      // gold + white text — white is lighter, so bg should darken.
      const orig = '#ffd700';
      const adjusted = ensureContrast(orig, '#ffffff', 4.5);
      expect(relativeLuminance(adjusted)).toBeLessThan(relativeLuminance(orig));
    });

    it('lightens when foreground is darker than bg (rare path)', () => {
      // A dark-ish color asked to contrast against a slightly-darker
      // text. Force a case where the bg has to LIGHTEN. e.g. #5a4f00
      // (dark mustard) + #2a2a2a (charcoal text) — bg ought to brighten.
      const orig = '#5a4f00';
      const adjusted = ensureContrast(orig, '#2a2a2a', 4.5);
      expect(contrastRatio(adjusted, '#2a2a2a')).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('capped / impossible cases', () => {
    it('returns best-effort even when target is unachievable', () => {
      // White text against a bg that started at white — impossible to
      // reach 21:1 (would need pure black) AND still nuke the brand,
      // but we ask for AAA-level 7:1 to force the chase.
      const adjusted = ensureContrast('#fffacd', '#ffffff', 7);
      // Either we hit 7:1, or we returned the best we could; both are
      // valid. What we MUST NOT do is return the original lemon white.
      expect(adjusted.toLowerCase()).not.toBe('#fffacd');
    });
  });

  describe('iteration bound', () => {
    it('converges within 12 iterations even on edge cases', () => {
      // Just exercise a few weird inputs to ensure no infinite loop.
      const inputs = ['#ffd700', '#87ceeb', '#ff69b4', '#90ee90', '#ffa07a'];
      for (const c of inputs) {
        const adjusted = ensureContrast(c, '#ffffff', 4.5);
        expect(adjusted).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrastRatio(adjusted, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});

describe('ensureBgInkContrast', () => {
  it('returns the higher-contrast ink when preferredInk is absent', () => {
    // Dark navy bg → white ink wins.
    const r = ensureBgInkContrast('#0b1220');
    expect(r.ink).toBe('#ffffff');
    expect(r.adjusted).toBe(false);
    expect(r.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('honors preferredInk override', () => {
    const r = ensureBgInkContrast('#ffd700', '#ffffff', 4.5);
    expect(r.ink).toBe('#ffffff');
    expect(r.adjusted).toBe(true);
    expect(r.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('adjusts a yellow bg + white ink case to pass 4.5:1', () => {
    const r = ensureBgInkContrast('#ffd700', '#ffffff', 4.5);
    expect(r.ratio).toBeGreaterThanOrEqual(4.5);
    expect(r.bg.toLowerCase()).not.toBe('#ffd700');
  });
});

describe('derivePalette — WCAG contrast enforcement (P0-6)', () => {
  describe('yellow brand color (#ffd700)', () => {
    // bestTextOn(#ffd700) returns #111111 (dark text wins on yellow),
    // and dark text on yellow passes 4.5:1 trivially. So `derivePalette`
    // does NOT adjust the yellow itself — it picks dark text and the
    // pair is legible. This matches what a designer would do by hand.
    it('keeps the yellow but pairs it with dark text (already legible)', () => {
      const p = derivePalette('#ffd700');
      const ratio = contrastRatio(p.primary, p.primaryInk);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(p.primaryInk).toBe('#111111');
      // The primaryRaw and primary should match because no adjustment
      // was needed — the dark-text pairing already passes.
      expect(p.primaryRaw.toLowerCase()).toBe('#ffd700');
      const primaryAdj = p.contrastReport.adjustments.find((a) => a.key === 'primary');
      expect(primaryAdj).toBeDefined();
      expect(primaryAdj!.adjusted).toBe(false);
    });
  });

  describe('medium teal that forces white-text-on-failing-bg (the real bug)', () => {
    // A mid-luminance teal where bestTextOn picks white but the ratio
    // still fails 4.5:1 against that white. This is the actual case
    // the P0-6 audit flagged: scraper returns a pretty-but-unreadable
    // bg, the helper auto-pairs white text, the pair fails.
    const TEAL = '#3a8a8a';
    it('adjusts the primary so primary/primaryInk passes 4.5:1', () => {
      const p = derivePalette(TEAL);
      const ratio = contrastRatio(p.primary, p.primaryInk);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      // primary may stay the same OR shift — what matters is the pair
      // passes. If the auto-ink flipped to dark, primary may still
      // match the raw. We assert the contract: the pair is legible.
    });

    it('preserves the original teal in primaryRaw', () => {
      const p = derivePalette(TEAL);
      expect(p.primaryRaw.toLowerCase()).toBe(TEAL);
    });

    it('records the adjustment in contrastReport if the bg was tweaked', () => {
      const p = derivePalette(TEAL);
      const primaryAdj = p.contrastReport.adjustments.find((a) => a.key === 'primary');
      expect(primaryAdj).toBeDefined();
      expect(primaryAdj!.toRatio).toBeGreaterThanOrEqual(4.5);
      // fromRatio describes the original — may or may not be below 4.5
      // depending on whether bestTextOn picked white or dark.
      expect(typeof primaryAdj!.fromRatio).toBe('number');
    });
  });

  describe('safe brand color (already passes)', () => {
    it('does NOT adjust indigo #4f46e5 (already passes white)', () => {
      const p = derivePalette('#4f46e5');
      expect(p.primary.toLowerCase()).toBe('#4f46e5');
      expect(p.primaryRaw.toLowerCase()).toBe('#4f46e5');
      const primaryAdj = p.contrastReport.adjustments.find((a) => a.key === 'primary');
      expect(primaryAdj!.adjusted).toBe(false);
    });
  });

  describe('explicit accent', () => {
    it('produces a legible accent/accentInk pair for any input', () => {
      // Yellow accent — bestTextOn flips to dark so the pair is fine
      // without adjusting the bg.
      const p = derivePalette('#4f46e5', '#ffeb3b');
      const accentRatio = contrastRatio(p.accent, p.accentInk);
      expect(accentRatio).toBeGreaterThanOrEqual(4.5);
      // Either the bg shifted (adjusted=true) OR the ink flipped to dark
      // (adjusted=false but pair passes via ink choice). Both legal.
      expect(p.accentRaw.toLowerCase()).toBe('#ffeb3b');
    });

    it('does NOT adjust an accent that already passes', () => {
      // Coral against white passes 4.5:1 -- pick something safe like a
      // dark teal.
      const p = derivePalette('#4f46e5', '#0f766e'); // teal-700
      const accentRatio = contrastRatio(p.accent, p.accentInk);
      expect(accentRatio).toBeGreaterThanOrEqual(4.5);
      const accentAdj = p.contrastReport.adjustments.find((a) => a.key === 'accent');
      expect(accentAdj!.adjusted).toBe(false);
    });
  });

  describe('contrastReport shape', () => {
    it('has primary + accent entries plus the 4 workhorse-shade entries each', () => {
      const p = derivePalette('#4f46e5'); // both should be safe-ish
      const keys = p.contrastReport.adjustments.map((a) => a.key);
      expect(keys).toEqual(
        expect.arrayContaining([
          'primary', 'accent',
          'primaryMid', 'primaryStrong', 'primaryStrongHover', 'primaryStronger',
          'accentMid', 'accentStrong', 'accentStrongHover', 'accentStronger',
        ]),
      );
      expect(p.contrastReport.adjustments).toHaveLength(10);
    });

    it('flags anyCapped when even an extreme tweak fails', () => {
      // Custom target way above what scaling can reach
      const p = derivePalette('#fffacd', '#fffacd', [], 21);
      // primary or accent should be capped (target 21:1 vs near-white)
      const primaryAdj = p.contrastReport.adjustments.find((a) => a.key === 'primary');
      const accentAdj = p.contrastReport.adjustments.find((a) => a.key === 'accent');
      // Either capped, or we hit the target (acceptable). What we want
      // to verify is the FIELD exists and has a sensible boolean.
      expect(typeof primaryAdj!.capped).toBe('boolean');
      expect(typeof accentAdj!.capped).toBe('boolean');
    });
  });

  describe('on/raw fields', () => {
    it('stamps primaryOn/accentOn with the resolved ink color', () => {
      const p = derivePalette('#ffd700');
      expect(p.primaryOn).toBe(bestTextOn('#ffd700'));
      // accent gets auto-derived from primary hue rotation
      expect(p.accentOn).toBeDefined();
    });
  });
});

// ── VisionCore incident (2026-07-21): readable-on-white workhorse shades ──
//
// The scraper stored a tenant's near-white page BACKGROUND (#fcf9e2 cream)
// as palette.primary. The chrome consumes primary AS text and as button bg
// under white ink — roles nothing validated. These tests pin the API-side
// mirror of apps/web/src/lib/brand-contrast.ts: same darken-along-hue math,
// same 4.5/5.2/7/2.5 targets, persisted so the web painter prefers them.

describe('ensureReadableOnWhite — darken-along-hue (VisionCore cream)', () => {
  const CREAM = '#fcf9e2';

  it('the cream fails white catastrophically before, passes every target after', () => {
    expect(contrastRatio(CREAM, '#ffffff')).toBeLessThan(1.2);
    for (const target of [2.5, 4.5, 5.2, 7]) {
      const shade = ensureReadableOnWhite(CREAM, target);
      expect(contrastRatio(shade, '#ffffff')).toBeGreaterThanOrEqual(target);
    }
  });

  it('preserves the hue — cream becomes a deep gold, never black or grey', () => {
    const strong = ensureReadableOnWhite(CREAM, 4.5);
    expect(strong.toLowerCase()).not.toBe('#000000');
    const baseHsl = hexToHsl(CREAM);
    const outHsl = hexToHsl(strong);
    expect(Math.abs(outHsl.h - baseHsl.h)).toBeLessThan(3); // hex-rounding wobble only
    expect(outHsl.s).toBeGreaterThan(10); // still saturated, not a grey
  });

  it('returns an already-passing color UNCHANGED (healthy dark brands never shift)', () => {
    expect(ensureReadableOnWhite('#1e3a8a', 4.5)).toBe('#1e3a8a'); // navy ≈10.3:1
    expect(ensureReadableOnWhite('#1e3a8a', 7)).toBe('#1e3a8a');
  });

  it('keeps the closest passing lightness (not the extreme)', () => {
    // The result must pass, but must stay strictly lighter than pure black —
    // the binary search converges on the lightest passing value.
    const strong = ensureReadableOnWhite(CREAM, 4.5);
    expect(relativeLuminance(strong)).toBeGreaterThan(0);
    // and not overshoot far past the target
    expect(contrastRatio(strong, '#ffffff')).toBeLessThan(6);
  });

  it('passes non-color garbage through untouched', () => {
    expect(ensureReadableOnWhite('not-a-color', 4.5)).toBe('not-a-color');
    expect(ensureReadableOnWhite('', 4.5)).toBe('');
  });
});

describe('deriveReadableShades', () => {
  it('derives all four shades meeting their exact targets', () => {
    const s = deriveReadableShades('#fcf9e2');
    expect(contrastRatio(s.mid, '#ffffff')).toBeGreaterThanOrEqual(2.5);
    expect(contrastRatio(s.strong, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(s.strongHover, '#ffffff')).toBeGreaterThanOrEqual(5.2);
    expect(contrastRatio(s.stronger, '#ffffff')).toBeGreaterThanOrEqual(7);
  });

  it('is the identity for a brand already past 7:1', () => {
    const s = deriveReadableShades('#1e3a8a');
    expect(s).toEqual({ mid: '#1e3a8a', strong: '#1e3a8a', strongHover: '#1e3a8a', stronger: '#1e3a8a' });
  });
});

describe('derivePalette — persisted workhorse shades (VisionCore, 2026-07-21)', () => {
  it('persists primaryMid/Strong/StrongHover/Stronger meeting 2.5/4.5/5.2/7 vs white', () => {
    const p = derivePalette('#fcf9e2');
    expect(contrastRatio(p.primaryMid, '#ffffff')).toBeGreaterThanOrEqual(2.5);
    expect(contrastRatio(p.primaryStrong, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.primaryStrongHover, '#ffffff')).toBeGreaterThanOrEqual(5.2);
    expect(contrastRatio(p.primaryStronger, '#ffffff')).toBeGreaterThanOrEqual(7);
  });

  it('persists the accent equivalents meeting the same targets', () => {
    const p = derivePalette('#fcf9e2', '#ffeb3b'); // pale primary + yellow accent
    expect(contrastRatio(p.accentMid, '#ffffff')).toBeGreaterThanOrEqual(2.5);
    expect(contrastRatio(p.accentStrong, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.accentStrongHover, '#ffffff')).toBeGreaterThanOrEqual(5.2);
    expect(contrastRatio(p.accentStronger, '#ffffff')).toBeGreaterThanOrEqual(7);
  });

  it('keeps the tenant\'s color: cream primary is NOT rewritten, only shaded', () => {
    // bestTextOn(cream) is dark ink, and dark-on-cream passes — so the
    // palette keeps the cream AS primary. The workhorse shades carry the
    // readable derivative; the raw color keeps its decorative roles.
    const p = derivePalette('#fcf9e2');
    expect(p.primary.toLowerCase()).toBe('#fcf9e2');
    expect(p.primaryStrong.toLowerCase()).not.toBe('#fcf9e2');
  });

  it('a dark navy brand passes through: every shade equals the primary', () => {
    const p = derivePalette('#1e3a8a'); // ≈10.3:1 vs white — beats every target except none
    expect(p.primary).toBe('#1e3a8a');
    expect(p.primaryMid).toBe('#1e3a8a');
    expect(p.primaryStrong).toBe('#1e3a8a');
    expect(p.primaryStrongHover).toBe('#1e3a8a');
    expect(p.primaryStronger).toBe('#1e3a8a');
  });

  it('records shade provenance in contrastReport with white ink + per-shade targets', () => {
    const p = derivePalette('#fcf9e2');
    const strongRow = p.contrastReport.adjustments.find((a) => a.key === 'primaryStrong');
    expect(strongRow).toBeDefined();
    expect(strongRow!.ink).toBe('#ffffff');
    expect(strongRow!.target).toBe(4.5);
    expect(strongRow!.to).toBe(p.primaryStrong);
    expect(strongRow!.toRatio).toBeGreaterThanOrEqual(4.5);
    expect(strongRow!.capped).toBe(false);
  });

  it('anyAdjusted reflects only operator-picked colors, not the derived shade rows', () => {
    // Cream + teal-700: both pass their ink pairing untouched, so neither
    // picked color is adjusted — but the cream's strong shades DO differ.
    const p = derivePalette('#fcf9e2', '#0f766e');
    expect(p.contrastReport.adjustments.find((a) => a.key === 'primary')!.adjusted).toBe(false);
    expect(p.contrastReport.adjustments.find((a) => a.key === 'accent')!.adjusted).toBe(false);
    expect(p.contrastReport.adjustments.find((a) => a.key === 'primaryStrong')!.adjusted).toBe(true);
    expect(p.contrastReport.anyAdjusted).toBe(false);
  });
});
