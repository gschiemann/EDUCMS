/**
 * lane-pad — pure logic unit tests (task #271, 2026-07-01 launch sprint).
 * Covers mark parsing, place computation, DQ/SCR exclusion, roster
 * auto-fill, and the heat-advance snapshot shape against `sanitizeResults`
 * (the real API gate every stats.results write passes through).
 */
import { sanitizeResults } from '@cms/api-types';
import {
  DEFAULT_LANE_COUNT,
  MAX_LANE_COUNT,
  applyRosterToLanes,
  buildHeatResult,
  computePlaces,
  formatLaneEventLabel,
  laneRowMark,
  makeLaneRows,
  mergeHeatResult,
  parseMarkSeconds,
  resultToLaneRows,
  rosterByLane,
  type LaneRow,
} from '../lane-pad';

describe('makeLaneRows', () => {
  it('defaults to 8 lanes, numbered 1..8, all blank', () => {
    const rows = makeLaneRows();
    expect(rows).toHaveLength(DEFAULT_LANE_COUNT);
    expect(rows.map((r) => r.lane)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows.every((r) => r.name === '' && r.mark === '')).toBe(true);
  });

  it('clamps to [1, 12]', () => {
    expect(makeLaneRows(0)).toHaveLength(1);
    expect(makeLaneRows(-5)).toHaveLength(1);
    expect(makeLaneRows(999)).toHaveLength(MAX_LANE_COUNT);
  });

  it('supports 6- and 10-lane pools', () => {
    expect(makeLaneRows(6)).toHaveLength(6);
    expect(makeLaneRows(10)).toHaveLength(10);
  });
});

describe('parseMarkSeconds', () => {
  it('parses plain seconds ("11.42")', () => {
    expect(parseMarkSeconds('11.42')).toBeCloseTo(11.42, 5);
  });

  it('parses MM:SS.hh ("1:52.31")', () => {
    expect(parseMarkSeconds('1:52.31')).toBeCloseTo(112.31, 5);
  });

  it('parses HH:MM:SS.hh ("1:05:12.00")', () => {
    expect(parseMarkSeconds('1:05:12.00')).toBeCloseTo(3912, 5);
  });

  it('parses plain integer seconds ("112")', () => {
    expect(parseMarkSeconds('112')).toBe(112);
  });

  it('returns null for blank', () => {
    expect(parseMarkSeconds('')).toBeNull();
    expect(parseMarkSeconds('   ')).toBeNull();
  });

  it('returns null for DQ/SCR/NT text', () => {
    expect(parseMarkSeconds('DQ')).toBeNull();
    expect(parseMarkSeconds('SCR')).toBeNull();
    expect(parseMarkSeconds('NT')).toBeNull();
  });

  it('returns null for a field-event distance ("142-06") or golf mark ("72 (+1)")', () => {
    expect(parseMarkSeconds('142-06')).toBeNull();
    expect(parseMarkSeconds('72 (+1)')).toBeNull();
  });

  it('returns null for garbage with too many colon segments', () => {
    expect(parseMarkSeconds('1:2:3:4')).toBeNull();
  });
});

describe('computePlaces', () => {
  const row = (lane: number, mark: string, extra: Partial<LaneRow> = {}): LaneRow => ({
    lane,
    name: `Swimmer ${lane}`,
    mark,
    ...extra,
  });

  it('sorts ascending by parsed time — fastest gets place 1', () => {
    const rows = [row(1, '1:00.00'), row(2, '55.00'), row(3, '58.00')];
    const placed = computePlaces(rows);
    expect(placed.find((r) => r.lane === 2)!.computedPlace).toBe(1); // fastest
    expect(placed.find((r) => r.lane === 3)!.computedPlace).toBe(2);
    expect(placed.find((r) => r.lane === 1)!.computedPlace).toBe(3); // slowest
  });

  it('excludes DQ rows from placing entirely', () => {
    const rows = [row(1, '55.00'), row(2, '', { dq: true }), row(3, '58.00')];
    const placed = computePlaces(rows);
    expect(placed.find((r) => r.lane === 2)!.computedPlace).toBe(0);
    expect(placed.find((r) => r.lane === 1)!.computedPlace).toBe(1);
    expect(placed.find((r) => r.lane === 3)!.computedPlace).toBe(2);
  });

  it('excludes SCR rows from placing entirely', () => {
    const rows = [row(1, '55.00'), row(2, '', { scr: true })];
    const placed = computePlaces(rows);
    expect(placed.find((r) => r.lane === 2)!.computedPlace).toBe(0);
    expect(placed.find((r) => r.lane === 1)!.computedPlace).toBe(1);
  });

  it('unparseable marks and blank lanes get place 0 (not fabricated)', () => {
    const rows = [row(1, '55.00'), row(2, ''), row(3, 'garbage')];
    const placed = computePlaces(rows);
    expect(placed.find((r) => r.lane === 2)!.computedPlace).toBe(0);
    expect(placed.find((r) => r.lane === 3)!.computedPlace).toBe(0);
  });

  it('an operator placeOverride wins over the computed place — auto is default, not a lock', () => {
    const rows = [row(1, '55.00'), row(2, '50.00', { placeOverride: 5 })];
    const placed = computePlaces(rows);
    // Lane 2 is objectively fastest but the operator pinned it to place 5.
    expect(placed.find((r) => r.lane === 2)!.computedPlace).toBe(5);
    // Lane 1 auto-places from the remaining pool (still gets 1, since the
    // override doesn't consume a rank from the pool).
    expect(placed.find((r) => r.lane === 1)!.computedPlace).toBe(1);
  });

  it('ties resolve stably in lane order (Array.sort stability)', () => {
    const rows = [row(1, '55.00'), row(2, '55.00')];
    const placed = computePlaces(rows);
    expect(placed.find((r) => r.lane === 1)!.computedPlace).toBe(1);
    expect(placed.find((r) => r.lane === 2)!.computedPlace).toBe(2);
  });
});

describe('laneRowMark', () => {
  it('DQ chip wins over any typed mark', () => {
    expect(laneRowMark({ lane: 1, name: '', mark: '55.00', dq: true })).toBe('DQ');
  });
  it('SCR chip wins over any typed mark', () => {
    expect(laneRowMark({ lane: 1, name: '', mark: '55.00', scr: true })).toBe('SCR');
  });
  it('otherwise returns the trimmed typed mark', () => {
    expect(laneRowMark({ lane: 1, name: '', mark: '  55.00  ' })).toBe('55.00');
  });
});

describe('formatLaneEventLabel', () => {
  it('matches the CTS feed convention: "EVENT — HEAT N"', () => {
    expect(formatLaneEventLabel('12', '3')).toBe('12 — HEAT 3');
  });
  it('event only when heat is blank (track & field has no heat field)', () => {
    expect(formatLaneEventLabel('100m Dash', '')).toBe('100m Dash');
  });
  it('falls back to "Event" when both are blank', () => {
    expect(formatLaneEventLabel('', '')).toBe('Event');
  });
  it('heat only when event is blank', () => {
    expect(formatLaneEventLabel('', '3')).toBe('HEAT 3');
  });
});

describe('buildHeatResult — the exact stats.results shape written', () => {
  it('produces a MeetResult that passes sanitizeResults unchanged', () => {
    const rows: LaneRow[] = [
      { lane: 1, name: 'A. Smith', team: 'home', mark: '58.00' },
      { lane: 2, name: 'B. Jones', team: 'away', mark: '55.00' },
      { lane: 3, name: '', mark: '' }, // untouched lane — should be dropped
      { lane: 4, name: 'C. DQ', team: 'home', mark: '', dq: true },
    ];
    const result = buildHeatResult('12', '3', rows, 999);
    expect(result.event).toBe('12 — HEAT 3');
    // eventNumber*100 + heat = 1203, but sanitizeResults clamps `order` to
    // [0, 999] server-side — buildHeatResult clamps to the SAME ceiling so
    // what it returns always matches what actually persists (see the
    // function's doc comment for the shared-gap context with the CTS feed).
    expect(result.order).toBe(999);
    expect(result.entries).toHaveLength(3); // lane 3 dropped (no data)

    const laneB = result.entries.find((e) => e.lane === 2)!;
    expect(laneB.place).toBe(1); // fastest
    expect(laneB.mark).toBe('55.00');
    expect(laneB.name).toBe('B. Jones');
    expect(laneB.team).toBe('away');

    const laneA = result.entries.find((e) => e.lane === 1)!;
    expect(laneA.place).toBe(2);

    const laneDQ = result.entries.find((e) => e.lane === 4)!;
    expect(laneDQ.place).toBe(0);
    expect(laneDQ.mark).toBe('DQ');

    // The real API gate — sanitizeResults must accept this shape byte-for-byte
    // (same fields, same types) with nothing dropped or coerced away.
    const sanitized = sanitizeResults([result]);
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].event).toBe(result.event);
    expect(sanitized[0].order).toBe(result.order);
    expect(sanitized[0].entries).toHaveLength(3);
    expect(sanitized[0].entries.find((e) => e.lane === 2)?.mark).toBe('55.00');
  });

  it('drops rows with neither name nor mark nor dq/scr (no fabricated finishers)', () => {
    const rows: LaneRow[] = [
      { lane: 1, name: '', mark: '' },
      { lane: 2, name: '', mark: '' },
    ];
    const result = buildHeatResult('1', '1', rows, 1);
    expect(result.entries).toHaveLength(0);
  });

  it('falls back to orderHint when event/heat are not plain integers', () => {
    const rows: LaneRow[] = [{ lane: 1, name: 'Relay A', mark: '1:40.00' }];
    const result = buildHeatResult('4x100 Free Relay', '', rows, 42);
    expect(result.order).toBe(42);
  });

  it('low event/heat numbers compute the real eventNumber*100+heat value under the cap', () => {
    const rows: LaneRow[] = [{ lane: 1, name: 'A', mark: '55.00' }];
    const result = buildHeatResult('2', '3', rows, 1);
    expect(result.order).toBe(203); // well under the 999 sanitizeResults ceiling
  });

  it('scratched/DQ-only heat still saves (status is data)', () => {
    const rows: LaneRow[] = [{ lane: 1, name: 'A', mark: '', scr: true }];
    const result = buildHeatResult('5', '1', rows, 1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].mark).toBe('SCR');
    const sanitized = sanitizeResults([result]);
    expect(sanitized[0].entries[0].mark).toBe('SCR');
  });
});

describe('mergeHeatResult', () => {
  it('appends a new event/heat', () => {
    const existing = [{ event: 'EVENT 1 — HEAT 1', entries: [] }];
    const fresh = { event: 'EVENT 1 — HEAT 2', entries: [] };
    const merged = mergeHeatResult(existing, fresh);
    expect(merged).toHaveLength(2);
  });

  it('replaces the SAME event label (re-saving a correction)', () => {
    const existing = [{ event: 'EVENT 1 — HEAT 1', entries: [{ place: 1, name: 'A', mark: '10.0' }] }];
    const fresh = { event: 'EVENT 1 — HEAT 1', entries: [{ place: 1, name: 'A', mark: '9.5' }] };
    const merged = mergeHeatResult(existing, fresh);
    expect(merged).toHaveLength(1);
    expect(merged[0].entries[0].mark).toBe('9.5');
  });

  it('caps at 64 entries, oldest dropped first — same ceiling sanitizeResults enforces', () => {
    const existing = Array.from({ length: 64 }, (_, i) => ({ event: `E${i}`, entries: [] }));
    const fresh = { event: 'NEW', entries: [] };
    const merged = mergeHeatResult(existing, fresh);
    expect(merged).toHaveLength(64);
    expect(merged[0].event).toBe('E1'); // E0 dropped
    expect(merged[merged.length - 1].event).toBe('NEW');
  });
});

describe('resultToLaneRows — reopening a saved heat for correction', () => {
  it('round-trips name/team/mark/place back into lane rows', () => {
    const result = {
      event: 'EVENT 1 — HEAT 1',
      entries: [
        { place: 1, name: 'A. Smith', team: 'home' as const, lane: 2, mark: '55.00' },
        { place: 0, name: 'B. Jones', team: 'away' as const, lane: 4, mark: 'DQ' },
      ],
    };
    const rows = resultToLaneRows(result, 6);
    expect(rows).toHaveLength(6);
    const lane2 = rows.find((r) => r.lane === 2)!;
    expect(lane2.name).toBe('A. Smith');
    expect(lane2.mark).toBe('55.00');
    expect(lane2.placeOverride).toBe(1);
    const lane4 = rows.find((r) => r.lane === 4)!;
    expect(lane4.dq).toBe(true);
    expect(lane4.mark).toBe(''); // DQ chip carries the status, not the mark field
    const lane1 = rows.find((r) => r.lane === 1)!;
    expect(lane1.name).toBe('');
  });

  it('returns a blank grid when result is null/undefined', () => {
    expect(resultToLaneRows(null, 8)).toHaveLength(8);
    expect(resultToLaneRows(undefined, 8).every((r) => r.name === '')).toBe(true);
  });
});

describe('rosterByLane / applyRosterToLanes', () => {
  it('joins roster entries by lane number', () => {
    const roster = [
      { name: 'A. Smith', team: 'home' as const, lane: 3 },
      { name: 'B. Jones', team: 'away' as const, lane: '5' as unknown as number }, // string lane, coerced
    ];
    const map = rosterByLane(roster);
    expect(map.get(3)?.name).toBe('A. Smith');
    expect(map.get(5)?.name).toBe('B. Jones');
  });

  it('never joins a roster entry with no lane assigned', () => {
    const roster = [{ name: 'Unassigned', lane: null }];
    const map = rosterByLane(roster);
    expect(map.size).toBe(0);
  });

  it('fills only blank lanes — never clobbers an operator-typed name', () => {
    const rows = makeLaneRows(4);
    rows[0].name = 'Already typed';
    const roster = [
      { name: 'Roster Swimmer 1', lane: 1 },
      { name: 'Roster Swimmer 2', lane: 2 },
    ];
    const filled = applyRosterToLanes(rows, roster);
    expect(filled.find((r) => r.lane === 1)!.name).toBe('Already typed');
    expect(filled.find((r) => r.lane === 2)!.name).toBe('Roster Swimmer 2');
  });

  it('blank when no roster configured — never fabricates a name', () => {
    const rows = makeLaneRows(4);
    const filled = applyRosterToLanes(rows, []);
    expect(filled.every((r) => r.name === '')).toBe(true);
  });
});
