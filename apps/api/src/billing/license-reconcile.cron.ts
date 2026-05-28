import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';

/**
 * LicenseReconcileCron — P1-5 audit fix (CLAUDE.md §16: "Cron-triggered
 * consistency checks (License vs Stripe quantity ...)").
 *
 * The Stripe subscription quantity (what the tenant is billed for) is
 * kept in lockstep with the live paired-screen count by
 * `StripeService.syncSubscriptionQuantity(tenantId)`, fired AFTER every
 * screen pair / unpair / delete in screens.controller.ts. Those calls
 * are event-driven, fire-and-forget (`.catch(() => {})`, never awaited)
 * so a Stripe hiccup can never block pairing. The downside: if any one
 * of those calls silently fails (Stripe 5xx, network blip, the API pod
 * dying mid-pair), the Stripe quantity drifts from the seat count
 * **permanently** — there is nothing to re-try it. The tenant is then
 * over- or under-billed until someone notices by hand.
 *
 * This cron is the safety net. Once a day it walks every tenant with an
 * active card subscription, recomputes the live seat count, and re-syncs
 * any drift via the SAME `syncSubscriptionQuantity` path (which is
 * idempotent — it only writes to Stripe when the quantity actually
 * differs). The event-driven calls stay; this is belt-and-suspenders,
 * not a replacement.
 *
 * ─── Safety properties ───────────────────────────────────────────────
 *
 *   - READ-COMPARE-THEN-SYNC. Never deletes, never cancels. The worst a
 *     buggy run can do is set the Stripe quantity to the (correct) live
 *     seat count — exactly what the event-driven path already does.
 *   - Stripe unreachable → the underlying retrieve throws, the sync
 *     returns `skipped`, and this run simply does nothing for that
 *     tenant. We try again tomorrow.
 *   - Degrades to a no-op when Stripe is unconfigured on this deploy
 *     (the live pilot has no Stripe), so it costs nothing there.
 *
 * ─── Multi-replica strategy ──────────────────────────────────────────
 *
 * The `LICENSE_RECONCILED` AuditLog row is BOTH the forensic record AND
 * the multi-replica dedup guard — the same pattern ScreenWedgeDetector
 * adopted after the Redis SET-NX lock proved unreliable on Railway
 * ("AuditLog is the source of truth. Multi-replica safe automatically
 * — Postgres serializes the SELECT+INSERT pair"). Before correcting a
 * tenant's drift we check whether a `LICENSE_RECONCILED` row already
 * exists for that tenant in the current day-bucket; if so we skip the
 * audit write. Two pods racing the same tenant is harmless regardless:
 * `syncSubscriptionQuantity` is idempotent (it sets the quantity to the
 * same correct value), and a rare duplicate audit row is read-only
 * forensics — never a destructive action.
 *
 * No `@nestjs/schedule` dependency (matches pos-sync.cron.ts /
 * canary-auto-promote.ts) — a plain `setInterval` that wakes once a
 * minute and fires at most once per UTC-day bucket.
 *
 * Env levers:
 *   LICENSE_RECONCILE_DISABLED      set to "1" to skip (manual ops)
 *   LICENSE_RECONCILE_INTERVAL_MS   wake cadence, default 60000 (60s)
 */
@Injectable()
export class LicenseReconcileCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LicenseReconcileCron.name);
  private timer?: NodeJS.Timeout;
  /** UTC-day bucket of the last completed run. -1 = never run. */
  private lastRunBucket = -1;
  private running = false;

  /** One day in ms — the reconcile cadence. */
  private static readonly DAY_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.LICENSE_RECONCILE_DISABLED === '1') {
      return;
    }
    const wakeMs = Number(process.env.LICENSE_RECONCILE_INTERVAL_MS) || 60_000;
    this.timer = setInterval(() => void this.tick(), wakeMs);
    // Don't keep the Node event loop alive on shutdown.
    this.timer.unref?.();
    this.logger.log('License↔Stripe reconcile cron scheduled (daily safety net).');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Wake handler: fire `runAll` at most once per UTC-day bucket. */
  private async tick(): Promise<void> {
    if (this.running) return; // overlap guard
    const bucket = Math.floor(Date.now() / LicenseReconcileCron.DAY_MS);
    if (bucket === this.lastRunBucket) return;
    this.lastRunBucket = bucket;
    this.running = true;
    try {
      await this.runAll();
    } catch (err: any) {
      this.logger.warn(`reconcile tick failed: ${err?.message ?? err}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Walk every tenant with an active card Stripe subscription and
   * re-sync any drift. Public so a SUPER_ADMIN script or a test can
   * force a pass without waiting on the timer.
   *
   * Returns a summary for observability + tests.
   */
  async runAll(): Promise<{
    scanned: number;
    corrected: number;
    inSync: number;
    skipped: number;
  }> {
    // No-op fast path when billing is off on this deploy — saves a DB
    // query and is the common case for the live pilot.
    if (!this.stripe.enabled()) {
      return { scanned: 0, corrected: 0, inSync: 0, skipped: 0 };
    }

    // Only CARD-billed, non-cancelled licenses with a Stripe
    // subscription are auto-adjustable. INVOICE / PURCHASE_ORDER / COMP
    // tenants are billed on a contracted seat count the operator tops
    // up by hand — `syncSubscriptionQuantity` would skip them anyway,
    // but filtering here keeps the scan tight.
    const licenses = await this.prisma.client.license.findMany({
      where: {
        billingMode: 'CARD',
        status: { not: 'CANCELLED' },
        stripeSubscriptionId: { not: null },
      },
      select: { tenantId: true },
    });

    if (licenses.length === 0) {
      return { scanned: 0, corrected: 0, inSync: 0, skipped: 0 };
    }

    let corrected = 0;
    let inSync = 0;
    let skipped = 0;

    for (const { tenantId } of licenses) {
      let result;
      try {
        // Reuse the exact event-driven path — it is idempotent and
        // only writes to Stripe when the quantity actually differs.
        result = await this.stripe.syncSubscriptionQuantity(tenantId);
      } catch (e: any) {
        // Stripe unreachable / unexpected — skip this tenant, try again
        // tomorrow. Never let one tenant's failure abort the whole run.
        this.logger.warn(
          `[license-reconcile] sync failed for tenant=${tenantId}: ${e?.message ?? e}`,
        );
        skipped++;
        continue;
      }

      if (result.status === 'corrected') {
        corrected++;
        await this.recordCorrection(tenantId, result.from, result.to);
      } else if (result.status === 'in-sync') {
        inSync++;
      } else {
        skipped++;
      }
    }

    if (corrected > 0) {
      this.logger.warn(
        `[license-reconcile] DRIFT CORRECTED on ${corrected} tenant(s) — ` +
          `event-driven sync had silently failed. ` +
          `(${inSync} already in-sync, ${skipped} skipped, ${licenses.length} scanned)`,
      );
    } else {
      this.logger.log(
        `[license-reconcile] all ${licenses.length} card subscription(s) in lockstep ` +
          `(${inSync} in-sync, ${skipped} skipped).`,
      );
    }

    return { scanned: licenses.length, corrected, inSync, skipped };
  }

  /**
   * Write a `LICENSE_RECONCILED` AuditLog row for a corrected drift —
   * the forensic trail AND the multi-replica dedup guard (one row per
   * tenant per UTC-day bucket; a second pod that also corrected the
   * same tenant within the day skips the write). Best-effort: a failed
   * audit insert must never undo the (already-applied, correct) Stripe
   * quantity change.
   */
  private async recordCorrection(
    tenantId: string,
    from: number | undefined,
    to: number | undefined,
  ): Promise<void> {
    try {
      const dayStart = new Date(
        Math.floor(Date.now() / LicenseReconcileCron.DAY_MS) * LicenseReconcileCron.DAY_MS,
      );
      const already = await this.prisma.client.auditLog.findFirst({
        where: {
          tenantId,
          action: 'LICENSE_RECONCILED',
          createdAt: { gte: dayStart },
        },
        select: { id: true },
      });
      if (already) return; // another replica already logged today

      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: null, // system-initiated
          action: 'LICENSE_RECONCILED',
          targetType: 'License',
          targetId: tenantId,
          details: JSON.stringify({
            scope: 'billing',
            reason:
              'Daily reconcile detected Stripe subscription quantity drift ' +
              'from live paired-screen count; re-synced. The event-driven ' +
              'sync (on pair/unpair/delete) had silently failed.',
            fromQuantity: from ?? null,
            toQuantity: to ?? null,
          }),
        },
      });
    } catch (e: any) {
      this.logger.warn(
        `[license-reconcile] audit log failed for tenant=${tenantId}: ${e?.message ?? e}`,
      );
    }
  }
}
