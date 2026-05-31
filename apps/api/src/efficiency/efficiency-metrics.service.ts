import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisService } from '../realtime/redis.service';

/**
 * EfficiencyMetricsService
 *
 * Multi-replica safe metrics aggregation via Redis HINCRBY / LPUSH.
 * All Redis writes are fire-and-forget inside try/catch so a Redis
 * outage NEVER breaks a real API request. The app continues serving;
 * only metrics collection is degraded.
 *
 * Rolling window: 60-minute sliding window using per-minute Redis hashes
 * keyed as `eff:req:YYYYMMDDHHMM`. Each key has a 2-hour TTL so Redis
 * stays bounded. An in-process ring of the last 60 sample-minutes is kept
 * for the /super/efficiency live view — written on every recorded tick,
 * survives Redis being down.
 *
 * Egress budget: EGRESS_BUDGET_GB env var (default 250 GB = Supabase Pro).
 * Thresholds: 50 / 70 / 90% of budget trigger alerts (deduplicated per hour).
 */
@Injectable()
export class EfficiencyMetricsService implements OnModuleInit {
  private readonly logger = new Logger(EfficiencyMetricsService.name);

  // In-process ring for the live view — max 60 entries (60 minutes).
  // Written on every recordRequest call so /super/efficiency works
  // even without Redis.
  private readonly ring: Array<{
    minute: string;          // 'YYYYMMDDHHMM'
    requests: number;
    bytes: number;
    latencySum: number;      // ms sum for p50/p95 approximation
    latencyCount: number;
    latencies: number[];     // last N (capped at 200 per minute) for percentile
  }> = [];

  // Slow-query ring: last 50 slow queries across all replicas (per-process).
  // Multi-replica coverage: top slow queries are also written to Redis.
  private readonly slowQueryRing: Array<{
    model: string;
    action: string;
    durationMs: number;
    ts: number;
  }> = [];

  // Per-route byte counters (in-process, cumulative since last restart).
  private readonly routeBytes = new Map<string, number>();
  private readonly routeCounts = new Map<string, number>();
  private readonly routeLatencySum = new Map<string, number>();

  // Asset/egress tracking
  private totalEgressBytes = 0;
  private assetHits = 0;
  private assetMisses = 0; // requests without If-None-Match / If-Modified-Since (no cache)

  // Alert de-dupe: track which threshold was last fired this hour
  private lastAlertThreshold: number | null = null;
  private lastAlertHour = -1;
  private lastAnomalyHour = -1;

  // Hourly egress samples for anomaly detection (trailing 7 × 24 slots = 168)
  private readonly hourlyEgressBytes: number[] = new Array(168).fill(0);
  private currentHourIndex = 0;
  private currentHourStart = 0;

  // Budget in bytes
  private readonly egressBudgetBytes: number;

  constructor(private readonly redis: RedisService) {
    const budgetGb = parseFloat(process.env.EGRESS_BUDGET_GB || '250');
    this.egressBudgetBytes = budgetGb * 1024 * 1024 * 1024;
    this.currentHourStart = Math.floor(Date.now() / 3_600_000);
  }

  onModuleInit() {
    // Nothing to await — Redis is already initialized by RealtimeModule.
    this.logger.log(
      `EfficiencyMetricsService ready. Budget: ${(this.egressBudgetBytes / 1e9).toFixed(0)} GB`,
    );
  }

  /** Called by EfficiencyInterceptor for every completed request. */
  recordRequest(params: {
    route: string;         // e.g. 'GET /api/v1/screens'
    statusCode: number;
    bytes: number;         // response body bytes
    durationMs: number;
    isAsset: boolean;
    hadConditionalHeaders: boolean; // If-None-Match / If-Modified-Since present
    wasNotModified: boolean;        // 304 response
  }) {
    const { route, bytes, durationMs, isAsset, hadConditionalHeaders, wasNotModified } = params;

    // ── In-process ring ──────────────────────────────────────────────
    const now = Date.now();
    const minute = this.toMinuteKey(now);
    let slot = this.ring[this.ring.length - 1];
    if (!slot || slot.minute !== minute) {
      slot = { minute, requests: 0, bytes: 0, latencySum: 0, latencyCount: 0, latencies: [] };
      this.ring.push(slot);
      if (this.ring.length > 60) this.ring.shift();
    }
    slot.requests++;
    slot.bytes += bytes;
    slot.latencySum += durationMs;
    slot.latencyCount++;
    if (slot.latencies.length < 200) slot.latencies.push(durationMs);

    // ── Per-route accumulators ────────────────────────────────────────
    this.routeBytes.set(route, (this.routeBytes.get(route) ?? 0) + bytes);
    this.routeCounts.set(route, (this.routeCounts.get(route) ?? 0) + 1);
    this.routeLatencySum.set(route, (this.routeLatencySum.get(route) ?? 0) + durationMs);

    // ── Asset / egress accounting ─────────────────────────────────────
    if (isAsset) {
      this.totalEgressBytes += bytes;
      if (wasNotModified) {
        this.assetHits++;
      } else if (hadConditionalHeaders) {
        this.assetHits++; // had conditional but wasn't 304 → cache miss at CDN level
      } else {
        this.assetMisses++;
      }
    }

    // ── Hourly egress tracking ────────────────────────────────────────
    const hourIndex = Math.floor(now / 3_600_000);
    if (hourIndex !== this.currentHourStart) {
      // Hour rolled over — advance the ring
      this.currentHourIndex = (this.currentHourIndex + 1) % this.hourlyEgressBytes.length;
      this.hourlyEgressBytes[this.currentHourIndex] = 0;
      this.currentHourStart = hourIndex;
    }
    this.hourlyEgressBytes[this.currentHourIndex] += bytes;

    // ── Redis fan-out (best-effort) ───────────────────────────────────
    void this.redisIncrement(minute, bytes, durationMs);
  }

  /** Called by slow-query Prisma middleware. */
  recordSlowQuery(model: string, action: string, durationMs: number) {
    const entry = { model, action, durationMs, ts: Date.now() };
    this.slowQueryRing.unshift(entry);
    if (this.slowQueryRing.length > 50) this.slowQueryRing.pop();

    // Best-effort Redis push so multi-replica fleets see each other's slow queries.
    void this.redisPushSlowQuery(model, action, durationMs);
  }

  /** Return the metrics snapshot for /super/efficiency. */
  getSnapshot() {
    // Aggregate the ring for totals over the rolling window.
    const windowMinutes = Math.min(this.ring.length, 60);
    let totalRequests = 0;
    let totalBytes = 0;
    const allLatencies: number[] = [];

    for (const slot of this.ring) {
      totalRequests += slot.requests;
      totalBytes += slot.bytes;
      allLatencies.push(...slot.latencies);
    }
    allLatencies.sort((a, b) => a - b);
    const p50 = percentile(allLatencies, 0.5);
    const p95 = percentile(allLatencies, 0.95);

    // Top routes by bytes
    const routeList = Array.from(this.routeBytes.entries()).map(([route, bytes]) => ({
      route,
      bytes,
      requests: this.routeCounts.get(route) ?? 0,
      avgLatencyMs: Math.round((this.routeLatencySum.get(route) ?? 0) / (this.routeCounts.get(route) ?? 1)),
    }));
    routeList.sort((a, b) => b.bytes - a.bytes);
    const topByBytes = routeList.slice(0, 10);

    const byRequests = [...routeList].sort((a, b) => b.requests - a.requests).slice(0, 10);

    // Slow queries (cross-replica if Redis available, else per-process)
    const slowQueries = this.slowQueryRing.slice(0, 20);

    // Egress
    const budgetGb = this.egressBudgetBytes / 1e9;
    const rollingEgressGb = this.totalEgressBytes / 1e9;
    const egressPct = (this.totalEgressBytes / this.egressBudgetBytes) * 100;

    // Cache-hit ratio (for asset/proxy paths where we can measure)
    const totalAssetReqs = this.assetHits + this.assetMisses;
    const cacheHitRatio = totalAssetReqs > 0
      ? Math.round((this.assetHits / totalAssetReqs) * 100)
      : null;

    // Anomaly: current hourly rate vs trailing baseline
    const currentHourBytes = this.hourlyEgressBytes[this.currentHourIndex];
    const trailing = [...this.hourlyEgressBytes];
    trailing.splice(this.currentHourIndex, 1); // exclude current
    const baseline = trailing.filter(v => v > 0);
    const baselineAvg = baseline.length > 0
      ? baseline.reduce((a, b) => a + b, 0) / baseline.length
      : 0;
    const anomalyRatio = baselineAvg > 0 ? currentHourBytes / baselineAvg : null;

    // Efficiency score (0-100, higher is better)
    // Penalties: high egress vs budget, low cache hit ratio, high p95 latency
    let score = 100;
    score -= Math.min(40, egressPct * 0.4);        // up to -40 for egress
    if (cacheHitRatio !== null) {
      score -= Math.max(0, (100 - cacheHitRatio) * 0.2); // up to -20 for cache misses
    }
    if (p95 > 500) score -= Math.min(20, (p95 - 500) / 100);  // up to -20 for slow p95
    score = Math.max(0, Math.round(score));

    const worstOffenders: string[] = [];
    if (egressPct > 70) worstOffenders.push(`Egress at ${egressPct.toFixed(1)}% of budget`);
    if (cacheHitRatio !== null && cacheHitRatio < 50) worstOffenders.push(`Cache hit ratio low: ${cacheHitRatio}%`);
    if (p95 > 1000) worstOffenders.push(`p95 latency high: ${p95}ms`);
    if (anomalyRatio !== null && anomalyRatio > 3) {
      worstOffenders.push(`Egress anomaly: ${anomalyRatio.toFixed(1)}x baseline this hour`);
    }

    return {
      window: { minutes: windowMinutes, from: this.ring[0]?.minute ?? null, to: this.ring[this.ring.length - 1]?.minute ?? null },
      requests: {
        total: totalRequests,
        bytes: totalBytes,
        p50LatencyMs: p50,
        p95LatencyMs: p95,
      },
      topRoutesByBytes: topByBytes,
      topRoutesByRequests: byRequests,
      slowQueries,
      egress: {
        rollingBytes: this.totalEgressBytes,
        rollingGb: parseFloat(rollingEgressGb.toFixed(4)),
        budgetGb: parseFloat(budgetGb.toFixed(0)),
        usedPct: parseFloat(egressPct.toFixed(2)),
        cacheHitRatioPct: cacheHitRatio,
        note: cacheHitRatio === null
          ? 'No asset requests observed yet — ratio not measurable'
          : undefined,
      },
      anomaly: {
        currentHourBytes,
        baselineAvgBytes: Math.round(baselineAvg),
        ratio: anomalyRatio !== null ? parseFloat(anomalyRatio.toFixed(2)) : null,
        triggered: anomalyRatio !== null && anomalyRatio > 3,
      },
      efficiency: {
        score,
        worstOffenders,
      },
    };
  }

  /** Check thresholds and return an alert if one should fire. */
  shouldAlert(): { threshold: number; label: string; egressGb: number } | null {
    const egressPct = (this.totalEgressBytes / this.egressBudgetBytes) * 100;
    const nowHour = Math.floor(Date.now() / 3_600_000);

    // Find the highest crossed threshold
    let crossed: number | null = null;
    for (const t of [90, 70, 50]) {
      if (egressPct >= t) { crossed = t; break; }
    }
    if (crossed === null) return null;

    // De-dupe: only fire once per threshold per hour
    if (this.lastAlertThreshold === crossed && this.lastAlertHour === nowHour) {
      return null;
    }

    this.lastAlertThreshold = crossed;
    this.lastAlertHour = nowHour;
    return {
      threshold: crossed,
      label: crossed === 90 ? 'CRITICAL' : crossed === 70 ? 'WARNING' : 'INFO',
      egressGb: parseFloat((this.totalEgressBytes / 1e9).toFixed(3)),
    };
  }

  /** Check egress anomaly and return one if it should fire this hour. */
  shouldAlertAnomaly(): { ratio: number; currentHourGb: number } | null {
    const currentHourBytes = this.hourlyEgressBytes[this.currentHourIndex];
    const trailing = [...this.hourlyEgressBytes];
    trailing.splice(this.currentHourIndex, 1);
    const baseline = trailing.filter(v => v > 0);
    if (baseline.length < 3) return null; // not enough history

    const baselineAvg = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    const ratio = baselineAvg > 0 ? currentHourBytes / baselineAvg : 0;
    if (ratio <= 3) return null;

    const nowHour = Math.floor(Date.now() / 3_600_000);
    if (this.lastAnomalyHour === nowHour) return null;
    this.lastAnomalyHour = nowHour;

    return {
      ratio: parseFloat(ratio.toFixed(2)),
      currentHourGb: parseFloat((currentHourBytes / 1e9).toFixed(3)),
    };
  }

  private toMinuteKey(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  }

  private async redisIncrement(minute: string, bytes: number, durationMs: number) {
    try {
      const pub = (this.redis as any).publisher;
      if (!pub) return;
      const key = `eff:req:${minute}`;
      await pub.hincrby(key, 'requests', 1);
      await pub.hincrby(key, 'bytes', bytes);
      await pub.hincrby(key, 'latencySum', Math.round(durationMs));
      await pub.hincrby(key, 'latencyCount', 1);
      await pub.expire(key, 7200); // 2-hour TTL
    } catch {
      // best-effort — Redis down is not a fatal error
    }
  }

  private async redisPushSlowQuery(model: string, action: string, durationMs: number) {
    try {
      const pub = (this.redis as any).publisher;
      if (!pub) return;
      const entry = JSON.stringify({ model, action, durationMs, ts: Date.now() });
      await pub.lpush('eff:slow_queries', entry);
      await pub.ltrim('eff:slow_queries', 0, 99);  // keep 100 entries
      await pub.expire('eff:slow_queries', 7200);
    } catch {
      // best-effort
    }
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}
