/**
 * judgeScores sanitize round-trip (Sports Wave S3, P0-3, 2026-07-02/03
 * sports deep-pass audit). `judgeScores` is a first-class STRUCTURED
 * stat (packages/api-types/src/sports.ts) validated by
 * `sanitizeStructuredStat`/`sanitizeJudgeScores` — the SAME gate
 * `apps/api/src/sports/sports.service.ts#updateStats` runs every
 * `PATCH /sports/games/:id/stats` write through server-side. This spec
 * proves the console's diving judge pad writes a shape that survives
 * that gate byte-for-byte (aside from the intentional [0,10] clamp +
 * one-decimal rounding), mirroring how `lane-pad.test.ts` proves
 * `buildHeatResult()`'s output against `sanitizeResults`.
 */
import {
  sanitizeJudgeScores,
  sanitizeStructuredStat,
  STRUCTURED_STAT_KEYS,
  findSport,
} from '@cms/api-types';

describe('sanitizeJudgeScores', () => {
  it('passes a valid 3-judge panel through unchanged', () => {
    expect(sanitizeJudgeScores([7, 7.5, 8])).toEqual([7, 7.5, 8]);
  });

  it('passes a valid 5- and 7-judge panel through unchanged', () => {
    expect(sanitizeJudgeScores([6, 6.5, 7, 7.5, 8])).toEqual([6, 6.5, 7, 7.5, 8]);
    expect(sanitizeJudgeScores([5, 5.5, 6, 6.5, 7, 7.5, 8])).toEqual([5, 5.5, 6, 6.5, 7, 7.5, 8]);
  });

  it('clamps out-of-range scores into [0, 10]', () => {
    expect(sanitizeJudgeScores([-3, 15, 10.2])).toEqual([0, 10, 10]);
  });

  it('rounds to one decimal place (half-point console UI, but the gate only bounds range)', () => {
    expect(sanitizeJudgeScores([7.34, 7.36])).toEqual([7.3, 7.4]);
  });

  it('drops non-numeric / NaN / Infinity entries instead of coercing to 0', () => {
    expect(sanitizeJudgeScores([7, 'x', null, undefined, NaN, Infinity, -Infinity, 8])).toEqual([7, 8]);
  });

  it('returns [] for non-array input (never throws)', () => {
    expect(sanitizeJudgeScores(null)).toEqual([]);
    expect(sanitizeJudgeScores(undefined)).toEqual([]);
    expect(sanitizeJudgeScores('not an array')).toEqual([]);
    expect(sanitizeJudgeScores({ 0: 7, 1: 8 })).toEqual([]);
  });

  it('caps at STRUCTURED_STAT_MAX_ENTRIES (64) — a diving panel is never close, but the bound is shared', () => {
    const huge = Array.from({ length: 100 }, () => 7);
    expect(sanitizeJudgeScores(huge)).toHaveLength(64);
  });

  it('an empty array round-trips to an empty array (clearing the panel for the next dive)', () => {
    expect(sanitizeJudgeScores([])).toEqual([]);
  });
});

describe('judgeScores wired into the shared structured-stat dispatcher', () => {
  it('STRUCTURED_STAT_KEYS declares judgeScores — the updateStats allow-list', () => {
    expect(STRUCTURED_STAT_KEYS).toContain('judgeScores');
  });

  it('sanitizeStructuredStat("judgeScores", …) delegates to sanitizeJudgeScores', () => {
    expect(sanitizeStructuredStat('judgeScores', [7, 7.5, 8, 20, 'bad'])).toEqual([7, 7.5, 8, 10]);
  });

  it('sanitizeStructuredStat still resolves results/playerFouls/playerExclusions unchanged (no regression)', () => {
    expect(sanitizeStructuredStat('results', 'not an array')).toEqual([]);
    expect(sanitizeStructuredStat('playerFouls', [])).toEqual([]);
    expect(sanitizeStructuredStat('playerExclusions', [])).toEqual([]);
  });

  it('an unknown key still returns undefined so the caller skips it', () => {
    expect(sanitizeStructuredStat('somethingElse', [1, 2, 3])).toBeUndefined();
  });
});

describe('DIVING sport definition — judgeScores/judgeCount are declared, first-class', () => {
  const def = findSport('diving');
  if (!def) throw new Error('diving sport definition not found — findSport regressed');

  it('declares a judgePanel default (3-judge NFHS dual-meet default)', () => {
    expect(def.judgePanel).toBeDefined();
    expect(def.judgePanel?.defaultCount).toBe(3);
    expect(def.judgePanel?.options).toEqual([3, 5, 7]);
  });

  it('declares judgeCount as a scalar game-scope stat (persists via the plain allow-list, not STRUCTURED_STAT_KEYS)', () => {
    const field = def.stats.find((s) => s.key === 'judgeCount');
    expect(field).toBeDefined();
    expect(field?.scope).toBe('game');
    expect(field?.type).toBe('number');
    expect(field?.min).toBe(3);
    expect(field?.max).toBe(7);
    expect(STRUCTURED_STAT_KEYS).not.toContain('judgeCount' as any);
  });

  it('does NOT declare judgeScores as a scalar def.stats field — it is structured (array-valued)', () => {
    // judgeScores is a number[], which the scalar allow-list branch in
    // updateStats would silently DROP (it only keeps string/number/
    // boolean) — it must ride the STRUCTURED_STAT_KEYS path instead.
    expect(def.stats.find((s) => s.key === 'judgeScores')).toBeUndefined();
  });
});
