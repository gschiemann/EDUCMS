import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { hostname } from 'os';
import { randomBytes } from 'crypto';
import { RedisService } from './redis.service';

/**
 * LeaderLeaseService — the one cluster-singleton primitive for this API.
 *
 * WHY (efficiency/scale audit 2026-09-02, finding L3): the API runs ~20
 * `setInterval` background workers inside a single process. On ONE replica
 * that is fine. On TWO it is not: every one of them fires twice — duplicate
 * offline-screen notifications, duplicate POS catalog pulls, duplicate
 * proof-of-play rows in a customer-facing billing report, two REFRESH_WEB
 * reboots at the same wedged screen, two horns in a live stadium, and a
 * canary OTA promoted twice. Replicas are the obvious scale lever for
 * emergency delivery, so the workers have to become replica-safe BEFORE the
 * second replica exists.
 *
 * WHAT: a named lease in Redis. Exactly one process holds `name` at a time;
 * the holder renews it in the background and releases it cleanly on
 * shutdown. Each fresh acquisition carries a strictly-increasing FENCING
 * TOKEN, so a tick that started under one leadership can tell it is stale
 * before it writes.
 *
 * ── BINDING RULES (do not weaken) ──────────────────────────────────────
 *
 * 1. NO LEASE FAILURE MAY STOP WORK. When Redis is absent (single-replica
 *    installs, local dev) or unreachable, `tryAcquire` returns
 *    `{ leader: true, degraded: true }` — "assume leadership" — and says so
 *    in the log. It NEVER degrades to "do nothing": a missing Redis must not
 *    silently stop the offline scanner, the license reconcile or the proof-
 *    of-play sampler, which is exactly today's behaviour on every deploy
 *    that has no Redis plugin (CLAUDE.md: "Redis missing → API boots
 *    anyway"). The cost of degraded mode is that two replicas may both act —
 *    i.e. precisely today's pre-lease behaviour, no worse.
 *
 * 2. NOTHING ON AN EMERGENCY PATH TAKES A LEASE. Trigger, all-clear, the
 *    Redis fan-out, the SSE/WS backstops and the manifest are untouched by
 *    this file. A lease is for periodic BACKGROUND work only.
 *
 * 3. PER-PROCESS WORK NEVER TAKES A LEASE. SSE keepalive, the SSE revocation
 *    sweep, the efficiency-metrics flush, the time-sync sampler, the storage
 *    watchdog and the platform health monitor all operate on state that only
 *    THIS process has (its own sockets, its own counters, its own clock, its
 *    own reachability). Leader-gating any of them would silently disable the
 *    thing on every follower — including two health probes whose entire job
 *    is to notice that THIS replica cannot reach Postgres. See the table in
 *    `docs/research/2026-09-02-efficiency-audit/1H-multi-replica.md`.
 *
 * 4. A LOST LEASE MID-TICK MUST NOT CORRUPT ANYTHING. Ticks are either
 *    idempotent or fence-checked: call `holdsFence(name, fence)` before a
 *    write that must not be duplicated and bail when it returns false.
 *
 * ── MECHANICS ──────────────────────────────────────────────────────────
 * Key `venueos:lease:<name>` holds `<ownerId>|<fence>` with a PX TTL. The
 * acquire-or-renew is a single Lua script so it is atomic (SET NX PX on a
 * free key; PEXPIRE when we already own it; refuse otherwise) and costs one
 * round trip. `venueos:lease-fence:<name>` is INCR'd only on a genuine
 * acquisition, so fences are strictly increasing across ownership changes
 * (gapless is not required, monotonic is).
 *
 * Leadership is STICKY: a background heartbeat renews every held lease at
 * ttl/3 so the same replica keeps the worker between ticks. That matters for
 * workers with per-process state (the offline scanner's healthy→offline
 * baseline) — bouncing those between replicas would re-seed the baseline and
 * lose crossings. The trade-off is that the first replica to boot tends to
 * own most leases; these workers are small next to the player loop, and
 * spreading them is a later refinement, not a correctness issue.
 */

/**
 * Every cluster-singleton lease in the API, in one place.
 *
 * A worker that does NOT appear here runs on every replica ON PURPOSE (it is
 * per-process or per-connection work, or it already claims its own rows
 * atomically). The reasoning for each is in the per-worker table in
 * `docs/research/2026-09-02-efficiency-audit/1H-multi-replica.md`; do not add
 * or remove an entry without updating it.
 */
export const LEASE = {
  PROOF_OF_PLAY_SAMPLE: 'proof-of-play:sample',
  PROOF_OF_PLAY_PURGE: 'proof-of-play:purge',
  PROOF_OF_PLAY_ROLLUP: 'proof-of-play:rollup',
  LICENSE_RECONCILE: 'billing:license-reconcile',
  EFFICIENCY_ALERTING: 'efficiency:alerting',
  GEOCODE_AUTOHEAL: 'geocode:autoheal',
  CLEVER_SYNC: 'integrations:clever-sync',
  // 2026-09-12 — Instagram / Facebook Page post-cache refresh. Leased for the
  // same reason POS_SYNC is: two replicas polling Meta hourly per tenant is
  // the fastest route to a throttled Graph quota on the customer's account.
  SOCIAL_SYNC: 'integrations:social-sync',
  OFFLINE_SCREEN_SCAN: 'notifications:offline-scan',
  CANARY_AUTO_PROMOTE: 'player-ota:canary-auto-promote',
  POS_SYNC: 'pos:sync',
  FLEET_PULSE: 'screens:fleet-pulse',
  SCREEN_WEDGE_DETECTOR: 'screens:wedge-detector',
  SPORTS_CLOCK_ADVANCE: 'sports:clock-advance',
  // 2026-09-15 — design-import staging sweep. Leased because the work is a
  // DELETE against shared object storage: two replicas racing the same keys
  // would each see the other's 404s and log failures for work that succeeded.
  IMPORT_STAGING_SWEEP: 'imports:staging-sweep',
  // 2026-09-22 — daily AI model catalog sync. Leased because it WRITES the one shared catalog row
  // and spends a canary call per new model: two replicas would double both and race the write.
  AI_MODEL_SYNC: 'ai:model-sync',
  // 2026-09-24 — hourly re-probe of videos with no current encode facts. Leased because every
  // candidate costs a storage read + ffprobe (+ a poster grab): two replicas would spend it twice
  // and race the same rows' processingMeta merge.
  VIDEO_PROBE_AUTOHEAL: 'storage:video-probe-autoheal',
  // 2026-09-26 — the pending-media publication sweep (15 s tick). Every write it
  // makes is claim-guarded, so a second replica would be safe but wasteful: it
  // would scan the same rows every tick and re-queue the same rendition jobs.
  MEDIA_PUBLICATION_SWEEP: 'schedules:media-publication-sweep',
} as const;

export type LeaseName = (typeof LEASE)[keyof typeof LEASE];

/** Result of an acquire attempt. `leader` is the only thing a worker gates on. */
export interface LeaseStatus {
  /** Lease name, as passed to `tryAcquire`. */
  readonly name: string;
  /** May this process do the work this tick? */
  readonly leader: boolean;
  /** True when leadership was ASSUMED because Redis is unavailable. */
  readonly degraded: boolean;
  /**
   * Fencing token for this leadership term. Strictly increases every time
   * ownership changes. 0 in degraded mode (there is no cluster to fence).
   */
  readonly fence: number;
}

/**
 * The two-line call every leased worker makes at the top of its tick.
 *
 * Workers inject `LeaderLeaseService` as `@Optional()` so the many specs that
 * construct them bare (`new PosSyncCron(prisma, svc)`) keep working. A missing
 * service is treated exactly like an unreachable Redis: DEGRADED LEADER — the
 * work still happens. That is binding rule 1 in one place instead of thirteen.
 */
export async function leadThisTick(
  lease: LeaderLeaseService | undefined,
  name: string,
  opts?: { ttlMs?: number },
): Promise<LeaseStatus> {
  if (!lease) {
    warnUnwired(name);
    return { name, leader: true, degraded: true, fence: 0 };
  }
  return lease.tryAcquire(name, opts);
}

const unwiredWarned = new Set<string>();
const unwiredLogger = new Logger('LeaderLease');

/**
 * A worker running with NO lease service injected is running unleased. In a
 * spec that is expected; in the real app it means the provider did not
 * resolve, and the only symptom would otherwise be duplicate work on a
 * second replica with nothing in the log. Say it once, per worker.
 */
function warnUnwired(name: string): void {
  if (process.env.NODE_ENV === 'test') return;
  if (unwiredWarned.has(name)) return;
  unwiredWarned.add(name);
  unwiredLogger.warn(
    `Worker '${name}' has no LeaderLeaseService injected — it will run on EVERY replica. ` +
      'Expected in unit tests; in the app it means DI did not resolve the (global) provider.',
  );
}

interface HeldLease {
  fence: number;
  ttlMs: number;
  degraded: boolean;
  /** When Redis last confirmed this lease (acquire or heartbeat). */
  confirmedAt: number;
}

/** Default lease lifetime. Failover lands within one TTL of a leader dying. */
export const DEFAULT_LEASE_TTL_MS = 30_000;
/** Lower bound — a TTL under this cannot survive normal GC/event-loop jitter. */
const MIN_LEASE_TTL_MS = 5_000;
/** How often the heartbeat renews held leases, as a fraction of the TTL. */
const HEARTBEAT_DIVISOR = 3;
/** Re-log the degraded state at most this often, per lease. */
const DEGRADED_RELOG_MS = 10 * 60_000;

const LEASE_KEY_PREFIX = 'venueos:lease:';
const FENCE_KEY_PREFIX = 'venueos:lease-fence:';

/**
 * KEYS[1] lease key · KEYS[2] fence key · ARGV[1] ownerId · ARGV[2] ttlMs.
 * Returns the stored `<owner>|<fence>` when we hold it, '' when someone else does.
 */
const ACQUIRE_OR_RENEW_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local sep = string.find(cur, '|', 1, true)
  local owner = cur
  if sep then owner = string.sub(cur, 1, sep - 1) end
  if owner == ARGV[1] then
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
    return cur
  end
  return ''
end
local fence = redis.call('INCR', KEYS[2])
local val = ARGV[1] .. '|' .. fence
redis.call('SET', KEYS[1], val, 'PX', ARGV[2])
return val
`;

/** Renew ONLY — never acquires. Returns 1 when we still hold it. */
const RENEW_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local sep = string.find(cur, '|', 1, true)
  local owner = cur
  if sep then owner = string.sub(cur, 1, sep - 1) end
  if owner == ARGV[1] then
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
    return 1
  end
end
return 0
`;

/** Fenced release — only the owner may delete. Returns 1 when it did. */
const RELEASE_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local sep = string.find(cur, '|', 1, true)
  local owner = cur
  if sep then owner = string.sub(cur, 1, sep - 1) end
  if owner == ARGV[1] then
    redis.call('DEL', KEYS[1])
    return 1
  end
end
return 0
`;

/** The single ioredis method this service needs. Keeps the file free of `any`. */
interface EvalCapableClient {
  status: string;
  eval(
    script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

@Injectable()
export class LeaderLeaseService implements OnModuleDestroy {
  private readonly logger = new Logger(LeaderLeaseService.name);

  /**
   * Identifies THIS process across the cluster. Must not contain '|' — the
   * lease value is `<ownerId>|<fence>` and the Lua splits on the first one.
   */
  readonly ownerId: string;

  private readonly held = new Map<string, HeldLease>();
  /** name → when we last saw ANOTHER process holding it (stand-down cache). */
  private readonly stoodDownAt = new Map<string, number>();
  private readonly degradedLoggedAt = new Map<string, number>();
  private heartbeat: NodeJS.Timeout | null = null;
  private heartbeatEveryMs = DEFAULT_LEASE_TTL_MS / HEARTBEAT_DIVISOR;
  private destroyed = false;

  // @Optional so a spec can construct the service bare, and so a module
  // wired without RealtimeModule still boots (degraded, never dead).
  constructor(@Optional() private readonly redisService?: RedisService) {
    const host = hostname().replace(/[^A-Za-z0-9._-]/g, '') || 'api';
    this.ownerId = `${host}-${process.pid}-${randomBytes(4).toString('hex')}`;
  }

  /** The ioredis client, or null when Redis is absent / not yet connected. */
  private client(): EvalCapableClient | null {
    const publisher = this.redisService?.publisher;
    if (!publisher) return null;
    const candidate = publisher as unknown as EvalCapableClient;
    if (candidate.status !== 'ready') return null;
    return candidate;
  }

  /**
   * Take (or keep) the named lease. NEVER throws.
   *
   * Returns `leader: true, degraded: true` when Redis cannot answer — see
   * binding rule 1. Call this at the TOP of a worker tick and return early
   * when `leader` is false.
   */
  async tryAcquire(name: string, opts?: { ttlMs?: number }): Promise<LeaseStatus> {
    const ttlMs = Math.max(MIN_LEASE_TTL_MS, Math.floor(opts?.ttlMs ?? DEFAULT_LEASE_TTL_MS));
    if (this.destroyed) return { name, leader: false, degraded: false, fence: 0 };

    // ── Round-trip damper ────────────────────────────────────────────
    // Some leased workers tick at 1 Hz. Leadership is already tracked
    // continuously by the heartbeat (which DELETES the record the moment a
    // renewal fails), so within one heartbeat interval the local record is
    // as authoritative as a fresh call and one Redis round trip per tick per
    // replica is pure waste. A stand-down answer is cached for the same
    // window, which bounds how long a follower can keep believing a dead
    // leader — at most heartbeat + TTL.
    const damperMs = Math.floor(ttlMs / HEARTBEAT_DIVISOR);
    const now = Date.now();
    const mine = this.held.get(name);
    if (mine && !mine.degraded && now - mine.confirmedAt < damperMs) {
      return { name, leader: true, degraded: false, fence: mine.fence };
    }
    if (now - (this.stoodDownAt.get(name) ?? 0) < damperMs) {
      return { name, leader: false, degraded: false, fence: 0 };
    }

    const client = this.client();
    if (!client) return this.assumeLeadership(name, ttlMs, 'Redis is not connected');

    let raw: unknown;
    try {
      raw = await client.eval(
        ACQUIRE_OR_RENEW_LUA,
        2,
        LEASE_KEY_PREFIX + name,
        FENCE_KEY_PREFIX + name,
        this.ownerId,
        ttlMs,
      );
    } catch (e) {
      return this.assumeLeadership(
        name,
        ttlMs,
        `Redis lease call failed (${e instanceof Error ? e.message : String(e)})`,
      );
    }

    const value = typeof raw === 'string' ? raw : '';
    if (!value) {
      // Somebody else holds it. Drop any stale local record so `holdsFence`
      // cannot keep saying yes after we lost the term.
      this.held.delete(name);
      this.stoodDownAt.set(name, Date.now());
      return { name, leader: false, degraded: false, fence: 0 };
    }

    const fence = Number(value.slice(value.indexOf('|') + 1));
    const record: HeldLease = {
      fence: Number.isFinite(fence) ? fence : 0,
      ttlMs,
      degraded: false,
      confirmedAt: Date.now(),
    };
    const previous = this.held.get(name);
    this.held.set(name, record);
    this.stoodDownAt.delete(name);
    this.degradedLoggedAt.delete(name);
    this.armHeartbeat(ttlMs);
    if (!previous || previous.degraded || previous.fence !== record.fence) {
      this.logger.log(`Leader lease acquired: ${name} (fence ${record.fence}, ttl ${ttlMs}ms)`);
    }
    return { name, leader: true, degraded: false, fence: record.fence };
  }

  /**
   * Does this process still believe it holds `name` under `fence`?
   *
   * Synchronous and in-process on purpose: it is meant to be called between
   * the read and the write of a tick, where an extra Redis round trip would
   * be its own failure mode. It answers "has my leadership term ended that I
   * know of" — a term that ended in the last heartbeat interval may not have
   * been noticed yet, which is why fence-checking is a belt on top of
   * idempotent writes, not a substitute for them.
   *
   * Degraded mode always returns true: there is no cluster to be fenced by.
   */
  holdsFence(name: string, fence: number): boolean {
    const record = this.held.get(name);
    if (!record) return false;
    if (record.degraded) return true;
    return record.fence === fence;
  }

  /**
   * Run `fn` only when this process leads `name`. Returns `undefined` when
   * it does not. `fn`'s own errors propagate — the caller keeps its existing
   * try/catch and logging.
   */
  async runExclusive<T>(
    name: string,
    fn: (status: LeaseStatus) => Promise<T>,
    opts?: { ttlMs?: number },
  ): Promise<T | undefined> {
    const status = await this.tryAcquire(name, opts);
    if (!status.leader) return undefined;
    return fn(status);
  }

  /** Release a lease we hold (fenced DEL). Never throws. */
  async release(name: string): Promise<void> {
    const record = this.held.get(name);
    this.held.delete(name);
    if (!record || record.degraded) return;
    const client = this.client();
    if (!client) return;
    try {
      await client.eval(RELEASE_LUA, 1, LEASE_KEY_PREFIX + name, this.ownerId);
    } catch {
      // Best-effort: the TTL expires the lease shortly anyway.
    }
  }

  /** Names this process currently holds. Diagnostics + tests. */
  heldNames(): string[] {
    return [...this.held.keys()];
  }

  /**
   * Clean shutdown: stop heartbeating and hand every lease back immediately,
   * so a rolling deploy fails over in milliseconds instead of one TTL.
   */
  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    await Promise.all([...this.held.keys()].map((name) => this.release(name)));
  }

  // ── internals ────────────────────────────────────────────────────────

  /** Redis cannot answer → assume leadership (binding rule 1) and say so. */
  private assumeLeadership(name: string, ttlMs: number, why: string): LeaseStatus {
    this.held.set(name, { fence: 0, ttlMs, degraded: true, confirmedAt: Date.now() });
    this.stoodDownAt.delete(name);
    const now = Date.now();
    const lastLogged = this.degradedLoggedAt.get(name) ?? 0;
    if (now - lastLogged > DEGRADED_RELOG_MS) {
      this.degradedLoggedAt.set(name, now);
      this.logger.warn(
        `Leader lease '${name}' DEGRADED — ${why}; assuming leadership so the worker keeps ` +
          'running. On a single replica this is correct; on more than one, expect duplicate work ' +
          'until Redis returns.',
      );
    }
    return { name, leader: true, degraded: true, fence: 0 };
  }

  /** One timer renews every held lease. Re-armed when a shorter TTL appears. */
  private armHeartbeat(ttlMs: number): void {
    const everyMs = Math.max(1_000, Math.floor(ttlMs / HEARTBEAT_DIVISOR));
    if (this.heartbeat && everyMs >= this.heartbeatEveryMs) return;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeatEveryMs = everyMs;
    this.heartbeat = setInterval(() => void this.renewAll(), everyMs);
    this.heartbeat.unref?.();
  }

  /** Refresh the TTL on every lease we hold. Losing one just drops the record. */
  private async renewAll(): Promise<void> {
    if (this.destroyed || this.held.size === 0) return;
    const client = this.client();
    if (!client) return; // Redis went away — degraded mode handles the next tick.
    for (const [name, record] of [...this.held.entries()]) {
      if (record.degraded) continue;
      try {
        const ok = await client.eval(
          RENEW_LUA,
          1,
          LEASE_KEY_PREFIX + name,
          this.ownerId,
          record.ttlMs,
        );
        if (ok === 1) {
          record.confirmedAt = Date.now();
        } else {
          this.held.delete(name);
          this.stoodDownAt.set(name, Date.now());
          this.logger.warn(
            `Leader lease '${name}' LOST (fence ${record.fence}) — another replica holds it now; ` +
              'this process stands down until it can re-acquire.',
          );
        }
      } catch {
        // Transient Redis error: keep the record. The lease TTL is the
        // backstop — if we truly cannot renew, it expires and the next
        // tryAcquire either re-acquires or stands down.
      }
    }
  }
}
