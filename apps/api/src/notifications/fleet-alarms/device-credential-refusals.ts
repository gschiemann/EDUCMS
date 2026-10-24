/**
 * Device-credential refusals — the RECORDER (2026-10-23).
 *
 * Called from the two places a screen's device credential is refused:
 *   - the WebSocket HELLO (`realtime.gateway.ts`, `admitDeviceCredential` said
 *     no) — a refused player retries the socket every ≤ 30 s, forever;
 *   - `POST /screens/register` refusing the prior token it was handed
 *     (`screens.controller.ts`, 401 SCREEN_TOKEN_MISMATCH) — once a minute.
 *
 * DESIGN — the simplest thing that is correct on more than one replica:
 *   one Redis SET of DISTINCT screens per minute (`venueos:devcred-refusals:v1:
 *   <minute>`, 20-minute TTL). A refusal is one `SADD` + `PEXPIRE`, at most
 *   once per screen per minute per process (the in-process copy below
 *   deduplicates), fire-and-forget. The leader-leased evaluator
 *   (device-credential-refusal-alarm.service.ts) reads the last 15 sets and
 *   asks, per screen, "refused in every minute (one gap allowed) for 10
 *   minutes?" — no read-modify-write on the hot path, no Lua, nothing to
 *   reconcile, and a deploy or a leader change loses nothing because the sets
 *   are in Redis. Per-replica counts are merged by Redis itself (a set union).
 *   The same sets are kept in-process as well: with no Redis (local dev, a
 *   Redis outage) the evaluator — leader in degraded mode — reads them, which
 *   is exact on one replica, and on the leader they backstop a lost write.
 *
 * WHAT IS NEVER STORED: the token, the fingerprint, the client address. Only
 * `<screenId>|<source>|<category>`. On the socket path the screen id is read
 * from the token's claims WITHOUT verifying it (it was just refused, after
 * all) — so it is a claim, bounded in shape, and the evaluator only counts ids
 * that are real, paired screens without a live push channel.
 *
 * NEVER THROWS, NEVER AWAITS: both callers are on a refusal branch that must
 * stay exactly as fast and as fallible as it was.
 */
import * as jwt from 'jsonwebtoken';
import {
  FLEET_ALARM_RULES,
  deviceCredentialRefusalAlarmDisabled,
  isPlausibleScreenId,
  parseRefusalMember,
  refusalBucketOf,
  refusalCategoryOf,
  refusalMember,
  type RefusalMark,
} from './fleet-alarm-policy';

const KEY_PREFIX = 'venueos:devcred-refusals:v1:';
/** Longer than the evaluator's 15-minute window, with slack for a slow tick. */
const KEY_TTL_MS = 20 * 60_000;
/** Per process per minute — bounds what a token-forging caller can add. */
const MAX_MEMBERS_PER_BUCKET = 2_000;
/** In-process minutes kept (≥ the evaluator's window). */
const MAX_LOCAL_BUCKETS = 20;
/** A device JWT is a few hundred bytes; anything far bigger is not one. */
const MAX_TOKEN_CHARS = 8_192;
/** Bound on the evaluator's Redis read. */
const READ_TIMEOUT_MS = 3_000;

/** The slice of ioredis this file uses. */
interface RefusalRedisClient {
  sadd(key: string, member: string): Promise<unknown>;
  pexpire(key: string, ms: number): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
}

/** `RedisService` (or a test double). Every member is optional on purpose. */
export interface RefusalRedisLike {
  publisher?: unknown;
  isConnected?: () => boolean;
}

function connectedClient(redis: RefusalRedisLike | null | undefined): RefusalRedisClient | null {
  try {
    if (!redis || typeof redis.isConnected !== 'function' || !redis.isConnected()) return null;
    const pub = redis.publisher as Partial<RefusalRedisClient> | null | undefined;
    if (!pub || typeof pub.sadd !== 'function' || typeof pub.pexpire !== 'function' || typeof pub.smembers !== 'function') return null;
    return pub as RefusalRedisClient;
  } catch {
    return null;
  }
}

// ─── In-process copy ──────────────────────────────────────────────────────

const local = new Map<number, Set<string>>();

/** True when this (bucket, member) is new to this process. */
function rememberLocally(bucket: number, member: string): boolean {
  let set = local.get(bucket);
  if (!set) {
    set = new Set();
    local.set(bucket, set);
    if (local.size > MAX_LOCAL_BUCKETS) {
      const keep = [...local.keys()].sort((a, b) => b - a).slice(0, MAX_LOCAL_BUCKETS);
      for (const b of [...local.keys()]) if (!keep.includes(b)) local.delete(b);
    }
  }
  if (set.has(member) || set.size >= MAX_MEMBERS_PER_BUCKET) return false;
  set.add(member);
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────

/** Count one refusal of `screenId`'s credential. Synchronous; never throws. */
export function recordDeviceCredentialRefusal(
  redis: RefusalRedisLike | null | undefined,
  mark: RefusalMark,
  nowMs: number = Date.now(),
): void {
  try {
    if (deviceCredentialRefusalAlarmDisabled()) return;
    const member = refusalMember(mark);
    if (!parseRefusalMember(member)) return;
    const bucket = refusalBucketOf(nowMs);
    if (!rememberLocally(bucket, member)) return;
    const client = connectedClient(redis);
    if (!client) return;
    const key = KEY_PREFIX + bucket;
    // Two commands on one connection run in order: the SADD creates the key,
    // the PEXPIRE bounds it. A lost write costs one bucket, which the run math
    // tolerates (and the leader's in-process copy covers).
    void Promise.resolve(client.sadd(key, member)).catch(() => undefined);
    void Promise.resolve(client.pexpire(key, KEY_TTL_MS)).catch(() => undefined);
  } catch {
    /* a counter must never touch the refusal it counts */
  }
}

/**
 * The screen a REFUSED device token names, read from its claims without
 * verifying them (`jwt.decode`). Null unless it looks like one of our device
 * tokens: `kind: 'device'`, `sub` and `deviceId` agreeing, a plausible id.
 * The token itself goes nowhere.
 */
export function screenIdOfRefusedDeviceToken(token: unknown): string | null {
  try {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS) return null;
    const claims = jwt.decode(token.trim());
    if (!claims || typeof claims !== 'object') return null;
    const c = claims as { kind?: unknown; sub?: unknown; deviceId?: unknown };
    if (c.kind !== 'device') return null;
    const sub = typeof c.sub === 'string' ? c.sub : '';
    const deviceId = typeof c.deviceId === 'string' ? c.deviceId : '';
    if (sub && deviceId && sub !== deviceId) return null;
    const id = sub || deviceId;
    return isPlausibleScreenId(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * The WebSocket HELLO refused this token for `reason` (an
 * `admitDeviceCredential` refusal). Counted only for the reasons
 * `refusalCategoryOf` names. Synchronous; never throws.
 */
export function noteWsDeviceCredentialRefusal(
  redis: RefusalRedisLike | null | undefined,
  reason: unknown,
  token: unknown,
  nowMs: number = Date.now(),
): void {
  try {
    if (deviceCredentialRefusalAlarmDisabled()) return;
    const category = refusalCategoryOf(reason);
    if (!category) return;
    const screenId = screenIdOfRefusedDeviceToken(token);
    if (!screenId) return;
    recordDeviceCredentialRefusal(redis, { screenId, source: 'ws', category }, nowMs);
  } catch {
    /* never */
  }
}

/** `POST /screens/register` is refusing this screen's prior token (401). Never throws. */
export function noteRegisterDeviceCredentialRefusal(
  redis: RefusalRedisLike | null | undefined,
  screenId: unknown,
  nowMs: number = Date.now(),
): void {
  try {
    if (!isPlausibleScreenId(screenId)) return;
    recordDeviceCredentialRefusal(redis, { screenId, source: 'register', category: 'register' }, nowMs);
  } catch {
    /* never */
  }
}

// ─── Reading (the evaluator) ──────────────────────────────────────────────

export interface RefusalBuckets {
  /** Minute index → members, for the evaluator's window. */
  buckets: Map<number, Set<string>>;
  /** True when Redis answered — i.e. every replica's refusals are in here. */
  shared: boolean;
}

/**
 * The last `REFUSAL_WINDOW_BUCKETS` minutes: Redis (every replica) merged
 * with this process's own copy. Never throws; a Redis read that fails or
 * stalls falls back to the in-process copy and says so.
 */
export async function readDeviceCredentialRefusals(
  redis: RefusalRedisLike | null | undefined,
  nowMs: number = Date.now(),
): Promise<RefusalBuckets> {
  const nowBucket = refusalBucketOf(nowMs);
  const range: number[] = [];
  for (let b = nowBucket - FLEET_ALARM_RULES.REFUSAL_WINDOW_BUCKETS + 1; b <= nowBucket; b++) range.push(b);
  const buckets = new Map<number, Set<string>>();
  for (const b of range) {
    const mine = local.get(b);
    if (mine && mine.size) buckets.set(b, new Set(mine));
  }
  const client = connectedClient(redis);
  if (!client) return { buckets, shared: false };
  try {
    const read = Promise.all(range.map((b) => client.smembers(KEY_PREFIX + b)));
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS);
      timer.unref?.();
    });
    const results = await Promise.race([read, timeout]).finally(() => timer && clearTimeout(timer));
    if (!results) return { buckets, shared: false };
    results.forEach((members, i) => {
      if (!Array.isArray(members) || members.length === 0) return;
      const set = buckets.get(range[i]) ?? new Set<string>();
      for (const m of members) if (typeof m === 'string') set.add(m);
      buckets.set(range[i], set);
    });
    return { buckets, shared: true };
  } catch {
    return { buckets, shared: false };
  }
}

/** Test hook. */
export function __resetDeviceCredentialRefusalsForTests(): void {
  local.clear();
}
