/**
 * VenueOS Sports — SportsService tests.
 *
 * Exercises the game engine against an in-memory Prisma fake: game
 * CRUD, the clock-as-anchor math, scoring (incl. the atomic-increment
 * fix), segment advance (incl. the count-up re-anchor fix), stat
 * bounding, cues, and the scoreboard-to-screen push. No DB required.
 */
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SPORT_DEFINITIONS } from '@cms/api-types';
import { SportsService } from './sports.service';

// ── in-memory Prisma fake ──────────────────────────────────────

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]: any) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      if ('gte' in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      if ('lt' in v) return Number(row[k]) < Number(v.lt);
      return false;
    }
    return row[k] === v;
  });
}

function applyData(row: any, data: any) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in (v as any)) {
      row[k] = (row[k] ?? 0) + (v as any).increment;
    } else {
      row[k] = v;
    }
  }
}

function makeTable(defaults: Record<string, any> = {}) {
  const rows: any[] = [];
  const updateCalls: any[] = [];
  let seq = 0;
  return {
    rows,
    updateCalls,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let out = rows.filter((r) => matches(r, where || {}));
      // Honor orderBy the way Prisma does (single clause or an array of
      // clauses, asc/desc, Date-aware) so tests that request an order get the
      // SAME sequence prod does. Without this the fake returned insertion
      // order and silently ignored `orderBy`, which made the undo-rail
      // reverse-chronological test flake on millisecond ties.
      if (orderBy) {
        const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
        out = out.slice().sort((a, b) => {
          for (const clause of clauses) {
            for (const [k, dir] of Object.entries(clause)) {
              const av = a[k], bv = b[k];
              let cmp = 0;
              if (av instanceof Date || bv instanceof Date) cmp = new Date(av).getTime() - new Date(bv).getTime();
              else if (av < bv) cmp = -1;
              else if (av > bv) cmp = 1;
              if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
            }
          }
          return 0;
        });
      }
      if (typeof skip === 'number') out = out.slice(skip);
      if (typeof take === 'number') out = out.slice(0, take);
      return out;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where || {})).length,
    create: async ({ data }: any) => {
      const row = { id: `id-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data };
      rows.push(row);
      return row;
    },
    createMany: async ({ data }: any) => {
      const arr = Array.isArray(data) ? data : [data];
      arr.forEach((d) =>
        rows.push({ id: `id-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...d }),
      );
      return { count: arr.length };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('Row not found');
      updateCalls.push({ where, data });
      applyData(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => applyData(r, data));
      return { count: hit.length };
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => matches(r, where));
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
  };
}

const TENANT = 'tenant-1';

function setup() {
  const game = makeTable({ homeScore: 0, awayScore: 0 });
  const gameEvent = makeTable();
  const screen = makeTable();
  const sponsor = makeTable();
  const rosterPlayer = makeTable();
  const customCue = makeTable();
  // Audit-Fix 1: AuditLog mock table.
  const auditLog = makeTable();
  // assertOwnedGameRefs (Sprint 13 — operator-picked custom layouts) verifies
  // every scoreboard/ribbon/scorebug template id belongs to the tenant (or is
  // a system preset) via `template.findMany({ where: { id: { in }, OR: [...] }})`.
  // The shared `matches()` helper doesn't model Prisma's `OR`, so this table
  // gets a dedicated findMany that only honours the `id: { in }` filter (tenant
  // scoping is exercised by the in-memory rows we seed below, all owned by
  // TENANT). Seed the layout templates the duplicateGame/updateGameDetails
  // tests reference so ownership validation passes instead of NPE'ing on an
  // undefined `template` model.
  const template = makeTable();
  template.rows.push(
    { id: 'tmpl-board', tenantId: TENANT, isSystem: false },
    { id: 'tmpl-ribbon', tenantId: TENANT, isSystem: false },
    { id: 'tmpl-scorebug', tenantId: TENANT, isSystem: false },
  );
  template.findMany = async ({ where }: any = {}) => {
    const ids: string[] | undefined = where?.id?.in;
    return template.rows.filter((r) => (ids ? ids.includes(r.id) : true));
  };
  const prisma = {
    client: { game, gameEvent, screen, sponsor, rosterPlayer, customCue, auditLog, template },
  };
  const redis = { publish: jest.fn().mockResolvedValue(undefined) };
  const signer = { signMessage: jest.fn(() => ({ eventId: 'e', signature: 's' })) };
  // SportsService gained a SponsorsService dependency (Phase 2 sponsorship)
  // — the board read calls sponsorsService.listActive. Mock it so the
  // getBoard tests don't NPE on an undefined collaborator.
  const sponsorsService = { listActive: jest.fn().mockResolvedValue([]) };
  const service = new SportsService(
    prisma as any,
    redis as any,
    signer as any,
    sponsorsService as any,
  );
  return { service, game, gameEvent, screen, sponsor, rosterPlayer, customCue, auditLog, redis, signer };
}

async function newGame(service: SportsService, sport = 'football') {
  return service.createGame(TENANT, { sport, homeTeam: 'Home', awayTeam: 'Away' });
}

// ── tests ──────────────────────────────────────────────────────

describe('SportsService — createGame', () => {
  it('rejects an unknown sport', async () => {
    const { service } = setup();
    await expect(
      service.createGame(TENANT, { sport: 'curling', homeTeam: 'A', awayTeam: 'B' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a missing team name', async () => {
    const { service } = setup();
    await expect(
      service.createGame(TENANT, { sport: 'football', homeTeam: '', awayTeam: 'B' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('initializes a countdown clock to the segment length', async () => {
    const { service } = setup();
    const g = await newGame(service, 'football');
    expect(g.clockMs).toBe(12 * 60_000);
    expect(g.clockRunning).toBe(false);
    expect(g.segment).toBe(1);
    expect(g.status).toBe('SCHEDULED');
  });

  it('initializes count-up and no-clock sports at 0', async () => {
    const { service } = setup();
    expect((await newGame(service, 'soccer')).clockMs).toBe(0);
    expect((await newGame(service, 'baseball')).clockMs).toBe(0);
  });
});

describe('SportsService — team branding', () => {
  it('stores team logo URLs on create', async () => {
    const { service } = setup();
    const g = await service.createGame(TENANT, {
      sport: 'baseball',
      homeTeam: 'Dodgers',
      awayTeam: 'Giants',
      homeLogoUrl: 'https://cdn.example.com/dodgers.png',
      awayLogoUrl: 'https://cdn.example.com/giants.png',
    });
    expect(g.homeLogoUrl).toBe('https://cdn.example.com/dodgers.png');
    expect(g.awayLogoUrl).toBe('https://cdn.example.com/giants.png');
  });

  it('edits team names, colors, and logos without disturbing the score', async () => {
    const { service } = setup();
    const g = await newGame(service);
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 7 });
    const edited = await service.updateGameDetails(TENANT, g.id, {
      homeTeam: 'LA Dodgers',
      homeColor: '#005A9C',
      homeLogoUrl: 'https://cdn.example.com/lad.svg',
    });
    expect(edited.homeTeam).toBe('LA Dodgers');
    expect(edited.homeColor).toBe('#005A9C');
    expect(edited.homeLogoUrl).toBe('https://cdn.example.com/lad.svg');
    expect(edited.homeScore).toBe(7); // score untouched by an identity edit
  });

  it('rejects an empty team name on edit and is tenant-scoped', async () => {
    const { service } = setup();
    const g = await newGame(service);
    await expect(service.updateGameDetails(TENANT, g.id, { homeTeam: '  ' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.updateGameDetails('other-tenant', g.id, { homeTeam: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('SportsService — tenant isolation', () => {
  it('refuses to read another tenant’s game', async () => {
    const { service } = setup();
    const g = await newGame(service);
    await expect(service.getGame('other-tenant', g.id)).rejects.toThrow(NotFoundException);
    await expect(service.getGame(TENANT, g.id)).resolves.toBeTruthy();
  });
});

describe('SportsService — scoring', () => {
  it('applies score via an atomic increment, not a read-modify-write', async () => {
    const { service, game } = setup();
    const g = await newGame(service);
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 6 });
    const lastData = game.updateCalls[game.updateCalls.length - 1].data;
    expect(lastData).toHaveProperty('homeScore.increment', 6);
  });

  it('accumulates repeated increments', async () => {
    const { service } = setup();
    const g = await newGame(service);
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 3 });
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 3 });
    const after = await service.adjustScore(TENANT, g.id, { team: 'away', delta: 1 });
    expect(after.homeScore).toBe(6);
    expect(after.awayScore).toBe(1);
  });

  it('clamps a negative score back to zero', async () => {
    const { service } = setup();
    const g = await newGame(service);
    const after = await service.adjustScore(TENANT, g.id, { team: 'home', delta: -1 });
    expect(after.homeScore).toBe(0);
  });

  it('setScore sets both scores absolutely', async () => {
    const { service } = setup();
    const g = await newGame(service);
    const after = await service.setScore(TENANT, g.id, { homeScore: 21, awayScore: 14 });
    expect(after.homeScore).toBe(21);
    expect(after.awayScore).toBe(14);
  });
});

describe('SportsService — clock', () => {
  it('start refuses a sport with no clock', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    await expect(service.clockAction(TENANT, g.id, { action: 'start' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('pause freezes a running countdown clock at the live reading', async () => {
    const { service, game } = setup();
    const g = await newGame(service, 'football'); // 720000ms
    await service.clockAction(TENANT, g.id, { action: 'start' });
    // pretend 5s have elapsed since the clock was anchored
    game.rows[0].clockUpdatedAt = new Date(Date.now() - 5000);
    const paused = await service.clockAction(TENANT, g.id, { action: 'pause' });
    expect(paused.clockRunning).toBe(false);
    expect(paused.clockMs).toBeLessThanOrEqual(720_000 - 5000);
    expect(paused.clockMs).toBeGreaterThan(720_000 - 5500);
  });

  it('set and reset behave', async () => {
    const { service } = setup();
    const g = await newGame(service, 'football');
    expect((await service.clockAction(TENANT, g.id, { action: 'set', ms: 60_000 })).clockMs).toBe(60_000);
    expect((await service.clockAction(TENANT, g.id, { action: 'reset' })).clockMs).toBe(12 * 60_000);
  });
});

describe('SportsService — setSegment', () => {
  it('re-anchors a COUNT-UP clock when the segment advances (soccer fix)', async () => {
    const { service } = setup();
    const g = await newGame(service, 'soccer');
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 120_000 });
    const advanced = await service.setSegment(TENANT, g.id, { delta: 1 });
    expect(advanced.segment).toBe(2);
    expect(advanced.clockMs).toBe(0); // count-up half restarts at 0
    expect(advanced.clockRunning).toBe(false);
  });

  it('re-anchors a countdown clock to the segment length', async () => {
    const { service } = setup();
    const g = await newGame(service, 'football');
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 30_000 });
    const advanced = await service.setSegment(TENANT, g.id, { delta: 1 });
    expect(advanced.clockMs).toBe(12 * 60_000);
  });

  it('leaves a no-clock sport’s clock untouched', async () => {
    const { service, game } = setup();
    const g = await newGame(service, 'baseball');
    game.rows[0].clockMs = 999;
    const advanced = await service.setSegment(TENANT, g.id, { delta: 1 });
    expect(advanced.segment).toBe(2);
    expect(advanced.clockMs).toBe(999);
  });

  it('clamps the segment to the legal range', async () => {
    const { service } = setup();
    const vb = await newGame(service, 'volleyball'); // 5 sets, no overtime
    expect((await service.setSegment(TENANT, vb.id, { segment: 99 })).segment).toBe(5);
    expect((await service.setSegment(TENANT, vb.id, { segment: 0 })).segment).toBe(1);
  });

  // ── config+api P2: football OT is untimed (2026-06-13 audit) ──
  it('football OT zeroes the game clock instead of re-anchoring to 12:00', async () => {
    const { service } = setup();
    const g = await newGame(service, 'football'); // 4 quarters, overtime:true
    // Jump straight to the first OT segment (count 4 → 5).
    const ot = await service.setSegment(TENANT, g.id, { segment: 5 });
    expect(ot.segment).toBe(5);
    expect(ot.clockMs).toBe(0); // OT clock zeroed, not 12:00
    expect(ot.clockRunning).toBe(false);
  });

  it('football regulation quarters still re-anchor to the segment length', async () => {
    const { service } = setup();
    const g = await newGame(service, 'football');
    const q2 = await service.setSegment(TENANT, g.id, { segment: 2 });
    expect(q2.clockMs).toBe(12 * 60_000); // regulation re-anchor unchanged
  });
});

// ── config+api: LINE SCORE producer (board cross-domain contract) ──
describe('SportsService — line score producer', () => {
  it('baseball snapshots cumulative score per inning on a forward advance', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    // 1st inning: home plates 2 runs, then advance to the 2nd.
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 });
    const r1: any = await service.setSegment(TENANT, g.id, { delta: 1 });
    expect(r1.segment).toBe(2);
    expect(r1.stats.lineScore).toEqual([{ segment: 1, home: 2, away: 0 }]);
    // 2nd inning: away plates 3; advance to the 3rd. Cumulative snapshot.
    await service.adjustScore(TENANT, g.id, { team: 'away', delta: 3 });
    const r2: any = await service.setSegment(TENANT, g.id, { delta: 1 });
    expect(r2.stats.lineScore).toEqual([
      { segment: 1, home: 2, away: 0 },
      { segment: 2, home: 2, away: 3 },
    ]);
  });

  it('football snapshots cumulative score per quarter on a forward advance', async () => {
    const { service } = setup();
    const g = await newGame(service, 'football');
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 7 });
    const q2: any = await service.setSegment(TENANT, g.id, { delta: 1 });
    expect(q2.stats.lineScore).toEqual([{ segment: 1, home: 7, away: 0 }]);
  });

  it('does NOT produce a line score for a non-box-score sport (soccer)', async () => {
    const { service } = setup();
    const g = await newGame(service, 'soccer');
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    const h2: any = await service.setSegment(TENANT, g.id, { delta: 1 });
    expect(h2.stats?.lineScore).toBeUndefined();
  });

  it('does NOT snapshot on a backward (correction) move', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    await service.setSegment(TENANT, g.id, { delta: 1 }); // inning 2, snapshot seg 1
    const back: any = await service.setSegment(TENANT, g.id, { delta: -1 });
    expect(back.segment).toBe(1);
    // The seg-1 snapshot from the forward move stays; no NEW entry on the
    // backward move (no segment 0 / duplicate).
    expect(back.stats.lineScore).toEqual([{ segment: 1, home: 1, away: 0 }]);
  });

  it('is idempotent per segment — re-advancing replaces, never duplicates', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    await service.setSegment(TENANT, g.id, { delta: 1 }); // → inning 2, snapshot seg1=1-0
    await service.setSegment(TENANT, g.id, { delta: -1 }); // back to inning 1
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 }); // now 2-0
    const again: any = await service.setSegment(TENANT, g.id, { delta: 1 }); // re-advance
    // Exactly one seg-1 entry, refreshed to the current cumulative total.
    expect(again.stats.lineScore).toEqual([{ segment: 1, home: 2, away: 0 }]);
  });
});

describe('SportsService — stats', () => {
  it('only merges keys the sport defines', async () => {
    const { service } = setup();
    const g = await newGame(service, 'football');
    const after = await service.updateStats(TENANT, g.id, { stats: { down: 2, bogusKey: 9 } });
    expect((after.stats as any).down).toBe(2);
    expect((after.stats as any).bogusKey).toBeUndefined();
  });

  it('bounds a string stat value to 200 chars', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    const after = await service.updateStats(TENANT, g.id, { stats: { half: 'x'.repeat(5000) } });
    expect(((after.stats as any).half as string).length).toBe(200);
  });

  it('drops a non-scalar stat value', async () => {
    const { service } = setup();
    const g = await newGame(service, 'football');
    const after = await service.updateStats(TENANT, g.id, { stats: { down: { nested: 1 } } as any });
    expect((after.stats as any).down).toBeUndefined();
  });

  it('still rejects an ARRAY value for a non-allowlisted key', async () => {
    const { service } = setup();
    const g = await newGame(service, 'football');
    const after = await service.updateStats(TENANT, g.id, {
      stats: { bogusList: [{ a: 1 }], down: 3 } as any,
    });
    // The structured branch only fires for results/playerFouls/playerExclusions;
    // any other array-valued key is dropped exactly as before.
    expect((after.stats as any).bogusList).toBeUndefined();
    expect((after.stats as any).down).toBe(3);
  });
});

describe('SportsService — structured stats (results / playerFouls / playerExclusions)', () => {
  it('persists a valid results blob (meet finish + per-apparatus)', async () => {
    const { service } = setup();
    const g = await newGame(service, 'track_and_field');
    const after = await service.updateStats(TENANT, g.id, {
      stats: {
        results: [
          {
            event: '100 Free',
            order: 1,
            entries: [
              { place: 1, name: 'Ada Lovelace', team: 'home', lane: 4, mark: '52.31' },
              { place: 2, name: 'Grace Hopper', team: 'away', lane: 3, mark: '53.10' },
            ],
          },
        ],
      } as any,
    });
    const results = (after.stats as any).results;
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0].event).toBe('100 Free');
    expect(results[0].order).toBe(1);
    expect(results[0].entries).toHaveLength(2);
    expect(results[0].entries[0]).toEqual({
      place: 1,
      name: 'Ada Lovelace',
      mark: '52.31',
      team: 'home',
      lane: 4,
    });
  });

  it('caps the top results array + nested entries array at 64, strings at 64 chars', async () => {
    const { service } = setup();
    const g = await newGame(service, 'gymnastics');
    const bigEntries = Array.from({ length: 100 }, (_, i) => ({
      place: i + 1,
      name: 'x'.repeat(200),
      mark: '9'.repeat(200),
    }));
    const bigResults = Array.from({ length: 100 }, (_, i) => ({
      event: 'e'.repeat(200) + i,
      entries: bigEntries,
    }));
    const after = await service.updateStats(TENANT, g.id, {
      stats: { results: bigResults } as any,
    });
    const results = (after.stats as any).results;
    expect(results).toHaveLength(64);
    expect(results[0].event.length).toBe(64);
    expect(results[0].entries).toHaveLength(64);
    expect(results[0].entries[0].name.length).toBe(64);
    expect(results[0].entries[0].mark.length).toBe(64);
  });

  it('drops malformed results members (no event / no entries / wrong type)', async () => {
    const { service } = setup();
    const g = await newGame(service, 'swimming_diving');
    const after = await service.updateStats(TENANT, g.id, {
      stats: {
        results: [
          { event: 'Good', entries: [{ place: 1, name: 'A', mark: '1:00' }] },
          { entries: [{ place: 1, name: 'B', mark: '2:00' }] }, // no event — dropped
          { event: 'NoEntries' }, // no entries array — dropped
          'not-an-object', // dropped
          null, // dropped
        ],
      } as any,
    });
    const results = (after.stats as any).results;
    expect(results).toHaveLength(1);
    expect(results[0].event).toBe('Good');
  });

  it('coerces a bad place / lane and a non-string mark inside an entry', async () => {
    const { service } = setup();
    const g = await newGame(service, 'cross_country');
    const after = await service.updateStats(TENANT, g.id, {
      stats: {
        results: [
          {
            event: '5K',
            entries: [
              { place: 9999, name: 42, team: 'sideline', lane: -5, mark: 17 },
            ],
          },
        ],
      } as any,
    });
    const entry = (after.stats as any).results[0].entries[0];
    expect(entry.place).toBe(999); // clamped to max
    expect(entry.name).toBe('42'); // coerced to string
    expect(entry.team).toBeNull(); // invalid side → null
    expect(entry.lane).toBe(0); // clamped to min
    expect(entry.mark).toBe('17'); // coerced to string
  });

  it('persists + bounds a playerFouls blob and drops members with no team', async () => {
    const { service } = setup();
    const g = await newGame(service, 'basketball');
    const after = await service.updateStats(TENANT, g.id, {
      stats: {
        playerFouls: [
          { team: 'home', jersey: 23, name: 'M. Jordan', fouls: 4 },
          { team: 'away', jersey: 99, fouls: 99 }, // fouls clamped to 9
          { jersey: 5, fouls: 2 }, // no team — dropped
          { team: 'bench', jersey: 1, fouls: 1 }, // invalid team — dropped
        ],
      } as any,
    });
    const pf = (after.stats as any).playerFouls;
    expect(pf).toHaveLength(2);
    expect(pf[0]).toEqual({ team: 'home', jersey: 23, fouls: 4, name: 'M. Jordan' });
    expect(pf[1].fouls).toBe(9); // clamped
    expect(pf[1].name).toBeUndefined(); // no name supplied
  });

  it('persists + bounds a playerExclusions blob (water polo, count clamped 0-9)', async () => {
    const { service } = setup();
    const g = await newGame(service, 'water_polo');
    const after = await service.updateStats(TENANT, g.id, {
      stats: {
        playerExclusions: [
          { team: 'away', jersey: 7, name: 'Driver', count: 3 },
          { team: 'home', jersey: 1000, count: 50 }, // jersey + count clamped
        ],
      } as any,
    });
    const px = (after.stats as any).playerExclusions;
    expect(px).toHaveLength(2);
    expect(px[0]).toEqual({ team: 'away', jersey: 7, count: 3, name: 'Driver' });
    expect(px[1].jersey).toBe(999);
    expect(px[1].count).toBe(9);
  });

  it('an operator clearing a list persists an empty array (not a drop)', async () => {
    const { service } = setup();
    const g = await newGame(service, 'basketball');
    await service.updateStats(TENANT, g.id, {
      stats: { playerFouls: [{ team: 'home', jersey: 1, fouls: 1 }] } as any,
    });
    const after = await service.updateStats(TENANT, g.id, { stats: { playerFouls: [] } as any });
    expect((after.stats as any).playerFouls).toEqual([]);
  });

  it('a non-array structured value sanitizes to an empty array', async () => {
    const { service } = setup();
    const g = await newGame(service, 'basketball');
    const after = await service.updateStats(TENANT, g.id, {
      stats: { playerFouls: { not: 'an array' } } as any,
    });
    expect((after.stats as any).playerFouls).toEqual([]);
  });

  it('does NOT disturb scalar keys merged in the same call', async () => {
    const { service } = setup();
    const g = await newGame(service, 'basketball');
    const after = await service.updateStats(TENANT, g.id, {
      stats: {
        homeFouls: 5,
        playerFouls: [{ team: 'home', jersey: 1, fouls: 2 }],
        bogusKey: 7,
      } as any,
    });
    expect((after.stats as any).homeFouls).toBe(5); // scalar still merged
    expect((after.stats as any).playerFouls).toHaveLength(1); // structured persisted
    expect((after.stats as any).bogusKey).toBeUndefined(); // non-allowlisted dropped
  });
});

describe('SportsService — cues & status', () => {
  it('fires a celebration cue the sport defines', async () => {
    const { service, gameEvent } = setup();
    const g = await newGame(service, 'football');
    const res = await service.fireCue(TENANT, g.id, { key: 'touchdown' });
    expect(res.fired).toBe(true);
    expect(res.cue.key).toBe('touchdown');
    expect(gameEvent.rows.some((e) => e.type === 'CUE')).toBe(true);
  });

  it('rejects an unknown cue key', async () => {
    const { service } = setup();
    const g = await newGame(service, 'football');
    await expect(service.fireCue(TENANT, g.id, { key: 'moonwalk' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('records startedAt on LIVE and endedAt on FINAL', async () => {
    const { service } = setup();
    const g = await newGame(service);
    const live = await service.setStatus(TENANT, g.id, { status: 'LIVE' });
    expect(live.startedAt).toBeTruthy();
    const final = await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    expect(final.endedAt).toBeTruthy();
    expect(final.clockRunning).toBe(false);
  });

  it('rejects an invalid status', async () => {
    const { service } = setup();
    const g = await newGame(service);
    await expect(service.setStatus(TENANT, g.id, { status: 'PARTY' })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('SportsService — scoreboard-to-screen push', () => {
  it('shows a game on tenant screens and reports which are showing', async () => {
    const { service, screen } = setup();
    const g = await newGame(service);
    screen.rows.push({ id: 's1', name: 'Lobby', status: 'ONLINE', tenantId: TENANT, activeBoardGameId: null });
    screen.rows.push({ id: 's2', name: 'Concourse', status: 'ONLINE', tenantId: TENANT, activeBoardGameId: null });

    const after = await service.showOnScreens(TENANT, g.id, ['s1']);
    expect(after.find((s: any) => s.id === 's1').showing).toBe(true);
    expect(after.find((s: any) => s.id === 's2').showing).toBe(false);

    const cleared = await service.hideFromScreens(TENANT, g.id);
    expect(cleared.every((s: any) => !s.showing)).toBe(true);
  });

  it('rejects an empty screen list', async () => {
    const { service } = setup();
    const g = await newGame(service);
    await expect(service.showOnScreens(TENANT, g.id, [])).rejects.toThrow(BadRequestException);
  });

  it('deleteGame releases screens still showing it', async () => {
    const { service, screen } = setup();
    const g = await newGame(service);
    screen.rows.push({ id: 's1', name: 'Lobby', status: 'ONLINE', tenantId: TENANT, activeBoardGameId: g.id });
    await service.deleteGame(TENANT, g.id);
    expect(screen.rows[0].activeBoardGameId).toBeNull();
  });
});

describe('SportsService — spotlight', () => {
  it('sets a featured-player spotlight with stat lines', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    const after = await service.setSpotlight(TENANT, g.id, {
      title: 'Mookie Betts',
      photoUrl: 'https://cdn.example.com/betts.jpg',
      subtitle: '#50 · RF',
      lines: [
        { label: 'AVG', value: '.312' },
        { label: 'HR', value: '19' },
      ],
    });
    const sp = after.spotlight as any;
    expect(sp.visible).toBe(true);
    expect(sp.title).toBe('Mookie Betts');
    expect(sp.lines).toHaveLength(2);
    expect(sp.lines[0]).toEqual({ label: 'AVG', value: '.312' });
  });

  it('rejects a spotlight with no title', async () => {
    const { service } = setup();
    const g = await newGame(service);
    await expect(service.setSpotlight(TENANT, g.id, { title: '  ' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('clears the spotlight', async () => {
    const { service } = setup();
    const g = await newGame(service);
    await service.setSpotlight(TENANT, g.id, { title: 'Promo Night' });
    const cleared = await service.setSpotlight(TENANT, g.id, { clear: true });
    expect(cleared.spotlight).toEqual({});
  });

  it('caps stat lines at four and is tenant-scoped', async () => {
    const { service } = setup();
    const g = await newGame(service);
    const after = await service.setSpotlight(TENANT, g.id, {
      title: 'Player',
      lines: [
        { label: 'A', value: '1' },
        { label: 'B', value: '2' },
        { label: 'C', value: '3' },
        { label: 'D', value: '4' },
        { label: 'E', value: '5' },
      ],
    });
    expect((after.spotlight as any).lines).toHaveLength(4);
    await expect(
      service.setSpotlight('other-tenant', g.id, { title: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });
});

// ── T2-8: Possession arrow ─────────────────────────────────────
describe('SportsService — setPossession (T2-8)', () => {
  it('persists possession to Game.possession and writes a POSSESSION GameEvent', async () => {
    const { service, game, gameEvent } = setup();
    const g = await newGame(service, 'basketball');

    const result = await service.setPossession(TENANT, g.id, { team: 'home' });

    expect(result).toEqual({ success: true, possession: 'home' });

    // Game.possession column is updated.
    const updated = game.rows.find((r: any) => r.id === g.id);
    expect(updated?.possession).toBe('home');

    // A POSSESSION GameEvent is appended.
    const events = gameEvent.rows.filter((e: any) => e.gameId === g.id && e.type === 'POSSESSION');
    expect(events).toHaveLength(1);
    expect(events[0].payload.team).toBe('home');
  });

  it('records prevPossession in the GameEvent payload', async () => {
    const { service, gameEvent } = setup();
    const g = await newGame(service, 'basketball');

    // Set to home first.
    await service.setPossession(TENANT, g.id, { team: 'home' });
    // Flip to away — the event should carry prevPossession = 'home'.
    await service.setPossession(TENANT, g.id, { team: 'away' });

    const events = gameEvent.rows.filter((e: any) => e.gameId === g.id && e.type === 'POSSESSION');
    expect(events).toHaveLength(2);
    expect(events[1].payload.team).toBe('away');
    expect(events[1].payload.prevPossession).toBe('home');
  });

  it('writes an AuditLog row on every setPossession call', async () => {
    const { service, auditLog } = setup();
    const g = await newGame(service, 'football');

    await service.setPossession(TENANT, g.id, { team: 'away' }, 'actor-user-1');

    const auditRows = auditLog.rows.filter(
      (r: any) => r.action === 'SPORTS_POSSESSION_SET' && r.targetId === g.id,
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].userId).toBe('actor-user-1');
    const details = JSON.parse(auditRows[0].details);
    expect(details.team).toBe('away');
    expect(details.sport).toBe('football');
  });

  it('defaults team to home when an invalid value is passed', async () => {
    const { service, game } = setup();
    const g = await newGame(service, 'basketball');

    const result = await service.setPossession(TENANT, g.id, { team: 'invalid' as any });
    expect(result.possession).toBe('home');
    const updated = game.rows.find((r: any) => r.id === g.id);
    expect(updated?.possession).toBe('home');
  });

  it('is tenant-scoped and 404s another tenant\'s game', async () => {
    const { service } = setup();
    const g = await newGame(service, 'basketball');
    await expect(
      service.setPossession('other-tenant', g.id, { team: 'home' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('SportsService — public board view', () => {
  it('returns the game plus its recent cue feed', async () => {
    const { service } = setup();
    const g = await newGame(service, 'basketball');
    await service.fireCue(TENANT, g.id, { key: 'dunk' });
    const board = await service.getBoard(g.id);
    expect(board.sport).toBe('basketball');
    expect(board.homeTeam).toBe('Home');
    expect(Array.isArray(board.cues)).toBe(true);
    expect(board.cues.some((c: any) => c.key === 'dunk')).toBe(true);
    expect(typeof board.serverTime).toBe('number');
  });

  it('404s an unknown game id', async () => {
    const { service } = setup();
    await expect(service.getBoard('nope')).rejects.toThrow(NotFoundException);
  });
});

describe('SportsService — roster', () => {
  it('adds players to home/away and lists them', async () => {
    const { service } = setup();
    const g = await newGame(service);
    await service.addPlayer(TENANT, g.id, { team: 'home', name: 'Mookie Betts', number: '50', position: 'RF' });
    await service.addPlayer(TENANT, g.id, { team: 'away', name: 'Aaron Judge', number: '99' });
    const roster = await service.listRoster(TENANT, g.id);
    expect(roster).toHaveLength(2);
    expect(roster.find((p: any) => p.team === 'home').name).toBe('Mookie Betts');
    expect(roster.find((p: any) => p.team === 'away').name).toBe('Aaron Judge');
  });

  it('rejects a player with no name', async () => {
    const { service } = setup();
    const g = await newGame(service);
    await expect(
      service.addPlayer(TENANT, g.id, { team: 'home', name: '  ' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('imports a roster from CSV with arbitrary stat columns', async () => {
    const { service } = setup();
    const g = await newGame(service);
    const csv = [
      'team,name,number,position,AVG,HR',
      'home,Mookie Betts,50,RF,.312,19',
      'away,Aaron Judge,99,RF,.297,37',
    ].join('\n');
    const roster = await service.importRosterCsv(TENANT, g.id, csv);
    expect(roster).toHaveLength(2);
    const mookie: any = roster.find((p: any) => p.name === 'Mookie Betts');
    expect(mookie.team).toBe('home');
    expect(mookie.stats).toEqual({ AVG: '.312', HR: '19' });
  });

  it('rejects a CSV with no name column', async () => {
    const { service } = setup();
    const g = await newGame(service);
    await expect(
      service.importRosterCsv(TENANT, g.id, 'team,number\nhome,50'),
    ).rejects.toThrow(BadRequestException);
  });

  it('updates and deletes a player', async () => {
    const { service } = setup();
    const g = await newGame(service);
    const p = await service.addPlayer(TENANT, g.id, { team: 'home', name: 'Player One' });
    const updated = await service.updatePlayer(TENANT, g.id, p.id, { number: '7' });
    expect(updated.number).toBe('7');
    await service.deletePlayer(TENANT, g.id, p.id);
    expect(await service.listRoster(TENANT, g.id)).toHaveLength(0);
  });

  it("getBoard includes the game's roster", async () => {
    const { service } = setup();
    const g = await newGame(service);
    await service.addPlayer(TENANT, g.id, { team: 'home', name: 'Mookie Betts' });
    const board = await service.getBoard(g.id);
    expect(Array.isArray(board.roster)).toBe(true);
    expect(board.roster).toHaveLength(1);
  });
});

describe('SportsService — baseball count rules', () => {
  it('a 4th ball is a walk — count resets, no out', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    const r: any = await service.updateStats(TENANT, g.id, { stats: { balls: 4 } });
    expect(r.stats).toMatchObject({ balls: 0, strikes: 0, outs: 0 });
  });

  it('a 3rd strike is an out — count resets, outs +1', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    const r: any = await service.updateStats(TENANT, g.id, { stats: { strikes: 3 } });
    expect(r.stats).toMatchObject({ strikes: 0, balls: 0, outs: 1 });
  });

  it('the 3rd out flips Top → Bottom, same inning', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    const r: any = await service.updateStats(TENANT, g.id, { stats: { outs: 3 } });
    expect(r.stats).toMatchObject({ outs: 0, half: 'Bottom' });
    expect(r.segment).toBe(1);
  });

  it('the 3rd out clears the bases for the new half', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    await service.updateStats(TENANT, g.id, {
      stats: { on1B: 1, on2B: 1, on3B: 1, outs: 2 },
    });
    const r: any = await service.updateStats(TENANT, g.id, { stats: { outs: 3 } });
    expect(r.stats).toMatchObject({ on1B: 0, on2B: 0, on3B: 0, outs: 0 });
  });

  it('the 3rd out of the bottom advances the inning', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    await service.updateStats(TENANT, g.id, { stats: { half: 'Bottom' } });
    const r: any = await service.updateStats(TENANT, g.id, { stats: { outs: 3 } });
    expect(r.stats).toMatchObject({ outs: 0, half: 'Top' });
    expect(r.segment).toBe(2);
  });

  it('a strikeout for the 3rd out retires the side', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    await service.updateStats(TENANT, g.id, { stats: { outs: 2 } });
    const r: any = await service.updateStats(TENANT, g.id, { stats: { strikes: 3 } });
    expect(r.stats).toMatchObject({ outs: 0, strikes: 0, balls: 0, half: 'Bottom' });
  });

  it('a football down of 4 does not cascade', async () => {
    const { service } = setup();
    const g = await newGame(service, 'football');
    const r: any = await service.updateStats(TENANT, g.id, { stats: { down: 4 } });
    expect(r.stats).toMatchObject({ down: 4 });
    expect(r.segment).toBe(1);
  });
});

describe('SportsService — set-sport rules', () => {
  it('volleyball: reaching 25 by 2 wins the set and advances', async () => {
    const { service } = setup();
    const g = await newGame(service, 'volleyball');
    await service.adjustScore(TENANT, g.id, { team: 'away', delta: 23 });
    const r: any = await service.adjustScore(TENANT, g.id, { team: 'home', delta: 25 });
    expect(r.homeScore).toBe(0);
    expect(r.awayScore).toBe(0);
    expect(r.stats).toMatchObject({ homeSets: 1 });
    expect(r.segment).toBe(2);
  });

  it('volleyball: 25-24 does not win — a set needs a 2-point lead', async () => {
    const { service } = setup();
    const g = await newGame(service, 'volleyball');
    await service.adjustScore(TENANT, g.id, { team: 'away', delta: 24 });
    const r: any = await service.adjustScore(TENANT, g.id, { team: 'home', delta: 25 });
    expect(r.homeScore).toBe(25);
    expect(r.awayScore).toBe(24);
  });

  it('volleyball: winning 3 sets ends the match', async () => {
    const { service } = setup();
    const g = await newGame(service, 'volleyball');
    let r: any;
    for (let i = 0; i < 3; i++) {
      await service.adjustScore(TENANT, g.id, { team: 'away', delta: 10 });
      r = await service.adjustScore(TENANT, g.id, { team: 'home', delta: 25 });
    }
    expect(r.stats).toMatchObject({ homeSets: 3 });
    expect(r.status).toBe('FINAL');
  });

  it('pickleball: reaching 11 by 2 wins the game', async () => {
    const { service } = setup();
    const g = await newGame(service, 'pickleball');
    await service.adjustScore(TENANT, g.id, { team: 'away', delta: 9 });
    const r: any = await service.adjustScore(TENANT, g.id, { team: 'home', delta: 11 });
    expect(r.homeScore).toBe(0);
    expect(r.stats).toMatchObject({ homeGames: 1 });
    expect(r.segment).toBe(2);
  });
});

describe('SportsService — baseball walk advances the runner (config+api P1)', () => {
  it('a walk with bases empty puts the batter on 1B', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    const r: any = await service.updateStats(TENANT, g.id, { stats: { balls: 4 } });
    expect(r.stats).toMatchObject({ balls: 0, strikes: 0, on1B: 1, on2B: 0, on3B: 0 });
  });

  it('a walk with a runner on 1B forces him to 2B (1B stays occupied)', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    await service.updateStats(TENANT, g.id, { stats: { on1B: 1 } });
    const r: any = await service.updateStats(TENANT, g.id, { stats: { balls: 4 } });
    expect(r.stats).toMatchObject({ on1B: 1, on2B: 1, on3B: 0 });
  });

  it('a walk with a runner on 2B only does NOT force him (2B unchanged, 1B fills)', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    await service.updateStats(TENANT, g.id, { stats: { on2B: 1 } });
    const r: any = await service.updateStats(TENANT, g.id, { stats: { balls: 4 } });
    expect(r.stats).toMatchObject({ on1B: 1, on2B: 1, on3B: 0 });
  });

  it('a bases-loaded walk forces in a run for the batting team', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball'); // starts Top → AWAY bats
    await service.updateStats(TENANT, g.id, { stats: { on1B: 1, on2B: 1, on3B: 1 } });
    const r: any = await service.updateStats(TENANT, g.id, { stats: { balls: 4 } });
    expect(r.stats).toMatchObject({ on1B: 1, on2B: 1, on3B: 1 });
    expect(r.awayScore).toBe(1); // Top of the inning → away team scores
    expect(r.homeScore).toBe(0);
  });

  it('a bases-loaded walk in the bottom scores for the HOME team', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    await service.updateStats(TENANT, g.id, {
      stats: { half: 'Bottom', on1B: 1, on2B: 1, on3B: 1 },
    });
    const r: any = await service.updateStats(TENANT, g.id, { stats: { balls: 4 } });
    expect(r.homeScore).toBe(1);
    expect(r.awayScore).toBe(0);
  });
});

describe('SportsService — volleyball next-set auto-zero (config+api P1)', () => {
  it('a manual forward set advance zeroes the carried-over point score', async () => {
    const { service } = setup();
    const g = await newGame(service, 'volleyball');
    // 24-20 hasn't reached the set target by 2, so applySetWin doesn't
    // auto-fire — the operator ends the set by hand via setSegment.
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 24 });
    await service.adjustScore(TENANT, g.id, { team: 'away', delta: 20 });
    const r: any = await service.setSegment(TENANT, g.id, { delta: 1 });
    expect(r.segment).toBe(2);
    expect(r.homeScore).toBe(0);
    expect(r.awayScore).toBe(0);
  });

  it('credits the just-finished set to the team that led it', async () => {
    const { service } = setup();
    const g = await newGame(service, 'volleyball');
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 24 });
    await service.adjustScore(TENANT, g.id, { team: 'away', delta: 20 });
    const r: any = await service.setSegment(TENANT, g.id, { delta: 1 });
    expect(r.stats).toMatchObject({ homeSets: 1 });
  });

  it('pickleball forward advance credits awayGames / zeroes the rally', async () => {
    const { service } = setup();
    const g = await newGame(service, 'pickleball');
    // 10-5 hasn't hit the 11-point game target, so no auto game-win.
    await service.adjustScore(TENANT, g.id, { team: 'away', delta: 10 });
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 5 });
    const r: any = await service.setSegment(TENANT, g.id, { delta: 1 });
    expect(r.homeScore).toBe(0);
    expect(r.awayScore).toBe(0);
    expect(r.stats).toMatchObject({ awayGames: 1 });
  });

  it('does NOT zero a baseball inning advance (clockless but cumulative score)', async () => {
    const { service } = setup();
    const g = await newGame(service, 'baseball');
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 3 });
    const r: any = await service.setSegment(TENANT, g.id, { delta: 1 });
    expect(r.homeScore).toBe(3); // baseball runs carry across innings
  });

  it('does NOT credit a set on a backward (segment-correction) move', async () => {
    const { service } = setup();
    const g = await newGame(service, 'volleyball');
    await service.setSegment(TENANT, g.id, { delta: 1 }); // now set 2, scores 0
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 10 });
    const r: any = await service.setSegment(TENANT, g.id, { delta: -1 });
    expect(r.segment).toBe(1);
    expect(r.stats?.homeSets ?? 0).toBe(0); // no credit going backward
    expect(r.homeScore).toBe(10); // backward move leaves the score alone
  });
});

describe('SportsService — soccer added-time auto-advance (config+api P1)', () => {
  // Helper: stand a soccer game up LIVE with a running count-up clock
  // reading `liveMs`, with `addedTime` minutes configured.
  function liveSoccer(game: any, liveMs: number, addedTime: number) {
    const row = game.rows[0];
    row.status = 'LIVE';
    row.clockMs = liveMs;
    row.clockRunning = true;
    row.clockUpdatedAt = new Date();
    row.stats = { addedTime };
  }

  it('auto-advances the half once regulation passes when no added time is set', async () => {
    const { service, game } = setup();
    const g = await newGame(service, 'soccer'); // 40-min halves
    liveSoccer(game, 40 * 60_000 + 1_000, 0);
    expect(g.segment).toBe(1);
    const changed = await service.autoAdvanceExpiredClocks();
    expect(changed).toBe(1);
    expect(game.rows[0].segment).toBe(2);
  });

  it('does NOT auto-advance during added time (clock runs past regulation)', async () => {
    const { service, game } = setup();
    await newGame(service, 'soccer');
    // 1 minute past regulation, 3 minutes of added time configured.
    liveSoccer(game, 40 * 60_000 + 60_000, 3);
    const changed = await service.autoAdvanceExpiredClocks();
    expect(changed).toBe(0);
    expect(game.rows[0].segment).toBe(1); // still in the first half
  });

  it('auto-advances once added time has also elapsed', async () => {
    const { service, game } = setup();
    await newGame(service, 'soccer');
    // Past regulation + past the 2 minutes of added time.
    liveSoccer(game, 40 * 60_000 + 2 * 60_000 + 1_000, 2);
    const changed = await service.autoAdvanceExpiredClocks();
    expect(changed).toBe(1);
    expect(game.rows[0].segment).toBe(2);
  });
});

describe('SportsService — config: wrestling team model + golf round (config+api P1)', () => {
  it('wrestling carries a dual-meet team-points model distinct from match points', () => {
    const wrestling: any = SPORT_DEFINITIONS.wrestling;
    expect(wrestling.teamScore).toBeDefined();
    expect(wrestling.teamScore.homeKey).toBe('homeTeamPoints');
    expect(wrestling.teamScore.awayKey).toBe('awayTeamPoints');
    // Decision / major / tech / pin result values.
    expect(wrestling.teamScore.increments).toEqual([3, 4, 5, 6]);
    // The per-bout match-points set stays separate.
    expect(wrestling.score.increments).toEqual([1, 2, 3, 4]);
    const statKeys = wrestling.stats.map((s: any) => s.key);
    expect(statKeys).toEqual(
      expect.arrayContaining(['homeTeamPoints', 'awayTeamPoints', 'weightClass', 'boutNumber']),
    );
  });

  it('golf round length is operator-selectable 9 / 18 and never overtimes', () => {
    const golf: any = SPORT_DEFINITIONS.golf;
    expect(golf.segment.countOptions).toEqual([9, 18]);
    expect(golf.segment.overtime).toBe(false);
  });
});

describe('SportsService — cue deck', () => {
  it('creates and lists custom cues', async () => {
    const { service } = setup();
    await service.createCue(TENANT, { name: 'T-Shirt Toss', mediaUrl: 'https://x/toss.png' });
    await service.createCue(TENANT, { name: 'Make Some Noise' });
    const cues = await service.listCues(TENANT);
    expect(cues).toHaveLength(2);
    expect(cues[0].name).toBe('T-Shirt Toss');
  });

  it('rejects a cue with no name', async () => {
    const { service } = setup();
    await expect(service.createCue(TENANT, { name: '  ' })).rejects.toThrow(BadRequestException);
  });

  it('fires a custom cue as a takeover CUE event', async () => {
    const { service, gameEvent } = setup();
    const g = await newGame(service);
    const cue = await service.createCue(TENANT, {
      name: 'Sponsor Takeover',
      mediaUrl: 'https://x/sponsor.png',
    });
    await service.fireCue(TENANT, g.id, { cueId: cue.id });
    const ev: any = gameEvent.rows.find((e: any) => e.type === 'CUE');
    expect(ev).toBeTruthy();
    expect(ev.payload).toMatchObject({
      label: 'Sponsor Takeover',
      mediaUrl: 'https://x/sponsor.png',
      custom: true,
    });
  });

  it('rejects firing an unknown custom cue', async () => {
    const { service } = setup();
    const g = await newGame(service);
    await expect(
      service.fireCue(TENANT, g.id, { cueId: 'nope' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('updates and deletes a cue', async () => {
    const { service } = setup();
    const cue = await service.createCue(TENANT, { name: 'Old Name' });
    const updated: any = await service.updateCue(TENANT, cue.id, {
      name: 'New Name',
      durationMs: 9000,
    });
    expect(updated.name).toBe('New Name');
    expect(updated.durationMs).toBe(9000);
    await service.deleteCue(TENANT, cue.id);
    expect(await service.listCues(TENANT)).toHaveLength(0);
  });
});

describe('SportsService — duplicateGame', () => {
  it('clones presentation into a fresh SCHEDULED game and resets live state', async () => {
    const { service, game, rosterPlayer } = setup();
    const src: any = await service.createGame(TENANT, {
      sport: 'football',
      homeTeam: 'Eagles',
      awayTeam: 'Tigers',
      homeColor: '#1d4ed8',
      awayColor: '#dc2626',
    });
    // Custom surfaces + ribbon content on the source.
    await service.updateGameDetails(TENANT, src.id, {
      scoreboardTemplateId: 'tmpl-board',
      ribbonTemplateId: 'tmpl-ribbon',
    });
    await service.setRibbonSlides(TENANT, src.id, {
      slides: ['https://x/banner1.png', 'https://x/banner2.png'],
    });
    rosterPlayer.rows.push(
      { id: 'p1', tenantId: TENANT, gameId: src.id, team: 'home', name: 'QB1', number: '7', position: 'QB', photoUrl: null, stats: {}, sortOrder: 0 },
      { id: 'p2', tenantId: TENANT, gameId: src.id, team: 'away', name: 'RB2', number: '22', position: 'RB', photoUrl: null, stats: {}, sortOrder: 1 },
    );
    // Source is live + pushing to a screen group.
    const srcRow: any = game.rows.find((r: any) => r.id === src.id);
    srcRow.homeScore = 21;
    srcRow.awayScore = 14;
    srcRow.status = 'LIVE';
    srcRow.segment = 3;
    srcRow.screenGroupId = 'grp-1';

    const copy: any = await service.duplicateGame(TENANT, src.id);

    // Fresh game, clean live state.
    expect(copy.id).not.toBe(src.id);
    expect(copy.status).toBe('SCHEDULED');
    expect(copy.homeScore).toBe(0);
    expect(copy.awayScore).toBe(0);
    expect(copy.segment).toBe(1);
    expect(copy.screenGroupId).toBeNull(); // never inherit the live binding
    // Presentation copied.
    expect(copy.homeTeam).toBe('Eagles');
    expect(copy.awayTeam).toBe('Tigers');
    expect(copy.homeColor).toBe('#1d4ed8');
    expect(copy.scoreboardTemplateId).toBe('tmpl-board');
    expect(copy.ribbonTemplateId).toBe('tmpl-ribbon');
    // Ribbon slides replayed onto the copy.
    const copyView: any = await service.getGame(TENANT, copy.id);
    expect(copyView.ribbonSlides).toEqual(['https://x/banner1.png', 'https://x/banner2.png']);
    // Roster cloned (both teams).
    const roster = await service.listRoster(TENANT, copy.id);
    expect(roster).toHaveLength(2);
    // Source untouched.
    const srcView: any = await service.getGame(TENANT, src.id);
    expect(srcView.homeScore).toBe(21);
    expect(srcView.status).toBe('LIVE');
  });

  it('is tenant-scoped — refuses to duplicate another tenant\'s game', async () => {
    const { service } = setup();
    const src: any = await service.createGame(TENANT, { sport: 'football', homeTeam: 'A', awayTeam: 'B' });
    await expect(service.duplicateGame('other-tenant', src.id)).rejects.toThrow(NotFoundException);
  });
});

describe('SportsService — AUTO celebration on score feed', () => {
  // Pull the CUE events a feed ingest produced (the manual-launchpad and
  // auto paths share the same CUE GameEvent shape).
  const cues = (gameEvent: any) =>
    gameEvent.rows.filter((r: any) => r.type === 'CUE').map((r: any) => r.payload);

  it('fires the matching celebration when a FEED bumps the score by a standout delta', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'football'); // 0-0
    // Feed reports a touchdown: home 0 → 7.
    await service.ingestByFeed(g.id, { homeScore: 7 });
    const fired = cues(gameEvent);
    expect(fired).toHaveLength(1);
    expect(fired[0].key).toBe('touchdown');
    expect(fired[0].auto).toBe(true);
    expect(fired[0].team).toBe('home');
    // A field goal (delta 3) for the away team fires fieldGoal.
    await service.ingestByFeed(g.id, { awayScore: 3 });
    const fired2 = cues(gameEvent);
    expect(fired2).toHaveLength(2);
    expect(fired2[1].key).toBe('fieldGoal');
    expect(fired2[1].team).toBe('away');
  });

  it('does NOT fire on a routine / non-standout delta (football +2 has no autoPoints)', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'football');
    await service.ingestByFeed(g.id, { homeScore: 2 }); // safety — no celebration
    expect(cues(gameEvent)).toHaveLength(0);
  });

  it('does NOT fire on a basketball bucket (+2) but DOES on a three (+3)', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.ingestByFeed(g.id, { homeScore: 2 });
    expect(cues(gameEvent)).toHaveLength(0);
    await service.ingestByFeed(g.id, { homeScore: 5 }); // +3 → three-pointer
    const fired = cues(gameEvent);
    expect(fired).toHaveLength(1);
    expect(fired[0].key).toBe('threePointer');
  });

  it('fires a soccer GOAL on every +1', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'soccer');
    await service.ingestByFeed(g.id, { homeScore: 1 });
    await service.ingestByFeed(g.id, { homeScore: 2 });
    const fired = cues(gameEvent);
    expect(fired).toHaveLength(2);
    expect(fired.every((c: any) => c.key === 'goal')).toBe(true);
  });

  it('does NOT fire on a score correction (delta <= 0) or an unchanged re-send', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'soccer');
    await service.ingestByFeed(g.id, { homeScore: 3 }); // not a +1 → no goal cue
    const after = cues(gameEvent).length;
    await service.ingestByFeed(g.id, { homeScore: 3 }); // re-send, delta 0
    await service.ingestByFeed(g.id, { homeScore: 2 }); // correction down
    expect(cues(gameEvent).length).toBe(after);
  });

  it('does NOT auto-fire from the MANUAL (guarded) ingest path', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'soccer');
    // No opts.auto → manual admin sync; operator fires cues themselves.
    await service.ingest(TENANT, g.id, { homeScore: 1 });
    expect(cues(gameEvent)).toHaveLength(0);
  });

  it('respects the per-game toggle — OFF suppresses, back ON resumes', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'soccer');
    await service.setAutoCelebrate(TENANT, g.id, false);
    await service.ingestByFeed(g.id, { homeScore: 1 });
    expect(cues(gameEvent)).toHaveLength(0);
    expect((await service.getAutoCelebrate(TENANT, g.id)).enabled).toBe(false);

    await service.setAutoCelebrate(TENANT, g.id, true);
    await service.ingestByFeed(g.id, { homeScore: 2 });
    expect(cues(gameEvent)).toHaveLength(1);
  });

  // Audit-Fix 1: the dashboard's +7 button (and every other manual quick-
  // button) now fires AUTO celebrations too — same path as the feed.
  // Without these tests, a regression that drops the manual path could
  // sail through CI (the +7 demo would silently NOT animate).
  it('MANUAL +7 (adjustScore) fires the touchdown celebration', async () => {
    const { service, gameEvent, auditLog } = setup();
    const g: any = await newGame(service, 'football'); // 0-0
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 7 }, 'user-1');
    const fired = cues(gameEvent);
    expect(fired).toHaveLength(1);
    expect(fired[0].key).toBe('touchdown');
    expect(fired[0].auto).toBe(true);
    expect(fired[0].team).toBe('home');
    expect(fired[0].source).toBe('manual');
    const cueAudit = auditLog.rows.find((r: any) => r.action === 'SPORTS_CUE_FIRED');
    expect(cueAudit).toBeTruthy();
    const details = JSON.parse(cueAudit.details);
    expect(details.source).toBe('manual');
    expect(details.auto).toBe(true);
    expect(cueAudit.userId).toBe('user-1');
  });

  it('MANUAL +3 (adjustScore) fires the field-goal celebration', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'football');
    await service.adjustScore(TENANT, g.id, { team: 'away', delta: 3 }, 'user-1');
    const fired = cues(gameEvent);
    expect(fired).toHaveLength(1);
    expect(fired[0].key).toBe('fieldGoal');
    expect(fired[0].team).toBe('away');
    expect(fired[0].source).toBe('manual');
  });

  it('MANUAL +1 single point (safety) does NOT fire a celebration in football', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'football');
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 }, 'user-1');
    expect(cues(gameEvent)).toHaveLength(0);
  });

  it('MANUAL adjustScore respects the per-game toggle — OFF suppresses', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'soccer');
    await service.setAutoCelebrate(TENANT, g.id, false);
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 }, 'user-1');
    expect(cues(gameEvent)).toHaveLength(0);
  });

  it('MANUAL setScore fires the matching celebration when a team\'s score jumps', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setScore(TENANT, g.id, { homeScore: 3, awayScore: 0 }, 'user-1');
    const fired = cues(gameEvent);
    expect(fired).toHaveLength(1);
    expect(fired[0].key).toBe('threePointer');
    expect(fired[0].source).toBe('manual');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T1-1: ingest() + ingestCtsSnapshot() unified mutation-path tests
// Verifies Greg's rule: "all the same rules apply if we are doing it or the
// integration is doing it."
// ─────────────────────────────────────────────────────────────────────────────

describe('T1-1 — ingest() clock-sync helpers fire on running-state transition', () => {
  it('ingest() slaving: toggling clockRunning false freezes a shot clock', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'basketball');
    // Seed a running shot clock in stats so syncShotClockToGameClock has
    // something to act on.
    game.rows[0].stats = {
      shotClock: { len: 24, ms: 24000, running: true, at: new Date().toISOString() },
    };
    game.rows[0].clockRunning = true;

    // Integration reports: clock stopped (running false → false transition
    // is ignored; true → false is the interesting path).
    const updated: any = await service.ingest(
      TENANT,
      g.id,
      { clockRunning: false },
    );

    // The operator column should reflect the new running state.
    expect(updated.clockRunning).toBe(false);
    // The shot clock in stats should be frozen (running: false).
    const shot = (updated.stats as any)?.shotClock;
    expect(shot).toBeDefined();
    expect(shot.running).toBe(false);
  });

  it('ingest() segment change: resets and stops the clock like setSegment', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'football'); // countdown 12:00 = 720000ms
    // Operator has been running, clock at some mid-game value.
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 300_000 });

    // Integration reports period 2 (segment change).
    const updated: any = await service.ingest(TENANT, g.id, { segment: 2 });

    expect(updated.segment).toBe(2);
    // Clock should be reset to the segment start (12:00 = 720000 ms) and stopped.
    expect(updated.clockMs).toBe(12 * 60_000);
    expect(updated.clockRunning).toBe(false);
  });

  it('ingest() same segment: does not reset clock', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'football');
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 300_000 });

    // Integration reports same segment (no transition).
    const updated: any = await service.ingest(TENANT, g.id, { segment: 1 });

    // Clock should NOT have been reset — same segment = no side effect.
    expect(updated.clockMs).toBe(300_000);
    expect(updated.segment).toBe(1);
  });
});

describe('T1-1 — ingestCtsSnapshot() unified side effects', () => {
  // Helper: build a minimal CTS snapshot object.
  const snap = (fields: Record<string, unknown>) => ({ ...fields });

  it('CTS score bump: SCORE GameEvent is recorded', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'football'); // homeScore=0, awayScore=0

    // Seed prevCts so the "scoreChanged" guard detects a real transition.
    game.rows[0].stats = {
      cts: { homeScore: 7, awayScore: 0, lastUpdateAt: new Date().toISOString() },
    };

    // CTS reports home 7 → 8.
    await service.ingestCtsSnapshot(g.id, snap({ homeScore: 8, awayScore: 0 }), {
      tenantId: TENANT,
    });

    const scoreEvents = gameEvent.rows.filter((e: any) => e.type === 'SCORE');
    expect(scoreEvents).toHaveLength(1);
    expect(scoreEvents[0].payload).toMatchObject({
      team: 'cts',
      homeScore: 8,
      awayScore: 0,
      source: 'cts',
    });
  });

  it('CTS score bump: maybeAutoCelebrate fires (touchdown on +7)', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'football');

    // Prev CTS: homeScore was 7.
    game.rows[0].stats = {
      cts: { homeScore: 7, awayScore: 0, lastUpdateAt: new Date().toISOString() },
    };
    // Operator column also at 7 so the delta math works from prevScores.
    game.rows[0].homeScore = 7;

    // CTS reports home 7 → 14 (two TDs somehow — +7 delta from op column perspective).
    await service.ingestCtsSnapshot(g.id, snap({ homeScore: 14, awayScore: 0 }), {
      tenantId: TENANT,
    });

    const cueEvents = gameEvent.rows.filter((e: any) => e.type === 'CUE');
    expect(cueEvents.length).toBeGreaterThanOrEqual(1);
    const td = cueEvents.find((e: any) => e.payload?.key === 'touchdown');
    expect(td).toBeTruthy();
    expect(td.payload.auto).toBe(true);
    expect(td.payload.team).toBe('home');
  });

  it('CTS score bump: syncShotClockToGameClock is invoked on clockRunning flip', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');

    // Operator clock currently running; shot clock configured at 24s running.
    game.rows[0].clockRunning = true;
    game.rows[0].stats = {
      shotClock: { len: 24, ms: 20000, running: true, at: new Date().toISOString() },
      cts: { clockRunning: true, lastUpdateAt: new Date().toISOString() },
    };

    // CTS reports clock stopped.
    await service.ingestCtsSnapshot(g.id, snap({ clockRunning: false }), {
      tenantId: TENANT,
    });

    // The DB update should have written a stats object with shot clock frozen.
    // Verify via the game row (our in-memory fake applies the update in-place).
    const shotClock = (game.rows[0].stats as any)?.shotClock;
    expect(shotClock).toBeDefined();
    expect(shotClock.running).toBe(false);
  });

  it('CTS segment change: SEGMENT GameEvent is recorded', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');

    // Prev CTS: segment 1.
    game.rows[0].stats = {
      cts: { segment: 1, lastUpdateAt: new Date().toISOString() },
    };

    // CTS reports Q2.
    await service.ingestCtsSnapshot(g.id, snap({ segment: 2 }), {
      tenantId: TENANT,
    });

    const segEvents = gameEvent.rows.filter((e: any) => e.type === 'SEGMENT');
    expect(segEvents).toHaveLength(1);
    expect(segEvents[0].payload).toMatchObject({ segment: 2, source: 'cts' });
  });

  it('CTS re-send of same score: no duplicate SCORE event (idempotent)', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'football');

    // Prev CTS already at homeScore 7.
    game.rows[0].stats = {
      cts: { homeScore: 7, awayScore: 0, lastUpdateAt: new Date().toISOString() },
    };

    // CTS sends the same score twice (common at 5 Hz).
    await service.ingestCtsSnapshot(g.id, snap({ homeScore: 7, awayScore: 0 }), {
      tenantId: TENANT,
    });
    await service.ingestCtsSnapshot(g.id, snap({ homeScore: 7, awayScore: 0 }), {
      tenantId: TENANT,
    });

    const scoreEvents = gameEvent.rows.filter((e: any) => e.type === 'SCORE');
    expect(scoreEvents).toHaveLength(0); // no change → no event
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task A — AUTO celebration fires on EVERY CTS goal (not just the first).
//
// Regression lock for commit 01ee1637's CTS score write-through: because
// ingestCtsSnapshot now writes the console's score THROUGH to the operator
// homeScore/awayScore columns, the next snapshot's `prevScores` (read from
// those columns) is accurate, so maybeAutoCelebrate sees a +1 delta on each
// goal — and water polo's `goal` celebration (autoPoints:[1]) auto-fires
// every time, not only on goal #1.
// ─────────────────────────────────────────────────────────────────────────────

describe('Task A — CTS AUTO celebration fires on every goal', () => {
  // Auto CUE payloads produced by the CTS ingest path.
  const autoCues = (gameEvent: any) =>
    gameEvent.rows
      .filter((r: any) => r.type === 'CUE' && r.payload?.auto === true)
      .map((r: any) => r.payload);

  it('fires an AUTO goal CUE for EACH water-polo goal across 0-0 → 1-0 → 2-0 → 2-1', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'water_polo'); // 0-0, autoPoints goal:[1]

    // Drive the live CTS feed goal-by-goal. Each call is one console
    // snapshot; the write-through keeps game.homeScore/awayScore in sync so
    // the next snapshot's delta is a clean +1.
    await service.ingestCtsSnapshot(g.id, { homeScore: 1, awayScore: 0 }, {}); // 0-0 → 1-0
    await service.ingestCtsSnapshot(g.id, { homeScore: 2, awayScore: 0 }, {}); // 1-0 → 2-0
    await service.ingestCtsSnapshot(g.id, { homeScore: 2, awayScore: 1 }, {}); // 2-0 → 2-1

    // The operator columns tracked the console (write-through), proving the
    // prevScores delta math stayed correct goal over goal.
    expect(game.rows[0].homeScore).toBe(2);
    expect(game.rows[0].awayScore).toBe(1);

    // THREE goals → THREE auto-fired goal celebrations (NOT just the first).
    const fired = autoCues(gameEvent);
    expect(fired).toHaveLength(3);
    expect(fired.every((c: any) => c.key === 'goal')).toBe(true);
    // Two home goals, one away goal — each themed to the scoring side.
    expect(fired.filter((c: any) => c.team === 'home')).toHaveLength(2);
    expect(fired.filter((c: any) => c.team === 'away')).toHaveLength(1);
  });

  it('also fires every goal for soccer (goal autoPoints:[1]) across three +1 snapshots', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'soccer');

    await service.ingestCtsSnapshot(g.id, { homeScore: 1, awayScore: 0 }, {});
    await service.ingestCtsSnapshot(g.id, { homeScore: 1, awayScore: 1 }, {});
    await service.ingestCtsSnapshot(g.id, { homeScore: 2, awayScore: 1 }, {});

    expect(game.rows[0].homeScore).toBe(2);
    expect(game.rows[0].awayScore).toBe(1);
    const fired = autoCues(gameEvent);
    expect(fired).toHaveLength(3);
    expect(fired.every((c: any) => c.key === 'goal')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task D — /cts-cue-fired fabrication + replay guards (recordCueFired).
//
// The endpoint is PUBLIC + tokenless (the only legit caller is the ribbon
// render surface, which has no feed token), and it drives the sponsor
// proof-of-play report. recordCueFired must:
//   (a) DROP a fabricated / unknown cueId (kills made-up-id inflation);
//   (b) DEDUP a replayed (cueId, team) within the client cooldown;
//   (c) still record a legitimate distinct cue.
// ─────────────────────────────────────────────────────────────────────────────

describe('Task D — recordCueFired fabrication + replay guards', () => {
  const ctsCues = (gameEvent: any) =>
    gameEvent.rows.filter((r: any) => r.type === 'CTS_CUE').map((r: any) => r.payload);

  it('does NOT record a fabricated / unknown cueId', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'water_polo');

    await service.recordCueFired(g.id, {
      cueId: 'GOLAZO_FAKE_INFLATE', // not a real cue for this game
      team: 'home',
      source: 'auto',
    });

    expect(ctsCues(gameEvent)).toHaveLength(0);
  });

  it('records a legitimate cinematic catalog cue, then DEDUPS the immediate replay', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'water_polo');

    // First fire of a real cinematic cue (the GOLAZO scenario) — recorded.
    await service.recordCueFired(g.id, {
      cueId: 'CEL_SOCCER_GOLAZO',
      team: 'home',
      source: 'auto',
    });
    expect(ctsCues(gameEvent)).toHaveLength(1);

    // A replay flood of the SAME (cueId, team) within the cooldown — dropped.
    await service.recordCueFired(g.id, { cueId: 'CEL_SOCCER_GOLAZO', team: 'home', source: 'auto' });
    await service.recordCueFired(g.id, { cueId: 'CEL_SOCCER_GOLAZO', team: 'home', source: 'auto' });
    expect(ctsCues(gameEvent)).toHaveLength(1); // still just the one
  });

  it('records a legitimate DISTINCT cue (different team / different cue) — not deduped', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'water_polo');

    await service.recordCueFired(g.id, { cueId: 'CEL_SOCCER_GOAL', team: 'home', source: 'auto' });
    // Same cue, DIFFERENT team → distinct → recorded.
    await service.recordCueFired(g.id, { cueId: 'CEL_SOCCER_GOAL', team: 'away', source: 'auto' });
    // DIFFERENT cue, same team → distinct → recorded.
    await service.recordCueFired(g.id, { cueId: 'CEL_HOCKEY_GOAL', team: 'home', source: 'auto' });

    const fired = ctsCues(gameEvent);
    expect(fired).toHaveLength(3);
  });

  it('accepts a sport-specific celebration key (goal) as a known cue', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'water_polo'); // celebrations include 'goal'

    await service.recordCueFired(g.id, { cueId: 'goal', team: 'home', source: 'manual' });
    expect(ctsCues(gameEvent)).toHaveLength(1);

    // But a celebration key from a DIFFERENT sport is not a real cue here.
    await service.recordCueFired(g.id, { cueId: 'touchdown', team: 'home', source: 'manual' });
    expect(ctsCues(gameEvent)).toHaveLength(1); // touchdown dropped (not a water-polo cue)
  });

  it('accepts an operator custom cue (custom:<id>) scoped to the game tenant', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'water_polo');
    const cc: any = await service.createCue(TENANT, { name: 'Pool Supply Takeover' });

    await service.recordCueFired(g.id, { cueId: `custom:${cc.id}`, team: 'home', source: 'manual' });
    expect(ctsCues(gameEvent)).toHaveLength(1);

    // A made-up custom id that isn't in the tenant's cue deck is dropped.
    await service.recordCueFired(g.id, { cueId: 'custom:does-not-exist', team: 'home', source: 'manual' });
    expect(ctsCues(gameEvent)).toHaveLength(1);
  });

  it('no-ops on a non-existent game id (never writes an orphan row)', async () => {
    const { service, gameEvent } = setup();
    await service.recordCueFired('no-such-game', { cueId: 'CEL_SOCCER_GOAL', team: 'home', source: 'auto' });
    expect(ctsCues(gameEvent)).toHaveLength(0);
  });
});

// ── callTimeout ─────────────────────────────────────────────────

describe('SportsService — callTimeout', () => {
  it('decrements homeTimeouts and pauses the clock for basketball', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    // Basketball initializes with 5 timeouts per team.
    const prevTimeouts = Number((g.stats as any).homeTimeouts);
    expect(prevTimeouts).toBeGreaterThan(0);

    const res = await service.callTimeout(TENANT, g.id, { team: 'home' });

    expect(res.success).toBe(true);
    expect(res.team).toBe('home');
    expect(res.timeoutsRemaining).toBe(prevTimeouts - 1);

    // Stats were updated in the game row.
    expect((game.rows[0].stats as any).homeTimeouts).toBe(prevTimeouts - 1);

    // Clock was paused.
    expect(game.rows[0].clockRunning).toBe(false);

    // TIMEOUT GameEvent was recorded.
    const timeoutEvents = gameEvent.rows.filter((e: any) => e.type === 'TIMEOUT');
    expect(timeoutEvents).toHaveLength(1);
    expect(timeoutEvents[0].payload).toMatchObject({
      team: 'home',
      prevTimeoutsRemaining: prevTimeouts,
      newTimeoutsRemaining: prevTimeouts - 1,
    });

    // CUE event was also recorded for the overlay.
    const cueEvents = gameEvent.rows.filter((e: any) => e.type === 'CUE' && e.payload?.key === 'timeout');
    expect(cueEvents).toHaveLength(1);
    expect(cueEvents[0].payload).toMatchObject({ team: 'home', target: 'ALL' });
  });

  it('decrements awayTimeouts', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'basketball');
    const prevAway = Number((g.stats as any).awayTimeouts);

    const res = await service.callTimeout(TENANT, g.id, { team: 'away' });

    expect(res.team).toBe('away');
    expect(res.timeoutsRemaining).toBe(prevAway - 1);
    expect((game.rows[0].stats as any).awayTimeouts).toBe(prevAway - 1);
  });

  it('rejects BUG_NO_TIMEOUTS_LEFT when homeTimeouts is already 0', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'football');
    // Force to 0.
    game.rows[0].stats = { ...(game.rows[0].stats as any), homeTimeouts: 0 };

    await expect(
      service.callTimeout(TENANT, g.id, { team: 'home' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('resets football play clock to 25s on a timeout', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'football');
    // Football starts with 3 timeouts per team.
    expect((g.stats as any).homeTimeouts).toBe(3);

    await service.callTimeout(TENANT, g.id, { team: 'home' });

    const pc = (game.rows[0].stats as any)?.playClock;
    expect(pc).toBeDefined();
    expect(pc.ms).toBe(25_000);
    expect(pc.running).toBe(false);
  });

  it('is tenant-scoped (refuses cross-tenant call)', async () => {
    const { service } = setup();
    const g = await newGame(service, 'basketball');

    await expect(
      service.callTimeout('other-tenant', g.id, { team: 'home' }),
    ).rejects.toThrow(NotFoundException);
  });
});

// ── Undo rail — T1-2: getEvents + undoEvent ──────────────────

describe('SportsService — undo rail (getEvents)', () => {
  it('returns events in reverse-chronological order with undoable flag', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');

    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 });
    await service.clockAction(TENANT, g.id, { action: 'pause' });

    const events = await service.getEvents(TENANT, g.id, 25);
    // Most-recent first.
    expect(events[0].createdAt >= events[events.length - 1].createdAt).toBe(true);

    // SCORE events are undoable.
    const scoreEv = events.find((e) => e.type === 'SCORE');
    expect(scoreEv).toBeDefined();
    expect(scoreEv!.undoable).toBe(true);

    // Non-auto CLOCK events are undoable.
    const clockEv = events.find((e) => e.type === 'CLOCK' && !(e.payload as any).auto);
    expect(clockEv).toBeDefined();
    expect(clockEv!.undoable).toBe(true);
  });

  it('marks CUE events as non-undoable', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');

    // Write a CUE GameEvent row directly.
    await gameEvent.create({ data: { gameId: g.id, type: 'CUE', payload: { key: 'goal' } } });

    const events = await service.getEvents(TENANT, g.id, 25);
    const cueEv = events.find((e) => e.type === 'CUE');
    expect(cueEv).toBeDefined();
    expect(cueEv!.undoable).toBe(false);
    expect(cueEv!.nonUndoableReason).toBe('type');
  });

  it('marks auto-advance SEGMENT events as non-undoable', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');

    await gameEvent.create({
      data: { gameId: g.id, type: 'SEGMENT', payload: { segment: 2, auto: true } },
    });

    const events = await service.getEvents(TENANT, g.id, 25);
    const autoEv = events.find((e) => e.type === 'SEGMENT' && (e.payload as any).auto);
    expect(autoEv).toBeDefined();
    expect(autoEv!.undoable).toBe(false);
    expect(autoEv!.nonUndoableReason).toBe('system');
  });

  it('throws NotFoundException for an unknown game', async () => {
    const { service } = setup();
    await expect(service.getEvents(TENANT, 'no-such-game', 25)).rejects.toThrow(NotFoundException);
  });
});

describe('SportsService — undo rail (undoEvent)', () => {
  it('inverts a SCORE event and records UNDO_SCORE', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');

    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 });
    const scoreRow = gameEvent.rows.find((r: any) => r.type === 'SCORE');
    expect(scoreRow).toBeDefined();

    await service.undoEvent(TENANT, g.id, scoreRow.id);

    const undoRow = gameEvent.rows.find((r: any) => r.type === 'UNDO_SCORE');
    expect(undoRow).toBeDefined();
    expect(undoRow.payload.undoOf).toBe(scoreRow.id);
  });

  it('inverts a STAT event using oldValues and records UNDO_STAT', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');

    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 3 } });
    const statEv = gameEvent.rows.find((r: any) => r.type === 'STAT');
    expect(statEv).toBeDefined();
    expect((statEv.payload as any).oldValues).toBeDefined();

    await service.undoEvent(TENANT, g.id, statEv.id);
    const undoRow = gameEvent.rows.find((r: any) => r.type === 'UNDO_STAT');
    expect(undoRow).toBeDefined();
    expect(undoRow.payload.undoOf).toBe(statEv.id);
  });

  it('returns 422 BUG_NOT_UNDOABLE for a CUE event', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');

    const cueRow = await gameEvent.create({
      data: { gameId: g.id, type: 'CUE', payload: { key: 'goal' } },
    });

    await expect(service.undoEvent(TENANT, g.id, cueRow.id)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('returns 422 BUG_NOT_UNDOABLE for a system auto-advance event', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');

    const autoRow = await gameEvent.create({
      data: { gameId: g.id, type: 'SEGMENT', payload: { segment: 2, auto: true } },
    });

    await expect(service.undoEvent(TENANT, g.id, autoRow.id)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('returns 422 BUG_NOT_UNDOABLE for a pre-rail SCORE event lacking prevHomeScore', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');

    // Simulate an old event without prev* fields.
    const oldScoreRow = await gameEvent.create({
      data: {
        gameId: g.id,
        type: 'SCORE',
        payload: { team: 'set', homeScore: 7, awayScore: 3 },
      },
    });

    await expect(service.undoEvent(TENANT, g.id, oldScoreRow.id)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('returns 404 for an event that belongs to a different game', async () => {
    const { service, gameEvent } = setup();
    const g1: any = await newGame(service, 'basketball');
    const g2: any = await newGame(service, 'basketball');

    await service.adjustScore(TENANT, g1.id, { team: 'home', delta: 1 });
    const ev = gameEvent.rows.find((r: any) => r.type === 'SCORE');

    // Try to undo g1's event against g2 — should 404.
    await expect(service.undoEvent(TENANT, g2.id, ev.id)).rejects.toThrow(NotFoundException);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2-7: Football play clock slaved to game clock
// Verifies that syncPlayClockToGameClock fires correctly from every call site.
// ─────────────────────────────────────────────────────────────────────────────

describe('T2-7 — football play clock slaved to game clock', () => {
  /**
   * Helper: seed a football game with a configured play clock in stats.
   * Returns the game row AND the service/game table so tests can inspect
   * the in-memory DB state after mutations.
   */
  async function footballWithPlayClock(
    service: SportsService,
    gameTable: ReturnType<typeof makeTable>,
    playClockMs = 40_000,
    playClockRunning = true,
  ) {
    const g: any = await newGame(service, 'football');
    gameTable.rows[0].stats = {
      ...(gameTable.rows[0].stats ?? {}),
      playClock: { ms: playClockMs, at: new Date().toISOString(), running: playClockRunning },
    };
    return g;
  }

  it('game clock pause freezes a running football play clock', async () => {
    const { service, game } = setup();
    await footballWithPlayClock(service, game, 35_000, true);
    const g: any = game.rows[0];

    await service.clockAction(TENANT, g.id, { action: 'pause' });

    const pc = (game.rows[0].stats as any)?.playClock;
    expect(pc).toBeDefined();
    expect(pc.running).toBe(false);
    // ms should be ≤ the original 35s (any elapsed time ticks it down).
    expect(pc.ms).toBeLessThanOrEqual(35_000);
    expect(pc.ms).toBeGreaterThanOrEqual(0);
  });

  it('game clock start re-anchors and runs a frozen football play clock', async () => {
    const { service, game } = setup();
    // Play clock frozen at 28s (after a stoppage the operator reset it but
    // hasn't started the game clock yet).
    await footballWithPlayClock(service, game, 28_000, false);
    const g: any = game.rows[0];
    // Game clock is currently stopped.
    game.rows[0].clockRunning = false;

    await service.clockAction(TENANT, g.id, { action: 'start' });

    const pc = (game.rows[0].stats as any)?.playClock;
    expect(pc).toBeDefined();
    expect(pc.running).toBe(true);
    // ms should still be ~28s (it was frozen, no elapsed time).
    expect(pc.ms).toBeLessThanOrEqual(28_000);
    expect(pc.ms).toBeGreaterThan(0);
  });

  it('game clock start with an expired play clock resets to 40s', async () => {
    const { service, game } = setup();
    // Play clock already at 0 — operator forgot to reset between plays.
    await footballWithPlayClock(service, game, 0, false);
    const g: any = game.rows[0];
    game.rows[0].clockRunning = false;

    await service.clockAction(TENANT, g.id, { action: 'start' });

    const pc = (game.rows[0].stats as any)?.playClock;
    expect(pc).toBeDefined();
    expect(pc.running).toBe(true);
    expect(pc.ms).toBe(40_000); // auto-reset to the standard fresh-snap duration
  });

  it('segment advance resets the football play clock to 40s (stopped)', async () => {
    const { service, game } = setup();
    await footballWithPlayClock(service, game, 22_000, true);
    const g: any = game.rows[0];
    // Advance from Q1 to Q2.
    await service.setSegment(TENANT, g.id, { delta: 1 });

    const pc = (game.rows[0].stats as any)?.playClock;
    expect(pc).toBeDefined();
    expect(pc.ms).toBe(40_000);
    expect(pc.running).toBe(false);
  });

  it('callTimeout resets football play clock to 25s (stopped)', async () => {
    const { service, game } = setup();
    await footballWithPlayClock(service, game, 38_000, true);
    const g: any = game.rows[0];
    // Give the team timeouts so the call doesn't throw.
    game.rows[0].stats = { ...(game.rows[0].stats as any), homeTimeouts: 3 };

    await service.callTimeout(TENANT, g.id, { team: 'home' });

    const pc = (game.rows[0].stats as any)?.playClock;
    expect(pc).toBeDefined();
    expect(pc.ms).toBe(25_000); // stoppage duration
    expect(pc.running).toBe(false);
  });

  it('non-football game (basketball) is not affected by syncPlayClockToGameClock', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'basketball');
    // Seed a shot clock to confirm shot-clock sync still works; no play clock.
    game.rows[0].stats = {
      shotClock: { len: 24, ms: 20_000, running: true, at: new Date().toISOString() },
    };
    game.rows[0].clockRunning = true;

    await service.clockAction(TENANT, g.id, { action: 'pause' });

    // Shot clock should be frozen (existing behaviour).
    const sc = (game.rows[0].stats as any)?.shotClock;
    expect(sc?.running).toBe(false);
    // No playClock key should appear (it was never seeded).
    const pc = (game.rows[0].stats as any)?.playClock;
    expect(pc).toBeUndefined();
  });

  it('football game without a play clock configured is a no-op (backwards compat)', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'football');
    // stats without playClock key.
    game.rows[0].stats = { homeTimeouts: 3, awayTimeouts: 3 };
    game.rows[0].clockRunning = false;

    // Should not throw and should not add a playClock entry.
    await service.clockAction(TENANT, g.id, { action: 'start' });
    const pc = (game.rows[0].stats as any)?.playClock;
    expect(pc).toBeUndefined();
  });
});

// ── T2-1: CTS full-fidelity — cleanCtsSnapshot accepts new fields ─

describe('SportsService — ingestCtsSnapshot T2-1 fields', () => {
  it('cleanCtsSnapshot accepts per-side shot clocks and writes them to stats.cts', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'water_polo');

    await service.ingestCtsSnapshot(
      g.id,
      {
        clockMs: 420000,
        clockRunning: true,
        homeScore: 3,
        awayScore: 2,
        segment: 2,
        homeShotClock: { ms: 18000, running: true, raw: '18' },
        awayShotClock: { ms: 24000, running: true, raw: '24' },
      },
      { tenantId: TENANT },
    );

    const updated = game.rows.find((r: any) => r.id === g.id);
    const cts = (updated.stats as any).cts;
    expect(cts).toBeDefined();
    expect(cts.homeShotClock).toMatchObject({ ms: 18000, running: true, raw: '18' });
    expect(cts.awayShotClock).toMatchObject({ ms: 24000, running: true, raw: '24' });
  });

  it('cleanCtsSnapshot accepts exclusions and merges them into stats.penalties', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'water_polo');

    await service.ingestCtsSnapshot(
      g.id,
      {
        clockMs: 300000,
        clockRunning: true,
        homeScore: 1,
        awayScore: 0,
        segment: 1,
        homeExclusions: [
          { playerJersey: 7, secondsRemaining: 15 },
          null,
          null,
        ],
        awayExclusions: [null, null, null],
        homeTimeoutsRemaining: 1,
        awayTimeoutsRemaining: 2,
      },
      { tenantId: TENANT },
    );

    const updated = game.rows.find((r: any) => r.id === g.id);
    const stats = updated.stats as any;

    // Exclusion should appear in stats.penalties with source: 'cts'.
    expect(Array.isArray(stats.penalties)).toBe(true);
    const ctsPenalty = stats.penalties.find(
      (p: any) => p.source === 'cts' && p.team === 'home',
    );
    expect(ctsPenalty).toBeDefined();
    expect(ctsPenalty.playerJersey).toBe(7);
    expect(ctsPenalty.secondsRemaining).toBe(15);

    // Timeouts should appear in stats.homeTimeouts / awayTimeouts.
    expect(stats.homeTimeouts).toBe(1);
    expect(stats.awayTimeouts).toBe(2);

    // stats.cts should also carry the exclusion arrays and timeouts.
    const cts = stats.cts;
    expect(cts.homeExclusions).toBeDefined();
    expect(cts.homeTimeoutsRemaining).toBe(1);
    expect(cts.awayTimeoutsRemaining).toBe(2);
  });

  it('cleanCtsSnapshot silently drops T2-1 fields from an older bridge (missing fields)', async () => {
    // An older bridge that sends only the original 7 fields must still work.
    const { service, game } = setup();
    const g: any = await newGame(service, 'water_polo');

    await service.ingestCtsSnapshot(
      g.id,
      {
        clockMs: 240000,
        clockRunning: false,
        homeScore: 0,
        awayScore: 0,
        segment: 1,
        horn: false,
        raw: '4:00',
        // No homeShotClock / awayShotClock / exclusions / timeouts.
      },
      { tenantId: TENANT },
    );

    const updated = game.rows.find((r: any) => r.id === g.id);
    const cts = (updated.stats as any).cts;
    expect(cts.clockMs).toBe(240000);
    // T2-1 fields should simply be absent — no crash.
    expect(cts.homeShotClock).toBeUndefined();
    expect(cts.awayShotClock).toBeUndefined();
    expect(cts.homeExclusions).toBeUndefined();
  });
});
