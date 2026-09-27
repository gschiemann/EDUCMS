/**
 * VenueOS Sports — Phase 1-A player-stats engine unit tests.
 * ──────────────────────────────────────────────────────────────────────
 *
 * `computePlayerSurfaces` is a PURE, fail-open function: it derives the
 * board's stat leaders + auto player-of-the-game from the per-game
 * roster the board cache already holds, never queries the DB, and never
 * throws on bad input. These tests prove:
 *   1. Leaders pick the top player per stat key, honoring higherBetter
 *      (golf strokes / race time = lowest wins) and reporting the
 *      ORIGINAL display string as `value`.
 *   2. Player-of-the-game weights the marquee scoring stat highest and
 *      returns a SpotlightBand-shaped object.
 *   3. Degenerate inputs (no roster, all-null stats, missing keys,
 *      unknown sport, malformed stats) never crash and yield empties.
 *   4. The fn iterates EVERY classified sport without throwing.
 */
import { PLAYER_STATS } from '@cms/api-types';
import {
  computePlayerSurfaces,
  type RosterRow,
} from './sports-stats.service';

function row(p: Partial<RosterRow> & { name: string }): RosterRow {
  return {
    id: p.id ?? p.name,
    team: p.team ?? 'home',
    name: p.name,
    number: p.number ?? null,
    position: p.position ?? null,
    photoUrl: p.photoUrl ?? null,
    stats: p.stats ?? {},
  };
}

describe('computePlayerSurfaces', () => {
  it('returns empty for no roster / empty roster / unknown sport', () => {
    expect(computePlayerSurfaces('basketball', null)).toEqual({
      leaders: [],
      playerOfGame: null,
    });
    expect(computePlayerSurfaces('basketball', [])).toEqual({
      leaders: [],
      playerOfGame: null,
    });
    expect(
      computePlayerSurfaces('not_a_sport', [row({ name: 'X', stats: { PTS: '10' } })]),
    ).toEqual({ leaders: [], playerOfGame: null });
  });

  it('never throws on malformed / missing stats', () => {
    const roster = [
      row({ name: 'A', stats: null as unknown as object }),
      row({ name: 'B', stats: 'not-an-object' as unknown as object }),
      row({ name: 'C', stats: { PTS: 'DNP', REB: '—', AST: '' } }),
      row({ name: 'D' }), // {} stats
    ];
    const out = computePlayerSurfaces('basketball', roster);
    expect(out.leaders).toEqual([]);
    expect(out.playerOfGame).toBeNull();
  });

  it('picks the top player per stat and keeps the original display string', () => {
    const roster = [
      row({ name: 'Guard', number: '3', team: 'home', stats: { PTS: '24', AST: '8' } }),
      row({ name: 'Center', number: '32', team: 'away', stats: { PTS: '12', REB: '15' } }),
    ];
    const { leaders } = computePlayerSurfaces('basketball', roster);
    const pts = leaders.find((l) => l.statKey === 'PTS');
    expect(pts).toMatchObject({
      playerName: 'Guard',
      playerNumber: '3',
      team: 'home',
      value: '24',
      label: 'Points',
    });
    const reb = leaders.find((l) => l.statKey === 'REB');
    expect(reb).toMatchObject({ playerName: 'Center', team: 'away', value: '15' });
    // No STL/BLK values anywhere → no leader for those keys.
    expect(leaders.find((l) => l.statKey === 'STL')).toBeUndefined();
    expect(leaders.find((l) => l.statKey === 'BLK')).toBeUndefined();
  });

  it('honors higherBetter:false (golf strokes — lowest wins)', () => {
    const roster = [
      row({ name: 'Lo', stats: { STR: '68' } }),
      row({ name: 'Hi', stats: { STR: '79' } }),
    ];
    const { leaders } = computePlayerSurfaces('golf', roster);
    const str = leaders.find((l) => l.statKey === 'STR');
    expect(str?.playerName).toBe('Lo');
    expect(str?.value).toBe('68');
  });

  it('honors higherBetter:false for time marks (XC TIME — fastest wins)', () => {
    const roster = [
      row({ name: 'Fast', stats: { TIME: '17:05.2' } }),
      row({ name: 'Slow', stats: { TIME: '18:42.0' } }),
    ];
    const { leaders } = computePlayerSurfaces('cross_country', roster);
    const t = leaders.find((l) => l.statKey === 'TIME');
    expect(t?.playerName).toBe('Fast');
    expect(t?.value).toBe('17:05.2');
  });

  it('resolves long/lowercase stored stat keys to short codes (CSV/seed rosters)', () => {
    // Rosters seeded or CSV-imported store the LONG label form
    // ('goals'/'assists'/'steals') instead of the PLAYER_STATS short
    // codes ('G'/'A'/'ST'); the board must still find them so leaders +
    // auto Player-of-Game aren't silently empty. (This is the live
    // water-polo board bug — 2026-06-25.)
    const roster = [
      row({ name: 'Sniper', team: 'home', stats: { goals: '44', assists: '9', steals: '14', drawn: '41' } }),
      row({ name: 'Playmaker', team: 'away', stats: { goals: '15', assists: '26', steals: '24', drawn: '12' } }),
    ];
    const { leaders, playerOfGame } = computePlayerSurfaces('water_polo', roster);
    expect(leaders.find((l) => l.statKey === 'G')).toMatchObject({ playerName: 'Sniper', value: '44' });
    expect(leaders.find((l) => l.statKey === 'A')).toMatchObject({ playerName: 'Playmaker', value: '26' });
    expect(leaders.find((l) => l.statKey === 'ST')).toMatchObject({ playerName: 'Playmaker', value: '24' });
    // SAFETY: 'drawn' (exclusions DRAWN) must NOT be mis-read as 'EXC'
    // (exclusions COMMITTED — a different, inverted-semantics stat). A
    // mismatch must stay null, never resolve to another stat's value.
    expect(leaders.find((l) => l.statKey === 'EXC')).toBeUndefined();
    expect(playerOfGame).not.toBeNull();
  });

  it('computes a weighted player-of-the-game shaped for the SpotlightBand', () => {
    const roster = [
      // Scorer: 30 pts.
      row({ name: 'Scorer', number: '23', team: 'home', stats: { PTS: '30', REB: '4' } }),
      // All-arounder: lower pts but strong supporting line.
      row({ name: 'Glue', number: '5', team: 'home', stats: { PTS: '14', REB: '12', AST: '11', STL: '5' } }),
    ];
    const { playerOfGame } = computePlayerSurfaces('basketball', roster);
    expect(playerOfGame).not.toBeNull();
    expect(playerOfGame).toMatchObject({
      name: expect.any(String),
      number: expect.any(String),
      team: 'home',
      photoUrl: null,
    });
    expect(typeof playerOfGame!.headline).toBe('string');
    expect(playerOfGame!.headline.length).toBeGreaterThan(0);
    expect(playerOfGame!.lines.length).toBeGreaterThan(0);
    expect(playerOfGame!.lines.length).toBeLessThanOrEqual(3);
    // Each line is { label, value }.
    for (const l of playerOfGame!.lines) {
      expect(typeof l.label).toBe('string');
      expect(typeof l.value).toBe('string');
    }
  });

  it('handles ties without crashing (first encountered wins)', () => {
    const roster = [
      row({ name: 'First', stats: { PTS: '20' } }),
      row({ name: 'Second', stats: { PTS: '20' } }),
    ];
    const { leaders, playerOfGame } = computePlayerSurfaces('basketball', roster);
    const pts = leaders.find((l) => l.statKey === 'PTS');
    expect(pts?.playerName).toBe('First');
    expect(playerOfGame?.name).toBe('First');
  });

  it('iterates EVERY classified sport without throwing', () => {
    for (const sport of Object.keys(PLAYER_STATS)) {
      const keys = PLAYER_STATS[sport];
      // Build a roster where each player carries a numeric value for the
      // first key (enough to exercise leaders + POTG for every sport).
      const roster = [
        row({ name: `${sport}-a`, stats: { [keys[0]]: '5' } }),
        row({ name: `${sport}-b`, stats: { [keys[0]]: '9' } }),
      ];
      expect(() => computePlayerSurfaces(sport, roster)).not.toThrow();
      const out = computePlayerSurfaces(sport, roster);
      expect(Array.isArray(out.leaders)).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// PHASE 2 — the aggregate READ path (getStatLeaders)
// ════════════════════════════════════════════════════════════════════
//
// In-memory Prisma fake (no DB) over the materialized season/career rows.
// The WRITE side (the roll-up) is sports-stat-rollup.spec.ts.

import { getStatLeaders } from './sports-stats.service';

/** Stable compound-unique serializers for the season/career fakes. */
// NOTE: this in-memory mock keys by (person, season, statKey) only — it does
// NOT model the `sport` dimension of the real DB unique key (added 2026-07-04:
// `person_season_stat` = [personId, season, statKey, sport]). Every test here
// uses a single sport, so the mock's dedup is faithful for these cases; the
// multi-sport separation is enforced by the real DB constraint + migration
// (20260704120000_add_sport_to_player_stat_unique_keys) and validated by tsc
// against the regenerated client, not this mock.
function seasonKey(personId: string, season: string, statKey: string): string {
  return `${personId}|${season}|${statKey}`;
}
function careerKey(personId: string, statKey: string): string {
  return `${personId}|${statKey}`;
}

/** Apply a single-field Prisma orderBy + take to an in-memory array. */
function applyOrderTake<T extends Record<string, any>>(
  rows: T[],
  orderBy: any,
  take?: number,
): T[] {
  let out = [...rows];
  const ob = Array.isArray(orderBy) ? orderBy[0] : orderBy;
  if (ob) {
    const [field, dir] = Object.entries(ob)[0] as [string, 'asc' | 'desc'];
    out.sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === 'asc' ? cmp : -cmp;
    });
  }
  if (typeof take === 'number') out = out.slice(0, take);
  return out;
}

/**
 * Mimic a Prisma `select` that pulls a nested `person` relation. The
 * in-memory rows carry no relation, so the person sub-object is left
 * undefined — the service's `r.person?.fullName ?? ''` handles that.
 */
function projectWithPerson<T extends Record<string, any>>(row: T, select?: any): any {
  if (select?.person) return { ...row, person: undefined };
  return { ...row };
}

interface FakeGame {
  id: string;
  tenantId: string;
  sport: string;
  stats: Record<string, unknown>;
  startedAt: Date | null;
  createdAt: Date | null;
}
interface FakeRoster {
  id: string;
  tenantId: string;
  gameId: string;
  personId: string | null;
  teamId: string | null;
  stats: Record<string, unknown>;
}

/**
 * Build a minimal Prisma fake supporting exactly the calls
 * getStatLeaders makes. `$transaction(fn)` just runs
 * fn against the same fake (single-process test = serial).
 */
function makePrisma(opts: {
  game: FakeGame;
  roster: FakeRoster[];
}) {
  const games = new Map<string, FakeGame>([[opts.game.id, opts.game]]);
  const roster = [...opts.roster];
  const seasonRows = new Map<
    string,
    {
      tenantId: string;
      personId: string;
      teamId: string | null;
      sport: string;
      season: string;
      statKey: string;
      statValue: number;
      gamesPlayed: number;
      displayValue: string | null;
      lastGameId: string | null;
    }
  >();
  const careerRows = new Map<
    string,
    {
      tenantId: string;
      personId: string;
      teamId: string | null;
      sport: string;
      statKey: string;
      statValue: number;
      gamesPlayed: number;
      displayValue: string | null;
      lastGameId: string | null;
    }
  >();

  const client: any = {
    game: {
      findFirst: async ({ where }: any) => {
        const g = games.get(where.id);
        if (!g || (where.tenantId && g.tenantId !== where.tenantId)) return null;
        return { ...g };
      },
      update: async ({ where, data }: any) => {
        const g = games.get(where.id);
        if (!g) throw new Error('game not found');
        if (data.stats) g.stats = data.stats;
        return { ...g };
      },
    },
    rosterPlayer: {
      findMany: async ({ where }: any) => {
        return roster
          .filter((r) => {
            if (where.gameId && r.gameId !== where.gameId) return false;
            if (where.tenantId && r.tenantId !== where.tenantId) return false;
            if (where.personId && 'not' in where.personId) {
              if (r.personId === where.personId.not) return false;
            }
            return true;
          })
          .map((r) => ({ ...r }));
      },
    },
    playerSeasonStat: {
      findUnique: async ({ where }: any) => {
        const u = where.person_season_stat;
        const k = seasonKey(u.personId, u.season, u.statKey);
        const r = seasonRows.get(k);
        return r ? { ...r } : null;
      },
      findMany: async ({ where, orderBy, take, select }: any) => {
        let out = [...seasonRows.values()].filter((r) => {
          if (where.personId && r.personId !== where.personId) return false;
          if (where.statKey && r.statKey !== where.statKey) return false;
          if (where.tenantId && r.tenantId !== where.tenantId) return false;
          if (where.sport && r.sport !== where.sport) return false;
          if (where.season && r.season !== where.season) return false;
          return true;
        });
        out = applyOrderTake(out, orderBy, take);
        return out.map((r) => projectWithPerson(r, select));
      },
      upsert: async ({ where, update, create }: any) => {
        const u = where.person_season_stat;
        const k = seasonKey(u.personId, u.season, u.statKey);
        const existing = seasonRows.get(k);
        if (existing) {
          Object.assign(existing, update);
          return { ...existing };
        }
        const row = { ...create };
        seasonRows.set(k, row);
        return { ...row };
      },
    },
    playerCareerStat: {
      findMany: async ({ where, orderBy, take, select }: any) => {
        let out = [...careerRows.values()].filter((r) => {
          if (where.personId && r.personId !== where.personId) return false;
          if (where.statKey && r.statKey !== where.statKey) return false;
          if (where.tenantId && r.tenantId !== where.tenantId) return false;
          if (where.sport && r.sport !== where.sport) return false;
          return true;
        });
        out = applyOrderTake(out, orderBy, take);
        return out.map((r) => projectWithPerson(r, select));
      },
      upsert: async ({ where, update, create }: any) => {
        const u = where.person_career_stat;
        const k = careerKey(u.personId, u.statKey);
        const existing = careerRows.get(k);
        if (existing) {
          Object.assign(existing, update);
          return { ...existing };
        }
        const row = { ...create };
        careerRows.set(k, row);
        return { ...row };
      },
    },
    $transaction: async (fn: any) => fn(client),
  };

  return { client, games, seasonRows, careerRows };
}

const T = 'tenant-fz';

function fakeGame(over: Partial<FakeGame> = {}): FakeGame {
  return {
    id: 'game-1',
    tenantId: T,
    sport: 'basketball',
    stats: {},
    startedAt: new Date('2025-12-01T19:00:00Z'),
    createdAt: new Date('2025-11-01T00:00:00Z'),
    ...over,
  };
}

// The roll-up engine (formerly finalizeGameStats) is covered by
// sports-stat-rollup.spec.ts (K12-F39: durable, correction-aware jobs) —
// every scenario that lived here is ported there.

describe('getStatLeaders', () => {
  it('orders SEASON leaders by higherBetter and reads the materialized rows', async () => {
    const game = fakeGame();
    const { client, seasonRows } = makePrisma({ game, roster: [] });
    // Seed three season PTS rows directly (materialized table).
    seasonRows.set('p-1|2025-26|PTS', {
      tenantId: T, personId: 'p-1', teamId: null, sport: 'basketball', season: '2025-26',
      statKey: 'PTS', statValue: 100, gamesPlayed: 5, displayValue: '100', lastGameId: 'g',
    });
    seasonRows.set('p-2|2025-26|PTS', {
      tenantId: T, personId: 'p-2', teamId: null, sport: 'basketball', season: '2025-26',
      statKey: 'PTS', statValue: 250, gamesPlayed: 5, displayValue: '250', lastGameId: 'g',
    });
    seasonRows.set('p-3|2025-26|PTS', {
      tenantId: T, personId: 'p-3', teamId: null, sport: 'basketball', season: '2025-26',
      statKey: 'PTS', statValue: 175, gamesPlayed: 5, displayValue: '175', lastGameId: 'g',
    });

    const leaders = await getStatLeaders(client, {
      tenantId: T, sport: 'basketball', season: '2025-26', statKey: 'PTS', scope: 'SEASON', limit: 10,
    });
    // PTS higherBetter → descending.
    expect(leaders.map((l) => l.statValue)).toEqual([250, 175, 100]);
    expect(leaders[0].personId).toBe('p-2');
  });
});

// ──────────────────────────────────────────────────────────────────────
// getAthleteCareer — READ-PATH sport surfacing (regression for the
// write/read asymmetry after the sport-unique-key fix, a56aebec).
//
// The write path now stores a multi-sport athlete's colliding stat codes
// (soccer 'G' goals vs basketball 'G' games) as SEPARATE rows per sport.
// This proves the READ path SELECTs + surfaces `sport` on every career and
// season row, so those rows don't collapse into one ambiguous entry on the
// public athlete profile. The fake below PROJECTS ONLY the columns the
// service `select`s — so if `sport` is dropped from the select (the pre-fix
// state), it never reaches the output and these assertions fail.
// ──────────────────────────────────────────────────────────────────────
import { getAthleteCareer } from './sports-stats.service';

interface FakeStatRow {
  tenantId: string;
  personId: string;
  sport: string;
  season?: string;
  statKey: string;
  statValue: number;
  gamesPlayed: number;
  displayValue: string | null;
}

/** A Prisma-faithful fake that returns ONLY the `select`ed fields. */
function selectProject(row: FakeStatRow, select?: Record<string, boolean>): any {
  if (!select) return { ...row };
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = (row as any)[k];
  return out;
}

function careerPrisma(seasonRows: FakeStatRow[], careerRows: FakeStatRow[]) {
  return {
    sportsPerson: {
      findFirst: async ({ where, select }: any) => {
        if (where.id !== 'p-multi' || where.tenantId !== T) return null;
        const person: any = {
          id: 'p-multi', fullName: 'Jordan Rivers', number: '10',
          position: 'MF', photoUrl: null, teamId: 'team-1', gradYear: 2027,
        };
        if (!select) return person;
        const out: any = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = person[k];
        return out;
      },
    },
    playerSeasonStat: {
      findMany: async ({ where, select }: any) =>
        seasonRows
          .filter((r) => r.personId === where.personId && r.tenantId === where.tenantId)
          .map((r) => selectProject(r, select)),
    },
    playerCareerStat: {
      findMany: async ({ where, select }: any) =>
        careerRows
          .filter((r) => r.personId === where.personId && r.tenantId === where.tenantId)
          .map((r) => selectProject(r, select)),
    },
  } as any;
}

describe('getAthleteCareer — multi-sport read path', () => {
  // Same stat code 'G' means DIFFERENT things per sport (soccer goals vs
  // basketball games), stored as two rows now that `sport` is in the key.
  const seasonRows: FakeStatRow[] = [
    { tenantId: T, personId: 'p-multi', sport: 'soccer', season: '2025-26', statKey: 'G', statValue: 12, gamesPlayed: 15, displayValue: '12' },
    { tenantId: T, personId: 'p-multi', sport: 'basketball', season: '2025-26', statKey: 'G', statValue: 22, gamesPlayed: 22, displayValue: '22' },
  ];
  const careerRows: FakeStatRow[] = [
    { tenantId: T, personId: 'p-multi', sport: 'soccer', statKey: 'G', statValue: 30, gamesPlayed: 40, displayValue: '30' },
    { tenantId: T, personId: 'p-multi', sport: 'basketball', statKey: 'G', statValue: 48, gamesPlayed: 48, displayValue: '48' },
  ];

  it('surfaces `sport` on every career row', async () => {
    const prisma = careerPrisma(seasonRows, careerRows);
    const out = await getAthleteCareer(prisma, { tenantId: T, personId: 'p-multi' });
    expect(out).not.toBeNull();
    for (const c of out!.career) expect(typeof c.sport).toBe('string');
    expect(out!.career.every((c) => c.sport && c.sport.length > 0)).toBe(true);
  });

  it('surfaces `sport` on every season row', async () => {
    const prisma = careerPrisma(seasonRows, careerRows);
    const out = await getAthleteCareer(prisma, { tenantId: T, personId: 'p-multi' });
    for (const s of out!.season) expect(typeof s.sport).toBe('string');
    expect(out!.season.every((s) => s.sport && s.sport.length > 0)).toBe(true);
  });

  it('keeps a colliding statKey as TWO DISTINCT career entries (not collapsed)', async () => {
    const prisma = careerPrisma(seasonRows, careerRows);
    const out = await getAthleteCareer(prisma, { tenantId: T, personId: 'p-multi' });
    const gRows = out!.career.filter((c) => c.statKey === 'G');
    expect(gRows).toHaveLength(2);
    // Distinguishable by sport, with their own (different) values preserved.
    const bySport = Object.fromEntries(gRows.map((c) => [c.sport, c.statValue]));
    expect(bySport.soccer).toBe(30);
    expect(bySport.basketball).toBe(48);
    expect(new Set(gRows.map((c) => c.sport)).size).toBe(2);
  });

  it('keeps a colliding statKey as TWO DISTINCT season entries (not collapsed)', async () => {
    const prisma = careerPrisma(seasonRows, careerRows);
    const out = await getAthleteCareer(prisma, { tenantId: T, personId: 'p-multi' });
    const gRows = out!.season.filter((s) => s.statKey === 'G' && s.season === '2025-26');
    expect(gRows).toHaveLength(2);
    const bySport = Object.fromEntries(gRows.map((s) => [s.sport, s.statValue]));
    expect(bySport.soccer).toBe(12);
    expect(bySport.basketball).toBe(22);
    expect(new Set(gRows.map((s) => s.sport)).size).toBe(2);
  });
});
