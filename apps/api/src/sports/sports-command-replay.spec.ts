/**
 * K12-F10 — durable command ids. A command that carries a `commandId` gets a
 * receipt (game_commands, unique per game) in the SAME transaction as its
 * effect; any later arrival of that command answers from the receipt and
 * changes nothing.
 *
 * Acceptance (02-FIX-REGISTER F10): "Commit a +2, drop the response, retry from
 * another replica and reload/replay the queue: exactly +2 is present. An old
 * Q1 command cannot silently change a finalized game."
 */
import { ConflictException } from '@nestjs/common';
import { SportsService } from './sports.service';
import { TENANT, setup, newGame } from './sports-test-harness';

const CMD = 'cmd-0123456789abcdef';

function expectConflict(err: unknown, code: string) {
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as ConflictException).getResponse()).toMatchObject({ code });
}

describe('K12-F10 — a replayed command is a no-op that returns the original result', () => {
  it('commit +2, lose the response, retry: exactly +2, one event, one receipt, the same answer', async () => {
    const { service, game, gameEvent, gameCommand } = setup();
    const g: any = await newGame(service, 'basketball');
    const ctx = { actor: { kind: 'user' as const, userId: 'u-1' }, commandId: CMD };

    const first: any = await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 }, ctx);
    const retry: any = await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 }, ctx);
    const replayAgain: any = await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 }, ctx);

    expect(game.rows[0].homeScore).toBe(2);
    expect(gameEvent.rows.filter((e: any) => e.type === 'SCORE')).toHaveLength(1);
    expect(gameCommand.rows).toHaveLength(1);
    // The replay answers exactly what the HTTP layer sent the first time.
    expect(retry).toEqual(JSON.parse(JSON.stringify(first)));
    expect(replayAgain).toEqual(retry);
  });

  it('the retry landing on ANOTHER replica (another service instance, same database) is still a no-op', async () => {
    const h = setup();
    const g: any = await newGame(h.service, 'basketball');
    const replicaB = new SportsService(
      { client: h.client } as any,
      { publish: async () => undefined } as any,
      { signMessage: () => ({}) } as any,
      { listActive: async () => [] } as any,
      { isEnabledAsync: async () => false } as any,
    );
    const ctx = { commandId: CMD };
    await h.service.adjustScore(TENANT, g.id, { team: 'away', delta: 3 }, ctx);
    await replicaB.adjustScore(TENANT, g.id, { team: 'away', delta: 3 }, ctx);
    expect(h.game.rows[0].awayScore).toBe(3);
  });

  it('a concurrent twin whose receipt commits first: this attempt is discarded and answers from the twin', async () => {
    const { service, game, gameEvent, gameCommand } = setup();
    const g: any = await newGame(service, 'basketball');
    const create = gameCommand.create;
    let first = true;
    gameCommand.create = async (args: any) => {
      if (first) {
        first = false;
        // The twin (same command, other replica) commits its receipt in the
        // window before ours: our INSERT then violates the unique key.
        gameCommand.rows.push({
          ...args.data,
          id: 'twin-receipt',
          createdAt: new Date(),
          response: { from: 'twin' },
        });
        const err: any = new Error('Unique constraint failed on the fields: (game_id,command_id)');
        err.code = 'P2002';
        throw err;
      }
      return create(args);
    };

    const answer = await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 }, { commandId: CMD });
    expect(answer).toEqual({ from: 'twin' });
    // Our own attempt's effect was rolled back with its transaction.
    expect(game.rows[0].homeScore).toBe(0);
    expect(gameEvent.rows.filter((e: any) => e.type === 'SCORE')).toHaveLength(0);
  });

  it('the same id with a DIFFERENT request is refused (409 COMMAND_ID_REUSED), never answered with another result', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 }, { commandId: CMD });
    const err = await service
      .adjustScore(TENANT, g.id, { team: 'home', delta: 3 }, { commandId: CMD })
      .catch((e: unknown) => e);
    expectConflict(err, 'COMMAND_ID_REUSED');
    expect(game.rows[0].homeScore).toBe(2);
  });

  it('a queued Q1 command replayed after the game moved to Q2 is refused (409 GAME_SEGMENT_CHANGED)', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setSegment(TENANT, g.id, { segment: 2 });
    const err = await service
      .updateStats(TENANT, g.id, { stats: { homeFouls: 5 } }, { commandId: CMD, expectedSegment: 1 })
      .catch((e: unknown) => e);
    expectConflict(err, 'GAME_SEGMENT_CHANGED');
    expect(game.rows[0].stats.homeFouls ?? 0).toBe(0);
    // The same command, made in the period it is replayed in, applies.
    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 5 } }, { commandId: 'cmd-q2-000000001', expectedSegment: 2 });
    expect(game.rows[0].stats.homeFouls).toBe(5);
  });

  it('a command that DID land before the period changed replays its own answer, not the period refusal', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'basketball');
    const ctx = { commandId: CMD, expectedSegment: 1 };
    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 2 } }, ctx);
    await service.setSegment(TENANT, g.id, { segment: 2 });
    await expect(
      service.updateStats(TENANT, g.id, { stats: { homeFouls: 2 } }, ctx),
    ).resolves.toBeTruthy();
    expect(game.rows[0].segment).toBe(2);
  });

  it('the receipt names the actor, the command kind and the revision it moved the game across', async () => {
    const { service, gameCommand } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.clockAction(TENANT, g.id, { action: 'start' }, {
      actor: { kind: 'user', userId: 'u-7' },
      commandId: CMD,
    });
    expect(gameCommand.rows[0]).toMatchObject({
      tenantId: TENANT,
      gameId: g.id,
      commandId: CMD,
      kind: 'clock.start',
      actorType: 'user',
      actorUserId: 'u-7',
      revisionBefore: 0,
      revisionAfter: 1,
    });
  });

  it('commands without an id (machine feeds, old clients) write no receipt', async () => {
    const { service, gameCommand } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 }, 'u-1');
    await service.ingestByFeed(g.id, { homeScore: 5 });
    expect(gameCommand.rows).toHaveLength(0);
  });
});
