/**
 * K12-F16 — the volunteer pad's Undo: a scorekeeper LINK undoes its OWN most
 * recent action, once (K12-F09 single-use inverse, K12-F34 attribution).
 *
 * Driven end to end through the REAL public console controller and the REAL
 * SportsService over the sports Prisma fake (sports-test-harness.ts), so the
 * link's fingerprint, the command receipts and the event trail are the ones
 * production writes — not hand-built rows.
 */
import { SportsConsoleController } from './sports-console.controller';
import { consoleTokenFingerprint, userCommand } from './game-command';
import { TENANT, classic, setup, newGame } from './sports-test-harness';
import { _resetIngestRateLimitMemoryForTests } from '../security/ingest-rate-limit';

beforeAll(() => {
  process.env.SPORTS_CONSOLE_SECRET =
    'test_console_secret_0123456789abcdef0123456789abcdef';
});
beforeEach(() => _resetIngestRateLimitMemoryForTests());

let ipSeq = 0;
const req = () => {
  ipSeq += 1;
  const ip = `198.51.100.${ipSeq % 250}`;
  return {
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
  } as any;
};

async function world(
  sport = 'basketball',
  scope: 'table' | 'scorer' | 'timer' | 'shot' = 'table',
  rulesProfile?: string,
) {
  const h = setup();
  const g: any = await newGame(h.service, sport, rulesProfile);
  const ctl = new SportsConsoleController(h.service, {
    publisher: null,
  } as any);
  const link = (
    await h.service.mintConsoleShare(TENANT, g.id, 'coach-1', undefined, scope)
  ).token;
  const ref = `console-link:${consoleTokenFingerprint(link)}`;
  const row = (): any => h.game.rows.find((r: any) => r.id === g.id);
  return { ...h, g, ctl, link, ref, row };
}

async function status(p: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await p;
    return 'ok';
  } catch (e: any) {
    return e?.status ?? 0;
  }
}

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e: any) {
    const r = typeof e?.getResponse === 'function' ? e.getResponse() : null;
    return r && typeof r === 'object'
      ? (r as Record<string, any>).code
      : undefined;
  }
}

describe('K12-F16 — a link undoes its own latest action, once', () => {
  it('+3 then Undo restores the score; the undo is attributed to the LINK; a second tap changes nothing', async () => {
    const w = await world();
    await w.ctl.score(
      w.link,
      { team: 'home', delta: 3, commandId: 'cmd-pad-000001' } as any,
      req(),
    );
    expect(w.row().homeScore).toBe(3);

    const out: any = await w.ctl.undo(
      w.link,
      { undoOf: 'cmd-pad-000001' },
      req(),
    );
    expect(out).toMatchObject({ ok: true, originalType: 'SCORE' });
    expect(w.row().homeScore).toBe(0);

    // The undo is on the event trail and the immutable audit log as this link.
    const undoEvent = w.gameEvent.rows.find(
      (e: any) => e.type === 'UNDO_SCORE',
    );
    expect(undoEvent).toMatchObject({
      actorType: 'console',
      actorUserId: null,
    });
    const audit: any = w.auditLog.rows.find(
      (r: any) => r.action === 'SPORTS_EVENT_UNDONE',
    );
    expect(audit.userId).toBeNull();
    expect(JSON.parse(audit.details).command).toMatchObject({
      actorType: 'console',
      actorRef: w.ref,
      kind: 'event.undo',
    });
    // The token itself is never recorded anywhere.
    expect(
      JSON.stringify(w.auditLog.rows) +
        JSON.stringify(w.gameEvent.rows) +
        JSON.stringify(w.gameCommand.rows),
    ).not.toContain(w.link.split('.').pop());

    // Single use: the retried / double-tapped undo is answered from its receipt.
    await w.ctl.score(
      w.link,
      { team: 'away', delta: 2, commandId: 'cmd-pad-000002' } as any,
      req(),
    );
    expect(
      await status(w.ctl.undo(w.link, { undoOf: 'cmd-pad-000001' }, req())),
    ).toBe(409); // no longer the latest
    expect(w.row()).toMatchObject({ homeScore: 0, awayScore: 2 });
    expect(
      w.gameEvent.rows.filter((e: any) => e.type === 'UNDO_SCORE'),
    ).toHaveLength(1);
  });

  it('the same undo sent twice (a lost response, a double tap) is ONE effect with the same answer', async () => {
    const w = await world();
    await w.ctl.score(
      w.link,
      { team: 'home', delta: 2, commandId: 'cmd-pad-000010' } as any,
      req(),
    );
    await w.ctl.score(
      w.link,
      { team: 'home', delta: 3, commandId: 'cmd-pad-000011' } as any,
      req(),
    );
    const a = await w.ctl.undo(w.link, { undoOf: 'cmd-pad-000011' }, req());
    const b = await w.ctl.undo(w.link, { undoOf: 'cmd-pad-000011' }, req());
    expect(b).toEqual(a);
    expect(w.row().homeScore).toBe(2);
    expect(
      w.gameEvent.rows.filter((e: any) => e.type === 'UNDO_SCORE'),
    ).toHaveLength(1);
  });

  it('only the LATEST action of the link: an older one is 409 CONSOLE_UNDO_NOT_LATEST and changes nothing', async () => {
    const w = await world();
    await w.ctl.score(
      w.link,
      { team: 'home', delta: 2, commandId: 'cmd-pad-000020' } as any,
      req(),
    );
    await w.ctl.score(
      w.link,
      { team: 'home', delta: 3, commandId: 'cmd-pad-000021' } as any,
      req(),
    );
    expect(
      await code(w.ctl.undo(w.link, { undoOf: 'cmd-pad-000020' }, req())),
    ).toBe('CONSOLE_UNDO_NOT_LATEST');
    expect(w.row().homeScore).toBe(5);
    await w.ctl.undo(w.link, { undoOf: 'cmd-pad-000021' }, req());
    expect(w.row().homeScore).toBe(2);
  });

  it("never someone else's action: the operator's command and another link's command are the same 404", async () => {
    const w = await world();
    // The operator's command (same game).
    const op = userCommand(
      { user: { id: 'coach-1' } },
      { team: 'home', delta: 1, commandId: 'cmd-op-0000001' },
    );
    await w.service.adjustScore(TENANT, w.g.id, op.dto as any, op.ctx);
    // A second link for the same game (a different fingerprint).
    const other = (
      await w.service.mintConsoleShare(
        TENANT,
        w.g.id,
        'coach-1',
        undefined,
        'scorer',
      )
    ).token;
    await w.ctl.score(
      other,
      { team: 'away', delta: 2, commandId: 'cmd-other-00001' } as any,
      req(),
    );

    for (const target of [
      'cmd-op-0000001',
      'cmd-other-00001',
      'cmd-never-issued',
    ]) {
      expect({
        target,
        code: await code(w.ctl.undo(w.link, { undoOf: target }, req())),
      }).toEqual({
        target,
        code: 'CONSOLE_UNDO_NOT_FOUND',
      });
    }
    expect(w.row()).toMatchObject({ homeScore: 1, awayScore: 2 });
    expect(
      w.gameEvent.rows.filter((e: any) => String(e.type).startsWith('UNDO_')),
    ).toHaveLength(0);
    // …while the other link CAN undo its own.
    await w.ctl.undo(other, { undoOf: 'cmd-other-00001' }, req());
    expect(w.row().awayScore).toBe(0);
  });

  it('a link cannot undo its own UNDO (undo-of-undo is not a thing), nor reach past it', async () => {
    const w = await world();
    await w.ctl.score(
      w.link,
      { team: 'home', delta: 3, commandId: 'cmd-pad-000030' } as any,
      req(),
    );
    await w.ctl.undo(w.link, { undoOf: 'cmd-pad-000030' }, req());
    const undoReceipt: any = w.gameCommand.rows.find(
      (r: any) => r.kind === 'event.undo',
    );
    expect(undoReceipt.actorRef).toBe(w.ref);
    expect(
      await code(w.ctl.undo(w.link, { undoOf: undoReceipt.commandId }, req())),
    ).toBe('CONSOLE_UNDO_NOT_FOUND');
    expect(w.row().homeScore).toBe(0);
  });

  it('an action that wrote no undoable event (a shot-clock tap) is 422 — the same reason the rail gives', async () => {
    // Classic rules: a shot clock that is on without a setup step, with the
    // 14 s partial reset (an NFHS game starts with its state-option clock OFF).
    const w = await world('basketball', 'shot', classic('basketball'));
    await w.ctl.shotClock(
      w.link,
      { action: 'reset', value: 14, commandId: 'cmd-pad-000040' } as any,
      req(),
    );
    expect(
      await status(w.ctl.undo(w.link, { undoOf: 'cmd-pad-000040' }, req())),
    ).toBe(422);
  });

  it('a clock start undone after the operator already paused it is 409 UNDO_CONFLICT — the later action wins', async () => {
    const w = await world('basketball', 'timer');
    await w.ctl.clock(
      w.link,
      { action: 'start', commandId: 'cmd-pad-000050' } as any,
      req(),
    );
    const op = userCommand({ user: { id: 'coach-1' } }, { action: 'pause' });
    await w.service.clockAction(TENANT, w.g.id, op.dto as any, op.ctx);
    expect(
      await code(w.ctl.undo(w.link, { undoOf: 'cmd-pad-000050' }, req())),
    ).toBe('UNDO_CONFLICT');
    expect(w.row().clockRunning).toBe(false);
  });

  it('a FINAL game refuses the undo (409 GAME_FINAL); only the operator can reopen it', async () => {
    const w = await world();
    await w.ctl.score(
      w.link,
      { team: 'home', delta: 2, commandId: 'cmd-pad-000060' } as any,
      req(),
    );
    const op = userCommand({ user: { id: 'coach-1' } }, { status: 'FINAL' });
    await w.service.setStatus(TENANT, w.g.id, op.dto as any, op.ctx);
    expect(
      await code(w.ctl.undo(w.link, { undoOf: 'cmd-pad-000060' }, req())),
    ).toBe('GAME_FINAL');
    // …and so does every other tap from the link.
    expect(
      await code(w.ctl.score(w.link, { team: 'home', delta: 1 }, req())),
    ).toBe('GAME_FINAL');
    expect(w.row().homeScore).toBe(2);
  });

  it('a revoked link cannot undo what it did before the revoke', async () => {
    const w = await world();
    await w.ctl.score(
      w.link,
      { team: 'home', delta: 3, commandId: 'cmd-pad-000070' } as any,
      req(),
    );
    await w.service.revokeConsoleShare(TENANT, w.g.id, 'coach-1');
    expect(
      await status(w.ctl.undo(w.link, { undoOf: 'cmd-pad-000070' }, req())),
    ).toBe(401);
    expect(w.row().homeScore).toBe(3);
  });
});
