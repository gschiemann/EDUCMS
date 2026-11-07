import { nativeStoreDiscoveryAllowed } from '../nativeStoreDiscovery';

const screenId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const manifest = () => ({ screenId, tenantId, isEmergency: false,
  nativeVideo: { screenId, tenantId, faceIndex: 0, nativeFirst: true, store: true } });
const eligible = (overrides: Partial<Parameters<typeof nativeStoreDiscoveryAllowed>[0]> = {}) =>
  nativeStoreDiscoveryAllowed({ screenId, manifest: manifest(), userAgent: 'Android EduCmsPlayer/1.1.64-field.1',
    holdRaised: false, mediaAlreadyAvailable: false, ...overrides });

test('only an explicitly enrolled .64+ face can request store discovery', () => {
  expect(eligible()).toBe(true);
  for (const version of ['1.1.63-field.1', '1.0.100', '0.99.999', '', 'unknown']) {
    expect(eligible({ userAgent: `Android EduCmsPlayer/${version}` })).toBe(false);
  }
  for (const version of ['1.1.65', '1.2.0', '2.0.0']) {
    expect(eligible({ userAgent: `Android EduCmsPlayer/${version}` })).toBe(true);
  }
});

test('existing playable media and every raised hold suppress discovery', () => {
  expect(eligible({ holdRaised: true })).toBe(false);
  expect(eligible({ mediaAlreadyAvailable: true })).toBe(false);
  expect(eligible({ manifest: { ...manifest(), isEmergency: true } })).toBe(false);
});

test('wrong identity, missing/false flags and malformed descriptors are inert', () => {
  expect(eligible({ screenId: tenantId })).toBe(false);
  expect(eligible({ manifest: null })).toBe(false);
  expect(eligible({ manifest: { ...manifest(), nativeVideo: null } })).toBe(false);
  for (const patch of [{ screenId: tenantId }, { tenantId: screenId }, { faceIndex: 2 },
    { nativeFirst: false }, { store: false }, { store: 'true' }, { nativeFirst: 'true' }]) {
    expect(eligible({ manifest: { ...manifest(), nativeVideo: { ...manifest().nativeVideo, ...patch } } })).toBe(false);
  }
});
