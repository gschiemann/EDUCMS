import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * 2026-07-28 — Frame-locked multi-screen sync: the server half of the clock.
 * Design: docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §4.
 *
 * Players sync their clocks to "server time" via TIME_PING/TIME_PONG over the
 * device WebSocket (plus an HTTP fallback). Sync across screens only needs all
 * players to agree on ONE clock — absolute UTC accuracy is irrelevant. But the
 * API runs multi-replica on Railway, and two replicas' container clocks are
 * not guaranteed to agree at the millisecond level. If screen A pings replica
 * 1 and screen B pings replica 2, any replica-clock disagreement becomes
 * screen-to-screen skew.
 *
 * Fix (Standard Audit Surface §17, multi-replica safety): every replica slaves
 * its served clock to the single Redis instance via the Redis TIME command —
 * Cristian's algorithm, min-RTT filtered, refreshed every 60s. All replicas
 * then serve the same clock to ~±1ms regardless of container clock drift.
 *
 * Redis absent/unreachable → serve the local clock (offset 0). That matches
 * today's single-replica behavior, and realtime is already degraded to HTTP
 * polling in that state anyway.
 */
@Injectable()
export class TimeSyncService implements OnModuleInit {
  private readonly logger = new Logger(TimeSyncService.name);

  /** ms to ADD to local Date.now() to get Redis-master time. */
  private redisOffsetMs = 0;
  private lastSampleAt = 0;
  private lastSampleRttMs: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(@Optional() private readonly redisService?: RedisService) {}

  onModuleInit() {
    // First sample shortly after boot (give ioredis its lazy connect window),
    // then hold a 60s cadence. unref() so the interval never blocks shutdown.
    const kickoff = setTimeout(() => void this.sampleRedisOffset(), 5_000);
    if (typeof (kickoff as any)?.unref === 'function') (kickoff as any).unref();
    this.timer = setInterval(() => void this.sampleRedisOffset(), 60_000);
    if (typeof (this.timer as any)?.unref === 'function') (this.timer as any).unref();
  }

  /** The one clock every replica serves. */
  now(): number {
    return Date.now() + this.redisOffsetMs;
  }

  /** Diagnostics for the HTTP time endpoint / health surfaces. */
  status(): { offsetMs: number; sampledAt: number; rttMs: number | null; source: 'redis' | 'local' } {
    return {
      offsetMs: this.redisOffsetMs,
      sampledAt: this.lastSampleAt,
      rttMs: this.lastSampleRttMs,
      source: this.lastSampleAt > 0 ? 'redis' : 'local',
    };
  }

  private async sampleRedisOffset(): Promise<void> {
    const redis = this.redisService?.publisher;
    if (!redis || (redis as any).status !== 'ready') return;

    // Cristian's algorithm against Redis TIME: 5 quick samples, keep the
    // minimum-RTT one (least queue-delay noise). Redis TIME returns
    // [seconds, microseconds] as strings.
    let best: { rtt: number; offset: number } | null = null;
    for (let i = 0; i < 5; i++) {
      try {
        const t0 = Date.now();
        // ioredis type stubs disagree across versions (string[] vs
        // number[]) — Redis itself returns [seconds, microseconds].
        const raw = (await redis.time()) as unknown as Array<string | number>;
        const t1 = Date.now();
        const sec = Number(raw?.[0]);
        const usec = Number(raw?.[1]);
        if (!Number.isFinite(sec) || !Number.isFinite(usec)) return;
        const rtt = t1 - t0;
        const redisMs = sec * 1000 + usec / 1000;
        // Redis's reading happened ~mid-flight; estimate local time then as
        // t0 + rtt/2, so offset = redisMs - (t0 + rtt/2).
        const offset = redisMs - (t0 + rtt / 2);
        if (!best || rtt < best.rtt) best = { rtt, offset };
      } catch {
        // Transient Redis blip — keep the previous offset; next cadence retries.
        return;
      }
    }
    if (!best) return;

    const prev = this.redisOffsetMs;
    this.redisOffsetMs = Math.round(best.offset);
    this.lastSampleAt = Date.now();
    this.lastSampleRttMs = best.rtt;
    if (Math.abs(this.redisOffsetMs - prev) > 250 && prev !== 0) {
      this.logger.warn(
        `Replica clock moved ${this.redisOffsetMs - prev}ms vs Redis master (now ${this.redisOffsetMs}ms, rtt ${best.rtt}ms)`,
      );
    }
    if (Math.abs(this.redisOffsetMs) > 10_000) {
      this.logger.warn(
        `Container clock is ${Math.round(this.redisOffsetMs / 1000)}s off Redis master — served clock is corrected, but check host NTP`,
      );
    }
  }
}
