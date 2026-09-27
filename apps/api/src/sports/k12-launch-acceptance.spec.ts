/**
 * K-12 sports launch acceptance — the 21 probes from the Codex readiness audit
 * (docs/research/2026-09-23-k12-sports-readiness-audit/repro/
 * k12-audit-acceptance.spec.ts, verified 21/21 failing on master by the lead on
 * 2026-09-24), promoted to a permanent spec.
 *
 * RULES FOR THIS FILE
 *  - The probe bodies and their `expect`s are the audit's, unchanged. A probe
 *    turns green because the ENGINE was fixed, never because an expectation was
 *    edited. If one ever needs a different expectation, that is a rules
 *    decision for the owning lane (and an official scorer), not a test edit.
 *  - `it.failing` marks a KNOWN launch defect owned by a later lane of the
 *    program (docs/research/2026-09-24-k12-sports-launch-program/00-PLAN.md).
 *    Jest reports it green while it fails and RED the moment it starts passing,
 *    so the lane that fixes it is forced to flip it to `it` in the same commit.
 *  - The double is sports-prisma-fake.ts: per-transaction rollback, real
 *    compare-and-swap filters, Prisma error codes. It does NOT model row locks;
 *    the opt-in k12-launch-acceptance.pg.spec.ts repeats the concurrency probes
 *    against real Postgres.
 */
import { TENANT, setup, newGame } from './sports-test-harness';

afterEach(() => jest.useRealTimers());

describe('K12 launch acceptance — the 21 audit probes', () => {
  // Owner: A3 (F03, NFHS basketball rules profile) — timeouts are per GAME.
  it.failing('K12-01 basketball does not replenish the game timeout bank at halftime', async () => {
    const { service } = setup(); const g: any = await newGame(service, 'basketball');
    await service.updateStats(TENANT, g.id, { stats: { homeTimeouts: 1 } });
    await service.setSegment(TENANT, g.id, { segment: 3 });
    expect(g.stats.homeTimeouts).toBe(1);
  });

  // Owner: A3 (F02) — 4:00 OT and Q4 team fouls carry into overtime.
  it.failing('K12-02 basketball overtime uses four minutes and carries Q4 team fouls', async () => {
    const { service } = setup(); const g: any = await newGame(service, 'basketball');
    await service.setSegment(TENANT, g.id, { segment: 4 });
    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 5 } });
    await service.setSegment(TENANT, g.id, { segment: 5 });
    expect({ clock: g.clockMs, fouls: g.stats.homeFouls }).toEqual({ clock: 240000, fouls: 5 });
  });

  // Owner: A2 (F05) — a configured shot-clock length survives a period change.
  it('K12-03 configured 35-second basketball shot clock survives period advance', async () => {
    const { service } = setup(); const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 35 });
    await service.setSegment(TENANT, g.id, { segment: 2 });
    expect(g.stats.shotClock.ms).toBe(35000);
  });

  // Owner: A2 (F06) — the play clock is independent of the game clock.
  it('K12-04 football play clock can continue while game clock is stopped', async () => {
    const { service } = setup(); const g: any = await newGame(service, 'football');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    await service.setPlayClock(TENANT, g.id, { action: 'reset', value: 40 });
    await service.clockAction(TENANT, g.id, { action: 'pause' });
    expect(g.stats.playClock.running).toBe(true);
  });

  // Owner: A3 (F24) — 2027 state-option boys lacrosse 70 s shot clock.
  it.failing('K12-05 2027 boys lacrosse can configure the state-option 70-second clock', async () => {
    const { service } = setup(); const g: any = await newGame(service, 'lacrosse');
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 70 });
    expect(g.stats.shotClock.len).toBe(70);
  });

  // Owner: A1 (F09).
  it('K12-06 undo winning volleyball point restores the previous set and scores', async () => {
    const { service, gameEvent } = setup(); const g: any = await newGame(service, 'volleyball');
    await service.setScore(TENANT, g.id, { homeScore: 24, awayScore: 23 });
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    const ev = gameEvent.rows.filter((e: any) => e.type === 'SCORE' && e.payload.delta === 1).pop();
    await service.undoEvent(TENANT, g.id, ev.id);
    expect({ segment: g.segment, home: g.homeScore, away: g.awayScore, sets: g.stats.homeSets || 0 })
      .toEqual({ segment: 1, home: 24, away: 23, sets: 0 });
  });

  // Owner: A1 (F09).
  it('K12-07 retrying undo cannot subtract the same points twice', async () => {
    const { service, gameEvent } = setup(); const g: any = await newGame(service, 'basketball');
    await service.setScore(TENANT, g.id, { homeScore: 10 });
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 });
    const ev = gameEvent.rows.filter((e: any) => e.type === 'SCORE' && e.payload.delta === 2).pop();
    await service.undoEvent(TENANT, g.id, ev.id);
    await service.undoEvent(TENANT, g.id, ev.id).catch(() => undefined);
    expect(g.homeScore).toBe(10);
  });

  // Owner: A1 (F09).
  it('K12-08 undo of a clamped decrement at zero must not award a point', async () => {
    const { service, gameEvent } = setup(); const g: any = await newGame(service, 'basketball');
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: -1 });
    const ev = gameEvent.rows.filter((e: any) => e.type === 'SCORE').pop();
    await service.undoEvent(TENANT, g.id, ev.id);
    expect(g.homeScore).toBe(0);
  });

  // Owner: A1 (F09).
  it('K12-09 an absolute score correction has an undoable before snapshot', async () => {
    const { service, gameEvent } = setup(); const g: any = await newGame(service, 'basketball');
    await service.setScore(TENANT, g.id, { homeScore: 10 });
    await service.setScore(TENANT, g.id, { homeScore: 12 });
    const ev = gameEvent.rows.filter((e: any) => e.type === 'SCORE').pop();
    await service.undoEvent(TENANT, g.id, ev.id);
    expect(g.homeScore).toBe(10);
  });

  // Owner: A1 (F13).
  it('K12-10 a late normal score tap cannot mutate a finalized game', async () => {
    const { service } = setup(); const g: any = await newGame(service, 'basketball');
    await service.setScore(TENANT, g.id, { homeScore: 10 });
    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 }).catch(() => undefined);
    expect(g.homeScore).toBe(10);
  });

  // Owner: A1 (F11).
  it('K12-11 score and its event commit atomically if event persistence fails', async () => {
    const { service, gameEvent, game } = setup(); const g: any = await newGame(service, 'basketball');
    await service.setScore(TENANT, g.id, { homeScore: 10 });
    gameEvent.create = async () => { throw new Error('simulated event persistence failure'); };
    await expect(service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 })).rejects.toThrow();
    expect(game.rows[0].homeScore).toBe(10);
  });

  // Owner: A1 (F09).
  it('K12-12 undo start returns clock to its previously paused state', async () => {
    const { service, gameEvent } = setup(); const g: any = await newGame(service, 'basketball');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    const ev = gameEvent.rows.filter((e: any) => e.type === 'CLOCK' && e.payload.action === 'start').pop();
    await service.undoEvent(TENANT, g.id, ev.id);
    expect(g.clockRunning).toBe(false);
  });

  // Owner: A1 (F09).
  it('K12-13 undo pause restores the live reading rather than adding elapsed time back', async () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    const { service, gameEvent } = setup(); const g: any = await newGame(service, 'basketball');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    jest.setSystemTime(new Date('2026-09-23T12:00:10Z'));
    await service.clockAction(TENANT, g.id, { action: 'pause' });
    const ev = gameEvent.rows.filter((e: any) => e.type === 'CLOCK' && e.payload.action === 'pause').pop();
    await service.undoEvent(TENANT, g.id, ev.id);
    expect(g.clockMs).toBe(470000);
  });

  // Owner: A2 (F08) — hold 0:00 in the current period until the table advances.
  it.failing('K12-14 period expiry holds zero and current quarter until the operator advances', async () => {
    const { service } = setup(); const g: any = await newGame(service, 'basketball');
    g.status = 'LIVE'; g.clockMs = 0; g.clockRunning = true; g.clockUpdatedAt = new Date();
    await service.autoAdvanceExpiredClocks();
    expect({ segment: g.segment, clock: g.clockMs }).toEqual({ segment: 1, clock: 0 });
  });

  // Owner: A2 (F14) — project the running clock before a boolean-only stop.
  it.failing('K12-15 boolean-only feed clock stop preserves the current projected reading', async () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    const { service } = setup(); const g: any = await newGame(service, 'basketball');
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 60000 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    jest.setSystemTime(new Date('2026-09-23T12:00:10Z'));
    await service.ingest(TENANT, g.id, { clockRunning: false });
    expect(g.clockMs).toBe(50000);
  });

  // Owner: A1 (F09).
  it('K12-16 period undo restores the team-foul values that advancing cleared', async () => {
    const { service, gameEvent } = setup(); const g: any = await newGame(service, 'basketball');
    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 4 } });
    await service.setSegment(TENANT, g.id, { segment: 2 });
    const ev = gameEvent.rows.filter((e: any) => e.type === 'SEGMENT').pop();
    await service.undoEvent(TENANT, g.id, ev.id);
    expect({ segment: g.segment, fouls: g.stats.homeFouls }).toEqual({ segment: 1, fouls: 4 });
  });

  // Owner: A1 (F12).
  it('K12-17 clock update cannot overwrite a concurrent team-foul update', async () => {
    const { service, game } = setup(); const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 35 });
    const update = game.update; let reached!: () => void; let release!: () => void;
    const blocked = new Promise<void>((r) => (reached = r)); const resume = new Promise<void>((r) => (release = r));
    let captured = false;
    game.update = async (args: any) => { if (!captured && args.data.clockRunning === true) { captured = true; reached(); await resume; } return update(args); };
    const clock = service.clockAction(TENANT, g.id, { action: 'start' });
    await blocked;
    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 4 } });
    release(); await clock;
    expect(g.stats.homeFouls).toBe(4);
  });

  // Owner: A1 (F12).
  it('K12-18 setting one team score cannot overwrite the other teams concurrent point', async () => {
    const { service, game } = setup(); const g: any = await newGame(service, 'basketball');
    const update = game.update; let reached!: () => void; let release!: () => void;
    const blocked = new Promise<void>((r) => (reached = r)); const resume = new Promise<void>((r) => (release = r)); let captured = false;
    game.update = async (args: any) => { if (!captured && args.data.homeScore === 12) { captured = true; reached(); await resume; } return update(args); };
    const correction = service.setScore(TENANT, g.id, { homeScore: 12 }); await blocked;
    await service.adjustScore(TENANT, g.id, { team: 'away', delta: 1 }); release(); await correction;
    expect(g.awayScore).toBe(1);
  });

  // Owner: A2 (F05) — an explicit OFF survives starting the game clock.
  it('K12-19 explicitly disabling shot clock survives starting the game clock', async () => {
    const { service } = setup(); const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 0 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    expect(g.stats.shotClock.len).toBe(0);
  });

  // Registered to A2 (F07). Passes since A1's F12 fix: callTimeout is now ONE
  // command on ONE read, so the timeout debit can no longer write back a stats
  // copy read before the pause (the stale read that restarted the shot clock).
  // A2 still owns the rest of F07 (halftime, penalties, finalization).
  it('K12-20 calling timeout freezes the shot clock after the timeout stats write', async () => {
    const { service } = setup(); const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 35 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    await service.callTimeout(TENANT, g.id, { team: 'home' });
    expect({ game: g.clockRunning, shot: g.stats.shotClock.running }).toEqual({ game: false, shot: false });
  });

  // Owner: A2 (F07) — HALFTIME freezes the game clock.
  // (K12-21 below; the A1 probes follow the audit's 21.)
  it.failing('K12-21 halftime status freezes the game clock', async () => {
    const { service } = setup(); const g: any = await newGame(service, 'basketball');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    await service.setStatus(TENANT, g.id, { status: 'HALFTIME' });
    expect(g.clockRunning).toBe(false);
  });
});

/**
 * Probes added by lane A1 (2026-09-26) for acceptance the audit named but did
 * not script: the reopen-after-FINAL flow (F13), command replay (F10) and the
 * screen-claim race (F35). Same style: expected-correct behaviour on the real
 * SportsService.
 */
describe('K12 launch acceptance — lane A1 additions', () => {
  // F13: FINAL locks the result; the audited reopen is the one way back.
  it('K12-22 a FINAL game rejects a late tap, then reopens with a reason and takes the correction', async () => {
    const { service, auditLog } = setup(); const g: any = await newGame(service, 'basketball');
    await service.setScore(TENANT, g.id, { homeScore: 40, awayScore: 38 });
    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    await service.adjustScore(TENANT, g.id, { team: 'away', delta: 3 }).catch(() => undefined);
    expect({ status: g.status, away: g.awayScore }).toEqual({ status: 'FINAL', away: 38 });
    await service.reopenGame(TENANT, g.id, { reason: 'Last three-pointer missed' }, 'admin-1');
    await service.adjustScore(TENANT, g.id, { team: 'away', delta: 3 }, 'admin-1');
    await service.setStatus(TENANT, g.id, { status: 'FINAL' }, 'admin-1');
    expect({ status: g.status, away: g.awayScore }).toEqual({ status: 'FINAL', away: 41 });
    expect(auditLog.rows.some((a: any) => a.action === 'SPORTS_GAME_REOPENED' && a.userId === 'admin-1')).toBe(true);
  });

  // F10: a +2 whose response was lost, retried and replayed, is +2 once.
  it('K12-23 a replayed command id applies exactly once', async () => {
    const { service } = setup(); const g: any = await newGame(service, 'basketball');
    const ctx = { commandId: 'cmd-k12-23-000001' };
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 }, ctx);
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 }, ctx);
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 }, ctx);
    expect(g.homeScore).toBe(2);
  });

  // F35: two consoles claim the same free gym board at the same moment. One
  // wins; the other gets a visible conflict naming the actual owner, and both
  // consoles' screen lists show the real assignment.
  it('K12-24 two simultaneous claims on one screen yield exactly one winner and a visible conflict', async () => {
    const { service, screen, auditLog } = setup();
    const a: any = await newGame(service, 'basketball');
    const b: any = await newGame(service, 'volleyball');
    screen.rows.push({ id: 'gym-board', name: 'Gym Board', status: 'ONLINE', tenantId: TENANT, activeBoardGameId: null, activeBoardSurface: null });
    // Simultaneous: both claims read the screen as FREE before either writes.
    // (The double returns live rows; a database returns snapshots — copy.)
    const liveFindMany = screen.findMany;
    let reads = 0;
    let bothRead!: () => void;
    const barrier = new Promise<void>((r) => (bothRead = r));
    screen.findMany = async (args: any) => {
      const rows = (await liveFindMany(args)).map((r: any) => ({ ...r }));
      if (++reads === 2) bothRead();
      await barrier;
      return rows;
    };
    const [ra, rb] = await Promise.allSettled([
      service.showOnScreens(TENANT, a.id, ['gym-board']),
      service.showOnScreens(TENANT, b.id, ['gym-board']),
    ]);
    const won = [ra, rb].filter((r) => r.status === 'fulfilled');
    const lost = [ra, rb].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const winner = ra.status === 'fulfilled' ? a.id : b.id;
    const loser = winner === a.id ? b.id : a.id;
    expect(lost[0].reason.getStatus()).toBe(409);
    expect(lost[0].reason.getResponse()).toMatchObject({
      code: 'SCREEN_IN_USE',
      conflicts: [{ screenId: 'gym-board', ownerGameId: winner }],
    });
    expect(screen.rows[0].activeBoardGameId).toBe(winner);
    const loserView = await service.listGameScreens(TENANT, loser);
    expect(loserView[0]).toMatchObject({ showing: false, showingOther: true, otherGameId: winner });
    const winnerView = await service.listGameScreens(TENANT, winner);
    expect(winnerView[0]).toMatchObject({ showing: true, showingOther: false });
    expect(auditLog.rows.filter((r: any) => r.action === 'SPORTS_SCREENS_SHOWN')).toHaveLength(1);
  });
});
