/**
 * Capacity early-warning — PURE math and configuration (no Nest, no Prisma, no I/O).
 *
 * Owner rule (2026-10-12): launch on the cheapest plans and upgrade BEFORE anything degrades.
 * Everything that decides "is this metric close to its plan limit, and should we say so now"
 * lives here so it is unit-tested without a database.
 *
 * ── LIMITS (where to change them) ───────────────────────────────────────────────────────────
 * `CAPACITY_LIMITS` (env, JSON) overrides any subset of the keys below, e.g.
 *   CAPACITY_LIMITS='{"dbBytes":17179869184,"pairedScreens":2500}'
 * Values are in the metric's own unit (bytes / count / ms). Defaults describe TODAY's plans:
 *   dbBytes          8 GiB    Supabase Pro includes 8 GB of database disk (grows on demand, billed).
 *   dbConnections    live     `SHOW max_connections` (60 on Micro compute, 90 on Small). Override only to
 *                             alert on a stricter number; the live value follows a compute upgrade.
 *   storageBytes     100 GiB  Supabase Pro includes 100 GB of file storage.
 *   redisBytes       256 MiB  Railway Redis; the live `maxmemory` is used when the server sets one.
 *   memoryBytes      NODE_OPTIONS --max-old-space-size, else 8 GiB (Railway container ceiling today).
 *   eventLoopLagMs   250 ms   p99 event-loop delay; sustained lag above this means the one API container
 *                             is CPU-bound and needs more CPU or a second replica.
 *   pairedScreens    1000     Fleet size at which Micro compute stops being comfortable (the
 *                             write-heavy telemetry tables are the first thing to saturate).
 * Thresholds: `CAPACITY_WARN_PCT` (default 70) and `CAPACITY_CRITICAL_PCT` (default 85).
 */

export type CapacityLevel = 'ok' | 'warn' | 'critical';

export type LimitKey =
  | 'dbBytes'
  | 'dbConnections'
  | 'storageBytes'
  | 'redisBytes'
  | 'memoryBytes'
  | 'eventLoopLagMs'
  | 'pairedScreens';

export type CapacityLimits = Record<LimitKey, number | null>;

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/** Static defaults. `null` = "take the live value from the server, fall back to the hard default". */
export const DEFAULT_LIMITS: CapacityLimits = {
  dbBytes: 8 * GIB,
  dbConnections: null,
  storageBytes: 100 * GIB,
  redisBytes: 256 * MIB,
  memoryBytes: null,
  eventLoopLagMs: 250,
  pairedScreens: 1000,
};

/** Hard fallbacks for the `null` defaults above (used when the live value is unreadable). */
export const FALLBACK_LIMITS = {
  dbConnections: 60,
  memoryBytes: 8 * GIB,
} as const;

export interface Thresholds {
  warnPct: number;
  criticalPct: number;
  /** Points below a threshold the metric must fall before the level steps down (hysteresis). */
  clearMarginPct: number;
  /** Minimum gap between two emails about the same metric. */
  realertMs: number;
}

export const DAY_MS = 24 * 3600_000;

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseThresholds(env: NodeJS.ProcessEnv = process.env): Thresholds {
  let warnPct = num(env.CAPACITY_WARN_PCT) ?? 70;
  let criticalPct = num(env.CAPACITY_CRITICAL_PCT) ?? 85;
  // A typo that inverts the pair must not silence the critical tier.
  if (warnPct >= criticalPct) {
    warnPct = 70;
    criticalPct = 85;
  }
  return { warnPct, criticalPct, clearMarginPct: 5, realertMs: DAY_MS };
}

/** Parse CAPACITY_LIMITS. Bad JSON or non-positive numbers are ignored key-by-key, never fatal. */
export function parseLimits(raw: string | undefined, base: CapacityLimits = DEFAULT_LIMITS): CapacityLimits {
  const out: CapacityLimits = { ...base };
  if (!raw || !raw.trim()) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object') return out;
  for (const key of Object.keys(base) as LimitKey[]) {
    const v = num((parsed as Record<string, unknown>)[key]);
    if (v !== null) out[key] = v;
  }
  return out;
}

/** `--max-old-space-size=4096` (MB) from NODE_OPTIONS, in bytes. */
export function memoryLimitFromNodeOptions(nodeOptions: string | undefined): number | null {
  const m = /--max[-_]old[-_]space[-_]size=(\d+)/.exec(nodeOptions || '');
  if (!m) return null;
  const mb = Number(m[1]);
  return mb > 0 ? mb * MIB : null;
}

export function pctOf(value: number, limit: number | null): number | null {
  if (limit === null || !(limit > 0)) return null;
  return (value / limit) * 100;
}

/** Raw level for a percentage, no memory. */
export function rawLevel(pct: number | null, t: Thresholds): CapacityLevel {
  if (pct === null) return 'ok';
  if (pct >= t.criticalPct) return 'critical';
  if (pct >= t.warnPct) return 'warn';
  return 'ok';
}

const RANK: Record<CapacityLevel, number> = { ok: 0, warn: 1, critical: 2 };

/**
 * Level after hysteresis. Going UP is immediate. Going DOWN needs the metric to fall `clearMarginPct`
 * below the threshold it crossed, so a metric hovering at 70% does not flap ok<->warn every hour.
 */
export function levelWithHysteresis(pct: number | null, previous: CapacityLevel, t: Thresholds): CapacityLevel {
  const raw = rawLevel(pct, t);
  if (RANK[raw] >= RANK[previous]) return raw;
  if (pct === null) return 'ok';
  // Falling: hold the previous level until we are clear of its threshold by the margin.
  if (previous === 'critical') {
    if (pct >= t.criticalPct - t.clearMarginPct) return 'critical';
    return pct >= t.warnPct ? 'warn' : levelWithHysteresis(pct, 'warn', t);
  }
  // previous === 'warn'
  return pct >= t.warnPct - t.clearMarginPct ? 'warn' : 'ok';
}

export interface AlertDecision {
  level: CapacityLevel;
  /** Send an email about this metric now. */
  alert: boolean;
  /** Stamp lastAlertAt (true exactly when alert is true). */
  stampAlert: boolean;
}

/**
 * Decide the new level and whether to email.
 *  - Never email for `ok`.
 *  - Email when the level RISES (ok->warn, warn->critical, ok->critical), unless we already emailed
 *    about this metric within the last day (once per metric per day) AND the level did not worsen.
 *    A worsening to `critical` always emails — a 70%->85% escalation must not wait for tomorrow.
 *  - While a level persists, repeat at most once per `realertMs`.
 */
export function decideAlert(
  pct: number | null,
  previous: CapacityLevel,
  lastAlertAt: Date | null,
  now: Date,
  t: Thresholds,
): AlertDecision {
  const level = levelWithHysteresis(pct, previous, t);
  if (level === 'ok') return { level, alert: false, stampAlert: false };

  const sinceLast = lastAlertAt ? now.getTime() - lastAlertAt.getTime() : Infinity;
  const escalated = RANK[level] > RANK[previous];
  const escalatedToCritical = escalated && level === 'critical';

  if (escalatedToCritical) return { level, alert: true, stampAlert: true };
  if (sinceLast >= t.realertMs) return { level, alert: true, stampAlert: true };
  return { level, alert: false, stampAlert: false };
}

export interface TrendPoint {
  t: number; // epoch ms
  value: number;
}

/**
 * Least-squares growth per day over the points, and days until `limit` at that rate.
 * null when there is too little history (<2 points / <1 h span), growth is flat or negative,
 * or the projection is absurdly far out (>3650 days).
 */
export function projectDaysToLimit(
  points: TrendPoint[],
  limit: number | null,
): { perDay: number; daysToLimit: number | null } | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const span = sorted[sorted.length - 1].t - sorted[0].t;
  if (span < 3600_000) return null;
  const n = sorted.length;
  const t0 = sorted[0].t;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of sorted) {
    const x = (p.t - t0) / DAY_MS;
    sx += x;
    sy += p.value;
    sxx += x * x;
    sxy += x * p.value;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const perDay = (n * sxy - sx * sy) / denom;
  const last = sorted[n - 1].value;
  if (limit === null || !(perDay > 0) || last >= limit) return { perDay, daysToLimit: null };
  const days = (limit - last) / perDay;
  return { perDay, daysToLimit: days > 3650 ? null : days };
}
