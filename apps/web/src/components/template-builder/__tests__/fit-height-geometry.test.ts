/** "Fit Height" keeps the zone's own aspect (Codex T07, 2026-09-13); the old formula ignored the zone's width. */
import { fitHeightGeometry } from '../zone-geometry';

describe('fitHeightGeometry', () => {
  it('a tall 10×20 zone becomes 50% wide, centred, full height', () => {
    expect(fitHeightGeometry({ width: 10, height: 20 })).toEqual({ x: 25, y: 0, width: 50, height: 100 });
  });
  it('a square 30×30 zone becomes 100% wide', () => {
    expect(fitHeightGeometry({ width: 30, height: 30 })).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
  it('a wide zone is clamped to the canvas, never pushed off it', () => {
    const g = fitHeightGeometry({ width: 40, height: 10 });
    expect(g.width).toBe(100); expect(g.x).toBe(0);
  });
  it('two zones of the same height but different widths get DIFFERENT widths (the old bug gave them the same)', () => {
    expect(fitHeightGeometry({ width: 5, height: 20 }).width).not.toBe(fitHeightGeometry({ width: 15, height: 20 }).width);
  });
});
