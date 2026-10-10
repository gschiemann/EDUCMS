/**
 * REVIEW FINDING (2026-10-10, Codex player/OTA review).
 *
 * A private field build `1.1.25-field.1` carries versionCode 10125, the SAME
 * code the next stable `1.1.25` will carry, and Path B's uptoDate check is
 * `semverGte(callerVn, latest)`. `semverGte` parses `25-field` as 25 and the
 * trailing `.1` as a FOURTH component, so it reports the field build as
 * NEWER than stable 1.1.25. Result: every screen that took the field APK is
 * told `uptoDate` for stable 1.1.25 and keeps running prerelease bytes until
 * 1.1.26 exists — a silent strand of the exact screens used for hardware
 * qualification.
 *
 * Semver precedence says a prerelease sorts BELOW its release; these
 * assertions encode that. They failed on HEAD 7abab895. The device side still refuses an equal
 * versionCode, so scripts/release-apk.sh also refuses a stable x.y.z while an
 * x.y.z-field.* candidate exists.
 */
import { semverGte } from './release-policy';

describe('field candidate must not outrank the stable release it precedes', () => {
  it('stable 1.1.25 is newer than 1.1.25-field.1', () => {
    expect(semverGte('1.1.25-field.1', '1.1.25')).toBe(false);
  });
  it('a field caller is still offered the next stable patch', () => {
    // Path B: `if (semverGte(callerVn, info.versionName)) return uptoDate`
    const callerVn = '1.1.25-field.1';
    const latestStable = '1.1.25';
    const wouldBeOffered = !semverGte(callerVn, latestStable);
    expect(wouldBeOffered).toBe(true);
  });
  it('orders prereleases by identifier and keeps plain semver unchanged', () => {
    expect(semverGte('1.1.25-field.2', '1.1.25-field.1')).toBe(true);
    expect(semverGte('1.1.25-field.1', '1.1.25-field.2')).toBe(false);
    expect(semverGte('1.1.25-field.10', '1.1.25-field.9')).toBe(true);
    expect(semverGte('1.1.25-field.1', '1.1.24')).toBe(true);
    expect(semverGte('1.1.26', '1.1.25-field.1')).toBe(true);
    expect(semverGte('1.1.24', '1.1.24')).toBe(true);
    expect(semverGte('1.1.23', '1.1.24')).toBe(false);
    expect(semverGte('1.2.0', '1.1.99')).toBe(true);
  });
});
