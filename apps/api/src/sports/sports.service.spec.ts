/**
 * VenueOS Sports — SportsService tests.
 *
 * Exercises the game engine against an in-memory Prisma fake: game
 * CRUD, the clock-as-anchor math, scoring (incl. the atomic-increment
 * fix), segment advance (incl. the count-up re-anchor fix), stat
 * bounding, cues, and the scoreboard-to-screen push. No DB required.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where || {})),
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
  const prisma = { client: { game, gameEvent, screen, sponsor, rosterPlayer, customCue } };
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
  return { service, game, gameEvent, screen, sponsor, rosterPlayer, customCue, redis, signer };
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
});
