import { Injectable, OnModuleDestroy, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { Redis } from 'ioredis';
import { createHash, randomUUID } from 'crypto';
import { deviceSecretKeyCandidates } from '../security/key-ring';
import {
  WS_SIG_MAX_AGE_MS,
  bindWsSignatureToChannel,
  verifyWsHmac,
} from '../security/ws-signature';
import {
  RevocationIndeterminateError,
  type RevocationCertainty,
} from '../security/revocation-posture';
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
// each check reach the INDETERMINATE state.
//
// SEC-012 (2026-09-04): indeterminate no longer means "not revoked". The
// pre-fix total-outage behavior (`sismember` → false, `getTokenInvalidBefore`
// → null) was a documented fail-OPEN that the security suite printed a
// warning about and then allowed the request anyway. Both lookups now report
// the indeterminate state to their caller — `sismember` by THROWING
// `RevocationIndeterminateError`, so the three call sites that already
// try/catch it (device-auth, sse.controller, realtime.gateway) deny without
// any change; `checkTokenRevoked` / `checkUserInvalidBefore` by returning a
// tri-state for `JwtAuthGuard`, the only caller that can see the request and
// therefore apply the ONE named exception (`security/revocation-posture.ts`).
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

// ───────────────────────────────────────────────────────────────────
// REVOCATION CONTINUITY (2026-11-14 — security review F1).
//
// THE HOLE. Every lookup above trusted a Redis MISS as "not revoked" and only
// consulted the Postgres mirror when Redis ERRORED. Redis can lose keys without
// erroring — a restart without persistence, a failover to an empty replica,
// FLUSHALL, or eviction under memory pressure — and then every role downgrade,
// `canTriggerPanic` removal and logout written before the loss stopped being
// enforced until the token expired on its own (a user access token: 1 h; a
// device token: up to 180 days, though `Screen.credentialEpoch` also holds those).
//
// THE FIX. A continuity marker, `REVOCATION_CONTINUITY_KEY`, with NO expiry.
// It exists only once Redis provably holds every unexpired row of the Postgres
// mirror. Every revocation lookup reads it in the SAME pipeline as the
// revocation key (one round trip, as before), and:
//   • marker present → the Redis answer stands (hit = revoked, miss = clear);
//   • marker ABSENT  → Redis has lost data, so a miss proves nothing: the
//     lookup takes the existing durable path (30 s cache; SEC-012 posture
//     when Postgres is down too) and starts ONE restore.
// The restore copies every unexpired mirror row back into Redis — invalid-before
// markers to their own keys (monotonic: never lowers a newer marker), revoked
// tokens to `REVOKED_TOKEN_HASH_SET` as sha256 (the mirror never held raw
// tokens) — and sets the marker only if Redis was not wiped again meanwhile
// (the run's own token must still be there, checked atomically).
//
// FAILURE DIRECTION: toward Postgres. A failed restore leaves the marker
// absent, so lookups keep reading the durable store — the Redis-outage path
// that already exists — and the next miss retries the restore (at most once
// per `RESTORE_RETRY_MS` per process).
//
// RESIDUAL: eviction of individual keys that carry a TTL (`volatile-*`
// policies) can remove a revocation without touching the marker (no TTL). Redis
// must run `maxmemory-policy noeviction`; the boot check below logs an ERROR
// when it can read the policy and it is anything else.
// ───────────────────────────────────────────────────────────────────

/** Present (no TTL) only while Redis holds every unexpired mirror row. */
export const REVOCATION_CONTINUITY_KEY = 'revocation:continuity';
/** sha256 of revoked bearer tokens restored from the Postgres mirror. */
export const REVOKED_TOKEN_HASH_SET = 'jwt_revoked_hashes';
/** The running restore's id; the marker is set only if it survives the run. */
export const REVOCATION_RESTORE_RUN_KEY = 'revocation:restore_run';

/**
 * Raise the per-user marker to ARGV[1] with TTL ARGV[2] seconds, never lower
 * it: a marker written after the data loss may already be newer.
 */
export const RESTORE_INVALID_BEFORE_LUA =
  "local cur = tonumber(redis.call('GET', KEYS[1])) " +
  'if (not cur) or cur < tonumber(ARGV[1]) then ' +
  "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]) return 1 end return 0";

/**
 * Set the continuity marker only if this run's id is still in KEYS[1] — i.e.
 * Redis was not wiped while the restore ran (a wipe would also drop
 * half-restored rows, so marking it intact then would re-open the hole).
 */
export const MARK_CONTINUITY_LUA =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then " +
  "redis.call('SET', KEYS[2], ARGV[2]) redis.call('DEL', KEYS[1]) return 1 end return 0";

const RESTORE_PAGE_SIZE = 1_000;

/**
 * The ONLY channel families the fan-out subscriber listens on (see the
 * psubscribe in onModuleInit) and therefore the only ones that may reach
 * `gateway.broadcastToScope` / `sse.broadcastToScope`.
 */
const WS_SCOPE_CHANNEL_TYPES = new Set(['tenant', 'group', 'device']);

/** `tenant:<id>` | `group:<id>` | `device:<id>` — exactly the shape the gate delivers. */
function isScopeChannel(channel: string): boolean {
  const parts = channel.split(':');
  return (
    parts.length === 2 &&
    parts[1].length > 0 &&
    WS_SCOPE_CHANNEL_TYPES.has(parts[0])
  );
}

// ───────────────────────────────────────────────────────────────────
// PUSH CHANNEL SURVIVES A REDIS OUTAGE (2026-11-21, EMG-03).
//
// THE DEFECT. `retryStrategy` returned null after 3 attempts, so ioredis ended
// both connections for good after any outage longer than about a second, and
// `connected` was written only at boot. After a Redis restart the subscriber
// was gone (no screen got a WS/SSE push until the API was restarted) while
// `connected` still read true, so `publish()` kept taking the Redis branch —
// which rejected — and never reached the in-process fallback that would have
// delivered to every screen connected to this (single) replica.
//
// THE RULES NOW:
//   • Boot still waits at most REDIS_BOOT_CAP_MS (7 s, CLAUDE.md §10) — then it
//     proceeds without Redis exactly as before.
//   • After that both connections reconnect forever, backoff capped at
//     REDIS_RECONNECT_MAX_DELAY_MS. A connection that reaches 'end' anyway
//     (only a connector fault can do that now) is re-dialled.
//   • `connected` is the truth: true only while the publisher is ready AND the
//     subscriber has confirmed its psubscribe on its CURRENT connection; false
//     the moment either closes. The subscriber re-subscribes itself on every
//     'ready' (ioredis's own auto-resubscribe is off, so there is one owner).
//   • While `connected` is false, `publish()` delivers to this process's own
//     WS + SSE clients and sends nothing to Redis (the offline queue is off on
//     both connections, so nothing is queued to be replayed later either).
//   • While it is true, a scope publish Redis does not confirm — rejected,
//     reached no subscriber at all, or still unanswered when the connection
//     dropped or after PUBLISH_CONFIRM_MS — is delivered here at once. After a
//     timeout, every later publish is delivered here FIRST and handed to Redis
//     second, until Redis confirms one again — so a district fan-out over many
//     schools pays the wait once, not once per school. In doubt, show.
//   • ioredis re-sends a command that was in flight when a connection dropped
//     (`autoResendUnfulfilledCommands`). So a publish this process already
//     delivered locally can arrive back from Redis later. The gate remembers
//     each (channel, eventId) it delivered for the signature's own freshness
//     window and drops the byte-identical second copy — so a late copy can
//     never re-raise an alert that has since been cleared.
//   • Revocation continuity (F1 below): a revocation written while the
//     publisher was away reached only the Postgres mirror, and the continuity
//     marker survives an outage that did not wipe Redis. So after any lost
//     connection — and after any revocation write that missed Redis — this
//     process does not trust the marker again until a restore that STARTED
//     after the loss has completed. Until then a Redis miss reads Postgres.
//
// FAILURE DIRECTION: toward delivery. Every unknown ends in a local delivery;
// the only thing ever dropped is an exact copy of an envelope this process has
// already delivered. Revocation lookups fail toward Postgres while Redis is
// away and until the post-outage restore completes (commands fail fast
// because the offline queue is off).
// Kill switch: REDIS_DISABLED=true (existing) — Redis off, polling fallback.
// ───────────────────────────────────────────────────────────────────

/** CLAUDE.md §10: boot never waits longer than this for Redis. Never raise or remove it. */
export const REDIS_BOOT_CAP_MS = 7_000;
/** Reconnect backoff ceiling: never give up, never hammer a recovering Redis. */
export const REDIS_RECONNECT_MAX_DELAY_MS = 5_000;
/**
 * How long `publish()` waits for Redis to confirm a scope publish before
 * delivering it here. A healthy Redis answers in milliseconds; a false alarm
 * only costs a local delivery whose Redis copy the gate then drops.
 */
export const PUBLISH_CONFIRM_MS = 1_000;
/** The only channel families the fan-out subscriber listens on. */
export const FANOUT_PATTERNS = ['tenant:*', 'group:*', 'device:*'] as const;
/** Bound on the delivered-envelope memory (insertion-ordered, oldest evicted first). */
const DELIVERED_MAX = 10_000;
/** One log line per this interval while lookups ride the durable store. */
const REDIS_FALLBACK_WARN_INTERVAL_MS = 60_000;

/** Delay before reconnect attempt `times` (1-based): 200 ms, 400 ms, … capped. Always a number. */
export function redisReconnectDelayMs(times: number): number {
  const n = Number.isFinite(times) && times > 0 ? times : 1;
  return Math.min(n * 200, REDIS_RECONNECT_MAX_DELAY_MS);
}

/** What `pushChannelState()` reports to the health probes. */
export interface PushChannelState {
  /** A Redis client exists (REDIS_URL set and not REDIS_DISABLED). */
  configured: boolean;
  /** Publisher ready, subscriber listening, publishes confirmed: pushes cross Redis. */
  live: boolean;
  publisher: string;
  subscriber: string;
  /** The subscriber confirmed its psubscribe on its current connection. */
  subscribed: boolean;
  /** When the channel was lost (ISO), null while live or unconfigured. */
  downSince: string | null;
  /** Plain-words reason while not live, null otherwise. Fixed wording: never an upstream error text. */
  reason: string | null;
}

type PublishOutcome =
  | 'delivered'
  | 'no-subscriber'
  | 'rejected'
  | 'lost'
  | 'timeout';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public publisher: Redis | null = null;
  public subscriber: Redis | null = null;
  private gateway: any;
  /**
   * The fan-out is up: publisher ready AND subscriber listening (EMG-03).
   * Written only by `refreshFanoutState()` once `onModuleInit` has attached
   * the connection watchers (tests that build the service by hand set it).
   */
  private connected = false;
  private publisherReady = false;
  private subscriberListening = false;
  /** Bumped on every subscriber close, so a late psubscribe reply from an old connection is ignored. */
  private subscriberEpoch = 0;
  private subscribing: Promise<void> | null = null;
  private shuttingDown = false;
  private watchersAttached = false;
  private continuityChecked = false;
  private fanoutDownSince: number | null = null;
  private fanoutDownReason: string | null = null;
  /** What the last transition log said (live or not), so each change logs once. */
  private pushLiveLogged = false;
  /**
   * Redis accepted a scope publish and did not answer within
   * PUBLISH_CONFIRM_MS. Until a publish is confirmed again (or the publisher
   * reconnects), `publish()` delivers here first and hands Redis a copy second.
   */
  private publishUnconfirmed = false;
  /**
   * Revocation continuity across an outage (EMG-03). `revocationSkewGen` moves
   * every time Redis may have missed a revocation (a lost publisher connection,
   * a revocation write that did not land); `revocationTrustedGen` is the
   * generation a completed restore STARTED at. The continuity marker is trusted
   * only once the trusted generation has caught up — both stay 0 in a process
   * that never lost Redis, which keeps the F1 hot path exactly as it was.
   */
  private revocationSkewGen = 0;
  private revocationTrustedGen = 0;
  /** Resolvers for publishes awaiting Redis; each is told when the publisher connection closes. */
  private readonly publisherLossWaiters = new Set<() => void>();
  /** (channel, eventId) → when this process delivered it. See the EMG-03 block above. */
  private readonly deliveredEnvelopes = new Map<string, number>();
  private lastRedisFallbackWarnAt = 0;

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
  // Revocation continuity (F1): one restore at a time per process, and at
  // most one attempt per RESTORE_RETRY_MS while the marker stays absent.
  private static readonly RESTORE_RETRY_MS = 30_000;
  private restoreInFlight: Promise<boolean> | null = null;
  private lastRestoreAttemptAt = 0;

  // Same key + dev-fallback the signer uses, so HMAC verify matches signing
  // byte-for-byte. This is the SERVER-SIDE emergency gate: every message
  // consumed off the Redis fan-out is verified before it reaches any player,
  // so a forged message published onto a scope channel is dropped here and
  // never renders. Stateless verify (no single-use nonce) → multi-replica safe.
  //
  // 2026-10-22 — a KEY RING, `[primary, previous?]` (security/key-ring.ts). During
  // a DEVICE_SECRET_KEY rotation window a replica still on the old key may be
  // the one that signed a lockdown; this gate must accept it on EVERY replica,
  // so verify tries the primary then the previous (each constant-time). Publish
  // still re-signs with the primary only. With no previous configured this is
  // a one-element list — the exact pre-ring behaviour.
  private readonly deviceSecret: readonly string[] = deviceSecretKeyCandidates();

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
        // OFF on both connections, deliberately: a command issued while a
        // connection is down fails at once (callers fall back) instead of
        // waiting in a queue to be sent — late — after the reconnect.
        enableOfflineQueue: false,
        lazyConnect: true,
        // EMG-03: reconnect forever. Returning null here (the old behaviour
        // after 3 attempts) ends the connection for good.
        retryStrategy: (times: number) => redisReconnectDelayMs(times),
        reconnectOnError: () => false,
      };
      this.publisher = new Redis(redisUrl, baseOpts);
      // The subscriber re-subscribes itself on every 'ready' (onSubscriberReady),
      // so ioredis's own resubscribe is off: one owner, one psubscribe per connection.
      this.subscriber = new Redis(redisUrl, {
        ...baseOpts,
        autoResubscribe: false,
      });

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
   *
   * Since EMG-03 (2026-11-21) it follows the connections live: false from the
   * moment either Redis connection drops until both are back and the
   * subscriber has re-subscribed — it used to stay true after an outage.
   */
  isConnected(): boolean {
    return (
      this.connected === true && !this.publishUnconfirmed && !!this.publisher
    );
  }

  async onModuleInit() {
    if (!this.publisher || !this.subscriber) return;
    // Every state change from here on is driven by the connections' own
    // events, at boot and after it (EMG-03).
    this.attachConnectionWatchers();

    // Absolute wall-clock cap on Redis bring-up. Boot must never hang
    // on Redis — we'd rather ship realtime over HTTP polling than
    // fail Railway's healthcheck window because ioredis is retrying.
    let capTimer: ReturnType<typeof setTimeout> | undefined;
    const hardCap = new Promise<void>((resolve) => {
      capTimer = setTimeout(resolve, REDIS_BOOT_CAP_MS);
    });

    const bringUp = (async () => {
      // Both dial in parallel: one failing must not leave the other un-dialled
      // (the old code never dialled the subscriber when the publisher failed,
      // so even a later reconnect of the publisher left screens without push).
      const [, sub] = await Promise.allSettled([
        this.publisher!.connect(),
        this.subscriber!.connect(),
      ]);
      // The subscriber's 'ready' watcher has started the psubscribe; boot
      // waits for it (inside the cap) so "connected" means screens get pushes.
      if (sub.status === 'fulfilled' && this.subscribing)
        await this.subscribing;
    })().catch(() => undefined);

    await Promise.race([bringUp, hardCap]);
    if (capTimer) clearTimeout(capTimer);
    if (!this.connected) {
      const bothUp = this.publisherReady && this.subscriber.status === 'ready';
      this.markFanoutDown(
        bothUp
          ? (this.fanoutDownReason ??
              "Redis did not confirm the API's push subscription in time")
          : 'Redis was not reachable when the API started',
      );
      this.logger.warn(
        'Redis is not connected after boot (at most 7 s) — proceeding with the HTTP-polling fallback; ' +
          "reconnecting in the background (pushes are delivered to this replica's own screens meanwhile)",
      );
    }
  }

  async onModuleDestroy() {
    this.shuttingDown = true;
    // A client that is not 'ready' cannot take QUIT (the offline queue is off,
    // so ioredis rejects it and keeps its reconnect timer alive), and with
    // retries that never give up that would hold the process open. Close
    // those outright; QUIT the ready ones, and close them too if QUIT fails.
    for (const client of [this.publisher, this.subscriber]) {
      if (!client) continue;
      try {
        if (client.status === 'ready') await client.quit();
        else client.disconnect();
      } catch {
        try {
          client.disconnect();
        } catch {
          /* ignore cleanup errors */
        }
      }
    }
  }

  // ── Connection state (EMG-03) ──────────────────────────────────────────

  /**
   * Attach the ready / close / end watchers to both connections, once. They
   * are the only writers of `connected` from here on.
   */
  private attachConnectionWatchers(): void {
    const pub = this.publisher;
    const sub = this.subscriber;
    if (!pub || !sub || this.watchersAttached) return;
    this.watchersAttached = true;

    pub.on('ready', () => {
      this.publisherReady = true;
      // A fresh connection: whatever the old one failed to confirm is moot.
      this.publishUnconfirmed = false;
      this.refreshFanoutState();
      // F1 revocation continuity: restore the mirror into Redis if the marker
      // is gone, and report an eviction policy that could drop revocations.
      // Once per process, on the first connection (at boot or after it).
      // Fire-and-forget — nothing waits on it.
      if (!this.continuityChecked) {
        this.continuityChecked = true;
        void this.checkRevocationContinuityAtBoot();
      }
      // EMG-03: back after a loss. Revocations written meanwhile reached only
      // the Postgres mirror; copy it back before the marker is trusted again.
      if (!this.revocationContinuityTrusted()) {
        this.startRevocationRestore('Redis reconnected after an outage');
      }
    });
    pub.on('close', () =>
      this.onPublisherDown(
        'the API lost its Redis connection for sending pushes',
      ),
    );
    pub.on('end', () => {
      this.onPublisherDown(
        'the API lost its Redis connection for sending pushes',
      );
      this.redialAfterEnd(pub);
    });

    sub.on('ready', () => this.onSubscriberReady());
    sub.on('close', () =>
      this.onSubscriberDown(
        'the API lost its Redis connection for receiving pushes',
      ),
    );
    sub.on('end', () => {
      this.onSubscriberDown(
        'the API lost its Redis connection for receiving pushes',
      );
      this.redialAfterEnd(sub);
    });
    // Attached once, here, so they survive every reconnect (same client object).
    sub.on('message', (channel: string, message: string) => {
      this.handleRedisMessage(channel, message);
    });
    sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      this.handleRedisMessage(channel, message);
    });
  }

  private onPublisherDown(reason: string): void {
    this.publisherReady = false;
    // Anything written while the publisher is away misses Redis (EMG-03).
    this.revocationSkewGen++;
    // A publish still waiting on this connection may be re-sent by ioredis
    // after the reconnect — late. Deliver it here NOW instead (publishToRedis).
    for (const lost of [...this.publisherLossWaiters]) lost();
    this.refreshFanoutState(reason);
  }

  /** psubscribe on THIS connection; listening only once Redis confirmed it. */
  private onSubscriberReady(): void {
    const sub = this.subscriber;
    if (!sub) return;
    const epoch = ++this.subscriberEpoch;
    this.subscribing = (async () => {
      try {
        await sub.psubscribe(...FANOUT_PATTERNS);
      } catch (e) {
        // The connection dropped mid-subscribe (its next 'ready' tries again)
        // or Redis refused it. Either way we are not listening: pushes are
        // delivered on this replica until a psubscribe is confirmed.
        if (epoch === this.subscriberEpoch) {
          this.logger.warn(
            `Redis psubscribe failed (${e instanceof Error ? e.message : e}) — ` +
              'pushes are delivered on this replica until the subscriber is back',
          );
          this.refreshFanoutState("Redis refused the API's push subscription");
        }
        return;
      }
      if (epoch !== this.subscriberEpoch) return; // a newer connection owns the state
      this.subscriberListening = true;
      this.refreshFanoutState();
    })();
  }

  private onSubscriberDown(reason: string): void {
    this.subscriberEpoch++;
    this.subscriberListening = false;
    this.refreshFanoutState(reason);
  }

  /**
   * With a retryStrategy that always returns a number, ioredis ends a
   * connection only on a connector fault (or our own quit at shutdown). Dial
   * it again rather than let the push channel stay dead until a restart.
   */
  private redialAfterEnd(client: Redis): void {
    if (this.shuttingDown) return;
    const t = setTimeout(() => {
      if (this.shuttingDown || client.status !== 'end') return;
      client.connect().catch(() => {
        /* its close / end watchers take it from here */
      });
    }, REDIS_RECONNECT_MAX_DELAY_MS);
    t.unref?.();
  }

  /** Recompute `connected` from the two connections, then the logged state. */
  private refreshFanoutState(reason?: string): void {
    this.connected = this.publisherReady && this.subscriberListening;
    this.updatePushLive(reason);
  }

  /**
   * Log each change of "pushes cross Redis" once, and keep the plain-words
   * reason and the since-when for the health probes.
   */
  private updatePushLive(reason?: string): void {
    const live = this.connected && !this.publishUnconfirmed;
    if (!live && reason && !this.shuttingDown) this.markFanoutDown(reason);
    if (live === this.pushLiveLogged) return;
    this.pushLiveLogged = live;
    if (live) {
      const downMs =
        this.fanoutDownSince === null
          ? null
          : Date.now() - this.fanoutDownSince;
      this.fanoutDownSince = null;
      this.fanoutDownReason = null;
      this.logger.log(
        downMs === null
          ? 'Redis connected successfully'
          : `Redis push channel restored after ${Math.round(downMs / 1000)} s — pushes cross Redis again`,
      );
      return;
    }
    if (this.shuttingDown) return;
    this.markFanoutDown(reason ?? 'a Redis connection is down');
    this.logger.warn(
      `Redis push channel lost (${this.fanoutDownReason}) — reconnecting; until it is back this ` +
        'replica delivers pushes to its own screens directly and every screen polls as the backstop',
    );
  }

  private markFanoutDown(reason: string): void {
    if (this.fanoutDownSince === null) this.fanoutDownSince = Date.now();
    this.fanoutDownReason = reason;
  }

  /**
   * Plain facts about the push channel for the health probes
   * (`/api/v1/health/emergency-path`, the platform-health email). Never throws.
   * The reason is fixed wording — never an upstream error text, which could
   * name an internal host on an unauthenticated endpoint.
   */
  pushChannelState(): PushChannelState {
    const configured = !!this.publisher && !!this.subscriber;
    const live = configured && this.connected && !this.publishUnconfirmed;
    let reason: string | null = null;
    if (configured && !live) {
      const since =
        this.fanoutDownSince === null
          ? ''
          : `, ${Math.max(0, Math.round((Date.now() - this.fanoutDownSince) / 1000))} s ago`;
      reason =
        `Instant push to screens is down: ${this.fanoutDownReason ?? 'Redis is not connected yet'}${since}. ` +
        'The API reconnects by itself; meanwhile it delivers alerts to the screens connected to it, ' +
        'and every screen still polls for alerts.';
    }
    return {
      configured,
      live,
      publisher: this.publisher?.status ?? 'none',
      subscriber: this.subscriber?.status ?? 'none',
      subscribed: this.subscriberListening,
      downSince:
        configured && !live && this.fanoutDownSince !== null
          ? new Date(this.fanoutDownSince).toISOString()
          : null,
      reason,
    };
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

      // F4 (2026-11-14): forward ONLY what the signature covers, plus the
      // signature. Any other top-level field on a Redis message was never
      // signed, so it must not reach a screen. The WS gateway already picked
      // these fields; SSE wrote the whole parsed object.
      const signed = parsed as {
        eventId: string;
        timestamp: number;
        type: string;
        payload: unknown;
        signature: string;
      };
      const envelope = {
        eventId: signed.eventId,
        timestamp: signed.timestamp,
        type: signed.type,
        payload: signed.payload,
        signature: signed.signature,
      };

      // EMG-03: at most once per (channel, eventId) on this process. A publish
      // delivered here because Redis did not confirm it can still arrive back
      // from Redis later (ioredis re-sends a command that was in flight when
      // its connection dropped). That copy is byte-identical to one these
      // screens already have — and, arriving late, it could otherwise re-raise
      // an alert cleared in between. Checked AFTER the HMAC gate, so only a
      // verified envelope is ever remembered.
      if (!this.rememberDelivered(channel, envelope.eventId)) {
        this.logger.debug(
          `[WS] Dropped a second copy of ${envelope.eventId} on ${channel} (already delivered)`,
        );
        return;
      }

      // Fan to BOTH transports. Either may be unset (e.g. WS gateway
      // not yet wired, or SSE service not present in test env).
      if (this.gateway) this.gateway.broadcastToScope(type, id, envelope);
      if (this.sse) this.sse.broadcastToScope(type, id, envelope);
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
    const body = JSON.stringify(framed);
    if (this.connected && this.publisher) {
      if (!isScopeChannel(channel)) {
        // Not a screen channel (e.g. `metrics:ack` telemetry, which nothing
        // subscribes to): unchanged — one PUBLISH, its error to the caller.
        await this.publisher.publish(channel, body);
        return;
      }
      if (this.publishUnconfirmed) {
        // EMG-03: Redis took an earlier publish and never answered. Deliver
        // here first, then still hand Redis a copy (it may be slow, not gone);
        // that copy coming back is dropped by the gate as already delivered,
        // and its confirmation ends this mode.
        this.deliverLocally(channel, body);
        void this.publishToRedis(channel, body);
        return;
      }
      const outcome = await this.publishToRedis(channel, body);
      if (outcome === 'delivered') return;
      // EMG-03: Redis did not confirm this one. Deliver it to this process's
      // own screens now rather than lose it (in doubt, show the alert); a copy
      // Redis delivers later is dropped by the gate as already delivered.
      this.logger.warn(
        `[WS] Redis did not confirm the publish on ${channel} (${outcome}) — delivering on this replica`,
      );
    }
    // Fallback: Redis is unavailable (local dev, a Redis-less deploy, or an
    // outage — EMG-03). Pipe straight to this process's WS gateway + SSE.
    // Nothing is sent to Redis, so nothing can be replayed after a reconnect.
    this.deliverLocally(channel, body);
  }

  /** The in-process delivery: the same gate a Redis message goes through. */
  private deliverLocally(channel: string, body: string): void {
    if (this.gateway || this.sse) {
      this.logger.debug(`[Mock Redis] Publishing to channel ${channel}`);
      this.handleRedisMessage(channel, body);
    }
  }

  /**
   * One PUBLISH, bounded. Resolves (never rejects) with how it ended:
   *   delivered      Redis answered and at least one subscriber received it;
   *   no-subscriber  Redis answered 0 receivers — no replica (not even this
   *                  one) got it, so delivering here can only help;
   *   rejected       the command failed (connection not writable, error reply);
   *   lost           the publisher connection closed while it was in flight —
   *                  ioredis may re-send it after the reconnect, late;
   *   timeout        no answer within PUBLISH_CONFIRM_MS (sets
   *                  `publishUnconfirmed`; a later confirmation clears it).
   */
  private publishToRedis(
    channel: string,
    body: string,
  ): Promise<PublishOutcome> {
    const pub = this.publisher!;
    return new Promise<PublishOutcome>((resolve) => {
      let done = false;
      // Created first, so `finish` can always clear it; it only fires later.
      const timer = setTimeout(() => {
        if (done) return;
        this.setPublishUnconfirmed(true);
        finish('timeout');
      }, PUBLISH_CONFIRM_MS);
      timer.unref?.();
      const finish = (outcome: PublishOutcome) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.publisherLossWaiters.delete(onLost);
        resolve(outcome);
      };
      const onLost = () => finish('lost');
      this.publisherLossWaiters.add(onLost);
      let sent: Promise<unknown>;
      try {
        sent = Promise.resolve(pub.publish(channel, body));
      } catch {
        finish('rejected');
        return;
      }
      sent.then(
        (receivers) => {
          // Even a late answer proves Redis is answering again.
          if (receivers !== 0) this.setPublishUnconfirmed(false);
          finish(receivers === 0 ? 'no-subscriber' : 'delivered');
        },
        () => finish('rejected'),
      );
    });
  }

  private setPublishUnconfirmed(value: boolean): void {
    if (this.publishUnconfirmed === value) return;
    this.publishUnconfirmed = value;
    this.updatePushLive(value ? 'Redis stopped confirming pushes' : undefined);
  }

  /**
   * Record that this process delivered (channel, eventId); false when it
   * already did within the signature's freshness window (beyond that the HMAC
   * gate drops the envelope as stale anyway). An envelope with no eventId is
   * always delivered — there is nothing to recognise it by.
   */
  private rememberDelivered(channel: string, eventId: unknown): boolean {
    if (typeof eventId !== 'string' || eventId.length === 0) return true;
    const now = Date.now();
    // Expired entries leave from the head (Map keeps insertion order = time order).
    for (const [k, at] of this.deliveredEnvelopes) {
      if (now - at < WS_SIG_MAX_AGE_MS) break;
      this.deliveredEnvelopes.delete(k);
    }
    const key = `${channel}\u0000${eventId}`;
    if (this.deliveredEnvelopes.has(key)) return false;
    this.deliveredEnvelopes.set(key, now);
    if (this.deliveredEnvelopes.size > DELIVERED_MAX) {
      const oldest = this.deliveredEnvelopes.keys().next().value as
        | string
        | undefined;
      if (oldest !== undefined) this.deliveredEnvelopes.delete(oldest);
    }
    return true;
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
      this.noteRevocationMissedRedis(key);
      this.logger.warn(
        `Redis unavailable — '${key}' set write skipped; the durable Postgres mirror ` +
          'and the credential epoch remain authoritative',
      );
      return false;
    }
    try {
      await this.publisher.sadd(key, member);
    } catch (e) {
      this.noteRevocationMissedRedis(key);
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
   * Plain string GET. Added 2026-09-02 for the emergency-revision endpoint
   * (`screens/emergency-rev.ts`), which needs a cross-replica scalar that is
   * emphatically NOT a Postgres read — answering "has anything changed?" for
   * a 1 000-screen fleet every 10 s is the one thing that must never touch
   * the `connection_limit=10` pool.
   *
   * FAIL-SAFE CONTRACT (do not weaken): NEVER throws, and returns `null` for
   * both "no such key" and "Redis is unreachable". The caller distinguishes
   * them from its own in-process state; a thrown error on this path would sit
   * inside a life-safety backstop poll.
   */
  async getString(key: string): Promise<string | null> {
    if (!this.connected || !this.publisher) return null;
    try {
      const value = await this.publisher.get(key);
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  }

  /**
   * Plain string SET with an optional TTL. Companion to `getString`.
   *
   * FAIL-SAFE CONTRACT (do not weaken): NEVER throws, returns `false` when
   * the write did not land. Its one caller writes the tenant emergency epoch
   * on the trigger / all-clear path, where the in-process value is already
   * authoritative for this replica — a Redis outage must not be able to fail
   * or delay an emergency dispatch.
   */
  async setString(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    if (!this.connected || !this.publisher) return false;
    try {
      if (ttlSeconds && Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
        await this.publisher.set(key, value, 'EX', Math.ceil(ttlSeconds));
      } else {
        await this.publisher.set(key, value);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a key. Companion to `getString` / `setString`.
   *
   * FAIL-SAFE CONTRACT (do not weaken): NEVER throws, returns `false` when
   * the delete did not land. Its caller is `invalidateDeviceCredentialCache`,
   * i.e. the revocation path — a Redis outage must not be able to fail a
   * revoke (the `credentialEpoch` in Postgres stays the authority and the
   * key's own TTL bounds the window).
   *
   * A real DEL rather than "write a tombstone with a 1 s TTL": a tombstone
   * would be read back as a NEGATIVE snapshot ("this screen does not exist")
   * and 401 a perfectly valid device for the length of the TTL.
   */
  async delKey(key: string): Promise<boolean> {
    if (!this.connected || !this.publisher) return false;
    try {
      await this.publisher.del(key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a value is a member of a Redis set.
   * Used by JwtAuthGuard / SSE / WS gateway for token revocation checks.
   *
   * Fallback semantics (2026-07-10 durable-revocation fix, SEC-012 posture):
   * - Redis up, continuity marker present → Redis answer, NO DB read.
   * - Redis up, marker ABSENT (Redis lost data — F1, 2026-11-14) → a hit is
   *   still a revocation; a miss takes the Postgres path below and starts
   *   one restore (see REVOCATION_CONTINUITY_KEY).
   * - Redis down/erroring → for `jwt_revoked_list` only: Postgres
   *   `revoked_credentials` lookup (30s in-memory cached) instead of the
   *   old blanket `false`.
   * - Redis AND Postgres down → **THROWS** `RevocationIndeterminateError`
   *   (SEC-012). It used to return `false`, i.e. "not revoked", which is a
   *   claim this process cannot make. Throwing is what makes the three
   *   existing try/catch call sites — `device-auth.verifyDeviceForScreen`
   *   (`revocation_check_unavailable`), `sse.controller` and
   *   `realtime.gateway` — fail closed without any change to them.
   *   `JwtAuthGuard` asks `checkTokenRevoked` instead, because it is the
   *   only caller that can classify the request's purpose.
   *
   * Any OTHER set keeps the legacy `false` (there is no mirror to consult,
   * and no other key in this codebase is a security decision).
   */
  async sismember(key: string, member: string): Promise<boolean> {
    if (key !== 'jwt_revoked_list') {
      if (this.connected && this.publisher) {
        try {
          return (await this.publisher.sismember(key, member)) === 1;
        } catch {
          /* non-revocation set — legacy behavior */
        }
      }
      return false;
    }
    const certainty = await this.checkTokenRevoked(member);
    if (certainty === 'indeterminate') {
      throw new RevocationIndeterminateError('redis and postgres both unreachable');
    }
    return certainty === 'revoked';
  }

  /**
   * SEC-012 — the tri-state single-token revocation lookup.
   *
   * Never throws. `indeterminate` means BOTH stores failed and is the caller's
   * cue to apply `security/revocation-posture.ts`; it is never a licence to
   * treat the token as clear.
   */
  async checkTokenRevoked(token: string): Promise<RevocationCertainty> {
    if (this.connected && this.publisher) {
      try {
        // One round trip: the raw-token set, the restored-hash set and the
        // continuity marker (F1 — see REVOCATION_CONTINUITY_KEY).
        const [inRaw, inRestored, intact] = await this.readPipeline((p) =>
          p
            .sismember('jwt_revoked_list', token)
            .sismember(REVOKED_TOKEN_HASH_SET, hashRevokedToken(token))
            .exists(REVOCATION_CONTINUITY_KEY),
        );
        // A hit is a revocation whatever the marker says.
        if (inRaw === 1 || inRestored === 1) return 'revoked';
        const trusted = this.revocationContinuityTrusted();
        if (intact === 1 && trusted) return 'clear';
        // Marker absent (Redis lost data), or this process lost Redis since
        // the last restore (EMG-03): either way this miss proves nothing.
        this.startRevocationRestore(
          trusted
            ? 'token lookup found the continuity marker absent'
            : 'token lookup after a Redis outage, before the restore',
        );
      } catch {
        // Redis answered with an error — fall through to the durable store.
      }
    } else {
      // Every authenticated request lands here while Redis is away (EMG-03:
      // `connected` now goes false during an outage, not only at boot), so
      // one line a minute — not one per request.
      const now = Date.now();
      if (
        now - this.lastRedisFallbackWarnAt >=
        REDIS_FALLBACK_WARN_INTERVAL_MS
      ) {
        this.lastRedisFallbackWarnAt = now;
        this.logger.warn(
          'Redis unavailable — token revocation check falling back to durable store',
        );
      }
    }
    return this.isTokenRevokedInDurableStore(token);
  }

  /**
   * Postgres side of the single-token revocation check (Redis-down path
   * only). Never throws: it reports `indeterminate` for the both-stores-down
   * state and warns once, and the CALLER decides what that means.
   */
  private async isTokenRevokedInDurableStore(token: string): Promise<RevocationCertainty> {
    const cacheKey = `${REVOKED_KIND_JTI}:${hashRevokedToken(token)}`;
    const cached = this.fallbackCacheGet(cacheKey);
    if (cached !== undefined) return cached.value === true ? 'revoked' : 'clear';
    if (!this.prismaService) {
      // No durable store wired into this process AT ALL. With Redis also
      // unavailable there is nothing left that could know, so this is the
      // indeterminate state too — not a quiet pass.
      this.warnRevocationTotalOutage('no Prisma service wired');
      return 'indeterminate';
    }
    try {
      const row = await this.prismaService.client.revokedCredential.findUnique({
        where: { kind_key: { kind: REVOKED_KIND_JTI, key: hashRevokedToken(token) } },
      });
      // An expired mirror row is inert — the JWT itself has expired.
      const revoked = !!row && (row.expiresAt == null || row.expiresAt.getTime() > Date.now());
      this.fallbackCacheSet(cacheKey, revoked);
      return revoked ? 'revoked' : 'clear';
    } catch (e) {
      this.warnRevocationTotalOutage(e instanceof Error ? e.message : String(e));
      return 'indeterminate';
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
    try {
      const existing = await this.publisher.get(key);
      const next = existing
        ? Math.max(parseInt(existing, 10) || 0, epoch)
        : epoch;
      await this.publisher.set(key, String(next), 'EX', 60 * 60 * 24 * 30);
    } catch (e) {
      // Only the mirror has it now (EMG-03): stop trusting the marker until
      // a restore has copied the mirror back. Still thrown, as before.
      this.noteRevocationMissedRedis(key);
      throw e;
    }
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
   * Fallback semantics (2026-07-10 durable-revocation fix, SEC-012 posture):
   * - Redis up, continuity marker present → Redis answer, NO DB read.
   * - Redis up, marker ABSENT (F1, 2026-11-14) → a present marker is still
   *   enforced; "no marker" takes the Postgres path and starts one restore.
   * - Redis configured but erroring → Postgres mirror lookup (30s
   *   cached). If Postgres ALSO fails, THROW — the guard fails CLOSED,
   *   exactly as before.
   * - No Redis configured (publisher null, dev / Redis-less deploy) →
   *   Postgres mirror lookup; if Postgres fails too, THROW as well
   *   (SEC-012 — this used to return `null`, i.e. "no revocation marker
   *   exists", which a process that just failed to read the store cannot
   *   know. A Redis-less deploy whose database is also down has no
   *   business authorizing a privileged session).
   */
  async getTokenInvalidBefore(userId: string): Promise<number | null> {
    const verdict = await this.checkUserInvalidBefore(userId);
    if (verdict.certainty === 'indeterminate') {
      throw new RevocationIndeterminateError('redis and postgres both unreachable');
    }
    return verdict.invalidBefore;
  }

  /**
   * SEC-012 — tri-state form of the per-user invalid-before lookup, for
   * `JwtAuthGuard`. Never throws; `indeterminate` is the caller's cue to
   * apply `security/revocation-posture.ts`.
   */
  async checkUserInvalidBefore(
    userId: string,
  ): Promise<
    { certainty: 'confirmed'; invalidBefore: number | null } | { certainty: 'indeterminate' }
  > {
    if (this.publisher) {
      try {
        // One round trip: the marker key and the continuity marker (F1).
        const [raw, intact] = await this.readPipeline((p) =>
          p
            .get(this.tokenInvalidBeforeKey(userId))
            .exists(REVOCATION_CONTINUITY_KEY),
        );
        if (raw != null) {
          // A present marker is enforced whatever the continuity marker says.
          const n = parseInt(raw as string, 10);
          return {
            certainty: 'confirmed',
            invalidBefore: Number.isFinite(n) ? n : null,
          };
        }
        const trusted = this.revocationContinuityTrusted();
        if (intact === 1 && trusted)
          return { certainty: 'confirmed', invalidBefore: null };
        // Marker absent (Redis lost data), or this process lost Redis since
        // the last restore (EMG-03): either way "no marker" proves nothing.
        this.startRevocationRestore(
          trusted
            ? 'invalid-before lookup found the continuity marker absent'
            : 'invalid-before lookup after a Redis outage, before the restore',
        );
      } catch {
        // Redis errored — fall through to the durable mirror.
      }
    }
    try {
      return {
        certainty: 'confirmed',
        invalidBefore: await this.getInvalidBeforeFromDurableStore(userId),
      };
    } catch (dbError) {
      this.warnRevocationTotalOutage(dbError instanceof Error ? dbError.message : String(dbError));
      return { certainty: 'indeterminate' };
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

  // ── Revocation continuity (F1, 2026-11-14) ────────────────────────────

  /**
   * EMG-03: may a Redis miss be trusted (given the marker)? Not after this
   * process lost Redis, or saw a revocation write miss it, until a restore
   * that started afterwards has completed. Always true in a process that never
   * lost Redis — the F1 behaviour, unchanged.
   */
  private revocationContinuityTrusted(): boolean {
    return this.revocationTrustedGen >= this.revocationSkewGen;
  }

  /** A revocation reached only the Postgres mirror: Redis lags it until a restore. */
  private noteRevocationMissedRedis(key: string): void {
    if (key === 'jwt_revoked_list' || key.startsWith('jwt_invalid_before:')) {
      this.revocationSkewGen++;
    }
  }

  /**
   * Run read commands in ONE round trip and return their results in order.
   * Throws if the pipeline or ANY command in it failed — the callers treat
   * that exactly like the Redis error they already handle (durable store).
   */
  private async readPipeline(
    build: (p: ReturnType<Redis['pipeline']>) => ReturnType<Redis['pipeline']>,
  ): Promise<unknown[]> {
    const results = await build(this.publisher!.pipeline()).exec();
    if (!results) throw new Error('redis pipeline returned no results');
    return results.map(([err, value]) => {
      if (err) throw err;
      return value;
    });
  }

  /**
   * Start ONE restore of the Postgres mirror into Redis, unless one is running
   * or the last attempt was under RESTORE_RETRY_MS ago. Never throws, never
   * awaited by a request — the request that noticed already reads Postgres.
   */
  private startRevocationRestore(reason: string): void {
    if (this.restoreInFlight) return;
    const now = Date.now();
    if (now - this.lastRestoreAttemptAt < RedisService.RESTORE_RETRY_MS) return;
    this.lastRestoreAttemptAt = now;
    this.logger.warn(
      `Revocation continuity not proven (${reason}) — Redis may be missing revocations; ` +
        'lookups read the Postgres mirror until the restore completes',
    );
    this.restoreInFlight = this.restoreRevocationsFromDurable()
      .then((ok) => {
        // Only a FAILED attempt throttles the next one; after a success a new
        // loss (marker gone again) restores at once.
        if (ok) this.lastRestoreAttemptAt = 0;
        return ok;
      })
      .catch((e) => {
        this.logger.error(
          `Revocation restore failed — lookups stay on the Postgres mirror and the next ` +
            `miss retries: ${e instanceof Error ? e.message : e}`,
        );
        return false;
      })
      .finally(() => {
        this.restoreInFlight = null;
      });
  }

  /**
   * Copy every unexpired row of the Postgres mirror into Redis, then set the
   * continuity marker — atomically, and only if Redis was not wiped while this
   * ran. Returns whether the marker was set. Throws on a store failure (the
   * caller logs it; the marker stays absent, so lookups keep reading Postgres).
   *
   * Exposed for tests and the boot check; requests use startRevocationRestore.
   */
  async restoreRevocationsFromDurable(): Promise<boolean> {
    if (!this.publisher || !this.prismaService) return false;
    // Everything Redis may have missed before this point is in the mirror
    // this run copies; a miss AFTER it moves the generation on again.
    const startedAtGen = this.revocationSkewGen;
    const runId = randomUUID();
    // Expires on its own if this process dies mid-run; a later run writes its own.
    await this.publisher.set(REVOCATION_RESTORE_RUN_KEY, runId, 'EX', 15 * 60);

    let cursor: string | undefined;
    let restoredUsers = 0;
    let restoredTokens = 0;
    let maxTokenTtlSec = 0;
    for (;;) {
      const nowMs = Date.now();
      const rows = await this.prismaService.client.revokedCredential.findMany({
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(nowMs) } }],
        },
        select: {
          id: true,
          kind: true,
          key: true,
          value: true,
          expiresAt: true,
        },
        orderBy: { id: 'asc' },
        take: RESTORE_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;

      const pipe = this.publisher.pipeline();
      let queued = 0;
      for (const row of rows) {
        const ttlSec = row.expiresAt
          ? Math.ceil((row.expiresAt.getTime() - nowMs) / 1000)
          : Math.ceil(REVOKED_MIRROR_TTL_MS / 1000);
        if (ttlSec <= 0) continue;
        if (row.kind === REVOKED_KIND_USER_INVALID_BEFORE) {
          const epoch = parseInt(row.value ?? '', 10);
          if (!Number.isFinite(epoch)) continue;
          pipe.eval(
            RESTORE_INVALID_BEFORE_LUA,
            1,
            this.tokenInvalidBeforeKey(row.key),
            String(epoch),
            String(ttlSec),
          );
          restoredUsers++;
          queued++;
        } else if (row.kind === REVOKED_KIND_JTI) {
          pipe.sadd(REVOKED_TOKEN_HASH_SET, row.key);
          maxTokenTtlSec = Math.max(maxTokenTtlSec, ttlSec);
          restoredTokens++;
          queued++;
        }
      }
      if (queued > 0) {
        const results = await pipe.exec();
        for (const [err] of results ?? []) {
          if (err) throw err;
        }
      }
      cursor = rows[rows.length - 1].id;
      if (rows.length < RESTORE_PAGE_SIZE) break;
    }

    // Extend-only expiry on the restored-hash set, the same rule `sadd` keeps
    // for `jwt_revoked_list`: never shorten what protects a longer-lived token.
    if (maxTokenTtlSec > 0) {
      const current = await this.publisher.ttl(REVOKED_TOKEN_HASH_SET);
      if (current === -1 || (current >= 0 && current < maxTokenTtlSec)) {
        await this.publisher.expire(REVOKED_TOKEN_HASH_SET, maxTokenTtlSec);
      }
    }

    const marked = await this.publisher.eval(
      MARK_CONTINUITY_LUA,
      2,
      REVOCATION_RESTORE_RUN_KEY,
      REVOCATION_CONTINUITY_KEY,
      runId,
      new Date().toISOString(),
    );
    if (marked === 1) {
      this.revocationTrustedGen = Math.max(
        this.revocationTrustedGen,
        startedAtGen,
      );
      this.logger.log(
        `Revocation continuity restored from the Postgres mirror ` +
          `(${restoredUsers} user markers, ${restoredTokens} revoked tokens)`,
      );
      return true;
    }
    this.logger.warn(
      'Revocation restore finished but Redis was wiped while it ran — marker left absent; ' +
        'the next lookup retries',
    );
    return false;
  }

  /**
   * Boot-time half of F1: restore if the marker is absent, and report an
   * eviction policy that could drop individual revocation keys. Never throws.
   */
  private async checkRevocationContinuityAtBoot(): Promise<void> {
    if (!this.publisher) return;
    try {
      const reply = await this.publisher.config('GET', 'maxmemory-policy');
      const policy: unknown = Array.isArray(reply)
        ? (reply as unknown[])[1]
        : undefined;
      if (typeof policy === 'string' && policy !== 'noeviction') {
        this.logger.error(
          `Redis maxmemory-policy is '${policy}': under memory pressure Redis may evict ` +
            'individual revocation keys without any error, un-revoking those sessions until ' +
            "they expire. Set it to 'noeviction'.",
        );
      }
    } catch {
      // Managed Redis often refuses CONFIG — nothing to report then.
    }
    try {
      if ((await this.publisher.exists(REVOCATION_CONTINUITY_KEY)) !== 1) {
        this.startRevocationRestore('boot');
        await this.restoreInFlight;
      }
    } catch (e) {
      this.logger.warn(
        `Revocation continuity check at boot failed (lookups read Postgres until it passes): ${
          e instanceof Error ? e.message : e
        }`,
      );
    }
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
   * BOTH revocation stores are unreachable. Loud, at warn, ONCE per process
   * — not per request; `RevocationPosture` carries the per-outage counters
   * and the recovery line.
   *
   * SEC-012 changed what happens NEXT, not this log: the lookups now report
   * `indeterminate` instead of answering "not revoked", so every caller
   * fails closed apart from the one named, time-bounded player-continuity
   * read (`security/revocation-posture.ts`).
   */
  private warnRevocationTotalOutage(detail: string): void {
    if (this.warnedRevocationTotalOutage) return;
    this.warnedRevocationTotalOutage = true;
    this.logger.warn(
      'REVOCATION BACKSTOP UNAVAILABLE: Redis AND Postgres are both unreachable ' +
        `(${detail}). Revocation state is INDETERMINATE — every privileged, ` +
        'credential, export and mutation request now fails closed until a store ' +
        'answers. This warning logs once per process.',
    );
  }
}
