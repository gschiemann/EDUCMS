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
    @Body() body: {
      note?: string;
      notifyUserIds?: string[];
      assetIds?: string[];
      playlistIds?: string[];
      scheduleIds?: string[];
    },
  ) {
    const tenantId = req.user.tenantId as string;
    const userId = req.user.id as string;
    const assetIds = body.assetIds || [];
    const playlistIds = body.playlistIds || [];
    const scheduleIds = body.scheduleIds || [];

    if (!assetIds.length && !playlistIds.length && !scheduleIds.length) {
      throw new HttpException('Submission must include at least one asset, playlist, or schedule.', HttpStatus.BAD_REQUEST);
    }

    // Tenant-isolation check on every referenced id. Without this, a
    // CONTRIBUTOR could pass another tenant's playlist id and the
    // reviewer panel would render it.
    if (assetIds.length) {
      const owned = await this.prisma.client.asset.count({ where: { id: { in: assetIds }, tenantId } });
      if (owned !== assetIds.length) throw new HttpException('One or more assets are not in this tenant.', HttpStatus.FORBIDDEN);
    }
    if (playlistIds.length) {
      const owned = await this.prisma.client.playlist.count({ where: { id: { in: playlistIds }, tenantId } });
      if (owned !== playlistIds.length) throw new HttpException('One or more playlists are not in this tenant.', HttpStatus.FORBIDDEN);
    }
    if (scheduleIds.length) {
      const owned = await this.prisma.client.schedule.count({ where: { id: { in: scheduleIds }, tenantId } });
      if (owned !== scheduleIds.length) throw new HttpException('One or more schedules are not in this tenant.', HttpStatus.FORBIDDEN);
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
    if (!sub) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    if (!isAdmin && sub.submittedById !== userId) {
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
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
  async approve(@Request() req: any, @Param('id') id: string, @Body() body: { reviewerNote?: string }) {
    return this.decide(req, id, 'APPROVED', body?.reviewerNote);
  }

  /** Reject a pending submission. Records reviewer feedback + audits. */
  @Post(':id/reject')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async reject(@Request() req: any, @Param('id') id: string, @Body() body: { reviewerNote?: string }) {
    return this.decide(req, id, 'REJECTED', body?.reviewerNote);
  }

  // ─── private ──────────────────────────────────────────────────────

  private async decide(req: any, id: string, decision: 'APPROVED' | 'REJECTED', reviewerNote?: string) {
    const tenantId = req.user.tenantId as string;
    const userId = req.user.id as string;
    const sub = await this.prisma.client.submission.findFirst({ where: { id, tenantId } });
    if (!sub) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    if (sub.status !== 'PENDING') throw new HttpException(`Already ${sub.status}`, HttpStatus.CONFLICT);

    const aIds = fromCsv(sub.assetIds);
    const pIds = fromCsv(sub.playlistIds);
    const sIds = fromCsv(sub.scheduleIds);

    // Approve: publish every bundled asset + activate every bundled
    // schedule. Reject: leave the underlying content alone — the
    // contributor edits + resubmits.
    if (decision === 'APPROVED') {
      const ops: any[] = [];
      if (aIds.length) {
        ops.push(this.prisma.client.asset.updateMany({ where: { id: { in: aIds }, tenantId, status: 'PENDING_APPROVAL' }, data: { status: 'PUBLISHED' } }));
      }
      if (sIds.length) {
        ops.push(this.prisma.client.schedule.updateMany({ where: { id: { in: sIds }, tenantId }, data: { isActive: true } }));
      }
      if (ops.length) await this.prisma.client.$transaction(ops);
    }

    const updated = await this.prisma.client.submission.update({
      where: { id },
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
