/**
 * Self-scheduling poll loop (2026-08-30 player reliability program, W1-4 /
 * audit P0-1).
 *
 * THE BUG THIS REPLACES. The pairing-splash poll was a `setInterval(tick, 3s)`
 * with a failure escape hatch: after 3 consecutive failures it CLEARED the
 * interval and scheduled ONE `setTimeout(tick, backoff)`. The comment said
 * "retry itself re-arms the interval on a successful tick" — no code did.
 * So: endpoint blips 3 times → one-shot retry fires → succeeds → device still
 * unpaired → **nothing is ever scheduled again**. The screen sits on the
 * pairing splash forever, polling nothing, and only a physical power-cycle
 * recovers it. An interval/timeout mixture where "keep going" is the
 * REMEMBERED state is exactly backwards for a kiosk; scheduling the next
 * tick must be the default that only an explicit 'stop' can end.
 *
 * This loop is timeout-chained: every tick, success or failure, schedules
 * the next one — fast cadence while healthy, exponential backoff (with the
 * player's existing full-jitter behavior left to the caller-supplied
 * `backoff`) while failing, and the ONLY ways it ends are `stop()` (effect
 * cleanup / phase change) or the tick returning 'done' (paired — the caller
 * advances phase).
 *
 * Injectable timers so tests run on fake clocks.
 */

export type PairingTickResult = 'continue' | 'fail' | 'done';

export interface PairingLoopOptions {
  tick: () => Promise<PairingTickResult>;
  /** Healthy cadence, e.g. 3000. */
  baseMs: number;
  /** Backoff for consecutive failures. Receives the failure streak (1-based). */
  backoff: (failStreak: number) => number;
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (t: ReturnType<typeof setTimeout>) => void;
}

export interface PairingLoop {
  start(): void;
  stop(): void;
  /** Current consecutive-failure streak (diagnostics/tests). */
  failStreak(): number;
  running(): boolean;
}

export function createPairingLoop(opts: PairingLoopOptions): PairingLoop {
  const setT = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeoutFn ?? ((t) => clearTimeout(t));

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;
  let fails = 0;
  let ticking = false;

  const schedule = (ms: number) => {
    if (stopped) return;
    timer = setT(runTick, ms);
  };

  const runTick = async () => {
    timer = null;
    if (stopped || ticking) return;
    ticking = true;
    let result: PairingTickResult = 'fail';
    try {
      result = await opts.tick();
    } catch {
      result = 'fail';
    } finally {
      ticking = false;
    }
    if (stopped) return;
    if (result === 'done') {
      stopped = true;
      return;
    }
    if (result === 'fail') {
      fails += 1;
      schedule(opts.backoff(fails));
    } else {
      fails = 0;
      schedule(opts.baseMs);
    }
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      fails = 0;
      schedule(0);
    },
    stop() {
      stopped = true;
      if (timer !== null) {
        clearT(timer);
        timer = null;
      }
    },
    failStreak: () => fails,
    running: () => !stopped,
  };
}
