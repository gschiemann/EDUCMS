/**
 * Text contrast, read from the RENDERED pixels behind each text box.
 *
 * The DOM alone cannot answer "is this readable": text sits on photos,
 * gradients, scrims and translucent panels whose composited colour only exists
 * in the frame. So each text element's glyph boxes are sampled from the
 * screenshot and split into three populations:
 *
 *   • glyph pixels — close to the text's own colour;
 *   • anti-aliasing — mixes that lie on the segment between text and
 *     background colour;
 *   • background — everything else.
 *
 * `ratio` is the text against the DOMINANT background colour (the most common
 * colour that is clearly not text) — exact for a flat panel. `minRatio` is the
 * text against the worst 10 % of real background pixels, which is what a photo
 * or gradient behind a headline actually costs. When most of the box is the
 * text's own colour the text is dissolving into its background, and
 * `minRatio` says so.
 *
 * Limitation, stated: a background pixel that happens to be the text's exact
 * colour is indistinguishable from a glyph pixel. The `fgShare` guard catches
 * the case where that is most of the box; a few such pixels are not seen.
 */
import { blendOver, colorDistance, contrastRatio, type RGB, type RGBA } from './color.js';
import { samplePixels, type PixelImage, type PxRect } from './pixels.js';

export interface ContrastReading {
  ratio: number;
  minRatio: number;
  fg: RGB;
  bg: RGB;
  samples: number;
  /** The text colour had to be inferred from the pixels (gradient / transparent fill). */
  fgFromPixels: boolean;
}

interface Bucket {
  n: number;
  r: number;
  g: number;
  b: number;
}

function center(b: Bucket): RGB {
  return { r: b.r / b.n, g: b.g / b.n, b: b.b / b.n };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx] as number;
}

/** Quantised colour histogram (5 bits per channel), most frequent first. */
export function colorHistogram(pixels: RGB[]): Bucket[] {
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
  return [...map.values()].sort((a, b) => b.n - a.n);
}

/**
 * Contrast of one text element.
 *
 * @param rects  the text's glyph boxes in IMAGE pixels
 * @param text   the text's fill colour with its effective alpha (colour alpha ×
 *               opacity), or null when the fill is not a flat colour
 */
export function measureTextContrast(
  img: PixelImage,
  rects: PxRect[],
  text: RGBA | null,
  opts: { maxSamples?: number } = {},
): ContrastReading | null {
  const pixels = samplePixels(img, rects, opts.maxSamples ?? 8000);
  if (pixels.length < 4) return null;
  const hist = colorHistogram(pixels);
  const first = hist[0];
  if (!first) return null;

  // ── Fill unknown (gradient text, transparent fill + stroke): infer it. ──
  if (!text || text.a < 0.1) {
    const bg = center(first);
    let fg = bg;
    let best = 1;
    for (const e of hist) {
      if (e.n < pixels.length * 0.02) continue;
      const c = contrastRatio(center(e), bg);
      if (c > best) {
        best = c;
        fg = center(e);
      }
    }
    return { ratio: best, minRatio: best, fg, bg, samples: pixels.length, fgFromPixels: true };
  }

  const fgRef: RGB = { r: text.r, g: text.g, b: text.b };
  const glyphOver = (bg: RGB): RGB => (text.a < 0.999 ? blendOver(text, bg) : fgRef);
  // "Clearly not text" scales with how far the frame gets from the text
  // colour at all, so a low-contrast pair (grey on grey) still separates.
  let maxDist = 0;
  for (const e of hist) maxDist = Math.max(maxDist, colorDistance(center(e), fgRef));
  const minDist = Math.max(12, 0.25 * maxDist);

  // The background is the frequent colour that, with the text drawn over it,
  // produces a glyph colour that is ALSO in the frame. For opaque text that
  // is just "the commonest colour that is not the text"; for translucent text
  // (a 30 % ghost letter) it stops the glyph's own blended colour — often
  // the commonest colour in its box — being mistaken for the background.
  let best: { score: number; bg: RGB } | null = null;
  for (const candidate of hist.slice(0, 12)) {
    const bgColor = center(candidate);
    const glyph = glyphOver(bgColor);
    if (colorDistance(bgColor, glyph) < 10) continue; // this bucket IS the text
    let evidence = 0;
    for (const e of hist) if (colorDistance(center(e), glyph) < 28) evidence += e.n;
    const score = Math.min(candidate.n, evidence);
    if (!best || score > best.score) best = { score, bg: bgColor };
  }
  const bg =
    best && best.score >= pixels.length * 0.01
      ? best.bg
      : center(hist.find((e) => colorDistance(center(e), fgRef) >= minDist) ?? first);
  const fg = glyphOver(bg);
  const ratio = contrastRatio(fg, bg);

  // ── Worst real background ──────────────────────────────────────────────
  const sx = bg.r - fg.r;
  const sy = bg.g - fg.g;
  const sz = bg.b - fg.b;
  const segLen2 = sx * sx + sy * sy + sz * sz;
  const glyphDist = Math.max(8, minDist * 0.5);
  const others: number[] = [];
  let glyphLike = 0;
  let glyphR = 0;
  let glyphG = 0;
  let glyphB = 0;
  for (const p of pixels) {
    if (colorDistance(p, fg) < glyphDist) {
      glyphLike += 1;
      glyphR += p.r;
      glyphG += p.g;
      glyphB += p.b;
      continue;
    }
    if (segLen2 > 0) {
      const t = ((p.r - fg.r) * sx + (p.g - fg.g) * sy + (p.b - fg.b) * sz) / segLen2;
      if (t > 0.03 && t < 0.92) {
        const px = fg.r + t * sx;
        const py = fg.g + t * sy;
        const pz = fg.b + t * sz;
        const perp = Math.sqrt((p.r - px) ** 2 + (p.g - py) ** 2 + (p.b - pz) ** 2);
        if (perp < 18) continue; // an anti-aliasing mix of text and background
      }
    }
    others.push(contrastRatio(fg, p));
  }
  others.sort((a, b) => a - b);
  let minRatio = others.length >= 16 ? Math.min(ratio, percentile(others, 0.1)) : ratio;

  // Even the heaviest display face (Anton, Impact) inks well under ~70 % of
  // its glyph box. When far more of the box is the text's own colour, the
  // background IS that colour.
  const fgShare = glyphLike / pixels.length;
  if (fgShare > 0.85 && glyphLike > 0) {
    const glyphMean = { r: glyphR / glyphLike, g: glyphG / glyphLike, b: glyphB / glyphLike };
    minRatio = Math.min(minRatio, contrastRatio(fg, glyphMean));
  }
  return { ratio, minRatio, fg, bg, samples: pixels.length, fgFromPixels: false };
}
