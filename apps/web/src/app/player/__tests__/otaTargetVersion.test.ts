import { otaTargetVersion } from '../otaTargetVersion';

describe('otaTargetVersion — the update label names the build being installed', () => {
  it('reads the pushed field build from the NEEDS_TAP message, not the stable release', () => {
    const msg = 'Android on this screen needs someone to tap Install for v1.1.45-field.1. Press Install now on the screen, then tap Install.';
    expect(otaTargetVersion(msg, '1.1.29')).toBe('1.1.45-field.1');
  });

  it('reads a plain progress message', () => {
    expect(otaTargetVersion('v1.1.46', '1.1.29')).toBe('1.1.46');
    expect(otaTargetVersion('Installing v1.1.46-field.2 now', null)).toBe('1.1.46-field.2');
  });

  it('falls back to the public latest version when no OTA message names one', () => {
    expect(otaTargetVersion(null, '1.1.29')).toBe('1.1.29');
    expect(otaTargetVersion('Update failed — will retry', '1.1.29')).toBe('1.1.29');
    expect(otaTargetVersion(undefined, null)).toBeNull();
  });
});
