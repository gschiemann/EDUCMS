/**
 * K12-F16 — the volunteer console role table. The API enforces exactly what
 * these functions return, so the acceptance rows live here as data tests:
 *
 *   "A timer link cannot change scores; a shot-clock link cannot end the
 *    game. Each assigned role completes its duties on a phone."
 *
 * Nothing in a console role can end the game (there is no status capability
 * at all); these tests pin that, and pin the sport filter per sport.
 */
import { findSport, SPORTS } from './sports';
import {
  CONSOLE_CAPABILITIES,
  CONSOLE_ROLES,
  LEGACY_CONSOLE_CAPABILITIES,
  consoleCapabilities,
  consolePenaltyPreset,
  consoleRolesForSport,
  consoleShotClockMaxSec,
  consoleStatRules,
  isConsoleRole,
  sportConsoleCapabilities,
  sportHasQuickScore,
  validateConsoleStats,
} from './sports-console-roles';

const sport = (key: string) => {
  const def = findSport(key);
  if (!def) throw new Error(`no sport ${key}`);
  return def;
};

describe('console roles — the role grants', () => {
  it('knows exactly four roles and refuses anything else', () => {
    expect([...CONSOLE_ROLES]).toEqual(['table', 'scorer', 'timer', 'shot']);
    for (const r of CONSOLE_ROLES) expect(isConsoleRole(r)).toBe(true);
    for (const bad of ['', 'TABLE', 'admin', 'status', null, 3, undefined, 'scorer ']) {
      expect(isConsoleRole(bad)).toBe(false);
    }
  });

  it('no role, in any sport, can change the game status (there is no such capability)', () => {
    expect(CONSOLE_CAPABILITIES as readonly string[]).not.toContain('status');
    for (const def of SPORTS) {
      for (const role of [...CONSOLE_ROLES, null]) {
        const caps = consoleCapabilities(role, def) as string[];
        expect(caps).not.toContain('status');
      }
    }
  });

  it('basketball: timer runs the clock and period but can NEVER change the score', () => {
    const caps = consoleCapabilities('timer', sport('basketball'));
    expect(caps).toEqual(['clock', 'segment', 'timeout']);
    expect(caps).not.toContain('score');
    expect(caps).not.toContain('stats');
  });

  it('basketball: shot-clock operator gets the shot clock only — no score, no game clock, no period', () => {
    expect(consoleCapabilities('shot', sport('basketball'))).toEqual(['shotClock']);
  });

  it('basketball: scorer gets points, timeouts, cues, team stats and the possession arrow — not the clocks', () => {
    expect(consoleCapabilities('scorer', sport('basketball'))).toEqual([
      'score',
      'timeout',
      'cue',
      'stats',
      'possession',
    ]);
  });

  it('basketball: table gets every capability the sport has', () => {
    expect(consoleCapabilities('table', sport('basketball'))).toEqual([
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

  it('football: the shot role is the PLAY clock (no shot clock in football)', () => {
    expect(consoleCapabilities('shot', sport('football'))).toEqual(['playClock']);
    expect(consoleCapabilities('table', sport('football'))).toContain('playClock');
    expect(consoleCapabilities('table', sport('football'))).not.toContain('shotClock');
  });

  it('hockey / lacrosse / field hockey / water polo: the scorer runs the penalty box', () => {
    for (const key of ['hockey', 'lacrosse', 'field_hockey', 'water_polo']) {
      expect(consoleCapabilities('scorer', sport(key))).toContain('penalties');
      expect(consoleCapabilities('timer', sport(key))).not.toContain('penalties');
    }
  });

  it('clockless sports: no timer role exists, so the scorer owns the inning / set counter', () => {
    for (const key of ['baseball', 'softball', 'volleyball', 'pickleball']) {
      const def = sport(key);
      expect(consoleRolesForSport(def)).not.toContain('timer');
      expect(consoleCapabilities('scorer', def)).toContain('segment');
      expect(consoleCapabilities('scorer', def)).not.toContain('clock');
    }
    // …but in a clocked sport the scorer never gets the period.
    expect(consoleCapabilities('scorer', sport('basketball'))).not.toContain('segment');
  });

  it('volleyball has no timeouts stat, so no role gets /timeout (the server would refuse it)', () => {
    for (const role of CONSOLE_ROLES) {
      expect(consoleCapabilities(role, sport('volleyball'))).not.toContain('timeout');
    }
  });

  it('legacy (pre-role) links keep exactly their original allowlist — never widened', () => {
    const caps = consoleCapabilities(null, sport('basketball'));
    expect(caps).toEqual(['score', 'clock', 'segment', 'timeout', 'cue']);
    for (const c of caps) expect(LEGACY_CONSOLE_CAPABILITIES).toContain(c);
    expect(caps).not.toContain('stats');
    expect(caps).not.toContain('shotClock');
  });

  it('judged sports store a SCALED total, so no volunteer link gets +N taps (a +1 would add 0.001)', () => {
    for (const key of ['gymnastics', 'competitive_cheer', 'diving']) {
      const def = sport(key);
      expect(def.scoreDecimals).toBeGreaterThan(0);
      expect(sportHasQuickScore(def)).toBe(false);
      for (const role of [...CONSOLE_ROLES, null]) {
        expect(consoleCapabilities(role, def)).not.toContain('score');
      }
    }
    expect(sportHasQuickScore(sport('basketball'))).toBe(true);
    expect(sportHasQuickScore(undefined)).toBe(false);
  });

  it('roles offered per sport follow the clocks the sport has', () => {
    expect(consoleRolesForSport(sport('basketball'))).toEqual(['table', 'scorer', 'timer', 'shot']);
    expect(consoleRolesForSport(sport('football'))).toEqual(['table', 'scorer', 'timer', 'shot']);
    expect(consoleRolesForSport(sport('soccer'))).toEqual(['table', 'scorer', 'timer']);
    expect(consoleRolesForSport(sport('volleyball'))).toEqual(['table', 'scorer']);
    expect(consoleRolesForSport(undefined)).toEqual([]);
  });

  it('every sport in the catalogue gets at least one capability for table and scorer', () => {
    for (const def of SPORTS) {
      expect(consoleCapabilities('table', def).length).toBeGreaterThan(0);
      expect(sportConsoleCapabilities(def).has('segment')).toBe(true);
    }
  });
});

describe('console stats — what a volunteer may write', () => {
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
});
