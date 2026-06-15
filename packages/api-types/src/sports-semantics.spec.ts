/**
 * Phase-0 stat-engine contract tests — the stat-math semantics that
 * every later phase of the Player-Stats / Records / Milestone engine
 * depends on. (Locked spec: docs/research/2026-06-15-sports-pro-gap-
 * analysis/01-STATS-ENGINE-SPEC.md, "PHASE 0".)
 *
 * The load-bearing assertion is the COVERAGE check: STAT_SEMANTICS
 * must carry a row for every `PLAYER_STATS[sport][*]` key across all
 * 18 sports. A missing row silently breaks leader computation
 * downstream, so this spec iterates `PLAYER_STATS` itself — when
 * someone adds a new stat key to a sport, this test goes red until a
 * matching semantic is added.
 *
 * 2026-06-15 — co-located with the source per CLAUDE.md "Testing"
 * convention: `*.spec.ts` next to the file under test. The api-types
 * tsconfig excludes `*.spec.ts` from the published build (only the
 * compiled .d.ts / .js ship). Jest is opt-in at the package level.
 */

import {
  PLAYER_STATS,
  STAT_SEMANTICS,
  StatSemantic,
  statSemantic,
  parseStatValue,
  CAREER_THRESHOLDS,
  MILESTONE_DEFS,
  CUE_MILESTONE_CAREER,
  CUE_MILESTONE_RECORD,
} from './sports';

describe('STAT_SEMANTICS coverage', () => {
  it('has exactly one semantic row for every PLAYER_STATS key, all 18 sports', () => {
    const sports = Object.keys(PLAYER_STATS);
    expect(sports.length).toBe(18); // guard: don't silently drop a sport

    for (const sport of sports) {
      const keys = PLAYER_STATS[sport];
      const sems = STAT_SEMANTICS[sport];
      expect(sems).toBeDefined();

      const semKeys = sems.map((s) => s.key);
      for (const key of keys) {
        const matches = sems.filter((s) => s.key === key);
        expect(matches.length).toBe(1); // present, and exactly once
      }
      // No extra rows for keys that don't exist in PLAYER_STATS.
      for (const sk of semKeys) {
        expect(keys).toContain(sk);
      }
    }
  });

  it('every semantic row is well-formed', () => {
    for (const [sport, sems] of Object.entries(STAT_SEMANTICS)) {
      for (const s of sems) {
        expect(typeof s.key).toBe('string');
        expect(s.key.length).toBeGreaterThan(0);
        expect(['counting', 'rate']).toContain(s.kind);
        expect(typeof s.higherBetter).toBe('boolean');
        if (s.decimals !== undefined) {
          expect(Number.isInteger(s.decimals)).toBe(true);
          expect(s.decimals).toBeGreaterThanOrEqual(0);
        }
        if (s.timeMark !== undefined) {
          expect(typeof s.timeMark).toBe('boolean');
          // A time mark is always lower-is-better.
          if (s.timeMark) expect(s.higherBetter).toBe(false);
        }
        // statSemantic() helper agrees with the table.
        expect(statSemantic(sport, s.key)).toEqual(s);
      }
    }
  });

  it('classifies counting vs rate sensibly for marquee stats', () => {
    const get = (sport: string, key: string): StatSemantic => {
      const s = statSemantic(sport, key);
      expect(s).toBeDefined();
      return s as StatSemantic;
    };

    // Counting stats that sum across games.
    expect(get('basketball', 'PTS').kind).toBe('counting');
    expect(get('soccer', 'G').kind).toBe('counting');
    expect(get('football', 'YDS').kind).toBe('counting');
    expect(get('volleyball', 'K').kind).toBe('counting');

    // Rate stats that must be recomputed, never summed.
    expect(get('baseball', 'AVG').kind).toBe('rate');
    expect(get('softball', 'AVG').kind).toBe('rate');
    expect(get('gymnastics', 'PTS').kind).toBe('rate');
  });

  it('higherBetter is true for normal counting stats', () => {
    for (const key of ['PTS', 'REB', 'AST', 'STL', 'BLK']) {
      expect(statSemantic('basketball', key)!.higherBetter).toBe(true);
    }
    expect(statSemantic('soccer', 'G')!.higherBetter).toBe(true);
    expect(statSemantic('football', 'TD')!.higherBetter).toBe(true);
  });

  it('higherBetter is false for golf strokes, race time, place, losses, penalties', () => {
    expect(statSemantic('golf', 'STR')!.higherBetter).toBe(false); // strokes
    expect(statSemantic('golf', 'PAR')!.higherBetter).toBe(false);
    expect(statSemantic('cross_country', 'TIME')!.higherBetter).toBe(false);
    expect(statSemantic('swimming_diving', 'MK')!.higherBetter).toBe(false);
    expect(statSemantic('track_and_field', 'PL')!.higherBetter).toBe(false); // place
    expect(statSemantic('wrestling', 'L')!.higherBetter).toBe(false); // losses
    expect(statSemantic('pickleball', 'L')!.higherBetter).toBe(false);
    expect(statSemantic('hockey', 'PIM')!.higherBetter).toBe(false); // penalty min
    expect(statSemantic('water_polo', 'EXC')!.higherBetter).toBe(false); // exclusions
  });

  it('time-mark stats are flagged for centisecond parsing', () => {
    expect(statSemantic('cross_country', 'TIME')!.timeMark).toBe(true);
    expect(statSemantic('swimming_diving', 'MK')!.timeMark).toBe(true);
  });
});

describe('parseStatValue', () => {
  const timeSem: StatSemantic = {
    key: 'TIME',
    kind: 'rate',
    higherBetter: false,
    timeMark: true,
  };

  it('parses plain integers', () => {
    expect(parseStatValue('19')).toBe(19);
    expect(parseStatValue('0')).toBe(0);
    expect(parseStatValue('1250')).toBe(1250);
  });

  it('parses decimals including leading-dot', () => {
    expect(parseStatValue('.312')).toBeCloseTo(0.312, 6);
    expect(parseStatValue('9.85')).toBeCloseTo(9.85, 6);
    expect(parseStatValue('0.0')).toBe(0);
  });

  it('parses signed / over-par values', () => {
    expect(parseStatValue('-3')).toBe(-3);
    expect(parseStatValue('+2')).toBe(2);
  });

  it('parses thousands separators', () => {
    expect(parseStatValue('1,250')).toBe(1250);
  });

  it('passes through finite numbers', () => {
    expect(parseStatValue(19)).toBe(19);
    expect(parseStatValue(0.312)).toBeCloseTo(0.312, 6);
    expect(parseStatValue(Number.NaN)).toBeNull();
    expect(parseStatValue(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('parses time marks to centiseconds when sem.timeMark', () => {
    expect(parseStatValue('1:52.31', timeSem)).toBe(11231);
    expect(parseStatValue(':45.2', timeSem)).toBe(4520);
    expect(parseStatValue('18:42', timeSem)).toBe(112200);
    expect(parseStatValue('52.31', timeSem)).toBe(5231);
  });

  it('refuses a colon-shaped value outside a time-mark context', () => {
    expect(parseStatValue('1:52.31')).toBeNull();
  });

  it('returns null for non-scalar / unparseable strings', () => {
    expect(parseStatValue('142-06')).toBeNull(); // field mark (feet-inches)
    expect(parseStatValue('5-10')).toBeNull(); // pair
    expect(parseStatValue('DNP')).toBeNull();
    expect(parseStatValue('DNF')).toBeNull();
    expect(parseStatValue('DQ')).toBeNull();
    expect(parseStatValue('—')).toBeNull(); // em dash
    expect(parseStatValue('-')).toBeNull();
    expect(parseStatValue('')).toBeNull();
    expect(parseStatValue('   ')).toBeNull();
    expect(parseStatValue('12pts')).toBeNull();
  });

  it('returns null for malformed time marks', () => {
    expect(parseStatValue('1:99.0', timeSem)).toBeNull(); // 99 seconds
    expect(parseStatValue('a:bb', timeSem)).toBeNull();
    expect(parseStatValue('', timeSem)).toBeNull();
  });

  it('never throws on hostile input', () => {
    const hostile: Array<string | number> = [
      '', '   ', 'NaN', 'Infinity', '1.2.3', '--5', '++1', ':::',
      '999999999999999', '-', '—', 'DNP', '0x10', '1e9',
    ];
    for (const h of hostile) {
      expect(() => parseStatValue(h)).not.toThrow();
      expect(() => parseStatValue(h, timeSem)).not.toThrow();
    }
  });
});

describe('CAREER_THRESHOLDS', () => {
  it('basketball PTS has the canonical career ladder', () => {
    expect(CAREER_THRESHOLDS.basketball.PTS).toEqual([
      500, 1000, 1500, 2000, 2500, 3000,
    ]);
  });

  it('every threshold list is ascending positive counting marks', () => {
    for (const [sport, byStat] of Object.entries(CAREER_THRESHOLDS)) {
      for (const [statKey, marks] of Object.entries(byStat)) {
        // The stat must be a known PLAYER_STATS key for the sport.
        expect(PLAYER_STATS[sport]).toContain(statKey);
        // Only counting stats earn career thresholds.
        const sem = statSemantic(sport, statKey);
        expect(sem?.kind).toBe('counting');
        // Ascending, positive.
        for (let i = 0; i < marks.length; i++) {
          expect(marks[i]).toBeGreaterThan(0);
          if (i > 0) expect(marks[i]).toBeGreaterThan(marks[i - 1]);
        }
      }
    }
  });
});

describe('MILESTONE_DEFS', () => {
  it('emits a THRESHOLD row per career mark + a RECORD row per marquee stat', () => {
    let expectedThresholds = 0;
    let expectedRecords = 0;
    for (const byStat of Object.values(CAREER_THRESHOLDS)) {
      for (const marks of Object.values(byStat)) {
        expectedThresholds += marks.length;
        expectedRecords += 1;
      }
    }
    const thresholds = MILESTONE_DEFS.filter((d) => d.kind === 'THRESHOLD');
    const records = MILESTONE_DEFS.filter((d) => d.kind === 'RECORD');
    expect(thresholds.length).toBe(expectedThresholds);
    expect(records.length).toBe(expectedRecords);
  });

  it('routes record vs career cues correctly', () => {
    for (const d of MILESTONE_DEFS) {
      expect(typeof d.label).toBe('string');
      expect(d.label.length).toBeGreaterThan(0);
      expect(PLAYER_STATS[d.sport]).toContain(d.statKey);
      if (d.kind === 'RECORD') {
        expect(d.cueKey).toBe(CUE_MILESTONE_RECORD);
        expect(d.threshold).toBeUndefined();
      } else if (d.kind === 'THRESHOLD') {
        expect(d.cueKey).toBe(CUE_MILESTONE_CAREER);
        expect(typeof d.threshold).toBe('number');
        expect(d.threshold!).toBeGreaterThan(0);
      }
    }
  });
});
