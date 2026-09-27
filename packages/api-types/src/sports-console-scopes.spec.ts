/**
 * K12-F34 + K12-F16 — the scorekeeper-link scope table. The API enforces
 * exactly what these functions return, so the acceptance rows live here as
 * data tests:
 *
 *   "A timer link cannot change scores; a shot-clock link cannot end the
 *    game. Each assigned role completes its duties on a phone."
 *
 * No scope can end the game (there is no status action at all); these tests
 * pin that, pin the frozen `full` (pre-scope) link, and pin the sport filter
 * per sport.
 */
import { findSport, SPORTS } from './sports';
import {
  CONSOLE_ACTIONS,
  CONSOLE_SCOPES,
  CONSOLE_SCOPE_ALLOWS,
  consoleAllows,
  consolePenaltyPreset,
  consolePlayClockResets,
  consoleScopeMintable,
  consoleScopesForSport,
  consoleShotClockMaxSec,
  consoleStatRules,
  isConsoleScope,
  sportConsoleActions,
  sportHasPlayClock,
  sportHasQuickScore,
  validateConsoleStats,
} from './sports-console-scopes';

const sport = (key: string) => {
  const def = findSport(key);
  if (!def) throw new Error(`no sport ${key}`);
  return def;
};

describe('console scopes — the grants', () => {
  it('knows exactly six scopes and refuses anything else', () => {
    expect([...CONSOLE_SCOPES]).toEqual(['full', 'table', 'scorer', 'timer', 'shot', 'presentation']);
    for (const s of CONSOLE_SCOPES) expect(isConsoleScope(s)).toBe(true);
    for (const bad of ['', 'FULL', 'admin', 'status', 'role', null, 3, undefined, 'scorer ']) {
      expect(isConsoleScope(bad)).toBe(false);
    }
  });

  it('no scope, in any sport, can change the game status (there is no such action)', () => {
    expect(CONSOLE_ACTIONS as readonly string[]).not.toContain('status');
    expect(CONSOLE_ACTIONS as readonly string[]).not.toContain('reopen');
    for (const def of SPORTS) {
      for (const scope of CONSOLE_SCOPES) {
        const allows = consoleAllows(scope, def) as string[];
        expect(allows).not.toContain('status');
        expect(allows).not.toContain('reopen');
      }
    }
  });

  it('full (every pre-scope link) keeps EXACTLY its original five — never widened, in any sport', () => {
    expect([...CONSOLE_SCOPE_ALLOWS.full]).toEqual(['score', 'clock', 'segment', 'timeout', 'cue']);
    expect(consoleAllows('full', sport('basketball'))).toEqual(['score', 'clock', 'segment', 'timeout', 'cue']);
    for (const def of SPORTS) {
      for (const a of consoleAllows('full', def)) expect(CONSOLE_SCOPE_ALLOWS.full).toContain(a);
    }
  });

  it('basketball: timer runs the clock and period but can NEVER change the score', () => {
    const allows = consoleAllows('timer', sport('basketball'));
    expect(allows).toEqual(['clock', 'segment', 'timeout']);
    expect(allows).not.toContain('score');
    expect(allows).not.toContain('stats');
  });

  it('basketball: the shot-clock operator gets the shot clock only — no score, no game clock, no period', () => {
    expect(consoleAllows('shot', sport('basketball'))).toEqual(['shotClock']);
  });

  it('basketball: scorer gets points, timeouts, cues, team stats and the possession arrow — not the clocks', () => {
    expect(consoleAllows('scorer', sport('basketball'))).toEqual(['score', 'timeout', 'cue', 'stats', 'possession']);
  });

  it('basketball: table gets every action the sport has', () => {
    expect(consoleAllows('table', sport('basketball'))).toEqual([
      'score',
      'clock',
      'segment',
      'timeout',
      'cue',
      'stats',
      'possession',
      'shotClock',
    ]);
  });

  it('presentation fires celebrations and nothing else', () => {
    for (const def of SPORTS) {
      for (const a of consoleAllows('presentation', def)) expect(a).toBe('cue');
    }
    expect(consoleAllows('presentation', sport('basketball'))).toEqual(['cue']);
  });

  it('football: the shot scope is the PLAY clock (no shot clock in football)', () => {
    expect(sportHasPlayClock(sport('football'))).toBe(true);
    expect(sportHasPlayClock(sport('basketball'))).toBe(false);
    expect(consoleAllows('shot', sport('football'))).toEqual(['playClock']);
    expect(consoleAllows('table', sport('football'))).toContain('playClock');
    expect(consoleAllows('table', sport('football'))).not.toContain('shotClock');
  });

  it('hockey / lacrosse / field hockey / water polo: the scorer runs the penalty box, the timer never does', () => {
    for (const key of ['hockey', 'lacrosse', 'field_hockey', 'water_polo']) {
      expect(consoleAllows('scorer', sport(key))).toContain('penalties');
      expect(consoleAllows('timer', sport(key))).not.toContain('penalties');
      expect(consoleAllows('full', sport(key))).not.toContain('penalties');
    }
  });

  it('clockless sports: no timer scope exists, so the scorer owns the inning / set counter', () => {
    for (const key of ['baseball', 'softball', 'volleyball', 'pickleball']) {
      const def = sport(key);
      expect(consoleScopesForSport(def)).not.toContain('timer');
      expect(consoleAllows('scorer', def)).toContain('segment');
      expect(consoleAllows('scorer', def)).not.toContain('clock');
    }
    // …but in a clocked sport the scorer never gets the period.
    expect(consoleAllows('scorer', sport('basketball'))).not.toContain('segment');
  });

  it('volleyball has no timeouts stat, so no scope gets /timeout (the server would refuse it)', () => {
    for (const scope of CONSOLE_SCOPES) {
      expect(consoleAllows(scope, sport('volleyball'))).not.toContain('timeout');
    }
  });

  it('judged sports store a SCALED total, so no link gets +N taps (a +1 would add 0.001)', () => {
    for (const key of ['gymnastics', 'competitive_cheer', 'diving']) {
      const def = sport(key);
      expect(def.scoreDecimals).toBeGreaterThan(0);
      expect(sportHasQuickScore(def)).toBe(false);
      for (const scope of CONSOLE_SCOPES) {
        expect(consoleAllows(scope, def)).not.toContain('score');
      }
    }
    expect(sportHasQuickScore(sport('basketball'))).toBe(true);
    expect(sportHasQuickScore(undefined)).toBe(false);
  });

  it('scopes offered per sport follow the clocks and celebrations the sport has; full is never offered', () => {
    expect(consoleScopesForSport(sport('basketball'))).toEqual(['table', 'scorer', 'timer', 'shot', 'presentation']);
    expect(consoleScopesForSport(sport('football'))).toEqual(['table', 'scorer', 'timer', 'shot', 'presentation']);
    expect(consoleScopesForSport(sport('soccer'))).toEqual(['table', 'scorer', 'timer', 'presentation']);
    expect(consoleScopesForSport(sport('volleyball'))).toEqual(['table', 'scorer', 'presentation']);
    expect(consoleScopesForSport(undefined)).toEqual([]);
    for (const def of SPORTS) expect(consoleScopesForSport(def)).not.toContain('full');
  });

  it('mintable: full always (the mint default); a scope that could do nothing for the sport never', () => {
    expect(consoleScopeMintable('full', sport('volleyball'))).toBe(true);
    expect(consoleScopeMintable('full', undefined)).toBe(true);
    expect(consoleScopeMintable('timer', sport('basketball'))).toBe(true);
    expect(consoleScopeMintable('shot', sport('football'))).toBe(true);
    expect(consoleScopeMintable('timer', sport('volleyball'))).toBe(false);
    expect(consoleScopeMintable('shot', sport('soccer'))).toBe(false);
    expect(consoleScopeMintable('scorer', undefined)).toBe(false);
  });

  it('every offered scope can do SOMETHING in its sport (no dead links)', () => {
    for (const def of SPORTS) {
      for (const scope of consoleScopesForSport(def)) {
        expect({ sport: def.key, scope, n: consoleAllows(scope, def).length > 0 }).toEqual({
          sport: def.key,
          scope,
          n: true,
        });
      }
      expect(sportConsoleActions(def).has('segment')).toBe(true);
    }
  });

  it('an unknown scope or sport allows nothing', () => {
    expect(consoleAllows('admin' as never, sport('basketball'))).toEqual([]);
    expect(consoleAllows('table', undefined)).toEqual([]);
  });
});

describe('console stats — what a link may write', () => {
  it('number stats carry their declared range; possession is excluded (own route)', () => {
    const rules = consoleStatRules(sport('basketball'));
    expect(rules.map((r) => r.key)).toEqual(['homeFouls', 'awayFouls', 'homeTimeouts', 'awayTimeouts']);
    expect(rules[0]).toMatchObject({ kind: 'int', min: 0, max: 30 });
  });

  it('free-text stats stay operator-only; closed-set text stats are allowed', () => {
    expect(consoleStatRules(sport('wrestling')).map((r) => r.key)).not.toContain('weightClass');
    expect(consoleStatRules(sport('baseball')).map((r) => r.key)).not.toContain('lastPitchType');
    expect(consoleStatRules(sport('cross_country')).map((r) => r.key)).not.toContain('leadRunner');
    expect(consoleStatRules(sport('volleyball')).find((r) => r.key === 'serving')).toMatchObject({
      kind: 'choice',
    });
    expect(consoleStatRules(sport('baseball')).find((r) => r.key === 'half')).toMatchObject({
      kind: 'choice',
    });
  });

  it('accepts an in-range write and returns exactly the validated keys', () => {
    const out = validateConsoleStats(sport('basketball'), { homeFouls: 5, awayTimeouts: 2 });
    expect(out).toEqual({ ok: true, stats: { homeFouls: 5, awayTimeouts: 2 } });
  });

  it('refuses the WHOLE write when one key is outside the policy, and names it', () => {
    expect(validateConsoleStats(sport('basketball'), { homeFouls: 5, celebrationPack: 'v1' })).toEqual({
      ok: false,
      rejected: ['celebrationPack'],
    });
    expect(validateConsoleStats(sport('basketball'), { shotClock: { ms: 1 } })).toEqual({
      ok: false,
      rejected: ['shotClock'],
    });
    expect(validateConsoleStats(sport('basketball'), { possession: 'home' })).toEqual({
      ok: false,
      rejected: ['possession'],
    });
    expect(validateConsoleStats(sport('wrestling'), { weightClass: 'anything at all' })).toEqual({
      ok: false,
      rejected: ['weightClass'],
    });
  });

  it('refuses out-of-range, non-integer and wrong-type values', () => {
    const bb = sport('basketball');
    expect(validateConsoleStats(bb, { homeFouls: 31 })).toEqual({ ok: false, rejected: ['homeFouls'] });
    expect(validateConsoleStats(bb, { homeFouls: -1 })).toEqual({ ok: false, rejected: ['homeFouls'] });
    expect(validateConsoleStats(bb, { homeFouls: 2.5 })).toEqual({ ok: false, rejected: ['homeFouls'] });
    expect(validateConsoleStats(bb, { homeFouls: '5' })).toEqual({ ok: false, rejected: ['homeFouls'] });
    expect(validateConsoleStats(sport('volleyball'), { serving: 'both' })).toEqual({
      ok: false,
      rejected: ['serving'],
    });
  });

  it('refuses empty, non-object and oversized bodies', () => {
    const bb = sport('basketball');
    for (const bad of [null, undefined, [], 'x', 5, {}]) {
      expect(validateConsoleStats(bb, bad)).toEqual({ ok: false, rejected: ['stats'] });
    }
    const big: Record<string, number> = {};
    for (let i = 0; i < 13; i += 1) big[`k${i}`] = 1;
    expect(validateConsoleStats(bb, big)).toEqual({ ok: false, rejected: ['stats'] });
  });

  it('baseball: the third out (one past the declared max) is allowed — it is how the side is retired', () => {
    expect(validateConsoleStats(sport('baseball'), { outs: 3, balls: 0, strikes: 0 })).toEqual({
      ok: true,
      stats: { outs: 3, balls: 0, strikes: 0 },
    });
    expect(validateConsoleStats(sport('baseball'), { outs: 4 })).toEqual({ ok: false, rejected: ['outs'] });
    // The cascade overflow is baseball/softball only.
    expect(validateConsoleStats(sport('basketball'), { outs: 3 })).toEqual({ ok: false, rejected: ['outs'] });
  });

  it('baseball: the half-inning reset (7 keys, the largest real write) passes', () => {
    const out = validateConsoleStats(sport('softball'), {
      half: 'Bot',
      balls: 0,
      strikes: 0,
      outs: 0,
      on1B: 0,
      on2B: 0,
      on3B: 0,
    });
    expect(out.ok).toBe(true);
  });
});

describe('console penalties and clocks', () => {
  it('a penalty must match a preset by label AND length', () => {
    const hockey = sport('hockey');
    expect(consolePenaltyPreset(hockey, 120, 'Minor')).toEqual({ label: 'Minor', sec: 120 });
    expect(consolePenaltyPreset(hockey, 121, 'Minor')).toBeNull();
    expect(consolePenaltyPreset(hockey, 120, 'Major')).toBeNull();
    expect(consolePenaltyPreset(hockey, 120, 'MINOR — go team')).toBeNull();
    expect(consolePenaltyPreset(sport('basketball'), 120, 'Minor')).toBeNull();
  });

  it('shot-clock reset ceiling is the longest option the sport offers', () => {
    expect(consoleShotClockMaxSec(sport('basketball'))).toBe(35);
    expect(consoleShotClockMaxSec(sport('lacrosse'))).toBe(90);
    expect(consoleShotClockMaxSec(sport('soccer'))).toBe(0);
  });

  it('the play clock resets to the sport presets only (football 40 / 25)', () => {
    expect(consolePlayClockResets(sport('football'))).toEqual([40, 25]);
    expect(consolePlayClockResets(sport('basketball'))).toEqual([]);
    expect(consolePlayClockResets(undefined)).toEqual([]);
  });
});
