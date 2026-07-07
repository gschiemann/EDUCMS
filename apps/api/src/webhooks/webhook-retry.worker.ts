import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from './webhook-dispatch.service';

/**
 * WebhookRetryWorker — Audit P1-5 (2026-05-28).
 *
 * Re-delivers failed outbound webhooks. Before this, WebhookDispatchService
 * POSTed once and gave up; a receiver down for 8s during a lockdown lost
 * `emergency.triggered` forever. Now every failed delivery leaves a PENDING
 * `WebhookDelivery` row with a `nextRetryAt`, and this worker drains them.
 *
 * Pattern matches OfflineScreenScanner / CanaryAutoPromote — process-
 * internal interval, no @nestjs/schedule dep, overlap-guarded, timer
 * unref'd + cleared on module destroy.
 *
 * Multi-replica safety: each tick CLAIMS a batch of due rows with a single
 * atomic statement:
 *
 *   UPDATE webhook_deliveries
 *      SET attempts = attempts + 1, next_retry_at = NULL, updated_at = NOW()
 *    WHERE id IN (
 *      SELECT id FROM webhook_deliveries
 *       WHERE status = 'PENDING' AND next_retry_at IS NOT NULL
 *         AND next_retry_at <= NOW()
 *       ORDER BY next_retry_at
 *       LIMIT $batch
 *       FOR UPDATE SKIP LOCKED       -- two replicas never grab the same row
 *    )
 *    RETURNING ...
 *
 * Setting next_retry_at = NULL inside the claim removes the row from the
 * "due" set for the duration of the attempt; applyOutcome() then either
 * marks it DELIVERED/FAILED or re-arms next_retry_at for the following
 * backoff step. The attempts++ happens in the claim so the row carries the
 * post-attempt count when applyOutcome decides the next backoff.
 *
 * Claim lease / heartbeat (2026-07-07). The reclaim below distinguishes a
 * genuinely CRASHED worker from one that is merely SLOW (alive but its DB
 * write is stalled by a pgbouncer blip / a long GC pause / a large in-flight
 * batch). It does this with a LEASE: when a worker claims a row it stamps
 * `updated_at = NOW()`, and while it is still sending it REFRESHES that
 * timestamp every `WEBHOOK_RETRY_HEARTBEAT_MS` (default 10s) via
 * `refreshLeases()`. The reclaim only re-arms rows whose lease is older than a
 * threshold comfortably LARGER than the heartbeat (≥ 4 missed heartbeats), so a
 * slow-but-alive worker's in-flight delivery is NEVER mistaken for a crash and
 * re-sent — that was the double-send-of-`emergency.triggered` bug this closes.
 * A truly crashed pod stops heartbeating; its lease goes stale and the reclaim
 * correctly recovers the stranded row. No schema change: `updated_at` (already
 * the field the reclaim keyed off) IS the lease.
 *
 * Configurable via env:
 *   WEBHOOK_RETRY_INTERVAL_MS  default 5000  (5s — matches the tightest backoff)
 *   WEBHOOK_RETRY_BATCH        default 50
 *   WEBHOOK_RETRY_HEARTBEAT_MS default 10000 (lease-refresh cadence for in-flight rows)
 *   WEBHOOK_RETRY_RECLAIM_MS   default 120000 (crashed-worker reclaim threshold; floored ≥ max(30s, 4× heartbeat))
 *   WEBHOOK_RETRY_DISABLED     set to "1" to skip (test env, manual ops)
 */

/** Default cadence at which an active worker refreshes the lease on its in-flight rows. */
export const WEBHOOK_HEARTBEAT_MS_DEFAULT = 10_000;
/** Default crashed-worker reclaim threshold. */
export const WEBHOOK_RECLAIM_MS_DEFAULT = 120_000;
/** Absolute floor for the reclaim threshold, independent of the heartbeat. */
export const WEBHOOK_RECLAIM_MS_FLOOR = 30_000;

@Injectable()
export class WebhookRetryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRetryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Delivery-row ids THIS worker instance is actively sending right now.
   *  The lease heartbeat refreshes exactly these while the batch is in-flight. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: WebhookDispatchService,
  ) {}

  onModuleInit() {
    if (process.env.WEBHOOK_RETRY_DISABLED === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('WebhookRetryWorker disabled (env or test mode)');
      return;
    }
    const intervalMs = Number(process.env.WEBHOOK_RETRY_INTERVAL_MS) || 5_000;
    this.logger.log(`WebhookRetryWorker starting (interval=${intervalMs}ms)`);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // Don't keep the Node event loop alive on shutdown.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Resolve the effective heartbeat cadence (ms) from env, floored at 1s. */
  private heartbeatMs(): number {
    const raw = Number(process.env.WEBHOOK_RETRY_HEARTBEAT_MS);
    return raw > 0 ? Math.floor(raw) : WEBHOOK_HEARTBEAT_MS_DEFAULT;
  }

  /**
   * Resolve the effective reclaim threshold (ms). A stranded row is only
   * reclaimed once its lease (`updated_at`) is older than this. It MUST be
   * comfortably larger than the heartbeat so a slow-but-alive worker — which
   * refreshes its lease every `heartbeatMs` — needs to miss ≥ 4 heartbeats in a
   * row before it is (correctly) treated as crashed. That margin is what
   * prevents the double-send of an in-flight delivery.
   */
  private reclaimThresholdMs(heartbeatMs: number): number {
    const configured = Number(process.env.WEBHOOK_RETRY_RECLAIM_MS) || WEBHOOK_RECLAIM_MS_DEFAULT;
    return Math.max(WEBHOOK_RECLAIM_MS_FLOOR, heartbeatMs * 4, Math.floor(configured));
  }

  /** Run one drain pass. Public so ops / tests can trigger it directly. */
  async tick(): Promise<{ claimed: number; delivered: number; failed: number }> {
    if (this.running) return { claimed: 0, delivered: 0, failed: 0 }; // overlap guard
    this.running = true;
    try {
      return await this.drainOnce();
    } catch (e: any) {
      this.logger.warn(`Webhook retry drain failed: ${e?.message ?? e}`);
      return { claimed: 0, delivered: 0, failed: 0 };
    } finally {
      this.running = false;
    }
  }

  private async drainOnce(): Promise<{ claimed: number; delivered: number; failed: number }> {
    const batch = Number(process.env.WEBHOOK_RETRY_BATCH) || 50;
    const heartbeatMs = this.heartbeatMs();

    // ── RECLAIM stranded in-flight deliveries (2026-07-04, lease-hardened 2026-07-07) ──
    await this.reclaimStranded(heartbeatMs);

    // Atomically claim due rows. FOR UPDATE SKIP LOCKED guarantees no two
    // replicas claim the same delivery. attempts++ lands here so the
    // returned row already carries its post-attempt count. `updated_at = NOW()`
    // stamps the initial lease; the heartbeat below keeps it fresh while we send.
    const claimed = await this.prisma.client.$queryRawUnsafe<
      Array<{
        id: string;
        webhook_id: string;
        event: string;
        body: string;
        signed_timestamp: bigint;
        attempts: number;
      }>
    >(
      `
      UPDATE "webhook_deliveries" AS d
         SET "attempts" = d."attempts" + 1,
             "next_retry_at" = NULL,
             "updated_at" = NOW()
       WHERE d."id" IN (
         SELECT "id" FROM "webhook_deliveries"
          WHERE "status" = 'PENDING'
            AND "next_retry_at" IS NOT NULL
            AND "next_retry_at" <= NOW()
          ORDER BY "next_retry_at" ASC
          LIMIT ${Math.max(1, Math.floor(batch))}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING d."id", d."webhook_id", d."event", d."body",
                d."signed_timestamp", d."attempts"
      `,
    );

    if (!claimed || claimed.length === 0) {
      return { claimed: 0, delivered: 0, failed: 0 };
    }

    // Resolve the (small number of distinct) webhook rows for url + secret.
    const webhookIds = Array.from(new Set(claimed.map((r) => r.webhook_id)));
    const webhooks = await this.prisma.client.tenantWebhook.findMany({
      where: { id: { in: webhookIds } },
      select: { id: true, url: true, signingSecret: true, isActive: true },
    });
    const byId = new Map(webhooks.map((w) => [w.id, w]));

    let delivered = 0;
    let failed = 0;

    // ── LEASE HEARTBEAT ────────────────────────────────────────────────────
    // Register the just-claimed rows as in-flight and refresh their lease
    // (`updated_at`) every `heartbeatMs` while we send. A slow-but-alive worker
    // keeps bumping updated_at, so the reclaim (threshold ≫ heartbeat) never
    // mistakes it for a crash and re-arms a delivery still being sent → no
    // double-send of `emergency.triggered`. Each row is removed from the set the
    // instant applyOutcome resolves it, so a completed row is never bumped. The
    // timer is unref'd (never blocks shutdown) and cleared in the finally below.
    for (const r of claimed) this.inFlight.add(r.id);
    const heartbeat = setInterval(() => void this.refreshLeases(), heartbeatMs);
    heartbeat.unref?.();

    try {
      await Promise.all(
        claimed.map(async (row) => {
          try {
            const wh = byId.get(row.webhook_id);
            if (!wh || !wh.isActive) {
              // Parent webhook deleted or disabled mid-flight — stop retrying.
              await this.prisma.client.webhookDelivery
                .update({
                  where: { id: row.id },
                  data: {
                    status: 'FAILED',
                    nextRetryAt: null,
                    lastError: 'webhook removed or deactivated before retry',
                  },
                })
                .catch(() => undefined);
              failed += 1;
              return;
            }

            const outcome = await this.dispatch.attemptDelivery(
              { id: wh.id, url: wh.url, signingSecret: wh.signingSecret },
              row.body,
              row.event,
              Number(row.signed_timestamp),
            );

            // attempts already incremented in the claim; pass it straight through.
            await this.dispatch.applyOutcome(row.id, row.attempts, outcome);

            if (outcome.ok) delivered += 1;
            else if (WebhookDispatchService.nextRetryDelayMs(row.attempts) === null) failed += 1;
          } finally {
            // Row is resolved (or errored out) — stop heartbeating its lease.
            this.inFlight.delete(row.id);
          }
        }),
      );
    } finally {
      clearInterval(heartbeat);
      // Belt-and-suspenders: never leave ids from this batch lingering in the
      // set (they'd be heartbeated by a LATER batch's timer, which is harmless
      // but wasteful). The per-row finally above already clears each one.
      for (const r of claimed) this.inFlight.delete(r.id);
    }

    if (delivered > 0 || failed > 0) {
      this.logger.log(
        `Webhook retry drain: claimed=${claimed.length} delivered=${delivered} ` +
          `permanently_failed=${failed}`,
      );
    }
    return { claimed: claimed.length, delivered, failed };
  }

  /**
   * Re-arm deliveries stranded by a genuine pod crash.
   *
   * The claim sets `next_retry_at = NULL` to hold a row OUT of the due set while
   * it's being attempted, and applyOutcome() later either resolves it
   * (DELIVERED/FAILED) or re-arms `next_retry_at`. If the pod DIES between the
   * claim and applyOutcome (mid-drain crash), the row is left PENDING with
   * `next_retry_at IS NULL` — which the claim's own `next_retry_at IS NOT NULL`
   * filter makes INVISIBLE forever. That silently strands the delivery,
   * including any `emergency.triggered` webhook.
   *
   * We re-arm ONLY rows whose lease (`updated_at`) is older than
   * `reclaimThresholdMs` — comfortably larger than the heartbeat, so an alive-
   * but-slow worker (which keeps refreshing `updated_at` via `refreshLeases`) is
   * NEVER reclaimed. Only a worker that has stopped heartbeating for ≥ 4
   * intervals — i.e. actually crashed — has its row recovered here. Terminal
   * rows (DELIVERED / FAILED) are excluded by the `status = 'PENDING'` filter,
   * and rows already scheduled for a normal retry are excluded by
   * `next_retry_at IS NULL`, so neither a completed nor a poison-capped delivery
   * is ever reclaimed. At-least-once semantics — a reclaimed-then-redelivered
   * row may double-send, which receivers dedup by eventId.
   *
   * Best-effort: a failure here must not abort the normal drain.
   */
  private async reclaimStranded(heartbeatMs: number): Promise<number> {
    const thresholdMs = this.reclaimThresholdMs(heartbeatMs);
    try {
      const reclaimed = await this.prisma.client.$executeRawUnsafe(
        `
        UPDATE "webhook_deliveries"
           SET "next_retry_at" = NOW()
         WHERE "status" = 'PENDING'
           AND "next_retry_at" IS NULL
           AND "updated_at" < NOW() - (INTERVAL '1 millisecond' * ${thresholdMs})
        `,
      );
      if (typeof reclaimed === 'number' && reclaimed > 0) {
        this.logger.warn(
          `Webhook retry: reclaimed ${reclaimed} stranded in-flight ` +
            `deliveries (lease expired — no heartbeat for ≥${thresholdMs}ms, ` +
            `likely a mid-drain pod crash) and re-armed them for redelivery. ` +
            `This recovers any emergency.triggered webhook that was stuck.`,
        );
      }
      return typeof reclaimed === 'number' ? reclaimed : 0;
    } catch (e: any) {
      // Reclaim is best-effort hardening; a failure here must not abort the
      // normal drain that follows.
      this.logger.warn(`Webhook retry reclaim failed (continuing to drain): ${e?.message ?? e}`);
      return 0;
    }
  }

  /**
   * Lease heartbeat: bump `updated_at = NOW()` for every row this worker is
   * still actively sending, so the reclaim above never mistakes an alive-but-
   * slow worker for a crashed one. The `status = 'PENDING' AND next_retry_at IS
   * NULL` guard means a row that applyOutcome resolved in the same instant
   * (raced against this bump) is left untouched. Ids are bound as positional
   * params (never interpolated) so this is injection-safe. Best-effort: a stalled
   * heartbeat just means the row may eventually be reclaimed if the stall exceeds
   * the threshold — the accepted at-least-once boundary.
   */
  private async refreshLeases(): Promise<void> {
    const ids = Array.from(this.inFlight);
    if (ids.length === 0) return;
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    try {
      await this.prisma.client.$executeRawUnsafe(
        `
        UPDATE "webhook_deliveries"
           SET "updated_at" = NOW()
         WHERE "id" IN (${placeholders})
           AND "status" = 'PENDING'
           AND "next_retry_at" IS NULL
        `,
        ...ids,
      );
    } catch (e: any) {
      this.logger.warn(`Webhook retry lease heartbeat failed: ${e?.message ?? e}`);
    }
  }
}
