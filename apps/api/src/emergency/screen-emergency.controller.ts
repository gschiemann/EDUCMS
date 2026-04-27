/**
 * ScreenEmergencyController — Sprint 8b Phase 1.
 *
 * Per-screen emergency overrides. The player checks for an override
 * on its own screen FIRST. Only if no override exists does it fall
 * back to the tenant-wide Tenant.emergencyStatus. THIS is what makes
 * "different alert per room" possible without breaking the existing
 * global-trigger model.
 *
 * Endpoints:
 *   POST   /api/v1/emergency/screens/:screenId/trigger
 *     Trigger an emergency on one screen. Body shape mirrors the
 *     tenant-wide trigger (type, severity, scopeNote, optional
 *     playlistId / mediaUrl / textBlob / expiresAt / scenarioId).
 *
 *   POST   /api/v1/emergency/screens/:screenId/all-clear
 *     Delete the active override for that screen. Player resumes
 *     either the tenant-wide alert (if one is active) or normal
 *     scheduled content.
 *
 *   GET    /api/v1/emergency/screens/:screenId/override
 *     Inspector / player polling endpoint. Returns the active
 *     override row (or null). Used by the player on boot.
 *
 *   POST   /api/v1/emergency/screens/bulk-trigger
 *     One operator action → multiple per-screen overrides in a
 *     single signed broadcast. Body { screenIds[], override }.
 *     Used by the floor-plan UI when an operator lassos several
 *     screens or picks a saved scenario.
 *
 * Security:
 *   - JwtAuthGuard + RbacGuard. Only SUPER / DISTRICT / SCHOOL
 *     admins can trigger / clear. @AllowPanicBypass present on
 *     trigger so operators with `canTriggerPanic` flag can fire
 *     without full admin rights — same model as the tenant-wide
 *     trigger.
 *   - Every screenId is re-checked against the caller's tenant
 *     before any DB write. No cross-tenant leak.
 *   - tenantId on the override row is denormalized from the screen
 *     so audit forensics + reporting don't need to join against
 *     screens later.
 *   - Every trigger / clear is AuditLog'd with userId, screenId,
 *     scope_note, floorPlanId / floorZoneId / scenarioId so an
 *     incident review can reconstruct exactly why screen X showed
 *     a Hold while screen Y showed Evacuate.
 *
 * Pub/sub:
 *   We publish the same signed envelope on `device:<screenId>` that
 *   the existing trigger uses for device-scope. Player already
 *   subscribes to its own device channel — zero protocol change.
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
  Req,
  UseGuards,
} from '@nestjs/common';
import * as crypto from 'crypto';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AllowPanicBypass } from '../auth/panic-bypass.decorator';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';

const ALLOWED_TYPES = new Set([
  'LOCKDOWN', 'EVACUATE', 'WEATHER', 'HOLD', 'SECURE', 'MEDICAL', 'CUSTOM',
]);
const ALLOWED_SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

interface OverrideInput {
  type: string;
  severity?: string;
  scopeNote?: string;
  playlistId?: string;
  mediaUrl?: string;
  textBlob?: string;
  expiresAt?: string | number;
  floorPlanId?: string;
  floorZoneId?: string;
  scenarioId?: string;
}

@Controller('api/v1/emergency/screens')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ScreenEmergencyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly signer: WebsocketSignerService,
  ) {}

  // ─── Validate + normalize an override payload ──────────────────

  private validateOverride(input: OverrideInput): {
    type: string;
    severity: string;
    scopeNote: string | null;
    playlistId: string | null;
    mediaUrl: string | null;
    textBlob: string | null;
    expiresAt: Date | null;
    floorPlanId: string | null;
    floorZoneId: string | null;
    scenarioId: string | null;
  } {
    const type = String(input.type || '').toUpperCase();
    if (!ALLOWED_TYPES.has(type)) {
      throw new HttpException(
        `Invalid emergency type. Allowed: ${[...ALLOWED_TYPES].join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const severity = (input.severity ? String(input.severity).toUpperCase() : 'HIGH');
    if (!ALLOWED_SEVERITIES.has(severity)) {
      throw new HttpException(
        `Invalid severity. Allowed: ${[...ALLOWED_SEVERITIES].join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    let expiresAt: Date | null = null;
    if (input.expiresAt) {
      const n = typeof input.expiresAt === 'number' ? input.expiresAt : Date.parse(String(input.expiresAt));
      if (Number.isFinite(n)) {
        expiresAt = new Date(n);
      }
    }
    return {
      type,
      severity,
      scopeNote: input.scopeNote?.toString().slice(0, 500) || null,
      playlistId: input.playlistId?.toString() || null,
      mediaUrl: input.mediaUrl?.toString().slice(0, 2048) || null,
      textBlob: input.textBlob?.toString().slice(0, 4000) || null,
      expiresAt,
      floorPlanId: input.floorPlanId?.toString() || null,
      floorZoneId: input.floorZoneId?.toString() || null,
      scenarioId: input.scenarioId?.toString() || null,
    };
  }

  // ─── Resolve the screen + tenant-check it ──────────────────────

  private async resolveScreen(screenId: string, callerTenantId: string) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id: screenId, tenantId: callerTenantId },
    });
    if (!screen) {
      throw new HttpException('Screen not found', HttpStatus.NOT_FOUND);
    }
    return screen;
  }

  // ─── Persist + broadcast a single override ─────────────────────

  private async createOverrideAndBroadcast(opts: {
    screen: { id: string; tenantId: string | null };
    override: ReturnType<typeof this.validateOverride>;
    userId: string;
  }) {
    const { screen, override, userId } = opts;
    const tenantId = screen.tenantId;
    if (!tenantId) {
      throw new HttpException('Screen has no tenant assignment', HttpStatus.BAD_REQUEST);
    }
    const overrideId = `ovr_${crypto.randomUUID()}`;

    // Upsert — there's a unique on screen_id, so a second trigger on
    // the same screen replaces the first override rather than failing.
    await (this.prisma.client as any).screenEmergencyOverride.upsert({
      where: { screenId: screen.id },
      create: {
        screenId: screen.id,
        tenantId,
        type: override.type,
        severity: override.severity,
        scopeNote: override.scopeNote,
        playlistId: override.playlistId,
        mediaUrl: override.mediaUrl,
        textBlob: override.textBlob,
        expiresAt: override.expiresAt,
        floorPlanId: override.floorPlanId,
        floorZoneId: override.floorZoneId,
        scenarioId: override.scenarioId,
        triggeredByUserId: userId,
      },
      update: {
        type: override.type,
        severity: override.severity,
        scopeNote: override.scopeNote,
        playlistId: override.playlistId,
        mediaUrl: override.mediaUrl,
        textBlob: override.textBlob,
        expiresAt: override.expiresAt,
        floorPlanId: override.floorPlanId,
        floorZoneId: override.floorZoneId,
        scenarioId: override.scenarioId,
        triggeredByUserId: userId,
        triggeredAt: new Date(),
      },
    });

    // Audit log — every per-screen trigger is forensic-grade. The
    // details JSON includes the floor plan / zone / scenario so a
    // post-incident review can reconstruct which playbook fired this.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          action: 'TRIGGER_SCREEN_EMERGENCY',
          targetType: 'screen',
          targetId: screen.id,
          tenantId,
          userId,
          details: JSON.stringify({
            overrideId,
            type: override.type,
            severity: override.severity,
            scopeNote: override.scopeNote,
            floorPlanId: override.floorPlanId,
            floorZoneId: override.floorZoneId,
            scenarioId: override.scenarioId,
          }),
        },
      });
    } catch { /* swallow */ }

    // Pub/sub fanout. Same envelope shape the tenant-wide trigger uses,
    // just on the device channel. Player verifies signature before
    // rendering — see WebsocketSignerService.
    const payload = {
      overrideId,
      severity: override.severity,
      type: override.type,
      mediaUrl: override.mediaUrl,
      textBlob: override.textBlob,
      playlistId: override.playlistId,
      scopeNote: override.scopeNote,
      expiresAt: override.expiresAt ? Math.floor(override.expiresAt.getTime() / 1000) : null,
    };
    const signed = this.signer.signMessage('OVERRIDE', payload);
    try {
      await this.redis.publish(`device:${screen.id}`, JSON.stringify(signed));
    } catch { /* publish-failure does not fail the trigger; HTTP polling fallback covers */ }

    return { overrideId, payload };
  }

  // ─── Trigger ───────────────────────────────────────────────────

  @Post(':screenId/trigger')
  @AllowPanicBypass()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async trigger(
    @Req() req: any,
    @Param('screenId') screenId: string,
    @Body() body: OverrideInput,
  ) {
    const screen = await this.resolveScreen(screenId, req.user.tenantId);
    const override = this.validateOverride(body);
    const { overrideId } = await this.createOverrideAndBroadcast({
      screen,
      override,
      userId: req.user.id,
    });
    return { success: true, overrideId, screenId };
  }

  // ─── All-clear (delete the override) ───────────────────────────

  @Post(':screenId/all-clear')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async allClear(@Req() req: any, @Param('screenId') screenId: string) {
    const screen = await this.resolveScreen(screenId, req.user.tenantId);
    const existing = await (this.prisma.client as any).screenEmergencyOverride.findUnique({
      where: { screenId: screen.id },
    });
    if (!existing) {
      // Idempotent: clearing an already-clear screen returns success
      // so the operator can safely click All Clear repeatedly without
      // hitting an error mid-incident.
      return { success: true, screenId, cleared: false };
    }
    await (this.prisma.client as any).screenEmergencyOverride.delete({
      where: { screenId: screen.id },
    });

    try {
      await this.prisma.client.auditLog.create({
        data: {
          action: 'CLEAR_SCREEN_EMERGENCY',
          targetType: 'screen',
          targetId: screen.id,
          tenantId: screen.tenantId!,
          userId: req.user.id,
          details: JSON.stringify({ clearedOverrideId: existing.id, type: existing.type }),
        },
      });
    } catch { /* swallow */ }

    // Broadcast all-clear so the player exits override mode without
    // waiting for its next manifest poll.
    const payload = { type: 'ALL_CLEAR', screenId: screen.id };
    const signed = this.signer.signMessage('ALL_CLEAR', payload);
    try {
      await this.redis.publish(`device:${screen.id}`, JSON.stringify(signed));
    } catch { /* fallback as above */ }

    return { success: true, screenId, cleared: true };
  }

  // ─── Inspect (dashboard + player on boot) ──────────────────────

  @Get(':screenId/override')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  async getOverride(@Req() req: any, @Param('screenId') screenId: string) {
    await this.resolveScreen(screenId, req.user.tenantId);
    const override = await (this.prisma.client as any).screenEmergencyOverride.findUnique({
      where: { screenId },
    });
    return override || null;
  }

  // ─── Bulk trigger (lasso / scenario) ───────────────────────────

  @Post('bulk-trigger')
  @AllowPanicBypass()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async bulkTrigger(
    @Req() req: any,
    @Body() body: { screenIds: string[]; override: OverrideInput },
  ) {
    if (!Array.isArray(body?.screenIds) || body.screenIds.length === 0) {
      throw new HttpException('screenIds required', HttpStatus.BAD_REQUEST);
    }
    if (body.screenIds.length > 500) {
      // Sanity bound — a district might trigger across thousands of
      // screens with a tenant-wide alert; bulk-screen is for surgical
      // multi-screen targeting (one zone, a few rooms). Past 500 the
      // operator should use a tenant or group scope.
      throw new HttpException('Too many screens — use tenant scope for fleet-wide', HttpStatus.BAD_REQUEST);
    }
    const override = this.validateOverride(body.override);
    const callerTenantId = req.user.tenantId;
    const screens = await this.prisma.client.screen.findMany({
      where: { id: { in: body.screenIds }, tenantId: callerTenantId },
    });
    if (screens.length === 0) {
      throw new HttpException('No matching screens found in your tenant', HttpStatus.NOT_FOUND);
    }
    const results: Array<{ screenId: string; overrideId: string }> = [];
    for (const screen of screens) {
      const { overrideId } = await this.createOverrideAndBroadcast({
        screen,
        override,
        userId: req.user.id,
      });
      results.push({ screenId: screen.id, overrideId });
    }
    return { success: true, count: results.length, results };
  }
}
