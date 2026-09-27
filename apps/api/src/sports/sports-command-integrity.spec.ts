/**
 * K12-F11 (atomicity) + K12-F12 (no stale read/modify/write) — the command
 * runner's guarantees, exercised through the real SportsService.
 *
 * F11 acceptance: "Inject failure at every write and before/after commit.
 * Observe either the complete command or no command."
 * F12 acceptance: "two winning volleyball taps credit one set, concurrent
 * timeouts debit correctly, and feed/clock/stat writes preserve unrelated
 * fields."
 *
 * Races are driven deterministically: an interceptor parks one command's
 * compare-and-swap write until another command has fully committed. What the
 * test then proves is that the parked write MISSES (its version is stale) and
 * the whole command re-runs on the winner's state — the property the engine
 * rests on. (The double does not model row locks; the opt-in
 * k12-launch-acceptance.pg.spec.ts repeats these against real Postgres.)
 */
import { ConflictException } from '@nestjs/common';
import { TENANT, setup, newGame } from './sports-test-harness';

/** Park the FIRST game.update matching `when` until `release()` is called. */
function parkFirstUpdate(game: any, when: (args: any) => boolean) {
  const original = game.update;
  let reached!: () => void;
  let release!: () => void;
  const parked = new Promise<void>((r) => (reached = r));
  const resume = new Promise<void>((r) => (release = r));
  let armed = true;
  game.update = async (args: any) => {
    if (armed && when(args)) {
      armed = false;
      reached();
      await resume;
    }
    return original(args);
  };
  return { parked, release: () => release() };
}

describe('F11 — a command commits completely or not at all', () => {
  it('a failed AUDIT write rolls back the timeout: no debit, clock still running, no events', async () => {
    const { service, game, gameEvent, auditLog } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    const eventsBefore = gameEvent.rows.length;
    const timeoutsBefore = g.stats.homeTimeouts;
    auditLog.create = async () => {
      throw new Error('simulated audit storage failure');
    };

    await expect(
      service.callTimeout(TENANT, g.id, { team: 'home' }),
    ).rejects.toThrow('simulated audit storage failure');
    const row = game.rows[0];
    expect(row.stats.homeTimeouts).toBe(timeoutsBefore);
    expect(row.clockRunning).toBe(true);
    expect(gameEvent.rows.length).toBe(eventsBefore);
  });

  it('a failed CUE insert (auto-celebration) rolls back the touchdown itself', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'football');
    const originalCreate = gameEvent.create;
    gameEvent.create = async (args: any) => {
      if (args.data.type === 'CUE')
        throw new Error('simulated cue insert failure');
      return originalCreate(args);
    };

    await expect(
      service.adjustScore(TENANT, g.id, { team: 'home', delta: 7 }, 'user-1'),
    ).rejects.toThrow('simulated cue insert failure');
    expect(game.rows[0].homeScore).toBe(0);
    expect(gameEvent.rows.filter((e: any) => e.type === 'SCORE')).toHaveLength(
      0,
    );
  });

  it('the SEGMENT command is all-or-nothing across its itemised reset events', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 4 } });
    const originalCreate = gameEvent.create;
    let seen = 0;
    gameEvent.create = async (args: any) => {
      // Let the SEGMENT event land, fail on the next (a derived STAT reset).
      if (seen++ === 1) throw new Error('simulated failure mid-command');
      return originalCreate(args);
    };

    await expect(
      service.setSegment(TENANT, g.id, { segment: 2 }),
    ).rejects.toThrow('simulated failure mid-command');
    const row = game.rows[0];
    expect(row.segment).toBe(1);
    expect(row.stats.homeFouls).toBe(4);
    expect(
      gameEvent.rows.filter((e: any) => e.type === 'SEGMENT'),
    ).toHaveLength(0);
  });

  it('a failing POST-COMMIT step (stat roll-up) never undoes the committed FINAL', async () => {
    const { service, game, flags } = setup();
    const g: any = await newGame(service, 'basketball');
    flags.isEnabledAsync = async () => {
      throw new Error('flag service down');
    };
    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    expect(game.rows[0].status).toBe('FINAL');
  });
});

describe('F12 — no command overwrites another command it did not see', () => {
  it('two winning volleyball taps credit ONE set: the second is a point in the next set', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'volleyball');
    await service.setScore(TENANT, g.id, { homeScore: 24, awayScore: 23 });
    // Park the first tap's write; let the second tap commit in between.
    const park = parkFirstUpdate(game, (a) => a.data?.stats?.homeSets === 1);
    const first = service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    await park.parked;
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    park.release();
    await first;

    const row = game.rows[0];
    expect(row.stats.homeSets).toBe(1); // one set, not two
    expect(row.segment).toBe(2);
    expect({ home: row.homeScore, away: row.awayScore }).toEqual({
      home: 1,
      away: 0,
    });
  });

  it('two timeouts racing debit twice, from the right counts (5 → 4 → 3)', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    expect(g.stats.homeTimeouts).toBe(5);
    const park = parkFirstUpdate(
      game,
      (a) => a.data?.stats?.homeTimeouts === 4,
    );
    const first = service.callTimeout(TENANT, g.id, { team: 'home' });
    await park.parked;
    await service.callTimeout(TENANT, g.id, { team: 'home' });
    park.release();
    await first;

    expect(game.rows[0].stats.homeTimeouts).toBe(3);
    const debits = gameEvent.rows
      .filter((e: any) => e.type === 'TIMEOUT')
      .map((e: any) => [
        e.payload.prevTimeoutsRemaining,
        e.payload.newTimeoutsRemaining,
      ]);
    expect(debits.sort()).toEqual([
      [4, 3],
      [5, 4],
    ]);
  });

  it('a CTS snapshot racing an operator foul keeps both', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'basketball');
    const park = parkFirstUpdate(game, (a) => a.data?.stats?.cts !== undefined);
    const cts = service.ingestCtsSnapshot(
      g.id,
      { homeTimeoutsRemaining: 2 },
      { tenantId: null },
    );
    await park.parked;
    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 3 } });
    park.release();
    await cts;

    expect(game.rows[0].stats.homeFouls).toBe(3);
    expect(game.rows[0].stats.homeTimeouts).toBe(2);
  });

  it('the clock-expiry sweep never rolls a period the operator corrected after it looked', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    const row = game.rows[0];
    row.status = 'LIVE';
    row.clockMs = 0;
    row.clockRunning = true;
    row.clockUpdatedAt = new Date(Date.now() - 1000);
    // The sweep reads an expired clock; before its command runs, the table
    // puts 5 s back on it (a last-second correction).
    const findMany = game.findMany;
    game.findMany = async (args: any) => {
      const stale = (await findMany(args)).map((r: any) => ({ ...r }));
      await service.clockAction(TENANT, g.id, { action: 'set', ms: 5000 });
      return stale;
    };

    const res = await service.autoAdvanceExpiredClocks();
    expect(res.changed).toBe(0);
    expect(row.segment).toBe(1);
    expect(row.clockMs).toBe(5000);
    expect(
      gameEvent.rows.some(
        (e: any) => e.type === 'CUE' && e.payload.key === 'horn',
      ),
    ).toBe(false);
  });

  it('a command that keeps losing the race gives up with 409 GAME_BUSY and writes nothing', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    const original = game.update;
    // Every attempt's CAS misses: a competing writer bumps the version first.
    game.update = async (args: any) => {
      game.rows[0].version = (game.rows[0].version ?? 0) + 1;
      return original(args);
    };
    const eventsBefore = gameEvent.rows.length;
    const err = await service
      .adjustScore(TENANT, g.id, { team: 'home', delta: 2 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'GAME_BUSY',
    });
    expect(game.rows[0].homeScore).toBe(0);
    expect(gameEvent.rows.length).toBe(eventsBefore);
  });

  it('every game-state write bumps the revision exactly once', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'basketball');
    expect(game.rows[0].version).toBe(0);
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 1 } });
    await service.callTimeout(TENANT, g.id, { team: 'away' });
    expect(game.rows[0].version).toBe(4);
  });
});
