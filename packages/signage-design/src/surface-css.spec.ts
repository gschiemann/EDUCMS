/**
 * surface-css.spec.ts — the DEPTH treatment (2026-06-27 richness pass).
 *
 * Asserts the new layered-background / premium-card / accent-divider CSS:
 *   - is built for EVERY curated theme + brand-derived themes,
 *   - is TAURUS-SAFE (no `inset` shorthand, no `gap`, no `backdrop-filter`),
 *   - tints with the theme accent (so brand identity reads on the board),
 *   - never collapses to a flat single-stop slab (the old failure mode).
 */

import {
  blend,
  cardFillCss,
  dividerCss,
  hexToRgba,
  imageHalfCss,
  themeBackgroundCss,
} from './surface-css';
import { THEMES, deriveThemeFromBrand, resolveSurfaceStyle } from './themes';

/** A CSS string is Taurus-safe if it never uses the banned shorthands. */
function isTaurusSafe(css: string): boolean {
  // `inset:` shorthand, `gap:` (flex/grid gap), `backdrop-filter` — all banned
  // on the player/widget surfaces (CLAUDE.md rule #10). The engine emits CSS
  // values only (gradients/colors/borders), so none should ever appear.
  return !/\binset\s*:/.test(css) && !/\bgap\s*:/.test(css) && !/backdrop-filter/.test(css);
}

describe('themeBackgroundCss — layered depth, never a flat slab', () => {
  it('builds a multi-stop gradient stack for every curated theme', () => {
    for (const t of THEMES) {
      const css = themeBackgroundCss(t);
      // Must reference a gradient (not a single solid color).
      expect(css).toMatch(/gradient\(/);
      // Must have at least two color stops somewhere (depth, not a slab).
      const stops = css.match(/#[0-9a-fA-F]{3,8}|rgba?\(/g) || [];
      expect(stops.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('tints the background with the theme accent (glow) on themes that ask for it', () => {
    for (const t of THEMES) {
      const style = resolveSurfaceStyle(t);
      const css = themeBackgroundCss(t);
      if (style.glow > 0.01) {
        // The accent (as rgba) must appear — the brand glow.
        const { r, g, b } = require('./contrast').parseHex(t.palette.accent);
        expect(css).toContain(`rgba(${r}, ${g}, ${b}`);
      }
    }
  });

  it('is Taurus-safe for every curated theme', () => {
    for (const t of THEMES) {
      expect(isTaurusSafe(themeBackgroundCss(t))).toBe(true);
    }
  });

  it('works for a brand-derived theme (no curated surfaceStyle)', () => {
    const brand = deriveThemeFromBrand('#e11d48', { mode: 'dark' });
    expect(brand.surfaceStyle).toBeUndefined(); // brand themes omit it
    const css = themeBackgroundCss(brand);
    expect(css).toMatch(/gradient\(/);
    expect(isTaurusSafe(css)).toBe(true);
  });

  it('gives a light brand theme an airy wash with a restrained glow', () => {
    const brand = deriveThemeFromBrand('#2563eb', { mode: 'light' });
    const style = resolveSurfaceStyle(brand);
    expect(style.background).toBe('wash');
    expect(style.glow).toBeLessThan(0.5);
  });
});

describe('cardFillCss — premium card, not a flat rounded rect', () => {
  it('returns a gradient background + accent hairline border for gradient themes', () => {
    const t = THEMES.find((x) => resolveSurfaceStyle(x).card === 'gradient')!;
    const fill = cardFillCss(t);
    expect(fill.background).toMatch(/gradient\(/);
    expect(fill.border).toContain('1px solid');
    expect(fill.boxShadow).toMatch(/rgba/);
    expect(isTaurusSafe(fill.background)).toBe(true);
  });

  it('a flat-card theme returns a solid surface fill', () => {
    const t = THEMES.find((x) => resolveSurfaceStyle(x).card === 'flat')!;
    const fill = cardFillCss(t);
    expect(fill.background).toBe(t.palette.surface);
  });

  it('glass cards never use backdrop-filter (Taurus)', () => {
    const t = THEMES.find((x) => resolveSurfaceStyle(x).card === 'glass');
    if (t) {
      const fill = cardFillCss(t);
      expect(isTaurusSafe(fill.background)).toBe(true);
      expect(fill.background).toMatch(/gradient\(/);
    }
  });
});

describe('dividerCss — the accent rule that anchors copy', () => {
  it('is a tapered accent gradient for every theme', () => {
    for (const t of THEMES) {
      const d = dividerCss(t);
      expect(d.background).toMatch(/linear-gradient\(90deg/);
      // Solid accent at one end, transparent accent at the other.
      const { r, g, b } = require('./contrast').parseHex(t.palette.accent);
      expect(d.background).toContain(`rgba(${r}, ${g}, ${b}, 0)`);
      expect(d.thicknessPx).toBeGreaterThan(0);
      expect(isTaurusSafe(d.background)).toBe(true);
    }
  });
});

describe('imageHalfCss — bold accent→surface field', () => {
  it('is a diagonal accent→surface ramp, Taurus-safe', () => {
    for (const t of THEMES) {
      const css = imageHalfCss(t);
      expect(css).toMatch(/linear-gradient\(135deg/);
      expect(css).toContain(t.palette.accent);
      expect(isTaurusSafe(css)).toBe(true);
    }
  });
});

describe('helpers', () => {
  it('hexToRgba parses #rrggbb and clamps alpha', () => {
    expect(hexToRgba('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(hexToRgba('#fff', 2)).toBe('rgba(255, 255, 255, 1)');
    expect(hexToRgba('#000', -1)).toBe('rgba(0, 0, 0, 0)');
  });

  it('blend is a linear midpoint and clamps t', () => {
    expect(blend('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(blend('#000000', '#ffffff', 0)).toBe('#000000');
    expect(blend('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(blend('#000000', '#ffffff', 5)).toBe('#ffffff'); // clamped
  });

  it('helpers fall back gracefully on bad input (never throw)', () => {
    expect(() => hexToRgba('not-a-hex', 0.5)).not.toThrow();
    expect(() => blend('xyz', '#fff', 0.5)).not.toThrow();
  });
});
