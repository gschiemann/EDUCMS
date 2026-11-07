import {
  FieldBuildInputError,
  MAX_WINDOW_MINUTES,
  PUSH_SETTLE_MS,
  GATE_TTL_MS,
  benchRefusal,
  envWindowView,
  hardwareClassRefusal,
  listScreenNames,
  offHoursRefusal,
  parseArmInput,
  parseMassPushOverride,
  parsePushInput,
  pushReadyAt,
  windowState,
} from './field-builds.policy';
import { evaluateHardwareClasses, evaluateOffHours } from '../player-ota/fleet-push-policy';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const S1 = '33333333-3333-4333-8333-333333333333';
const S2 = '44444444-4444-4444-8444-444444444444';

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof FieldBuildInputError ? e.code : `not-an-input-error:${String(e)}`;
  }
};

describe('arming a field window — input rules', () => {
  const ok = { candidate: '1.1.42-field.1', tenantIds: [T1], screens: [S1], durationMinutes: 60 };

  it('accepts named screens or `all`, de-duplicates and lower-cases ids, trims the note', () => {
    expect(parseArmInput({ ...ok, tenantIds: [T1, T1.toUpperCase()], screens: [S1, S1], note: '  soak  ' })).toEqual({
      candidate: '1.1.42-field.1',
      tenantIds: [T1],
      allScreens: false,
      screenIds: [S1],
      durationMinutes: 60,
      note: 'soak',
    });
    expect(parseArmInput({ ...ok, tenantIds: [T1, T2], screens: 'all', note: '' })).toMatchObject({
      tenantIds: [T1, T2],
      allScreens: true,
      screenIds: [],
      note: null,
    });
  });

  it('expiry is at most 24 h: whole minutes from 5 to 1440', () => {
    expect(parseArmInput({ ...ok, durationMinutes: MAX_WINDOW_MINUTES }).durationMinutes).toBe(1440);
    expect(parseArmInput({ ...ok, durationMinutes: '90' }).durationMinutes).toBe(90);
    for (const bad of [1441, 4, 0, -60, 60.5, 'soon', null, undefined, Number.POSITIVE_INFINITY]) {
      expect(code(() => parseArmInput({ ...ok, durationMinutes: bad }))).toBe('FIELD_BUILD_DURATION_INVALID');
    }
  });

  it('there is no organisation wildcard, and an organisation is always named', () => {
    expect(code(() => parseArmInput({ ...ok, tenantIds: 'all' }))).toBe('FIELD_BUILD_TENANTS_INVALID');
    expect(code(() => parseArmInput({ ...ok, tenantIds: ['all'] }))).toBe('FIELD_BUILD_TENANTS_INVALID');
    expect(code(() => parseArmInput({ ...ok, tenantIds: [] }))).toBe('FIELD_BUILD_TENANTS_REQUIRED');
    expect(code(() => parseArmInput({ ...ok, tenantIds: undefined }))).toBe('FIELD_BUILD_TENANTS_REQUIRED');
    expect(code(() => parseArmInput({ ...ok, tenantIds: Array.from({ length: 51 }, (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`) }))).toBe(
      'FIELD_BUILD_TENANTS_INVALID',
    );
  });

  it('screens are a non-empty id list or the exact word `all`', () => {
    expect(code(() => parseArmInput({ ...ok, screens: [] }))).toBe('FIELD_BUILD_SCREENS_REQUIRED');
    expect(code(() => parseArmInput({ ...ok, screens: 'ALL' }))).toBe('FIELD_BUILD_SCREENS_INVALID');
    expect(code(() => parseArmInput({ ...ok, screens: ['all'] }))).toBe('FIELD_BUILD_SCREENS_INVALID');
    expect(code(() => parseArmInput({ ...ok, screens: [S1, 'x'] }))).toBe('FIELD_BUILD_SCREENS_INVALID');
  });

  it('the candidate must be shaped like a field build (the registry decides the rest)', () => {
    for (const bad of ['1.1.42', '1.1.42-field.0', 'latest', '', null, '1.1.42-field.1; drop']) {
      expect(code(() => parseArmInput({ ...ok, candidate: bad }))).toBe('FIELD_BUILD_CANDIDATE_INVALID');
    }
  });

  it('a note is bounded text', () => {
    expect(code(() => parseArmInput({ ...ok, note: 'x'.repeat(501) }))).toBe('FIELD_BUILD_NOTE_TOO_LONG');
    expect(code(() => parseArmInput({ ...ok, note: 7 }))).toBe('FIELD_BUILD_NOTE_INVALID');
  });
});

describe('push now — input rules', () => {
  it('named screens only, at most ten; overrideWindow defaults to the dashboard’s false', () => {
    expect(parsePushInput({ screenIds: [S1, S2] })).toEqual({ screenIds: [S1, S2], overrideWindow: false });
    expect(parsePushInput({ screenIds: [S1], overrideWindow: true }).overrideWindow).toBe(true);
    expect(code(() => parsePushInput({ screenIds: [] }))).toBe('FIELD_BUILD_PUSH_SCREENS_REQUIRED');
    expect(code(() => parsePushInput({ screenIds: 'all' }))).toBe('FIELD_BUILD_PUSH_SCREENS_INVALID');
    expect(code(() => parsePushInput({ screenIds: [S1], overrideWindow: 'yes' }))).toBe('FIELD_BUILD_PUSH_OVERRIDE_INVALID');
    const eleven = Array.from({ length: 11 }, (_, i) => `${String(i).padStart(8, '0')}-3333-4333-8333-333333333333`);
    expect(code(() => parsePushInput({ screenIds: eleven }))).toBe('FIELD_BUILD_PUSH_SCREENS_INVALID');
  });
});

describe('window state and the push settle time', () => {
  const now = Date.UTC(2026, 9, 18, 12);
  it('cancelled beats everything; otherwise open until the expiry instant', () => {
    expect(windowState({ cancelledAt: new Date(now - 1), expiresAt: new Date(now + 1_000) }, now)).toBe('cancelled');
    expect(windowState({ cancelledAt: null, expiresAt: new Date(now + 1) }, now)).toBe('active');
    expect(windowState({ cancelledAt: null, expiresAt: new Date(now) }, now)).toBe('expired');
  });
  it('a push waits out one gate cache period (plus slack) after arming', () => {
    expect(PUSH_SETTLE_MS).toBeGreaterThan(GATE_TTL_MS);
    expect(pushReadyAt({ armedAt: new Date(now) })).toBe(now + PUSH_SETTLE_MS);
  });
});

describe('the variables’ window, as the page reports it', () => {
  const now = Date.UTC(2026, 9, 18, 12);
  it('reads the four variables the way the gate does', () => {
    expect(envWindowView({}, now)).toEqual({
      configured: false,
      candidate: null,
      tenantIds: [],
      screens: [],
      expiresAt: null,
      live: false,
    });
    const env = {
      PLAYER_APK_FIELD_CANDIDATE: '1.1.41-field.1',
      PLAYER_APK_FIELD_TENANT_ID: `${T1}, ${T2}, nope`,
      PLAYER_APK_FIELD_SCREEN_IDS: `${S1},all`,
      PLAYER_APK_FIELD_EXPIRES_AT: new Date(now + 3_600_000).toISOString(),
    };
    expect(envWindowView(env, now)).toMatchObject({ configured: true, tenantIds: [T1, T2], screens: 'all', live: true });
    expect(envWindowView({ ...env, PLAYER_APK_FIELD_EXPIRES_AT: new Date(now - 1).toISOString() }, now).live).toBe(false);
    expect(envWindowView({ ...env, PLAYER_APK_FIELD_EXPIRES_AT: new Date(now + 25 * 3_600_000).toISOString() }, now).live).toBe(false);
  });
});

// ─── 2026-10-31 — the owner's fleet push rules, as the panel refuses them ──

describe('overrideMassPushRules — the owner’s explicit override', () => {
  it('absent = false; only a real boolean is accepted', () => {
    expect(parseMassPushOverride({})).toBe(false);
    expect(parseMassPushOverride(undefined)).toBe(false);
    expect(parseMassPushOverride({ overrideMassPushRules: false })).toBe(false);
    expect(parseMassPushOverride({ overrideMassPushRules: true })).toBe(true);
    for (const bad of ['true', 1, null, {}, []]) {
      expect(code(() => parseMassPushOverride({ overrideMassPushRules: bad }))).toBe('FIELD_BUILD_MASS_PUSH_OVERRIDE_INVALID');
    }
  });

  it('is read on its own: the window and push inputs are unchanged by it', () => {
    expect(parsePushInput({ screenIds: [S1], overrideMassPushRules: true })).toEqual({ screenIds: [S1], overrideWindow: false });
    expect(
      parseArmInput({ candidate: '1.1.42-field.1', tenantIds: [T1], screens: [S1], durationMinutes: 60, overrideMassPushRules: true }),
    ).not.toHaveProperty('overrideMassPushRules');
  });
});

describe('the refusals the panel answers with (the web words each code in en / es / zh)', () => {
  it('names screens briefly', () => {
    const s = (name: string | null, id = S1) => ({ id, name });
    expect(listScreenNames([])).toBe('');
    expect(listScreenNames([s('Lobby')])).toBe('Lobby');
    expect(listScreenNames([s('Lobby'), s('Gym')])).toBe('Lobby and Gym');
    expect(listScreenNames([s('Lobby'), s(null, S2), s('Wall')])).toBe('Lobby, 44444444 and Wall');
    expect(listScreenNames([s('A'), s('B'), s('C'), s('D'), s('E')])).toBe('A, B, C and 2 more');
  });

  it('one hardware class: a mix names the classes; unknown hardware names the screens', () => {
    const mixed = evaluateHardwareClasses([
      { id: S1, hardwareModel: 'goodview-ep6n' },
      { id: S2, hardwareModel: 'maxhub-l55vec' },
    ]);
    expect(hardwareClassRefusal('push', mixed)).toEqual({
      status: 422,
      code: 'FIELD_BUILD_MIXED_HARDWARE',
      message: 'These screens are more than one kind of hardware: goodview-ep6n, maxhub-l55vec. Push one kind at a time.',
      extra: { classes: ['goodview-ep6n', 'maxhub-l55vec'], unknownScreens: [] },
    });
    expect(hardwareClassRefusal('window', mixed).message).toMatch(/Arm a window for one kind at a time\.$/);

    const unknown = evaluateHardwareClasses([
      { id: S1, name: 'Lobby', hardwareModel: 'goodview-ep6n' },
      { id: S2, name: 'Gym', hardwareModel: 'generic-android' },
    ]);
    const r = hardwareClassRefusal('push', unknown);
    expect(r).toMatchObject({
      status: 422,
      code: 'FIELD_BUILD_HARDWARE_UNKNOWN',
      extra: { unknownScreens: [{ id: S2, name: 'Gym' }], incomplete: false },
    });
    expect(r.message).toBe(
      'Gym has no known hardware model, so this push cannot be shown to be one kind of hardware. Push one screen at a time.',
    );
    const twoUnknown = evaluateHardwareClasses([
      { id: S1, name: 'A' },
      { id: S2, name: 'B' },
    ]);
    expect(hardwareClassRefusal('window', twoUnknown).message).toMatch(/^A and B have no known hardware model, so this window/);
    const partial = evaluateHardwareClasses([{ id: S1, hardwareModel: 'pi5' }], { incomplete: true });
    expect(hardwareClassRefusal('window', partial).message).toMatch(/too many screens/);
  });

  it('off-hours: a day-time screen is named with its local time (409, it would go later); a missing zone is a 422', () => {
    const night = new Date(Date.UTC(2026, 9, 31, 4, 30)); // Chicago 23:30, Tokyo 13:30
    const outside = offHoursRefusal(
      evaluateOffHours(
        [
          { id: S1, name: 'Lobby', timeZone: 'America/Chicago' },
          { id: S2, name: 'Gym', timeZone: 'Asia/Tokyo' },
        ],
        night,
      ),
    );
    expect(outside).toMatchObject({
      status: 409,
      code: 'FIELD_BUILD_OUTSIDE_OFF_HOURS',
      extra: { offHours: { start: '22:00', end: '06:00' } },
    });
    expect(outside.message).toBe(
      "A push to more than one screen goes out only between 22:00 and 06:00 in each screen's own time zone. " +
        'It is 13:30 at Gym (Asia/Tokyo). Push one screen at a time, or wait.',
    );
    const noZone = offHoursRefusal(
      evaluateOffHours(
        [
          { id: S1, name: 'Lobby', timeZone: null },
          { id: S2, name: 'Gym', timeZone: 'Asia/Tokyo' },
        ],
        night,
      ),
    );
    expect(noZone).toMatchObject({ status: 422, code: 'FIELD_BUILD_TIME_ZONE_UNKNOWN', extra: { screens: [{ id: S1, name: 'Lobby' }] } });
    expect(noZone.message).toBe(
      'Lobby has no time zone, so a push to more than one screen cannot be checked against the off-hours ' +
        '(22:00 and 06:00 local). Set its time zone, or push it on its own.',
    );
    const bothUnknown = evaluateOffHours(
      [
        { id: S1, timeZone: null },
        { id: S2, timeZone: '' },
      ],
      night,
    );
    expect(offHoursRefusal(bothUnknown).message).toMatch(/have no time zone.*Set their time zone, or push them on their own\.$/);
  });

  it('bench: names the screens that are not on the list', () => {
    expect(benchRefusal([{ id: S2, name: 'Gym' }])).toEqual({
      status: 422,
      code: 'FIELD_BUILD_SCREEN_NOT_BENCH',
      message: 'Field builds go only to the bench screens listed in PLAYER_FIELD_BENCH_SCREENS, and Gym is not on that list.',
      extra: { screens: [{ id: S2, name: 'Gym' }] },
    });
    const two = benchRefusal([
      { id: S1, name: 'A' },
      { id: S2, name: 'B' },
    ]);
    expect(two.message).toMatch(/A and B are not on that list\.$/);
  });
});
