/**
 * The automatic time zone — the offline lookup and the per-screen resolver
 * (2026-10-24). Real coordinates, the real library; no network, no clock.
 */
import {
  autoTimeZoneFor,
  lookupTimeZoneForCoordinates,
  manifestTimeZone,
  resetTimeZoneLookupCacheForTests,
  resolveScreenTimeZone,
  screenTimeZoneFields,
} from './screen-time-zone';

const LA = { latitude: 34.0522, longitude: -118.2437 };
const CLEVELAND = { latitude: 41.4993, longitude: -81.6944 };
const HONOLULU = { latitude: 21.3069, longitude: -157.8583 };
const SHANGHAI = { latitude: 31.2304, longitude: 121.4737 };

beforeEach(() => resetTimeZoneLookupCacheForTests());

describe('lookupTimeZoneForCoordinates — offline, honest about the edges', () => {
  it('answers the IANA zone for real places', () => {
    expect(lookupTimeZoneForCoordinates(LA.latitude, LA.longitude)).toBe(
      'America/Los_Angeles',
    );
    expect(
      lookupTimeZoneForCoordinates(CLEVELAND.latitude, CLEVELAND.longitude),
    ).toBe('America/New_York');
    expect(
      lookupTimeZoneForCoordinates(HONOLULU.latitude, HONOLULU.longitude),
    ).toBe('Pacific/Honolulu');
    expect(
      lookupTimeZoneForCoordinates(SHANGHAI.latitude, SHANGHAI.longitude),
    ).toBe('Asia/Shanghai');
    // Arizona keeps no DST — a different zone from Denver, which the grid must tell apart.
    expect(lookupTimeZoneForCoordinates(33.4484, -112.074)).toBe(
      'America/Phoenix',
    );
    expect(lookupTimeZoneForCoordinates(39.7392, -104.9903)).toBe(
      'America/Denver',
    );
  });

  it('accepts numeric strings (a raw column read) and rejects garbage', () => {
    expect(lookupTimeZoneForCoordinates('34.0522', '-118.2437')).toBe(
      'America/Los_Angeles',
    );
    expect(lookupTimeZoneForCoordinates('abc', '-118')).toBeNull();
    expect(lookupTimeZoneForCoordinates(null, null)).toBeNull();
    expect(lookupTimeZoneForCoordinates(undefined, -118)).toBeNull();
    expect(lookupTimeZoneForCoordinates(NaN, 0)).toBeNull();
    expect(lookupTimeZoneForCoordinates(Infinity, 0)).toBeNull();
  });

  it('falls back cleanly off the map: out-of-range, the open ocean, the poles', () => {
    expect(lookupTimeZoneForCoordinates(95, 0)).toBeNull(); // the library throws; we answer null
    expect(lookupTimeZoneForCoordinates(0, 200)).toBeNull();
    // Mid-Atlantic and the North Pole come back as Etc/GMT* — "no place" — never pinned.
    expect(lookupTimeZoneForCoordinates(30, -40)).toBeNull();
    expect(lookupTimeZoneForCoordinates(89.9, 0)).toBeNull();
    // The zero island.
    expect(lookupTimeZoneForCoordinates(0, 0)).toBeNull();
  });

  it('is deterministic and cached by rounded coordinates', () => {
    const a = lookupTimeZoneForCoordinates(34.05221, -118.24371);
    const b = lookupTimeZoneForCoordinates(34.05229, -118.24379);
    expect(a).toBe('America/Los_Angeles');
    expect(b).toBe(a);
  });
});

describe('autoTimeZoneFor — screen > group > location coordinates', () => {
  it('prefers the screen pin, then the group address, then the location', () => {
    expect(
      autoTimeZoneFor({ screen: LA, group: CLEVELAND, location: HONOLULU }),
    ).toEqual({ zone: 'America/Los_Angeles', from: 'screen' });
    expect(
      autoTimeZoneFor({ screen: null, group: CLEVELAND, location: HONOLULU }),
    ).toEqual({ zone: 'America/New_York', from: 'group' });
    expect(
      autoTimeZoneFor({
        screen: { latitude: null, longitude: null },
        group: null,
        location: HONOLULU,
      }),
    ).toEqual({ zone: 'Pacific/Honolulu', from: 'location' });
  });

  it('skips a level whose coordinates resolve to nothing instead of stopping there', () => {
    // A screen pinned in the Atlantic by mistake still gets its building's zone.
    expect(
      autoTimeZoneFor({
        screen: { latitude: 30, longitude: -40 },
        group: null,
        location: LA,
      }),
    ).toEqual({ zone: 'America/Los_Angeles', from: 'location' });
    expect(
      autoTimeZoneFor({ screen: null, group: null, location: null }),
    ).toBeNull();
    expect(autoTimeZoneFor({})).toBeNull();
  });
});

describe('resolveScreenTimeZone — the whole precedence over real rows', () => {
  it('override > location setting > automatic > device', () => {
    expect(
      resolveScreenTimeZone({
        screenOverride: 'America/Denver',
        locationSetting: 'America/Chicago',
        location: LA,
      }).zone,
    ).toBe('America/Denver');
    expect(
      resolveScreenTimeZone({
        locationSetting: 'America/Chicago',
        location: LA,
      }),
    ).toMatchObject({
      zone: 'America/Chicago',
      source: 'location',
      auto: { zone: 'America/Los_Angeles', from: 'location' },
    });
    expect(resolveScreenTimeZone({ location: LA })).toMatchObject({
      zone: 'America/Los_Angeles',
      source: 'auto',
    });
    expect(resolveScreenTimeZone({})).toEqual({
      zone: null,
      source: 'device',
      auto: null,
    });
  });

  it('a hand-edited invalid override never reaches a screen', () => {
    expect(
      resolveScreenTimeZone({
        screenOverride: 'Pacific/Nowhere',
        location: LA,
      }),
    ).toMatchObject({ zone: 'America/Los_Angeles', source: 'auto' });
  });

  it('screenTimeZoneFields names the four dashboard fields', () => {
    expect(
      screenTimeZoneFields({ screen: CLEVELAND, locationSetting: null }),
    ).toEqual({
      timeZone: 'America/New_York',
      timeZoneSource: 'auto',
      timeZoneAuto: 'America/New_York',
      timeZoneAutoFrom: 'screen',
    });
    expect(screenTimeZoneFields({})).toEqual({
      timeZone: null,
      timeZoneSource: 'device',
      timeZoneAuto: null,
      timeZoneAutoFrom: null,
    });
  });
});

describe('manifestTimeZone — the manifest field from the preamble rows', () => {
  it('uses the tenant projection (setting + coordinates) and the group row', () => {
    expect(
      manifestTimeZone(
        { timezone: null, latitude: null, longitude: null },
        null,
        { timezone: null, ...LA },
      ),
    ).toBe('America/Los_Angeles');
    expect(
      manifestTimeZone(
        { timezone: null, latitude: null, longitude: null },
        CLEVELAND,
        { timezone: null, ...LA },
      ),
    ).toBe('America/New_York');
    expect(
      manifestTimeZone({ timezone: 'Pacific/Honolulu', ...LA }, CLEVELAND, {
        timezone: 'America/Chicago',
        ...LA,
      }),
    ).toBe('Pacific/Honolulu');
    expect(
      manifestTimeZone(
        { timezone: null, latitude: null, longitude: null },
        null,
        { timezone: 'America/Chicago', ...LA },
      ),
    ).toBe('America/Chicago');
  });

  it('is null — "use the device" — when nothing resolves, and tolerates a missing tenant/group', () => {
    expect(manifestTimeZone({ timezone: null }, null, null)).toBeNull();
    expect(manifestTimeZone({}, undefined, undefined)).toBeNull();
    expect(
      manifestTimeZone({ timezone: 123 as unknown as string }, null, {
        timezone: 7 as unknown as string,
      }),
    ).toBeNull();
  });
});
