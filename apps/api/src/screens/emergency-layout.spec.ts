import { emergencyLayoutIsPortrait, emergencyLayoutOrientation } from './emergency-layout';

describe('emergency face layout', () => {
  it.each([
    ['PORTRAIT', '960×540', true],
    ['LANDSCAPE', '540×960', false],
    ['AUTO', '540×960', true],
    ['AUTO', '960×540', false],
  ])('uses the secondary face orientation %s over browser resolution %s', (orientation, resolution, expected) => {
    expect(emergencyLayoutIsPortrait({ faceOfScreenId: 'synthetic-parent', orientation, resolution })).toBe(expected);
  });
  it('retains explicit LED canvas precedence', () => {
    expect(emergencyLayoutIsPortrait({ faceOfScreenId: 'synthetic-parent', orientation: 'LANDSCAPE', canvasW: 320, canvasH: 1080 })).toBe(true);
  });
  it('keeps the primary and single-sided policy unchanged', () => {
    expect(emergencyLayoutIsPortrait({ orientation: 'LANDSCAPE', resolution: '1080×1920' })).toBe(true);
    expect(emergencyLayoutIsPortrait({ orientation: 'PORTRAIT', resolution: '1920×1080' })).toBe(false);
  });
  it('keeps missing geometry on the existing landscape fallback', () => {
    expect(emergencyLayoutIsPortrait({})).toBe(false);
  });
});

describe('emergency orientation wire contract', () => {
  it('keeps the primary value unchanged and supplies the secondary CSS orientation on cold alert boot', () => {
    expect(emergencyLayoutOrientation({ resolution: '1080×1920' })).toBe('portrait');
    expect(emergencyLayoutOrientation({ faceOfScreenId: 'synthetic-parent', orientation: 'PORTRAIT', resolution: '960×540' })).toBe('PORTRAIT');
    expect(emergencyLayoutOrientation({ faceOfScreenId: 'synthetic-parent', orientation: 'LANDSCAPE', resolution: '540×960' })).toBe('LANDSCAPE');
  });
});
