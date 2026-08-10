/**
 * Wake signal for the ClockAdvanceService idle-skip (efficiency audit
 * 2026-07-01 #3). A module-level flag instead of DI on purpose:
 * SportsService → ClockAdvanceService via constructor injection would be a
 * circular dependency (ClockAdvanceService already injects SportsService).
 *
 * Contract (Phase-2 Domain CLOCK, 2026-08-09): every clock-relevant write
 * path calls wakeClockSweep() so the sweep returns to its 1s cadence
 * immediately — the operator clock-start (clockAction), the machine feed
 * (ingest / ingestByFeed), and CTS snapshot ingest (ingestCtsSnapshot).
 * Each gates the wake on the write leaving a RUNNING clock, mirroring the
 * clockAction gate. Remaining non-waking paths (raw prisma writes, admin
 * scripts) are still covered by the idle sweep's 30s fallback — for those
 * the wake stays a latency optimization, not a correctness requirement.
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
