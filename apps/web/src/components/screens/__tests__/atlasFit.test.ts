/**
 * Network Atlas fit math.
 *
 * The case that matters is the one the operator reported (2026-08-31): an
 * eight-school district whose campuses sit inside five kilometres opened
 * showing half of Northern California. The regression that produced it was a
 * flat zoom ceiling of 10 — added for the single-pin case — applied to every
 * fit, so no amount of tightness in the bounds could reach city scale.
 */
import {
  atlasFitMaxZoom,
  clampFitPadding,
  pinSetKey,
  ATLAS_LONE_PIN_MAX_ZOOM,
  MAX_FIT_PAD_SHARE,
} from '../atlasFit';

/** Eight campuses inside ~5 km, the shape of the operator's real district. */
const DISTRICT: Array<[number, number]> = [
  [37.9020, -122.0640], [37.9068, -122.0555], [37.8975, -122.0712],
  [37.9111, -122.0498], [37.8940, -122.0601], [37.9052, -122.0790],
  [37.8998, -122.0455], [37.9130, -122.0668],
];

describe('atlasFitMaxZoom', () => {
  it('imposes NO ceiling on a district that carries its own scale', () => {
    // The bug: any number here re-creates it. The bounds ARE the answer.
    expect(atlasFitMaxZoom(DISTRICT)).toBeUndefined();
  });

  it('imposes no ceiling on a fleet spread across states either', () => {
    expect(atlasFitMaxZoom([[38.58, -121.49], [36.03, -114.98]])).toBeUndefined();
  });

  it('caps a lone pin at city scale — a degenerate box rides to the tile ceiling', () => {
    expect(atlasFitMaxZoom([[38.5816, -121.4944]])).toBe(ATLAS_LONE_PIN_MAX_ZOOM);
    expect(atlasFitMaxZoom([])).toBe(ATLAS_LONE_PIN_MAX_ZOOM);
  });

  it('caps pins stacked on ONE address — count is not what makes a box degenerate', () => {
    const sameBuilding: Array<[number, number]> = [
      [38.5816, -121.4944], [38.5816, -121.4944], [38.58161, -121.49441],
    ];
    expect(atlasFitMaxZoom(sameBuilding)).toBe(ATLAS_LONE_PIN_MAX_ZOOM);
  });

  it('reads the WIDER axis, so a north-south line still counts as spread', () => {
    // ~4 km of latitude, no longitude spread at all.
    expect(atlasFitMaxZoom([[37.90, -122.06], [37.94, -122.06]])).toBeUndefined();
  });
});

describe('clampFitPadding', () => {
  const TL: [number, number] = [430, 90];
  const BR: [number, number] = [400, 130];

  it('leaves the floating-card padding alone on a desktop-width map', () => {
    expect(clampFitPadding(TL, BR, { x: 1380, y: 780 }))
      .toEqual({ topLeft: [430, 90], bottomRight: [400, 130] });
  });

  it('never lets padding exceed the container — a negative box fits at MAX zoom', () => {
    // A phone: 830 px of horizontal padding on a 351 px map makes Leaflet's
    // usable box negative; `log(negative)` is NaN, getScaleZoom turns that
    // into Infinity, and the fit clamps to the tile ceiling — one rooftop,
    // every other pin off-screen.
    const { topLeft, bottomRight } = clampFitPadding(TL, BR, { x: 351, y: 520 });
    const usedX = topLeft[0] + bottomRight[0];
    expect(usedX).toBeLessThanOrEqual(351 * MAX_FIT_PAD_SHARE + 1);
    expect(351 - usedX).toBeGreaterThan(0);
    // Both sides still get a share — the inbox does not eat the panel's.
    expect(topLeft[0]).toBeGreaterThan(0);
    expect(bottomRight[0]).toBeGreaterThan(0);
    // Proportions survive the squeeze.
    expect(topLeft[0]).toBeGreaterThan(bottomRight[0]);
  });

  it('clamps each axis independently', () => {
    // Wide enough horizontally, far too short vertically.
    const { topLeft, bottomRight } = clampFitPadding(TL, BR, { x: 1380, y: 200 });
    expect(topLeft[0]).toBe(430);
    expect(bottomRight[0]).toBe(400);
    expect(topLeft[1] + bottomRight[1]).toBeLessThanOrEqual(200 * MAX_FIT_PAD_SHARE + 1);
  });

  it('survives a zero-size container (the fit itself bails on one)', () => {
    expect(clampFitPadding(TL, BR, { x: 0, y: 0 }))
      .toEqual({ topLeft: [0, 0], bottomRight: [0, 0] });
  });

  it('is a no-op when no padding is asked for', () => {
    expect(clampFitPadding([0, 0], [0, 0], { x: 800, y: 600 }))
      .toEqual({ topLeft: [0, 0], bottomRight: [0, 0] });
  });
});

describe('pinSetKey', () => {
  it('is stable across a re-poll that rebuilds the array', () => {
    expect(pinSetKey(DISTRICT)).toBe(pinSetKey([...DISTRICT]));
  });

  it('ignores pin ORDER — the table sorts worst-first and re-sorts on churn', () => {
    expect(pinSetKey(DISTRICT)).toBe(pinSetKey([...DISTRICT].reverse()));
  });

  it('changes when a location joins the map (a fresh geocode, or a filter)', () => {
    expect(pinSetKey(DISTRICT)).not.toBe(pinSetKey(DISTRICT.slice(0, 7)));
  });
});
