/**
 * SwimTimingFeed normalizer tests — pure functions, no Prisma/NestJS.
 * docs/research/2026-06-30-swim-dive-scoreboards/00-REPORT.md part A7.
 *
 * These prove the CTS-decoded-snapshot → MeetResult/ResultEntry mapping
 * is correct in isolation, independent of the service-layer auth/DB
 * plumbing (covered separately in sports.service.spec.ts's
 * ingestSwimTimingSnapshot block).
 */
import type { SwimTimingSnapshot } from '@cms/scoreboard-cts';
import {
  formatSwimEventLabel,
  laneMark,
  normalizeSwimSnapshot,
  mergeSwimResult,
  extractSwimTeamScore,
  type SwimRosterEntry,
} from './swim-timing-feed';

function emptySnapshot(): SwimTimingSnapshot {
  return { lanes: {}, splits: {}, eventHeat: null, teamScore: null, receivedAt: 0 };
}

describe('formatSwimEventLabel', () => {
  it('formats event + heat', () => {
    expect(formatSwimEventLabel(12, 3)).toBe('EVENT 12 — HEAT 3');
  });

  it('omits the heat suffix when heat is 0 (not yet reported)', () => {
    expect(formatSwimEventLabel(12, 0)).toBe('EVENT 12');
  });

  it('falls back to a bare "EVENT" label when the event number is 0', () => {
    expect(formatSwimEventLabel(0, 0)).toBe('EVENT');
  });
});

describe('laneMark', () => {
  it('returns the display time when the lane has one', () => {
    expect(laneMark({ display: '52.18', blank: false }, false)).toBe('52.18');
    expect(laneMark({ display: '52.18', blank: false }, true)).toBe('52.18');
  });

  it('returns DQ for a blank lane once the heat is over', () => {
    expect(laneMark({ display: '', blank: true }, true)).toBe('DQ');
  });

  it('returns blank (not DQ) for a blank lane mid-race — never invents a DQ early', () => {
    expect(laneMark({ display: '', blank: true }, false)).toBe('');
  });

  it('returns blank for a lane with no time and not blank (still racing, timer just hasn\'t posted yet)', () => {
    expect(laneMark({ display: '', blank: false }, false)).toBe('');
  });
});

describe('normalizeSwimSnapshot', () => {
  it('produces an empty-entries MeetResult when there is no lane data', () => {
    const result = normalizeSwimSnapshot(emptySnapshot());
    expect(result.event).toBe('EVENT');
    expect(result.entries).toEqual([]);
  });

  it('renders lane + time only when no roster is supplied (never fabricates a name)', () => {
    const snapshot: SwimTimingSnapshot = {
      ...emptySnapshot(),
      eventHeat: { eventNumber: 12, heat: 3 },
      lanes: {
        3: { lane: 3, place: 1, minutes: 0, seconds: 51, hundredths: 90, display: '51.90', blank: false },
        4: { lane: 4, place: 2, minutes: 0, seconds: 52, hundredths: 18, display: '52.18', blank: false },
      },
    };
    const result = normalizeSwimSnapshot(snapshot);
    expect(result.event).toBe('EVENT 12 — HEAT 3');
    expect(result.order).toBe(1203);
    expect(result.entries).toEqual([
      { place: 1, name: '', mark: '51.90', lane: 3 },
      { place: 2, name: '', mark: '52.18', lane: 4 },
    ]);
  });

  it('joins roster names/teams onto the matching lane', () => {
    const snapshot: SwimTimingSnapshot = {
      ...emptySnapshot(),
      eventHeat: { eventNumber: 12, heat: 3 },
      lanes: {
        3: { lane: 3, place: 1, minutes: 0, seconds: 51, hundredths: 90, display: '51.90', blank: false },
      },
    };
    const roster: SwimRosterEntry[] = [{ name: 'D. Okafor', team: 'home', lane: 3 }];
    const result = normalizeSwimSnapshot(snapshot, roster);
    expect(result.entries[0]).toEqual({ place: 1, name: 'D. Okafor', mark: '51.90', lane: 3, team: 'home' });
  });

  it('does not join a roster entry onto a lane it was not assigned to', () => {
    const snapshot: SwimTimingSnapshot = {
      ...emptySnapshot(),
      lanes: {
        5: { lane: 5, place: 0, minutes: 0, seconds: 53, hundredths: 61, display: '53.61', blank: false },
      },
    };
    const roster: SwimRosterEntry[] = [{ name: 'T. Nguyen', team: 'away', lane: 3 }];
    const result = normalizeSwimSnapshot(snapshot, roster);
    expect(result.entries[0].name).toBe('');
  });

  it('sorts entries by lane number', () => {
    const snapshot: SwimTimingSnapshot = {
      ...emptySnapshot(),
      lanes: {
        6: { lane: 6, place: 0, minutes: 0, seconds: 54, hundredths: 5, display: '54.05', blank: false },
        1: { lane: 1, place: 0, minutes: 0, seconds: 55, hundredths: 42, display: '55.42', blank: false },
      },
    };
    const result = normalizeSwimSnapshot(snapshot);
    expect(result.entries.map((e) => e.lane)).toEqual([1, 6]);
  });

  it('marks a blank lane as DQ when heatOver is true', () => {
    const snapshot: SwimTimingSnapshot = {
      ...emptySnapshot(),
      lanes: {
        7: { lane: 7, place: 0, minutes: 0, seconds: 0, hundredths: 0, display: '', blank: true },
      },
    };
    const result = normalizeSwimSnapshot(snapshot, [], true);
    expect(result.entries[0].mark).toBe('DQ');
  });

  it('never assigns a "team" field when the roster entry has none', () => {
    const snapshot: SwimTimingSnapshot = {
      ...emptySnapshot(),
      lanes: {
        2: { lane: 2, place: 0, minutes: 0, seconds: 50, hundredths: 0, display: '50.00', blank: false },
      },
    };
    const roster: SwimRosterEntry[] = [{ name: 'Invited Swimmer', lane: 2 }];
    const result = normalizeSwimSnapshot(snapshot, roster);
    expect(result.entries[0]).not.toHaveProperty('team');
  });
});

describe('mergeSwimResult', () => {
  it('appends a new event when none exists yet', () => {
    const fresh = { event: 'EVENT 12 — HEAT 3', order: 1203, entries: [] as any[] };
    const merged = mergeSwimResult([], fresh);
    expect(merged).toEqual([fresh]);
  });

  it('replaces the SAME event/heat in place (live-updating heat)', () => {
    const older = { event: 'EVENT 12 — HEAT 3', order: 1203, entries: [{ place: 0, name: '', mark: '', lane: 1 }] };
    const fresher = { event: 'EVENT 12 — HEAT 3', order: 1203, entries: [{ place: 1, name: '', mark: '55.42', lane: 1 }] };
    const merged = mergeSwimResult([older], fresher);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(fresher);
  });

  it('keeps a DIFFERENT event/heat as a separate row (multi-heat meet tracking)', () => {
    const heat3 = { event: 'EVENT 12 — HEAT 3', order: 1203, entries: [] as any[] };
    const heat4 = { event: 'EVENT 12 — HEAT 4', order: 1204, entries: [] as any[] };
    const merged = mergeSwimResult([heat3], heat4);
    expect(merged.map((e) => e.event)).toEqual(['EVENT 12 — HEAT 3', 'EVENT 12 — HEAT 4']);
  });

  it('caps the array at 64 entries, dropping the oldest', () => {
    const existing = Array.from({ length: 64 }, (_, i) => ({ event: `EVENT ${i}`, order: i, entries: [] as any[] }));
    const fresh = { event: 'EVENT 999', order: 999, entries: [] as any[] };
    const merged = mergeSwimResult(existing, fresh);
    expect(merged).toHaveLength(64);
    expect(merged[0].event).toBe('EVENT 1'); // EVENT 0 dropped
    expect(merged[63].event).toBe('EVENT 999');
  });
});

describe('extractSwimTeamScore', () => {
  it('returns null when the console has not reported a team score', () => {
    expect(extractSwimTeamScore(emptySnapshot())).toBeNull();
  });

  it('extracts the home/away score when present', () => {
    const snapshot: SwimTimingSnapshot = { ...emptySnapshot(), teamScore: { homeScore: 88, awayScore: 76 } };
    expect(extractSwimTeamScore(snapshot)).toEqual({ homeScore: 88, awayScore: 76 });
  });
});
