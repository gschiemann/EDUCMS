import { Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RbacGuard } from '../../auth/rbac.guard';
import { RequireRoles } from '../../auth/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { clientIpFromRequest } from '../../security/client-ip';
import { loadManageableTarget } from '../../users/manageable-target';
import { eligibilityRefusal } from './panic-device.policy';
import { PanicDeviceService, type PanicDeviceRow } from './panic-device.service';

/**
 * Panic phones (2026-11-14) — what an administrator sees and can do, on the
 * People page (Settings → People → a person → "Emergency phones").
 *
 * The person is resolved through `users/manageable-target.ts` — the SAME gate
 * as every People action: SUPER_ADMIN across organisations (under a support
 * grant), a DISTRICT_ADMIN over their organisation and its schools, everyone
 * else inside their own organisation, always strictly below their own rank —
 * and a person outside that reach answers 404, so a probe cannot map out
 * another organisation's people. `allowSelf`: an admin may see and turn off
 * their own phones. Every query is constrained to the person's own tenant.
 *
 * Revoke is immediate: the next presentation of that phone's credential is
 * refused (`PanicDeviceService.authenticate` reads the row every time), and
 * an immutable PANIC_DEVICE_REVOKED row names who did it.
 */
@Controller('api/v1/users/:userId/panic-devices')
@UseGuards(JwtAuthGuard, RbacGuard)
export class PanicDeviceAdminController {
  constructor(
    private readonly devices: PanicDeviceService,
    private readonly prisma: PrismaService,
  ) {}

  private present(row: PanicDeviceRow) {
    return {
      id: row.id,
      label: row.label,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      // The reason as written ('admin', 'self', 'admin-mfa-reset',
      // 'ineligible:no-authority', …) — the UI words it.
      revokedReason: row.revokedReason,
      state: row.revokedAt ? ('revoked' as const) : ('active' as const),
    };
  }

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async list(@Request() req: any, @Param('userId') userId: string) {
    const target = await loadManageableTarget(this.prisma.client, req, userId, { allowSelf: true, notFoundOnScopeMiss: true });
    const [rows, person, tenant] = await Promise.all([
      this.devices.listForUser(target.id, target.tenantId),
      this.prisma.client.user.findFirst({
        where: { id: target.id, tenantId: target.tenantId },
        select: { id: true, tenantId: true, role: true, status: true, deletedAt: true, canTriggerPanic: true } as any,
      }),
      this.prisma.client.tenant.findUnique({ where: { id: target.tenantId }, select: { id: true, archivedAt: true } }),
    ]);
    return {
      // Whether a phone of this person would be accepted right now. When it
      // is false, every phone below is refused (and turned off) on its next use.
      personCanSend: eligibilityRefusal({ tenantId: target.tenantId }, person as any, tenant as any) === null,
      devices: rows.map((r) => this.present(r)),
    };
  }

  @Post(':deviceId/revoke')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async revoke(@Request() req: any, @Param('userId') userId: string, @Param('deviceId') deviceId: string) {
    const target = await loadManageableTarget(this.prisma.client, req, userId, { allowSelf: true, notFoundOnScopeMiss: true });
    const device = await this.devices.findForUser(deviceId, target.id, target.tenantId);
    if (!device) {
      throw new HttpException({ code: 'PANIC_DEVICE_NOT_FOUND', message: 'That phone was not found.' }, HttpStatus.NOT_FOUND);
    }
    const revoked = await this.devices.revoke({
      device,
      byUserId: req.user.id,
      reason: 'admin',
      ip: clientIpFromRequest(req),
    });
    return { revoked, device: this.present({ ...device, revokedAt: device.revokedAt ?? new Date(), revokedReason: device.revokedReason ?? 'admin' }) };
  }
}
