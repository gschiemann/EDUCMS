import { Injectable, OnModuleDestroy, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { Redis } from 'ioredis';
import { createHash } from 'crypto';
import { requireSecret } from '../security/required-secret';
import { bindWsSignatureToChannel, verifyWsHmac } from '../security/ws-signature';
import { PrismaService } from '../prisma/prisma.service';

// ───────────────────────────────────────────────────────────────────
// Durable revocation backstop (2026-07-10 — external-audit fix).
//
// Redis is the PRIMARY revocation store (hot path, no DB reads while
// Redis answers). Every revocation write is ALSO mirrored to the
// Postgres `revoked_credentials` table so a previously-revoked
// credential stays revoked while Redis is degraded or down — the
// pre-fix behavior was fail-OPEN (`sismember` returned false on any
// Redis failure), letting revoked tokens back in for the duration of
// a Redis outage. Only if BOTH Redis and Postgres are unreachable does
// each check keep its pre-fix total-outage behavior (see the fallback
// semantics on each method), logged loudly once.
// ───────────────────────────────────────────────────────────────────

/** Postgres mirror row kinds (RevokedCredential.kind). */
export const REVOKED_KIND_JTI = 'jti';
export const REVOKED_KIND_USER_INVALID_BEFORE = 'user_invalid_before';

/**
 * The Postgres mirror stores a sha256 of the bearer token, never the
 * raw token — a DB dump must not contain live credentials. (Redis keeps
 * the raw token in `jwt_revoked_list`, unchanged — existing behavior.)
 */
export function hashRevokedToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 30 days — the rememberMe ceiling; matches the Redis TTLs. */
const REVOKED_MIRROR_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The ONLY channel families the fan-out subscriber listens on (see the
 * psubscribe in onModuleInit) and therefore the only ones that may reach
 * `gateway.broadcastToScope` / `sse.broadcastToScope`.
 */
const WS_SCOPE_CHANNEL_TYPES = new Set(['tenant', 'group', 'device']);

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public publisher: Redis | null = null;
  public subscriber: Redis | null = null;
  private gateway: any;
  private connected = false;

  // In-memory TTL cache for the Redis-DOWN fallback path only (never
  // consulted while Redis answers), so a sustained Redis outage doesn't
  // hammer Postgres on every request. Positive AND negative results are
  // cached. Per-replica + 30s TTL = bounded staleness: a revocation
  // written DURING an outage is enforced within 30s on every replica
  // (immediately on the replica that wrote it — writes invalidate).
  private static readonly FALLBACK_CACHE_TTL_MS = 30_000;
  private static readonly FALLBACK_CACHE_MAX = 5_000;
  private readonly revocationFallbackCache = new Map<
    string,
    { value: boolean | number | null; expiresAt: number }
  >();
  // One-shot loud warning for the both-stores-down state (per process).
  private warnedRevocationTotalOutage = false;
  // Opportunistic prune of expired mirror rows — at most once/hour per
  // process, piggybacked on the (rare) mirror writes. No cron needed.
  private lastMirrorPruneAt = 0;

  // Same key + dev-fallback the signer uses, so HMAC verify matches signing
  // byte-for-byte. This is the SERVER-SIDE emergency gate: every message
  // consumed off the Redis fan-out is verified before it reaches any player,
  // so a forged message published onto a scope channel is dropped here and
  // never renders. Stateless verify (no single-use nonce) → multi-replica safe.
  private readonly deviceSecret = requireSecret('DEVICE_SECRET_KEY', {
    devFallback: 'dev_only_device_secret_CHANGE_ME',
  });

  // @Optional so test contexts that `new RedisService()` directly (and
  // module setups without PrismaModule) still construct fine. In the
  // real app PrismaModule is @Global, so this is always injected. When
  // absent, every durable-mirror path degrades to the pre-fix behavior.
  constructor(@Optional() private readonly prismaService?: PrismaService) {
    // Skip Redis entirely when explicitly disabled OR when no URL is set in production.
    // Railway deploys without a Redis plugin should boot cleanly and fall through
    // to HTTP-polling realtime — we do NOT want a missing REDIS_URL to crash the API.
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl || process.env.REDIS_DISABLED === 'true') {
      this.logger.warn(
        `Redis disabled (REDIS_URL ${redisUrl ? 'present but REDIS_DISABLED=true' : 'not set'}) — running with HTTP-polling realtime fallback`,
      );
      return;
    }

    try {
      const baseOpts = {
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
        enableOfflineQueue: false,
        lazyConnect: true,
        retryStrategy: (times: number) => {
          if (times > 3) {
            this.logger.warn('Redis unavailable — running without realtime features');
            return null; // Stop retrying
          }
          return Math.min(times * 200, 2000);
        },
        reconnectOnError: () => false,
      };
      this.publisher = new Redis(redisUrl, baseOpts);
      this.subscriber = new Redis(redisUrl, baseOpts);

      // Swallow error events — ioredis emits 'error' on every reconnect attempt,
      // and an unhandled 'error' event crashes the Node process.
      this.publisher.on('error', (err) => {
        this.logger.debug(`Redis publisher error (non-fatal): ${err.message}`);
      });
      this.subscriber.on('error', (err) => {
        this.logger.debug(`Redis subscriber error (non-fatal): ${err.message}`);
      });
    } catch (e) {
      this.logger.warn('Redis client creation failed — running without realtime features');
      this.publisher = null;
      this.subscriber = null;
    }
  }

  setGateway(gateway: any) {
    this.gateway = gateway;
  }

  /**
   * Is the Redis fan-out actually up?
   *
   * ADDED 2026-08-13 (display-control review, P1). `publish()` does NOT throw
   * when Redis is down — it takes the `else` branch and hands the envelope to
   * THIS replica's local gateway. That fallback is correct (CLAUDE.md:
   * "Redis missing → API boots anyway"), but it means a caller that infers
   * delivery from "publish did not throw" reports success for a message that
   * never left this process. On >1 replica, a screen socketed to the other
   * replica gets nothing — and for an immediate display action there is no
   * manifest backstop to catch it, so a dark screen stays dark while the
   * audit row says "dispatched".
   *
   * Read-only, synchronous, never throws. Callers use it to report delivery
   * HONESTLY; nobody should gate a publish on it (the local fallback is
   * still better than dropping the message).
   */
  isConnected(): boolean {
    return this.connected === true && !!this.publisher;
  }

  async onModuleInit() {
    if (!this.publisher || !this.subscriber) return;

    // Absolute wall-clock cap on Redis bring-up. Boot must never hang
    // on Redis — we'd rather ship realtime over HTTP polling than
    // fail Railway's healthcheck window because ioredis is retrying.
    const hardCap = new Promise<void>((resolve) => setTimeout(resolve, 7000));

    const bringUp = (async () => {
      try {
        await this.publisher!.connect();
        await this.subscriber!.connect();
        this.connected = true;
        this.logger.log('Redis connected successfully');

        this.subscriber!.on('message', this.handleRedisMessage.bind(this));
        await this.subscriber!.psubscribe('tenant:*', 'group:*', 'device:*');

        this.subscriber!.on('pmessage', (_pattern, channel, message) => {
          this.handleRedisMessage(channel, message);
        });
      } catch (e) {
        this.logger.warn('Redis connection failed — running without realtime features');
        this.connected = false;
      }
    })();

    await Promise.race([bringUp, hardCap]);
    if (!this.connected) {
      this.logger.warn('Redis did not come up within 7s — proceeding with HTTP-polling fallback');
    }
  }

  async onModuleDestroy() {
    try {
      if (this.publisher) await this.publisher.quit();
      if (this.subscriber) await this.subscriber.quit();
    } catch { /* ignore cleanup errors */ }
  }

  // Phase B SSE — secondary realtime fan-out. RedisService stays the
  // single subscriber, but each pmessage is broadcast to BOTH the WS
  // gateway AND any SSE clients. Optional — code paths that haven't
  // wired SseService through DI just skip the SSE fan.
  private sse: { broadcastToScope: (type: string, id: string, payload: any) => void } | null = null;
  setSseService(sse: { broadcastToScope: (type: string, id: string, payload: any) => void }) {
    this.sse = sse;
  }

  private handleRedisMessage(channel: string, message: string) {
    try {
      const parsed = JSON.parse(message);
      const channelParts = channel.split(':');
      // HARDENING (R-02 follow-on): scope channels are EXACTLY two segments.
      // `split(':')` + destructure used to accept `tenant:<A>:anything` and
      // route it as scope `tenant:<A>` — so a channel that merely PREFIXES a
      // real tenant (e.g. the gateway's own `tenant:<id>:devices` set key)
      // would have fanned out to that whole tenant. Every publisher in the
      // codebase emits exactly `tenant:<id>` | `group:<id>` | `device:<id>`
      // (verified by sweeping every `.publish(` call site), so this rejects
      // only malformed/injected channels.
      if (channelParts.length !== 2) {
        this.logger.warn(`[WS] DROPPED message on malformed channel ${channel}`);
        return;
      }
      const [type, id] = channelParts;
      if (!WS_SCOPE_CHANNEL_TYPES.has(type)) {
        // Not a deliverable scope channel — e.g. the unsigned `metrics:ack`
        // telemetry channel, which the Redis-DOWN fallback in publish() loops
        // back through here. It was always dropped by the HMAC gate below,
        // but at WARN — one line per ACK from every kiosk, i.e. a
        // device-controlled log flood while Redis is down (R-07). Drop it
        // here, at debug, before the gate.
        this.logger.debug(`[WS] Ignoring non-scope channel ${channel}`);
        return;
      }

      // SERVER-SIDE EMERGENCY GATE (life-safety): verify the HMAC signature
      // + freshness BEFORE fanning out to any player. Every legitimate
      // publisher to tenant:* / group:* / device:* signs via
      // WebsocketSignerService.signMessage; anything that fails verification
      // was injected onto the channel by something other than our authorized
      // controllers (e.g. a compromised Redis) and must never reach a screen.
      // Stateless verify → safe across replicas. Real emergencies are still
      // guaranteed by the player's authenticated HTTPS poll backstop even if
      // a message is ever dropped here.
      //
      // R-02: verify against the channel the message ACTUALLY arrived on.
      // The routing scope below (`type`/`id`) is read straight off this
      // untrusted channel name, so without binding it into the signed bytes
      // a captured tenant-A envelope replayed onto `tenant:<B>` verified
      // byte-for-byte — defeating the very "compromised Redis" threat this
      // gate exists for.
      const verdict = verifyWsHmac(parsed, this.deviceSecret, undefined, channel);
      if (!verdict.ok) {
        this.logger.warn(
          `[WS] DROPPED unverified message on ${channel} ` +
            `(reason=${verdict.reason}, msgType=${(parsed && parsed.type) || 'unknown'})`,
        );
        return;
      }

      // Fan to BOTH transports. Either may be unset (e.g. WS gateway
      // not yet wired, or SSE service not present in test env).
      if (this.gateway) this.gateway.broadcastToScope(type, id, parsed);
      if (this.sse) this.sse.broadcastToScope(type, id, parsed);
    } catch (e) {
      this.logger.error(`Failed to parse redis message on channel ${channel}:`, e);
    }
  }

  async publish(channel: string, payload: any) {
    // R-02 ENFORCEMENT POINT. This is the one place that knows both the
    // signed envelope AND the channel it is authorized for, so bind them
    // together here — every publisher in the app gets channel-scoped
    // signatures with no change at its call site. Envelopes that don't
    // already carry a valid signature (unsigned telemetry, test doubles) pass
    // through untouched; this never mints a signature for unsigned data.
    const framed = bindWsSignatureToChannel(payload, channel, this.deviceSecret);
    if (this.connected && this.publisher) {
      await this.publisher.publish(channel, JSON.stringify(framed));
    } else {
      // Fallback: If Redis is unavailable (local dev), pipe directly to the resident websocket gateway
      if (this.gateway) {
        this.logger.debug(`[Mock Redis] Publishing to channel ${channel}`);
        this.handleRedisMessage(channel, JSON.stringify(framed));
      }
    }
  }

  /**
   * Add a member to a Redis set — the WRITE half of the revocation check
   * `sismember` performs (2026-08-03).
   *
   * THE BUG THIS CLOSES. `RedisService` exposed `sismember` but no `sadd`,
   * so `revokeScreenCredentials()` (screens/device-credentials.ts) called
   * `redis.sadd?.(…)` against a method that did not exist. Optional chaining
   * made that a silent no-op: the durable Postgres mirror was written, the
   * `credentialEpoch` was bumped, but the HOT set every request checks first
   * was never populated. The revocation still held — the epoch is the real
   * control and the mirror is consulted whenever Redis is down — but the
   * cheap tier that keeps revocation affordable at fleet scale was dead.
   *
   * FAIL-SAFE CONTRACT (do not weaken):
   *   • NEVER throws. A Redis outage must not be able to fail a revocation,
   *     and this is called from `revokeScreenCredentials`, which is on the
   *     unpair/re-pair path a live kiosk walks at boot.
   *   • Returns whether the member actually landed in Redis, so a caller can
   *     record the degraded state — but no caller may treat `false` as "the
   *     revocation failed". Postgres (`revoked_credentials`, written by
   *     `mirrorRevokedTokenDurable`) plus `Screen.credentialEpoch` remain
   *     authoritative, and `sismember` already falls back to the mirror.
   *
   * TTL. `jwt_revoked_list` is one shared set, so its TTL is per-KEY, not
   * per-member. A device token outlives a user session by 6×, so the TTL is
   * only ever EXTENDED here, never shortened — otherwise revoking a device
   * would quietly shorten the window protecting every user token in the set
   * (and vice versa).
   *
   * 2026-08-03 — the last hole is CLOSED: `auth.controller.ts` logout used to
   * call `publisher.expire('jwt_revoked_list', 30d)` on the raw client, which
   * could shorten a window this method had extended (re-validating a revoked
   * 180-day device token). Logout now routes through here, so this is the ONE
   * writer of that key's expiry. Do not add another — grep for
   * `expire('jwt_revoked_list'` before touching any revocation path.
   */
  async sadd(
    key: string,
    member: string,
    opts?: { ttlSeconds?: number },
  ): Promise<boolean> {
    if (!this.connected || !this.publisher) {
      this.logger.warn(
        `Redis unavailable — '${key}' set write skipped; the durable Postgres mirror ` +
          'and the credential epoch remain authoritative',
      );
      return false;
    }
    try {
      await this.publisher.sadd(key, member);
    } catch (e) {
      this.logger.warn(
        `Redis set write failed for '${key}' (${e instanceof Error ? e.message : e}) — ` +
          'durable mirror remains authoritative',
      );
      return false;
    }
    // Extend-only TTL. Best-effort and separately guarded: the member is
    // already in the set at this point, and failing to lengthen an expiry is
    // not a reason to report the write as lost.
    const ttl = opts?.ttlSeconds;
    if (ttl && Number.isFinite(ttl) && ttl > 0) {
      try {
        const current = await this.publisher.ttl(key);
        // -1 = no expiry (already stronger than anything we'd set)
        // -2 = key missing (raced with an eviction — nothing to extend)
        if (current >= 0 && current < ttl) {
          await this.publisher.expire(key, Math.ceil(ttl));
        }
      } catch {
        /* TTL extension is best-effort; the member is already stored */
      }
    }
    return true;
  }

  /**
   * Check if a value is a member of a Redis set.
   * Used by JwtAuthGuard / SSE / WS gateway for token revocation checks.
   *
   * Fallback semantics (2026-07-10 durable-revocation fix):
   * - Redis up            → Redis answer, byte-identical to before, NO DB read.
   * - Redis down/erroring → for `jwt_revoked_list` only: Postgres
   *   `revoked_credentials` lookup (30s in-memory cached) instead of the
   *   old blanket `false`.
   * - Redis AND Postgres down → false (pre-fix fail-open preserved —
   *   never lock every request out on a total infra outage), with a
   *   one-shot loud warn.
   */
  async sismember(key: string, member: string): Promise<boolean> {
    if (this.connected && this.publisher) {
      try {
        const result = await this.publisher.sismember(key, member);
        return result === 1;
      } catch {
        // Redis answered with an error — fall through to the durable store.
      }
    } else {
      this.logger.warn('Redis unavailable — token revocation check falling back to durable store');
    }
    // Durable fallback exists only for the token-revocation set. Any
    // other set keeps the legacy fail-open false (no mirror to consult).
    if (key !== 'jwt_revoked_list') return false;
    return this.isTokenRevokedInDurableStore(member);
  }

  /**
   * Postgres side of the single-token revocation check (Redis-down path
   * only). Never throws: a Postgres failure here is the both-stores-down
   * state — preserve the pre-fix fail-open `false` and warn once.
   */
  private async isTokenRevokedInDurableStore(token: string): Promise<boolean> {
    const cacheKey = `${REVOKED_KIND_JTI}:${hashRevokedToken(token)}`;
    const cached = this.fallbackCacheGet(cacheKey);
    if (cached !== undefined) return cached.value === true;
    if (!this.prismaService) {
      this.warnRevocationTotalOutage('no Prisma service wired');
      return false;
    }
    try {
      const row = await this.prismaService.client.revokedCredential.findUnique({
        where: { kind_key: { kind: REVOKED_KIND_JTI, key: hashRevokedToken(token) } },
      });
      // An expired mirror row is inert — the JWT itself has expired.
      const revoked = !!row && (row.expiresAt == null || row.expiresAt.getTime() > Date.now());
      this.fallbackCacheSet(cacheKey, revoked);
      return revoked;
    } catch (e) {
      this.warnRevocationTotalOutage(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Per-user token invalidation (P1-1, 2026-05-28)
  //
  // Individual user JWTs carry no `jti`, and a user can hold several
  // live tokens at once (multiple devices / browsers, rememberMe up to
  // 30 days). Adding "the token" to `jwt_revoked_list` (the logout path)
  // can only burn the ONE token presented at logout. To revoke EVERY
  // outstanding token for a user the moment their privileges are
  // tightened (role downgrade / canTriggerPanic→false), we store a
  // per-user "invalid-before" epoch; the guard rejects any token whose
  // `iat` predates it. One key, all sessions, no jti needed.
  //
  // Redis is the PRIMARY store (same tradeoff as jwt_revoked_list — see
  // auth.controller.ts logout); since 2026-07-10 every write is ALSO
  // mirrored to Postgres `revoked_credentials` so the marker survives a
  // Redis outage. The guard still fails CLOSED when Redis errors AND the
  // Postgres mirror can't answer either.
  // ───────────────────────────────────────────────────────────────────

  /** Redis key holding the per-user "all tokens issued before this epoch are invalid" marker. */
  private tokenInvalidBeforeKey(userId: string): string {
    return `jwt_invalid_before:${userId}`;
  }

  /**
   * Mark every token currently held by `userId` as invalid: any JWT
   * whose `iat` is < the stored epoch is rejected by JwtAuthGuard.
   * Called on a privilege TIGHTENING (role downgrade, canTriggerPanic
   * set false). TTL = 30d, the rememberMe ceiling — after that any
   * affected token has expired on its own, so the marker can lapse.
   *
   * Throws on Redis failure so the caller can surface that the
   * revocation did not take (the writer treats it as a hard error, the
   * same way `auth.controller` logout 503s when Redis is down rather
   * than pretending the session was burned).
   */
  async markUserTokensInvalid(userId: string, atEpochSeconds?: number): Promise<void> {
    // +1s so a token minted in the SAME second as the revocation (its
    // `iat` floors to whole seconds) is still caught: iat < epoch.
    const epoch = (atEpochSeconds ?? Math.floor(Date.now() / 1000)) + 1;

    // Durable mirror FIRST (best-effort, never throws): if Redis is down
    // this row is exactly what keeps the revocation enforced (the guard
    // falls back to Postgres), so it must land even when the Redis write
    // below throws. The method's external contract is unchanged — it
    // still throws on Redis failure so callers surface it.
    await this.mirrorUserInvalidBeforeDurable(userId, epoch);

    if (!this.publisher) {
      throw new Error('Redis unavailable — cannot revoke user tokens');
    }
    const key = this.tokenInvalidBeforeKey(userId);
    // Monotonic: never move the marker backwards if two tightenings race
    // (or this runs on multiple replicas) — keep the latest cutoff.
    const existing = await this.publisher.get(key);
    const next = existing ? Math.max(parseInt(existing, 10) || 0, epoch) : epoch;
    await this.publisher.set(key, String(next), 'EX', 60 * 60 * 24 * 30);
  }

  /**
   * Postgres mirror of the per-user invalid-before marker. Best-effort:
   * logs at warn on failure, never throws (a DB hiccup must not fail the
   * privilege-tightening flow — Redis remains the primary store).
   * Monotonic via read-then-max, the same accepted race tradeoff as the
   * Redis GET/SET pair above.
   */
  private async mirrorUserInvalidBeforeDurable(userId: string, epoch: number): Promise<void> {
    if (!this.prismaService) return;
    try {
      const where = { kind_key: { kind: REVOKED_KIND_USER_INVALID_BEFORE, key: userId } };
      const existing = await this.prismaService.client.revokedCredential.findUnique({ where });
      const prev = existing?.value ? parseInt(existing.value, 10) : NaN;
      const next = Number.isFinite(prev) ? Math.max(prev, epoch) : epoch;
      const expiresAt = new Date(Date.now() + REVOKED_MIRROR_TTL_MS);
      await this.prismaService.client.revokedCredential.upsert({
        where,
        create: {
          kind: REVOKED_KIND_USER_INVALID_BEFORE,
          key: userId,
          value: String(next),
          expiresAt,
        },
        update: { value: String(next), expiresAt },
      });
      // Fresh marker must be visible to this replica's fallback reads
      // immediately, not after the 30s cache TTL.
      this.revocationFallbackCache.delete(`${REVOKED_KIND_USER_INVALID_BEFORE}:${userId}`);
      this.pruneExpiredMirrorRows();
    } catch (e) {
      this.logger.warn(
        `Durable revocation mirror write failed for user ${userId}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /**
   * Postgres mirror of a single revoked bearer token (`jwt_revoked_list`
   * SADD in auth.controller logout). Best-effort: logs at warn on
   * failure, never throws — the logout flow decides success/failure on
   * the Redis write, exactly as before. Stores sha256(token), never the
   * raw token; expiry mirrors the JWT's own `exp` claim when decodable
   * (falling back to the 30d rememberMe ceiling).
   */
  async mirrorRevokedTokenDurable(token: string): Promise<void> {
    if (!this.prismaService) return;
    try {
      let expiresAt = new Date(Date.now() + REVOKED_MIRROR_TTL_MS);
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        if (typeof payload?.exp === 'number' && Number.isFinite(payload.exp)) {
          expiresAt = new Date(payload.exp * 1000);
        }
      } catch {
        /* not a decodable JWT — keep the 30d ceiling */
      }
      const tokenHash = hashRevokedToken(token);
      const where = { kind_key: { kind: REVOKED_KIND_JTI, key: tokenHash } };
      await this.prismaService.client.revokedCredential.upsert({
        where,
        create: { kind: REVOKED_KIND_JTI, key: tokenHash, expiresAt },
        update: { expiresAt },
      });
      // Same-replica fallback reads must see the revocation immediately.
      this.revocationFallbackCache.delete(`${REVOKED_KIND_JTI}:${tokenHash}`);
      this.pruneExpiredMirrorRows();
    } catch (e) {
      this.logger.warn(
        `Durable revocation mirror write failed for token: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /**
   * Opportunistic cleanup: expired mirror rows are inert (the JWT itself
   * has expired), but without pruning they'd accumulate forever. Fired
   * fire-and-forget from the mirror writes, gated to once/hour per
   * process, best-effort — a failure only defers cleanup.
   */
  private pruneExpiredMirrorRows(): void {
    if (!this.prismaService) return;
    const now = Date.now();
    if (now - this.lastMirrorPruneAt < 60 * 60 * 1000) return;
    this.lastMirrorPruneAt = now;
    this.prismaService.client.revokedCredential
      .deleteMany({ where: { expiresAt: { lt: new Date(now) } } })
      .then((res) => {
        if (res.count > 0) this.logger.log(`Pruned ${res.count} expired revocation mirror rows`);
      })
      .catch((e) => {
        this.logger.warn(
          `Expired revocation mirror prune failed (deferred): ${e instanceof Error ? e.message : e}`,
        );
      });
  }

  /**
   * Return the per-user "invalid-before" epoch (seconds) or null if no
   * marker is set. Used by JwtAuthGuard to reject pre-revocation tokens.
   *
   * Fallback semantics (2026-07-10 durable-revocation fix):
   * - Redis up               → Redis answer, byte-identical to before,
   *   NO DB read.
   * - Redis configured but erroring → Postgres mirror lookup (30s
   *   cached). If Postgres ALSO fails, rethrow the ORIGINAL Redis error
   *   — preserving the pre-fix contract where the guard's catch fails
   *   CLOSED (deny-and-retry) on this path.
   * - No Redis configured (publisher null, dev / Redis-less deploy) →
   *   Postgres mirror lookup (previously an unconditional null — the
   *   mirror is strictly safer); if Postgres fails too, the pre-fix
   *   fail-open null is preserved (don't brick every request in dev),
   *   with a one-shot loud warn.
   */
  async getTokenInvalidBefore(userId: string): Promise<number | null> {
    if (this.publisher) {
      try {
        const raw = await this.publisher.get(this.tokenInvalidBeforeKey(userId));
        if (raw == null) return null;
        const n = parseInt(raw, 10);
        return Number.isFinite(n) ? n : null;
      } catch (redisError) {
        try {
          return await this.getInvalidBeforeFromDurableStore(userId);
        } catch (dbError) {
          this.warnRevocationTotalOutage(dbError instanceof Error ? dbError.message : String(dbError));
          throw redisError; // guard keeps failing CLOSED, as before
        }
      }
    }
    try {
      return await this.getInvalidBeforeFromDurableStore(userId);
    } catch (dbError) {
      this.warnRevocationTotalOutage(dbError instanceof Error ? dbError.message : String(dbError));
      return null; // pre-fix behavior for a Redis-less deploy
    }
  }

  /**
   * Postgres side of the invalid-before lookup (Redis-down path only).
   * THROWS on DB failure — each caller above decides between the
   * fail-closed rethrow and the fail-open null.
   */
  private async getInvalidBeforeFromDurableStore(userId: string): Promise<number | null> {
    const cacheKey = `${REVOKED_KIND_USER_INVALID_BEFORE}:${userId}`;
    const cached = this.fallbackCacheGet(cacheKey);
    if (cached !== undefined) return cached.value as number | null;
    if (!this.prismaService) {
      throw new Error('durable revocation store unavailable (no Prisma service wired)');
    }
    const row = await this.prismaService.client.revokedCredential.findUnique({
      where: { kind_key: { kind: REVOKED_KIND_USER_INVALID_BEFORE, key: userId } },
    });
    let epoch: number | null = null;
    if (row && (row.expiresAt == null || row.expiresAt.getTime() > Date.now())) {
      const n = parseInt(row.value ?? '', 10);
      epoch = Number.isFinite(n) ? n : null;
    }
    this.fallbackCacheSet(cacheKey, epoch);
    return epoch;
  }

  // ── Fallback-path plumbing (Redis-down only — never on the hot path) ──

  private fallbackCacheGet(
    key: string,
  ): { value: boolean | number | null } | undefined {
    const hit = this.revocationFallbackCache.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.revocationFallbackCache.delete(key);
      return undefined;
    }
    return hit;
  }

  private fallbackCacheSet(key: string, value: boolean | number | null): void {
    // Bounded memory during a long outage: evict the oldest entry
    // (Map preserves insertion order) once at capacity.
    if (this.revocationFallbackCache.size >= RedisService.FALLBACK_CACHE_MAX) {
      const oldest = this.revocationFallbackCache.keys().next().value;
      if (oldest !== undefined) this.revocationFallbackCache.delete(oldest);
    }
    this.revocationFallbackCache.set(key, {
      value,
      expiresAt: Date.now() + RedisService.FALLBACK_CACHE_TTL_MS,
    });
  }

  /**
   * BOTH revocation stores are unreachable — the one state where the
   * legacy fail-open behavior is deliberately preserved (a total infra
   * outage must never lock the fleet out of emergency data). Loud, at
   * warn, ONCE per process — not per request.
   */
  private warnRevocationTotalOutage(detail: string): void {
    if (this.warnedRevocationTotalOutage) return;
    this.warnedRevocationTotalOutage = true;
    this.logger.warn(
      'REVOCATION BACKSTOP UNAVAILABLE: Redis AND Postgres are both unreachable ' +
        `(${detail}). Previously-revoked tokens may be accepted until either store ` +
        'recovers (legacy fail-open preserved). This warning logs once per process.',
    );
  }
}
