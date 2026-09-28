/**
 * K-12 launch program, lane A3 — rules profiles per sport (register rows
 * K12-F01..F04, F19..F25, F27 of docs/research/2026-09-23-k12-sports-
 * readiness-audit/). Probes on the REAL SportsService over the lane-A1 fake
 * (sports-prisma-fake.ts), one or more per sport. Every probe names the rule
 * it proves and the source it comes from — the source ids are
 * @cms/api-types RULES_SOURCES, i.e. the documents of the audit's
 * 05-RULES-SOURCES.md. The catalog-level checks (fingerprint pins, the
 * shared helpers) are packages/api-types/src/sports-rules.spec.ts.
 *
 * Probe ids: R-<sport>-<n>. A probe that documents a KNOWN gap is
 * `it.failing` and names the lane that owns it.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  classicRulesKey,
  findRulesProfile,
  formatSportClock,
  snapshotRules,
  sportForGame,
} from '@cms/api-types';
import { TENANT, newGame, setup } from './sports-test-harness';

afterEach(() => jest.useRealTimers());

async function refusal(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected the command to be refused');
}

describe('K12-F01 — a versioned rules profile is bound to every game', () => {
  it("R-F01-1 a new game binds its sport's default profile and stores the resolved snapshot", async () => {
    const { service, auditLog } = setup();
    const g: any = await newGame(service, 'basketball');
    expect(g.rulesProfile).toBe('nfhs-basketball@2026-27');
    expect(g.rules).toMatchObject({
      v: 1,
      profile: 'nfhs-basketball@2026-27',
      sport: 'basketball',
    });
    expect(g.rules.clock.otSegmentMs).toBe(240_000);
    const created = auditLog.rows.find(
      (r: any) => r.action === 'SPORTS_GAME_CREATED',
    );
    expect(JSON.parse(created.details)).toMatchObject({
      rulesProfile: 'nfhs-basketball@2026-27',
    });
  });

  it('R-F01-2 the table can pick another level / association (junior-high volleyball, JV soccer)', async () => {
    const { service } = setup();
    const jh: any = await newGame(
      service,
      'volleyball',
      'uil-volleyball-junior-high@2026-27',
    );
    expect(jh.rules.setFormat).toMatchObject({
      bestOf: 3,
      cap: 30,
      autoFinal: false,
    });
    const jv: any = await newGame(service, 'soccer', 'ohsaa-soccer-jv@2025-26');
    expect(jv.clockMs).toBe(36 * 60_000);
  });

  it("R-F01-3 refuses an unknown profile, another sport's profile, and the retired alias", async () => {
    const { service } = setup();
    for (const rulesProfile of [
      'nfhs-basketball@1999',
      'nfhs-football@2025',
      classicRulesKey('swimming_diving'),
    ]) {
      const err = await refusal(
        service.createGame(TENANT, {
          sport: 'basketball',
          homeTeam: 'A',
          awayTeam: 'B',
          rulesProfile,
        }),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({
        code: 'RULES_PROFILE_UNKNOWN',
      });
    }
  });

  it('R-F01-4 a game keeps the rules it was created under — the stored snapshot decides, not the catalog', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    // What an OLDER version of the profile stored (a 3:00 overtime): the
    // engine must run the game's own snapshot, never today's catalog.
    g.rules = {
      ...g.rules,
      clock: { ...g.rules.clock, otSegmentMs: 3 * 60_000 },
    };
    await service.setSegment(TENANT, g.id, { segment: 5 });
    expect(g.clockMs).toBe(180_000);
  });

  it('R-F01-5 a game created before profiles (no snapshot) keeps the classic rules it always ran', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    g.rulesProfile = null;
    g.rules = null;
    await service.setSegment(TENANT, g.id, { segment: 5 });
    expect(g.clockMs).toBe(8 * 60_000); // the classic overtime: another full quarter
  });

  it("R-F01-6 a duplicate runs the same rules as its source, including the table's shot-clock choice", async () => {
    const { service } = setup();
    const src: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, src.id, {
      action: 'configure',
      value: 35,
    });
    const copy: any = await service.duplicateGame(TENANT, src.id);
    expect(copy.rulesProfile).toBe('nfhs-basketball@2026-27');
    expect(copy.rules).toEqual(src.rules);
    expect(copy.stats.shotClock).toMatchObject({ len: 35, running: false });
    expect(copy.stats.homeTimeouts).toBe(5);
  });

  it('R-F01-7 a game that has not started can switch profile (audited); a live game cannot', async () => {
    const { service, auditLog } = setup();
    const g: any = await newGame(
      service,
      'basketball',
      classicRulesKey('basketball'),
    );
    expect(g.stats.homeTimeouts).toBe(5); // classic: the stat maximum
    await service.setRulesProfile(TENANT, g.id, {
      rulesProfile: 'nfhs-basketball@2026-27',
      shotClockLen: 35,
    });
    expect(g.rulesProfile).toBe('nfhs-basketball@2026-27');
    expect(g.stats).toMatchObject({
      homeTimeouts: 5,
      homeShortTimeouts: 2,
      shotClock: { len: 35 },
    });
    expect(
      auditLog.rows.some((r: any) => r.action === 'SPORTS_GAME_RULES_SET'),
    ).toBe(true);

    await service.setStatus(TENANT, g.id, { status: 'LIVE' });
    const err = await refusal(
      service.setRulesProfile(TENANT, g.id, {
        rulesProfile: classicRulesKey('basketball'),
      }),
    );
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'RULES_LOCKED' });
    expect(g.rulesProfile).toBe('nfhs-basketball@2026-27');
  });

  it("R-F01-8 the public board carries the game's rules so every display follows them", async () => {
    const { service } = setup();
    const g: any = await newGame(
      service,
      'volleyball',
      'uil-volleyball-sub-varsity@2026-27',
    );
    const board: any = await service.getBoard(g.id);
    expect(board.rulesProfile).toBe('uil-volleyball-sub-varsity@2026-27');
    expect(board.rules).toEqual(
      snapshotRules(findRulesProfile('uil-volleyball-sub-varsity@2026-27')!),
    );
  });
});

/**
 * NFHS basketball — nfhs-basketball@2026-27. Sources: ncaa-nfhs-bb-2025-26
 * (NFHS column), nfhs-bb-changes-2023-24, nfhs-bb-fouls-2023-24,
 * kshsaa-bb-table-2026, nfhs-bb-clock-2026-27, nfhs-bb-resources.
 */
describe('NFHS basketball — K12-F02 / F03 / F04', () => {
  it('R-BB-1 (F02) overtime is 4:00 and continues the Q4 team fouls; Q1-Q3 boundaries still reset them', async () => {
    // "Four minutes" overtime; team fouls reset at the end of the first,
    // second and third quarters [ncaa-nfhs-bb-2025-26]; Q4 fouls remain at
    // the start of overtime [kshsaa-bb-table-2026].
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 3 } });
    await service.setSegment(TENANT, g.id, { segment: 2 });
    expect(g.stats.homeFouls ?? 0).toBe(0);
    await service.setSegment(TENANT, g.id, { segment: 4 });
    await service.updateStats(TENANT, g.id, {
      stats: { homeFouls: 5, awayFouls: 2 },
    });
    await service.setSegment(TENANT, g.id, { segment: 5 });
    expect({
      clock: g.clockMs,
      home: g.stats.homeFouls,
      away: g.stats.awayFouls,
    }).toEqual({ clock: 240_000, home: 5, away: 2 });
    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 6 } });
    await service.setSegment(TENANT, g.id, { segment: 6 });
    expect({ clock: g.clockMs, home: g.stats.homeFouls }).toEqual({
      clock: 240_000,
      home: 6,
    });
  });

  it('R-BB-2 (F03) one timeout bank per GAME: nothing comes back at halftime; each overtime adds one 60-second', async () => {
    // Three 60-second and two 30-second time-outs [ncaa-nfhs-bb-2025-26];
    // one more 60-second per extra period (5-11-5 — see the profile's
    // `unverified` list).
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    expect(g.stats).toMatchObject({
      homeTimeouts: 5,
      homeShortTimeouts: 2,
      awayTimeouts: 5,
    });
    await service.callTimeout(TENANT, g.id, { team: 'home', type: 'full' });
    await service.callTimeout(TENANT, g.id, { team: 'home', type: 'short' });
    await service.setSegment(TENANT, g.id, { segment: 3 });
    expect(g.stats).toMatchObject({ homeTimeouts: 3, homeShortTimeouts: 1 });
    await service.setSegment(TENANT, g.id, { segment: 5 }); // Q3 -> OT1
    expect(g.stats).toMatchObject({
      homeTimeouts: 4,
      homeShortTimeouts: 1,
      awayTimeouts: 6,
    });
    await service.setSegment(TENANT, g.id, { segment: 6 }); // OT2
    expect(g.stats.homeTimeouts).toBe(5);
  });

  it('R-BB-3 (F03) the timeout comes out of the bank the official signalled, and undo gives it back', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    for (let i = 0; i < 3; i++) {
      await service.callTimeout(TENANT, g.id, { team: 'away' });
    }
    // No full timeouts left: an explicit full is refused, visibly…
    const err = await refusal(
      service.callTimeout(TENANT, g.id, { team: 'away', type: 'full' }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({
      code: 'NO_TIMEOUTS_OF_KIND_LEFT',
      kind: 'full',
      full: 0,
      short: 2,
    });
    // …and a timeout with no kind named uses a 30-second one.
    const res: any = await service.callTimeout(TENANT, g.id, { team: 'away' });
    expect(res).toMatchObject({
      type: 'short',
      timeoutsRemaining: 1,
      shortTimeoutsRemaining: 1,
    });
    const ev = gameEvent.rows.filter((e: any) => e.type === 'TIMEOUT').pop();
    await service.undoEvent(TENANT, g.id, ev.id);
    expect(g.stats).toMatchObject({ awayTimeouts: 2, awayShortTimeouts: 2 });
  });

  it('R-BB-4 (F04) the bonus lamp lights for the team whose OPPONENT has five fouls this quarter', async () => {
    // Two free throws from the fifth team foul in each quarter, no
    // one-and-one [nfhs-bb-changes-2023-24; ncaa-nfhs-bb-2025-26].
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.updateStats(TENANT, g.id, {
      stats: { homeFouls: 5, awayFouls: 2 },
    });
    const board: any = await service.getBoard(g.id);
    expect(board.stats).toMatchObject({ awayBonus: true, homeBonus: false });
    // A new quarter clears it with the fouls.
    await service.setSegment(TENANT, g.id, { segment: 2 });
    const next: any = await service.getBoard(g.id);
    expect(next.stats).toMatchObject({ awayBonus: false, homeBonus: false });
  });

  it('R-BB-5 (F05/F04) the shot clock is a state option: OFF unless picked, 35 s when it is, nothing else', async () => {
    // State adoption, 35 seconds, no partial-reset rule
    // [ncaa-nfhs-bb-2025-26; nfhs-bb-resources].
    const { service } = setup();
    const off: any = await newGame(service, 'basketball');
    expect(off.stats.shotClock).toMatchObject({ len: 0, off: true });
    const err = await refusal(
      service.setShotClock(TENANT, off.id, { action: 'configure', value: 24 }),
    );
    expect(err.getResponse()).toMatchObject({
      code: 'SHOT_CLOCK_LENGTH_UNSUPPORTED',
      allowed: [0, 35],
    });
    const on: any = await service.createGame(TENANT, {
      sport: 'basketball',
      homeTeam: 'A',
      awayTeam: 'B',
      shotClockLen: 35,
    });
    expect(on.stats.shotClock).toMatchObject({ len: 35, ms: 35_000 });
    const bad = await refusal(
      service.createGame(TENANT, {
        sport: 'basketball',
        homeTeam: 'A',
        awayTeam: 'B',
        shotClockLen: 30,
      }),
    );
    expect(bad.getResponse()).toMatchObject({
      code: 'SHOT_CLOCK_LENGTH_UNSUPPORTED',
    });
  });

  it('R-BB-6 (F17) tenths in the final minute (a 0.3 s correction is on a tenths clock)', async () => {
    // Rule 5-9-5 administers 0.3 s on a clock that displays tenths
    // [nfhs-bb-clock-2026-27].
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    expect(formatSportClock(sportForGame(g), 4_300)).toBe('4.3');
    expect(formatSportClock(sportForGame(g), 64_000)).toBe('1:04');
  });

  it('R-BB-7 a classic game keeps the classic rules: 8:00 overtime, fouls cleared, halftime refill', async () => {
    const { service } = setup();
    const g: any = await newGame(
      service,
      'basketball',
      classicRulesKey('basketball'),
    );
    await service.updateStats(TENANT, g.id, {
      stats: { homeTimeouts: 1, homeFouls: 5 },
    });
    await service.setSegment(TENANT, g.id, { segment: 3 });
    expect(g.stats.homeTimeouts).toBe(5);
    await service.setSegment(TENANT, g.id, { segment: 4 });
    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 5 } });
    await service.setSegment(TENANT, g.id, { segment: 5 });
    expect({ clock: g.clockMs, fouls: g.stats.homeFouls ?? 0 }).toEqual({
      clock: 480_000,
      fouls: 0,
    });
  });
});

/** Score a rally point. */
async function point(service: any, id: string, team: 'home' | 'away') {
  await service.adjustScore(TENANT, id, { team, delta: 1 });
}

/**
 * Volleyball — nfhs-volleyball-varsity@2026-27, uil-volleyball-sub-varsity
 * and uil-volleyball-junior-high (@2026-27). Source: uil-volleyball-rally.
 * Pickleball — local formats, NOT verified (no listed source).
 */
describe('Volleyball / pickleball formats — K12-F19', () => {
  it('R-VB-1 varsity: sets to 25 by two with no cap, best of five, the fifth set to 15', async () => {
    // "3 out of 5 to 25 (no cap)", "5th game to 15 (no cap)" [uil-volleyball-rally].
    const { service } = setup();
    const g: any = await newGame(service, 'volleyball');
    await service.setScore(TENANT, g.id, { homeScore: 24, awayScore: 24 });
    await point(service, g.id, 'home');
    expect({ set: g.segment, home: g.homeScore }).toEqual({ set: 1, home: 25 });
    await service.setScore(TENANT, g.id, { homeScore: 31, awayScore: 31 });
    await point(service, g.id, 'away');
    await point(service, g.id, 'away');
    expect({ set: g.segment, awaySets: g.stats.awaySets }).toEqual({
      set: 2,
      awaySets: 1,
    });
    // To 2-2, then the fifth set is to 15.
    g.stats = { ...g.stats, homeSets: 2, awaySets: 2 };
    g.segment = 5;
    await service.setScore(TENANT, g.id, { homeScore: 14, awayScore: 13 });
    await point(service, g.id, 'home');
    expect({ status: g.status, homeSets: g.stats.homeSets }).toEqual({
      status: 'FINAL',
      homeSets: 3,
    });
  });

  it('R-VB-2 UIL sub-varsity: best of three, 25 by two capped at 30, the third set to 25 as well', async () => {
    // "2 out of 3 to 25 (cap at 30)", "3rd set to 25 (cap at 30)" [uil-volleyball-rally].
    const { service } = setup();
    const g: any = await newGame(
      service,
      'volleyball',
      'uil-volleyball-sub-varsity@2026-27',
    );
    await service.setScore(TENANT, g.id, { homeScore: 29, awayScore: 29 });
    await point(service, g.id, 'home'); // 30-29: the cap
    expect({ set: g.segment, homeSets: g.stats.homeSets }).toEqual({
      set: 2,
      homeSets: 1,
    });
    await service.setScore(TENANT, g.id, { homeScore: 0, awayScore: 24 });
    await point(service, g.id, 'away');
    expect(g.segment).toBe(3);
    await service.setScore(TENANT, g.id, { homeScore: 14, awayScore: 13 });
    await point(service, g.id, 'home'); // 15-13 is not a win in a set to 25
    expect({ set: g.segment, status: g.status }).toEqual({
      set: 3,
      status: 'SCHEDULED',
    });
    await service.setScore(TENANT, g.id, { homeScore: 24, awayScore: 20 });
    await point(service, g.id, 'home');
    expect({ status: g.status, homeSets: g.stats.homeSets }).toEqual({
      status: 'FINAL',
      homeSets: 2,
    });
  });

  it('R-VB-3 UIL junior high: 2-0 does not end the match — the deciding set may be played by consent', async () => {
    // "mutual consent to play deciding sets even after one team wins the
    // first two games" [uil-volleyball-rally].
    const { service } = setup();
    const g: any = await newGame(
      service,
      'volleyball',
      'uil-volleyball-junior-high@2026-27',
    );
    for (const set of [1, 2]) {
      await service.setScore(TENANT, g.id, { homeScore: 24, awayScore: 10 });
      await point(service, g.id, 'home');
      expect(g.stats.homeSets).toBe(set);
    }
    expect({ status: g.status, set: g.segment }).toEqual({
      status: 'SCHEDULED',
      set: 3,
    });
    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    expect(g.status).toBe('FINAL');
  });

  it('R-VB-4 two time-outs per set: a third is refused; a new set refills them; undoing the winning point restores all', async () => {
    // "two time-outs per game" (per set) [uil-volleyball-rally].
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'volleyball');
    expect(g.stats).toMatchObject({ homeTimeouts: 2, awayTimeouts: 2 });
    await service.callTimeout(TENANT, g.id, { team: 'home' });
    await service.callTimeout(TENANT, g.id, { team: 'home' });
    const err = await refusal(
      service.callTimeout(TENANT, g.id, { team: 'home' }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    await service.setScore(TENANT, g.id, { homeScore: 24, awayScore: 22 });
    await point(service, g.id, 'home');
    expect({ set: g.segment, timeouts: g.stats.homeTimeouts }).toEqual({
      set: 2,
      timeouts: 2,
    });
    const winning = gameEvent.rows
      .filter((e: any) => e.type === 'SCORE' && e.payload.delta === 1)
      .pop();
    await service.undoEvent(TENANT, g.id, winning.id);
    expect({
      set: g.segment,
      home: g.homeScore,
      sets: g.stats.homeSets ?? 0,
      timeouts: g.stats.homeTimeouts,
    }).toEqual({ set: 1, home: 24, sets: 0, timeouts: 0 });
  });

  it('R-PB-1 a local pickleball format (one game to 15) ends at 15 by two; not verified, and says so', async () => {
    const { service } = setup();
    const g: any = await newGame(
      service,
      'pickleball',
      'pickleball-bo1-15@2026-09',
    );
    expect(findRulesProfile(g.rulesProfile)!.verification).toBe('not-verified');
    await service.setScore(TENANT, g.id, { homeScore: 10, awayScore: 9 });
    await point(service, g.id, 'home'); // 11-9 is not a win in a game to 15
    expect(g.status).toBe('SCHEDULED');
    await service.setScore(TENANT, g.id, { homeScore: 14, awayScore: 14 });
    await point(service, g.id, 'home'); // 15-14: not by two
    expect(g.status).toBe('SCHEDULED');
    await point(service, g.id, 'home'); // 16-14
    expect({ status: g.status, games: g.stats.homeGames }).toEqual({
      status: 'FINAL',
      games: 1,
    });
  });

  it('R-PB-2 the classic pickleball format (best of three to 11) is unchanged', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'pickleball');
    expect(g.rulesProfile).toBe(classicRulesKey('pickleball'));
    await service.setScore(TENANT, g.id, { homeScore: 10, awayScore: 9 });
    await point(service, g.id, 'home');
    expect({ game: g.segment, won: g.stats.homeGames }).toEqual({
      game: 2,
      won: 1,
    });
  });
});

/**
 * Boys and girls lacrosse — nfhs-lacrosse-boys@2027 / @2026 and
 * nfhs-lacrosse-girls@2027. Sources: nfhs-blax-shot-clock-2027,
 * nfhs-glax-resources.
 */
describe('Lacrosse — K12-F24', () => {
  it('R-LAX-1 boys 2027: the shot clock is OFF unless the state adopted it; then 70 s and nothing else', async () => {
    // "By state association adoption, a 70-second shot clock … starting
    // with the 2027 season" [nfhs-blax-shot-clock-2027].
    const { service } = setup();
    const g: any = await newGame(service, 'lacrosse');
    expect(g.rulesProfile).toBe('nfhs-lacrosse-boys@2027');
    expect(g.stats.shotClock).toMatchObject({ len: 0, off: true });
    const err = await refusal(
      service.setShotClock(TENANT, g.id, { action: 'configure', value: 80 }),
    );
    expect(err.getResponse()).toMatchObject({
      code: 'SHOT_CLOCK_LENGTH_UNSUPPORTED',
      allowed: [0, 70],
    });
    await service.setShotClock(TENANT, g.id, {
      action: 'configure',
      value: 70,
    });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    await service.setSegment(TENANT, g.id, { segment: 2 });
    expect(g.stats.shotClock).toMatchObject({ len: 70, ms: 70_000 });
  });

  it('R-LAX-2 boys 2026: no shot clock at all — the 2027 option is not retroactive', async () => {
    const { service } = setup();
    const g: any = await newGame(
      service,
      'lacrosse',
      'nfhs-lacrosse-boys@2026',
    );
    const err = await refusal(
      service.setShotClock(TENANT, g.id, { action: 'configure', value: 70 }),
    );
    expect(err.getResponse()).toMatchObject({ code: 'SHOT_CLOCK_UNSUPPORTED' });
    expect(g.stats.shotClock).toBeUndefined();
    // …so no shot-clock operator link is handed out for it.
    await expect(
      service.mintConsoleShare(TENANT, g.id, 'coach', undefined, 'shot'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('R-LAX-3 girls 2027: a 90 s possession clock by state adoption, and the card suspensions', async () => {
    // 90-second possession clock by state adoption; yellow 2:00, red 4:00
    // [nfhs-glax-resources — 2027 possession clock; timers' Rule 3-7].
    const { service } = setup();
    const g: any = await newGame(
      service,
      'lacrosse',
      'nfhs-lacrosse-girls@2027',
    );
    const def = sportForGame(g)!;
    expect(def.shotClock).toMatchObject({
      full: 90,
      options: [0, 90],
      label: 'Possession clock',
    });
    expect(def.penaltyBox!.presets.map((p) => p.sec)).toEqual([120, 240, 120]);
    await service.setShotClock(TENANT, g.id, {
      action: 'configure',
      value: 90,
    });
    expect(g.stats.shotClock).toMatchObject({ len: 90 });
  });
});

/**
 * Baseball / softball — nfhs-baseball@2027, nfhs-softball@2027. Sources:
 * nfhs-baseball-rules, uil-baseball-regular, uil-baseball-post,
 * uil-softball-regular, nfhs-pitch-count.
 */
describe('Baseball / softball — K12-F20 / F21', () => {
  it('R-BASE-1 (F20) a varsity baseball game is seven innings; extra innings keep counting', async () => {
    // Rule 4-2-2: seven innings [nfhs-baseball-rules; uil-baseball-regular].
    const { service } = setup();
    const g: any = await newGame(service, 'baseball');
    expect(sportForGame(g)!.segment.count).toBe(7);
    await service.setSegment(TENANT, g.id, { segment: 8 });
    expect(g.segment).toBe(8);
    // The classic (MLB-style) nine innings stays available, and says what it is.
    const classic: any = await newGame(
      service,
      'baseball',
      classicRulesKey('baseball'),
    );
    expect(sportForGame(classic)!.segment.count).toBe(9);
  });

  it('R-BASE-2 (F20) a bases-loaded walk forces in a run — and one undo gives back the run, the bases and the count', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'baseball');
    await service.updateStats(TENANT, g.id, {
      stats: { half: 'Top', on1B: 1, on2B: 1, on3B: 1, balls: 3, strikes: 1 },
    });
    await service.updateStats(TENANT, g.id, { stats: { balls: 4 } });
    expect({ away: g.awayScore, balls: g.stats.balls }).toEqual({
      away: 1,
      balls: 0,
    });
    const walk = gameEvent.rows.filter((e: any) => e.type === 'STAT').pop();
    await service.undoEvent(TENANT, g.id, walk.id);
    expect({
      away: g.awayScore,
      balls: g.stats.balls,
      strikes: g.stats.strikes,
      bases: [g.stats.on1B, g.stats.on2B, g.stats.on3B],
    }).toEqual({ away: 0, balls: 3, strikes: 1, bases: [1, 1, 1] });
  });

  it('R-BASE-3 (F20) the third out flips the half and clears the bases — and undo restores outs, half, inning and bases', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'baseball');
    await service.updateStats(TENANT, g.id, {
      stats: { half: 'Bottom', outs: 2, on2B: 1 },
    });
    await service.updateStats(TENANT, g.id, { stats: { outs: 3 } });
    expect({
      inning: g.segment,
      half: g.stats.half,
      on2B: g.stats.on2B,
    }).toEqual({ inning: 2, half: 'Top', on2B: 0 });
    const out = gameEvent.rows
      .filter((e: any) => e.type === 'STAT' && e.payload.change)
      .pop();
    await service.undoEvent(TENANT, g.id, out.id);
    expect({
      inning: g.segment,
      half: g.stats.half,
      outs: g.stats.outs,
      on2B: g.stats.on2B,
    }).toEqual({ inning: 1, half: 'Bottom', outs: 2, on2B: 1 });
  });

  it('R-BASE-4 (F21) the pitch count is a count on the board — never an eligibility decision', async () => {
    // Each state association sets its own pitch-count policy
    // [nfhs-pitch-count]: the profile says so, and the engine stores the
    // number it is given, nothing more.
    const profile = findRulesProfile('nfhs-baseball@2027')!;
    expect(profile.notes.join(' ')).toMatch(/display count only/i);
    const { service } = setup();
    const g: any = await newGame(service, 'baseball');
    await service.updateStats(TENANT, g.id, { stats: { homePitchCount: 111 } });
    expect(g.stats.homePitchCount).toBe(111);
    expect(g.stats).not.toHaveProperty('homePitcherEligible');
  });

  it('R-SOFT-1 (F20) softball is seven innings', async () => {
    // Seven innings unless tied [uil-softball-regular].
    const { service } = setup();
    const g: any = await newGame(service, 'softball');
    expect(g.rulesProfile).toBe('nfhs-softball@2027');
    expect(sportForGame(g)!.segment.count).toBe(7);
  });
});

/**
 * Soccer — nfhs-soccer@2025-26, nfhs-soccer-quarters@2025-26,
 * ohsaa-soccer-jv@2025-26. Sources: nfhs-soccer-guide-2024-25,
 * ohsaa-soccer-timekeeper, nfhs-soccer-2025-26.
 */
describe('Soccer — K12-F22', () => {
  it('R-SOC-1 two 40:00 halves on a clock that counts DOWN, and holds at 0:00 until the table advances', async () => {
    // "2- 40 min. periods"; the timer counts down the last ten seconds
    // [nfhs-soccer-guide-2024-25; ohsaa-soccer-timekeeper].
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-02T19:00:00Z'));
    const { service } = setup();
    const g: any = await newGame(service, 'soccer');
    expect({ kind: sportForGame(g)!.clock.type, clock: g.clockMs }).toEqual({
      kind: 'countdown',
      clock: 40 * 60_000,
    });
    await service.setStatus(TENANT, g.id, { status: 'LIVE' });
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 5_000 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    jest.setSystemTime(new Date('2026-10-02T19:00:06Z'));
    await service.autoAdvanceExpiredClocks();
    expect({
      half: g.segment,
      clock: g.clockMs,
      running: g.clockRunning,
    }).toEqual({ half: 1, clock: 0, running: false });
  });

  it('R-SOC-2 the clock stops rather than adding time: no added-time stat under NFHS', async () => {
    // Goals, penalty kicks, cards and the referee's signal stop the clock
    // [nfhs-soccer-guide-2024-25].
    const { service } = setup();
    const g: any = await newGame(service, 'soccer');
    expect(sportForGame(g)!.stats.some((s) => s.key === 'addedTime')).toBe(
      false,
    );
    await service.updateStats(TENANT, g.id, { stats: { addedTime: 3 } });
    expect(g.stats.addedTime).toBeUndefined();
  });

  it('R-SOC-3 overtime: two 10:00 periods at most (state option, listed as unverified)', async () => {
    // "Overtime allowed by state association, up to 20 mins. maximum"
    // [nfhs-soccer-guide-2024-25].
    const { service } = setup();
    const g: any = await newGame(service, 'soccer');
    await service.setSegment(TENANT, g.id, { segment: 3 });
    expect(g.clockMs).toBe(10 * 60_000);
    await service.setSegment(TENANT, g.id, { segment: 9 });
    expect(g.segment).toBe(4); // two overtime periods, no more
  });

  it('R-SOC-4 the level and format are selectable: four 20:00 quarters; OHSAA JV 36:00 halves', async () => {
    const { service } = setup();
    const q: any = await newGame(
      service,
      'soccer',
      'nfhs-soccer-quarters@2025-26',
    );
    expect({
      clock: q.clockMs,
      periods: sportForGame(q)!.segment,
    }).toMatchObject({
      clock: 20 * 60_000,
      periods: { name: 'Quarter', count: 4 },
    });
    const jv: any = await newGame(service, 'soccer', 'ohsaa-soccer-jv@2025-26');
    expect(jv.clockMs).toBe(36 * 60_000);
  });
});

/**
 * Wrestling — nfhs-wrestling@2025-26, kshsaa-wrestling-ms@2025-26. Sources:
 * kshsaa-wrestling-2025-26, nfhs-wrestling-poster-2024-25,
 * nfhs-wrestling-resources.
 */
describe('Wrestling — K12-F23', () => {
  it('R-WR-1 overtime is 1:00 sudden victory, two 0:30 tiebreakers, a 0:30 ultimate tiebreaker — and no more', async () => {
    // NFHS Rule 6-7 as the KSHSAA 2025-26 manual prints it
    // [kshsaa-wrestling-2025-26].
    const { service } = setup();
    const g: any = await newGame(service, 'wrestling');
    const seen: Array<[number, number, string]> = [];
    for (const period of [3, 4, 5, 6, 7]) {
      await service.setSegment(TENANT, g.id, { segment: period });
      const cue = (service as any).cueSnapshot(g);
      seen.push([g.segment, g.clockMs, cue.segmentLabel]);
    }
    expect(seen).toEqual([
      [3, 120_000, 'P3'],
      [4, 60_000, 'SV'],
      [5, 30_000, 'TB1'],
      [6, 30_000, 'TB2'],
      [7, 30_000, 'UTB'],
    ]);
    await service.setSegment(TENANT, g.id, { delta: 1 });
    expect(g.segment).toBe(7);
  });

  it('R-WR-2 no riding time in NFHS scoring; a takedown is worth three (the +3 quick add)', async () => {
    // No riding time among the NFHS scoring symbols [nfhs-wrestling-resources];
    // three match points for a takedown [nfhs-wrestling-poster-2024-25].
    const { service } = setup();
    const g: any = await newGame(service, 'wrestling');
    const def = sportForGame(g)!;
    expect(def.stats.some((s) => s.key === 'homeRideTime')).toBe(false);
    expect(def.score.increments).toContain(3);
    await service.updateStats(TENANT, g.id, { stats: { homeRideTime: 60 } });
    expect(g.stats.homeRideTime).toBeUndefined();
  });

  it('R-WR-3 KSHSAA 7th/8th grade: periods of 1:00, 1:30, 1:30', async () => {
    // [kshsaa-wrestling-2025-26 — middle school provisions].
    const { service } = setup();
    const g: any = await newGame(
      service,
      'wrestling',
      'kshsaa-wrestling-ms@2025-26',
    );
    const lengths: number[] = [g.clockMs];
    for (const period of [2, 3, 4]) {
      await service.setSegment(TENANT, g.id, { segment: period });
      lengths.push(g.clockMs);
    }
    expect(lengths).toEqual([60_000, 90_000, 90_000, 60_000]);
  });
});

/**
 * Ice hockey, field hockey, water polo — NOT verified (the listed sources
 * point at rule books that are not public). Each probe proves the structure;
 * the values are on the profile's `unverified` list for the official scorer.
 */
describe('Hockey / field hockey / water polo — K12-F25', () => {
  it('R-HOC-1 ice hockey: overtime has its own length, not another 17:00 period; one time-out per team', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'hockey');
    expect(findRulesProfile(g.rulesProfile)!.verification).toBe('not-verified');
    await service.setSegment(TENANT, g.id, { segment: 4 });
    expect(g.clockMs).toBe(8 * 60_000);
    expect(g.stats.homeTimeouts).toBe(1);
    await service.callTimeout(TENANT, g.id, { team: 'home' });
    const err = await refusal(
      service.callTimeout(TENANT, g.id, { team: 'home' }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it('R-FH-1 field hockey: overtime is its own 10:00 period, not a regulation quarter', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'field_hockey');
    await service.setSegment(TENANT, g.id, { segment: 5 });
    expect(g.clockMs).toBe(10 * 60_000);
  });

  it('R-WP-1 water polo: seven-minute quarters by default (the other lengths stay selectable), 3:00 overtime', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'water_polo');
    expect(g.clockMs).toBe(7 * 60_000);
    const ncaa: any = await service.createGame(TENANT, {
      sport: 'water_polo',
      homeTeam: 'A',
      awayTeam: 'B',
      clockSegmentMs: 8 * 60_000,
    });
    expect(ncaa.clockMs).toBe(8 * 60_000);
    await service.setSegment(TENANT, g.id, { segment: 5 });
    expect(g.clockMs).toBe(3 * 60_000);
  });
});

/** Tenths per sport — from the profile's clock (K12-F17 display policy). */
describe('Tenths per sport — from the rules profile', () => {
  it('R-TEN-1 basketball, hockey and water polo show tenths in the final minute; soccer, lacrosse and wrestling do not', async () => {
    const { service } = setup();
    const tenths: Record<string, string> = {};
    for (const sport of [
      'basketball',
      'hockey',
      'water_polo',
      'soccer',
      'lacrosse',
      'wrestling',
    ]) {
      const g: any = await newGame(service, sport);
      tenths[sport] = formatSportClock(sportForGame(g), 9_400);
    }
    expect(tenths).toEqual({
      basketball: '9.4',
      hockey: '9.4',
      water_polo: '9.4',
      soccer: '0:10',
      lacrosse: '0:10',
      wrestling: '0:10',
    });
  });
});

/** K12-F27 — sports and levels with no verified profile say so. */
describe('Catalog honesty — K12-F27', () => {
  it('R-CAT-1 every sport without a listed source resolves to a profile marked not-verified', async () => {
    const { service } = setup();
    for (const sport of [
      'pickleball',
      'track_and_field',
      'swimming',
      'diving',
      'cross_country',
      'gymnastics',
      'golf',
      'competitive_cheer',
    ]) {
      const g: any = await newGame(service, sport);
      expect([sport, findRulesProfile(g.rulesProfile)!.verification]).toEqual([
        sport,
        'not-verified',
      ]);
    }
  });
});
