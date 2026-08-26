import {
  LOGO_BACKGROUNDS,
  LOGO_BACKGROUND_LABELS,
  LOGO_BACKGROUND_HINTS,
  isLogoBackground,
  suggestBackgroundForTone,
  logoBackdrop,
  readLogoBackground,
} from '../logo-backdrop';

/**
 * The branding wizard's THIRD picker (2026-08-25).
 *
 * Operator: "we should have a logo background picker but do our best to get
 * it right … just add another picker like we already have just have 3 now."
 *
 * The contract these tests hold:
 *   1. Every render site (sidebar, settings chip, live preview, brand-kit
 *      panel) goes through `logoBackdrop()` — so a NO-CHOICE tenant must get
 *      back exactly the treatment those sites hard-coded before the picker
 *      existed. Any drift here is a visual regression for every existing row.
 *   2. `readLogoBackground` tolerates every shape a caller might hold.
 *   3. The value set is closed — the persist boundary validates against it.
 */

describe('the offered set', () => {
  it('covers the operator\'s ask: transparent / white / dark / brand + a tile', () => {
    expect(LOGO_BACKGROUNDS).toEqual(['transparent', 'white', 'dark', 'primary', 'tile']);
  });

  it('every option has a label and a hint (the picker renders both)', () => {
    for (const bg of LOGO_BACKGROUNDS) {
      expect(LOGO_BACKGROUND_LABELS[bg]).toBeTruthy();
      expect(LOGO_BACKGROUND_HINTS[bg]).toBeTruthy();
    }
  });
});

describe('isLogoBackground — the validator both sides share', () => {
  it('accepts each offered value', () => {
    for (const bg of LOGO_BACKGROUNDS) expect(isLogoBackground(bg)).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isLogoBackground('DARK')).toBe(false);
    expect(isLogoBackground('#fff')).toBe(false);
    expect(isLogoBackground(undefined)).toBe(false);
    expect(isLogoBackground(null)).toBe(false);
    expect(isLogoBackground(0)).toBe(false);
  });
});

describe('suggestBackgroundForTone — the client-side default rule', () => {
  it('a DARK mark sits on nothing', () => {
    expect(suggestBackgroundForTone('dark')).toBe('transparent');
  });
  it('a LIGHT mark gets the brand chip', () => {
    expect(suggestBackgroundForTone('light')).toBe('primary');
  });
  it('an UNANALYZABLE mark gets the brand chip (safe for white wordmarks)', () => {
    expect(suggestBackgroundForTone('unknown')).toBe('primary');
  });
});

describe('logoBackdrop — no stored choice reproduces the PRE-picker behavior', () => {
  // Before 2026-08-25 every site computed:
  //   needsDarkBacking = tone === 'light' || tone === 'unknown'
  //   → true : background var(--brand-primary), white ink, padded
  //   → false: no background, slate-800 ink, unpadded
  it('light tone → brand-primary chip with white ink, padded', () => {
    const b = logoBackdrop(null, 'light');
    expect(String(b.style.background)).toContain('--brand-primary');
    expect(b.inkClass).toBe('text-white');
    expect(b.padded).toBe(true);
  });

  it('unknown tone → same brand-primary chip', () => {
    const b = logoBackdrop(undefined, 'unknown');
    expect(String(b.style.background)).toContain('--brand-primary');
    expect(b.inkClass).toBe('text-white');
  });

  it('dark tone → no backing, dark ink, unpadded', () => {
    const b = logoBackdrop(null, 'dark');
    expect(b.style.background).toBeUndefined();
    expect(b.inkClass).toBe('text-slate-800');
    expect(b.padded).toBe(false);
  });

  it('an INVALID stored value falls back to the tone rule rather than breaking render', () => {
    const b = logoBackdrop('neon-plaid' as any, 'dark');
    expect(b.style.background).toBeUndefined();
  });
});

describe('logoBackdrop — an explicit choice OVERRIDES the tone', () => {
  it('transparent wins even for a light mark', () => {
    const b = logoBackdrop('transparent', 'light');
    expect(b.style.background).toBeUndefined();
    expect(b.padded).toBe(false);
  });

  it('white gives a white card with dark ink and a hairline border', () => {
    const b = logoBackdrop('white', 'light');
    expect(b.style.background).toBe('#ffffff');
    expect(b.inkClass).toBe('text-slate-800');
    expect(b.className).toContain('border');
  });

  it('dark gives a near-black card with white ink', () => {
    const b = logoBackdrop('dark', 'dark');
    expect(b.style.background).toBe('#111827');
    expect(b.inkClass).toBe('text-white');
  });

  it('primary paints from the live brand token so it re-skins with the palette', () => {
    expect(String(logoBackdrop('primary', 'dark').style.background)).toContain('var(--brand-primary');
  });

  it('tile paints from the soft brand tint and keeps dark ink', () => {
    const b = logoBackdrop('tile', 'light');
    expect(String(b.style.background)).toContain('--brand-primary-soft');
    expect(b.inkClass).toBe('text-slate-800');
  });

  it('every option yields a renderable result for every tone', () => {
    for (const bg of LOGO_BACKGROUNDS) {
      for (const tone of ['light', 'dark', 'unknown'] as const) {
        const b = logoBackdrop(bg, tone);
        expect(typeof b.className).toBe('string');
        expect(typeof b.inkClass).toBe('string');
        expect(typeof b.padded).toBe('boolean');
      }
    }
  });

  it('every brand token carries a literal fallback (a page with no theme still paints)', () => {
    for (const bg of LOGO_BACKGROUNDS) {
      const raw = String(logoBackdrop(bg, 'light').style.background ?? '');
      if (raw.includes('var(')) expect(raw).toMatch(/var\(--[a-z-]+,\s*#[0-9a-f]{3,6}\)/i);
    }
  });
});

describe('readLogoBackground — tolerant of every caller shape', () => {
  it('reads a full branding row (the value lives inside palette)', () => {
    expect(readLogoBackground({ logoUrl: 'x', palette: { primary: '#000', logoBackground: 'dark' } })).toBe('dark');
  });
  it('reads a bare palette object', () => {
    expect(readLogoBackground({ logoBackground: 'white' })).toBe('white');
  });
  it('prefers a top-level value over the nested one', () => {
    expect(readLogoBackground({ logoBackground: 'tile', palette: { logoBackground: 'dark' } })).toBe('tile');
  });
  it('returns null for anything unusable', () => {
    expect(readLogoBackground(null)).toBeNull();
    expect(readLogoBackground(undefined)).toBeNull();
    expect(readLogoBackground('dark')).toBeNull();
    expect(readLogoBackground({ palette: null })).toBeNull();
    expect(readLogoBackground({ palette: { logoBackground: 'chartreuse' } })).toBeNull();
  });
});
