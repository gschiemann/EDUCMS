import { clearOfflineManifests, LEGACY_MANIFEST_KEY, readOfflineManifest, recordManifestPairing, saveManifest } from '../offlineBoot';

const screenId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const fp = 'offline-screen-fingerprint';
const jwt = (extra: Record<string, unknown> = {}) => 'header.' + Buffer.from(JSON.stringify({ kind: 'device', sub: screenId, tenantId, exp: 1, ...extra })).toString('base64url') + '.signature';
const manifest = (name: string, extra = {}) => ({ screenId, tenantId, playlists: [{ name, items: [] }], ...extra });
beforeEach(() => localStorage.clear());

test('authoritative unpair refuses replay and late writes even with a tenantless token', () => {
  saveManifest(localStorage, manifest('old tenant'), screenId, fp, true);
  recordManifestPairing(localStorage, screenId, false);
  expect(readOfflineManifest(localStorage, jwt({ tenantId: undefined }), fp)).toBeNull();
  saveManifest(localStorage, manifest('late old response'), screenId, fp, true);
  expect(readOfflineManifest(localStorage, jwt(), fp)).toBeNull();
  recordManifestPairing(localStorage, screenId, true);
  saveManifest(localStorage, manifest('repaired'), screenId, fp, true);
  expect(readOfflineManifest(localStorage, jwt(), fp)?.m.playlists[0].name).toBe('repaired');
});
test('temporary tenantless repair credentials retain a previously paired own cache', () => {
  recordManifestPairing(localStorage, screenId, true);
  saveManifest(localStorage, manifest('own paired content'), screenId, fp, true);
  expect(readOfflineManifest(localStorage, jwt({ tenantId: undefined }), fp)?.screenId).toBe(screenId);
});

test('cold boot adopts the existing own cache even with an expired credential', () => {
  localStorage.setItem(LEGACY_MANIFEST_KEY, JSON.stringify({ at: 1000, m: manifest('last played') }));
  expect(readOfflineManifest(localStorage, jwt(), fp)?.m.playlists[0].name).toBe('last played');
});
test('a newly received download cannot replace the last playable fallback', () => {
  saveManifest(localStorage, manifest('last played'), screenId, fp, true, 1000);
  saveManifest(localStorage, manifest('still downloading'), screenId, fp, false, 2000);
  expect(readOfflineManifest(localStorage, jwt(), fp)?.m.playlists[0].name).toBe('last played');
  saveManifest(localStorage, manifest('new video ready'), screenId, fp, true, 3000);
  expect(readOfflineManifest(localStorage, jwt(), fp)?.m.playlists[0].name).toBe('new video ready');
});
test('a cached alert outranks previously playing normal content', () => {
  saveManifest(localStorage, manifest('normal'), screenId, fp, true);
  saveManifest(localStorage, manifest('alert', { isEmergency: true }), screenId, fp);
  expect(readOfflineManifest(localStorage, jwt(), fp)?.m.isEmergency).toBe(true);
});
test('a cleared alert snapshot does not resurrect older emergency content', () => {
  saveManifest(localStorage, manifest('alert', { isEmergency: true }), screenId, fp, true);
  saveManifest(localStorage, manifest('normal'), screenId, fp);
  expect(readOfflineManifest(localStorage, jwt(), fp)?.m.playlists[0].name).toBe('normal');
});
test('another face, account, fingerprint and an admin credential cannot bootstrap local content', () => {
  saveManifest(localStorage, manifest('own'), screenId, fp, true);
  expect(readOfflineManifest(localStorage, jwt({ sub: other }), fp)).toBeNull();
  expect(readOfflineManifest(localStorage, jwt({ tenantId: other }), fp)).toBeNull();
  expect(readOfflineManifest(localStorage, jwt(), 'new device')).toBeNull();
  expect(readOfflineManifest(localStorage, jwt({ kind: 'user' }), fp)).toBeNull();
});
test('a legacy cache requires its exact screen and tenant', () => {
  localStorage.setItem(LEGACY_MANIFEST_KEY, JSON.stringify({ at: 1000, m: manifest('wrong', { tenantId: other }) }));
  expect(readOfflineManifest(localStorage, jwt(), fp)).toBeNull();
  localStorage.setItem(LEGACY_MANIFEST_KEY, JSON.stringify({ at: 1000, m: manifest('wrong', { screenId: other }) }));
  expect(readOfflineManifest(localStorage, jwt(), fp)).toBeNull();
});
test('malformed or inaccessible storage is not adopted and unpair clears all faces', () => {
  saveManifest(localStorage, manifest('own'), screenId, fp, true);
  localStorage.setItem(LEGACY_MANIFEST_KEY, 'bad JSON');
  expect(readOfflineManifest(localStorage, 'junk', fp)).toBeNull();
  expect(readOfflineManifest({ ...localStorage, getItem: () => { throw new Error('unavailable'); } }, jwt(), fp)).toBeNull();
  localStorage.setItem('unrelated-setting', 'keep');
  clearOfflineManifests(localStorage);
  expect(readOfflineManifest(localStorage, jwt(), fp)).toBeNull();
  expect(localStorage.getItem('unrelated-setting')).toBe('keep');
});
