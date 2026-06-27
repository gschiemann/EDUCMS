import { CANVAS_CLASSES, resolveCanvas } from './types';
import {
  MIN_FONT_PX,
  PERFECT_FOURTH,
  bodyBasePx,
  buildTypeScale,
  capHeightFraction,
  fontSizeForRole,
  headlineFloorPx,
  headlineToBodyRatio,
} from './type-scale';

describe('type-scale exports', () => {
  it('PERFECT_FOURTH is 1.333', () => {
    expect(PERFECT_FOURTH).toBeCloseTo(1.333, 3);
  });
});

describe('floors', () => {
  const landscape = CANVAS_CLASSES['landscape-16-9'];

  it('body base never drops below the 50px auto-fit floor', () => {
    const tiny = resolveCanvas('landscape-16-9', { h: 200 });
    expect(bodyBasePx(tiny)).toBe(MIN_FONT_PX);
  });

  it('on a 1080p board the body base meets the ~3.5% cap-height floor', () => {
    const body = bodyBasePx(landscape);
    const frac = capHeightFraction(body, landscape);
    // BODY_CAP_FLOOR is 3.5% at the 15ft reference; allow small rounding slack.
    expect(frac).toBeGreaterThanOrEqual(0.034);
  });

  it('headline floor meets the ~6.5% cap-height floor on 1080p', () => {
    const hl = headlineFloorPx(landscape);
    const frac = capHeightFraction(hl, landscape);
    expect(frac).toBeGreaterThanOrEqual(0.064);
  });

  it('4K board derives ~2x the px sizes of 1080p (resolution-scaled)', () => {
    const fourK = resolveCanvas('landscape-16-9', { w: 3840, h: 2160 });
    expect(bodyBasePx(fourK)).toBeGreaterThan(bodyBasePx(landscape) * 1.8);
  });
});

describe('modular scale + hierarchy', () => {
  const landscape = CANVAS_CLASSES['landscape-16-9'];

  it('display > headline > title > body > kicker', () => {
    const s = buildTypeScale(landscape);
    expect(s.display).toBeGreaterThan(s.headline);
    expect(s.headline).toBeGreaterThan(s.title);
    expect(s.title).toBeGreaterThan(s.body);
    expect(s.body).toBeGreaterThanOrEqual(s.kicker);
  });

  it('the dominant text is 2-3x the body (R6 §10.A rule 3)', () => {
    const ratio = headlineToBodyRatio('display', landscape);
    expect(ratio).toBeGreaterThanOrEqual(2);
    expect(ratio).toBeLessThanOrEqual(3.1);
  });

  it('every role clamps at the 50px floor', () => {
    const tiny = resolveCanvas('square', { w: 200, h: 200 });
    const s = buildTypeScale(tiny);
    for (const v of Object.values(s)) {
      expect(v).toBeGreaterThanOrEqual(MIN_FONT_PX);
    }
  });

  it('longer viewing distance enlarges type (distance law, floor not dominating)', () => {
    // Use a tall canvas so the modular scale — not the 50px clamp — governs,
    // proving the viewingDistance multiplier actually scales the derived size.
    const far = resolveCanvas('landscape-16-9', { h: 2160, viewingDistanceFt: 30 });
    const near = resolveCanvas('landscape-16-9', { h: 2160, viewingDistanceFt: 10 });
    expect(fontSizeForRole('headline', far)).toBeGreaterThan(
      fontSizeForRole('headline', near),
    );
    // The published headline floor is itself distance-scaled.
    expect(headlineFloorPx(far)).toBeGreaterThan(headlineFloorPx(near));
  });

  it('headline floor wins even if the scale step would be smaller', () => {
    // A very short canvas makes the modular step small; the published headline
    // floor must still apply.
    const short = resolveCanvas('landscape-16-9', { h: 800 });
    const hl = fontSizeForRole('headline', short, PERFECT_FOURTH);
    expect(hl).toBeGreaterThanOrEqual(headlineFloorPx(short));
  });
});
