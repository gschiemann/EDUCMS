/**
 * logo-colors — "the palette must harmonize with the chosen logo."
 *
 * Operator (2026-08-25): "why do you use colors that dont look good with
 * the logo ... it needs to look good for the customer on the first try."
 *
 * Before this, `derivePalette()` was fed purely from ranked PAGE CSS colors,
 * so a navy website with a magenta mark produced navy chrome beside a
 * magenta logo. These tests pin the new contract:
 *   - the MARK's colors drive primary/accent
 *   - a monochrome mark (or an undecodable one) falls all the way back to
 *     the page colors — i.e. the exact pre-2026-08-25 behavior
 *   - the logo BACKGROUND default ("do our best to get it right")
 */
import {
  extractSvgColors,
  svgInkLuminance,
  dominantColorsFromRgba,
  averageOpaqueLuminance,
  paletteFromLogoColors,
  suggestLogoBackground,
  isChromatic,
  isLogoBackground,
  LOGO_BACKGROUNDS,
} from './logo-colors';

// ── helpers ──────────────────────────────────────────────────────────
/** Build an RGBA buffer of n pixels of one color. */
function pixels(
  ...runs: Array<[r: number, g: number, b: number, a: number, count: number]>
): Uint8Array {
  const total = runs.reduce((sum, r) => sum + r[4], 0);
  const out = new Uint8Array(total * 4);
  let i = 0;
  for (const [r, g, b, a, count] of runs) {
    for (let k = 0; k < count; k++) {
      out[i++] = r;
      out[i++] = g;
      out[i++] = b;
      out[i++] = a;
    }
  }
  return out;
}

describe('isChromatic — black / white / grey are structure, not brand', () => {
  it('accepts real brand colors', () => {
    expect(isChromatic('#e8112d')).toBe(true); // Domino's red
    expect(isChromatic('#c2185b')).toBe(true); // a magenta lotus
    expect(isChromatic('#005a9c')).toBe(true); // Dodger blue
  });
  it('rejects greyscale and the extremes', () => {
    expect(isChromatic('#000000')).toBe(false);
    expect(isChromatic('#ffffff')).toBe(false);
    expect(isChromatic('#808080')).toBe(false);
    expect(isChromatic('#f8f8f8')).toBe(false);
    expect(isChromatic('#111111')).toBe(false);
  });
});

describe('extractSvgColors — inline / URL vector marks', () => {
  it('pulls fill + stroke colors and ranks by occurrence', () => {
    const svg =
      '<svg viewBox="0 0 100 40">' +
      '<path fill="#c2185b" d="M0 0h10v10H0z"/>' +
      '<path fill="#c2185b" d="M20 0h10v10H20z"/>' +
      '<circle stroke="#f9a825" cx="5" cy="5" r="4"/>' +
      '</svg>';
    const out = extractSvgColors(svg);
    expect(out[0].hex).toBe('#c2185b');
    expect(out.map((c) => c.hex)).toContain('#f9a825');
    expect(out[0].share).toBeGreaterThan(0);
  });

  it('reads colors out of style="" and <style> blocks (same vocabulary)', () => {
    const svg =
      '<svg><style>.a{fill:#0b6efd}</style><path class="a"/>' +
      '<rect style="fill: #e8112d; stroke: none"/></svg>';
    const hexes = extractSvgColors(svg).map((c) => c.hex);
    expect(hexes).toContain('#0b6efd');
    expect(hexes).toContain('#e8112d');
  });

  it('resolves CSS named colors (crests use fill="gold" constantly)', () => {
    const hexes = extractSvgColors(
      '<svg><path fill="gold"/><path fill="navy"/></svg>',
    ).map((c) => c.hex);
    expect(hexes).toContain('#ffd700');
    expect(hexes).toContain('#000080');
  });

  it('ignores none / currentColor / transparent / url(#grad)', () => {
    const svg =
      '<svg><path fill="none"/><path fill="currentColor"/>' +
      '<path fill="transparent"/><path fill="url(#g)"/></svg>';
    expect(extractSvgColors(svg)).toEqual([]);
  });

  it('returns [] for a MONOCHROME mark — the fall-back-to-page signal', () => {
    const svg =
      '<svg><path fill="#000000"/><path fill="#ffffff"/><path fill="#888888"/></svg>';
    expect(extractSvgColors(svg)).toEqual([]);
  });

  it('collapses near-duplicate hues so one blue does not eat every slot', () => {
    const svg =
      '<svg><path fill="#0b6efd"/><path fill="#0d70fe"/><path fill="#0a6cfb"/>' +
      '<path fill="#e8112d"/></svg>';
    const hexes = extractSvgColors(svg).map((c) => c.hex);
    expect(hexes).toHaveLength(2);
    expect(hexes).toContain('#e8112d');
  });

  it('never throws on junk input', () => {
    expect(extractSvgColors(null)).toEqual([]);
    expect(extractSvgColors('')).toEqual([]);
    expect(extractSvgColors('not svg at all')).toEqual([]);
  });
});

describe('svgInkLuminance — is this vector mark light or dark?', () => {
  it('reads a white wordmark as light', () => {
    const lum = svgInkLuminance(
      '<svg><path fill="#ffffff"/><path fill="#fefefe"/></svg>',
    );
    expect(lum).not.toBeNull();
    expect(lum!).toBeGreaterThan(0.9);
  });
  it('reads a black wordmark as dark', () => {
    const lum = svgInkLuminance('<svg><path fill="#000000"/></svg>');
    expect(lum!).toBeLessThan(0.1);
  });
  it('treats currentColor as dark ink (every wrapper paints it slate-800)', () => {
    const lum = svgInkLuminance('<svg><path fill="currentColor"/></svg>');
    expect(lum!).toBeLessThan(0.3);
  });
  it('returns null when the markup declares no color at all', () => {
    expect(svgInkLuminance('<svg><path d="M0 0h4v4H0z"/></svg>')).toBeNull();
    expect(svgInkLuminance(null)).toBeNull();
  });
});

describe('dominantColorsFromRgba — raster marks', () => {
  it('ranks the most-covering chromatic color first', () => {
    const data = pixels(
      [194, 24, 91, 255, 100], // magenta — the lotus
      [249, 168, 37, 255, 20], // gold accent
    );
    const out = dominantColorsFromRgba(data);
    expect(out[0].hex).toMatch(/^#c[0-9a-f]/);
    expect(out).toHaveLength(2);
    expect(out[0].count).toBeGreaterThan(out[1].count);
  });

  it('SKIPS transparent pixels — a white-on-transparent wordmark is not "white"', () => {
    const data = pixels(
      [255, 255, 255, 0, 500], // fully transparent padding
      [0, 90, 156, 255, 40], // the actual ink
    );
    const out = dominantColorsFromRgba(data);
    expect(out).toHaveLength(1);
    expect(out[0].hex).toBe('#005a9c');
  });

  it('returns [] for an all-greyscale mark (the monochrome fallback signal)', () => {
    const data = pixels(
      [0, 0, 0, 255, 50],
      [255, 255, 255, 255, 50],
      [128, 128, 128, 255, 50],
    );
    expect(dominantColorsFromRgba(data)).toEqual([]);
  });

  it('never throws on empty / short buffers', () => {
    expect(dominantColorsFromRgba(new Uint8Array(0))).toEqual([]);
    expect(dominantColorsFromRgba(new Uint8Array([1, 2]))).toEqual([]);
  });
});

describe('averageOpaqueLuminance', () => {
  it('ignores transparent pixels', () => {
    const data = pixels([0, 0, 0, 0, 100], [255, 255, 255, 255, 10]);
    expect(averageOpaqueLuminance(data)!).toBeGreaterThan(0.9);
  });
  it('returns null when every pixel is transparent', () => {
    expect(averageOpaqueLuminance(pixels([9, 9, 9, 0, 10]))).toBeNull();
  });
});

describe('paletteFromLogoColors — the mark is the source of truth', () => {
  const page = ['#0f2d52', '#1a1a1a', '#f5a623'];

  it('takes primary from the mark, NOT the page', () => {
    const choice = paletteFromLogoColors(
      [{ hex: '#c2185b', count: 90, share: 0.9 }],
      page,
    );
    expect(choice!.primary).toBe('#c2185b');
    expect(choice!.source).toBe('logo+page');
  });

  it('takes BOTH slots from a two-color mark', () => {
    const choice = paletteFromLogoColors(
      [
        { hex: '#c2185b', count: 90, share: 0.7 },
        { hex: '#f9a825', count: 30, share: 0.3 },
      ],
      page,
    );
    expect(choice!.primary).toBe('#c2185b');
    expect(choice!.accent).toBe('#f9a825');
    expect(choice!.source).toBe('logo');
  });

  it('ignores a second mark color that is the SAME hue family', () => {
    // A light + dark shade of one magenta is one brand color, not two.
    const choice = paletteFromLogoColors(
      [
        { hex: '#c2185b', count: 90, share: 0.7 },
        { hex: '#e91e63', count: 30, share: 0.3 },
      ],
      page,
    );
    expect(choice!.accent).not.toBe('#e91e63');
  });

  it('borrows the accent from the page when the mark is single-hue', () => {
    const choice = paletteFromLogoColors(
      [{ hex: '#c2185b', count: 90, share: 1 }],
      ['#f5a623'],
    );
    expect(choice!.primary).toBe('#c2185b');
    expect(choice!.accent).toBe('#f5a623');
    expect(choice!.source).toBe('logo+page');
  });

  it('MONOCHROME MARK → falls all the way back to page colors (old behavior)', () => {
    const choice = paletteFromLogoColors([], page);
    expect(choice!.primary).toBe('#0f2d52');
    expect(choice!.accent).toBe('#1a1a1a');
    expect(choice!.source).toBe('page');
    expect(choice!.reasons.join(' ')).toMatch(/no chromatic color/);
  });

  it('FETCH FAILED (no analysis at all) → page colors', () => {
    expect(paletteFromLogoColors(null, page)!.source).toBe('page');
    expect(paletteFromLogoColors(undefined, page)!.primary).toBe('#0f2d52');
  });

  it('returns null when there is NOTHING to work with (caller keeps indigo)', () => {
    expect(paletteFromLogoColors([], [])).toBeNull();
    expect(paletteFromLogoColors(null, null)).toBeNull();
  });

  it('drops malformed page hexes rather than persisting them', () => {
    const choice = paletteFromLogoColors(
      [],
      ['nonsense', '#GGGGGG', '#0f2d52'],
    );
    expect(choice!.primary).toBe('#0f2d52');
  });

  it('leaves accent undefined when nothing distinct exists (derivePalette auto-fills)', () => {
    const choice = paletteFromLogoColors(
      [{ hex: '#c2185b', count: 1, share: 1 }],
      ['#c81f60'],
    );
    expect(choice!.accent).toBeUndefined();
  });
});

describe("suggestLogoBackground — the third picker's DEFAULT", () => {
  it('unknown ink → the branded chip (matches pre-picker behavior exactly)', () => {
    expect(
      suggestLogoBackground({ luminance: null, primaryHex: '#c2185b' }),
    ).toBe('primary');
    expect(suggestLogoBackground({})).toBe('primary');
  });

  it('a WHITE wordmark gets a dark backing', () => {
    // Dark brand primary can carry it → the branded chip.
    expect(
      suggestLogoBackground({ luminance: 0.95, primaryHex: '#0f2d52' }),
    ).toBe('primary');
    // A pale brand primary cannot → fall to a neutral dark card.
    expect(
      suggestLogoBackground({ luminance: 0.95, primaryHex: '#ffe082' }),
    ).toBe('dark');
  });

  it('a DARK mark sits on nothing — boxing it looks cheap', () => {
    expect(
      suggestLogoBackground({ luminance: 0.1, primaryHex: '#0f2d52' }),
    ).toBe('transparent');
  });

  it('a MID-TONE colored mark gets white, never a clashing brand chip', () => {
    // This is the operator's exact complaint: a colored lotus on a
    // brand-primary chip is the clash. White keeps the mark's own color.
    expect(
      suggestLogoBackground({
        luminance: 0.45,
        dominantHex: '#c2185b',
        primaryHex: '#c2185b',
      }),
    ).toBe('white');
  });

  it('always returns a member of the offered set', () => {
    for (const lum of [null, 0, 0.2, 0.4, 0.5, 0.7, 0.99]) {
      const bg = suggestLogoBackground({
        luminance: lum,
        primaryHex: '#4f46e5',
        dominantHex: '#c2185b',
      });
      expect(LOGO_BACKGROUNDS).toContain(bg);
    }
  });

  it('ignores malformed hex inputs instead of throwing', () => {
    expect(() =>
      suggestLogoBackground({
        luminance: 0.5,
        primaryHex: 'oops',
        dominantHex: '#xyz',
      }),
    ).not.toThrow();
  });
});

describe('isLogoBackground — the persist-boundary validator', () => {
  it('accepts every offered value', () => {
    for (const bg of LOGO_BACKGROUNDS) expect(isLogoBackground(bg)).toBe(true);
  });
  it('rejects anything else (a client round-trip is untrusted)', () => {
    expect(isLogoBackground('rgb(1,2,3)')).toBe(false);
    expect(isLogoBackground('')).toBe(false);
    expect(isLogoBackground(null)).toBe(false);
    expect(isLogoBackground({ toString: () => 'dark' })).toBe(false);
    expect(isLogoBackground('DARK')).toBe(false);
  });
});
