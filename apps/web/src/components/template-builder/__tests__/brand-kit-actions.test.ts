import { logoCornerGeometry, nextBrandColor } from '../brand-kit-actions';

const px = (g: { width: number; height: number }, c: { width: number; height: number }) =>
  ({ w: (g.width / 100) * c.width, h: (g.height / 100) * c.height });

describe('logoCornerGeometry', () => {
  it('pins a square logo top-left and keeps it square on a 16:9 canvas', () => {
    const c = { width: 1920, height: 1080 };
    const g = logoCornerGeometry({ width: 500, height: 500 }, c);
    const p = px(g, c);
    expect(p.w).toBeCloseTo(p.h);
    expect((g.x / 100) * c.width).toBeCloseTo((g.y / 100) * c.height); // equal pixel margins
    expect(g.x).toBeLessThan(5);
    expect(g.y).toBeLessThan(5);
  });

  it('caps a very wide wordmark at 28% of the width, aspect intact', () => {
    const c = { width: 1920, height: 1080 };
    const g = logoCornerGeometry({ width: 2000, height: 100 }, c);
    expect(g.width).toBeCloseTo(28);
    const p = px(g, c);
    expect(p.w / p.h).toBeCloseTo(20);
  });

  it('works on a portrait canvas and with unknown dimensions (square fallback)', () => {
    const c = { width: 1080, height: 1920 };
    const g = logoCornerGeometry(null, c);
    const p = px(g, c);
    expect(p.w).toBeCloseTo(p.h);
    expect(g.x + g.width).toBeLessThan(40);
  });
});

describe('nextBrandColor', () => {
  it('returns the next DIFFERENT colour, wrapping, ignoring duplicates', () => {
    expect(nextBrandColor(['#111111', '#222222', '#333333'], '#222222')).toBe('#333333');
    expect(nextBrandColor(['#111111', '#222222', '#333333'], '#333333')).toBe('#111111');
    expect(nextBrandColor(['#111111', '#111111', '#222222'], '#111111')).toBe('#222222');
    expect(nextBrandColor(['#111111'], '#111111')).toBeNull();
  });
});
