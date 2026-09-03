/**
 * emergencyRev.ts — the player half of the cheap emergency-revision poll
 * (efficiency audit 2026-09-02, P0-2 / P0-3).
 *
 * WHAT CHANGED. The HTTP emergency backstop used to call `fetchContent()`
 * (a FULL manifest fetch) every 10 s, 5 s while an alert was up or the push
 * channel was degraded, and a separate 30 s reconcile ran on top of it. A
 * live Railway sample measured the manifest route at 45.5 % of all API
 * traffic. The player now polls `GET /screens/:id/emergency-rev` on the same
 * cadence — a device-authed request that answers 304 when nothing has moved
 * and costs the API zero database work — and fetches the manifest only when
 * the revision differs from the one it last applied.
 *
 * ── THE SAFETY ARGUMENT (read before changing any threshold) ─────────────
 * The two independent emergency delivery paths are UNCHANGED:
 *   1. signed WS / SSE push (primary), and
 *   2. the manifest, still the sole arbiter of lockdown.
 * This module adds no third path and carries no alert content. It only
 * decides when path 2 is worth asking for, and it is built to fail toward
 * asking:
 *   • the revision endpoint is unreachable, 5xx, 4xx, or returns something
 *     unparseable → `unavailable` → the caller does exactly what it did
 *     before this change: a full `fetchContent()` at the current cadence.
 *     A broken or entirely absent revision endpoint therefore cannot delay
 *     an alert by one millisecond; it can only cost traffic.
 *   • the very first poll has no baseline → `changed` → fetch.
 *   • the server answers `cold` (a restarted API that has not yet observed
 *     this screen) → a revision unlike any the player holds → fetch.
 *   • a local schedule-window edge → fetch, with no network opinion at all.
 * The one thing it will never do is turn a poll that FAILED into a reason
 * not to reconcile.
 *
 * ── CADENCE ──────────────────────────────────────────────────────────────
 * Revision poll: 10 s healthy, 5 s when an alert is on glass, the server
 * reports one active, or push is degraded — i.e. exactly the cadence the
 * old full-manifest poll used, on a request that is orders of magnitude
 * cheaper. Manifest reconcile: 60 s healthy (was 30 s), 10 s degraded — so
 * a screen whose push channel is unhealthy reconciles MORE often than it did
 * before, and a healthy one leans on the revision poll it now has.
 *
 * Pure and framework-free so it unit-tests without mounting the 12k-line
 * player page (same discipline as `scheduleWindow.ts` / `manifestGate.ts`).
 */

/** Revision poll while everything is healthy. */
export const REV_POLL_HEALTHY_MS = 10_000;
/** Revision poll while an alert is live or the push channel is degraded. */
export const REV_POLL_FAST_MS = 5_000;
/** Manifest reconcile while the push channel is healthy (was 30 s). */
export const RECONCILE_HEALTHY_MS = 60_000;
/** Manifest reconcile while the push channel is degraded. */
export const RECONCILE_DEGRADED_MS = 10_000;

/**
 * Consecutive 429s from our own per-screen floor before we stop trusting the
 * revision poll and fall back to full fetches.
 *
 * A 429 is normally SELF-inflicted (two effect instances polling, a clock
 * step) and means "you are asking too fast", not "the server is broken" —
 * reacting to it with a FULL manifest fetch would be precisely backwards.
 * But a hostile or misconfigured intermediary can also return 429, and a
 * response we treat as "skip" must never be able to suppress the backstop
 * indefinitely. Three in a row (≤30 s at the healthy cadence, ≤15 s at the
 * fast one, with the manifest reconcile running underneath the whole time)
 * converts to `unavailable`.
 */
export const REV_THROTTLE_STRIKES = 3;

export type RevPollOutcome =
  /** Server confirmed nothing has moved since `rev`. */
  | { kind: 'unchanged'; rev: string; active: boolean }
  /** Something moved (or we had no baseline). */
  | { kind: 'changed'; rev: string; active: boolean }
  /** We asked too fast. Skip this tick; do NOT escalate to a full fetch. */
  | { kind: 'throttled' }
  /** No usable answer. Fall back to the pre-2026-09-02 behaviour. */
  | { kind: 'unavailable'; reason: string };

/** The shape of one revision response, already read off the wire. */
export interface RevPollResponse {
  status: number;
  /** Parsed JSON body (null for a 304 / empty body). */
  body: unknown;
  /** `ETag` response header, if present. */
  etag?: string | null;
}

function readRevBody(body: unknown): { rev: string; active: boolean } | null {
  if (!body || typeof body !== 'object') return null;
  const row = body as Record<string, unknown>;
  if (typeof row.rev !== 'string' || row.rev.length === 0) return null;
  return { rev: row.rev, active: row.active === true };
}

/**
 * Classify one revision poll.
 *
 * @param lastAppliedRev the revision in force when the player last applied a
 *   manifest, or `null` if it has never had one.
 */
export function classifyRevPoll(
  lastAppliedRev: string | null,
  res: RevPollResponse,
): RevPollOutcome {
  if (res.status === 304) {
    // A 304 only means anything relative to what we sent. If we had no
    // baseline we cannot have sent one, so this is not a confirmation of
    // anything — treat it as unusable rather than as "nothing changed".
    if (!lastAppliedRev) return { kind: 'unavailable', reason: 'not-modified-without-baseline' };
    const etag = typeof res.etag === 'string' ? res.etag : null;
    if (etag && etag !== lastAppliedRev) {
      // The server 304'd against a revision that is not the one we hold.
      // Trust the ETag over the status line and reconcile.
      return { kind: 'changed', rev: etag, active: false };
    }
    return { kind: 'unchanged', rev: lastAppliedRev, active: false };
  }

  if (res.status === 429) return { kind: 'throttled' };

  if (res.status !== 200) return { kind: 'unavailable', reason: `http-${res.status}` };

  const parsed = readRevBody(res.body);
  if (!parsed) return { kind: 'unavailable', reason: 'unparseable-body' };

  if (!lastAppliedRev || parsed.rev !== lastAppliedRev) {
    return { kind: 'changed', rev: parsed.rev, active: parsed.active };
  }
  return { kind: 'unchanged', rev: parsed.rev, active: parsed.active };
}

export interface RevActionInput {
  outcome: RevPollOutcome;
  /** An emergency is currently rendered on this screen. */
  emergencyOnGlass: boolean;
  /** The player's own local schedule-window signature moved since the apply. */
  windowEdge: boolean;
  /** Consecutive prior `throttled` outcomes, INCLUDING this one. */
  throttleStrikes: number;
}

export interface RevAction {
  /** Call `fetchContent()` (or `preemptReconcile()`) this tick. */
  fetch: boolean;
  /**
   * Use the emergency preempt lane — abort an in-flight NORMAL manifest
   * request so the gate's coalesced follow-up runs now (deep-audit F2),
   * exactly as the OVERRIDE / ALL_CLEAR handlers do.
   */
  preempt: boolean;
  /** Short, honest label for the `data-*` diagnostic and the console line. */
  reason: string;
}

/**
 * Decide what one revision tick does.
 *
 * PREEMPT RULE: a revision change while an alert is on glass, or while the
 * server reports one active, takes the preempt lane — that change is either
 * the all-clear for what is showing or an escalation of it, and it must not
 * queue behind a slow normal fetch. Everything else uses plain coalescing.
 */
export function decideRevAction(input: RevActionInput): RevAction {
  const { outcome, emergencyOnGlass, windowEdge, throttleStrikes } = input;

  if (outcome.kind === 'throttled') {
    if (throttleStrikes >= REV_THROTTLE_STRIKES) {
      return { fetch: true, preempt: emergencyOnGlass, reason: 'rev-throttled-repeatedly' };
    }
    // Self-inflicted: skip the tick. The manifest reconcile still runs.
    return { fetch: false, preempt: false, reason: 'rev-throttled' };
  }

  if (outcome.kind === 'unavailable') {
    // Pre-2026-09-02 behaviour, verbatim: full fetch at the current cadence.
    return { fetch: true, preempt: false, reason: `rev-unavailable:${outcome.reason}` };
  }

  if (outcome.kind === 'changed') {
    return {
      fetch: true,
      preempt: emergencyOnGlass || outcome.active,
      reason: 'rev-changed',
    };
  }

  // Unchanged. The only remaining reason to reconcile is something the
  // server cannot see: a schedule window that opened or closed under us.
  if (windowEdge) {
    return { fetch: true, preempt: false, reason: 'window-edge' };
  }
  return { fetch: false, preempt: false, reason: 'rev-unchanged' };
}

/**
 * Revision-poll cadence.
 *
 * `serverActive` is the server's last-known alert state for this screen. It
 * only ever RAISES the cadence — it can never be read as permission to slow
 * down or as grounds to clear anything (CLAUDE.md player rule 11: a cheaper
 * signal may raise an alert, never release one).
 */
export function revPollCadenceMs(state: {
  emergencyOnGlass: boolean;
  pushDegraded: boolean;
  serverActive: boolean;
}): number {
  return state.emergencyOnGlass || state.pushDegraded || state.serverActive
    ? REV_POLL_FAST_MS
    : REV_POLL_HEALTHY_MS;
}

/**
 * Manifest reconcile cadence. 60 s while the push channel is healthy — the
 * revision poll is what covers the gap — and 10 s while it is degraded,
 * which is FASTER than the 30 s this replaced.
 */
export function reconcileCadenceMs(state: { pushDegraded: boolean }): number {
  return state.pushDegraded ? RECONCILE_DEGRADED_MS : RECONCILE_HEALTHY_MS;
}

/** Path of the revision endpoint for one screen. */
export function emergencyRevPath(screenId: string): string {
  return `/api/v1/screens/${encodeURIComponent(screenId)}/emergency-rev`;
}
