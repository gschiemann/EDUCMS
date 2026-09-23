import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blendOver, contrastRatio, relativeLuminance, toHex, type RGB } from '../../src/metrics/color.js';
import { looksOccluded, measureTextContrast } from '../../src/metrics/contrast.js';
import type { PixelImage, PxRect } from '../../src/metrics/pixels.js';
import { drawStrokes, fillNoise, fillRect, makeImage } from '../helpers/pixels.js';

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };
const NAVY = { r: 13, g: 27, b: 42 };

const close = (actual: number, expected: number, tol = 0.05) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected} ± ${tol}, got ${actual}`);

/** A background frame, and the same frame with glyph strokes drawn on it. */
function frames(width: number, height: number, paintBackground: (img: PixelImage) => void, ink: RGB, box: PxRect, stroke?: number) {
  const plate = makeImage(width, height, WHITE);
  paintBackground(plate);
  const frame: PixelImage = { ...plate, data: Uint8Array.from(plate.data) };
  drawStrokes(frame, box, ink, stroke ? { stroke } : {});
  return { frame, plate };
}

test('WCAG luminance and ratio match the published reference values', () => {
  close(relativeLuminance(WHITE), 1, 1e-9);
  close(relativeLuminance(BLACK), 0, 1e-9);
  close(contrastRatio(BLACK, WHITE), 21, 1e-9);
  close(contrastRatio(WHITE, BLACK), 21, 1e-9); // order-independent
  // #767676 on white is the classic "just passes AA" grey: 4.54:1.
  close(contrastRatio({ r: 0x76, g: 0x76, b: 0x76 }, WHITE), 4.54, 0.01);
  // #777777 is the classic "just fails": 4.48:1.
  close(contrastRatio({ r: 0x77, g: 0x77, b: 0x77 }, WHITE), 4.48, 0.01);
  close(contrastRatio(WHITE, WHITE), 1, 1e-9);
});

test('blendOver composites source-over', () => {
  assert.deepEqual(blendOver({ ...BLACK, a: 0.5 }, WHITE), { r: 127.5, g: 127.5, b: 127.5 });
  assert.deepEqual(blendOver({ ...BLACK, a: 1 }, WHITE), BLACK);
  assert.deepEqual(blendOver({ ...BLACK, a: 0 }, WHITE), WHITE);
  assert.equal(toHex({ r: 255, g: 0, b: 16 }), '#ff0010');
});

test('black text on white reads 21:1, anti-aliasing and all', () => {
  const box = { x: 10, y: 10, w: 180, h: 40 };
  const { frame, plate } = frames(200, 60, () => undefined, BLACK, box);
  const r = measureTextContrast(frame, plate, [box], { ...BLACK, a: 1 });
  assert.ok(r);
  close(r.ratio, 21, 0.01);
  close(r.minRatio, 21, 0.01);
  assert.equal(toHex(r.bg), '#ffffff');
  assert.ok(r.inkShare > 0.2 && r.inkShare < 0.8, `ink share ${r.inkShare}`);
  assert.equal(looksOccluded(r), false);
});

test('a just-failing grey measures 4.48, not a rounded-up pass', () => {
  const grey = { r: 0x77, g: 0x77, b: 0x77 };
  const box = { x: 10, y: 10, w: 180, h: 40 };
  const { frame, plate } = frames(200, 60, () => undefined, grey, box);
  const r = measureTextContrast(frame, plate, [box], { ...grey, a: 1 });
  assert.ok(r);
  close(r.ratio, 4.48, 0.02);
});

test('semi-transparent text is measured as the colour it composites to', () => {
  const box = { x: 10, y: 10, w: 180, h: 40 };
  const drawn = blendOver({ ...BLACK, a: 0.5 }, WHITE);
  const { frame, plate } = frames(200, 60, () => undefined, drawn, box);
  const r = measureTextContrast(frame, plate, [box], { ...BLACK, a: 0.5 });
  assert.ok(r);
  close(r.ratio, contrastRatio(drawn, WHITE), 0.05);
});

test('a translucent ghost letter covering most of its box is read against the navy behind it', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };
  const ghost = blendOver({ ...WHITE, a: 0.3 }, NAVY);
  const plate = makeImage(100, 100, NAVY);
  const frame = makeImage(100, 100, NAVY);
  fillRect(frame, { x: 0, y: 0, w: 70, h: 100 }, ghost);
  const r = measureTextContrast(frame, plate, [box], { ...WHITE, a: 0.3 });
  assert.ok(r);
  assert.equal(toHex(r.bg), toHex(NAVY));
  close(r.ratio, contrastRatio(ghost, NAVY), 0.05);
});

test('white text over navy with a bright photo patch: ratio is the navy, minRatio the patch', () => {
  // The case single-frame sampling cannot do: every grey in the photo lies on
  // the white→navy line, so it looks exactly like anti-aliasing.
  const box = { x: 0, y: 0, w: 300, h: 80 };
  const { frame, plate } = frames(
    300,
    80,
    (img) => {
      fillRect(img, { x: 0, y: 0, w: 300, h: 80 }, NAVY);
      fillNoise(img, { x: 200, y: 0, w: 100, h: 80 }, { r: 200, g: 200, b: 200 }, 40);
    },
    WHITE,
    { x: 10, y: 10, w: 280, h: 60 },
  );
  const r = measureTextContrast(frame, plate, [box], { ...WHITE, a: 1 });
  assert.ok(r);
  assert.ok(r.ratio > 15, `navy dominates: ${r.ratio}`);
  assert.ok(r.minRatio < 2, `the bright patch is the real risk: ${r.minRatio}`);
});

test('text the same colour as its background reads 1:1 and is not called occluded', () => {
  const box = { x: 0, y: 0, w: 120, h: 40 };
  const plate = makeImage(120, 40, WHITE);
  const frame = makeImage(120, 40, WHITE);
  const r = measureTextContrast(frame, plate, [box], { ...WHITE, a: 1 });
  assert.ok(r);
  close(r.ratio, 1, 0.01);
  assert.equal(r.inkShare, 0);
  assert.equal(looksOccluded(r), false, 'invisible-by-colour is a contrast finding, not an occlusion');
});

test('black text that inked nothing on a white background is occluded (something covers it)', () => {
  // Both frames identical: hiding the text changed nothing, so nothing of
  // it was visible — a photo or panel is painted over it.
  const box = { x: 0, y: 0, w: 120, h: 40 };
  const plate = makeImage(120, 40, WHITE);
  const frame = makeImage(120, 40, WHITE);
  const r = measureTextContrast(frame, plate, [box], { ...BLACK, a: 1 });
  assert.ok(r);
  close(r.ratio, 21, 0.01);
  assert.equal(looksOccluded(r), true);
});

test('unknown fill (gradient text) is taken from the ink the two frames disagree on', () => {
  const box = { x: 10, y: 10, w: 180, h: 40 };
  const red = { r: 200, g: 30, b: 30 };
  const { frame, plate } = frames(200, 60, () => undefined, red, box, 6);
  const r = measureTextContrast(frame, plate, [box], null);
  assert.ok(r);
  assert.equal(r.fgFromPixels, true);
  close(r.ratio, contrastRatio(red, WHITE), 0.05);
});

test('mismatched frames or an off-image box yield no reading rather than a made-up one', () => {
  const a = makeImage(50, 50, WHITE);
  const b = makeImage(40, 50, WHITE);
  assert.equal(measureTextContrast(a, b, [{ x: 0, y: 0, w: 10, h: 10 }], { ...BLACK, a: 1 }), null);
  assert.equal(measureTextContrast(a, a, [{ x: 100, y: 100, w: 20, h: 20 }], { ...BLACK, a: 1 }), null);
});
