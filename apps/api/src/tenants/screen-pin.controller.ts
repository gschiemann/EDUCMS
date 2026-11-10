/**
 * The tenant's screen PIN — set, change, clear (2026-11-09, player stability
 * gap 6). What the PIN does is in `../screens/screen-pin.ts`: it gates ONLY
 * the device-initiated unpair from a screen's on-screen menu.
 *
 * Rules:
 *  - The caller's OWN tenant only (`me`), like `me/mfa-enforced`: an org
 *    security policy, written by SUPER_ADMIN / DISTRICT_ADMIN. No password
 *    step-up: the comparable org policies (MFA enforcement, emergency
 *    enablement, the USB ingest key rotation) take none, and the dashboard's
 *    "Remove screen" stays the recovery path for a forgotten PIN.
 *  - The PIN is stored only as an Argon2id hash in `tenant_screen_pins`; the
 *    `tenants.screen_pin_set_at` column (in the same transaction) is what the
 *    manifest reads. The PIN and its hash are never returned, logged or put in
 *    an audit row — only the fact of the change.
 *  - Every change writes an `AuditLog` row in the same transaction.
 *  - Clearing is the kill switch: no row = today's behaviour on every screen.
 */
import { Body, Controller, Delete, Get, HttpException, HttpStatus, Put, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { SCREEN_PIN_MAX_DIGITS, SCREEN_PIN_MIN_DIGITS, hashScreenPin, normalizeScreenPin } from '../screens/screen-pin';

@Controller('api/v1/tenants/me/screen-pin')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ScreenPinController {
  constructor(private readonly prisma: PrismaService) {}

  /** Is a PIN set? Never the PIN. Readable by every admin role (the card renders read-only for SCHOOL_ADMIN). */
  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async get(@Request() req: any) {
    const tenantId = req.user.tenantId as string;
    const t = (await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { screenPinSetAt: true } as any,
    })) as { screenPinSetAt?: Date | null } | null;
    if (!t) throw new HttpException({ code: 'TENANT_NOT_FOUND', message: 'Tenant not found' }, HttpStatus.NOT_FOUND);
    return { set: !!t.screenPinSetAt, setAt: t.screenPinSetAt ?? null };
  }

  @Put()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async set(@Request() req: any, @Body() body: { pin?: unknown }) {
    const tenantId = req.user.tenantId as string;
    const pin = normalizeScreenPin(body?.pin);
    if (!pin) {
      throw new HttpException(
        { code: 'SCREEN_PIN_INVALID', message: `A screen PIN is ${SCREEN_PIN_MIN_DIGITS} to ${SCREEN_PIN_MAX_DIGITS} digits.` },
        HttpStatus.BAD_REQUEST,
      );
    }
    const pinHash = await hashScreenPin(pin);
    const now = new Date();
    const result = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.tenantScreenPin.findUnique({ where: { tenantId }, select: { tenantId: true } });
      await tx.tenantScreenPin.upsert({
        where: { tenantId },
        create: { tenantId, pinHash, setByUserId: req.user.userId ?? null },
        update: { pinHash, setByUserId: req.user.userId ?? null },
      });
      // Busts the manifest cache (Tenant is manifest-fed): screens learn
      // `unpairPinRequired` on their next poll.
      await tx.tenant.update({ where: { id: tenantId }, data: { screenPinSetAt: now } as any });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req.user.userId ?? null,
          action: existing ? 'SCREEN_PIN_CHANGED' : 'SCREEN_PIN_SET',
          targetType: 'Tenant',
          targetId: tenantId,
          // The fact only. Never the PIN, its length or its hash.
          details: JSON.stringify({ byRole: req.user.role ?? null }),
        },
      });
      return { changed: !!existing };
    });
    return { ok: true, set: true, setAt: now, changed: result.changed };
  }

  @Delete()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  async clear(@Request() req: any) {
    const tenantId = req.user.tenantId as string;
    await this.prisma.client.$transaction(async (tx) => {
      const removed = await tx.tenantScreenPin.deleteMany({ where: { tenantId } });
      await tx.tenant.update({ where: { id: tenantId }, data: { screenPinSetAt: null } as any });
      if (removed?.count) {
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: req.user.userId ?? null,
            action: 'SCREEN_PIN_CLEARED',
            targetType: 'Tenant',
            targetId: tenantId,
            details: JSON.stringify({ byRole: req.user.role ?? null }),
          },
        });
      }
    });
    return { ok: true, set: false, setAt: null };
  }
}
