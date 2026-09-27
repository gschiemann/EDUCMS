/**
 * K-12 sports launch program, lane A2 (2026-09-27) — clocks and the game
 * lifecycle, on the real SportsService over sports-prisma-fake.ts (the same
 * double as the acceptance probes: per-transaction rollback, real
 * compare-and-swap, Prisma error codes).
 *
 * Every time here is set explicitly with jest's system clock — no real
 * sleeps — so a projected reading is an exact number, not a range.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SportsService } from './sports.service';
import { TENANT, newGame, setup } from './sports-test-harness';

const T0 = new Date('2026-09-27T18:00:00.000Z').getTime();

function at(ms: number) {
  jest.setSystemTime(new Date(T0 + ms));
}

beforeEach(() => {
  jest.useFakeTimers();
  at(0);
});
afterEach(() => jest.useRealTimers());

/** The error a promise rejected with (fails the test if it resolved). */
async function rejection(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected the command to be refused');
}

describe('K12-F05 — the shot clock keeps the configuration the table chose', () => {
  it('OFF survives start, pause, timeout, a period change and a reload', async () => {
    const { service, client } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 0 });
    expect(g.stats.shotClock).toMatchObject({
      len: 0,
      running: false,
      off: true,
    });

    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(4_000);
    await service.clockAction(TENANT, g.id, { action: 'pause' });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    await service.callTimeout(TENANT, g.id, { team: 'home' });
    await service.setSegment(TENANT, g.id, { segment: 2 });
    expect(g.stats.shotClock).toMatchObject({
      len: 0,
      running: false,
      off: true,
    });

    // A reload / another replica: a fresh service over the same rows.
    const reloaded = new SportsService(
      { client } as any,
      { publish: async () => undefined } as any,
      { signMessage: () => ({}) } as any,
      { listActive: async () => [] } as any,
      { isEnabledAsync: async () => false } as any,
    );
    await reloaded.clockAction(TENANT, g.id, { action: 'start' });
    expect(g.stats.shotClock.len).toBe(0);
    expect(g.stats.shotClock.off).toBe(true);
  });

  it('a switched-off shot clock refuses start, stop and reset — and changes nothing', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 0 });
    const before = JSON.stringify(g.stats.shotClock);
    for (const dto of [
      { action: 'start' },
      { action: 'stop' },
      { action: 'reset', value: 14 },
    ]) {
      const err = await rejection(service.setShotClock(TENANT, g.id, dto));
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: 'SHOT_CLOCK_OFF' });
    }
    expect(JSON.stringify(g.stats.shotClock)).toBe(before);
  });

  it('a legacy OFF row (length 0, written before the marker existed) is still OFF', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    g.stats = {
      ...g.stats,
      shotClock: {
        len: 0,
        ms: 0,
        at: new Date(T0).toISOString(),
        running: false,
      },
    };
    await service.clockAction(TENANT, g.id, { action: 'start' });
    expect(g.stats.shotClock.len).toBe(0);
  });

  it('a configured 35 s clock stays 35 s across a period change, a timeout and resets', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, {
      action: 'configure',
      value: 35,
    });
    await service.setSegment(TENANT, g.id, { segment: 2 });
    expect(g.stats.shotClock).toMatchObject({
      len: 35,
      ms: 35_000,
      running: false,
    });

    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(6_000);
    await service.callTimeout(TENANT, g.id, { team: 'away' });
    expect(g.stats.shotClock).toMatchObject({
      len: 35,
      ms: 29_000,
      running: false,
    });

    await service.setShotClock(TENANT, g.id, { action: 'reset' });
    expect(g.stats.shotClock).toMatchObject({
      len: 35,
      ms: 35_000,
      running: false,
    });
    await service.setShotClock(TENANT, g.id, { action: 'reset', value: 20 });
    expect(g.stats.shotClock).toMatchObject({ len: 35, ms: 20_000 });

    await service.setSegment(TENANT, g.id, { segment: 3 });
    expect(g.stats.shotClock).toMatchObject({ len: 35, ms: 35_000 });
  });

  it('undoing a period change gives back the shot clock the period change reset', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, {
      action: 'configure',
      value: 35,
    });
    await service.setShotClock(TENANT, g.id, { action: 'reset', value: 12 });
    await service.setSegment(TENANT, g.id, { segment: 2 });
    expect(g.stats.shotClock.ms).toBe(35_000);
    const seg = gameEvent.rows.filter((e: any) => e.type === 'SEGMENT').pop();
    await service.undoEvent(TENANT, g.id, seg.id);
    expect(g.segment).toBe(1);
    expect(g.stats.shotClock).toMatchObject({ len: 35, ms: 12_000 });
  });

  it('refuses an unsupported length visibly instead of turning the clock off', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, {
      action: 'configure',
      value: 35,
    });
    for (const value of [70, 25, -1, 35.5, undefined]) {
      const err = await rejection(
        service.setShotClock(TENANT, g.id, {
          action: 'configure',
          value,
        } as any),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({
        code: 'SHOT_CLOCK_LENGTH_UNSUPPORTED',
        allowed: [0, 24, 30, 35],
      });
    }
    expect(g.stats.shotClock.len).toBe(35);
  });

  it('refuses a reset above the configured length', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, {
      action: 'configure',
      value: 24,
    });
    for (const value of [30, 0, 3.5]) {
      const err = await rejection(
        service.setShotClock(TENANT, g.id, { action: 'reset', value }),
      );
      expect(err.getResponse()).toMatchObject({
        code: 'SHOT_CLOCK_RESET_INVALID',
        max: 24,
      });
    }
    await service.setShotClock(TENANT, g.id, { action: 'reset', value: 14 });
    expect(g.stats.shotClock).toMatchObject({ len: 24, ms: 14_000 });
  });

  it('refuses a shot clock on a sport that has none', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'football');
    const err = await rejection(
      service.setShotClock(TENANT, g.id, { action: 'configure', value: 24 }),
    );
    expect(err.getResponse()).toMatchObject({ code: 'SHOT_CLOCK_UNSUPPORTED' });
    expect(g.stats.shotClock).toBeUndefined();
  });

  it('a never-configured shot clock still arms at the sport default when the game clock starts', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'water_polo');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    expect(g.stats.shotClock).toMatchObject({
      len: 30,
      ms: 30_000,
      running: true,
    });
  });

  it('a never-configured shot clock takes a direct reset at the sport default length', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'reset', value: 14 });
    expect(g.stats.shotClock).toMatchObject({
      len: 24,
      ms: 14_000,
      running: false,
    });
  });

  it('a reset never reads above the time left in the period', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, {
      action: 'configure',
      value: 35,
    });
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 9_000 });
    await service.setShotClock(TENANT, g.id, { action: 'reset' });
    expect(g.stats.shotClock.ms).toBe(9_000);
  });
});

describe('K12-F06 — the football play clock runs on its own', () => {
  // The sequences are the NFHS 2025 instructions for game and play-clock
  // operators (docs/research/2026-09-23-k12-sports-readiness-audit/
  // 05-RULES-SOURCES.md): the game clock and the play clock are two clocks
  // with their own starts and stops.

  it('incomplete pass: the game clock stops, the 40 s count runs, the snap starts the game clock and parks the count', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'football');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(5_000);
    // The pass hits the ground: the game clock stops; the 40 count starts.
    await service.clockAction(TENANT, g.id, { action: 'pause' });
    await service.setPlayClock(TENANT, g.id, { action: 'reset', value: 40 });
    at(17_000);
    expect(g.clockRunning).toBe(false);
    expect(g.clockMs).toBe(12 * 60_000 - 5_000);
    // 12 s of play clock have run while the game clock stood still.
    await service.setPlayClock(TENANT, g.id, { action: 'stop' });
    expect(g.stats.playClock).toMatchObject({ ms: 28_000, running: false });
    // The snap: the game clock starts; the play clock is set to 40, parked.
    await service.setPlayClock(TENANT, g.id, {
      action: 'reset',
      value: 40,
      run: false,
    });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(24_000);
    await service.clockAction(TENANT, g.id, { action: 'pause' });
    expect(g.stats.playClock).toMatchObject({ ms: 40_000, running: false });
    expect(g.clockMs).toBe(12 * 60_000 - 5_000 - 7_000);
  });

  it('out of bounds: pausing the game clock never stops a running count', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'football');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    await service.setPlayClock(TENANT, g.id, { action: 'reset', value: 40 });
    at(3_000);
    await service.clockAction(TENANT, g.id, { action: 'pause' });
    at(10_000);
    expect(g.stats.playClock.running).toBe(true);
    await service.setPlayClock(TENANT, g.id, { action: 'stop' });
    expect(g.stats.playClock.ms).toBe(30_000);
  });

  it('charged timeout: both clocks stop, the count is parked at 25, it starts on the ready signal', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'football');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    await service.setPlayClock(TENANT, g.id, { action: 'reset', value: 40 });
    at(6_000);
    await service.callTimeout(TENANT, g.id, { team: 'home' });
    expect(g.clockRunning).toBe(false);
    expect(g.stats.playClock).toMatchObject({ ms: 25_000, running: false });
    at(66_000);
    // Ready for play: the 25 count starts; the game clock waits for the snap.
    await service.setPlayClock(TENANT, g.id, { action: 'start' });
    at(76_000);
    await service.setPlayClock(TENANT, g.id, { action: 'stop' });
    expect(g.stats.playClock.ms).toBe(15_000);
    expect(g.clockRunning).toBe(false);
  });

  it('penalty administration: the count is parked at 25, then run on the ready signal while the game clock stays stopped', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'football');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(2_000);
    await service.clockAction(TENANT, g.id, { action: 'pause' }); // the flag
    await service.setPlayClock(TENANT, g.id, {
      action: 'reset',
      value: 25,
      run: false,
    });
    at(40_000);
    expect(g.stats.playClock).toMatchObject({ ms: 25_000, running: false });
    await service.setPlayClock(TENANT, g.id, { action: 'start' });
    at(45_000);
    await service.setPlayClock(TENANT, g.id, { action: 'stop' });
    expect(g.stats.playClock.ms).toBe(20_000);
    expect(g.clockRunning).toBe(false);
  });

  it('overtime is untimed, and the play clock still runs there on its 25 count', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'football');
    await service.setPlayClock(TENANT, g.id, {
      action: 'reset',
      value: 40,
      run: false,
    });
    await service.setSegment(TENANT, g.id, { segment: 5 });
    expect({ clock: g.clockMs, running: g.clockRunning }).toEqual({
      clock: 0,
      running: false,
    });
    expect(g.stats.playClock).toMatchObject({ ms: 25_000, running: false });
    await service.setPlayClock(TENANT, g.id, { action: 'start' });
    at(9_000);
    await service.setPlayClock(TENANT, g.id, { action: 'stop' });
    expect(g.stats.playClock.ms).toBe(16_000);
  });

  it('never shows more time than is left: a count that would start above the running game clock is turned off (NFHS instruction M)', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'football');
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 30_000 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    await service.setPlayClock(TENANT, g.id, { action: 'reset', value: 40 });
    expect(g.stats.playClock).toMatchObject({
      ms: 40_000,
      running: false,
      off: true,
    });
    // A 25 count fits in the 30 s left, so it runs and is on again.
    await service.setPlayClock(TENANT, g.id, { action: 'reset', value: 25 });
    expect(g.stats.playClock).toMatchObject({ ms: 25_000, running: true });
    expect(g.stats.playClock.off).toBeUndefined();
    // With the game clock STOPPED (it starts on the snap) the count runs.
    await service.clockAction(TENANT, g.id, { action: 'pause' });
    await service.setPlayClock(TENANT, g.id, { action: 'reset', value: 40 });
    expect(g.stats.playClock).toMatchObject({ ms: 40_000, running: true });
  });

  it('refuses a reset other than 40 or 25, and a play clock on a sport that has none', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'football');
    for (const value of [30, 60, 0, 24.5]) {
      const err = await rejection(
        service.setPlayClock(TENANT, g.id, { action: 'reset', value }),
      );
      expect(err.getResponse()).toMatchObject({
        code: 'PLAY_CLOCK_RESET_INVALID',
        allowed: [40, 25],
      });
    }
    const b: any = await newGame(service, 'basketball');
    const err = await rejection(
      service.setPlayClock(TENANT, b.id, { action: 'start' }),
    );
    expect(err.getResponse()).toMatchObject({ code: 'PLAY_CLOCK_UNSUPPORTED' });
    expect(b.stats.playClock).toBeUndefined();
    const bad = await rejection(
      service.setPlayClock(TENANT, g.id, {
        action: 'reset',
        value: 40,
        run: 'yes',
      } as any),
    );
    expect(bad).toBeInstanceOf(BadRequestException);
  });
});

describe('K12-F07 — timeouts, halftime and the final stop every clock at one reading', () => {
  /** A water-polo game with a running game clock, shot clock and exclusion. */
  async function runningWaterPolo() {
    const h = setup();
    const g: any = await newGame(h.service, 'water_polo');
    await h.service.setPenalties(TENANT, g.id, {
      action: 'add',
      team: 'away',
      lenSec: 20,
      player: '7',
    });
    await h.service.clockAction(TENANT, g.id, { action: 'start' }); // arms the 30 s shot clock
    return { ...h, g };
  }

  it('a timeout freezes the game clock, the shot clock and the penalty box together, and one start resumes them', async () => {
    const { service, g } = await runningWaterPolo();
    at(5_000);
    await service.callTimeout(TENANT, g.id, { team: 'home' });
    expect(g.clockRunning).toBe(false);
    expect(g.clockMs).toBe(8 * 60_000 - 5_000);
    expect(g.stats.shotClock).toMatchObject({ ms: 25_000, running: false });
    expect(g.stats.penalties[0]).toMatchObject({ ms: 15_000, running: false });
    expect(g.stats.homeTimeouts).toBe(2);

    at(65_000); // the timeout lasts a minute; nothing may move
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(68_000);
    await service.clockAction(TENANT, g.id, { action: 'pause' });
    expect(g.clockMs).toBe(8 * 60_000 - 8_000);
    expect(g.stats.shotClock).toMatchObject({ ms: 22_000, running: false });
    expect(g.stats.penalties[0]).toMatchObject({ ms: 12_000, running: false });
  });

  it('halftime freezes every running clock at its current reading in the same write', async () => {
    const { service, g, game } = await runningWaterPolo();
    at(5_000);
    const writesBefore = game.rows[0].version;
    await service.setStatus(TENANT, g.id, { status: 'HALFTIME' });
    expect(g.version).toBe(writesBefore + 1); // one compare-and-swap write
    expect(g.status).toBe('HALFTIME');
    expect({ ms: g.clockMs, running: g.clockRunning }).toEqual({
      ms: 8 * 60_000 - 5_000,
      running: false,
    });
    expect(g.stats.shotClock).toMatchObject({ ms: 25_000, running: false });
    expect(g.stats.penalties[0]).toMatchObject({ ms: 15_000, running: false });
    // Ten minutes of halftime pass; nothing moves.
    at(605_000);
    const board: any = await service.getBoard(g.id);
    expect({ ms: board.clockMs, running: board.clockRunning }).toEqual({
      ms: 8 * 60_000 - 5_000,
      running: false,
    });
    // Back to LIVE: nothing starts on its own; one start resumes all of them.
    await service.setStatus(TENANT, g.id, { status: 'LIVE' });
    expect(g.clockRunning).toBe(false);
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(607_000);
    await service.clockAction(TENANT, g.id, { action: 'pause' });
    expect(g.clockMs).toBe(8 * 60_000 - 7_000);
    expect(g.stats.shotClock.ms).toBe(23_000);
    expect(g.stats.penalties[0].ms).toBe(13_000);
  });

  it('halftime freezes a running football play clock too', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'football');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    await service.setPlayClock(TENANT, g.id, { action: 'reset', value: 40 });
    at(4_000);
    await service.setStatus(TENANT, g.id, { status: 'HALFTIME' });
    expect(g.stats.playClock).toMatchObject({ ms: 36_000, running: false });
    expect(g.clockMs).toBe(12 * 60_000 - 4_000);
  });

  it('the final freezes the clock at the reading it had, not the one it was last started from', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(30_000);
    await service.setStatus(TENANT, g.id, { status: 'FINAL' });
    expect({ ms: g.clockMs, running: g.clockRunning }).toEqual({
      ms: 450_000,
      running: false,
    });
    expect(g.stats.shotClock).toMatchObject({ ms: 0, running: false });
    expect(new Date(g.endedAt).getTime()).toBe(T0 + 30_000);
  });

  it('a timeout during a stoppage debits the bank and moves no clock', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'water_polo');
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 90_000 });
    at(10_000);
    await service.callTimeout(TENANT, g.id, { team: 'away' });
    expect({ ms: g.clockMs, running: g.clockRunning }).toEqual({
      ms: 90_000,
      running: false,
    });
    expect(g.stats.awayTimeouts).toBe(2);
    expect(g.stats.shotClock).toBeUndefined();
  });
});

describe('K12-F08 — an expired period holds until the table advances it', () => {
  const horns = (rows: any[]) =>
    rows.filter((e) => e.type === 'CUE' && e.payload?.key === 'horn');

  async function liveBasketball(h = setup()) {
    const g: any = await newGame(h.service, 'basketball');
    await h.service.setStatus(TENANT, g.id, { status: 'LIVE' });
    return { ...h, g };
  }

  it('0:00 holds in the same quarter with its fouls; one horn; the table advances it', async () => {
    const { service, gameEvent, g } = await liveBasketball();
    await service.updateStats(TENANT, g.id, { stats: { homeFouls: 4 } });
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 3_000 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(4_000);
    expect(await service.autoAdvanceExpiredClocks()).toEqual({
      found: 1,
      changed: 1,
    });
    expect({
      segment: g.segment,
      clock: g.clockMs,
      running: g.clockRunning,
      fouls: g.stats.homeFouls,
    }).toEqual({ segment: 1, clock: 0, running: false, fouls: 4 });
    expect(horns(gameEvent.rows)).toHaveLength(1);
    expect(horns(gameEvent.rows)[0].payload.segmentLabel).toBe('Q1');
    const expired = gameEvent.rows.filter(
      (e: any) => e.type === 'CLOCK' && e.payload.action === 'expired',
    );
    expect(expired).toHaveLength(1);
    expect(expired[0].payload).toMatchObject({
      auto: true,
      segment: 1,
      clockMs: 0,
    });

    // Later sweeps see a stopped clock: nothing more happens.
    at(60_000);
    expect(await service.autoAdvanceExpiredClocks()).toEqual({
      found: 0,
      changed: 0,
    });
    expect(horns(gameEvent.rows)).toHaveLength(1);

    await service.setSegment(TENANT, g.id, { segment: 2 });
    expect({ segment: g.segment, clock: g.clockMs }).toEqual({
      segment: 2,
      clock: 8 * 60_000,
    });
  });

  it('every clock stops at the instant the period ended, not at the late sweep tick', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'hockey');
    await service.setStatus(TENANT, g.id, { status: 'LIVE' });
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 5_000 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    await service.setPenalties(TENANT, g.id, {
      action: 'add',
      team: 'home',
      lenSec: 120,
      player: '9',
    });
    // The period ends at +5 s; the sweep only runs at +8 s (a lease failover).
    at(8_000);
    await service.autoAdvanceExpiredClocks();
    expect({ clock: g.clockMs, running: g.clockRunning }).toEqual({
      clock: 0,
      running: false,
    });
    expect(new Date(g.clockUpdatedAt).getTime()).toBe(T0 + 5_000);
    // The player served 5 s of the minor, not 8 — 1:55 carries into P2.
    expect(g.stats.penalties[0]).toMatchObject({ ms: 115_000, running: false });
  });

  it('a count-up half holds at its length plus added time, exactly', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'soccer');
    await service.setStatus(TENANT, g.id, { status: 'LIVE' });
    await service.updateStats(TENANT, g.id, { stats: { addedTime: 2 } });
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 41 * 60_000 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(61_000 + 900);
    await service.autoAdvanceExpiredClocks();
    expect({
      segment: g.segment,
      clock: g.clockMs,
      running: g.clockRunning,
    }).toEqual({ segment: 1, clock: 42 * 60_000, running: false });
  });

  it('a correction the table makes after the hold stands, in the same period, with no second horn', async () => {
    const { service, gameEvent, g } = await liveBasketball();
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 1_000 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(1_500);
    await service.autoAdvanceExpiredClocks();
    // The officials put 0.3 s back on the clock.
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 300 });
    expect({
      segment: g.segment,
      clock: g.clockMs,
      running: g.clockRunning,
    }).toEqual({ segment: 1, clock: 300, running: false });
    at(20_000);
    await service.autoAdvanceExpiredClocks();
    expect(horns(gameEvent.rows)).toHaveLength(1);
  });

  it('two replicas sweeping the same expiry at once produce one stop and one horn', async () => {
    const { service, gameEvent, game, g } = await liveBasketball();
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 2_000 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(3_000);
    // Both replicas' commands read the running clock before either writes
    // (a real second replica, or one that kept sweeping after losing Redis
    // and with it the leader lease).
    const liveFindFirst = game.findFirst;
    let reads = 0;
    let bothRead!: () => void;
    const barrier = new Promise<void>((r) => (bothRead = r));
    game.findFirst = async (args: any) => {
      const row = await liveFindFirst(args);
      if (row && row.clockRunning && ++reads === 2) bothRead();
      if (row && row.clockRunning && reads <= 2) await barrier;
      return row ? { ...row } : row;
    };
    const [a, b] = await Promise.all([
      service.autoAdvanceExpiredClocks(),
      service.autoAdvanceExpiredClocks(),
    ]);
    game.findFirst = liveFindFirst;
    expect(reads).toBeGreaterThanOrEqual(2); // both really read the running clock
    expect(a.changed + b.changed).toBe(1);
    expect(horns(gameEvent.rows)).toHaveLength(1);
    expect(
      gameEvent.rows.filter(
        (e: any) => e.type === 'CLOCK' && e.payload.action === 'expired',
      ),
    ).toHaveLength(1);
    expect({
      segment: g.segment,
      clock: g.clockMs,
      running: g.clockRunning,
    }).toEqual({ segment: 1, clock: 0, running: false });
  });

  it('a clock that has run out does not start again; an untimed period has no clock to start', async () => {
    const { service, g } = await liveBasketball();
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 0 });
    const err = await rejection(
      service.clockAction(TENANT, g.id, { action: 'start' }),
    );
    expect(err.getResponse()).toMatchObject({ code: 'CLOCK_EXPIRED' });
    expect(g.clockRunning).toBe(false);

    const f: any = await newGame(service, 'football');
    await service.setSegment(TENANT, f.id, { segment: 5 });
    const ot = await rejection(
      service.clockAction(TENANT, f.id, { action: 'start' }),
    );
    expect(ot.getResponse()).toMatchObject({ code: 'CLOCK_UNTIMED_PERIOD' });
    // Resetting an untimed period leaves it at 0:00 (it used to put 12:00 up).
    await service.clockAction(TENANT, f.id, { action: 'reset' });
    expect(f.clockMs).toBe(0);
  });

  it("the last regulation period holds the same way — overtime or the final stays the table's call", async () => {
    const { service, gameEvent, g } = await liveBasketball();
    await service.setSegment(TENANT, g.id, { segment: 4 });
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 500 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(1_000);
    await service.autoAdvanceExpiredClocks();
    expect({
      segment: g.segment,
      clock: g.clockMs,
      running: g.clockRunning,
      status: g.status,
    }).toEqual({ segment: 4, clock: 0, running: false, status: 'LIVE' });
    expect(horns(gameEvent.rows)[0].payload.segmentLabel).toBe('Q4');
  });
});

describe('K12-F14 — feed snapshots are applied in order, with honest time', () => {
  const horns = (rows: any[]) =>
    rows.filter((e) => e.type === 'CUE' && e.payload?.key === 'horn');

  it('a boolean-only "still running" packet keeps the projected reading (the clock never jumps back)', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 60_000 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(10_000);
    await service.ingestByFeed(g.id, { clockRunning: true });
    expect({ ms: g.clockMs, running: g.clockRunning }).toEqual({
      ms: 50_000,
      running: true,
    });
    expect(new Date(g.clockUpdatedAt).getTime()).toBe(T0 + 10_000);
  });

  it('a boolean-only stop freezes the shot clock and the penalty box at their current readings too', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'water_polo');
    await service.setPenalties(TENANT, g.id, {
      action: 'add',
      team: 'home',
      lenSec: 20,
      player: '4',
    });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(6_000);
    await service.ingestByFeed(g.id, { clockRunning: false });
    expect({ ms: g.clockMs, running: g.clockRunning }).toEqual({
      ms: 8 * 60_000 - 6_000,
      running: false,
    });
    expect(g.stats.shotClock).toMatchObject({ ms: 24_000, running: false });
    expect(g.stats.penalties[0]).toMatchObject({ ms: 14_000, running: false });
  });

  it('an older snapshot never overwrites a newer one; the next in order applies', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    const a = await service.ingestFeedPacket(g.id, {
      session: 'box-1',
      seq: 5,
      homeScore: 10,
    });
    expect(a.accepted).toBe(true);
    const late = await service.ingestFeedPacket(g.id, {
      session: 'box-1',
      seq: 4,
      homeScore: 8,
    });
    expect(late).toMatchObject({ accepted: false, reason: 'stale-sequence' });
    const replay = await service.ingestFeedPacket(g.id, {
      session: 'box-1',
      seq: 5,
      homeScore: 8,
    });
    expect(replay).toMatchObject({ accepted: false, reason: 'stale-sequence' });
    expect(g.homeScore).toBe(10);
    await service.ingestFeedPacket(g.id, {
      session: 'box-1',
      seq: 6,
      homeScore: 12,
    });
    expect(g.homeScore).toBe(12);
  });

  it('a delayed clock snapshot cannot roll the clock back', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.ingestFeedPacket(g.id, {
      session: 's',
      seq: 2,
      clockMs: 300_000,
      clockRunning: true,
    });
    at(1_000);
    const r = await service.ingestFeedPacket(g.id, {
      session: 's',
      seq: 1,
      clockMs: 301_000,
      clockRunning: true,
    });
    expect(r.accepted).toBe(false);
    expect({ ms: g.clockMs, at: new Date(g.clockUpdatedAt).getTime() }).toEqual(
      { ms: 300_000, at: T0 },
    );
  });

  it('switching sources: a new session takes over and the old session can never come back', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.ingestFeedPacket(g.id, {
      session: 'old-box',
      seq: 100,
      homeScore: 20,
    });
    await service.ingestFeedPacket(g.id, {
      session: 'new-box',
      seq: 1,
      homeScore: 22,
    });
    expect(g.homeScore).toBe(22);
    const straggler = await service.ingestFeedPacket(g.id, {
      session: 'old-box',
      seq: 101,
      homeScore: 20,
    });
    expect(straggler).toMatchObject({
      accepted: false,
      reason: 'retired-session',
    });
    expect(g.homeScore).toBe(22);
  });

  it('disconnect and recover: the same session carries on from its next number', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.ingestFeedPacket(g.id, {
      session: 'box',
      seq: 7,
      homeScore: 5,
    });
    at(90_000); // a minute and a half with no packets
    const back = await service.ingestFeedPacket(g.id, {
      session: 'box',
      seq: 8,
      homeScore: 7,
    });
    expect(back.accepted).toBe(true);
    expect(g.homeScore).toBe(7);
  });

  it('a repeated eventId applies once; occurredAt orders a session that sends no numbers', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.ingestFeedPacket(g.id, { eventId: 'evt-1', homeScore: 3 });
    const dup = await service.ingestFeedPacket(g.id, {
      eventId: 'evt-1',
      homeScore: 3,
    });
    expect(dup).toMatchObject({ accepted: false, reason: 'duplicate-event' });

    const t = Date.parse('2026-09-27T18:00:05Z');
    await service.ingestFeedPacket(g.id, {
      session: 'clockless',
      occurredAt: t,
      awayScore: 4,
    });
    const older = await service.ingestFeedPacket(g.id, {
      session: 'clockless',
      occurredAt: t - 500,
      awayScore: 1,
    });
    expect(older).toMatchObject({
      accepted: false,
      reason: 'stale-observation',
    });
    expect(g.awayScore).toBe(4);
  });

  it('an unsequenced legacy feed keeps working exactly as before', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.ingestByFeed(g.id, { homeScore: 9 });
    await service.ingestByFeed(g.id, { homeScore: 7 });
    expect(g.homeScore).toBe(7);
    expect(g.stats.feedCursor).toBeUndefined();
  });

  it('refuses a malformed envelope with a reason (FEED_ENVELOPE_INVALID)', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    for (const bad of [
      { seq: 3 }, // a counter with no session
      { session: 'has space' },
      { session: 's', seq: -1 },
      { session: 's', seq: 1.5 },
      { eventId: '' },
      { occurredAt: 'yesterday' },
    ]) {
      const err = await rejection(service.ingestFeedPacket(g.id, bad as any));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({
        code: 'FEED_ENVELOPE_INVALID',
      });
    }
  });

  it('a feed never runs a clock that has run out; the packet that ends the period sounds the horn once', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setStatus(TENANT, g.id, { status: 'LIVE' });
    await service.ingestFeedPacket(g.id, {
      session: 'b',
      seq: 1,
      clockMs: 400,
      clockRunning: true,
    });
    at(700);
    // The console's own clock reached zero and it still says "running".
    await service.ingestFeedPacket(g.id, {
      session: 'b',
      seq: 2,
      clockMs: 0,
      clockRunning: true,
    });
    expect({
      segment: g.segment,
      ms: g.clockMs,
      running: g.clockRunning,
    }).toEqual({ segment: 1, ms: 0, running: false });
    expect(horns(gameEvent.rows)).toHaveLength(1);
    await service.ingestFeedPacket(g.id, {
      session: 'b',
      seq: 3,
      clockMs: 0,
      clockRunning: true,
    });
    await service.ingestFeedPacket(g.id, {
      session: 'b',
      seq: 4,
      clockMs: 0,
      clockRunning: false,
    });
    expect(horns(gameEvent.rows)).toHaveLength(1);
    expect(await service.autoAdvanceExpiredClocks()).toEqual({
      found: 0,
      changed: 0,
    });
  });

  it('CTS: an older snapshot never rolls the overlay back, and a goal is celebrated once', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'soccer');
    const auth = { tenantId: null, source: 'cts-feed' };
    expect(
      await service.ingestCtsSnapshot(
        g.id,
        { session: 'bridge', seq: 1, homeScore: 0 },
        auth,
      ),
    ).toEqual({ ok: true, accepted: true });
    await service.ingestCtsSnapshot(
      g.id,
      { session: 'bridge', seq: 3, homeScore: 1 },
      auth,
    );
    // seq 2 was the pre-goal packet, delivered late.
    expect(
      await service.ingestCtsSnapshot(
        g.id,
        { session: 'bridge', seq: 2, homeScore: 0 },
        auth,
      ),
    ).toEqual({ ok: true, accepted: false, reason: 'stale-sequence' });
    await service.ingestCtsSnapshot(
      g.id,
      { session: 'bridge', seq: 4, homeScore: 1 },
      auth,
    );
    expect(g.homeScore).toBe(1);
    expect(g.stats.cts.homeScore).toBe(1);
    const goals = gameEvent.rows.filter(
      (e: any) => e.type === 'CUE' && e.payload?.key === 'goal',
    );
    expect(goals).toHaveLength(1);
  });
});

describe('K12-F17 — one server clock for every anchor and every sample', () => {
  /** A service on a replica whose container clock is 2 minutes behind the
   *  Redis-aligned server clock (TimeSyncService adds the offset). */
  function onSkewedReplica(h = setup()) {
    const timeSync = { now: () => Date.now() + 120_000 };
    const service = new SportsService(
      { client: h.client } as any,
      { publish: async () => undefined } as any,
      { signMessage: () => ({}) } as any,
      { listActive: async () => [] } as any,
      { isEnabledAsync: async () => false } as any,
      timeSync as any,
    );
    return { ...h, service };
  }

  it('anchors and serverTime share the TimeSyncService clock, so projections are exact', async () => {
    const { service } = onSkewedReplica();
    const g: any = await newGame(service, 'basketball');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    expect(new Date(g.clockUpdatedAt).getTime()).toBe(T0 + 120_000);
    at(10_000);
    const board: any = await service.getBoard(g.id);
    expect(board.serverTime).toBe(T0 + 130_000);
    // What any surface computes from the payload alone:
    const shown =
      board.clockMs -
      (board.serverTime - new Date(board.clockUpdatedAt).getTime());
    expect(shown).toBe(470_000);
    await service.clockAction(TENANT, g.id, { action: 'pause' });
    expect(g.clockMs).toBe(470_000);
    expect(g.stats.shotClock).toMatchObject({
      ms: 14_000,
      at: new Date(T0 + 130_000).toISOString(),
    });
  });

  it('the operator console gets a server-clock sample with the game', async () => {
    const { service } = onSkewedReplica();
    const g: any = await newGame(service, 'basketball');
    const got: any = await service.getGame(TENANT, g.id);
    expect(got.serverTime).toBe(T0 + 120_000);
  });

  it('the expiry sweep judges expiry on the server clock too', async () => {
    const { service } = onSkewedReplica();
    const g: any = await newGame(service, 'basketball');
    await service.setStatus(TENANT, g.id, { status: 'LIVE' });
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 2_000 });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(1_000);
    expect((await service.autoAdvanceExpiredClocks()).changed).toBe(0);
    at(2_500);
    expect((await service.autoAdvanceExpiredClocks()).changed).toBe(1);
    expect(new Date(g.clockUpdatedAt).getTime()).toBe(T0 + 120_000 + 2_000);
  });

  it('a celebration snapshot formats the clock with the sport display policy', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 4_300 });
    await service.fireCue(TENANT, g.id, { key: 'threePointer' });
    const cue = gameEvent.rows.filter((e: any) => e.type === 'CUE').pop();
    expect(cue.payload.snapshot.clockText).toBe('4.3');
    const f: any = await newGame(service, 'football');
    await service.clockAction(TENANT, f.id, { action: 'set', ms: 4_300 });
    await service.fireCue(TENANT, f.id, { key: 'touchdown' });
    const td = gameEvent.rows.filter((e: any) => e.type === 'CUE').pop();
    expect(td.payload.snapshot.clockText).toBe('0:05');
  });
});

describe('K12-F40 — the board payload carries what the freshness contract needs', () => {
  it('revision and commit time, both moving with every committed command', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    const first: any = await service.getBoard(g.id);
    expect(first.revision).toBe(0);
    at(2_000);
    await service.adjustScore(TENANT, g.id, { team: 'home', delta: 2 });
    const second: any = await service.getBoard(g.id); // the write invalidated the cache
    expect(second.revision).toBe(1);
    expect(new Date(second.updatedAt).getTime()).toBe(T0 + 2_000);
    expect(second.serverTime).toBe(T0 + 2_000);
  });

  it('a refused command commits nothing, so the revision does not move', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 0 });
    const before: any = await service.getBoard(g.id);
    await rejection(service.setShotClock(TENANT, g.id, { action: 'start' }));
    const after: any = await service.getBoard(g.id);
    expect(after.revision).toBe(before.revision);
  });
});
