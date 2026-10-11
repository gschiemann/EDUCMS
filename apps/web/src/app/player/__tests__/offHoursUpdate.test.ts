/**
 * offHoursUpdate — the window decision, one case per guarantee (2026-10-10).
 *
 * Timezones (incl. both US DST transitions), display-off windows, the idle
 * rule, and every exclusion: emergency / drill, a large download, an
 * operator pause, a sync-locked group, the reload floor, an unprepared
 * shell. Missed windows catch up at the next one and never in the daytime.
 */
import {
  BOUNDARY_WAIT_CAP_MS,
  CONVERGENCE_HOLD_MS,
  NIGHTLY_JITTER_MAX_MS,
  PREPARE_MAX_ATTEMPTS,
  buildUpdateEvidence,
  convergenceHoldUntil,
  decideUpdateApply,
  nightlyJitterMs,
  nightlyWindowOpen,
  parseDisplayWindows,
  parseUpdateAppliedRecord,
  resolveUpdateZone,
  shellReady,
  type UpdateAppliedRecord,
  type UpdateDecisionInput,
} from '../offHoursUpdate';
import { parseSoftWindow } from '../softSchedule';

const CHI = 'America/Chicago';
const chicago = (iso: string) => Date.parse(iso);

const playing = { rendering: true, sig: 'pl:abc', kind: 'playlist', emergency: false };
const idle = { rendering: false, sig: 'idle:playing', kind: 'idle', emergency: false };

/** A playing screen, prepared, with no display schedule, at 03:30 Chicago. */
function base(over: Partial<UpdateDecisionInput> = {}): UpdateDecisionInput {
  return {
    pending: true,
    prepared: true,
    prepareAttempts: 1,
    cacheDrive: 'ready',
    nowMs: chicago('2026-10-11T03:30:00-05:00'),
    lastReloadAtMs: 0,
    minReloadGapMs: 10 * 60_000,
    screenId: 'screen-1',
    zone: { zone: CHI, source: 'device' },
    windows: null,
    softBlank: false,
    emergency: false,
    largeDownload: false,
    paused: false,
    syncActive: false,
    evidence: playing,
    hasItemBoundary: true,
    ...over,
  };
}

describe('nightlyWindowOpen — local wall clock, with jitter', () => {
  it('03:00–04:00 local is open, 02:59 and 04:00 are not', () => {
    expect(nightlyWindowOpen(CHI, chicago('2026-10-11T03:00:00-05:00'), 0)).toBe(true);
    expect(nightlyWindowOpen(CHI, chicago('2026-10-11T03:59:59-05:00'), 0)).toBe(true);
    expect(nightlyWindowOpen(CHI, chicago('2026-10-11T02:59:59-05:00'), 0)).toBe(false);
    expect(nightlyWindowOpen(CHI, chicago('2026-10-11T04:00:00-05:00'), 0)).toBe(false);
    // The same instant read in another zone is daytime there.
    expect(nightlyWindowOpen('Europe/Berlin', chicago('2026-10-11T03:30:00-05:00'), 0)).toBe(false);
  });

  it('a 14:00 local afternoon is never a window — in any zone the fleet runs', () => {
    for (const zone of [CHI, 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'UTC', 'Asia/Shanghai']) {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hour12: false });
      // Scan a whole UTC day in 10-minute steps; every open instant must read 03:xx locally.
      for (let t = Date.UTC(2026, 9, 11); t < Date.UTC(2026, 9, 12); t += 10 * 60_000) {
        if (nightlyWindowOpen(zone, t, 0)) {
          expect(Number(parts.format(new Date(t)))).toBe(3);
        }
      }
    }
  });

  it('the jitter moves the start, never the end', () => {
    const j = 15 * 60_000;
    expect(nightlyWindowOpen(CHI, chicago('2026-10-11T03:10:00-05:00'), j)).toBe(false);
    expect(nightlyWindowOpen(CHI, chicago('2026-10-11T03:15:00-05:00'), j)).toBe(true);
    expect(nightlyWindowOpen(CHI, chicago('2026-10-11T03:59:00-05:00'), j)).toBe(true);
    // A jitter beyond the cap is clamped — the window can never vanish.
    expect(nightlyWindowOpen(CHI, chicago('2026-10-11T03:25:00-05:00'), 59 * 60_000)).toBe(true);
  });

  it('DST spring-forward (2026-03-08, 02:00 → 03:00 CST→CDT): 03:30 CDT is open, 01:30 CST is not', () => {
    // 08:30Z = 03:30 CDT (UTC−5), right after the jump.
    expect(nightlyWindowOpen(CHI, Date.UTC(2026, 2, 8, 8, 30), 0)).toBe(true);
    // 07:30Z = 01:30 CST (UTC−6), before the jump.
    expect(nightlyWindowOpen(CHI, Date.UTC(2026, 2, 8, 7, 30), 0)).toBe(false);
    // 09:00Z = 04:00 CDT — closed again.
    expect(nightlyWindowOpen(CHI, Date.UTC(2026, 2, 8, 9, 0), 0)).toBe(false);
  });

  it('DST fall-back (2026-11-01, 02:00 CDT → 01:00 CST): 03:30 CST is open, 02:30 CST is not', () => {
    // DST ends at 07:00Z. 09:30Z = 03:30 CST (UTC−6).
    expect(nightlyWindowOpen(CHI, Date.UTC(2026, 10, 1, 9, 30), 0)).toBe(true);
    // 08:30Z = 02:30 CST — the repeated early hour, still closed.
    expect(nightlyWindowOpen(CHI, Date.UTC(2026, 10, 1, 8, 30), 0)).toBe(false);
    // 10:00Z = 04:00 CST — closed.
    expect(nightlyWindowOpen(CHI, Date.UTC(2026, 10, 1, 10, 0), 0)).toBe(false);
  });

  it('an unknown zone falls back to UTC (predictable), never to the device', () => {
    expect(nightlyWindowOpen('Mars/Olympus', Date.UTC(2026, 9, 11, 3, 30), 0)).toBe(true);
    expect(nightlyWindowOpen('Mars/Olympus', Date.UTC(2026, 9, 11, 13, 30), 0)).toBe(false);
  });
});

describe('nightlyJitterMs', () => {
  it('is deterministic per screen id and bounded', () => {
    expect(nightlyJitterMs('screen-1')).toBe(nightlyJitterMs('screen-1'));
    expect(nightlyJitterMs('screen-1')).not.toBe(nightlyJitterMs('screen-2'));
    for (const id of ['a', 'screen-1', 'cmf0abc123', '', null, undefined]) {
      const j = nightlyJitterMs(id);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(NIGHTLY_JITTER_MAX_MS);
    }
  });
});

describe('resolveUpdateZone — schedule, then device, then UTC', () => {
  const w = parseSoftWindow({ id: 'w', daysOfWeek: [1, 2], onTime: '07:00', offTime: '22:00', timezone: 'America/New_York' })!;
  it('a schedule row zone wins over the device zone', () => {
    expect(resolveUpdateZone([w], CHI)).toEqual({ zone: 'America/New_York', source: 'schedule' });
  });
  it('no rows → the device zone, flagged as the device’s', () => {
    expect(resolveUpdateZone([], CHI)).toEqual({ zone: CHI, source: 'device' });
    expect(resolveUpdateZone(null, CHI)).toEqual({ zone: CHI, source: 'device' });
  });
  it('no rows and no usable device zone → UTC', () => {
    expect(resolveUpdateZone(null, null)).toEqual({ zone: 'UTC', source: 'utc' });
    expect(resolveUpdateZone(null, '')).toEqual({ zone: 'UTC', source: 'utc' });
    expect(resolveUpdateZone(null, 'Not/AZone')).toEqual({ zone: 'UTC', source: 'utc' });
    expect(resolveUpdateZone(null, 'UTC')).toEqual({ zone: 'UTC', source: 'utc' });
  });
  it('a row whose zone the runtime cannot resolve is skipped, not read as UTC', () => {
    const bad = { ...w, timezone: 'Mars/Olympus' };
    expect(resolveUpdateZone([bad], CHI)).toEqual({ zone: CHI, source: 'device' });
  });
});

describe('parseDisplayWindows — both arrays, absent block is null', () => {
  it('reads hard AND soft rows', () => {
    const rows = parseDisplayWindows({
      schedules: [{ id: 'h', daysOfWeek: [1], onTime: '07:00', offTime: '22:00', timezone: CHI }],
      softSchedules: [{ id: 's', daysOfWeek: [2], onTime: '08:00', offTime: '23:00', timezone: CHI }],
    });
    expect(rows?.map((r) => r.id)).toEqual(['h', 's']);
  });
  it('an absent block is null; a present block with no rows is []', () => {
    expect(parseDisplayWindows(undefined)).toBeNull();
    expect(parseDisplayWindows(null)).toBeNull();
    expect(parseDisplayWindows({ brightness: {} })).toEqual([]);
  });
});

describe('decideUpdateApply', () => {
  it('nothing pending → wait', () => {
    expect(decideUpdateApply(base({ pending: false }))).toEqual({ action: 'wait', reason: 'no-update' });
  });

  it('inside the nightly window, playing a slideshow → apply at the next item boundary', () => {
    expect(decideUpdateApply(base())).toEqual({ action: 'apply', window: 'nightly', boundary: 'item' });
  });

  it('inside the nightly window with a solo item / template → apply now', () => {
    expect(decideUpdateApply(base({ hasItemBoundary: false }))).toEqual({ action: 'apply', window: 'nightly', boundary: 'now' });
  });

  it('daytime playback → outside the window; the screen keeps playing', () => {
    expect(decideUpdateApply(base({ nowMs: chicago('2026-10-11T14:00:00-05:00') }))).toEqual({ action: 'wait', reason: 'outside-window' });
    // Just after the window closes, too — a missed window waits for the next night.
    expect(decideUpdateApply(base({ nowMs: chicago('2026-10-11T04:00:30-05:00') }))).toEqual({ action: 'wait', reason: 'outside-window' });
  });

  it('before this screen’s jitter inside the hour → still waiting', () => {
    const id = 'screen-with-jitter';
    const jitter = nightlyJitterMs(id);
    const start = chicago('2026-10-11T03:00:00-05:00');
    expect(decideUpdateApply(base({ screenId: id, nowMs: start + Math.max(0, jitter - 60_000) })).action).toBe(jitter >= 60_000 ? 'wait' : 'apply');
    expect(decideUpdateApply(base({ screenId: id, nowMs: start + jitter + 1_000 })).action).toBe('apply');
  });

  it('a scheduled display-OFF window applies at once, any hour, even while content "plays" underneath', () => {
    const windows = [parseSoftWindow({ id: 'w', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '07:00', offTime: '22:00', timezone: CHI })!];
    // 23:00 Chicago on a Saturday: outside the ON window → display is OFF.
    expect(decideUpdateApply(base({ windows, nowMs: chicago('2026-10-10T23:00:00-05:00') }))).toEqual({
      action: 'apply', window: 'display-off', boundary: 'now',
    });
    // 14:00: ON → not display-off, and not the nightly window either.
    expect(decideUpdateApply(base({ windows, nowMs: chicago('2026-10-10T14:00:00-05:00') }))).toEqual({ action: 'wait', reason: 'outside-window' });
  });

  it('the soft-blank overlay on the glass applies at once', () => {
    expect(decideUpdateApply(base({ softBlank: true, nowMs: chicago('2026-10-10T14:00:00-05:00') }))).toEqual({
      action: 'apply', window: 'display-off', boundary: 'now',
    });
  });

  it('nothing on the glass applies at once (the existing idle rule)', () => {
    expect(decideUpdateApply(base({ evidence: idle, nowMs: chicago('2026-10-10T14:00:00-05:00') }))).toEqual({
      action: 'apply', window: 'idle', boundary: 'now',
    });
    // …but a download or load in progress is not idle.
    expect(decideUpdateApply(base({ evidence: { ...idle, sig: 'idle:content-downloading' }, nowMs: chicago('2026-10-10T14:00:00-05:00') }))).toEqual({
      action: 'wait', reason: 'outside-window',
    });
  });

  it('an emergency or drill blocks every window — including display-off and idle', () => {
    expect(decideUpdateApply(base({ emergency: true }))).toEqual({ action: 'wait', reason: 'emergency' });
    expect(decideUpdateApply(base({ evidence: { ...playing, sig: 'em:LOCKDOWN', kind: 'emergency', emergency: true } }))).toEqual({ action: 'wait', reason: 'emergency' });
    expect(decideUpdateApply(base({ emergency: true, softBlank: true }))).toEqual({ action: 'wait', reason: 'emergency' });
    expect(decideUpdateApply(base({ emergency: true, evidence: idle }))).toEqual({ action: 'wait', reason: 'emergency' });
  });

  it('a large download in flight blocks', () => {
    expect(decideUpdateApply(base({ largeDownload: true }))).toEqual({ action: 'wait', reason: 'downloading' });
    expect(decideUpdateApply(base({ largeDownload: true, softBlank: true }))).toEqual({ action: 'wait', reason: 'downloading' });
  });

  it('an operator-paused screen blocks (flag, kind, or sig)', () => {
    expect(decideUpdateApply(base({ paused: true }))).toEqual({ action: 'wait', reason: 'paused' });
    expect(decideUpdateApply(base({ evidence: { rendering: false, sig: 'paused:pl1', kind: 'paused', emergency: false } }))).toEqual({ action: 'wait', reason: 'paused' });
  });

  it('a sync-locked group never applies mid-timeline in the nightly window', () => {
    expect(decideUpdateApply(base({ syncActive: true }))).toEqual({ action: 'wait', reason: 'sync-locked' });
    // Display-off is invisible on every screen of the group — allowed.
    expect(decideUpdateApply(base({ syncActive: true, softBlank: true }))).toEqual({ action: 'apply', window: 'display-off', boundary: 'now' });
  });

  it('the reload-loop floor holds', () => {
    const now = chicago('2026-10-11T03:30:00-05:00');
    expect(decideUpdateApply(base({ nowMs: now, lastReloadAtMs: now - 5 * 60_000 }))).toEqual({ action: 'wait', reason: 'reload-floor' });
    expect(decideUpdateApply(base({ nowMs: now, lastReloadAtMs: now - 11 * 60_000 })).action).toBe('apply');
  });

  it('an unprepared shell waits while a worker could still prepare it', () => {
    expect(decideUpdateApply(base({ prepared: false, prepareAttempts: 1, cacheDrive: 'ready' }))).toEqual({ action: 'wait', reason: 'not-prepared' });
    expect(decideUpdateApply(base({ prepared: false, prepareAttempts: 0, cacheDrive: 'unknown' }))).toEqual({ action: 'wait', reason: 'not-prepared' });
    // No worker at all: the reload is network-served, as it always was.
    expect(decideUpdateApply(base({ prepared: false, prepareAttempts: 0, cacheDrive: 'unavailable' })).action).toBe('apply');
    // Preparation that keeps failing stops blocking after the cap.
    expect(decideUpdateApply(base({ prepared: false, prepareAttempts: PREPARE_MAX_ATTEMPTS, cacheDrive: 'ready' })).action).toBe('apply');
  });

  it('shellReady matches those three answers', () => {
    expect(shellReady({ prepared: true, prepareAttempts: 0, cacheDrive: 'ready' })).toBe(true);
    expect(shellReady({ prepared: false, prepareAttempts: 0, cacheDrive: 'unavailable' })).toBe(true);
    expect(shellReady({ prepared: false, prepareAttempts: 2, cacheDrive: 'ready' })).toBe(false);
  });

  it('the boundary wait cap is a bounded constant (a 20-minute clip still updates that night)', () => {
    expect(BOUNDARY_WAIT_CAP_MS).toBeLessThanOrEqual(60 * 60_000);
    expect(BOUNDARY_WAIT_CAP_MS).toBeGreaterThan(0);
  });
});

describe('convergence hold + evidence', () => {
  const record: UpdateAppliedRecord = {
    v: 1, from: 'aaaa', to: 'bbbb', window: 'nightly', boundary: 'item', zone: CHI, zoneSource: 'schedule',
    capture: 'live', navigatedAtMs: 1_000_000, coverAtMs: 1_000_420, contentAtMs: 1_001_900,
  };

  it('the new document still on the old bundle holds for CONVERGENCE_HOLD_MS; a converged one does not', () => {
    expect(convergenceHoldUntil(record, 'aaaa')).toBe(1_000_000 + CONVERGENCE_HOLD_MS);
    expect(convergenceHoldUntil(record, 'bbbb')).toBe(0);
    expect(convergenceHoldUntil(null, 'aaaa')).toBe(0);
    expect(convergenceHoldUntil(record, null)).toBe(0);
  });

  it('parseUpdateAppliedRecord refuses junk', () => {
    expect(parseUpdateAppliedRecord(null)).toBeNull();
    expect(parseUpdateAppliedRecord('nope')).toBeNull();
    expect(parseUpdateAppliedRecord(JSON.stringify({ v: 2 }))).toBeNull();
    expect(parseUpdateAppliedRecord(JSON.stringify({ v: 1 }))).toBeNull();
    expect(parseUpdateAppliedRecord(JSON.stringify(record))).toEqual(record);
  });

  it('buildUpdateEvidence measures the blank and the cover, and says whether the deploy converged', () => {
    expect(buildUpdateEvidence(record, 'bbbb')).toEqual({
      fromBundleId: 'aaaa', toBundleId: 'bbbb', window: 'nightly', boundary: 'item', zone: CHI, zoneSource: 'schedule',
      capture: 'live', blankMs: 420, coverMs: 1480, converged: true,
    });
    expect(buildUpdateEvidence({ ...record, coverAtMs: undefined, contentAtMs: undefined }, 'aaaa')).toMatchObject({
      blankMs: null, coverMs: null, converged: false,
    });
  });
});
