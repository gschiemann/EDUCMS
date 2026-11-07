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
import { currentManifestContentRev, tenantStateEpoch } from './manifest-hot-cache';

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
  /**
   * The RAISE fast-path descriptor for this epoch, or null.
   *
   * Travels WITH the stamp — one value, one Redis key, one `pickNewerEpoch`
   * decision — so a descriptor can never be paired with an epoch it did not
   * come from. See {@link EmergencyAlertDescriptor}.
   */
  alert?: EmergencyAlertDescriptor | null;
}

/**
 * ── THE RAISE FAST PATH (P0-7 #2, 2026-09-05) ────────────────────────────
 *
 * MEASURED (1,000-screen load test 2026-09-04, `P0-7-load-test.md` §5.6).
 * With Redis stopped the alert still reached 1000/1000 screens — but at
 * **p50 7 572 ms / p95 21 653 ms / max 45 131 ms**, against p95 343 ms with
 * push alive; the all-clear was worse (p50 13 650 / p95 30 669). Nothing was
 * erroring: 4 258 requests / 0 errors through the outage, `emergency-rev`
 * p95 33 ms, `manifest` p95 49 ms. The cost was the HERD — with the bus gone
 * every screen drops to the degraded cadence, notices the revision move
 * within ~5 s, and all 1 000 then pull a FULL emergency manifest (live screen
 * row + per-screen override + playlist + items + assets, a branch that is
 * deliberately never cached) inside a few seconds of each other. The API ran
 * CPU p50 228 % / max 775 % of 10 cores through that window; the queueing IS
 * the 21.6 s.
 *
 * THE FIX. The revision poll is a round trip the player is ALREADY making,
 * and it is cheap (zero Postgres, by contract). So the 200 body now carries
 * the same flat descriptor the manifest's emergency branch emits — the exact
 * object the player stores as `activeEmergency` and already hydrates from
 * `edu_emergency_cache_v1` on a cold boot — captured at TRIGGER time, held in
 * process, and mirrored inside the epoch value that was already being written
 * to Redis. Serving it costs no query and no extra round trip.
 *
 * ── WHAT KEEPS THIS SAFE ─────────────────────────────────────────────────
 * 1. **RAISE ONLY.** There is no "clear" descriptor and the player must never
 *    read absence as an all-clear (CLAUDE.md player rule 11). The manifest
 *    remains the sole arbiter that RELEASES an alert. Deleting this feature
 *    entirely would slow raises back down and change nothing else.
 * 2. **Never overrides a live alert.** `resolveEmergencyRev` withholds the
 *    descriptor when this screen's last manifest build already recorded an
 *    active alert, so a per-screen override (which a tenant-wide descriptor
 *    cannot see) can never be replaced by the tenant-wide one.
 * 3. **Tenant scope only.** A group- or device-scoped trigger stores NO
 *    descriptor: this module cannot evaluate group membership without a
 *    query, and lighting up a whole tenant for a one-wall incident is the one
 *    mistake a life-safety fast path must not make. Those triggers keep
 *    today's behaviour exactly (epoch bump → manifest fetch → alert).
 * 4. **It travels with its epoch.** A later bump that carries no descriptor
 *    (an all-clear) replaces the value wholesale, so a stale descriptor
 *    cannot outlive the state it described.
 * 5. **Signed at the response boundary, not stored signed.** The controller
 *    mints a fresh `WebsocketSignerService` envelope per response, so the
 *    player runs it through the SAME `checkSensitivePush` gate a WS/SSE push
 *    clears rather than through a bespoke trust rule.
 * 6. **Only what the DATABASE confirms is signed (2026-11-01).** The epoch is
 *    read from Redis, and Redis is shared mutable state that anyone holding
 *    `REDIS_URL` can write — it was in the 2026-10-21 Railway environment
 *    leak. Before this rule the endpoint turned any planted
 *    `<stamp>:1:<descriptor>` into a correctly HMAC-signed OVERRIDE for every
 *    screen of that tenant, with no signing key: a signing oracle. Now a
 *    descriptor is offered only when the manifest's own read of the tenant
 *    (`tenant-emergency-state.ts`) confirms a live tenant-wide alert with the
 *    same type, severity and drill flag, and no per-screen note or expiry
 *    (a tenant-scoped trigger writes neither). The read is bounded
 *    (`RAISE_CONFIRM_TIMEOUT_MS`), single-flight and cached per tenant, and
 *    runs only inside the raise window, never on the 304 path. Unreadable,
 *    slow or disagreeing → NO descriptor; `active` is untouched, so the
 *    player still learns an alert is up and fetches the manifest — the
 *    unchanged source of truth. Authenticity is closed; availability
 *    degrades only to the manifest path. A refusal is evidence: see
 *    `classifyDescriptorRefusal`.
 */
export interface EmergencyAlertDescriptor {
  /** `manifest.emergencyType` — the incident type ("LOCKDOWN", "EVACUATE"…). */
  type: string;
  /** `manifest.emergencySeverity`. */
  severity: string;
  /** `manifest.emergencyScopeNote`. Always null on the tenant-wide path. */
  scopeNote: string | null;
  /** `manifest.emergencyScope`. Only ever 'tenant' here — see rule 3 above. */
  scope: 'tenant';
  /** `manifest.emergencyExpiresAt` (UNIX seconds). Null tenant-wide. */
  expiresAt: number | null;
  /**
   * `manifest.isDrill` (2026-10-10). Present and `true` only for a DRILL, so
   * a live descriptor is byte-for-byte what it was; the player reads
   * `=== true` and paints its drill banner from the raise alone.
   */
  isDrill?: true;
}

/**
 * Hard cap on the serialized descriptor. It is read back from Redis, which is
 * shared mutable state, so the parser must be able to refuse a value that is
 * not the small object this module writes.
 */
export const ALERT_DESCRIPTOR_MAX_BYTES = 2048;

/**
 * Accept only the exact shape above, from any source (in-process or Redis).
 * Anything else reads as "no descriptor" — i.e. the pre-2026-09-05 behaviour,
 * which is the safe direction: the screen fetches the manifest.
 */
/**
 * Kill switch: `EMERGENCY_REV_RAISE=off` (also `0` / `false`) stops the rev
 * endpoint attaching a descriptor to any response, reverting delivery exactly
 * to the pre-2026-09-05 shape (revision moves → manifest fetch → alert).
 *
 * SUBTRACTIVE ONLY, on purpose — the same rule `PLAYER_APK_STORAGE_REDIRECT`
 * follows. It can remove a delivery option, never add or pin one, so a stale
 * or typo'd value can only ever make raises SLOWER, never wrong and never
 * missing. Anything other than the three off-values leaves it ON, which is the
 * direction a misconfiguration on a life-safety path has to fail.
 *
 * Read per call rather than cached at import so a spec (and the A/B run that
 * measured this) can flip it without a module reset.
 */
export function emergencyRevRaiseEnabled(): boolean {
  const raw = (process.env.EMERGENCY_REV_RAISE || '').trim().toLowerCase();
  return !(raw === 'off' || raw === '0' || raw === 'false');
}

export function sanitizeAlertDescriptor(value: unknown): EmergencyAlertDescriptor | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const str = (x: unknown, max: number): string | null =>
    typeof x === 'string' && x.length > 0 && x.length <= max ? x : null;
  const type = str(v.type, 64);
  const severity = str(v.severity, 64);
  if (!type || !severity) return null;
  if (v.scope !== 'tenant') return null;
  const scopeNote = str(v.scopeNote, 512);
  const expiresAt =
    typeof v.expiresAt === 'number' && Number.isFinite(v.expiresAt) && v.expiresAt > 0
      ? Math.floor(v.expiresAt)
      : null;
  return {
    type,
    severity,
    scopeNote,
    scope: 'tenant',
    expiresAt,
    // Only the literal `true` survives the round trip through Redis.
    ...(v.isDrill === true ? { isDrill: true as const } : {}),
  };
}

/** The minimal Redis surface this module needs. Never throws. */
export interface EmergencyRevRedis {
  getString(key: string): Promise<string | null>;
  setString(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
}

/**
 * The tenant-wide alert as the DATABASE has it (rule 6 above) — produced by
 * `tenant-emergency-state.ts` from the manifest's own read, so it is exactly
 * what the tenant's next manifest asserts for a screen with no override.
 */
export interface ConfirmedTenantAlert {
  /** `manifest.emergencyType` — Tenant.emergencyType (stored upper-case). */
  type: string;
  /** `manifest.emergencySeverity` — Tenant.emergencyStatus. */
  severity: string;
  /** `manifest.isDrill` — Tenant.emergencyIsDrill. */
  isDrill: boolean;
}

/**
 * Why a descriptor was not offered:
 *   'no-alert'    — the database read worked; no tenant-wide alert is up;
 *   'mismatch'    — an alert is up, but not the one the descriptor names;
 *   'unavailable' — the read threw, timed out or returned junk: unknown.
 */
export type DescriptorRefusalReason = 'no-alert' | 'mismatch' | 'unavailable';

/**
 * Where the epoch's DESCRIPTOR came from. 'local' = minted by this process's
 * own `bumpTenantEmergencyEpoch` (an authenticated trigger request served
 * here). 'redis' = read from the shared mirror — written by another replica,
 * by a previous process, or by anyone else who can write Redis.
 */
export type EpochDescriptorOrigin = 'local' | 'redis';

/** One refused descriptor, handed to `EmergencyRevDeps.onDescriptorRefused`. */
export interface EmergencyRevRefusal {
  tenantId: string;
  screenId: string;
  reason: DescriptorRefusalReason;
  origin: EpochDescriptorOrigin;
  /** The descriptor that was NOT signed (already shape-checked, bounded). */
  descriptor: { type: string; severity: string; isDrill: boolean };
  /** What the database said, when it could be read. */
  confirmed: ConfirmedTenantAlert | null;
  epochStamp: number;
  /** `now - epochStamp` — negative when the stamp is in the future. */
  epochAgeMs: number;
  /** See `classifyDescriptorRefusal`. */
  forgerySignal: boolean;
  /** Emit the throttled log line now. */
  log: boolean;
  /** Alert the owner now — a forgery signal, at most once per tenant per hour. */
  notifyOwner: boolean;
}

export interface EmergencyRevDeps {
  redis?: EmergencyRevRedis | null;
  /**
   * The database confirmation (rule 6). WITHOUT it no descriptor is ever
   * returned — fail closed. The controller's cheap pre-304 pass deliberately
   * omits it (that pass must stay free of Postgres, and its answer is never
   * signed); the post-304 pass supplies `confirmTenantWideAlert`. Resolve
   * null when no tenant-wide alert is up; throw when the database cannot be
   * read.
   */
  confirmTenantAlert?: ((tenantId: string) => Promise<ConfirmedTenantAlert | null>) | null;
  /**
   * Evidence hook for a refused descriptor. Called synchronously; must not
   * block — anything slow (mail, audit row) belongs off the request path. A
   * throw here is swallowed.
   */
  onDescriptorRefused?: ((refusal: EmergencyRevRefusal) => void) | null;
}

// ── Raise confirmation tunables (rule 6) ─────────────────────────────────

/**
 * Bound on the confirmation read as one poll sees it. A slower read answers
 * "unavailable" (no descriptor → the manifest path) but keeps running as the
 * tenant's single in-flight read, so a stalled database gets ONE outstanding
 * confirmation per tenant, never one per poll.
 */
export const RAISE_CONFIRM_TIMEOUT_MS = 300;

/**
 * How long a confirmed alert is reused for one tenant. The herd moment — every
 * screen of a tenant polling while an alert is up and not yet applied — then
 * costs one indexed read per tenant per 2 s, not one per screen. Same window
 * as the manifest's own tenant-state cache, which this read goes through.
 */
export const RAISE_CONFIRM_POSITIVE_TTL_MS = 2_000;

/**
 * How long a NEGATIVE answer (no alert / mismatch / unreadable) is reused.
 * Short on purpose: the only writer that mints a descriptor — the tenant
 * trigger — bumps the epoch BEFORE its transaction commits (the 2026-08-15
 * dispatch-first fast path), so a poll inside that window is refused and the
 * next one must succeed. Every cached answer is also keyed to the epoch stamp
 * and to the manifest cache's invalidation epoch, which the trigger moves
 * again right after its commit — so on this replica the first poll after the
 * commit re-reads at once.
 */
export const RAISE_CONFIRM_NEGATIVE_TTL_MS = 500;

/** After this, a confirmation read still in flight no longer blocks a new one. */
export const RAISE_CONFIRM_FLIGHT_MAX_AGE_MS = 10_000;

/**
 * A disagreement younger than this may be a legitimate trigger whose
 * transaction has not committed yet (the pool waits up to 20 s for a
 * connection); see `classifyDescriptorRefusal`.
 */
export const RAISE_REFUSAL_COMMIT_GRACE_MS = 30_000;

/** A stamp further in the future than this was not written by any API clock. */
export const RAISE_REFUSAL_CLOCK_SKEW_MS = 5_000;

/** One refusal log line per tenant per kind per minute. */
export const RAISE_REFUSAL_LOG_INTERVAL_MS = 60_000;

/** One owner alert per tenant per hour (per API process). */
export const RAISE_REFUSAL_OWNER_ALERT_INTERVAL_MS = 60 * 60_000;

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
  /** 2026-10-10 — the alert on glass is a drill. */
  isDrill?: boolean | null;
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
    // Appended LAST so every pre-drill signature is unchanged (`''` for a
    // live alert, exactly what the join produced before this field).
    input.isDrill === true ? 'drill' : '',
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

/**
 * tenantId → the stamp of the newest epoch whose DESCRIPTOR this process
 * minted itself (rule 6 evidence). `localTenantEpochs` cannot answer that: it
 * also holds values adopted from Redis, and a local bump that omits `alert`
 * CARRIES the previous descriptor forward — possibly one adopted from Redis.
 * Diagnostics only: it decides how a refusal is reported, never whether a
 * descriptor is signed (only the database decides that).
 */
const localDescriptorStamps = new Map<string, number>();

/** Where the descriptor of this epoch came from (see `EpochDescriptorOrigin`). */
export function epochDescriptorOrigin(
  tenantId: string,
  epoch: Pick<TenantEmergencyEpoch, 'stamp'>,
): EpochDescriptorOrigin {
  return localDescriptorStamps.get(tenantId) === epoch.stamp ? 'local' : 'redis';
}

export function localTenantEmergencyEpoch(tenantId: string): TenantEmergencyEpoch | undefined {
  return localTenantEpochs.get(tenantId);
}

function serializeEpoch(e: TenantEmergencyEpoch): string {
  const head = `${e.stamp}:${e.active ? 1 : 0}`;
  const alert = sanitizeAlertDescriptor(e.alert);
  if (!alert) return head;
  // Base64url keeps the descriptor a single colon-free token, so an older
  // replica's two-field `parseEpoch` still reads the stamp and the flag off
  // the same value and simply ignores the tail.
  const encoded = Buffer.from(JSON.stringify(alert), 'utf8').toString('base64url');
  if (encoded.length > ALERT_DESCRIPTOR_MAX_BYTES) return head;
  return `${head}:${encoded}`;
}

/** Tolerant parser — a malformed value reads as "no epoch", never as fresh. */
export function parseEpoch(raw: string | null | undefined): TenantEmergencyEpoch | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const [stampRaw, activeRaw, alertRaw] = raw.split(':');
  // `Number('')` is 0, so an empty or whitespace-only stamp would otherwise
  // parse as a valid epoch-0 and outrank nothing — reject it explicitly.
  if (!stampRaw || !/^\d+$/.test(stampRaw)) return null;
  const stamp = Number(stampRaw);
  if (!Number.isFinite(stamp) || stamp < 0) return null;
  let alert: EmergencyAlertDescriptor | null = null;
  if (
    typeof alertRaw === 'string' &&
    alertRaw.length > 0 &&
    alertRaw.length <= ALERT_DESCRIPTOR_MAX_BYTES
  ) {
    try {
      alert = sanitizeAlertDescriptor(
        JSON.parse(Buffer.from(alertRaw, 'base64url').toString('utf8')),
      );
    } catch {
      alert = null; // an unreadable descriptor is simply no descriptor
    }
  }
  return { stamp: Math.floor(stamp), active: activeRaw === '1', alert };
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
 * @param alert the RAISE fast-path descriptor (P0-7 #2). Supply it ONLY on a
 *   TENANT-scoped trigger; pass `null` on an all-clear to drop it; OMIT it
 *   for every other bump, which keeps whatever the last trigger/all-clear
 *   asserted — the same rule `active` already follows, so the pair can never
 *   disagree about whether an alert is up.
 */
export function bumpTenantEmergencyEpoch(
  deps: EmergencyRevDeps,
  tenantId: string,
  opts: { active?: boolean; alert?: EmergencyAlertDescriptor | null } = {},
): TenantEmergencyEpoch {
  if (!tenantId) return { stamp: 0, active: false };
  const prev = localTenantEpochs.get(tenantId);
  // Strictly monotone even for two bumps inside one millisecond — a
  // trigger immediately followed by an all-clear must not collapse.
  const stamp = Math.max(Date.now(), (prev?.stamp ?? 0) + 1);
  const nextActive = opts.active === undefined ? (prev?.active ?? false) : opts.active;
  const nextAlert =
    opts.alert === undefined
      ? (sanitizeAlertDescriptor(prev?.alert) ?? null)
      : sanitizeAlertDescriptor(opts.alert);
  const next: TenantEmergencyEpoch = {
    stamp,
    active: nextActive,
    // A descriptor without an active alert is meaningless and would be a
    // latent re-raise if `active` ever came back true from elsewhere. Tie
    // them together at the write, not at every read.
    alert: nextActive ? nextAlert : null,
  };
  // Provenance of the descriptor this value carries (rule 6 evidence): minted
  // here when the caller supplied it, carried from a value that was itself
  // minted here when omitted — anything else came from Redis.
  if (
    opts.alert !== undefined ||
    (prev !== undefined && localDescriptorStamps.get(tenantId) === prev.stamp)
  ) {
    localDescriptorStamps.set(tenantId, stamp);
    capMap(localDescriptorStamps, TENANT_EPOCH_MAX_ENTRIES);
  } else {
    localDescriptorStamps.delete(tenantId);
  }
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

// ── Raise confirmation (rule 6, 2026-11-01) ──────────────────────────────

/**
 * Does the descriptor say exactly what the database says? Type compares
 * without case — the trigger mints the descriptor from the request's
 * lower-case incident type and stores `toUpperCase()` of it — while severity
 * and the drill flag compare exactly. A tenant-scoped trigger never writes a
 * scope note or an expiry, so a descriptor carrying either was not written by
 * it and does not match.
 */
export function descriptorMatchesConfirmed(
  descriptor: EmergencyAlertDescriptor,
  confirmed: ConfirmedTenantAlert,
): boolean {
  return (
    descriptor.scope === 'tenant' &&
    descriptor.scopeNote === null &&
    descriptor.expiresAt === null &&
    descriptor.type.toUpperCase() === confirmed.type.toUpperCase() &&
    descriptor.severity === confirmed.severity &&
    (descriptor.isDrill === true) === (confirmed.isDrill === true)
  );
}

type RaiseConfirmation =
  | { kind: 'ok'; alert: ConfirmedTenantAlert | null }
  | { kind: 'unavailable' };

interface RaiseConfirmationEntry {
  /** The tenant epoch stamp the read was made for. */
  stamp: number;
  /** `tenantStateEpoch(tenantId)` when the read began. */
  stateEpoch: number;
  /** `now` of the poll that started the read. */
  at: number;
  outcome: RaiseConfirmation;
}

const raiseConfirmations = new Map<string, RaiseConfirmationEntry>();
const raiseConfirmationsInFlight = new Map<
  string,
  { stamp: number; stateEpoch: number; at: number; promise: Promise<RaiseConfirmation> }
>();

/** Accept only a well-formed answer from the confirmer; anything else is unknown. */
function asConfirmedAlert(value: unknown): RaiseConfirmation {
  if (value === null) return { kind: 'ok', alert: null };
  if (!value || typeof value !== 'object') return { kind: 'unavailable' };
  const v = value as Record<string, unknown>;
  if (typeof v.type !== 'string' || v.type.length === 0) return { kind: 'unavailable' };
  if (typeof v.severity !== 'string' || v.severity.length === 0) return { kind: 'unavailable' };
  return { kind: 'ok', alert: { type: v.type, severity: v.severity, isDrill: v.isDrill === true } };
}

async function runRaiseConfirmation(
  confirm: (tenantId: string) => Promise<ConfirmedTenantAlert | null>,
  tenantId: string,
): Promise<RaiseConfirmation> {
  try {
    return asConfirmedAlert(await confirm(tenantId));
  } catch {
    return { kind: 'unavailable' };
  }
}

function raiseConfirmationTtl(outcome: RaiseConfirmation): number {
  return outcome.kind === 'ok' && outcome.alert
    ? RAISE_CONFIRM_POSITIVE_TTL_MS
    : RAISE_CONFIRM_NEGATIVE_TTL_MS;
}

/**
 * The database's answer for one tenant: cached, single-flight, and bounded to
 * `RAISE_CONFIRM_TIMEOUT_MS` as this poll sees it. Never throws.
 *
 * A cached answer is reused only for the SAME epoch stamp (a new trigger,
 * all-clear or broadcast re-reads), the SAME manifest-cache invalidation epoch
 * (the trigger's post-commit `invalidateTenantState` re-reads), and inside its
 * TTL. An answer from a read that began before an invalidation is not cached
 * — it may carry pre-commit state — exactly the guard `setTenantState` uses.
 */
async function readRaiseConfirmation(
  confirm: (tenantId: string) => Promise<ConfirmedTenantAlert | null>,
  tenantId: string,
  stamp: number,
  now: number,
): Promise<RaiseConfirmation> {
  const stateEpoch = tenantStateEpoch(tenantId);
  const hit = raiseConfirmations.get(tenantId);
  if (
    hit &&
    hit.stamp === stamp &&
    hit.stateEpoch === stateEpoch &&
    now >= hit.at &&
    now - hit.at < raiseConfirmationTtl(hit.outcome)
  ) {
    return hit.outcome;
  }

  let flight = raiseConfirmationsInFlight.get(tenantId);
  if (
    !flight ||
    flight.stamp !== stamp ||
    flight.stateEpoch !== stateEpoch ||
    // A read that never settles (a hung connection) must not disable the
    // fast path for this tenant for good: past this age a new read starts.
    // Still bounded — one more read per tenant per window.
    now - flight.at > RAISE_CONFIRM_FLIGHT_MAX_AGE_MS
  ) {
    const started = { stamp, stateEpoch, at: now, promise: runRaiseConfirmation(confirm, tenantId) };
    raiseConfirmationsInFlight.set(tenantId, started);
    capMap(raiseConfirmationsInFlight, TENANT_EPOCH_MAX_ENTRIES);
    void started.promise.then((outcome) => {
      if (raiseConfirmationsInFlight.get(tenantId) === started) {
        raiseConfirmationsInFlight.delete(tenantId);
      }
      if (tenantStateEpoch(tenantId) !== started.stateEpoch) return;
      const current = raiseConfirmations.get(tenantId);
      if (current && current.at > started.at) return;
      raiseConfirmations.set(tenantId, {
        stamp: started.stamp,
        stateEpoch: started.stateEpoch,
        at: started.at,
        outcome,
      });
      capMap(raiseConfirmations, TENANT_EPOCH_MAX_ENTRIES);
    });
    flight = started;
  }
  return (await withTimeout(flight.promise, RAISE_CONFIRM_TIMEOUT_MS)) ?? { kind: 'unavailable' };
}

/** A tenant's run of consecutive definite refusals of Redis-sourced descriptors. */
export interface RefusalStreak {
  since: number;
  last: number;
}

/**
 * Is this refusal a FORGERY SIGNAL — the owner-alert class — or the expected
 * shape of a legitimate alert in flight? Pure.
 *
 * Never a signal:
 *   • 'unavailable' — an unknown is not evidence of anything;
 *   • origin 'local' — this process minted the descriptor on an
 *     authenticated trigger request; Redis cannot have written it. A refusal
 *     here is that trigger's own pre-commit window (the epoch is bumped
 *     before the transaction commits), or a trigger whose write failed —
 *     which its operator was already told.
 *
 * A Redis-sourced descriptor the database DEFINITELY disagrees with is a
 * signal once it cannot be another replica's trigger mid-commit:
 *   • its stamp is older than `RAISE_REFUSAL_COMMIT_GRACE_MS`, or
 *   • its stamp is in the future beyond `RAISE_REFUSAL_CLOCK_SKEW_MS`, or
 *   • definite refusals for this tenant have run, with no gap longer than
 *     the grace, for `RAISE_REFUSAL_COMMIT_GRACE_MS` — a writer re-stamping
 *     its value to look fresh still trips this.
 * A confirmed descriptor ends the streak (the caller deletes it).
 */
export function classifyDescriptorRefusal(input: {
  reason: DescriptorRefusalReason;
  origin: EpochDescriptorOrigin;
  epochStamp: number;
  now: number;
  streak: RefusalStreak | null;
}): { forgerySignal: boolean; streak: RefusalStreak | null } {
  const { reason, origin, epochStamp, now, streak } = input;
  if (reason === 'unavailable' || origin === 'local') return { forgerySignal: false, streak };
  const next: RefusalStreak =
    streak && now - streak.last <= RAISE_REFUSAL_COMMIT_GRACE_MS
      ? { since: streak.since, last: now }
      : { since: now, last: now };
  const forgerySignal =
    now - epochStamp >= RAISE_REFUSAL_COMMIT_GRACE_MS ||
    epochStamp - now > RAISE_REFUSAL_CLOCK_SKEW_MS ||
    now - next.since >= RAISE_REFUSAL_COMMIT_GRACE_MS;
  return { forgerySignal, streak: next };
}

const refusalStreaks = new Map<string, RefusalStreak>();
const refusalLogAt = new Map<string, number>();
const refusalOwnerAlertAt = new Map<string, number>();

/** True at most once per `intervalMs` per key; records the emission. */
function emitAtMostEvery(map: Map<string, number>, key: string, now: number, intervalMs: number): boolean {
  const last = map.get(key);
  if (last !== undefined && now >= last && now - last < intervalMs) return false;
  map.set(key, now);
  capMap(map, TENANT_EPOCH_MAX_ENTRIES);
  return true;
}

/** Record a refusal and hand the evidence to the hook. Never throws. */
function noteDescriptorRefused(
  deps: EmergencyRevDeps,
  args: {
    tenantId: string;
    screenId: string;
    reason: DescriptorRefusalReason;
    descriptor: EmergencyAlertDescriptor;
    confirmed: ConfirmedTenantAlert | null;
    epoch: TenantEmergencyEpoch;
    now: number;
  },
): void {
  try {
    const { tenantId, screenId, reason, descriptor, confirmed, epoch, now } = args;
    const origin = epochDescriptorOrigin(tenantId, epoch);
    const { forgerySignal, streak } = classifyDescriptorRefusal({
      reason,
      origin,
      epochStamp: epoch.stamp,
      now,
      streak: refusalStreaks.get(tenantId) ?? null,
    });
    if (streak) {
      refusalStreaks.set(tenantId, streak);
      capMap(refusalStreaks, TENANT_EPOCH_MAX_ENTRIES);
    }
    const log = emitAtMostEvery(
      refusalLogAt,
      `${tenantId}|${forgerySignal ? 'forgery-signal' : `${origin}:${reason}`}`,
      now,
      RAISE_REFUSAL_LOG_INTERVAL_MS,
    );
    const notifyOwner =
      forgerySignal &&
      emitAtMostEvery(refusalOwnerAlertAt, tenantId, now, RAISE_REFUSAL_OWNER_ALERT_INTERVAL_MS);
    const hook = deps.onDescriptorRefused;
    if (typeof hook !== 'function') return;
    hook({
      tenantId,
      screenId,
      reason,
      origin,
      descriptor: {
        type: descriptor.type,
        severity: descriptor.severity,
        isDrill: descriptor.isDrill === true,
      },
      confirmed,
      epochStamp: epoch.stamp,
      epochAgeMs: now - epoch.stamp,
      forgerySignal,
      log,
      notifyOwner,
    });
  } catch {
    // Evidence must never be able to fail a poll.
  }
}

/**
 * Offer `candidate` only if the database confirms it (rule 6). Returns the
 * descriptor to sign, or null. Never throws.
 */
async function confirmRaiseDescriptor(
  deps: EmergencyRevDeps,
  tenantId: string,
  screenId: string,
  candidate: EmergencyAlertDescriptor,
  epoch: TenantEmergencyEpoch,
  now: number,
): Promise<EmergencyAlertDescriptor | null> {
  const confirm = deps.confirmTenantAlert;
  // No confirmer → nothing may be signed. The cheap pre-304 pass calls
  // without one on purpose; it is not a refusal, so it records nothing.
  if (typeof confirm !== 'function') return null;
  try {
    const outcome = await readRaiseConfirmation(confirm, tenantId, epoch.stamp, now);
    if (outcome.kind === 'ok' && outcome.alert && descriptorMatchesConfirmed(candidate, outcome.alert)) {
      refusalStreaks.delete(tenantId);
      return candidate;
    }
    noteDescriptorRefused(deps, {
      tenantId,
      screenId,
      reason: outcome.kind === 'unavailable' ? 'unavailable' : outcome.alert ? 'mismatch' : 'no-alert',
      descriptor: candidate,
      confirmed: outcome.kind === 'ok' ? outcome.alert : null,
      epoch,
      now,
    });
    return null;
  } catch {
    return null;
  }
}

// ── Composition ──────────────────────────────────────────────────────────

export interface EmergencyRevAnswer {
  rev: string;
  /** Server's last-known alert state for this screen. False when unknown. */
  active: boolean;
  /** Diagnostics only — never sent to a device. */
  cold: boolean;
  /**
   * The RAISE fast-path descriptor to put in a 200 body, or null (P0-7 #2).
   *
   * Non-null ONLY when all four hold, and the caller must not second-guess
   * them — they are the whole safety argument:
   *   1. the tenant epoch says an alert is ACTIVE, and
   *   2. that epoch carries a descriptor (⇒ a TENANT-scoped trigger minted
   *      it — a group/device trigger stores none), and
   *   3. this screen's last manifest build did NOT already record an active
   *      alert, so the fast path can only ever move a screen from "no alert"
   *      to "alert", never replace one alert with another, and
   *   4. the DATABASE confirms it (rule 6, 2026-11-01): the manifest's own
   *      read of the tenant has a live tenant-wide alert of the same type,
   *      severity and drill flag. Points 1–3 come from Redis-fed state, which
   *      anyone holding `REDIS_URL` can write; point 4 is what stops this
   *      field being a signing oracle. Without `deps.confirmTenantAlert` it
   *      is always null.
   *
   * It must never be attached to a 304: a 304 says "nothing moved", and a
   * screen that has already applied this revision has already been told.
   */
  alert: EmergencyAlertDescriptor | null;
}

/**
 * Build the answer for one screen. Reads Redis at most once (memoised).
 * Postgres is read only through `deps.confirmTenantAlert`, only inside the
 * raise window (rule 6) — an alert up, a descriptor present, this screen not
 * yet showing one — and at most once per tenant per cache window. Without a
 * confirmer this never touches Postgres and never returns a descriptor.
 */
export async function resolveEmergencyRev(
  deps: EmergencyRevDeps,
  screenId: string,
  tenantId: string | null,
  now: number = Date.now(),
): Promise<EmergencyRevAnswer> {
  const epoch: TenantEmergencyEpoch = tenantId
    ? await readTenantEmergencyEpoch(deps, tenantId, now)
    : { stamp: 0, active: false, alert: null };
  const record = readScreenRecord(screenId, tenantId, now);
  const rev = computeEmergencyRev({
    originId: emergencyRevOriginId(),
    contentRev: currentManifestContentRev(),
    tenantStamp: epoch.stamp,
    tenantActive: epoch.active,
    screenSig: record?.sig ?? null,
    boundarySeq: record?.boundarySeq ?? 0,
  });
  // RAISE-ONLY GATE (see EmergencyRevAnswer.alert). `record?.active === true`
  // means this screen's own last manifest build already put an alert on the
  // glass — possibly a per-screen override the tenant-wide descriptor knows
  // nothing about — so the fast path stands down and the manifest decides.
  const candidate =
    epoch.active && record?.active !== true && emergencyRevRaiseEnabled()
      ? sanitizeAlertDescriptor(epoch.alert)
      : null;
  // DATABASE CONFIRMATION (rule 6). Only a candidate pays for it, so the
  // read happens only inside the raise window. `active` below is untouched:
  // a refused descriptor still tells the player an alert is up, and the
  // player answers that with the manifest fetch — the unchanged path.
  const alert =
    candidate && tenantId
      ? await confirmRaiseDescriptor(deps, tenantId, screenId, candidate, epoch, now)
      : null;
  return {
    rev,
    active: epoch.active || (record?.active ?? false),
    cold: record === null,
    alert,
  };
}

// ── Refusal evidence copy (rule 6) ───────────────────────────────────────

/**
 * A descriptor's strings come from Redis: bounded by `sanitizeAlertDescriptor`
 * but otherwise attacker-chosen. Anything leaving this process in a log line
 * or an email is reduced to a plain token so it cannot forge a second log line
 * or rewrite the mail.
 */
export function evidenceSafe(value: unknown, max = 64): string {
  const s = typeof value === 'string' ? value : String(value ?? '');
  const cleaned = s.replace(/[^A-Za-z0-9_.:-]/g, '?').slice(0, max);
  return cleaned.length > 0 ? cleaned : '-';
}

/** The one throttled log line (no secrets: ids, the descriptor's type/severity, provenance). */
export function formatDescriptorRefusalLine(r: EmergencyRevRefusal): string {
  return (
    '[emergency-rev] descriptor refused: not confirmed by the database' +
    ` tenant=${evidenceSafe(r.tenantId, 128)}` +
    ` type=${evidenceSafe(r.descriptor.type)}` +
    ` severity=${evidenceSafe(r.descriptor.severity)}` +
    ` drill=${r.descriptor.isDrill ? 'yes' : 'no'}` +
    ` source=${r.origin}` +
    ` reason=${r.reason}` +
    ` db=${r.confirmed ? `${evidenceSafe(r.confirmed.type)}/${evidenceSafe(r.confirmed.severity)}${r.confirmed.isDrill ? '/drill' : ''}` : 'none'}` +
    ` epoch-age-s=${Math.round(r.epochAgeMs / 1000)}` +
    ` forgery-signal=${r.forgerySignal ? 'yes' : 'no'}` +
    ` screen=${evidenceSafe(r.screenId, 128)}`
  );
}

/** The owner alert (PlatformAlertMailer → PLATFORM_ALERT_EMAILS). */
export function renderDescriptorRefusalAlert(r: EmergencyRevRefusal): { subject: string; body: string } {
  const tenant = evidenceSafe(r.tenantId, 128);
  const stampMs = Number.isFinite(r.epochStamp) ? r.epochStamp : NaN;
  const stampIso =
    Number.isFinite(stampMs) && stampMs > 0 && stampMs < 8.64e15 ? new Date(stampMs).toISOString() : 'unreadable';
  const db = r.confirmed
    ? `type=${evidenceSafe(r.confirmed.type)} severity=${evidenceSafe(r.confirmed.severity)} drill=${r.confirmed.isDrill ? 'yes' : 'no'}`
    : 'no tenant-wide alert is active';
  const body = [
    'The emergency-rev fast path (GET /api/v1/screens/:id/emergency-rev) was about to sign a',
    'tenant-wide alert descriptor that the database does not confirm. It refused: no screen was',
    'handed a signed alert from it. The screens were told an alert may be up and fetched their',
    'manifest instead, which reads the database and is unchanged.',
    '',
    `Tenant:             ${tenant}`,
    `Descriptor (Redis): type=${evidenceSafe(r.descriptor.type)} severity=${evidenceSafe(r.descriptor.severity)} drill=${r.descriptor.isDrill ? 'yes' : 'no'}`,
    `Database:           ${db}`,
    `Reason:             ${r.reason}`,
    `Descriptor source:  ${r.origin === 'redis' ? 'redis (not minted by this API process)' : 'local'}`,
    `Epoch stamp:        ${stampIso} (${Math.round(r.epochAgeMs / 1000)} s before the refusal)`,
    `Screen that asked:  ${evidenceSafe(r.screenId, 128)}`,
    '',
    'What it can mean:',
    `  1. Something other than VenueOS wrote the Redis key venueos:emrev:t:${tenant} - an attempted`,
    '     forged alert. REDIS_URL was in the 2026-10-21 Railway environment leak; anyone holding it',
    '     can write that key. Treat it as one until (2) is ruled out.',
    '  2. A stale mirror outlived its alert (an all-clear whose Redis write failed, then a restart),',
    '     or a trigger whose database write never committed.',
    '',
    'Check: the tenant\'s TRIGGER_EMERGENCY / CLEAR_EMERGENCY audit rows around the epoch stamp; the',
    'Redis key above; rotate REDIS_URL if (1) is plausible.',
    '',
    'Sent at most once per tenant per hour per API process. Every refusal is also logged as',
    '"[emergency-rev] descriptor refused" and this one is audited as EMERGENCY_REV_DESCRIPTOR_REFUSED.',
  ].join('\n');
  return {
    subject: `[VenueOS] Emergency raise refused: the database does not confirm an alert for tenant ${tenant}`,
    body,
  };
}

/** Full reset of module state between spec cases. */
export function resetEmergencyRevForTests(nextOriginId = 'testorigin'): void {
  screenRecords.clear();
  localTenantEpochs.clear();
  tenantEpochMemo.clear();
  localDescriptorStamps.clear();
  raiseConfirmations.clear();
  raiseConfirmationsInFlight.clear();
  refusalStreaks.clear();
  refusalLogAt.clear();
  refusalOwnerAlertAt.clear();
  originId = nextOriginId;
}
