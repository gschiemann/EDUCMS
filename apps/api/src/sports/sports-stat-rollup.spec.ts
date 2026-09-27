/**
 * K12-F39 — final-stat aggregation is recoverable and correction-aware.
 *
 * Acceptance (audit register): "Fail aggregation after FINAL, restart workers
 * and recover exactly once. Correct a finalized game and verify player/team
 * season totals are rebuilt for the new result revision."
 *
 * Part 1 drives applyGameStatRollup directly over the in-memory Prisma double
 * (sports-prisma-fake.ts: per-transaction rollback, compound unique keys) —
 * including every scenario the old finalizeGameStats suite covered. Part 2
 * drives the real SportsService: the FINAL command queues the job, the
 * post-commit hook / retry sweep / administrator retry apply it, and a reopen
 * + correction + FINAL rolls up the difference.
 */
import { makeSportsPrismaFake } from './sports-prisma-fake';
import {
  STAT_ROLLUP_STATE,
  applyGameStatRollup,
  computeGameContribution,
  deriveSeason,
} from './sports-stats.service';
import { TENANT, setup, newGame } from './sports-test-harness';

const T = 'tenant-fz';
const SEASON = '2025-26'; // a December 2025 game → the 2025-26 academic season

function db() {
  const { client, tables } = makeSportsPrismaFake({
    game: {},
    rosterPlayer: {},
    gameStatRollup: { pk: 'gameId' },
    playerSeasonStat: { uniques: [['personId', 'season', 'statKey', 'sport']] },
    playerCareerStat: { uniques: [['personId', 'statKey', 'sport']] },
  });
  let rp = 0;
  const addGame = (id: string, over: Record<string, unknown> = {}) =>
    tables.game.rows.push({
      id,
      tenantId: T,
      sport: 'basketball',
      status: 'FINAL',
      version: 3,
      stats: {},
      startedAt: new Date('2025-12-01T19:00:00Z'),
      createdAt: new Date('2025-11-01T00:00:00Z'),
      ...over,
    });
  const addPlayer = (
    gameId: string,
    personId: string | null,
    stats: Record<string, string>,
    teamId: string | null = null,
  ) => {
    const row = {
      id: `rp-${++rp}`,
      tenantId: T,
      gameId,
      personId,
      teamId,
      team: 'home',
      stats,
    };
    tables.rosterPlayer.rows.push(row);
    return row;
  };
  const queue = (
    gameId: string,
    revision = 3,
    over: Record<string, unknown> = {},
  ) =>
    tables.gameStatRollup.rows.push({
      gameId,
      tenantId: T,
      state: STAT_ROLLUP_STATE.PENDING,
      targetRevision: revision,
      appliedRevision: null,
      contribution: [],
      attempts: 0,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    });
  const season = (personId: string, statKey: string, s = SEASON) =>
    tables.playerSeasonStat.rows.find(
      (r: any) =>
        r.personId === personId && r.statKey === statKey && r.season === s,
    );
  const career = (personId: string, statKey: string) =>
    tables.playerCareerStat.rows.find(
      (r: any) => r.personId === personId && r.statKey === statKey,
    );
  const job = (gameId: string) =>
    tables.gameStatRollup.rows.find((r: any) => r.gameId === gameId);
  return { client, tables, addGame, addPlayer, queue, season, career, job };
}

describe('applyGameStatRollup — the roll-up itself', () => {
  it('rolls linked players COUNTING stats into season + career and records what it applied', async () => {
    const d = db();
    d.addGame('game-1');
    d.addPlayer('game-1', 'p-1', { PTS: '24', REB: '10', AST: '5' }, 'team-1');
    d.addPlayer('game-1', 'p-2', { PTS: '12', REB: '8' }, 'team-1');
    d.queue('game-1', 3);

    const res = await applyGameStatRollup(d.client, T, 'game-1');
    expect(res).toMatchObject({ applied: true, aggregated: 2, revision: 3 });
    expect(d.season('p-1', 'PTS')).toMatchObject({
      statValue: 24,
      gamesPlayed: 1,
      displayValue: '24',
      teamId: 'team-1',
    });
    expect(d.career('p-1', 'PTS')).toMatchObject({
      statValue: 24,
      gamesPlayed: 1,
    });
    expect(d.season('p-2', 'PTS')?.statValue).toBe(12);
    expect(d.job('game-1')).toMatchObject({
      state: 'APPLIED',
      appliedRevision: 3,
      lastError: null,
    });
    expect(d.job('game-1').contribution).toHaveLength(5);
    // The old marker-in-game.stats is gone: the job row is the record.
    expect(d.tables.game.rows[0].stats).toEqual({});
  });

  it('accumulates two games into the same season + career rows', async () => {
    const d = db();
    d.addGame('game-1');
    d.addGame('game-2', { startedAt: new Date('2025-12-08T19:00:00Z') });
    d.addPlayer('game-1', 'p-1', { PTS: '20' });
    d.addPlayer('game-2', 'p-1', { PTS: '15' });
    d.queue('game-1');
    d.queue('game-2');
    await applyGameStatRollup(d.client, T, 'game-1');
    await applyGameStatRollup(d.client, T, 'game-2');
    expect(d.season('p-1', 'PTS')).toMatchObject({
      statValue: 35,
      gamesPlayed: 2,
    });
    expect(d.career('p-1', 'PTS')).toMatchObject({
      statValue: 35,
      gamesPlayed: 2,
    });
  });

  it('resolves LONG/lowercase stored keys (CSV/seed rosters) and never mis-reads another stat', async () => {
    const d = db();
    d.addGame('game-1', { sport: 'water_polo' });
    d.addPlayer(
      'game-1',
      'p-1',
      { goals: '4', assists: '2', steals: '3', drawn: '5' },
      'team-1',
    );
    d.queue('game-1');
    await applyGameStatRollup(d.client, T, 'game-1');
    expect(d.season('p-1', 'G')?.statValue).toBe(4);
    expect(d.season('p-1', 'A')?.statValue).toBe(2);
    expect(d.season('p-1', 'ST')?.statValue).toBe(3);
    expect(d.career('p-1', 'G')?.statValue).toBe(4);
    expect(d.season('p-1', 'EXC')).toBeUndefined();
  });

  it('never sums rate stats (baseball AVG is per game)', async () => {
    const d = db();
    d.addGame('game-1', { sport: 'baseball' });
    d.addPlayer('game-1', 'p-1', { AVG: '.312', H: '3', HR: '1', RBI: '2' });
    d.queue('game-1');
    await applyGameStatRollup(d.client, T, 'game-1');
    expect(d.season('p-1', 'H')?.statValue).toBe(3);
    expect(d.season('p-1', 'RBI')?.statValue).toBe(2);
    expect(d.season('p-1', 'AVG')).toBeUndefined();
  });

  it('skips an unparseable value, ignores unlinked players (opponents, typos)', async () => {
    const d = db();
    d.addGame('game-1');
    d.addPlayer('game-1', 'p-1', { PTS: 'DNP', REB: '7' });
    d.addPlayer('game-1', null, { PTS: '99' });
    d.queue('game-1');
    const res = await applyGameStatRollup(d.client, T, 'game-1');
    expect(res.aggregated).toBe(1);
    expect(d.season('p-1', 'PTS')).toBeUndefined();
    expect(d.season('p-1', 'REB')?.statValue).toBe(7);
    expect(
      d.tables.playerSeasonStat.rows.some((r: any) => r.statValue === 99),
    ).toBe(false);
  });

  it('re-applying an applied revision is a no-op — nothing is counted twice', async () => {
    const d = db();
    d.addGame('game-1');
    d.addPlayer('game-1', 'p-1', { PTS: '30' });
    d.queue('game-1');
    await applyGameStatRollup(d.client, T, 'game-1');
    const again = await applyGameStatRollup(d.client, T, 'game-1');
    expect(again).toMatchObject({ applied: false, skipped: 'already-applied' });
    expect(d.season('p-1', 'PTS')).toMatchObject({
      statValue: 30,
      gamesPlayed: 1,
    });
    expect(d.career('p-1', 'PTS')?.statValue).toBe(30);
  });

  it('a corrected result at a new revision moves the totals by the DIFFERENCE', async () => {
    const d = db();
    d.addGame('game-1');
    d.addGame('game-2', { startedAt: new Date('2025-12-08T19:00:00Z') });
    const p1 = d.addPlayer('game-1', 'p-1', { PTS: '24', REB: '10' });
    const p2 = d.addPlayer('game-1', 'p-2', { PTS: '8' });
    d.addPlayer('game-2', 'p-1', { PTS: '15' });
    d.queue('game-1', 3);
    d.queue('game-2', 5);
    await applyGameStatRollup(d.client, T, 'game-1');
    await applyGameStatRollup(d.client, T, 'game-2');
    expect(d.season('p-1', 'PTS')?.statValue).toBe(39);

    // The correction: p-1 scored 30 not 24, the rebounds were someone else's,
    // p-2 did not play (unlinked); FINAL again at revision 9.
    p1.stats = { PTS: '30' };
    p2.personId = null;
    const j = d.job('game-1');
    j.state = STAT_ROLLUP_STATE.PENDING;
    j.targetRevision = 9;

    const res = await applyGameStatRollup(d.client, T, 'game-1');
    expect(res).toMatchObject({ applied: true, revision: 9 });
    expect(d.season('p-1', 'PTS')).toMatchObject({
      statValue: 45,
      gamesPlayed: 2,
    }); // 30 + 15
    expect(d.career('p-1', 'PTS')).toMatchObject({
      statValue: 45,
      gamesPlayed: 2,
    });
    // Rows no game contributes to any more are removed, not left at 0.
    expect(d.season('p-1', 'REB')).toBeUndefined();
    expect(d.career('p-1', 'REB')).toBeUndefined();
    expect(d.season('p-2', 'PTS')).toBeUndefined();
    expect(d.job('game-1')).toMatchObject({
      state: 'APPLIED',
      appliedRevision: 9,
    });
  });

  it('a failure part-way changes NO total and leaves the job to be retried', async () => {
    const d = db();
    d.addGame('game-1');
    d.addPlayer('game-1', 'p-1', { PTS: '24', REB: '10' });
    d.queue('game-1');
    const realUpsert = d.tables.playerCareerStat.upsert;
    d.tables.playerCareerStat.upsert = async () => {
      throw new Error('simulated storage failure');
    };
    await expect(applyGameStatRollup(d.client, T, 'game-1')).rejects.toThrow(
      'simulated storage failure',
    );
    expect(d.tables.playerSeasonStat.rows).toHaveLength(0);
    expect(d.job('game-1')).toMatchObject({
      state: 'PENDING',
      attempts: 0,
      appliedRevision: null,
    });

    d.tables.playerCareerStat.upsert = realUpsert;
    await applyGameStatRollup(d.client, T, 'game-1');
    expect(d.season('p-1', 'PTS')?.statValue).toBe(24);
  });

  it('two appliers at once (hook on one replica, sweep on another) apply it exactly once', async () => {
    const d = db();
    d.addGame('game-1');
    d.addPlayer('game-1', 'p-1', { PTS: '24' });
    d.queue('game-1');
    // Both read the job before either claims it.
    const live = d.tables.gameStatRollup.findFirst;
    let reads = 0;
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    d.tables.gameStatRollup.findFirst = async (args: any) => {
      const row = await live(args);
      const copy = row ? { ...row } : row;
      if (reads < 2) {
        reads += 1;
        if (reads === 2) open();
        await gate;
      }
      return copy;
    };
    const results = await Promise.all([
      applyGameStatRollup(d.client, T, 'game-1'),
      applyGameStatRollup(d.client, T, 'game-1'),
    ]);
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(results.find((r) => !r.applied)).toMatchObject({ skipped: 'busy' });
    expect(d.season('p-1', 'PTS')).toMatchObject({
      statValue: 24,
      gamesPlayed: 1,
    });
  });

  it('a job whose game was reopened meanwhile is held, not applied', async () => {
    const d = db();
    d.addGame('game-1', { status: 'LIVE' });
    d.addPlayer('game-1', 'p-1', { PTS: '24' });
    d.queue('game-1');
    const res = await applyGameStatRollup(d.client, T, 'game-1');
    expect(res).toMatchObject({ applied: false, skipped: 'not-final' });
    expect(d.job('game-1').state).toBe('REOPENED');
    expect(d.tables.playerSeasonStat.rows).toHaveLength(0);
  });

  it('a game rolled up by the OLD finalize (marker, no baseline) is never added a second time', async () => {
    const d = db();
    d.addGame('game-1', {
      stats: { statsFinalizedAt: '2026-01-01T00:00:00.000Z' },
    });
    d.addPlayer('game-1', 'p-1', { PTS: '24' });
    d.tables.playerSeasonStat.rows.push({
      id: 'old',
      tenantId: T,
      personId: 'p-1',
      sport: 'basketball',
      season: SEASON,
      statKey: 'PTS',
      statValue: 24,
      gamesPlayed: 1,
      displayValue: '24',
      teamId: null,
      lastGameId: 'game-1',
    });
    d.queue('game-1');
    await applyGameStatRollup(d.client, T, 'game-1');
    expect(d.season('p-1', 'PTS')).toMatchObject({
      statValue: 24,
      gamesPlayed: 1,
    });
    expect(d.job('game-1')).toMatchObject({ state: 'APPLIED' });
    expect(d.job('game-1').contribution).toEqual([
      expect.objectContaining({ personId: 'p-1', statKey: 'PTS', value: 24 }),
    ]);
  });

  it('tenant-scoped: another tenant, a missing job and bad input do nothing', async () => {
    const d = db();
    d.addGame('game-1');
    d.addPlayer('game-1', 'p-1', { PTS: '24' });
    d.queue('game-1');
    expect(
      await applyGameStatRollup(d.client, 'other-tenant', 'game-1'),
    ).toMatchObject({ applied: false, skipped: 'no-job' });
    expect(
      await applyGameStatRollup(d.client, T, 'no-such-game'),
    ).toMatchObject({ applied: false, skipped: 'no-job' });
    await expect(applyGameStatRollup(d.client, '', 'game-1')).rejects.toThrow(
      /tenantId/,
    );
    await expect(applyGameStatRollup(d.client, T, '')).rejects.toThrow(
      /gameId/,
    );
    expect(d.tables.playerSeasonStat.rows).toHaveLength(0);
  });
});

// ── Part 2: the engine around it ────────────────────────────────────────

/** A basketball game with one linked home player, ready to go FINAL. */
async function liveGameWithPlayer(pts: string) {
  const h = setup({ playerStats: true });
  const g: any = await newGame(h.service, 'basketball');
  await h.service.setStatus(TENANT, g.id, { status: 'LIVE' });
  const p: any = await h.service.addPlayer(TENANT, g.id, {
    name: 'Sam',
    number: '12',
    stats: { PTS: pts },
  });
  h.rosterPlayer.rows.find((r: any) => r.id === p.id).personId = 'person-sam';
  const season = () => deriveSeason(h.game.rows[0]);
  const seasonRow = () =>
    h.tables.playerSeasonStat.rows.find(
      (r: any) =>
        r.personId === 'person-sam' &&
        r.statKey === 'PTS' &&
        r.season === season(),
    );
  const job = () =>
    h.tables.gameStatRollup.rows.find((r: any) => r.gameId === g.id);
  return { ...h, g, p, seasonRow, job };
}

describe('K12-F39 — the FINAL command queues the roll-up; the engine applies it', () => {
  it('FINAL queues the job at the final revision and applies it after commit', async () => {
    const h = await liveGameWithPlayer('24');
    await h.service.setStatus(TENANT, h.g.id, { status: 'FINAL' }, 'admin-1');
    expect(h.job()).toMatchObject({
      state: 'APPLIED',
      appliedRevision: h.game.rows[0].version,
    });
    expect(h.seasonRow()).toMatchObject({ statValue: 24, gamesPlayed: 1 });
    const view: any = await h.service.getGame(TENANT, h.g.id);
    expect(view.statRollup).toMatchObject({ state: 'APPLIED' });
  });

  it('fails after FINAL, then a restarted worker recovers it EXACTLY once', async () => {
    const h = await liveGameWithPlayer('24');
    const realUpsert = h.tables.playerSeasonStat.upsert;
    h.tables.playerSeasonStat.upsert = async () => {
      throw new Error('simulated storage failure');
    };
    const errors = jest
      .spyOn((h.service as any).logger, 'error')
      .mockImplementation(() => undefined);

    // "End game" still succeeds — the roll-up failure is recorded on the job.
    await h.service.setStatus(TENANT, h.g.id, { status: 'FINAL' }, 'admin-1');
    expect(h.game.rows[0].status).toBe('FINAL');
    expect(h.job()).toMatchObject({
      state: 'FAILED',
      attempts: 1,
      lastError: 'simulated storage failure',
    });
    expect(h.seasonRow()).toBeUndefined();
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('stat roll-up FAILED'),
    );
    const view: any = await h.service.getGame(TENANT, h.g.id);
    expect(view.statRollup).toMatchObject({ state: 'FAILED', attempts: 1 });

    // Storage is back; the sweep on a restarted worker picks it up (after
    // the back-off) — and a second sweep, or a second replica, adds nothing.
    h.tables.playerSeasonStat.upsert = realUpsert;
    const later = Date.now() + 5 * 60_000;
    await h.service.sweepStatRollups(later);
    await h.service.sweepStatRollups(later + 60 * 60_000);
    expect(h.seasonRow()).toMatchObject({ statValue: 24, gamesPlayed: 1 });
    expect(h.job()).toMatchObject({ state: 'APPLIED', lastError: null });
  });

  it('a job whose post-commit hook never ran (process died after commit) is recovered by the sweep', async () => {
    const h = await liveGameWithPlayer('24');
    const realRun = (h.service as any).runStatRollup;
    (h.service as any).runStatRollup = async () => undefined; // the process dies here
    await h.service.setStatus(TENANT, h.g.id, { status: 'FINAL' }, 'admin-1');
    (h.service as any).runStatRollup = realRun;
    expect(h.job()).toMatchObject({ state: 'PENDING' });

    // Inside the grace period the hook may still be running: left alone.
    await h.service.sweepStatRollups(Date.now());
    expect(h.seasonRow()).toBeUndefined();

    await h.service.sweepStatRollups(Date.now() + 60_000);
    await h.service.sweepStatRollups(Date.now() + 120_000);
    expect(h.seasonRow()).toMatchObject({ statValue: 24, gamesPlayed: 1 });
  });

  it('correct a finalized game: reopen → fix → FINAL rebuilds the totals for the NEW revision', async () => {
    const h = await liveGameWithPlayer('24');
    await h.service.setStatus(TENANT, h.g.id, { status: 'FINAL' }, 'admin-1');
    const firstRevision = h.job().appliedRevision;
    expect(h.seasonRow()?.statValue).toBe(24);

    await h.service.reopenGame(
      TENANT,
      h.g.id,
      { reason: 'Scorebook shows 30 points' },
      'admin-1',
    );
    // While reopened the totals still show the last FINAL result.
    expect(h.seasonRow()?.statValue).toBe(24);
    await h.service.updatePlayer(
      TENANT,
      h.g.id,
      h.p.id,
      { stats: { PTS: '30' } },
      'admin-1',
    );
    await h.service.setStatus(TENANT, h.g.id, { status: 'FINAL' }, 'admin-1');

    expect(h.seasonRow()).toMatchObject({ statValue: 30, gamesPlayed: 1 });
    expect(h.job().appliedRevision).toBe(h.game.rows[0].version);
    expect(h.job().appliedRevision).toBeGreaterThan(firstRevision);
  });

  it('reopened BEFORE its roll-up applied: held, then rolled up once at the corrected FINAL', async () => {
    const h = await liveGameWithPlayer('24');
    const realRun = (h.service as any).runStatRollup;
    (h.service as any).runStatRollup = async () => undefined;
    await h.service.setStatus(TENANT, h.g.id, { status: 'FINAL' }, 'admin-1');
    (h.service as any).runStatRollup = realRun;

    await h.service.reopenGame(
      TENANT,
      h.g.id,
      { reason: 'Wrong player credited' },
      'admin-1',
    );
    expect(h.job().state).toBe('REOPENED');
    await h.service.sweepStatRollups(Date.now() + 10 * 60_000);
    expect(h.seasonRow()).toBeUndefined();

    await h.service.updatePlayer(
      TENANT,
      h.g.id,
      h.p.id,
      { stats: { PTS: '18' } },
      'admin-1',
    );
    await h.service.setStatus(TENANT, h.g.id, { status: 'FINAL' }, 'admin-1');
    expect(h.seasonRow()).toMatchObject({ statValue: 18, gamesPlayed: 1 });
  });

  it('a game rolled up by the OLD finalize gets a baseline at reopen, so the correction is not added twice', async () => {
    const h = await liveGameWithPlayer('24');
    // What the old finalize left behind: FINAL, a marker, a season row, no job.
    const row = h.game.rows[0];
    row.status = 'FINAL';
    row.stats = { ...row.stats, statsFinalizedAt: '2026-05-01T00:00:00.000Z' };
    h.tables.playerSeasonStat.rows.push({
      id: 'legacy',
      tenantId: TENANT,
      personId: 'person-sam',
      sport: 'basketball',
      season: deriveSeason(row),
      statKey: 'PTS',
      statValue: 24,
      gamesPlayed: 1,
      displayValue: '24',
      teamId: null,
      lastGameId: h.g.id,
    });

    await h.service.reopenGame(
      TENANT,
      h.g.id,
      { reason: 'Scorebook shows 30 points' },
      'admin-1',
    );
    expect(h.job()).toMatchObject({ state: 'APPLIED' });
    expect(h.job().contribution).toEqual([
      expect.objectContaining({ personId: 'person-sam', value: 24 }),
    ]);

    await h.service.updatePlayer(
      TENANT,
      h.g.id,
      h.p.id,
      { stats: { PTS: '30' } },
      'admin-1',
    );
    await h.service.setStatus(TENANT, h.g.id, { status: 'FINAL' }, 'admin-1');
    expect(h.seasonRow()).toMatchObject({ statValue: 30, gamesPlayed: 1 });
  });

  it('a set-majority FINAL (volleyball 3 sets) queues the roll-up too', async () => {
    const h = setup({ playerStats: true });
    const g: any = await newGame(h.service, 'volleyball');
    await h.service.setStatus(TENANT, g.id, { status: 'LIVE' });
    for (let set = 0; set < 3; set++) {
      await h.service.setScore(TENANT, g.id, { homeScore: 24, awayScore: 10 });
      await h.service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    }
    expect(h.game.rows[0].status).toBe('FINAL');
    expect(
      h.tables.gameStatRollup.rows.find((r: any) => r.gameId === g.id),
    ).toBeDefined();
  });

  it('player stats off for the tenant: the job is marked SKIPPED, never retried', async () => {
    const h = await liveGameWithPlayer('24');
    h.flags.isEnabledAsync = async () => false;
    await h.service.setStatus(TENANT, h.g.id, { status: 'FINAL' }, 'admin-1');
    expect(h.job().state).toBe('SKIPPED');
    await h.service.sweepStatRollups(Date.now() + 10 * 60_000);
    expect(h.seasonRow()).toBeUndefined();
  });

  it('an administrator can retry a failed roll-up now; the retry is audited', async () => {
    const h = await liveGameWithPlayer('24');
    const realUpsert = h.tables.playerSeasonStat.upsert;
    h.tables.playerSeasonStat.upsert = async () => {
      throw new Error('simulated storage failure');
    };
    jest
      .spyOn((h.service as any).logger, 'error')
      .mockImplementation(() => undefined);
    await h.service.setStatus(TENANT, h.g.id, { status: 'FINAL' }, 'admin-1');
    expect(h.job().state).toBe('FAILED');
    h.tables.playerSeasonStat.upsert = realUpsert;

    const out: any = await h.service.retryStatRollup(TENANT, h.g.id, 'admin-2');
    expect(out.statRollup).toMatchObject({ state: 'APPLIED' });
    expect(h.seasonRow()?.statValue).toBe(24);
    const audit = h.auditLog.rows.find(
      (r: any) => r.action === 'SPORTS_STATS_ROLLUP_RETRIED',
    );
    expect(audit).toMatchObject({ userId: 'admin-2', targetId: h.g.id });
  });
});

describe('computeGameContribution', () => {
  it('is pure: one entry per counting stat per linked roster row, in the game season', () => {
    const entries = computeGameContribution(
      { sport: 'basketball', startedAt: new Date('2025-12-01T19:00:00Z') },
      [
        { personId: 'p-1', teamId: 't', stats: { PTS: '10', REB: 'x' } },
        { personId: null, stats: { PTS: '99' } },
      ],
    );
    expect(entries).toEqual([
      {
        personId: 'p-1',
        teamId: 't',
        sport: 'basketball',
        season: SEASON,
        statKey: 'PTS',
        value: 10,
      },
    ]);
  });
});
