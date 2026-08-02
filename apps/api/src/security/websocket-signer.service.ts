import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { requireSecret } from './required-secret';
import { wsCanonicalString, wsHmacHex } from './ws-signature';

export interface WsMessagePayload {
  eventId: string;
  timestamp: number;
  type: string;
  payload: any;
  signature?: string;
}

/**
 * SIGNER for WebSocket messages broadcast from the API to the player fleet.
 * Every emergency-class message (OVERRIDE / ALL_CLEAR / TENANT_CHANGED /
 * SOS / TEXT_BROADCAST / MEDIA_ALERT) goes through `signMessage()` before
 * publishing to Redis.
 *
 * sec-fix(wave1) #2: HMAC key sourced via requireSecret() which throws at
 * boot in production if DEVICE_SECRET_KEY is unset — no silent fallback
 * to a hard-coded default.
 *
 * 2026-05-26 audit P0-6 — verification design clarification:
 *
 *   This class no longer carries a `verifyMessage()` method. It previously
 *   had one with a per-eventId nonce check (Redis SETNX + local LRU
 *   fallback), but it had ZERO production callers — every audit that
 *   surfaced it (including 2026-05-21 "AUDITS ARE EXHAUSTIVE OR
 *   WORTHLESS" and 2026-05-26 P0-6) flagged it as audit theater. It also
 *   could NOT be wired into the actual fan-out gate because of the
 *   multi-replica replay-vs-broadcast tradeoff documented in
 *   apps/api/src/security/ws-signature.ts (a single-use nonce would
 *   starve every replica's connected players except the first to claim
 *   it).
 *
 *   The REAL defense-in-depth on the broadcast path is:
 *
 *     1. SERVER GATE (stateless, multi-replica safe) —
 *        apps/api/src/realtime/redis.service.ts:137 calls
 *        verifyWsHmac() at every replica's pmessage subscriber.
 *        Forged Redis publishes (no valid HMAC) are dropped here
 *        before reaching the WS gateway or SSE controller.
 *
 *     2. PLAYER DEDUP (per-eventId) —
 *        apps/web/src/app/player/page.tsx:3465 maintains a bounded
 *        Set of seen eventIds for SENSITIVE_TYPES messages. A
 *        signed-and-replayed message that slips past the server's
 *        freshness window is dropped client-side.
 *
 *   Together: forgery is blocked server-side, replay is blocked
 *   client-side, and every replica still delivers every legit message
 *   to its connected players. Removing verifyMessage closes the
 *   audit-theater pattern (callers who think a safeguard exists when
 *   it doesn't).
 */
@Injectable()
export class WebsocketSignerService {
  private readonly deviceSecret = requireSecret('DEVICE_SECRET_KEY', {
    devFallback: 'dev_only_device_secret_CHANGE_ME',
  });

  /**
   * @param channel OPTIONAL Redis delivery channel (`tenant:<id>` |
   *   `group:<id>` | `device:<id>`). When supplied the signature is bound to
   *   that channel, so the envelope cannot be replayed onto another tenant's
   *   channel by anything holding Redis PUBLISH (R-02).
   *
   *   Callers that publish via `RedisService.publish()` do NOT need to pass
   *   it: publish() rebinds every valid envelope to its actual channel at the
   *   send boundary (`bindWsSignatureToChannel`), which is idempotent with
   *   signing it here. Pass it when you sign for a channel you already know
   *   and want the bound bytes at mint time.
   */
  public signMessage(type: string, payload: any, channel?: string): WsMessagePayload {
    const eventId = crypto.randomUUID();
    const timestamp = Date.now();

    const signature = wsHmacHex(
      wsCanonicalString({ eventId, timestamp, type, payload, channel }),
      this.deviceSecret,
    );

    return {
      eventId,
      timestamp,
      type,
      payload,
      signature,
    };
  }
}
