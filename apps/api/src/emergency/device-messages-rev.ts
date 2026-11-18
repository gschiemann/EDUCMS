/**
 * device-messages-rev.ts - lets `GET /api/v1/emergency/messages` answer
 * "nothing changed" WITHOUT reading Postgres.
 *
 * WHY THIS EXISTS (cost and capacity audit 2026-11-15, measured 2026-11-16).
 * Every paired screen polls that endpoint every 10 s. It is the HTTP backstop
 * for pushed SOS / broadcast / media alerts, and for exactly that reason it
 * has always read the database on every poll: one `Screen` row, the visible
 * `EmergencyMessage` rows, one `Tenant` row. In production 14,455 of those
 * polls arrived in one hour from 40 screens and 14,368 of them (99.4 %) ended
 * as `304 Not Modified` - AFTER the three reads, the serialisation and the
 * body hash that Express needs to discover the answer is the one the screen
 * already holds. At 1,000 screens that is 300 queries a second, across the
 * country, on a pool of 10 connections, to say "still nothing".
 *
 * WHAT IT DOES. It computes a short revision from things this process
 * already knows without Postgres, and it remembers, per screen, the exact
 * representation it last sent. When a screen presents that representation's
 * ETag and nothing that could change its answer has moved, the route replies
 * 304 before any query runs. Every other case falls through to the code that
 * was there before, unchanged.
 *
 * ── WHAT MOVES THE REVISION ──────────────────────────────────────────────
 *   1. TENANT EMERGENCY EPOCH (`screens/emergency-rev.ts`) - bumped by the
 *      emergency controller on trigger / all-clear / SOS / broadcast / media
 *      alert / message clear, for every tenant a fan-out reaches. All five
 *      `EmergencyMessage` writers bump it AFTER their transaction commits;
 *      `device-messages-rev.writers.spec.ts` fails if a writer appears that
 *      does not.
 *   2. TENANT STATE EPOCH (`screens/manifest-hot-cache.ts`) - moved by every
 *      `invalidateTenantState`, which the controller calls before a trigger's
 *      fan-out AND after its commit.
 *   3. THE SCREEN'S SCOPE - its tenant and group, from the credential
 *      snapshot the global `DeviceIdentityInterceptor` verified for this very
 *      request. A re-homed or re-grouped screen gets a different revision.
 *   4. PROCESS ORIGIN - random per boot, so nothing survives a restart.
 *
 * Deliberately NOT in it: the process-wide manifest content revision. It
 * moves on every content edit by any customer, so including it would make
 * this endpoint's cost grow with the platform's write rate instead of with
 * the number of alerts.
 *
 * ── WHAT A REVISION CANNOT SEE, AND WHAT COVERS IT ───────────────────────
 *   • EXPIRY. A message stops being visible at `expiresAt` with no write.
 *     Each record keeps the earliest expiry among the rows it returned and
 *     cannot answer at or after that instant.
 *   • A WRITE NOBODY SIGNALLED (Supabase Studio, a script, a future writer
 *     that forgot). A record cannot answer once it is
 *     `DEVICE_MESSAGES_RECORD_MAX_AGE_MS` old, so the worst case is one
 *     minute, on the backstop tier only - the signed push is untouched.
 *   • A READ THAT RACED A COMMIT. A trigger moves the epochs BEFORE its
 *     transaction commits (the fan-out must not wait on the database), so a
 *     read in that gap can return the old state under the new revision. Two
 *     rules close it: the revision attached to a response is the one computed
 *     BEFORE its read began, and a read that began within
 *     `DEVICE_MESSAGES_SETTLE_MS` of anything tenant-level moving is
 *     PROVISIONAL - it is served, but it can never authorise a 304. The same
 *     class of bug is described at `tenantStateEpochs` in
 *     manifest-hot-cache.ts (the MEDICAL drill, 2026-10-26).
 *   • ANOTHER COPY OF THE BODY. The ETag carries a hash of the body, and the
 *     record keeps the ETag itself, so a 304 is granted only to a client that
 *     holds the exact bytes this process last sent to that screen.
 *
 * ── WHY THE ETAG IS WEAK (`W/"..."`) ─────────────────────────────────────
 * Not because the bytes may differ - the tag is a hash of them. Because a
 * proxy that compresses a response on the way out keeps a weak validator and
 * weakens or DROPS a strong one, and a screen that never receives its
 * validator never sends one: every poll would be a database read and a full
 * body. The weak form is also the form Express gives this route today, and
 * 99.4 % of production polls coming back 304 is the proof that it survives
 * every hop between a screen and this process. Validators are compared the
 * way `If-None-Match` is defined to compare them (RFC 9110 section 13.1.2,
 * weak comparison): the `W/` prefix is ignored, the opaque tag must be equal.
 *
 * ── FAIL-SAFE DIRECTION ──────────────────────────────────────────────────
 * Every unknown is a database read, never a 304: no record, a different
 * ETag, a moved revision, a provisional record, an expired boundary, an old
 * record, a clock that went backwards, no verified identity, a slow Redis.
 * A wrong answer in that direction costs three queries, which is what every
 * poll cost before this file existed.
 *
 * ── THE SWITCH ───────────────────────────────────────────────────────────
 * `EMERGENCY_MESSAGES_FAST_304`: unset = off (the shipped default); a list of
 * screen ids = those screens only; `all` = the fleet. See
 * `deviceMessagesFastPathEnabled`. Turning it on, for a bench list or for the
 * fleet, is the owner's decision after an on-glass drill - never an agent's.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
 * It is not a cache of messages. No message row, and nothing derived from
 * one except its expiry instant, is kept here; every 200 is a live read.
 *
 * Pure and framework-free (no Nest, no Prisma, no Redis import), the same
 * shape as emergency-rev.ts, so it unit-tests without a module graph.
 */

import * as crypto from 'crypto';

/** Bump when the composition of the revision or the ETag changes. */
export const DEVICE_MESSAGES_REV_SCHEMA = 'm1';

/**
 * A record older than this cannot answer "not modified".
 *
 * It bounds the one thing no signal covers: a change made behind the API's
 * back. One minute keeps five of every six idle polls off the database and
 * still has every screen re-read the truth once a minute.
 */
export const DEVICE_MESSAGES_RECORD_MAX_AGE_MS = 60_000;

/**
 * After anything tenant-level moves, reads that begin inside this window are
 * provisional. Longer than any transaction this API runs (Prisma's
 * interactive-transaction ceiling is 5 s) and equal to one poll interval, so
 * a change costs every screen of the tenant two or three database reads and
 * then the hot path resumes.
 */
export const DEVICE_MESSAGES_SETTLE_MS = 10_000;

const RECORD_MAX_ENTRIES = 20_000;
const TENANT_SEEN_MAX_ENTRIES = 10_000;

/** At most this many listed screens are honoured; the rest are ignored. */
export const DEVICE_MESSAGES_FAST_PATH_MAX_LISTED = 200;

let parsedSwitchRaw: string | null = null;
let parsedSwitch: { all: boolean; screens: ReadonlySet<string> } = {
  all: false,
  screens: new Set(),
};

/**
 * Opt-in switch, read from `EMERGENCY_MESSAGES_FAST_304`:
 *   - unset or empty        -> off: every poll reads the database, as before;
 *   - `all`                 -> on for every screen;
 *   - a list of screen ids  -> on for exactly those screens (comma or space
 *                              separated). This is the bench ring: the hot
 *                              path can be drilled on listed screens while
 *                              the rest of the fleet is untouched.
 *
 * FAILS CLOSED. Only the exact word `all` opens it fleet-wide, so `1`, `true`
 * or a typo is read as a list naming a screen that does not exist, which
 * enables nothing. Past `DEVICE_MESSAGES_FAST_PATH_MAX_LISTED` ids the rest
 * are ignored - a bad value only ever narrows.
 *
 * Read per call (memoised on the raw string) so a spec can flip it and an
 * operator's change needs no code path to notice.
 */
export function deviceMessagesFastPathEnabled(
  screenId: string | null | undefined,
): boolean {
  const raw = (process.env.EMERGENCY_MESSAGES_FAST_304 || '').trim();
  if (raw === '') return false;
  if (raw !== parsedSwitchRaw) {
    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    parsedSwitch =
      tokens.length === 1 && tokens[0].toLowerCase() === 'all'
        ? { all: true, screens: new Set() }
        : {
            all: false,
            screens: new Set(
              tokens.slice(0, DEVICE_MESSAGES_FAST_PATH_MAX_LISTED),
            ),
          };
    parsedSwitchRaw = raw;
  }
  if (parsedSwitch.all) return true;
  return (
    typeof screenId === 'string' &&
    screenId.length > 0 &&
    parsedSwitch.screens.has(screenId)
  );
}

export interface DeviceMessagesRevInputs {
  /** `emergencyRevOriginId()` - random per boot. */
  originId: string;
  screenId: string;
  tenantId: string;
  groupId: string | null;
  /** `readTenantEmergencyEpoch(...).stamp` - wall-clock ms of the last emergency action. */
  tenantEpochStamp: number;
  /** `tenantStateEpoch(tenantId)` from manifest-hot-cache. */
  tenantStateEpoch: number;
}

/**
 * The revision. Opaque for the reason emergency-rev.ts gives: a device has
 * no business reading a tenant epoch out of a header, and a token that can
 * only be compared cannot be depended on for anything else.
 */
export function computeDeviceMessagesRev(i: DeviceMessagesRevInputs): string {
  const material = [
    DEVICE_MESSAGES_REV_SCHEMA,
    i.originId,
    i.screenId,
    i.tenantId,
    i.groupId ?? '',
    String(i.tenantEpochStamp),
    String(i.tenantStateEpoch),
  ].join('|');
  return crypto
    .createHash('sha256')
    .update(material)
    .digest('hex')
    .slice(0, 20);
}

/**
 * The ETag for one response: the revision it was read under plus a hash of
 * the body's exact bytes, so two bodies never share one. Weak on the wire -
 * see "WHY THE ETAG IS WEAK" in the header.
 */
export function deviceMessagesEtag(rev: string, body: string): string {
  const bodyHash = crypto
    .createHash('sha256')
    .update(body)
    .digest('hex')
    .slice(0, 12);
  return `W/"${DEVICE_MESSAGES_REV_SCHEMA}.${rev}.${bodyHash}"`;
}

/** The opaque tag of one validator: the value without its optional `W/`. */
function opaqueTag(validator: string): string {
  return validator.startsWith('W/') ? validator.slice(2) : validator;
}

export interface DeviceMessagesRecord {
  /** The ETag of the representation last sent to this screen. */
  etag: string;
  /** The revision that representation was read under (computed before the read). */
  rev: string;
  /** When that read BEGAN (ms). */
  readAt: number;
  /** Earliest instant a returned message expires (ms), or null when none does. */
  boundaryAt: number | null;
  /** True when the read began inside the settle window: served, never trusted. */
  provisional: boolean;
}

const records = new Map<string, DeviceMessagesRecord>();
const tenantSeen = new Map<string, { key: string; at: number }>();

function capMap<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}

/**
 * Note the tenant-level inputs this process sees right now and return when it
 * FIRST saw this exact pair. Called on every poll; a pair that differs from
 * the last one opens a settle window starting now. A process that has never
 * seen the tenant treats "now" as the first sighting, so nothing read in the
 * first seconds after a boot is trusted either.
 */
export function noteDeviceMessagesTenantInputs(
  tenantId: string,
  tenantEpochStamp: number,
  tenantStateEpoch: number,
  now: number,
): number {
  const key = `${tenantEpochStamp}|${tenantStateEpoch}`;
  const hit = tenantSeen.get(tenantId);
  if (hit && hit.key === key) return hit.at;
  tenantSeen.delete(tenantId);
  tenantSeen.set(tenantId, { key, at: now });
  capMap(tenantSeen, TENANT_SEEN_MAX_ENTRIES);
  return now;
}

/**
 * Was a read that began at `readAt` too close to a tenant-level change to be
 * trusted? Two clocks on purpose: when THIS process first saw the current
 * inputs (covers a tenant-state invalidation, which carries no time), and the
 * epoch's own stamp (covers a bump made on another replica that this process
 * learned of late). A stamp in the future reads as "just changed".
 */
export function isProvisionalRead(
  readAt: number,
  tenantInputsSeenAt: number,
  tenantEpochStamp: number,
): boolean {
  if (!Number.isFinite(readAt)) return true;
  if (
    !Number.isFinite(tenantInputsSeenAt) ||
    readAt - tenantInputsSeenAt < DEVICE_MESSAGES_SETTLE_MS
  ) {
    return true;
  }
  if (!Number.isFinite(tenantEpochStamp)) return true;
  if (
    tenantEpochStamp > 0 &&
    readAt - tenantEpochStamp < DEVICE_MESSAGES_SETTLE_MS
  )
    return true;
  return false;
}

/**
 * The earliest expiry among the messages a response carries, in ms.
 * `expiresAt` on the wire is whole seconds, floored, so the boundary can be
 * up to a second EARLY - an early database read, never a late one. A value
 * that is not a usable number makes the boundary "now": that response is
 * served and never trusted.
 */
export function earliestExpiryMs(
  active: ReadonlyArray<{ expiresAt?: unknown }>,
  now: number,
): number | null {
  let earliest: number | null = null;
  for (const row of active) {
    const raw = row?.expiresAt;
    if (raw === null || raw === undefined) continue;
    const ms =
      typeof raw === 'number' && Number.isFinite(raw) && raw > 0
        ? raw * 1000
        : now;
    if (earliest === null || ms < earliest) earliest = ms;
  }
  return earliest;
}

/** Remember the representation just sent to a screen. */
export function recordDeviceMessagesRead(input: {
  screenId: string;
  rev: string;
  etag: string;
  /** When the read BEGAN. */
  readAt: number;
  boundaryAt: number | null;
  provisional: boolean;
}): DeviceMessagesRecord {
  const record: DeviceMessagesRecord = {
    etag: input.etag,
    rev: input.rev,
    readAt: input.readAt,
    boundaryAt: input.boundaryAt,
    provisional: input.provisional,
  };
  // Delete first so a re-insert moves the screen to the young end of the map.
  records.delete(input.screenId);
  records.set(input.screenId, record);
  capMap(records, RECORD_MAX_ENTRIES);
  return record;
}

/** Drop a screen's record: the next poll reads the database. */
export function forgetDeviceMessagesRecord(screenId: string): void {
  records.delete(screenId);
}

/** Diagnostic / test read of a screen's record. */
export function peekDeviceMessagesRecord(
  screenId: string,
): DeviceMessagesRecord | undefined {
  return records.get(screenId);
}

export type NotModifiedRefusal =
  | 'no-record'
  | 'no-validator'
  | 'different-representation'
  | 'revision-moved'
  | 'provisional'
  | 'clock'
  | 'too-old'
  | 'expiry-reached';

/**
 * May this poll be answered 304 without reading the database?
 *
 * `ifNoneMatch` must be the one ETag this process last sent to this screen
 * (weak comparison: with or without its `W/`, the same opaque tag). A list of
 * validators or `*` is refused: they are legal HTTP and they are not what a
 * screen's own cache sends, so each of them is simply a database read.
 */
export function deviceMessagesNotModified(input: {
  screenId: string;
  rev: string;
  ifNoneMatch: unknown;
  now: number;
}): { ok: true; etag: string } | { ok: false; reason: NotModifiedRefusal } {
  const record = records.get(input.screenId);
  if (!record) return { ok: false, reason: 'no-record' };
  if (typeof input.ifNoneMatch !== 'string' || input.ifNoneMatch.length === 0) {
    return { ok: false, reason: 'no-validator' };
  }
  if (opaqueTag(input.ifNoneMatch) !== opaqueTag(record.etag)) {
    return { ok: false, reason: 'different-representation' };
  }
  if (record.rev !== input.rev) return { ok: false, reason: 'revision-moved' };
  if (record.provisional) return { ok: false, reason: 'provisional' };
  if (!Number.isFinite(input.now) || input.now < record.readAt)
    return { ok: false, reason: 'clock' };
  if (input.now - record.readAt >= DEVICE_MESSAGES_RECORD_MAX_AGE_MS) {
    return { ok: false, reason: 'too-old' };
  }
  if (record.boundaryAt !== null && input.now >= record.boundaryAt) {
    return { ok: false, reason: 'expiry-reached' };
  }
  return { ok: true, etag: record.etag };
}

// ── What the hot path is doing, in one log line ──────────────────────────
//
// The only way to tell, from outside a screen, whether polls are being
// answered from memory - and if not, why not. Counts only: no screen, no
// tenant, no message. A validator that never survives the network shows here
// as `no-validator` or `different-representation` on every poll.

/** At most one summary line per this many ms. */
export const DEVICE_MESSAGES_STATS_EVERY_MS = 10 * 60_000;

const stats = {
  since: 0,
  fromMemory: 0,
  /** Polls that had a revision and read the database anyway, by reason. */
  refused: new Map<NotModifiedRefusal, number>(),
  /** Polls of an enabled screen for which pass 1 could not produce a revision. */
  withoutRevision: 0,
};

function countRefusal(reason: NotModifiedRefusal): void {
  stats.refused.set(reason, (stats.refused.get(reason) ?? 0) + 1);
}

/** Pass 1 returned null for a screen the switch is on for. */
export function noteDeviceMessagesWithoutRevision(): void {
  stats.withoutRevision += 1;
}

/**
 * The summary line, at most once per `DEVICE_MESSAGES_STATS_EVERY_MS` and
 * only when there is something to say; null otherwise. Taking a line resets
 * the counts. The caller logs it - this module has no side effects of its own.
 */
export function takeDeviceMessagesStatsLine(now: number): string | null {
  if (!Number.isFinite(now)) return null;
  if (stats.since === 0 || now < stats.since) {
    stats.since = now;
    return null;
  }
  if (now - stats.since < DEVICE_MESSAGES_STATS_EVERY_MS) return null;
  let read = 0;
  const reasons: string[] = [];
  for (const [reason, n] of [...stats.refused.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    read += n;
    reasons.push(`${reason} ${n}`);
  }
  const total = stats.fromMemory + read + stats.withoutRevision;
  const minutes = Math.round((now - stats.since) / 60_000);
  const line =
    total === 0
      ? null
      : `[Emergency] device message poll, last ${minutes} min: ${stats.fromMemory} answered from memory, ` +
        `${read} read the database${reasons.length ? ` (${reasons.join(', ')})` : ''}, ` +
        `${stats.withoutRevision} had no revision`;
  stats.since = now;
  stats.fromMemory = 0;
  stats.refused.clear();
  stats.withoutRevision = 0;
  return line;
}

// ── The two passes, as functions of their inputs ─────────────────────────
//
// The route is a thin adapter over these two. They take ports instead of
// Prisma / Redis / Express so the ordering rules above - revision before
// read, record stamped with the instant the read began, nothing remembered
// when the live row disagrees - are tested without a module graph.

/** Pass 1's result: what a response read from now on is filed under. */
export interface DeviceMessagesRevision {
  rev: string;
  /** The tenant the verified snapshot places this screen in. */
  tenantId: string;
  /** The instant pass 1 ran - the read that follows began no earlier. */
  now: number;
  provisional: boolean;
}

/**
 * Pass 1. Returns null whenever the cheap question cannot be asked safely;
 * null always means "read the database and remember nothing".
 *
 * @param identity the credential snapshot ALREADY verified for this request
 *   (live row, not revoked, epoch accepted), or null when the request did not
 *   come through that verification.
 * @param readEpochStamp the tenant emergency epoch's stamp, or null when it
 *   could not be had quickly. Must never throw past its own deadline.
 */
export async function resolveDeviceMessagesRevision(input: {
  screenId: string;
  identity: {
    tenantId: string | null;
    groupId: string | null;
    status: string;
  } | null;
  readEpochStamp: (tenantId: string, now: number) => Promise<number | null>;
  tenantStateEpochOf: (tenantId: string) => number;
  originId: string;
  now: number;
}): Promise<DeviceMessagesRevision | null> {
  try {
    const { identity, screenId, now } = input;
    if (
      !screenId ||
      !identity ||
      !identity.tenantId ||
      identity.status === 'REVOKED'
    )
      return null;
    if (!Number.isFinite(now)) return null;
    const tenantId = identity.tenantId;
    const stamp = await input.readEpochStamp(tenantId, now);
    if (typeof stamp !== 'number' || !Number.isFinite(stamp)) return null;
    // Read AFTER the await: a tenant-state invalidation that lands while the
    // epoch read is in flight must be part of this revision, not the next.
    const stateEpoch = input.tenantStateEpochOf(tenantId);
    const seenAt = noteDeviceMessagesTenantInputs(
      tenantId,
      stamp,
      stateEpoch,
      now,
    );
    return {
      rev: computeDeviceMessagesRev({
        originId: input.originId,
        screenId,
        tenantId,
        groupId: identity.groupId ?? null,
        tenantEpochStamp: stamp,
        tenantStateEpoch: stateEpoch,
      }),
      tenantId,
      now,
      provisional: isProvisionalRead(now, seenAt, stamp),
    };
  } catch {
    return null;
  }
}

/** What the route must send. */
export type DeviceMessagesPollAnswer<B> =
  /** 304, no body, and no database read was made. */
  | { kind: 'not-modified'; etag: string }
  /** 200 with this module's ETag, a hash of exactly these bytes (a live read). */
  | { kind: 'fresh'; etag: string; json: string }
  /** 200 exactly as the route answered before this module existed. */
  | { kind: 'plain'; body: B };

/**
 * Pass 2, with pass 1's verdict in front of it.
 *
 * `revision` was computed by the caller BEFORE this function is entered, so
 * it is by construction older than the read `readLive` performs.
 */
export async function answerDeviceMessagesPoll<
  B extends {
    tenantId: string | null;
    active: ReadonlyArray<{ expiresAt?: unknown }>;
  },
>(input: {
  screenId: string;
  ifNoneMatch: unknown;
  revision: DeviceMessagesRevision | null;
  readLive: () => Promise<B>;
}): Promise<DeviceMessagesPollAnswer<B>> {
  const { revision, screenId } = input;
  if (revision) {
    const verdict = deviceMessagesNotModified({
      screenId,
      rev: revision.rev,
      ifNoneMatch: input.ifNoneMatch,
      now: revision.now,
    });
    if (verdict.ok) {
      stats.fromMemory += 1;
      return { kind: 'not-modified', etag: verdict.etag };
    }
    countRefusal(verdict.reason);
  }

  const body = await input.readLive();

  if (!revision) return { kind: 'plain', body };
  if (
    !body ||
    body.tenantId !== revision.tenantId ||
    !Array.isArray(body.active)
  ) {
    // The live row disagreed with the snapshot (re-homed, unpaired or revoked
    // in between), or the answer is not the shape this module reasons about:
    // nothing about this screen may be remembered.
    forgetDeviceMessagesRecord(screenId);
    return { kind: 'plain', body };
  }
  // Serialise once: the ETag is a hash of the bytes actually sent.
  const json = JSON.stringify(body);
  const etag = deviceMessagesEtag(revision.rev, json);
  recordDeviceMessagesRead({
    screenId,
    rev: revision.rev,
    etag,
    readAt: revision.now,
    boundaryAt: earliestExpiryMs(body.active, revision.now),
    provisional: revision.provisional,
  });
  return { kind: 'fresh', etag, json };
}

/** Test seam: forget everything this module remembers. */
export function resetDeviceMessagesRevForTests(): void {
  records.clear();
  tenantSeen.clear();
  stats.since = 0;
  stats.fromMemory = 0;
  stats.refused.clear();
  stats.withoutRevision = 0;
}
