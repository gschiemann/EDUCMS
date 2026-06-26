import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import {
  ScheduleCreateSchema, type ScheduleCreateInput,
  ScheduleUpdateSchema, type ScheduleUpdateInput,
} from '@cms/api-types';

@Controller('api/v1/schedules')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SchedulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly signer: WebsocketSignerService,
    private readonly notify: NotificationsService,
  ) {}

  private async notifySync(tenantId: string) {
    try {
      const message = this.signer.signMessage('SYNC', { source: 'schedule_update' });
      await this.redisService.publish(`tenant:${tenantId}`, message);
    } catch (e) {}
  }

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.prisma.client.schedule.findMany({
      where: { tenantId },
      include: {
        playlist: { select: { id: true, name: true } },
        screenGroup: { select: { id: true, name: true } },
        screen: { select: { id: true, name: true } },
      },
      orderBy: { startTime: 'desc' },
    });
  }

  @Post()
  // CONTRIBUTOR (Editor) may STAGE schedules, but only as drafts — see the
  // willBeActive override below. Publishing a schedule live (isActive=true)
  // stays an admin action, or happens automatically when an admin approves
  // the Editor's submission (submissions.controller flips isActive→true).
  // This is the publish gate: Editor stages → admin reviews → goes live.
  // (2026-06-09 — operator: "editor … won't let them publish … should say
  // send for review".)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async create(
    @Request() req: any,
    @Body(new ZodValidationPipe(ScheduleCreateSchema)) body: ScheduleCreateInput,
  ) {
    if (!body.screenGroupId && !body.screenId) {
      throw new HttpException('Either screenGroupId or screenId must be specified', HttpStatus.BAD_REQUEST);
    }

    // auth-BUG-003: validate every foreign id in the body actually
    // belongs to the caller's tenant before writing. Without these
    // checks Prisma would happily insert a Schedule referencing
    // another tenant's playlist/screen/screenGroup, leaking content
    // across tenants. Mirrors submissions.controller.ts:78-89 pattern.
    if (!body.playlistId) {
      throw new HttpException('playlistId is required', HttpStatus.BAD_REQUEST);
    }
    const playlistOwned = await this.prisma.client.playlist.findFirst({
      where: { id: body.playlistId, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!playlistOwned) {
      throw new HttpException('Playlist not found', HttpStatus.NOT_FOUND);
    }
    if (body.screenId) {
      const screenOwned = await this.prisma.client.screen.findFirst({
        where: { id: body.screenId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!screenOwned) {
        throw new HttpException('Screen not found', HttpStatus.NOT_FOUND);
      }
    }
    if (body.screenGroupId) {
      const groupOwned = await this.prisma.client.screenGroup.findFirst({
        where: { id: body.screenGroupId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!groupOwned) {
        throw new HttpException('Screen group not found', HttpStatus.NOT_FOUND);
      }
    }

    // CONTRIBUTOR (Editor) schedules are ALWAYS staged as drafts — they
    // cannot push content live directly. An admin activates on approval
    // (or directly). Everyone else honors the requested isActive flag.
    const isContributor = req.user?.role === AppRole.CONTRIBUTOR;
    const willBeActive = !isContributor && body.isActive !== false;

    // Org-wide "Require approval before any content goes live" gate
    // (2026-06-26). When the tenant flag is ON and the actor is a
    // CONTRIBUTOR, this publish is FORCED through the submit-for-review
    // queue: the schedule is staged as a draft (already guaranteed above)
    // AND a Submission review record is auto-created below so an admin
    // must approve it before it goes live. Admins bypass — they ARE the
    // approvers, so we never even look up the flag for them.
    let routeThroughReview = false;
    if (isContributor) {
      const t = await this.prisma.client.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: { requireContentApproval: true } as any,
      }) as any;
      routeThroughReview = !!t?.requireContentApproval;
    }

    // Only displace other active schedules when THIS schedule is going
    // live. A saved-draft schedule should not knock the currently-
    // running one off the screen; it's a plan, not a go-live.
    if (willBeActive && body.mode !== 'append') {
       // Replace mode: disable all existing active schedules that overlap
       // THIS target's screens.
       //
       // 2026-06-26 — the "publish reaches only 1 of N posters" bug. The old
       // query only matched the SAME target (screenId→screenId, group→group),
       // so publishing a playlist to a GROUP deactivated old GROUP schedules
       // but LEFT every member screen's per-screen pin active. The manifest
       // then returned both the new group schedule AND the stale per-screen
       // one, so each poster kept whatever was individually pinned to it —
       // the operator saw the new playlist on at most one screen. Fix:
       // publishing to a group also supersedes the per-screen pins on all of
       // its member screens, so the single group schedule cleanly wins.
       const replaceOr: any[] = [];
       if (body.screenId) replaceOr.push({ screenId: body.screenId });
       if (body.screenGroupId) {
         replaceOr.push({ screenGroupId: body.screenGroupId });
         const members = await this.prisma.client.screen.findMany({
           where: { tenantId: req.user.tenantId, screenGroupId: body.screenGroupId },
           select: { id: true },
         });
         const memberIds = members.map((m) => m.id);
         if (memberIds.length) replaceOr.push({ screenId: { in: memberIds } });
       }
       if (replaceOr.length) {
         await this.prisma.client.schedule.updateMany({
           where: { tenantId: req.user.tenantId, isActive: true, OR: replaceOr },
           data: { isActive: false },
         });
       }
    }

    // Validate and normalize mode
    const mode = body.mode || 'replace';
    if (!['append', 'replace'].includes(mode)) {
      throw new HttpException('Mode must be "append" or "replace"', HttpStatus.BAD_REQUEST);
    }

    // 2026-05-05 — operator: "i only selected 2 displays and it
    // created 4 different schedules for some reason".
    //
    // Each (playlistId, target) combination should resolve to at
    // most ONE Schedule row. The previous deactivate-only logic
    // soft-disabled OTHER playlists' schedules but appended a fresh
    // row for THIS playlist on every republish — leaving stale
    // inactive duplicates piling up in the schedule list every
    // time the operator hit Publish.
    //
    // Hard-delete prior (playlist, target) rows so a republish
    // becomes a true upsert. The Schedule row itself has no audit
    // value — the AuditLog table records "operator scheduled
    // playlist X on screen Y" separately and survives this delete.
    //
    // Applies to BOTH replace and append modes: today's UI has one
    // time-window-per-schedule, so multi-window-on-same-target
    // isn't a supported workflow; collapsing to a single row is
    // strictly cleaner.
    if (body.playlistId && (body.screenId || body.screenGroupId)) {
      await this.prisma.client.schedule.deleteMany({
        where: {
          tenantId: req.user.tenantId,
          playlistId: body.playlistId,
          ...(body.screenId
            ? { screenId: body.screenId }
            : { screenId: null }),
          ...(body.screenGroupId
            ? { screenGroupId: body.screenGroupId }
            : { screenGroupId: null }),
        },
      });
    }

    const res = await this.prisma.client.schedule.create({
      data: {
        tenantId: req.user.tenantId,
        playlistId: body.playlistId,
        screenGroupId: body.screenGroupId || undefined,
        screenId: body.screenId || undefined,
        startTime: new Date(body.startTime),
        endTime: body.endTime ? new Date(body.endTime) : null,
        daysOfWeek: body.daysOfWeek || null,
        timeStart: body.timeStart || null,
        timeEnd: body.timeEnd || null,
        priority: body.priority ?? 0,
        mode: mode,
        // 2026-05-05 — accept null/true/false; null = honor item-level.
        mutedOverride: body.mutedOverride === undefined ? null : body.mutedOverride,
        isActive: willBeActive,
      },
      include: {
        playlist: { select: { id: true, name: true } },
        screenGroup: { select: { id: true, name: true } },
        screen: { select: { id: true, name: true } },
      },
    });
    // Only nudge players when the new schedule is actually live.
    // Drafts don't affect the running fleet so there's no reason to
    // wake every player up to re-sync.
    if (willBeActive) {
      this.notifySync(req.user.tenantId);
    }

    // Org-wide approval gate: when ON and the actor is a CONTRIBUTOR,
    // auto-create a Submission so the staged draft actually lands in the
    // admin review queue (instead of sitting as an orphan draft the
    // contributor would have to manually "Send for review"). This is the
    // forced-approval enforcement — it reuses the existing submit-for-
    // review module (the same Submission table whose approval flow flips
    // isActive→true), so we never built a parallel review system.
    if (routeThroughReview) {
      await this.routeScheduleThroughReview(req, res);
      // Signal the UI to message "sent for review" instead of "published."
      return { ...res, pendingReview: true };
    }

    return res;
  }

  /**
   * Bundle a freshly-staged draft schedule into a Submission and notify
   * every admin in the tenant so it can't sit unseen in the queue. Mirrors
   * submissions.controller.ts create() (auto-notify-all-admins branch).
   * Best-effort notifications; the submission + audit row are the
   * load-bearing writes.
   */
  private async routeScheduleThroughReview(req: any, schedule: any) {
    const tenantId = req.user.tenantId as string;
    const userId = req.user.userId as string;

    const admins = await this.prisma.client.user.findMany({
      where: {
        tenantId,
        role: { in: [AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN] },
      },
      select: { id: true },
    });
    const reviewerIds = admins.map((a) => a.id);

    const submission = await this.prisma.client.submission.create({
      data: {
        tenantId,
        submittedById: userId,
        status: 'PENDING',
        note: null,
        // CSV columns (see submissions.controller.ts shape/fromCsv).
        notifyUserIds: reviewerIds.join(','),
        assetIds: '',
        playlistIds: schedule.playlistId || '',
        scheduleIds: schedule.id,
      },
    });

    await this.prisma.client.auditLog
      .create({
        data: {
          tenantId,
          userId,
          action: 'SUBMISSION_CREATED',
          targetType: 'Submission',
          targetId: submission.id,
          details: JSON.stringify({
            via: 'content_approval_gate',
            scheduleId: schedule.id,
            playlistId: schedule.playlistId || null,
          }),
        },
      })
      .catch(() => {});

    for (const reviewerId of reviewerIds) {
      this.notify
        .notify({
          tenantId,
          userId: reviewerId,
          kind: 'INFO',
          title: 'New submission awaiting your review',
          body: 'A schedule was submitted for approval before it can go live.',
          link: `/reviews?id=${submission.id}`,
          dedupeKey: `sub-create-${submission.id}-${reviewerId}`,
        })
        .catch(() => {});
    }

    return submission;
  }

  @Put(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ScheduleUpdateSchema)) body: ScheduleUpdateInput,
  ) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!schedule) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    // auth-BUG-003: same cross-tenant validation as create — when a
    // PUT body re-targets the schedule at a different screen or group
    // we must confirm the new id belongs to this tenant. A bare string
    // (with no truthy id) clears the field and is fine.
    if (body.playlistId) {
      const playlistOwned = await this.prisma.client.playlist.findFirst({
        where: { id: body.playlistId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!playlistOwned) {
        throw new HttpException('Playlist not found', HttpStatus.NOT_FOUND);
      }
    }
    if (body.screenId) {
      const screenOwned = await this.prisma.client.screen.findFirst({
        where: { id: body.screenId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!screenOwned) {
        throw new HttpException('Screen not found', HttpStatus.NOT_FOUND);
      }
    }
    if (body.screenGroupId) {
      const groupOwned = await this.prisma.client.screenGroup.findFirst({
        where: { id: body.screenGroupId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!groupOwned) {
        throw new HttpException('Screen group not found', HttpStatus.NOT_FOUND);
      }
    }

    const data: any = {};
    if (body.playlistId !== undefined && body.playlistId) data.playlistId = body.playlistId;
    if (body.screenGroupId !== undefined) { data.screenGroupId = body.screenGroupId || null; data.screenId = null; }
    if (body.screenId !== undefined) { data.screenId = body.screenId || null; data.screenGroupId = null; }
    if (body.daysOfWeek !== undefined) data.daysOfWeek = body.daysOfWeek || null;
    if (body.timeStart !== undefined) data.timeStart = body.timeStart || null;
    if (body.timeEnd !== undefined) data.timeEnd = body.timeEnd || null;
    if (body.priority !== undefined) data.priority = body.priority;
    // 2026-05-05 — explicit undefined check so a caller passing null
    // can CLEAR the override (back to per-item behavior). Without the
    // explicit check `body.mutedOverride || null` would coerce false
    // to null and lose the "force unmuted" state.
    if (body.mutedOverride !== undefined) data.mutedOverride = body.mutedOverride;

    const res = await this.prisma.client.schedule.update({
      where: { id },
      data,
      include: {
        playlist: { select: { id: true, name: true } },
        screenGroup: { select: { id: true, name: true } },
        screen: { select: { id: true, name: true } },
      },
    });
    this.notifySync(req.user.tenantId);
    return res;
  }

  @Put(':id/toggle')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async toggle(@Request() req: any, @Param('id') id: string) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!schedule) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    // 2026-05-23 launch audit P1: toggling a schedule active/inactive
    // directly controls what every screen plays at a given time —
    // audit-worthy. Transactional with the update so a partial state
    // is impossible.
    const res = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.schedule.update({
        where: { id },
        data: { isActive: !schedule.isActive },
        include: {
          playlist: { select: { id: true, name: true } },
          screenGroup: { select: { id: true, name: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user.id,
          action: 'SCHEDULE_TOGGLED',
          targetType: 'Schedule',
          targetId: id,
          details: JSON.stringify({
            isActive: updated.isActive,
            playlistId: schedule.playlistId,
            screenId: schedule.screenId,
            screenGroupId: schedule.screenGroupId,
          }),
        },
      });
      return updated;
    });
    this.notifySync(req.user.tenantId);
    return res;
  }

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!schedule) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    // 2026-05-23 launch audit P1: schedule delete previously had no
    // forensic trail. Audit + delete in one transaction so partial
    // state is impossible.
    await this.prisma.client.$transaction(async (tx) => {
      await tx.schedule.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user.id,
          action: 'SCHEDULE_DELETED',
          targetType: 'Schedule',
          targetId: id,
          details: JSON.stringify({
            playlistId: schedule.playlistId,
            screenId: schedule.screenId,
            screenGroupId: schedule.screenGroupId,
            wasActive: schedule.isActive,
          }),
        },
      });
    });
    this.notifySync(req.user.tenantId);
    return { deleted: true };
  }
}
