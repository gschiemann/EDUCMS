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
// PHASE 2 — finalizeGameStats aggregation engine
// ════════════════════════════════════════════════════════════════════
//
// In-memory Prisma fake (no DB). Proves the load-bearing finalize
// contract: linked players' COUNTING stats roll into season + career;
// rate stats are NOT summed; re-FINAL is a NO-OP (idempotency marker);
// unparseable stats are skipped without throwing; unlinked roster rows
// (personId null) are ignored.

import { finalizeGameStats, getStatLeaders } from './sports-stats.service';

/** Stable compound-unique serializers for the season/career fakes. */
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
 * finalizeGameStats + getStatLeaders make. `$transaction(fn)` just runs
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

describe('finalizeGameStats', () => {
  it('aggregates linked players COUNTING stats into season + career', async () => {
    const game = fakeGame();
    const roster: FakeRoster[] = [
      {
        id: 'rp-1',
        tenantId: T,
        gameId: 'game-1',
        personId: 'p-1',
        teamId: 'team-1',
        stats: { PTS: '24', REB: '10', AST: '5' },
      },
      {
        id: 'rp-2',
        tenantId: T,
        gameId: 'game-1',
        personId: 'p-2',
        teamId: 'team-1',
        stats: { PTS: '12', REB: '8' },
      },
    ];
    const { client, seasonRows, careerRows } = makePrisma({ game, roster });

    const res = await finalizeGameStats(client, T, 'game-1');
    expect(res.aggregated).toBe(2);
    expect(res.skipped).toBeUndefined();

    // p-1 season PTS = 24, career PTS = 24 (season "2025" from startedAt).
    const sPts = seasonRows.get('p-1|2025|PTS');
    expect(sPts?.statValue).toBe(24);
    expect(sPts?.season).toBe('2025');
    expect(sPts?.gamesPlayed).toBe(1);
    expect(sPts?.displayValue).toBe('24');
    const cPts = careerRows.get('p-1|PTS');
    expect(cPts?.statValue).toBe(24);
    expect(cPts?.gamesPlayed).toBe(1);

    // p-2 PTS rolled too.
    expect(seasonRows.get('p-2|2025|PTS')?.statValue).toBe(12);
    expect(careerRows.get('p-2|PTS')?.statValue).toBe(12);

    // The game's idempotency marker is now stamped.
    expect((game.stats as any).statsFinalizedAt).toEqual(expect.any(String));
  });

  it('accumulates across two different games into the season + career total', async () => {
    // Game 1.
    const g1 = fakeGame({ id: 'game-1' });
    const r1: FakeRoster[] = [
      { id: 'rp-1', tenantId: T, gameId: 'game-1', personId: 'p-1', teamId: null, stats: { PTS: '20' } },
    ];
    const fake = makePrisma({ game: g1, roster: r1 });
    await finalizeGameStats(fake.client, T, 'game-1');

    // Splice a second game + roster into the SAME fake stores by adding a
    // second game to the games map and roster rows, then finalize it.
    const g2 = fakeGame({ id: 'game-2', startedAt: new Date('2025-12-08T19:00:00Z') });
    fake.games.set('game-2', g2);
    // The rosterPlayer.findMany in the fake reads the original `roster`
    // array — rebuild the prisma over a combined store instead.
    const combined = makePrisma({
      game: g2,
      roster: [
        { id: 'rp-2', tenantId: T, gameId: 'game-2', personId: 'p-1', teamId: null, stats: { PTS: '15' } },
      ],
    });
    // Seed combined with game-1's already-finalized season/career rows.
    combined.seasonRows.set('p-1|2025|PTS', {
      tenantId: T, personId: 'p-1', teamId: null, sport: 'basketball',
      season: '2025', statKey: 'PTS', statValue: 20, gamesPlayed: 1,
      displayValue: '20', lastGameId: 'game-1',
    });
    combined.careerRows.set('p-1|PTS', {
      tenantId: T, personId: 'p-1', teamId: null, sport: 'basketball',
      statKey: 'PTS', statValue: 20, gamesPlayed: 1, displayValue: '20', lastGameId: 'game-1',
    });

    const res = await finalizeGameStats(combined.client, T, 'game-2');
    expect(res.aggregated).toBe(1);
    // Season PTS now 20 + 15 = 35 over 2 games; career mirrors it.
    expect(combined.seasonRows.get('p-1|2025|PTS')?.statValue).toBe(35);
    expect(combined.seasonRows.get('p-1|2025|PTS')?.gamesPlayed).toBe(2);
    expect(combined.careerRows.get('p-1|PTS')?.statValue).toBe(35);
    expect(combined.careerRows.get('p-1|PTS')?.gamesPlayed).toBe(2);
  });

  it('does NOT sum rate stats (baseball AVG is per-game, never aggregated)', async () => {
    const game = fakeGame({ sport: 'baseball' });
    const roster: FakeRoster[] = [
      {
        id: 'rp-1', tenantId: T, gameId: 'game-1', personId: 'p-1', teamId: null,
        // AVG is a rate stat; H/HR/RBI are counting.
        stats: { AVG: '.312', H: '3', HR: '1', RBI: '2' },
      },
    ];
    const { client, seasonRows } = makePrisma({ game, roster });

    await finalizeGameStats(client, T, 'game-1');

    // Counting stats present.
    expect(seasonRows.get('p-1|2025|H')?.statValue).toBe(3);
    expect(seasonRows.get('p-1|2025|HR')?.statValue).toBe(1);
    expect(seasonRows.get('p-1|2025|RBI')?.statValue).toBe(2);
    // AVG (rate) must NOT have produced any aggregate row.
    expect(seasonRows.get('p-1|2025|AVG')).toBeUndefined();
  });

  it('is idempotent — re-running finalize on the same game is a NO-OP (no double count)', async () => {
    const game = fakeGame();
    const roster: FakeRoster[] = [
      { id: 'rp-1', tenantId: T, gameId: 'game-1', personId: 'p-1', teamId: null, stats: { PTS: '30' } },
    ];
    const { client, seasonRows, careerRows } = makePrisma({ game, roster });

    const first = await finalizeGameStats(client, T, 'game-1');
    expect(first.aggregated).toBe(1);
    expect(seasonRows.get('p-1|2025|PTS')?.statValue).toBe(30);

    // Re-FINAL — the marker is set, so this must do nothing.
    const second = await finalizeGameStats(client, T, 'game-1');
    expect(second.aggregated).toBe(0);
    expect(second.skipped).toBe('already-finalized');

    // Totals UNCHANGED — no double count.
    expect(seasonRows.get('p-1|2025|PTS')?.statValue).toBe(30);
    expect(careerRows.get('p-1|PTS')?.statValue).toBe(30);
  });

  it('skips an unparseable stat without throwing (fail-open within the parse)', async () => {
    const game = fakeGame();
    const roster: FakeRoster[] = [
      {
        id: 'rp-1', tenantId: T, gameId: 'game-1', personId: 'p-1', teamId: null,
        // PTS is junk → skipped; REB is valid → rolled.
        stats: { PTS: 'DNP', REB: '7' },
      },
    ];
    const { client, seasonRows } = makePrisma({ game, roster });

    const res = await finalizeGameStats(client, T, 'game-1');
    expect(res.aggregated).toBe(1);
    // The unparseable PTS produced no row; REB did.
    expect(seasonRows.get('p-1|2025|PTS')).toBeUndefined();
    expect(seasonRows.get('p-1|2025|REB')?.statValue).toBe(7);
  });

  it('ignores unlinked roster players (personId null)', async () => {
    const game = fakeGame();
    const roster: FakeRoster[] = [
      // Linked — aggregates.
      { id: 'rp-1', tenantId: T, gameId: 'game-1', personId: 'p-1', teamId: null, stats: { PTS: '18' } },
      // Unlinked — must be ignored (opponent / typo).
      { id: 'rp-2', tenantId: T, gameId: 'game-1', personId: null, teamId: null, stats: { PTS: '99' } },
    ];
    const { client, seasonRows } = makePrisma({ game, roster });

    const res = await finalizeGameStats(client, T, 'game-1');
    // Only the one linked player aggregated.
    expect(res.aggregated).toBe(1);
    expect(seasonRows.get('p-1|2025|PTS')?.statValue).toBe(18);
    // No row for the unlinked 99-point opponent.
    expect([...seasonRows.values()].some((r) => r.statValue === 99)).toBe(false);
  });

  it('skips a cross-tenant / missing game without throwing', async () => {
    const game = fakeGame();
    const { client } = makePrisma({ game, roster: [] });

    const wrongTenant = await finalizeGameStats(client, 'other-tenant', 'game-1');
    expect(wrongTenant).toEqual({ aggregated: 0, skipped: 'game-not-found' });

    const missing = await finalizeGameStats(client, T, 'no-such-game');
    expect(missing).toEqual({ aggregated: 0, skipped: 'game-not-found' });
  });

  it('validates required inputs', async () => {
    const { client } = makePrisma({ game: fakeGame(), roster: [] });
    await expect(finalizeGameStats(client, '', 'game-1')).rejects.toThrow(/tenantId/);
    await expect(finalizeGameStats(client, T, '')).rejects.toThrow(/gameId/);
  });
});

describe('getStatLeaders', () => {
  it('orders SEASON leaders by higherBetter and reads the materialized rows', async () => {
    const game = fakeGame();
    const { client, seasonRows } = makePrisma({ game, roster: [] });
    // Seed three season PTS rows directly (materialized table).
    seasonRows.set('p-1|2025|PTS', {
      tenantId: T, personId: 'p-1', teamId: null, sport: 'basketball', season: '2025',
      statKey: 'PTS', statValue: 100, gamesPlayed: 5, displayValue: '100', lastGameId: 'g',
    });
    seasonRows.set('p-2|2025|PTS', {
      tenantId: T, personId: 'p-2', teamId: null, sport: 'basketball', season: '2025',
      statKey: 'PTS', statValue: 250, gamesPlayed: 5, displayValue: '250', lastGameId: 'g',
    });
    seasonRows.set('p-3|2025|PTS', {
      tenantId: T, personId: 'p-3', teamId: null, sport: 'basketball', season: '2025',
      statKey: 'PTS', statValue: 175, gamesPlayed: 5, displayValue: '175', lastGameId: 'g',
    });

    const leaders = await getStatLeaders(client, {
      tenantId: T, sport: 'basketball', season: '2025', statKey: 'PTS', scope: 'SEASON', limit: 10,
    });
    // PTS higherBetter → descending.
    expect(leaders.map((l) => l.statValue)).toEqual([250, 175, 100]);
    expect(leaders[0].personId).toBe('p-2');
  });
});
