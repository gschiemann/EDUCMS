/**
 * A3 regression spec (Wave A — "Crush Canva", 2026-07-02).
 *
 * Pre-fix, BuilderCanvas.onResizePointerDown called select([zoneId])
 * unconditionally, so grabbing a resize handle on ANY zone — even while a
 * 4-zone multi-selection was active — collapsed the selection to that one
 * zone and only it resized. This spec proves the extracted pure scaling
 * math (`scaleZoneInBox`) that now backs the group-resize gesture:
 * dragging one corner handle of the shared bounding box scales every
 * selected zone's x/y/w/h proportionally relative to the box's origin,
 * preserving each zone's relative position and aspect.
 */
import { boundingBoxOf, scaleZoneInBox } from '../BuilderCanvas';
import type { Zone } from '../types';

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

describe('A3 — group resize scaling math', () => {
  it('boundingBoxOf computes the tight bounding rect of a zone set', () => {
    const zones = [
      makeZone({ id: 'a', x: 10, y: 10, width: 20, height: 10 }),
      makeZone({ id: 'b', x: 40, y: 30, width: 15, height: 15 }),
    ];
    const box = boundingBoxOf(zones);
    expect(box).toEqual({ x: 10, y: 10, width: 45, height: 35 });
  });

  it('scaling the box 2x (se handle drag) doubles every zone size and preserves relative offsets', () => {
    const origBox = { x: 10, y: 10, width: 40, height: 20 };
    const newBox = { x: 10, y: 10, width: 80, height: 40 }; // se handle: 2x scale, origin anchored

    const zoneA = { x: 10, y: 10, width: 10, height: 10 }; // top-left corner of the group
    const zoneB = { x: 30, y: 20, width: 20, height: 10 }; // offset inside the group

    const scaledA = scaleZoneInBox(zoneA, origBox, newBox);
    const scaledB = scaleZoneInBox(zoneB, origBox, newBox);

    // Zone A sat exactly at the box origin — stays anchored, doubles in size.
    expect(scaledA).toEqual({ x: 10, y: 10, width: 20, height: 20 });
    // Zone B was offset (20, 10) from the box origin — that offset doubles
    // too (2x scale), and its own size doubles.
    expect(scaledB).toEqual({ x: 50, y: 30, width: 40, height: 20 });
  });

  it('shrinking the box to 50% halves every zone and its offset from the anchor corner', () => {
    const origBox = { x: 0, y: 0, width: 100, height: 100 };
    const newBox = { x: 0, y: 0, width: 50, height: 50 };
    const zone = { x: 60, y: 40, width: 20, height: 20 };

    const scaled = scaleZoneInBox(zone, origBox, newBox);
    expect(scaled).toEqual({ x: 30, y: 20, width: 10, height: 10 });
  });

  it('a group of 3+ zones all scale together, preserving each one relative position (no collapse to one zone)', () => {
    const zones = [
      makeZone({ id: 'a', x: 0, y: 0, width: 10, height: 10 }),
      makeZone({ id: 'b', x: 20, y: 0, width: 10, height: 10 }),
      makeZone({ id: 'c', x: 40, y: 0, width: 10, height: 10 }),
    ];
    const origBox = boundingBoxOf(zones);
    // Drag the 'e' handle to widen the box 1.5x.
    const newBox = { ...origBox, width: origBox.width * 1.5 };

    const results = zones.map((z) => scaleZoneInBox(z, origBox, newBox));

    // All three zones moved/resized — none was left untouched (the
    // pre-fix bug would have resized only the single zone whose handle
    // was grabbed and left the other two exactly where they started).
    expect(results[0]).not.toEqual({ x: zones[0].x, y: zones[0].y, width: zones[0].width, height: zones[0].height });
    expect(results[1]).not.toEqual({ x: zones[1].x, y: zones[1].y, width: zones[1].width, height: zones[1].height });
    expect(results[2]).not.toEqual({ x: zones[2].x, y: zones[2].y, width: zones[2].width, height: zones[2].height });

    // Relative order (a before b before c, left to right) is preserved.
    expect(results[0].x).toBeLessThan(results[1].x);
    expect(results[1].x).toBeLessThan(results[2].x);

    // Every width scaled by the same 1.5x factor.
    for (let i = 0; i < zones.length; i++) {
      expect(results[i].width).toBeCloseTo(zones[i].width * 1.5, 5);
    }
  });

  it('handles a zero-width/height original box without dividing by zero', () => {
    const origBox = { x: 5, y: 5, width: 0, height: 0 };
    const newBox = { x: 5, y: 5, width: 10, height: 10 };
    const zone = { x: 5, y: 5, width: 5, height: 5 };
    const scaled = scaleZoneInBox(zone, origBox, newBox);
    // scaleX/scaleY fall back to 1 when the original dimension is 0.
    expect(scaled).toEqual({ x: 5, y: 5, width: 5, height: 5 });
  });
});
