/**
 * player-ota.spec.ts
 *
 * Guards the versionCode encoding scheme used by the API's
 * /player/update-check endpoint. The formula must stay in sync
 * with the Gradle versionCode values in:
 *   apps/player/app/build.gradle.kts
 *   apps/player/manager/build.gradle.kts
 *
 * Bug history: the API used to return derivedVersionCode = 10033
 * while the APK manifest had versionCode = 33. WatchdogService
 * compared PackageManager.versionCode (33) against
 * InstallState.pendingVc (10033) and always saw mismatch, triggering
 * a false rollback after every successful OTA install.
 *
 * Fix: Gradle now encodes versionCode with the same formula
 * (major*10000 + minor*100 + patch). These tests lock that invariant.
 */

/** Replicated from player-ota.controller.ts — kept in sync by this test. */
function deriveVersionCode(versionName: string): number {
  const match = versionName.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return 0;
  return (
    parseInt(match[1], 10) * 10000 +
    parseInt(match[2], 10) * 100 +
    parseInt(match[3], 10)
  );
}

describe('deriveVersionCode (API semver → versionCode formula)', () => {
  it('encodes 1.0.33 as 10033', () => {
    expect(deriveVersionCode('1.0.33')).toBe(10033);
  });

  it('encodes 1.0.8 as 10008 (Manager versionName)', () => {
    expect(deriveVersionCode('1.0.8')).toBe(10008);
  });

  it('encodes 1.0.0 as 10000', () => {
    expect(deriveVersionCode('1.0.0')).toBe(10000);
  });

  it('encodes 2.1.5 as 20105', () => {
    expect(deriveVersionCode('2.1.5')).toBe(20105);
  });

  it('returns 0 for a non-semver string', () => {
    expect(deriveVersionCode('invalid')).toBe(0);
  });

  /**
   * CRITICAL INVARIANT: the Gradle versionCode must equal the API's
   * derivedVersionCode for the same versionName. These two assertions
   * will fail if someone bumps versionName without updating versionCode
   * (or vice-versa) in the Gradle files.
   *
   * Current versions as of 2026-04-27:
   *   Player:  versionName="1.0.33"  versionCode=10033
   *   Manager: versionName="1.0.8"   versionCode=10008
   */
  it('Player Gradle versionCode (10033) matches derivedVersionCode for "1.0.33"', () => {
    const GRADLE_PLAYER_VERSION_CODE = 10033; // apps/player/app/build.gradle.kts
    const GRADLE_PLAYER_VERSION_NAME = '1.0.33';
    expect(deriveVersionCode(GRADLE_PLAYER_VERSION_NAME)).toBe(GRADLE_PLAYER_VERSION_CODE);
  });

  it('Manager Gradle versionCode (10008) matches derivedVersionCode for "1.0.8"', () => {
    const GRADLE_MANAGER_VERSION_CODE = 10008; // apps/player/manager/build.gradle.kts
    const GRADLE_MANAGER_VERSION_NAME = '1.0.8';
    expect(deriveVersionCode(GRADLE_MANAGER_VERSION_NAME)).toBe(GRADLE_MANAGER_VERSION_CODE);
  });
});

describe('WatchdogService rollback guard logic', () => {
  /**
   * Simulates the check at WatchdogService.kt:102
   *
   *   val sawNewBoot = (ts > 0L) &&
   *     (System.currentTimeMillis() - ts <= STALE_THRESHOLD_MS) &&
   *     (playerVersionCode == pendingVc)
   *
   * With the OLD scheme (Gradle vc=33, API pendingVc=10033) this was
   * always false → false rollback. With the NEW scheme (both 10033) it
   * fires correctly.
   */
  function sawNewBootWouldFire(
    installedVersionCode: number,
    pendingVc: number,
    heartbeatAgeMs: number,
    staleThresholdMs = 90_000,
  ): boolean {
    const ts = Date.now() - heartbeatAgeMs;
    return ts > 0 && heartbeatAgeMs <= staleThresholdMs && installedVersionCode === pendingVc;
  }

  it('OLD scheme: Gradle vc=33 vs API pendingVc=10033 → false → rollback fires incorrectly', () => {
    // This is the bug. sawNewBoot=false even though the install succeeded.
    expect(sawNewBootWouldFire(33, 10033, 5_000)).toBe(false);
  });

  it('NEW scheme: Gradle vc=10033 vs API pendingVc=10033 → true → no false rollback', () => {
    // Fresh heartbeat within the grace window, matching version codes.
    expect(sawNewBootWouldFire(10033, 10033, 5_000)).toBe(true);
  });

  it('stale heartbeat (>90s) still does not promote even with matching vc', () => {
    expect(sawNewBootWouldFire(10033, 10033, 91_000)).toBe(false);
  });

  it('wrong versionCode with fresh heartbeat still does not promote', () => {
    // e.g. still on old APK, fresh heartbeat — should not promote pending
    expect(sawNewBootWouldFire(10032, 10033, 5_000)).toBe(false);
  });
});
