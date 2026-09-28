/**
 * K-12 launch program, lane A4 — K12-F18: the engine names a winner from the
 * SPORT's result model (@cms/api-types sports-result.ts), never from the raw
 * score columns. Probes on the REAL SportsService over the lane-A1 fake.
 *
 * The audit's reproduction: a volleyball match ends 3–1, the rally columns
 * were zeroed by the last set, and the final cue announced "TIED · GAME
 * OVER" (it compared homeScore with awayScore). Every probe below ends a game
 * whose raw columns disagree with its real result.
 */
import { getAthleteGameLog } from './sports-stats.service';
import { TENANT, newGame, setup } from './sports-test-harness';

async function point(service: any, id: string, team: 'home' | 'away') {
  await service.adjustScore(TENANT, id, { team, delta: 1 });
}

/** Win the set in play for `team`, from 24–`other` (a set to 25). */
async function winSet(service: any, id: string, team: 'home' | 'away', other = 20) {
  await service.setScore(TENANT, id, team === 'home' ? { homeScore: 24, awayScore: other } : { homeScore: other, awayScore: 24 });
  await point(service, id, team);
}

function finalCues(gameEvent: { rows: any[] }) {
  return gameEvent.rows.filter((e) => e.type === 'CUE' && String(e.payload.key).startsWith('status:final'));
}

describe('K12-F18 — the final result comes from the sport, not the raw columns', () => {
  it('RES-1 volleyball 3–1 (set majority ends it): the final cue announces home 3–1, and the set history is kept', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'volleyball');
    await winSet(service, g.id, 'home', 20);
    await winSet(service, g.id, 'away', 22);
    await winSet(service, g.id, 'home', 18);
    await winSet(service, g.id, 'home', 23);
    expect(g.status).toBe('FINAL');
    // The rally columns were zeroed by the last set — the old cue read them.
    expect({ home: g.homeScore, away: g.awayScore }).toEqual({ home: 0, away: 0 });
    expect(g.stats.setScores).toEqual([
      { home: 25, away: 20 },
      { home: 22, away: 25 },
      { home: 25, away: 18 },
      { home: 25, away: 23 },
    ]);
    const cues = finalCues(gameEvent);
    expect(cues).toHaveLength(1);
    expect(cues[0].payload).toMatchObject({
      key: 'status:final-home',
      source: 'set-majority',
      snapshot: { homeScore: 3, awayScore: 1, segmentLabel: '' },
      result: { basis: 'sets', outcome: 'home', home: 3, away: 1 },
    });
  });

  it('RES-2 volleyball ended by the table after the end-set macro: home wins, not a 0–0 tie', async () => {
    const { service, gameEvent } = setup();
    // Junior high: the set majority does not end the match by itself.
    const g: any = await newGame(service, 'volleyball', 'uil-volleyball-junior-high@2026-27');
    await service.setScore(TENANT, g.id, { homeScore: 25, awayScore: 19 });
    await service.endSegmentAtomic(TENANT, g.id);
    await service.setScore(TENANT, g.id, { homeScore: 25, awayScore: 21 });
    await service.endSegmentAtomic(TENANT, g.id);
    expect(g.stats).toMatchObject({ homeSets: 2, setScores: [{ home: 25, away: 19 }, { home: 25, away: 21 }] });
    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    expect({ home: g.homeScore, away: g.awayScore }).toEqual({ home: 0, away: 0 });
    expect(finalCues(gameEvent).map((c) => c.payload.key)).toEqual(['status:final-home']);
  });

  it('RES-3 a set credited by advancing the set by hand keeps its points too', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'volleyball');
    await service.setScore(TENANT, g.id, { homeScore: 17, awayScore: 23 });
    await service.setSegment(TENANT, g.id, { delta: 1 });
    expect(g.stats).toMatchObject({ awaySets: 1, setScores: [{ home: 17, away: 23 }] });
  });

  it('RES-4 undoing the set-winning point takes the set history entry back with the credit', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'volleyball');
    await winSet(service, g.id, 'home', 22);
    expect(g.stats.setScores).toHaveLength(1);
    const winning = gameEvent.rows.filter((e: any) => e.type === 'SCORE' && e.payload.delta === 1).pop();
    await service.undoEvent(TENANT, g.id, winning.id);
    expect(g.stats.setScores ?? []).toEqual([]);
    expect(g.stats.homeSets ?? 0).toBe(0);
  });

  it('RES-5 a wrestling dual is won on team points, against the last bout’s winner', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'wrestling');
    await service.updateStats(TENANT, g.id, { stats: { homeTeamPoints: 30, awayTeamPoints: 27 } });
    // The last bout on the mat: away 9–2.
    await service.setScore(TENANT, g.id, { homeScore: 2, awayScore: 9 });
    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    expect(finalCues(gameEvent)[0].payload).toMatchObject({
      key: 'status:final-home',
      snapshot: { homeScore: 30, awayScore: 27 },
      result: { basis: 'team-points', winner: 'home' },
    });
  });

  it('RES-6 golf and cross-country: the lower total is announced as the winner', async () => {
    const { service, gameEvent } = setup();
    const golf: any = await newGame(service, 'golf');
    await service.setScore(TENANT, golf.id, { homeScore: 312, awayScore: 305 });
    await service.setStatus(TENANT, golf.id, { status: 'FINAL' });
    const xc: any = await newGame(service, 'cross_country');
    await service.setScore(TENANT, xc.id, { homeScore: 27, awayScore: 30 });
    await service.setStatus(TENANT, xc.id, { status: 'FINAL' });
    expect(finalCues(gameEvent).map((c) => c.payload.key)).toEqual(['status:final-away', 'status:final-home']);
  });

  it('RES-7 a legitimate tie is a tie; a final that recorded nothing is never called a tie', async () => {
    const { service, gameEvent } = setup();
    const soccer: any = await newGame(service, 'soccer');
    await service.setStatus(TENANT, soccer.id, { status: 'LIVE' });
    await service.setStatus(TENANT, soccer.id, { status: 'FINAL' });
    const vb: any = await newGame(service, 'volleyball');
    await service.setStatus(TENANT, vb.id, { status: 'FINAL' });
    expect(finalCues(gameEvent).map((c) => c.payload.key)).toEqual(['status:final-tie', 'status:final-none']);
  });

  it('RES-8 a corrected final announces the corrected result (reopen → correct → end again)', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'wrestling');
    await service.updateStats(TENANT, g.id, { stats: { homeTeamPoints: 30, awayTeamPoints: 27 } });
    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    await service.reopenGame(TENANT, g.id, { reason: 'Bout 12 was a pin, not a decision' });
    await service.updateStats(TENANT, g.id, { stats: { awayTeamPoints: 33 } });
    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    const cues = finalCues(gameEvent);
    expect(cues.map((c) => c.payload.key)).toEqual(['status:final-home', 'status:final-away']);
    // Each announcement names the revision it was read from.
    expect(cues[1].payload.result.revision).toBeGreaterThan(cues[0].payload.result.revision);
  });

  it('RES-9 the athlete game log grades W / L from the result, and only once the game is final', async () => {
    const { service, client, rosterPlayer } = setup();
    const vb: any = await newGame(service, 'volleyball');
    const live: any = await newGame(service, 'basketball');
    for (const [gameId, team] of [[vb.id, 'away'], [live.id, 'home']] as const) {
      rosterPlayer.rows.push({ id: `rp-${gameId}`, tenantId: TENANT, gameId, team, name: 'A. Lee', stats: {}, personId: 'person-1', createdAt: new Date() });
    }
    await winSet(service, vb.id, 'home', 20);
    await winSet(service, vb.id, 'home', 20);
    await winSet(service, vb.id, 'home', 20);
    await service.setScore(TENANT, live.id, { homeScore: 40, awayScore: 31 });
    const log = await getAthleteGameLog(client as any, { tenantId: TENANT, personId: 'person-1' });
    const byGame = Object.fromEntries(log.map((e) => [e.gameId, e]));
    // The athlete played for AWAY in a 3–0 match: a loss, 0 sets to 3.
    expect(byGame[vb.id]).toMatchObject({ result: 'L', teamScore: 0, opponentScore: 3 });
    // A game still in play has no result yet.
    expect(byGame[live.id]).toMatchObject({ result: null, teamScore: 40, opponentScore: 31 });
  });
});
