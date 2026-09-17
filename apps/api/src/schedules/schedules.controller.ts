import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
// CC-2 go-dark fallback — shared with playlists.controller (P0-1 fix,
// launch-sprint Day 1): any path that removes/deactivates schedules must
// run the same protection.
import { reactivateFallbackIfDark as reactivateFallbackIfDarkShared } from './go-dark-fallback';
// Go-live displacement — shared with submissions.controller (approval path,
// 2026-07-03): flipping a staged draft to active must displace competing live
// schedules for the same target exactly as a direct publish does.
import { displaceCompetingActiveSchedules } from './schedule-displacement';
// 2026-09-16 — the shared overlap rule, ported from the web side so the server
// stops promising one thing in the UI and doing another. See the file header.
import { shouldDisplace } from './schedule-window-overlap';
// P5 — reject a "windowed" schedule (a time window with zero days
// selected) at the API boundary; see schedule-window-validation.ts for
// the full semantics. Mirrors the P7 client-side gate
// (apps/web/src/lib/blast-radius.ts reachWarnings) so raw API callers
// (HQ fleet, imports, direct clients) can't create what the UI refuses to.
import {
  assertScheduleWindowIsReachable,
  resolveEffectiveScheduleWindow,
} from './schedule-window-validation';
import {
  ScheduleCreateSchema, type ScheduleCreateInput,
  ScheduleUpdateSchema, type ScheduleUpdateInput,
} from '@cms/api-types';

@Controller('api/v1/schedules')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SchedulesController {
  private readonly auditLogger = new Logger('SchedulesController');

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

  /**
   * Forensic trail for the two schedule mutations that had none (2026-08-03).
   *
   * `toggle` and `remove` already audit inside their transactions, and
   * `update` audits — but ONLY when `isActive` actually flips. So the two
   * most direct answers to "who put this on that screen" were missing:
   *
   *   - CREATE, the publish action itself, wrote no SCHEDULE_CREATED at all
   *     (the only row was SUBMISSION_CREATED on the CONTRIBUTOR draft path).
   *   - a PUT that RE-TARGETS a schedule at a different screen/group, swaps
   *     its playlist, or moves its time window wrote nothing whatsoever.
   *
   * Same row shape as the existing SCHEDULE_TOGGLED / SCHEDULE_DELETED rows.
   * AuditLog carries DB-level immutability triggers, so this goes through
   * the normal Prisma create path.
   *
   * Best-effort (a DB hiccup must never fail an operator's publish) but not
   * silent — a failure logs at warn. The delete/toggle paths that must be
   * atomic keep their in-transaction writes untouched.
   *
   * `req.user` exposes the actor id as `id` on most routes and `userId` on
   * some (the existing PUT audit row reads `userId`), so accept either.
   */
  private async audit(
    req: any,
    action: 'SCHEDULE_CREATED' | 'SCHEDULE_UPDATED',
    scheduleId: string | null,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) return; // defensive — JwtAuthGuard guarantees this
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: req?.user?.id ?? req?.user?.userId ?? null,
          action,
          targetType: 'Schedule',
          targetId: scheduleId,
          details: JSON.stringify(details),
        },
      });
    } catch (e: any) {
      this.auditLogger.warn(`audit(${action}, ${scheduleId}) failed: ${e?.message ?? e}`);
    }
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
      throw new HttpException({ code: 'SCHEDULE_TARGET_REQUIRED', message: 'Either screenGroupId or screenId must be specified' }, HttpStatus.BAD_REQUEST);
    }

    // P5 — a time-windowed schedule with zero days selected can never run
    // (silent "why isn't my content playing"). Cheap, no-DB-query check —
    // fail fast before the ownership lookups below.
    assertScheduleWindowIsReachable({
      daysOfWeek: body.daysOfWeek,
      timeStart: body.timeStart,
      timeEnd: body.timeEnd,
    });

    // auth-BUG-003: validate every foreign id in the body actually
    // belongs to the caller's tenant before writing. Without these
    // checks Prisma would happily insert a Schedule referencing
    // another tenant's playlist/screen/screenGroup, leaking content
    // across tenants. Mirrors submissions.controller.ts:78-89 pattern.
    if (!body.playlistId) {
      throw new HttpException({ code: 'SCHEDULE_PLAYLIST_ID_REQUIRED', message: 'playlistId is required' }, HttpStatus.BAD_REQUEST);
    }
    const playlistOwned = await this.prisma.client.playlist.findFirst({
      where: { id: body.playlistId, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!playlistOwned) {
      throw new HttpException({ code: 'SCHEDULE_PLAYLIST_NOT_FOUND', message: 'Playlist not found' }, HttpStatus.NOT_FOUND);
    }
    if (body.screenId) {
      const screenOwned = await this.prisma.client.screen.findFirst({
        where: { id: body.screenId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!screenOwned) {
        throw new HttpException({ code: 'SCHEDULE_SCREEN_NOT_FOUND', message: 'Screen not found' }, HttpStatus.NOT_FOUND);
      }
    }
    if (body.screenGroupId) {
      const groupOwned = await this.prisma.client.screenGroup.findFirst({
        where: { id: body.screenGroupId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!groupOwned) {
        throw new HttpException({ code: 'SCHEDULE_SCREEN_GROUP_NOT_FOUND', message: 'Screen group not found' }, HttpStatus.NOT_FOUND);
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
       //
       // 2026-07-03 — extracted to displaceCompetingActiveSchedules so the
       // submit-for-review APPROVAL path (submissions.controller.decide) runs
       // the IDENTICAL displacement when it flips a staged draft to active.
       // Passing this.prisma.client as `tx` keeps this call byte-identical to
       // the old inline block.
       await displaceCompetingActiveSchedules(this.prisma.client, {
         tenantId: req.user.tenantId,
         screenId: body.screenId || null,
         screenGroupId: body.screenGroupId || null,
         // 2026-09-16 — the window this publish will occupy. Displacement now
         // stands down only the rules that actually OVERLAP it, so breakfast /
         // lunch / dinner coexist on one screen exactly as Greg described the
         // rule. The fallback tier (always-on at a negative priority) is exempt
         // in both directions — it is the safety net for the uncovered hours.
         incoming: {
           daysOfWeek: body.daysOfWeek ?? null,
           timeStart: body.timeStart ?? null,
           timeEnd: body.timeEnd ?? null,
           priority: body.priority ?? 0,
         },
       });
    }

    // Validate and normalize mode
    const mode = body.mode || 'replace';
    if (!['append', 'replace'].includes(mode)) {
      throw new HttpException({ code: 'SCHEDULE_MODE_INVALID', message: 'Mode must be "append" or "replace"' }, HttpStatus.BAD_REQUEST);
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
    //
    // 2026-06-26 — content-integrity data-loss guard. A DRAFT/pending
    // submission (every CONTRIBUTOR stage, plus any saved-draft) must
    // NEVER hard-delete a DIFFERENT actor's LIVE (isActive=true)
    // schedule for the same (playlist, target). Without this scope a
    // low-privilege Editor could silently wipe an admin's published
    // schedule just by drafting a competing one for the same screen.
    // So: when THIS write is staged as a draft (willBeActive=false),
    // restrict the upsert-cleanup to other DRAFT rows only — the live
    // schedule survives untouched until the draft is approved and goes
    // live through the normal publish path. When THIS write IS going
    // live (an admin publish, or an approval flipping a draft active),
    // the displacement step above has already deactivated competing
    // actives, so collapsing every prior (playlist, target) row to one
    // is the intended publish behavior and stays unrestricted.
    if (body.playlistId && (body.screenId || body.screenGroupId)) {
      // 2026-09-16 — WINDOW-AWARE. This used to collapse EVERY prior
      // (playlist, target) row into one, which silently undid the displacement
      // fix above and made "multiple schedules on one playlist" impossible —
      // the very thing the Schedule dialog offers ("i should be able to have
      // multiple schedules but not overlapping each other on the same
      // playlist"). Now only the rows whose window collides with the incoming
      // one are collapsed; a non-overlapping sibling window survives.
      const cleanupWhere: any = {
          tenantId: req.user.tenantId,
          playlistId: body.playlistId,
          ...(body.screenId
            ? { screenId: body.screenId }
            : { screenId: null }),
          ...(body.screenGroupId
            ? { screenGroupId: body.screenGroupId }
            : { screenGroupId: null }),
          // Draft staging only ever cleans up other drafts — never a
          // live schedule (which may belong to an admin). Live publishes
          // collapse everything as before.
          ...(willBeActive ? {} : { isActive: false }),
      };
      const priorRows = await this.prisma.client.schedule.findMany({
        where: cleanupWhere,
        select: { id: true, daysOfWeek: true, timeStart: true, timeEnd: true, priority: true },
      });
      const collapsing = (priorRows ?? [])
        .filter((r: any) =>
          shouldDisplace(r, {
            daysOfWeek: body.daysOfWeek ?? null,
            timeStart: body.timeStart ?? null,
            timeEnd: body.timeEnd ?? null,
            priority: body.priority ?? 0,
          }),
        )
        .map((r: any) => r.id);
      if (collapsing.length) {
        await this.prisma.client.schedule.deleteMany({ where: { id: { in: collapsing } } });
      }
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
    // The publish action itself — previously invisible in forensics. Audit
    // BOTH the live publish and the staged draft (a draft is what an
    // approval later flips live, so the chain must start here).
    await this.audit(req, 'SCHEDULE_CREATED', res.id, {
      playlistId: res.playlistId,
      playlistName: (res as any).playlist?.name ?? null,
      screenId: res.screenId,
      screenGroupId: res.screenGroupId,
      isActive: res.isActive,
      staged: !willBeActive,
      mode,
      startTime: res.startTime,
      endTime: res.endTime,
      daysOfWeek: res.daysOfWeek,
      timeStart: res.timeStart,
      timeEnd: res.timeEnd,
      priority: res.priority,
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

    // P1 (launch-sprint Day 1, 2026-07-01): the audit write MUST NOT be
    // swallowed — same rationale as the playlist-delete hardening (a
    // privileged action with no forensic trail is worse than surfacing the
    // failure). Reviewer NOTIFICATIONS below stay best-effort by design.
    await this.prisma.client.auditLog.create({
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
    });

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

  /**
   * CC-2 (2026-06-27 launch beta) — a screen must NEVER silently go dark.
   *
   * Publishing a schedule deactivates the prior active one for the same
   * target; DELETING (or deactivating) that survivor used to leave the
   * target with ZERO active schedules → the manifest resolver
   * (screens.controller `:id/manifest`, the `isActive: true` query) returned
   * an EMPTY playlist set → the physical screen went BLANK.
   *
   * This helper runs AFTER a delete / deactivate. If the just-removed
   * schedule's EXACT target (same screenId, or same screenGroupId) now has
   * no active schedule left BUT other (inactive) schedules still exist for
   * that same target, it re-activates the next-best one — highest priority,
   * most-recent startTime as tiebreak (there is no updatedAt column on
   * Schedule). It writes a SCHEDULE_AUTO_REACTIVATED AuditLog row so the
   * fallback is forensically traceable.
   *
   * SAFETY:
   *  - Same-tenant only (the where clause is always tenant-scoped) — never
   *    auto-activate across tenants.
   *  - Same-target only (exact screenId OR exact screenGroupId match) — we
   *    deliberately do NOT promote a group schedule onto a per-screen pin or
   *    vice-versa; that cross-target precedence is the operator's call, not
   *    an automatic one. The common case the operator hits (publish A then B
   *    to the same screen, then delete B) is exactly a same-target promotion.
   *  - Idempotent: if an active schedule already covers the target, it does
   *    nothing.
   *  - Runs inside the caller's transaction (`tx`) so the delete/deactivate
   *    and the fallback commit atomically — a screen is never momentarily
   *    dark between the two writes.
   *
   * Returns the id of the schedule it re-activated, or null.
   */
  private async reactivateFallbackIfDark(
    tx: any,
    opts: {
      tenantId: string;
      userId: string | null;
      screenId: string | null;
      screenGroupId: string | null;
      removedScheduleId: string;
    },
  ): Promise<string | null> {
    // Logic extracted to the shared helper (launch-sprint Day 1 P0-1) so the
    // playlist-delete door — which hard-deletes attached schedules — runs the
    // EXACT same protection. Any new code path that removes/deactivates
    // schedules must import reactivateFallbackIfDark from ./go-dark-fallback.
    return reactivateFallbackIfDarkShared(tx, opts);
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
    if (!schedule) throw new HttpException({ code: 'SCHEDULE_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // P5 — same "can never run" guard as create(), evaluated against the
    // EFFECTIVE post-update state: a PUT can touch just one of
    // daysOfWeek/timeStart/timeEnd and leave the others at whatever is
    // already on the row, so validate the merge — not just this request's
    // fields — or a two-step edit slips a zero-day windowed schedule past
    // both PUTs individually.
    assertScheduleWindowIsReachable(
      resolveEffectiveScheduleWindow(body, schedule),
    );

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
        throw new HttpException({ code: 'SCHEDULE_PLAYLIST_NOT_FOUND', message: 'Playlist not found' }, HttpStatus.NOT_FOUND);
      }
    }
    if (body.screenId) {
      const screenOwned = await this.prisma.client.screen.findFirst({
        where: { id: body.screenId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!screenOwned) {
        throw new HttpException({ code: 'SCHEDULE_SCREEN_NOT_FOUND', message: 'Screen not found' }, HttpStatus.NOT_FOUND);
      }
    }
    if (body.screenGroupId) {
      const groupOwned = await this.prisma.client.screenGroup.findFirst({
        where: { id: body.screenGroupId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!groupOwned) {
        throw new HttpException({ code: 'SCHEDULE_SCREEN_GROUP_NOT_FOUND', message: 'Screen group not found' }, HttpStatus.NOT_FOUND);
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

    // PUT now honors isActive (admin-only endpoint), so the live/draft state
    // is no longer ONLY flippable via /toggle — that silent inconsistency
    // confused operators. We mirror /toggle's discipline exactly: when the
    // active state actually CHANGES, audit it AND (on a deactivation) run the
    // go-dark fallback, all inside one transaction so partial state and a
    // momentarily-blank screen are both impossible.
    const isActiveChanging =
      body.isActive !== undefined && body.isActive !== schedule.isActive;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    // The effective target AFTER this update — a PUT may also re-target the
    // schedule, so the fallback must reason about where it ends up living.
    const effectiveScreenId =
      data.screenId !== undefined ? data.screenId : schedule.screenId;
    const effectiveScreenGroupId =
      data.screenGroupId !== undefined ? data.screenGroupId : schedule.screenGroupId;

    const res = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.schedule.update({
        where: { id, tenantId: req.user.tenantId },
        data,
        include: {
          playlist: { select: { id: true, name: true } },
          screenGroup: { select: { id: true, name: true } },
          screen: { select: { id: true, name: true } },
        },
      });

      if (isActiveChanging) {
        await tx.auditLog.create({
          data: {
            tenantId: req.user.tenantId,
            userId: req.user.userId ?? null,
            action: 'SCHEDULE_TOGGLED',
            targetType: 'Schedule',
            targetId: id,
            details: JSON.stringify({
              isActive: updated.isActive,
              via: 'put',
              playlistId: updated.playlistId,
              screenId: updated.screenId,
              screenGroupId: updated.screenGroupId,
            }),
          },
        });

        // Deactivating via PUT can take a screen off the air exactly like
        // /toggle or delete — apply the same fallback.
        if (updated.isActive === false) {
          await this.reactivateFallbackIfDark(tx, {
            tenantId: req.user.tenantId,
            userId: req.user.userId ?? null,
            screenId: effectiveScreenId,
            screenGroupId: effectiveScreenGroupId,
            removedScheduleId: id,
          });
        }
      }

      return updated;
    });

    // Everything a PUT can change OTHER than isActive — re-targeting the
    // schedule at a different screen/group, swapping its playlist, moving
    // its time window — previously left NO trail at all: the only audit row
    // this handler wrote was SCHEDULE_TOGGLED, and only when the active
    // state actually flipped. Re-pointing a live schedule at another screen
    // is precisely "who changed what is on that screen", so record the
    // before/after of every field the request actually touched. Skipped
    // when the PUT changed nothing but isActive (already audited above).
    const changedFields = Object.keys(data).filter((k) => k !== 'isActive');
    if (changedFields.length > 0) {
      await this.audit(req, 'SCHEDULE_UPDATED', id, {
        changedFields,
        before: Object.fromEntries(
          changedFields.map((k) => [k, (schedule as any)[k] ?? null]),
        ),
        after: Object.fromEntries(
          changedFields.map((k) => [k, (res as any)[k] ?? null]),
        ),
        isActive: res.isActive,
      });
    }

    this.notifySync(req.user.tenantId);
    return res;
  }

  @Put(':id/toggle')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async toggle(@Request() req: any, @Param('id') id: string) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!schedule) throw new HttpException({ code: 'SCHEDULE_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // 2026-05-23 launch audit P1: toggling a schedule active/inactive
    // directly controls what every screen plays at a given time —
    // audit-worthy. Transactional with the update so a partial state
    // is impossible.
    const res = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.schedule.update({
        where: { id, tenantId: req.user.tenantId },
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

      // CC-2: toggling a schedule OFF can take the screen off the air the
      // same way a delete can. If this deactivation left the target with no
      // active schedule, promote the next-best inactive one (same target)
      // so the screen never goes dark.
      if (!updated.isActive) {
        await this.reactivateFallbackIfDark(tx, {
          tenantId: req.user.tenantId,
          userId: req.user.userId ?? null,
          screenId: schedule.screenId,
          screenGroupId: schedule.screenGroupId,
          removedScheduleId: id,
        });
      }
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
    if (!schedule) throw new HttpException({ code: 'SCHEDULE_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // 2026-05-23 launch audit P1: schedule delete previously had no
    // forensic trail. Audit + delete in one transaction so partial
    // state is impossible.
    await this.prisma.client.$transaction(async (tx) => {
      await tx.schedule.delete({ where: { id, tenantId: req.user.tenantId } });
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

      // CC-2: if this delete just removed the LAST active schedule for the
      // target, promote the next-best inactive one so the screen never goes
      // dark. Only matters when the deleted schedule was the live one —
      // deleting a draft can't take a screen off the air. Same transaction,
      // so the screen is never momentarily blank.
      if (schedule.isActive) {
        await this.reactivateFallbackIfDark(tx, {
          tenantId: req.user.tenantId,
          userId: req.user.userId ?? null,
          screenId: schedule.screenId,
          screenGroupId: schedule.screenGroupId,
          removedScheduleId: id,
        });
      }
    });
    this.notifySync(req.user.tenantId);
    return { deleted: true };
  }
}
