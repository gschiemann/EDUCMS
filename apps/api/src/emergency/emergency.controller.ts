import { Controller, Post, Get, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppRole } from '@cms/database';
import { RbacGuard } from '../auth/rbac.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AllowPanicBypass } from '../auth/panic-bypass.decorator';
import * as crypto from 'crypto';
import * as Sentry from '@sentry/nestjs';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { invalidateTenantState } from '../screens/manifest-hot-cache';
import {
  TriggerEmergencyInputSchema,
  ClearEmergencyInputSchema,
  SosInputSchema,
  BroadcastInputSchema,
  MediaAlertInputSchema,
} from '@cms/api-types';
import type {
  TriggerEmergencyInput,
  ClearEmergencyInput,
  SosInput,
  BroadcastInput,
  MediaAlertInput,
} from '@cms/api-types';

@Controller('api/v1/emergency')
@UseGuards(JwtAuthGuard, RbacGuard)
export class EmergencyController {
  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
    private readonly signer: WebsocketSignerService
  ) {}

  /**
   * Resolve the CANONICAL tenantId for an audit-log row given the
   * emergency scope. Audit rows must be tenant-scoped so the incident
   * forensics live with the affected school, not the acting admin's
   * home tenant.
   *
   * Why this matters: previously every audit row used
   *   `req.user?.schoolId || req.user?.districtId || scopeId`
   * which for a SUPER_ADMIN triggering lockdown on a partner tenant
   * stamped the admin's OWN tenant in the audit log. Responders
   * reviewing the scope tenant's audit trail would see no record of
   * the trigger.
   *
   * Rules:
   *   - scopeType='tenant'  → scopeId IS the tenantId
   *   - scopeType='group'   → look up ScreenGroup.tenantId
   *   - scopeType='device'  → look up Screen.tenantId
   *   - fallback            → req.user's own tenant (defensible for
   *                           scope types we haven't built yet)
   */
  private async resolveAuditTenantId(
    scopeType: string,
    scopeId: string,
    reqUser: any,
  ): Promise<string> {
    try {
      if (scopeType === 'tenant') return scopeId;
      if (scopeType === 'group') {
        const g = await this.prisma.client.screenGroup.findUnique({
          where: { id: scopeId },
          select: { tenantId: true },
        });
        if (g?.tenantId) return g.tenantId;
      }
      if (scopeType === 'device') {
        const s = await this.prisma.client.screen.findUnique({
          where: { id: scopeId },
          select: { tenantId: true },
        });
        if (s?.tenantId) return s.tenantId;
      }
    } catch {
      /* fall through to caller's tenant */
    }
    return reqUser?.schoolId || reqUser?.districtId || reqUser?.tenantId || scopeId;
  }

  @Post('trigger')
  @AllowPanicBypass()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async triggerEmergency(
    @Body(new ZodValidationPipe(TriggerEmergencyInputSchema)) body: TriggerEmergencyInput,
    @Req() req: any,
  ) {
    const { scopeType, scopeId, overridePayload } = body;
    
    const overrideId = overridePayload.overrideId || `ovr_${crypto.randomUUID()}`;
    const severity = overridePayload.severity || 'CRITICAL';
    const message = {
      type: 'OVERRIDE',
      payload: {
        overrideId,
        severity,
        mediaUrl: overridePayload.mediaUrl,
        textBlob: overridePayload.textBlob,
        expiresAt: overridePayload.expiresAt || (Math.floor(Date.now() / 1000) + 3600) // 1 hr default
      }
    };

    // If targeting a tenant (e.g., a school), update its emergencyStatus persistently
    if (scopeType === 'tenant') {
      let activePlaylistId = overridePayload.playlistId || null;
      // Portrait variant resolved alongside the landscape playlist so
      // each screen can auto-pick the right one at manifest time.
      // null-safe: if a tenant hasn't configured a portrait variant,
      // this stays null and the manifest falls back to landscape.
      let activePortraitPlaylistId: string | null = null;

      // If no playlist was explicitly provided, auto-resolve based on
      // the configured Panic Button content for this panic type.
      if (!activePlaylistId) {
        const tenantInfo = await this.prisma.client.tenant.findUnique({ where: { id: scopeId } });
        if (tenantInfo) {
          const t = tenantInfo as any;
          switch (overridePayload.type) {
            case 'lockdown':
              activePlaylistId = tenantInfo.panicLockdownPlaylistId;
              activePortraitPlaylistId = t.panicLockdownPortraitPlaylistId ?? null;
              break;
            case 'weather':
              activePlaylistId = tenantInfo.panicWeatherPlaylistId;
              activePortraitPlaylistId = t.panicWeatherPortraitPlaylistId ?? null;
              break;
            case 'evacuate':
              activePlaylistId = tenantInfo.panicEvacuatePlaylistId;
              activePortraitPlaylistId = t.panicEvacuatePortraitPlaylistId ?? null;
              break;
            case 'hold':
              activePlaylistId = t.panicHoldPlaylistId ?? null;
              activePortraitPlaylistId = t.panicHoldPortraitPlaylistId ?? null;
              break;
            case 'secure':
              activePlaylistId = t.panicSecurePlaylistId ?? null;
              activePortraitPlaylistId = t.panicSecurePortraitPlaylistId ?? null;
              break;
            case 'medical':
              activePlaylistId = t.panicMedicalPlaylistId ?? null;
              activePortraitPlaylistId = t.panicMedicalPortraitPlaylistId ?? null;
              break;
          }
        }
      }

      // Resolve the CANONICAL tenantId for the audit row — must be the
      // scope's tenant, not the acting admin's home tenant (see
      // resolveAuditTenantId JSDoc).
      const auditTenantId = await this.resolveAuditTenantId(scopeType, scopeId, req.user);

      // Wrap state mutation + audit in one transaction so a concurrent
      // trigger or all-clear can't leave the Tenant in a half-updated
      // state where emergencyStatus says CRITICAL but emergencyPlaylistId
      // is null (or vice versa). All-or-nothing. Both orientation
      // pointers flip together so portrait + landscape screens see the
      // same emergency transition at the same moment.
      await this.prisma.client.$transaction([
        this.prisma.client.tenant.update({
          where: { id: scopeId },
          data: {
            emergencyStatus: severity,
            emergencyPlaylistId: activePlaylistId || null,
            emergencyPortraitPlaylistId: activePortraitPlaylistId || null,
          } as any,
        }),
        this.prisma.client.auditLog.create({
          data: {
            action: 'TRIGGER_EMERGENCY',
            targetType: scopeType,
            targetId: scopeId,
            tenantId: auditTenantId,
            userId: req.user?.id,
            details: JSON.stringify({ overrideId, severity, portraitPlaylistId: activePortraitPlaylistId, triggeredByTenant: req.user?.tenantId }),
          },
        }),
      ]);
    } else {
      // Non-tenant scope (group / device) — still need an audit row but
      // no Tenant.update is involved so a single insert is fine.
      const auditTenantId = await this.resolveAuditTenantId(scopeType, scopeId, req.user);
      await this.prisma.client.auditLog.create({
        data: {
          action: 'TRIGGER_EMERGENCY',
          targetType: scopeType,
          targetId: scopeId,
          tenantId: auditTenantId,
          userId: req.user?.id,
          details: JSON.stringify({ overrideId, severity, triggeredByTenant: req.user?.tenantId }),
        },
      });
    }

    // Create WSSP envelope before transmission (Mitigates RT-01)
    const signedMessage = this.signer.signMessage('OVERRIDE', message.payload);

    // Hot-path cache invalidation — the manifest endpoint caches
    // tenant emergency state for 2s per tenant to dodge the polling
    // herd. Emergency trigger is the moment we MUST bust that cache
    // so the next poll from any screen in the tenant sees the new
    // state without waiting for the 2s TTL.
    if (scopeType === 'tenant') invalidateTenantState(scopeId);

    // Publish via Redis for WebSocket fanout (graceful fallback if offline)
    const channel = `${scopeType}:${scopeId}`;
    try {
      await this.redisService.publish(channel, signedMessage);
    } catch (error) {
      Sentry.withScope((s) => {
        s.setTag('emergency.action', 'trigger');
        s.setTag('emergency.scopeType', scopeType);
        s.setUser({ id: req.user?.id });
        s.setExtra('overrideId', overrideId);
        s.setExtra('channel', channel);
        Sentry.captureException(error);
      });
      console.warn(`[Emergency] Redis publish failed for ${channel}. Realtime bypass disabled. Screens will pull via HTTP polling. Error: ${error}`);
    }

    return {
      success: true,
      overrideId,
      message: `Emergency dispatched to ${channel}`
    };
  }

  @Post(':overrideId/all-clear')
  @AllowPanicBypass()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async clearEmergency(
    @Param('overrideId') overrideId: string,
    @Body(new ZodValidationPipe(ClearEmergencyInputSchema)) body: ClearEmergencyInput,
    @Req() req: any,
  ) {
    const { scopeType, scopeId } = body;
    const clearedBy = req.user?.id || 'admin_system';

    // ALL_CLEAR is classified as SENSITIVE on the player. The player
    // DROPS any SENSITIVE event missing a `signature` field — so if we
    // publish this plain, screens stay stuck on lockdown until the 10s
    // HTTP manifest poll notices emergencyStatus=INACTIVE. That's the
    // "stuck on lockdown after all-clear" life-safety bug. Sign the
    // payload through the same signer every other emergency type uses.
    const signedMessage = this.signer.signMessage('ALL_CLEAR', {
      overrideId,
      clearedBy,
    });

    // Resolve audit row's tenantId to the SCOPE's tenant (see
    // resolveAuditTenantId) so an ALL_CLEAR by a SUPER_ADMIN on a
    // partner tenant is logged under that tenant's audit trail.
    const auditTenantId = await this.resolveAuditTenantId(scopeType, scopeId, req.user);

    // If targeting a tenant, clear its emergencyStatus + audit atomically.
    // Clear BOTH orientation pointers so a portrait screen doesn't keep
    // rendering an emergency after the admin hit all-clear.
    if (scopeType === 'tenant') {
      await this.prisma.client.$transaction([
        this.prisma.client.tenant.update({
          where: { id: scopeId },
          data: {
            emergencyStatus: 'INACTIVE',
            emergencyPlaylistId: null,
            emergencyPortraitPlaylistId: null,
          } as any,
        }),
        this.prisma.client.auditLog.create({
          data: {
            action: 'CLEAR_EMERGENCY',
            targetType: scopeType,
            targetId: scopeId,
            tenantId: auditTenantId,
            userId: req.user?.id,
            details: JSON.stringify({ overrideId, triggeredByTenant: req.user?.tenantId }),
          },
        }),
      ]);
    } else {
      await this.prisma.client.auditLog.create({
        data: {
          action: 'CLEAR_EMERGENCY',
          targetType: scopeType,
          targetId: scopeId,
          tenantId: auditTenantId,
          userId: req.user?.id,
          details: JSON.stringify({ overrideId, triggeredByTenant: req.user?.tenantId }),
        },
      });
    }

    // Hot-path cache invalidation so the next manifest poll from any
    // screen in the tenant picks up INACTIVE without waiting for TTL.
    if (scopeType === 'tenant') invalidateTenantState(scopeId);

    // Publish via Redis for fanout
    const channel = `${scopeType}:${scopeId}`;
    try {
      await this.redisService.publish(channel, signedMessage);
    } catch (error) {
      Sentry.withScope((s) => {
        s.setTag('emergency.action', 'all-clear');
        s.setTag('emergency.scopeType', scopeType);
        s.setUser({ id: req.user?.id });
        s.setExtra('overrideId', overrideId);
        s.setExtra('channel', channel);
        Sentry.captureException(error);
      });
      console.warn(`[Emergency] Redis publish failed for ${channel}.`);
    }

    return {
      success: true,
      message: `All clear dispatched to ${channel} for ${overrideId}`
    };
  }

  // ───────────────────────────────────────────────────────────
  // Sprint 5: Emergency System Expansion
  // SOS, broadcast text, media-rich alerts, polling fallback.
  // Each new endpoint mirrors the /trigger flow exactly:
  //   1. Persist an EmergencyMessage (polling fallback source)
  //   2. Write an immutable AuditLog entry
  //   3. Sign the payload with WebsocketSignerService
  //   4. Publish to Redis; swallow failures so screens poll
  // ───────────────────────────────────────────────────────────

  /**
   * Staff SOS trigger. Intentionally permissive on role — any authenticated
   * user EXCEPT RESTRICTED_VIEWER can fire (covers teachers + non-admin
   * staff who aren't provisioned for /trigger). RESTRICTED_VIEWER is
   * read-only by definition and shouldn't have any panic capability.
   *
   * Audit fix (#4): explicitly block RESTRICTED_VIEWER instead of relying
   * on it never being deployed. Hold-to-trigger UX on the client + audit
   * log per attempt remain the abuse mitigations.
   */
  @Post('sos')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async triggerSos(
    @Body(new ZodValidationPipe(SosInputSchema)) body: SosInput,
    @Req() req: any,
  ) {
    const user = req.user || {};
    const tenantId = user.schoolId || user.tenantId || user.districtId;
    if (!tenantId) {
      return { success: false, message: 'SOS rejected — user has no tenant context' };
    }

    const messageId = `sos_${crypto.randomUUID()}`;
    const severity = 'CRITICAL';
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

    const textBlob = body.location
      ? `SOS from ${user.email || 'staff'} — ${body.location}`
      : `SOS from ${user.email || 'staff'}`;

    // Wrap message + audit in one transaction so a failure in either
    // one rolls both back — no orphan EmergencyMessage without audit,
    // no audit row referencing a message that never persisted.
    await this.prisma.client.$transaction([
      this.prisma.client.emergencyMessage.create({
        data: {
          id: messageId,
          tenantId,
          triggeredByUserId: user.id || null,
          type: 'SOS',
          severity,
          textBlob,
          mediaUrls: null,
          audioUrl: body.voiceClipUrl || null,
          scopeType: 'tenant',
          scopeId: tenantId,
          expiresAt,
        },
      }),
      this.prisma.client.auditLog.create({
        data: {
          action: 'SOS_TRIGGER',
          targetType: 'tenant',
          targetId: tenantId,
          tenantId,
          userId: user.id,
          details: JSON.stringify({
            messageId,
            severity,
            location: body.location || null,
            hasVoiceClip: !!body.voiceClipUrl,
            triggerAt: new Date().toISOString(),
          }),
        },
      }),
    ]);

    const signedMessage = this.signer.signMessage('SOS', {
      messageId,
      severity,
      textBlob,
      audioUrl: body.voiceClipUrl,
      location: body.location,
      triggeredBy: user.email || user.id,
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
    });

    const channel = `tenant:${tenantId}`;
    try {
      await this.redisService.publish(channel, signedMessage);
    } catch (error) {
      Sentry.withScope((s) => {
        s.setTag('emergency.action', 'sos');
        s.setTag('emergency.scopeType', 'tenant');
        s.setUser({ id: user.id });
        s.setExtra('messageId', messageId);
        s.setExtra('channel', channel);
        Sentry.captureException(error);
      });
      console.warn(`[Emergency] SOS redis publish failed for ${channel}. Falling back to HTTP polling. Error: ${error}`);
    }

    return { success: true, messageId, message: `SOS dispatched to ${channel}` };
  }

  /**
   * Text-overlay broadcast. Renders on top of the running playlist.
   * Admins only, same role set as /trigger.
   */
  @Post('broadcast')
  @AllowPanicBypass()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async broadcastText(
    @Body(new ZodValidationPipe(BroadcastInputSchema)) body: BroadcastInput,
    @Req() req: any,
  ) {
    const user = req.user || {};
    const { scopeType, scopeId, text, severity, durationMs } = body;

    const messageId = `bcast_${crypto.randomUUID()}`;
    const expiresAtDate = body.expiresAt
      ? new Date(typeof body.expiresAt === 'number' ? body.expiresAt * 1000 : body.expiresAt)
      : durationMs
        ? new Date(Date.now() + durationMs)
        : new Date(Date.now() + 5 * 60 * 1000); // 5 min default

    const resolvedTenantId = user.schoolId || user.districtId || scopeId;

    // Atomic message + audit so a partial failure can't orphan either row.
    await this.prisma.client.$transaction([
      this.prisma.client.emergencyMessage.create({
        data: {
          id: messageId,
          tenantId: resolvedTenantId,
          triggeredByUserId: user.id || null,
          type: 'TEXT_BROADCAST',
          severity,
          textBlob: text,
          mediaUrls: null,
          audioUrl: null,
          scopeType,
          scopeId,
          expiresAt: expiresAtDate,
        },
      }),
      this.prisma.client.auditLog.create({
        data: {
          action: 'BROADCAST_TEXT',
          targetType: scopeType,
          targetId: scopeId,
          tenantId: resolvedTenantId,
          userId: user.id,
          details: JSON.stringify({ messageId, severity, len: text.length, durationMs }),
        },
      }),
    ]);

    const signedMessage = this.signer.signMessage('TEXT_BROADCAST', {
      messageId,
      severity,
      text,
      expiresAt: Math.floor(expiresAtDate.getTime() / 1000),
    });

    const channel = `${scopeType}:${scopeId}`;
    try {
      await this.redisService.publish(channel, signedMessage);
    } catch (error) {
      Sentry.withScope((s) => {
        s.setTag('emergency.action', 'broadcast');
        s.setTag('emergency.scopeType', scopeType);
        s.setUser({ id: user.id });
        s.setExtra('messageId', messageId);
        s.setExtra('channel', channel);
        Sentry.captureException(error);
      });
      console.warn(`[Emergency] Broadcast redis publish failed for ${channel}. Falling back to HTTP polling. Error: ${error}`);
    }

    return { success: true, messageId, message: `Broadcast dispatched to ${channel}` };
  }

  /**
   * Media-rich emergency alert — images/video/audio attached.
   */
  @Post('media-alert')
  @AllowPanicBypass()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async mediaAlert(
    @Body(new ZodValidationPipe(MediaAlertInputSchema)) body: MediaAlertInput,
    @Req() req: any,
  ) {
    const user = req.user || {};
    const { scopeType, scopeId, mediaUrls, audioUrl, textBlob, severity } = body;

    const messageId = `media_${crypto.randomUUID()}`;
    const expiresAtDate = body.expiresAt
      ? new Date(typeof body.expiresAt === 'number' ? body.expiresAt * 1000 : body.expiresAt)
      : new Date(Date.now() + 60 * 60 * 1000); // 1 hr default

    const resolvedTenantId = user.schoolId || user.districtId || scopeId;

    // Atomic message + audit — matches the other emergency endpoints.
    await this.prisma.client.$transaction([
      this.prisma.client.emergencyMessage.create({
        data: {
          id: messageId,
          tenantId: resolvedTenantId,
          triggeredByUserId: user.id || null,
          type: 'MEDIA_ALERT',
          severity,
          textBlob,
          mediaUrls: mediaUrls && mediaUrls.length ? JSON.stringify(mediaUrls) : null,
          audioUrl: audioUrl || null,
          scopeType,
          scopeId,
          expiresAt: expiresAtDate,
        },
      }),
      this.prisma.client.auditLog.create({
        data: {
          action: 'MEDIA_ALERT',
          targetType: scopeType,
          targetId: scopeId,
          tenantId: resolvedTenantId,
          userId: user.id,
          details: JSON.stringify({
            messageId,
            severity,
            mediaCount: mediaUrls.length,
            hasAudio: !!audioUrl,
          }),
        },
      }),
    ]);

    const signedMessage = this.signer.signMessage('MEDIA_ALERT', {
      messageId,
      severity,
      textBlob,
      mediaUrls,
      audioUrl,
      expiresAt: Math.floor(expiresAtDate.getTime() / 1000),
    });

    const channel = `${scopeType}:${scopeId}`;
    try {
      await this.redisService.publish(channel, signedMessage);
    } catch (error) {
      Sentry.withScope((s) => {
        s.setTag('emergency.action', 'media-alert');
        s.setTag('emergency.scopeType', scopeType);
        s.setUser({ id: user.id });
        s.setExtra('messageId', messageId);
        s.setExtra('channel', channel);
        Sentry.captureException(error);
      });
      console.warn(`[Emergency] Media alert redis publish failed for ${channel}. Falling back to HTTP polling. Error: ${error}`);
    }

    return { success: true, messageId, message: `Media alert dispatched to ${channel}` };
  }

  /**
   * All-clear for a specific EmergencyMessage (SOS / broadcast / media-alert).
   * Existing `:overrideId/all-clear` stays untouched for legacy overrides.
   */
  @Post('messages/:messageId/all-clear')
  @AllowPanicBypass()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async clearMessage(
    @Param('messageId') messageId: string,
    @Req() req: any,
  ) {
    const user = req.user || {};
    const existing = await this.prisma.client.emergencyMessage.findUnique({ where: { id: messageId } });
    if (!existing) {
      return { success: false, message: 'Emergency message not found' };
    }

    // Atomic clear + audit — if audit fails we must not leave the
    // message marked cleared with no trail of who did it.
    await this.prisma.client.$transaction([
      this.prisma.client.emergencyMessage.update({
        where: { id: messageId },
        data: { clearedAt: new Date(), clearedByUserId: user.id || null },
      }),
      this.prisma.client.auditLog.create({
        data: {
          action: 'CLEAR_EMERGENCY_MESSAGE',
          targetType: existing.scopeType,
          targetId: existing.scopeId,
          tenantId: existing.tenantId,
          userId: user.id,
          details: JSON.stringify({ messageId, type: existing.type }),
        },
      }),
    ]);

    const channel = `${existing.scopeType}:${existing.scopeId}`;
    const signedMessage = this.signer.signMessage('ALL_CLEAR', {
      messageId,
      clearedBy: user.id || 'admin_system',
    });
    try {
      await this.redisService.publish(channel, signedMessage);
    } catch (error) {
      Sentry.withScope((s) => {
        s.setTag('emergency.action', 'clear-message');
        s.setTag('emergency.scopeType', existing.scopeType);
        s.setUser({ id: user.id });
        s.setExtra('messageId', messageId);
        s.setExtra('channel', channel);
        Sentry.captureException(error);
      });
      console.warn(`[Emergency] Clear publish failed for ${channel}. Error: ${error}`);
    }

    return { success: true, message: `All clear for ${messageId} dispatched to ${channel}` };
  }

  /**
   * HTTP polling fallback. Screens poll this every ~10s when Redis
   * is unavailable. Returns active (not cleared, not expired)
   * emergency messages for the given tenant/scope.
   * Intentionally unauthenticated at JWT level is NOT permitted —
   * screens paired to a tenant receive a device JWT separately.
   * For now we inherit controller-wide JwtAuthGuard; device auth
   * is a separate follow-up.
   */
  @Get('status')
  async status(
    @Req() req: any,
    @Query('tenantId') queryTenantId: string,
    @Query('scopeType') scopeType?: string,
    @Query('scopeId') scopeId?: string,
  ) {
    // Hardening (Sprint 7E audit fix #1): the caller can only see their
    // own tenant's emergency state. SUPER_ADMIN may pass an explicit
    // tenantId in the query; everyone else is locked to req.user.tenantId
    // regardless of what they pass. This was previously unscoped — any
    // authenticated user could enumerate tenant IDs and harvest active
    // lockdown messages from other schools.
    const callerTenantId = req.user?.schoolId || req.user?.tenantId || req.user?.districtId;
    const isSuper = req.user?.role === AppRole.SUPER_ADMIN;
    const tenantId = isSuper ? (queryTenantId || callerTenantId) : callerTenantId;

    if (!tenantId) {
      return { active: [], tenantId: null };
    }

    const now = new Date();
    const where: any = {
      tenantId,
      clearedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
    if (scopeType) where.scopeType = scopeType;
    if (scopeId) where.scopeId = scopeId;

    const rows = await this.prisma.client.emergencyMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: tenantId } });

    return {
      tenantId,
      tenantStatus: tenant?.emergencyStatus || 'INACTIVE',
      tenantPlaylistId: tenant?.emergencyPlaylistId || null,
      active: rows.map(r => ({
        id: r.id,
        type: r.type,
        severity: r.severity,
        textBlob: r.textBlob,
        mediaUrls: r.mediaUrls ? JSON.parse(r.mediaUrls) : [],
        audioUrl: r.audioUrl,
        scopeType: r.scopeType,
        scopeId: r.scopeId,
        expiresAt: r.expiresAt ? Math.floor(r.expiresAt.getTime() / 1000) : null,
        createdAt: r.createdAt.toISOString(),
        triggeredByUserId: r.triggeredByUserId,
      })),
    };
  }
}
