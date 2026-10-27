import {
  emergencyLayoutIsPortrait,
  emergencyLayoutOrientation,
} from './emergency-layout';

describe('emergency face layout', () => {
  it.each([
    ['PORTRAIT', '960×540', true],
    ['LANDSCAPE', '540×960', false],
    ['AUTO', '540×960', true],
    ['AUTO', '960×540', false],
  ])(
    'uses the secondary face orientation %s over browser resolution %s',
    (orientation, resolution, expected) => {
      expect(
        emergencyLayoutIsPortrait({
          faceOfScreenId: 'synthetic-parent',
          orientation,
          resolution,
        }),
      ).toBe(expected);
    },
  );
  it('retains explicit LED canvas precedence', () => {
    expect(
      emergencyLayoutIsPortrait({
        faceOfScreenId: 'synthetic-parent',
        orientation: 'LANDSCAPE',
        canvasW: 320,
        canvasH: 1080,
      }),
    ).toBe(true);
  });
  it('keeps the primary and single-sided policy unchanged', () => {
    expect(
      emergencyLayoutIsPortrait({
        orientation: 'LANDSCAPE',
        resolution: '1080×1920',
      }),
    ).toBe(true);
    expect(
      emergencyLayoutIsPortrait({
        orientation: 'PORTRAIT',
        resolution: '1920×1080',
      }),
    ).toBe(false);
  });
  it('keeps missing geometry on the existing landscape fallback', () => {
    expect(emergencyLayoutIsPortrait({})).toBe(false);
  });
});

describe('emergency orientation wire contract', () => {
  it('keeps the primary value unchanged and supplies the secondary CSS orientation on cold alert boot', () => {
    expect(emergencyLayoutOrientation({ resolution: '1080×1920' })).toBe(
      'portrait',
    );
    expect(
      emergencyLayoutOrientation({
        faceOfScreenId: 'synthetic-parent',
        orientation: 'PORTRAIT',
        resolution: '960×540',
      }),
    ).toBe('PORTRAIT');
    expect(
      emergencyLayoutOrientation({
        faceOfScreenId: 'synthetic-parent',
        orientation: 'LANDSCAPE',
        resolution: '540×960',
      }),
    ).toBe('LANDSCAPE');
  });
});

describe('one orientation rule for the trigger, the manifest and the staged boards (2026-10-26)', () => {
  it('an LED poster is PORTRAIT: its OS canvas (1920×1080) is not the LED (a 320×1080 module)', () => {
    const poster = {
      resolution: '1920×1080',
      orientation: 'AUTO',
      hardwareModel: 'novastar-taurus',
    };
    expect(emergencyLayoutIsPortrait(poster, { w: 320, h: 1080 })).toBe(true);
    // The fleet default standard when the tenant set none.
    expect(emergencyLayoutIsPortrait(poster)).toBe(true);
    // A ViPlex chain (3 × 320 = 960 wide, not a factory width) is 960×1080 — still portrait.
    expect(
      emergencyLayoutIsPortrait(
        { ...poster, resolution: '960×1080' },
        { w: 320, h: 1080 },
      ),
    ).toBe(true);
    // A wide landscape module standard follows the standard's own shape.
    expect(emergencyLayoutIsPortrait(poster, { w: 1920, h: 480 })).toBe(false);
    // An explicit LED canvas still wins over the poster rule.
    expect(
      emergencyLayoutIsPortrait(
        { ...poster, canvasW: 1280, canvasH: 720 },
        { w: 320, h: 1080 },
      ),
    ).toBe(false);
    // Every other box keeps the OS resolution rule.
    expect(
      emergencyLayoutIsPortrait({
        ...poster,
        hardwareModel: 'generic-android',
      }),
    ).toBe(false);
  });
  it("a double-sided unit's back face follows its own orientation, not the landscape mode its panel reports", () => {
    expect(
      emergencyLayoutIsPortrait({
        faceOfScreenId: 'front',
        orientation: 'PORTRAIT',
        resolution: '960×540',
        hardwareModel: 'generic-android',
      }),
    ).toBe(true);
  });
});
