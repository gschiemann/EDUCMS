import { test } from 'node:test';
import assert from 'node:assert/strict';
import { area, findOverlaps, intersect, union } from '../../src/metrics/geometry.js';

test('intersect / area / union', () => {
  assert.deepEqual(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), { x: 5, y: 5, w: 5, h: 5 });
  assert.equal(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }), null, 'touching is not intersecting');
  assert.equal(area({ x: 0, y: 0, w: 4, h: 5 }), 20);
  assert.deepEqual(union([{ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 5, w: 5, h: 5 }]), { x: 0, y: 0, w: 10, h: 10 });
  assert.equal(union([]), null);
});

test('two text runs overlapping by more than 6 px on BOTH axes collide', () => {
  const pairs = findOverlaps([
    { id: 1, boxes: [{ x: 0, y: 0, w: 100, h: 40 }] },
    { id: 2, boxes: [{ x: 90, y: 30, w: 100, h: 40 }] }, // 10 × 10
  ]);
  assert.deepEqual(pairs, [{ a: 1, b: 2, w: 10, h: 10 }]);
});

test('exactly 6 px, or deep on one axis only, is not a collision', () => {
  assert.equal(
    findOverlaps([
      { id: 1, boxes: [{ x: 0, y: 0, w: 100, h: 40 }] },
      { id: 2, boxes: [{ x: 94, y: 0, w: 100, h: 40 }] }, // 6 × 40
    ]).length,
    0,
  );
  assert.equal(
    findOverlaps([
      { id: 1, boxes: [{ x: 0, y: 0, w: 100, h: 40 }] },
      { id: 2, boxes: [{ x: 0, y: 35, w: 100, h: 40 }] }, // 100 × 5: tight leading
    ]).length,
    0,
  );
});

test('inline siblings wrapping around each other are compared line by line, not as a union', () => {
  // "Hello <b>world</b> again": the parent's own runs sit either side of the
  // bold word. Their UNION would swallow it; the fragments do not.
  const pairs = findOverlaps([
    { id: 1, boxes: [{ x: 0, y: 0, w: 50, h: 20 }, { x: 90, y: 0, w: 50, h: 20 }] },
    { id: 2, boxes: [{ x: 50, y: 0, w: 40, h: 20 }] },
  ]);
  assert.equal(pairs.length, 0);
});

test('the largest fragment intersection is reported', () => {
  const pairs = findOverlaps([
    { id: 1, boxes: [{ x: 0, y: 0, w: 100, h: 20 }, { x: 0, y: 20, w: 100, h: 20 }] },
    { id: 2, boxes: [{ x: 50, y: 5, w: 100, h: 30 }] },
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.w, 50);
  assert.equal(pairs[0]?.h, 15);
});
