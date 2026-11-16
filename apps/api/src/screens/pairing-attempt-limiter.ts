/**
 * PER-USER limit on wrong pairing codes for `POST /screens/pair` (2026-11-16).
 *
 * A signed-in admin who enters a code that matches no screen (or a screen
 * another organisation owns) records one failure against their own user id.
 * At PAIR_FAIL_LIMIT failures inside PAIR_FAIL_WINDOW_MS the user's pairing is
 * refused (429 SCREEN_PAIRING_TOO_MANY_ATTEMPTS) until the window lapses — a
 * correct code included — and the failure that trips the limit is reported to
 * the caller so it writes one audit row. A successful pair does NOT reset the
 * count: the window simply ages out.
 *
 * Shared across replicas through Redis (the same `incr` / `pexpire` / `pttl`
 * shape as auth/login-attempt-limiter.ts). If Redis is unreachable it counts
 * in process instead (numReplicas = 1), so an outage never removes the limit
 * and never locks anyone out beyond it.
 */
import { HttpException, HttpStatus, Logger } from '@nestjs/common';

export const PAIR_FAIL_LIMIT = 10;
export const PAIR_FAIL_WINDOW_MS = 15 * 60_000;
export const PAIRING_TOO_MANY_ATTEMPTS = 'SCREEN_PAIRING_TOO_MANY_ATTEMPTS';

/** The subset of ioredis this needs (so a test can hand in a fake). */
export interface PairLimiterRedis {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  get(key: string): Promise<string | null>;
  pttl(key: string): Promise<number>;
}

const key = (userId: string) => `screens:pair:fail:${userId}`;

export function pairingLockedRefusal(retryAfterMs: number): HttpException {
  return new HttpException(
    {
      code: PAIRING_TOO_MANY_ATTEMPTS,
      message: 'Too many incorrect pairing codes. Wait a few minutes, then check the code on the screen and try again.',
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

export class PairingAttemptLimiter {
  private readonly logger = new Logger('PairingAttemptLimiter');
  private lastWarnAt = 0;
  /** In-process fallback while Redis is unreachable: userId → window. */
  private readonly local = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly redis: () => PairLimiterRedis | null | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  private warn(e: unknown) {
    const t = this.now();
    if (t - this.lastWarnAt < 60_000) return;
    this.lastWarnAt = t;
    this.logger.warn(`pairing-attempt limiter using the in-process count (Redis unavailable): ${(e as Error)?.message ?? e}`);
  }

  private localWindow(userId: string) {
    const t = this.now();
    const w = this.local.get(userId);
    if (w && w.resetAt > t) return w;
    if (w) this.local.delete(userId);
    return null;
  }

  /** Throws 429 while this user has used up their wrong-code budget. */
  async check(userId: string): Promise<void> {
    const r = this.redis();
    if (r) {
      try {
        const [count, ttl] = await Promise.all([r.get(key(userId)), r.pttl(key(userId))]);
        if (Number(count) >= PAIR_FAIL_LIMIT) throw pairingLockedRefusal(ttl > 0 ? ttl : PAIR_FAIL_WINDOW_MS);
        return;
      } catch (e) {
        if (e instanceof HttpException) throw e;
        this.warn(e);
      }
    }
    const w = this.localWindow(userId);
    if (w && w.count >= PAIR_FAIL_LIMIT) throw pairingLockedRefusal(w.resetAt - this.now());
  }

  /**
   * Record one wrong code. Returns the count in the window and whether THIS
   * failure reached the limit (exactly once per window — the caller audits it).
   */
  async recordFailure(userId: string): Promise<{ failures: number; tripped: boolean }> {
    const r = this.redis();
    if (r) {
      try {
        const failures = await r.incr(key(userId));
        if (failures === 1) await r.pexpire(key(userId), PAIR_FAIL_WINDOW_MS);
        return { failures, tripped: failures === PAIR_FAIL_LIMIT };
      } catch (e) {
        this.warn(e);
      }
    }
    const t = this.now();
    const w = this.localWindow(userId) ?? { count: 0, resetAt: t + PAIR_FAIL_WINDOW_MS };
    w.count += 1;
    this.local.set(userId, w);
    if (this.local.size > 10_000) {
      const oldest = this.local.keys().next().value;
      if (oldest !== undefined) this.local.delete(oldest);
    }
    return { failures: w.count, tripped: w.count === PAIR_FAIL_LIMIT };
  }
}
