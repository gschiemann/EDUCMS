import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisService } from '../realtime/redis.service';

/**
 * EfficiencyMetricsService
 *
 * ── 2026-09-02 rewrite (efficiency audit P0-6) ──────────────────────────
 * The previous version could not be used to make hosting decisions, and it
 * cost more than the thing it measured:
 *
 *   1. FIVE awaited Redis commands PER REQUEST (4 × hincrby + expire). At
 *      the observed 552,900 Railway requests/day that is ~2.76 M monitoring
 *      Redis operations/day — for a dashboard nobody reads more than
 *      occasionally.
 *   2. Bytes were read from the Content-Length header inside a `tap()` that
 *      fires BEFORE Nest serialises the body, so response bytes were
 *      commonly recorded as 0.
 *   3. A request carrying If-None-Match that got a 200 was counted as a
 *      cache HIT — i.e. the cache-miss storm this monitor exists to catch
 *      was scored as a cache success.
 *   4. The "monthly" egress total was an in-process counter that reset on
 *      every restart, and the "7-day" anomaly baseline was likewise
 *      process-local.
 *   5. Redis aggregates were written but never read back for the snapshot.
 *   6. Latency kept only the FIRST 200 samples per minute, so percentiles
 *      described the first few seconds of each minute.
 *
 * What it does now:
 *   - Requests accumulate in memory only. A single Redis PIPELINE flushes
 *     every EFFICIENCY_FLUSH_MS (default 10 s) or every
 *     EFFICIENCY_FLUSH_EVERY_N requests (default 200) — whichever comes
 *     first. One round trip, not five per request.
 *   - Bytes are counted by the interceptor from what is actually written to
 *     the socket (post-serialisation), including piped/streamed bodies.
 *   - A 304 is a cache hit. A 200 that carried conditional headers is a
 *     MISS, and is also reported separately as `conditionalMisses`.
 *   - Month-to-date totals live in Redis (`eff:month:<YYYYMM>`, 70-day TTL)
 *     and survive restarts and redeploys; the hourly baseline lives in
 *     `eff:hours` (30-day TTL) and is read back for the snapshot AND for
 *     the anomaly detector.
 *   - Latency uses a uniform reservoir (Algorithm R) per minute.
 *   - Egress accounting includes the APK and streaming routes. It still
 *     cannot see Supabase / CDN direct egress — the snapshot says so
 *     instead of implying the number is the whole bill.
 *
 * Every Redis interaction is best-effort inside try/catch: a Redis outage
 * degrades metrics, never a real API request.
 *
 * Egress budget: EGRESS_BUDGET_GB env var (default 250 GB = Supabase Pro).
 * Thresholds: 50 / 70 / 90% of budget trigger alerts (deduplicated per hour).
 */

/** Uniform-reservoir size per minute slot (percentile sample). */
const LATENCY_RESERVOIR = 200;
/** Redis key TTLs. */
const MINUTE_KEY_TTL_S = 7_200; // 2 h — the rolling live window
const HOURS_KEY_TTL_S = 30 * 24 * 60 * 60; // 30 d — the anomaly baseline
const MONTH_KEY_TTL_S = 70 * 24 * 60 * 60; // 70 d — month-to-date totals
/** How many trailing hours the displayed baseline considers. */
const BASELINE_HOURS = 168; // 7 × 24

/** One minute's worth of pending counters awaiting the next Redis flush. */
interface PendingBucket {
  requests: number;
  bytes: number;
  latencySum: number;
  latencyCount: number;
}

function emptyBucket(): PendingBucket {
  return { requests: 0, bytes: 0, latencySum: 0, latencyCount: 0 };
}

/** Minimal shape of the ioredis client this service uses. */
interface RedisLike {
  pipeline(): RedisPipelineLike;
  hgetall(key: string): Promise<Record<string, string>>;
  lpush(key: string, value: string): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}
interface RedisPipelineLike {
  hincrby(key: string, field: string, increment: number): RedisPipelineLike;
  expire(key: string, seconds: number): RedisPipelineLike;
  hdel(key: string, ...fields: string[]): RedisPipelineLike;
  exec(): Promise<unknown>;
}

@Injectable()
export class EfficiencyMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EfficiencyMetricsService.name);

  // In-process ring for the live view — max 60 entries (60 minutes).
  // Written on every recordRequest call so /super/efficiency works
  // even without Redis.
  private readonly ring: Array<{
    minute: string;          // 'YYYYMMDDHHMM'
    requests: number;
    bytes: number;
    latencySum: number;      // ms sum for the mean
    latencyCount: number;    // total samples SEEN this minute (reservoir denominator)
    latencies: number[];     // uniform reservoir, capped at LATENCY_RESERVOIR
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

  // Asset/egress tracking (in-process, since restart).
  private totalEgressBytes = 0;
  private assetHits = 0;
  private assetMisses = 0;
  /** 200s that carried If-None-Match / If-Modified-Since — a real cache miss. */
  private assetConditionalMisses = 0;

  // Alert de-dupe: track which threshold was last fired this hour
  private lastAlertThreshold: number | null = null;
  private lastAlertHour = -1;
  private lastAnomalyHour = -1;

  // Hourly egress samples for anomaly detection (trailing 7 × 24 slots = 168).
  // Kept as the FALLBACK for the anomaly detector when Redis has no history
  // (fresh deploy, Redis down) — the primary source is `redisHourly` below.
  private readonly hourlyEgressBytes: number[] = new Array(BASELINE_HOURS).fill(0);
  private currentHourIndex = 0;
  private currentHourStart = 0;

  // Budget in bytes
  private readonly egressBudgetBytes: number;

  // ── Batched Redis flush state ─────────────────────────────────────────
  /** Pending per-minute counters, keyed 'YYYYMMDDHHMM'. */
  private readonly pendingMinutes = new Map<string, PendingBucket>();
  /** Pending per-hour asset bytes, keyed 'YYYYMMDDHH'. */
  private readonly pendingHourBytes = new Map<string, number>();
  /** Pending per-month totals, keyed 'YYYYMM'. */
  private readonly pendingMonths = new Map<string, { bytes: number; assetBytes: number; requests: number }>();
  private pendingRequests = 0;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private lastFlushAt = 0;
  private flushCount = 0;
  private readonly flushIntervalMs: number;
  private readonly flushEveryN: number;

  // ── Redis-derived aggregates (restart-durable), refreshed on a cadence ──
  /** Month-to-date totals read back from Redis; null until first refresh. */
  private redisMonth: { bytes: number; assetBytes: number; requests: number } | null = null;
  /** Hour → asset bytes, read back from Redis; null until first refresh. */
  private redisHourly: Map<string, number> | null = null;
  private redisAggregatesAt = 0;
  /** Opportunistic prune of baseline fields older than the window. */
  private lastBaselinePruneAt = 0;

  constructor(private readonly redis: RedisService) {
    const budgetGb = parseFloat(process.env.EGRESS_BUDGET_GB || '250');
    this.egressBudgetBytes = budgetGb * 1024 * 1024 * 1024;
    this.currentHourStart = Math.floor(Date.now() / 3_600_000);
    const intervalRaw = Number(process.env.EFFICIENCY_FLUSH_MS);
    this.flushIntervalMs = Number.isFinite(intervalRaw) && intervalRaw >= 1_000 ? intervalRaw : 10_000;
    const everyRaw = Number(process.env.EFFICIENCY_FLUSH_EVERY_N);
    this.flushEveryN = Number.isFinite(everyRaw) && everyRaw >= 1 ? Math.floor(everyRaw) : 200;
  }

  onModuleInit() {
    this.logger.log(
      `EfficiencyMetricsService ready. Budget: ${(this.egressBudgetBytes / 1e9).toFixed(0)} GB · ` +
        `flush every ${this.flushIntervalMs}ms or ${this.flushEveryN} requests`,
    );
    // Batched flush + periodic read-back of the durable aggregates. One
    // interval, unref'd so it never holds the event loop open on shutdown.
    this.flushTimer = setInterval(() => {
      void this.flush();
      // Refresh the durable aggregates about once a minute so shouldAlert /
      // shouldAlertAnomaly stay synchronous but restart-durable.
      if (Date.now() - this.redisAggregatesAt >= 60_000) void this.refreshRedisAggregates();
    }, this.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  async onModuleDestroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Last flush so a graceful shutdown doesn't drop the tail.
    await this.flush();
  }

  /** Called by EfficiencyInterceptor for every completed request. */
  recordRequest(params: {
    route: string;         // e.g. 'GET /api/v1/screens'
    statusCode: number;
    bytes: number;         // response body bytes ACTUALLY written (post-serialisation)
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
    // Uniform reservoir (Algorithm R) — the old code kept only the FIRST
    // 200 samples of each minute, so p95 described the start of the minute
    // and a slow burst at :45 was invisible.
    if (slot.latencies.length < LATENCY_RESERVOIR) {
      slot.latencies.push(durationMs);
    } else {
      const j = Math.floor(Math.random() * slot.latencyCount);
      if (j < LATENCY_RESERVOIR) slot.latencies[j] = durationMs;
    }

    // ── Per-route accumulators ────────────────────────────────────────
    this.routeBytes.set(route, (this.routeBytes.get(route) ?? 0) + bytes);
    this.routeCounts.set(route, (this.routeCounts.get(route) ?? 0) + 1);
    this.routeLatencySum.set(route, (this.routeLatencySum.get(route) ?? 0) + durationMs);

    // ── Asset / egress accounting ─────────────────────────────────────
    // A 304 is a cache HIT. A 200 that carried If-None-Match / If-Modified-
    // Since is a cache MISS — the previous code scored it as a hit, which
    // made a cache-miss storm (the 2026-05-23 incident class) look healthy.
    if (isAsset) {
      this.totalEgressBytes += bytes;
      if (wasNotModified) {
        this.assetHits++;
      } else {
        this.assetMisses++;
        if (hadConditionalHeaders) this.assetConditionalMisses++;
      }
    }

    // ── Hourly egress tracking (in-process fallback baseline) ─────────
    const hourIndex = Math.floor(now / 3_600_000);
    if (hourIndex !== this.currentHourStart) {
      // Hour rolled over — advance the ring
      this.currentHourIndex = (this.currentHourIndex + 1) % this.hourlyEgressBytes.length;
      this.hourlyEgressBytes[this.currentHourIndex] = 0;
      this.currentHourStart = hourIndex;
    }
    this.hourlyEgressBytes[this.currentHourIndex] += bytes;

    // ── Pending Redis accumulation — NO I/O on the request path ───────
    const bucket = this.pendingMinutes.get(minute) ?? emptyBucket();
    bucket.requests += 1;
    bucket.bytes += bytes;
    bucket.latencySum += Math.round(durationMs);
    bucket.latencyCount += 1;
    this.pendingMinutes.set(minute, bucket);

    const hourKey = minute.slice(0, 10); // YYYYMMDDHH
    this.pendingHourBytes.set(hourKey, (this.pendingHourBytes.get(hourKey) ?? 0) + bytes);

    const monthKey = minute.slice(0, 6); // YYYYMM
    const month = this.pendingMonths.get(monthKey) ?? { bytes: 0, assetBytes: 0, requests: 0 };
    month.bytes += bytes;
    month.requests += 1;
    if (isAsset) month.assetBytes += bytes;
    this.pendingMonths.set(monthKey, month);

    this.pendingRequests += 1;
    if (this.pendingRequests >= this.flushEveryN) void this.flush();
  }

  /** Called by slow-query Prisma middleware. */
  recordSlowQuery(model: string, action: string, durationMs: number) {
    const entry = { model, action, durationMs, ts: Date.now() };
    this.slowQueryRing.unshift(entry);
    if (this.slowQueryRing.length > 50) this.slowQueryRing.pop();

    // Best-effort Redis push so multi-replica fleets see each other's slow
    // queries. Slow queries are rare by definition (they cross a threshold),
    // so this stays a per-event write rather than a batched one.
    void this.redisPushSlowQuery(model, action, durationMs);
  }

  /**
   * Flush every pending counter to Redis in ONE pipeline. Called by the
   * interval, by the every-N-requests trigger, and on shutdown.
   * Best-effort: on failure the counters are put back so nothing is lost
   * until Redis returns.
   */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.pendingMinutes.size === 0 && this.pendingMonths.size === 0) {
      this.pendingRequests = 0;
      return;
    }
    const pub = this.redisClient();
    if (!pub) {
      // No Redis — drop the pending Redis-side counters (the in-process ring
      // and per-route maps already hold everything the local snapshot needs).
      this.pendingMinutes.clear();
      this.pendingHourBytes.clear();
      this.pendingMonths.clear();
      this.pendingRequests = 0;
      return;
    }

    this.flushing = true;
    const minutes = new Map(this.pendingMinutes);
    const hours = new Map(this.pendingHourBytes);
    const months = new Map(this.pendingMonths);
    this.pendingMinutes.clear();
    this.pendingHourBytes.clear();
    this.pendingMonths.clear();
    this.pendingRequests = 0;

    try {
      const pipe = pub.pipeline();
      for (const [minute, b] of minutes) {
        const key = `eff:req:${minute}`;
        if (b.requests) pipe.hincrby(key, 'requests', b.requests);
        if (b.bytes) pipe.hincrby(key, 'bytes', b.bytes);
        if (b.latencySum) pipe.hincrby(key, 'latencySum', b.latencySum);
        if (b.latencyCount) pipe.hincrby(key, 'latencyCount', b.latencyCount);
        pipe.expire(key, MINUTE_KEY_TTL_S);
      }
      for (const [hour, bytes] of hours) {
        if (bytes) pipe.hincrby('eff:hours', hour, bytes);
      }
      if (hours.size) pipe.expire('eff:hours', HOURS_KEY_TTL_S);
      for (const [month, m] of months) {
        const key = `eff:month:${month}`;
        if (m.bytes) pipe.hincrby(key, 'bytes', m.bytes);
        if (m.assetBytes) pipe.hincrby(key, 'assetBytes', m.assetBytes);
        if (m.requests) pipe.hincrby(key, 'requests', m.requests);
        pipe.expire(key, MONTH_KEY_TTL_S);
      }
      await pipe.exec();
      this.lastFlushAt = Date.now();
      this.flushCount += 1;
    } catch (err: unknown) {
      // Put the counters back so a transient Redis blip doesn't lose data.
      for (const [minute, b] of minutes) {
        const existing = this.pendingMinutes.get(minute) ?? emptyBucket();
        existing.requests += b.requests;
        existing.bytes += b.bytes;
        existing.latencySum += b.latencySum;
        existing.latencyCount += b.latencyCount;
        this.pendingMinutes.set(minute, existing);
      }
      for (const [hour, bytes] of hours) {
        this.pendingHourBytes.set(hour, (this.pendingHourBytes.get(hour) ?? 0) + bytes);
      }
      for (const [month, m] of months) {
        const existing = this.pendingMonths.get(month) ?? { bytes: 0, assetBytes: 0, requests: 0 };
        existing.bytes += m.bytes;
        existing.assetBytes += m.assetBytes;
        existing.requests += m.requests;
        this.pendingMonths.set(month, existing);
      }
      this.logger.debug(
        `efficiency flush deferred (Redis): ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Read the durable aggregates back out of Redis. Called about once a
   * minute by the flush timer and once by the controller before rendering,
   * so `getSnapshot` / `shouldAlert` / `shouldAlertAnomaly` stay synchronous
   * while still reflecting cross-replica, restart-durable totals.
   */
  async refreshRedisAggregates(): Promise<void> {
    const pub = this.redisClient();
    if (!pub) return;
    try {
      const monthKey = `eff:month:${this.toMonthKey(Date.now())}`;
      const [monthRaw, hoursRaw] = await Promise.all([
        pub.hgetall(monthKey),
        pub.hgetall('eff:hours'),
      ]);
      this.redisMonth = {
        bytes: toInt(monthRaw?.bytes),
        assetBytes: toInt(monthRaw?.assetBytes),
        requests: toInt(monthRaw?.requests),
      };
      const hourly = new Map<string, number>();
      for (const [hour, value] of Object.entries(hoursRaw ?? {})) hourly.set(hour, toInt(value));
      this.redisHourly = hourly;
      this.redisAggregatesAt = Date.now();
      void this.pruneBaseline(pub, hourly);
    } catch (err: unknown) {
      this.logger.debug(
        `efficiency aggregate refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

    // ── Egress ────────────────────────────────────────────────────────
    // `rollingBytes` keeps its name (the dashboard reads it) but now means
    // month-to-date asset egress when Redis has it — a number that survives
    // a restart. The old process-local total is still reported, honestly
    // labelled, as `processBytes`.
    const monthAssetBytes = this.monthAssetBytes();
    const egressSource: 'redis' | 'process' = this.redisMonth ? 'redis' : 'process';
    const budgetGb = this.egressBudgetBytes / 1e9;
    const rollingEgressGb = monthAssetBytes / 1e9;
    const egressPct = (monthAssetBytes / this.egressBudgetBytes) * 100;

    // Cache-hit ratio (for asset/proxy paths where we can measure)
    const totalAssetReqs = this.assetHits + this.assetMisses;
    const cacheHitRatio = totalAssetReqs > 0
      ? Math.round((this.assetHits / totalAssetReqs) * 100)
      : null;

    // ── Anomaly: current hourly rate vs trailing baseline ─────────────
    const { currentHourBytes, baselineAvg, anomalyRatio, baselineSource } = this.anomalyInputs();

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
        rollingBytes: monthAssetBytes,
        rollingGb: parseFloat(rollingEgressGb.toFixed(4)),
        budgetGb: parseFloat(budgetGb.toFixed(0)),
        usedPct: parseFloat(egressPct.toFixed(2)),
        cacheHitRatioPct: cacheHitRatio,
        note: [
          cacheHitRatio === null
            ? 'No asset requests observed yet — ratio not measurable. '
            : '',
          'Month-to-date API egress only. Bytes are counted as written to the ',
          'socket for /assets, /proxy, /storage, /player/apk, /player/manager-apk ',
          'and /streaming. Supabase and CDN egress served DIRECTLY to players ',
          'never passes through this process and is NOT included — read the ',
          'Supabase and Railway dashboards for the authoritative bill.',
        ].join(''),
        // ── added 2026-09-02 ──
        month: this.toMonthKey(Date.now()),
        monthBytes: this.redisMonth?.bytes ?? null,
        monthAssetBytes,
        monthRequests: this.redisMonth?.requests ?? null,
        processBytes: this.totalEgressBytes,
        source: egressSource,
        cacheHits: this.assetHits,
        cacheMisses: this.assetMisses,
        conditionalMisses: this.assetConditionalMisses,
        observes: [
          'GET|HEAD /api/v1/assets',
          'GET|HEAD /api/v1/proxy',
          'GET|HEAD /api/v1/storage',
          'GET|HEAD /api/v1/player/apk',
          'GET|HEAD /api/v1/player/manager-apk',
          'GET|HEAD /api/v1/streaming',
        ],
        doesNotObserve: [
          'Supabase object storage served directly to players',
          'CDN / Vercel edge egress',
          'WebSocket frames',
        ],
      },
      anomaly: {
        currentHourBytes,
        baselineAvgBytes: Math.round(baselineAvg),
        ratio: anomalyRatio !== null ? parseFloat(anomalyRatio.toFixed(2)) : null,
        triggered: anomalyRatio !== null && anomalyRatio > 3,
        // ── added 2026-09-02 ──
        baselineSource,
        baselineHours: BASELINE_HOURS,
      },
      efficiency: {
        score,
        worstOffenders,
      },
      // ── added 2026-09-02 — how these numbers were collected, so the page
      // can state what it actually knows rather than implying precision.
      collection: {
        bytesMeasuredAt: 'response-bytes-written',
        latencySampling: 'uniform-reservoir',
        reservoirPerMinute: LATENCY_RESERVOIR,
        flushIntervalMs: this.flushIntervalMs,
        flushEveryNRequests: this.flushEveryN,
        flushes: this.flushCount,
        pendingRequests: this.pendingRequests,
        lastFlushAt: this.lastFlushAt || null,
        redisAggregatesAt: this.redisAggregatesAt || null,
        redisConnected: !!this.redisClient(),
        redisCommandsPerRequest: 0,
      },
    };
  }

  /** Check thresholds and return an alert if one should fire. */
  shouldAlert(): { threshold: number; label: string; egressGb: number } | null {
    const egressBytes = this.monthAssetBytes();
    const egressPct = (egressBytes / this.egressBudgetBytes) * 100;
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
      egressGb: parseFloat((egressBytes / 1e9).toFixed(3)),
    };
  }

  /** Check egress anomaly and return one if it should fire this hour. */
  shouldAlertAnomaly(): { ratio: number; currentHourGb: number } | null {
    const { currentHourBytes, baselineCount, baselineAvg } = this.anomalyInputs();

    // ── Absolute floor (2026-07-16 — the "This hour: 0 GB, 4.68x baseline"
    // email). The baseline is the average of the NON-ZERO trailing hours, so
    // on an idle/test fleet it's a few hundred KB — and any dashboard session
    // is instantly "4-5x baseline" while moving less than a megabyte. A ratio
    // alarm with no magnitude gate turns kilobytes into pages. Require the
    // current hour to move real bytes before the ratio can alert. Tunable via
    // EGRESS_ANOMALY_MIN_GB (default 1 GB — the incident class this monitor
    // exists for, the 2026-05-23 cache-miss storm, was 5.79 GB).
    const minGbRaw = parseFloat(process.env.EGRESS_ANOMALY_MIN_GB || '1');
    const floorBytes = (Number.isFinite(minGbRaw) && minGbRaw >= 0 ? minGbRaw : 1) * 1e9;
    if (currentHourBytes < floorBytes) return null;

    if (baselineCount < 3) return null; // not enough history

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

  /**
   * Current-hour bytes + trailing baseline. Prefers the Redis-backed hourly
   * series (survives restarts, spans replicas, 30-day TTL) and falls back to
   * the in-process ring when Redis has no history yet.
   */
  private anomalyInputs(): {
    currentHourBytes: number;
    baselineAvg: number;
    baselineCount: number;
    anomalyRatio: number | null;
    baselineSource: 'redis' | 'process';
  } {
    const hourKey = this.toHourKey(Date.now());
    const pendingThisHour = this.pendingHourBytes.get(hourKey) ?? 0;
    const redisHourly = this.redisHourly;

    let currentHourBytes: number;
    let baseline: number[];
    let baselineSource: 'redis' | 'process';

    if (redisHourly && redisHourly.size > 0) {
      baselineSource = 'redis';
      // Pending bytes have not reached Redis yet — add them so the current
      // hour isn't understated in the seconds between flushes.
      currentHourBytes = (redisHourly.get(hourKey) ?? 0) + pendingThisHour;
      baseline = Array.from(redisHourly.entries())
        .filter(([hour, value]) => hour !== hourKey && value > 0)
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .slice(0, BASELINE_HOURS)
        .map(([, value]) => value);
    } else {
      baselineSource = 'process';
      currentHourBytes = this.hourlyEgressBytes[this.currentHourIndex];
      const trailing = [...this.hourlyEgressBytes];
      trailing.splice(this.currentHourIndex, 1); // exclude current
      baseline = trailing.filter((v) => v > 0);
    }

    const baselineAvg = baseline.length > 0
      ? baseline.reduce((a, b) => a + b, 0) / baseline.length
      : 0;
    const anomalyRatio = baselineAvg > 0 ? currentHourBytes / baselineAvg : null;
    return { currentHourBytes, baselineAvg, baselineCount: baseline.length, anomalyRatio, baselineSource };
  }

  /** Month-to-date asset egress: Redis when available, in-process otherwise. */
  private monthAssetBytes(): number {
    const pending = this.pendingMonths.get(this.toMonthKey(Date.now()))?.assetBytes ?? 0;
    if (this.redisMonth) return this.redisMonth.assetBytes + pending;
    return this.totalEgressBytes;
  }

  private redisClient(): RedisLike | null {
    const pub = this.redis?.publisher;
    return pub ? (pub as unknown as RedisLike) : null;
  }

  private toMinuteKey(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  }

  private toHourKey(ms: number): string {
    return this.toMinuteKey(ms).slice(0, 10);
  }

  private toMonthKey(ms: number): string {
    return this.toMinuteKey(ms).slice(0, 6);
  }

  /**
   * Drop baseline fields older than the 7-day window so `eff:hours` stays
   * bounded (168 live fields) even though the key's TTL is 30 days. At most
   * once an hour, best-effort.
   */
  private async pruneBaseline(pub: RedisLike, hourly: Map<string, number>): Promise<void> {
    const now = Date.now();
    if (now - this.lastBaselinePruneAt < 3_600_000) return;
    if (hourly.size <= BASELINE_HOURS) return;
    this.lastBaselinePruneAt = now;
    const cutoff = this.toHourKey(now - BASELINE_HOURS * 3_600_000);
    const stale = Array.from(hourly.keys()).filter((hour) => hour < cutoff);
    if (stale.length === 0) return;
    try {
      const pipe = pub.pipeline();
      pipe.hdel('eff:hours', ...stale);
      await pipe.exec();
      for (const hour of stale) hourly.delete(hour);
    } catch {
      // best-effort
    }
  }

  private async redisPushSlowQuery(model: string, action: string, durationMs: number) {
    try {
      const pub = this.redisClient();
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

function toInt(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}
