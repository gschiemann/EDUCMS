import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellFlatness, gridEmptiness, largestComponent } from '../../src/metrics/grid.js';
import { fillNoise, fillRect, makeImage } from '../helpers/pixels.js';

const NAVY = { r: 13, g: 27, b: 42 };

test('a single flat colour is 100 % dead space, one connected void', () => {
  const img = makeImage(160, 90, NAVY);
  const g = gridEmptiness(img);
  assert.equal(g.cols, 16);
  assert.equal(g.rows, 9);
  assert.equal(g.emptyCells, 144);
  assert.equal(g.ratio, 1);
  assert.equal(g.largestVoidCells, 144);
  assert.equal(g.largestVoidPct, 1);
  assert.deepEqual(g.map, Array(9).fill('.'.repeat(16)));
});

test('a photo is never dead space; a flat panel is, even when it is a different colour', () => {
  const img = makeImage(160, 90, NAVY);
  fillNoise(img, { x: 80, y: 0, w: 80, h: 90 }, { r: 120, g: 120, b: 120 }, 50); // right half: "photo"
  fillRect(img, { x: 0, y: 50, w: 80, h: 40 }, { r: 27, g: 38, b: 59 }); // flat panel, bottom-left
  const g = gridEmptiness(img);
  for (const row of g.map) assert.equal(row.slice(8), '########', 'photo half is used');
  // Left half, all flat (navy or panel) = 8 × 9 cells, split by the panel edge
  // only where a cell straddles it (that cell is not flat).
  assert.ok(g.emptyCells >= 8 * 8 && g.emptyCells <= 8 * 9, `empty ${g.emptyCells}`);
});

test('text or an image box on a flat cell makes it used; a 1-px sliver from a neighbour does not', () => {
  const img = makeImage(160, 90, NAVY);
  const g = gridEmptiness(img, {
    occupied: [
      { x: 12, y: 12, w: 6, h: 6 }, // inside cell (1,1)
      { x: 25, y: 0, w: 6, h: 10 }, // 5 px in cell (2,0), a 1-px sliver into cell (3,0)
    ],
  });
  assert.equal(g.map[1]?.[1], '#');
  assert.equal(g.map[0]?.[3], '.', 'sliver ignored');
  assert.equal(g.map[0]?.[2], '#', 'but the cell it mostly sits in is used');
});

test('dithered gradients read as flat; a texture does not', () => {
  const img = makeImage(100, 100, { r: 100, g: 100, b: 100 });
  for (let y = 0; y < 100; y += 1) fillRect(img, { x: 0, y, w: 100, h: 1 }, { r: 100 + (y % 2), g: 100, b: 100 + (y % 3) });
  assert.ok(cellFlatness(img, { x: 0, y: 0, w: 100, h: 100 }) <= 3);
  fillNoise(img, { x: 0, y: 0, w: 100, h: 100 }, { r: 100, g: 100, b: 100 }, 30);
  assert.ok(cellFlatness(img, { x: 0, y: 0, w: 100, h: 100 }) > 3);
});

test('largestComponent counts 4-connected runs only', () => {
  // 3×3:  . # .
  //       # . #
  //       . # .   → five isolated singles
  const empty = [true, false, true, false, true, false, true, false, true];
  assert.equal(largestComponent(empty, 3, 3), 1);
  assert.equal(largestComponent([true, true, false, true], 2, 2), 3);
});

test('portrait canvases use a 9 × 16 grid when asked', () => {
  const img = makeImage(90, 160, NAVY);
  const g = gridEmptiness(img, { cols: 9, rows: 16 });
  assert.equal(g.map.length, 16);
  assert.equal(g.map[0]?.length, 9);
});
