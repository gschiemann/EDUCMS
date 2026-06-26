/**
 * Per-user rate limiter for the MFA challenge endpoint.
 *
 * Spec: 5 failed attempts per user per minute → 5-minute lockout.
 *
 * Why in-memory, not Redis: a malicious actor that scales attacks
 * across multiple API replicas to bypass an in-memory limiter is
 * already inside our perimeter. The `@Throttle` decorator on the
 * challenge route adds a per-IP layer through the NestJS global
 * limiter (in-memory / per-replica — see the ThrottlerModule note
 * in app.module.ts; effectively global at our committed
 * numReplicas:1), and the audit log records every failed attempt
 * for forensic review. The in-memory limiter is the third defense.
 *
 * If the API scales to >1 replica BOTH this limiter and the global
 * ThrottlerModule should migrate to Redis (SETNX-with-TTL here; a
 * fail-open Redis ThrottlerStorage there), but at our current size
 * the cost of a Redis round-trip per attempt outweighs the marginal
 * security gain.
 */

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';

const MAX_ATTEMPTS_PER_MINUTE = 5;
const ATTEMPT_WINDOW_MS = 60_000;
const LOCKOUT_MS = 5 * 60_000;

interface UserAttemptState {
  attempts: number[]; // timestamps of failed attempts within window
  lockedUntil: number; // unix ms, 0 if not locked
}

@Injectable()
export class MfaRateLimiter {
  private states = new Map<string, UserAttemptState>();

  /**
   * Call BEFORE verifying the code. Throws 429 if the user is locked
   * out, otherwise returns silently.
   *
   * `userKey` should be the user id (not the email — the email may
   * not even reach us if the challenge token is opaque to the
   * client). Pre-challenge we trust the JWT sub.
   */
  check(userKey: string): void {
    const now = Date.now();
    const state = this.states.get(userKey);
    if (state?.lockedUntil && state.lockedUntil > now) {
      const secondsLeft = Math.ceil((state.lockedUntil - now) / 1000);
      throw new HttpException(
        {
          message: `Too many failed MFA attempts. Try again in ${secondsLeft} seconds.`,
          code: 'MFA_LOCKED_OUT',
          retryAfterSeconds: secondsLeft,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Call AFTER a verification attempt with the outcome. On
   * `success=true` the state is cleared. On failure the failed
   * timestamp is recorded and, if N-in-window exceeded, the user
   * is locked for LOCKOUT_MS.
   */
  record(userKey: string, success: boolean): void {
    const now = Date.now();
    if (success) {
      // Clear the slate on success — the user has proven they own the
      // account. A subsequent bad attempt resets the count.
      this.states.delete(userKey);
      return;
    }
    const existing = this.states.get(userKey) || { attempts: [], lockedUntil: 0 };
    existing.attempts = existing.attempts.filter((t) => t >= now - ATTEMPT_WINDOW_MS);
    existing.attempts.push(now);
    if (existing.attempts.length >= MAX_ATTEMPTS_PER_MINUTE) {
      existing.lockedUntil = now + LOCKOUT_MS;
      // Reset attempts after lockout starts so the lockout doesn't
      // immediately re-trigger on the next check.
      existing.attempts = [];
    }
    this.states.set(userKey, existing);
  }
}
