/**
 * SEC-012 (2026-09-04) — revocation must fail CLOSED when its state cannot
 * be established.
 *
 * THE BUG THIS CLOSES. `RedisService.sismember('jwt_revoked_list', …)`
 * answered `false` — "not revoked" — whenever Redis AND the Postgres mirror
 * were both unreachable, and `getTokenInvalidBefore` answered `null` on the
 * Redis-less variant of the same state. The service logged the situation
 * loudly ("REVOCATION BACKSTOP UNAVAILABLE … Previously-revoked tokens may be
 * accepted") and then allowed the request anyway. A logged-out session, a
 * demoted admin's other tabs, and a screen whose credential an operator
 * revoked all came back to life for the duration of a dual-dependency outage
 * — including on routes that need no database at all (static/cached reads,
 * a replica recovering out of order, anything served from the manifest hot
 * cache).
 *
 * THE RULE NOW. Uncertainty is not permission. Every principal and every
 * route fails closed when revocation state is indeterminate, with exactly
 * ONE named, bounded, instrumented exception:
 *
 *   `player-continuity-read` — a DEVICE credential performing a SAFE
 *   (GET/HEAD) request, for at most REVOCATION_CONTINUITY_GRACE_MS after the
 *   outage began.
 *
 * WHY THAT ONE EXISTS. `GET /screens/:id/manifest` is CLAUDE.md emergency
 * safeguard #4: the HTTP-polling backstop that delivers a lockdown when the
 * push channel is down. It is served from an in-process hot cache, so it
 * keeps working while Postgres is unreachable. Failing it closed would take
 * the whole fleet content-dead AND cut it out of alert delivery during the
 * exact infrastructure incident most likely to coincide with a real
 * emergency — trading a confidentiality bug for a life-safety availability
 * bug. The exception is CAPABILITY-shaped, not a route list, for the same
 * reason SEC-001's write ban is: a device-reachable mutation added tomorrow
 * is refused without anyone remembering this file exists.
 *
 * WHAT IT COSTS, STATED PLAINLY. For up to the grace window, a device token
 * revoked during a total outage can still read its own screen's manifest.
 * It cannot write anything (SEC-001), cannot open a socket or an SSE stream
 * (both fail closed — see below), cannot mint a stream ticket, and cannot
 * reach any user-scoped route. Every other credential class — user sessions,
 * API keys, and every mutation of any kind — is refused for the entire
 * outage.
 *
 * WHERE THE FAIL-CLOSED DEFAULT IS ENFORCED. `RedisService.sismember` now
 * THROWS `RevocationIndeterminateError` instead of answering `false`, so the
 * three call sites that already wrap it in try/catch (`device-auth.ts`,
 * `sse.controller.ts`, `realtime.gateway.ts`) deny without needing to know
 * this file exists. `JwtAuthGuard` is the only caller that asks for the
 * tri-state verdict, because it is the only one that can see the request and
 * therefore classify the purpose.
 *
 * NOTHING HERE IS ENVIRONMENT-GATED. The P1-4 lesson (a revocation check
 * wrapped in `NODE_ENV === 'production'` was a silent no-op everywhere else)
 * applies to the posture too.
 */

import { Logger } from '@nestjs/common';

/**
 * Thrown by the revocation lookups when neither Redis nor the Postgres
 * mirror could answer. Callers that already fail closed on a thrown
 * revocation check keep doing exactly that; callers that want the named
 * exception ask for the tri-state verdict instead.
 */
export class RevocationIndeterminateError extends Error {
  /** Brand, so a catch block can identify this without `instanceof` across module copies. */
  readonly revocationIndeterminate = true;

  constructor(detail: string) {
    super(`Revocation state could not be established (${detail})`);
    this.name = 'RevocationIndeterminateError';
  }
}

export function isRevocationIndeterminateError(e: unknown): e is RevocationIndeterminateError {
  return (
    !!e &&
    typeof e === 'object' &&
    (e as { revocationIndeterminate?: unknown }).revocationIndeterminate === true
  );
}

/** Tri-state answer from a revocation store. `indeterminate` is never "allowed". */
export type RevocationCertainty = 'revoked' | 'clear' | 'indeterminate';

/**
 * What the request is trying to do, from the revocation policy's point of
 * view. Only `player-continuity-read` is eligible for the exception; the
 * name of the other value is deliberately blunt.
 */
export type RevocationPurpose = 'player-continuity-read' | 'protected';

/**
 * The only HTTP methods a continuity read may use. Everything else — POST,
 * PUT, PATCH, DELETE, and any future verb — is a mutation as far as this
 * policy is concerned and fails closed.
 */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/**
 * How long the continuity exception survives after revocation state first
 * became indeterminate, in ms.
 *
 * TEN MINUTES, and the number is reasoned, not arbitrary: a device token's
 * proactive renewal timer is 10 minutes (`deviceCredential.ts`), so this is
 * one renewal cycle — long enough to ride out the pool blip / failover /
 * restart class of outage that produces the both-stores-down state, short
 * enough that a genuine sustained outage converges to fully closed while the
 * player is still holding cached content (the service worker's never-evict
 * emergency tier and the manifest hot cache both outlive this window). After
 * it expires the fleet keeps PLAYING; it just stops being handed fresh
 * manifests until a revocation store answers again.
 */
export const REVOCATION_CONTINUITY_GRACE_MS = 10 * 60 * 1000;

/** At most one "allowed under continuity" line per this interval, per replica. */
const ALLOW_LOG_THROTTLE_MS = 10_000;

export interface RevocationPostureDecision {
  /** `true` ONLY for a continuity read inside the grace window. */
  allow: boolean;
  /** Stable, greppable reason string — logged and returned for tests. */
  reason:
    | 'continuity-read-within-grace'
    | 'continuity-grace-expired'
    | 'protected-request';
  /** How long revocation state has been indeterminate, in ms. */
  outageMs: number;
}

export interface RevocationPostureSnapshot {
  /** ms since the outage opened, or `null` when revocation state is known. */
  outageMs: number | null;
  /** Continuity reads allowed since the outage opened. */
  allowed: number;
  /** Requests refused since the outage opened. */
  denied: number;
  /** `true` once the grace window lapsed during the CURRENT outage. */
  graceExpired: boolean;
}

/**
 * Classify a request for the revocation policy.
 *
 * Capability-shaped on purpose (see the file header). A device credential
 * doing a safe read is the continuity case; literally everything else —
 * every user session, every API key, every mutation by anyone — is
 * `protected` and fails closed.
 */
export function classifyRevocationPurpose(input: {
  principalKind?: string | null;
  method?: string | null;
}): RevocationPurpose {
  if (input.principalKind !== 'device') return 'protected';
  const method = String(input.method ?? '').toUpperCase();
  return SAFE_METHODS.has(method) ? 'player-continuity-read' : 'protected';
}

/**
 * Per-replica outage bookkeeping + the loud telemetry the audit asked for.
 *
 * State is intentionally process-local: the grace window measures how long
 * THIS replica has been unable to answer, and a replica that can still reach
 * a store never opens a window at all.
 */
export class RevocationPosture {
  private readonly logger = new Logger('RevocationPosture');
  private outageStartedAt: number | null = null;
  private allowed = 0;
  private denied = 0;
  private graceExpired = false;
  private lastAllowLogAt = 0;

  /**
   * A revocation store answered. Closes any open outage window so the next
   * outage gets a fresh (and freshly logged) grace period.
   */
  observeConfirmed(now: number = Date.now()): void {
    if (this.outageStartedAt == null) return;
    const durationMs = now - this.outageStartedAt;
    this.logger.log(
      `REVOCATION BACKSTOP RECOVERED after ${durationMs}ms — ` +
        `${this.allowed} continuity read(s) allowed, ${this.denied} request(s) refused ` +
        'while revocation state was indeterminate.',
    );
    this.reset();
  }

  /**
   * Revocation state is indeterminate for this request. Opens the outage
   * window if needed and returns the decision. NEVER returns `allow: true`
   * for anything but a continuity read inside the window.
   */
  decide(purpose: RevocationPurpose, now: number = Date.now()): RevocationPostureDecision {
    if (this.outageStartedAt == null) {
      this.outageStartedAt = now;
      this.logger.warn(
        'REVOCATION BACKSTOP UNAVAILABLE: Redis AND Postgres are both unreachable. ' +
          'FAILING CLOSED for every user session, API key and mutation. Device GET/HEAD ' +
          `reads (player continuity) are allowed for the next ${REVOCATION_CONTINUITY_GRACE_MS}ms ` +
          'so a lockdown can still reach the fleet through the manifest backstop.',
      );
    }
    const outageMs = now - this.outageStartedAt;

    if (purpose !== 'player-continuity-read') {
      this.denied += 1;
      return { allow: false, reason: 'protected-request', outageMs };
    }

    if (outageMs > REVOCATION_CONTINUITY_GRACE_MS) {
      if (!this.graceExpired) {
        this.graceExpired = true;
        this.logger.warn(
          `REVOCATION CONTINUITY GRACE EXPIRED after ${outageMs}ms — player reads now ` +
            'fail closed too. Screens keep playing cached content; they stop receiving ' +
            'fresh manifests until Redis or Postgres answers again.',
        );
      }
      this.denied += 1;
      return { allow: false, reason: 'continuity-grace-expired', outageMs };
    }

    this.allowed += 1;
    if (now - this.lastAllowLogAt >= ALLOW_LOG_THROTTLE_MS) {
      this.lastAllowLogAt = now;
      this.logger.warn(
        `REVOCATION INDETERMINATE — allowed ${this.allowed} player-continuity read(s) ` +
          `and refused ${this.denied} request(s) in the last ${outageMs}ms. ` +
          'A device credential revoked during this outage may still read its own manifest.',
      );
    }
    return { allow: true, reason: 'continuity-read-within-grace', outageMs };
  }

  snapshot(now: number = Date.now()): RevocationPostureSnapshot {
    return {
      outageMs: this.outageStartedAt == null ? null : now - this.outageStartedAt,
      allowed: this.allowed,
      denied: this.denied,
      graceExpired: this.graceExpired,
    };
  }

  /** Test seam, and what `observeConfirmed` uses to close a window. */
  reset(): void {
    this.outageStartedAt = null;
    this.allowed = 0;
    this.denied = 0;
    this.graceExpired = false;
    this.lastAllowLogAt = 0;
  }
}

/**
 * Process-wide instance. One per replica by design — see the class comment.
 */
export const revocationPosture = new RevocationPosture();
