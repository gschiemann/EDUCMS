import { cachedManifestWouldClearLiveAlert, provisionalAlertSurvivesPreCommitManifest } from '../emergencyInterlock';

// 2026-10-26: the signed trigger's own pre-commit manifest may not release
// the alert that trigger raised (the fan-out precedes the commit by design).
describe('provisionalAlertSurvivesPreCommitManifest — a trigger cannot un-raise itself mid-commit', () => {
  it('KEEPS: a live normal manifest inside the confirmation window leaves a push-raised alert up', () => {
    expect(provisionalAlertSurvivesPreCommitManifest({ fromCache: false, manifestHasEmergency: false, provisionalAlertOnGlass: true, confirmWindowOpen: true })).toBe(true);
  });

  it('RELEASES: once the window has closed, a live normal manifest clears it (the 30 s timeout path drops it too)', () => {
    expect(provisionalAlertSurvivesPreCommitManifest({ fromCache: false, manifestHasEmergency: false, provisionalAlertOnGlass: true, confirmWindowOpen: false })).toBe(false);
  });

  it('CONFIRMS: a manifest that carries an emergency always applies — the committed alert replaces the provisional one', () => {
    expect(provisionalAlertSurvivesPreCommitManifest({ fromCache: false, manifestHasEmergency: true, provisionalAlertOnGlass: true, confirmWindowOpen: true })).toBe(false);
  });

  it('never for an alert the manifest itself asserted: that one releases exactly as before', () => {
    expect(provisionalAlertSurvivesPreCommitManifest({ fromCache: false, manifestHasEmergency: false, provisionalAlertOnGlass: false, confirmWindowOpen: true })).toBe(false);
  });

  it('a cached manifest is the first interlock\'s business, not this one\'s', () => {
    expect(provisionalAlertSurvivesPreCommitManifest({ fromCache: true, manifestHasEmergency: false, provisionalAlertOnGlass: true, confirmWindowOpen: true })).toBe(false);
  });
});

// Player rule 11: a cached manifest may RAISE an alert but never RELEASE one.
describe('cachedManifestWouldClearLiveAlert — a cached manifest raises, never releases', () => {
  it('NEVER RELEASES: a disk copy with no emergency must not clear a live alert', () => {
    expect(cachedManifestWouldClearLiveAlert({ fromCache: true, manifestHasEmergency: false, liveAlertOnGlass: true })).toBe(true);
  });

  it('RAISES: a disk copy that carries an emergency is applied (a power-cycle mid-lockdown rides through)', () => {
    expect(cachedManifestWouldClearLiveAlert({ fromCache: true, manifestHasEmergency: true, liveAlertOnGlass: false })).toBe(false);
    expect(cachedManifestWouldClearLiveAlert({ fromCache: true, manifestHasEmergency: true, liveAlertOnGlass: true })).toBe(false);
  });

  it('the SERVER of record releases: a live manifest with no emergency clears the alert', () => {
    expect(cachedManifestWouldClearLiveAlert({ fromCache: false, manifestHasEmergency: false, liveAlertOnGlass: true })).toBe(false);
  });

  it('nothing on glass: a cached normal manifest is simply applied', () => {
    expect(cachedManifestWouldClearLiveAlert({ fromCache: true, manifestHasEmergency: false, liveAlertOnGlass: false })).toBe(false);
  });
});
