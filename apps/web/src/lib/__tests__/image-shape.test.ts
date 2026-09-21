import { imageShape } from '../image-shape';

describe('imageShape', () => {
  it.each([
    [1920, 1080, 'Landscape'],
    [1080, 1920, 'Portrait'],
    [1000, 1000, 'Square'],
    [1080, 1100, 'Square'], // inside the 5% band — not "Portrait"
    [1100, 1000, 'Landscape'],
    [960, 1080, 'Portrait'], // the half-width LED wall
  ])('%i×%i → %s', (w, h, want) => expect(imageShape(w, h)).toBe(want));

  it.each([[0, 100], [100, 0], [NaN, 100], [-5, 10]])('unknown size %p×%p → null (never a guess)', (w, h) => {
    expect(imageShape(w, h)).toBeNull();
  });
});
