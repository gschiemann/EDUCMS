/**
 * scheduled-at — the client-boundary kickoff conversion (Inputs-wave
 * SCHED). Pins the timezone contract: a zone-less datetime-local value is
 * interpreted in the BROWSER's zone (the operator's venue) and shipped as
 * a full ISO string with timezone, so the server (UTC on Railway) can
 * never re-interpret "7:00 PM" as 7pm UTC.
 */
import {
  datetimeLocalToIso,
  autoPushMoment,
  DEFAULT_AUTO_PUSH_LEAD_MS,
} from '../scheduled-at';

describe('datetimeLocalToIso', () => {
  it('converts a zone-less datetime-local value using the browser zone', () => {
    const iso = datetimeLocalToIso('2026-08-21T19:00');
    // Same instant `new Date` derives locally — NOT the raw string.
    expect(iso).toBe(new Date('2026-08-21T19:00').toISOString());
    // Always carries an explicit zone (UTC designator) on the wire.
    expect(iso!.endsWith('Z')).toBe(true);
  });

  it('round-trips: the ISO string re-parses to the operator local wall time', () => {
    const iso = datetimeLocalToIso('2026-08-21T19:00')!;
    const back = new Date(iso);
    expect(back.getHours()).toBe(19);
    expect(back.getMinutes()).toBe(0);
  });

  it('passes an already-zoned ISO string through as the same instant', () => {
    expect(datetimeLocalToIso('2026-08-21T19:00:00.000Z')).toBe('2026-08-21T19:00:00.000Z');
  });

  it('maps empty / blank / null / undefined to null (the "no time set" contract)', () => {
    expect(datetimeLocalToIso('')).toBeNull();
    expect(datetimeLocalToIso('   ')).toBeNull();
    expect(datetimeLocalToIso(null)).toBeNull();
    expect(datetimeLocalToIso(undefined)).toBeNull();
  });

  it('maps an unparseable value to null rather than throwing', () => {
    expect(datetimeLocalToIso('not-a-date')).toBeNull();
  });
});

describe('autoPushMoment', () => {
  it('is scheduledAt minus the baked 10-minute lead by default', () => {
    const kickoff = new Date('2026-08-21T19:00:00.000Z');
    const at = autoPushMoment(kickoff.toISOString());
    expect(at!.getTime()).toBe(kickoff.getTime() - DEFAULT_AUTO_PUSH_LEAD_MS);
    expect(DEFAULT_AUTO_PUSH_LEAD_MS).toBe(10 * 60_000);
  });

  it('honors a server-provided lead', () => {
    const kickoff = new Date('2026-08-21T19:00:00.000Z');
    const at = autoPushMoment(kickoff, 5 * 60_000);
    expect(at!.getTime()).toBe(kickoff.getTime() - 5 * 60_000);
  });

  it('returns null for a missing or invalid kickoff', () => {
    expect(autoPushMoment(null)).toBeNull();
    expect(autoPushMoment(undefined)).toBeNull();
    expect(autoPushMoment('nope')).toBeNull();
  });
});
