import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationKind =
  | 'SCREEN_OFFLINE'
  | 'SYNC_FAILED'
  | 'EMERGENCY_TRIGGERED'
  | 'INVITE_ACCEPTED'
  | 'INFO';

export interface NotifyInput {
  tenantId: string;
  userId?: string | null;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  /** Optional dedupe key unique per tenant. Prevents duplicate notifications for the same underlying event. */
  dedupeKey?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a notification. If `dedupeKey` is provided and a row already exists
   * with the same (tenantId, dedupeKey), it is returned unchanged (no duplicate).
   */
  async notify(input: NotifyInput) {
    try {
      // Audit fix #11: previously findUnique→create wasn't atomic, so
      // two concurrent emitters with the same dedupeKey could both pass
      // the existence check and the second create would crash on the
      // unique constraint violation. Switch to upsert: the database
      // enforces atomicity and we get the existing row back when it
      // matches. When no dedupeKey is given we keep the plain create
      // (no constraint to upsert against).
      if (input.dedupeKey) {
        return await this.prisma.client.notification.upsert({
          where: {
            tenantId_dedupeKey: { tenantId: input.tenantId, dedupeKey: input.dedupeKey },
          },
          create: {
            tenantId: input.tenantId,
            userId: input.userId ?? null,
            kind: input.kind,
            title: input.title,
            body: input.body ?? null,
            link: input.link ?? null,
            dedupeKey: input.dedupeKey,
          },
          // No-op update preserves the original notification verbatim
          // (matches the prior "return existing" behavior).
          update: {},
        });
      }
      return await this.prisma.client.notification.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          kind: input.kind,
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
          dedupeKey: null,
        },
      });
    } catch (err: any) {
      // Never let notification failures blow up the calling request.
      this.logger.warn(`[notify] failed: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * List notifications visible to a given user:
   * - Direct (userId === user.id)
   * - Tenant-wide (userId === null) for the user's tenant
   */
  async listForUser(params: { tenantId: string; userId: string; limit?: number }) {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    return this.prisma.client.notification.findMany({
      where: {
        tenantId: params.tenantId,
        OR: [{ userId: params.userId }, { userId: null }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async unreadCount(tenantId: string, userId: string): Promise<number> {
    return this.prisma.client.notification.count({
      where: {
        tenantId,
        isRead: false,
        OR: [{ userId }, { userId: null }],
      },
    });
  }

  async markRead(id: string, tenantId: string, userId: string) {
    // Only allow marking notifications the user can see.
    const n = await this.prisma.client.notification.findFirst({
      where: {
        id,
        tenantId,
        OR: [{ userId }, { userId: null }],
      },
    });
    if (!n) return { ok: false as const };
    await this.prisma.client.notification.update({
      where: { id },
      data: { isRead: true },
    });
    return { ok: true as const };
  }

  async markAllRead(tenantId: string, userId: string) {
    const res = await this.prisma.client.notification.updateMany({
      where: {
        tenantId,
        isRead: false,
        OR: [{ userId }, { userId: null }],
      },
      data: { isRead: true },
    });
    return { updated: res.count };
  }

  /**
   * Scan screens whose lastPingAt is older than `thresholdMinutes` and create
   * ONE offline notification per screen (deduped via key).
   *
   * Returns the number of notifications created or already-present.
   */
  async scanOfflineScreens(thresholdMinutes = 5): Promise<{ found: number; notified: number }> {
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    const screens = await this.prisma.client.screen.findMany({
      where: {
        tenantId: { not: null },
        status: { not: 'REVOKED' },
        lastPingAt: { lt: cutoff },
      },
      select: { id: true, name: true, tenantId: true, lastPingAt: true },
    });

    let notified = 0;
    for (const screen of screens) {
      if (!screen.tenantId) continue;
      // One notification per (screen, offline-hour-bucket) so admins eventually re-see stale ones.
      const bucket = Math.floor((screen.lastPingAt?.getTime() ?? Date.now()) / (60 * 60 * 1000));
      const dedupeKey = `screen-offline:${screen.id}:${bucket}`;
      const result = await this.notify({
        tenantId: screen.tenantId,
        kind: 'SCREEN_OFFLINE',
        title: `Screen offline: ${screen.name}`,
        body: `No heartbeat since ${screen.lastPingAt?.toISOString() ?? 'unknown'}.`,
        link: `/screens`,
        dedupeKey,
      });
      if (result) notified++;
    }
    return { found: screens.length, notified };
  }
}
