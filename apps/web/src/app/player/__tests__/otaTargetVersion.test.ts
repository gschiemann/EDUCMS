import { otaTargetVersion } from '../otaTargetVersion';

describe('otaTargetVersion — the update label names the build being installed', () => {
  it('reads the pushed field build from the NEEDS_TAP message, not the stable release', () => {
    // The Player's own words today (OtaInstallReceiver.needsTapMessage, a staged commit).
    const msg = 'v1.1.45-field.1 is downloaded and waiting for a person: on the screen press Back, choose Install v1.1.45-field.1, then select Install (OK on the remote, or tap it).';
    expect(otaTargetVersion(msg, '1.1.29')).toBe('1.1.45-field.1');
  });

  it('reads it from every wording of the waiting-for-a-person message — new, older players and the server\'s own', () => {
    // A raised dialog (the Player today, then an older Player's sentence).
    expect(otaTargetVersion("Android's Install dialog for v1.1.46 is open on the screen — select Install (OK on the remote, or tap it).", '1.1.29')).toBe('1.1.46');
    expect(otaTargetVersion('Android on this screen needs someone to tap Install for v1.1.45-field.1. Press Install now on the screen, then tap Install.', '1.1.29')).toBe('1.1.45-field.1');
    // The sentence the API stores when it holds the push (apps/api push-tracking.ts).
    expect(otaTargetVersion(
      'Android on this screen is waiting for someone to confirm the install of v1.1.29. At the screen: press Back, choose Install v1.1.29, then select Install (OK on the remote, or tap it).',
      null,
    )).toBe('1.1.29');
    expect(otaTargetVersion(
      'v1.1.29 (offered 2026-10-26T09:00:00.000Z) did not install; the screen is still on v1.1.23. Android on this screen needs someone to confirm the install. At the screen: press Back, choose Install v1.1.29, then select Install (OK on the remote, or tap it).',
      null,
    )).toBe('1.1.29');
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
