import { broadcastContentStyle } from '../broadcastLayout';

it('scales the original landscape canvas below the banner without resizing its layout viewport', () => {
  expect(broadcastContentStyle({ width: 1920, height: 1080, bannerHeight: 108 })).toEqual({ top: 108, left: expect.closeTo(96), transform: 'scale(0.9)', transformOrigin: 'top left' });
});
it('caps a long banner at 40 percent and preserves portrait and ribbon content', () => {
  for (const [width, height] of [[1080, 1920], [320, 1080], [1920, 160]]) {
    const style = broadcastContentStyle({ width, height, bannerHeight: height });
    expect(style.top).toBe(height * 0.4);
    expect(style.transform).toBe('scale(0.6)');
  }
});
it('restores the same original canvas after clear', () => {
  expect(broadcastContentStyle(null)).toEqual({});
  expect(broadcastContentStyle({ width: 0, height: 0, bannerHeight: 100 })).toEqual({});
});
