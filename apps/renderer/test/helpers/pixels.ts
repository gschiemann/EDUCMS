/**
 * Synthetic frames for the pixel-math unit tests.
 */
import type { PixelImage, PxRect } from '../../src/metrics/pixels.js';
import type { RGB } from '../../src/metrics/color.js';

export function makeImage(width: number, height: number, fill: RGB): PixelImage {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 3] = fill.r;
    data[i * 3 + 1] = fill.g;
    data[i * 3 + 2] = fill.b;
  }
  return { data, width, height, channels: 3 };
}

export function setPixel(img: PixelImage, x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * img.channels;
  img.data[i] = Math.round(c.r);
  img.data[i + 1] = Math.round(c.g);
  img.data[i + 2] = Math.round(c.b);
}

export function fillRect(img: PixelImage, r: PxRect, c: RGB): void {
  for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) setPixel(img, x, y, c);
}

const mix = (a: RGB, b: RGB, t: number): RGB => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });

/**
 * Fake glyphs: vertical strokes `stroke` px wide every `pitch` px, with one
 * anti-aliased column on each side — roughly the ink pattern of text.
 */
export function drawStrokes(img: PixelImage, r: PxRect, ink: RGB, opts: { stroke?: number; pitch?: number } = {}): void {
  const stroke = opts.stroke ?? 4;
  const pitch = opts.pitch ?? 10;
  for (let x = r.x; x < r.x + r.w; x += pitch) {
    for (let y = r.y; y < r.y + r.h; y += 1) {
      const i = (y * img.width + (x - 1)) * img.channels;
      const under: RGB = { r: img.data[i] as number, g: img.data[i + 1] as number, b: img.data[i + 2] as number };
      setPixel(img, x - 1, y, mix(under, ink, 0.5));
      for (let k = 0; k < stroke; k += 1) setPixel(img, x + k, y, ink);
      setPixel(img, x + stroke, y, mix(under, ink, 0.5));
    }
  }
}

/** Deterministic pseudo-random noise over a rect (a "photo"). */
export function fillNoise(img: PixelImage, r: PxRect, base: RGB, spread: number, seed = 7): void {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let y = r.y; y < r.y + r.h; y += 1) {
    for (let x = r.x; x < r.x + r.w; x += 1) {
      const d = (rand() - 0.5) * 2 * spread;
      setPixel(img, x, y, {
        r: Math.min(255, Math.max(0, base.r + d)),
        g: Math.min(255, Math.max(0, base.g + d)),
        b: Math.min(255, Math.max(0, base.b + d)),
      });
    }
  }
}
