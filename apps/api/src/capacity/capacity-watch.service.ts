import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { monitorEventLoopDelay, IntervalHistogram } from 'perf_hooks';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAlertMailer } from '../email/platform-alert-mailer.service';
import { RedisService } from '../realtime/redis.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';
import { withTimeout } from '../health/with-timeout';
import {
  CapacityLevel,
  CapacityLimits,
  DAY_MS,
  FALLBACK_LIMITS,
  Thresholds,
  decideAlert,
  memoryLimitFromNodeOptions,
  parseLimits,
  parseThresholds,
  pctOf,
  projectDaysToLimit,
} from './capacity-math';
import { MANUAL_CHECKLIST, METRICS, METRIC_BY_KEY, MetricDef, TABLE_METRIC_COUNT, TABLE_PREFIX, tableMetricDef } from './capacity-metrics';

/**
 * CapacityWatchService (2026-10-12) — the early warning that lets us run on the cheapest plans and
 * upgrade BEFORE anything degrades.
 *
 * Hourly, leader-leased: measure what the API can see from the inside (Postgres size and
 * connections, Supabase Storage bytes, biggest tables, paired screens, Redis memory, this
 * process's RSS and event-loop lag), store one sample per metric, judge each against its plan
 * limit (`capacity-math.ts` documents every default and `CAPACITY_LIMITS`), and email
 * PLATFORM_ALERT_EMAILS (via the shared PlatformAlertMailer) when one crosses 70% / 85%.
 *
 * No new credentials. Every probe is individually bounded and best-effort: a probe that fails is
 * simply absent from that hour's sample (and logged) — it NEVER throws out of the tick and it never
 * fabricates a number. Off under NODE_ENV=test; `CAPACITY_WATCH_DISABLED=1` is the kill switch.
 *
 * Multi-replica: leased, so exactly one replica samples. RSS and event-loop lag are the LEADER's own
 * container (the lease is sticky, so it is a consistent series); fine at today's single replica.
 * Everything else is cluster-wide state.
 */

const TICK_MS = 60 * 60_000;
const FIRST_TICK_DELAY_MS = 3 * 60_000; // let boot (migrate, pool warm, lease) settle
const PROBE_TIMEOUT_MS = 8_000;
const RETENTION_DAYS = 35;

export interface Reading {
  def: MetricDef;
  value: number;
  limit: number | null;
}

export interface CapacityReportMetric {
  key: string;
  label: string;
  unit: string;
  value: number;
  limit: number | null;
  pct: number | null;
  level: CapacityLevel;
  action: string;
  link: string | null;
  sampledAt: string;
  /** [epochMs, value] points for the last 7 days. */
  trend: Array<[number, number]>;
  growthPerDay: number | null;
  daysToLimit: number | null;
}

@Injectable()
export class CapacityWatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CapacityWatchService.name);
  private timer: NodeJS.Timeout | null = null;
  private firstTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  private loopDelay: IntervalHistogram | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: PlatformAlertMailer,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.CAPACITY_WATCH_DISABLED === '1') return;
    try {
      this.loopDelay = monitorEventLoopDelay({ resolution: 20 });
      this.loopDelay.enable();
    } catch {
      this.loopDelay = null;
    }
    this.firstTimer = setTimeout(() => void this.tick(), FIRST_TICK_DELAY_MS);
    this.firstTimer.unref?.();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    this.logger.log('Capacity watch armed (hourly sample, leader-leased)');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.firstTimer) clearTimeout(this.firstTimer);
    try {
      this.loopDelay?.disable();
    } catch {
      /* ignore */
    }
  }

  /** One lease-gated pass. Exposed for specs. */
  async tick(): Promise<'ran' | 'follower' | 'busy' | 'failed'> {
    if (this.ticking) return 'busy';
    this.ticking = true;
    try {
      const status = await leadThisTick(this.lease, LEASE.CAPACITY_WATCH);
      if (!status.leader) return 'follower';
      await this.runOnce();
      return 'ran';
    } catch (e: any) {
      this.logger.warn(`[capacity-watch] tick failed: ${e?.message ?? e}`);
      return 'failed';
    } finally {
      this.ticking = false;
    }
  }

  // ───────────────────────── measurement ─────────────────────────

  /** Run one probe with a hard bound; a failure is logged once and yields null. */
  private async probe<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await withTimeout(fn(), PROBE_TIMEOUT_MS);
    } catch (e: any) {
      this.logger.warn(`[capacity-watch] probe '${name}' unavailable: ${e?.message ?? e}`);
      return null;
    }
  }

  async collect(): Promise<Reading[]> {
    const limits = parseLimits(process.env.CAPACITY_LIMITS);
    const out: Reading[] = [];
    const add = (key: string, value: number | null | undefined, limit: number | null) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return;
      const def = METRIC_BY_KEY.get(key);
      if (def) out.push({ def, value, limit });
    };

    const db = this.prisma.client;

    const size = await this.probe('db_size', async () => {
      const r = await db.$queryRaw<Array<{ v: number }>>`SELECT pg_database_size(current_database())::float8 AS v`;
      return Number(r[0]?.v);
    });
    add('db_size', size, limits.dbBytes);

    const conns = await this.probe('db_connections', async () => {
      const r = await db.$queryRaw<Array<{ used: number; max: number }>>`
        SELECT (SELECT count(*) FROM pg_stat_activity)::float8 AS used,
               current_setting('max_connections')::float8 AS max`;
      return { used: Number(r[0]?.used), max: Number(r[0]?.max) };
    });
    if (conns) add('db_connections', conns.used, limits.dbConnections ?? (conns.max > 0 ? conns.max : FALLBACK_LIMITS.dbConnections));

    // Storage bytes: Supabase keeps object sizes in storage.objects.metadata. The DATABASE_URL role
    // can read it on Supabase; elsewhere (local Postgres) the schema is absent -> metric omitted.
    const storage = await this.probe('storage_bytes', async () => {
      const r = await db.$queryRaw<Array<{ v: number }>>`
        SELECT COALESCE(SUM((metadata->>'size')::bigint), 0)::float8 AS v FROM storage.objects`;
      return Number(r[0]?.v);
    });
    add('storage_bytes', storage, limits.storageBytes);

    const tables = await this.probe('tables', async () => {
      return await db.$queryRaw<Array<{ name: string; bytes: number }>>`
        SELECT c.relname AS name, pg_total_relation_size(c.oid)::float8 AS bytes
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
         ORDER BY pg_total_relation_size(c.oid) DESC
         LIMIT ${TABLE_METRIC_COUNT}`;
    });
    for (const t of tables ?? []) {
      out.push({ def: tableMetricDef(t.name), value: Number(t.bytes), limit: null });
    }

    const screens = await this.probe('paired_screens', async () => {
      return await db.screen.count({ where: { pairedAt: { not: null } } });
    });
    add('paired_screens', screens, limits.pairedScreens);

    const redis = await this.probe('redis_memory', async () => this.readRedisMemory());
    if (redis) add('redis_memory', redis.used, limits.redisBytes ?? (redis.max > 0 ? redis.max : null));

    const memLimit = limits.memoryBytes ?? memoryLimitFromNodeOptions(process.env.NODE_OPTIONS) ?? FALLBACK_LIMITS.memoryBytes;
    add('api_memory', process.memoryUsage().rss, memLimit);

    if (this.loopDelay) {
      const p99ms = this.loopDelay.percentile(99) / 1e6;
      this.loopDelay.reset();
      add('event_loop_lag', Math.round(p99ms * 10) / 10, limits.eventLoopLagMs);
    }

    return out;
  }

  /** Redis INFO memory -> used_memory and maxmemory (0 = unlimited -> max 0). null when unreachable. */
  private async readRedisMemory(): Promise<{ used: number; max: number } | null> {
    const client = this.redis?.publisher;
    if (!client || !this.redis?.isConnected()) return null;
    const info = await client.info('memory');
    const used = /^used_memory:(\d+)/m.exec(info)?.[1];
    const max = /^maxmemory:(\d+)/m.exec(info)?.[1];
    if (!used) return null;
    return { used: Number(used), max: max ? Number(max) : 0 };
  }

  // ───────────────────────── persistence + alerting ─────────────────────────

  async runOnce(now: Date = new Date()): Promise<{ sampled: number; alerted: string[] }> {
    const readings = await this.collect();
    if (readings.length === 0) return { sampled: 0, alerted: [] };
    const thresholds = parseThresholds();
    const db = this.prisma.client;

    await db.capacitySample.createMany({
      data: readings.map((r) => ({ metric: r.def.key, value: r.value, limitValue: r.limit, createdAt: now })),
    });

    const stateRows = await db.capacityAlertState.findMany();
    const states = new Map<string, { level: CapacityLevel; lastAlertAt: Date | null }>(
      stateRows.map((s: { metric: string; level: string; lastAlertAt: Date | null }) => [
        s.metric,
        { level: (s.level as CapacityLevel) ?? 'ok', lastAlertAt: s.lastAlertAt },
      ]),
    );

    const { decisions, toAlert } = evaluateReadings(readings, states, now, thresholds);

    // Persist the new levels first: if the email below fails we still do not re-decide every hour
    // from stale state, and a mail outage costs one missed email, never a storm.
    for (const d of decisions) {
      await db.capacityAlertState.upsert({
        where: { metric: d.key },
        create: { metric: d.key, level: d.level, lastAlertAt: d.stampAlert ? now : null },
        update: { level: d.level, ...(d.stampAlert ? { lastAlertAt: now } : {}) },
      });
    }

    if (toAlert.length > 0) {
      const { subject, body } = buildAlertEmail(toAlert, thresholds);
      await this.mailer.sendAlert(subject, body, 'CAPACITY_WATCH_ALERT');
      this.logger.warn(`[capacity-watch] alerted: ${toAlert.map((a) => `${a.key}=${a.level}`).join(', ')}`);
    }

    await db.capacitySample
      .deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - RETENTION_DAYS * DAY_MS) } } })
      .catch((e: any) => this.logger.warn(`[capacity-watch] purge failed: ${e?.message ?? e}`));

    return { sampled: readings.length, alerted: toAlert.map((a) => a.key) };
  }

  // ───────────────────────── read side (Capacity card) ─────────────────────────

  async getReport(now: Date = new Date()) {
    const db = this.prisma.client;
    const since = new Date(now.getTime() - 7 * DAY_MS);
    const rows: Array<{ metric: string; value: number; limitValue: number | null; createdAt: Date }> =
      await db.capacitySample.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
        select: { metric: true, value: true, limitValue: true, createdAt: true },
      });
    const stateRows: Array<{ metric: string; level: string }> = await db.capacityAlertState.findMany();
    const levelByMetric = new Map(stateRows.map((s) => [s.metric, s.level as CapacityLevel]));

    const byMetric = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byMetric.get(r.metric);
      if (list) list.push(r);
      else byMetric.set(r.metric, [r]);
    }

    const metrics: CapacityReportMetric[] = [];
    for (const [key, list] of byMetric) {
      const def = METRIC_BY_KEY.get(key) ?? (key.startsWith(TABLE_PREFIX) ? tableMetricDef(key.slice(TABLE_PREFIX.length)) : null);
      if (!def) continue;
      const last = list[list.length - 1];
      const proj = projectDaysToLimit(
        list.map((r) => ({ t: r.createdAt.getTime(), value: r.value })),
        last.limitValue,
      );
      metrics.push({
        key,
        label: def.label,
        unit: def.unit,
        value: last.value,
        limit: last.limitValue,
        pct: pctOf(last.value, last.limitValue),
        level: levelByMetric.get(key) ?? 'ok',
        action: def.action,
        link: def.link ?? null,
        sampledAt: last.createdAt.toISOString(),
        trend: list.map((r) => [r.createdAt.getTime(), r.value] as [number, number]),
        growthPerDay: proj ? proj.perDay : null,
        daysToLimit: proj ? proj.daysToLimit : null,
      });
    }
    // Registry order first (limits before informational tables), then tables by size.
    const order = new Map(METRICS.map((m, i) => [m.key, i]));
    metrics.sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999) || b.value - a.value);

    const thresholds = parseThresholds();
    return {
      enabled: process.env.NODE_ENV !== 'test' && process.env.CAPACITY_WATCH_DISABLED !== '1',
      thresholds: { warnPct: thresholds.warnPct, criticalPct: thresholds.criticalPct },
      limits: parseLimits(process.env.CAPACITY_LIMITS) as CapacityLimits,
      metrics,
      checklist: MANUAL_CHECKLIST,
      note:
        'Sampled hourly by the leader replica. A metric missing here could not be read that hour ' +
        '(see the API log, "[capacity-watch] probe ... unavailable").',
    };
  }
}

export interface MetricDecision {
  key: string;
  level: CapacityLevel;
  stampAlert: boolean;
}

export interface AlertItem {
  key: string;
  def: MetricDef;
  level: CapacityLevel;
  value: number;
  limit: number | null;
  pct: number;
}

/** Pure: readings + remembered state -> new levels and the metrics to email about. */
export function evaluateReadings(
  readings: Reading[],
  states: Map<string, { level: CapacityLevel; lastAlertAt: Date | null }>,
  now: Date,
  thresholds: Thresholds,
): { decisions: MetricDecision[]; toAlert: AlertItem[] } {
  const decisions: MetricDecision[] = [];
  const toAlert: AlertItem[] = [];
  for (const r of readings) {
    if (r.def.limitKey === null) continue; // informational
    const pct = pctOf(r.value, r.limit);
    const prev = states.get(r.def.key) ?? { level: 'ok' as CapacityLevel, lastAlertAt: null };
    const d = decideAlert(pct, prev.level, prev.lastAlertAt, now, thresholds);
    decisions.push({ key: r.def.key, level: d.level, stampAlert: d.stampAlert });
    if (d.alert && pct !== null) {
      toAlert.push({ key: r.def.key, def: r.def, level: d.level, value: r.value, limit: r.limit, pct });
    }
  }
  return { decisions, toAlert };
}

export function formatValue(unit: string, v: number): string {
  if (unit === 'bytes') {
    if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
    return `${(v / 1024 ** 2).toFixed(1)} MB`;
  }
  if (unit === 'ms') return `${v.toFixed(1)} ms`;
  return String(Math.round(v));
}

/** Pure: one email listing every metric that crossed, worst first, each with its exact upgrade action. */
export function buildAlertEmail(items: AlertItem[], t: Thresholds): { subject: string; body: string } {
  const sorted = [...items].sort((a, b) => b.pct - a.pct);
  const critical = sorted.filter((i) => i.level === 'critical');
  const subject =
    critical.length > 0
      ? `[VenueOS] CAPACITY CRITICAL: ${critical.map((i) => i.def.label).join(', ')} past ${t.criticalPct}% of plan limit`
      : `[VenueOS] Capacity warning: ${sorted.map((i) => i.def.label).join(', ')} past ${t.warnPct}% of plan limit`;
  const lines: string[] = [
    'VenueOS is approaching a plan limit. Upgrade BEFORE it degrades:',
    '',
  ];
  for (const i of sorted) {
    lines.push(
      `${i.level.toUpperCase()}  ${i.def.label}: ${formatValue(i.def.unit, i.value)} of ${i.limit === null ? '?' : formatValue(i.def.unit, i.limit)} (${i.pct.toFixed(0)}%)`,
      `  Upgrade: ${i.def.action}`,
      ...(i.def.link ? [`  Where:   ${i.def.link}`] : []),
      '',
    );
  }
  lines.push(
    'Trend and the full list: /super/efficiency -> Capacity.',
    `Thresholds: warn ${t.warnPct}%, critical ${t.criticalPct}% (CAPACITY_WARN_PCT / CAPACITY_CRITICAL_PCT). Limits: CAPACITY_LIMITS.`,
    'Each metric emails at most once a day while it stays over a threshold, immediately if it worsens to critical.',
    '',
    '— VenueOS Capacity Watch',
  );
  return { subject, body: lines.join('\n') };
}
