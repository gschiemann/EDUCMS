import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isInCanaryCohort } from './canary-cohort';

/**
 * ─── OTA-02 (2026-08-03): the promotion gate, rebuilt ──────────────────
 *
 * WHAT IT USED TO BE. `canaryScreens.find(s => s.lastOtaState === 'ERROR')`
 * — one line, and every part of it was load-bearing in the wrong direction:
 *
 *   • NO MINIMUM COHORT. `canaryScreens.length` was computed, logged, and
 *     never compared to anything. An EMPTY cohort — a low percent that no
 *     screen hashes below, a tenant whose screens were all deleted, a
 *     tenant with no screens at all — made `find()` return undefined, which
 *     read as "no errors", which promoted the tenant to a 100% rollout on
 *     ZERO health evidence.
 *   • NO SUCCESS REQUIREMENT. The gate never checked that any cohort screen
 *     had actually INSTALLED anything. `playerVersionAt` was selected and
 *     then never read.
 *   • NO OUTLIER REJECTION. Exactly one ERROR halted everything, forever,
 *     every 5 minutes — and `lastOtaState` was writable by an unauthenticated
 *     caller who knew one fingerprint. One request held a tenant's entire
 *     patch pipeline closed indefinitely.
 *   • A SELF-ERASING SIGNAL. The player reports `CHECKING` at the head of
 *     EVERY OTA cycle, overwriting `lastOtaState`. With the default 24 h
 *     force-window equal to the default 24 h soak, the state at soak expiry
 *     was routinely `CHECKING`, not `ERROR` — so a genuinely failing build
 *     promoted itself, no attacker required.
 *
 * WHAT IT IS NOW. Promotion requires POSITIVE evidence, not merely the
 * absence of a signal that erased itself: a non-empty cohort, at least one
 * confirmed install during the soak, and an error rate under threshold.
 * Errors are read from the STICKY `lastOtaErrorAt` column that no
 * non-ERROR state report can clear, and an AUTHENTICATED error always halts
 * regardless of rate — so a trustworthy failure still stops a rollout dead
 * while a single anonymous one no longer can.
 *
 * Kept as a pure function so the quorum arithmetic is unit-testable without
 * a Prisma client — the same discipline as `canary-cohort.ts` and
 * `ScreenWedgeDetectorCron.decide`.
 */
export interface CanaryCohortScreen {
  id: string;
  lastOtaState?: string | null;
  lastOtaAt?: Date | string | null;
  lastOtaErrorAt?: Date | string | null;
  lastOtaErrorAuthenticated?: boolean | null;
  playerVersionAt?: Date | string | null;
}

export interface CanaryPromotionVerdict {
  promote: boolean;
  reason: string;
  cohortSize: number;
  successCount: number;
  errorCount: number;
  authenticatedErrorCount: number;
}

/**
 * Minimum cohort size for an AUTOMATIC promotion. Default 1 — i.e. the
 * cohort must simply be non-empty, which is the actual bug (promoting on
 * zero evidence). Deliberately NOT defaulted higher: most K-12 tenants run
 * a handful of screens, and a floor of 3+ would silently strand them in
 * canary forever, which is its own outage. Operators who want a stricter
 * floor set CANARY_MIN_COHORT.
 */
const MIN_CANARY_COHORT = () => {
  const n = Number(process.env.CANARY_MIN_COHORT);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
};

/**
 * Fraction of the cohort that may report an UNAUTHENTICATED error before
 * promotion halts. Anonymous error reports are attacker-writable, so a lone
 * one is treated as an outlier rather than a veto; a real bad build shows up
 * across the cohort and clears this bar easily. Authenticated errors bypass
 * this entirely (see below).
 */
const MAX_ANONYMOUS_ERROR_RATE = () => {
  const n = Number(process.env.CANARY_MAX_ERROR_RATE);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.2;
};

const asMs = (v: Date | string | null | undefined): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

export function evaluateCanaryPromotion(opts: {
  cohort: CanaryCohortScreen[];
  canarySetAt: Date;
  minCohort?: number;
  maxAnonymousErrorRate?: number;
}): CanaryPromotionVerdict {
  const { cohort, canarySetAt } = opts;
  const minCohort = opts.minCohort ?? 1;
  const maxRate = opts.maxAnonymousErrorRate ?? 0.2;
  const setAtMs = canarySetAt.getTime();

  // Errors that happened DURING this canary window. Pre-existing failures
  // from before the canary was armed don't count.
  const errors = cohort.filter((s) => {
    const errAt = asMs(s.lastOtaErrorAt);
    if (errAt !== null) return errAt >= setAtMs;
    // Back-compat for rows written before `lastOtaErrorAt` existed: fall
    // back to the old (erasable) column so a canary armed across the deploy
    // boundary still honours an error it recorded the old way.
    if (s.lastOtaState !== 'ERROR') return false;
    const at = asMs(s.lastOtaAt);
    return at === null ? true : at >= setAtMs;
  });
  const authenticatedErrors = errors.filter((s) => s.lastOtaErrorAuthenticated === true);

  // Positive evidence: the screen reported a version AFTER the canary was
  // armed. That is the same "the install actually landed" proof the
  // force-flag clear uses, applied to the promotion decision.
  const successes = cohort.filter((s) => {
    const at = asMs(s.playerVersionAt);
    return at !== null && at >= setAtMs;
  });

  const base = {
    cohortSize: cohort.length,
    successCount: successes.length,
    errorCount: errors.length,
    authenticatedErrorCount: authenticatedErrors.length,
  };

  if (cohort.length < minCohort) {
    return { promote: false, reason: `cohort-below-minimum(${cohort.length}<${minCohort})`, ...base };
  }
  if (authenticatedErrors.length > 0) {
    return { promote: false, reason: 'authenticated-install-error-in-cohort', ...base };
  }
  if (errors.length > 0) {
    const rate = errors.length / cohort.length;
    if (rate > maxRate) {
      return {
        promote: false,
        reason: `error-rate-above-threshold(${errors.length}/${cohort.length}>${maxRate})`,
        ...base,
      };
    }
  }
  if (successes.length === 0) {
    return { promote: false, reason: 'no-confirmed-install-in-cohort', ...base };
  }
  return { promote: true, reason: 'ok', ...base };
}

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

        const screens = await this.prisma.client.screen.findMany({
          where: { tenantId: t.id },
          select: {
            id: true,
            lastOtaState: true,
            lastOtaAt: true,
            lastOtaErrorAt: true,
            lastOtaErrorAuthenticated: true,
            playerVersionAt: true,
          } as any,
        });
        const canaryScreens = (screens as any[]).filter((s) =>
          isInCanaryCohort(s.id, t.canaryFleetPercent),
        );

        const verdict = evaluateCanaryPromotion({
          cohort: canaryScreens,
          canarySetAt: new Date(setAt),
          minCohort: MIN_CANARY_COHORT(),
          maxAnonymousErrorRate: MAX_ANONYMOUS_ERROR_RATE(),
        });

        if (!verdict.promote) {
          this.logger.warn(
            `[canary] tenant=${t.id} (${t.name}) auto-promote HALTED — ${verdict.reason} ` +
            `(cohort=${verdict.cohortSize} installs=${verdict.successCount} ` +
            `errors=${verdict.errorCount} authedErrors=${verdict.authenticatedErrorCount})`,
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
              cohortSize: verdict.cohortSize,
              // The evidence the promotion was actually based on. Before
              // 2026-08-03 this row recorded a cohort size that was never
              // compared to anything — an empty cohort promoted on zero
              // health evidence and the audit row looked identical.
              confirmedInstalls: verdict.successCount,
              errorsInCohort: verdict.errorCount,
              authenticatedErrors: verdict.authenticatedErrorCount,
              setAt: setAt.toISOString(),
              elapsedMs,
            }),
          },
        }).catch(() => { /* audit best-effort */ });
        this.logger.log(
          `[canary] tenant=${t.id} (${t.name}) AUTO-PROMOTED ` +
          `(was ${t.canaryFleetPercent}%, cohort=${verdict.cohortSize}, ` +
          `confirmedInstalls=${verdict.successCount}, errors=${verdict.errorCount}, ` +
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
