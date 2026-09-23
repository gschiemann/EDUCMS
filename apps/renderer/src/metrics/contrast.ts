/**
 * Text contrast, read from the RENDERED pixels — two frames of them.
 *
 * The DOM alone cannot answer "is this readable": text sits on photos,
 * gradients, scrims and translucent panels whose composited colour only exists
 * in the frame. A single frame cannot answer it cleanly either: inside a glyph
 * box, anti-aliased edge pixels and a grey background are the same colours.
 *
 * So the renderer takes TWO shots of the frozen board: the normal FRAME, and a
 * BACKPLATE with every glyph's fill made transparent (`-webkit-text-fill-color`
 * only — borders, icons, shadows and strokes that use currentColor stay). Under
 * each text box the backplate IS the background, exactly, pixel for pixel; the
 * pixels that differ between the two frames are the ink.
 *
 *   ratio     — the text against the DOMINANT background colour under it
 *               (exact for a flat panel);
 *   minRatio  — against the worst 10 % of background pixels under it (the
 *               bright patch of a photo, the light end of a gradient);
 *   inkShare  — how much of the box the text actually drew. ≈0 for text whose
 *               colour differs from its background means something is painted
 *               OVER it (a photo, a panel): the text is not visible at all.
 */
import { blendOver, colorDistance, contrastRatio, type RGB, type RGBA } from './color.js';
import { rgbAt, samplePositions, type PixelImage, type PxRect } from './pixels.js';

export interface ContrastReading {
  ratio: number;
  minRatio: number;
  fg: RGB;
  bg: RGB;
  samples: number;
  /** Share of sampled pixels the text changed (its ink). */
  inkShare: number;
  /** The text colour had to be inferred from the pixels (gradient / transparent fill). */
  fgFromPixels: boolean;
}

interface Bucket {
  n: number;
  r: number;
  g: number;
  b: number;
}

/** Quantised colour histogram (5 bits per channel), most frequent first. */
export function colorHistogram(pixels: RGB[]): Array<{ n: number; color: RGB }> {
  const map = new Map<number, Bucket>();
  for (const p of pixels) {
    const key = ((p.r >> 3) << 10) | ((p.g >> 3) << 5) | (p.b >> 3);
    let e = map.get(key);
    if (!e) {
      e = { n: 0, r: 0, g: 0, b: 0 };
      map.set(key, e);
    }
    e.n += 1;
    e.r += p.r;
    e.g += p.g;
    e.b += p.b;
  }
  return [...map.values()]
    .sort((a, b) => b.n - a.n)
    .map((e) => ({ n: e.n, color: { r: e.r / e.n, g: e.g / e.n, b: e.b / e.n } }));
}

/** A pixel counts as ink when the two frames differ by more than this (RGB distance). */
export const INK_DELTA = 20;

/**
 * Contrast of one text element.
 *
 * @param frame  the normal screenshot
 * @param plate  the same frame with glyph fills transparent (same size)
 * @param rects  the text's visible glyph boxes, IMAGE pixels
 * @param fill   the text's fill with its effective alpha (colour alpha ×
 *               opacity), or null when the fill is not a flat colour
 */
export function measureTextContrast(
  frame: PixelImage,
  plate: PixelImage,
  rects: PxRect[],
  fill: RGBA | null,
  opts: { maxSamples?: number } = {},
): ContrastReading | null {
  if (frame.width !== plate.width || frame.height !== plate.height) return null;
  const positions = samplePositions(frame, rects, opts.maxSamples ?? 6000);
  if (positions.length < 4) return null;

  const backs: RGB[] = [];
  const inks: Array<{ px: RGB; delta: number }> = [];
  for (const pos of positions) {
    const shown = rgbAt(frame, pos);
    const back = rgbAt(plate, pos);
    backs.push(back);
    const delta = colorDistance(shown, back);
    if (delta > INK_DELTA) inks.push({ px: shown, delta });
  }
  const bg = (colorHistogram(backs)[0] as { color: RGB }).color;
  const inkShare = inks.length / positions.length;

  // The text colour: the declared fill (composited per pixel when it is
  // translucent), or — gradient text, transparent fill — the strongest ink.
  let fgAt: (back: RGB) => RGB;
  let fgFromPixels = false;
  if (fill && fill.a >= 0.1) {
    const opaque: RGB = { r: fill.r, g: fill.g, b: fill.b };
    fgAt = fill.a < 0.999 ? (back) => blendOver(fill, back) : () => opaque;
  } else {
    fgFromPixels = true;
    let fgConst = bg;
    if (inks.length > 0) {
      const strongest = Math.max(...inks.map((i) => i.delta));
      const core = inks.filter((i) => i.delta >= strongest * 0.8);
      fgConst = {
        r: core.reduce((s, i) => s + i.px.r, 0) / core.length,
        g: core.reduce((s, i) => s + i.px.g, 0) / core.length,
        b: core.reduce((s, i) => s + i.px.b, 0) / core.length,
      };
    }
    fgAt = () => fgConst;
  }

  const ratio = contrastRatio(fgAt(bg), bg);
  const per = backs.map((b) => contrastRatio(fgAt(b), b)).sort((a, b) => a - b);
  const p10 = per[Math.floor(0.1 * (per.length - 1))] as number;
  return {
    ratio,
    minRatio: Math.min(ratio, p10),
    fg: fgAt(bg),
    bg,
    samples: positions.length,
    inkShare,
    fgFromPixels,
  };
}

/**
 * Text that should be visible against its background but drew (almost) no
 * ink: something is painted over it. `ratio` guards the other reason a text
 * draws nothing — being the same colour as what is behind it, which the
 * contrast numbers already report.
 */
export function looksOccluded(reading: ContrastReading): boolean {
  return reading.inkShare < 0.02 && reading.ratio >= 1.5 && !reading.fgFromPixels;
}
