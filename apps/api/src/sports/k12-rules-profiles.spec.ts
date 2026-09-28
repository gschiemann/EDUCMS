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
