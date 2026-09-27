/**
 * K12-F09 — undo is the single-use inverse of the WHOLE action.
 *
 * Acceptance (02-FIX-REGISTER F09): "All seven saved undo probes pass.
 * Concurrent/retried undo returns the same result; undo of a winning point
 * restores score, set count/history, period, phase and cues consistently."
 * The seven probes live in k12-launch-acceptance.spec.ts; this file covers the
 * rest of the contract.
 */
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { TENANT, setup, newGame } from './sports-test-harness';

const lastEvent = (gameEvent: any, pred: (e: any) => boolean) =>
  gameEvent.rows.filter(pred).pop();

describe('K12-F09 — single use', () => {
  it('two CONCURRENT undos of one event: one effect, both answered with the same result', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setScore(TENANT, g.id, { homeScore: 10 });
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 });
    const ev = lastEvent(gameEvent, (e) => e.type === 'SCORE' && e.payload.delta === 2);

    // Park the first undo's write; the second undo runs to completion.
    const original = game.update;
    let reached!: () => void;
    let release!: () => void;
    const parked = new Promise<void>((r) => (reached = r));
    const resume = new Promise<void>((r) => (release = r));
    let armed = true;
    game.update = async (args: any) => {
      if (armed && args.data?.homeScore === 10) {
        armed = false;
        reached();
        await resume;
      }
      return original(args);
    };
    const first = service.undoEvent(TENANT, g.id, ev.id, 'u-1');
    await parked;
    const second = await service.undoEvent(TENANT, g.id, ev.id, 'u-2');
    release();
    const firstResult = await first;

    expect(game.rows[0].homeScore).toBe(10);
    expect(firstResult).toEqual(second);
    expect(gameEvent.rows.filter((e: any) => e.type === 'UNDO_SCORE')).toHaveLength(1);
  });

  it('the rail stops offering an undone event', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 3 });
    const ev = lastEvent(gameEvent, (e) => e.type === 'SCORE');
    await service.undoEvent(TENANT, g.id, ev.id);
    const rows = await service.getEvents(TENANT, g.id, 25);
    expect(rows.find((r) => r.id === ev.id)).toMatchObject({ undoable: false, nonUndoableReason: 'undone' });
  });
});

describe('K12-F09 — the inverse of the whole action', () => {
  it('undoing a timeout gives the timeout back AND restarts the clocks it stopped', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 35 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    await service.callTimeout(TENANT, g.id, { team: 'home' });
    expect(game.rows[0].stats.homeTimeouts).toBe(4);
    const ev = lastEvent(gameEvent, (e) => e.type === 'TIMEOUT');

    await service.undoEvent(TENANT, g.id, ev.id);
    const row = game.rows[0];
    expect(row.stats.homeTimeouts).toBe(5);
    expect(row.clockRunning).toBe(true);
    expect(row.stats.shotClock.running).toBe(true);
  });

  it('undoing a penalty add empties the box again', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'hockey');
    await service.setPenalties(TENANT, g.id, { action: 'add', team: 'home', lenSec: 120, player: '12' });
    expect(game.rows[0].stats.penalties).toHaveLength(1);
    await service.undoEvent(TENANT, g.id, lastEvent(gameEvent, (e) => e.type === 'PENALTY').id);
    expect(game.rows[0].stats.penalties ?? []).toHaveLength(0);
  });

  it('a score-only command undoes by the delta it actually applied when later points moved the score', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 });
    const two = lastEvent(gameEvent, (e) => e.type === 'SCORE');
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 3 });
    await service.undoEvent(TENANT, g.id, two.id);
    expect(game.rows[0].homeScore).toBe(3);
  });

  it('refuses (409 UNDO_CONFLICT) rather than overwrite a later action it depends on', async () => {
    const { service, game, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    const start = lastEvent(gameEvent, (e) => e.type === 'CLOCK' && e.payload.action === 'start');
    await service.clockAction(TENANT, g.id, { action: 'pause' });
    const pausedAt = game.rows[0].clockMs;

    const err = await service.undoEvent(TENANT, g.id, start.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'UNDO_CONFLICT',
      fields: expect.arrayContaining(['clockRunning']),
    });
    expect(game.rows[0].clockMs).toBe(pausedAt);
    expect(game.rows[0].clockRunning).toBe(false);
  });

  it('the itemised parts of a command are not separately undoable — the rail and the server agree', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 4 } });
    await service.setSegment(TENANT, g.id, { segment: 2 });
    const derived = lastEvent(gameEvent, (e) => e.type === 'STAT' && e.payload.derived);
    expect(derived).toBeDefined();

    const rows = await service.getEvents(TENANT, g.id, 25);
    expect(rows.find((r) => r.id === derived.id)).toMatchObject({ undoable: false, nonUndoableReason: 'derived' });
    await expect(service.undoEvent(TENANT, g.id, derived.id)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('every undo is an audited command with the actor named', async () => {
    const { service, gameEvent, auditLog } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.adjustScore(TENANT, g.id, { team: 'away', delta: 1 });
    const ev = lastEvent(gameEvent, (e) => e.type === 'SCORE');
    await service.undoEvent(TENANT, g.id, ev.id, 'user-42');
    const row = auditLog.rows.find((a: any) => a.action === 'SPORTS_EVENT_UNDONE');
    expect(row).toMatchObject({ tenantId: TENANT, userId: 'user-42', targetId: g.id });
    expect(JSON.parse(row.details)).toMatchObject({ eventId: ev.id, originalType: 'SCORE', mode: 'exact' });
  });
});
