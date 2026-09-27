import { cachedManifestWouldClearLiveAlert } from '../emergencyInterlock';

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
