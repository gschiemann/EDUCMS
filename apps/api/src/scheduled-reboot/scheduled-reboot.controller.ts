/**
 * Scheduled restart policy — one per screen group, opt-in (2026-11-08).
 *
 *   GET    /api/v1/scheduled-reboots/groups/:groupId   policy + each screen's readiness + last result
 *   PUT    /api/v1/scheduled-reboots/groups/:groupId   set (create or replace) the policy
 *   DELETE /api/v1/scheduled-reboots/groups/:groupId   turn it off (row removed)
 *
 * TENANT SCOPE: the group is loaded with `{ id, tenantId }` (and the person's
 * screen scope) before anything is read or written; every policy write is
 * keyed by the group the caller owns. Every configuration change writes an
 * AuditLog row with the before and after. The kill switch
 * (SCHEDULED_REBOOTS_DISABLED=1) refuses writes with 409 and reads say so.
 */
import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AppRole } from '@cms/database';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { DisplayService } from '../display/display.service';
import { hardwareClassOf } from '../player-ota/fleet-push-policy';
import { PrismaService } from '../prisma/prisma.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { scopedGroupWhere } from '../user-scope/user-scope.context';
import {
  isAllowedPolicyTime,
  ownRestartThresholdMs,
  scheduledRebootsDisabled,
  uptimeFrom,
  verdictCanRestart,
} from './scheduled-reboot-policy';
import { SCHEDULED_REBOOT_AUDIT } from './scheduled-reboot.service';

export const ScheduledRebootPolicySchema = z
  .object({
    cadence: z.enum(['DAILY', 'WEEKLY']),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!isAllowedPolicyTime(v.time)) {
      ctx.addIssue({ code: 'custom', path: ['time'], message: 'A scheduled restart runs between 22:00 and 04:59 only.' });
    }
    if (v.cadence === 'WEEKLY' && (v.dayOfWeek === null || v.dayOfWeek === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['dayOfWeek'], message: 'A weekly restart needs a day.' });
    }
  });
export type ScheduledRebootPolicyInput = z.infer<typeof ScheduledRebootPolicySchema>;

const POLICY_FIELDS = { id: true, cadence: true, dayOfWeek: true, time: true, isActive: true, updatedAt: true } as const;

@Controller('api/v1/scheduled-reboots')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ScheduledRebootController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly display: DisplayService,
  ) {}

  @Get('groups/:groupId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async get(@Param('groupId') groupId: string, @Req() req: any) {
    const tenantId = this.requireTenant(req);
    await this.loadGroup(tenantId, groupId, req);
    const policy = await this.prisma.client.screenRebootPolicy.findFirst({
      where: { tenantId, screenGroupId: groupId },
      select: POLICY_FIELDS,
    });
    const screens = (await this.prisma.client.screen.findMany({
      where: { tenantId, screenGroupId: groupId },
      select: {
        id: true,
        name: true,
        hardwareModel: true,
        lastVideoReport: true,
        displayCapabilities: true,
        nativeRuntimeReport: true,
        nativeRuntimeReportAt: true,
      },
      orderBy: { name: 'asc' },
    })) as any[];
    const runs = screens.length
      ? ((await this.prisma.client.screenRebootRun.findMany({
          where: { tenantId, screenId: { in: screens.map((s) => s.id) } },
          orderBy: { createdAt: 'desc' },
          take: Math.min(screens.length * 3, 600),
          select: {
            screenId: true,
            status: true,
            reason: true,
            scheduledFor: true,
            dispatchedAt: true,
            returnedAt: true,
            restartProven: true,
          },
        })) as any[])
      : [];
    const lastByScreen = new Map<string, any>();
    for (const r of runs) if (!lastByScreen.has(r.screenId)) lastByScreen.set(r.screenId, r);
    const nowMs = Date.now();
    const cadence = policy?.cadence ?? 'DAILY';
    return {
      disabled: scheduledRebootsDisabled(),
      policy: policy ?? null,
      screens: screens.map((s) => {
        const uptime = uptimeFrom(s.nativeRuntimeReport, s.nativeRuntimeReportAt, nowMs);
        return {
          id: s.id,
          name: s.name,
          hardwareClass: hardwareClassOf(s)?.label ?? null,
          canRestart: verdictCanRestart(s.displayCapabilities),
          restartedRecently: uptime !== null && uptime < ownRestartThresholdMs(cadence),
          lastRun: lastByScreen.get(s.id) ?? null,
        };
      }),
    };
  }

  @Put('groups/:groupId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async set(
    @Param('groupId') groupId: string,
    @Req() req: any,
    @Body(new ZodValidationPipe(ScheduledRebootPolicySchema)) body: ScheduledRebootPolicyInput,
  ) {
    const tenantId = this.requireTenant(req);
    this.refuseWhenDisabled();
    await this.loadGroup(tenantId, groupId, req);
    const userId = req.user?.id ?? req.user?.userId ?? null;
    const before = await this.prisma.client.screenRebootPolicy.findFirst({
      where: { tenantId, screenGroupId: groupId },
      select: POLICY_FIELDS,
    });
    const data = {
      cadence: body.cadence,
      dayOfWeek: body.cadence === 'WEEKLY' ? (body.dayOfWeek as number) : null,
      time: body.time,
      isActive: body.isActive ?? true,
      updatedById: userId,
    };
    let saved: any;
    if (before) {
      await this.prisma.client.screenRebootPolicy.updateMany({ where: { id: before.id, tenantId }, data });
      saved = await this.prisma.client.screenRebootPolicy.findFirst({ where: { id: before.id, tenantId }, select: POLICY_FIELDS });
    } else {
      saved = await this.prisma.client.screenRebootPolicy.create({
        data: { tenantId, screenGroupId: groupId, ...data },
        select: POLICY_FIELDS,
      });
    }
    await this.display.writeAudit({
      action: SCHEDULED_REBOOT_AUDIT.POLICY_SET,
      targetType: 'screen_group',
      targetId: groupId,
      tenantId,
      userId,
      details: { before: before ?? null, after: { cadence: data.cadence, dayOfWeek: data.dayOfWeek, time: data.time, isActive: data.isActive } },
    });
    return saved;
  }

  @Delete('groups/:groupId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Param('groupId') groupId: string, @Req() req: any) {
    const tenantId = this.requireTenant(req);
    this.refuseWhenDisabled();
    await this.loadGroup(tenantId, groupId, req);
    const before = await this.prisma.client.screenRebootPolicy.findFirst({
      where: { tenantId, screenGroupId: groupId },
      select: POLICY_FIELDS,
    });
    if (!before) return { success: true };
    await this.prisma.client.screenRebootPolicy.deleteMany({ where: { id: before.id, tenantId } });
    await this.display.writeAudit({
      action: SCHEDULED_REBOOT_AUDIT.POLICY_DELETED,
      targetType: 'screen_group',
      targetId: groupId,
      tenantId,
      userId: req.user?.id ?? req.user?.userId ?? null,
      details: { before },
    });
    return { success: true };
  }

  private refuseWhenDisabled(): void {
    if (scheduledRebootsDisabled()) {
      throw new HttpException(
        { code: 'SCHEDULED_REBOOTS_DISABLED', message: 'Scheduled restarts are paused by VenueOS.' },
        HttpStatus.CONFLICT,
      );
    }
  }

  private async loadGroup(tenantId: string, groupId: string, req: any): Promise<void> {
    const group = await this.prisma.client.screenGroup.findFirst({
      // AND, not a spread: the scope fragment is itself `{ id: { in } }` and would
      // replace the requested id.
      where: { id: groupId, tenantId, AND: [scopedGroupWhere(req)] },
      select: { id: true },
    });
    if (!group) {
      // 404, never 403 — do not confirm that an id exists in another tenant.
      throw new HttpException({ code: 'SCREEN_GROUP_NOT_FOUND', message: 'Screen group not found' }, HttpStatus.NOT_FOUND);
    }
  }

  private requireTenant(req: any): string {
    const tenantId: string | null = req.user?.tenantId || req.user?.schoolId || req.user?.districtId || null;
    if (!tenantId) {
      throw new HttpException({ code: 'TENANT_REQUIRED', message: 'No tenant on the current session' }, HttpStatus.FORBIDDEN);
    }
    return tenantId;
  }
}
