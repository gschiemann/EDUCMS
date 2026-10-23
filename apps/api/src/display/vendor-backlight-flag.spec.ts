import { parseVendorBacklightEnv, vendorBacklightFlagFor } from './vendor-backlight-flag';

const A = '7d0c4a3e-1b2f-4c5d-8e9f-0a1b2c3d4e5f';
const B = '11111111-2222-4333-8444-555555555555';

describe('PLAYER_VENDOR_BACKLIGHT — the lead-only kill switch (player 1.1.52)', () => {
  it('unset or empty: the default — nobody gets a key, the APK decides from its own facts', () => {
    expect(vendorBacklightFlagFor(A, {})).toBeNull();
    expect(vendorBacklightFlagFor(A, { PLAYER_VENDOR_BACKLIGHT: '' })).toBeNull();
    expect(vendorBacklightFlagFor(A, { PLAYER_VENDOR_BACKLIGHT: '   ' })).toBeNull();
  });

  it('off / 0 / false / no / -all switch the whole fleet off', () => {
    for (const v of ['off', 'OFF', '0', 'false', 'no', '-all', '-ALL']) {
      expect(vendorBacklightFlagFor(A, { PLAYER_VENDOR_BACKLIGHT: v })).toBe(false);
      expect(vendorBacklightFlagFor(B, { PLAYER_VENDOR_BACKLIGHT: v })).toBe(false);
    }
  });

  it('-<uuid> switches off exactly that screen, case-insensitively', () => {
    const env = { PLAYER_VENDOR_BACKLIGHT: `-${A.toUpperCase()}` };
    expect(vendorBacklightFlagFor(A, env)).toBe(false);
    expect(vendorBacklightFlagFor(B, env)).toBeNull();
    expect(vendorBacklightFlagFor(B, { PLAYER_VENDOR_BACKLIGHT: `-${A}, -${B}` })).toBe(false);
  });

  it('a positive token is accepted and changes nothing — the key can only remove', () => {
    expect(vendorBacklightFlagFor(A, { PLAYER_VENDOR_BACKLIGHT: 'all' })).toBeNull();
    expect(vendorBacklightFlagFor(A, { PLAYER_VENDOR_BACKLIGHT: A })).toBeNull();
    expect(vendorBacklightFlagFor(A, { PLAYER_VENDOR_BACKLIGHT: `on,${A}` })).toBeNull();
  });

  it('a typo or a malformed id disables nothing', () => {
    expect(vendorBacklightFlagFor(A, { PLAYER_VENDOR_BACKLIGHT: 'of' })).toBeNull();
    expect(vendorBacklightFlagFor(A, { PLAYER_VENDOR_BACKLIGHT: '-not-a-uuid' })).toBeNull();
    expect(vendorBacklightFlagFor(A, { PLAYER_VENDOR_BACKLIGHT: `-${A.slice(0, 20)}` })).toBeNull();
    expect(parseVendorBacklightEnv({ PLAYER_VENDOR_BACKLIGHT: '-' })).toEqual({ offAll: false, offIds: new Set() });
  });

  it('a screen id that is not a uuid is never matched by a per-screen token', () => {
    expect(vendorBacklightFlagFor('screen-a', { PLAYER_VENDOR_BACKLIGHT: `-${A}` })).toBeNull();
    // …but a fleet-wide off still covers it.
    expect(vendorBacklightFlagFor('screen-a', { PLAYER_VENDOR_BACKLIGHT: 'off' })).toBe(false);
  });
});
