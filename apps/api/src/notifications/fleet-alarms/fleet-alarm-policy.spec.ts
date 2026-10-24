/**
 * Owner fleet alarms — the math (2026-10-23). One test per rule, including the
 * two the incident review asked for by name: "a normal deploy where screens
 * reconnect within 3 minutes → no alert" and "an outage that begins at the
 * restart → alert at +10 minutes".
 */
import {
  FLEET_ALARM_RULES,
  INITIAL_REFUSAL_ALARM_STATE,
  bootAlarmThreshold,
  checkedInSinceBoot,
  deviceCredentialRefusalAlarmDisabled,
  downgradedSinceBoot,
  evaluateBootCheck,
  inBootCohort,
  isContinuousRefusal,
  parseRefusalAlarmState,
  parseRefusalMember,
  postRestartFleetCheckDisabled,
  pushChannelLive,
  refusalBucketOf,
  refusalCategoryOf,
  refusalMember,
  refusalRuns,
  stepRefusalAlarm,
  type BootCohortRow,
  type RefusalAlarmState,
} from './fleet-alarm-policy';

const MIN = 60_000;
const SEC = 1_000;
const BOOT = Date.parse('2026-10-23T05:42:00Z');

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function row(n: number, over: Partial<BootCohortRow> = {}): BootCohortRow {
  return {
    id: uuid(n),
    name: `Screen ${n}`,
    tenantId: `org-${n % 5}`,
    status: 'ONLINE',
    pairedAt: new Date(BOOT - 30 * 24 * 60 * MIN),
    lastPingAt: new Date(BOOT - 40 * SEC),
    playerVersionAt: null,
    managerVersionAt: null,
    authState: 'PROVEN',
    authStateChangedAt: new Date(BOOT - 10 * 24 * 60 * MIN),
    ...over,
  };
}

const noExcuse = () => null;

describe('kill switches', () => {
  it('each alarm has its own; unset or anything but 1/true/yes leaves it on', () => {
    expect(postRestartFleetCheckDisabled({})).toBe(false);
    expect(postRestartFleetCheckDisabled({ POST_RESTART_FLEET_CHECK_DISABLED: '1' })).toBe(true);
    expect(postRestartFleetCheckDisabled({ POST_RESTART_FLEET_CHECK_DISABLED: 'TRUE ' })).toBe(true);
    expect(postRestartFleetCheckDisabled({ POST_RESTART_FLEET_CHECK_DISABLED: '0' })).toBe(false);
    expect(deviceCredentialRefusalAlarmDisabled({})).toBe(false);
    expect(deviceCredentialRefusalAlarmDisabled({ DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED: 'yes' })).toBe(true);
    expect(deviceCredentialRefusalAlarmDisabled({ POST_RESTART_FLEET_CHECK_DISABLED: '1' })).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 1. Post-restart fleet check
// ═════════════════════════════════════════════════════════════════════════

describe('post-restart fleet check — the cohort', () => {
  it('= paired, non-revoked screens whose player checked in during the 15 minutes before the boot', () => {
    expect(inBootCohort(row(1, { lastPingAt: new Date(BOOT - 14 * MIN) }), BOOT)).toBe(true);
    expect(inBootCohort(row(1, { lastPingAt: new Date(BOOT - 16 * MIN) }), BOOT)).toBe(false);
    expect(inBootCohort(row(1, { lastPingAt: null }), BOOT)).toBe(false);
    expect(inBootCohort(row(1, { tenantId: null }), BOOT)).toBe(false);
    expect(inBootCohort(row(1, { status: 'REVOKED' }), BOOT)).toBe(false);
  });
  it('a check-in that landed after the boot (the old container, mid hand-over) still counts as "before"', () => {
    expect(inBootCohort(row(1, { lastPingAt: new Date(BOOT + 70 * SEC) }), BOOT)).toBe(true);
  });
  it('a screen paired after the boot was never expected back', () => {
    expect(inBootCohort(row(1, { pairedAt: new Date(BOOT + MIN), lastPingAt: new Date(BOOT + 2 * MIN) }), BOOT)).toBe(false);
  });
});

describe('post-restart fleet check — back or not', () => {
  it('a check-in inside the 5-minute hand-over does not prove the screen is back', () => {
    expect(checkedInSinceBoot(new Date(BOOT + 90 * SEC), BOOT)).toBe(false);
    expect(checkedInSinceBoot(new Date(BOOT + 4 * MIN + 59 * SEC), BOOT)).toBe(false);
    expect(checkedInSinceBoot(new Date(BOOT + 5 * MIN), BOOT)).toBe(true);
    expect(checkedInSinceBoot(null, BOOT)).toBe(false);
  });
  it('downgraded = re-pair required stamped AFTER the boot (an older one is not this restart’s doing)', () => {
    expect(downgradedSinceBoot({ authState: 'REPAIR_REQUIRED', authStateChangedAt: new Date(BOOT + MIN) }, BOOT)).toBe(true);
    expect(downgradedSinceBoot({ authState: 'REPAIR_REQUIRED', authStateChangedAt: new Date(BOOT - MIN) }, BOOT)).toBe(false);
    expect(downgradedSinceBoot({ authState: 'PROVEN', authStateChangedAt: new Date(BOOT + MIN) }, BOOT)).toBe(false);
  });
});

describe('post-restart fleet check — threshold: ≥ 3, or ≥ 10 % of a small fleet, never a single screen', () => {
  it.each([
    [1_000, 3],
    [34, 3],
    [21, 3],
    [20, 2],
    [10, 2],
    [3, 2],
    [1, 2],
    [0, 2],
  ])('%i screens expected back → %i', (expected, threshold) => {
    expect(bootAlarmThreshold(expected)).toBe(threshold);
  });
});

describe('post-restart fleet check — the verdict', () => {
  /** 34 screens that checked in just before a boot at BOOT. */
  const fleet = () => Array.from({ length: 34 }, (_, i) => row(i + 1));
  const ids = (rows: BootCohortRow[]) => rows.map((r) => r.id);

  it('NORMAL DEPLOY: every screen back within 3 minutes → no alert at +10 or at +20', () => {
    for (const offset of [10 * MIN, 20 * MIN]) {
      const now = BOOT + offset;
      // Each screen reconnected somewhere in the first 3 minutes and has
      // checked in every ~25 s since: its newest check-in is seconds old.
      const rows = fleet().map((r, i) => ({ ...r, lastPingAt: new Date(now - ((i * 7) % 25) * SEC) }));
      const v = evaluateBootCheck({ bootAtMs: BOOT, cohortIds: ids(rows), rows, excuse: noExcuse });
      expect(v).toMatchObject({ cohort: 34, expected: 34, alert: false });
      expect(v.missing).toHaveLength(0);
    }
  });

  it('OUTAGE AT THE RESTART: 14 screens last seen 1–2 min after the boot, then nothing → alert at +10 min', () => {
    const now = BOOT + 10 * MIN;
    const rows = fleet().map((r, i) =>
      i < 14 ? { ...r, lastPingAt: new Date(BOOT + (60 + i * 5) * SEC) } : { ...r, lastPingAt: new Date(now - 10 * SEC) },
    );
    const v = evaluateBootCheck({ bootAtMs: BOOT, cohortIds: ids(rows), rows, excuse: noExcuse });
    expect(v.alert).toBe(true);
    expect(v.missing.map((m) => m.id)).toEqual(ids(rows).slice(0, 14));
    expect(v.threshold).toBe(3);
  });

  it('2 of 34 not back → no alert; 3 → alert', () => {
    const now = BOOT + 10 * MIN;
    const withMissing = (n: number) =>
      fleet().map((r, i) => (i < n ? { ...r, lastPingAt: new Date(BOOT - MIN) } : { ...r, lastPingAt: new Date(now - 5 * SEC) }));
    const two = withMissing(2);
    const three = withMissing(3);
    expect(evaluateBootCheck({ bootAtMs: BOOT, cohortIds: ids(two), rows: two, excuse: noExcuse }).alert).toBe(false);
    expect(evaluateBootCheck({ bootAtMs: BOOT, cohortIds: ids(three), rows: three, excuse: noExcuse }).alert).toBe(true);
  });

  it('a small fleet: 2 of 8 is 25 % → alert; 1 of 8 never', () => {
    const now = BOOT + 10 * MIN;
    const small = (n: number) =>
      Array.from({ length: 8 }, (_, i) => row(i + 1, { lastPingAt: new Date(i < n ? BOOT - MIN : now - 5 * SEC) }));
    expect(evaluateBootCheck({ bootAtMs: BOOT, cohortIds: ids(small(2)), rows: small(2), excuse: noExcuse }).alert).toBe(true);
    expect(evaluateBootCheck({ bootAtMs: BOOT, cohortIds: ids(small(1)), rows: small(1), excuse: noExcuse }).alert).toBe(false);
  });

  it('a screen meant to be off (schedule / power-off / standby) is not missing — and leaves the denominator', () => {
    const now = BOOT + 10 * MIN;
    const rows = fleet().map((r, i) => (i < 4 ? { ...r, lastPingAt: new Date(BOOT - MIN) } : { ...r, lastPingAt: new Date(now - 5 * SEC) }));
    const v = evaluateBootCheck({
      bootAtMs: BOOT,
      cohortIds: ids(rows),
      rows,
      excuse: (r) => (r.id === uuid(1) || r.id === uuid(2) ? 'display-schedule-off' : null),
    });
    expect(v.excused).toEqual({ 'display-schedule-off': 2 });
    expect(v.missing).toHaveLength(2);
    expect(v.expected).toBe(32);
    expect(v.alert).toBe(false);
  });

  it('the excuse is asked only for screens that are NOT back', () => {
    const now = BOOT + 10 * MIN;
    const rows = fleet().map((r) => ({ ...r, lastPingAt: new Date(now - 5 * SEC) }));
    const excuse = jest.fn(() => 'standby');
    evaluateBootCheck({ bootAtMs: BOOT, cohortIds: ids(rows), rows, excuse });
    expect(excuse).not.toHaveBeenCalled();
  });

  it('unpaired / revoked / deleted since the boot are gone, not missing', () => {
    const rows = fleet().slice(0, 6).map((r) => ({ ...r, lastPingAt: new Date(BOOT - MIN) }));
    rows[0] = { ...rows[0], tenantId: null };
    rows[1] = { ...rows[1], status: 'REVOKED' };
    const cohortIds = [...ids(rows), uuid(999)]; // 999 was deleted
    const v = evaluateBootCheck({ bootAtMs: BOOT, cohortIds, rows, excuse: noExcuse });
    expect(v.gone).toBe(3);
    expect(v.missing).toHaveLength(4);
  });

  it('screens that came back on a 1-hour credential ("re-pair required" since the boot) count as not back', () => {
    const now = BOOT + 10 * MIN;
    const rows = fleet().map((r, i) =>
      i < 3
        ? { ...r, lastPingAt: new Date(now - 5 * SEC), authState: 'REPAIR_REQUIRED', authStateChangedAt: new Date(BOOT + 70 * SEC) }
        : { ...r, lastPingAt: new Date(now - 5 * SEC) },
    );
    const v = evaluateBootCheck({ bootAtMs: BOOT, cohortIds: ids(rows), rows, excuse: noExcuse });
    expect(v.downgraded).toHaveLength(3);
    expect(v.missing).toHaveLength(0);
    expect(v.alert).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. Device-credential refusals
// ═════════════════════════════════════════════════════════════════════════

describe('refusal categories — only a credential this API could have issued counts', () => {
  it.each([
    ['jwt_invalid:invalid signature', 'signature'],
    ['jwt_invalid:jwt expired', 'expired'],
    ['credential_epoch_stale', 'superseded'],
  ])('%s → %s', (reason, category) => expect(refusalCategoryOf(reason)).toBe(category));
  it.each([
    'credential_unproven',
    'token_revoked',
    'screen_revoked',
    'screen_unpaired',
    'screen_not_found',
    'revocation_check_unavailable',
    'no_auth',
    'wrong_token_kind',
    'subject_mismatch',
    'subject_missing',
    'jwt_invalid:jwt malformed',
    'jwt_invalid:invalid algorithm',
    'jwt_invalid:jwt signature is required',
  ])('%s → not counted', (reason) => expect(refusalCategoryOf(reason)).toBeNull());
});

describe('refusal members', () => {
  it('round-trip, and refuse anything that is not one of ours', () => {
    const m = { screenId: uuid(7), source: 'ws' as const, category: 'signature' as const };
    expect(parseRefusalMember(refusalMember(m))).toEqual(m);
    expect(parseRefusalMember(`${uuid(7)}|ws|signature|x`)).toBeNull();
    expect(parseRefusalMember(`${uuid(7)}|sse|signature`)).toBeNull();
    expect(parseRefusalMember(`${uuid(7)}|ws|bogus`)).toBeNull();
    expect(parseRefusalMember('bad id!|ws|signature')).toBeNull();
    expect(parseRefusalMember(`${'a'.repeat(65)}|ws|signature`)).toBeNull();
    expect(parseRefusalMember(42)).toBeNull();
  });
});

describe('refusal runs — "refused continuously for 10 minutes"', () => {
  const T = Date.parse('2026-10-23T05:43:10Z');
  /** Buckets for one screen refused at each of these minute offsets from T. */
  function buckets(minutes: number[], screen = uuid(1), category = 'signature') {
    const out = new Map<number, Set<string>>();
    for (const m of minutes) {
      const b = refusalBucketOf(T + m * MIN);
      const set = out.get(b) ?? new Set<string>();
      set.add(`${screen}|ws|${category}`);
      out.set(b, set);
    }
    return out;
  }
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

  it('refused every minute: continuous at +10 min, not at +9', () => {
    const at9 = T + 9 * MIN;
    const at10 = T + 10 * MIN;
    expect(isContinuousRefusal(refusalRuns(buckets(range(0, 9)), at9)[0], at9)).toBe(false);
    const [run] = refusalRuns(buckets(range(0, 10)), at10);
    expect(run).toMatchObject({ screenId: uuid(1), sources: ['ws'], categories: ['signature'] });
    expect(run.sinceMs).toBe(refusalBucketOf(T) * MIN);
    expect(isContinuousRefusal(run, at10)).toBe(true);
  });

  it('one quiet minute is jitter; two is a screen that stopped trying', () => {
    const at = T + 10 * MIN;
    const oneGap = range(0, 10).filter((m) => m !== 4);
    const twoGaps = range(0, 10).filter((m) => m !== 4 && m !== 5);
    expect(isContinuousRefusal(refusalRuns(buckets(oneGap), at)[0], at)).toBe(true);
    const [broken] = refusalRuns(buckets(twoGaps), at);
    expect(broken.sinceMs).toBe(refusalBucketOf(T + 6 * MIN) * MIN);
    expect(isContinuousRefusal(broken, at)).toBe(false);
  });

  it('a run that stopped 2 minutes ago is over', () => {
    const at = T + 12 * MIN;
    expect(isContinuousRefusal(refusalRuns(buckets(range(0, 10)), at)[0], at)).toBe(false);
    // …but the current or previous minute still counts (the newest bucket may be seconds old).
    const at11 = T + 11 * MIN;
    expect(isContinuousRefusal(refusalRuns(buckets(range(0, 10)), at11)[0], at11)).toBe(true);
  });

  it('a run longer than the 15-minute window is cut at its start — still continuous', () => {
    const at = T + 40 * MIN;
    const [run] = refusalRuns(buckets(range(0, 40)), at);
    expect(run.sinceMs).toBe((refusalBucketOf(at) - FLEET_ALARM_RULES.REFUSAL_WINDOW_BUCKETS + 1) * MIN);
    expect(isContinuousRefusal(run, at)).toBe(true);
  });

  it('distinct screens, each with its own run; sources and categories are merged per screen', () => {
    const at = T + 10 * MIN;
    const b = buckets(range(0, 10), uuid(1));
    for (const [k, set] of buckets(range(3, 10), uuid(2))) b.set(k, new Set([...(b.get(k) ?? []), ...set]));
    b.get(refusalBucketOf(T + 10 * MIN))!.add(`${uuid(1)}|register|register`);
    const runs = refusalRuns(b, at);
    expect(runs.map((r) => r.screenId)).toEqual([uuid(1), uuid(2)]);
    expect(runs[0]).toMatchObject({ sources: ['register', 'ws'], categories: ['register', 'signature'] });
    expect(runs.filter((r) => isContinuousRefusal(r, at)).map((r) => r.screenId)).toEqual([uuid(1)]);
  });

  it('garbage members are ignored', () => {
    const b = new Map([[refusalBucketOf(T), new Set(['nope', `${uuid(3)}|ws|signature`])]]);
    expect(refusalRuns(b, T).map((r) => r.screenId)).toEqual([uuid(3)]);
  });
});

describe('a live push channel means the screen is not locked out', () => {
  const NOW = Date.parse('2026-10-23T06:00:00Z');
  it('admitted in the last 3 minutes = live', () => {
    expect(pushChannelLive(new Date(NOW - 2 * MIN), NOW)).toBe(true);
    expect(pushChannelLive(new Date(NOW - 4 * MIN), NOW)).toBe(false);
    expect(pushChannelLive(null, NOW)).toBe(false);
  });
});

describe('the alarm: one email, hourly reminders while it lasts, a recovery note when it stops', () => {
  const T = Date.parse('2026-10-23T05:53:00Z');
  const three = [uuid(1), uuid(2), uuid(3)];
  const run = (state: RefusalAlarmState, ids: string[], at: number) => stepRefusalAlarm(state, ids, T - 10 * MIN, at);

  it('2 screens → nothing; 3 → the alert', () => {
    expect(run(INITIAL_REFUSAL_ALARM_STATE, three.slice(0, 2), T).action).toEqual({ kind: 'none' });
    const { state, action } = run(INITIAL_REFUSAL_ALARM_STATE, three, T);
    expect(action).toEqual({ kind: 'alert', reminder: false });
    expect(state).toMatchObject({ alerting: true, lastAlertAtMs: T, alertedIds: three, incidentSinceMs: T - 10 * MIN });
  });

  it('at most one problem email an hour while it lasts', () => {
    let { state } = run(INITIAL_REFUSAL_ALARM_STATE, three, T);
    for (let m = 1; m < 60; m++) {
      const step = run(state, three, T + m * MIN);
      expect(step.action).toEqual({ kind: 'none' });
      state = step.state;
    }
    const reminder = run(state, [...three, uuid(4)], T + 60 * MIN);
    expect(reminder.action).toEqual({ kind: 'alert', reminder: true });
    expect(reminder.state.alertedIds).toEqual([...three, uuid(4)]);
  });

  it('recovery note once the condition has been clear for 5 minutes — and only then', () => {
    let { state } = run(INITIAL_REFUSAL_ALARM_STATE, three, T);
    for (let m = 1; m <= 4; m++) {
      const step = run(state, [], T + m * MIN);
      expect(step.action).toEqual({ kind: 'none' });
      state = step.state;
    }
    const recovered = run(state, [], T + 6 * MIN);
    expect(recovered.action).toEqual({ kind: 'recovered', alertedIds: three, incidentSinceMs: T - 10 * MIN });
    expect(recovered.state.alerting).toBe(false);
    // Nothing more after it.
    expect(run(recovered.state, [], T + 7 * MIN).action).toEqual({ kind: 'none' });
  });

  it('a flap inside the hold: no recovery note, no second alert', () => {
    let { state } = run(INITIAL_REFUSAL_ALARM_STATE, three, T);
    state = run(state, [], T + MIN).state;
    state = run(state, [], T + 3 * MIN).state;
    const back = run(state, three, T + 4 * MIN);
    expect(back.action).toEqual({ kind: 'none' });
    expect(back.state.clearSinceMs).toBeNull();
    expect(run(back.state, [], T + 8 * MIN).action).toEqual({ kind: 'none' }); // the hold restarted
  });

  it('a new incident inside the hour after the last alert is throttled, then alerted', () => {
    let { state } = run(INITIAL_REFUSAL_ALARM_STATE, three, T);
    state = run(state, [], T + MIN).state;
    state = run(state, [], T + 7 * MIN).state; // recovered
    expect(state.alerting).toBe(false);
    const again = run(state, three, T + 20 * MIN);
    expect(again.action).toEqual({ kind: 'throttled' });
    expect(run(again.state, three, T + 60 * MIN).action).toEqual({ kind: 'alert', reminder: false });
  });

  it('a persisted state that cannot be read is the initial state', () => {
    expect(parseRefusalAlarmState('not json')).toEqual(INITIAL_REFUSAL_ALARM_STATE);
    expect(parseRefusalAlarmState(JSON.stringify({ v: 2 }))).toEqual(INITIAL_REFUSAL_ALARM_STATE);
    const s = { v: 1, alerting: true, lastAlertAtMs: T, incidentSinceMs: null, alertedIds: [uuid(1), 'bad id!'], clearSinceMs: null };
    expect(parseRefusalAlarmState(JSON.stringify(s))).toEqual({ ...s, alertedIds: [uuid(1)] });
  });
});
