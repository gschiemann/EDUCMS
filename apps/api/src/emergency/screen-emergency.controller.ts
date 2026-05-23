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
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as Sentry from '@sentry/nestjs';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AllowPanicBypass } from '../auth/panic-bypass.decorator';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { assertAllowedEmergencyMediaUrl } from './media-url-guard';

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
  private readonly logger = new Logger(ScreenEmergencyController.name);

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
    // SECURITY: SSRF allowlist on the per-screen mediaUrl. Same rationale as
    // the tenant-wide /trigger endpoint — without this an admin could paint
    // arbitrary attacker-controlled or file:/// content onto any one screen.
    assertAllowedEmergencyMediaUrl(input.mediaUrl, 'mediaUrl');
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

  /**
   * emergency-004 fix: Prisma silently strips `undefined` filter values.
   * If a JWT lands here without `tenantId` (e.g. a malformed token, a
   * SUPER_ADMIN whose context never resolved, or a bug in the auth
   * pipeline), `findFirst({ where: { id, tenantId: undefined } })`
   * would match the first screen by id ACROSS ALL TENANTS — and a
   * subsequent emergency trigger against that screen would write a
   * cross-tenant override.  Reject with 403 before any DB call so the
   * tenant-isolation invariant cannot leak.
   *
   * emergency-012 fix: SUPER_ADMIN tokens legitimately may not carry a
   * tenantId (cross-tenant operators). Match the EmergencyController
   * pattern (resolveScopeTenant) — let SUPER_ADMIN pass through with
   * no tenantId so cross-tenant per-screen triggers work; everyone
   * else is still rejected before any DB call.
   */
  private requireTenantId(req: any): string | null {
    const isSuper = req?.user?.role === AppRole.SUPER_ADMIN;
    const tenantId = req?.user?.tenantId;
    if (typeof tenantId === 'string' && tenantId.trim().length > 0) {
      return tenantId;
    }
    if (isSuper) {
      // SUPER_ADMIN may operate cross-tenant; no tenant filter needed.
      return null;
    }
    throw new ForbiddenException('Token missing tenantId');
  }

  /**
   * emergency-012 fix: SUPER_ADMIN may target a screen in any tenant.
   * For non-super callers we still strictly filter by their tenantId
   * so a DISTRICT_ADMIN of tenant A cannot resolve a screen in tenant
   * B. The screen row itself carries `tenantId`, so the override row
   * we write later is denormalized from the screen — never from the
   * caller's token — keeping audit forensics correct regardless of
   * which admin fired the trigger.
   */
  private async resolveScreen(screenId: string, callerTenantId: string | null) {
    if (callerTenantId === null) {
      // SUPER_ADMIN path — look up by id only. No cross-tenant leak
      // possible because only SUPER_ADMIN reaches this branch (see
      // requireTenantId).
      const screen = await this.prisma.client.screen.findUnique({
        where: { id: screenId },
      });
      if (!screen) {
        throw new HttpException('Screen not found', HttpStatus.NOT_FOUND);
      }
      return screen;
    }
    if (typeof callerTenantId !== 'string' || callerTenantId.trim().length === 0) {
      // Defense-in-depth: callers should already have invoked
      // requireTenantId, but if anyone forgets we still refuse rather
      // than letting Prisma drop the filter.
      throw new ForbiddenException('Token missing tenantId');
    }
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

    // 2026-05-03 BUG FIX (cycle 4 emergency-BUG-006) — previously the
    // upsert and audit-log writes were two separate calls, with the
    // audit wrapped in `try { ... } catch { /* swallow */ }`. If the
    // audit write failed (DB blip, FK race) we'd return success to the
    // operator with NO forensic record — a worse state than no trigger
    // at all. Wrap both in a Prisma transaction (matching cycle-1
    // emergency-003 pattern in emergency.controller.ts:520-555). If the
    // audit cannot be written, the override is rolled back too and the
    // caller gets a 500 — which is correct: a failed-audit trigger is
    // a worse state than no-trigger.
    try {
      await this.prisma.client.$transaction([
        (this.prisma.client as any).screenEmergencyOverride.upsert({
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
        }),
        // Audit log — every per-screen trigger is forensic-grade. The
        // details JSON includes the floor plan / zone / scenario so a
        // post-incident review can reconstruct which playbook fired this.
        this.prisma.client.auditLog.create({
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
        }),
      ]);
    } catch (error) {
      Sentry.withScope((s) => {
        s.setTag('emergency.action', 'screen-trigger');
        s.setUser({ id: userId });
        s.setExtra('screenId', screen.id);
        s.setExtra('tenantId', tenantId);
        s.setExtra('overrideId', overrideId);
        Sentry.captureException(error);
      });
      this.logger.error(
        `[ScreenEmergency] Trigger transaction failed for screen ${screen.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new HttpException(
        'Failed to record per-screen emergency override (audit write failed). Trigger aborted.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

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
      // Pass the signed object directly — RedisService.publish() does
      // its own JSON.stringify. Wrapping it in another JSON.stringify
      // here double-encoded the payload: the player received a
      // JSON-encoded STRING, JSON.parse yielded a string not the
      // envelope, and the per-screen emergency WebSocket fast-path
      // silently failed (manifest polling still delivered, masking it).
      await this.redis.publish(`device:${screen.id}`, signed);
    } catch (e) {
      // Publish failure does not fail the trigger — HTTP polling
      // fallback covers it — but log it so a broken realtime path
      // isn't invisible.
      console.warn(`[ScreenEmergency] override redis publish failed for device:${screen.id}: ${e}`);
    }

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
    // emergency-004 fix: refuse missing-tenantId tokens before any DB call.
    const tenantId = this.requireTenantId(req);
    const screen = await this.resolveScreen(screenId, tenantId);
    const override = this.validateOverride(body);
    // SECURITY (Lane-1 re-audit P0): verify any operator-supplied playlistId
    // belongs to the screen's tenant. Same shape as the panic-settings fix.
    if (override.playlistId) {
      if (!screen.tenantId) {
        throw new HttpException('Screen has no tenant binding', HttpStatus.CONFLICT);
      }
      const owned = await this.prisma.client.playlist.findFirst({
        where: { id: override.playlistId, tenantId: screen.tenantId },
        select: { id: true },
      });
      if (!owned) {
        throw new HttpException(
          `Playlist not found in this tenant: ${override.playlistId}`,
          HttpStatus.NOT_FOUND,
        );
      }
    }
    const { overrideId } = await this.createOverrideAndBroadcast({
      screen,
      override,
      userId: req.user.id,
    });
    return { success: true, overrideId, screenId };
  }

  // ─── All-clear (delete the override) ───────────────────────────

  @Post(':screenId/all-clear')
  @AllowPanicBypass()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async allClear(@Req() req: any, @Param('screenId') screenId: string) {
    // emergency-009 fix: trigger has @AllowPanicBypass() — allClear must
    // mirror it. Without parity, an operator with `canTriggerPanic: false`
    // who fired an emergency through @AllowPanicBypass cannot clear it
    // again, leaving a screen stuck in lockdown until an admin steps in.
    // Life-safety adjacent: trigger and clear must always be reachable
    // by the same operator-set.
    // emergency-004 fix: refuse missing-tenantId tokens before any DB call.
    const tenantId = this.requireTenantId(req);
    const screen = await this.resolveScreen(screenId, tenantId);
    const existing = await (this.prisma.client as any).screenEmergencyOverride.findUnique({
      where: { screenId: screen.id },
    });
    if (!existing) {
      // Idempotent: clearing an already-clear screen returns success
      // so the operator can safely click All Clear repeatedly without
      // hitting an error mid-incident.
      return { success: true, screenId, cleared: false };
    }

    // 2026-05-03 BUG FIX (cycle 4 emergency-BUG-006) — previously the
    // delete + audit write were independent calls with the audit
    // catch-swallowed. Forensic record could go missing while the
    // operator-visible result said "cleared". Wrap both in one
    // transaction so they cannot drift apart; surface a 500 if the
    // audit write fails so the operator knows to re-fire.
    try {
      await this.prisma.client.$transaction([
        (this.prisma.client as any).screenEmergencyOverride.delete({
          where: { screenId: screen.id },
        }),
        this.prisma.client.auditLog.create({
          data: {
            action: 'CLEAR_SCREEN_EMERGENCY',
            targetType: 'screen',
            targetId: screen.id,
            tenantId: screen.tenantId!,
            userId: req.user.id,
            details: JSON.stringify({ clearedOverrideId: existing.id, type: existing.type }),
          },
        }),
      ]);
    } catch (error) {
      Sentry.withScope((s) => {
        s.setTag('emergency.action', 'screen-all-clear');
        s.setUser({ id: req.user?.id });
        s.setExtra('screenId', screen.id);
        s.setExtra('tenantId', screen.tenantId);
        s.setExtra('clearedOverrideId', existing.id);
        Sentry.captureException(error);
      });
      this.logger.error(
        `[ScreenEmergency] All-clear transaction failed for screen ${screen.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new HttpException(
        'Failed to record per-screen all-clear (audit write failed). Override may still be active; please retry.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Broadcast all-clear so the player exits override mode without
    // waiting for its next manifest poll.
    const payload = { type: 'ALL_CLEAR', screenId: screen.id };
    const signed = this.signer.signMessage('ALL_CLEAR', payload);
    try {
      // Pass `signed` directly — RedisService.publish() stringifies.
      // (See the override handler above for why double-stringify
      // broke the per-screen WS fast-path.)
      await this.redis.publish(`device:${screen.id}`, signed);
    } catch (e) {
      console.warn(`[ScreenEmergency] all-clear redis publish failed for device:${screen.id}: ${e}`);
    }

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
    // emergency-004 fix: refuse missing-tenantId tokens before any DB call.
    const tenantId = this.requireTenantId(req);
    await this.resolveScreen(screenId, tenantId);
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
    // emergency-004 fix: previously this read `req.user.tenantId` blind.
    // If the JWT was missing tenantId (malformed token, SUPER_ADMIN with
    // unresolved context, or an upstream auth bug), the resulting Prisma
    // findMany silently dropped the `tenantId: undefined` filter and
    // matched screens ACROSS ALL TENANTS — letting the caller bulk-trigger
    // emergencies on every screen in the fleet that happened to share an
    // id with their input list. Refuse the request before any DB call so
    // the tenant-isolation invariant cannot leak.
    //
    // emergency-012 fix: SUPER_ADMIN may bulk-trigger across tenants
    // (e.g. multi-tenant lasso of screens during a district-wide
    // incident). requireTenantId returns null for SUPER_ADMIN, which we
    // translate into a tenantId-less findMany — non-super callers are
    // still strictly tenant-scoped.
    const callerTenantId = this.requireTenantId(req);
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
    const where: any = { id: { in: body.screenIds } };
    if (callerTenantId !== null) {
      where.tenantId = callerTenantId;
    }
    const screens = await this.prisma.client.screen.findMany({ where });
    if (screens.length === 0) {
      throw new HttpException('No matching screens found in your tenant', HttpStatus.NOT_FOUND);
    }
    // SECURITY (Lane-1 re-audit P0): verify the playlistId belongs to the
    // tenant of EVERY targeted screen. SUPER_ADMIN bulk-triggers can span
    // tenants — refuse if the playlist doesn't belong to all of them.
    if (override.playlistId) {
      const tenantIds = [...new Set(screens.map((s) => s.tenantId).filter((t): t is string => !!t))];
      if (tenantIds.length === 0) {
        throw new HttpException('Targeted screens have no tenant binding', HttpStatus.CONFLICT);
      }
      const owned = await this.prisma.client.playlist.findMany({
        where: { id: override.playlistId, tenantId: { in: tenantIds } },
        select: { id: true, tenantId: true },
      });
      const ownedTenants = new Set(owned.map((o) => o.tenantId));
      const missing = tenantIds.filter((t) => !ownedTenants.has(t));
      if (missing.length > 0) {
        throw new HttpException(
          `Playlist not found in tenant(s): ${missing.join(', ')}`,
          HttpStatus.NOT_FOUND,
        );
      }
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
