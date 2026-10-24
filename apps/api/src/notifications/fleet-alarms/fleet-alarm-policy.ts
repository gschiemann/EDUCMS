/**
 * Owner fleet alarms — the POLICY (2026-10-23). Pure: no Prisma, no Redis, no
 * clock of its own, so every rule has a unit test (fleet-alarm-policy.spec.ts).
 *
 * WHY. On 2026-10-23 a device-secret rotation finished with an API restart and
 * 14 paired screens at 5 organisations stopped checking in a minute later:
 * their saved device tokens were signed by the retired key. Every refused
 * attempt was logged, every few seconds, and nobody noticed for 16 hours. The
 * customer alert emails could not have caught it either (they mute everything
 * for 15 minutes after a restart, and they ignore screens silent for more than
 * 6 hours — the outage was 12 hours old when they were deployed).
 *
 * Two OWNER-ONLY alarms (PlatformAlertMailer → PLATFORM_ALERT_EMAILS); no
 * customer is ever emailed by anything in this folder:
 *
 *   1. POST-RESTART FLEET CHECK — the screens that checked in during the 15
 *      minutes before a boot are expected back. At +10 and +20 minutes, if at
 *      least 3 of them (or 10 % of a small fleet, never a single screen) have
 *      not checked in since — or came back on a downgraded credential — the
 *      owner hears about it. One alert per boot.
 *   2. DEVICE-CREDENTIAL REFUSALS — at least 3 distinct screens refused their
 *      device credential continuously for 10 minutes (WebSocket HELLO, and
 *      `POST /screens/register`). At most one alert an hour while it lasts, and
 *      a recovery note once it stops.
 *
 * "No false alarms on normal deploys" is binding: every doubt here resolves to
 * silence, exactly as in customer-alert-policy.ts, whose intended-downtime
 * rules (on/off schedules, remote power-off, Android standby, maintenance) the
 * fleet check reuses as they are.
 */

const MIN = 60_000;

// ─── Kill switches ────────────────────────────────────────────────────────

function envFlag(v: string | undefined): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/** `POST_RESTART_FLEET_CHECK_DISABLED=1` — the boot snapshot and both checks stay off. */
export function postRestartFleetCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlag(env.POST_RESTART_FLEET_CHECK_DISABLED);
}

/**
 * `DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED=1` — nothing is recorded on the
 * refusal paths (not even the in-process count) and the evaluator never arms.
 */
export function deviceCredentialRefusalAlarmDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlag(env.DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED);
}

// ─── Thresholds ───────────────────────────────────────────────────────────

export const FLEET_ALARM_RULES = {
  // ── 1. Post-restart fleet check ──
  /** The cohort: screens whose player checked in during this long before the boot. */
  BOOT_COHORT_LOOKBACK_MS: 15 * MIN,
  /** When the check runs, after the boot. */
  BOOT_CHECK_OFFSETS_MS: [10 * MIN, 20 * MIN] as readonly number[],
  /**
   * A check-in stamped up to this long after the boot does not prove the
   * screen came back. During Railway's hand-over the OLD container keeps
   * serving: on 2026-10-23 the dark screens' last check-ins were 1–2 minutes
   * after the restart, then nothing — the new process refused them. A healthy
   * screen checks in every ~25–60 s (the debounced `lastPingAt` write), so by
   * +10 min it has many check-ins after this mark.
   */
  BOOT_HANDOVER_GRACE_MS: 5 * MIN,
  /** Alert when at least this many screens are not back… */
  BOOT_MIN_SCREENS: 3,
  /** …or at least this share of the screens expected back (a small fleet)… */
  BOOT_MIN_SHARE: 0.1,
  /** …but never for a single screen. */
  BOOT_FLOOR: 2,

  // ── 2. Device-credential refusals ──
  /** Refusals are counted in one-minute buckets of distinct screens. */
  REFUSAL_BUCKET_MS: MIN,
  /** Buckets the evaluator reads (the run math needs CONTINUOUS + gap + now). */
  REFUSAL_WINDOW_BUCKETS: 15,
  /** Refused continuously this long = alarm-worthy. */
  REFUSAL_CONTINUOUS_MS: 10 * MIN,
  /**
   * One quiet minute inside a run is tolerated. A refused player retries the
   * socket every ≤ 30 s (1–30 s backoff, never gives up) and re-registers once
   * a minute, so a real lock-out shows up in every bucket; one empty bucket is
   * jitter at the boundary, two is a screen that stopped trying.
   */
  REFUSAL_MAX_GAP_BUCKETS: 1,
  /** Distinct screens refused continuously before the owner hears about it. */
  REFUSAL_MIN_SCREENS: 3,
  /** At most one problem email per this window while it lasts. */
  REFUSAL_REALERT_MS: 60 * MIN,
  /** The condition must stay clear this long before the recovery note. */
  REFUSAL_RECOVERY_HOLD_MS: 5 * MIN,
  /**
   * A screen whose push channel was admitted this recently is not locked out,
   * whatever else is being refused in its name (`lastPushConnectedAt` is
   * stamped on every socket admission and, debounced to a minute, on every
   * heartbeat). This is also what keeps forged tokens naming a HEALTHY screen
   * from counting toward the alarm.
   */
  PUSH_LIVE_MS: 3 * MIN,
} as const;

// ═════════════════════════════════════════════════════════════════════════
// 1. POST-RESTART FLEET CHECK
// ═════════════════════════════════════════════════════════════════════════

/** The columns the boot check reads for one screen of the cohort (current values). */
export interface BootCohortRow {
  id: string;
  name: string;
  tenantId: string | null;
  status: string | null;
  pairedAt: Date | null;
  /** The player's own authenticated check-in (manifest poll, heartbeat, telemetry, register). */
  lastPingAt: Date | null;
  /**
   * Written by the anonymous, fingerprint-keyed update checks too (the Manager
   * runs both every 30 min), so they say "the UNIT is powered", never "the
   * player is working": on 2026-10-23 they kept moving for every dark screen.
   * They label a missing screen; they never decide whether it is back.
   */
  playerVersionAt: Date | null;
  managerVersionAt: Date | null;
  authState: string | null;
  authStateChangedAt: Date | null;
}

/**
 * The cohort predicate: a paired screen whose player checked in at or after
 * `bootAt − 15 min`. `lastPingAt` only ever moves forward, so a screen that
 * checked in before the boot still matches after it — the snapshot can be
 * taken (or retaken) at any time after the boot with the same answer.
 * Screens paired after the boot were never expected back.
 */
export function inBootCohort(row: Pick<BootCohortRow, 'tenantId' | 'status' | 'pairedAt' | 'lastPingAt'>, bootAtMs: number): boolean {
  if (!row.tenantId || row.status === 'REVOKED') return false;
  if (row.pairedAt && row.pairedAt.getTime() > bootAtMs) return false;
  return !!row.lastPingAt && row.lastPingAt.getTime() >= bootAtMs - FLEET_ALARM_RULES.BOOT_COHORT_LOOKBACK_MS;
}

/** Has this screen's player checked in since the boot (past the hand-over)? */
export function checkedInSinceBoot(lastPingAt: Date | null, bootAtMs: number): boolean {
  return !!lastPingAt && lastPingAt.getTime() >= bootAtMs + FLEET_ALARM_RULES.BOOT_HANDOVER_GRACE_MS;
}

/**
 * Checked in, but on a DOWNGRADED credential since the boot: register stamps
 * `authState = REPAIR_REQUIRED` when it can only issue a 1-hour credential
 * (no proof of the prior token). The screen keeps content and alerts through
 * the manifest poll, but has no push channel and needs Restore trust — the
 * shape the retired-key screens take once a register no longer 401s them.
 */
export function downgradedSinceBoot(row: Pick<BootCohortRow, 'authState' | 'authStateChangedAt'>, bootAtMs: number): boolean {
  return row.authState === 'REPAIR_REQUIRED' && !!row.authStateChangedAt && row.authStateChangedAt.getTime() >= bootAtMs;
}

/** How many screens must be not-back for the alarm: ≥ 3, or ≥ 10 % of a small fleet, never 1. */
export function bootAlarmThreshold(expectedBack: number): number {
  const r = FLEET_ALARM_RULES;
  const share = Math.ceil(Math.max(0, expectedBack) * r.BOOT_MIN_SHARE);
  return Math.max(r.BOOT_FLOOR, Math.min(r.BOOT_MIN_SCREENS, share));
}

export interface BootCheckVerdict {
  /** Cohort screens still paired at the check. */
  cohort: number;
  /** Cohort screens since unpaired / revoked / deleted (not "missing" — gone). */
  gone: number;
  /** Missing screens whose silence is intended (reason → count), not counted. */
  excused: Record<string, number>;
  /** Screens expected back = cohort − excused. The threshold's denominator. */
  expected: number;
  /** Not checked in since the boot (and not excused). */
  missing: BootCohortRow[];
  /** Checked in, but fell to a 1-hour credential + re-pair required since the boot. */
  downgraded: BootCohortRow[];
  threshold: number;
  alert: boolean;
}

/**
 * The verdict at one check point. `rows` are the cohort's CURRENT rows (a
 * screen deleted since the boot simply is not there); `excuse` answers "is
 * this missing screen meant to be off?" from the customer alerts'
 * `intendedDowntime` (or returns null).
 */
export function evaluateBootCheck(input: {
  bootAtMs: number;
  cohortIds: readonly string[];
  rows: readonly BootCohortRow[];
  excuse: (row: BootCohortRow) => string | null;
}): BootCheckVerdict {
  const byId = new Map(input.rows.map((r) => [r.id, r]));
  let gone = 0;
  const excused: Record<string, number> = {};
  const missing: BootCohortRow[] = [];
  const downgraded: BootCohortRow[] = [];
  let excusedCount = 0;
  let cohort = 0;
  for (const id of new Set(input.cohortIds)) {
    const row = byId.get(id);
    if (!row || !row.tenantId || row.status === 'REVOKED') {
      gone++;
      continue;
    }
    cohort++;
    if (checkedInSinceBoot(row.lastPingAt, input.bootAtMs)) {
      if (downgradedSinceBoot(row, input.bootAtMs)) downgraded.push(row);
      continue;
    }
    const reason = input.excuse(row);
    if (reason) {
      excused[reason] = (excused[reason] ?? 0) + 1;
      excusedCount++;
      continue;
    }
    missing.push(row);
  }
  const expected = cohort - excusedCount;
  const threshold = bootAlarmThreshold(expected);
  const notBack = missing.length + downgraded.length;
  return { cohort, gone, excused, expected, missing, downgraded, threshold, alert: notBack >= threshold };
}

// ═════════════════════════════════════════════════════════════════════════
// 2. DEVICE-CREDENTIAL REFUSALS
// ═════════════════════════════════════════════════════════════════════════

export type RefusalSource = 'ws' | 'register';

/**
 * Why a credential was refused, in the few words the owner email uses.
 *   signature   — no key we hold verifies its signature (the retired-key case);
 *   expired     — past its `exp` and not renewed;
 *   superseded  — its credential epoch was rotated past (another register won);
 *   register    — `POST /screens/register` 401'd the prior token it presented.
 */
export type RefusalCategory = 'signature' | 'expired' | 'superseded' | 'register';

/**
 * The admission refusal reasons (device-auth.ts `admitDeviceCredential`) this
 * alarm counts, or null for the ones it deliberately does not:
 *   - `credential_unproven` — a 1-hour bootstrap credential is refused at the
 *     socket BY DESIGN (SEC-001) while its manifest poll still delivers content
 *     and alerts, and the dashboard already says "re-pair required"; counting
 *     it would turn every unrepaired screen into an hourly owner email. The
 *     fleet check reports a WAVE of them after a restart instead;
 *   - operator retirements — `token_revoked`, `screen_revoked`,
 *     `screen_unpaired`, `screen_not_found`: someone meant it;
 *   - `revocation_check_unavailable` — an infrastructure fault the platform
 *     health monitor already pages for;
 *   - `no_auth`, `wrong_token_kind`, `subject_*`, and every other
 *     `jwt_invalid:*` (malformed, wrong algorithm, stripped signature) — not a
 *     credential this API could have issued to a screen.
 */
export function refusalCategoryOf(reason: unknown): RefusalCategory | null {
  if (reason === 'jwt_invalid:invalid signature') return 'signature';
  if (reason === 'jwt_invalid:jwt expired') return 'expired';
  if (reason === 'credential_epoch_stale') return 'superseded';
  return null;
}

/** Screen ids are UUIDs; this bounds what an unverified claim can put in a Redis set. */
const SCREEN_ID_SHAPE = /^[A-Za-z0-9_-]{6,64}$/;
const SOURCES: ReadonlySet<string> = new Set<RefusalSource>(['ws', 'register']);
const CATEGORIES: ReadonlySet<string> = new Set<RefusalCategory>(['signature', 'expired', 'superseded', 'register']);

export interface RefusalMark {
  screenId: string;
  source: RefusalSource;
  category: RefusalCategory;
}

export function isPlausibleScreenId(id: unknown): id is string {
  return typeof id === 'string' && SCREEN_ID_SHAPE.test(id);
}

/** One bucket member. `|` cannot occur in any field (shapes above). */
export function refusalMember(m: RefusalMark): string {
  return `${m.screenId}|${m.source}|${m.category}`;
}

export function parseRefusalMember(raw: unknown): RefusalMark | null {
  if (typeof raw !== 'string') return null;
  const [screenId, source, category, extra] = raw.split('|');
  if (extra !== undefined || !isPlausibleScreenId(screenId) || !SOURCES.has(source) || !CATEGORIES.has(category)) return null;
  return { screenId, source: source as RefusalSource, category: category as RefusalCategory };
}

export function refusalBucketOf(ms: number): number {
  return Math.floor(ms / FLEET_ALARM_RULES.REFUSAL_BUCKET_MS);
}

export interface RefusalRun {
  screenId: string;
  /** Start of the run's first bucket (ms). */
  sinceMs: number;
  /** Start of the newest bucket the screen was refused in (ms). */
  lastMs: number;
  /** Buckets in the run in which the screen was refused. */
  refusedBuckets: number;
  sources: RefusalSource[];
  categories: RefusalCategory[];
}

/**
 * Each screen's CURRENT run of refusals, from minute buckets (bucket index →
 * members). The run ends at the screen's newest bucket and reaches back while
 * no more than REFUSAL_MAX_GAP_BUCKETS consecutive buckets are empty for it.
 * A run older than the window is cut at the window's start — it is at least
 * that long.
 */
export function refusalRuns(buckets: ReadonlyMap<number, Iterable<string>>, nowMs: number): RefusalRun[] {
  const r = FLEET_ALARM_RULES;
  const nowBucket = refusalBucketOf(nowMs);
  const firstBucket = nowBucket - r.REFUSAL_WINDOW_BUCKETS + 1;
  const seen = new Map<string, Map<number, RefusalMark[]>>();
  for (const [bucket, members] of buckets) {
    if (bucket < firstBucket || bucket > nowBucket) continue;
    for (const raw of members) {
      const m = parseRefusalMember(raw);
      if (!m) continue;
      let byBucket = seen.get(m.screenId);
      if (!byBucket) seen.set(m.screenId, (byBucket = new Map()));
      const list = byBucket.get(bucket) ?? [];
      list.push(m);
      byBucket.set(bucket, list);
    }
  }
  const out: RefusalRun[] = [];
  for (const [screenId, byBucket] of seen) {
    const newest = Math.max(...byBucket.keys());
    let start = newest;
    let gap = 0;
    let refused = 1;
    for (let b = newest - 1; b >= firstBucket; b--) {
      if (byBucket.has(b)) {
        start = b;
        gap = 0;
        refused++;
      } else if (++gap > r.REFUSAL_MAX_GAP_BUCKETS) {
        break;
      }
    }
    const marks = [...byBucket.entries()].filter(([b]) => b >= start).flatMap(([, ms]) => ms);
    out.push({
      screenId,
      sinceMs: start * r.REFUSAL_BUCKET_MS,
      lastMs: newest * r.REFUSAL_BUCKET_MS,
      refusedBuckets: refused,
      sources: [...new Set(marks.map((m) => m.source))].sort(),
      categories: [...new Set(marks.map((m) => m.category))].sort(),
    });
  }
  return out.sort((a, b) => a.sinceMs - b.sinceMs || a.screenId.localeCompare(b.screenId));
}

/**
 * Refused continuously for ≥ 10 minutes AND still being refused (in this
 * minute or the previous one — the current bucket may be seconds old).
 * Minute-granular: the run's first and current buckets are 10 apart.
 */
export function isContinuousRefusal(run: RefusalRun, nowMs: number): boolean {
  const r = FLEET_ALARM_RULES;
  const nowBucket = refusalBucketOf(nowMs);
  if (nowBucket - refusalBucketOf(run.lastMs) > 1) return false;
  return nowBucket - refusalBucketOf(run.sinceMs) >= r.REFUSAL_CONTINUOUS_MS / r.REFUSAL_BUCKET_MS;
}

/** Does this screen have a working push channel right now? Then it is not locked out. */
export function pushChannelLive(lastPushConnectedAt: Date | null | undefined, nowMs: number): boolean {
  if (!lastPushConnectedAt) return false;
  const age = nowMs - lastPushConnectedAt.getTime();
  return age >= -MIN && age < FLEET_ALARM_RULES.PUSH_LIVE_MS;
}

// ─── The alarm's state machine ────────────────────────────────────────────

export interface RefusalAlarmState {
  v: 1;
  /** An incident the owner was told about is open. */
  alerting: boolean;
  /** The last PROBLEM email (first alert or hourly reminder), ms. 0 = never. */
  lastAlertAtMs: number;
  /** The open incident's earliest refusal (ms), for the copy. */
  incidentSinceMs: number | null;
  /** Every screen any email of the open incident named. */
  alertedIds: string[];
  /** The condition has been clear since (ms), while an incident is open. */
  clearSinceMs: number | null;
}

export const INITIAL_REFUSAL_ALARM_STATE: RefusalAlarmState = {
  v: 1,
  alerting: false,
  lastAlertAtMs: 0,
  incidentSinceMs: null,
  alertedIds: [],
  clearSinceMs: null,
};

export type RefusalAlarmAction =
  | { kind: 'none' }
  /** The condition holds but a problem email went out less than an hour ago. */
  | { kind: 'throttled' }
  | { kind: 'alert'; reminder: boolean }
  | { kind: 'recovered'; alertedIds: string[]; incidentSinceMs: number | null };

/**
 * One evaluator tick. `qualifyingIds` are the real, paired screens refused
 * continuously for 10 min right now; `earliestSinceMs` is the oldest of their
 * runs. Problem emails: at most one per REFUSAL_REALERT_MS — the first when
 * the condition starts, a reminder each hour it lasts. Recovery: once the
 * condition has stayed clear for REFUSAL_RECOVERY_HOLD_MS, and only for an
 * incident the owner was told about.
 */
export function stepRefusalAlarm(
  state: RefusalAlarmState,
  qualifyingIds: readonly string[],
  earliestSinceMs: number | null,
  nowMs: number,
): { state: RefusalAlarmState; action: RefusalAlarmAction } {
  const r = FLEET_ALARM_RULES;
  const on = qualifyingIds.length >= r.REFUSAL_MIN_SCREENS;
  if (on) {
    const throttled = nowMs - state.lastAlertAtMs < r.REFUSAL_REALERT_MS;
    if (!state.alerting) {
      if (throttled) return { state: { ...state, clearSinceMs: null }, action: { kind: 'throttled' } };
      return {
        state: {
          v: 1,
          alerting: true,
          lastAlertAtMs: nowMs,
          incidentSinceMs: earliestSinceMs,
          alertedIds: [...qualifyingIds],
          clearSinceMs: null,
        },
        action: { kind: 'alert', reminder: false },
      };
    }
    const alertedIds = [...new Set([...state.alertedIds, ...qualifyingIds])];
    const incidentSinceMs =
      state.incidentSinceMs === null ? earliestSinceMs : earliestSinceMs === null ? state.incidentSinceMs : Math.min(state.incidentSinceMs, earliestSinceMs);
    if (throttled) return { state: { ...state, alertedIds, incidentSinceMs, clearSinceMs: null }, action: { kind: 'none' } };
    return {
      state: { ...state, alertedIds, incidentSinceMs, lastAlertAtMs: nowMs, clearSinceMs: null },
      action: { kind: 'alert', reminder: true },
    };
  }
  if (!state.alerting) return { state, action: { kind: 'none' } };
  const clearSinceMs = state.clearSinceMs ?? nowMs;
  if (nowMs - clearSinceMs < r.REFUSAL_RECOVERY_HOLD_MS) return { state: { ...state, clearSinceMs }, action: { kind: 'none' } };
  return {
    state: { ...state, alerting: false, incidentSinceMs: null, alertedIds: [], clearSinceMs: null },
    action: { kind: 'recovered', alertedIds: state.alertedIds, incidentSinceMs: state.incidentSinceMs },
  };
}

/** Parse a persisted state; anything unreadable is the initial state. */
export function parseRefusalAlarmState(raw: unknown): RefusalAlarmState {
  try {
    const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!s || typeof s !== 'object' || (s as { v?: unknown }).v !== 1) return { ...INITIAL_REFUSAL_ALARM_STATE };
    const o = s as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      v: 1,
      alerting: o.alerting === true,
      lastAlertAtMs: num(o.lastAlertAtMs) ?? 0,
      incidentSinceMs: num(o.incidentSinceMs),
      alertedIds: Array.isArray(o.alertedIds) ? o.alertedIds.filter(isPlausibleScreenId).slice(0, 2_000) : [],
      clearSinceMs: num(o.clearSinceMs),
    };
  } catch {
    return { ...INITIAL_REFUSAL_ALARM_STATE };
  }
}
