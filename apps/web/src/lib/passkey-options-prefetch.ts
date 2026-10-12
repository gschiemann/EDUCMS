/**
 * PASSKEY OPTIONS, FETCHED BEFORE THE TAP (2026-10-11).
 *
 * Owner, Safari on a Mac: "Use your passkey" PERIODICALLY did not open the
 * passkey sheet. Every passkey button used to do: tap → `await fetch(options)`
 * → `navigator.credentials.get()`. Safari only lets a WebAuthn call run inside
 * the tap's TRANSIENT user activation; when the options request is slow the
 * activation is spent before the ceremony starts, and Safari rejects it
 * (`NotAllowedError`) or shows nothing. Intermittent, because it depends on
 * network latency — exactly the report.
 *
 * So the options are fetched when the step that shows the button comes on
 * screen, and the tap calls the ceremony SYNCHRONOUSLY with them (nothing
 * awaited in front of it). This module is that cache — pure, no React, no
 * timers — so the rules below are covered by a plain unit test.
 *
 * Rules (each one matters):
 *  • ONE-TIME. A challenge can be answered once: `take()` hands the options
 *    out and forgets them.
 *  • FRESH ONLY. The server keeps a challenge 5 minutes; anything older than
 *    `maxAgeMs` (4 min) is never handed out. Refresh is ON DEMAND
 *    (`refreshIfStale`, called on focus / visibility / step open) — never an
 *    interval timer (mobile-perf standard: no background polling).
 *  • NEVER WHILE A CEREMONY RUNS. The second-factor and required-setup
 *    challenges are stored server-side PER USER — a new options request
 *    REPLACES the one the open sheet is answering, and its verify would then
 *    fail. `begin()` locks the cache until the matching `end()`; a prefetch
 *    requested meanwhile is dropped. (The passwordless challenge is keyed by
 *    its own id, but it follows the same rule — simpler, and no harm.)
 *  • NEVER TWO REQUESTS AT ONCE, for the same reason: `acquire()` awaits a
 *    prefetch already in flight instead of racing it with a second request.
 *  • KEYED. The key (the partial mfaToken, or a constant for passwordless)
 *    must match: options minted for one sign-in attempt are never used for
 *    another. A different key, or `reset()`, discards everything — a result
 *    that lands after that is thrown away.
 */

/** What an options request answered — the page maps errors from this. */
export interface PasskeyOptionsReply {
  ok: boolean;
  status: number;
  // The JSON body, whatever it is; `options` present means usable. Untyped on
  // purpose: the page's existing refusal mappers read `code` / `message` from it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export type PasskeyOptionsFetcher = (key: string) => Promise<PasskeyOptionsReply>;

/** The server's challenge TTL is 5 minutes; hand out nothing older than 4. */
export const PASSKEY_OPTIONS_MAX_AGE_MS = 4 * 60_000;

export interface PasskeyOptionsCache {
  /** Fetch options for `key` unless fresh ones are held, one is in flight, or a ceremony runs. */
  prefetch(key: string): void;
  /**
   * `prefetch` only when nothing fresh is held — for focus / visibility. Not
   * more often than every `minRetryMs` (30 s): a refused or throttled options
   * request must not be re-sent on every window focus.
   */
  refreshIfStale(key: string): void;
  /** SYNCHRONOUS. Fresh options for `key` — consumed — or null. */
  take(key: string): PasskeyOptionsReply | null;
  /**
   * The fallback when `take` had nothing: wait for the prefetch already in
   * flight (never race it), else make the request now. Not stored — the
   * caller is about to use it.
   */
  acquire(key: string): Promise<PasskeyOptionsReply>;
  /** A ceremony is starting: no options request until `end(ticket)`. */
  begin(): number;
  /**
   * The ceremony `ticket` settled. Only the LATEST ticket unlocks — a tap
   * superseded by a newer one (whose sheet aborted it) must not unlock or
   * re-fetch under it. TRUE when this call unlocked.
   */
  end(ticket: number): boolean;
  /** Forget everything (left the step). An in-flight result is discarded. */
  reset(): void;
  /** Fresh options for `key` are held (diagnostics / tests). */
  hasFresh(key: string): boolean;
}

export function createPasskeyOptionsCache(
  fetcher: PasskeyOptionsFetcher,
  opts: { maxAgeMs?: number; minRetryMs?: number; now?: () => number } = {},
): PasskeyOptionsCache {
  const maxAgeMs = opts.maxAgeMs ?? PASSKEY_OPTIONS_MAX_AGE_MS;
  const minRetryMs = opts.minRetryMs ?? 30_000;
  const now = opts.now ?? (() => Date.now());

  let held: { key: string; reply: PasskeyOptionsReply; at: number } | null = null;
  let inflight: { key: string; promise: Promise<PasskeyOptionsReply>; gen: number } | null = null;
  /** Bumped by reset / take / acquire so a late result cannot be stored. */
  let gen = 0;
  let ticket = 0;
  let locked = false;
  /** When the last request was sent (refreshIfStale's rate limit). */
  let lastAttemptAt = -Infinity;

  const usable = (r: PasskeyOptionsReply) => r.ok && !!r.data?.options;
  const fresh = (key: string) => !!held && held.key === key && now() - held.at < maxAgeMs;

  const prefetch = (key: string) => {
    if (!key || locked) return;
    if (fresh(key)) return;
    if (inflight && inflight.key === key) return;
    if (held && held.key !== key) held = null;
    const myGen = ++gen;
    lastAttemptAt = now();
    const promise = fetcher(key);
    inflight = { key, promise, gen: myGen };
    promise.then(
      (reply) => {
        if (inflight?.promise === promise) inflight = null;
        // Discarded: the page moved on, or someone took over this request.
        if (myGen !== gen || locked) return;
        if (usable(reply)) held = { key, reply, at: now() };
      },
      () => {
        if (inflight?.promise === promise) inflight = null;
        /* unreachable now — the tap falls back to fetching itself */
      },
    );
  };

  return {
    prefetch,
    refreshIfStale(key) {
      if (fresh(key) || now() - lastAttemptAt < minRetryMs) return;
      prefetch(key);
    },
    take(key) {
      if (!fresh(key)) return null;
      const reply = held!.reply;
      held = null;
      gen++;
      return reply;
    },
    acquire(key) {
      held = null;
      const pending = inflight && inflight.key === key ? inflight.promise : null;
      // Whatever lands from here on belongs to the caller, not the cache.
      gen++;
      inflight = null;
      return pending ?? fetcher(key);
    },
    begin() {
      locked = true;
      return ++ticket;
    },
    end(t) {
      if (t !== ticket) return false;
      locked = false;
      return true;
    },
    reset() {
      held = null;
      inflight = null;
      gen++;
    },
    hasFresh: fresh,
  };
}

/**
 * Refused this fast, a `NotAllowedError` came from the browser, not from a
 * person: nobody reads a passkey sheet and dismisses it in under 2 seconds.
 */
export const EXPIRED_ACTIVATION_MAX_MS = 2_000;

/**
 * Did Safari refuse a ceremony because the tap had to wait for the network
 * first? Only on the fallback path (no prefetched options), only for
 * `NotAllowedError`, and only when it came back at once — a sheet the person
 * saw and closed takes longer, and keeps today's calm "may be on another
 * device" handling. When true the page says "tap again": by then the options
 * are prefetched, so the next tap goes straight to the device.
 */
export function isLikelyExpiredActivation(
  errorName: string,
  usedPrefetched: boolean,
  elapsedMs: number,
): boolean {
  return !usedPrefetched && errorName === 'NotAllowedError' && elapsedMs < EXPIRED_ACTIVATION_MAX_MS;
}
