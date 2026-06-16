/**
 * fetchWithTimeout — fetch() with a bounded AbortController timeout.
 *
 * LIFE-SAFETY (2026-06-16): the emergency path (trigger, all-clear,
 * status polling, session-verify on /panic) had ZERO bounded timeouts.
 * A *stalled* connection (DNS hang, half-open socket, unresponsive
 * server — distinct from a refused connection, which fails fast) left
 * the operator stuck forever: "Verifying authorization…" on /panic, or
 * "Sending alert to all screens…" mid-lockdown, with no failure surfaced.
 * Every emergency fetch now goes through this helper so a hung request is
 * aborted and surfaces as a real error the UI can act on.
 *
 * On timeout this rejects with a {@link FetchTimeoutError} whose message
 * contains BOTH "network" and "fetch" (case-insensitive). That is load-
 * bearing: the /panic page routes `result.error` by substring — it greps
 * for "401"/"403" (auth) then "network"/"fetch" (connectivity) to decide
 * which guidance to show. A timeout MUST land in the connectivity branch
 * ("alert was NOT broadcast — NOTIFY SECURITY MANUALLY"), never the
 * generic branch, so the wording stays truthful during a real incident.
 *
 * Isomorphic: global `fetch` + `AbortController` exist in every supported
 * browser AND the Next.js server-action (Node 18+) runtime, so the same
 * helper covers `broadcastEmergency` (server action) and the client polls.
 *
 * NOTE: this intentionally owns its own AbortController and does not
 * merge a caller-supplied `init.signal` — none of the emergency call
 * sites pass one. If a future caller needs to combine an external signal
 * with the timeout, extend this with AbortSignal.any() (Node 20+ / modern
 * browsers) rather than dropping the timeout.
 */

export class FetchTimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    public readonly url: string,
  ) {
    // Message MUST contain "network" + "fetch" — see file header.
    super(`Network timeout after ${timeoutMs}ms — fetch aborted (${url})`);
    this.name = 'FetchTimeoutError';
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    // Translate OUR timeout abort into a clear, routable error. We only
    // own this controller's signal, so an abort here is always the timer
    // firing (not a caller cancel). A genuine network error (connection
    // refused, DNS failure) re-throws unchanged.
    if (
      controller.signal.aborted &&
      (err as { name?: string } | null)?.name === 'AbortError'
    ) {
      const url =
        typeof input === 'string'
          ? input
          : ((input as Request)?.url ?? String(input));
      throw new FetchTimeoutError(timeoutMs, url);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
