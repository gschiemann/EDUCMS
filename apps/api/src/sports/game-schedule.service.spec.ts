/**
 * GameScheduleService — the 15s auto-push sweep loop (Inputs-wave SCHED).
 *
 * The heavy lifting (claim + push) lives in SportsService.sweepDueAutoPushes
 * and is covered by sports-auto-push.spec.ts; this spec pins the loop
 * mechanics copied from ClockAdvanceService: test/env kill-switch, overlap
 * guard, fail-open ticks, and the idle-skip + wake contract.
 */
import { GameScheduleService } from './game-schedule.service';
import { wakeScheduleSweep, consumeScheduleSweepWake } from './game-schedule-wake';

function makeService(sweep: jest.Mock) {
  return new GameScheduleService({ sweepDueAutoPushes: sweep } as any);
}

describe('GameScheduleService', () => {
  beforeEach(() => {
    // Drain any wake left behind by a previous test (module-level flag).
    consumeScheduleSweepWake();
  });

  it('does not start a timer under NODE_ENV=test (kill-switch parity with ClockAdvanceService)', () => {
    const sweep = jest.fn();
    const svc = makeService(sweep);
    svc.onModuleInit();
    expect((svc as any).timer).toBeNull();
    svc.onModuleDestroy(); // no-op, must not throw
  });

  it('tick runs the sweep and swallows sweep failures (fail-open loop)', async () => {
    const sweep = jest.fn().mockRejectedValue(new Error('db down'));
    const svc = makeService(sweep);
    await expect(svc.tick()).resolves.toBeUndefined();
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('overlap guard: a tick during an in-flight tick is a no-op', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sweep = jest.fn().mockImplementation(async () => {
      await gate;
      return { found: 0, pushed: 0, blocked: 0 };
    });
    const svc = makeService(sweep);
    const first = svc.tick();
    await svc.tick(); // overlaps — must return without sweeping again
    release();
    await first;
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('idle-skips after an empty sweep and wakes back up on wakeScheduleSweep()', async () => {
    const sweep = jest.fn().mockResolvedValue({ found: 0, pushed: 0, blocked: 0 });
    const svc = makeService(sweep);
    await svc.tick(); // sweeps → found 0 → arms the idle window
    await svc.tick(); // idle-skipped
    await svc.tick(); // idle-skipped
    expect(sweep).toHaveBeenCalledTimes(1);
    // Arming a game wakes the loop — the very next tick sweeps again.
    wakeScheduleSweep();
    await svc.tick();
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('keeps full cadence while games are pending (found > 0 never idles)', async () => {
    const sweep = jest.fn().mockResolvedValue({ found: 1, pushed: 1, blocked: 0 });
    const svc = makeService(sweep);
    await svc.tick();
    await svc.tick();
    expect(sweep).toHaveBeenCalledTimes(2);
  });
});
