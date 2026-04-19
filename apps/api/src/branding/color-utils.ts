/**
 * Color utilities: parsing hex/rgb/hsl, HSL math, WCAG contrast,
 * full 9-shade palette derivation from a single primary. Pure fns,
 * no deps — kept isolated so the scraper and the manual tweaker
 * share a single palette-math implementation.
 */

export interface HSL { h: number; s: number; l: number }
export interface RGB { r: number; g: number; b: number }

export function clamp(v: number, min = 0, max = 100) { return Math.max(min, Math.min(max, v)); }

// ── Parsers ───────────────────────────────────────────────────────

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FN = /rgba?\s*\(\s*([-.\d]+)\s*[, ]\s*([-.\d]+)\s*[, ]\s*([-.\d]+)(?:\s*[,/]\s*([-.\d]+%?))?\s*\)/i;
const HSL_FN = /hsla?\s*\(\s*([-.\d]+)(?:deg|rad|turn)?\s*[, ]\s*([-.\d]+)%\s*[, ]\s*([-.\d]+)%(?:\s*[,/]\s*([-.\d]+%?))?\s*\)/i;

export function parseColor(raw: string): { hex: string; alpha: number } | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = s.match(HEX3))) {
    const hex = `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
    return { hex, alpha: 1 };
  }
  if ((m = s.match(HEX8))) {
    const hex = `#${m[1]}${m[2]}${m[3]}`;
    const a = parseInt(m[4], 16) / 255;
    return { hex, alpha: a };
  }
  if ((m = s.match(HEX6))) return { hex: `#${m[1]}${m[2]}${m[3]}`, alpha: 1 };
  if ((m = s.match(RGB_FN))) {
    const r = clamp(+m[1], 0, 255), g = clamp(+m[2], 0, 255), b = clamp(+m[3], 0, 255);
    const a = m[4] ? parseAlpha(m[4]) : 1;
    return { hex: rgbToHex({ r, g, b }), alpha: a };
  }
  if ((m = s.match(HSL_FN))) {
    const h = ((+m[1] % 360) + 360) % 360;
    const sat = clamp(+m[2]);
    const l = clamp(+m[3]);
    const a = m[4] ? parseAlpha(m[4]) : 1;
    return { hex: rgbToHex(hslToRgb({ h, s: sat, l })), alpha: a };
  }
  return null;
}

function parseAlpha(v: string): number {
  if (v.endsWith('%')) return clamp(parseFloat(v), 0, 100) / 100;
  return clamp(parseFloat(v), 0, 1);
}

// ── Conversions ───────────────────────────────────────────────────

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const to = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const r1 = r / 255, g1 = g / 255, b1 = b / 255;
  const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r1: h = (g1 - b1) / d + (g1 < b1 ? 6 : 0); break;
      case g1: h = (b1 - r1) / d + 2; break;
      case b1: h = (r1 - g1) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const s1 = s / 100, l1 = l / 100;
  const c = (1 - Math.abs(2 * l1 - 1)) * s1;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l1 - c / 2;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

export function hexToHsl(hex: string): HSL { return rgbToHsl(hexToRgb(hex)); }
export function hslToHex(hsl: HSL): string { return rgbToHex(hslToRgb(hsl)); }

// ── Manipulators ──────────────────────────────────────────────────

export function lighten(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, l: clamp(hsl.l + amount) });
}

export function darken(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, l: clamp(hsl.l - amount) });
}

export function rotateHue(hex: string, degrees: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, h: (hsl.h + degrees + 360) % 360 });
}

export function saturate(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, s: clamp(hsl.s + amount) });
}

// ── Contrast (WCAG 2.1) ───────────────────────────────────────────

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const [L1, L2] = la > lb ? [la, lb] : [lb, la];
  return (L1 + 0.05) / (L2 + 0.05);
}

export function wcagGrade(ratio: number): 'AAA' | 'AA' | 'AA-large' | 'fail' {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA-large';
  return 'fail';
}

/** For a given bg, pick whichever of white/black gives the higher contrast. */
export function bestTextOn(bg: string): string {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111111') ? '#ffffff' : '#111111';
}

// ── Palette derivation ────────────────────────────────────────────

export interface DerivedPalette {
  primary: string;
  primaryHover: string;
  primaryActive: string;
  primarySoft: string;
  primaryInk: string;        // best contrast text color on primary
  accent: string;
  accentHover: string;
  accentSoft: string;
  accentInk: string;
  ink: string;               // primary text
  inkMuted: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  success: string;
  warn: string;
  danger: string;
  // 9-shade ramp of the primary (50..900) for custom Tailwind-like access
  ramp: Record<'50'|'100'|'200'|'300'|'400'|'500'|'600'|'700'|'800'|'900', string>;
}

/**
 * Derive a full design system from just a primary (and optionally an
 * accent + extras). Missing shades are generated via HSL math so the UI
 * stays coherent even when the scraper only found one color.
 */
export function derivePalette(primary: string, accent?: string, _extras: string[] = []): DerivedPalette {
  const pHsl = hexToHsl(primary);
  const autoAccent = accent || hslToHex({ h: (pHsl.h + 180) % 360, s: clamp(pHsl.s, 40, 85), l: clamp(pHsl.l, 40, 65) });

  const ramp = {
    '50':  hslToHex({ h: pHsl.h, s: clamp(pHsl.s * 0.5, 10, 40), l: 97 }),
    '100': hslToHex({ h: pHsl.h, s: clamp(pHsl.s * 0.55, 15, 55), l: 94 }),
    '200': hslToHex({ h: pHsl.h, s: clamp(pHsl.s * 0.6, 20, 70), l: 86 }),
    '300': hslToHex({ h: pHsl.h, s: clamp(pHsl.s * 0.7, 25, 80), l: 75 }),
    '400': hslToHex({ h: pHsl.h, s: clamp(pHsl.s * 0.85, 30, 90), l: 62 }),
    '500': primary,
    '600': hslToHex({ h: pHsl.h, s: clamp(pHsl.s, 40, 95), l: clamp(pHsl.l - 8, 20, 55) }),
    '700': hslToHex({ h: pHsl.h, s: clamp(pHsl.s, 40, 95), l: clamp(pHsl.l - 16, 15, 45) }),
    '800': hslToHex({ h: pHsl.h, s: clamp(pHsl.s, 35, 90), l: clamp(pHsl.l - 24, 10, 35) }),
    '900': hslToHex({ h: pHsl.h, s: clamp(pHsl.s, 30, 85), l: clamp(pHsl.l - 32, 5, 25) }),
  };

  return {
    primary,
    primaryHover: ramp['600'],
    primaryActive: ramp['700'],
    primarySoft: ramp['100'],
    primaryInk: bestTextOn(primary),
    accent: autoAccent,
    accentHover: darken(autoAccent, 8),
    accentSoft: lighten(autoAccent, 38),
    accentInk: bestTextOn(autoAccent),
    ink: '#0f172a',
    inkMuted: '#475569',
    surface: '#ffffff',
    surfaceAlt: ramp['50'],
    border: '#e2e8f0',
    success: '#16a34a',
    warn: '#f59e0b',
    danger: '#dc2626',
    ramp,
  };
}
