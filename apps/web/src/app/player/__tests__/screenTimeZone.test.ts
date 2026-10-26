/**
 * The screen's effective time zone on the player (2026-10-24): what the
 * manifest says, how it folds, and how every widget gets it as a default —
 * plus its place in the off-hours update zone.
 */
import {
  applyManifestTimeZone,
  deviceTimeZoneOf,
  isUsableTimeZone,
  readManifestTimeZone,
  readStoredTimeZone,
  SCREEN_TIME_ZONE_STORAGE_KEY,
  TIME_ZONE_DEFAULTED_KEY,
  withDefaultTimeZone,
  writeStoredTimeZone,
} from '../screenTimeZone';
import { resolveUpdateZone } from '../offHoursUpdate';

describe('readManifestTimeZone — three answers, kept apart', () => {
  it('a valid zone, null, or ABSENT (undefined)', () => {
    expect(readManifestTimeZone({ timeZone: 'America/Los_Angeles' })).toBe('America/Los_Angeles');
    expect(readManifestTimeZone({ timeZone: null })).toBeNull();
    expect(readManifestTimeZone({})).toBeUndefined();
    expect(readManifestTimeZone({ isEmergency: true, playlists: [] })).toBeUndefined();
    expect(readManifestTimeZone(null)).toBeUndefined();
    expect(readManifestTimeZone('nope')).toBeUndefined();
  });

  it('a zone this runtime cannot format in reads as null, never as a zone', () => {
    expect(readManifestTimeZone({ timeZone: 'Mars/Olympus' })).toBeNull();
    expect(readManifestTimeZone({ timeZone: 42 })).toBeNull();
    expect(readManifestTimeZone({ timeZone: '' })).toBeNull();
  });
});

describe('applyManifestTimeZone — absent keeps, anything else replaces', () => {
  it('an emergency manifest (no key) cannot move the zone; a normal one can clear it', () => {
    expect(applyManifestTimeZone('America/Chicago', undefined)).toBe('America/Chicago');
    expect(applyManifestTimeZone(null, undefined)).toBeNull();
    expect(applyManifestTimeZone('America/Chicago', 'America/Denver')).toBe('America/Denver');
    expect(applyManifestTimeZone('America/Chicago', null)).toBeNull();
  });
});

describe('withDefaultTimeZone — every widget without a zone gets the screen’s', () => {
  it('fills a config with no zone and marks it as defaulted', () => {
    const cfg = { content: 'Lobby', fontSize: 48 };
    const out = withDefaultTimeZone(cfg, 'America/Los_Angeles');
    expect(out).toMatchObject({
      content: 'Lobby',
      fontSize: 48,
      timezone: 'America/Los_Angeles',
      clockTimeZone: 'America/Los_Angeles',
      timeZone: 'America/Los_Angeles',
      [TIME_ZONE_DEFAULTED_KEY]: true,
    });
    // The input is never mutated (templates are shared objects).
    expect(cfg).toEqual({ content: 'Lobby', fontSize: 48 });
  });

  it('an explicit widget zone always wins — any spelling, even an odd one', () => {
    const explicit = { timezone: 'Asia/Tokyo' };
    expect(withDefaultTimeZone(explicit, 'America/Los_Angeles')).toBe(explicit);
    const animated = { clockTimeZone: 'Europe/London', title: 'Bell' };
    expect(withDefaultTimeZone(animated, 'America/Los_Angeles')).toBe(animated);
    const camel = { timeZone: 'America/New_York' };
    expect(withDefaultTimeZone(camel, 'America/Los_Angeles')).toBe(camel);
    const operatorTypo = { timezone: 'Mars/Olympus' };
    expect(withDefaultTimeZone(operatorTypo, 'America/Los_Angeles')).toBe(operatorTypo);
  });

  it('a blank zone counts as no zone', () => {
    expect(withDefaultTimeZone({ timezone: '   ' }, 'America/Chicago')).toMatchObject({ timezone: 'America/Chicago' });
  });

  it('is the identity when there is no screen zone or no config', () => {
    const cfg = { content: 'x' };
    expect(withDefaultTimeZone(cfg, null)).toBe(cfg);
    expect(withDefaultTimeZone(cfg, undefined)).toBe(cfg);
    expect(withDefaultTimeZone(null as unknown as Record<string, unknown>, 'America/Chicago')).toBeNull();
  });
});

describe('persistence — a boot straight into an alert still has the zone', () => {
  function fakeStorage(seed: Record<string, string> = {}) {
    const map = new Map(Object.entries(seed));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      map,
    };
  }

  it('round-trips a zone and drops an unusable stored value', () => {
    const s = fakeStorage();
    writeStoredTimeZone(s, 'America/Los_Angeles');
    expect(s.map.get(SCREEN_TIME_ZONE_STORAGE_KEY)).toBe('America/Los_Angeles');
    expect(readStoredTimeZone(s)).toBe('America/Los_Angeles');
    writeStoredTimeZone(s, null);
    expect(readStoredTimeZone(s)).toBeNull();
    expect(readStoredTimeZone(fakeStorage({ [SCREEN_TIME_ZONE_STORAGE_KEY]: 'Nope/Nope' }))).toBeNull();
    expect(readStoredTimeZone(null)).toBeNull();
  });

  it('a throwing storage never throws out', () => {
    const bad = {
      getItem: () => { throw new Error('quota'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('quota'); },
    };
    expect(readStoredTimeZone(bad)).toBeNull();
    expect(() => writeStoredTimeZone(bad, 'America/Chicago')).not.toThrow();
  });
});

describe('the update window zone — schedule, then SCREEN, then device, then UTC', () => {
  const CHI = 'America/Chicago';
  const w = { id: 'w1', daysOfWeek: new Set([1, 2, 3, 4, 5]), onMinute: 7 * 60, offMinute: 22 * 60, timezone: 'America/New_York' };

  it('the manifest zone beats the device zone and loses to a schedule row', () => {
    expect(resolveUpdateZone([w], CHI, 'America/Los_Angeles')).toEqual({ zone: 'America/New_York', source: 'schedule' });
    expect(resolveUpdateZone([], CHI, 'America/Los_Angeles')).toEqual({ zone: 'America/Los_Angeles', source: 'screen' });
    expect(resolveUpdateZone(null, CHI, 'America/Los_Angeles')).toEqual({ zone: 'America/Los_Angeles', source: 'screen' });
  });

  it('a GUQ still set to Shanghai applies its update at the location’s 03:00, not Shanghai’s', () => {
    expect(resolveUpdateZone(null, 'Asia/Shanghai', 'America/Los_Angeles')).toEqual({ zone: 'America/Los_Angeles', source: 'screen' });
  });

  it('without a manifest zone nothing changes: device, then UTC — exactly as before', () => {
    expect(resolveUpdateZone(null, CHI, null)).toEqual({ zone: CHI, source: 'device' });
    expect(resolveUpdateZone(null, CHI, undefined)).toEqual({ zone: CHI, source: 'device' });
    expect(resolveUpdateZone(null, CHI)).toEqual({ zone: CHI, source: 'device' });
    expect(resolveUpdateZone(null, null, 'Not/AZone')).toEqual({ zone: 'UTC', source: 'utc' });
  });
});

describe('the runtime’s own facts', () => {
  it('isUsableTimeZone agrees with Intl, and deviceTimeZoneOf answers a usable zone or null', () => {
    expect(isUsableTimeZone('America/Los_Angeles')).toBe(true);
    expect(isUsableTimeZone('Nope/Nope')).toBe(false);
    expect(isUsableTimeZone(' America/Los_Angeles')).toBe(false);
    const dz = deviceTimeZoneOf();
    expect(dz === null || isUsableTimeZone(dz)).toBe(true);
  });
});
