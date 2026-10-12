/**
 * PER-ACCOUNT password sign-in throttle (2026-10-11, launch security
 * re-audit V-5).
 *
 * `POST /auth/login` already has a per-IP `@Throttle` (10/min). That bounds
 * one machine; a credential-stuffing run from many addresses against ONE
 * admin's email was bounded by nothing. This counts FAILED password attempts
 * per normalized email, in Redis so every replica shares the count:
 *
 *   - failures 1..4 within the window: no delay;
 *   - from the 5th: exponential backoff — the next attempt is refused until
 *     2^(n-5) seconds have passed (1 s, 2 s, 4 s … capped at 60 s);
 *   - at 20 failures: a 15-minute soft lock. A CORRECT password during a
 *     backoff or lock is refused too (that is the point).
 *
 * NOT AN ACCOUNT ORACLE: the key is the address the caller typed, whether or
 * not an account exists, so a known and an unknown address are throttled and
 * answered identically.
 *
 * FAILS OPEN to the per-IP limit: if Redis is unreachable, `check` allows and
 * `record*` are no-ops (logged once per minute). Sign-in must never be taken
 * down by a Redis blip; the per-IP throttle and argon2's cost still apply.
 *
 * Success clears the failure count (not an active lock — the lock is checked
 * before the password is ever verified).
 */
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

export const LOGIN_FAIL_WINDOW_MS = 15 * 60_000;
export const LOGIN_BACKOFF_AFTER = 5;
export const LOGIN_LOCK_AFTER = 20;
export const LOGIN_LOCK_MS = 15 * 60_000;
const BACKOFF_CAP_MS = 60_000;

export const AUTH_TEMP_LOCKED = 'AUTH_TEMP_LOCKED';

/** The subset of ioredis this needs (so a test can hand in a fake). */
export interface LimiterRedis {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  set(key: string, value: string, mode: 'PX', ms: number): Promise<unknown>;
  pttl(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
}

export function normalizeLoginEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function keyId(email: string): string {
  return createHash('sha256').update(normalizeLoginEmail(email)).digest('hex').slice(0, 32);
}

export function backoffMsFor(failures: number): number {
  if (failures < LOGIN_BACKOFF_AFTER) return 0;
  return Math.min(BACKOFF_CAP_MS, 1000 * 2 ** (failures - LOGIN_BACKOFF_AFTER));
}

export function lockedRefusal(retryAfterMs: number): HttpException {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return new HttpException(
    {
      code: AUTH_TEMP_LOCKED,
      message:
        'Too many sign-in attempts. Wait a few minutes and try again, or reset your password.',
      retryAfterSeconds,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

export class LoginAttemptLimiter {
  private readonly logger = new Logger('LoginAttemptLimiter');
  private lastWarnAt = 0;

  constructor(private readonly redis: () => LimiterRedis | null | undefined) {}

  private warn(e: unknown) {
    const now = Date.now();
    if (now - this.lastWarnAt < 60_000) return;
    this.lastWarnAt = now;
    this.logger.warn(`per-account login throttle unavailable (falling back to the per-IP limit): ${(e as Error)?.message ?? e}`);
  }

  /** Throws 429 AUTH_TEMP_LOCKED while the address is backed off or locked. */
  async check(email: string): Promise<void> {
    const r = this.redis();
    if (!r) return;
    const id = keyId(email);
    let wait = 0;
    try {
      const [lock, next] = await Promise.all([r.pttl(`auth:login:lock:${id}`), r.pttl(`auth:login:next:${id}`)]);
      wait = Math.max(lock > 0 ? lock : 0, next > 0 ? next : 0);
    } catch (e) {
      this.warn(e);
      return;
    }
    if (wait > 0) throw lockedRefusal(wait);
  }

  /**
   * Record one failed password attempt. Returns the failure count in the
   * window and whether this failure started a lock (for the caller's audit),
   * or null when Redis is unavailable.
   */
  async recordFailure(email: string): Promise<{ failures: number; locked: boolean } | null> {
    const r = this.redis();
    if (!r) return null;
    const id = keyId(email);
    try {
      const failures = await r.incr(`auth:login:fail:${id}`);
      if (failures === 1) await r.pexpire(`auth:login:fail:${id}`, LOGIN_FAIL_WINDOW_MS);
      if (failures >= LOGIN_LOCK_AFTER) {
        await r.set(`auth:login:lock:${id}`, '1', 'PX', LOGIN_LOCK_MS);
        // Start a fresh count once the lock lapses.
        await r.del(`auth:login:fail:${id}`);
        return { failures, locked: true };
      }
      const backoff = backoffMsFor(failures);
      if (backoff > 0) await r.set(`auth:login:next:${id}`, '1', 'PX', backoff);
      return { failures, locked: false };
    } catch (e) {
      this.warn(e);
      return null;
    }
  }

  async recordSuccess(email: string): Promise<void> {
    const r = this.redis();
    if (!r) return;
    const id = keyId(email);
    try {
      await r.del(`auth:login:fail:${id}`, `auth:login:next:${id}`);
    } catch (e) {
      this.warn(e);
    }
  }
}
