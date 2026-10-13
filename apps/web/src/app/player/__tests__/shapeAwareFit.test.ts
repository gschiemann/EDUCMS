import { DEFAULT_PLAYLIST_MEDIA_FIT, shapeAwareFit } from '../mediaFit';

describe('shape-aware playlist fit (2026-10-12)', () => {
  it('portrait clip on a landscape screen shows the whole clip (no 3x zoom)', () => {
    expect(shapeAwareFit('cover', 1080, 1920, 1920, 1080)).toBe('contain');
  });
  it('landscape clip on a portrait screen shows the whole clip', () => {
    expect(shapeAwareFit('cover', 1920, 1080, 1080, 1920)).toBe('contain');
  });
  it('an explicit cover choice still fills close shapes edge to edge (1080x1668 on 1080x1920)', () => {
    expect(shapeAwareFit('cover', 1080, 1668, 1080, 1920)).toBe('cover');
    expect(shapeAwareFit('cover', 1920, 1080, 1920, 1080)).toBe('cover');
  });
  it('unknown size keeps the base fit; emergency contain is untouched', () => {
    expect(shapeAwareFit('cover', null, null, 1920, 1080)).toBe('cover');
    expect(shapeAwareFit('contain', 1080, 1920, 1920, 1080)).toBe('contain');
  });

  it('the playlist default fills close, mismatched, and unknown shapes', () => {
    const base = DEFAULT_PLAYLIST_MEDIA_FIT;
    expect(base).toBe('fill');
    expect(shapeAwareFit(base, 1080, 1668, 1080, 1920)).toBe('fill');
    expect(shapeAwareFit(base, 1920, 1080, 1080, 1920)).toBe('fill');
    expect(shapeAwareFit(base, null, null, 1920, 1080)).toBe('fill');
  });
});
