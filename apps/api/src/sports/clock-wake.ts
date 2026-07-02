/**
 * Wake signal for the ClockAdvanceService idle-skip (efficiency audit
 * 2026-07-01 #3). A module-level flag instead of DI on purpose:
 * SportsService → ClockAdvanceService via constructor injection would be a
 * circular dependency (ClockAdvanceService already injects SportsService).
 *
 * Contract: clock-start mutation paths call wakeClockSweep() so the sweep
 * returns to its 1s cadence immediately. Paths that DON'T wake (CTS ingest,
 * direct game updates) are still covered by the idle sweep's 30s fallback —
 * the wake is a latency optimization for the common operator path, not a
 * correctness requirement.
 */
let wakePending = false;

export function wakeClockSweep(): void {
  wakePending = true;
}

/** Read-and-clear. Returns true at most once per wake. */
export function consumeClockSweepWake(): boolean {
  const w = wakePending;
  wakePending = false;
  return w;
}
