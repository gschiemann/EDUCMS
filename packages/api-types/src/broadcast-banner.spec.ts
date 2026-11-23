/**
 * Broadcast banner options: text size and the slower marquee (2026-11-23).
 *
 * Pins the canonical form (medium = no `size` key, fixed key order), what
 * counts as a request, the strict input schema, the speed table and the
 * per-size font maths the player and the composer preview both draw with.
 */
import {
  BANNER_MIN_LOOP_SECONDS,
  BANNER_SIZES,
  BANNER_SPEEDS,
  BANNER_SPEED_STAGES_PER_MIN,
  BANNER_TEXT_SCALE,
  BannerStyleInputSchema,
  bannerFontPx,
  bannerPxPerSecond,
  bannerLoopSeconds,
  bannerSizeOf,
  sanitizeBannerOptions,
} from './broadcast-banner';
import { BroadcastInputSchema } from './index';

describe('sanitizeBannerOptions with a text size', () => {
  it('keeps small and large, in a fixed key order (color, mode, speed, size)', () => {
    const a = sanitizeBannerOptions({ size: 'large', speed: 'slow', mode: 'scroll', color: '#ABC' });
    const b = sanitizeBannerOptions({ color: '#aabbcc', mode: 'scroll', speed: 'slow', size: 'large' });
    expect(a).toEqual({ color: '#aabbcc', mode: 'scroll', speed: 'slow', size: 'large' });
    expect(Object.keys(a!)).toEqual(['color', 'mode', 'speed', 'size']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(sanitizeBannerOptions({ mode: 'static', size: 'small' })).toEqual({ mode: 'static', speed: 'normal', size: 'small' });
  });

  it('medium is the absence of the key: explicit medium and no size hash alike', () => {
    const explicit = sanitizeBannerOptions({ mode: 'scroll', speed: 'fast', size: 'medium' });
    const absent = sanitizeBannerOptions({ mode: 'scroll', speed: 'fast' });
    expect(explicit).toEqual({ mode: 'scroll', speed: 'fast' });
    expect('size' in explicit!).toBe(false);
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(absent));
  });

  it('a message stored before the size existed sanitises to exactly what it did', () => {
    expect(sanitizeBannerOptions({ color: '#1d4ed8', mode: 'scroll', speed: 'slow' })).toEqual({ color: '#1d4ed8', mode: 'scroll', speed: 'slow' });
    expect(JSON.stringify(sanitizeBannerOptions({ mode: 'static', speed: 'normal' }))).toBe('{"mode":"static","speed":"normal"}');
  });

  it('an unknown or hostile size is medium, and on its own asks for nothing', () => {
    expect(sanitizeBannerOptions({ mode: 'static', size: 'huge' })).toEqual({ mode: 'static', speed: 'normal' });
    expect(sanitizeBannerOptions({ mode: 'static', size: 'LARGE' })).toEqual({ mode: 'static', speed: 'normal' });
    expect(sanitizeBannerOptions({ mode: 'static', size: { toString: () => 'large' } })).toEqual({ mode: 'static', speed: 'normal' });
    expect(sanitizeBannerOptions({ size: 'huge' })).toBeNull();
    expect(sanitizeBannerOptions({ size: 3 })).toBeNull();
    expect(sanitizeBannerOptions({ speed: 'slow' })).toBeNull(); // unchanged: a speed alone means nothing
  });

  it('an explicit valid size alone is a request: the stage-relative static bar at that size', () => {
    expect(sanitizeBannerOptions({ size: 'large' })).toEqual({ mode: 'static', speed: 'normal', size: 'large' });
    expect(sanitizeBannerOptions({ size: 'small' })).toEqual({ mode: 'static', speed: 'normal', size: 'small' });
    // Medium alone is medium text, not the fixed 20 px of "today's look" (which is smaller than small).
    expect(sanitizeBannerOptions({ size: 'medium' })).toEqual({ mode: 'static', speed: 'normal' });
  });

  it('null, empty and non-objects are still today\'s look', () => {
    expect(sanitizeBannerOptions({})).toBeNull();
    expect(sanitizeBannerOptions(null)).toBeNull();
    expect(sanitizeBannerOptions(['large'])).toBeNull();
    expect(sanitizeBannerOptions('large')).toBeNull();
  });

  it('bannerSizeOf reads medium for absent and unknown', () => {
    expect(bannerSizeOf(null)).toBe('medium');
    expect(bannerSizeOf({})).toBe('medium');
    expect(bannerSizeOf({ size: 'giant' })).toBe('medium');
    expect(bannerSizeOf({ size: 'small' })).toBe('small');
    expect(bannerSizeOf({ size: 'large' })).toBe('large');
  });
});

describe('the strict input schema', () => {
  it.each(BANNER_SIZES)('accepts size %s', (size) => {
    expect(BannerStyleInputSchema.safeParse({ mode: 'scroll', speed: 'slow', size }).success).toBe(true);
  });
  it.each([['huge'], ['LARGE'], [''], [2], [null]])('refuses size %p', (size) => {
    expect(BannerStyleInputSchema.safeParse({ mode: 'static', size }).success).toBe(false);
  });
  it('still refuses unknown keys', () => {
    expect(BannerStyleInputSchema.safeParse({ mode: 'static', size: 'large', weight: 'bold' }).success).toBe(false);
  });
  it('rides inside a broadcast request', () => {
    const base = { scopeType: 'tenant', scopeId: 'school-1', text: 'hi', severity: 'INFO' };
    expect(BroadcastInputSchema.safeParse({ ...base, banner: { mode: 'scroll', speed: 'slow', size: 'large' } }).success).toBe(true);
    expect(BroadcastInputSchema.safeParse({ ...base, banner: { mode: 'scroll', size: 'xl' } }).success).toBe(false);
  });
});

describe('marquee speeds (slowed 2026-11-23)', () => {
  it('keeps the three stored values', () => {
    expect(BANNER_SPEEDS).toEqual(['slow', 'normal', 'fast']);
  });
  it('one stage width every 30 s / 20 s / 13.3 s', () => {
    expect(BANNER_SPEED_STAGES_PER_MIN).toEqual({ slow: 2, normal: 3, fast: 4.5 });
    for (const [speed, seconds] of [['slow', 30], ['normal', 20], ['fast', 13.3]] as const) {
      expect(60 / BANNER_SPEED_STAGES_PER_MIN[speed]).toBeCloseTo(seconds, 1);
    }
  });
  it.each([
    [1920, 'slow', 64], [1920, 'normal', 96], [1920, 'fast', 144],
    [3840, 'slow', 128], [3840, 'normal', 192], [3840, 'fast', 288],
  ] as const)('a %d px stage at %s moves %d px per second', (w, speed, px) => {
    expect(bannerPxPerSecond(w, speed)).toBe(px);
  });
  it('every speed is slower than the old normal (5 stage widths a minute)', () => {
    for (const speed of BANNER_SPEEDS) expect(BANNER_SPEED_STAGES_PER_MIN[speed]).toBeLessThan(5);
    expect(BANNER_SPEED_STAGES_PER_MIN.slow).toBeLessThan(BANNER_SPEED_STAGES_PER_MIN.normal);
    expect(BANNER_SPEED_STAGES_PER_MIN.normal).toBeLessThan(BANNER_SPEED_STAGES_PER_MIN.fast);
  });
  it('a loop one stage wide takes 30 s / 20 s / 13.3 s, in 0.1 s steps', () => {
    expect(bannerLoopSeconds(1920, 1920, 'slow')).toBe(30);
    expect(bannerLoopSeconds(1920, 1920, 'normal')).toBe(20);
    expect(bannerLoopSeconds(1920, 1920, 'fast')).toBe(13.3);
    // A 4K canvas draws everything twice as wide: the same screen-relative speed.
    expect(bannerLoopSeconds(3840, 3840, 'slow')).toBe(30);
    expect(bannerLoopSeconds(3840, 3840, 'fast')).toBe(13.3);
    expect(bannerLoopSeconds(1000, 1920, 'normal')).toBe(10.4);
  });
  it('the speed is the same for every message length (the loop is timed by the distance travelled)', () => {
    // Three copies of a short message or one copy of a long one: same px per second.
    for (const loop of [2229, 3336, 3900]) {
      for (const speed of BANNER_SPEEDS) {
        expect(loop / bannerLoopSeconds(loop, 1920, speed)).toBeCloseTo(bannerPxPerSecond(1920, speed), 0);
      }
    }
  });
  it('a degenerate loop is held to the minimum (it only ever slows down)', () => {
    expect(BANNER_MIN_LOOP_SECONDS).toBe(4);
    expect(bannerLoopSeconds(100, 1920, 'fast')).toBe(4);
    expect(bannerLoopSeconds(0, 1920, 'fast')).toBe(4);
    expect(bannerLoopSeconds(500, 0, 'fast')).toBe(4);
  });
});

describe('text size scale', () => {
  it('medium is exactly the size every banner with options has drawn since 2026-11-01', () => {
    for (const w of [320, 960, 1280, 1920, 2560, 3840, 7680]) {
      expect(bannerFontPx('medium', w)).toEqual({
        base: Math.max(20, Math.min(120, Math.round(w * 0.022))),
        floor: Math.max(14, Math.min(60, Math.round(w * 0.0115))),
      });
      expect(bannerFontPx(undefined, w)).toEqual(bannerFontPx('medium', w));
    }
  });
  it.each([
    ['small', 1920, 33, 17], ['medium', 1920, 42, 22], ['large', 1920, 58, 30],
    ['small', 3840, 65, 34], ['medium', 3840, 84, 44], ['large', 3840, 115, 60],
  ] as const)('%s on a %d px stage starts at %d px with a %d px floor', (size, w, base, floor) => {
    expect(bannerFontPx(size, w)).toEqual({ base, floor });
  });
  it('small < medium < large on every stage, and the floor is always below the base', () => {
    for (const w of [160, 320, 960, 1280, 1920, 2560, 3840, 7680]) {
      const s = bannerFontPx('small', w);
      const m = bannerFontPx('medium', w);
      const l = bannerFontPx('large', w);
      expect(s.base).toBeLessThan(m.base);
      expect(m.base).toBeLessThan(l.base);
      for (const f of [s, m, l]) expect(f.floor).toBeLessThan(f.base);
    }
  });
  it('clamps keep tiny and huge canvases sane', () => {
    expect(bannerFontPx('small', 320)).toEqual({ base: 16, floor: 12 });
    expect(bannerFontPx('large', 320)).toEqual({ base: 27, floor: 19 });
    expect(bannerFontPx('large', 20000)).toEqual({ base: BANNER_TEXT_SCALE.large.max, floor: BANNER_TEXT_SCALE.large.floorMax });
    expect(bannerFontPx('large', 0)).toEqual(bannerFontPx('large', 1920));
    expect(bannerFontPx('large', Number.NaN)).toEqual(bannerFontPx('large', 1920));
  });
});
