import { shapeAwareFit } from '../mediaFit';

describe('shape-aware playlist fit (2026-10-12)', () => {
  it('portrait clip on a landscape screen shows the whole clip (no 3x zoom)', () => {
    expect(shapeAwareFit('cover', 1080, 1920, 1920, 1080)).toBe('contain');
  });
  it('landscape clip on a portrait screen shows the whole clip', () => {
    expect(shapeAwareFit('cover', 1920, 1080, 1080, 1920)).toBe('contain');
  });
  it('close shapes still fill edge to edge (1080x1668 on 1080x1920)', () => {
    expect(shapeAwareFit('cover', 1080, 1668, 1080, 1920)).toBe('cover');
    expect(shapeAwareFit('cover', 1920, 1080, 1920, 1080)).toBe('cover');
  });
  it('unknown size keeps the base fit; emergency contain is untouched', () => {
    expect(shapeAwareFit('cover', null, null, 1920, 1080)).toBe('cover');
    expect(shapeAwareFit('contain', 1080, 1920, 1920, 1080)).toBe('contain');
  });
});
