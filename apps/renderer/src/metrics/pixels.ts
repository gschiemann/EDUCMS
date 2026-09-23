/**
 * A decoded screenshot and the sampling helpers the pixel measurements share.
 * Pure — the image is a plain RGB(A) byte buffer (sharp's raw output).
 */
import type { RGB } from './color.js';

export interface PixelImage {
  data: Uint8Array;
  width: number;
  height: number;
  /** 3 (RGB) or 4 (RGBA). */
  channels: number;
}

/** A rectangle in IMAGE pixels. */
export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clamp a rect to the image; null when nothing is left. Integer bounds, half-open. */
export function clampRect(img: PixelImage, r: PxRect): { x0: number; y0: number; x1: number; y1: number } | null {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(img.width, Math.ceil(r.x + r.w));
  const y1 = Math.min(img.height, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

/**
 * Up to `maxSamples` pixels spread evenly over the rects (a common 2-D stride,
 * so a big headline and a small caption are both sampled across their whole
 * box rather than just their first rows).
 */
export function samplePixels(img: PixelImage, rects: PxRect[], maxSamples = 8000): RGB[] {
  const boxes = rects.map((r) => clampRect(img, r)).filter((b): b is NonNullable<typeof b> => b !== null);
  let area = 0;
  for (const b of boxes) area += (b.x1 - b.x0) * (b.y1 - b.y0);
  if (area === 0) return [];
  const stride = Math.max(1, Math.ceil(Math.sqrt(area / maxSamples)));
  const out: RGB[] = [];
  const { data, width, channels } = img;
  for (const b of boxes) {
    for (let y = b.y0; y < b.y1; y += stride) {
      const row = y * width;
      for (let x = b.x0; x < b.x1; x += stride) {
        const i = (row + x) * channels;
        out.push({ r: data[i] as number, g: data[i + 1] as number, b: data[i + 2] as number });
      }
    }
  }
  return out;
}
