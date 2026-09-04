import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { recordPushDeployment } from '../screens/deployment-record';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { PlaylistDistributionService } from './playlist-distribution.service';
// CC-2 go-dark fallback (P0-1 fix, launch-sprint Day 1) — deleting a playlist
// hard-deletes its schedules, which previously BYPASSED the fallback that
// protects screens from going dark. Shared helper with schedules.controller.
import { reactivateFallbackIfDark } from '../schedules/go-dark-fallback';
import { evaluateScheduleEligibility } from '../common/schedule-eligibility';
// INJ-003 — the live-bound content gate (an Editor may not rewrite content
// that is already on a screen). Shared with templates.controller.
import {
  actorNeedsApprovalToEditLiveContent,
  findLivePlaylistBinding,
  requiresApprovalException,
  auditBlockedLiveEdit,
} from '../submissions/live-content-gate';
import {
  PlaylistCreateSchema, type PlaylistCreateInput,
  PlaylistUpdateSchema, type PlaylistUpdateInput,
  PlaylistReorderItemsSchema, type PlaylistReorderItemsInput,
  PlaylistSetActiveSchema, type PlaylistSetActiveInput,
} from '@cms/api-types';

@Controller('api/v1/playlists')
@UseGuards(JwtAuthGuard, RbacGuard)
export class PlaylistsController {
  private readonly auditLogger = new Logger('PlaylistsController');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly signer: WebsocketSignerService,
    private readonly distribution: PlaylistDistributionService,
  ) {}

  private async notifySync(tenantId: string) {
    try {
      const message = this.signer.signMessage('SYNC', { source: 'playlist_update' });
      await this.redisService.publish(`tenant:${tenantId}`, message);
    } catch (e) {
      // 2026-08-30 (reliability W1-10 / audit P0-7) — this catch used to be
      // EMPTY: a publish failure after a successful assignment meant the
      // dashboard said "sent" while no screen was told, with zero trace.
      // Delivery still converges via manifest polling (≤60 s), so we don't
      // fail the request — but the miss is now logged with enough context
      // to correlate a "publish didn't land" report to the exact moment.
      this.auditLogger.warn(
        `SYNC publish failed for tenant=${tenantId} — screens converge via manifest polling: ${(e as Error)?.message ?? e}`,
      );
    }
  }

  /**
   * Forensic trail for playlist mutations (2026-08-03).
   *
   * Only `remove()` wrote an AuditLog row — every OTHER mutating endpoint
   * (create, rename, the replace-all items write, the schedules on/off
   * toggle, publish-to-fleet) left nothing behind. So "who changed what is
   * on that screen" was unanswerable for the write that literally decides
   * it: `PUT /playlists/:id/items` swaps every asset a playlist plays, and
   * it is CONTRIBUTOR-reachable.
   *
   * Same row shape as `TemplatesController.audit` and the existing
   * PLAYLIST_DELETED row: tenantId + userId + action + targetType/targetId
   * + JSON details. AuditLog carries DB-level immutability triggers, so
   * this goes through the normal Prisma create path — never a raw UPDATE.
   *
   * Best-effort by design (cheap, and a DB hiccup must never fail an
   * operator's save), but NOT silent — a failure logs at warn so a broken
   * audit path is visible instead of masquerading as covered. The
   * delete/toggle paths that MUST be atomic keep their in-transaction
   * writes; this helper is for the create/update paths only.
   */
  private async audit(
    req: any,
    action:
      | 'PLAYLIST_CREATED'
      | 'PLAYLIST_UPDATED'
      | 'PLAYLIST_ITEMS_REPLACED'
      | 'PLAYLIST_SCHEDULES_TOGGLED'
      | 'PLAYLIST_PUBLISHED_TO_FLEET',
    playlistId: string | null,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) return; // defensive — JwtAuthGuard guarantees this
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: req?.user?.id ?? null,
          action,
          targetType: 'Playlist',
          targetId: playlistId,
          details: JSON.stringify(details),
        },
      });
    } catch (e: any) {
      this.auditLogger.warn(`audit(${action}, ${playlistId}) failed: ${e?.message ?? e}`);
    }
  }

  /**
   * INJ-003 (2026-08-02) — the CONTRIBUTOR (Editor) publish gate, extended
   * from "new schedules" to "edits of already-live content".
   *
   * `schedules.controller.create()` stages every CONTRIBUTOR-created
   * schedule as a draft: *"they cannot push content live directly."* But
   * that only covered creating a NEW schedule. `PUT /playlists/:id/items`
   * allows CONTRIBUTOR and checked only tenant ownership — so an Editor
   * could swap the items of a playlist that was ALREADY live and the new
   * content shipped to every screen at the next manifest poll, un-reviewed.
   * Same "push content live directly", just through the back door.
   *
   * The live-bound definition, the fail-closed role test, the full
   * why-not-the-submission-queue analysis and the accepted residual risk all
   * live in ONE place — `submissions/live-content-gate.ts` — shared with the
   * identical gate on the template write paths. Read that file before
   * changing anything here.
   */
  private async assertContributorMayEditLivePlaylist(
    req: any,
    playlistId: string,
    isProtected: boolean,
  ): Promise<void> {
    if (!actorNeedsApprovalToEditLiveContent(req?.user)) return;
    const binding = await findLivePlaylistBinding(this.prisma, req.user.tenantId, playlistId, { isProtected });
    if (!binding) return;
    await auditBlockedLiveEdit(this.prisma, req, 'playlist', playlistId, binding);
    throw requiresApprovalException('playlist', binding);
  }

  // ─── Phase 2c — publish (distribute) this playlist to screens across child
  //     locations. Copies the playlist + its assets down into each child and
  //     schedules it live there (idempotent re-publish via sourcePlaylistId).
  //     Parent/corporate admins only; targets must be the caller's tenant or
  //     its direct children (enforced in the service).
  @Post(':id/publish-to-fleet')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  async publishToFleet(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { screenIds?: string[] },
  ) {
    const result = await this.distribution.publishToFleet({
      parentTenantId: req.user.tenantId,
      actorUserId: req.user.id,
      sourcePlaylistId: id,
      screenIds: Array.isArray(body?.screenIds) ? body.screenIds : [],
    });
    await this.audit(req, 'PLAYLIST_PUBLISHED_TO_FLEET', id, {
      requestedScreenIds: Array.isArray(body?.screenIds) ? body.screenIds.length : 0,
      locations: result.perLocation.map((l: any) => l.tenantId),
    });
    // A content publish IS a push (2026-08-31): mint the same tracked
    // Deployment the refresh endpoints mint, labeled with the playlist, so
    // the dashboard's Live-deployment card follows THIS — the thing the
    // operator actually shipped — and the durable pendingRefreshAt ride
    // reaches even push-dead screens. Best-effort by construction.
    try {
      const source = await this.prisma.client.playlist.findFirst({
        where: { id, tenantId: req.user.tenantId },
        select: { name: true },
      });
      const targetTenantIds = result.perLocation.map((l: any) => l.tenantId as string);
      if (targetTenantIds.length > 0) {
        await recordPushDeployment(this.prisma, {
          tenantId: req.user.tenantId,
          targetTenantIds,
          createdById: req.user.id ?? null,
          value: new Date(),
          corrId: `pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          scope: 'tenant',
          playlistId: id,
          ...(Array.isArray(body?.screenIds) && body.screenIds.length > 0
            ? { screenIds: body.screenIds }
            : {}),
          label: `Publish · ${source?.name ?? 'playlist'}`,
        });
      }
    } catch { /* record is bookkeeping — the publish already succeeded */ }
    // Nudge each affected location's players to re-sync now (they'd otherwise
    // pick it up on the next 5-10s manifest poll).
    for (const loc of result.perLocation) this.notifySync(loc.tenantId);
    return result;
  }

  /**
   * Library summaries (Playlists Operations v1, 2026-08-31) — the list
   * surface rides THIS, not the full item graphs (the bare list ships every
   * item + asset row; at hundreds of playlists that's megabytes per nav).
   *
   * scheduleState is CALENDAR-honest, same convention as the assets/
   * templates usage builders: ACTIVE means "an enabled schedule's date
   * range covers now, its day list (when set) includes today in UTC, and
   * its time window (when set) contains the current UTC clock" — a
   * scheduling-intent claim, never a proof a player painted it. Declared
   * ABOVE @Get(':id') — a literal path after a param route is swallowed
   * as an id (controller-prefix/fleet-pulse lesson family).
   */
  @Get('summary')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async summary(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const playlists = await this.prisma.client.playlist.findMany({
      where: { tenantId, isProtected: false },
      select: {
        id: true, name: true, templateId: true, sourcePlaylistId: true, updatedAt: true,
        template: { select: { name: true, screenWidth: true, screenHeight: true } },
        createdBy: { select: { email: true } },
        _count: { select: { items: true, schedules: true } },
        // First few items only — enough to find a thumbnail, never the graph.
        items: {
          orderBy: { sequenceOrder: 'asc' },
          take: 4,
          select: { asset: { select: { fileUrl: true, mimeType: true } } },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const ids = playlists.map((p) => p.id);

    // Total duration per playlist in ONE grouped query.
    const durations = ids.length
      ? await this.prisma.client.playlistItem.groupBy({
          by: ['playlistId'],
          where: { playlistId: { in: ids } },
          _sum: { durationMs: true },
        })
      : [];
    const durationBy = new Map((durations as any[]).map((d) => [d.playlistId, d._sum?.durationMs ?? 0]));

    const now = new Date();
    const schedules = ids.length
      ? await this.prisma.client.schedule.findMany({
          where: { playlistId: { in: ids } },
          select: {
            playlistId: true, isActive: true, screenId: true, screenGroupId: true,
            startTime: true, endTime: true, daysOfWeek: true, timeStart: true, timeEnd: true,
          },
        })
      : [];
    const groupIds = [...new Set(schedules.map((s) => s.screenGroupId).filter(Boolean))] as string[];
    const groupScreens = groupIds.length
      ? await this.prisma.client.screen.findMany({
          where: { screenGroupId: { in: groupIds } },
          select: { id: true, tenantId: true, screenGroupId: true },
        })
      : [];
    const screensByGroup = new Map<string, Array<{ id: string; tenantId: string | null }>>();
    for (const s of groupScreens) {
      const list = screensByGroup.get(s.screenGroupId as string) ?? [];
      list.push({ id: s.id, tenantId: s.tenantId });
      screensByGroup.set(s.screenGroupId as string, list);
    }
    const pinnedIds = [...new Set(schedules.map((s) => s.screenId).filter(Boolean))] as string[];
    const pinned = pinnedIds.length
      ? await this.prisma.client.screen.findMany({
          where: { id: { in: pinnedIds } },
          select: { id: true, tenantId: true },
        })
      : [];
    const pinnedById = new Map(pinned.map((s) => [s.id, s]));

    const dayLabel = (days: string | null) => {
      const d = (days ?? '').toLowerCase();
      if (!d) return 'Every day';
      if (d.includes('mon') && d.includes('fri') && !d.includes('sat') && !d.includes('sun')) return 'Weekdays';
      return d.split(',').map((x) => x.trim().slice(0, 3)).filter(Boolean)
        .map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(' · ');
    };

    const bySummary = new Map<string, {
      screens: Set<string>; tenants: Set<string>; groups: Set<string>;
      hasTargets: boolean; anyEnabled: boolean; eligibleNow: boolean; futureOnly: boolean;
      firstLine: string | null;
    }>();
    for (const sc of schedules) {
      const slot = bySummary.get(sc.playlistId) ?? {
        screens: new Set(), tenants: new Set(), groups: new Set(),
        hasTargets: false, anyEnabled: false, eligibleNow: false, futureOnly: false,
        firstLine: null,
      };
      const reached: Array<{ id: string; tenantId: string | null }> = [];
      if (sc.screenId && pinnedById.has(sc.screenId)) reached.push(pinnedById.get(sc.screenId)!);
      if (sc.screenGroupId) {
        slot.groups.add(sc.screenGroupId);
        reached.push(...(screensByGroup.get(sc.screenGroupId) ?? []));
      }
      if (sc.screenId || sc.screenGroupId) slot.hasTargets = true;
      for (const r of reached) {
        slot.screens.add(r.id);
        if (r.tenantId) slot.tenants.add(r.tenantId);
      }
      if (sc.isActive) {
        slot.anyEnabled = true;
        // 2026-09-01 (Codex truth audit) — this used to compare an hour-
        // level timeStart/timeEnd window against the SERVER's UTC clock,
        // which is wrong by construction (those strings are the SCREEN's
        // local wall-clock window; the server has no tenant/screen
        // timezone to reproduce that — see schedule-eligibility.ts). Fails
        // CLOSED now: a time-windowed schedule reads SCHEDULED, never a
        // guessed ACTIVE/not-ACTIVE.
        const elig = evaluateScheduleEligibility(sc, now);
        const started = elig !== 'future';
        const days = (sc.daysOfWeek ?? '').toLowerCase();
        if (elig === 'active') slot.eligibleNow = true;
        else if (elig !== 'expired') slot.futureOnly = true;
        if (!slot.firstLine) {
          if (!started) {
            slot.firstLine = `Starts ${sc.startTime.toISOString().slice(0, 10)}`;
          } else if (!sc.timeStart && !sc.timeEnd && !days) {
            slot.firstLine = 'Always';
          } else {
            const win = sc.timeStart && sc.timeEnd ? ` · ${sc.timeStart}–${sc.timeEnd}` : '';
            slot.firstLine = `${dayLabel(sc.daysOfWeek)}${win}`;
          }
        }
      }
      bySummary.set(sc.playlistId, slot);
    }

    return {
      playlists: playlists.map((p) => {
        const slot = bySummary.get(p.id);
        const thumb = p.items.find((it) => it.asset?.mimeType?.startsWith('image/'))?.asset?.fileUrl ?? null;
        const scheduleState = !slot || !slot.hasTargets
          ? 'UNASSIGNED'
          : !slot.anyEnabled
            ? 'PAUSED'
            : slot.eligibleNow
              ? 'ACTIVE'
              : 'SCHEDULED';
        return {
          id: p.id,
          name: p.name,
          kind: p.templateId ? 'template' : 'media',
          itemCount: p._count.items,
          durationMs: durationBy.get(p.id) ?? 0,
          thumbnailUrl: thumb,
          templateSummary: p.template
            ? `${p.template.name} · ${p.template.screenWidth}×${p.template.screenHeight}`
            : null,
          creatorSummary: p.createdBy?.email ?? null,
          scheduleState,
          // No persisted review state exists on the Playlist model today —
          // null is honest, never a guessed value.
          reviewState: null,
          reach: {
            screens: slot?.screens.size ?? 0,
            groups: slot?.groups.size ?? 0,
            locations: slot?.tenants.size ?? 0,
          },
          scheduleSummary: slot?.firstLine ?? (slot?.hasTargets ? 'Not scheduled' : 'No screens'),
          updatedAt: p.updatedAt,
          sourceOwnership: p.sourcePlaylistId ? 'hq' : 'own',
        };
      }),
      total: playlists.length,
    };
  }

  /**
   * One playlist's push history + live per-target acknowledgement
   * (Playlists Operations v1). Truth ceiling per the design correction:
   * acknowledged = the screen's refreshAckMs echoes THIS deployment's exact
   * value (VALUE identity, CLAUDE.md player rule 6) — never "confirmed":
   * no expected-content-signature comparison exists yet, and this endpoint
   * refuses to imply one.
   */
  @Get(':id/delivery')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async delivery(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user.tenantId;
    const playlist = await this.prisma.client.playlist.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!playlist) throw new HttpException({ code: 'PLAYLIST_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const rows = await this.prisma.client.deployment.findMany({
      where: { tenantId, playlistId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    if (rows.length === 0) return { latest: null, history: [] };

    // THE ack truth is the durable 'refresh-acked' ScreenEvent written on
    // the value-match clear ("the clear IS the ack" — there is no persisted
    // ack column on Screen; render-proof nulls pendingRefreshAt and records
    // the event with the exact echoed value). One event fetch covers every
    // history row.
    const allTargetIds = [
      ...new Set(rows.flatMap((r) => (Array.isArray(r.targetIds) ? (r.targetIds as string[]) : []))),
    ];
    const ackEvents = allTargetIds.length
      ? await this.prisma.client.screenEvent.findMany({
          where: { kind: 'refresh-acked', screenId: { in: allTargetIds } },
          select: { screenId: true, detail: true, createdAt: true },
        })
      : [];
    const ackKey = (screenId: string, valueMs: number) => `${screenId}:${valueMs}`;
    const ackAtByKey = new Map<string, Date>();
    for (const ev of ackEvents) {
      const v = (ev.detail as any)?.valueMs;
      if (typeof v === 'number') {
        const k = ackKey(ev.screenId, v);
        // Keep the earliest ack — the moment the update actually landed.
        if (!ackAtByKey.has(k) || ackAtByKey.get(k)! > ev.createdAt) ackAtByKey.set(k, ev.createdAt);
      }
    }
    const ackCountFor = (row: (typeof rows)[number]) => {
      const idsFor = (Array.isArray(row.targetIds) ? row.targetIds : []) as string[];
      const v = row.value.getTime();
      return idsFor.filter((sid) => ackAtByKey.has(ackKey(sid, v))).length;
    };

    const latestRow = rows[0];
    const targetIds = (Array.isArray(latestRow.targetIds) ? latestRow.targetIds : []) as string[];
    const screens = targetIds.length
      ? await this.prisma.client.screen.findMany({
          where: { id: { in: targetIds } },
          select: {
            id: true, name: true, tenantId: true, lastPingAt: true,
            lastRenderedAt: true, lastPushConnectedAt: true, pendingRefreshAt: true,
          } as any,
        })
      : [];
    const tenantNames = new Map(
      (await this.prisma.client.tenant.findMany({
        where: { id: { in: [...new Set(screens.map((s: any) => s.tenantId).filter(Boolean))] as string[] } },
        select: { id: true, name: true },
      })).map((t) => [t.id, t.name]),
    );

    const nowMs = Date.now();
    const valueMs = latestRow.value.getTime();
    const ONLINE_MS = 35 * 1000;

    const targets = screens.map((s: any) => {
      const online = !!s.lastPingAt && nowMs - new Date(s.lastPingAt).getTime() < ONLINE_MS;
      const ackedAt = ackAtByKey.get(ackKey(s.id, valueMs)) ?? null;
      const state = ackedAt
        ? 'acknowledged'
        : !online
          ? 'offline'
          : s.lastRenderedAt == null
            ? 'unknown'
            : 'not-updated';
      return {
        screenId: s.id,
        name: s.name,
        locationName: tenantNames.get(s.tenantId) ?? '',
        online,
        ackAt: ackedAt ? ackedAt.getTime() : null,
        lastProofAt: s.lastRenderedAt ? new Date(s.lastRenderedAt).toISOString() : null,
        pushChannel: s.lastPushConnectedAt
          ? (nowMs - new Date(s.lastPushConnectedAt).getTime() < 10 * 60_000 ? 'live' : 'stale')
          : 'unknown',
        state,
      };
    });

    return {
      latest: {
        id: latestRow.id,
        label: latestRow.label,
        createdAt: latestRow.createdAt,
        targetCount: latestRow.targetCount,
        acknowledged: targets.filter((t) => t.state === 'acknowledged').length,
        targets,
      },
      history: rows.map((row) => ({
        id: row.id,
        label: row.label,
        createdAt: row.createdAt,
        targetCount: row.targetCount,
        acknowledged: ackCountFor(row),
      })),
    };
  }

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any) {
    await this.prisma.ensurePlaylistMetadataColumns();
    const tenantId = req.user.tenantId;
    const playlists = await this.prisma.client.playlist.findMany({
      // Hide protected (emergency) playlists from the regular /playlists
      // list so they can't be accidentally deleted. They surface only
      // through the panic-content settings card.
      where: { tenantId, isProtected: false },
      include: {
        items: {
          orderBy: { sequenceOrder: 'asc' },
          include: { asset: { select: { id: true, fileUrl: true, mimeType: true, originalName: true } } },
        },
        // zones + bg travel with the template so the dashboard can PREVIEW a
        // template-backed playlist. Before this the Screens page could only show
        // a thumbnail when a playlist contained an image asset, so a playlist
        // that IS a board with no items rendered as a blank grey box (operator,
        // 2026-09-01: "only images preview and not templates ... everything
        // should preview"). A board is a single EXTERNAL_HTML zone whose config
        // holds the html path, which resolves to its pre-rendered poster PNG.
        // Measured cost on the fleet's busiest tenant: 16 playlists -> 2 KB.
        template: {
          select: {
            id: true, name: true, screenWidth: true, screenHeight: true, category: true,
            bgColor: true, bgGradient: true, bgImage: true,
            zones: { select: { widgetType: true, defaultConfig: true } },
          },
        },
        createdBy: { select: { id: true, email: true } },
        _count: { select: { schedules: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    // Phase 2c — fleet-publish decoration. For each playlist that was published
    // to locations, how many child locations got a copy + how many of those
    // copies' schedules are active. Lets the card show "published to N
    // locations" and keep its on/off toggle working even when the SOURCE has
    // zero own schedules (the copies hold them). Best-effort; never blocks list.
    try {
      const ids = playlists.map((p) => p.id);
      const copies = ids.length
        ? await this.prisma.client.playlist.findMany({
            where: { sourcePlaylistId: { in: ids }, tenant: { parentId: tenantId } },
            select: { id: true, sourcePlaylistId: true, tenantId: true },
          })
        : [];
      if (copies.length) {
        const activeRows = await this.prisma.client.schedule.groupBy({
          by: ['playlistId'],
          where: { playlistId: { in: copies.map((c) => c.id) }, isActive: true },
          _count: { _all: true },
        });
        const activeByCopy = new Map<string, number>();
        for (const r of activeRows as any[]) activeByCopy.set(r.playlistId, r._count?._all ?? 0);
        const locsBySource = new Map<string, Set<string>>();
        const activeBySource = new Map<string, number>();
        for (const c of copies) {
          const src = c.sourcePlaylistId as string;
          (locsBySource.get(src) ?? locsBySource.set(src, new Set()).get(src)!).add(c.tenantId);
          activeBySource.set(src, (activeBySource.get(src) ?? 0) + (activeByCopy.get(c.id) ?? 0));
        }
        for (const p of playlists as any[]) {
          p.fleetLocations = locsBySource.get(p.id)?.size ?? 0;
          p.fleetActiveSchedules = activeBySource.get(p.id) ?? 0;
        }
      }
    } catch { /* fleet decoration is best-effort */ }

    return playlists;
  }

  @Get(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async get(@Request() req: any, @Param('id') id: string) {
    await this.prisma.ensurePlaylistMetadataColumns();
    return this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
      include: {
        items: {
          orderBy: { sequenceOrder: 'asc' },
          include: { asset: true },
        },
        // zones + bg travel with the template so the dashboard can PREVIEW a
        // template-backed playlist. Before this the Screens page could only show
        // a thumbnail when a playlist contained an image asset, so a playlist
        // that IS a board with no items rendered as a blank grey box (operator,
        // 2026-09-01: "only images preview and not templates ... everything
        // should preview"). A board is a single EXTERNAL_HTML zone whose config
        // holds the html path, which resolves to its pre-rendered poster PNG.
        // Measured cost on the fleet's busiest tenant: 16 playlists -> 2 KB.
        template: {
          select: {
            id: true, name: true, screenWidth: true, screenHeight: true, category: true,
            bgColor: true, bgGradient: true, bgImage: true,
            zones: { select: { widgetType: true, defaultConfig: true } },
          },
        },
        createdBy: { select: { id: true, email: true } },
      },
    });
  }

  @Post()
  // CONTRIBUTOR (the "Editor" tier) can CREATE a playlist to build content —
  // creating one does NOT publish it to any screen (publishing/scheduling is a
  // separate admin-only action the Editor reaches via Submit-for-Review).
  // Without this the editor role was half-crippled: it could edit existing
  // playlists but not start a new one. 2026-06-09 RBAC/reviewer rework.
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async create(@Request() req: any, @Body(new ZodValidationPipe(PlaylistCreateSchema)) body: PlaylistCreateInput) {
    await this.prisma.ensurePlaylistMetadataColumns();

    // auth-BUG-004: when the body provides a templateId, verify it's
    // either a system preset (isSystem: true, shared globally) or a
    // template belonging to the caller's tenant. Without this gate a
    // user could attach another tenant's custom template to their own
    // playlist and the player would render that tenant's layout.
    if (body.templateId) {
      // ten-ok: tenant scope IS applied — `OR: [{ tenantId: caller }, { isSystem: true }]`
      // below. This IS the auth-BUG-004 gate that stops a tenant-B template being
      // attached to a tenant-A playlist; the gate cannot read a nested OR arm.
      const templateOwned = await this.prisma.client.template.findFirst({
        where: {
          id: body.templateId,
          OR: [
            { tenantId: req.user.tenantId },
            { isSystem: true },
          ],
        },
        select: { id: true },
      });
      if (!templateOwned) {
        throw new HttpException({ code: 'PLAYLIST_TEMPLATE_NOT_FOUND', message: 'Template not found' }, HttpStatus.NOT_FOUND);
      }
    }

    const res = await this.prisma.client.playlist.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name,
        createdByUserId: req.user.id,
        ...(body.templateId ? { templateId: body.templateId } : {}),
      },
      include: {
        template: { select: { id: true, name: true, screenWidth: true, screenHeight: true, category: true } },
        createdBy: { select: { id: true, email: true } },
        items: {
          orderBy: { sequenceOrder: 'asc' },
          include: { asset: { select: { id: true, fileUrl: true, mimeType: true, originalName: true } } },
        },
        _count: { select: { schedules: true } },
      },
    });
    await this.audit(req, 'PLAYLIST_CREATED', res.id, {
      name: res.name,
      templateId: body.templateId ?? null,
    });
    this.notifySync(req.user.tenantId);
    return res;
  }

  @Put(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async update(@Request() req: any, @Param('id') id: string, @Body(new ZodValidationPipe(PlaylistUpdateSchema)) body: PlaylistUpdateInput) {
    await this.prisma.ensurePlaylistMetadataColumns();
    const playlist = await this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!playlist) throw new HttpException({ code: 'PLAYLIST_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const res = await this.prisma.client.playlist.update({
      where: { id, tenantId: req.user.tenantId },
      data: { name: body.name },
    });
    await this.audit(req, 'PLAYLIST_UPDATED', id, {
      previousName: playlist.name,
      name: res.name,
    });
    this.notifySync(req.user.tenantId);
    return res;
  }

  @Put(':id/items')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async reorderItems(
    @Request() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PlaylistReorderItemsSchema)) body: PlaylistReorderItemsInput,
  ) {
    await this.prisma.ensurePlaylistMetadataColumns();
    const playlist = await this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!playlist) throw new HttpException({ code: 'PLAYLIST_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // INJ-003 (2026-08-02) — an Editor may not rewrite the contents of a
    // playlist that is already live on screens, NOR of a protected
    // (emergency / panic) playlist. `update`, `setActive` and `remove`
    // already refuse protected playlists; this replace-all path — the one
    // that rewrites what a lockdown board actually SHOWS — did not, and it
    // is CONTRIBUTOR-reachable. See assertContributorMayEditLivePlaylist.
    await this.assertContributorMayEditLivePlaylist(req, id, !!(playlist as any).isProtected);

    // HIGH-1 audit fix: validate every assetId in the body actually
    // belongs to the caller's tenant. Without this, a user could insert
    // another tenant's assetId into their own playlist (existence-leak +
    // potential cross-tenant rendering). Single COUNT query is cheap.
    const assetIds = Array.from(new Set(body.items.map(i => i.assetId).filter(Boolean)));
    if (assetIds.length > 0) {
      const ownedCount = await this.prisma.client.asset.count({
        where: { id: { in: assetIds }, tenantId: req.user.tenantId },
      });
      if (ownedCount !== assetIds.length) {
        throw new HttpException(
          { code: 'ASSET_TENANT_MISMATCH', message: 'One or more assets do not belong to this tenant.' },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // Replace all items in a transaction
    await this.prisma.client.$transaction([
      this.prisma.client.playlistItem.deleteMany({ where: { playlistId: id } }),
      ...body.items.map((item) =>
        this.prisma.client.playlistItem.create({
          data: {
            playlistId: id,
            assetId: item.assetId,
            durationMs: item.durationMs,
            sequenceOrder: item.sequenceOrder,
            daysOfWeek: item.daysOfWeek || null,
            timeStart: item.timeStart || null,
            timeEnd: item.timeEnd || null,
            transitionType: item.transitionType || 'FADE',
            // 2026-05-05 — default TRUE matches the previous always-
            // muted behavior. Operator flips per-item via the editor.
            muted: typeof item.muted === 'boolean' ? item.muted : true,
          },
        }),
      ),
      this.prisma.client.playlist.update({
        where: { id, tenantId: req.user.tenantId },
        data: { updatedAt: new Date() },
      }),
    ]);

    const updated = await this.prisma.client.playlist.findUnique({
      where: { id, tenantId: req.user.tenantId },
      include: {
        items: { orderBy: { sequenceOrder: 'asc' }, include: { asset: true } },
        template: { select: { id: true, name: true, screenWidth: true, screenHeight: true, category: true } },
        createdBy: { select: { id: true, email: true } },
        _count: { select: { schedules: true } },
      },
    });
    // THE write that decides what a screen actually plays — this replaces
    // every item in the playlist and is CONTRIBUTOR-reachable. Record the
    // asset set (ids only, ordered) so a later "who changed what is on that
    // screen" can be answered without a DB time machine.
    await this.audit(req, 'PLAYLIST_ITEMS_REPLACED', id, {
      name: playlist.name,
      isProtected: !!(playlist as any).isProtected,
      itemCount: body.items.length,
      assetIds: body.items
        .slice()
        .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
        .map((i) => i.assetId),
    });
    this.notifySync(req.user.tenantId);
    return updated;
  }

  /**
   * Flip every schedule attached to this playlist on or off in one
   * call. Powers the on/off toggle on the playlist card so an
   * operator doesn't have to drill into the playlist, hit Schedule,
   * then Publish just to turn content on or off for the day. Returns
   * the updated count so the UI can surface "N schedules activated".
   *
   * `active: true` with zero existing schedules is a soft no-op — the
   * frontend is expected to send the user through the publish flow in
   * that case. We don't silently create a schedule here because we
   * can't guess the correct screen target or time window.
   */
  @Put(':id/active')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setActive(
    @Request() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PlaylistSetActiveSchema)) body: PlaylistSetActiveInput,
  ) {
    await this.prisma.ensurePlaylistMetadataColumns();
    const playlist = await this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!playlist) throw new HttpException({ code: 'PLAYLIST_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    // Protected (emergency / panic) playlists must not have their
    // schedules toggled from this generic operator endpoint — that
    // would silently disable a panic trigger. Same guard as `remove`
    // and `update`; managed from Settings → Panic Button Integrations.
    if (playlist.isProtected) {
      throw new HttpException(
        {
          code: 'PLAYLIST_PROTECTED',
          message: `This playlist holds ${playlist.protectedKind || 'emergency'} content — its schedules can't be toggled from here. Manage it from Settings → Panic Button Integrations.`,
        },
        HttpStatus.FORBIDDEN,
      );
    }
    const result = await this.prisma.client.schedule.updateMany({
      where: { playlistId: id, tenantId: req.user.tenantId },
      data: { isActive: !!body.active },
    });
    // Turning a playlist's schedules off takes its content OFF the wall —
    // the same class of change SCHEDULE_TOGGLED already audits one schedule
    // at a time. This bulk door had no trail at all.
    await this.audit(req, 'PLAYLIST_SCHEDULES_TOGGLED', id, {
      name: playlist.name,
      active: !!body.active,
      scheduleCount: result.count,
    });
    // Nudge the players so they re-fetch the manifest immediately
    // instead of waiting for the next 5-10s poll — same pattern as
    // schedule create.
    this.notifySync(req.user.tenantId);

    // Phase 2c — cascade to fleet copies. If this playlist was published to
    // locations, each child copy (Playlist.sourcePlaylistId === id) has its OWN
    // schedules in the child tenant, so turning the source off/on here must flip
    // those too — otherwise the copies keep playing. Scoped to DIRECT children
    // of this tenant (parent→child authority). Non-fatal: a cascade failure
    // never blocks the primary toggle.
    let cascadedLocations = 0;
    let cascadedSchedules = 0;
    try {
      const copies = await this.prisma.client.playlist.findMany({
        where: { sourcePlaylistId: id, tenant: { parentId: req.user.tenantId } },
        select: { id: true, tenantId: true },
      });
      if (copies.length) {
        const casc = await this.prisma.client.schedule.updateMany({
          where: { playlistId: { in: copies.map((c) => c.id) } },
          data: { isActive: !!body.active },
        });
        cascadedSchedules = casc.count;
        const tenantIds = Array.from(new Set(copies.map((c) => c.tenantId)));
        cascadedLocations = tenantIds.length;
        for (const tid of tenantIds) this.notifySync(tid);
      }
    } catch { /* cascade is best-effort; primary toggle already succeeded */ }

    return { count: result.count, active: !!body.active, cascadedLocations, cascadedSchedules };
  }

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    await this.prisma.ensurePlaylistMetadataColumns();
    const playlist = await this.prisma.client.playlist.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!playlist) throw new HttpException({ code: 'PLAYLIST_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // Refuse to delete a protected (emergency) playlist. The settings
    // page manages these; deleting one would silently break a future
    // panic trigger. The "BULLETPROOF FALLBACK" in screens/manifest
    // would still render a default red screen, but the operator's
    // configured content would be gone.
    if (playlist.isProtected) {
      throw new HttpException(
        {
          code: 'PLAYLIST_PROTECTED',
          message: `This playlist holds ${playlist.protectedKind || 'emergency'} content and cannot be deleted from here. Manage it from Settings → Panic Button Integrations.`,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // 2026-05-13 — Old behavior soft-disabled schedules (set
    // isActive=false) then tried to delete the playlist. That FAILED
    // with a Postgres foreign-key constraint because `Schedule.playlist`
    // has no `onDelete: Cascade` — every Schedule row still pointed at
    // the playlist, so the delete bounced and the client's optimistic
    // update rolled back ("deletes for 1s then pops right back in,"
    // reported verbatim by the operator).
    //
    // New behavior: write an AuditLog entry that captures the schedule
    // metadata first (audit trail preserved), THEN hard-delete the
    // schedules, THEN delete the playlist. PlaylistItems are removed by
    // their own onDelete: Cascade. Single transaction so a partial
    // failure rolls everything back.
    await this.prisma.client.$transaction(async (tx) => {
      const attachedSchedules = await tx.schedule.findMany({
        where: { playlistId: id },
        select: {
          id: true, screenId: true, screenGroupId: true,
          startTime: true, endTime: true, isActive: true,
        },
      });
      // 2026-05-23 launch audit P1: audit EVERY playlist delete, not
      // just deletes-with-attached-schedules. Operators were able to
      // ghost-delete an unscheduled draft with zero forensic trail.
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user.id,
          action: 'PLAYLIST_DELETED',
          targetType: 'Playlist',
          targetId: id,
          details: JSON.stringify({
            name: playlist.name,
            scheduleCount: attachedSchedules.length,
            schedules: attachedSchedules,
          }),
        },
      });
      // 2026-05-23 launch audit P1: removed the `.catch(() => {})`
      // that previously swallowed audit-write errors INSIDE this
      // $transaction. A failed audit MUST roll back the playlist +
      // schedule delete; a partial state with no forensic trail is
      // worse than rejecting and asking the operator to retry.
      if (attachedSchedules.length > 0) {
        await tx.schedule.deleteMany({ where: { playlistId: id } });
        // P0-1 (launch-sprint Day 1, 2026-07-01): deleting a playlist kills
        // every schedule referencing it — a second door into the CC-2
        // go-dark failure that previously bypassed the fallback entirely.
        // For each ACTIVE schedule we just removed, run the SAME fallback
        // the schedules controller runs: if its target (screen/group) is
        // now uncovered, promote the best inactive candidate. Runs AFTER
        // deleteMany inside this tx, so candidates can never reference the
        // dying playlist (its schedules are already gone) and the whole
        // delete+fallback commits atomically. Idempotent per target — the
        // helper's stillActive check makes duplicate targets a no-op.
        for (const s of attachedSchedules) {
          if (!s.isActive) continue;
          await reactivateFallbackIfDark(tx, {
            tenantId: req.user.tenantId,
            userId: req.user.id ?? null,
            screenId: s.screenId,
            screenGroupId: s.screenGroupId,
            removedScheduleId: s.id,
          });
        }
      }
      await tx.playlist.delete({ where: { id, tenantId: req.user.tenantId } });
    });
    this.notifySync(req.user.tenantId);
    return { deleted: true };
  }
}
