/**
 * board-poll — shared client poll engine for the PUBLIC game surfaces
 * (/board, /ribbon and the GameStateContext provider behind /scorebug,
 * /overlay and the sport widgets).
 *
 * Replaces the three per-surface `setInterval(load, 750)` loops (Trust
 * wave Domain B, 2026-08-06). Design constraints, in order:
 *
 *   1. OVERLAP-FREE BY CONSTRUCTION — the next attempt is scheduled only
 *      after the current one settles (self-chaining setTimeout), so a
 *      response slower than the cadence can never stack fetches the way
 *      a fixed setInterval did.
 *   2. CONDITIONAL REVALIDATION — when the API offers an `ETag` (Domain
 *      A adds it to GET /sports/board/:id) the engine sends
 *      `If-None-Match` and treats 304 as "unchanged": the only work is
 *      forwarding the fresh `X-Server-Time` clock sample so the caller's
 *      skew projection stays honest. Against an API that does NOT send
 *      an ETag (deploy-order safety) no `If-None-Match` is ever sent and
 *      every poll is a plain 200 — exactly today's behavior.
 *   3. BACKOFF + JITTER — consecutive failures stretch the cadence
 *      1500 → 3000 → 5000 ms (capped), reset on the first success; every
 *      delay carries ±10% jitter so a fleet of boards that lost the same
 *      AP doesn't thundering-herd the API on recovery.
 *
 * Ships to Chromium 83 (NovaStar Taurus): plain fetch + .then only — no
 * AbortSignal.timeout, no structuredClone, no replaceAll/Array.at. Pure
 * DOM-free module (no React) so it unit-tests under fake timers.
 */

/** Failure-cadence ladder: after N consecutive failures the next attempt
 *  waits BOARD_POLL_BACKOFF_MS[min(N, len) - 1] (± jitter). */
export const BOARD_POLL_BACKOFF_MS = [1500, 3000, 5000];

/** How long a surface may go without a good poll before it must stop
 *  pretending its frame is live (the "CONNECTION LOST" chip threshold).
 *  Shared by /board and /ribbon so both surfaces flip together. */
export const STALE_FEED_AFTER_MS = 8000;

export interface BoardPollStatus {
  /** Wall-clock ms (Date.now) of the last good poll — a 200 OR a 304.
   *  Seeded with the start() time so "stale after N ms" math is
   *  well-defined before the first success (a board that never reaches
   *  the API goes stale N ms after boot, which is the honest reading). */
  lastGoodAt: number;
  consecutiveFailures: number;
  /** `consecutiveFailures === 0` — the last settled attempt succeeded. */
  online: boolean;
  /** Message from the most recent attempt when it failed; null after a
   *  good poll. Network errors carry the fetch error message, HTTP
   *  failures carry `HTTP <status>`. */
  lastError: string | null;
  /** HTTP status of the most recent settled attempt; null when the
   *  attempt never produced a response (network failure). */
  lastHttpStatus: number | null;
}

export interface BoardPollOptions {
  url: string;
  /** Steady-state cadence while polls succeed (750 on the game surfaces). */
  intervalMs: number;
  /** Fresh full payload — fires on every 200 with the parsed JSON body. */
  onPayload: (payload: unknown) => void;
  /** Fresh server-clock sample — fires on a 304 that carries a numeric
   *  `X-Server-Time` header (200s carry serverTime in the body instead). */
  onServerTime?: (serverTimeMs: number) => void;
  /** Fires after EVERY settled attempt, success or failure. */
  onStatus?: (status: BoardPollStatus) => void;
}

/** ±10% jitter, floored at 0 — desynchronizes a fleet on one cadence. */
function jittered(baseMs: number): number {
  return Math.max(0, Math.round(baseMs + (Math.random() * 2 - 1) * 0.1 * baseMs));
}

/**
 * Start polling `url`. Fires the first attempt immediately, then
 * self-chains. Returns a `stop()` that cancels the pending timer AND
 * suppresses every callback from any still-in-flight attempt.
 */
export function startBoardPoll(opts: BoardPollOptions): () => void {
  const { url, intervalMs, onPayload, onServerTime, onStatus } = opts;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let etag: string | null = null;
  let lastGoodAt = Date.now();
  let failures = 0;

  const report = (lastError: string | null, lastHttpStatus: number | null) => {
    if (onStatus) {
      onStatus({
        lastGoodAt,
        consecutiveFailures: failures,
        online: failures === 0,
        lastError,
        lastHttpStatus,
      });
    }
  };

  const schedule = () => {
    if (stopped) return;
    const base =
      failures === 0
        ? intervalMs
        : BOARD_POLL_BACKOFF_MS[Math.min(failures, BOARD_POLL_BACKOFF_MS.length) - 1];
    timer = setTimeout(attempt, jittered(base));
  };

  const settleGood = () => {
    failures = 0;
    lastGoodAt = Date.now();
  };

  const attempt = () => {
    const headers: Record<string, string> = {};
    if (etag) headers['If-None-Match'] = etag;
    fetch(url, { cache: 'no-store', headers })
      .then((res) => {
        if (stopped) return;
        // Header reads must tolerate a Response with no usable `headers`
        // (Jest fetch stubs commonly omit it) — a throw here would register
        // as a failed poll and silently starve the surface of data.
        const readHeader = (name: string): string | null => {
          const h = (res as { headers?: { get?: (n: string) => string | null } }).headers;
          return h && typeof h.get === 'function' ? (h.get(name) ?? null) : null;
        };
        if (res.status === 304) {
          // Unchanged body — a good poll. Forward the server clock sample
          // (the whole point of the 304 fast path) and move on.
          settleGood();
          if (onServerTime) {
            const raw = readHeader('X-Server-Time');
            const n = raw == null ? NaN : Number(raw);
            if (isFinite(n) && n > 0) onServerTime(n);
          }
          report(null, 304);
          schedule();
          return;
        }
        if (!res.ok) {
          failures += 1;
          report('HTTP ' + res.status, res.status);
          schedule();
          return;
        }
        // 200 — remember the validator (null when the API doesn't send
        // one, which also clears a stale validator if the server stops).
        const nextTag = readHeader('ETag');
        return res.json().then((json) => {
          if (stopped) return;
          etag = nextTag;
          settleGood();
          onPayload(json);
          report(null, res.status);
          schedule();
        });
      })
      .catch((e) => {
        // Network failure or a malformed 200 body — either way this
        // attempt produced nothing usable.
        if (stopped) return;
        failures += 1;
        report(e instanceof Error ? e.message : String(e), null);
        schedule();
      });
  };

  attempt();

  return function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
