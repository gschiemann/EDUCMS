/**
 * A7 regression spec (Wave A — "Crush Canva", 2026-07-02).
 *
 * Pre-fix, collectTargets only emitted canvas 0/50/100 plus other
 * zones' edges/centers — no rule-of-thirds lines and no equal-spacing
 * detection — and the guide labels showed raw percent ("37.5%") which
 * means nothing to an operator. Post-fix (landed with the A1 engine
 * rework, locked in here):
 *   - canvas thirds (33.33 / 66.67) are snap targets,
 *   - equal-gap candidates continue the spacing rhythm two aligned
 *     neighbors already established (Canva's pink equal-spacing snap),
 *   - element-edge guide labels show REAL PIXELS via the template's
 *     screenWidth/screenHeight.
 */
import { snapMove } from '../snap-engine';
import { guideLabelFor } from '../BuilderCanvas';
import type { Zone, SnapLine } from '../types';

function makeZone(over: Partial<Zone>): Zone {
  return {
    id: 'z',
    name: 'Zone',
    widgetType: 'TEXT',
    x: 0, y: 0, width: 10, height: 10,
    zIndex: 1,
    sortOrder: 0,
    defaultConfig: {},
    ...over,
  };
}

const opts = { gridSize: 5, snapEnabled: true, snapGrid: false };

describe('A7 — snap targets: canvas thirds', () => {
  it('snaps a dragged edge onto the 1/3 canvas line', () => {
    const candidate = { x: 100 / 3 + 0.5, y: 80, width: 10, height: 10 };
    const r = snapMove(candidate, [], opts);
    expect(r.x).toBeCloseTo(100 / 3, 5);
    expect(r.lines.some((l) => l.kind === 'canvas' && Math.abs(l.position - 100 / 3) < 1e-6)).toBe(true);
  });

  it('snaps onto the 2/3 canvas line too', () => {
    const candidate = { x: 200 / 3 - 0.6, y: 80, width: 10, height: 10 };
    const r = snapMove(candidate, [], opts);
    expect(r.x).toBeCloseTo(200 / 3, 5);
  });
});

describe('A7 — snap targets: equal spacing', () => {
  it('offers the position that continues the gap two aligned neighbors established', () => {
    // A ends at 15, B spans 22–32 → gap is 7 → the equal-gap candidate
    // for a third element's near edge is 32 + 7 = 39. (Chosen so 39 is
    // NOT also a canvas anchor or any element edge — a shared position
    // would let another target win the tie and report its own kind.)
    const a = makeZone({ id: 'a', x: 5, y: 10, width: 10 });
    const b = makeZone({ id: 'b', x: 22, y: 10, width: 10 });
    const candidate = { x: 39.8, y: 80, width: 4, height: 4 }; // near 39, within threshold

    const r = snapMove(candidate, [a, b], opts);
    expect(r.x).toBeCloseTo(39, 5);
    expect(r.lines.some((l) => l.kind === 'equal-gap' && Math.abs(l.position - 39) < 1e-6)).toBe(true);
  });

  it('emits no equal-gap target from overlapping neighbors (gap <= 0)', () => {
    const a = makeZone({ id: 'a', x: 10, y: 10, width: 30 }); // ends at 40
    const b = makeZone({ id: 'b', x: 30, y: 10, width: 10 }); // starts INSIDE a
    // Position far from every legit target; if an equal-gap candidate
    // leaked from the overlap it would sit near 40+(30-40)=30..50 zone —
    // pick a probe near where a bogus candidate would land.
    const candidate = { x: 29.4, y: 80, width: 10, height: 10 };
    const r = snapMove(candidate, [a, b], opts);
    expect(r.lines.some((l) => l.kind === 'equal-gap')).toBe(false);
  });
});

describe('A7 — guide labels in real pixels', () => {
  const at = (kind: SnapLine['kind'], position: number, orientation: 'v' | 'h' = 'v'): SnapLine =>
    ({ kind, position, orientation });

  it('element-edge labels convert percent to pixels via the template canvas size', () => {
    // 37.5% of a 3840-wide canvas = 1440px.
    expect(guideLabelFor(at('edge', 37.5, 'v'), 3840, 2160)).toBe('1440px');
    // Horizontal lines use screenHeight: 25% of 2160 = 540px.
    expect(guideLabelFor(at('edge', 25, 'h'), 3840, 2160)).toBe('540px');
  });

  it('named anchors keep their semantic labels', () => {
    expect(guideLabelFor(at('canvas', 50), 1920, 1080)).toBe('Center');
    expect(guideLabelFor(at('canvas', 0), 1920, 1080)).toBe('Edge');
    expect(guideLabelFor(at('canvas', 100), 1920, 1080)).toBe('Edge');
    expect(guideLabelFor(at('canvas', 100 / 3), 1920, 1080)).toBe('Thirds');
    expect(guideLabelFor(at('center', 42), 1920, 1080)).toBe('Center match');
    expect(guideLabelFor(at('equal-gap', 50), 1920, 1080)).toBe('Equal spacing');
    expect(guideLabelFor(at('grid', 20), 1920, 1080)).toBe('Grid');
  });
});
