/**
 * K-12 launch lane A3 — the rules-profile catalog and the shared rule helpers
 * (sports-rules.ts). The engine-level probes, one per sport, live in
 * apps/api/src/sports/k12-rules-profiles.spec.ts.
 */
import { createHash } from 'crypto';
import { findSport, SPORT_DEFINITIONS, SPORTS } from './sports';
import {
  RULES_PROFILES,
  RULES_SOURCES,
  applyGameRules,
  classicRulesKey,
  defaultRulesProfile,
  displayTeamFouls,
  findRulesProfile,
  foulsReachBonus,
  gameRulesInfo,
  inningGameCanEnd,
  maxSegment,
  overtimeLabel,
  parseGameRules,
  rulesProfilesForSport,
  segmentLengthMs,
  setWinner,
  snapshotRules,
  sportForGame,
  teamBonus,
  timeoutAllocation,
  timeoutBanks,
  type GameRules,
} from './sports-rules';

/** Rule VALUES only: every `label` (presentation) stripped, keys sorted. */
function canonicalRules(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalRules);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (k === 'label') continue;
      out[k] = canonicalRules((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

function fingerprint(rules: GameRules): string {
  return createHash('sha256').update(JSON.stringify(canonicalRules(rules))).digest('hex').slice(0, 16);
}

/**
 * THE IMMUTABILITY PIN (K12-F01). Every published profile's rule values,
 * fingerprinted. A game stores its snapshot, so an edit here cannot reach a
 * bound game — but it WOULD make two games that name the same profile run
 * different rules, and an edit to a base SPORT_DEFINITIONS value would change
 * every game created before profiles existed. So: never edit a published
 * profile (or a base definition's rule values) — publish a new version and
 * add its line here. Labels are not pinned (they are presentation).
 */
const PUBLISHED: Record<string, string> = {
  'nfhs-basketball@2026-27': 'f30fd8854cb1c6a0',
  'nfhs-football@2025': '20ccb46d2c61ce63',
  'nfhs-baseball@2027': 'e787bdf6d2899220',
  'nfhs-softball@2027': '9e8e9a1f3cb6ab56',
  'nfhs-soccer@2025-26': '43a1eafdf7d1c922',
  'nfhs-soccer-quarters@2025-26': '59b262484b362c61',
  'ohsaa-soccer-jv@2025-26': 'be777c89346d3de7',
  'nfhs-volleyball-varsity@2026-27': '8c2e6ec901aa55bb',
  'uil-volleyball-sub-varsity@2026-27': '8d8f14d307bcb030',
  'uil-volleyball-junior-high@2026-27': '2b3add466bcdf4c0',
  'pickleball-bo1-15@2026-09': '97d5e7db93c53f50',
  'pickleball-bo1-21@2026-09': 'ba1deeb356c44058',
  'pickleball-bo3-15@2026-09': 'a8a3e6f205e35aa8',
  'nfhs-wrestling@2025-26': '86b0cec25dc06884',
  'kshsaa-wrestling-ms@2025-26': 'dfa1795676ac3a1c',
  'nfhs-lacrosse-boys@2027': '200d9b20ce4b72bf',
  'nfhs-lacrosse-boys@2026': 'd08a97e4ea90b2ad',
  'nfhs-lacrosse-girls@2027': '346635daabd59c88',
  'nfhs-ice-hockey@2026-27': 'f03c10d01a649dd8',
  'nfhs-field-hockey@2026': '71cc480d742b2c00',
  'nfhs-water-polo@2026-28': 'f9587bd0cecad057',
  // The classic profiles ARE the base SPORT_DEFINITIONS: these lines pin the
  // rules every game created before profiles runs.
  'classic-football@2026-09': '593c6dd8be0c7e9d',
  'classic-basketball@2026-09': 'b261cdbe0948537f',
  'classic-baseball@2026-09': '8814822b0e2eb587',
  'classic-softball@2026-09': '07993d792e653214',
  'classic-soccer@2026-09': '8182c963cb1832a0',
  'classic-volleyball@2026-09': 'ac5e248cb337b1a4',
  'classic-wrestling@2026-09': 'a27a2c7143ff62a6',
  'classic-hockey@2026-09': '4f16c8e3f5c5f992',
  'classic-lacrosse@2026-09': '6086925accbcde58',
  'classic-field_hockey@2026-09': '0550a750f640c574',
  'classic-water_polo@2026-09': '68f0b29a4f8a7597',
  'classic-pickleball@2026-09': 'dece1981267c44a9',
  'classic-track_and_field@2026-09': '3993a122024bfd28',
  'classic-swimming_diving@2026-09': '85a34a705103f4bb',
  'classic-swimming@2026-09': 'ccd526c808a1a80e',
  'classic-diving@2026-09': 'a7e05a68ba51ed50',
  'classic-cross_country@2026-09': '45bd9c6aebc6bcc8',
  'classic-gymnastics@2026-09': 'd1b96574b1434375',
  'classic-golf@2026-09': '5e1080eec654ba52',
  'classic-competitive_cheer@2026-09': '0fe53455a1775f35',
};

describe('rules-profile catalog', () => {
  it('has unique keys of the form id@version, each naming a real sport', () => {
    const keys = RULES_PROFILES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of RULES_PROFILES) {
      expect(p.key).toBe(`${p.id}@${p.version}`);
      expect(findSport(p.sport)).toBeDefined();
    }
  });

  it('cites only listed sources, and every checked profile cites at least one', () => {
    for (const p of RULES_PROFILES) {
      for (const s of p.sources) expect(RULES_SOURCES[s]).toBeDefined();
      if (p.verification !== 'not-verified') expect(p.sources.length).toBeGreaterThan(0);
      // A partial profile names what is NOT checked — that list is the
      // official scorer's review sheet (G01).
      if (p.verification === 'partial') expect(p.unverified.length).toBeGreaterThan(0);
    }
  });

  it('gives every sport a classic profile and exactly one default for new games', () => {
    for (const def of Object.values(SPORT_DEFINITIONS)) {
      expect(findRulesProfile(classicRulesKey(def.key))).toBeDefined();
    }
    for (const def of SPORTS) {
      const selectable = rulesProfilesForSport(def.key);
      expect(selectable.length).toBeGreaterThan(0);
      expect(selectable.filter((p) => p.isDefault).length).toBeLessThanOrEqual(1);
      expect(defaultRulesProfile(def.key)).toBe(selectable[0]);
    }
    // The deprecated swimming_diving alias is never offered.
    expect(rulesProfilesForSport('swimming_diving')).toEqual([]);
  });

  it('never lets a profile change a value outside a real rule block', () => {
    for (const p of RULES_PROFILES) {
      const snap = snapshotRules(p);
      expect(snap.sport).toBe(p.sport);
      // The snapshot survives a JSON round trip unchanged (it is stored as JSONB).
      expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
      expect(parseGameRules(JSON.parse(JSON.stringify(snap)), p.sport)).not.toBeNull();
    }
  });

  it('pins the rule values of every published profile (publish a new version instead of editing one)', () => {
    const actual = Object.fromEntries(RULES_PROFILES.map((p) => [p.key, fingerprint(snapshotRules(p))]));
    const unpinned = Object.keys(actual).filter((k) => !(k in PUBLISHED));
    const changed = Object.keys(PUBLISHED).filter((k) => k in actual && actual[k] !== PUBLISHED[k]);
    const removed = Object.keys(PUBLISHED).filter((k) => !(k in actual));
    // A NEW profile: add its line to PUBLISHED. A CHANGED one: revert it and
    // publish a new version. A REMOVED one: put it back (old games name it).
    expect({ unpinned, changed, removed }).toEqual({ unpinned: [], changed: [], removed: [] });
  });
});

describe('a game runs its own snapshot (F01)', () => {
  const nfhs = findRulesProfile('nfhs-basketball@2026-27')!;

  it('a game with no snapshot runs the classic base definition', () => {
    expect(sportForGame({ sport: 'basketball' })).toBe(SPORT_DEFINITIONS.basketball);
    expect(sportForGame({ sport: 'basketball', rules: null })).toBe(SPORT_DEFINITIONS.basketball);
    expect(gameRulesInfo({ sport: 'basketball' })).toMatchObject({ key: null, verification: 'not-verified' });
  });

  it('a bound game runs its snapshot, with a stable definition object', () => {
    const game = { sport: 'basketball', rules: snapshotRules(nfhs) };
    const def = sportForGame(game)!;
    expect(def.rulesProfile).toEqual({ key: 'nfhs-basketball@2026-27', label: nfhs.label });
    expect(def.clock.otSegmentMs).toBe(240_000);
    expect(def.teamFouls?.bonusAt).toBe(5);
    expect(sportForGame(game)).toBe(def);
    // A board re-parses the same rules on every poll: same definition object.
    const reparsed = { sport: 'basketball', rules: JSON.parse(JSON.stringify(game.rules)) };
    expect(sportForGame(reparsed)).toBe(def);
    expect(gameRulesInfo(game)).toMatchObject({ key: 'nfhs-basketball@2026-27', verification: 'partial' });
  });

  it('the snapshot, not the catalog, decides — a stored snapshot keeps its values', () => {
    const stored = JSON.parse(JSON.stringify(snapshotRules(nfhs))) as GameRules;
    stored.clock.otSegmentMs = 5 * 60_000; // what an older version of a profile stored
    expect(sportForGame({ sport: 'basketball', rules: stored })!.clock.otSegmentMs).toBe(300_000);
  });

  it('ignores a snapshot of another sport (never runs football rules on a basketball game)', () => {
    const football = snapshotRules(findRulesProfile('nfhs-football@2025')!);
    expect(sportForGame({ sport: 'basketball', rules: football })).toBe(SPORT_DEFINITIONS.basketball);
  });

  it('applyGameRules removes a block the snapshot says the game does not have', () => {
    const boys2026 = snapshotRules(findRulesProfile('nfhs-lacrosse-boys@2026')!);
    expect(applyGameRules(SPORT_DEFINITIONS.lacrosse, boys2026).shotClock).toBeUndefined();
  });
});

describe('shared rule helpers', () => {
  const def = (key: string) => sportForGame({ sport: findRulesProfile(key)!.sport, rules: snapshotRules(findRulesProfile(key)!) })!;

  it('segment lengths: overtime, finite overtime sequences, per-period lengths, per-game picks', () => {
    const bb = def('nfhs-basketball@2026-27');
    expect(segmentLengthMs(bb, {}, 4)).toBe(480_000);
    expect(segmentLengthMs(bb, {}, 5)).toBe(240_000);
    expect(segmentLengthMs(bb, {}, 7)).toBe(240_000);
    const wr = def('nfhs-wrestling@2025-26');
    expect([1, 3, 4, 5, 6, 7].map((n) => segmentLengthMs(wr, {}, n))).toEqual([
      120_000, 120_000, 60_000, 30_000, 30_000, 30_000,
    ]);
    expect(maxSegment(wr)).toBe(7);
    const ms = def('kshsaa-wrestling-ms@2025-26');
    expect([1, 2, 3, 4].map((n) => segmentLengthMs(ms, {}, n))).toEqual([60_000, 90_000, 90_000, 60_000]);
    const wp = def('nfhs-water-polo@2026-28');
    expect(segmentLengthMs(wp, {}, 1)).toBe(420_000);
    expect(segmentLengthMs(wp, { clockSegmentMs: 480_000 }, 1)).toBe(480_000);
    expect(segmentLengthMs(wp, { clockSegmentMs: 123 }, 1)).toBe(420_000);
    expect(segmentLengthMs(def('nfhs-baseball@2027'), {}, 1)).toBe(0);
  });

  it('overtime labels', () => {
    const wr = def('nfhs-wrestling@2025-26');
    expect([3, 4, 5, 6, 7].map((n) => overtimeLabel(wr, n))).toEqual([null, 'SV', 'TB1', 'TB2', 'UTB']);
    const bb = def('nfhs-basketball@2026-27');
    expect([5, 6].map((n) => overtimeLabel(bb, n))).toEqual(['OT', 'OT2']);
  });

  it('the bonus belongs to the team whose OPPONENT has the fouls (F04)', () => {
    const bb = def('nfhs-basketball@2026-27');
    const stats = { homeFouls: 5, awayFouls: 2 };
    expect(teamBonus(bb, 'away', stats)).toBe('BONUS');
    expect(teamBonus(bb, 'home', stats)).toBeNull();
    expect(teamBonus(bb, 'home', { awayFouls: 9 })).toBe('BONUS'); // no double bonus in NFHS
    expect(foulsReachBonus(bb, 4)).toBeNull();
    expect(foulsReachBonus(bb, 5)).toBe('BONUS');
    expect(displayTeamFouls(bb, 7)).toBe(5);
    // A classic game keeps the lamp it always had (7 / 10), now on the right team.
    const classic = SPORT_DEFINITIONS.basketball;
    expect(teamBonus(classic, 'away', { homeFouls: 7 })).toBe('BONUS');
    expect(teamBonus(classic, 'away', { homeFouls: 10 })).toBe('DOUBLE BONUS');
    expect(displayTeamFouls(classic, 7)).toBe(7);
    expect(teamBonus(SPORT_DEFINITIONS.hockey, 'home', { awayFouls: 9 })).toBeNull();
  });

  it('timeout banks: total left, short sub-bank never above it (F03)', () => {
    const bb = def('nfhs-basketball@2026-27');
    expect(timeoutAllocation(bb)).toBe(5);
    expect(timeoutBanks(bb, 'home', { homeTimeouts: 5 })).toEqual({ total: 5, full: 3, short: 2 });
    expect(timeoutBanks(bb, 'home', { homeTimeouts: 4, homeShortTimeouts: 1 })).toEqual({ total: 4, full: 3, short: 1 });
    expect(timeoutBanks(bb, 'home', { homeTimeouts: 1, homeShortTimeouts: 2 })).toEqual({ total: 1, full: 0, short: 1 });
    expect(timeoutBanks(SPORT_DEFINITIONS.basketball, 'home', { homeTimeouts: 3 })).toEqual({ total: 3, full: 3, short: 0 });
  });

  it('baseball: the home team leading in the bottom of the 7th (or later) ends the game — a hint (F20)', () => {
    const base = def('nfhs-baseball@2027');
    const at = (segment: number, half: string, home: number, away: number) =>
      inningGameCanEnd(base, { segment, homeScore: home, awayScore: away, stats: { half } });
    expect(at(7, 'Bottom', 3, 2)).toBe(true); // led after the top: no bottom needed
    expect(at(9, 'Bot', 5, 4)).toBe(true); // walk-off in extras
    expect(at(7, 'Top', 3, 2)).toBe(false);
    expect(at(6, 'Bottom', 3, 2)).toBe(false);
    expect(at(7, 'Bottom', 2, 2)).toBe(false);
    // The classic nine-inning game waits for the 9th.
    expect(inningGameCanEnd(SPORT_DEFINITIONS.baseball, { segment: 7, homeScore: 3, awayScore: 2, stats: { half: 'Bottom' } })).toBe(false);
    expect(inningGameCanEnd(def('nfhs-basketball@2026-27'), { segment: 7, homeScore: 3, awayScore: 2 })).toBe(false);
  });

  it('set winners: target by two, deciding set, cap (F19)', () => {
    const varsity = def('nfhs-volleyball-varsity@2026-27').setFormat!;
    expect(setWinner(varsity, false, 25, 23)).toBe('home');
    expect(setWinner(varsity, false, 25, 24)).toBeNull();
    expect(setWinner(varsity, false, 31, 33)).toBe('away'); // no cap
    expect(setWinner(varsity, true, 15, 13)).toBe('home');
    const sub = def('uil-volleyball-sub-varsity@2026-27').setFormat!;
    expect(setWinner(sub, false, 29, 29)).toBeNull();
    expect(setWinner(sub, false, 30, 29)).toBe('home'); // cap at 30
    expect(setWinner(sub, true, 15, 13)).toBeNull(); // the third set is to 25 too
    expect(setWinner(sub, true, 25, 23)).toBe('home');
  });
});
