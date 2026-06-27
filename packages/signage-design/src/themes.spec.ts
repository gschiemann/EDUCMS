import { contrastRatio, BODY_CONTRAST_FLOOR, LARGE_CONTRAST_FLOOR } from './contrast';
import { Hct, TonalPalette, argbFromHex, hexFromArgb } from './hct';
import { THEMES, deriveThemeFromBrand, getTheme } from './themes';
import type { ThemeBundle } from './types';

function assertThemeLegible(t: ThemeBundle) {
  // ink must clear the BODY floor on both background and surface.
  expect(contrastRatio(t.palette.ink, t.palette.background)).toBeGreaterThanOrEqual(
    BODY_CONTRAST_FLOOR - 0.05,
  );
  expect(contrastRatio(t.palette.ink, t.palette.surface)).toBeGreaterThanOrEqual(
    BODY_CONTRAST_FLOOR - 0.05,
  );
  // muted must clear at least the LARGE floor on background.
  expect(contrastRatio(t.palette.muted, t.palette.background)).toBeGreaterThanOrEqual(
    LARGE_CONTRAST_FLOOR - 0.05,
  );
  // onAccent must clear the LARGE floor on the accent fill.
  expect(contrastRatio(t.palette.onAccent, t.palette.accent)).toBeGreaterThanOrEqual(
    LARGE_CONTRAST_FLOOR - 0.05,
  );
}

describe('HCT primitives', () => {
  it('argb <-> hex round-trips', () => {
    expect(hexFromArgb(argbFromHex('#ff8800'))).toBe('#ff8800');
  });

  it('Hct.fromInt reports tone 0 for black, ~100 for white', () => {
    expect(Hct.fromInt(argbFromHex('#000000')).tone).toBeCloseTo(0, 0);
    expect(Hct.fromInt(argbFromHex('#ffffff')).tone).toBeGreaterThan(99);
  });

  it('Hct.from(hue, chroma, tone) is reproducible and tone-accurate', () => {
    const h = Hct.from(120, 40, 50);
    // The solved color should report ~tone 50 back (within HCT solver tolerance).
    expect(h.tone).toBeCloseTo(50, 0);
  });

  it('TonalPalette tones are monotonic in luminance (perceptually even)', () => {
    const p = TonalPalette.fromHex('#1d4ed8');
    const lum = (t: number) => Hct.fromInt(argbFromHex(p.tone(t))).tone;
    expect(lum(10)).toBeLessThan(lum(50));
    expect(lum(50)).toBeLessThan(lum(90));
  });
});

describe('curated THEMES', () => {
  it('ships exactly 12 themes with unique ids', () => {
    expect(THEMES.length).toBe(12);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(12);
  });

  it('every theme uses at most 2 font families', () => {
    for (const t of THEMES) {
      const fams = new Set([t.fontPair.display, t.fontPair.body]);
      expect(fams.size).toBeLessThanOrEqual(2);
    }
  });

  it('never uses linear easing', () => {
    for (const t of THEMES) {
      expect(t.motion.easing).not.toBe('linear');
      expect(t.motion.durationMs).toBeGreaterThanOrEqual(300);
      expect(t.motion.durationMs).toBeLessThanOrEqual(500);
    }
  });

  it('every curated theme passes the contrast floors', () => {
    for (const t of THEMES) {
      assertThemeLegible(t);
    }
  });

  it('getTheme looks up by id', () => {
    expect(getTheme('warm-school')?.label).toBe('Warm School');
    expect(getTheme('nope')).toBeUndefined();
  });
});

describe('deriveThemeFromBrand — GUARANTEED contrast for any brand color', () => {
  // Garish / hard cases the critic called out explicitly.
  const hardColors = [
    '#ff6600', // safety orange
    '#39ff14', // neon green
    '#ff00ff', // magenta
    '#ffff00', // pure yellow (worst case for white text)
    '#000000', // black brand
    '#ffffff', // white brand
    '#1d4ed8', // a normal blue
    '#7f1d1d', // dark maroon
  ];

  it.each(hardColors)('dark-mode theme from %s passes all floors', (hex) => {
    const t = deriveThemeFromBrand(hex, { mode: 'dark' });
    assertThemeLegible(t);
  });

  it.each(hardColors)('light-mode theme from %s passes all floors', (hex) => {
    const t = deriveThemeFromBrand(hex, { mode: 'light' });
    assertThemeLegible(t);
  });

  it('respects an explicit accent hex while keeping onAccent legible', () => {
    const t = deriveThemeFromBrand('#1d4ed8', { accentHex: '#ff6600' });
    expect(contrastRatio(t.palette.onAccent, t.palette.accent)).toBeGreaterThanOrEqual(
      LARGE_CONTRAST_FLOOR - 0.05,
    );
  });

  it('tints the background with the brand hue (not pure black/white)', () => {
    const t = deriveThemeFromBrand('#1d4ed8', { mode: 'dark' });
    // Background is a dark brand tone, not literal #000000.
    expect(t.palette.background).not.toBe('#000000');
    expect(t.palette.background).not.toBe('#ffffff');
  });
});
