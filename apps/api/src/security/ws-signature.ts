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

/** Default freshness window for a signed fan-out envelope. */
export const WS_SIG_MAX_AGE_MS = 120_000;

/**
 * ROLLOUT FLAG — R-02 channel binding, backward-compatibility window.
 *
 * `true` = the verifier ALSO accepts the legacy channel-UNBOUND canonical
 * string. This MUST stay `true` until every running replica ships the
 * channel-binding signer: Railway does rolling deploys, so during a rollout
 * old replicas are still publishing unbound signatures while new replicas
 * are already verifying. Flipping this to `false` early would DROP real
 * emergency messages mid-rollout on a life-safety path.
 *
 * Flip to `false` in a FOLLOW-UP deploy, once the channel-binding build has
 * fully rolled out (no replica older than that build is serving traffic).
 * Nothing else has to change when it flips — the signer already emits the
 * bound form, and a NEW-form signature is already rejected on the wrong
 * channel regardless of this flag (the legacy fallback can only ever accept
 * an unbound signature, which by construction was never channel-scoped).
 */
export const ACCEPT_LEGACY_UNBOUND_WS_SIG = true;

export interface WsCanonicalFields {
  eventId: string;
  timestamp: number;
  type: string;
  payload: unknown;
  /**
   * Redis delivery channel the message is authorized for — `tenant:<id>` |
   * `group:<id>` | `device:<id>`. Binding it into the signed bytes is what
   * stops a captured tenant-A envelope from being replayed onto tenant B by
   * anything holding Redis PUBLISH (redis.service.ts takes the routing scope
   * entirely from the channel name). Omit for the LEGACY unbound form.
   */
  channel?: string;
}

/**
 * The exact string both signer and verifier hash. Do not change casually.
 *
 * With `channel` → the CHANNEL-BOUND form (current).
 * Without       → the LEGACY unbound form, kept byte-identical so the
 *                 rolling-deploy compat window above still verifies.
 */
export function wsCanonicalString(m: WsCanonicalFields): string {
  const base = `${m.eventId}:${m.timestamp}:${m.type}:${JSON.stringify(m.payload)}`;
  return m.channel === undefined ? base : `${m.channel}:${base}`;
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
 *
 * R-02 — CHANNEL BINDING. Pass the channel the message ACTUALLY arrived on.
 * The signature then has to cover that channel, so a captured tenant-A
 * envelope replayed onto `tenant:<B>` no longer verifies (the routing scope
 * is read straight off the untrusted channel name in redis.service.ts, so
 * without this the "compromised Redis" threat the gate documents was not
 * actually closed). During the rolling-deploy window the LEGACY unbound form
 * is still accepted — see ACCEPT_LEGACY_UNBOUND_WS_SIG.
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
  maxAgeMs = WS_SIG_MAX_AGE_MS,
  channel?: string,
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

  const fields = {
    eventId: message.eventId,
    timestamp: message.timestamp,
    type: message.type,
    payload: (message as { payload?: unknown }).payload,
  };

  // Current form first: signature must cover the delivery channel.
  if (channel !== undefined) {
    const bound = wsCanonicalString({ ...fields, channel });
    if (sigMatches(bound, secret, message.signature)) {
      return { ok: true };
    }
    // Rolling-deploy compat ONLY. An unbound signature is by construction
    // not channel-scoped, so this branch cannot weaken a NEW-form message:
    // a bound signature replayed on the wrong channel fails BOTH checks.
    if (!ACCEPT_LEGACY_UNBOUND_WS_SIG) {
      return { ok: false, reason: 'bad-signature' };
    }
  }

  if (sigMatches(wsCanonicalString(fields), secret, message.signature)) {
    return { ok: true };
  }
  return { ok: false, reason: 'bad-signature' };
}

/**
 * Constant-time signature compare. Lengths must match first (timingSafeEqual
 * throws on length mismatch, which would itself leak timing).
 */
function sigMatches(
  canonical: string,
  secret: string,
  actual: string,
): boolean {
  const expBuf = Buffer.from(wsHmacHex(canonical, secret), 'utf8');
  const actBuf = Buffer.from(actual, 'utf8');
  if (expBuf.length !== actBuf.length) return false;
  return crypto.timingSafeEqual(expBuf, actBuf);
}

/**
 * R-02 enforcement point — rebind an already-signed envelope to the Redis
 * channel it is about to be published on.
 *
 * WHY HERE and not at each `signMessage()` call site: ~25 controllers across
 * 10 modules sign then publish, and `RedisService.publish(channel, envelope)`
 * is the ONE place that knows both the envelope and its channel. Binding here
 * covers every publisher today with no cross-module change, and is idempotent
 * for a caller that already signed with the channel (`signMessage(type,
 * payload, channel)` recomputes the identical bytes).
 *
 * Trust-preserving by construction: the incoming envelope must ALREADY carry
 * a signature this secret verifies (legacy or bound) before we re-sign it.
 * Anything else — unsigned telemetry, a forged object, a test double — is
 * returned UNCHANGED, so this can never mint a signature for unsigned data.
 * Returning unchanged is also the fail-safe direction: a message we could not
 * rebind is exactly as deliverable as it is today.
 */
export function bindWsSignatureToChannel<T>(
  message: T,
  channel: string,
  secret: string,
  maxAgeMs = WS_SIG_MAX_AGE_MS,
): T {
  if (!message || typeof message !== 'object') return message;
  const env = message as {
    eventId?: unknown;
    timestamp?: unknown;
    type?: unknown;
    payload?: unknown;
    signature?: unknown;
  };
  if (!verifyWsHmac(env, secret, maxAgeMs, channel).ok) return message;
  const signature = wsHmacHex(
    wsCanonicalString({
      eventId: env.eventId as string,
      timestamp: env.timestamp as number,
      type: env.type as string,
      payload: env.payload,
      channel,
    }),
    secret,
  );
  return { ...(message as object), signature } as T;
}
