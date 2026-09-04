import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { safeFetchPost, SsrfError } from '../branding/safe-fetch';

/**
 * Outbound webhook delivery (Developer area, 2026-05-25).
 *
 * Separate from WebhooksService so the high-volume dispatch path
 * doesn't depend on validation / DTO machinery. Callers fire-and-
 * forget — never await, never block the request.
 *
 * Delivery contract for receivers:
 *   POST <url>
 *   Headers:
 *     Content-Type: application/json
 *     User-Agent: VenueOS-Webhook/1.0
 *     X-VenueOS-Event: <event-type>
 *     X-VenueOS-Delivery-Id: <uuid>
 *     X-VenueOS-Timestamp: <unix-ms>
 *     X-VenueOS-Signature: sha256=<hex>
 *   Body:
 *     { tenantId, event, timestamp, data: <event-payload> }
 *
 * Signature = HMAC-SHA256(signingSecret, `${timestamp}.${body}`)
 * which the receiver verifies in constant time. Same envelope shape
 * Stripe / GitHub webhooks use.
 *
 * Retry (Audit P1-5, 2026-05-28). Every delivery now writes a durable
 * `WebhookDelivery` row. A receiver that is down during a lockdown no
 * longer loses `emergency.triggered` permanently:
 *   - Each fire creates a delivery row (status=PENDING) carrying the
 *     EXACT signed body + signed timestamp, so a retry reproduces a
 *     byte-identical payload AND signature.
 *   - First POST happens inline (fire-and-forget on the next tick).
 *   - On a 2xx → row flips to DELIVERED.
 *   - On non-2xx / timeout / network error → the row is scheduled for
 *     the next attempt (nextRetryAt = now + backoff). WebhookRetryWorker
 *     picks it up. After max attempts the row flips to FAILED and a
 *     warning is logged.
 *   - lastDelivery* on the TenantWebhook row is still stamped so the
 *     existing operator UI keeps showing per-webhook health.
 *
 * The retry POST itself lives in `attemptDelivery`, shared by the first
 * send here and by WebhookRetryWorker, so the wire format is identical
 * on every attempt.
 */

/** Backoff schedule in ms for attempts 1, 2, 3 (after the initial send). */
export const WEBHOOK_RETRY_BACKOFF_MS = [5_000, 30_000, 120_000];
/** Total attempts including the first inline send = 1 + backoff steps. */
export const WEBHOOK_MAX_ATTEMPTS = 1 + WEBHOOK_RETRY_BACKOFF_MS.length;

/** Shape of a single delivery attempt's HTTP outcome. */
export interface DeliveryOutcome {
  ok: boolean;
  status: number | null;
  errorMessage: string | null;
}

@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);

  /**
   * In-process listeners notified the moment a delivery is ARMED for retry
   * (`status = PENDING` with a `nextRetryAt`). WebhookRetryWorker subscribes
   * so it can drop its idle backoff back to the base cadence immediately —
   * see the backoff comment in webhook-retry.worker.ts. Purely local: a
   * missed signal only costs pickup latency (bounded by the idle ceiling),
   * never a lost delivery, because the durable row is the source of truth.
   */
  private readonly retryListeners = new Set<() => void>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Subscribe to "a retry was just enqueued". Returns an unsubscribe fn.
   * Never throws into the caller — a listener that throws is swallowed.
   */
  onRetryScheduled(listener: () => void): () => void {
    this.retryListeners.add(listener);
    return () => {
      this.retryListeners.delete(listener);
    };
  }

  private signalRetryScheduled(): void {
    for (const listener of this.retryListeners) {
      try {
        listener();
      } catch {
        /* a broken listener must never affect delivery */
      }
    }
  }

  /**
   * Compute the next-retry timestamp for a row that just failed its
   * `attempts`-th attempt, or null if attempts are exhausted (caller
   * then flips status to FAILED). `attempts` is the post-increment count
   * (i.e. how many tries have now happened). Exposed for the worker +
   * unit tests.
   */
  static nextRetryDelayMs(attempts: number): number | null {
    // attempts=1 → first retry uses backoff[0]; attempts=N → backoff[N-1].
    const idx = attempts - 1;
    if (idx < 0 || idx >= WEBHOOK_RETRY_BACKOFF_MS.length) return null;
    return WEBHOOK_RETRY_BACKOFF_MS[idx];
  }

  /**
   * Fire an event to every active webhook for a tenant that subscribed
   * to this event type. Returns immediately; the actual HTTP POSTs run
   * fire-and-forget on the next event-loop tick so the caller's
   * request path stays fast.
   */
  dispatch(tenantId: string, event: string, data: Record<string, unknown>): void {
    // Schedule on the next tick so the calling endpoint can return its
    // response without waiting for the webhook POSTs.
    setImmediate(() => {
      this.dispatchInner(tenantId, event, data).catch((err) => {
        this.logger.warn(
          `dispatch failed for ${event} on tenant ${tenantId}: ${err?.message ?? err}`,
        );
      });
    });
  }

  private async dispatchInner(
    tenantId: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const rows = await this.prisma.client.tenantWebhook.findMany({
      where: { tenantId, isActive: true },
    });
    if (rows.length === 0) return;

    const subscribers = rows.filter((r) => {
      try {
        const events = JSON.parse(r.events || '[]') as string[];
        return Array.isArray(events) && events.includes(event);
      } catch {
        return false;
      }
    });
    if (subscribers.length === 0) return;

    const timestamp = Date.now();
    const payload = { tenantId, event, timestamp, data };
    const body = JSON.stringify(payload);

    // Parallel deliveries — bounded by typical N=1-3 webhooks per tenant.
    await Promise.all(
      subscribers.map((row) =>
        this.deliverFirst(
          { id: row.id, url: row.url, signingSecret: row.signingSecret },
          tenantId,
          body,
          event,
          timestamp,
        ),
      ),
    );
  }

  /**
   * First delivery of a fresh event: persist a durable WebhookDelivery
   * row, POST once, then either mark DELIVERED or schedule the first
   * retry. Always stamps lastDelivery* on the webhook row for the
   * existing operator UI.
   */
  private async deliverFirst(
    row: { id: string; url: string; signingSecret: string },
    tenantId: string,
    body: string,
    event: string,
    timestamp: number,
  ): Promise<void> {
    // Create the durable delivery record up front so a crash between the
    // POST and the status write still leaves a row the worker can retry.
    let deliveryRowId: string | null = null;
    try {
      const created = await this.prisma.client.webhookDelivery.create({
        data: {
          webhookId: row.id,
          tenantId,
          event,
          body,
          signedTimestamp: BigInt(timestamp),
          status: 'PENDING',
          attempts: 0,
        },
        select: { id: true },
      });
      deliveryRowId = created.id;
    } catch (err: any) {
      // If we can't persist the delivery row we can't retry it durably.
      // Fall back to a best-effort single POST so behavior never regresses
      // below the pre-retry world.
      this.logger.warn(
        `failed to persist delivery row for ${row.id}: ${err?.message ?? err} — single-shot POST only`,
      );
    }

    const outcome = await this.attemptDelivery(row, body, event, timestamp);
    await this.recordWebhookHealth(row.id, timestamp, outcome);

    if (deliveryRowId) {
      await this.applyOutcome(deliveryRowId, 1, outcome);
    }
  }

  /**
   * Perform ONE signed HTTP POST. Pure transport — no DB writes — so it
   * is shared verbatim by the first send and by WebhookRetryWorker. The
   * signature is recomputed from the persisted `signedTimestamp` + body
   * so every attempt is byte-identical on the wire.
   */
  async attemptDelivery(
    row: { id: string; url: string; signingSecret: string },
    body: string,
    event: string,
    signedTimestamp: number,
  ): Promise<DeliveryOutcome> {
    const signature = createHmac('sha256', row.signingSecret)
      .update(`${signedTimestamp}.${body}`)
      .digest('hex');
    const deliveryId =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `dlv_${signedTimestamp}_${Math.random().toString(36).slice(2, 10)}`;

    let status: number | null = null;
    let errorMessage: string | null = null;

    try {
      // SSRF: route every POST (first send AND every retry) through
      // safeFetchPost — it re-resolves the host and connect-pins the socket
      // on THIS attempt, so a webhook url whose DNS later flips to an
      // internal/metadata IP (169.254.169.254, 10/8, ::1, …) is rejected at
      // delivery time, not just at create time. (Audit task #58 / 35-SSRF.)
      const res = await safeFetchPost(row.url, {
        body,
        timeoutMs: 8000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'VenueOS-Webhook/1.0',
          'X-VenueOS-Event': event,
          'X-VenueOS-Delivery-Id': deliveryId,
          'X-VenueOS-Timestamp': String(signedTimestamp),
          'X-VenueOS-Signature': `sha256=${signature}`,
        },
      });
      status = res.status;
      if (status < 200 || status >= 300) {
        // ANTI-EXFIL: never reflect the receiver's response body into a
        // field the operator can read (lastError / lastDeliveryError surface
        // in GET /webhooks). A hostile url could otherwise echo an internal
        // service's response back to a customer admin. Store a generic
        // status only. (Audit 35-SSRF response-body exfil twist.)
        errorMessage = `HTTP ${status}`;
      }
    } catch (err: any) {
      // SSRF rejection, timeout, or transport error. Crucially we record a
      // generic reason — for an SsrfError we deliberately do NOT echo the
      // resolved private IP back to the operator (info-leak), just that the
      // destination was refused.
      if (err instanceof SsrfError) {
        errorMessage = 'destination refused (not publicly reachable)';
      } else {
        errorMessage = 'delivery failed';
      }
      this.logger.warn(`webhook ${row.id} delivery failed: ${err?.message ?? err}`);
    }

    return { ok: status !== null && status >= 200 && status < 300, status, errorMessage };
  }

  /**
   * Apply a delivery outcome to a WebhookDelivery row.
   * `attempts` is the number of tries that have now happened (1-based).
   *   - success → status=DELIVERED, nextRetryAt cleared.
   *   - failure with attempts remaining → status stays PENDING,
   *     nextRetryAt = now + backoff(attempts).
   *   - failure with no attempts left → status=FAILED (give up).
   * Shared by the first send and the worker.
   */
  async applyOutcome(
    deliveryRowId: string,
    attempts: number,
    outcome: DeliveryOutcome,
  ): Promise<void> {
    let data: Record<string, unknown>;
    /** True when this write ARMS the row for another attempt (worker work). */
    let armedForRetry = false;
    if (outcome.ok) {
      data = {
        status: 'DELIVERED',
        attempts,
        nextRetryAt: null,
        lastStatusCode: outcome.status,
        lastError: null,
      };
    } else {
      const delay = WebhookDispatchService.nextRetryDelayMs(attempts);
      if (delay === null) {
        data = {
          status: 'FAILED',
          attempts,
          nextRetryAt: null,
          lastStatusCode: outcome.status,
          lastError: outcome.errorMessage,
        };
        this.logger.warn(
          `webhook delivery ${deliveryRowId} permanently failed after ${attempts} attempts: ${outcome.errorMessage ?? 'unknown error'}`,
        );
      } else {
        data = {
          status: 'PENDING',
          attempts,
          nextRetryAt: new Date(Date.now() + delay),
          lastStatusCode: outcome.status,
          lastError: outcome.errorMessage,
        };
        armedForRetry = true;
      }
    }
    try {
      // ten-ok: background dispatcher — no request actor, no caller tenant. `deliveryRowId`
      // is the id of the WebhookDelivery row this same method created a few lines above
      // for this one send; it never comes from a request.
      await this.prisma.client.webhookDelivery.update({ where: { id: deliveryRowId }, data });
      // Only after the row is actually armed: wake the retry worker out of
      // its idle backoff so a failed `emergency.triggered` is retried on the
      // tight cadence, not on whatever idle interval the worker had drifted
      // out to. Signalling BEFORE the write would race the worker's own
      // "is there work?" probe.
      if (armedForRetry) this.signalRetryScheduled();
    } catch (err: any) {
      this.logger.warn(
        `failed to update delivery row ${deliveryRowId}: ${err?.message ?? err}`,
      );
    }
  }

  /**
   * Stamp lastDelivery* on the TenantWebhook row so the existing
   * operator UI keeps reflecting per-webhook health. Non-fatal on error.
   */
  private async recordWebhookHealth(
    webhookId: string,
    timestamp: number,
    outcome: DeliveryOutcome,
  ): Promise<void> {
    try {
      // ten-ok: background dispatcher — `webhookId` is the TenantWebhook row the dispatcher
      // itself selected for this delivery, and the write stamps only that row's own
      // last-delivery health fields. No request actor, so no caller tenant to scope by.
      await this.prisma.client.tenantWebhook.update({
        where: { id: webhookId },
        data: {
          lastDeliveryAt: new Date(timestamp),
          lastDeliveryStatus: outcome.status,
          lastDeliveryError: outcome.errorMessage,
        },
      });
    } catch (err: any) {
      // Persistence failure is non-fatal — the delivery itself
      // already happened (or didn't). Log and move on.
      this.logger.warn(`failed to record delivery status for ${webhookId}: ${err?.message ?? err}`);
    }
  }
}
