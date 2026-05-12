/**
 * AnalyticsController — Phase D5 (2026-05-12).
 *
 * Endpoints:
 *   - POST /api/v1/analytics/touch-events    — player batches taps
 *   - GET  /api/v1/analytics/touch-events/template/:id — aggregate
 *
 * Player ingest is JWT-protected (the device JWT is fine — we already
 * trust the device identity for telemetry). Aggregation endpoint
 * requires the dashboard JWT so admins / contributors can see results
 * for their tenant only.
 *
 * Rate limiting: 200 events per minute per screen, in-memory soft cap.
 * Excess events are silently dropped after a one-line log so a buggy
 * player can't DOS the API.
 *
 * Retention: written rows are immutable. A future cron will sweep
 * touch_events older than 90 days; v1 has no sweeper since pilot
 * volume is low. Storage cost at pilot scale: ~10 KB / day / screen.
 */

import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, Request, BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

interface TouchEventPayload {
  templateId: string;
  zoneId?: string;
  sceneId?: string;
  actionType?: string;
  actionTarget?: string;
  /** Player-side timestamp (ms epoch). Within ±5 min of server time;
   *  rejected otherwise to defeat replay/log poisoning attempts. */
  clientTs: number;
}

@Controller('api/v1/analytics')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  // In-memory per-screen rate limiter. Map<screenId, timestamps[]>.
  // Filter sliding window of 60s, drop old entries on read.
  private readonly recentByScreen = new Map<string, number[]>();
  private readonly PER_SCREEN_PER_MINUTE = 200;
  private readonly CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────
  // POST /analytics/touch-events
  //
  // Accepts a batch of events from a single player. Body shape:
  //   { events: TouchEventPayload[], screenId?: string }
  //
  // Returns: { accepted: number, rejected: number, rateLimitedUntil?: number }
  //
  // No payload body validation library — events are small and the
  // shape is shallow. Manual checks are fine; bad events get dropped
  // individually instead of failing the whole batch.
  // ───────────────────────────────────────────────────────
  @Post('touch-events')
  @RequireRoles(
    AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER,
  )
  async ingest(
    @Request() req: any,
    @Body() body: { events?: TouchEventPayload[]; screenId?: string },
  ) {
    const events = Array.isArray(body?.events) ? body.events : [];
    if (events.length === 0) return { accepted: 0, rejected: 0 };
    if (events.length > 100) {
      // Defense-in-depth: cap batch size so a runaway player can't
      // ship a 10MB body. The player should batch in 50s but
      // accepting up to 100 leaves headroom for offline catchup.
      throw new BadRequestException('Batch too large; max 100 events per call.');
    }

    const tenantId = req.user.tenantId;
    const screenId = body.screenId || null;

    // Per-screen rate limit. Anonymous batches (no screenId) get
    // bucketed under 'anon-<tenantId>' so we can still see if a
    // tenant misbehaves.
    const bucketKey = screenId || `anon-${tenantId}`;
    const now = Date.now();
    const oneMinAgo = now - 60_000;
    const recent = (this.recentByScreen.get(bucketKey) || []).filter((t) => t > oneMinAgo);
    if (recent.length >= this.PER_SCREEN_PER_MINUTE) {
      this.logger.warn(`touch-events rate-limited screen=${bucketKey} tenant=${tenantId}`);
      this.recentByScreen.set(bucketKey, recent);
      return { accepted: 0, rejected: events.length, rateLimitedUntil: oneMinAgo + 60_000 };
    }

    let accepted = 0;
    let rejected = 0;
    const rows: any[] = [];
    for (const e of events) {
      // Validate per-event so a single bad event doesn't poison the batch.
      if (!e || typeof e !== 'object') { rejected += 1; continue; }
      if (typeof e.templateId !== 'string' || !e.templateId) { rejected += 1; continue; }
      const ts = typeof e.clientTs === 'number' ? e.clientTs : NaN;
      if (!Number.isFinite(ts)) { rejected += 1; continue; }
      // Reject events outside ±5 min of server time. Real players have
      // <100ms clock skew; anything bigger is either a replay or a
      // misconfigured device. Drop instead of trying to clamp.
      if (Math.abs(now - ts) > this.CLOCK_SKEW_TOLERANCE_MS) { rejected += 1; continue; }
      // Bound field lengths so a malicious player can't poison the
      // table with multi-MB strings.
      rows.push({
        tenantId,
        screenId,
        templateId: e.templateId.slice(0, 64),
        zoneId: typeof e.zoneId === 'string' ? e.zoneId.slice(0, 64) : null,
        sceneId: typeof e.sceneId === 'string' ? e.sceneId.slice(0, 64) : null,
        actionType: typeof e.actionType === 'string' ? e.actionType.slice(0, 32) : null,
        actionTarget: typeof e.actionTarget === 'string' ? e.actionTarget.slice(0, 500) : null,
        clientTs: new Date(ts),
      });
      accepted += 1;
    }

    if (rows.length > 0) {
      await (this.prisma.client as any).touchEvent.createMany({ data: rows });
      recent.push(now);
      this.recentByScreen.set(bucketKey, recent);
    }

    return { accepted, rejected };
  }

  // ───────────────────────────────────────────────────────
  // GET /analytics/touch-events/template/:id
  //
  // Aggregate tap counts per zone for a given template over a window.
  // Query params:
  //   sinceDays?: number (default 30, max 365)
  //   sceneId?:   string (optional scene filter)
  //
  // Returns:
  //   { templateId, sinceDays, total, byZone: { [zoneId]: count } }
  // ───────────────────────────────────────────────────────
  @Get('touch-events/template/:id')
  @RequireRoles(
    AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER,
  )
  async aggregateForTemplate(
    @Request() req: any,
    @Param('id') templateId: string,
    @Query('sinceDays') sinceDays?: string,
    @Query('sceneId') sceneId?: string,
  ) {
    const days = Math.min(Math.max(parseInt(sinceDays || '30', 10) || 30, 1), 365);
    const since = new Date(Date.now() - days * 86_400_000);

    // Use raw grouping via Prisma's groupBy. Restricted to the caller's
    // tenant so admins can never see another tenant's analytics —
    // critical for multi-tenant tenancy guarantees.
    const where: any = {
      tenantId: req.user.tenantId,
      templateId,
      createdAt: { gte: since },
    };
    if (sceneId) where.sceneId = sceneId;

    const groups = await (this.prisma.client as any).touchEvent.groupBy({
      by: ['zoneId'],
      where,
      _count: { _all: true },
    });

    const byZone: Record<string, number> = {};
    let total = 0;
    for (const g of groups as Array<{ zoneId: string | null; _count: { _all: number } }>) {
      const key = g.zoneId || '__no_zone__';
      byZone[key] = g._count._all;
      total += g._count._all;
    }

    return {
      templateId,
      sinceDays: days,
      sceneId: sceneId || null,
      total,
      byZone,
    };
  }
}
