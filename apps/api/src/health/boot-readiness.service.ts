/**
 * boot-readiness.service.ts — the ONE-WAY boot gate (P0-7 finding #3).
 *
 * ── THE MEASURED DEFECT ──────────────────────────────────────────────────
 * An API restart under 1,000 screens is a thundering herd: **31 % of all
 * requests failed across a ~20 s window** (712 rev-poll timeouts, 507
 * ECONNRESETs, 23 ECONNREFUSED), and 49 of 1,000 screens had not
 * re-authenticated their WebSocket 15 s in. The credential survives — 0
 * `401`/`403` responses, 1000/1000 still `PROVEN` — so this is availability,
 * not auth.
 *
 * Part of the cause is that the process accepts traffic before it can serve
 * it. `PrismaService.onModuleInit` fires `$connect()` **fire-and-forget** (by
 * design — an unreachable DB must not crash the boot), and `main.ts` calls
 * `app.listen()` without waiting for it. Railway's `healthcheckPath` points at
 * `/api/v1/health`, which is deliberately **always 200** so a DB blip can
 * never make Railway kill the pod. The consequence: Railway switches traffic
 * to a container whose pool is cold and whose Redis client may not be
 * connected, and the whole fleet arrives at once.
 *
 * ── THE GATE, AND WHY IT CANNOT RE-CREATE THE POD-THRASH ─────────────────
 * `GET /api/v1/health/started` is a **latch**, not a check:
 *
 *   • it answers 503 until the DB has served one real query AND Redis has
 *     either connected or definitively said it is not in play;
 *   • once it answers 200 it answers 200 **forever**, no matter what happens
 *     to the DB or Redis afterwards.
 *
 * That second property is what makes it safe as `healthcheckPath`, and it is
 * the difference between this and `/health/ready` — which re-checks the DB on
 * every call and would therefore hand Railway a reason to fail a deploy (or,
 * on a platform that re-probes, to cycle a pod) during exactly the Supabase
 * blip CLAUDE.md's "never add DB checks to liveness" rule exists to survive.
 * `/health` itself is untouched: still always 200, still the liveness probe.
 *
 * • **Bounded.** If the DB never comes back, the latch opens anyway after
 *   `BOOT_READY_MAX_MS`. A database outage must not be able to freeze
 *   deploys — that is a worse failure than a cold start, and it is what a
 *   gate with no ceiling would produce (10 restart retries × a 300 s
 *   healthcheck timeout).
 * • **Warms what it gates.** While waiting it issues a small number of
 *   PARALLEL probe queries, so the pool has real connections open before the
 *   first screen arrives rather than opening them under a 1,000-way herd.
 *   `$connect()` opens ONE connection; this opens a few.
 *   Deliberately small — CLAUDE.md warns that each pool slot is a real
 *   Postgres connection against a 60-connection server with ~30 already used
 *   by Supabase.
 */

import { Injectable, Logger, type OnModuleInit, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { withTimeout } from './with-timeout';

/** Absolute ceiling on how long the gate may hold a deploy back. */
export const BOOT_READY_MAX_MS = Number(process.env.BOOT_READY_MAX_MS) > 0
  ? Number(process.env.BOOT_READY_MAX_MS)
  : 45_000;
/** How often the boot probe retries while it is still not ready. */
export const BOOT_PROBE_INTERVAL_MS = 250;
/** Per-probe budget. Generous: a cold Supabase pool's first query is slow. */
export const BOOT_PROBE_TIMEOUT_MS = 3_000;
/**
 * Parallel probe queries. Each one that succeeds leaves a warm connection in
 * the Prisma pool. Kept well under `connection_limit=10` on purpose.
 */
export const BOOT_WARM_CONNECTIONS = 4;

export interface BootReadyReport {
  ready: boolean;
  /** Why the latch opened — or what it is still waiting on. */
  reason: string;
  db: 'ok' | 'waiting' | 'timeout';
  redis: 'ok' | 'off' | 'waiting' | 'timeout';
  /** ms from service init to the latch opening; null while still closed. */
  readyAfterMs: number | null;
}

@Injectable()
export class BootReadinessService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BootReadinessService.name);
  private readonly startedAt = Date.now();

  /** ONE-WAY. Nothing in this class ever sets it back to false. */
  private ready = false;
  private readyAfterMs: number | null = null;
  private reason = 'booting';
  private dbState: BootReadyReport['db'] = 'waiting';
  private redisState: BootReadyReport['redis'] = 'waiting';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    void this.probe();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** The latch. Callers must treat a `true` as permanent. */
  isReady(): boolean {
    return this.ready;
  }

  report(): BootReadyReport {
    return {
      ready: this.ready,
      reason: this.reason,
      db: this.dbState,
      redis: this.redisState,
      readyAfterMs: this.readyAfterMs,
    };
  }

  /** Test hook — drive one probe pass synchronously. */
  async probeOnce(): Promise<BootReadyReport> {
    await this.evaluate();
    return this.report();
  }

  private async probe(): Promise<void> {
    if (this.stopped || this.ready) return;
    await this.evaluate();
    if (this.ready || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.probe();
    }, BOOT_PROBE_INTERVAL_MS);
    (this.timer as any).unref?.();
  }

  private async evaluate(): Promise<void> {
    if (this.ready) return;
    const elapsed = Date.now() - this.startedAt;

    await this.probeDb();
    this.probeRedis();

    if (this.dbState === 'ok' && (this.redisState === 'ok' || this.redisState === 'off')) {
      this.latch(`db=${this.dbState} redis=${this.redisState}`);
      return;
    }

    if (elapsed >= BOOT_READY_MAX_MS) {
      // The ceiling. A downstream that never comes back must not be able to
      // hold a deploy hostage — degrade to the pre-gate behaviour, loudly.
      if (this.dbState !== 'ok') this.dbState = 'timeout';
      if (this.redisState === 'waiting') this.redisState = 'timeout';
      this.logger.warn(
        `[boot-gate] opening after ${elapsed}ms WITHOUT a healthy downstream ` +
          `(db=${this.dbState} redis=${this.redisState}). Serving traffic anyway — ` +
          'a gate that never opens is a worse outage than a cold start.',
      );
      this.latch(`ceiling-${BOOT_READY_MAX_MS}ms db=${this.dbState} redis=${this.redisState}`);
    }
  }

  private latch(reason: string): void {
    if (this.ready) return;
    this.ready = true;
    this.reason = reason;
    this.readyAfterMs = Date.now() - this.startedAt;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.log(`[boot-gate] ready after ${this.readyAfterMs}ms (${reason})`);
  }

  private async probeDb(): Promise<void> {
    if (this.dbState === 'ok') return;
    try {
      // PARALLEL on purpose: each success leaves a warm connection behind, so
      // the first screen to arrive does not pay for opening one.
      await withTimeout(
        Promise.all(
          Array.from({ length: BOOT_WARM_CONNECTIONS }, () =>
            this.prisma.client.$queryRaw`SELECT 1`,
          ),
        ),
        BOOT_PROBE_TIMEOUT_MS,
      );
      this.dbState = 'ok';
    } catch {
      this.dbState = 'waiting';
    }
  }

  private probeRedis(): void {
    if (this.redisState === 'ok' || this.redisState === 'off') return;
    const pub = this.redis.publisher;
    // No client at all means Redis is not part of this deployment — the
    // documented HTTP-polling fallback covers realtime, so it is not something
    // to wait for. 'off' is a READY state, not a degraded one.
    if (!pub) {
      this.redisState = 'off';
      return;
    }
    if (pub.status === 'ready') {
      this.redisState = 'ok';
      return;
    }
    // 'end' means ioredis stopped retrying: it is not coming back on its own,
    // so waiting for it would only burn the ceiling.
    if (pub.status === 'end') {
      this.redisState = 'off';
      return;
    }
    this.redisState = 'waiting';
  }
}
