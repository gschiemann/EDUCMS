/**
 * emergency-rev.ts — the CHEAP change-detector behind
 * `GET /api/v1/screens/:id/emergency-rev`.
 *
 * WHY THIS EXISTS (efficiency audit 2026-09-02, P0-2 / P0-3).
 * The web player's HTTP emergency backstop fetched the FULL manifest every
 * 10 s (5 s while an alert was up or the push channel was degraded) — a
 * measured 45.5 % of all production API traffic, each request re-running the
 * schedule → playlist → item → asset → template fan-out or at best paying a
 * screen-row + tenant-row read to answer "nothing changed". At 1 000 screens
 * that is ~8 640 full manifest builds per screen per day for a payload that
 * changes a handful of times a week.
 *
 * The fix is a revision token: a short opaque string that changes whenever
 * anything that could alter what this screen should be showing changes. The
 * player polls the revision on the SAME cadence it used to poll the manifest
 * and only pays for a manifest when the revision moves.
 *
 * ── WHAT MOVES THE REVISION ──────────────────────────────────────────────
 *   1. TENANT EMERGENCY EPOCH — bumped SYNCHRONOUSLY by the emergency
 *      controller on trigger / all-clear / SOS / broadcast / media-alert /
 *      message-clear, in the same statement block that invalidates the
 *      tenant hot-cache and immediately BEFORE the Redis fan-out starts.
 *      The life-safety fast path (2026-08-15) dispatches before persistence;
 *      this bump is at least as early, so the HTTP backstop can never be
 *      later than the push it backs up.
 *   2. MANIFEST CONTENT REV — the process-wide counter that the Prisma
 *      `$use` mutation hook already bumps for every write to a manifest-fed
 *      model (manifest-hot-cache.ts). Template / playlist / schedule /
 *      per-screen-override edits therefore move the revision for free, with
 *      no second subscriber on the hook.
 *   3. PER-SCREEN EMERGENCY SIGNATURE — recorded by `getManifest` from the
 *      state it already read (per-screen override + effective tenant alert +
 *      district inheritance). Costs zero extra queries and covers the cases
 *      a tenant-wide epoch cannot see, e.g. a per-screen override that
 *      applies to one wall only.
 *   4. BOUNDARY — the earliest future instant at which the answer changes
 *      with NO write at all: a per-screen override expiring, or a schedule
 *      window opening/closing. Crossing it increments a monotone counter
 *      exactly once, so a 15:00 go-live lands within one poll (≤10 s)
 *      instead of waiting out the manifest reconcile.
 *   5. PROCESS ORIGIN — a per-boot random id. After a deploy every screen
 *      sees one changed revision, fetches once, and settles. Without it the
 *      restarted content counter would replay values a screen had already
 *      applied and a real change could be read as "unchanged".
 *
 * ── FAIL-SAFE DIRECTION ──────────────────────────────────────────────────
 * Every unknown reads as CHANGED, never as unchanged:
 *   • no per-screen record yet (cold process, first poll after a deploy) →
 *     the `cold` sentinel, which differs from every real signature;
 *   • a record older than `SCREEN_RECORD_MAX_AGE_MS` → treated as cold;
 *   • a record whose tenant no longer matches the authenticated screen (the
 *     screen was re-homed) → treated as cold;
 *   • Redis unreachable → the in-process epoch is used, and on the replica
 *     that served the trigger that value is exact (numReplicas = 1 today).
 * A wrong answer in the "changed" direction costs one manifest fetch. A
 * wrong answer in the "unchanged" direction would delay an alert, so the
 * module never produces one from missing data.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
 * It is NOT a second delivery path and it does NOT carry alert content. The
 * two independent emergency paths are unchanged: signed WS/SSE push, and the
 * manifest (still the sole arbiter of lockdown). This module only decides
 * WHEN the second one is worth asking.
 *
 * Pure + framework-free (no Nest, no Prisma, no ioredis import) so it unit
 * tests without a module graph — same shape as manifest-hot-cache.ts, which
 * is why the Redis client arrives as a tiny injected port rather than a DI
 * dependency.
 */

import * as crypto from 'crypto';
import { currentManifestContentRev } from './manifest-hot-cache';

/** Bump when the composition of the revision string changes. */
export const EMERGENCY_REV_SCHEMA = 'r1';

/** Redis key holding a tenant's emergency epoch. Never cross-tenant. */
export const TENANT_EPOCH_REDIS_PREFIX = 'venueos:emrev:t:';

/**
 * Epoch key TTL. Long enough that a quiet tenant's epoch survives any
 * realistic outage window, short enough that a deleted tenant's key does not
 * live forever. A missing key is not a correctness problem — it reads as
 * epoch 0, which differs from whatever the screen last held, so the screen
 * fetches once.
 */
export const TENANT_EPOCH_TTL_SECONDS = 45 * 24 * 60 * 60;

/**
 * How long a Redis epoch read is memoised per tenant.
 *
 * Same 2 s window `getTenantState` already uses on the manifest path, and
 * for the same reason: every screen in a tenant asks the same question at
 * the same cadence. It bounds only CROSS-REPLICA propagation — the local
 * bump is synchronous, so on the replica that served the trigger (the only
 * replica today) the epoch is visible on the very next request.
 */
export const TENANT_EPOCH_MEMO_MS = 2_000;

/** Hard cap on the Redis round trip so a wedged Redis cannot stall a poll. */
export const TENANT_EPOCH_REDIS_TIMEOUT_MS = 2_000;

/**
 * A per-screen record older than this reads as cold (→ the screen fetches).
 * The player reconciles the manifest at least once a minute, which refreshes
 * the record, so in a healthy fleet this never fires; it exists so an
 * out-of-band write (Supabase Studio, a seed script) cannot hide behind a
 * record nothing will ever invalidate.
 */
export const SCREEN_RECORD_MAX_AGE_MS = 5 * 60_000;

const SCREEN_RECORD_MAX_ENTRIES = 5_000;
const TENANT_EPOCH_MAX_ENTRIES = 5_000;

/** Sentinel used when this process cannot vouch for a screen's state. */
export const COLD_SIGNATURE = 'cold';

// ── Types ────────────────────────────────────────────────────────────────

export interface TenantEmergencyEpoch {
  /** Wall-clock ms of the last emergency action on this tenant (0 = never). */
  stamp: number;
  /** Last known tenant-wide alert state. Only ever set by trigger/all-clear. */
  active: boolean;
}

/** The minimal Redis surface this module needs. Never throws. */
export interface EmergencyRevRedis {
  getString(key: string): Promise<string | null>;
  setString(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
}

export interface EmergencyRevDeps {
  redis?: EmergencyRevRedis | null;
}

/** What `getManifest` observed for one screen on its last build. */
export interface ScreenEmergencyRecord {
  tenantId: string | null;
  /** Stable hash of the emergency-relevant state (see `emergencySignature`). */
  sig: string;
  /** Was an alert active for THIS screen on that build? */
  active: boolean;
  /** Earliest future instant that changes the answer with no write. */
  boundaryAt: number | null;
  /** Monotone — one increment per boundary that has fired. */
  boundarySeq: number;
  at: number;
}

/** Inputs to the pure revision hash. */
export interface EmergencyRevInputs {
  originId: string;
  contentRev: number;
  tenantStamp: number;
  tenantActive: boolean;
  /** `null` → the `cold` sentinel. */
  screenSig: string | null;
  boundarySeq: number;
}

// ── Process origin ───────────────────────────────────────────────────────

let originId: string = crypto.randomBytes(4).toString('hex');

/**
 * Random per boot. Makes a restarted process's revision differ from anything
 * a screen already holds, which is what stops the reset content counter from
 * replaying an already-applied value.
 */
export function emergencyRevOriginId(): string {
  return originId;
}

// ── Pure revision algebra ────────────────────────────────────────────────

/**
 * The revision string. Opaque on purpose: a device has no business reading
 * the platform-wide mutation counter or another tenant's epoch out of an
 * ETag, and an opaque token cannot be reasoned about (or depended on) by a
 * client beyond "same or different", which is the whole contract.
 */
export function computeEmergencyRev(i: EmergencyRevInputs): string {
  const material = [
    EMERGENCY_REV_SCHEMA,
    i.originId,
    String(i.contentRev),
    String(i.tenantStamp),
    i.tenantActive ? '1' : '0',
    i.screenSig ?? COLD_SIGNATURE,
    String(i.boundarySeq),
  ].join('|');
  return `${EMERGENCY_REV_SCHEMA}.${crypto.createHash('sha256').update(material).digest('hex').slice(0, 20)}`;
}

/** The emergency-relevant fields of one screen's manifest build. */
export interface EmergencySignatureInput {
  overrideId?: string | null;
  overrideType?: string | null;
  overrideSeverity?: string | null;
  overridePlaylistId?: string | null;
  overrideScopeNote?: string | null;
  overrideExpiresAtMs?: number | null;
  tenantStatus?: string | null;
  tenantType?: string | null;
  tenantPlaylistId?: string | null;
  tenantPortraitPlaylistId?: string | null;
  inheritedFromTenantId?: string | null;
}

/**
 * Stable hash of everything the manifest's emergency branch decides from.
 * Deterministic across processes and replicas: two API pods that read the
 * same rows produce the same signature, so a screen that moves between them
 * does not see phantom changes.
 */
export function emergencySignature(input: EmergencySignatureInput): string {
  const material = [
    input.overrideId ?? '',
    input.overrideType ?? '',
    input.overrideSeverity ?? '',
    input.overridePlaylistId ?? '',
    input.overrideScopeNote ?? '',
    input.overrideExpiresAtMs != null && Number.isFinite(input.overrideExpiresAtMs)
      ? String(Math.floor(input.overrideExpiresAtMs))
      : '',
    input.tenantStatus ?? '',
    input.tenantType ?? '',
    input.tenantPlaylistId ?? '',
    input.tenantPortraitPlaylistId ?? '',
    input.inheritedFromTenantId ?? '',
  ].join('|');
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 12);
}

// ── Per-screen record registry ───────────────────────────────────────────

const screenRecords = new Map<string, ScreenEmergencyRecord>();

function capMap<K, V>(map: Map<K, V>, max: number): void {
  if (map.size <= max) return;
  const oldest = map.keys().next().value;
  if (oldest !== undefined) map.delete(oldest);
}

/**
 * Record what the manifest just decided for this screen.
 *
 * Called from `getManifest` AFTER the per-screen override + tenant emergency
 * state (including district inheritance) are resolved and BEFORE the branch
 * split, so every branch — emergency, scoreboard, normal, empty — records the
 * same fact. Zero extra queries: every input was already read.
 *
 * `boundaryAt` here is the EMERGENCY boundary only (a per-screen override's
 * expiry). The schedule boundary arrives separately from the normal branch,
 * which is the only branch that computes one.
 */
export function noteScreenEmergencyState(
  screenId: string,
  obs: {
    tenantId: string | null;
    sig: string;
    active: boolean;
    boundaryAt?: number | null;
  },
): void {
  const prev = screenRecords.get(screenId);
  const boundaryAt = normalizeBoundary(obs.boundaryAt);
  screenRecords.set(screenId, {
    tenantId: obs.tenantId,
    sig: obs.sig,
    active: obs.active,
    boundaryAt,
    // A record for a DIFFERENT tenant is a re-home: restart the counter so
    // the new tenant's screen never inherits the old one's boundary history.
    boundarySeq: prev && prev.tenantId === obs.tenantId ? prev.boundarySeq : 0,
    at: Date.now(),
  });
  capMap(screenRecords, SCREEN_RECORD_MAX_ENTRIES);
}

/**
 * Merge in the schedule boundary the normal manifest branch computed (the
 * same `boundaryAt` the manifest hot cache stores). Keeps the EARLIEST of the
 * two boundaries — whichever transition lands first is the one that must move
 * the revision.
 */
export function noteScreenScheduleBoundary(screenId: string, boundaryAt: number | null): void {
  const rec = screenRecords.get(screenId);
  if (!rec) return;
  const next = normalizeBoundary(boundaryAt);
  if (next === null) return;
  rec.boundaryAt = rec.boundaryAt === null ? next : Math.min(rec.boundaryAt, next);
}

function normalizeBoundary(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

/**
 * Read a screen's record for revision purposes.
 *
 * Side effect BY DESIGN: a boundary that has fired is CONSUMED here — the
 * monotone `boundarySeq` increments once and the boundary clears. That makes
 * the crossing produce exactly ONE revision change; without it the revision
 * would flip when the boundary passed and flip back when the next manifest
 * build installed a new one, costing two fetches per boundary instead of one.
 *
 * Returns `null` (→ the `cold` sentinel → the screen fetches) when there is
 * no record, when it is older than `SCREEN_RECORD_MAX_AGE_MS`, or when it
 * belongs to a different tenant than the caller authenticated as.
 */
export function readScreenRecord(
  screenId: string,
  tenantId: string | null,
  now: number = Date.now(),
): { sig: string; active: boolean; boundarySeq: number } | null {
  const rec = screenRecords.get(screenId);
  if (!rec) return null;
  if (rec.tenantId !== tenantId) return null;
  if (now - rec.at > SCREEN_RECORD_MAX_AGE_MS) return null;
  if (rec.boundaryAt !== null && now >= rec.boundaryAt) {
    rec.boundarySeq += 1;
    rec.boundaryAt = null;
  }
  return { sig: rec.sig, active: rec.active, boundarySeq: rec.boundarySeq };
}

/** Test/diagnostic read that never consumes a boundary. */
export function peekScreenRecord(screenId: string): ScreenEmergencyRecord | undefined {
  return screenRecords.get(screenId);
}

// ── Tenant emergency epoch ───────────────────────────────────────────────

const localTenantEpochs = new Map<string, TenantEmergencyEpoch>();
const tenantEpochMemo = new Map<string, { value: TenantEmergencyEpoch; at: number }>();

export function localTenantEmergencyEpoch(tenantId: string): TenantEmergencyEpoch | undefined {
  return localTenantEpochs.get(tenantId);
}

function serializeEpoch(e: TenantEmergencyEpoch): string {
  return `${e.stamp}:${e.active ? 1 : 0}`;
}

/** Tolerant parser — a malformed value reads as "no epoch", never as fresh. */
export function parseEpoch(raw: string | null | undefined): TenantEmergencyEpoch | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const [stampRaw, activeRaw] = raw.split(':');
  // `Number('')` is 0, so an empty or whitespace-only stamp would otherwise
  // parse as a valid epoch-0 and outrank nothing — reject it explicitly.
  if (!stampRaw || !/^\d+$/.test(stampRaw)) return null;
  const stamp = Number(stampRaw);
  if (!Number.isFinite(stamp) || stamp < 0) return null;
  return { stamp: Math.floor(stamp), active: activeRaw === '1' };
}

/** The newer of two epochs. Ties keep `a` (the local, already-applied one). */
export function pickNewerEpoch(
  a: TenantEmergencyEpoch | null,
  b: TenantEmergencyEpoch | null,
): TenantEmergencyEpoch {
  if (!a && !b) return { stamp: 0, active: false };
  if (!a) return b as TenantEmergencyEpoch;
  if (!b) return a;
  return b.stamp > a.stamp ? b : a;
}

/**
 * Move a tenant's emergency epoch. SYNCHRONOUS by contract.
 *
 * The local write lands before this function returns, so a caller can place
 * it beside `invalidateTenantState(...)` — i.e. before the Redis fan-out is
 * even constructed — and be certain the HTTP backstop cannot report a stale
 * revision after the push has gone out. The Redis mirror is fire-and-forget:
 * a Redis outage must never be able to delay or fail an emergency dispatch,
 * and on this replica the local value is already authoritative.
 *
 * @param active `true` on trigger, `false` on all-clear, and OMITTED for
 *   changes that move the epoch without changing tenant-wide alert state
 *   (group/device-scoped triggers, pushed SOS/broadcast/media-alert
 *   messages) — those keep whatever the last trigger/all-clear asserted.
 */
export function bumpTenantEmergencyEpoch(
  deps: EmergencyRevDeps,
  tenantId: string,
  opts: { active?: boolean } = {},
): TenantEmergencyEpoch {
  if (!tenantId) return { stamp: 0, active: false };
  const prev = localTenantEpochs.get(tenantId);
  // Strictly monotone even for two bumps inside one millisecond — a
  // trigger immediately followed by an all-clear must not collapse.
  const stamp = Math.max(Date.now(), (prev?.stamp ?? 0) + 1);
  const next: TenantEmergencyEpoch = {
    stamp,
    active: opts.active === undefined ? (prev?.active ?? false) : opts.active,
  };
  localTenantEpochs.set(tenantId, next);
  capMap(localTenantEpochs, TENANT_EPOCH_MAX_ENTRIES);
  // Drop the read memo so this replica's very next poll sees the new value
  // without waiting out TENANT_EPOCH_MEMO_MS.
  tenantEpochMemo.delete(tenantId);

  const redis = deps.redis;
  if (redis) {
    void Promise.resolve()
      .then(() =>
        redis.setString(
          `${TENANT_EPOCH_REDIS_PREFIX}${tenantId}`,
          serializeEpoch(next),
          TENANT_EPOCH_TTL_SECONDS,
        ),
      )
      .catch(() => {
        /* mirror is best-effort; the local epoch is authoritative here */
      });
  }
  return next;
}

/**
 * Read a tenant's epoch: the newer of the in-process value and the Redis
 * mirror, memoised for `TENANT_EPOCH_MEMO_MS`.
 *
 * Never throws and never reads Postgres. A Redis failure degrades to the
 * in-process value, which is exact on the replica that served the trigger.
 */
export async function readTenantEmergencyEpoch(
  deps: EmergencyRevDeps,
  tenantId: string,
  now: number = Date.now(),
): Promise<TenantEmergencyEpoch> {
  if (!tenantId) return { stamp: 0, active: false };
  const memo = tenantEpochMemo.get(tenantId);
  if (memo && now - memo.at < TENANT_EPOCH_MEMO_MS) return memo.value;

  const local = localTenantEpochs.get(tenantId) ?? null;
  let remote: TenantEmergencyEpoch | null = null;
  const redis = deps.redis;
  if (redis) {
    try {
      const raw = await withTimeout(
        redis.getString(`${TENANT_EPOCH_REDIS_PREFIX}${tenantId}`),
        TENANT_EPOCH_REDIS_TIMEOUT_MS,
      );
      remote = parseEpoch(raw);
    } catch {
      remote = null;
    }
  }

  const value = pickNewerEpoch(local, remote);
  // Keep the local map in step so a later bump increments from the newest
  // known stamp rather than from a stale local one.
  if (remote && (!local || remote.stamp > local.stamp)) {
    localTenantEpochs.set(tenantId, remote);
    capMap(localTenantEpochs, TENANT_EPOCH_MAX_ENTRIES);
  }
  tenantEpochMemo.set(tenantId, { value, at: now });
  capMap(tenantEpochMemo, TENANT_EPOCH_MAX_ENTRIES);
  return value;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Composition ──────────────────────────────────────────────────────────

export interface EmergencyRevAnswer {
  rev: string;
  /** Server's last-known alert state for this screen. False when unknown. */
  active: boolean;
  /** Diagnostics only — never sent to a device. */
  cold: boolean;
}

/**
 * Build the answer for one screen. Reads Redis at most once (memoised) and
 * Postgres NEVER — that is the whole point of the endpoint.
 */
export async function resolveEmergencyRev(
  deps: EmergencyRevDeps,
  screenId: string,
  tenantId: string | null,
  now: number = Date.now(),
): Promise<EmergencyRevAnswer> {
  const epoch = tenantId
    ? await readTenantEmergencyEpoch(deps, tenantId, now)
    : { stamp: 0, active: false };
  const record = readScreenRecord(screenId, tenantId, now);
  const rev = computeEmergencyRev({
    originId: emergencyRevOriginId(),
    contentRev: currentManifestContentRev(),
    tenantStamp: epoch.stamp,
    tenantActive: epoch.active,
    screenSig: record?.sig ?? null,
    boundarySeq: record?.boundarySeq ?? 0,
  });
  return {
    rev,
    active: epoch.active || (record?.active ?? false),
    cold: record === null,
  };
}

/** Full reset of module state between spec cases. */
export function resetEmergencyRevForTests(nextOriginId = 'testorigin'): void {
  screenRecords.clear();
  localTenantEpochs.clear();
  tenantEpochMemo.clear();
  originId = nextOriginId;
}
