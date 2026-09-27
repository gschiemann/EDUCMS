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
    expect(g.stats.shotClock).toMatchObject({ len: 0, running: false, off: true });

    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(4_000);
    await service.clockAction(TENANT, g.id, { action: 'pause' });
    await service.clockAction(TENANT, g.id, { action: 'start' });
    await service.callTimeout(TENANT, g.id, { team: 'home' });
    await service.setSegment(TENANT, g.id, { segment: 2 });
    expect(g.stats.shotClock).toMatchObject({ len: 0, running: false, off: true });

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
    for (const dto of [{ action: 'start' }, { action: 'stop' }, { action: 'reset', value: 14 }]) {
      const err = await rejection(service.setShotClock(TENANT, g.id, dto));
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: 'SHOT_CLOCK_OFF' });
    }
    expect(JSON.stringify(g.stats.shotClock)).toBe(before);
  });

  it('a legacy OFF row (length 0, written before the marker existed) is still OFF', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    g.stats = { ...g.stats, shotClock: { len: 0, ms: 0, at: new Date(T0).toISOString(), running: false } };
    await service.clockAction(TENANT, g.id, { action: 'start' });
    expect(g.stats.shotClock.len).toBe(0);
  });

  it('a configured 35 s clock stays 35 s across a period change, a timeout and resets', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 35 });
    await service.setSegment(TENANT, g.id, { segment: 2 });
    expect(g.stats.shotClock).toMatchObject({ len: 35, ms: 35_000, running: false });

    await service.clockAction(TENANT, g.id, { action: 'start' });
    at(6_000);
    await service.callTimeout(TENANT, g.id, { team: 'away' });
    expect(g.stats.shotClock).toMatchObject({ len: 35, ms: 29_000, running: false });

    await service.setShotClock(TENANT, g.id, { action: 'reset' });
    expect(g.stats.shotClock).toMatchObject({ len: 35, ms: 35_000, running: false });
    await service.setShotClock(TENANT, g.id, { action: 'reset', value: 20 });
    expect(g.stats.shotClock).toMatchObject({ len: 35, ms: 20_000 });

    await service.setSegment(TENANT, g.id, { segment: 3 });
    expect(g.stats.shotClock).toMatchObject({ len: 35, ms: 35_000 });
  });

  it('undoing a period change gives back the shot clock the period change reset', async () => {
    const { service, gameEvent } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 35 });
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
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 35 });
    for (const value of [70, 25, -1, 35.5, undefined]) {
      const err = await rejection(service.setShotClock(TENANT, g.id, { action: 'configure', value } as any));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'SHOT_CLOCK_LENGTH_UNSUPPORTED', allowed: [0, 24, 30, 35] });
    }
    expect(g.stats.shotClock.len).toBe(35);
  });

  it('refuses a reset above the configured length', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 24 });
    for (const value of [30, 0, 3.5]) {
      const err = await rejection(service.setShotClock(TENANT, g.id, { action: 'reset', value }));
      expect(err.getResponse()).toMatchObject({ code: 'SHOT_CLOCK_RESET_INVALID', max: 24 });
    }
    await service.setShotClock(TENANT, g.id, { action: 'reset', value: 14 });
    expect(g.stats.shotClock).toMatchObject({ len: 24, ms: 14_000 });
  });

  it('refuses a shot clock on a sport that has none', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'football');
    const err = await rejection(service.setShotClock(TENANT, g.id, { action: 'configure', value: 24 }));
    expect(err.getResponse()).toMatchObject({ code: 'SHOT_CLOCK_UNSUPPORTED' });
    expect(g.stats.shotClock).toBeUndefined();
  });

  it('a never-configured shot clock still arms at the sport default when the game clock starts', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'water_polo');
    await service.clockAction(TENANT, g.id, { action: 'start' });
    expect(g.stats.shotClock).toMatchObject({ len: 30, ms: 30_000, running: true });
  });

  it('a never-configured shot clock takes a direct reset at the sport default length', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'reset', value: 14 });
    expect(g.stats.shotClock).toMatchObject({ len: 24, ms: 14_000, running: false });
  });

  it('a reset never reads above the time left in the period', async () => {
    const { service } = setup();
    const g: any = await newGame(service, 'basketball');
    await service.setShotClock(TENANT, g.id, { action: 'configure', value: 35 });
    await service.clockAction(TENANT, g.id, { action: 'set', ms: 9_000 });
    await service.setShotClock(TENANT, g.id, { action: 'reset' });
    expect(g.stats.shotClock.ms).toBe(9_000);
  });
});
