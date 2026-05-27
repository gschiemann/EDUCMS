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

// ── Contrast enforcement ─────────────────────────────────────────
//
// P0-6 fix (2026-05-27 bulletproof audit, §18 Accessibility):
// the brand-scrape happily returned colors like yellow (#ffd700) or
// pastel blue (#87ceeb) as the tenant's primary, then the UI painted
// every button as "white-on-yellow" — unreadable, fails WCAG 2.1 AA
// (4.5:1 ratio for normal text).
//
// `ensureContrast(bg, fg, target)` shifts `bg` in HSL lightness space
// until it achieves the target ratio against `fg`. Binary search
// because the relationship between lightness and contrast ratio is
// monotonic but non-linear (luminance is a sRGB-gamma'd dot product).
//
// Direction: we move AWAY from the foreground's luminance — i.e., if
// the text is dark, darken-or-lighten the background until it's far
// ENOUGH from the text. Pick the direction that has more headroom
// (a light-text-on-dark-bg can go DARKER; a light-text-on-light-bg
// must go MUCH darker, so we pick darken).
//
// Returns the ORIGINAL hex if it already passes — no needless tweaks.
// Capped at 12 binary-search iterations (well past what we need to
// converge to a 0.01 ratio precision). If even L=0 or L=100 doesn't
// achieve target (e.g., pure white text on pure white bg with target
// 21:1), returns whichever extreme is closer to passing — caller
// surfaces this in the contrast report.

/**
 * Tweak `bg` toward black or white until `contrastRatio(bg, fg)` ≥ target.
 * Works in HSL lightness; binary search; max 12 iterations.
 *
 * @param bg     Hex color we may adjust.
 * @param fg     Hex color of the foreground we want bg to contrast against.
 * @param target Minimum contrast ratio (default 4.5 = WCAG 2.1 AA normal).
 * @returns      Adjusted hex (or original bg if it already passes).
 */
export function ensureContrast(bg: string, fg: string, target: number = 4.5): string {
  // Fast path — already passes.
  const startRatio = contrastRatio(bg, fg);
  if (startRatio >= target) return bg;

  const bgHsl = hexToHsl(bg);
  const fgLum = relativeLuminance(fg);

  // Direction: if fg is LIGHTER than bg, the bg needs to get DARKER
  // (more contrast = wider luminance gap). If fg is DARKER than bg,
  // the bg needs to get LIGHTER.
  //
  // This keeps the bg in roughly the right perceptual zone — a yellow
  // brand color asked to contrast against white becomes a deeper
  // saturated gold/orange, not pure black.
  const bgLum = relativeLuminance(bg);
  const goLighter = fgLum < bgLum;
  // The bound we search toward: 0 (darken) or 100 (lighten).
  const targetL = goLighter ? 100 : 0;

  // Binary search the lightness axis.
  let lo = bgHsl.l;
  let hi = targetL;
  let bestHex = bg;
  let bestRatio = startRatio;

  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const candidate = hslToHex({ h: bgHsl.h, s: bgHsl.s, l: clamp(mid) });
    const r = contrastRatio(candidate, fg);

    // Track the best candidate we've seen — even if we never hit the
    // target (e.g., asking for 21:1 on a real-world pastel), return
    // the closest we got rather than the original.
    if (r > bestRatio) {
      bestRatio = r;
      bestHex = candidate;
    }

    if (r >= target) {
      // Passes — narrow toward the original to keep the perceptual
      // shift minimal. The caller still got a passing color.
      hi = mid;
      bestHex = candidate;
      bestRatio = r;
    } else {
      // Still failing — push further toward the bound.
      lo = mid;
    }
  }

  return bestHex;
}

/**
 * Choose the best ink-on-bg pairing — start from `bestTextOn(bg)`
 * (the higher-contrast of white / dark), then enforce target. If the
 * resulting bg shift would be huge, this still returns the bg as-is
 * (because the SCRAPED primary is what the user wants visually) and
 * lets the caller bump the bg via `ensureContrast` to close the gap.
 *
 * Returns BOTH the ink color and the (possibly tweaked) bg, so the
 * caller can persist either or both. The "raw" original bg flows
 * through `_raw` fields on the palette so the UI can offer "undo".
 */
export function ensureBgInkContrast(
  bg: string,
  preferredInk?: string,
  target: number = 4.5,
): { bg: string; ink: string; ratio: number; adjusted: boolean } {
  // Pick the ink that gives us more headroom to begin with — usually
  // the higher-contrast of (#0b1220 / #ffffff). Caller may override
  // (e.g., per the design system they want ink to stay a specific
  // color and only the bg shifts).
  const ink = preferredInk
    ?? (contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#0b1220') ? '#ffffff' : '#0b1220');
  const adjustedBg = ensureContrast(bg, ink, target);
  const ratio = contrastRatio(adjustedBg, ink);
  return {
    bg: adjustedBg,
    ink,
    ratio,
    adjusted: adjustedBg.toLowerCase() !== bg.toLowerCase(),
  };
}

// ── Palette derivation ────────────────────────────────────────────

export interface ContrastAdjustment {
  /** Which palette key was adjusted (primary, accent, etc). */
  key: string;
  /** Original hex BEFORE the WCAG nudge — what the scraper actually found. */
  from: string;
  /** Final hex AFTER the WCAG nudge — what we're persisting. */
  to: string;
  /** The ink/text color the bg had to contrast against. */
  ink: string;
  /** Contrast ratio of the ORIGINAL bg vs ink (often below target). */
  fromRatio: number;
  /** Contrast ratio of the ADJUSTED bg vs ink (≥ target on success). */
  toRatio: number;
  /** Target ratio that was being chased (4.5 for WCAG 2.1 AA normal text). */
  target: number;
  /** True if the candidate had to be moved. False if `from === to`. */
  adjusted: boolean;
  /**
   * True if even at the limit (L=0 / L=100) the candidate couldn't hit
   * the target. The "to" hex is the best we could do; the UI may want
   * to suggest the operator pick a darker variant manually.
   */
  capped: boolean;
}

export interface ContrastReport {
  /** Target ratio used for all adjustments (default 4.5 = WCAG AA). */
  target: number;
  /** One entry per palette field we checked — primary, accent. */
  adjustments: ContrastAdjustment[];
  /** True if any field needed adjustment. */
  anyAdjusted: boolean;
  /** True if any field couldn't hit target even after maxing out. */
  anyCapped: boolean;
}

export interface DerivedPalette {
  primary: string;
  /** Original primary BEFORE WCAG nudge — preserves the operator's scraped color for "undo". */
  primaryRaw: string;
  /** The text/ink color `primary` was checked against (white or near-black). */
  primaryOn: string;
  primaryHover: string;
  primaryActive: string;
  primarySoft: string;
  primaryInk: string;        // best contrast text color on primary
  accent: string;
  /** Original accent BEFORE WCAG nudge. */
  accentRaw: string;
  /** The text/ink color `accent` was checked against. */
  accentOn: string;
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
  /** Per-field contrast adjustments + summary. UI may surface in a tooltip. */
  contrastReport: ContrastReport;
}

/**
 * Derive a full design system from just a primary (and optionally an
 * accent + extras). Missing shades are generated via HSL math so the UI
 * stays coherent even when the scraper only found one color.
 *
 * WCAG enforcement (P0-6, 2026-05-27): `primary` and `accent` are
 * automatically nudged in HSL-lightness space until they contrast at
 * least `contrastTarget` (default 4.5 — WCAG 2.1 AA for normal text)
 * against their corresponding ink/text color (auto-picked from the
 * higher-contrast of #fff / #0b1220). The original scraped hex is
 * preserved in `primaryRaw` / `accentRaw` so the wizard UI can offer
 * "we adjusted your yellow — undo?". The `contrastReport` field on
 * the returned palette enumerates exactly what got moved + the
 * resulting ratios.
 */
export function derivePalette(
  primary: string,
  accent?: string,
  _extras: string[] = [],
  contrastTarget: number = 4.5,
): DerivedPalette {
  // ── Step 1: Adjust the primary for legibility ──────────────────
  // We pick the ink color BEFORE adjusting bg so the chase is stable.
  // (If we picked ink AFTER tweaking bg, we'd flip-flop on edge cases
  // where the bg crosses the L≈55 luminance threshold mid-tweak.)
  const primaryRaw = primary;
  const primaryOn = bestTextOn(primary);
  const primaryFromRatio = contrastRatio(primaryRaw, primaryOn);
  const primaryAdjusted = ensureContrast(primaryRaw, primaryOn, contrastTarget);
  const primaryToRatio = contrastRatio(primaryAdjusted, primaryOn);

  // Use the adjusted primary downstream for the ramp + hover/active.
  // The HSL the rest of the palette derives from is the ADJUSTED hue/
  // sat/lightness — otherwise tints stay on the unreadable original.
  const pHsl = hexToHsl(primaryAdjusted);

  // ── Step 2: Resolve the accent (auto from hue rotation if absent) ──
  const accentRawSource = accent || hslToHex({
    h: (pHsl.h + 180) % 360,
    s: clamp(pHsl.s, 40, 85),
    l: clamp(pHsl.l, 40, 65),
  });
  const accentRaw = accentRawSource;
  const accentOn = bestTextOn(accentRaw);
  const accentFromRatio = contrastRatio(accentRaw, accentOn);
  const accentAdjusted = ensureContrast(accentRaw, accentOn, contrastTarget);
  const accentToRatio = contrastRatio(accentAdjusted, accentOn);

  // ── Step 3: Build the ramp from the adjusted primary ──────────
  const ramp = {
    '50':  hslToHex({ h: pHsl.h, s: clamp(pHsl.s * 0.5, 10, 40), l: 97 }),
    '100': hslToHex({ h: pHsl.h, s: clamp(pHsl.s * 0.55, 15, 55), l: 94 }),
    '200': hslToHex({ h: pHsl.h, s: clamp(pHsl.s * 0.6, 20, 70), l: 86 }),
    '300': hslToHex({ h: pHsl.h, s: clamp(pHsl.s * 0.7, 25, 80), l: 75 }),
    '400': hslToHex({ h: pHsl.h, s: clamp(pHsl.s * 0.85, 30, 90), l: 62 }),
    '500': primaryAdjusted,
    '600': hslToHex({ h: pHsl.h, s: clamp(pHsl.s, 40, 95), l: clamp(pHsl.l - 8, 20, 55) }),
    '700': hslToHex({ h: pHsl.h, s: clamp(pHsl.s, 40, 95), l: clamp(pHsl.l - 16, 15, 45) }),
    '800': hslToHex({ h: pHsl.h, s: clamp(pHsl.s, 35, 90), l: clamp(pHsl.l - 24, 10, 35) }),
    '900': hslToHex({ h: pHsl.h, s: clamp(pHsl.s, 30, 85), l: clamp(pHsl.l - 32, 5, 25) }),
  };

  // ── Step 4: Build the contrast report ─────────────────────────
  const adjustments: ContrastAdjustment[] = [
    {
      key: 'primary',
      from: primaryRaw,
      to: primaryAdjusted,
      ink: primaryOn,
      fromRatio: +primaryFromRatio.toFixed(2),
      toRatio: +primaryToRatio.toFixed(2),
      target: contrastTarget,
      adjusted: primaryAdjusted.toLowerCase() !== primaryRaw.toLowerCase(),
      capped: primaryToRatio < contrastTarget,
    },
    {
      key: 'accent',
      from: accentRaw,
      to: accentAdjusted,
      ink: accentOn,
      fromRatio: +accentFromRatio.toFixed(2),
      toRatio: +accentToRatio.toFixed(2),
      target: contrastTarget,
      adjusted: accentAdjusted.toLowerCase() !== accentRaw.toLowerCase(),
      capped: accentToRatio < contrastTarget,
    },
  ];
  const contrastReport: ContrastReport = {
    target: contrastTarget,
    adjustments,
    anyAdjusted: adjustments.some((a) => a.adjusted),
    anyCapped: adjustments.some((a) => a.capped),
  };

  return {
    primary: primaryAdjusted,
    primaryRaw,
    primaryOn,
    primaryHover: ramp['600'],
    primaryActive: ramp['700'],
    primarySoft: ramp['100'],
    primaryInk: primaryOn,
    accent: accentAdjusted,
    accentRaw,
    accentOn,
    accentHover: darken(accentAdjusted, 8),
    accentSoft: lighten(accentAdjusted, 38),
    accentInk: accentOn,
    ink: '#0f172a',
    inkMuted: '#475569',
    surface: '#ffffff',
    surfaceAlt: ramp['50'],
    border: '#e2e8f0',
    success: '#16a34a',
    warn: '#f59e0b',
    danger: '#dc2626',
    ramp,
    contrastReport,
  };
}
