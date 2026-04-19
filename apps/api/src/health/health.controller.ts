import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';

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

/**
 * Runs a promise with a hard timeout so a single slow downstream
 * (e.g. Postgres pooler hiccup, Redis DNS flake) can never make
 * Railway's healthcheck exceed its budget and kill the container.
 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

@Controller('api/v1/health')
export class HealthController {
  private readonly startedAt = Date.now();
  private readonly commit = process.env.GIT_COMMIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || 'dev';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly wsSigner: WebsocketSignerService,
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
}
