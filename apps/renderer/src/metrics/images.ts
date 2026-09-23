/**
 * How big a bitmap is actually DRAWN, and how far that stretches it past its
 * own pixels. Pure.
 *
 * A board is judged at its design canvas (a 4K board plays on 4K panels), so
 * the caller converts the drawn size to canvas px before asking for the
 * upscale: an image drawn 1.3× past its natural pixels is visibly soft, and
 * the Wix blur placeholder that landed on a Designer board (151 × 101 shown
 * full-bleed) is ~21×.
 */

export interface Size {
  w: number;
  h: number;
}

export type ObjectFit = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';

/** Drawn size of an <img>'s content for a given object-fit (CSS px). */
export function objectFitDrawnSize(box: Size, natural: Size, fit: string): Size {
  if (natural.w <= 0 || natural.h <= 0) return { w: 0, h: 0 };
  const contain = Math.min(box.w / natural.w, box.h / natural.h);
  switch (fit as ObjectFit) {
    case 'contain':
      return { w: natural.w * contain, h: natural.h * contain };
    case 'cover': {
      const s = Math.max(box.w / natural.w, box.h / natural.h);
      return { w: natural.w * s, h: natural.h * s };
    }
    case 'none':
      return { w: natural.w, h: natural.h };
    case 'scale-down': {
      const s = Math.min(1, contain);
      return { w: natural.w * s, h: natural.h * s };
    }
    case 'fill':
    default:
      return { w: box.w, h: box.h };
  }
}

/** One `background-size` component: px / % / bare number, or null for auto/unparsed. */
function parseBgLength(token: string, reference: number): number | null {
  const t = token.trim();
  if (!t || t === 'auto') return null;
  const px = /^(-?\d+(?:\.\d+)?)px$/.exec(t);
  if (px) return Number(px[1]);
  const pct = /^(-?\d+(?:\.\d+)?)%$/.exec(t);
  if (pct) return (Number(pct[1]) / 100) * reference;
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
  return null;
}

/**
 * Drawn size of one background layer (CSS Backgrounds 3 §3.9), given the
 * computed `background-size` for that layer and the positioning area (CSS px).
 */
export function backgroundDrawnSize(value: string, area: Size, natural: Size): Size {
  if (natural.w <= 0 || natural.h <= 0) return { w: 0, h: 0 };
  const v = value.trim();
  if (v === 'cover' || v === 'contain') {
    const sx = area.w / natural.w;
    const sy = area.h / natural.h;
    const s = v === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
    return { w: natural.w * s, h: natural.h * s };
  }
  const parts = v.split(/\s+/);
  const w = parseBgLength(parts[0] ?? 'auto', area.w);
  const h = parseBgLength(parts[1] ?? 'auto', area.h);
  if (w === null && h === null) return { w: natural.w, h: natural.h };
  if (w !== null && h === null) return { w, h: (w * natural.h) / natural.w };
  if (w === null && h !== null) return { w: (h * natural.w) / natural.h, h };
  return { w: w as number, h: h as number };
}

/** drawn ÷ natural along the more-stretched axis. */
export function upscaleRatio(drawn: Size, natural: Size): number | null {
  if (natural.w <= 0 || natural.h <= 0 || drawn.w <= 0 || drawn.h <= 0) return null;
  return Math.max(drawn.w / natural.w, drawn.h / natural.h);
}

/** Aspect distortion: the larger axis scale ÷ the smaller (1 = true to the source). */
export function aspectDistortion(drawn: Size, natural: Size): number | null {
  if (natural.w <= 0 || natural.h <= 0 || drawn.w <= 0 || drawn.h <= 0) return null;
  const sx = drawn.w / natural.w;
  const sy = drawn.h / natural.h;
  return Math.max(sx, sy) / Math.min(sx, sy);
}

/** The blur threshold the rubric uses. */
export const BLURRY_UPSCALE = 1.3;
