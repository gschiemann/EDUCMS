import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { BootReadinessService } from './boot-readiness.service';
import { withTimeout } from './with-timeout';

type CheckState = 'ok' | 'fail' | 'fallback' | 'degraded' | 'off';

interface HealthReport {
  status: 'ok' | 'degraded' | 'not-ready';
  checks: Record<string, CheckState>;
  uptime_s: number;
  ts: string;
  commit?: string;
  version?: string;
  // Flat convenience fields (what the Railway healthcheck + ops dashboard read)
  db?: CheckState;
  redis?: CheckState;
  uptime?: number;
  timestamp?: string;
}

@Controller('api/v1/health')
// 2026-05-06 — operator: "getting a 429 trying to reconnect screen".
// Health endpoints MUST never be throttled. They're liveness/readiness
// probes used by Railway, Vercel cron, and the kiosk's
// NetworkRecoveryController. If a kiosk trips the global 100/min cap,
// it then can't even verify the server is alive — recovery probe also
// 429s — and the screen wedges on "Reconnecting…" forever.
@SkipThrottle()
export class HealthController {
  private readonly startedAt = Date.now();
  private readonly commit = process.env.GIT_COMMIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || 'dev';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly wsSigner: WebsocketSignerService,
    private readonly storage: SupabaseStorageService,
    private readonly boot: BootReadinessService,
  ) {}

  private baseReport(): HealthReport {
    const uptime = Math.floor((Date.now() - this.startedAt) / 1000);
    const ts = new Date().toISOString();
    return {
      status: 'ok',
      checks: {},
      uptime_s: uptime,
      uptime,
      ts,
      timestamp: ts,
      commit: this.commit,
      version: this.commit,
    };
  }

  /**
   * Liveness probe — Railway hits this every few seconds.
   * MUST NEVER throw, and MUST return 200 even when downstreams (DB, Redis)
   * are degraded or down. Railway killing the pod during a transient DB
   * blip is the exact failure we've been hitting.
   *
   * It still reports the real status in the JSON body so ops dashboards,
   * the frontend retry banner, and the keep-warm pinger can surface it.
   */
  @Get()
  async liveness(): Promise<HealthReport> {
    const report = this.baseReport();

    // DB check — best-effort, 400ms budget.
    try {
      await withTimeout(this.prisma.client.$queryRaw`SELECT 1`, 400);
      report.checks.db = 'ok';
      report.db = 'ok';
    } catch {
      report.checks.db = 'degraded';
      report.db = 'degraded';
      report.status = 'degraded';
    }

    // Redis check — reports fallback when not configured, never fails hard.
    const pub = this.redis.publisher;
    if (!pub) {
      report.checks.redis = 'off';
      report.redis = 'off';
    } else if (pub.status === 'ready') {
      try {
        const pong = await withTimeout(pub.ping(), 200);
        const ok = pong === 'PONG';
        report.checks.redis = ok ? 'ok' : 'degraded';
        report.redis = ok ? 'ok' : 'degraded';
        if (!ok) report.status = report.status === 'ok' ? 'degraded' : report.status;
      } catch {
        report.checks.redis = 'degraded';
        report.redis = 'degraded';
      }
    } else {
      // Not connected yet, or gave up retrying. HTTP polling fallback
      // covers realtime; emergency flow stays healthy.
      report.checks.redis = 'fallback';
      report.redis = 'fallback';
    }

    // Always 200. Railway stays green for transient blips.
    return report;
  }

  /**
   * BOOT GATE (P0-7 finding #3, 2026-09-05) — the Railway `healthcheckPath`.
   *
   * 503 until this process has actually served a database query and settled
   * its Redis client; 200 **forever** after. It is a LATCH, not a check.
   *
   * WHY THIS AND NOT `/health/ready`: `/ready` re-probes the database on every
   * call, so pointing a deploy gate at it hands Railway a reason to fail a
   * deploy during a transient Supabase blip — the pod-thrash CLAUDE.md's
   * "never add DB checks to liveness" rule exists to prevent. This endpoint
   * cannot do that: once it has said 200 it can never say anything else, and
   * it opens on a ceiling (`BOOT_READY_MAX_MS`) even if the database never
   * answers, because a gate that never opens is a worse outage than a cold
   * start.
   *
   * WHAT IT BUYS: Railway holds traffic on the OLD container until the new one
   * has a warm pool and a live Redis client, instead of switching to a cold
   * process and letting the whole fleet arrive at once — the measured
   * thundering herd (31 % of requests failing across ~20 s at 1,000 screens).
   *
   * `GET /health` is untouched: still always 200, still the liveness probe.
   */
  @Get('started')
  async started(): Promise<HealthReport & { boot: ReturnType<BootReadinessService['report']> }> {
    const boot = this.boot.report();
    const report = {
      ...this.baseReport(),
      status: boot.ready ? ('ok' as const) : ('not-ready' as const),
      checks: { boot: boot.ready ? ('ok' as CheckState) : ('degraded' as CheckState) },
      boot,
    };
    if (!boot.ready) throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }

  /**
   * Readiness probe — only returns 200 when the DB is reachable.
   * Use this for deeper monitoring / smoke tests, NOT for the
   * Railway healthcheck.
   */
  @Get('ready')
  async readiness(): Promise<HealthReport> {
    const report = this.baseReport();

    try {
      await withTimeout(this.prisma.client.$queryRaw`SELECT 1`, 1500);
      report.checks.db = 'ok';
      report.db = 'ok';
    } catch {
      report.checks.db = 'fail';
      report.db = 'fail';
      report.status = 'not-ready';
    }

    if (report.status === 'not-ready') {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }

  /**
   * Deep emergency-path probe — verifies the full signing + DB chain
   * that a lockdown trigger needs. Kept separate from liveness so
   * a signing misconfiguration doesn't cause a restart loop.
   */
  @Get('emergency-path')
  async emergencyPath(): Promise<HealthReport> {
    const report = this.baseReport();

    try {
      await withTimeout(this.prisma.client.$queryRaw`SELECT 1`, 1500);
      report.checks.db = 'ok';
      report.db = 'ok';
    } catch {
      report.checks.db = 'fail';
      report.db = 'fail';
      report.status = 'degraded';
    }

    const pub = this.redis.publisher;
    if (pub && pub.status === 'ready') {
      try {
        const pong = await withTimeout(pub.ping(), 500);
        report.checks.redis = pong === 'PONG' ? 'ok' : 'fail';
        report.redis = report.checks.redis as CheckState;
      } catch {
        report.checks.redis = 'fail';
        report.redis = 'fail';
      }
    } else {
      report.checks.redis = 'fallback';
      report.redis = 'fallback';
    }

    try {
      const signed = this.wsSigner.signMessage('health.probe', { probe: true });
      report.checks.ws_signer = signed.signature ? 'ok' : 'fail';
    } catch {
      report.checks.ws_signer = 'fail';
      report.status = 'degraded';
    }

    if (report.checks.db === 'fail' || report.checks.ws_signer === 'fail') {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }

  /**
   * Storage round-trip probe (2026-07-31 "fetch failed" incident). Every
   * server-side upload (assets, branding logos, bug screenshots, emergency
   * content) rides SupabaseStorageService — when its transport silently
   * breaks, the damage surfaces days later as missing files. This endpoint
   * does a tiny real upload + read so monitoring catches the break within
   * minutes.
   *
   * Unauthenticated like its siblings, but SINGLE-FLIGHT + 30s-cached: the
   * in-flight PROMISE is stored synchronously, so N concurrent requests
   * share one probe (review finding: caching only the completed result let
   * concurrent first-hitters each fire their own service-role upload on an
   * unauthenticated, @SkipThrottle route). Hammering the endpoint cannot
   * generate storage writes faster than one per 30s.
   *
   * Response semantics: transport 'primary' → status ok (200);
   * 'fallback' → uploads WORK but the primary path is broken → status
   * degraded (still 200 — customers unaffected; the storage watchdog emails
   * PLATFORM_ALERT_EMAILS); probe failed → 503.
   */
  private storageProbe: {
    at: number;
    promise: Promise<{ ok: boolean; transport: string; upload: string; read: string; ms: number }>;
  } | null = null;

  @Get('storage')
  async storageHealth() {
    const now = Date.now();
    if (!this.storageProbe || now - this.storageProbe.at > 30_000) {
      // Assigned synchronously (before any await) — concurrent callers all
      // await this same promise. The .catch makes the stored promise
      // never-rejecting so one failure doesn't poison later awaits.
      this.storageProbe = {
        at: now,
        promise: withTimeout(this.storage.storageHealthProbe(), 20_000).catch((e: any) => ({
          ok: false,
          transport: 'none',
          upload: `fail: ${String(e?.message ?? e).slice(0, 300)}`,
          read: 'skipped',
          ms: Date.now() - now,
        })),
      };
    }
    const result = await this.storageProbe.promise;
    const report = {
      ...this.baseReport(),
      storage: result,
    };
    report.status = result.ok ? (result.transport === 'primary' ? 'ok' : 'degraded') : 'degraded';
    if (!result.ok) {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
