import { evaluateScheduleEligibility, isEligibleNow } from './schedule-eligibility';

const sched = (over: Partial<Parameters<typeof evaluateScheduleEligibility>[0]> = {}) => ({
  startTime: new Date('2020-01-01T00:00:00Z'),
  endTime: null,
  daysOfWeek: null,
  timeStart: null,
  timeEnd: null,
  ...over,
});

describe('evaluateScheduleEligibility', () => {
  it('an always-on schedule (no day/time window) is active', () => {
    expect(evaluateScheduleEligibility(sched(), new Date('2026-09-01T12:00:00Z'))).toBe('active');
  });

  it('before its start date is future', () => {
    const s = sched({ startTime: new Date('2099-01-01T00:00:00Z') });
    expect(evaluateScheduleEligibility(s, new Date('2026-09-01T12:00:00Z'))).toBe('future');
  });

  it('past its end date is expired', () => {
    const s = sched({ endTime: new Date('2020-06-01T00:00:00Z') });
    expect(evaluateScheduleEligibility(s, new Date('2026-09-01T12:00:00Z'))).toBe('expired');
  });

  it('a day-of-week list that excludes today is day-mismatch', () => {
    const monday = new Date('2026-08-31T12:00:00Z'); // a Monday in UTC
    const s = sched({ daysOfWeek: 'sat,sun' });
    expect(evaluateScheduleEligibility(s, monday)).toBe('day-mismatch');
  });

  it('a day-of-week list that includes today is active (no time window)', () => {
    const monday = new Date('2026-08-31T12:00:00Z');
    const s = sched({ daysOfWeek: 'mon,tue,wed,thu,fri' });
    expect(evaluateScheduleEligibility(s, monday)).toBe('active');
  });

  /**
   * THE regression case (Codex audit): an 8–10am template must never read
   * as active at 10pm. The server has no reliable local clock for the
   * screen, so the honest answer is "can't verify" — not a guess in either
   * direction.
   */
  it('an hour-level window is time-unverifiable, at ANY hour — never guessed active or inactive', () => {
    const s = sched({ timeStart: '08:00', timeEnd: '10:00' });
    expect(evaluateScheduleEligibility(s, new Date('2026-09-01T22:00:00Z'))).toBe('time-unverifiable');
    expect(evaluateScheduleEligibility(s, new Date('2026-09-01T09:00:00Z'))).toBe('time-unverifiable');
  });

  it('date range and day-of-week are still checked before falling to time-unverifiable', () => {
    const monday = new Date('2026-08-31T12:00:00Z');
    const s = sched({ daysOfWeek: 'sat,sun', timeStart: '08:00', timeEnd: '10:00' });
    // A real, provable reason (wrong day) beats the "can't tell" state.
    expect(evaluateScheduleEligibility(s, monday)).toBe('day-mismatch');
  });

  it('isEligibleNow is true ONLY for the active state', () => {
    expect(isEligibleNow(sched(), new Date())).toBe(true);
    expect(isEligibleNow(sched({ timeStart: '08:00', timeEnd: '10:00' }), new Date())).toBe(false);
    expect(isEligibleNow(sched({ startTime: new Date('2099-01-01') }), new Date())).toBe(false);
  });
});
