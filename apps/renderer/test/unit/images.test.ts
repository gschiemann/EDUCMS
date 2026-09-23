import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLURRY_UPSCALE, aspectDistortion, backgroundDrawnSize, objectFitDrawnSize, upscaleRatio } from '../../src/metrics/images.js';

const close = (actual: number | null, expected: number, tol = 0.01) =>
  assert.ok(actual !== null && Math.abs(actual - expected) <= tol, `expected ${expected} ± ${tol}, got ${actual}`);

test('the Wix blur placeholder stretched full-height is ~21× and 2.5× distorted', () => {
  const natural = { w: 151, h: 101 };
  const drawn = objectFitDrawnSize({ w: 1280, h: 2160 }, natural, 'fill');
  assert.deepEqual(drawn, { w: 1280, h: 2160 });
  close(upscaleRatio(drawn, natural), 2160 / 101);
  close(aspectDistortion(drawn, natural), 2160 / 101 / (1280 / 151));
  assert.ok((upscaleRatio(drawn, natural) as number) > BLURRY_UPSCALE);
});

test('object-fit: contain / cover / none / scale-down', () => {
  const box = { w: 800, h: 400 };
  const natural = { w: 400, h: 400 };
  assert.deepEqual(objectFitDrawnSize(box, natural, 'contain'), { w: 400, h: 400 });
  assert.deepEqual(objectFitDrawnSize(box, natural, 'cover'), { w: 800, h: 800 });
  assert.deepEqual(objectFitDrawnSize(box, natural, 'none'), { w: 400, h: 400 });
  assert.deepEqual(objectFitDrawnSize({ w: 200, h: 100 }, natural, 'scale-down'), { w: 100, h: 100 });
  assert.deepEqual(objectFitDrawnSize({ w: 2000, h: 2000 }, natural, 'scale-down'), { w: 400, h: 400 }, 'never enlarges');
  assert.equal(aspectDistortion(objectFitDrawnSize(box, natural, 'cover'), natural), 1);
});

test('background-size: cover, contain, auto, lengths, one-auto', () => {
  const area = { w: 1000, h: 500 };
  const natural = { w: 200, h: 100 };
  assert.deepEqual(backgroundDrawnSize('cover', area, natural), { w: 1000, h: 500 });
  assert.deepEqual(backgroundDrawnSize('contain', { w: 1000, h: 1000 }, natural), { w: 1000, h: 500 });
  assert.deepEqual(backgroundDrawnSize('auto', area, natural), { w: 200, h: 100 });
  assert.deepEqual(backgroundDrawnSize('auto auto', area, natural), { w: 200, h: 100 });
  assert.deepEqual(backgroundDrawnSize('400px', area, natural), { w: 400, h: 200 });
  assert.deepEqual(backgroundDrawnSize('auto 250px', area, natural), { w: 500, h: 250 });
  assert.deepEqual(backgroundDrawnSize('50% 100%', area, natural), { w: 500, h: 500 });
});

test('upscale is measured on the more-stretched axis; a downscaled logo is < 1', () => {
  close(upscaleRatio({ w: 535.7, h: 150 }, { w: 1300, h: 364 }), 150 / 364);
  close(upscaleRatio({ w: 1275, h: 850 }, { w: 1200, h: 800 }), 1.0625);
  assert.equal(upscaleRatio({ w: 10, h: 10 }, { w: 0, h: 0 }), null, 'broken image has no ratio');
});
