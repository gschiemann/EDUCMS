/**
 * K12-F34 — every privileged game action has durable attribution.
 *
 * Acceptance (audit register): "For each mutation, verify tenant,
 * actor/session, reason and before/after state in the audit trail. Reject
 * cross-tenant and unauthorized roles. Audit storage failure cannot silently
 * lose required attribution."
 *
 * Exercised through the real SportsService over the in-memory Prisma double
 * (sports-prisma-fake.ts). Cross-tenant and role refusal are covered by
 * tenant-isolation/two-tenant-role-matrix.spec.ts and the controller guards.
 */
import { TENANT, setup, newGame } from './sports-test-harness';
import { consoleCommand, consoleTokenFingerprint } from './game-command';

const details = (row: any) => JSON.parse(row.details);
const auditsFor = (auditLog: any, commandId: string) =>
  auditLog.rows.filter((r: any) => details(r).command?.commandId === commandId);
const auditFailure = () => {
  throw new Error('simulated audit storage failure');
};

describe('K12-F34 — a game command is attributed on its event AND in the audit trail', () => {
  it('score tap: the event names the user, the command id and the revision; the audit row carries before/after', async () => {
    const { service, game, gameEvent, auditLog } = setup();
    const g: any = await newGame(service, 'football');
    const v0 = game.rows[0].version;

    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 7 }, {
      actor: { kind: 'user', userId: 'user-7' },
      commandId: 'cmd-attr-0001',
    });

    const score = gameEvent.rows.find((e: any) => e.type === 'SCORE');
    expect(score).toMatchObject({
      commandId: 'cmd-attr-0001',
      actorType: 'user',
      actorUserId: 'user-7',
      revision: v0 + 1,
    });
    // The touchdown's auto-celebration is the same command, same attribution.
    const cue = gameEvent.rows.find((e: any) => e.type === 'CUE');
    expect(cue).toMatchObject({ commandId: 'cmd-attr-0001', actorType: 'user', actorUserId: 'user-7' });

    const rows = auditsFor(auditLog, 'cmd-attr-0001');
    const own = rows.find((r: any) => r.action === 'SPORTS_GAME_COMMAND');
    expect(own).toBeDefined();
    expect(own.tenantId).toBe(TENANT);
    expect(own.userId).toBe('user-7');
    expect(own.targetId).toBe(g.id);
    expect(details(own).command).toMatchObject({
      kind: 'score.adjust',
      actorType: 'user',
      revisionBefore: v0,
      revisionAfter: v0 + 1,
    });
    expect(details(own).change.before.homeScore).toBe(0);
    expect(details(own).change.after.homeScore).toBe(7);
    // The auto cue gets its own row too — as a side effect, not as the
    // record of the score change.
    const cueRow = rows.find((r: any) => r.action === 'SPORTS_CUE_FIRED');
    expect(cueRow).toBeDefined();
    expect(details(cueRow).change).toBeUndefined();
  });

  it('a command with an action-specific row (timeout) is not double-written', async () => {
    const { service, auditLog } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.callTimeout(TENANT, g.id, { team: 'home' }, {
      actor: { kind: 'user', userId: 'user-2' },
      commandId: 'cmd-attr-0002',
    });
    const rows = auditsFor(auditLog, 'cmd-attr-0002');
    expect(rows.map((r: any) => r.action)).toEqual(['SPORTS_TIMEOUT_CALLED']);
    // Stat fields are tracked per key in the change record.
    expect(details(rows[0]).change.before['stats.homeTimeouts']).toBeDefined();
    expect(details(rows[0]).change.after['stats.homeTimeouts']).toBe(
      details(rows[0]).change.before['stats.homeTimeouts'] - 1,
    );
  });

  it('an API-key call is attributed to the key, not just the user', async () => {
    const { service, auditLog } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.clockAction(TENANT, g.id, { action: 'start' }, {
      actor: { kind: 'user', userId: 'user-3', ref: 'api-key:key-1' },
      commandId: 'cmd-attr-0003',
    });
    const [row] = auditsFor(auditLog, 'cmd-attr-0003');
    expect(row.userId).toBe('user-3');
    expect(details(row).command).toMatchObject({ kind: 'clock.start', actorRef: 'api-key:key-1' });
    expect(details(row).change.after.clockRunning).toBe(true);
  });

  it('a scorekeeper link: the actor is the LINK, traceable to the mint row by fingerprint, and the token never appears', async () => {
    const { service, gameEvent, auditLog } = setup();
    const g: any = await newGame(service, 'basketball');
    const minted = await service.mintConsoleShare(TENANT, g.id, 'coach-1');
    const mintRow = auditLog.rows.find((r: any) => r.action === 'SPORTS_CONSOLE_SHARE_MINTED');
    expect(mintRow.userId).toBe('coach-1');
    expect(details(mintRow).linkFingerprint).toBe(consoleTokenFingerprint(minted.token));

    const { dto, ctx } = consoleCommand(minted.token, { team: 'home', delta: 2, commandId: 'cmd-attr-0004' });
    await service.adjustScore(TENANT, g.id, dto as any, ctx, { suppressAutoFinal: true });

    const score = gameEvent.rows.find((e: any) => e.type === 'SCORE');
    expect(score).toMatchObject({ actorType: 'console', actorUserId: null, commandId: 'cmd-attr-0004' });
    const [row] = auditsFor(auditLog, 'cmd-attr-0004');
    expect(row.userId).toBeNull();
    expect(details(row).command.actorRef).toBe(`console-link:${details(mintRow).linkFingerprint}`);
    const everything = JSON.stringify(auditLog.rows) + JSON.stringify(gameEvent.rows);
    expect(everything).not.toContain(minted.token);
    expect(everything).not.toContain(minted.token.split('.').pop());
  });

  it('a machine feed is attributed on its events without an audit row per snapshot', async () => {
    const { service, gameEvent, auditLog } = setup();
    const g: any = await newGame(service, 'basketball');
    const before = auditLog.rows.length;
    await service.ingest(TENANT, g.id, { homeScore: 2, awayScore: 0 }, {}, { actor: { kind: 'feed', ref: 'feed' } });
    const ingest = gameEvent.rows.filter((e: any) => e.type === 'INGEST').pop();
    expect(ingest).toMatchObject({ actorType: 'feed', actorUserId: null });
    expect(auditLog.rows.length).toBe(before);
  });

  it('the server clock-expiry sweep is attributed to the system', async () => {
    const { service, game, auditLog } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setStatus(TENANT, g.id, { status: 'LIVE' });
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 1000 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    game.rows[0].clockUpdatedAt = new Date(Date.now() - 5_000);
    await service.autoAdvanceExpiredClocks();
    const sys = auditLog.rows.filter((r: any) => details(r).command?.actorType === 'system');
    expect(sys.length).toBeGreaterThan(0);
    expect(details(sys[0]).command.actorRef).toBe('clock-advance');
    expect(sys[0].userId).toBeNull();
  });

  it('audit storage failure rolls the command back — no attribution-less state change', async () => {
    const { service, game, gameEvent, auditLog } = setup();
    const g: any = await newGame(service, 'basketball');
    const events = gameEvent.rows.length;
    auditLog.create = auditFailure;
    await expect(
      service.clockAction(TENANT, g.id, { action: 'start' }, 'user-1'),
    ).rejects.toThrow('simulated audit storage failure');
    expect(game.rows[0].clockRunning).toBe(false);
    expect(gameEvent.rows.length).toBe(events);
  });
});

describe('K12-F34 — presentation, configuration and admin actions', () => {
  it('a cue, an overlay, a scene and ribbon settings each commit their event WITH an attributed audit row', async () => {
    const { service, gameEvent, auditLog } = setup();
    const g: any = await newGame(service, 'football');
    const actor = { actor: { kind: 'user' as const, userId: 'user-5' } };

    await service.fireCue(TENANT, g.id, { key: 'touchdown' }, actor);
    await service.fireLiveOverlay(TENANT, g.id, { kind: 'review' }, actor);
    await service.recallScene(TENANT, g.id, 'tmpl-board', 10_000, actor);
    await service.extendScene(TENANT, g.id, 20_000, actor);
    await service.setRibbon(TENANT, g.id, { messages: ['GO TEAM'] }, actor);
    await service.setRibbon(TENANT, g.id, { messages: ['DEFENSE'] }, actor);
    await service.setAutoCelebrate(TENANT, g.id, false, actor);

    const byAction = (a: string) => auditLog.rows.filter((r: any) => r.action === a);
    for (const action of [
      'SPORTS_CUE_FIRED',
      'SPORTS_LIVE_OVERLAY_FIRED',
      'SPORTS_SCENE_RECALLED',
      'SPORTS_SCENE_EXTENDED',
      'SPORTS_RIBBON_MESSAGES_SET',
      'SPORTS_AUTO_CELEBRATE_SET',
    ]) {
      const rows = byAction(action);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.tenantId).toBe(TENANT);
        expect(r.userId).toBe('user-5');
        expect(details(r).actor).toEqual({ type: 'user', ref: null });
        // Each row points at the event it describes, which carries the actor.
        const ev = gameEvent.rows.find((e: any) => e.id === details(r).eventId);
        expect(ev).toMatchObject({ actorType: 'user', actorUserId: 'user-5' });
      }
    }
    // Configuration rows carry before/after.
    const ribbon = byAction('SPORTS_RIBBON_MESSAGES_SET');
    expect(details(ribbon[1])).toMatchObject({ before: ['GO TEAM'], after: ['DEFENSE'] });
    expect(details(byAction('SPORTS_AUTO_CELEBRATE_SET')[0])).toMatchObject({ before: true, after: false });
  });

  it('a failed audit write means the cue did NOT fire (it used to fire unrecorded)', async () => {
    const { service, gameEvent, auditLog } = setup();
    const g: any = await newGame(service, 'football');
    const events = gameEvent.rows.length;
    auditLog.create = auditFailure;
    await expect(service.fireCue(TENANT, g.id, { key: 'touchdown' }, 'user-1')).rejects.toThrow(
      'simulated audit storage failure',
    );
    expect(gameEvent.rows.length).toBe(events);
  });

  it('game admin: create, edit, spotlight and delete are audited; delete keeps the final result', async () => {
    const { service, game, auditLog } = setup();
    const g: any = await service.createGame(
      TENANT,
      { sport: 'basketball', homeTeam: 'Home', awayTeam: 'Away' },
      { actor: { kind: 'user', userId: 'admin-1' } },
    );
    await service.updateGameDetails(TENANT, g.id, { homeTeam: 'Eagles' }, 'admin-1');
    await service.setSpotlight(TENANT, g.id, { title: 'Player of the game' } as any, 'admin-1');
    game.rows[0].homeScore = 55;
    game.rows[0].awayScore = 48;
    await service.deleteGame(TENANT, g.id, 'admin-1');

    const actions = auditLog.rows.map((r: any) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'SPORTS_GAME_CREATED',
        'SPORTS_GAME_DETAILS_UPDATED',
        'SPORTS_SPOTLIGHT_SET',
        'SPORTS_GAME_DELETED',
      ]),
    );
    const edit = auditLog.rows.find((r: any) => r.action === 'SPORTS_GAME_DETAILS_UPDATED');
    expect(details(edit).values).toMatchObject({ homeTeam: 'Eagles' });
    const del = auditLog.rows.find((r: any) => r.action === 'SPORTS_GAME_DELETED');
    expect(del.userId).toBe('admin-1');
    expect(details(del).finalScore).toEqual({ home: 55, away: 48 });
    expect(game.rows).toHaveLength(0);
  });

  it('roster: add / re-score / remove are audited with before/after, and each bumps the game revision', async () => {
    const { service, game, auditLog } = setup();
    const g: any = await newGame(service, 'basketball');
    const v0 = game.rows[0].version;
    const p: any = await service.addPlayer(TENANT, g.id, { name: 'Sam', number: '12', stats: { PTS: '4' } }, 'coach-2');
    await service.updatePlayer(TENANT, g.id, p.id, { stats: { PTS: '6' } }, 'coach-2');
    await service.updatePlayer(TENANT, g.id, p.id, { number: '13' }, 'coach-2');
    await service.deletePlayer(TENANT, g.id, p.id, 'coach-2');

    const rows = auditLog.rows.filter((r: any) => String(r.action).startsWith('SPORTS_ROSTER_'));
    expect(rows.map((r: any) => r.action)).toEqual([
      'SPORTS_ROSTER_PLAYER_ADDED',
      'SPORTS_ROSTER_PLAYER_UPDATED',
      'SPORTS_ROSTER_PLAYER_UPDATED',
      'SPORTS_ROSTER_PLAYER_REMOVED',
    ]);
    expect(rows.every((r: any) => r.userId === 'coach-2')).toBe(true);
    expect(details(rows[1])).toMatchObject({ before: { stats: { PTS: '4' } }, after: { stats: { PTS: '6' } } });
    expect(details(rows[3]).stats).toEqual({ PTS: '6' });
    // Box-score edits (add, re-score, remove) move the revision; a cosmetic
    // number change does not.
    expect(game.rows[0].version).toBe(v0 + 3);
  });

  it('a box-score edit loses the race to FINAL instead of landing after the roll-up read the roster', async () => {
    const { service, game } = setup();
    const g: any = await newGame(service, 'basketball');
    const p: any = await service.addPlayer(TENANT, g.id, { name: 'Sam', stats: { PTS: '4' } });
    // The edit's pre-read saw a LIVE game; FINAL commits before its write.
    const originalFindFirst = game.findFirst;
    let raced = false;
    game.findFirst = async (args: any) => {
      const row = await originalFindFirst(args);
      if (!raced && row && row.status !== 'FINAL') {
        raced = true;
        // The double hands out live rows: copy what this read SAW first.
        const seen = { ...row };
        await service.setStatus(TENANT, g.id, { status: 'FINAL' }, 'admin-1');
        return seen;
      }
      return row;
    };
    await expect(
      service.updatePlayer(TENANT, g.id, p.id, { stats: { PTS: '40' } }, 'coach-2'),
    ).rejects.toMatchObject({ response: { code: 'GAME_FINAL' } });
    game.findFirst = originalFindFirst;
    const roster = await service.listRoster(TENANT, g.id);
    expect((roster[0] as any).stats).toEqual({ PTS: '4' });
  });
});
