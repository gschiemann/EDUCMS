import {
  FieldBuildInputError,
  MAX_WINDOW_MINUTES,
  PUSH_SETTLE_MS,
  GATE_TTL_MS,
  envWindowView,
  parseArmInput,
  parsePushInput,
  pushReadyAt,
  windowState,
} from './field-builds.policy';

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
