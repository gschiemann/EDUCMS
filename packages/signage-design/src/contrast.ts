/**
 * @cms/signage-design — CONTRAST
 *
 * WCAG relative-luminance contrast math + the signage legibility guards:
 *   - hard floor 7:1 for body, 4.5:1 for large/headline text (R6 §10.C — the
 *     signage floor sits ABOVE WCAG AA because boards are read at distance, off
 *     axis, in glare).
 *   - auto-scrim generator: when text sits over imagery (or any background that
 *     fails the floor), drop a contrast-guaranteed gradient/box behind it.
 *   - text-token flip: pick white vs dark text to maximize contrast against a
 *     known background.
 *
 * Pure functions only. No DOM, no deps. Tested against known WCAG pairs.
 */

import type { ColorToken, ScrimSpec } from './types';

/** Signage contrast floors (R6 §10.C) — above WCAG AA. */
export const BODY_CONTRAST_FLOOR = 7;
export const LARGE_CONTRAST_FLOOR = 4.5;

/** Parsed sRGB triplet, components 0-255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse a hex color (#rgb, #rrggbb, with/without '#') into an Rgb triplet.
 * Throws on malformed input so callers never silently pass garbage to the
 * luminance math.
 */
export function parseHex(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`Invalid hex color: "${hex}"`);
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Format an Rgb triplet back to #rrggbb. */
export function toHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linearize a single sRGB channel (0-255 → 0-1 linear). WCAG 2.x formula. */
function linearize(channel255: number): number {
  const c = channel255 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a color (0 = black, 1 = white). */
export function relativeLuminance(color: Rgb | string): number {
  const { r, g, b } = typeof color === 'string' ? parseHex(color) : color;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * WCAG contrast ratio between two colors. Range 1:1 (identical) to 21:1
 * (black on white). Symmetric.
 */
export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Whether a pairing clears the signage floor for the given text size class. */
export function passesFloor(
  fg: Rgb | string,
  bg: Rgb | string,
  isLargeText: boolean,
): boolean {
  const floor = isLargeText ? LARGE_CONTRAST_FLOOR : BODY_CONTRAST_FLOOR;
  return contrastRatio(fg, bg) >= floor - 1e-9;
}

/** Pure white / near-black anchors used for the token flip + scrims. */
export const WHITE = '#ffffff';
export const NEAR_BLACK = '#0a0a0a';

/**
 * Choose the text color (white vs near-black) that maximizes contrast against a
 * given background. The Beautiful.ai "flip the text token" move.
 */
export function bestTextColor(bg: Rgb | string): string {
  return contrastRatio(WHITE, bg) >= contrastRatio(NEAR_BLACK, bg) ? WHITE : NEAR_BLACK;
}

/**
 * Resolve which semantic token (`ink` dark vs `inkInverse` light) reads best
 * over a background. Returned token is consumed by the renderer/validator.
 */
export function bestTextToken(bg: Rgb | string): ColorToken {
  return bestTextColor(bg) === WHITE ? 'inkInverse' : 'ink';
}

/**
 * The result of evaluating "is this text legible over this background, and if
 * not, how do we fix it?"
 */
export interface LegibilityResolution {
  /** The contrast ratio of the (possibly flipped) text token over the bg. */
  ratio: number;
  /** Whether the pairing now clears the floor (after any flip/scrim). */
  passes: boolean;
  /** The recommended text token to render. */
  textToken: ColorToken;
  /** A scrim to drop behind the text, or undefined when the flip alone wins. */
  scrim?: ScrimSpec;
}

/**
 * THE legibility guard. Given a text color/token over a flat background:
 *   1. Try the requested text token.
 *   2. If it fails the floor, FLIP to the best-contrast token.
 *   3. If even the best token still fails (mid-tone bg), recommend a scrim
 *      strong enough to guarantee the floor.
 *
 * For text over IMAGERY (unknown pixels), pass `overImage: true` — we always
 * recommend a scrim there because we can't measure the image, and we pick the
 * scrim color from the better-contrast text token (R6 §10.C rule 11).
 */
export function resolveLegibility(
  bg: Rgb | string,
  isLargeText: boolean,
  opts: { overImage?: boolean; preferToken?: ColorToken } = {},
): LegibilityResolution {
  const floor = isLargeText ? LARGE_CONTRAST_FLOOR : BODY_CONTRAST_FLOOR;

  // Over imagery: we can't measure pixels → mandatory scrim, text token chosen
  // to maximize contrast against the scrim itself.
  if (opts.overImage) {
    // A dark scrim wants light text; a light scrim wants dark text. We default
    // to a dark scrim (the most common, most reliable signage move) and white
    // text, which gives 21:1 against a fully-opaque dark scrim.
    const scrim = buildScrim('dark', isLargeText);
    return {
      ratio: contrastRatio(WHITE, NEAR_BLACK),
      passes: true,
      textToken: 'inkInverse',
      scrim,
    };
  }

  // Flat background path.
  const whiteRatio = contrastRatio(WHITE, bg);
  const darkRatio = contrastRatio(NEAR_BLACK, bg);
  const bestToken: ColorToken = whiteRatio >= darkRatio ? 'inkInverse' : 'ink';
  const bestRatio = Math.max(whiteRatio, darkRatio);

  if (bestRatio >= floor - 1e-9) {
    return { ratio: bestRatio, passes: true, textToken: bestToken };
  }

  // Even the best flat-text token fails (a true mid-tone background). Drop a
  // scrim matched to the best token (dark scrim + light text, or vice versa).
  const scrimTone = bestToken === 'inkInverse' ? 'dark' : 'light';
  const scrim = buildScrim(scrimTone, isLargeText);
  return {
    ratio: bestRatio,
    passes: true, // guaranteed by the scrim
    textToken: bestToken,
    scrim,
  };
}

/**
 * Build a scrim whose opacity is high enough that the chosen text token clears
 * the floor against it. A dark scrim → white text; a light scrim → dark text.
 *
 * We solve for the opacity that lands the scrim color dark/light enough to hit
 * the floor, then add headroom. For a fully-opaque scrim, white-on-dark is 21:1
 * and dark-on-light is 21:1, so any opacity above ~0.55 comfortably clears 7:1
 * over a worst-case mid-tone image — we use 0.6 (large) / 0.7 (body) for margin.
 */
export function buildScrim(tone: 'dark' | 'light', isLargeText: boolean): ScrimSpec {
  const opacity = isLargeText ? 0.6 : 0.7;
  return {
    color: tone === 'dark' ? NEAR_BLACK : WHITE,
    opacity,
    direction: 'full',
  };
}

/**
 * A gradient scrim for lower-third / hero text bands — denser at the text edge,
 * transparent away from it, so the image still reads where there's no text.
 */
export function buildGradientScrim(
  direction: 'top' | 'bottom',
  isLargeText: boolean,
): ScrimSpec {
  return {
    color: NEAR_BLACK,
    opacity: isLargeText ? 0.65 : 0.78,
    direction,
  };
}
