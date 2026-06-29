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
  ENTRANCE_KEYFRAMES_CSS,
  badgeCss,
  blend,
  cardFillCss,
  dividerCss,
  entranceAnimName,
  hexToRgba,
  imageHalfCss,
  imageTreatmentCss,
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
  it('is a tapered secondary-accent gradient for every theme', () => {
    for (const t of THEMES) {
      const d = dividerCss(t); // default = secondary accent (accent2)
      expect(d.background).toMatch(/linear-gradient\(90deg/);
      // Solid accent2 at one end, transparent accent2 at the other.
      const c = t.palette.accent2 ?? t.palette.accent;
      const { r, g, b } = require('./contrast').parseHex(c);
      expect(d.background).toContain(`rgba(${r}, ${g}, ${b}, 0)`);
      expect(d.thicknessPx).toBeGreaterThan(0);
      expect(isTaurusSafe(d.background)).toBe(true);
    }
  });

  it('honors useSecondary:false (primary accent for the card top-bar)', () => {
    const t = THEMES[0];
    const d = dividerCss(t, false);
    const { r, g, b } = require('./contrast').parseHex(t.palette.accent);
    expect(d.background).toContain(`rgba(${r}, ${g}, ${b}, 0)`);
  });
});

describe('badgeCss — the kicker-as-badge chip', () => {
  it('returns a Taurus-safe filled/outline recipe per theme', () => {
    for (const t of THEMES) {
      const b = badgeCss(t);
      expect(['filled', 'outline']).toContain(b.variant);
      expect(typeof b.color).toBe('string');
      expect(isTaurusSafe(b.background)).toBe(true);
      if (b.border) expect(b.border).toContain('1px solid');
    }
  });

  it('minimal-luxury opts OUT of a badge (bare type is the look)', () => {
    const t = THEMES.find((x) => x.id === 'minimal-luxury')!;
    expect(badgeCss(t).enabled).toBe(false);
  });

  it('a high-energy dark theme uses a FILLED accent2 pill', () => {
    const t = THEMES.find((x) => x.id === 'neon-sports')!;
    const b = badgeCss(t);
    expect(b.enabled).toBe(true);
    expect(b.variant).toBe('filled');
    expect(b.background).toBe(t.palette.accent2);
  });
});

describe('entrance motion CSS', () => {
  it('exposes namespaced keyframes for every reveal kind', () => {
    expect(ENTRANCE_KEYFRAMES_CSS).toContain('@keyframes sigd-rise-fade');
    expect(ENTRANCE_KEYFRAMES_CSS).toContain('@keyframes sigd-fade');
    expect(ENTRANCE_KEYFRAMES_CSS).toContain('@keyframes sigd-pop');
    // transform/opacity ONLY — no banned/layout-thrashing props.
    expect(/\bwidth\s*:/.test(ENTRANCE_KEYFRAMES_CSS)).toBe(false);
    expect(/\binset\s*:/.test(ENTRANCE_KEYFRAMES_CSS)).toBe(false);
  });

  it('maps a kind to a keyframe name (none → undefined)', () => {
    expect(entranceAnimName('rise-fade')).toBe('sigd-rise-fade');
    expect(entranceAnimName('pop')).toBe('sigd-pop');
    expect(entranceAnimName('none')).toBeUndefined();
  });
});

describe('imageHalfCss — bold accent→accent2 field', () => {
  it('is a diagonal accent-led ramp, Taurus-safe', () => {
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

describe('imageTreatmentCss — art-directed photo grade + directional scrim', () => {
  it('builds a grade + directional scrim for every curated theme (Taurus-safe)', () => {
    for (const t of THEMES) {
      for (const anchor of ['bottom', 'left', 'right', 'center'] as const) {
        const tr = imageTreatmentCss(t, anchor);
        // Both layers must be gradient strings — never a bare slab.
        expect(tr.grade).toMatch(/gradient\(/);
        expect(tr.scrim).toMatch(/gradient\(/);
        // The grade blend is one of the two allowed modes.
        expect(['multiply', 'soft-light']).toContain(tr.gradeBlend);
        // BOTH layers must be Taurus-safe (no inset / gap / backdrop-filter).
        expect(isTaurusSafe(tr.grade)).toBe(true);
        expect(isTaurusSafe(tr.scrim)).toBe(true);
      }
    }
  });

  it('the scrim is DENSE near the text edge so headline contrast is guaranteed', () => {
    // The densest stop is a NEAR_BLACK at >= 0.62 alpha — the legibility floor
    // the flat scrim used to guarantee, kept on the directional one.
    for (const t of THEMES) {
      const tr = imageTreatmentCss(t, 'bottom');
      expect(tr.scrim).toMatch(/rgba\(10, 10, 10, 0\.(6[2-9]|7\d?|8\d?|9\d?)/);
    }
  });

  it('anchors the scrim to where the headline sits (direction differs per anchor)', () => {
    const t = THEMES[0];
    expect(imageTreatmentCss(t, 'bottom').scrim).toContain('linear-gradient(0deg');
    expect(imageTreatmentCss(t, 'left').scrim).toContain('linear-gradient(90deg');
    expect(imageTreatmentCss(t, 'right').scrim).toContain('linear-gradient(270deg');
    expect(imageTreatmentCss(t, 'center').scrim).toContain('radial-gradient(');
  });
});
