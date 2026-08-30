/**
 * Manifest reconciliation gate — single-flight + trigger coalescing
 * (2026-08-30 player reliability program, W1-6 / audit P0-8).
 *
 * `fetchContent()` is invoked by at least six independent triggers: the
 * normal reconcile interval, the 5–10 s emergency poll, the HTTP realtime
 * fallback poll, WS/SSE SYNC handlers, manual sync, and self-scheduled retry
 * timeouts. Before this gate they could overlap freely, so on the slow /
 * intermittent networks signage players actually live on, an OLD in-flight
 * response could land AFTER a newer one and re-apply stale normal or
 * emergency state ("last response to arrive wins").
 *
 * The fix is structural, not heuristic: at most ONE reconcile runs at a
 * time. Triggers that arrive mid-flight coalesce into exactly one follow-up
 * run (they don't queue N-deep — the follow-up fetches the CURRENT truth,
 * which subsumes every trigger that requested it). With requests serialized,
 * arrival-order inversion is impossible in-page, for normal AND emergency
 * payloads, without adding a wire revision that would interact with the
 * manifest ETag/304 contract (CLAUDE.md manifest-cache rule #4).
 *
 * The disk-cache fallback path (`readCachedManifest` → `applyManifest(m,
 * fromCache=true)`) keeps its existing, separately-audited emergency
 * interlock — this gate deliberately does not touch it.
 *
 * Pure and framework-free so it unit-tests without the player page.
 */

export interface ManifestGate {
  /**
   * Run `job` if idle; if a run is already in flight, remember that another
   * reconcile was requested and return the in-flight completion promise.
   * A throwing job never breaks the gate: the error is contained (the
   * player's fetchContent already reports its own failures) and a queued
   * follow-up still runs.
   */
  run(job: () => Promise<void>): Promise<void>;
  /** True while a reconcile (or its coalesced follow-up) is in flight. */
  busy(): boolean;
  /** How many triggers were coalesced away (diagnostics). */
  coalescedCount(): number;
}

export function createManifestGate(): ManifestGate {
  let inFlight: Promise<void> | null = null;
  let rerunRequested = false;
  let coalesced = 0;
  // B-P2-13 (2026-08-30): the coalesced follow-up runs the LATEST job
  // handed to run(), not the one captured by the first call. In practice
  // callers always pass fetchContent — but fetchContent's inner closure is
  // rebuilt when screenId changes (TENANT_CHANGED → re-register), and a
  // follow-up that re-ran the OLD closure fetched the old screen's
  // manifest once.
  let latestJob: (() => Promise<void>) | null = null;

  const run = (job: () => Promise<void>): Promise<void> => {
    latestJob = job;
    if (inFlight) {
      rerunRequested = true;
      coalesced += 1;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        // First pass, plus one pass per coalesced burst that arrived while
        // we were fetching. `rerunRequested` is cleared BEFORE the job so a
        // trigger landing mid-job is seen by the loop condition.
        do {
          rerunRequested = false;
          try {
            await (latestJob ?? job)();
          } catch {
            // fetchContent handles/reports its own errors; a throw here must
            // not kill a queued follow-up or wedge the gate.
          }
        } while (rerunRequested);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  return {
    run,
    busy: () => inFlight !== null,
    coalescedCount: () => coalesced,
  };
}
