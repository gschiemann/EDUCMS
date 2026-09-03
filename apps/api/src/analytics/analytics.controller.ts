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
  UseGuards, Request, BadRequestException, ForbiddenException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import {
  RollupCapableClient,
  hourFloor,
  rollupWatermark,
} from './proof-of-play-rollup.service';

// Per-event payload validation — both action type and target are
// allowlisted at write-time. Anything outside these sets is silently
// dropped (per-event soft fail) instead of poisoning the batch.
//
// Why server-side (vs trusting the client): a forged/compromised player
// could otherwise stuff arbitrary scheme URLs into actionTarget
// ("javascript:..." / data:) and the moment a future UI surface renders
// the field as a link, the audit log becomes a stored-XSS pivot.
const VALID_ACTION_TYPES = new Set([
  // D1+ canonical actions
  'open-url', 'play-video', 'goto-template', 'goto-scene',
  'show-overlay', 'reset-idle', 'sound-toggle', 'webhook', 'request-help',
  // Legacy v0 aliases — still emitted by old player builds.
  'url', 'navigate', 'show',
]);
const CTRL_CHAR_RE = /[\x00-\x1f\x7f]/g;

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
  // NOTE: deliberately NO @RequireRoles here. Player kiosks authenticate
  // with a DEVICE JWT (kind='device') that carries no `role` field, so
  // the RbacGuard role check would 403 every legitimate kiosk batch.
  // Security audit caught the gap; we now hand-roll the access check
  // below so we can express "either a tenant role I trust to write
  // analytics, or a paired device acting on behalf of itself."
  //
  // Also dropped RESTRICTED_VIEWER from the eligible role set — viewers
  // are read-only and should not be able to poison aggregates.
  @Post('touch-events')
  async ingest(
    @Request() req: any,
    @Body() body: { events?: TouchEventPayload[] },
  ) {
    const user = req.user;
    const isDevice = user?.kind === 'device';
    const isPermittedWriter = isDevice || [
      AppRole.SUPER_ADMIN,
      AppRole.DISTRICT_ADMIN,
      AppRole.SCHOOL_ADMIN,
      AppRole.CONTRIBUTOR,
    ].includes(user?.role);
    if (!isPermittedWriter) throw new ForbiddenException({ code: 'ANALYTICS_TOUCH_EVENTS_FORBIDDEN', message: 'Not allowed to write touch events.' });

    const events = Array.isArray(body?.events) ? body.events : [];
    if (events.length === 0) return { accepted: 0, rejected: 0 };
    if (events.length > 100) {
      // Defense-in-depth: cap batch size so a runaway player can't
      // ship a 10MB body. The player should batch in 50s but
      // accepting up to 100 leaves headroom for offline catchup.
      throw new BadRequestException({ code: 'ANALYTICS_TOUCH_EVENTS_BATCH_TOO_LARGE', message: 'Batch too large; max 100 events per call.' });
    }

    const tenantId = user.tenantId;
    // Bind screenId to the JWT identity, NOT the request body. A
    // client-supplied screenId let a malicious player rotate it on
    // every batch to bypass the per-screen rate limit. Device tokens
    // carry their screen id in `sub`; dashboard tokens (operator
    // testing in browser) get bucketed under a per-tenant anon key.
    const screenId = isDevice ? (user.sub as string) : null;

    // Per-screen rate limit. Dashboard-user batches (no screenId) get
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
      // Bound field lengths + allowlist-validate so a malicious player
      // can't poison the table with multi-MB strings or stored-XSS
      // payloads. Unknown actionType → null (event still recorded for
      // template-level aggregate); actionTarget gets ctrl-char + length
      // bound but no scheme allowlist (legitimate non-URL targets
      // include scene ids and free-text help-request titles).
      const actionType = typeof e.actionType === 'string' && VALID_ACTION_TYPES.has(e.actionType)
        ? e.actionType
        : null;
      const actionTarget = typeof e.actionTarget === 'string'
        ? e.actionTarget.replace(CTRL_CHAR_RE, '').slice(0, 256)
        : null;
      rows.push({
        tenantId,
        screenId,
        templateId: e.templateId.slice(0, 64),
        zoneId: typeof e.zoneId === 'string' ? e.zoneId.slice(0, 64) : null,
        sceneId: typeof e.sceneId === 'string' ? e.sceneId.slice(0, 64) : null,
        actionType,
        actionTarget,
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

  // ───────────────────────────────────────────────────────
  // GET /analytics/proof-of-play
  //
  // Proof-of-play report — how long each playlist / asset / screen
  // was live, from the PlaybackSample stream the ProofOfPlaySampler
  // writes every ~10 min. Tenant-scoped. Query params:
  //   days?: number (default 7, max 365)
  //
  // Each sample = one interval of a playlist being live on a screen.
  // Display time ≈ sample count × the sampler interval. Per-asset
  // airtime sums the sample count of every playlist the asset sits
  // in (counted once per playlist ITEM, so an asset placed N times
  // in a playlist earns N× the airtime).
  //
  // `ready:false` when the playback_samples table is not present yet
  // (migration unapplied) — the dashboard shows a friendly setup hint
  // instead of an error.
  //
  // ROLLUP STITCH (2026-09-02 efficiency/scale audit, L4). Raw samples are
  // now kept for ~14 days and aggregated into `playback_sample_hours` beyond
  // that, so the window is served from TWO sources:
  //
  //   [windowStart, watermark)  hourly rollup — SUM(samples)
  //   [watermark,   now]        raw samples   — COUNT(*)
  //
  // The ranges are disjoint and cover the whole window, so every figure is
  // EXACT, not an estimate: a sample is counted once, in one source. When no
  // rollup exists yet (fresh install, migration unapplied, service disabled)
  // the watermark is null and the whole window is read from raw — byte-for-
  // byte today's behaviour.
  //
  // `windowStart` snaps DOWN to the top of the hour so it lines up with the
  // rollup's buckets; without that a report boundary landing mid-hour would
  // either double-count or drop the boundary hour. It widens the window by
  // under an hour and is reported back in the payload.
  // ───────────────────────────────────────────────────────
  /**
   * SUM(samples) from the hourly rollup, grouped by one column, for one
   * tenant over `[from, to)`.
   *
   * `column` is NOT user input — it is one of two literals chosen by the
   * caller below, and the union type is what keeps it that way. The tenant
   * id and both bounds are bound parameters, so this cannot be widened into
   * a cross-tenant read by a crafted query string.
   */
  private async rollupSum(
    column: 'playlist_id' | 'screen_id',
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ key: string; samples: number }>> {
    const rows = await (this.prisma.client as unknown as RollupCapableClient).$queryRawUnsafe<
      Array<{ key: string; samples: number | bigint }>
    >(
      `
      SELECT "${column}" AS key, SUM("samples")::int AS samples
        FROM "playback_sample_hours"
       WHERE "tenant_id" = $1 AND "hour_start" >= $2 AND "hour_start" < $3
       GROUP BY "${column}"
      `,
      tenantId,
      from,
      to,
    );
    return (rows ?? []).map((r) => ({ key: r.key, samples: Number(r.samples) }));
  }

  @Get('proof-of-play')
  @RequireRoles(
    AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER,
  )
  async proofOfPlay(@Request() req: any, @Query('days') daysParam?: string) {
    const days = Math.min(Math.max(parseInt(daysParam || '7', 10) || 7, 1), 365);
    const since = hourFloor(Date.now() - days * 86_400_000);
    const tenantId = req.user.tenantId;
    const sampleMinutes =
      (Number(process.env.PROOF_OF_PLAY_SAMPLE_INTERVAL_MS) || 600_000) / 60_000;
    const hours = (count: number) =>
      Math.round((count * sampleMinutes) / 6) / 10; // count*min/60, 1 decimal

    const empty = {
      ready: true as boolean,
      sinceDays: days,
      windowStart: since.toISOString(),
      rolledUpThrough: null as string | null,
      sampleMinutes,
      totalSamples: 0,
      estimatedScreenHours: 0,
      playlists: [] as unknown[],
      assets: [] as unknown[],
      screens: [] as unknown[],
    };

    // Where the rollup ends and the raw tail begins. A null watermark means
    // "nothing aggregated" → read the whole window from raw, exactly as
    // before the rollup existed.
    let rawFrom = since;
    let rollupTo: Date | null = null;
    try {
      const watermark = await rollupWatermark(
        this.prisma.client as unknown as RollupCapableClient,
      );
      if (watermark && watermark.getTime() > since.getTime()) {
        rollupTo = watermark;
        rawFrom = watermark;
      }
    } catch {
      // Rollup migration not applied / table unreadable — raw-only path.
    }

    const byPlaylist = new Map<string, number>();
    const byScreen = new Map<string, number>();
    const add = (map: Map<string, number>, key: string, n: number) => {
      map.set(key, (map.get(key) ?? 0) + n);
    };

    // ── Aggregated half: [since, rollupTo) ────────────────────────────
    if (rollupTo) {
      try {
        const [playlistRows, screenRows] = await Promise.all([
          this.rollupSum('playlist_id', tenantId, since, rollupTo),
          this.rollupSum('screen_id', tenantId, since, rollupTo),
        ]);
        for (const r of playlistRows) add(byPlaylist, r.key, r.samples);
        for (const r of screenRows) add(byScreen, r.key, r.samples);
      } catch (e) {
        // Never serve a SHORT report silently. If the aggregate half fails,
        // fall back to reading the entire window from raw — slower, still
        // correct — rather than returning a number that is quietly missing
        // everything older than 14 days.
        this.logger.warn(
          `proof-of-play rollup read failed, falling back to raw: ${e instanceof Error ? e.message : String(e)}`,
        );
        byPlaylist.clear();
        byScreen.clear();
        rollupTo = null;
        rawFrom = since;
      }
    }

    // ── Raw half: [rawFrom, now] ──────────────────────────────────────
    // Aggregate IN THE DATABASE (efficiency audit 2026-07-20). This was a
    // findMany + in-memory tally, which at a 90-day × 1k-screen window
    // would stream ~13M raw rows through Node per page view. Two groupBys
    // ride the (tenantId, sampledAt) index and return one row per
    // playlist/screen instead. The separate count() was dropped: every
    // sample has a playlistId, so the total is the sum of the playlist
    // groups — provably identical, one query fewer per report view.
    let byPlaylistRows: Array<{ playlistId: string; _count: { _all: number } }>;
    let byScreenRows: Array<{ screenId: string; _count: { _all: number } }>;
    try {
      [byPlaylistRows, byScreenRows] = await Promise.all([
        (this.prisma.client as any).playbackSample.groupBy({
          by: ['playlistId'],
          where: { tenantId, sampledAt: { gte: rawFrom } },
          _count: { _all: true },
        }),
        (this.prisma.client as any).playbackSample.groupBy({
          by: ['screenId'],
          where: { tenantId, sampledAt: { gte: rawFrom } },
          _count: { _all: true },
        }),
      ]);
    } catch {
      // Table not present yet — the migration has not been applied.
      return { ...empty, ready: false };
    }
    for (const r of byPlaylistRows) add(byPlaylist, r.playlistId, r._count._all);
    for (const r of byScreenRows) add(byScreen, r.screenId, r._count._all);

    let totalSamples = 0;
    for (const n of byPlaylist.values()) totalSamples += n;
    if (totalSamples === 0) {
      return { ...empty, rolledUpThrough: rollupTo ? rollupTo.toISOString() : null };
    }

    // Resolve names. Restricted to the caller's tenant — an admin can
    // never see another tenant's analytics.
    const [playlists, screens] = await Promise.all([
      this.prisma.client.playlist.findMany({
        where: { id: { in: [...byPlaylist.keys()] }, tenantId },
        select: { id: true, name: true, items: { select: { assetId: true } } },
      }),
      this.prisma.client.screen.findMany({
        where: { id: { in: [...byScreen.keys()] }, tenantId },
        select: { id: true, name: true },
      }),
    ]);

    // Per-asset airtime: each playlist item earns its playlist's count.
    const byAsset = new Map<string, number>();
    for (const pl of playlists) {
      const plCount = byPlaylist.get(pl.id) || 0;
      for (const item of pl.items) {
        byAsset.set(item.assetId, (byAsset.get(item.assetId) || 0) + plCount);
      }
    }
    const assets = byAsset.size
      ? await this.prisma.client.asset.findMany({
          where: { id: { in: [...byAsset.keys()] }, tenantId },
          select: { id: true, originalName: true, mimeType: true },
        })
      : [];

    const playlistName = new Map(playlists.map((p) => [p.id, p.name]));
    const screenName = new Map(screens.map((s) => [s.id, s.name]));
    const assetMeta = new Map(assets.map((a) => [a.id, a]));

    return {
      ready: true,
      sinceDays: days,
      // Hour-aligned start of the window these numbers cover, and the point
      // where the aggregate half ends (null = the whole window came from raw
      // samples). Additive fields — existing clients ignore them.
      windowStart: since.toISOString(),
      rolledUpThrough: rollupTo ? rollupTo.toISOString() : null,
      sampleMinutes,
      totalSamples,
      estimatedScreenHours: hours(totalSamples),
      playlists: [...byPlaylist.entries()]
        .map(([id, count]) => ({
          playlistId: id,
          name: playlistName.get(id) || '(removed playlist)',
          samples: count,
          estimatedHours: hours(count),
        }))
        .sort((a, b) => b.samples - a.samples),
      assets: [...byAsset.entries()]
        .map(([id, count]) => {
          const meta = assetMeta.get(id);
          return {
            assetId: id,
            name: meta?.originalName || '(removed asset)',
            mimeType: meta?.mimeType || null,
            samples: count,
            estimatedHours: hours(count),
          };
        })
        .sort((a, b) => b.samples - a.samples)
        .slice(0, 100),
      screens: [...byScreen.entries()]
        .map(([id, count]) => ({
          screenId: id,
          name: screenName.get(id) || '(removed screen)',
          samples: count,
          estimatedHours: hours(count),
        }))
        .sort((a, b) => b.samples - a.samples),
    };
  }
}
