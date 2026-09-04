import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { validatePublicUrl, SsrfError } from '../branding/safe-fetch';

/**
 * Tenant-scoped outbound webhooks (Developer area, 2026-05-25).
 *
 * Manages CRUD on the TenantWebhook table. Delivery itself lives in
 * WebhookDispatchService — separated so the dispatch path doesn't pull
 * in BadRequestException / DTO validation overhead on every event.
 *
 * Event types the platform currently emits (more added over time):
 *   - emergency.triggered
 *   - emergency.cleared
 *
 * Future:
 *   - screen.online / screen.offline (off-line scanner already detects)
 *   - playlist.published / playlist.deleted
 *   - ota.completed / ota.failed
 *   - asset.uploaded
 */
@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Whitelist of event types webhooks may subscribe to. Reject
   *  unknown event names at create-time so the operator never quietly
   *  subscribes to an event that never fires. */
  static ALLOWED_EVENTS: readonly string[] = [
    'emergency.triggered',
    'emergency.cleared',
  ];

  async list(tenantId: string) {
    const rows = await this.prisma.client.tenantWebhook.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        url: true,
        events: true,
        isActive: true,
        lastDeliveryAt: true,
        lastDeliveryStatus: true,
        lastDeliveryError: true,
        createdAt: true,
        createdByUserId: true,
      },
    });
    return rows.map((r) => ({ ...r, events: this.parseEvents(r.events) }));
  }

  async create(opts: {
    tenantId: string;
    name: string;
    url: string;
    events: string[];
    actorUserId: string | null;
  }): Promise<{ id: string; signingSecret: string }> {
    const name = (opts.name || '').trim();
    if (!name) throw new BadRequestException('Name is required.');
    if (name.length > 80) throw new BadRequestException('Name must be 80 characters or fewer.');

    const url = (opts.url || '').trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Webhook URL is not a valid URL.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new BadRequestException('Webhook URL must use http or https.');
    }
    // Belt-and-suspenders SSRF gate (Audit 35-SSRF FIX 2): the real defense
    // is the connect-time pin in WebhookDispatchService.attemptDelivery →
    // safeFetchPost, but reject obviously-internal targets at create time too
    // so they never get stored. validatePublicUrl blocks non-http(s) schemes,
    // non-80/443 ports, and private/loopback/link-local/metadata IP LITERALS
    // (169.254.169.254, 10/8, 192.168/16, 172.16/12, ::1, IPv4-mapped, CGNAT).
    // Runs in ALL envs now — the old check was prod-only AND only matched the
    // literal strings localhost/127.0.0.1/.local.
    try {
      validatePublicUrl(url);
    } catch (e) {
      if (e instanceof SsrfError) {
        throw new BadRequestException(
          'Webhook URL must be a publicly reachable http(s) endpoint on port 80/443 (private, loopback, link-local, and metadata addresses are blocked).',
        );
      }
      throw new BadRequestException('Webhook URL is not a valid URL.');
    }
    // Block localhost / *.local hostnames (DNS names, which the IP-literal
    // check above can't catch). The connect-time pin in delivery still covers
    // any other name that resolves to a private range.
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === 'localhost.localdomain' || host.endsWith('.local')) {
      throw new BadRequestException(
        'Webhook URL must be publicly reachable (localhost / .local blocked).',
      );
    }

    if (!Array.isArray(opts.events) || opts.events.length === 0) {
      throw new BadRequestException('Subscribe to at least one event.');
    }
    const events = opts.events.map((e) => String(e).trim());
    for (const e of events) {
      if (!WebhooksService.ALLOWED_EVENTS.includes(e)) {
        throw new BadRequestException(
          `Unknown event: ${e}. Allowed: ${WebhooksService.ALLOWED_EVENTS.join(', ')}`,
        );
      }
    }

    // 32 random bytes = 256 bits. HMAC-SHA256 signing secret.
    const signingSecret = `whsec_${randomBytes(32).toString('hex')}`;

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.tenantWebhook.create({
        data: {
          tenantId: opts.tenantId,
          name,
          url,
          events: JSON.stringify(events),
          signingSecret,
          createdByUserId: opts.actorUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: opts.tenantId,
          userId: opts.actorUserId,
          action: 'WEBHOOK_CREATED',
          targetType: 'TenantWebhook',
          targetId: row.id,
          details: JSON.stringify({ name: row.name, url: row.url, events }),
        },
      });
      return row;
    });

    // Surface the signing secret ONCE — caller is expected to render
    // it in a copy-to-clipboard banner immediately. Subsequent list()
    // calls never return it.
    return { id: created.id, signingSecret };
  }

  async remove(opts: { tenantId: string; id: string; actorUserId: string | null }) {
    const row = await this.prisma.client.tenantWebhook.findFirst({
      where: { id: opts.id, tenantId: opts.tenantId },
    });
    if (!row) throw new NotFoundException('Webhook not found.');
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.tenantWebhook.delete({ where: { id: row.id, tenantId: opts.tenantId } });
      await tx.auditLog.create({
        data: {
          tenantId: opts.tenantId,
          userId: opts.actorUserId,
          action: 'WEBHOOK_DELETED',
          targetType: 'TenantWebhook',
          targetId: row.id,
          details: JSON.stringify({ name: row.name, url: row.url }),
        },
      });
    });
    return { ok: true };
  }

  private parseEvents(raw: string): string[] {
    try {
      const v = JSON.parse(raw || '[]');
      return Array.isArray(v) ? v.map((s) => String(s)) : [];
    } catch {
      return [];
    }
  }
}
