/**
 * PlatformHealthMonitor — in-app infra self-monitoring (2026-08-05).
 *
 * Replaces the external "Claude routine" that curled the health endpoints
 * every 20 minutes from the operator's laptop. This is what the major
 * signage platforms (Yodeck / ScreenCloud / OptiSigns) do: monitoring is a
 * product capability, not a bot babysitting curl.
 *
 * Every 5 minutes it runs the same checks as GET /api/v1/health/emergency-path
 * — DB reachability, Redis pub/sub, and the WebSocket signer (the life-safety
 * chain) — and classifies:
 *   ok        — everything healthy
 *   degraded  — Redis is configured but unreachable (realtime is riding the
 *               HTTP-polling fallback; emergency alerts still deliver, but
 *               slower — investigate)
 *   critical  — DB unreachable or WS signer broken (manifest reads, auth, and
 *               the emergency trigger chain are impacted NOW)
 *
 * On any transition into degraded/critical: email PLATFORM_ALERT_EMAILS via
 * PlatformAlertMailer + Sentry capture. While unhealthy it re-alerts at most
 * every 6h; a worsening (degraded → critical) alerts immediately. On recovery
 * it sends the all-clear.
 *
 * False-positive guard: a failed DB probe is re-probed once after 10s inside
 * the same tick before it counts — a single pooler blip must not page anyone.
 *
 * What this deliberately does NOT cover: the app being entirely down (a dead
 * process cannot email about itself). That layer is the keep-warm GitHub
 * Action (.github/workflows/keep-warm.yml), which sweeps the health endpoints
 * from outside every 5 minutes and fails loudly — plus the public /status
 * page on Vercel, a separate deploy surface from the API.
 *
 * Storage is NOT probed here — StorageWatchdogService already owns that.
 *
 * Kill switch: PLATFORM_HEALTH_MONITOR_DISABLED=1. Off in NODE_ENV=test.
 * Multi-replica note: state is in-memory (same as the other two watchdogs);
 * with N replicas you would get up to N copies of an alert. Acceptable at the
 * current single-replica deployment — revisit alongside the others if we
 * scale out (docs/SLO_AND_ONCALL.md §4).
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { PlatformAlertMailer } from '../email/platform-alert-mailer.service';
import { withTimeout } from './with-timeout';

type MonitorStatus = 'ok' | 'degraded' | 'critical';

interface ProbeResult {
  status: MonitorStatus;
  db: 'ok' | 'fail';
  redis: 'ok' | 'off' | 'fail';
  wsSigner: 'ok' | 'fail';
}

const TICK_MS = 5 * 60_000;
const FIRST_TICK_DELAY_MS = 90_000; // let boot (pool warm, Redis connect) settle
const REALERT_MS = 6 * 3600_000;
const DB_RETRY_DELAY_MS = 10_000; // re-probe gap before a DB fail counts
const PROBE_TIMEOUT_MS = 1_500;

const SEVERITY_RANK: Record<MonitorStatus, number> = { ok: 0, degraded: 1, critical: 2 };

@Injectable()
export class PlatformHealthMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformHealthMonitorService.name);
  private timer: NodeJS.Timeout | null = null;
  private firstTimer: NodeJS.Timeout | null = null;
  private lastStatus: MonitorStatus = 'ok';
  private lastAlertAt = 0;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly wsSigner: WebsocketSignerService,
    private readonly mailer: PlatformAlertMailer,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.PLATFORM_HEALTH_MONITOR_DISABLED === '1') return;
    this.firstTimer = setTimeout(() => void this.tick(), FIRST_TICK_DELAY_MS);
    this.firstTimer.unref?.();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    this.logger.log(`Platform health monitor armed (DB + Redis + WS-signer every ${TICK_MS / 60000} min)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.firstTimer) clearTimeout(this.firstTimer);
  }

  /** Instance method (not a module helper) so tests can stub the 10s pause. */
  private pause(ms: number): Promise<void> {
    return new Promise<void>((r) => {
      const t = setTimeout(r, ms);
      (t as any).unref?.();
    });
  }

  /** One DB reachability check. */
  private async dbOnce(): Promise<boolean> {
    try {
      await withTimeout(this.prisma.client.$queryRaw`SELECT 1`, PROBE_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }

  async probe(): Promise<ProbeResult> {
    // DB — re-probe once after a pause so a transient pooler blip never pages.
    let db: ProbeResult['db'] = (await this.dbOnce()) ? 'ok' : 'fail';
    if (db === 'fail') {
      await this.pause(DB_RETRY_DELAY_MS);
      db = (await this.dbOnce()) ? 'ok' : 'fail';
    }

    // Redis — only a CONFIGURED-but-unreachable Redis is unhealthy. An
    // unconfigured deploy (no REDIS_URL) runs the designed HTTP-polling
    // fallback and must not alert on every boot.
    let redis: ProbeResult['redis'];
    const configured = !!process.env.REDIS_URL;
    const pub = this.redis.publisher;
    if (!configured) {
      redis = 'off';
    } else if (pub && pub.status === 'ready') {
      try {
        const pong = await withTimeout(pub.ping(), 500);
        redis = pong === 'PONG' ? 'ok' : 'fail';
      } catch {
        redis = 'fail';
      }
    } else {
      redis = 'fail'; // configured but not connected / gave up retrying
    }

    // WS signer — the emergency broadcast chain.
    let wsSigner: ProbeResult['wsSigner'];
    try {
      const signed = this.wsSigner.signMessage('health.probe', { probe: true });
      wsSigner = signed.signature ? 'ok' : 'fail';
    } catch {
      wsSigner = 'fail';
    }

    const status: MonitorStatus =
      db === 'fail' || wsSigner === 'fail' ? 'critical' : redis === 'fail' ? 'degraded' : 'ok';
    return { status, db, redis, wsSigner };
  }

  async tick(): Promise<void> {
    if (this.ticking) return; // never overlap probes
    this.ticking = true;
    try {
      const result = await this.probe();
      const now = Date.now();

      const enteredUnhealthy = result.status !== 'ok' && this.lastStatus === 'ok';
      const worsened = SEVERITY_RANK[result.status] > SEVERITY_RANK[this.lastStatus] && this.lastStatus !== 'ok';
      const stillUnhealthy =
        result.status !== 'ok' && this.lastStatus !== 'ok' && !worsened && now - this.lastAlertAt > REALERT_MS;
      const recovered = result.status === 'ok' && this.lastStatus !== 'ok';

      if (enteredUnhealthy || worsened || stillUnhealthy) {
        this.lastAlertAt = now;
        const subject =
          result.status === 'critical'
            ? `[VenueOS] PLATFORM CRITICAL — ${result.db === 'fail' ? 'database unreachable' : 'emergency signing chain broken'}`
            : '[VenueOS] Platform DEGRADED — Redis unreachable, realtime on polling fallback';
        const body = [
          result.status === 'critical'
            ? 'The API is up but a load-bearing dependency is failing. Dashboards, manifests, and the emergency trigger chain may be impacted RIGHT NOW.'
            : 'Redis is configured but unreachable. Realtime is riding the HTTP-polling fallback — emergency alerts still deliver (screens poll their manifest), but push delivery and multi-screen sync are degraded.',
          '',
          `Checks: db=${result.db}  redis=${result.redis}  ws_signer=${result.wsSigner}`,
          '',
          'Likely causes (CLAUDE.md-documented):',
          '  - db fail: Supabase pooler hiccup, or DATABASE_URL missing connection_limit=10&pool_timeout=20',
          '  - redis fail: Railway Redis addon restart/outage — API keeps working on the polling fallback',
          '  - ws_signer fail: DEVICE_SECRET_KEY / signer misconfiguration — treat as emergency-path outage',
          '',
          'Live checks: GET /api/v1/health, /health/ready, /health/emergency-path',
          'Logs: Railway → api → Deploy Logs. Public page: /status on the web app.',
          '',
          '— VenueOS Platform Health Monitor',
        ].join('\n');

        await this.mailer.sendAlert(subject, body, 'PLATFORM_HEALTH_ALERT');
        if (result.status === 'critical') {
          try {
            Sentry.captureMessage(subject, 'error');
          } catch {
            /* sentry optional */
          }
        }
        this.logger.warn(
          `[platform-health] ${result.status.toUpperCase()} — db=${result.db} redis=${result.redis} ws_signer=${result.wsSigner} (alert dispatched)`,
        );
      } else if (recovered) {
        await this.mailer.sendAlert(
          '[VenueOS] Platform recovered — DB/Redis/emergency chain healthy',
          'All platform health checks are green again (db=ok, redis=ok, ws_signer=ok). No action needed.\n\n— VenueOS Platform Health Monitor',
          'PLATFORM_HEALTH_RECOVERED',
        );
        this.logger.log('[platform-health] recovered — all checks green');
      }

      this.lastStatus = result.status;
    } catch (e: any) {
      this.logger.warn(`[platform-health] tick failed: ${e?.message ?? e}`);
    } finally {
      this.ticking = false;
    }
  }
}
