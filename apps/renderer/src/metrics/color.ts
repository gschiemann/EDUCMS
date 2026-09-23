/**
 * Colour math for the contrast measurement — WCAG 2.x relative luminance and
 * contrast ratio, sRGB, 0–255 channels. Pure.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Alpha 0–1. */
export interface RGBA extends RGB {
  a: number;
}

function toLinear(channel: number): number {
  const s = Math.min(255, Math.max(0, channel)) / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function relativeLuminance(c: RGB): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** WCAG contrast ratio, 1 – 21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` composited over an opaque `bg` (source-over). */
export function blendOver(fg: RGBA, bg: RGB): RGB {
  const a = Math.min(1, Math.max(0, fg.a));
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
  };
}

/** Euclidean distance in RGB space (0 – ~441). */
export function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function toHex(c: RGB): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Round a ratio for reporting (two decimals). */
export function roundRatio(r: number): number {
  return Math.round(r * 100) / 100;
}
