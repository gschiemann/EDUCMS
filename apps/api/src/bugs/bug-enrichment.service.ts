/**
 * BugEnrichmentService — builds the BugServerContext that gets stored
 * on Bug.serverContext at insert time.
 *
 * Called synchronously by BugsController.create() BEFORE the row goes
 * in, so the AI analyzer never has to round-trip the DB for context —
 * the bundle the analyzer sees is the bundle the operator filed +
 * everything the server knew about the reporter / tenant / infra at
 * that moment.
 *
 * Output shape is defined in @cms/api-types/bugs.ts as
 * BugServerContext. Every field is JSON-serializable so it lands
 * cleanly into the Bug.serverContext (Json) column.
 *
 * Failure mode: every individual lookup is wrapped — a degraded DB
 * pool / Redis blip during enrichment must NEVER block a bug from
 * being filed (that's the worst possible time to lose a bug report).
 * Anything that throws is logged + the corresponding field comes back
 * null/empty.
 */

import { Injectable, Logger } from '@nestjs/common';
import type {
  BugAuditSnapshot,
  BugServerContext,
} from '@cms/api-types';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';

// Cap on detail-string size we store from any single AuditLog row.
// Matches the contract comment ("First ~500 chars of details JSON").
const AUDIT_DETAILS_CHAR_CAP = 500;

// How many recent rows to pull per scope. The contract says "Last N".
const AUDIT_HISTORY_LIMIT = 30;

@Injectable()
export class BugEnrichmentService {
  private readonly logger = new Logger(BugEnrichmentService.name);
  // Captured at service-construction time so /api/v1/bugs gets a
  // monotonically-meaningful "API uptime" without doing any work.
  // Matches the pattern HealthController uses.
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Build a BugServerContext for a given reporter. Both arguments are
   * nullable because:
   *   - The capture bundle ALWAYS carries reporter.userId/tenantId
   *     from the JWT, but a future "anonymous bug" path (e.g. a
   *     pre-login page hit) could land here without one.
   *   - Tenant is nullable in the Bug schema (Bug.tenantId is `String?`)
   *     so SUPER_ADMIN bugs aren't forced to invent a tenant id.
   */
  async build(opts: {
    reporterUserId: string | null;
    tenantId: string | null;
  }): Promise<BugServerContext> {
    const serverTs = Date.now();
    const apiCommitSha =
      process.env.GIT_COMMIT_SHA ||
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      'dev';
    const apiUptimeSec = Math.floor((Date.now() - this.startedAt) / 1000);

    // Run every lookup in parallel. A slow infra check shouldn't
    // delay an audit query that doesn't need it. Promise.allSettled
    // so one failure can't drop the whole enrichment.
    const [reporterLog, tenantLog, infra, license] = await Promise.all([
      this.fetchAuditFor(opts.reporterUserId),
      this.fetchTenantAuditExcluding(opts.tenantId, opts.reporterUserId),
      this.checkInfra(),
      this.fetchLicense(opts.tenantId),
    ]);

    const ctx: BugServerContext = {
      v: 1,
      serverTs,
      reporterAuditLog: reporterLog,
      tenantAuditLog: tenantLog,
      apiCommitSha,
      apiUptimeSec,
      infraHealth: infra,
    };
    if (license) ctx.license = license;
    return ctx;
  }

  /** Last N AuditLog rows where userId = reporter. */
  private async fetchAuditFor(
    userId: string | null,
  ): Promise<BugAuditSnapshot[]> {
    if (!userId) return [];
    try {
      const rows = await this.prisma.client.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: AUDIT_HISTORY_LIMIT,
        select: {
          createdAt: true,
          action: true,
          targetType: true,
          targetId: true,
          details: true,
          userId: true,
        },
      });
      return rows.map((r) => this.toSnapshot(r));
    } catch (e: any) {
      this.logger.warn(`reporter audit fetch failed: ${e?.message ?? e}`);
      return [];
    }
  }

  /**
   * Last N AuditLog rows for the tenant EXCLUDING the reporter's own
   * rows (those are already in reporterAuditLog — duplicating wastes
   * AI context window).
   */
  private async fetchTenantAuditExcluding(
    tenantId: string | null,
    excludeUserId: string | null,
  ): Promise<BugAuditSnapshot[]> {
    if (!tenantId) return [];
    try {
      const rows = await this.prisma.client.auditLog.findMany({
        where: {
          tenantId,
          ...(excludeUserId ? { NOT: { userId: excludeUserId } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: AUDIT_HISTORY_LIMIT,
        select: {
          createdAt: true,
          action: true,
          targetType: true,
          targetId: true,
          details: true,
          userId: true,
        },
      });
      return rows.map((r) => this.toSnapshot(r));
    } catch (e: any) {
      this.logger.warn(`tenant audit fetch failed: ${e?.message ?? e}`);
      return [];
    }
  }

  /** Lightweight DB ping (400ms budget — same as /health). */
  private async pingDb(): Promise<'ok' | 'degraded' | 'down'> {
    try {
      await Promise.race([
        this.prisma.client.$queryRaw`SELECT 1`,
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('db ping timeout')), 400),
        ),
      ]);
      return 'ok';
    } catch {
      // We don't separately classify down vs degraded here — the
      // distinction is whether the publisher object exists at all,
      // which doesn't apply to Prisma. Treat all DB ping failures
      // as 'degraded' so the AI knows the DB was iffy without
      // overclaiming "the DB is down" from a single missed ping.
      return 'degraded';
    }
  }

  /** Redis status mirroring the health-controller logic. */
  private redisStatus(): 'ok' | 'degraded' | 'down' {
    const pub = this.redis.publisher;
    if (!pub) return 'down';
    // ioredis publishes a 'status' string that's 'ready' when usable.
    // Treat anything else as 'degraded' (could be 'connecting' /
    // 'reconnecting' / 'end' / 'wait'). Distinguishing 'down' from
    // 'degraded' would require an actual PING; we skip it on the bug
    // path because the bug filing has to be fast and Redis health
    // is already in the audit log if there was a real outage.
    return pub.status === 'ready' ? 'ok' : 'degraded';
  }

  private async checkInfra(): Promise<BugServerContext['infraHealth']> {
    const [db, redis] = await Promise.all([
      this.pingDb(),
      Promise.resolve(this.redisStatus()),
    ]);
    return { db, redis };
  }

  /** Tenant's current license — null when tenant is null or has no row. */
  private async fetchLicense(
    tenantId: string | null,
  ): Promise<BugServerContext['license'] | null> {
    if (!tenantId) return null;
    try {
      const lic = await this.prisma.client.license.findUnique({
        where: { tenantId },
        select: {
          tier: true,
          seatLimit: true,
          expiresAt: true,
        },
      });
      if (!lic) return null;
      // currentSeats is a derived value — count the active screens for
      // this tenant. Bounded query; if it times out / errors we still
      // return the tier + seatLimit snapshot without it. The Bug AI
      // mostly cares about tier; the seat count is for billing-flavor
      // bugs ("I'm pinned at limit and can't add a screen").
      let currentSeats: number | null = null;
      try {
        currentSeats = await this.prisma.client.screen.count({
          where: { tenantId },
        });
      } catch (e: any) {
        this.logger.debug(`license seat count failed: ${e?.message ?? e}`);
      }
      return {
        tier: lic.tier,
        seatLimit: lic.seatLimit,
        currentSeats,
        expiresAt: lic.expiresAt ? lic.expiresAt.toISOString() : null,
      };
    } catch (e: any) {
      this.logger.warn(`license lookup failed: ${e?.message ?? e}`);
      return null;
    }
  }

  /** Compact a raw AuditLog row into a BugAuditSnapshot. */
  private toSnapshot(row: {
    createdAt: Date;
    action: string;
    // AuditLog.targetType is non-null in the schema, but the
    // contract widens this to nullable so older / cross-DB rows
    // still serialize cleanly. The select above always returns a
    // string in practice.
    targetType: string;
    targetId: string | null;
    details: string | null;
    userId: string | null;
  }): BugAuditSnapshot {
    let details: string | null = null;
    if (row.details) {
      details =
        row.details.length > AUDIT_DETAILS_CHAR_CAP
          ? row.details.slice(0, AUDIT_DETAILS_CHAR_CAP) + '…'
          : row.details;
    }
    return {
      ts: row.createdAt.toISOString(),
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      details,
      userId: row.userId,
    };
  }
}
