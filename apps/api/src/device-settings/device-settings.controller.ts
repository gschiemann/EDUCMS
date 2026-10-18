/**
 * DeviceSettingsController — the operator half of basic Android settings
 * (2026-10-18). Mounted under /api/v1/screens next to DisplayController
 * (same prefix, a new literal segment after `:id`).
 *
 *   GET /:id/device-settings   What is stored, what the unit last reported,
 *                              and when. Never a Wi-Fi passphrase.
 *   PUT /:id/device-settings   A partial update of the desired set. Same
 *                              roles as display control / panel power.
 *                              Audited before/after, passphrase redacted.
 *
 * The unit picks a change up on its next native heartbeat (≤ 60 s while its
 * page is not reporting, ≤ 5 min while it is); nothing is pushed, nothing is
 * queued elsewhere. See `device-settings.ts` for identity and
 * `device-settings.heartbeat.ts` for delivery.
 */

import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AppRole, type Prisma } from '@cms/database';
import {
  DeviceSettingsPatchSchema,
  type DeviceSettingsPatch,
  type DeviceSettingsView,
} from '@cms/api-types';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { sealCredentials } from '../streaming/creds-cipher';
import { assertSupportReach } from '../support-access/support-access.context';
import {
  DEVICE_SETTINGS_AUDIT_ACTIONS,
  WifiPassphraseRequiredError,
  applyPatch,
  auditView,
  readStoredReport,
  readStoredSettings,
  viewDesired,
  type StoredSettings,
} from './device-settings';

/** A PUT that keeps losing the optimistic revision race gives up with a 409. */
const MAX_WRITE_TRIES = 3;

class RevisionConflict extends Error {}

@Controller('api/v1/screens')
export class DeviceSettingsController {
  private readonly logger = new Logger(DeviceSettingsController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/device-settings')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async get(@Param('id') screenId: string, @Req() req: any): Promise<DeviceSettingsView> {
    const screen = await this.loadOperatorScreen(screenId, req);
    // ten-ok: keyed by the screen id the tenant-scoped load above proved.
    const row = await this.prisma.client.desiredDeviceSettings.findUnique({ where: { screenId: screen.id } });
    return buildView(screen, row);
  }

  @Put(':id/device-settings')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async put(
    @Param('id') screenId: string,
    @Req() req: any,
    @Body(new ZodValidationPipe(DeviceSettingsPatchSchema)) body: DeviceSettingsPatch,
  ): Promise<DeviceSettingsView & { changed: string[] }> {
    const screen = await this.loadOperatorScreen(screenId, req);
    const tenantId = typeof screen.tenantId === 'string' ? screen.tenantId : null;
    if (!tenantId) {
      throw new HttpException(
        { code: 'SCREEN_NO_TENANT', message: 'Screen is not assigned to a tenant' },
        HttpStatus.CONFLICT,
      );
    }
    if (screen.faceOfScreenId) {
      // One Android unit, one set of Android settings: they live on the
      // primary side's row, which is the one that heartbeats.
      throw new HttpException(
        {
          code: 'DEVICE_SETTINGS_ON_PRIMARY_SIDE',
          message: 'This is one side of a double-sided screen. Its Android settings are set on the main side.',
        },
        HttpStatus.CONFLICT,
      );
    }
    const userId: string | null = req.user?.id ?? req.user?.userId ?? null;

    for (let attempt = 1; attempt <= MAX_WRITE_TRIES; attempt += 1) {
      try {
        const outcome = await this.writeOnce(screen.id, tenantId, userId, body);
        if (outcome.changed.length > 0) {
          await this.audit(tenantId, screen.id, userId, {
            revision: outcome.revision,
            changed: outcome.changed,
            before: outcome.before,
            after: outcome.after,
            ...(outcome.wifiPassphrase ? { wifiPassphrase: outcome.wifiPassphrase } : {}),
          });
        }
        const row = await this.prisma.client.desiredDeviceSettings.findUnique({ where: { screenId: screen.id } });
        return { ...buildView({ ...screen, deviceSettingsRev: outcome.revision }, row), changed: outcome.changed };
      } catch (e) {
        if (e instanceof WifiPassphraseRequiredError) {
          throw new HttpException({ code: e.code, message: e.message }, HttpStatus.BAD_REQUEST);
        }
        const conflict = e instanceof RevisionConflict || (e as { code?: string })?.code === 'P2002';
        if (!conflict) throw e;
        if (attempt === MAX_WRITE_TRIES) {
          throw new HttpException(
            {
              code: 'DEVICE_SETTINGS_CONFLICT',
              message: 'Someone else changed this screen’s Android settings at the same moment. Try again.',
            },
            HttpStatus.CONFLICT,
          );
        }
      }
    }
    // Unreachable: the loop returns or throws.
    throw new HttpException({ code: 'DEVICE_SETTINGS_CONFLICT', message: 'Try again.' }, HttpStatus.CONFLICT);
  }

  /**
   * One optimistic write: read the row, fold the patch, write it back ONLY if
   * the revision is still the one read (a concurrent PUT makes this throw
   * [RevisionConflict] and the caller retries) — so a revision, and therefore
   * an identity, can never be issued twice.
   */
  private async writeOnce(
    screenId: string,
    tenantId: string,
    userId: string | null,
    body: DeviceSettingsPatch,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      // ten-ok: the caller passed the screen id its tenant-scoped load proved.
      const row = await tx.desiredDeviceSettings.findUnique({ where: { screenId } });
      // A row left over from another organisation (a re-paired screen) is
      // never shown, merged or kept — this tenant starts from nothing.
      const sameTenant = !!row && row.tenantId === tenantId;
      const current: StoredSettings = sameTenant ? readStoredSettings(row!.settings) : {};
      const hadSecret = sameTenant && !!row!.wifiSecret;
      const revision = (row?.revision ?? 0) + 1;
      const now = new Date();
      const { next, changed, wifiSecret } = applyPatch(current, body, { revision, now, userId, hasSecret: hadSecret });

      if (changed.length === 0 && sameTenant) {
        return { revision: row!.revision, changed: [] as string[], before: {}, after: {}, wifiPassphrase: null };
      }

      const sealed =
        wifiSecret.kind === 'set'
          ? JSON.stringify(sealCredentials({ passphrase: wifiSecret.passphrase }))
          : wifiSecret.kind === 'clear' || !sameTenant
            ? null
            : (row?.wifiSecret ?? null);
      const data = {
        tenantId,
        revision,
        settings: next as unknown as Prisma.InputJsonValue,
        wifiSecret: sealed,
        updatedByUserId: userId,
      };
      if (row) {
        const written = await tx.desiredDeviceSettings.updateMany({
          where: { screenId, revision: row.revision },
          data,
        });
        if (written.count !== 1) throw new RevisionConflict();
      } else {
        await tx.desiredDeviceSettings.create({ data: { screenId, ...data } });
      }
      // The heartbeat's cheap marker. Telemetry-only for the manifest cache.
      await tx.screen.update({ where: { id: screenId }, data: { deviceSettingsRev: revision }, select: { id: true } });

      return {
        revision,
        changed: changed as string[],
        before: sameTenant ? auditView(current, hadSecret) : {},
        after: auditView(next, sealed !== null),
        wifiPassphrase:
          wifiSecret.kind === 'set' ? 'changed' : wifiSecret.kind === 'clear' && hadSecret ? 'removed' : null,
      };
    });
  }

  private async audit(tenantId: string, screenId: string, userId: string | null, details: Record<string, unknown>) {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          action: DEVICE_SETTINGS_AUDIT_ACTIONS.CHANGED,
          targetType: 'screen',
          targetId: screenId,
          tenantId,
          userId,
          details: JSON.stringify(details),
        },
      });
    } catch (e) {
      // AuditLog carries DB-level immutability triggers: a failure is a real signal.
      this.logger.warn(`audit(${DEVICE_SETTINGS_AUDIT_ACTIONS.CHANGED}) failed for screen ${screenId}: ${(e as Error)?.message ?? e}`);
    }
  }

  /**
   * Tenant-scoped screen load — the same rule as DisplayController's:
   * SUPER_ADMIN is cross-tenant by design; every other role must match; a
   * cross-tenant miss is a 404, never a 403.
   */
  private async loadOperatorScreen(screenId: string, req: any): Promise<any> {
    const isSuper = req.user?.role === AppRole.SUPER_ADMIN;
    const callerTenantId: string | null = req.user?.tenantId || req.user?.schoolId || req.user?.districtId || null;
    if (!isSuper && !callerTenantId) {
      throw new NotFoundException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found' });
    }
    const screen = await this.prisma.client.screen.findFirst({
      where: isSuper ? { id: screenId } : { id: screenId, tenantId: callerTenantId as string },
      select: {
        id: true,
        tenantId: true,
        faceOfScreenId: true,
        deviceSettingsRev: true,
        deviceSettingsReportAt: true,
      },
    });
    if (!screen) throw new NotFoundException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found' });
    await assertSupportReach(req.user, screen.tenantId); // SUPPORT ACCESS (2026-10-11)
    return screen;
  }
}

/** The dashboard's view. A row from another organisation is shown as nothing at all. */
export function buildView(
  screen: { id: string; tenantId: string | null; faceOfScreenId?: string | null; deviceSettingsReportAt?: Date | null },
  row: { tenantId: string; revision: number; settings: unknown; wifiSecret: string | null; report: unknown; reportChangedAt: Date | null } | null,
): DeviceSettingsView {
  const mine = !!row && row.tenantId === screen.tenantId;
  return {
    screenId: screen.id,
    faceOfScreenId: screen.faceOfScreenId ?? null,
    revision: mine ? row!.revision : 0,
    desired: mine ? viewDesired(readStoredSettings(row!.settings), !!row!.wifiSecret) : {},
    report: mine ? readStoredReport(row!.report) : null,
    reportChangedAt: mine && row!.reportChangedAt ? row!.reportChangedAt.toISOString() : null,
    reportedAt: screen.deviceSettingsReportAt ? screen.deviceSettingsReportAt.toISOString() : null,
  };
}
