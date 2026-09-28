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
  snapshotRules,
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
