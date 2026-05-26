/**
 * Unit tests for the apply-brand-to-zone helpers.
 *
 * These cover the per-zone + per-template patch contract used by the
 * `POST /api/v1/branding/apply-to-templates` endpoint. The controller
 * wraps these helpers in a $transaction + audit log; this spec
 * exercises ONLY the math so the rules are pinned in isolation.
 */

import {
  patchZoneForBrand,
  patchTemplateBackgroundForBrand,
  resolveBrandInputs,
  type BrandInputs,
} from './apply-brand-to-zone';

const BRAND: BrandInputs = {
  ink: '#1e293b',
  surface: '#f8fafc',
  fontHeading: 'Inter',
};

describe('patchZoneForBrand', () => {
  describe('fill-blanks mode', () => {
    it('patches color when cfg.color is undefined', () => {
      const r = patchZoneForBrand(
        { defaultConfig: JSON.stringify({ fontSize: 48 }) },
        BRAND,
        'fill-blanks',
      );
      expect(r.changed).toBe(true);
      expect(r.mergedConfig).toEqual({ fontSize: 48, color: '#1e293b', fontFamily: 'Inter' });
      expect(JSON.parse(r.serialized!)).toEqual(r.mergedConfig);
    });

    it('does NOT patch color when cfg.color is already set', () => {
      const r = patchZoneForBrand(
        { defaultConfig: JSON.stringify({ color: '#ff0000', fontSize: 48 }) },
        BRAND,
        'fill-blanks',
      );
      // color preserved, only fontFamily filled in
      expect(r.changed).toBe(true);
      expect(r.mergedConfig).toEqual({ color: '#ff0000', fontSize: 48, fontFamily: 'Inter' });
    });

    it('does NOT patch fontFamily when cfg.fontFamily is already set', () => {
      const r = patchZoneForBrand(
        { defaultConfig: JSON.stringify({ fontFamily: 'Comic Sans', fontSize: 48 }) },
        BRAND,
        'fill-blanks',
      );
      expect(r.changed).toBe(true);
      expect(r.mergedConfig).toEqual({ fontFamily: 'Comic Sans', fontSize: 48, color: '#1e293b' });
    });

    it('is a no-op when BOTH color and fontFamily are already set', () => {
      const r = patchZoneForBrand(
        { defaultConfig: JSON.stringify({ color: '#ff0000', fontFamily: 'Comic Sans' }) },
        BRAND,
        'fill-blanks',
      );
      expect(r.changed).toBe(false);
      expect(r.mergedConfig).toBeNull();
      expect(r.serialized).toBeNull();
    });

    it('preserves all unrelated keys exactly', () => {
      const r = patchZoneForBrand(
        { defaultConfig: JSON.stringify({ fontSize: 64, bold: true, animation: { duration: 2000 } }) },
        BRAND,
        'fill-blanks',
      );
      expect(r.changed).toBe(true);
      expect(r.mergedConfig).toEqual({
        fontSize: 64,
        bold: true,
        animation: { duration: 2000 },
        color: '#1e293b',
        fontFamily: 'Inter',
      });
    });

    it('handles null defaultConfig (brand-new zone) by patching from empty', () => {
      const r = patchZoneForBrand(
        { defaultConfig: null },
        BRAND,
        'fill-blanks',
      );
      expect(r.changed).toBe(true);
      expect(r.mergedConfig).toEqual({ color: '#1e293b', fontFamily: 'Inter' });
    });

    it('handles malformed defaultConfig by falling back to empty config', () => {
      const r = patchZoneForBrand(
        { defaultConfig: '{not valid json' },
        BRAND,
        'fill-blanks',
      );
      expect(r.changed).toBe(true);
      expect(r.mergedConfig).toEqual({ color: '#1e293b', fontFamily: 'Inter' });
    });

    it('never writes a null fontFamily when the brand has no heading font', () => {
      const r = patchZoneForBrand(
        { defaultConfig: JSON.stringify({ fontSize: 48 }) },
        { ...BRAND, fontHeading: null },
        'fill-blanks',
      );
      // Only color was filled — fontFamily intentionally left absent.
      expect(r.changed).toBe(true);
      expect(r.mergedConfig).toEqual({ fontSize: 48, color: '#1e293b' });
      expect(r.mergedConfig).not.toHaveProperty('fontFamily');
    });
  });

  describe('override mode', () => {
    it('replaces existing color even when set', () => {
      const r = patchZoneForBrand(
        { defaultConfig: JSON.stringify({ color: '#ff0000', fontSize: 48 }) },
        BRAND,
        'override',
      );
      expect(r.changed).toBe(true);
      expect(r.mergedConfig).toEqual({ color: '#1e293b', fontSize: 48, fontFamily: 'Inter' });
    });

    it('replaces existing fontFamily even when set', () => {
      const r = patchZoneForBrand(
        { defaultConfig: JSON.stringify({ fontFamily: 'Comic Sans', fontSize: 48 }) },
        BRAND,
        'override',
      );
      expect(r.changed).toBe(true);
      expect(r.mergedConfig).toEqual({ fontFamily: 'Inter', fontSize: 48, color: '#1e293b' });
    });

    it('still skips fontFamily write when brand has no heading font', () => {
      const r = patchZoneForBrand(
        { defaultConfig: JSON.stringify({ color: '#ff0000', fontFamily: 'Comic Sans' }) },
        { ...BRAND, fontHeading: null },
        'override',
      );
      // color gets overridden; fontFamily preserved because we never write null
      expect(r.changed).toBe(true);
      expect(r.mergedConfig).toEqual({ color: '#1e293b', fontFamily: 'Comic Sans' });
    });
  });
});

describe('patchTemplateBackgroundForBrand', () => {
  it('paints surface + clears gradient when template has NO background', () => {
    const r = patchTemplateBackgroundForBrand(
      { bgColor: null, bgGradient: null, bgImage: null },
      BRAND,
      'fill-blanks',
    );
    expect(r).toEqual({ bgColor: '#f8fafc', bgGradient: null });
  });

  it('leaves template alone in fill-blanks when bgColor is set', () => {
    const r = patchTemplateBackgroundForBrand(
      { bgColor: '#ff00ff', bgGradient: null, bgImage: null },
      BRAND,
      'fill-blanks',
    );
    expect(r).toEqual({});
  });

  it('leaves template alone in fill-blanks when bgGradient is set', () => {
    const r = patchTemplateBackgroundForBrand(
      { bgColor: null, bgGradient: 'linear-gradient(…)', bgImage: null },
      BRAND,
      'fill-blanks',
    );
    expect(r).toEqual({});
  });

  it('leaves template alone in fill-blanks when bgImage is set', () => {
    const r = patchTemplateBackgroundForBrand(
      { bgColor: null, bgGradient: null, bgImage: 'https://example.com/bg.jpg' },
      BRAND,
      'fill-blanks',
    );
    expect(r).toEqual({});
  });

  it('in override mode, paints surface + clears gradient even when bgColor was set', () => {
    const r = patchTemplateBackgroundForBrand(
      { bgColor: '#ff00ff', bgGradient: 'linear-gradient(…)', bgImage: null },
      BRAND,
      'override',
    );
    expect(r).toEqual({ bgColor: '#f8fafc', bgGradient: null });
  });
});

describe('resolveBrandInputs', () => {
  it('uses palette.ink + palette.surface when present', () => {
    const r = resolveBrandInputs(
      { ink: '#111111', surface: '#fafafa', primary: '#0000ff' },
      'Roboto',
    );
    expect(r).toEqual({ ink: '#111111', surface: '#fafafa', fontHeading: 'Roboto' });
  });

  it('falls back to surfaceAlt then primary then white when surface is missing', () => {
    expect(resolveBrandInputs({ ink: '#000', surfaceAlt: '#abcdef', primary: '#0000ff' }, null)).toEqual({
      ink: '#000',
      surface: '#abcdef',
      fontHeading: null,
    });
    expect(resolveBrandInputs({ ink: '#000', primary: '#0000ff' }, null)).toEqual({
      ink: '#000',
      surface: '#0000ff',
      fontHeading: null,
    });
    expect(resolveBrandInputs({}, null)).toEqual({
      ink: '#0f172a',
      surface: '#ffffff',
      fontHeading: null,
    });
  });

  it('treats undefined / null palette as defaults', () => {
    expect(resolveBrandInputs(null, undefined)).toEqual({
      ink: '#0f172a',
      surface: '#ffffff',
      fontHeading: null,
    });
    expect(resolveBrandInputs(undefined, '')).toEqual({
      ink: '#0f172a',
      surface: '#ffffff',
      fontHeading: null,
    });
  });
});
