/**
 * K-12 launch program, lane A4 — K12-F36: automatic celebrations fire from a
 * SCORING PLAY, once per play, under the table's shared settings, and never
 * from a correction or an undo. Probes on the REAL SportsService over the
 * lane-A1 fake (sports-prisma-fake.ts).
 *
 * The audit's acceptance: across two replicas, toggle off and score — no cue;
 * two distinct quick scores each behave correctly; retrying one score does not
 * duplicate its cue; an upward correction stays quiet unless explicitly
 * requested.
 */
import { BadRequestException } from '@nestjs/common';
import { SportsService } from './sports.service';
import { TENANT, newGame, setup } from './sports-test-harness';

type Ctx = ReturnType<typeof setup>;

/** A second API process over the same database (another replica). */
function replica(ctx: Ctx): SportsService {
  return new SportsService(
    { client: ctx.client } as any,
    { publish: async () => undefined } as any,
    { signMessage: () => ({ eventId: 'e', signature: 's' }) } as any,
    { listActive: async () => [] } as any,
    { isEnabledAsync: async () => false } as any,
  );
}

const cues = (ctx: Ctx) => ctx.gameEvent.rows.filter((e: any) => e.type === 'CUE').map((e: any) => ({ id: e.id, ...e.payload }));
const autoCues = (ctx: Ctx) => cues(ctx).filter((c: any) => c.auto === true && c.play);
const cancels = (ctx: Ctx) => ctx.gameEvent.rows.filter((e: any) => e.type === 'CUE_CANCEL').map((e: any) => e.payload);

async function live(ctx: Ctx, sport: string) {
  const g: any = await newGame(ctx.service, sport);
  await ctx.service.setStatus(TENANT, g.id, { status: 'LIVE' });
  return g;
}

describe('K12-F36 — the audit acceptance', () => {
  it('CEL-1 across two replicas: switched off on one, a score on the other fires nothing', async () => {
    const ctx = setup();
    const other = replica(ctx);
    const g = await live(ctx, 'soccer');
    await other.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    expect(autoCues(ctx)).toHaveLength(1); // on: the other replica celebrated
    await ctx.service.setAutoCelebrate(TENANT, g.id, { enabled: false }, 'user-1');
    await other.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    expect(autoCues(ctx)).toHaveLength(1); // it read the switch, not a stale copy
  });

  it('CEL-2 two distinct quick scores both celebrate (auto after auto is never silenced)', async () => {
    const ctx = setup();
    const g = await live(ctx, 'soccer');
    await ctx.service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    await ctx.service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    const fired = autoCues(ctx);
    expect(fired.map((c: any) => c.key)).toEqual(['goal', 'goal']);
    // Each names its own play.
    expect(new Set(fired.map((c: any) => c.play.eventId)).size).toBe(2);
  });

  it('CEL-3 retrying one score (same command id) does not duplicate its cue', async () => {
    const ctx = setup();
    const g = await live(ctx, 'basketball');
    const cmd = { actor: { kind: 'user' as const, userId: 'user-1' }, commandId: 'tap-7f3' };
    await ctx.service.adjustScore(TENANT, g.id, { team: 'away', delta: 3 }, cmd);
    await ctx.service.adjustScore(TENANT, g.id, { team: 'away', delta: 3 }, cmd);
    expect(autoCues(ctx)).toHaveLength(1);
    expect(ctx.game.rows[0].awayScore).toBe(3);
  });

  it('CEL-4 an upward correction stays quiet unless marked a play', async () => {
    const ctx = setup();
    const g = await live(ctx, 'basketball');
    await ctx.service.setScore(TENANT, g.id, { homeScore: 13 }, 'user-1'); // 10→13 typo fix, from 0 here
    expect(cues(ctx)).toHaveLength(0);
    await ctx.service.setScore(TENANT, g.id, { homeScore: 16, celebrate: true }, 'user-1');
    expect(autoCues(ctx).map((c: any) => c.key)).toEqual(['threePointer']);
  });
});

describe('K12-F36 — a named cue and the automatic one for the same play', () => {
  it('CEL-5 a named cue BEFORE the score narrates that play once; the next play celebrates', async () => {
    const ctx = setup();
    const g = await live(ctx, 'soccer');
    await ctx.service.fireCue(TENANT, g.id, { key: 'goal', team: 'home', scorerName: 'Rivera' }, 'user-1');
    await ctx.service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    expect(autoCues(ctx)).toHaveLength(0); // the named cue was this play's
    // A second goal seconds later is a different play — it celebrates (the
    // old ten-second team mutex swallowed it).
    await ctx.service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    expect(autoCues(ctx)).toHaveLength(1);
    // The other team was never silenced.
    await ctx.service.fireCue(TENANT, g.id, { key: 'goal', team: 'home' }, 'user-1');
    await ctx.service.adjustScore(TENANT, g.id, { team: 'away', delta: 1 });
    expect(autoCues(ctx).map((c: any) => c.team)).toEqual(['home', 'away']);
  });

  it('CEL-6 a named cue AFTER the automatic one replaces it on every surface', async () => {
    const ctx = setup();
    const g = await live(ctx, 'soccer');
    await ctx.service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    const [auto] = autoCues(ctx);
    await ctx.service.fireCue(TENANT, g.id, { key: 'goal', team: 'home', scorerName: 'Rivera' }, 'user-1');
    const named = cues(ctx).pop();
    expect(named).toMatchObject({ key: 'goal', replaces: auto.id, scorerName: 'Rivera' });
    expect(cancels(ctx)).toEqual([{ cancels: auto.id, reason: 'replaced' }]);
    const board: any = await ctx.service.getBoard(g.id);
    expect(board.cueCancels.map((c: any) => c.cancels)).toEqual([auto.id]);
    // A second named cue for the same play does not cancel anything more.
    await ctx.service.fireCue(TENANT, g.id, { key: 'penalty', team: 'home' }, 'user-1');
    expect(cancels(ctx)).toHaveLength(1);
  });
});

describe('K12-F36 — never on an undo', () => {
  it('CEL-7 undoing the play withdraws its cue, and the undo fires none', async () => {
    const ctx = setup();
    const g = await live(ctx, 'basketball');
    await ctx.service.adjustScore(TENANT, g.id, { team: 'home', delta: 3 }, 'user-1');
    const [three] = autoCues(ctx);
    const score = ctx.gameEvent.rows.filter((e: any) => e.type === 'SCORE').pop();
    await ctx.service.undoEvent(TENANT, g.id, score.id, 'user-1');
    expect(cues(ctx)).toHaveLength(1); // nothing new fired
    expect(cancels(ctx)).toEqual([{ cancels: three.id, reason: 'undo', derived: true }]);
    const board: any = await ctx.service.getBoard(g.id);
    expect(board.cueCancels.map((c: any) => c.cancels)).toEqual([three.id]);
  });

  it('CEL-8 undoing a set-winning point withdraws the set cue it fired', async () => {
    const ctx = setup();
    const g = await live(ctx, 'volleyball');
    await ctx.service.setScore(TENANT, g.id, { homeScore: 24, awayScore: 20 });
    await ctx.service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    const setCue = cues(ctx).find((c: any) => c.key === 'setWin');
    expect(setCue).toBeTruthy();
    const winning = ctx.gameEvent.rows.filter((e: any) => e.type === 'SCORE' && e.payload.delta === 1).pop();
    await ctx.service.undoEvent(TENANT, g.id, winning.id);
    expect(cancels(ctx).map((c: any) => c.cancels)).toEqual([setCue.id]);
  });
});

describe('K12-F36 — the shared settings', () => {
  it('CEL-9 which cues fire: a cue switched off stays quiet, the others fire', async () => {
    const ctx = setup();
    const g = await live(ctx, 'football');
    const view: any = await ctx.service.setAutoCelebrate(TENANT, g.id, { off: ['fieldGoal', 'not-a-cue'] });
    expect(view.off).toEqual(['fieldGoal']);
    expect(view.available.map((c: any) => c.key)).toEqual(['touchdown', 'fieldGoal']);
    await ctx.service.adjustScore(TENANT, g.id, { team: 'home', delta: 3 });
    await ctx.service.adjustScore(TENANT, g.id, { team: 'home', delta: 6 });
    expect(autoCues(ctx).map((c: any) => c.key)).toEqual(['touchdown']);
  });

  it('CEL-10 the cooldown: a second celebration inside it stays quiet', async () => {
    const ctx = setup();
    const g = await live(ctx, 'hockey');
    await ctx.service.setAutoCelebrate(TENANT, g.id, { cooldownSec: 30 });
    await ctx.service.adjustScore(TENANT, g.id, { team: 'home', delta: 1 });
    await ctx.service.adjustScore(TENANT, g.id, { team: 'away', delta: 1 });
    expect(autoCues(ctx)).toHaveLength(1);
    await expect(ctx.service.setAutoCelebrate(TENANT, g.id, { cooldownSec: 7 })).rejects.toThrow(BadRequestException);
    expect(((await ctx.service.getAutoCelebrate(TENANT, g.id)) as any).cooldownSec).toBe(30);
  });

  it('CEL-11 a machine feed’s higher score is the play: recorded, and its cue names it', async () => {
    const ctx = setup();
    const g = await live(ctx, 'water_polo');
    await ctx.service.ingestByFeed(g.id, { homeScore: 1 });
    await ctx.service.ingestByFeed(g.id, { homeScore: 1 }); // a re-send: no play
    const ingest = ctx.gameEvent.rows.filter((e: any) => e.type === 'INGEST');
    expect(ingest[0].payload.plays).toEqual([{ team: 'home', points: 1 }]);
    const fired = autoCues(ctx);
    expect(fired).toHaveLength(1);
    expect(fired[0].play).toEqual({ eventId: ingest[0].id, team: 'home', points: 1 });
  });
});
