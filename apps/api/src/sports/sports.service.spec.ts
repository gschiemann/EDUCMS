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
    create: async ({ data }: any) => {
      const row = { id: `id-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data };
      rows.push(row);
      return row;
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
  const prisma = { client: { game, gameEvent, screen, sponsor } };
  const redis = { publish: jest.fn().mockResolvedValue(undefined) };
  const signer = { signMessage: jest.fn(() => ({ eventId: 'e', signature: 's' })) };
  const service = new SportsService(prisma as any, redis as any, signer as any);
  return { service, game, gameEvent, screen, sponsor, redis, signer };
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
