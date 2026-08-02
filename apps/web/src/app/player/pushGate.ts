/**
 * R-04 / R-05 (2026-08-01, security wave) — the SHARED client-side gate every
 * pushed life-safety message must clear, on EVERY transport.
 *
 * Historically only `ws.onmessage` enforced it. The SSE fallback consumer
 * implemented NONE of the three checks (its own comment admitted so), and an
 * on-path attacker can deterministically force screens onto SSE by killing the
 * WS upgrade three times (`wsFailCountRef >= 3 → tryOpenSse()`). They could
 * then replay one captured `ALL_CLEAR_MESSAGE` to keep a real SOS / broadcast
 * suppressed. The SSE stream carries the identical verified envelope the WS
 * does (`sse.service.ts` `broadcastToScope` writes the whole `parsed` message
 * that passed `verifyWsHmac`, i.e. `{ eventId, timestamp, type, payload,
 * signature }`), so the data for all three checks was already on the wire.
 *
 * The three checks (unchanged in substance from the WS implementation):
 *   1. SIGNATURE PRESENT — we can't verify the HMAC client-side (the secret
 *      stays on the server, by design), but its absence proves the message
 *      never passed through the signer.
 *   2. FRESHNESS — |server-corrected now − timestamp| ≤ 30s. The offset is
 *      learned from AUTH_OK because Android signage boxes routinely boot
 *      without NTP.
 *   3. REPLAY — per-eventId dedup in a bounded LRU. The caller passes ONE Map
 *      shared by both transports, so a frame seen on WS and replayed on SSE
 *      (or vice-versa) is caught.
 *
 * Pure module (no React / DOM / network) so it is unit-testable without
 * mounting the player page — same pattern as `emergencyReconcile.ts`.
 */

/**
 * Message types that carry life-safety weight and must clear the gate.
 *
 * `ALL_CLEAR` is deliberately ABSENT (see player-006): it only triggers a
 * manifest re-fetch, and the authenticated manifest is the sole arbiter of the
 * emergency overlay, so dropping a real ALL_CLEAR on a clock-skewed kiosk is
 * strictly worse than accepting a forged one. `ALL_CLEAR_MESSAGE` IS in the
 * set — it clears the pushed-message overlay directly, with no server
 * re-confirmation behind it.
 */
export const SENSITIVE_PUSH_TYPES: ReadonlySet<string> = new Set([
  'OVERRIDE',
  'TENANT_CHANGED',
  'SOS',
  'TEXT_BROADCAST',
  'MEDIA_ALERT',
  'ALL_CLEAR_MESSAGE',
]);

/** Loose client-side equivalent of the server's signing window. */
export const PUSH_FRESHNESS_WINDOW_MS = 30_000;
/** Hard cap on the replay LRU. */
export const PUSH_EVENT_ID_MAX = 500;
/** Entries older than this are swept when the LRU overflows. */
export const PUSH_EVENT_ID_TTL_MS = 5 * 60_000;

export interface PushEnvelope {
  type?: unknown;
  signature?: unknown;
  timestamp?: unknown;
  eventId?: unknown;
  payload?: unknown;
}

export interface PushGateContext {
  /** Shared across WS + SSE so a cross-transport replay is caught. */
  seenEventIds: Map<string, number>;
  /** "server − local" ms, learned at AUTH_OK. Added to local now. */
  serverClockOffsetMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export type PushGateVerdict =
  | { accepted: true }
  | { accepted: false; reason: 'unsigned' | 'stale' | 'replay' };

/**
 * @param msg          the signed envelope as it came off the wire
 * @param ctx          shared replay LRU + clock offset
 * @param transportType the transport's own idea of the event type (the SSE
 *        `event:` name). Checked ALONGSIDE `msg.type` so an attacker can't
 *        route a sensitive event under a non-sensitive self-declared type.
 */
export function checkSensitivePush(
  msg: PushEnvelope | null | undefined,
  ctx: PushGateContext,
  transportType?: string,
): PushGateVerdict {
  const declaredType = typeof msg?.type === 'string' ? msg.type : undefined;
  const sensitive =
    (declaredType != null && SENSITIVE_PUSH_TYPES.has(declaredType)) ||
    (transportType != null && SENSITIVE_PUSH_TYPES.has(transportType));
  if (!sensitive) return { accepted: true };
  if (!msg || typeof msg !== 'object') return { accepted: false, reason: 'unsigned' };

  // 1. Signature must be present (server-side HMAC verify already happened at
  //    the Redis fan-out gate; this catches anything that bypassed it).
  if (typeof msg.signature !== 'string' || msg.signature.length === 0) {
    return { accepted: false, reason: 'unsigned' };
  }

  // 2. Freshness, against the server-corrected clock.
  const nowFn = ctx.now ?? Date.now;
  const adjustedNow = nowFn() + ctx.serverClockOffsetMs;
  if (
    typeof msg.timestamp !== 'number' ||
    !Number.isFinite(msg.timestamp) ||
    Math.abs(adjustedNow - msg.timestamp) > PUSH_FRESHNESS_WINDOW_MS
  ) {
    return { accepted: false, reason: 'stale' };
  }

  // 3. Replay, in the LRU shared by every transport.
  if (typeof msg.eventId === 'string' && msg.eventId.length > 0) {
    const seen = ctx.seenEventIds;
    if (seen.has(msg.eventId)) return { accepted: false, reason: 'replay' };
    seen.set(msg.eventId, nowFn());
    if (seen.size > PUSH_EVENT_ID_MAX) {
      const cutoff = nowFn() - PUSH_EVENT_ID_TTL_MS;
      for (const [k, t] of seen) if (t < cutoff) seen.delete(k);
      while (seen.size > PUSH_EVENT_ID_MAX) {
        seen.delete(seen.keys().next().value as string);
      }
    }
  }

  return { accepted: true };
}

/**
 * R-05 (consumer half) — TENANT_CHANGED de-provisions the device: it wipes the
 * device token, the fingerprint, the manifest + emergency caches, tells the SW
 * to CLEAR_CACHE all tiers, calls the native unpair, and drops to 'registering'.
 * Recovery needs a human at the kiosk.
 *
 * The player used to run all of that WITHOUT reading `payload.screenId`, even
 * though the server signs one — so a single frame de-provisioned every screen
 * that received it. Require an exact match against this screen's own id, and
 * fail CLOSED (a missing/unknown screenId is ignored, not obeyed).
 *
 * The server half — publishing this on the per-device channel rather than
 * tenant-wide — is fixed separately; either half alone leaves the hazard.
 */
export function isTenantChangeForThisScreen(
  msg: { payload?: unknown } | null | undefined,
  screenId: string | null | undefined,
): boolean {
  if (!screenId) return false;
  const payload = msg?.payload;
  if (!payload || typeof payload !== 'object') return false;
  const target = (payload as { screenId?: unknown }).screenId;
  return typeof target === 'string' && target === screenId;
}
