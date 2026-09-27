/**
 * K12-F13 — a FINAL game is locked; the only way back is the named, audited
 * reopen.
 *
 * Acceptance (02-FIX-REGISTER F13): "All ordinary controls/feed replays are
 * rejected after FINAL. An authorized correction updates game, final display
 * and season totals once, with attribution." (Season totals: see
 * sports-stat-rollup.spec.ts.)
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { TENANT, setup, newGame } from './sports-test-harness';

async function finalGame(sport = 'basketball') {
  const h = setup();
  const g: any = await newGame(h.service, sport);
  await h.service.setScore(TENANT, g.id, { homeScore: 50, awayScore: 48 });
  await h.service.setStatus(TENANT, g.id, { status: 'FINAL' }, 'user-scorer');
  return { ...h, g };
}

function isFinalRefusal(err: unknown) {
  return (
    err instanceof ConflictException &&
    (err.getResponse() as { code?: string }).code === 'GAME_FINAL'
  );
}

describe('K12-F13 — every ordinary control is refused on a FINAL game', () => {
  const CONTROLS: Array<[string, (s: any, id: string) => Promise<unknown>]> = [
    [
      'score delta',
      (s, id) => s.adjustScore(TENANT, id, { team: 'home', delta: 2 }),
    ],
    ['score correction', (s, id) => s.setScore(TENANT, id, { awayScore: 60 })],
    ['clock', (s, id) => s.clockAction(TENANT, id, { action: 'start' })],
    [
      'shot clock',
      (s, id) => s.setShotClock(TENANT, id, { action: 'configure', value: 35 }),
    ],
    ['period', (s, id) => s.setSegment(TENANT, id, { delta: 1 })],
    [
      'stats',
      (s, id) => s.updateStats(TENANT, id, { stats: { homeFouls: 3 } }),
    ],
    ['timeout', (s, id) => s.callTimeout(TENANT, id, { team: 'home' })],
    ['possession', (s, id) => s.setPossession(TENANT, id, { team: 'away' })],
    ['penalty', (s, id) => s.setPenalties(TENANT, id, { action: 'clear' })],
    [
      'status back to LIVE',
      (s, id) => s.setStatus(TENANT, id, { status: 'LIVE' }),
    ],
    ['admin ingest', (s, id) => s.ingest(TENANT, id, { homeScore: 99 })],
    ['machine feed', (s, id) => s.ingestByFeed(id, { homeScore: 99 })],
  ];

  for (const [name, run] of CONTROLS) {
    it(`${name}: 409 GAME_FINAL, result untouched`, async () => {
      const { service, game, g } = await finalGame();
      const version = game.rows[0].version;
      const err = await run(service, g.id).catch((e: unknown) => e);
      expect(isFinalRefusal(err)).toBe(true);
      const row = game.rows[0];
      expect({
        status: row.status,
        home: row.homeScore,
        away: row.awayScore,
        version: row.version,
      }).toEqual({
        status: 'FINAL',
        home: 50,
        away: 48,
        version,
      });
    });
  }

  it('an undo on a FINAL game is refused too (reopen first)', async () => {
    const { service, gameEvent, g } = await finalGame();
    const score = gameEvent.rows.filter((e: any) => e.type === 'SCORE').pop();
    const err = await service
      .undoEvent(TENANT, g.id, score.id)
      .catch((e: unknown) => e);
    expect(isFinalRefusal(err)).toBe(true);
  });

  it('a CTS / swim console still streaming after the horn is told accepted:false, not errored', async () => {
    const { service, game, g } = await finalGame();
    await expect(
      service.ingestCtsSnapshot(g.id, { homeScore: 52 }, { tenantId: null }),
    ).resolves.toEqual({ ok: true, accepted: false, reason: 'game is final' });
    expect(game.rows[0].homeScore).toBe(50);
  });

  it('a repeated "end game" is a no-op: no second cinematic, no new revision', async () => {
    const { service, game, gameEvent, g } = await finalGame();
    const events = gameEvent.rows.length;
    const version = game.rows[0].version;
    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    expect(gameEvent.rows.length).toBe(events);
    expect(game.rows[0].version).toBe(version);
  });

  it('box-score changes are locked; cosmetic roster edits and presentation are not', async () => {
    const { service, rosterPlayer, g } = await finalGame();
    // Seed a player directly (the add path is itself locked now).
    rosterPlayer.rows.push({
      id: 'p1',
      tenantId: TENANT,
      gameId: g.id,
      team: 'home',
      name: 'Sam',
      stats: { PTS: '12' },
    });
    await expect(
      service.addPlayer(TENANT, g.id, { name: 'Late Add' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.updatePlayer(TENANT, g.id, 'p1', { stats: { PTS: '14' } }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.deletePlayer(TENANT, g.id, 'p1'),
    ).rejects.toBeInstanceOf(ConflictException);
    // Fixing a misspelled name is not a result change.
    await expect(
      service.updatePlayer(TENANT, g.id, 'p1', { name: 'Sammy' }),
    ).resolves.toBeTruthy();
    // A post-game celebration is presentation, not a result.
    await expect(
      service.fireCue(TENANT, g.id, { key: 'buzzerBeater' }),
    ).resolves.toMatchObject({ fired: true });
  });
});

describe('K12-F13 — the audited reopen', () => {
  it('requires a reason', async () => {
    const { service, g } = await finalGame();
    await expect(
      service.reopenGame(TENANT, g.id, { reason: ' ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only reopens a FINAL game', async () => {
    const h = setup();
    const g: any = await newGame(h.service, 'basketball');
    const err = await h.service
      .reopenGame(TENANT, g.id, { reason: 'scorer error' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'GAME_NOT_FINAL',
    });
  });

  it('reopen → correct → end again: the corrected result stands, and every step is attributed', async () => {
    const { service, game, gameEvent, auditLog, g } = await finalGame();
    await service.reopenGame(
      TENANT,
      g.id,
      { reason: 'Away free throw was never entered' },
      'user-admin',
    );
    expect(game.rows[0].status).toBe('LIVE');
    expect(game.rows[0].endedAt).toBeNull();
    const reopened = gameEvent.rows
      .filter((e: any) => e.type === 'STATUS' && e.payload.reopened)
      .pop();
    expect(reopened.payload).toMatchObject({
      prevStatus: 'FINAL',
      reason: 'Away free throw was never entered',
    });
    const audit = auditLog.rows.find(
      (a: any) => a.action === 'SPORTS_GAME_REOPENED',
    );
    expect(audit).toMatchObject({ userId: 'user-admin', targetId: g.id });
    expect(JSON.parse(audit.details)).toMatchObject({
      reason: 'Away free throw was never entered',
      finalScore: { home: 50, away: 48 },
    });

    await service.adjustScore(
      TENANT,
      g.id,
      { team: 'away', delta: 1 },
      'user-admin',
    );
    await service.setStatus(TENANT, g.id, { status: 'FINAL' }, 'user-admin');
    expect({
      status: game.rows[0].status,
      away: game.rows[0].awayScore,
    }).toEqual({ status: 'FINAL', away: 49 });
  });
});
