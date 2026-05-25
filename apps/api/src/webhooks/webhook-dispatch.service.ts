import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

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
 * No retry queue in this first cut. Failed deliveries record the
 * status + error on the TenantWebhook row so the operator can see in
 * the UI which webhook is broken. A retry worker ships in a follow-up.
 */
@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      subscribers.map((row) => this.deliverOne(row, body, event, timestamp)),
    );
  }

  private async deliverOne(
    row: { id: string; url: string; signingSecret: string },
    body: string,
    event: string,
    timestamp: number,
  ): Promise<void> {
    const signature = createHmac('sha256', row.signingSecret)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    const deliveryId =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `dlv_${timestamp}_${Math.random().toString(36).slice(2, 10)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    let status: number | null = null;
    let errorMessage: string | null = null;

    try {
      const res = await fetch(row.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'VenueOS-Webhook/1.0',
          'X-VenueOS-Event': event,
          'X-VenueOS-Delivery-Id': deliveryId,
          'X-VenueOS-Timestamp': String(timestamp),
          'X-VenueOS-Signature': `sha256=${signature}`,
        },
        body,
      });
      status = res.status;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        errorMessage = `${res.status} ${res.statusText}${text ? ' — ' + text.slice(0, 200) : ''}`;
      }
    } catch (err: any) {
      const msg = err?.name === 'AbortError'
        ? 'request timed out after 8s'
        : (err?.message || String(err));
      errorMessage = msg;
      this.logger.warn(`webhook ${row.id} → ${row.url} failed: ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    // Record last delivery result on the webhook row so the operator
    // can see in the UI which webhook is healthy vs failing.
    try {
      await this.prisma.client.tenantWebhook.update({
        where: { id: row.id },
        data: {
          lastDeliveryAt: new Date(timestamp),
          lastDeliveryStatus: status,
          lastDeliveryError: errorMessage,
        },
      });
    } catch (err: any) {
      // Persistence failure is non-fatal — the delivery itself
      // already happened (or didn't). Log and move on.
      this.logger.warn(`failed to record delivery status for ${row.id}: ${err?.message ?? err}`);
    }
  }
}
