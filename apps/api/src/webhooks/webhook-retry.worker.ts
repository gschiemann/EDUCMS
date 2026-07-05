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
 * Configurable via env:
 *   WEBHOOK_RETRY_INTERVAL_MS  default 5000  (5s — matches the tightest backoff)
 *   WEBHOOK_RETRY_BATCH        default 50
 *   WEBHOOK_RETRY_DISABLED     set to "1" to skip (test env, manual ops)
 */
@Injectable()
export class WebhookRetryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRetryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

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

    // ── RECLAIM stranded in-flight deliveries (2026-07-04) ──────────────
    // The claim below sets `next_retry_at = NULL` to hold a row OUT of the due
    // set while it's being attempted, and applyOutcome() later either resolves
    // it (DELIVERED/FAILED) or re-arms `next_retry_at`. If the pod DIES between
    // the claim and applyOutcome (mid-drain crash), the row is left PENDING with
    // `next_retry_at IS NULL` — which the claim's own `next_retry_at IS NOT NULL`
    // filter makes INVISIBLE forever. That silently strands the delivery,
    // including any `emergency.triggered` webhook. Re-arm rows that have been
    // "in flight" longer than any legitimate attempt could take (a live attempt
    // updates the row within seconds; the HTTP dispatch is bounded well under a
    // minute) so the next claim redelivers them. At-least-once semantics — a
    // reclaimed-then-redelivered row may double-send, which receivers dedup by
    // eventId and emergency consumers already treat idempotently. Never touches
    // a row a healthy replica is actively working (its updated_at is recent).
    const reclaimMs = Number(process.env.WEBHOOK_RETRY_RECLAIM_MS) || 120_000;
    try {
      const reclaimed = await this.prisma.client.$executeRawUnsafe(
        `
        UPDATE "webhook_deliveries"
           SET "next_retry_at" = NOW()
         WHERE "status" = 'PENDING'
           AND "next_retry_at" IS NULL
           AND "updated_at" < NOW() - (INTERVAL '1 millisecond' * ${Math.max(30_000, Math.floor(reclaimMs))})
        `,
      );
      if (typeof reclaimed === 'number' && reclaimed > 0) {
        this.logger.warn(
          `Webhook retry: reclaimed ${reclaimed} stranded in-flight ` +
            `deliveries (claimed but never resolved — likely a mid-drain pod ` +
            `crash) and re-armed them for redelivery. This recovers any ` +
            `emergency.triggered webhook that was stuck.`,
        );
      }
    } catch (e: any) {
      // Reclaim is best-effort hardening; a failure here must not abort the
      // normal drain below.
      this.logger.warn(`Webhook retry reclaim failed (continuing to drain): ${e?.message ?? e}`);
    }

    // Atomically claim due rows. FOR UPDATE SKIP LOCKED guarantees no two
    // replicas claim the same delivery. attempts++ lands here so the
    // returned row already carries its post-attempt count.
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

    await Promise.all(
      claimed.map(async (row) => {
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
      }),
    );

    if (delivered > 0 || failed > 0) {
      this.logger.log(
        `Webhook retry drain: claimed=${claimed.length} delivered=${delivered} ` +
          `permanently_failed=${failed}`,
      );
    }
    return { claimed: claimed.length, delivered, failed };
  }
}
