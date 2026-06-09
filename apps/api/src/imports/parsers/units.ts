/**
 * Pure unit-conversion + geometry helpers for Import 2.0.
 *
 * Kept dependency-free and side-effect-free so they are trivially
 * unit-testable (imports.parsers.spec.ts). All of the "fidelity" of
 * the PPTX path lives in these conversions:
 *
 *   - PowerPoint geometry is in EMUs (English Metric Units).
 *     914400 EMU = 1 inch = 96 CSS px. Shapes carry `<a:off x y>`
 *     (top-left) and `<a:ext cx cy>` (size) in EMU; the slide size is
 *     in `presentation.xml` `<p:sldSz cx cy>` (also EMU).
 *   - PowerPoint font size (`sz` on `<a:rPr>`) is in HUNDREDTHS of a
 *     point: sz=1800 → 18pt. We convert points → px at 96dpi
 *     (1pt = 96/72 = 1.333px) because the builder canvas is a px
 *     surface and TextWidget reads fontSize as px.
 */

/** EMUs per inch (OOXML constant). */
export const EMU_PER_INCH = 914400;
/** CSS pixels per inch (the canvas reference DPI). */
export const PX_PER_INCH = 96;
/** EMUs per CSS pixel. */
export const EMU_PER_PX = EMU_PER_INCH / PX_PER_INCH; // 9525

/** Convert an EMU length to CSS pixels. */
export function emuToPx(emu: number): number {
  if (!Number.isFinite(emu)) return 0;
  return emu / EMU_PER_PX;
}

/** Convert points to CSS pixels at 96dpi. */
export function ptToPx(pt: number): number {
  if (!Number.isFinite(pt)) return 0;
  return (pt * PX_PER_INCH) / 72;
}

/**
 * Convert a PowerPoint `sz` attribute (hundredths of a point) to a
 * px fontSize the TextWidget can render, clamped to a sane range so a
 * malformed deck can't produce a 0px or 4000px run.
 *
 * Default 18pt (sz=1800) when absent — PowerPoint's body default.
 */
export function pptSzToFontSizePx(sz: number | undefined | null): number {
  const pt =
    typeof sz === 'number' && Number.isFinite(sz) && sz > 0 ? sz / 100 : 18;
  const px = ptToPx(pt);
  // Floor 8px (legible-but-tiny), ceil 800px (a 4K hero title).
  return Math.round(clamp(px, 8, 800));
}

/** Clamp a number into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Convert an absolute px rectangle on a page of (canvasW × canvasH) px
 * into a %-of-canvas zone, clamped so x+width ≤ 100 and y+height ≤ 100
 * (the builder's validateZoneBounds rejects overflow). Returns null if
 * the result is degenerate (zero/negative size) so the caller can drop
 * the zone rather than persist an invalid one.
 */
export function pxRectToPercent(
  xPx: number,
  yPx: number,
  wPx: number,
  hPx: number,
  canvasW: number,
  canvasH: number,
): { x: number; y: number; width: number; height: number } | null {
  if (canvasW <= 0 || canvasH <= 0) return null;
  // Round to 4 decimals — enough precision for a 4K canvas, avoids
  // float-dust like 33.33333333333.
  const round = (v: number) => Math.round(v * 10000) / 10000;

  const x = clamp((xPx / canvasW) * 100, 0, 100);
  const y = clamp((yPx / canvasH) * 100, 0, 100);
  let width = clamp((wPx / canvasW) * 100, 0, 100);
  let height = clamp((hPx / canvasH) * 100, 0, 100);

  // Pull width/height in if the shape spills past the right/bottom edge.
  if (x + width > 100) width = 100 - x;
  if (y + height > 100) height = 100 - y;

  if (width <= 0.01 || height <= 0.01) return null;
  return {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
  };
}

/**
 * Normalize an OOXML solid-fill / run color to a `#rrggbb` string.
 * Accepts a 6-hex `srgbClr val`, or a small set of named presets.
 * Returns null for anything we can't resolve (theme colors, schemes)
 * so the caller leaves the field unset and the widget default applies.
 */
export function ooxmlColorToHex(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  // A handful of OOXML preset color names map cleanly to hex.
  const NAMED: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    green: '#008000',
    blue: '#0000ff',
    yellow: '#ffff00',
    gray: '#808080',
    grey: '#808080',
  };
  return NAMED[s.toLowerCase()] ?? null;
}
