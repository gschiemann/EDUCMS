/**
 * refreshAckReport — the decision and the schedule for reporting a refresh
 * confirmation immediately. See refreshAckReport.ts (2026-09-28).
 */
import {
  LS_REFRESH_ACK_REPORTED,
  markRefreshAckReported,
  readReportedRefreshAck,
  refreshAckDelayMs,
  refreshAckToReport,
  REFRESH_ACK_RETRY_DELAYS_MS,
} from '../refreshAckReport';

describe('refreshAckToReport', () => {
  it('reports an ack the server has not heard yet', () => {
    expect(refreshAckToReport(1_790_000_000_000, null)).toBe(1_790_000_000_000);
    expect(refreshAckToReport(1_790_000_000_000, 1_780_000_000_000)).toBe(1_790_000_000_000);
  });

  it('says nothing when there is no ack, or this exact value was already reported', () => {
    expect(refreshAckToReport(null, null)).toBeNull();
    expect(refreshAckToReport(null, 5)).toBeNull();
    expect(refreshAckToReport(1_790_000_000_000, 1_790_000_000_000)).toBeNull();
  });

  it('never reports a non-finite value', () => {
    expect(refreshAckToReport(Number.NaN, null)).toBeNull();
    expect(refreshAckToReport(Number.POSITIVE_INFINITY, null)).toBeNull();
  });
});

describe('the retry ladder', () => {
  it('starts after boot has had time to mint a credential, then backs off, then hands over to telemetry', () => {
    expect(refreshAckDelayMs(0)).toBe(1_500);
    expect(refreshAckDelayMs(1)).toBe(4_000);
    expect(refreshAckDelayMs(2)).toBe(10_000);
    expect(refreshAckDelayMs(3)).toBe(30_000);
    expect(refreshAckDelayMs(4)).toBeNull();
    expect(refreshAckDelayMs(-1)).toBeNull();
  });

  it('every step is longer than the server\'s 2 s accept spacing, so a retry is never refused for being too eager', () => {
    for (const d of REFRESH_ACK_RETRY_DELAYS_MS.slice(1)) expect(d).toBeGreaterThan(2_000);
  });
});

describe('the reported-value memory', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips through localStorage', () => {
    expect(readReportedRefreshAck()).toBeNull();
    markRefreshAckReported(1_790_000_000_000);
    expect(window.localStorage.getItem(LS_REFRESH_ACK_REPORTED)).toBe('1790000000000');
    expect(readReportedRefreshAck()).toBe(1_790_000_000_000);
    // …and it is what stops the same value being reported on the next boot.
    expect(refreshAckToReport(1_790_000_000_000, readReportedRefreshAck())).toBeNull();
  });

  it('a corrupt stored value reads as "nothing reported"', () => {
    window.localStorage.setItem(LS_REFRESH_ACK_REPORTED, 'not-a-number');
    expect(readReportedRefreshAck()).toBeNull();
  });
});
