import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SCREEN_ONLINE_GRACE_MS } from '../telemetry/online-grace';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';

/**
 * FleetPulseSampler — the truth behind the dashboard's "Fleet pulse" chart
 * (2026-08-31, design-mock parity).
 *
 * The mock draws a 24h online/degraded/offline area chart. A chart needs
 * HISTORY, and until now nothing recorded fleet status over time — so this
 * samples every tenant's fleet into `fleet_samples` on a fixed cadence:
 * one tiny row per tenant per tick (online / offline / not-painting /
 * total). The chart then draws only what was actually observed; on a fresh
 * deploy it fills forward honestly instead of inventing a past.
 *
 * COST DISCIPLINE (connection_limit=10 pool):
 *   - THREE grouped queries per tick for the entire platform — never
 *     per-tenant fan-out. groupBy(tenantId) over screens for totals,
 *     online, and online-with-fresh-render; not-painting is derived from
 *     the same 5-minute STALE convention deriveRenderHealth encodes.
 *   - createMany in one insert.
 *   - Samples every 15 min → 96 rows/tenant/day; pruned at 7 days in the
 *     same tick (cheap deleteMany), so the table is permanently small.
 *
 * Multi-replica: two replicas double-sampling would only densify the
 * series harmlessly, but to keep it clean each tick first checks whether a
 * platform-wide sample newer than half the cadence exists and stands down.
 */
@Injectable()
export class FleetPulseSamplerCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FleetPulseSamplerCron.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  private static readonly SAMPLE_INTERVAL_MS = 15 * 60_000;
  /** Mirrors the fleet's liveness convention (screens.controller STALE_MS).
   *  2026-09-02: both now read the SAME constant, because a pulse sampler
   *  that disagreed with the list about what "online" means would draw a
   *  history chart the operator could not reconcile with the screen rows. */
  private static readonly ONLINE_WITHIN_MS = SCREEN_ONLINE_GRACE_MS;
  /** Mirrors deriveRenderHealth's 5-minute no-proof alarm window. */
  private static readonly RENDER_FRESH_MS = 5 * 60_000;
  private static readonly RETENTION_MS = 7 * 24 * 60 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.FLEET_PULSE_DISABLED === '1') {
      this.logger.warn('FleetPulseSampler disabled via env (FLEET_PULSE_DISABLED=1)');
      return;
    }
    // First sample shortly after boot so a fresh deploy starts its history
    // now rather than up to 15 minutes from now.
    setTimeout(() => {
      void this.sample().catch((e) => this.logger.warn(`first sample failed: ${(e as Error).message}`));
    }, 30_000);
    this.timer = setInterval(() => {
      void this.sample().catch((e) => this.logger.warn(`sample failed: ${(e as Error).message}`));
    }, FleetPulseSamplerCron.SAMPLE_INTERVAL_MS);
    this.logger.log(
      `FleetPulseSampler active — every ${FleetPulseSamplerCron.SAMPLE_INTERVAL_MS / 60_000}min, retention ${FleetPulseSamplerCron.RETENTION_MS / 86_400_000}d`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public so tests can drive a tick without the timer. */
  async sample(now = Date.now()): Promise<void> {
    // Leader-leased (2026-09-02 multi-replica wave). The read-then-write
    // stand-down below is a RACE — two replicas that tick within the same
    // moment both read "no recent sample" and both insert a row per tenant,
    // densifying the chart with duplicate points. It also costs the follower
    // a DB read every 15 min for nothing. The lease decides first; the probe
    // stays as the backstop for degraded (Redis-down) mode.
    const status = await leadThisTick(this.lease, LEASE.FLEET_PULSE);
    if (!status.leader) return;

    // Replica stand-down: if any sample newer than half a cadence exists,
    // another replica already took this tick.
    const recent = await this.prisma.client.fleetSample.findFirst({
      where: { createdAt: { gte: new Date(now - FleetPulseSamplerCron.SAMPLE_INTERVAL_MS / 2) } },
      select: { id: true },
    });
    if (recent) return;

    const onlineCutoff = new Date(now - FleetPulseSamplerCron.ONLINE_WITHIN_MS);
    const renderCutoff = new Date(now - FleetPulseSamplerCron.RENDER_FRESH_MS);

    const [totals, online, onlinePainting] = await Promise.all([
      this.prisma.client.screen.groupBy({
        by: ['tenantId'],
        where: { tenantId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.client.screen.groupBy({
        by: ['tenantId'],
        where: { tenantId: { not: null }, lastPingAt: { gte: onlineCutoff } },
        _count: { _all: true },
      }),
      this.prisma.client.screen.groupBy({
        by: ['tenantId'],
        where: {
          tenantId: { not: null },
          lastPingAt: { gte: onlineCutoff },
          lastRenderedAt: { gte: renderCutoff },
        },
        _count: { _all: true },
      }),
    ]);

    const onlineBy = new Map(online.map((r: any) => [r.tenantId as string, r._count._all as number]));
    const paintingBy = new Map(onlinePainting.map((r: any) => [r.tenantId as string, r._count._all as number]));

    const rows = totals
      .filter((r: any) => r.tenantId)
      .map((r: any) => {
        const total = r._count._all as number;
        const on = onlineBy.get(r.tenantId as string) ?? 0;
        const painting = paintingBy.get(r.tenantId as string) ?? 0;
        return {
          tenantId: r.tenantId as string,
          online: on,
          offline: total - on,
          // Online but no render proof inside the fresh window — the
          // "degraded" band of the chart. Approximates deriveRenderHealth
          // at aggregate cost; per-screen nuance stays on the screens list.
          notPainting: Math.max(0, on - painting),
          total,
        };
      });
    if (rows.length === 0) return;

    await this.prisma.client.fleetSample.createMany({ data: rows });
    await this.prisma.client.fleetSample.deleteMany({
      where: { createdAt: { lt: new Date(now - FleetPulseSamplerCron.RETENTION_MS) } },
    });
  }
}
