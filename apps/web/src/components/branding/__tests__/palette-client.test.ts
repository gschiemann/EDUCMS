import { derivePaletteClient } from '../palette-client';

/** WCAG contrast ratio between two hex colors. */
function channel(c: number) { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
function lum(hex: string) { const h = hex.replace('#', ''); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); }
function contrast(a: string, b: string) { const la = lum(a), lb = lum(b); const [hi, lo] = la > lb ? [la, lb] : [lb, la]; return (hi + 0.05) / (lo + 0.05); }

/**
 * S17 (launch-readiness): the client brand-palette preview must guarantee the
 * button text/background pairing meets WCAG AA (4.5:1) — including the mid-tone
 * brand colors that pure black/white ink alone cannot satisfy.
 */
describe('derivePaletteClient — WCAG AA button contrast (S17)', () => {
  // Mid-tone colors are the worst case: neither pure white nor pure black text
  // clears 4.5:1 on the raw color, so the bg itself must be nudged.
  const midTones = ['#767676', '#808080', '#7a8b99', '#a0522d', '#6b8e23', '#5f9ea0'];

  for (const c of midTones) {
    it(`primary ${c}: primary/primaryInk pairing >= 4.5:1`, () => {
      const p = derivePaletteClient(c);
      expect(contrast(p.primary, p.primaryInk)).toBeGreaterThanOrEqual(4.5);
    });
    it(`accent derived from ${c}: accent/accentInk pairing >= 4.5:1`, () => {
      const p = derivePaletteClient(c);
      expect(contrast(p.accent, p.accentInk)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('preserves the raw brand color for undo', () => {
    const p = derivePaletteClient('#767676');
    expect(p.primaryRaw).toBe('#767676');
    // Whether or not the bg had to move, the RAW is retained so the UI can undo.
    expect(contrast(p.primary, p.primaryInk)).toBeGreaterThanOrEqual(4.5);
  });

  it('nudges the bg for a color where NEITHER pure black nor white clears AA', () => {
    // ~luminance 0.19 sits in the band where best-of-black/white ≈ 4.35 < 4.5,
    // so the bg itself must be shifted to reach AA.
    const p = derivePaletteClient('#797979');
    expect(p.primaryRaw).toBe('#797979');
    expect(p.primary).not.toBe('#797979'); // had to move
    expect(contrast(p.primary, p.primaryInk)).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves an already-AA-safe color essentially unchanged', () => {
    const p = derivePaletteClient('#0b3d91'); // deep blue, white text already >7:1
    expect(p.primary.toLowerCase()).toBe('#0b3d91');
    expect(contrast(p.primary, p.primaryInk)).toBeGreaterThanOrEqual(4.5);
  });
});
