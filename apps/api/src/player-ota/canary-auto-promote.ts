import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isInCanaryCohort } from './canary-cohort';

/**
 * CanaryAutoPromote — Sprint 11 Phase B.
 *
 * Background service that promotes tenants out of canary state once
 * the soak window elapses with no install errors in the canary cohort.
 *
 * Pattern matches OfflineScreenScanner — process-internal interval,
 * no @nestjs/schedule dep, overlap-guarded, kills the timer on
 * module destroy.
 *
 * Per-tick logic:
 *
 *   1. Find tenants where canary_fleet_percent < 100 AND
 *      canary_set_at IS NOT NULL.
 *   2. For each:
 *      a) If soak window NOT yet elapsed → skip
 *      b) If canary_auto_promote = false → log + skip
 *         (manual promotion required)
 *      c) Scan tenant screens. For those in the canary cohort
 *         (deterministic hash), check last_ota_state since
 *         canary_set_at. If any reported ERROR → log + skip
 *         (operator must investigate before promoting)
 *      d) Otherwise promote: set canary_fleet_percent=100,
 *         clear canary_set_at, write AuditLog.
 *
 * Cadence: every 5 min. Drift doesn't matter — a tenant that
 * crossed the soak threshold 4 min ago vs 1 min ago is functionally
 * the same outcome.
 */
@Injectable()
export class CanaryAutoPromote implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CanaryAutoPromote.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.CANARY_AUTO_PROMOTE_DISABLED === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('CanaryAutoPromote disabled (env or test mode)');
      return;
    }
    const intervalMs = Number(process.env.CANARY_AUTO_PROMOTE_INTERVAL_MS) || 5 * 60_000;
    this.logger.log(`CanaryAutoPromote starting (interval=${intervalMs}ms)`);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<{ scanned: number; promoted: number; blocked: number }> {
    if (this.running) return { scanned: 0, promoted: 0, blocked: 0 };
    this.running = true;
    let scanned = 0;
    let promoted = 0;
    let blocked = 0;
    try {
      const tenants = await this.prisma.client.tenant.findMany({
        where: {
          AND: [
            { canaryFleetPercent: { lt: 100 } } as any,
            { canarySetAt: { not: null } } as any,
          ],
        },
        select: {
          id: true,
          name: true,
          canaryFleetPercent: true,
          canarySetAt: true,
          canaryAutoPromote: true,
          canarySoakHours: true,
        } as any,
      });
      scanned = tenants.length;

      for (const t of tenants as any[]) {
        const setAt: Date | null = t.canarySetAt;
        const soakHours: number = t.canarySoakHours ?? 24;
        const soakMs = Math.max(1, soakHours) * 60 * 60_000;
        if (!setAt) continue;
        const elapsedMs = Date.now() - new Date(setAt).getTime();
        if (elapsedMs < soakMs) continue; // soak not elapsed yet

        if (!t.canaryAutoPromote) {
          // Manual mode — log once per tick so operator notices.
          this.logger.log(
            `[canary] tenant=${t.id} (${t.name}) soak elapsed but auto-promote=OFF — manual action required`,
          );
          blocked++;
          continue;
        }

        // Check the canary cohort for install errors since canary
        // was set. Even one ERROR halts auto-promotion — operator
        // must investigate and either lower the percent further,
        // resolve, then bump back to 100 manually.
        const screens = await this.prisma.client.screen.findMany({
          where: { tenantId: t.id },
          select: {
            id: true,
            lastOtaState: true,
            lastOtaAt: true,
            playerVersionAt: true,
          } as any,
        });
        const canaryScreens = (screens as any[]).filter((s) =>
          isInCanaryCohort(s.id, t.canaryFleetPercent),
        );
        const errorScreen = canaryScreens.find((s) => {
          if (s.lastOtaState !== 'ERROR') return false;
          // ERROR must have happened DURING this canary window —
          // pre-existing ERRORs from before the canary was set
          // don't count.
          if (!s.lastOtaAt) return true;
          return new Date(s.lastOtaAt).getTime() >= new Date(setAt).getTime();
        });
        if (errorScreen) {
          this.logger.warn(
            `[canary] tenant=${t.id} (${t.name}) auto-promote HALTED — ` +
            `cohort screen=${errorScreen.id} reported ERROR during soak; ` +
            `operator must investigate before promoting`,
          );
          blocked++;
          continue;
        }

        // Promote.
        await this.prisma.client.tenant.update({
          where: { id: t.id },
          data: {
            canaryFleetPercent: 100,
            canarySetAt: null,
          } as any,
        });
        await this.prisma.client.auditLog.create({
          data: {
            action: 'CANARY_AUTO_PROMOTED',
            targetType: 'tenant',
            targetId: t.id,
            tenantId: t.id,
            userId: null,
            details: JSON.stringify({
              previousPercent: t.canaryFleetPercent,
              soakHours,
              cohortSize: canaryScreens.length,
              setAt: setAt.toISOString(),
              elapsedMs,
            }),
          },
        }).catch(() => { /* audit best-effort */ });
        this.logger.log(
          `[canary] tenant=${t.id} (${t.name}) AUTO-PROMOTED ` +
          `(was ${t.canaryFleetPercent}%, ${canaryScreens.length} screens in cohort, ` +
          `soaked ${Math.round(elapsedMs / 60000)}min)`,
        );
        promoted++;
      }
    } catch (e: any) {
      this.logger.warn(`CanaryAutoPromote tick failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
    return { scanned, promoted, blocked };
  }
}
