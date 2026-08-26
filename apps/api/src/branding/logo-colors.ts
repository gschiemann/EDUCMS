/**
 * logo-colors — make the CHOSEN LOGO the source of truth for the brand
 * palette, and pick the backdrop that logo should sit on.
 *
 * Why (2026-08-25, operator): "why do you use colors that dont look good
 * with the logo … it needs to look good for the customer on the first try".
 *
 * Before this, `derivePalette(primaryHex, accentHex)` was fed purely from
 * ranked PAGE CSS colors. A site whose chrome is navy while the mark is a
 * magenta lotus produced navy buttons next to a magenta logo — technically
 * "the site's colors", visually a clash. The logo is the brand; the page is
 * just where it happens to live.
 *
 * Everything here is PURE (no fetch, no sharp, no NestJS) except that
 * `dominantColorsFromRgba` expects raw RGBA bytes the caller decoded — the
 * scraper does the decode with `sharp`, which is already an API dependency.
 * Keeping the math pure is what makes the whole thing unit-testable.
 */

import {
  parseColor,
  rgbToHsl,
  hexToRgb,
  relativeLuminance,
  contrastRatio,
} from './color-utils';

/** Backdrop treatments offered for the tenant logo (the wizard's 3rd picker). */
export const LOGO_BACKGROUNDS = [
  'transparent',
  'white',
  'dark',
  'primary',
  'tile',
] as const;
export type LogoBackground = (typeof LOGO_BACKGROUNDS)[number];

export function isLogoBackground(v: unknown): v is LogoBackground {
  return (
    typeof v === 'string' && (LOGO_BACKGROUNDS as readonly string[]).includes(v)
  );
}

/** A color observed in a logo, with how much of the mark it covers. */
export interface LogoColor {
  hex: string;
  /** Pixel count (raster) or occurrence count (SVG). */
  count: number;
  /** 0..1 share of the counted ink. */
  share: number;
}

// ── Chromatic-ness helpers ────────────────────────────────────────────
//
// A logo's BRAND color is a chromatic one. Black outlines, white knockouts
// and grey shadows are structure, not brand — they'd make every logo derive
// a grey palette. Same spirit as the scraper's isNoiseColor(), but tuned for
// small ink samples rather than page CSS.

/** Saturation (0-100) and lightness (0-100) of a hex. */
function hsl(hex: string) {
  return rgbToHsl(hexToRgb(hex));
}

/** True when a color carries real chroma — not black / white / grey. */
export function isChromatic(hex: string, minSat = 18): boolean {
  const { s, l } = hsl(hex);
  if (l <= 8 || l >= 95) return false; // near-black / near-white
  return s >= minSat;
}

// ── SVG color extraction ──────────────────────────────────────────────

const SVG_COLOR_ATTR =
  /(?:fill|stroke|stop-color|flood-color|lighting-color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]{3,20})/gi;

/**
 * CSS named colors, scoped to THIS module on purpose. `parseColor` in
 * color-utils only understands hex / rgb() / hsl(), and widening it would
 * change page-color ranking (a much riskier blast radius). Logo markup
 * uses names far more often than page CSS does — `fill="gold"` on a crest
 * is common — so resolve them here only. Greys/black/white are included so
 * they can be recognized and then correctly REJECTED by `isChromatic`.
 */
const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  maroon: '#800000',
  olive: '#808000',
  green: '#008000',
  purple: '#800080',
  teal: '#008080',
  navy: '#000080',
  orange: '#ffa500',
  gold: '#ffd700',
  crimson: '#dc143c',
  indigo: '#4b0082',
  violet: '#ee82ee',
  pink: '#ffc0cb',
  hotpink: '#ff69b4',
  salmon: '#fa8072',
  tomato: '#ff6347',
  coral: '#ff7f50',
  khaki: '#f0e68c',
  turquoise: '#40e0d0',
  skyblue: '#87ceeb',
  royalblue: '#4169e1',
  steelblue: '#4682b4',
  darkblue: '#00008b',
  darkred: '#8b0000',
  darkgreen: '#006400',
  forestgreen: '#228b22',
  seagreen: '#2e8b57',
  firebrick: '#b22222',
  chocolate: '#d2691e',
  peru: '#cd853f',
  goldenrod: '#daa520',
  darkorange: '#ff8c00',
  orangered: '#ff4500',
  deeppink: '#ff1493',
  mediumblue: '#0000cd',
  dodgerblue: '#1e90ff',
  cornflowerblue: '#6495ed',
  slateblue: '#6a5acd',
  darkviolet: '#9400d3',
  darkmagenta: '#8b008b',
  limegreen: '#32cd32',
  springgreen: '#00ff7f',
};

function namedColor(name: string): { hex: string; alpha: number } | null {
  const hex = NAMED_COLORS[name];
  return hex ? { hex, alpha: 1 } : null;
}

/**
 * Pull the colors out of raw SVG markup — attributes AND inline `style=`
 * AND `<style>` blocks all use the same `fill:`/`stroke:` vocabulary, so one
 * regex covers them.
 *
 * Ignores the non-colors (`none`, `currentColor`, `transparent`, `inherit`,
 * `url(#grad)`) and ranks by occurrence. Only the CHROMATIC results are
 * returned — a mark that is pure black-on-transparent yields `[]`, which is
 * exactly the "monochrome → fall back to page colors" signal the caller
 * wants.
 */
export function extractSvgColors(
  svg: string | null | undefined,
  maxLen = 400_000,
): LogoColor[] {
  if (!svg || typeof svg !== 'string') return [];
  const src = svg.length > maxLen ? svg.slice(0, maxLen) : svg;
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  SVG_COLOR_ATTR.lastIndex = 0;
  while ((m = SVG_COLOR_ATTR.exec(src)) !== null) {
    const raw = (m[1] || '').trim();
    if (!raw) continue;
    const lower = raw.toLowerCase();
    if (
      lower === 'none' ||
      lower === 'currentcolor' ||
      lower === 'transparent' ||
      lower === 'inherit' ||
      lower === 'initial' ||
      lower === 'unset' ||
      lower.startsWith('url(')
    ) {
      continue;
    }
    const parsed = parseColor(raw) ?? namedColor(lower);
    if (!parsed || parsed.alpha < 0.5) continue;
    if (!isChromatic(parsed.hex)) continue;
    counts.set(parsed.hex, (counts.get(parsed.hex) || 0) + 1);
  }
  return rankColorCounts(counts);
}

/**
 * Coverage-weighted mean luminance of an SVG's ink — the vector twin of
 * `averageOpaqueLuminance`. Unlike `extractSvgColors` this KEEPS the greys,
 * black and white, because "is this mark light or dark" is exactly the
 * question they answer.
 *
 * `currentColor` counts as DARK (0.15): every surface that renders an
 * inline brand SVG sets a dark `color` on the wrapper (the wizard and
 * sidebar both use `text-slate-800`), so a currentColor mark paints dark.
 * Returns null when the markup declares no color at all — the caller then
 * treats the mark as "unknown" and picks the safe branded chip.
 */
export function svgInkLuminance(
  svg: string | null | undefined,
  maxLen = 400_000,
): number | null {
  if (!svg || typeof svg !== 'string') return null;
  const src = svg.length > maxLen ? svg.slice(0, maxLen) : svg;
  let sum = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  SVG_COLOR_ATTR.lastIndex = 0;
  while ((m = SVG_COLOR_ATTR.exec(src)) !== null) {
    const lower = (m[1] || '').trim().toLowerCase();
    if (
      !lower ||
      lower === 'none' ||
      lower === 'transparent' ||
      lower === 'inherit' ||
      lower.startsWith('url(')
    )
      continue;
    if (lower === 'currentcolor') {
      sum += 0.15;
      n++;
      continue;
    }
    const parsed = parseColor(lower) ?? namedColor(lower);
    if (!parsed || parsed.alpha < 0.5) continue;
    const { r, g, b } = hexToRgb(parsed.hex);
    sum += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    n++;
  }
  return n === 0 ? null : sum / n;
}

// ── Raster color extraction ───────────────────────────────────────────

/**
 * Rank the dominant chromatic colors of a decoded RGBA buffer.
 *
 * - Fully/mostly transparent pixels are skipped (alpha < 200) so a
 *   white-on-transparent wordmark isn't biased by its own background.
 * - Pixels are bucketed at 4 bits per channel (16 levels → 4096 buckets),
 *   then each surviving bucket reports the MEAN of its members, so the
 *   returned hex is a real color from the mark rather than a bucket centre.
 * - Only chromatic buckets are returned (see `isChromatic`).
 *
 * @param data   RGBA bytes, length = width*height*4
 */
export function dominantColorsFromRgba(
  data: Uint8Array | Buffer,
  opts: { alphaFloor?: number; maxColors?: number } = {},
): LogoColor[] {
  const alphaFloor = opts.alphaFloor ?? 200;
  if (!data || data.length < 4) return [];
  const buckets = new Map<
    number,
    { r: number; g: number; b: number; n: number }
  >();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < alphaFloor) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = buckets.get(key);
    if (cur) {
      cur.r += r;
      cur.g += g;
      cur.b += b;
      cur.n += 1;
    } else {
      buckets.set(key, { r, g, b, n: 1 });
    }
  }
  const counts = new Map<string, number>();
  for (const b of buckets.values()) {
    const hex = rgbToHexTuple(
      Math.round(b.r / b.n),
      Math.round(b.g / b.n),
      Math.round(b.b / b.n),
    );
    if (!isChromatic(hex)) continue;
    counts.set(hex, (counts.get(hex) || 0) + b.n);
  }
  return rankColorCounts(counts, opts.maxColors ?? 6);
}

/** Mean luminance of the OPAQUE pixels — the raster tone signal. */
export function averageOpaqueLuminance(
  data: Uint8Array | Buffer,
  alphaFloor = 200,
): number | null {
  if (!data || data.length < 4) return null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < alphaFloor) continue;
    // ITU-R BT.601 — matches the browser-side useLogoTone heuristic.
    sum += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    n++;
  }
  return n === 0 ? null : sum / n;
}

function rgbToHexTuple(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Sort by coverage, then collapse near-duplicate hues so a 3-shade gradient
 * of one blue doesn't occupy all the slots. Hue gap of 22° (or a big
 * lightness gap) counts as a distinct brand color.
 */
function rankColorCounts(
  counts: Map<string, number>,
  maxColors = 6,
): LogoColor[] {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const sorted = [...counts.entries()]
    .map(([hex, count]) => ({ hex, count, share: count / total }))
    .sort((a, b) => b.count - a.count);

  const out: LogoColor[] = [];
  for (const c of sorted) {
    const ch = hsl(c.hex);
    const dupe = out.some((k) => {
      const kh = hsl(k.hex);
      let dh = Math.abs(kh.h - ch.h);
      if (dh > 180) dh = 360 - dh;
      return dh < 22 && Math.abs(kh.l - ch.l) < 26;
    });
    if (dupe) continue;
    out.push(c);
    if (out.length >= maxColors) break;
  }
  return out;
}

// ── Palette selection ─────────────────────────────────────────────────

export interface LogoPaletteChoice {
  primary: string;
  accent?: string;
  /**
   * Where each slot came from — surfaced in the preview warnings + tests.
   *  'logo'      both slots from the mark
   *  'logo+page' primary from the mark, accent from the page
   *  'page'      the mark yielded no usable color (monochrome / fetch failed)
   */
  source: 'logo' | 'logo+page' | 'page';
  reasons: string[];
}

/** Hue distance in degrees, 0..180. */
function hueGap(a: string, b: string): number {
  const ha = hsl(a).h;
  const hb = hsl(b).h;
  let d = Math.abs(ha - hb);
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * Choose primary + accent, preferring the LOGO's own colors.
 *
 * Precedence:
 *   1. primary = the logo's most-covering chromatic color.
 *   2. accent  = the logo's next chromatic color that is a genuinely
 *      different hue (≥ 30° away) — a two-color mark brands itself.
 *   3. if the mark is single-hue, accent = the first PAGE color that is
 *      ≥ 30° from the logo primary (the site's own secondary, which the
 *      designer already chose to sit next to this mark).
 *   4. if the mark yields nothing chromatic at all (a black wordmark, a
 *      failed fetch, a CORS-blocked image), fall back to today's behavior
 *      entirely: page colors, unchanged.
 *
 * Returning `accent: undefined` is legal — `derivePalette` then generates
 * the complement exactly as it does today.
 */
export function paletteFromLogoColors(
  logoColors: LogoColor[] | null | undefined,
  pageColors: string[] | null | undefined,
): LogoPaletteChoice | null {
  const page = (pageColors || []).filter(
    (h) => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h),
  );
  const logo = (logoColors || []).filter((c) => c && isChromatic(c.hex));

  if (logo.length === 0) {
    if (page.length === 0) return null; // caller keeps its own default
    return {
      primary: page[0],
      accent: page[1],
      source: 'page',
      reasons: ['logo yielded no chromatic color'],
    };
  }

  const primary = logo[0].hex;
  const reasons = [
    `primary from logo (${(logo[0].share * 100).toFixed(0)}% of mark)`,
  ];

  const logoAccent = logo.slice(1).find((c) => hueGap(primary, c.hex) >= 30);
  if (logoAccent) {
    reasons.push('accent from a second logo hue');
    return { primary, accent: logoAccent.hex, source: 'logo', reasons };
  }

  const pageAccent = page.find((h) => hueGap(primary, h) >= 30);
  if (pageAccent) {
    reasons.push('monochrome mark — accent from page colors');
    return { primary, accent: pageAccent, source: 'logo+page', reasons };
  }

  reasons.push(
    'monochrome mark and no distinct page hue — accent auto-derived',
  );
  return { primary, accent: undefined, source: 'logo+page', reasons };
}

// ── Backdrop selection ────────────────────────────────────────────────

export interface LogoBackgroundInput {
  /** Mean luminance of the mark's opaque ink, 0..1. Null when unknown. */
  luminance?: number | null;
  /** The mark's dominant chromatic color, when it has one. */
  dominantHex?: string | null;
  /** The palette primary the logo will sit next to. */
  primaryHex?: string | null;
}

/**
 * "Do our best to get it right" — the DEFAULT backdrop for a given mark.
 * The operator can always override with the wizard's 3rd picker.
 *
 * Rules, in order:
 *   - Unknown ink (CORS-blocked canvas, un-decodable image): 'primary'.
 *     Most un-analyzable marks are white-on-transparent wordmarks, and a
 *     brand-colored chip is the treatment that already ships today — so the
 *     unknown case is a no-op against current behavior.
 *   - Light ink (luminance > 0.62): needs a dark backing. Use 'primary' when
 *     the brand primary is dark enough to carry it (≥ 3:1 against the ink),
 *     else 'dark'.
 *   - Dark ink (luminance < 0.38): 'transparent' — it reads fine on the
 *     light chrome, and boxing it looks cheap.
 *   - Mid-tone / colored ink: 'white' when the mark keeps ≥ 1.6:1 against
 *     white (a saturated lotus does), otherwise 'dark'. A colored mark on a
 *     brand-primary chip is the clash the operator complained about, so
 *     'primary' is deliberately NOT the default here.
 */
export function suggestLogoBackground(
  input: LogoBackgroundInput,
): LogoBackground {
  const lum =
    typeof input.luminance === 'number' && isFinite(input.luminance)
      ? input.luminance
      : null;
  const primary =
    input.primaryHex && /^#[0-9a-f]{6}$/i.test(input.primaryHex)
      ? input.primaryHex
      : null;
  const dominant =
    input.dominantHex && /^#[0-9a-f]{6}$/i.test(input.dominantHex)
      ? input.dominantHex
      : null;

  if (lum === null) return 'primary';

  if (lum > 0.62) {
    // Light mark. Prefer the branded chip when it actually contrasts.
    if (primary && relativeLuminance(primary) < 0.4) return 'primary';
    return 'dark';
  }

  if (lum < 0.38) return 'transparent';

  // Mid-tone / colored mark.
  if (dominant && contrastRatio(dominant, '#ffffff') >= 1.6) return 'white';
  return 'dark';
}
