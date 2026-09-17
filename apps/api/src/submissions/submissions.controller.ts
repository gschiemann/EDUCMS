/**
 * Submissions controller — Sprint 1.5 submit-for-review workflow.
 *
 * CONTRIBUTOR creates draft assets/playlists/schedules, bundles them
 * into a Submission with selected admin reviewers, and submits.
 * Reviewers see PENDING submissions, drill in to preview the bundled
 * content, then Approve or Reject (with feedback).
 *
 * Approve effects (intended):
 *   - Asset.status PENDING_APPROVAL → PUBLISHED on every bundled asset
 *   - Schedule.isActive false → true on every bundled schedule
 *   - AuditLog row written
 *   - Submitter notified (in-app + email) of the decision
 *
 * Reject effects:
 *   - Submission.status → REJECTED with reviewerNote
 *   - Bundled assets stay PENDING (reviewer's note tells the
 *     contributor what to fix; they can edit + resubmit)
 *   - AuditLog row + submitter notified
 *
 * Tenant-scoped on every endpoint. RBAC:
 *   - CONTRIBUTOR can create + view own submissions
 *   - SCHOOL_ADMIN / DISTRICT_ADMIN / SUPER_ADMIN can list, view, approve, reject
 */

import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import {
  SubmissionCreateSchema, type SubmissionCreateInput,
  SubmissionDecisionSchema, type SubmissionDecisionInput,
} from '@cms/api-types';
// Go-live displacement — shared with schedules.controller.create(). Approving a
// staged draft flips it isActive=true; it must displace the competing LIVE
// schedule for the same target exactly as a direct publish does, or the player
// interleaves the old + new playlists. (P1, 2026-07-03.)
import { displaceCompetingActiveSchedules } from '../schedules/schedule-displacement';

/** Comma-separated CSV → string[] (filtered to non-empty). */
const fromCsv = (s: string | null | undefined): string[] =>
  (s || '').split(',').map((x) => x.trim()).filter(Boolean);
const toCsv = (arr: string[] | undefined | null): string =>
  Array.from(new Set((arr || []).map((s) => s.trim()).filter(Boolean))).join(',');

@Controller('api/v1/submissions')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SubmissionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationsService,
  ) {}

  /**
   * Create a new submission. Bundles asset/playlist/schedule ids into
   * one record, validates each id belongs to the tenant, then notifies
   * the picked reviewers.
   */
  @Post()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async create(
    @Request() req: any,
    @Body(new ZodValidationPipe(SubmissionCreateSchema)) body: SubmissionCreateInput,
  ) {
    const tenantId = req.user.tenantId as string;
    const userId = req.user.id as string;
    const assetIds = body.assetIds || [];
    const playlistIds = body.playlistIds || [];
    const scheduleIds = body.scheduleIds || [];

    if (!assetIds.length && !playlistIds.length && !scheduleIds.length) {
      throw new HttpException({ code: 'SUBMISSION_CONTENT_REQUIRED', message: 'Submission must include at least one asset, playlist, or schedule.' }, HttpStatus.BAD_REQUEST);
    }

    // Tenant-isolation check on every referenced id. Without this, a
    // CONTRIBUTOR could pass another tenant's playlist id and the
    // reviewer panel would render it.
    if (assetIds.length) {
      const owned = await this.prisma.client.asset.count({ where: { id: { in: assetIds }, tenantId } });
      if (owned !== assetIds.length) throw new HttpException({ code: 'SUBMISSION_ASSETS_NOT_IN_TENANT', message: 'One or more assets are not in this tenant.' }, HttpStatus.FORBIDDEN);
    }
    if (playlistIds.length) {
      const owned = await this.prisma.client.playlist.count({ where: { id: { in: playlistIds }, tenantId } });
      if (owned !== playlistIds.length) throw new HttpException({ code: 'SUBMISSION_PLAYLISTS_NOT_IN_TENANT', message: 'One or more playlists are not in this tenant.' }, HttpStatus.FORBIDDEN);
    }
    if (scheduleIds.length) {
      const owned = await this.prisma.client.schedule.count({ where: { id: { in: scheduleIds }, tenantId } });
      if (owned !== scheduleIds.length) throw new HttpException({ code: 'SUBMISSION_SCHEDULES_NOT_IN_TENANT', message: 'One or more schedules are not in this tenant.' }, HttpStatus.FORBIDDEN);
    }

    // Notify-user list — must all be admins in the same tenant. Drop
    // any that don't qualify (silently — submitter doesn't need to
    // know which entries we filtered, only that the survivors got the
    // notification).
    const wantedReviewers = body.notifyUserIds || [];
    let validReviewers: string[] = [];
    if (wantedReviewers.length) {
      const admins = await this.prisma.client.user.findMany({
        where: {
          id: { in: wantedReviewers },
          tenantId,
          role: { in: [AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN] },
        },
        select: { id: true },
      });
      validReviewers = admins.map((a) => a.id);
    } else {
      // No explicit reviewer picked (e.g. the playlist wizard's Editor
      // "Send for Review" flow has no reviewer step) → notify EVERY admin in
      // the tenant so the submission can't sit unseen in the queue.
      const admins = await this.prisma.client.user.findMany({
        where: {
          tenantId,
          role: { in: [AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN] },
        },
        select: { id: true },
      });
      validReviewers = admins.map((a) => a.id);
    }

    const submission = await this.prisma.client.submission.create({
      data: {
        tenantId,
        submittedById: userId,
        status: 'PENDING',
        note: body.note?.trim() || null,
        notifyUserIds: toCsv(validReviewers),
        assetIds: toCsv(assetIds),
        playlistIds: toCsv(playlistIds),
        scheduleIds: toCsv(scheduleIds),
      },
    });

    // Audit log + notify each reviewer in parallel. Don't await
    // notifications — they're fire-and-forget so a slow notification
    // service can't stall the submit response.
    this.prisma.client.auditLog
      .create({
        data: {
          tenantId,
          userId,
          action: 'SUBMISSION_CREATED',
          targetType: 'Submission',
          targetId: submission.id,
          details: JSON.stringify({ assetCount: assetIds.length, playlistCount: playlistIds.length, scheduleCount: scheduleIds.length }),
        },
      })
      .catch(() => {});

    for (const reviewerId of validReviewers) {
      this.notify.notify({
        tenantId,
        userId: reviewerId,
        kind: 'INFO',
        title: 'New submission awaiting your review',
        body: body.note?.trim() || `${assetIds.length + playlistIds.length + scheduleIds.length} item(s) submitted for approval.`,
        link: `/reviews?id=${submission.id}`,
        dedupeKey: `sub-create-${submission.id}-${reviewerId}`,
      }).catch(() => {});
    }

    return this.shape(submission);
  }

  /**
   * List submissions. Admins see PENDING by default (their queue);
   * CONTRIBUTOR sees only their own submissions regardless of status
   * (so they can track approvals/rejections from their dashboard).
   */
  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('mine') mine?: string,
  ) {
    const tenantId = req.user.tenantId as string;
    const userId = req.user.id as string;
    const role = req.user.role as string;
    const isAdmin = role === AppRole.SUPER_ADMIN || role === AppRole.DISTRICT_ADMIN || role === AppRole.SCHOOL_ADMIN;

    const onlyMine = mine === '1' || !isAdmin;
    const where: any = { tenantId };
    if (onlyMine) where.submittedById = userId;
    if (status) where.status = status.toUpperCase();
    else if (isAdmin && !onlyMine) where.status = 'PENDING';

    const rows = await this.prisma.client.submission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        submittedBy: { select: { id: true, email: true } },
        decidedBy:   { select: { id: true, email: true } },
      },
      take: 100,
    });
    return rows.map((r) => this.shape(r));
  }

  /**
   * How many submissions are waiting on a reviewer, PER SCHOOL — the number
   * a district admin's dashboard leads with (2026-08-24).
   *
   * ⚠️ MUST stay declared ABOVE `@Get(':id')`. Nest matches routes in
   * declaration order, so moving this below the param route would make
   * `:id` swallow `pending-counts` and 404 every call.
   *
   * SCOPE: the caller's own tenant plus its DIRECT, non-archived children —
   * the same asymmetric, read-only parent→child window `GET /screens/fleet`
   * opens. Children stay sealed from each other; a leaf school calling this
   * gets exactly one row, its own. Counts only — never a submission's
   * content, so the district office learns "Lincoln has 3 waiting", not
   * what is in them.
   *
   * QUERY COST: exactly TWO queries regardless of district size — one
   * findMany for the child ids, one groupBy for the counts (served by the
   * existing `@@index([tenantId, status, createdAt])`). A per-school count()
   * fan-out would be 40 queries on a connection_limit=10 pool.
   */
  @Get('pending-counts')
  // SCHOOL_ADMIN added 2026-08-31 (child-location Fleet Command): the query
  // below is already self-plus-children scoped, which for a leaf admin is
  // just their own tenant's pending counts.
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async pendingCounts(@Request() req: any) {
    const rootId = req.user.tenantId as string;
    const tenants = await this.prisma.client.tenant.findMany({
      where: { OR: [{ id: rootId }, { parentId: rootId, archivedAt: null }] },
      select: { id: true },
    });
    const tenantIds = tenants.map((t) => t.id);
    const rows = await this.prisma.client.submission.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: tenantIds }, status: 'PENDING' },
      _count: { _all: true },
    });
    const byTenant = rows.map((r: any) => ({
      tenantId: r.tenantId as string,
      pending: r._count._all as number,
    }));
    return {
      total: byTenant.reduce((n, r) => n + r.pending, 0),
      byTenant,
    };
  }

  /**
   * Drill-in — full payload with every linked asset/playlist/schedule
   * embedded, so the reviewer doesn't have to chase 6 separate API
   * calls to render the review screen.
   */
  @Get(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async get(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user.tenantId as string;
    const userId = req.user.id as string;
    const role = req.user.role as string;
    const isAdmin = role === AppRole.SUPER_ADMIN || role === AppRole.DISTRICT_ADMIN || role === AppRole.SCHOOL_ADMIN;

    const sub = await this.prisma.client.submission.findFirst({
      where: { id, tenantId },
      include: {
        submittedBy: { select: { id: true, email: true } },
        decidedBy:   { select: { id: true, email: true } },
      },
    });
    if (!sub) throw new HttpException({ code: 'SUBMISSION_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    if (!isAdmin && sub.submittedById !== userId) {
      throw new HttpException({ code: 'SUBMISSION_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    }

    const aIds = fromCsv(sub.assetIds);
    const pIds = fromCsv(sub.playlistIds);
    const sIds = fromCsv(sub.scheduleIds);

    const [assets, playlists, schedules] = await Promise.all([
      aIds.length
        ? this.prisma.client.asset.findMany({ where: { id: { in: aIds }, tenantId } })
        : Promise.resolve([]),
      pIds.length
        ? this.prisma.client.playlist.findMany({
            where: { id: { in: pIds }, tenantId },
            include: { items: { include: { asset: true }, orderBy: { sequenceOrder: 'asc' } } },
          })
        : Promise.resolve([]),
      sIds.length
        ? this.prisma.client.schedule.findMany({
            where: { id: { in: sIds }, tenantId },
            include: { playlist: { select: { id: true, name: true } }, screen: { select: { id: true, name: true } }, screenGroup: { select: { id: true, name: true } } },
          })
        : Promise.resolve([]),
    ]);

    return { ...this.shape(sub), assets, playlists, schedules };
  }

  /** Approve a pending submission. Publishes bundled content + audits. */
  @Post(':id/approve')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async approve(@Request() req: any, @Param('id') id: string, @Body(new ZodValidationPipe(SubmissionDecisionSchema)) body: SubmissionDecisionInput) {
    return this.decide(req, id, 'APPROVED', body?.reviewerNote);
  }

  /** Reject a pending submission. Records reviewer feedback + audits. */
  @Post(':id/reject')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async reject(@Request() req: any, @Param('id') id: string, @Body(new ZodValidationPipe(SubmissionDecisionSchema)) body: SubmissionDecisionInput) {
    return this.decide(req, id, 'REJECTED', body?.reviewerNote);
  }

  // ─── private ──────────────────────────────────────────────────────

  private async decide(req: any, id: string, decision: 'APPROVED' | 'REJECTED', reviewerNote?: string) {
    const tenantId = req.user.tenantId as string;
    const userId = req.user.id as string;
    const sub = await this.prisma.client.submission.findFirst({ where: { id, tenantId } });
    if (!sub) throw new HttpException({ code: 'SUBMISSION_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    if (sub.status !== 'PENDING') throw new HttpException({ code: 'SUBMISSION_ALREADY_DECIDED', message: `Already ${sub.status}` }, HttpStatus.CONFLICT);

    const aIds = fromCsv(sub.assetIds);
    const pIds = fromCsv(sub.playlistIds);
    const sIds = fromCsv(sub.scheduleIds);

    // Approve: publish every bundled asset + activate every bundled
    // schedule. Reject: leave the underlying content alone — the
    // contributor edits + resubmits.
    if (decision === 'APPROVED') {
      // Load the bundled schedules' targets BEFORE the transaction so we can
      // replicate the direct-publish go-live displacement. A bare
      // updateMany({isActive:true}) (the old behavior) flipped the drafts
      // active WITHOUT deactivating the competing LIVE schedule already on
      // the same screen — so approving a draft for playlist B on a screen
      // showing playlist A left BOTH active and the player interleaved them.
      // The normal publish path (schedules.controller.create) runs this same
      // displacement; the approval path must too. (P1, 2026-07-03.)
      const scheduleRows = sIds.length
        ? await this.prisma.client.schedule.findMany({
            where: { id: { in: sIds }, tenantId },
            // 2026-09-16 — the window rides along so the approval path displaces
            // exactly what a direct publish would: only the rules that overlap.
            select: {
              id: true, screenId: true, screenGroupId: true, mode: true,
              daysOfWeek: true, timeStart: true, timeEnd: true, priority: true,
            },
          })
        : [];

      await this.prisma.client.$transaction(async (tx) => {
        if (aIds.length) {
          await tx.asset.updateMany({ where: { id: { in: aIds }, tenantId, status: 'PENDING_APPROVAL' }, data: { status: 'PUBLISHED' } });
        }
        if (scheduleRows.length) {
          // For each approved schedule going live in REPLACE mode, displace
          // the competing active schedules for its target FIRST — exactly as a
          // direct publish would. Append-mode schedules intentionally coexist,
          // so they skip displacement (mirrors create()'s `mode !== 'append'`
          // gate). excludeScheduleId guards the row itself (it's still a draft
          // here, but be defensive about ordering).
          for (const s of scheduleRows) {
            if (s.mode !== 'append') {
              await displaceCompetingActiveSchedules(tx, {
                tenantId,
                screenId: s.screenId,
                screenGroupId: s.screenGroupId,
                excludeScheduleId: s.id,
                incoming: {
                  daysOfWeek: (s as any).daysOfWeek ?? null,
                  timeStart: (s as any).timeStart ?? null,
                  timeEnd: (s as any).timeEnd ?? null,
                  priority: (s as any).priority ?? 0,
                },
              });
            }
          }
          // Now flip every approved draft live — the competing actives are gone.
          await tx.schedule.updateMany({ where: { id: { in: sIds }, tenantId }, data: { isActive: true } });
        }
      });
    }

    const updated = await this.prisma.client.submission.update({
      where: { id, tenantId },
      data: {
        status: decision,
        reviewerNote: reviewerNote?.trim() || null,
        decidedAt: new Date(),
        decidedById: userId,
      },
      include: {
        submittedBy: { select: { id: true, email: true } },
        decidedBy:   { select: { id: true, email: true } },
      },
    });

    this.prisma.client.auditLog
      .create({
        data: {
          tenantId,
          userId,
          action: decision === 'APPROVED' ? 'SUBMISSION_APPROVED' : 'SUBMISSION_REJECTED',
          targetType: 'Submission',
          targetId: id,
          details: JSON.stringify({ reviewerNote: reviewerNote || null, assetCount: aIds.length, playlistCount: pIds.length, scheduleCount: sIds.length }),
        },
      })
      .catch(() => {});

    // Notify the original submitter — they want to know whether their
    // work is live (approved) or what to fix (rejected).
    this.notify
      .notify({
        tenantId,
        userId: sub.submittedById,
        kind: 'INFO',
        title: decision === 'APPROVED' ? 'Your submission was approved' : 'Your submission was rejected',
        body: reviewerNote?.trim() || (decision === 'APPROVED' ? 'Content is now live.' : 'Reviewer left no feedback. Edit and resubmit when ready.'),
        link: `/submissions/${id}`,
        dedupeKey: `sub-decide-${id}`,
      })
      .catch(() => {});

    return this.shape(updated);
  }

  /** Common response shape — exposes CSV columns as arrays. */
  private shape(sub: any) {
    return {
      id: sub.id,
      tenantId: sub.tenantId,
      submittedById: sub.submittedById,
      submittedBy: sub.submittedBy,
      status: sub.status,
      note: sub.note,
      reviewerNote: sub.reviewerNote,
      notifyUserIds: fromCsv(sub.notifyUserIds),
      assetIds: fromCsv(sub.assetIds),
      playlistIds: fromCsv(sub.playlistIds),
      scheduleIds: fromCsv(sub.scheduleIds),
      decidedAt: sub.decidedAt,
      decidedById: sub.decidedById,
      decidedBy: sub.decidedBy,
      createdAt: sub.createdAt,
    };
  }
}
