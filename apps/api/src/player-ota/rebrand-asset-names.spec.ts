/**
 * rebrand-asset-names.spec.ts
 *
 * The 2026-11-08 VenueOS rebrand renamed the APK release assets
 * (`edu-cms-<kind>-v….apk` → `venueos-<kind>-v….apk`) and the CI workflow
 * artifacts (`edu-cms-player-apk` → `venueos-player-apk`). Every release,
 * artifact and storage object made before that keeps its old name forever,
 * and the fleet (1.1.55–1.1.65, the older Manager) updates from them. These
 * tests pin: the OTA lane PREFERS the new name and still RESOLVES the old.
 */
import { PLAYER_APK_ARTIFACT_NAMES, pickReleaseApkAssetByName } from './player-ota.controller';

describe('pickReleaseApkAssetByName — new release-asset name preferred, legacy still served', () => {
  it('picks the venueos asset on a post-rebrand release', () => {
    const assets = [{ name: 'venueos-player-v1.1.66.apk', id: 1 }];
    expect(pickReleaseApkAssetByName(assets, 'player', '1.1.66')?.id).toBe(1);
  });

  it('still picks the edu-cms asset on every pre-rebrand release (e.g. player-v1.1.64)', () => {
    const assets = [{ name: 'edu-cms-player-v1.1.64.apk', id: 2 }];
    expect(pickReleaseApkAssetByName(assets, 'player', '1.1.64')?.id).toBe(2);
    const mgr = [{ name: 'edu-cms-manager-v1.0.24.apk', id: 3 }];
    expect(pickReleaseApkAssetByName(mgr, 'manager', '1.0.24')?.id).toBe(3);
  });

  it('prefers the new exact name when a release somehow carries both', () => {
    const assets = [
      { name: 'edu-cms-player-v1.1.66.apk', id: 4 },
      { name: 'venueos-player-v1.1.66.apk', id: 5 },
    ];
    expect(pickReleaseApkAssetByName(assets, 'player', '1.1.66')?.id).toBe(5);
  });

  it('keeps the generic non-x86 fallback and never hands out an x86 build', () => {
    expect(pickReleaseApkAssetByName([{ name: 'something-else.apk', id: 6 }], 'player', '1.1.66')?.id).toBe(6);
    expect(pickReleaseApkAssetByName([{ name: 'venueos-player-x86.apk', id: 7 }], 'player', '1.1.66')).toBeUndefined();
  });
});

describe('PLAYER_APK_ARTIFACT_NAMES — CI artifact query order', () => {
  it('queries the new artifact name first, then the pre-rebrand one', () => {
    // Field candidates up to and including 1.1.65-field.1 (CI 42446385225)
    // were uploaded as `edu-cms-player-apk`.
    expect([...PLAYER_APK_ARTIFACT_NAMES]).toEqual(['venueos-player-apk', 'edu-cms-player-apk']);
  });
});
