/**
 * SYNTHETIC EMERGENCY DRILL — the owner's permission (2026-11-10).
 *
 * The owner's rule: no test alert reaches a screen unless the owner said yes
 * to THAT test, and never on a timer in the middle of the day. So the drill
 * has no schedule any more. A pass runs only when a SUPER_ADMIN approves it
 * here, at the time that person names, on the screens that person was shown.
 * One approval is one pass.
 *
 *   GET  /api/v1/super/emergency-drill          what is armed, on which screens, what is approved
 *   POST /api/v1/super/emergency-drill/approve  { runAt?: ISO } — one pass, now or at a time ≤ 24 h ahead
 *   POST /api/v1/super/emergency-drill/revoke   take every open permission back (stops a pass between screens)
 *
 * SUPER_ADMIN only, no panic bypass. Every approval and every revoke is an
 * append-only audit row naming who did it (`EMERGENCY_DRILL_APPROVED` /
 * `EMERGENCY_DRILL_APPROVAL_REVOKED`), written in the bench organisation the
 * screens belong to. The runner reads those rows fresh before every dispatch
 * and checks the approver is still an active SUPER_ADMIN; anything it cannot
 * read is "not approved".
 *
 * This route cannot widen anything: it approves only screens already listed
 * in EMERGENCY_DRILL_SCREENS whose organisation root is internal, it cannot
 * trigger or clear an alert itself, and it refuses when the drill is not armed.
 */
import { Body, Controller, Get, HttpException, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RbacGuard } from '../../auth/rbac.guard';
import { RequireRoles } from '../../auth/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DRILL_APPROVAL,
  DRILL_APPROVAL_REVOKED_ACTION,
  DRILL_APPROVED_ACTION,
  DrillApprovalRevokedDetailsSchema,
  DrillApprovedDetailsSchema,
  approvalWindow,
  isLiveApprover,
  type DrillApprovedDetails,
} from './synthetic-drill.policy';
import { SyntheticDrillRunner } from './synthetic-drill.runner';

const ApproveBody = z.object({ runAt: z.string().max(40).optional() }).strict();

function refuse(status: HttpStatus, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

@Controller('api/v1/super/emergency-drill')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
export class SyntheticDrillApprovalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: SyntheticDrillRunner,
  ) {}

  @Get()
  async status() {
    const cfg = this.runner.config();
    const screens = await this.runner.listedScreens();
    const roots = [...new Set(screens.filter((s) => s.rootInternal === true).map((s) => s.rootTenantId))];
    const open = (await this.runner.readOpenApprovals(roots)) ?? [];
    const nowMs = this.runner.now();
    return {
      armed: cfg.enabled,
      disabledReason: cfg.disabledReason,
      mode: cfg.mode,
      nowMs,
      maxAheadMs: DRILL_APPROVAL.MAX_AHEAD_MS,
      windowMs: DRILL_APPROVAL.WINDOW_MS,
      screens: screens.map((s) => ({ id: s.id, name: s.name, eligible: s.rootInternal === true })),
      approvals: open.map((a) => ({
        approvalId: a.approvalId,
        runAtMs: a.runAtMs,
        expiresAtMs: a.expiresAtMs,
        screenCount: a.screenIds.length,
        state: nowMs >= a.runAtMs ? 'running' : 'waiting',
      })),
    };
  }

  @Post('approve')
  async approve(@Req() req: any, @Body() body: unknown) {
    const parsed = ApproveBody.safeParse(body ?? {});
    if (!parsed.success) refuse(HttpStatus.BAD_REQUEST, 'DRILL_APPROVAL_INVALID', 'Send only an optional runAt time.');
    const cfg = this.runner.config();
    if (!cfg.enabled) refuse(HttpStatus.CONFLICT, 'DRILL_NOT_ARMED', `The drill is off (${cfg.disabledReason}). Nothing was approved.`);

    const nowMs = this.runner.now();
    const requested = parsed.data.runAt === undefined ? null : Date.parse(parsed.data.runAt);
    const window = approvalWindow(requested, nowMs);
    if (!window.ok) refuse(HttpStatus.BAD_REQUEST, 'DRILL_APPROVAL_TIME', `Start time refused (${window.reason}): choose now or a time in the next 24 hours.`);

    // The approver, read fresh — the token alone is not enough for this.
    const userId = String(req.user?.id ?? req.user?.sub ?? '');
    const approverTenantId = String(req.user?.tenantId ?? '');
    if (!userId || !approverTenantId) refuse(HttpStatus.FORBIDDEN, 'DRILL_APPROVER', 'Only a signed-in owner account can approve a drill.');
    const approver = await this.prisma.client.user.findFirst({
      where: { id: userId, tenantId: approverTenantId },
      select: { role: true, status: true, deletedAt: true },
    });
    if (!isLiveApprover(approver)) refuse(HttpStatus.FORBIDDEN, 'DRILL_APPROVER', 'Only an active owner account can approve a drill.');

    const screens = (await this.runner.listedScreens()).filter((s) => s.rootInternal === true);
    if (screens.length === 0) refuse(HttpStatus.CONFLICT, 'DRILL_NO_BENCH_SCREENS', 'No listed screen sits under an internal organisation. Nothing was approved.');
    const roots = [...new Set(screens.map((s) => s.rootTenantId))];

    // One permission at a time: a second one would be a second pass nobody watched being asked for.
    const open = await this.runner.readOpenApprovals(roots);
    if (open === null) refuse(HttpStatus.SERVICE_UNAVAILABLE, 'DRILL_APPROVALS_UNREADABLE', 'Could not read the existing approvals. Nothing was approved.');
    if (open.length > 0) refuse(HttpStatus.CONFLICT, 'DRILL_ALREADY_APPROVED', 'A drill is already approved. Cancel it first to approve a different one.');

    const approvalId = randomUUID();
    const details = (rootTenantId: string): DrillApprovedDetails =>
      DrillApprovedDetailsSchema.parse({
        v: 1,
        approvalId,
        runAtMs: window.runAtMs,
        expiresAtMs: window.expiresAtMs,
        screenIds: screens.filter((s) => s.rootTenantId === rootTenantId).map((s) => s.id),
        approverUserId: userId,
        approverTenantId,
      });
    await this.prisma.client.$transaction(
      roots.map((rootTenantId) =>
        this.prisma.client.auditLog.create({
          data: {
            tenantId: rootTenantId,
            userId,
            action: DRILL_APPROVED_ACTION,
            targetType: 'Tenant',
            targetId: rootTenantId,
            details: JSON.stringify(details(rootTenantId)),
          },
        }),
      ),
    );
    return { approved: true, approvalId, runAtMs: window.runAtMs, expiresAtMs: window.expiresAtMs, screenCount: screens.length };
  }

  @Post('revoke')
  async revoke(@Req() req: any) {
    const userId = String(req.user?.id ?? req.user?.sub ?? '');
    if (!userId) refuse(HttpStatus.FORBIDDEN, 'DRILL_APPROVER', 'Only a signed-in owner account can cancel a drill.');
    const screens = await this.runner.listedScreens();
    const roots = [...new Set(screens.map((s) => s.rootTenantId))];
    const open = await this.runner.readOpenApprovals(roots);
    if (open === null) refuse(HttpStatus.SERVICE_UNAVAILABLE, 'DRILL_APPROVALS_UNREADABLE', 'Could not read the approvals. Nothing was changed.');
    if (open.length === 0 || roots.length === 0) return { revoked: 0 };
    // One revoke row per approval in every bench organisation: whichever row the runner reads, it sees the cancel.
    await this.prisma.client.$transaction(
      open.flatMap((a) =>
        roots.map((rootTenantId) =>
          this.prisma.client.auditLog.create({
            data: {
              tenantId: rootTenantId,
              userId,
              action: DRILL_APPROVAL_REVOKED_ACTION,
              targetType: 'Tenant',
              targetId: rootTenantId,
              details: JSON.stringify(DrillApprovalRevokedDetailsSchema.parse({ v: 1, approvalId: a.approvalId, revokedByUserId: userId })),
            },
          }),
        ),
      ),
    );
    return { revoked: open.length };
  }
}
