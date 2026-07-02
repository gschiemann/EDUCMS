/**
 * A1 drift-catcher (Wave A — "Crush Canva", 2026-07-02).
 *
 * Pre-fix, snap-engine.ts pre-quantized the dragged x/y to the nearest
 * multiple of `gridSize` WHENEVER the grid overlay was visible (showGrid ===
 * true), BEFORE element/canvas snapping ran. That made every drag move in
 * chunky 5%-of-canvas jumps and made a neighbor at a non-multiple-of-5
 * position mathematically unreachable — snapMove could never return a
 * position between grid lines even if an element-edge target sat there.
 *
 * Post-fix: dragging is 1:1 with the pointer; grid lines are just one more
 * snap TARGET in the same nearest-within-threshold contest as element
 * edges/centers and canvas guides. This spec proves the drift: dragging
 * toward a position that is NOT a multiple of gridSize, but IS within
 * SNAP_THRESHOLD of another zone's edge, lands exactly on that element-snap
 * target — not on the nearest grid line.
 */
import { snapMove, snapResize } from '../snap-engine';
import type { Zone } from '../types';
import { SNAP_THRESHOLD } from '../constants';

function makeZone(over: Partial<Zone> = {}): Zone {
  return {
    id: 'other',
    name: 'Other',
    widgetType: 'TEXT',
    x: 37, // NOT a multiple of the default gridSize (5)
    y: 20,
    width: 30,
    height: 10,
    zIndex: 1,
    sortOrder: 0,
    defaultConfig: {},
    ...over,
  };
}

describe('A1 — grid-visible no longer quantizes movement (drift catcher)', () => {
  it('lands on an element-edge target that is not a multiple of gridSize, even with the grid visible', () => {
    const other = makeZone(); // left edge at x=37
    const gridSize = 5;

    // Dragged candidate starts close to x=37 (well within SNAP_THRESHOLD)
    // but NOT itself a multiple of 5, and not exactly 37 either — this is
    // the raw pointer position mid-drag.
    const candidate = { x: 37 + SNAP_THRESHOLD * 0.5, y: 20, width: 20, height: 10 };

    const result = snapMove(candidate, [other], { gridSize, snapEnabled: true, snapGrid: true });

    // The OLD behavior would have first quantized x to Math.round(x/5)*5 = 40,
    // then attempted element snap from 40 — 40 is 3% away from 37, which is
    // OUTSIDE SNAP_THRESHOLD (1.5), so the element edge would never be
    // reached and the result would stick at the grid-quantized 40.
    expect(result.x).not.toBe(40);
    // The NEW behavior snaps the raw (unquantized) position onto the
    // element's left edge at x=37 exactly.
    expect(result.x).toBeCloseTo(37, 5);
    expect(result.lines.some((l) => l.kind === 'edge' && Math.abs(l.position - 37) < 1e-6)).toBe(true);
  });

  it('follows the pointer 1:1 when no snap target is nearby (no grid-step quantization)', () => {
    const other = makeZone({ x: 80, y: 80 }); // far away, out of threshold range
    const gridSize = 5;
    // A raw position that is deliberately NOT a multiple of 5 and far from
    // any snap target.
    const candidate = { x: 12.3, y: 6.7, width: 10, height: 10 };

    const result = snapMove(candidate, [other], { gridSize, snapEnabled: true, snapGrid: true });

    // Old behavior: snapToGrid(12.3, 5) = 10, snapToGrid(6.7, 5) = 5.
    // New behavior: raw pointer position passes through unchanged because
    // nothing (grid line included) is within SNAP_THRESHOLD of it.
    expect(result.x).toBeCloseTo(12.3, 5);
    expect(result.y).toBeCloseTo(6.7, 5);
  });

  it('still offers a grid line as a snap TARGET when the dragged position is within threshold of one', () => {
    const gridSize = 5;
    // x=20.4 is within SNAP_THRESHOLD (1.5) of the grid line at x=20.
    const candidate = { x: 20.4, y: 20.4, width: 10, height: 10 };

    const result = snapMove(candidate, [], { gridSize, snapEnabled: true, snapGrid: true });

    expect(result.x).toBeCloseTo(20, 5);
    expect(result.lines.some((l) => l.kind === 'grid')).toBe(true);
  });

  it('emits no grid targets when the grid overlay is hidden (snapGrid: false)', () => {
    const gridSize = 5;
    const candidate = { x: 20.4, y: 20.4, width: 10, height: 10 };

    const result = snapMove(candidate, [], { gridSize, snapEnabled: true, snapGrid: false });

    // Nothing else is nearby, and grid targets are suppressed, so the raw
    // position passes through untouched.
    expect(result.x).toBeCloseTo(20.4, 5);
    expect(result.lines.length).toBe(0);
  });

  it('snapResize also uses raw pointer position instead of pre-quantizing to grid', () => {
    const other = makeZone({ x: 62, y: 0, width: 10, height: 100 }); // left edge at 62
    const gridSize = 5;
    const candidate = { x: 10, y: 0, width: 52 + SNAP_THRESHOLD * 0.5, height: 30 }; // east edge near 62

    const result = snapResize(candidate, [other], 'e', { gridSize, snapEnabled: true, snapGrid: true });

    // East edge should land exactly on the neighbor's edge at x=62,
    // i.e. width = 62 - x = 52. The old pre-quantization to grid (60 or 65)
    // would have missed this target entirely.
    expect(result.width).toBeCloseTo(52, 5);
  });
});
