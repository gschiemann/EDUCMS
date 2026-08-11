/**
 * Wake signal for the GameScheduleService idle-skip (Inputs-wave SCHED,
 * 2026-08-10). A module-level flag instead of DI on purpose — the same
 * shape (and reason) as clock-wake.ts: SportsService → GameScheduleService
 * via constructor injection would be a circular dependency
 * (GameScheduleService already injects SportsService).
 *
 * Contract: every write path that can leave Game.autoPushAt set to a
 * pending fire time calls wakeScheduleSweep() so the sweep returns to its
 * normal cadence immediately — arming (setAutoPush) and a scheduledAt edit
 * that recomputes the pending time (updateGameDetails). Remaining
 * non-waking paths (raw prisma writes, admin scripts) are still covered by
 * the idle sweep's fallback window — for those the wake is a latency
 * optimization, not a correctness requirement (the push lead is 10
 * minutes; the idle window is one minute).
 */
let wakePending = false;

export function wakeScheduleSweep(): void {
  wakePending = true;
}

/** Read-and-clear. Returns true at most once per wake. */
export function consumeScheduleSweepWake(): boolean {
  const w = wakePending;
  wakePending = false;
  return w;
}
