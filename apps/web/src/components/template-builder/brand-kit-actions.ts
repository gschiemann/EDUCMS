/**
 * Pure placement + colour helpers for the Brand tab (owner feedback
 * 2026-10-12: "picking colors and fonts I don't see anything happen").
 * Kept free of React and the store so the geometry is unit-testable.
 */
import type { MediaDimensions } from './media-sizing';

/** Widgets whose visible copy reads zone-level `color` / `fontFamily`. */
export const BRAND_TEXT_WIDGETS = new Set(['TEXT', 'RICH_TEXT', 'TICKER', 'ANNOUNCEMENT']);

export interface ZoneGeometry { x: number; y: number; width: number; height: number }

/**
 * A logo pinned to the TOP-LEFT corner at a sensible size, keeping the
 * logo's own aspect ratio. Sizes are in canvas pixels first (so a square
 * logo stays square on a 16:9 canvas), then converted to the zone's
 * percentage space.
 *
 * - height target: 14% of the canvas's SHORT side
 * - width capped at 28% of the canvas width (a wide wordmark scales down)
 * - margin: 3% of the short side, the same on both edges
 *
 * Unknown dimensions (the logo could not be read) fall back to a square.
 */
export function logoCornerGeometry(source: MediaDimensions | null, canvas: MediaDimensions): ZoneGeometry {
  const short = Math.min(canvas.width, canvas.height);
  const aspect = source && source.width > 0 && source.height > 0 ? source.width / source.height : 1;
  let h = short * 0.14;
  let w = h * aspect;
  const maxW = canvas.width * 0.28;
  if (w > maxW) { w = maxW; h = w / aspect; }
  const margin = short * 0.03;
  return {
    x: (margin / canvas.width) * 100,
    y: (margin / canvas.height) * 100,
    width: (w / canvas.width) * 100,
    height: (h / canvas.height) * 100,
  };
}

/**
 * A new text box dropped by clicking a brand font with nothing selected.
 * Heading = a wide headline strip in the upper third; body = a smaller
 * paragraph box under it. Both centred horizontally.
 */
export function brandTextBox(kind: 'heading' | 'body'): ZoneGeometry & { fontSize: number } {
  return kind === 'heading'
    ? { x: 15, y: 22, width: 70, height: 18, fontSize: 48 }
    : { x: 20, y: 44, width: 60, height: 14, fontSize: 28 };
}

/** The next DIFFERENT colour in the brand palette, wrapping around. */
export function nextBrandColor(colors: string[], hex: string): string | null {
  const distinct = colors.filter((c, i) => c && colors.findIndex(o => o.toLowerCase() === c.toLowerCase()) === i);
  if (distinct.length < 2) return null;
  const i = distinct.findIndex(c => c.toLowerCase() === hex.toLowerCase());
  for (let step = 1; step < distinct.length; step++) {
    const c = distinct[(Math.max(i, 0) + step) % distinct.length];
    if (c.toLowerCase() !== hex.toLowerCase()) return c;
  }
  return null;
}

export function brandGradient(from: string, to: string): string {
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}
