/**
 * Shared probe timeout for the health surfaces (2026-08-05 consolidation —
 * health.controller.ts and platform-health-monitor.service.ts each carried
 * their own copy, and the copies had drifted: only the monitor's called
 * `.unref()`. The controller's copy runs on every liveness hit — Railway
 * polls it every few seconds and every kiosk's NetworkRecoveryController
 * probes it — so each successful fast probe left a pending timer alive for
 * the full timeout budget. Consolidated with the unref behavior.)
 *
 * Races the promise against a hard timeout so a slow downstream (Postgres
 * pooler hiccup, Redis DNS flake) can never make a health check exceed its
 * budget. The timer never holds the process (or Jest) open.
 *
 * NOTE: integrations-health.controller.ts has a DIFFERENT, Result-shaped
 * helper ({ok, value|error, ms}) — that one is not this and stays local.
 */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
      (t as any).unref?.();
    }),
  ]);
}
