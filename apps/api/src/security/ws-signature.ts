import * as crypto from 'crypto';

/**
 * Shared, pure WebSocket-message signature primitives.
 *
 * SINGLE SOURCE OF TRUTH for the canonical string + HMAC so the signer
 * (WebsocketSignerService) and every verifier (the Redis fan-out gate, tests)
 * can never drift. A one-byte disagreement here would either let forged
 * emergencies through or silently drop real ones — both unacceptable on a
 * life-safety path.
 *
 * The HMAC layer (this file) is the SERVER-SIDE gate: the API verifies it at
 * the Redis fan-out chokepoint before any message reaches a player, which
 * closes the "publish a forged message onto the Redis channel" attack. The
 * shared secret never leaves the server.
 *
 * Player-side Ed25519 device verification (ControlEnvelopeV2, EVT-001) is the
 * multi-week hardening and is NOT yet built — there is no `ws-ed25519.ts`.
 * The server-side HMAC gate in this file is the PRIMARY safeguard; the player
 * only smoke-tests for the presence of a `signature` field. Do not describe
 * an end-to-end asymmetric chain here until one actually ships (see
 * `packages/api-types/src/capability-registry.ts` →
 * `emergency-signed-fanout-gate`).
 */

export interface WsCanonicalFields {
  eventId: string;
  timestamp: number;
  type: string;
  payload: unknown;
}

/** The exact string both signer and verifier hash. Do not change casually. */
export function wsCanonicalString(m: WsCanonicalFields): string {
  return `${m.eventId}:${m.timestamp}:${m.type}:${JSON.stringify(m.payload)}`;
}

export function wsHmacHex(canonical: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

export type WsVerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Stateless HMAC verify: recompute, constant-time compare, freshness window.
 *
 * Deliberately has NO single-use replay nonce — this runs on EVERY API
 * replica that consumes the Redis fan-out, and a single-use nonce would make
 * only the first replica accept the message (the rest would drop it as a
 * "replay"), starving every player connected to the other replicas. Replay
 * within the freshness window is benign for OVERRIDE (re-asserts the same
 * active alert) and is additionally caught by the player's per-eventId dedup;
 * a replayed ALL_CLEAR is corrected within ~10s by the manifest-poll
 * reconciliation. The freshness window is intentionally generous so clock
 * skew / transport latency can NEVER drop a freshly-signed real emergency.
 */
export function verifyWsHmac(
  message: {
    eventId?: unknown;
    timestamp?: unknown;
    type?: unknown;
    payload?: unknown;
    signature?: unknown;
  } | null | undefined,
  secret: string,
  maxAgeMs = 120_000,
): WsVerifyResult {
  if (!message || typeof message !== 'object') return { ok: false, reason: 'no-message' };
  if (typeof message.signature !== 'string' || message.signature.length === 0)
    return { ok: false, reason: 'no-signature' };
  if (typeof message.eventId !== 'string' || message.eventId.length === 0)
    return { ok: false, reason: 'no-eventId' };
  if (typeof message.timestamp !== 'number' || !Number.isFinite(message.timestamp))
    return { ok: false, reason: 'no-timestamp' };
  if (typeof message.type !== 'string') return { ok: false, reason: 'no-type' };

  const age = Date.now() - message.timestamp;
  if (age > maxAgeMs) return { ok: false, reason: 'stale' };
  if (age < -maxAgeMs) return { ok: false, reason: 'future' }; // clock-skew guard

  const canonical = wsCanonicalString({
    eventId: message.eventId,
    timestamp: message.timestamp,
    type: message.type,
    payload: (message as { payload?: unknown }).payload,
  });
  const expected = wsHmacHex(canonical, secret);

  // Constant-time compare. Lengths must match first (timingSafeEqual throws on
  // length mismatch, which would itself leak timing).
  const expBuf = Buffer.from(expected, 'utf8');
  const actBuf = Buffer.from(message.signature, 'utf8');
  if (expBuf.length !== actBuf.length) return { ok: false, reason: 'bad-signature' };
  if (!crypto.timingSafeEqual(expBuf, actBuf)) return { ok: false, reason: 'bad-signature' };

  return { ok: true };
}
