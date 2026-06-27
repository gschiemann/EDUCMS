import {
  BODY_CONTRAST_FLOOR,
  LARGE_CONTRAST_FLOOR,
  bestTextColor,
  bestTextToken,
  buildScrim,
  contrastRatio,
  parseHex,
  passesFloor,
  relativeLuminance,
  resolveLegibility,
  toHex,
} from './contrast';

describe('parseHex / toHex', () => {
  it('parses 6-digit hex', () => {
    expect(parseHex('#ff8800')).toEqual({ r: 255, g: 136, b: 0 });
  });
  it('parses shorthand hex', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });
  it('parses without leading #', () => {
    expect(parseHex('000000')).toEqual({ r: 0, g: 0, b: 0 });
  });
  it('round-trips through toHex', () => {
    expect(toHex(parseHex('#1e293b'))).toBe('#1e293b');
  });
  it('throws on garbage', () => {
    expect(() => parseHex('not-a-color')).toThrow();
    expect(() => parseHex('#12')).toThrow();
  });
});

describe('relativeLuminance', () => {
  it('black is 0, white is 1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('contrastRatio — known WCAG pairs', () => {
  it('black on white = 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });
  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(
      contrastRatio('#abcdef', '#123456'),
      9,
    );
  });
  it('identical colors = 1:1', () => {
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
  it('#777 on white ~4.48 (a known reference value)', () => {
    // WebAIM reports #777777 on #ffffff at 4.48:1.
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });
});

describe('passesFloor', () => {
  it('white on near-black clears the body floor', () => {
    expect(passesFloor('#ffffff', '#0a0a0a', false)).toBe(true);
  });
  it('a mid grey on white fails the 7:1 body floor', () => {
    expect(passesFloor('#888888', '#ffffff', false)).toBe(false);
  });
  it('#777 on white passes the 4.5:1 large floor but not 7:1 body', () => {
    expect(passesFloor('#777777', '#ffffff', true)).toBe(false); // 4.48 < 4.5
    expect(passesFloor('#767676', '#ffffff', true)).toBe(true); // 4.54 >= 4.5
  });
});

describe('bestTextColor / bestTextToken', () => {
  it('picks white over a dark background', () => {
    expect(bestTextColor('#0f172a')).toBe('#ffffff');
    expect(bestTextToken('#0f172a')).toBe('inkInverse');
  });
  it('picks near-black over a light background', () => {
    expect(bestTextColor('#fffaf0')).toBe('#0a0a0a');
    expect(bestTextToken('#fffaf0')).toBe('ink');
  });
});

describe('resolveLegibility', () => {
  it('over a dark flat bg: flips to light text, no scrim needed', () => {
    const res = resolveLegibility('#0a0a0a', false);
    expect(res.passes).toBe(true);
    expect(res.textToken).toBe('inkInverse');
    expect(res.scrim).toBeUndefined();
  });

  it('over a true mid-tone flat bg: still passes via scrim', () => {
    // Pure mid grey #808080 fails both white and black against the 7:1 floor.
    const res = resolveLegibility('#808080', false);
    expect(res.passes).toBe(true);
    expect(res.scrim).toBeDefined();
    expect(res.scrim!.opacity).toBeGreaterThan(0);
  });

  it('over imagery: always returns a mandatory scrim + light text', () => {
    const res = resolveLegibility('#000000', true, { overImage: true });
    expect(res.passes).toBe(true);
    expect(res.textToken).toBe('inkInverse');
    expect(res.scrim).toBeDefined();
    expect(res.scrim!.direction).toBe('full');
  });
});

describe('buildScrim', () => {
  it('a dark scrim at its opacity gives white text well above the floor', () => {
    const scrim = buildScrim('dark', false);
    // Approximate the composited surface as the scrim color at full strength —
    // white over near-black is ~21:1, so any practical opacity clears 7:1.
    expect(contrastRatio('#ffffff', scrim.color)).toBeGreaterThanOrEqual(
      BODY_CONTRAST_FLOOR,
    );
    expect(scrim.opacity).toBeGreaterThanOrEqual(0.6);
  });
  it('large-text scrim is lighter than body-text scrim', () => {
    expect(buildScrim('dark', true).opacity).toBeLessThan(
      buildScrim('dark', false).opacity,
    );
  });
  it('the large floor is below the body floor', () => {
    expect(LARGE_CONTRAST_FLOOR).toBeLessThan(BODY_CONTRAST_FLOOR);
  });
});
