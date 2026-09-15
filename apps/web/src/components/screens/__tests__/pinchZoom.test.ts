import { isPinchWheel, zoomStepFor, WHEEL_PX_PER_ZOOM_LEVEL } from '../pinchZoom';

describe('isPinchWheel — a plain scroll scrolls the page, a pinch zooms the map', () => {
  it('plain wheel is not a pinch', () => {
    expect(isPinchWheel({ ctrlKey: false, metaKey: false })).toBe(false);
  });
  it('ctrl+wheel (how browsers report a trackpad pinch) is a pinch, and so is ⌘', () => {
    expect(isPinchWheel({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isPinchWheel({ ctrlKey: false, metaKey: true })).toBe(true);
  });
});

describe('zoomStepFor — Leaflet\'s own wheel maths', () => {
  it('nothing accumulated → no zoom', () => {
    expect(zoomStepFor(0, 1)).toBe(0);
    expect(zoomStepFor(Number.NaN, 1)).toBe(0);
  });
  it('a small pinch still moves one whole level when the map snaps to whole levels', () => {
    expect(zoomStepFor(5, 1)).toBe(1);
    expect(zoomStepFor(-5, 1)).toBe(-1);
  });
  it('one nominal wheel-level of delta is a soft two-thirds of a level (Leaflet\'s curve), sign follows the delta', () => {
    const up = zoomStepFor(WHEEL_PX_PER_ZOOM_LEVEL, 0);
    expect(up).toBeGreaterThan(0.5);
    expect(up).toBeLessThan(1);
    expect(zoomStepFor(-WHEEL_PX_PER_ZOOM_LEVEL, 0)).toBeCloseTo(-up, 6);
  });
  it('a runaway gesture is capped at four levels', () => {
    expect(zoomStepFor(1e6, 1)).toBe(4);
    expect(zoomStepFor(-1e6, 0.25)).toBe(-4);
  });
});
