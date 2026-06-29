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
  // ACCENT-AS-TEXT (2026-06-28): the focal stat / accent text sits ON the
  // background, so the accent MUST clear the LARGE floor as text there too —
  // otherwise art-director.ts silently flips the focal stat to plain white and
  // the brand pop vanishes (the old bold-retail / midnight-tech failure).
  expect(contrastRatio(t.palette.accent, t.palette.background)).toBeGreaterThanOrEqual(
    LARGE_CONTRAST_FLOOR - 0.05,
  );
  // SECONDARY ACCENT (2026-06-28): when present, accent2 must clear the LARGE
  // floor as text on background AND its onAccent2 must clear it on the fill.
  if (t.palette.accent2) {
    expect(contrastRatio(t.palette.accent2, t.palette.background)).toBeGreaterThanOrEqual(
      LARGE_CONTRAST_FLOOR - 0.05,
    );
    if (t.palette.onAccent2) {
      expect(contrastRatio(t.palette.onAccent2, t.palette.accent2)).toBeGreaterThanOrEqual(
        LARGE_CONTRAST_FLOOR - 0.05,
      );
    }
  }
}

/** HCT chroma of a hex (0 = grey, higher = more saturated). */
function chromaOf(hex: string): number {
  return Hct.fromInt(argbFromHex(hex)).chroma;
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
  it('ships exactly 17 themes with unique ids', () => {
    expect(THEMES.length).toBe(17);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(17);
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

  it('every curated theme ships a secondary accent (accent2 system)', () => {
    for (const t of THEMES) {
      expect(typeof t.palette.accent2).toBe('string');
      expect(t.palette.accent2).toMatch(/^#[0-9a-fA-F]{6}$/);
      // accent2 should be a DISTINCT hue, not a clone of the primary accent.
      expect(t.palette.accent2).not.toBe(t.palette.accent);
    }
  });

  it('every curated theme carries typographic detail tokens', () => {
    for (const t of THEMES) {
      // display weight set per face (serif 600-800, condensed/sans 400-800).
      expect(typeof t.fontPair.displayWeight).toBe('number');
      expect(typeof t.fontPair.displayTracking).toBe('string');
      expect(typeof t.fontPair.kickerTracking).toBe('string');
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

  it('derives a secondary accent (accent2) for every brand color', () => {
    for (const hex of hardColors) {
      const t = deriveThemeFromBrand(hex, { mode: 'dark' });
      expect(t.palette.accent2).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  // PASTEL FIX (2026-06-28): the old code lightened the accent to tone 70, which
  // washed a high-chroma brand into a pastel (Coca-Cola red → salmon). The fix
  // keeps the accent SATURATED — for a high-chroma seed the derived accent must
  // retain a meaningful fraction of the seed's chroma, NOT collapse toward grey.
  it.each([
    '#e61a27', // Coca-Cola red
    '#ff1493', // hot pink
    '#1d4ed8', // a strong blue
    '#16a34a', // a vivid green
  ])('keeps a high-chroma brand %s vivid (no pastel collapse)', (hex) => {
    const seedChroma = chromaOf(hex);
    const t = deriveThemeFromBrand(hex, { mode: 'dark' });
    const accentChroma = chromaOf(t.palette.accent);
    // The derived accent must retain >= 55% of the seed's chroma — a pastel
    // (tone-70) derivation drops well below half. This is the brand-fidelity guard.
    expect(accentChroma).toBeGreaterThanOrEqual(seedChroma * 0.55);
  });
});
