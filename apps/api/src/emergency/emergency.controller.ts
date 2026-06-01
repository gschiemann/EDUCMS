import { Controller, Post, Get, Body, Param, Query, Req, UseGuards, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
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
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { invalidateTenantState } from '../screens/manifest-hot-cache';
// 2026-05-27 — Goodview EP6N GPIO. When the emergency trigger fires
// on a tenant, sweep every screen whose GPIO OUT is wired to a
// status_lamp + flip the lamp high. On all-clear, flip it back to
// low. Implemented in GpioService.driveStatusLampForEmergency().
import { GpioService } from '../screens/gpio.service';
import {
  assertAllowedEmergencyMediaUrl,
  assertAllowedEmergencyMediaUrls,
} from './media-url-guard';
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
    private readonly signer: WebsocketSignerService,
    // 2026-05-25 Developer area: outbound webhook dispatch on
    // emergency-triggered + emergency-cleared events. Fire-and-forget;
    // never blocks the response path. Injected from the global
    // WebhooksModule.
    private readonly webhookDispatch: WebhookDispatchService,
    // 2026-05-27 — auto-drive a wired GPIO status lamp during
    // tenant-wide emergencies. Injected from the global GpioModule.
    // Fire-and-forget — never blocks the response path or the
    // life-safety trigger transaction. See call sites below.
    private readonly gpio: GpioService,
  ) {}

  private emergencyTypeKey(type?: string | null): string | null {
    const value = String(type || '').trim().toUpperCase();
    return value || null;
  }

  private isPortraitScreen(screen: any): boolean {
    const resolution = String(screen?.resolution || '').trim();
    const match = resolution.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) return false;
    return Number.parseInt(match[2], 10) > Number.parseInt(match[1], 10);
  }

  private pickTenantPanicPlaylists(tenantInfo: any, type?: string | null): {
    landscape: string | null;
    portrait: string | null;
  } {
    const t = tenantInfo || {};
    switch (type) {
      case 'lockdown':
        return {
          landscape: t.panicLockdownPlaylistId ?? null,
          portrait: t.panicLockdownPortraitPlaylistId ?? null,
        };
      case 'weather':
        return {
          landscape: t.panicWeatherPlaylistId ?? null,
          portrait: t.panicWeatherPortraitPlaylistId ?? null,
        };
      case 'evacuate':
        return {
          landscape: t.panicEvacuatePlaylistId ?? null,
          portrait: t.panicEvacuatePortraitPlaylistId ?? null,
        };
      case 'hold':
        return {
          landscape: t.panicHoldPlaylistId ?? null,
          portrait: t.panicHoldPortraitPlaylistId ?? null,
        };
      case 'secure':
        return {
          landscape: t.panicSecurePlaylistId ?? null,
          portrait: t.panicSecurePortraitPlaylistId ?? null,
        };
      case 'medical':
        return {
          landscape: t.panicMedicalPlaylistId ?? null,
          portrait: t.panicMedicalPortraitPlaylistId ?? null,
        };
      default:
        return { landscape: null, portrait: null };
    }
  }

  private pickScreenEmergencyContent(screen: any, typeKey: string | null): {
    playlistId: string | null;
    mediaUrl: string | null;
  } {
    const isPortrait = this.isPortraitScreen(screen);
    const pick = (
      landscapePlaylist?: string | null,
      portraitPlaylist?: string | null,
      landscapeAsset?: string | null,
      portraitAsset?: string | null,
    ) => ({
      playlistId: isPortrait
        ? (portraitPlaylist || landscapePlaylist || null)
        : (landscapePlaylist || portraitPlaylist || null),
      mediaUrl: isPortrait
        ? (portraitAsset || landscapeAsset || null)
        : (landscapeAsset || portraitAsset || null),
    });

    switch (typeKey) {
      case 'LOCKDOWN':
        return pick(
          screen.emergencyLockdownPlaylistId,
          screen.emergencyLockdownPortraitPlaylistId,
          screen.emergencyLockdownAssetUrl,
          screen.emergencyLockdownPortraitAssetUrl,
        );
      case 'EVACUATE':
        return pick(
          screen.emergencyEvacuatePlaylistId,
          screen.emergencyEvacuatePortraitPlaylistId,
          screen.emergencyEvacuateAssetUrl,
          screen.emergencyEvacuatePortraitAssetUrl,
        );
      case 'WEATHER':
        return pick(
          screen.emergencyWeatherPlaylistId,
          screen.emergencyWeatherPortraitPlaylistId,
          screen.emergencyWeatherAssetUrl,
          screen.emergencyWeatherPortraitAssetUrl,
        );
      case 'HOLD':
        return pick(
          screen.emergencyHoldPlaylistId,
          screen.emergencyHoldPortraitPlaylistId,
          screen.emergencyHoldAssetUrl,
          screen.emergencyHoldPortraitAssetUrl,
        );
      case 'SECURE':
        return pick(
          screen.emergencySecurePlaylistId,
          screen.emergencySecurePortraitPlaylistId,
          screen.emergencySecureAssetUrl,
          screen.emergencySecurePortraitAssetUrl,
        );
      case 'MEDICAL':
        return pick(
          screen.emergencyMedicalPlaylistId,
          screen.emergencyMedicalPortraitPlaylistId,
          screen.emergencyMedicalAssetUrl,
          screen.emergencyMedicalPortraitAssetUrl,
        );
      default:
        return { playlistId: null, mediaUrl: null };
    }
  }

  private emergencyExpiresAt(value?: string | number | null): Date | null {
    if (!value) return null;
    const parsed = typeof value === 'number'
      ? (value < 10_000_000_000 ? value * 1000 : value)
      : Date.parse(String(value));
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }

  /**
   * Build per-screen ScreenEmergencyOverride upserts for a group/device-scoped
   * emergency so the HTTP-poll manifest backstop reflects it (not only the
   * realtime WS/SSE fan-out). The manifest's emergency check is
   * `!!activeScreenOverride || tenant.emergencyStatus !== 'INACTIVE'`, and
   * group/device triggers never touch Tenant.emergencyStatus — so without a
   * per-screen row, a poll-only kiosk (WS AND SSE both blocked) sees nothing.
   *
   * Content precedence mirrors the tenant location-based path: the admin's
   * explicit playlist > the screen's configured per-type emergency content >
   * the tenant's panic-playlist fallback (orientation-aware); a media URL is
   * used only when no playlist resolves.
   */
  private buildScreenEmergencyUpserts(
    screens: any[],
    opts: {
      tenantId: string;
      severity: string;
      overridePayload: any;
      panicLandscape: string | null;
      panicPortrait: string | null;
      triggeredByUserId: string;
    },
  ): any[] {
    const typeKey = this.emergencyTypeKey(opts.overridePayload.type);
    const explicitPlaylistId = opts.overridePayload.playlistId || null;
    return screens.map((screen) => {
      const screenContent = this.pickScreenEmergencyContent(screen, typeKey);
      const isPortrait = this.isPortraitScreen(screen);
      const tenantFallbackPlaylistId = isPortrait
        ? (opts.panicPortrait || opts.panicLandscape || null)
        : (opts.panicLandscape || opts.panicPortrait || null);
      const playlistId =
        explicitPlaylistId
        || screenContent.playlistId
        || (screenContent.mediaUrl ? null : tenantFallbackPlaylistId);
      const mediaUrl = playlistId
        ? null
        : (screenContent.mediaUrl || opts.overridePayload.mediaUrl || null);
      const data = {
        type: typeKey || 'CUSTOM',
        severity: opts.severity,
        playlistId,
        mediaUrl,
        textBlob: opts.overridePayload.textBlob || null,
        expiresAt: this.emergencyExpiresAt(opts.overridePayload.expiresAt),
        triggeredByUserId: opts.triggeredByUserId,
      };
      return (this.prisma.client as any).screenEmergencyOverride.upsert({
        where: { screenId: screen.id },
        create: { screenId: screen.id, tenantId: opts.tenantId, ...data },
        update: { ...data, triggeredAt: new Date() },
      });
    });
  }

  /**
   * SECURITY: Resolve the tenantId that OWNS the given scope and verify the
   * requesting user is allowed to act on it.
   *
   * This is the single access-control gate for all emergency write endpoints.
   * It must be called before any state mutation or pub/sub publish.
   *
   * Resolution + authorisation rules:
   *   - scopeType='tenant' : scopeId IS the tenantId.
   *                          SUPER_ADMIN may target any tenant.
   *                          All others must match their own tenantId.
   *   - scopeType='group'  : look up ScreenGroup.tenantId.
   *                          Caller must own that tenant (same rule as above).
   *   - scopeType='device' : look up Screen.tenantId.
   *                          Caller must own that tenant.
   *   - unknown scopeType  : always 400 — we never guess.
   *
   * Throws:
   *   BadRequestException   — unknown scopeType
   *   NotFoundException     — group/screen id not found in DB
   *   ForbiddenException    — caller does not own the resolved tenant
   *
   * Returns the verified owning tenantId (safe to use for audit rows,
   * pub/sub channels, and DB mutations).
   */
  private async resolveScopeTenant(
    scopeType: string,
    scopeId: string,
    reqUser: any,
  ): Promise<string> {
    const callerTenantId: string =
      reqUser?.tenantId || reqUser?.schoolId || reqUser?.districtId;
    const isSuper: boolean = reqUser?.role === AppRole.SUPER_ADMIN;

    let owningTenantId: string;

    if (scopeType === 'tenant') {
      owningTenantId = scopeId;
    } else if (scopeType === 'group') {
      const group = await this.prisma.client.screenGroup.findUnique({
        where: { id: scopeId },
        select: { tenantId: true },
      });
      if (!group) {
        throw new NotFoundException(`Screen group '${scopeId}' not found`);
      }
      owningTenantId = group.tenantId;
    } else if (scopeType === 'device') {
      const screen = await this.prisma.client.screen.findUnique({
        where: { id: scopeId },
        select: { tenantId: true },
      });
      if (!screen) {
        throw new NotFoundException(`Screen '${scopeId}' not found`);
      }
      if (!screen.tenantId) {
        throw new BadRequestException(`Screen '${scopeId}' is not assigned to a tenant`);
      }
      // screen.tenantId is non-null here — guarded by the throw above.
      owningTenantId = screen.tenantId!;
    } else {
      throw new BadRequestException(
        `Unknown scopeType '${scopeType}'. Must be tenant, group, or device.`,
      );
    }

    // SUPER_ADMIN may act on any tenant; everyone else is strictly
    // confined to their own tenant. Deny anything else with 403.
    if (!isSuper && owningTenantId !== callerTenantId) {
      throw new ForbiddenException(
        'You do not have permission to trigger emergency actions for this scope.',
      );
    }

    return owningTenantId;
  }

  /**
   * @deprecated Use resolveScopeTenant for all write endpoints.
   * Kept only for the read-path (resolveAuditTenantId is now a thin
   * wrapper that trusts the already-verified owningTenantId passed by
   * resolveScopeTenant callers).
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
    return reqUser?.tenantId || reqUser?.schoolId || reqUser?.districtId || scopeId;
  }

  @Post('trigger')
  @AllowPanicBypass()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async triggerEmergency(
    @Body(new ZodValidationPipe(TriggerEmergencyInputSchema)) body: TriggerEmergencyInput,
    @Req() req: any,
  ) {
    const { scopeType, scopeId, overridePayload } = body;

    // SECURITY: reject any operator-supplied media URL that isn't on the
    // tenant's storage allowlist (Supabase by default). Without this an
    // admin (legitimate or compromised) could paint file:///etc/hosts or
    // arbitrary attacker content onto every screen in the district.
    assertAllowedEmergencyMediaUrl(overridePayload?.mediaUrl, 'overridePayload.mediaUrl');

    // SECURITY: verify the caller owns the target scope before any mutation.
    // Throws 400 (unknown scopeType), 404 (scope not found), or 403 (cross-tenant).
    const ownedTenantId = await this.resolveScopeTenant(scopeType, scopeId, req.user);

    // SECURITY (Lane-1 re-audit P0): verify the override's playlistId belongs
    // to the scope's tenant — same shape as the panic-settings fix in
    // tenants.controller. Without this a SCHOOL_ADMIN can paste another
    // tenant's playlist UUID and that playlist plays on every screen the
    // trigger reaches.
    if (overridePayload?.playlistId) {
      const ok = await this.prisma.client.playlist.findFirst({
        where: { id: overridePayload.playlistId, tenantId: ownedTenantId },
        select: { id: true },
      });
      if (!ok) {
        throw new NotFoundException(
          `Playlist not found in this tenant: ${overridePayload.playlistId}`,
        );
      }
    }

    const overrideId = overridePayload.overrideId || `ovr_${crypto.randomUUID()}`;
    const severity = overridePayload.severity || 'CRITICAL';
    const message = {
      type: 'OVERRIDE',
      payload: {
        overrideId,
        severity,
        type: overridePayload.type,
        playlistId: overridePayload.playlistId,
        mediaUrl: overridePayload.mediaUrl,
        textBlob: overridePayload.textBlob,
        expiresAt: overridePayload.expiresAt || (Math.floor(Date.now() / 1000) + 3600) // 1 hr default
      }
    };

    // If targeting a tenant (e.g., a school), update its emergencyStatus persistently
    if (scopeType === 'tenant') {
      const explicitPlaylistId = !!overridePayload.playlistId;
      let activePlaylistId = overridePayload.playlistId || null;
      // Portrait variant resolved alongside the landscape playlist so
      // each screen can auto-pick the right one at manifest time.
      // null-safe: if a tenant hasn't configured a portrait variant,
      // this stays null and the manifest falls back to landscape.
      let activePortraitPlaylistId: string | null = null;
      const tenantInfo = await this.prisma.client.tenant.findUnique({ where: { id: scopeId } });

      // If no playlist was explicitly provided, auto-resolve based on
      // the configured Panic Button content for this panic type.
      if (tenantInfo) {
        const tenantPlaylists = this.pickTenantPanicPlaylists(tenantInfo, overridePayload.type);
        if (!activePlaylistId) {
          activePlaylistId = tenantPlaylists.landscape;
          activePortraitPlaylistId = tenantPlaylists.portrait;
        } else if (!explicitPlaylistId) {
          activePortraitPlaylistId = tenantPlaylists.portrait;
        }
      }

      const typeKey = this.emergencyTypeKey(overridePayload.type);
      const locationBasedOverrides: any[] = [];
      let locationScreenCount = 0;
      let locationSpecificCount = 0;

      if ((tenantInfo as any)?.locationBasedEmergencyEnabled) {
        const screens = await this.prisma.client.screen.findMany({
          where: { tenantId: scopeId },
        });
        locationScreenCount = screens.length;

        for (const screen of screens) {
          const screenContent = this.pickScreenEmergencyContent(screen, typeKey);
          const isPortrait = this.isPortraitScreen(screen);
          const tenantFallbackPlaylistId = isPortrait
            ? (activePortraitPlaylistId || activePlaylistId || null)
            : (activePlaylistId || activePortraitPlaylistId || null);

          if (screenContent.playlistId || screenContent.mediaUrl) {
            locationSpecificCount += 1;
          }

          const playlistId = screenContent.playlistId || (screenContent.mediaUrl ? null : tenantFallbackPlaylistId);
          const mediaUrl = screenContent.playlistId
            ? null
            : (screenContent.mediaUrl || (playlistId ? null : (overridePayload.mediaUrl || null)));

          locationBasedOverrides.push((this.prisma.client as any).screenEmergencyOverride.upsert({
            where: { screenId: screen.id },
            create: {
              screenId: screen.id,
              tenantId: scopeId,
              type: typeKey || 'CUSTOM',
              severity,
              playlistId,
              mediaUrl,
              textBlob: overridePayload.textBlob || null,
              expiresAt: this.emergencyExpiresAt(overridePayload.expiresAt),
              triggeredByUserId: req.user?.id || 'admin_system',
            },
            update: {
              type: typeKey || 'CUSTOM',
              severity,
              playlistId,
              mediaUrl,
              textBlob: overridePayload.textBlob || null,
              expiresAt: this.emergencyExpiresAt(overridePayload.expiresAt),
              triggeredByUserId: req.user?.id || 'admin_system',
              triggeredAt: new Date(),
            },
          }));
        }
      }

      // ownedTenantId already verified above — use it for the audit row so
      // the forensic trail lives with the school that was affected.
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
            tenantId: ownedTenantId,
            userId: req.user?.id,
            details: JSON.stringify({
              overrideId,
              severity,
              type: typeKey,
              portraitPlaylistId: activePortraitPlaylistId,
              locationBasedEnabled: !!(tenantInfo as any)?.locationBasedEmergencyEnabled,
              locationScreenCount,
              locationSpecificCount,
              triggeredByTenant: req.user?.tenantId,
            }),
          },
        }),
        ...locationBasedOverrides,
      ]);
    } else {
      // Non-tenant scope (group / device). Persist per-screen
      // ScreenEmergencyOverride rows so the HTTP-poll manifest backstop ALSO
      // reflects this emergency — not just the realtime WS/SSE fan-out.
      // Previously this branch wrote only an audit row, so the manifest
      // (Tenant.emergencyStatus — untouched here — plus per-screen overrides)
      // showed nothing for a group/device lockdown: a poll-only kiosk (WS AND
      // SSE both blocked) missed it entirely. The most degraded screen must
      // not be the one that misses the lockdown. (2026-06-01.)
      const affectedScreens = scopeType === 'device'
        ? await this.prisma.client.screen.findMany({ where: { id: scopeId } })
        : await this.prisma.client.screen.findMany({ where: { screenGroupId: scopeId } });

      const tenantForFallback = await this.prisma.client.tenant.findUnique({ where: { id: ownedTenantId } });
      const panic = this.pickTenantPanicPlaylists(tenantForFallback as any, overridePayload.type);

      const overrideUpserts = this.buildScreenEmergencyUpserts(affectedScreens, {
        tenantId: ownedTenantId,
        severity,
        overridePayload,
        panicLandscape: panic.landscape,
        panicPortrait: panic.portrait,
        triggeredByUserId: req.user?.id || 'admin_system',
      });

      // ownedTenantId already verified above. Override rows + audit in one
      // transaction so a concurrent all-clear can't leave half the group's
      // screens locked down with no audit trail (or vice versa).
      await this.prisma.client.$transaction([
        this.prisma.client.auditLog.create({
          data: {
            action: 'TRIGGER_EMERGENCY',
            targetType: scopeType,
            targetId: scopeId,
            tenantId: ownedTenantId,
            userId: req.user?.id,
            details: JSON.stringify({
              overrideId,
              severity,
              scopeType,
              affectedScreenCount: affectedScreens.length,
              triggeredByTenant: req.user?.tenantId,
            }),
          },
        }),
        ...overrideUpserts,
      ]);
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

    // 2026-05-25 Developer area: outbound webhook on emergency.triggered.
    // Fire-and-forget; the response below is never blocked. Only fires
    // for tenant-scoped triggers (per-screen / per-group emergencies
    // are too granular for typical external integrations — those can
    // listen to the WS channel directly if needed).
    if (scopeType === 'tenant' && ownedTenantId) {
      this.webhookDispatch.dispatch(ownedTenantId, 'emergency.triggered', {
        overrideId,
        scopeType,
        scopeId,
        severity: message.payload?.severity ?? severity,
        type: message.payload?.type,
        triggeredAt: new Date().toISOString(),
        triggeredByUserId: req.user?.id ?? null,
      });
    }

    // 2026-05-27 — Goodview EP6N GPIO status lamp auto-drive. Sweep
    // every screen in the tenant whose `config.wiring.gpio_out1` or
    // `gpio_out2` is wired to a `status_lamp` and flip the output
    // high. Fire-and-forget — a lamp that fails to flip is logged
    // by GpioService but NEVER rolls back the emergency. Tenant-
    // scope only; group/device scope triggers don't auto-drive the
    // tenant-wide lamp signal (those have their own per-screen UX).
    if (scopeType === 'tenant' && ownedTenantId) {
      this.gpio
        .driveStatusLampForEmergency({
          tenantId: ownedTenantId,
          state: 'high',
          reason: 'emergency_trigger',
          sourceContext: { overrideId, severity, type: overridePayload.type ?? null },
        })
        .catch((e) => {
          Sentry.withScope((s) => {
            s.setTag('emergency.action', 'trigger.gpio_lamp');
            s.setTag('emergency.scopeType', scopeType);
            s.setUser({ id: req.user?.id });
            s.setExtra('overrideId', overrideId);
            Sentry.captureException(e);
          });
          console.warn(`[Emergency] GPIO status-lamp auto-drive failed (trigger): ${e}`);
        });
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

    // SECURITY: verify the caller owns the target scope before any mutation.
    const ownedTenantId = await this.resolveScopeTenant(scopeType, scopeId, req.user);

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
        (this.prisma.client as any).screenEmergencyOverride.deleteMany({
          where: { tenantId: scopeId },
        }),
        this.prisma.client.auditLog.create({
          data: {
            action: 'CLEAR_EMERGENCY',
            targetType: scopeType,
            targetId: scopeId,
            tenantId: ownedTenantId,
            userId: req.user?.id,
            details: JSON.stringify({ overrideId, triggeredByTenant: req.user?.tenantId }),
          },
        }),
      ]);
    } else if (scopeType === 'device') {
      // emergency-003 fix: previously the device-scope all-clear only
      // wrote an AuditLog row and broadcast — it never deleted the
      // ScreenEmergencyOverride. Result: the screen rebooted and re-read
      // its override row from disk, getting stuck on lockdown after the
      // operator thought they had cleared it. Delete the override row
      // atomically with the audit write so they can't drift apart.
      await this.prisma.client.$transaction([
        (this.prisma.client as any).screenEmergencyOverride.deleteMany({
          where: { screenId: scopeId, tenantId: ownedTenantId },
        }),
        this.prisma.client.auditLog.create({
          data: {
            action: 'CLEAR_EMERGENCY',
            targetType: scopeType,
            targetId: scopeId,
            tenantId: ownedTenantId,
            userId: req.user?.id,
            details: JSON.stringify({ overrideId, triggeredByTenant: req.user?.tenantId }),
          },
        }),
      ]);
    } else {
      // group scope — delete the per-screen ScreenEmergencyOverride rows we
      // created for this group's screens on trigger (symmetry with the device
      // branch above) so a poll-only kiosk drops the lockdown on all-clear
      // too. Without this a rebooted screen would re-read its override row and
      // stay locked down after all-clear — the emergency-003 bug, group-scope
      // variant. (2026-06-01.)
      const groupScreens = await this.prisma.client.screen.findMany({
        where: { screenGroupId: scopeId },
        select: { id: true },
      });
      await this.prisma.client.$transaction([
        (this.prisma.client as any).screenEmergencyOverride.deleteMany({
          where: { screenId: { in: groupScreens.map((s) => s.id) } },
        }),
        this.prisma.client.auditLog.create({
          data: {
            action: 'CLEAR_EMERGENCY',
            targetType: scopeType,
            targetId: scopeId,
            tenantId: ownedTenantId,
            userId: req.user?.id,
            details: JSON.stringify({
              overrideId,
              clearedScreenCount: groupScreens.length,
              triggeredByTenant: req.user?.tenantId,
            }),
          },
        }),
      ]);
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

    // 2026-05-25 Developer area: outbound webhook on emergency.cleared.
    // Mirror of the trigger-side dispatch above.
    if (scopeType === 'tenant' && ownedTenantId) {
      this.webhookDispatch.dispatch(ownedTenantId, 'emergency.cleared', {
        overrideId,
        scopeType,
        scopeId,
        clearedAt: new Date().toISOString(),
        clearedByUserId: req.user?.id ?? null,
      });
    }

    // 2026-05-27 — Mirror of the trigger-side GPIO status-lamp drive.
    // Flip every wired status_lamp back to 'low' so the lobby light
    // goes dark when the emergency clears. Fire-and-forget for the
    // same reason as the trigger path — a stuck lamp must never
    // delay all-clear from reaching the player fleet.
    if (scopeType === 'tenant' && ownedTenantId) {
      this.gpio
        .driveStatusLampForEmergency({
          tenantId: ownedTenantId,
          state: 'low',
          reason: 'emergency_all_clear',
          sourceContext: { overrideId },
        })
        .catch((e) => {
          Sentry.withScope((s) => {
            s.setTag('emergency.action', 'all-clear.gpio_lamp');
            s.setTag('emergency.scopeType', scopeType);
            s.setUser({ id: req.user?.id });
            s.setExtra('overrideId', overrideId);
            Sentry.captureException(e);
          });
          console.warn(`[Emergency] GPIO status-lamp auto-drive failed (all-clear): ${e}`);
        });
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

    // SECURITY: SSRF allowlist on the SOS voice clip — same reason as
    // overridePayload.mediaUrl on /trigger.
    assertAllowedEmergencyMediaUrl(body.voiceClipUrl, 'voiceClipUrl');

    const messageId = `sos_${crypto.randomUUID()}`;
    const severity = 'CRITICAL';
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

    // emergency-007 fix: even though SosInputSchema caps location at 500
    // chars, it doesn't strip control characters. The string flows into
    // (a) textBlob rendered onscreen, (b) AuditLog.details, (c) console
    // and Sentry log lines. A `\r\n` injection could forge a fake log
    // entry, splice arbitrary content into the screen overlay, or
    // confuse downstream log-processing pipelines. Strip CR/LF/TAB and
    // re-cap length defensively.
    const safeLocation = body.location
      ? String(body.location).replace(/[\r\n\t]/g, ' ').trim().slice(0, 500)
      : null;

    const textBlob = safeLocation
      ? `SOS from ${user.email || 'staff'} — ${safeLocation}`
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
            // emergency-007: sanitized location goes into the audit log so
            // a malicious \r\n can't split log entries during forensic review.
            location: safeLocation,
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
      // emergency-007: signed payload also carries the sanitized version.
      location: safeLocation,
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

    // SECURITY: verify the caller owns the target scope before any mutation.
    const ownedTenantId = await this.resolveScopeTenant(scopeType, scopeId, user);

    const messageId = `bcast_${crypto.randomUUID()}`;
    const expiresAtDate = body.expiresAt
      ? new Date(typeof body.expiresAt === 'number' ? body.expiresAt * 1000 : body.expiresAt)
      : durationMs
        ? new Date(Date.now() + durationMs)
        : new Date(Date.now() + 5 * 60 * 1000); // 5 min default

    // Atomic message + audit so a partial failure can't orphan either row.
    await this.prisma.client.$transaction([
      this.prisma.client.emergencyMessage.create({
        data: {
          id: messageId,
          tenantId: ownedTenantId,
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
          tenantId: ownedTenantId,
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

    // SECURITY: SSRF allowlist — every URL field the operator can set must
    // resolve to the tenant's storage allowlist before we hand it to the
    // player to fetch.
    assertAllowedEmergencyMediaUrls(mediaUrls, 'mediaUrls');
    assertAllowedEmergencyMediaUrl(audioUrl, 'audioUrl');

    // SECURITY: verify the caller owns the target scope before any mutation.
    const ownedTenantId = await this.resolveScopeTenant(scopeType, scopeId, user);

    const messageId = `media_${crypto.randomUUID()}`;
    const expiresAtDate = body.expiresAt
      ? new Date(typeof body.expiresAt === 'number' ? body.expiresAt * 1000 : body.expiresAt)
      : new Date(Date.now() + 60 * 60 * 1000); // 1 hr default

    // Atomic message + audit — matches the other emergency endpoints.
    await this.prisma.client.$transaction([
      this.prisma.client.emergencyMessage.create({
        data: {
          id: messageId,
          tenantId: ownedTenantId,
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
          tenantId: ownedTenantId,
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
      // Return 404-style response rather than swallowing — caller should know the message doesn't exist.
      throw new NotFoundException(`Emergency message '${messageId}' not found`);
    }

    // SECURITY: verify the caller owns the message's tenant before clearing.
    const callerTenantId: string = user?.tenantId || user?.schoolId || user?.districtId;
    const isSuper: boolean = user?.role === AppRole.SUPER_ADMIN;
    if (!isSuper && existing.tenantId !== callerTenantId) {
      throw new ForbiddenException(
        'You do not have permission to clear emergency messages for this scope.',
      );
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
      active: rows.map(r => this.toEmergencyMessageView(r)),
    };
  }

  /**
   * Shared row → wire shape mapper for active EmergencyMessage rows.
   * The player's <EmergencyOverlay> parses exactly this shape, so the
   * user-session /status path and the device-JWT /messages path below
   * MUST emit identical objects. Centralizing it keeps them in lockstep.
   */
  private toEmergencyMessageView(r: any) {
    return {
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
    };
  }

  /**
   * P0-2 (life-safety) — DEVICE-authenticated emergency-message poll.
   *
   * The existing GET /status above resolves the tenant from a USER
   * session (req.user.schoolId/tenantId), so a paired kiosk — which
   * carries a DEVICE JWT, not a user session — got a 401 and the
   * <EmergencyOverlay> self-poll silently swallowed it (`if (!res.ok)
   * return`). Net effect: SOS / TEXT_BROADCAST / MEDIA_ALERT reached
   * kiosks ONLY while the live WebSocket was healthy. Behind a
   * WS-blocking proxy (Squid/ZScaler/iboss/GoGuardian — the exact
   * reason the SSE + HTTP-poll fallback tiers exist) OR with Redis
   * down, these life-safety pushes were never delivered to the wall.
   *
   * This endpoint closes the HTTP-poll tier for device clients:
   *   - Auth: the controller-wide JwtAuthGuard already verifies a
   *     device JWT (kind:'device', sub:screenId) and populates
   *     req.user. RbacGuard short-circuits (this route has no
   *     @RequireRoles). We additionally HARD-REQUIRE kind==='device'
   *     so a user/api-key token can't reach this device-only path.
   *   - Tenant scope: resolved from the LIVE Screen row keyed by
   *     req.user.sub (the HMAC-signed screenId), NOT the JWT's
   *     tenantId claim. A screen re-paired to another tenant carries
   *     a stale claim until its 365-day token rotates; reading the
   *     live row prevents a cross-tenant leak through an old token.
   *   - Per-scope filter: a device only sees messages addressed to a
   *     scope it actually belongs to — tenant:<tenantId>,
   *     group:<screenGroupId>, or device:<screenId>. This stops a
   *     per-screen (Sprint 8b device-scoped) message for screen B
   *     from leaking onto screen A in the same tenant.
   *
   * No signing/HMAC/freshness/dedup is weakened: this is a READ of
   * the same EmergencyMessage rows the signer/AuditLog already
   * produced. The DB is the source of truth for the poll tier exactly
   * as it is for the user-session /status path.
   */
  @Get('messages')
  async deviceMessages(@Req() req: any) {
    const u = req.user || {};
    if (u.kind !== 'device' || !u.sub) {
      // This route is device-only. User sessions use GET /status.
      throw new ForbiddenException('Device authentication required');
    }

    const screen = await this.prisma.client.screen.findUnique({
      where: { id: u.sub },
      select: { id: true, tenantId: true, screenGroupId: true, status: true },
    });

    // Unpaired, revoked, or unknown screen → nothing to show. Empty
    // (not an error) so the player keeps polling cleanly once paired.
    if (!screen || !screen.tenantId || screen.status === 'REVOKED') {
      return { tenantId: null, tenantStatus: 'INACTIVE', tenantPlaylistId: null, active: [] };
    }

    const tenantId = screen.tenantId;
    const now = new Date();

    // Scopes this exact device is a member of. A message only reaches
    // the wall if its (scopeType:scopeId) matches one of these.
    const scopeOr: Array<{ scopeType: string; scopeId: string }> = [
      { scopeType: 'tenant', scopeId: tenantId },
      { scopeType: 'device', scopeId: screen.id },
    ];
    if (screen.screenGroupId) {
      scopeOr.push({ scopeType: 'group', scopeId: screen.screenGroupId });
    }

    const rows = await this.prisma.client.emergencyMessage.findMany({
      where: {
        tenantId,
        clearedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        AND: [{ OR: scopeOr }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: tenantId } });

    return {
      tenantId,
      tenantStatus: tenant?.emergencyStatus || 'INACTIVE',
      tenantPlaylistId: tenant?.emergencyPlaylistId || null,
      active: rows.map(r => this.toEmergencyMessageView(r)),
    };
  }
}
