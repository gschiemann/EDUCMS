/**
 * DisplaySchedulesController — CRUD for scheduled screen on/off windows.
 *
 *   GET    /api/v1/display-schedules[?screenId=|screenGroupId=]
 *   POST   /api/v1/display-schedules
 *   PUT    /api/v1/display-schedules/:id
 *   DELETE /api/v1/display-schedules/:id
 *
 * THESE ROWS ARE NOT A SERVER CRON. They ride the manifest to the player,
 * which arms local AlarmManager alarms from them and re-arms on
 * BOOT_COMPLETED — so a screen whose network is cut still blanks at 22:00
 * and wakes at 07:00. Server push (POST /screens/:id/display-control) is for
 * immediate/manual actions only. That is why every row carries an explicit
 * IANA `timezone`: the player has to resolve a real local wall-clock instant
 * in the SCREEN's timezone, and the device default is not trustworthy (a
 * district can span timezones; a factory-reset box comes up on UTC).
 *
 * TENANT SCOPE: every read and every write is constrained by tenantId, and
 * the target screen/group is verified to belong to the caller's tenant
 * BEFORE the row is written — otherwise a schedule could be pointed at
 * another tenant's screen, which the manifest would then happily serve.
 * Mutations use updateMany/deleteMany with `{ id, tenantId }` rather than
 * update/delete by bare id, so the scope is in the query itself rather than
 * in a preceding check a future refactor could drop.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AppRole } from '@cms/database';
import {
  DisplayScheduleCreateSchema,
  DisplayScheduleUpdateSchema,
  type DisplayScheduleCreateInput,
  type DisplayScheduleUpdateInput,
} from '@cms/api-types';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { DISPLAY_AUDIT_ACTIONS, DisplayService } from './display.service';

/** Hard cap so one tenant cannot bloat every manifest in its fleet. */
export const DISPLAY_SCHEDULES_PER_TARGET_MAX = 20;

@Controller('api/v1/display-schedules')
@UseGuards(JwtAuthGuard, RbacGuard)
export class DisplaySchedulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly display: DisplayService,
  ) {}

  @Get()
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async list(
    @Req() req: any,
    @Query('screenId') screenId?: string,
    @Query('screenGroupId') screenGroupId?: string,
  ) {
    const tenantId = this.requireTenant(req);
    const where: any = { tenantId };
    if (screenId) where.screenId = screenId;
    if (screenGroupId) where.screenGroupId = screenGroupId;
    return this.prisma.client.displaySchedule.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  @Post()
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  async create(
    @Req() req: any,
    @Body(new ZodValidationPipe(DisplayScheduleCreateSchema))
    body: DisplayScheduleCreateInput,
  ) {
    const tenantId = this.requireTenant(req);
    await this.assertExactlyOneOwnedTarget(
      tenantId,
      body.screenId,
      body.screenGroupId,
    );

    const existing = await this.prisma.client.displaySchedule.count({
      where: {
        tenantId,
        ...(body.screenId
          ? { screenId: body.screenId }
          : { screenGroupId: body.screenGroupId }),
      },
    });
    if (existing >= DISPLAY_SCHEDULES_PER_TARGET_MAX) {
      throw new HttpException(
        {
          code: 'DISPLAY_SCHEDULE_LIMIT',
          message: `A target may have at most ${DISPLAY_SCHEDULES_PER_TARGET_MAX} on/off windows`,
        },
        HttpStatus.CONFLICT,
      );
    }

    const created = await this.prisma.client.displaySchedule.create({
      data: {
        tenantId,
        screenId: body.screenId ?? null,
        screenGroupId: body.screenGroupId ?? null,
        name: body.name ?? null,
        daysOfWeek: [...new Set(body.daysOfWeek)].sort((a, b) => a - b),
        onTime: body.onTime,
        offTime: body.offTime,
        timezone: body.timezone,
        isActive: body.isActive ?? true,
      } as any,
    });

    await this.display.writeAudit({
      action: DISPLAY_AUDIT_ACTIONS.SCHEDULE_CREATED,
      targetType: 'display_schedule',
      targetId: (created as any).id,
      tenantId,
      userId: req.user?.id ?? req.user?.userId ?? null,
      details: {
        screenId: body.screenId ?? null,
        screenGroupId: body.screenGroupId ?? null,
        daysOfWeek: body.daysOfWeek,
        onTime: body.onTime,
        offTime: body.offTime,
        timezone: body.timezone,
      },
    });
    await this.display.notifyScheduleChanged(tenantId);
    return created;
  }

  @Put(':id')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  async update(
    @Param('id') id: string,
    @Req() req: any,
    @Body(new ZodValidationPipe(DisplayScheduleUpdateSchema))
    body: DisplayScheduleUpdateInput,
  ) {
    const tenantId = this.requireTenant(req);

    const current = await this.prisma.client.displaySchedule.findFirst({
      where: { id, tenantId },
    });
    if (!current) {
      // 404 rather than 403 — never confirm that an id exists in another tenant.
      throw new HttpException(
        {
          code: 'DISPLAY_SCHEDULE_NOT_FOUND',
          message: 'Display schedule not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const nextOn = body.onTime ?? (current as any).onTime;
    const nextOff = body.offTime ?? (current as any).offTime;
    if (nextOn === nextOff) {
      throw new HttpException(
        {
          code: 'DISPLAY_SCHEDULE_INVALID_WINDOW',
          message:
            'onTime and offTime must differ — an equal pair is an ambiguous 0h/24h window',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const data: any = {};
    if (body.name !== undefined) data.name = body.name ?? null;
    if (body.daysOfWeek !== undefined) {
      data.daysOfWeek = [...new Set(body.daysOfWeek)].sort((a, b) => a - b);
    }
    if (body.onTime !== undefined) data.onTime = body.onTime;
    if (body.offTime !== undefined) data.offTime = body.offTime;
    if (body.timezone !== undefined) data.timezone = body.timezone;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    // Tenant scope lives in the WHERE, not in a preceding check — the row is
    // unreachable from another tenant even if the findFirst above is ever
    // refactored away.
    await this.prisma.client.displaySchedule.updateMany({
      where: { id, tenantId },
      data,
    });

    await this.display.writeAudit({
      action: DISPLAY_AUDIT_ACTIONS.SCHEDULE_UPDATED,
      targetType: 'display_schedule',
      targetId: id,
      tenantId,
      userId: req.user?.id ?? req.user?.userId ?? null,
      details: { changed: Object.keys(data) },
    });
    await this.display.notifyScheduleChanged(tenantId);

    return this.prisma.client.displaySchedule.findFirst({
      where: { id, tenantId },
    });
  }

  @Delete(':id')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = this.requireTenant(req);
    const result = await this.prisma.client.displaySchedule.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) {
      throw new HttpException(
        {
          code: 'DISPLAY_SCHEDULE_NOT_FOUND',
          message: 'Display schedule not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }
    await this.display.writeAudit({
      action: DISPLAY_AUDIT_ACTIONS.SCHEDULE_DELETED,
      targetType: 'display_schedule',
      targetId: id,
      tenantId,
      userId: req.user?.id ?? req.user?.userId ?? null,
      details: {},
    });
    await this.display.notifyScheduleChanged(tenantId);
    return { success: true };
  }

  private requireTenant(req: any): string {
    const tenantId: string | null =
      req.user?.tenantId || req.user?.schoolId || req.user?.districtId || null;
    if (!tenantId) {
      throw new HttpException(
        {
          code: 'TENANT_REQUIRED',
          message: 'No tenant on the current session',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    return tenantId;
  }

  /**
   * Exactly one target, and it must belong to the caller's tenant.
   *
   * Without the ownership half, a well-formed request could hang a schedule
   * off another tenant's screen id — and the manifest builder, which reads
   * `{ tenantId, OR: [{screenId}, {screenGroupId}] }`, would never serve it
   * but the row would still sit there as a cross-tenant reference. Refuse it
   * at write time (auth-BUG-003 pattern from schedules.controller).
   */
  private async assertExactlyOneOwnedTarget(
    tenantId: string,
    screenId?: string,
    screenGroupId?: string,
  ): Promise<void> {
    if (!!screenId === !!screenGroupId) {
      throw new HttpException(
        {
          code: 'DISPLAY_SCHEDULE_TARGET_REQUIRED',
          message: 'Specify exactly one of screenId or screenGroupId',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (screenId) {
      const owned = await this.prisma.client.screen.findFirst({
        where: { id: screenId, tenantId },
        select: { id: true },
      });
      if (!owned) {
        throw new HttpException(
          { code: 'SCREEN_NOT_FOUND', message: 'Screen not found' },
          HttpStatus.NOT_FOUND,
        );
      }
      return;
    }
    const ownedGroup = await this.prisma.client.screenGroup.findFirst({
      where: { id: screenGroupId as string, tenantId },
      select: { id: true },
    });
    if (!ownedGroup) {
      throw new HttpException(
        { code: 'SCREEN_GROUP_NOT_FOUND', message: 'Screen group not found' },
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
