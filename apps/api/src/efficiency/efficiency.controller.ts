import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { EfficiencyMetricsService } from './efficiency-metrics.service';
import { EfficiencyAlertingService } from './efficiency-alerting.service';

/**
 * GET /api/v1/super/efficiency — SUPER_ADMIN only.
 *
 * Returns a real-time efficiency snapshot:
 *  - Top-N heaviest routes by bytes served
 *  - Top-N routes by request count
 *  - p50/p95 latencies over the rolling 60-minute window
 *  - Slowest Prisma queries (model + action + duration, cross-replica via Redis)
 *  - Rolling egress estimate + % of configurable budget
 *  - Cache-hit ratio for asset/proxy paths
 *  - Overall efficiency score (0-100) with worst-offender call-outs
 *  - Active alert banner flag
 *
 * Guard pattern copied exactly from super-license.controller.ts:
 *   @UseGuards(JwtAuthGuard, RbacGuard) + @RequireRoles(AppRole.SUPER_ADMIN)
 */
@Controller('api/v1/super')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
export class EfficiencyController {
  constructor(
    private readonly metrics: EfficiencyMetricsService,
    private readonly alerting: EfficiencyAlertingService,
  ) {}

  @Get('efficiency')
  async getEfficiency() {
    // 2026-09-02: pull the durable Redis aggregates (month-to-date egress +
    // the 7-day hourly baseline) before rendering, so the page shows totals
    // that survived the last restart instead of whatever this process has
    // counted since boot. One read on a SUPER_ADMIN-only page; the request
    // path itself does zero Redis work.
    await this.metrics.refreshRedisAggregates();
    const snapshot = this.metrics.getSnapshot();
    const banner = {
      active: this.alerting.bannerActive,
      message: this.alerting.bannerMessage || null,
    };

    // Reading the snapshot clears the banner (the operator has seen it).
    // We intentionally do NOT write an AuditLog row here — this is a
    // read-only diagnostic endpoint, not a privileged mutation.
    if (this.alerting.bannerActive) {
      this.alerting.bannerActive = false;
      this.alerting.bannerMessage = '';
    }

    return {
      ...snapshot,
      banner,
      meta: {
        budgetGb: parseFloat(process.env.EGRESS_BUDGET_GB || '250'),
        slowQueryThresholdMs: parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '200', 10),
        note: [
          'Egress totals and the anomaly baseline come from Redis when it is ',
          'reachable (month-to-date, cross-replica, restart-durable) — see ',
          'egress.source and anomaly.baselineSource; they fall back to this ',
          "process's counters when it is not. Per-route bytes/counts and the ",
          '60-minute latency window are LOCAL to this replica: directional ',
          'signal, not absolute totals. Response bytes are counted as written ',
          'to the socket. Supabase/CDN egress served directly to players is ',
          'not observable here — the provider dashboards are authoritative.',
        ].join(''),
      },
    };
  }
}
