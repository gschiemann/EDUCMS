import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationKind =
  | 'SCREEN_OFFLINE'
  | 'SYNC_FAILED'
  | 'EMERGENCY_TRIGGERED'
  | 'INVITE_ACCEPTED'
  | 'INFO'
  // Sprint 11 Phase B — cohort outage detection. Fires ONCE per
  // tenant per 5-min bucket when >50% of paired screens drop in
  // <90 s — almost always a WAN cut, ISP issue, or building power
  // event rather than a per-screen problem. We deliberately
  // SUPPRESS the per-screen SCREEN_OFFLINE notifications for the
  // affected tenant during the window so the operator sees one
  // signal, not fifty.
  | 'INFRA_EVENT';

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
   * Sprint 11 Phase B — cohort outage detection. Before firing per-
   * screen notifications, classify each affected tenant:
   *
   *   - If >= COHORT_PCT of the tenant's paired fleet crossed the
   *     offline threshold within the last COHORT_WINDOW_S seconds
   *     (default 50% and 90 s), treat it as an "infrastructure
   *     event" (WAN cut, ISP outage, building power) and emit ONE
   *     INFRA_EVENT notification per tenant per 5-min bucket.
   *     Per-screen SCREEN_OFFLINE notifications are SUPPRESSED for
   *     screens belonging to that tenant during the scan.
   *
   *   - Otherwise: per-screen notifications fire as before.
   *
   * The COHORT_MIN_FLEET threshold (default 3) prevents 2-screen
   * tenants from accidentally triggering infra-event mode every
   * time one screen reboots.
   *
   * Returns counts so the wrapping scanner can log scan health.
   */
  async scanOfflineScreens(
    thresholdMinutes = 5,
  ): Promise<{ found: number; notified: number; infraEvents: number }> {
    const COHORT_WINDOW_S = Number(process.env.COHORT_OUTAGE_WINDOW_S) || 90;
    const COHORT_PCT = Number(process.env.COHORT_OUTAGE_PCT) || 0.5;
    const COHORT_MIN_FLEET = Number(process.env.COHORT_OUTAGE_MIN_FLEET) || 3;

    const now = Date.now();
    const offlineCutoff = new Date(now - thresholdMinutes * 60_000);
    // A "recently dropped" screen is one whose lastPingAt is within
    // the cohort window BEFORE the offline cutoff — i.e. it just
    // crossed into offline territory in the last COHORT_WINDOW_S
    // seconds. (A screen offline for hours doesn't count toward an
    // infra event; only sudden drops do.)
    const recentDropCutoff = new Date(now - thresholdMinutes * 60_000 - COHORT_WINDOW_S * 1000);

    const offlineScreens = await this.prisma.client.screen.findMany({
      where: {
        tenantId: { not: null },
        status: { not: 'REVOKED' },
        lastPingAt: { lt: offlineCutoff },
      },
      select: { id: true, name: true, tenantId: true, lastPingAt: true },
    });

    // Affected tenants — only ones with at least one offline screen
    // matter for the size lookup.
    const affectedTenantIds = Array.from(
      new Set(offlineScreens.map((s) => s.tenantId).filter((t): t is string => !!t)),
    );

    // Tenant-fleet sizes (paired, non-revoked) for the affected set.
    // groupBy returns one row per tenant; flatten to a Map for O(1)
    // lookup below.
    const fleetSizeRows = affectedTenantIds.length
      ? await this.prisma.client.screen.groupBy({
          by: ['tenantId'],
          where: {
            tenantId: { in: affectedTenantIds as any },
            status: { not: 'REVOKED' },
          },
          _count: { _all: true },
        })
      : [];
    const fleetSize = new Map<string, number>();
    for (const row of fleetSizeRows as any[]) {
      if (row.tenantId) fleetSize.set(row.tenantId, row._count?._all ?? 0);
    }

    // Per-tenant: how many of the offline screens crossed the
    // threshold inside the cohort window?
    const recentlyDroppedByTenant = new Map<string, typeof offlineScreens>();
    for (const s of offlineScreens) {
      if (!s.tenantId || !s.lastPingAt) continue;
      if (s.lastPingAt >= recentDropCutoff) {
        const arr = recentlyDroppedByTenant.get(s.tenantId) ?? [];
        arr.push(s);
        recentlyDroppedByTenant.set(s.tenantId, arr);
      }
    }

    // Classify each tenant.
    const infraEventTenants = new Set<string>();
    for (const [tenantId, dropped] of recentlyDroppedByTenant.entries()) {
      const total = fleetSize.get(tenantId) ?? 0;
      if (total < COHORT_MIN_FLEET) continue;
      if (dropped.length / total >= COHORT_PCT) {
        infraEventTenants.add(tenantId);
      }
    }

    // Emit per-screen notifications for tenants NOT flagged as infra
    // events. Same dedupe key as before so existing scan cadence
    // doesn't double-fire.
    // Audit P1 (N+1): previously this looped `await this.notify()` per
    // offline screen — one upsert round-trip each, serialized through the
    // connection_limit=10 pool DURING an outage (exactly when the DB is most
    // stressed). A 40%-partial drop on a 500-screen district = ~200 serial
    // upserts every 60s. The (tenantId, dedupeKey) unique constraint lets us
    // collapse that to a single createMany({ skipDuplicates }): the DB drops
    // the already-seen buckets, so behavior (one row per dedupeKey) is
    // identical — just one round-trip instead of N.
    const offlineRows = offlineScreens
      .filter((s) => s.tenantId && !infraEventTenants.has(s.tenantId))
      .map((screen) => {
        const bucket = Math.floor((screen.lastPingAt?.getTime() ?? now) / (60 * 60 * 1000));
        return {
          tenantId: screen.tenantId as string,
          kind: 'SCREEN_OFFLINE',
          title: `Screen offline: ${screen.name}`,
          body: `No heartbeat since ${screen.lastPingAt?.toISOString() ?? 'unknown'}.`,
          link: `/screens`,
          dedupeKey: `screen-offline:${screen.id}:${bucket}`,
        };
      });
    let notified = 0;
    if (offlineRows.length) {
      try {
        const res = await this.prisma.client.notification.createMany({
          data: offlineRows,
          skipDuplicates: true,
        });
        notified = res.count;
      } catch (err: any) {
        this.logger.warn(`[scanOfflineScreens] batch notify failed: ${err?.message ?? err}`);
      }
    }

    // One aggregated notification per infra-event tenant per 5-min
    // bucket so a sustained outage doesn't re-page every minute.
    let infraEvents = 0;
    const fiveMinBucket = Math.floor(now / (5 * 60_000));
    for (const tenantId of infraEventTenants) {
      const dropped = recentlyDroppedByTenant.get(tenantId)!;
      const total = fleetSize.get(tenantId) ?? 0;
      const dedupeKey = `infra-event:${tenantId}:${fiveMinBucket}`;
      const result = await this.notify({
        tenantId,
        kind: 'INFRA_EVENT',
        title: `Possible infrastructure event — ${dropped.length}/${total} screens dropped`,
        body:
          `${dropped.length} screens went offline within ${COHORT_WINDOW_S} s ` +
          `(>${Math.round(COHORT_PCT * 100)}% of fleet). ` +
          `Likely WAN, ISP, or local power event — per-screen alerts suppressed. ` +
          `Affected: ${dropped.slice(0, 5).map((s) => s.name).join(', ')}${dropped.length > 5 ? '…' : ''}.`,
        link: `/screens`,
        dedupeKey,
      });
      if (result) infraEvents++;
    }

    if (infraEventTenants.size > 0) {
      this.logger.log(
        `[cohort-outage] tenants=${infraEventTenants.size} ` +
        `suppressed-per-screen=${offlineScreens.filter((s) => s.tenantId && infraEventTenants.has(s.tenantId)).length}`,
      );
    }
    return { found: offlineScreens.length, notified, infraEvents };
  }
}
