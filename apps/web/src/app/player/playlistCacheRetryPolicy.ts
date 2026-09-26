/**
 * When to try the playlist pre-cache again after a failed or partial attempt.
 *
 * Why this exists (2026-09-26, 4K cache-fill incident): a failed attempt used
 * to be reconsidered only when a FULL manifest was applied — and an unchanged
 * manifest poll answers 304, so a screen whose first download failed could
 * stream its 4K clip from origin for the rest of the session. The page now
 * ticks this policy on a timer (page.tsx) and re-drives the cache whenever it
 * says the attempt is due. Exponential backoff, capped: a dead link must not
 * turn into a request storm, a blip must not cost ten minutes.
 *
 * Pure: no timers, no DOM, no network — unit-tested without the page.
 */
export interface PlaylistCacheRetryOptions {
  /** Delay after the first failure. Default 30 s. */
  baseMs?: number;
  /** Growth per consecutive failure. Default 2. */
  factor?: number;
  /** Ceiling on the delay. Default 10 minutes. */
  maxMs?: number;
}

export class PlaylistCacheRetryPolicy {
  private failures = 0;
  private dueAtMs = 0;
  private readonly baseMs: number;
  private readonly factor: number;
  private readonly maxMs: number;

  constructor(opts: PlaylistCacheRetryOptions = {}) {
    this.baseMs = opts.baseMs ?? 30_000;
    this.factor = opts.factor ?? 2;
    this.maxMs = opts.maxMs ?? 10 * 60_000;
  }

  get consecutiveFailures(): number {
    return this.failures;
  }

  /** The delay a given failure count earns (1 = first failure). */
  delayFor(failures: number): number {
    if (failures <= 0) return 0;
    return Math.min(this.maxMs, this.baseMs * Math.pow(this.factor, failures - 1));
  }

  /** Everything the manifest needs is in the cache — start over from zero. */
  recordSuccess(): void {
    this.failures = 0;
    this.dueAtMs = 0;
  }

  /** An attempt ended incomplete. Returns the delay before the next one. */
  recordFailure(nowMs: number): number {
    this.failures += 1;
    const delay = this.delayFor(this.failures);
    this.dueAtMs = nowMs + delay;
    return delay;
  }

  isDue(nowMs: number): boolean {
    return nowMs >= this.dueAtMs;
  }

  msUntilDue(nowMs: number): number {
    return Math.max(0, this.dueAtMs - nowMs);
  }

  /** The network came back (or an operator asked): try now, keep the count. */
  expedite(): void {
    this.dueAtMs = 0;
  }
}
