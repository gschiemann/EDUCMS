/**
 * The owner's fleet push rules (fleet-push-policy.ts), every shape pinned.
 *   1. one hardware class for a set of more than one screen;
 *   2. field candidates only to PLAYER_FIELD_BENCH_SCREENS (unset = no change);
 *   3. a push to more than one screen only 22:00–06:00 in each screen's zone.
 */
import {
  COARSE_HARDWARE_MODELS,
  FIELD_BENCH_ENV,
  OFF_HOURS,
  evaluateHardwareClasses,
  evaluateOffHours,
  hardwareClassOf,
  isFieldBenchScreen,
  localTimeIn,
  parseFieldBenchScreens,
} from './fleet-push-policy';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const C = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';

/** A `lastVideoReport` as APK ≥ 1.1.41 writes it (only the device class is read). */
const reported = (cls: string) => ({ native: { device: { class: cls } } });

describe('rule 2 — PLAYER_FIELD_BENCH_SCREENS', () => {
  it('UNSET or blank: no restriction at all — every screen passes, exactly as before the variable existed', () => {
    for (const env of [{}, { [FIELD_BENCH_ENV]: '' }, { [FIELD_BENCH_ENV]: '  ' }, { [FIELD_BENCH_ENV]: undefined }]) {
      expect(parseFieldBenchScreens(env)).toEqual({ configured: false, ids: new Set() });
      for (const id of [A, B, 'not-a-uuid', '', null, undefined]) expect(isFieldBenchScreen(id, env)).toBe(true);
    }
  });

  it('SET: only the listed screens, matched without regard to case or spaces', () => {
    const env = { [FIELD_BENCH_ENV]: ` ${A.toUpperCase()} ,${B}` };
    expect(parseFieldBenchScreens(env)).toEqual({ configured: true, ids: new Set([A, B]) });
    expect(isFieldBenchScreen(A, env)).toBe(true);
    expect(isFieldBenchScreen(B.toUpperCase(), env)).toBe(true);
    expect(isFieldBenchScreen(C, env)).toBe(false);
    expect(isFieldBenchScreen(null, env)).toBe(false);
    expect(isFieldBenchScreen(undefined, env)).toBe(false);
  });

  it('a typo can only shrink the list: no wildcard, unknown tokens ignored, nothing valid = no bench screen', () => {
    expect(parseFieldBenchScreens({ [FIELD_BENCH_ENV]: `all,${A}x,-${B},${C}` }).ids).toEqual(new Set([C]));
    for (const raw of ['all', '*', 'off', 'none', `${A.slice(0, 35)}`, ',,,']) {
      const env = { [FIELD_BENCH_ENV]: raw };
      expect(parseFieldBenchScreens(env).configured).toBe(true);
      expect(isFieldBenchScreen(A, env)).toBe(false);
      expect(isFieldBenchScreen(B, env)).toBe(false);
    }
  });

  it('reads process.env by default', () => {
    const saved = process.env[FIELD_BENCH_ENV];
    try {
      delete process.env[FIELD_BENCH_ENV];
      expect(isFieldBenchScreen(C)).toBe(true);
      process.env[FIELD_BENCH_ENV] = A;
      expect(isFieldBenchScreen(C)).toBe(false);
      expect(isFieldBenchScreen(A)).toBe(true);
    } finally {
      if (saved === undefined) delete process.env[FIELD_BENCH_ENV];
      else process.env[FIELD_BENCH_ENV] = saved;
    }
  });
});

describe('rule 1 — a screen’s hardware class', () => {
  it('a specific model is its own class (the field the model:<id> rollout tokens match), normalised', () => {
    expect(hardwareClassOf({ hardwareModel: 'goodview-ep6n' })).toEqual({ key: 'model:goodview-ep6n', label: 'goodview-ep6n' });
    expect(hardwareClassOf({ hardwareModel: '  MAXHUB-L55VEC ' })).toEqual({ key: 'model:maxhub-l55vec', label: 'maxhub-l55vec' });
    // A specific model wins over a report: the SKU is the class.
    expect(hardwareClassOf({ hardwareModel: 'novastar-taurus', lastVideoReport: reported('rockchip/android-11') })?.key).toBe('model:novastar-taurus');
  });

  it('the "could not tell" buckets are told apart by the device class the APK reported', () => {
    expect([...COARSE_HARDWARE_MODELS].sort()).toEqual(['generic-android', 'unknown']);
    expect(hardwareClassOf({ hardwareModel: 'generic-android', lastVideoReport: reported('amlogic/android-13') })).toEqual({
      key: 'class:amlogic/android-13',
      label: 'generic-android (amlogic/android-13)',
    });
    expect(hardwareClassOf({ hardwareModel: null, lastVideoReport: reported('rockchip/android-7') })).toEqual({
      key: 'class:rockchip/android-7',
      label: 'rockchip/android-7',
    });
  });

  it('no specific model and no report = no known class', () => {
    for (const s of [
      {},
      { hardwareModel: null },
      { hardwareModel: '' },
      { hardwareModel: '   ' },
      { hardwareModel: 'generic-android' },
      { hardwareModel: 'UNKNOWN' },
      { hardwareModel: 'generic-android', lastVideoReport: 'garbage' },
      { hardwareModel: 'generic-android', lastVideoReport: reported('Amlogic/android-13') },
      { hardwareModel: 'generic-android', lastVideoReport: { native: { device: {} } } },
      null,
      undefined,
    ]) {
      expect(hardwareClassOf(s as any)).toBeNull();
    }
  });
});

describe('rule 1 — one hardware class for more than one screen', () => {
  const ep6n = (id: string, name?: string) => ({ id, name, hardwareModel: 'goodview-ep6n' });

  it('none or one screen always passes, even of unknown hardware', () => {
    expect(evaluateHardwareClasses([])).toMatchObject({ ok: true, reason: null });
    expect(evaluateHardwareClasses([{ id: A, name: 'Lobby' }])).toMatchObject({ ok: true, reason: null, unknown: [{ id: A, name: 'Lobby' }] });
  });

  it('many screens of one known class pass', () => {
    expect(evaluateHardwareClasses([ep6n(A), ep6n(B), ep6n(C)])).toEqual({
      ok: true,
      reason: null,
      classes: ['goodview-ep6n'],
      unknown: [],
      incomplete: false,
    });
  });

  it('two classes are refused, naming both in the order seen', () => {
    expect(evaluateHardwareClasses([ep6n(A), { id: B, hardwareModel: 'maxhub-l55vec' }, ep6n(C)])).toEqual({
      ok: false,
      reason: 'mixed',
      classes: ['goodview-ep6n', 'maxhub-l55vec'],
      unknown: [],
      incomplete: false,
    });
  });

  it('THE 2026-10-12 SHAPE: a GUQ panel and an rk3288 double-sided unit, both generic-android, are two classes', () => {
    const guq = { id: A, name: 'M43', hardwareModel: 'generic-android', lastVideoReport: reported('amlogic/android-13') };
    const dh43 = { id: B, name: 'DH43', hardwareModel: 'generic-android', lastVideoReport: reported('rockchip/android-7') };
    expect(evaluateHardwareClasses([guq, dh43])).toMatchObject({
      ok: false,
      reason: 'mixed',
      classes: ['generic-android (amlogic/android-13)', 'generic-android (rockchip/android-7)'],
    });
    // Two GUQ panels that reported the same class are one.
    expect(evaluateHardwareClasses([guq, { ...guq, id: C }])).toMatchObject({ ok: true, classes: ['generic-android (amlogic/android-13)'] });
  });

  it('a screen of unknown hardware in a set cannot be shown to be one class — refused, naming it', () => {
    expect(evaluateHardwareClasses([ep6n(A, 'Lobby'), { id: B, name: 'Gym', hardwareModel: 'generic-android' }])).toEqual({
      ok: false,
      reason: 'unknown',
      classes: ['goodview-ep6n'],
      unknown: [{ id: B, name: 'Gym' }],
      incomplete: false,
    });
    expect(evaluateHardwareClasses([{ id: A }, { id: B }])).toMatchObject({ ok: false, reason: 'unknown', classes: [] });
  });

  it('a definite mix is reported before an unknown screen', () => {
    expect(evaluateHardwareClasses([ep6n(A), { id: B, hardwareModel: 'pi5' }, { id: C, name: '' }])).toMatchObject({
      reason: 'mixed',
      classes: ['goodview-ep6n', 'pi5'],
      unknown: [{ id: C, name: null }],
    });
  });

  it('a set the caller could not read whole cannot be shown to be one class', () => {
    expect(evaluateHardwareClasses([ep6n(A), ep6n(B)], { incomplete: true })).toMatchObject({ ok: false, reason: 'unknown', incomplete: true });
    expect(evaluateHardwareClasses([ep6n(A)], { incomplete: true })).toMatchObject({ ok: false, reason: 'unknown', incomplete: true });
  });
});

describe('rule 3 — off-hours, in each screen’s own time zone', () => {
  // 2026-10-31 04:30 UTC: Chicago (CDT) 23:30 · New York (EDT) 00:30 · Tokyo 13:30.
  const night = new Date(Date.UTC(2026, 9, 31, 4, 30));
  const utcAt = (hh: number, mm: number) => new Date(Date.UTC(2026, 9, 31, hh, mm, 30));
  const two = (zone1: string | null, zone2: string | null) => [
    { id: A, name: 'Lobby', timeZone: zone1 },
    { id: B, name: 'Gym', timeZone: zone2 },
  ];

  it('is 22:00 to 06:00', () => {
    expect(OFF_HOURS).toEqual({ start: '22:00', end: '06:00' });
  });

  it('one screen is exempt at any hour, with or without a zone — that is how bench testing works', () => {
    expect(evaluateOffHours([], utcAt(12, 0)).ok).toBe(true);
    expect(evaluateOffHours([{ id: A, timeZone: null }], utcAt(12, 0))).toEqual({ ok: true, reason: null, noZone: [], outside: [] });
    expect(evaluateOffHours([{ id: A, timeZone: 'America/Chicago' }], utcAt(17, 0)).ok).toBe(true);
  });

  it('many screens go out when it is night in every one of their zones', () => {
    expect(evaluateOffHours(two('America/Chicago', 'America/New_York'), night)).toEqual({ ok: true, reason: null, noZone: [], outside: [] });
  });

  it('a screen whose local time is day refuses the push, with that time', () => {
    expect(evaluateOffHours(two('America/Chicago', 'Asia/Tokyo'), night)).toEqual({
      ok: false,
      reason: 'outside',
      noZone: [],
      outside: [{ id: B, name: 'Gym', timeZone: 'Asia/Tokyo', localTime: '13:30' }],
    });
  });

  it('the edges: 22:00 is inside, 06:00 is outside, 05:59 inside, 21:59 outside', () => {
    expect(evaluateOffHours(two('UTC', 'UTC'), utcAt(22, 0)).ok).toBe(true);
    expect(evaluateOffHours(two('UTC', 'UTC'), utcAt(5, 59)).ok).toBe(true);
    expect(evaluateOffHours(two('UTC', 'UTC'), utcAt(0, 0)).ok).toBe(true);
    expect(evaluateOffHours(two('UTC', 'UTC'), utcAt(6, 0))).toMatchObject({ ok: false, reason: 'outside' });
    expect(evaluateOffHours(two('UTC', 'UTC'), utcAt(21, 59))).toMatchObject({ ok: false, reason: 'outside' });
  });

  it('a screen with no zone — or one no clock can read — is UNKNOWN and refuses, named; it is reported first', () => {
    for (const bad of [null, undefined, '', 'Mars/Olympus_Mons', 'not a zone']) {
      expect(evaluateOffHours(two('America/Chicago', bad as any), night)).toEqual({
        ok: false,
        reason: 'no-time-zone',
        noZone: [{ id: B, name: 'Gym' }],
        outside: [],
      });
    }
    // Both problems at once: the missing zone leads (it blocks even at night); both lists are filled.
    expect(evaluateOffHours([...two(null, 'Asia/Tokyo'), { id: C, timeZone: 'America/Chicago' }], night)).toEqual({
      ok: false,
      reason: 'no-time-zone',
      noZone: [{ id: A, name: 'Lobby' }],
      outside: [{ id: B, name: 'Gym', timeZone: 'Asia/Tokyo', localTime: '13:30' }],
    });
  });

  it('localTimeIn reads the zone’s own clock, 00–23', () => {
    expect(localTimeIn('UTC', utcAt(5, 7))).toBe('05:07');
    expect(localTimeIn('Asia/Tokyo', utcAt(15, 0))).toBe('00:00');
    expect(localTimeIn('America/Chicago', night)).toBe('23:30');
    expect(localTimeIn('Mars/Olympus_Mons', night)).toBeNull();
    expect(localTimeIn('', night)).toBeNull();
  });
});
