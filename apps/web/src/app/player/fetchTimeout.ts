/**
 * Bounded fetch for the player's load-bearing await chains
 * (2026-08-30 deep audit, D-1 — then re-fixed the same day after the
 * adversarial emergency-chain audit CONFIRMED the first version was a
 * half-fix, finding F1).
 *
 * THE HOLE, PRECISELY. Browser `fetch()` resolves when response HEADERS
 * arrive; the BODY streams afterwards. Version 1 of this helper cleared its
 * abort timer in `.finally()` on the fetch promise — i.e. at headers — so
 * every caller's subsequent `res.json()` was UNBOUNDED again. A proxy or
 * captive portal that answers 200 and then stalls the body (ordinary
 * flaky-venue-WiFi / slow-loris behaviour) would still wedge:
 *
 *   • the manifest read inside the single-flight gate → ALL reconciliation
 *     frozen, including the 5–10 s emergency poll;
 *   • the register read inside attemptCredentialRecovery → the recovery
 *     single-flight ref parked for the life of the page;
 *   • the pairing-loop reads → pairing polling stopped.
 *
 * And the v1 unit test asserted the timer was cleared after headers —
 * codifying the hole. This version holds ONE deadline across
 * connect + headers + body-read, and its tests stall the BODY.
 *
 * A deadline abort that lands mid-body surfaces as an AbortError REJECTION
 * (never a silent `json: null`), so callers' existing catch paths treat it
 * exactly like any other fetch failure. A genuinely empty / non-JSON body
 * (304s, 204s) parses to `json: null` without throwing.
 *
 * `externalCtl` (optional) lets a caller hand in the AbortController so
 * something else can preempt the request — the emergency path uses this to
 * abort an in-flight NORMAL manifest fetch the moment an OVERRIDE arrives,
 * so the gate's coalesced follow-up (which will fetch the emergency
 * payload) runs immediately instead of after a stalled request's deadline
 * (audit finding F2).
 *
 * AbortController is Chromium 66+ / Safari 12.1+ — the whole fleet floor
 * (Taurus = Chromium 83). Where absent, degrade to unbounded (pre-wave
 * behavior) rather than breaking the call.
 */

/** Generous ceiling: covers a cold Railway boot + slow venue WiFi, while
 *  guaranteeing the serialized chains make progress within seconds of a
 *  real stall — well inside the emergency poll's tolerance. */
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

export interface BoundedJsonResult {
  /** Status/headers usable as normal; the body has already been consumed. */
  res: Response;
  /** Parsed JSON body, or null for an empty / non-JSON body (304, 204…). */
  json: any | null;
}

const HEADERS_STATUS = '__venueosHeadersStatus';

/**
 * The HTTP status whose headers had ALREADY arrived when a bounded fetch
 * threw mid-body, or null when the failure happened before any response
 * (DNS, connect, headers deadline). Lets a caller tell "the server never got
 * it" (retry soon) from "the server got it, the body stalled" (it counted).
 */
export function headersStatusOf(err: unknown): number | null {
  const v = (err as Record<string, unknown> | null | undefined)?.[HEADERS_STATUS];
  return typeof v === 'number' ? v : null;
}

export async function fetchJsonBounded(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  externalCtl?: AbortController,
): Promise<BoundedJsonResult> {
  if (typeof AbortController !== 'function') {
    // Ancient/exotic runtime — keep working, just unbounded.
    const res = await fetch(input, init);
    let json: any = null;
    try { json = await res.json(); } catch { json = null; }
    return { res, json };
  }
  const ctl = externalCtl ?? new AbortController();
  const timer = setTimeout(() => {
    try { ctl.abort(); } catch { /* swallow */ }
  }, timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: ctl.signal });
    let json: any = null;
    try {
      // STILL under the deadline — this is the read v1 left unbounded.
      json = await res.json();
    } catch (e: any) {
      if (e && (e.name === 'AbortError' || ctl.signal.aborted)) {
        // Deadline (or preemption) hit mid-body: a failure, never a
        // silent empty-body success. The HEADERS did arrive, though, and
        // for a POST that is a fact the caller may need: a 2xx means the
        // server already accepted and counted the request, so re-sending
        // it on the fast retry path is what produces the fleet's 429s
        // (telemetry, 2026-09-22). Carried on the error, read with
        // `headersStatusOf`; everything else about the throw is unchanged.
        try { Object.assign(e, { [HEADERS_STATUS]: res.status }); } catch { /* frozen error — fine */ }
        throw e;
      }
      json = null; // empty or non-JSON body — normal for 304/204
    }
    return { res, json };
  } finally {
    clearTimeout(timer);
  }
}
