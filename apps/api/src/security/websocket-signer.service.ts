import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { RedisService } from '../realtime/redis.service';
import { requireSecret } from './required-secret';

export interface WsMessagePayload {
  eventId: string;
  timestamp: number;
  type: string;
  payload: any;
  signature?: string;
}

/**
 * Signs + verifies WebSocket messages broadcast from the API to the player
 * fleet. Emergency triggers rely on this path — if verify() returns true
 * the player will render the payload, so correctness is load-bearing.
 *
 * sec-fix(wave1) #2: the HMAC key is now sourced via requireSecret() which
 * throws at boot in production if DEVICE_SECRET_KEY is unset — no more
 * silent fallback to a hard-coded default.
 *
 * sec-fix(wave1) #9: verifyMessage() previously accepted any signed
 * message whose timestamp was within 10s of now. That left a 10s replay
 * window — anyone who captured a signed emergency trigger could re-send
 * it during that window and refire the lockdown on the fleet. We now
 * enforce a per-eventId nonce in Redis (30s TTL), falling back to a
 * bounded in-process LRU seen-set when Redis is unavailable (fail
 * secure: duplicate eventIds are rejected regardless of redis health).
 */
@Injectable()
export class WebsocketSignerService {
  private readonly logger = new Logger(WebsocketSignerService.name);

  private readonly deviceSecret = requireSecret('DEVICE_SECRET_KEY', {
    devFallback: 'dev_only_device_secret_CHANGE_ME',
  });

  // Replay window: timestamps older than this are rejected outright.
  private static readonly REPLAY_WINDOW_MS = 10_000;
  // Nonce TTL in Redis: long enough to cover REPLAY_WINDOW_MS + clock skew.
  private static readonly NONCE_TTL_SEC = 30;

  // In-process LRU seen-set for when Redis is offline. Cap keeps memory
  // bounded under pathological retry storms.
  private static readonly LOCAL_SEEN_CAP = 10_000;
  private readonly localSeen = new Map<string, number>(); // eventId -> expiry ms

  constructor(private readonly redisService?: RedisService) {}

  public signMessage(type: string, payload: any): WsMessagePayload {
    const eventId = crypto.randomUUID();
    const timestamp = Date.now();

    const canonicalString = `${eventId}:${timestamp}:${type}:${JSON.stringify(payload)}`;

    const signature = crypto
      .createHmac('sha256', this.deviceSecret)
      .update(canonicalString)
      .digest('hex');

    return {
      eventId,
      timestamp,
      type,
      payload,
      signature,
    };
  }

  /**
   * Verify a message's signature + freshness + replay-uniqueness.
   * Async now because the nonce check may round-trip to Redis.
   */
  public async verifyMessage(message: WsMessagePayload): Promise<boolean> {
    if (!message.signature || !message.eventId) return false;

    const now = Date.now();
    if (now - message.timestamp > WebsocketSignerService.REPLAY_WINDOW_MS) {
      this.logger.warn(`Stale message detected from event ${message.eventId}`);
      return false;
    }

    const canonicalString = `${message.eventId}:${message.timestamp}:${message.type}:${JSON.stringify(message.payload)}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.deviceSecret)
      .update(canonicalString)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature);
    const actualBuf = Buffer.from(message.signature);
    if (expectedBuf.length !== actualBuf.length) return false;
    const sigOk = crypto.timingSafeEqual(expectedBuf, actualBuf);
    if (!sigOk) return false;

    // Signature is valid — now make sure this eventId hasn't been seen
    // inside the replay window.
    const fresh = await this.markNonce(message.eventId);
    if (!fresh) {
      this.logger.warn(`Replay detected for event ${message.eventId}`);
      return false;
    }
    return true;
  }

  /**
   * Atomically claim an eventId. Returns true if this is the first time
   * we've seen it within the window (caller should accept the message),
   * false if we've seen it before (caller MUST reject).
   *
   * Primary path: Redis SET NX EX. Fallback: in-process Map with capped
   * size — fails closed so duplicates are still rejected.
   */
  private async markNonce(eventId: string): Promise<boolean> {
    const key = `ws:nonce:${eventId}`;
    const pub = this.redisService?.publisher;
    if (pub) {
      try {
        // SET key "1" NX EX 30 — only sets if the key does not exist.
        const res = await pub.set(key, '1', 'EX', WebsocketSignerService.NONCE_TTL_SEC, 'NX');
        // ioredis returns 'OK' on set, null if NX failed (already existed).
        return res === 'OK';
      } catch (e) {
        this.logger.warn(`Redis nonce check failed (falling back to in-proc): ${(e as Error).message}`);
        // fall through to local path
      }
    }
    return this.markNonceLocal(eventId);
  }

  private markNonceLocal(eventId: string): boolean {
    const now = Date.now();
    // Lazy expiry sweep: every time we're about to add, drop anything
    // already past its TTL.
    if (this.localSeen.size >= WebsocketSignerService.LOCAL_SEEN_CAP / 2) {
      for (const [k, exp] of this.localSeen) {
        if (exp <= now) this.localSeen.delete(k);
      }
    }
    // Hard cap: if still too big, evict oldest insertion.
    if (this.localSeen.size >= WebsocketSignerService.LOCAL_SEEN_CAP) {
      const firstKey = this.localSeen.keys().next().value;
      if (firstKey !== undefined) this.localSeen.delete(firstKey);
    }
    const existing = this.localSeen.get(eventId);
    if (existing && existing > now) {
      return false; // replay
    }
    this.localSeen.set(eventId, now + WebsocketSignerService.NONCE_TTL_SEC * 1000);
    return true;
  }
}
