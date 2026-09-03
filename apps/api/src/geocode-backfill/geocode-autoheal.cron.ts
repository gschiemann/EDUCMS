import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeocodeBackfillService } from './geocode-backfill.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';

/**
 * Geocode auto-heal (2026-08-31 — Network Atlas wave).
 *
 * The manual backfill (Task #60) assumed a one-time legacy cleanup, but the
 * eligible set REFILLS in normal operation: several flows save a location's
 * `address` without coordinates (typed address, no picker resolution), and a
 * coordinate-less location can never appear on the fleet map. The operator's
 * live fleet proved it — two of four gyms had addresses and no pins.
 *
 * So the existing service now runs itself: shortly after boot and then
 * hourly, IF (and only if) candidates exist. Everything hard was already
 * solved in GeocodeBackfillService — provider chain, 1.1s pacing, range +
 * null-island validation, per-tenant AuditLog rows, single-flight lock —
 * this cron only decides WHEN. `dryRun: false` is the point: healing, not
 * reporting.
 *
 * Multi-replica: the pre-check `count()` plus the WHERE (`latitude IS
 * NULL`) make concurrent runs converge — a second replica re-geocoding a
 * just-healed tenant is filtered out at its own findMany. The boot delay
 * carries jitter so replicas don't tick in phase. Worst case is duplicate
 * provider calls, never duplicate/conflicting writes.
 */
@Injectable()
export class GeocodeAutoHealCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GeocodeAutoHealCron.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  private static readonly INTERVAL_MS = 60 * 60_000;
  private static readonly BATCH_LIMIT = 25;

  constructor(
    private readonly prisma: PrismaService,
    private readonly backfill: GeocodeBackfillService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.GEOCODE_AUTOHEAL_DISABLED === '1') {
      this.logger.warn('Geocode auto-heal disabled via env (GEOCODE_AUTOHEAL_DISABLED=1)');
      return;
    }
    const bootDelay = 45_000 + Math.floor(Math.random() * 30_000);
    setTimeout(() => {
      void this.tick().catch((e) => this.logger.warn(`first tick failed: ${(e as Error).message}`));
    }, bootDelay);
    this.timer = setInterval(() => {
      void this.tick().catch((e) => this.logger.warn(`tick failed: ${(e as Error).message}`));
    }, GeocodeAutoHealCron.INTERVAL_MS);
    this.logger.log(`Geocode auto-heal active — hourly, batch ≤ ${GeocodeAutoHealCron.BATCH_LIMIT}`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public so tests can drive a tick without the timer. */
  async tick(): Promise<void> {
    // Leader-leased (2026-09-02 multi-replica wave). The class comment above
    // is right that concurrent runs CONVERGE — but each one still spends
    // billed Google Geocoding quota and writes its own per-tenant AuditLog
    // row, so two replicas double the bill and the paper trail for one heal.
    // One leader does the work; the convergence argument stays true and is
    // now the backstop for degraded (Redis-down) lease mode.
    const status = await leadThisTick(this.lease, LEASE.GEOCODE_AUTOHEAL);
    if (!status.leader) return;

    // Cheap gate before waking the machinery: the overwhelmingly common
    // hourly outcome is "nothing to do" and it must cost one count() only.
    const candidates = await this.prisma.client.tenant.count({
      where: { address: { not: null }, latitude: null, longitude: null },
    });
    if (candidates === 0) return;

    try {
      const summary = await this.backfill.run({
        dryRun: false,
        limit: GeocodeAutoHealCron.BATCH_LIMIT,
      });
      this.logger.log(
        `geocode auto-heal: ${summary.geocoded} geocoded, ${summary.failed} failed, ${summary.skipped} skipped (candidates=${candidates})`,
      );
    } catch (e) {
      // Single-flight collision with a concurrent manual run is expected
      // and harmless — next hour's tick will find whatever remains.
      const msg = (e as Error).message ?? String(e);
      this.logger.warn(`geocode auto-heal run did not start: ${msg}`);
    }
  }
}
