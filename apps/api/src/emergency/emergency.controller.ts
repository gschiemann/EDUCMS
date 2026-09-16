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
// 2026-09-02 (efficiency P0-2) — the cheap emergency-revision token the
// player polls INSTEAD of re-fetching the whole manifest every 10 s. Every
// bump below sits in the same synchronous block as `invalidateTenantState`,
// i.e. BEFORE the Redis fan-out is even constructed, so the HTTP backstop can
// never learn about an alert later than the push it backs up.
import {
  bumpTenantEmergencyEpoch,
  type EmergencyAlertDescriptor,
} from '../screens/emergency-rev';
// 2026-05-27 — Goodview EP6N GPIO. When the emergency trigger fires
// on a tenant, sweep every screen whose GPIO OUT is wired to a
// status_lamp + flip the lamp high. On all-clear, flip it back to
// low. Implemented in GpioService.driveStatusLampForEmergency().
import { GpioService } from '../screens/gpio.service';
import {
  assertAllowedEmergencyMediaUrl,
  assertAllowedEmergencyMediaUrls,
} from './media-url-guard';
// 2026-08-03 — district-wide propagation. `Tenant` is a tree
// (district → school via Tenant.parentId) and every emergency write used to
// touch exactly ONE row + publish to exactly ONE channel, so a district
// lockdown reached the district office and nothing else. See the module
// header for the fan-out-vs-inheritance decision and its tradeoff.
import { collectDescendantTenantIds, isDescendantTenant } from './tenant-hierarchy';
// 2026-09-16 — double-sided displays. A device-scoped alert names ONE screen
// id, and with faces that id is one PANE of a physical display. An alert that
// lit the front while the back kept running the lunch menu is exactly the
// failure this product exists to prevent, so the scope expands to the whole
// unit. (Tenant- and group-scoped alerts already reach faces for free: a face
// is an ordinary Screen row in the tenant.)
import { deviceScopeScreenIds } from '../screens/screen-faces';
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

  /**
   * Redis fan-out for a life-safety dispatch.
   *
   * Split out (2026-08-15) so callers can START it before persistence and
   * await it afterwards — the alert must never be gated on a database write.
   * See the "LIFE-SAFETY FAST PATH" note in `trigger`.
   *
   * Every channel is published INDEPENDENTLY and every failure is swallowed
   * after being reported: one school's Redis hiccup must not abort the
   * remaining schools' fan-out. This method therefore never rejects — a
   * caller awaiting it cannot be made to fail by a downstream Redis problem,
   * and screens that miss the push still get the emergency from their next
   * manifest poll (the HTTP backstop).
   */
  private async dispatchEmergencyFanout(
    channels: string[],
    signedMessage: unknown,
    ctx: { scopeType: string; overrideId: string; userId?: string; action?: string },
  ): Promise<void> {
    for (const ch of channels) {
      try {
        await this.redisService.publish(ch, signedMessage as any);
      } catch (error) {
        Sentry.withScope((s) => {
          s.setTag('emergency.action', ctx.action ?? 'trigger');
          s.setTag('emergency.scopeType', ctx.scopeType);
          s.setUser({ id: ctx.userId });
          s.setExtra('overrideId', ctx.overrideId);
          s.setExtra('channel', ch);
          Sentry.captureException(error);
        });
        console.warn(
          `[Emergency] Redis publish failed for ${ch}. Realtime bypass disabled. Screens will pull via HTTP polling. Error: ${error}`,
        );
      }
    }
  }

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
   * 2026-08-03 — HIERARCHY EXTENSION (district-wide propagation).
   * `Tenant` is a tree, and a DISTRICT_ADMIN legitimately needs to reach a
   * school INSIDE their own district (lock down one building, not all seven).
   * The rule is EXTENDED, never bypassed, and only in the DOWNWARD direction:
   *
   *     allow  ⇔  isSuper
   *            ∨  owningTenantId === callerTenantId          (unchanged)
   *            ∨  (caller is DISTRICT_ADMIN                   (NEW)
   *                ∧ owningTenantId is a DESCENDANT of callerTenantId)
   *
   * Nothing previously permitted becomes denied. Crucially, the new clause is
   * strictly downward and role-gated, so it can never be used to escalate:
   *   - A SCHOOL_ADMIN targeting their district → the district is neither
   *     their tenant nor a descendant of it → 403, exactly as before.
   *   - A SCHOOL_ADMIN targeting a SIBLING school → not a descendant → 403.
   *   - A DISTRICT_ADMIN of district A targeting district B (or B's schools)
   *     → not a descendant of A → 403.
   * The walk goes UP from the target (bounded by tree depth, ~2 lookups),
   * never down from the caller, so an admin of a 500-school district pays the
   * same two queries as an admin of a two-school one.
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
      // ten-ok: ownership RESOLVER — reads tenantId to verify the caller owns it (403 below); SUPER_ADMIN cross-tenant by design
      const group = await this.prisma.client.screenGroup.findUnique({
        where: { id: scopeId },
        select: { tenantId: true },
      });
      if (!group) {
        throw new NotFoundException(`Screen group '${scopeId}' not found`);
      }
      owningTenantId = group.tenantId;
    } else if (scopeType === 'device') {
      // ten-ok: ownership RESOLVER — reads tenantId to verify the caller owns it (403 below); SUPER_ADMIN cross-tenant by design
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
    // confined to their own tenant — or, for a DISTRICT_ADMIN, to a tenant
    // BELOW their own in the hierarchy (see the block comment above).
    if (!isSuper && owningTenantId !== callerTenantId) {
      const mayReachDownward =
        reqUser?.role === AppRole.DISTRICT_ADMIN &&
        !!callerTenantId &&
        (await isDescendantTenant(
          this.prisma.client.tenant as any,
          owningTenantId,
          callerTenantId,
        ));
      if (!mayReachDownward) {
        throw new ForbiddenException(
          'You do not have permission to trigger emergency actions for this scope.',
        );
      }
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
        // ten-ok: read-path audit-tenant RESOLVER — derives the owning tenant for audit rows; never grants access
        const g = await this.prisma.client.screenGroup.findUnique({
          where: { id: scopeId },
          select: { tenantId: true },
        });
        if (g?.tenantId) return g.tenantId;
      }
      if (scopeType === 'device') {
        // ten-ok: read-path audit-tenant RESOLVER — derives the owning tenant for audit rows; never grants access
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

    // ── LIFE-SAFETY FAST PATH (2026-08-15) ──────────────────────────────
    // Sign HERE, not after the writes. `message.payload` is complete and
    // validated at this point and is never mutated again before dispatch,
    // so the envelope can be built before any persistence happens.
    //
    // WHY THIS MOVED. The fan-out used to run only AFTER
    // `$transaction(...)` committed. That coupled the fastest path to a
    // screen (Redis -> WS, single-digit ms) to the slowest thing in the
    // request (a multi-statement write over a link measured at a ~333ms
    // per-query floor). On 2026-08-15 a Supabase pooler stall queued
    // queries for 4.5s with the database otherwise idle; a lockdown fired
    // in that window would have sat unsent for the whole stall, and with
    // `pool_timeout=20` a deeper stall means the publish never happens at
    // all — the operator sees an error and NOT ONE SCREEN was told.
    //
    // Now the dispatch STARTS as soon as the channel list is known and runs
    // concurrently with persistence; we await it after the writes so the
    // response still reflects the true dispatch outcome. Ordering the two
    // this way is the correct life-safety trade: "shown on the wall but not
    // yet recorded" is recoverable, "recorded but never shown" is not.
    // AuditLog is still written unconditionally (CLAUDE.md) — it simply no
    // longer gates delivery.
    const signedMessage = this.signer.signMessage('OVERRIDE', message.payload);
    let fanout: Promise<void> | null = null;

    // Every tenant this trigger actually reached. For a leaf school that's
    // just the school; for a district it's the district PLUS every
    // non-archived descendant. Post-commit side effects (manifest-cache
    // invalidation, pub/sub fan-out, webhooks, GPIO lamps) all iterate this
    // list rather than the single targeted id — that was the whole bug.
    let affectedTenantIds: string[] = [];

    // If targeting a tenant (e.g., a school), update its emergencyStatus persistently
    if (scopeType === 'tenant') {
      // ── DISTRICT FAN-OUT (2026-08-03) ───────────────────────────────────
      // Walk DOWN the hierarchy and treat every descendant as an affected
      // tenant in its own right. See tenant-hierarchy.ts for why fan-out
      // beats inheritance here; the short version is that each school owns
      // its own drilled panic playlists, its own Sprint-8b per-screen config,
      // its own WS channel and its own audit trail — and a per-tenant write
      // is the only thing that gets all four right at once.
      const descendantTenantIds = await collectDescendantTenantIds(
        this.prisma.client.tenant as any,
        scopeId,
      );
      affectedTenantIds = [scopeId, ...descendantTenantIds];

      // Channels are known the instant the subtree is resolved — dispatch
      // now, in parallel with everything below. Cache invalidation rides
      // along because it is synchronous in-memory work that must not be
      // stranded behind the writes either.
      // ── RAISE FAST-PATH DESCRIPTOR (P0-7 #2, 2026-09-05) ────────────────
      // The exact flat shape the manifest's emergency branch emits for a
      // TENANT-scoped alert on a screen with no per-screen override:
      //   effectiveType     = tenant.emergencyType   ← overridePayload.type
      //   effectiveSeverity = tenant.emergencyStatus ← severity
      //   scopeNote         = null   (only a ScreenEmergencyOverride has one)
      //   scope             = 'tenant'
      //   expiresAt         = absent (only a per-screen override emits one)
      // Both writes happen a few lines below (`emergencyStatus: severity`,
      // `emergencyType: overridePayload.type`), so what a screen raises from
      // the rev body is byte-identical to what its next manifest re-asserts —
      // no visible flip when the manifest lands. Tenant scope ONLY: see the
      // header of `emergency-rev.ts` for why a group/device trigger must not
      // mint one.
      const raiseDescriptor: EmergencyAlertDescriptor | null =
        typeof overridePayload.type === 'string' && overridePayload.type.length > 0
          ? {
              type: overridePayload.type,
              severity,
              scopeNote: null,
              scope: 'tenant',
              expiresAt: null,
            }
          : null;
      for (const tid of affectedTenantIds) {
        invalidateTenantState(tid);
        // Synchronous, local-first: the revision has moved before the next
        // line builds the fan-out, so a screen polling `emergency-rev` in
        // this same millisecond already sees "changed" and — since P0-7 #2 —
        // gets the alert itself in that same response, with no manifest
        // round-trip needed to raise it.
        bumpTenantEmergencyEpoch({ redis: this.redisService }, tid, {
          active: true,
          alert: raiseDescriptor,
        });
      }
      fanout = this.dispatchEmergencyFanout(
        affectedTenantIds.map((tid) => `tenant:${tid}`),
        signedMessage,
        { scopeType, overrideId, userId: req.user?.id },
      );

      const explicitPlaylistId = !!overridePayload.playlistId;
      const typeKey = this.emergencyTypeKey(overridePayload.type);

      // Root tenant stays a findUnique so the (overwhelmingly common)
      // single-school path issues exactly the query it always did. The
      // descendants ride ONE extra findMany — never N.
      const rootTenantInfo = await this.prisma.client.tenant.findUnique({ where: { id: scopeId } });
      const tenantInfoById = new Map<string, any>([[scopeId, rootTenantInfo]]);
      if (descendantTenantIds.length > 0) {
        const childRows = await this.prisma.client.tenant.findMany({
          where: { id: { in: descendantTenantIds } },
        });
        for (const row of childRows as any[]) tenantInfoById.set(row.id, row);
      }

      // Sprint-8b location-based mode is a PER-TENANT opt-in, so only the
      // tenants that enabled it need their screens loaded. Single-tenant
      // shape is preserved verbatim; the subtree shape collapses to one
      // findMany that we then group by tenantId.
      const locationModeTenantIds = affectedTenantIds.filter(
        (tid) => !!tenantInfoById.get(tid)?.locationBasedEmergencyEnabled,
      );
      const screensByTenant = new Map<string, any[]>();
      if (locationModeTenantIds.length === 1 && locationModeTenantIds[0] === scopeId) {
        screensByTenant.set(
          scopeId,
          await this.prisma.client.screen.findMany({ where: { tenantId: scopeId } }),
        );
      } else if (locationModeTenantIds.length > 0) {
        const rows = await this.prisma.client.screen.findMany({
          where: { tenantId: { in: locationModeTenantIds } },
        });
        for (const s of rows as any[]) {
          const list = screensByTenant.get(s.tenantId) ?? [];
          list.push(s);
          screensByTenant.set(s.tenantId, list);
        }
      }

      // Build the whole subtree's writes, then commit them in ONE
      // transaction. All-or-nothing across the district: a fan-out that
      // locked down four schools and failed on the fifth would be worse
      // than one that failed outright, because the operator would believe
      // the district was covered.
      const subtreeOps: any[] = [];

      for (const affectedTenantId of affectedTenantIds) {
        const tenantInfo = tenantInfoById.get(affectedTenantId) ?? null;
        const isOriginTenant = affectedTenantId === scopeId;

        let activePlaylistId = overridePayload.playlistId || null;
        // Portrait variant resolved alongside the landscape playlist so
        // each screen can auto-pick the right one at manifest time.
        // null-safe: if a tenant hasn't configured a portrait variant,
        // this stays null and the manifest falls back to landscape.
        let activePortraitPlaylistId: string | null = null;

        // If no playlist was explicitly provided, auto-resolve based on
        // the configured Panic Button content for this panic type — READ
        // OFF THIS TENANT'S OWN ROW, so each school in the district plays
        // the lockdown content that school rehearsed. An explicit
        // playlistId from the operator still wins everywhere (it was
        // ownership-checked against the district above).
        if (tenantInfo) {
          const tenantPlaylists = this.pickTenantPanicPlaylists(tenantInfo, overridePayload.type);
          if (!activePlaylistId) {
            activePlaylistId = tenantPlaylists.landscape;
            activePortraitPlaylistId = tenantPlaylists.portrait;
          } else if (!explicitPlaylistId) {
            activePortraitPlaylistId = tenantPlaylists.portrait;
          }
        }

        const locationBasedOverrides: any[] = [];
        let locationScreenCount = 0;
        let locationSpecificCount = 0;

        if (tenantInfo?.locationBasedEmergencyEnabled) {
          const screens = screensByTenant.get(affectedTenantId) ?? [];
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
                tenantId: affectedTenantId,
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

        // Wrap state mutation + audit in one transaction so a concurrent
        // trigger or all-clear can't leave the Tenant in a half-updated
        // state where emergencyStatus says CRITICAL but emergencyPlaylistId
        // is null (or vice versa). All-or-nothing. Both orientation
        // pointers flip together so portrait + landscape screens see the
        // same emergency transition at the same moment.
        subtreeOps.push(
          this.prisma.client.tenant.update({
            where: { id: affectedTenantId },
            data: {
              emergencyStatus: severity,
              // 2026-07-25 — persist the INCIDENT TYPE too. emergencyStatus holds
              // the SEVERITY, and Severity/OverrideIncidentType are disjoint enums,
              // so without this the type was lost on a tenant-scope trigger and the
              // manifest fell back to the severity — screens rendered "CRITICAL
              // PROTOCOL ACTIVE" instead of LOCKDOWN or EVACUATE.
              emergencyType: overridePayload.type
                ? String(overridePayload.type).toUpperCase()
                : null,
              emergencyPlaylistId: activePlaylistId || null,
              emergencyPortraitPlaylistId: activePortraitPlaylistId || null,
            } as any,
          }),
          // AUDIT: one immutable row PER AFFECTED TENANT. The forensic
          // question "who locked down this school, and when" has to be
          // answerable from that school's own activity trail — a single
          // district row would make the answer wrong for the other six.
          // `propagatedFromTenantId` links each child row back to the
          // district action that caused it.
          this.prisma.client.auditLog.create({
            data: {
              action: 'TRIGGER_EMERGENCY',
              targetType: scopeType,
              targetId: affectedTenantId,
              tenantId: affectedTenantId,
              userId: req.user?.id,
              details: JSON.stringify({
                overrideId,
                severity,
                type: typeKey,
                portraitPlaylistId: activePortraitPlaylistId,
                locationBasedEnabled: !!tenantInfo?.locationBasedEmergencyEnabled,
                locationScreenCount,
                locationSpecificCount,
                triggeredByTenant: req.user?.tenantId,
                // Hierarchy provenance — present on the origin row too so a
                // reader never has to infer it from absence.
                originTenantId: scopeId,
                propagatedFromTenantId: isOriginTenant ? null : scopeId,
                subtreeTenantCount: affectedTenantIds.length,
              }),
            },
          }),
          ...locationBasedOverrides,
        );
      }

      await this.prisma.client.$transaction(subtreeOps);
    } else {
      // Non-tenant scope (group / device). Persist per-screen
      // ScreenEmergencyOverride rows so the HTTP-poll manifest backstop ALSO
      // reflects this emergency — not just the realtime WS/SSE fan-out.
      // Previously this branch wrote only an audit row, so the manifest
      // (Tenant.emergencyStatus — untouched here — plus per-screen overrides)
      // showed nothing for a group/device lockdown: a poll-only kiosk (WS AND
      // SSE both blocked) missed it entirely. The most degraded screen must
      // not be the one that misses the lockdown. (2026-06-01.)
      // Group/device scope needs NO lookup to know its channel, so the
      // dispatch goes out before this branch touches the database at all.
      //
      // The revision moves for the WHOLE owning tenant even though only some
      // of its screens are targeted: the epoch is per tenant, the alert is
      // per screen, and over-invalidating costs the untargeted screens one
      // manifest fetch each while under-invalidating would leave a targeted
      // screen on a 304. `active` is deliberately NOT asserted here — a
      // group/device trigger does not put the TENANT into an alert, and the
      // per-screen record picks the real state up on the next manifest build.
      bumpTenantEmergencyEpoch({ redis: this.redisService }, ownedTenantId);
      fanout = this.dispatchEmergencyFanout(
        [`${scopeType}:${scopeId}`],
        signedMessage,
        { scopeType, overrideId, userId: req.user?.id },
      );

      // ── Double-sided displays: a device scope means the DISPLAY ────────
      //
      // `scopeId` names one Screen row, which on a double-sided unit is ONE
      // PANE. Both sides are in the room and both must carry the alert, so
      // the scope expands to the primary and every face (and, if the
      // operator named a face, to its primary and siblings too).
      //
      // The query is tenant-scoped: `ownedTenantId` was verified above, and
      // an alert must never be able to reach a row outside it.
      let affectedScreens: any[];
      if (scopeType === 'device') {
        // ONE query in the common case: the named row, plus any sides
        // hanging off it. When the operator names the display (or an
        // ordinary single-sided screen) that IS the whole unit, and this is
        // the only read — same cost as before faces existed.
        const named = await this.prisma.client.screen.findMany({
          where: {
            tenantId: ownedTenantId,
            OR: [{ id: scopeId }, { faceOfScreenId: scopeId }],
          },
        });
        const rootId =
          ((named.find((s) => s.id === scopeId) as any)?.faceOfScreenId as string | null) || scopeId;
        const unitRows =
          rootId === scopeId
            ? named
            // They named a SIDE, so the display is elsewhere. One extra read,
            // only in that case, to pick up the front and its other sides.
            : await this.prisma.client.screen.findMany({
                where: {
                  tenantId: ownedTenantId,
                  OR: [{ id: rootId }, { faceOfScreenId: rootId }],
                },
              });
        // `deviceScopeScreenIds` is the single authority on unit membership,
        // shared with the all-clear below so the two can never disagree.
        const inScope = new Set(deviceScopeScreenIds(scopeId, unitRows as any));
        affectedScreens = unitRows.filter((r) => inScope.has(r.id));
      } else {
        affectedScreens = await this.prisma.client.screen.findMany({
          where: { screenGroupId: scopeId },
        });
      }

      // Push to every pane. The named channel already went out above; these
      // are the OTHER sides of the same display, which have their own device
      // channels because they are their own Screen rows. Best-effort exactly
      // like the primary fan-out — the per-screen override rows written below
      // are what the HTTP polling backstop reads, so a dead push channel
      // still delivers the alert.
      if (scopeType === 'device') {
        const extraChannels = affectedScreens
          .map((s) => `device:${s.id}`)
          .filter((ch) => ch !== `${scopeType}:${scopeId}`);
        if (extraChannels.length) {
          await this.dispatchEmergencyFanout(extraChannels, signedMessage, {
            scopeType,
            overrideId,
            userId: req.user?.id,
          });
        }
      }

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

    // Fan-out was STARTED before persistence (see the life-safety fast path
    // above) so a slow or stalled database can neither delay nor cancel the
    // alert reaching a screen. Await it here so the response below reports
    // the real dispatch outcome rather than a fire-and-forget guess.
    //
    // ONE CHANNEL PER AFFECTED TENANT. The gateway matches a scope publish
    // against the DEVICE'S OWN tenantId (`broadcastToScope`:
    // `type === 'tenant' && ctx.tenantId === id`), so a screen in a child
    // school never sees a `tenant:<districtId>` message. Publishing per
    // descendant is what actually reaches those schools. Each publish is
    // caught INDEPENDENTLY inside the helper: one school's Redis hiccup must
    // not skip the remaining schools' fan-out — they'd each be silently
    // demoted to the 5-10s HTTP-poll tier while the operator believes the
    // push landed.
    const channel = `${scopeType}:${scopeId}`;
    if (fanout) await fanout;

    // 2026-05-25 Developer area: outbound webhook on emergency.triggered.
    // Fire-and-forget; the response below is never blocked. Only fires
    // for tenant-scoped triggers (per-screen / per-group emergencies
    // are too granular for typical external integrations — those can
    // listen to the WS channel directly if needed). Fired once per
    // affected tenant so a school's own integrations (its PA bridge, its
    // Slack channel) see the alert that is actually running on its walls.
    if (scopeType === 'tenant') {
      for (const tid of affectedTenantIds) {
        this.webhookDispatch.dispatch(tid, 'emergency.triggered', {
          overrideId,
          scopeType,
          scopeId: tid,
          severity: message.payload?.severity ?? severity,
          type: message.payload?.type,
          triggeredAt: new Date().toISOString(),
          triggeredByUserId: req.user?.id ?? null,
          // Provenance so a downstream integration can tell a district
          // cascade apart from a school-local trigger.
          originTenantId: scopeId,
        });
      }
    }

    // 2026-05-27 — Goodview EP6N GPIO status lamp auto-drive. Sweep
    // every screen in the tenant whose `config.wiring.gpio_out1` or
    // `gpio_out2` is wired to a `status_lamp` and flip the output
    // high. Fire-and-forget — a lamp that fails to flip is logged
    // by GpioService but NEVER rolls back the emergency. Tenant-
    // scope only; group/device scope triggers don't auto-drive the
    // tenant-wide lamp signal (those have their own per-screen UX).
    // Swept per affected tenant so a district lockdown lights the lobby
    // lamp in every school, not just the district office.
    if (scopeType === 'tenant') {
      for (const tid of affectedTenantIds) {
        this.gpio
          .driveStatusLampForEmergency({
            tenantId: tid,
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
              s.setExtra('tenantId', tid);
              Sentry.captureException(e);
            });
            console.warn(`[Emergency] GPIO status-lamp auto-drive failed (trigger): ${e}`);
          });
      }
    }

    return {
      success: true,
      overrideId,
      // Additive reach reporting so the operator UI can say "7 schools,
      // 38 screens" instead of implying a district trigger hit one row.
      affectedTenantIds,
      affectedTenantCount: affectedTenantIds.length,
      message:
        affectedTenantIds.length > 1
          ? `Emergency dispatched to ${channel} and ${affectedTenantIds.length - 1} child location(s)`
          : `Emergency dispatched to ${channel}`,
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

    // Every tenant this all-clear reached — mirror of the trigger path so
    // the two are exactly symmetric. Asymmetry here is the worst possible
    // bug in this file: a district all-clear that leaves one school locked
    // down is worse than no district feature at all, because the operator
    // has been told the incident is over.
    let affectedTenantIds: string[] = [];
    let clearFanout: Promise<void> | null = null;

    // If targeting a tenant, clear its emergencyStatus + audit atomically.
    // Clear BOTH orientation pointers so a portrait screen doesn't keep
    // rendering an emergency after the admin hit all-clear.
    if (scopeType === 'tenant') {
      const descendantTenantIds = await collectDescendantTenantIds(
        this.prisma.client.tenant as any,
        scopeId,
      );
      affectedTenantIds = [scopeId, ...descendantTenantIds];

      // Same life-safety fast path as `trigger` — and it matters just as much
      // here. A stalled write on all-clear leaves screens STUCK IN LOCKDOWN
      // until the HTTP backstop catches up; people stay sheltering for no
      // reason. Dispatch now, persist after.
      for (const tid of affectedTenantIds) {
        invalidateTenantState(tid);
        // Exactly symmetric with `trigger` — a revision that moved on the way
        // IN but not on the way OUT would leave screens polling 304s while
        // they are still showing a lockdown that has already been cleared.
        //
        // `alert: null` DROPS the P0-7 #2 raise descriptor in the same
        // synchronous write. This is the one line that stops the fast path
        // from re-raising an alert that has just been cleared: after this,
        // every `emergency-rev` 200 for this tenant carries no `alert`, and
        // absence never means "clear" (the manifest releases) — it means
        // "nothing to raise".
        bumpTenantEmergencyEpoch({ redis: this.redisService }, tid, {
          active: false,
          alert: null,
        });
      }
      clearFanout = this.dispatchEmergencyFanout(
        affectedTenantIds.map((tid) => `tenant:${tid}`),
        signedMessage,
        { scopeType, overrideId, userId: req.user?.id, action: 'all-clear' },
      );

      const clearedState = {
        emergencyStatus: 'INACTIVE',
        // Clear the incident type with the status — a stale type would make
        // a cleared tenant look like it still has an active incident.
        emergencyType: null,
        emergencyPlaylistId: null,
        emergencyPortraitPlaylistId: null,
      } as any;

      await this.prisma.client.$transaction([
        this.prisma.client.tenant.update({
          where: { id: scopeId },
          data: clearedState,
        }),
        // Descendants clear in ONE statement — the data is identical for
        // every school, unlike the trigger path where each resolves its own
        // playlists. Empty `in` list is a no-op, so the leaf-school path
        // costs nothing.
        ...(descendantTenantIds.length > 0
          ? [
              this.prisma.client.tenant.updateMany({
                where: { id: { in: descendantTenantIds } },
                data: clearedState,
              }),
            ]
          : []),
        // Per-screen overrides across the WHOLE subtree. Without the `in`
        // a rebooted screen in a child school re-reads its override row off
        // disk and comes back up locked down — the emergency-003 bug,
        // district-scope variant.
        (this.prisma.client as any).screenEmergencyOverride.deleteMany({
          where: { tenantId: { in: affectedTenantIds } },
        }),
        // One audit row per affected tenant, same reasoning as the trigger:
        // each school's own trail has to record that IT was cleared.
        ...affectedTenantIds.map((tid) =>
          this.prisma.client.auditLog.create({
            data: {
              action: 'CLEAR_EMERGENCY',
              targetType: scopeType,
              targetId: tid,
              tenantId: tid,
              userId: req.user?.id,
              details: JSON.stringify({
                overrideId,
                triggeredByTenant: req.user?.tenantId,
                originTenantId: scopeId,
                propagatedFromTenantId: tid === scopeId ? null : scopeId,
                subtreeTenantCount: affectedTenantIds.length,
              }),
            },
          }),
        ),
      ]);
    } else if (scopeType === 'device') {
      // emergency-003 fix: previously the device-scope all-clear only
      // wrote an AuditLog row and broadcast — it never deleted the
      // ScreenEmergencyOverride. Result: the screen rebooted and re-read
      // its override row from disk, getting stuck on lockdown after the
      // operator thought they had cleared it. Delete the override row
      // atomically with the audit write so they can't drift apart.
      // ── Double-sided displays: clear every pane the trigger lit ────────
      //
      // DELIBERATELY SYMMETRIC with the trigger above. The set that goes
      // into an alert must be the set that comes out of it — an asymmetry
      // here is precisely how a screen gets stranded on a lockdown nobody
      // can clear (the emergency-003 bug class, which is why this branch
      // deletes override rows at all).
      // Same shape as the trigger: one query in the common case, a second
      // only when the operator named a SIDE rather than the display.
      const namedForClear = await this.prisma.client.screen.findMany({
        where: {
          tenantId: ownedTenantId,
          OR: [{ id: scopeId }, { faceOfScreenId: scopeId }],
        },
        select: { id: true, faceOfScreenId: true },
      });
      const clearRootId =
        ((namedForClear.find((s) => s.id === scopeId) as any)?.faceOfScreenId as string | null) ||
        scopeId;
      const clearUnitRows =
        clearRootId === scopeId
          ? namedForClear
          : await this.prisma.client.screen.findMany({
              where: {
                tenantId: ownedTenantId,
                OR: [{ id: clearRootId }, { faceOfScreenId: clearRootId }],
              },
              select: { id: true, faceOfScreenId: true },
            });
      // `scopeId` is ALWAYS included, even if the row could not be read: a
      // failed lookup must never SHRINK the set an all-clear reaches.
      const clearScreenIds = Array.from(
        new Set([scopeId, ...deviceScopeScreenIds(scopeId, clearUnitRows as any)]),
      );
      // Push the all-clear to the other panes' own device channels.
      const clearExtraChannels = clearScreenIds
        .map((sid) => `device:${sid}`)
        .filter((ch) => ch !== `${scopeType}:${scopeId}`);
      if (clearExtraChannels.length) {
        await this.dispatchEmergencyFanout(clearExtraChannels, signedMessage, {
          scopeType,
          overrideId,
          userId: req.user?.id,
          action: 'all-clear',
        });
      }

      await this.prisma.client.$transaction([
        (this.prisma.client as any).screenEmergencyOverride.deleteMany({
          where: { screenId: { in: clearScreenIds }, tenantId: ownedTenantId },
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
    // screen in the tenant (or any school under it) picks up INACTIVE
    // without waiting for TTL.
    //
    // For tenant scope the fan-out was STARTED before persistence (see
    // above) so a stalled write cannot strand screens in lockdown. Group /
    // device scope needs no lookup to know its channel, so it dispatches
    // here — still before nothing, since its writes are already done and
    // the channel was never in doubt. Both awaited so the response reports
    // the real dispatch outcome. One channel per affected tenant, for the
    // same gateway-matching reason as the trigger path, and with the same
    // independent catch so one failed publish can't strand the rest of the
    // district on a lockdown that has already been cleared.
    const channel = `${scopeType}:${scopeId}`;
    if (!clearFanout) {
      for (const tid of affectedTenantIds) {
        invalidateTenantState(tid);
        // Group / device all-clear: move the revision so the cleared screens
        // pull the manifest, but leave `active` alone — the tenant-wide alert
        // state (if any) was never touched by this scope.
        bumpTenantEmergencyEpoch({ redis: this.redisService }, tid);
      }
      clearFanout = this.dispatchEmergencyFanout(
        [channel],
        signedMessage,
        { scopeType, overrideId, userId: req.user?.id, action: 'all-clear' },
      );
    }
    await clearFanout;

    return {
      success: true,
      affectedTenantIds,
      affectedTenantCount: affectedTenantIds.length,
      message:
        affectedTenantIds.length > 1
          ? `All clear dispatched to ${channel} and ${affectedTenantIds.length - 1} child location(s) for ${overrideId}`
          : `All clear dispatched to ${channel} for ${overrideId}`,
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
    // Move the revision so a screen on the cheap poll notices SOMETHING
    // emergency-shaped happened. `active` is untouched: an SOS is a pushed
    // message, not a tenant-wide manifest alert (the overlay's own
    // `/emergency/messages` reconcile is what actually delivers it).
    bumpTenantEmergencyEpoch({ redis: this.redisService }, tenantId);
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

    // ── EM-01 (2026-08-04) — DISTRICT BROADCASTS REACHED ZERO SCREENS ──────
    //
    // This handler published to exactly ONE channel and wrote exactly ONE
    // EmergencyMessage row, both keyed on the scope the operator picked. The
    // trigger path was fixed for this long ago (see the fan-out at the
    // `publishChannels` comment above); broadcast and media-alert were not —
    // `collectDescendantTenantIds` had only two call sites in this file, both
    // on trigger/clear.
    //
    // BOTH delivery tiers therefore missed every child school:
    //   * WS  — realtime.gateway matches a scope publish against the DEVICE'S
    //           OWN tenantId, so a screen in school B never sees
    //           `tenant:<districtId>`.
    //   * poll — deviceMessages filters `where: { tenantId: screen.tenantId }`
    //           with no ancestor walk (unlike the manifest, which has one).
    //
    // Since the documented production shape is that the district tenant owns
    // NO screens directly (41 paired screens sit under child tenants), a
    // district-wide broadcast was delivered to nobody — and still returned
    // `{ success: true }`, so the operator believed seven schools had it.
    // Silent total non-delivery on a life-safety surface.
    //
    // Fan out the same way trigger does: one message row per affected tenant
    // so each school's poll finds it, and one publish per tenant channel.
    // Each descendant gets its OWN messageId (the row id is the PK, and the
    // player dedups on the id it is handed), so the pushed message and the
    // polled row always agree.
    let affectedTenantIds: string[] = [ownedTenantId];
    if (scopeType === 'tenant') {
      const descendantTenantIds = await collectDescendantTenantIds(
        this.prisma.client.tenant as any,
        scopeId,
      );
      affectedTenantIds = [scopeId, ...descendantTenantIds];
    }
    // messageId (the caller-visible one) belongs to the scope the operator
    // targeted; descendants get derived ids.
    const idForTenant = (tid: string) =>
      tid === affectedTenantIds[0] ? messageId : `${messageId}_${tid}`;

    // Atomic message rows + audit so a partial failure can't orphan any of them.
    await this.prisma.client.$transaction([
      ...affectedTenantIds.map((tid) =>
        this.prisma.client.emergencyMessage.create({
          data: {
            id: idForTenant(tid),
            tenantId: tid,
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
      ),
      this.prisma.client.auditLog.create({
        data: {
          action: 'BROADCAST_TEXT',
          targetType: scopeType,
          targetId: scopeId,
          tenantId: ownedTenantId,
          userId: user.id,
          details: JSON.stringify({
            messageId,
            severity,
            len: text.length,
            durationMs,
            affectedTenantCount: affectedTenantIds.length,
          }),
        },
      }),
    ]);

    const channel = `${scopeType}:${scopeId}`;
    const publishTargets =
      scopeType === 'tenant'
        ? affectedTenantIds.map((tid) => ({ ch: `tenant:${tid}`, id: idForTenant(tid) }))
        : [{ ch: channel, id: messageId }];

    // Move the revision for every tenant this broadcast reached, before the
    // fan-out below. `active` untouched (a text overlay is not a manifest
    // alert) — see the SOS bump for the full reasoning.
    for (const tid of affectedTenantIds) {
      bumpTenantEmergencyEpoch({ redis: this.redisService }, tid);
    }

    // Each publish is caught INDEPENDENTLY: one school's Redis hiccup must not
    // skip the remaining schools' fan-out — they would each be silently
    // demoted to the HTTP-poll tier while the operator believes it landed.
    for (const target of publishTargets) {
      const signedMessage = this.signer.signMessage('TEXT_BROADCAST', {
        messageId: target.id,
        severity,
        text,
        expiresAt: Math.floor(expiresAtDate.getTime() / 1000),
      });
      try {
        await this.redisService.publish(target.ch, signedMessage);
      } catch (error) {
        Sentry.withScope((s) => {
          s.setTag('emergency.action', 'broadcast');
          s.setTag('emergency.scopeType', scopeType);
          s.setUser({ id: user.id });
          s.setExtra('messageId', target.id);
          s.setExtra('channel', target.ch);
          Sentry.captureException(error);
        });
        console.warn(`[Emergency] Broadcast redis publish failed for ${target.ch}. Falling back to HTTP polling. Error: ${error}`);
      }
    }

    return {
      success: true,
      messageId,
      affectedTenantIds,
      affectedTenantCount: affectedTenantIds.length,
      message: `Broadcast dispatched to ${affectedTenantIds.length} location(s)`,
    };
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

    // EM-01 (2026-08-04) — same district fan-out bug as broadcastText; see the
    // long note there. A district-scope media alert (evacuation map, shelter
    // photo, audio instruction) published to one channel and wrote one row, so
    // it reached zero screens whenever the district tenant owns none directly
    // — while still returning success.
    let affectedTenantIds: string[] = [ownedTenantId];
    if (scopeType === 'tenant') {
      const descendantTenantIds = await collectDescendantTenantIds(
        this.prisma.client.tenant as any,
        scopeId,
      );
      affectedTenantIds = [scopeId, ...descendantTenantIds];
    }
    const idForTenant = (tid: string) =>
      tid === affectedTenantIds[0] ? messageId : `${messageId}_${tid}`;

    // Atomic message rows + audit — matches the other emergency endpoints.
    await this.prisma.client.$transaction([
      ...affectedTenantIds.map((tid) =>
        this.prisma.client.emergencyMessage.create({
          data: {
            id: idForTenant(tid),
            tenantId: tid,
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
      ),
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
            affectedTenantCount: affectedTenantIds.length,
          }),
        },
      }),
    ]);

    const channel = `${scopeType}:${scopeId}`;
    const publishTargets =
      scopeType === 'tenant'
        ? affectedTenantIds.map((tid) => ({ ch: `tenant:${tid}`, id: idForTenant(tid) }))
        : [{ ch: channel, id: messageId }];

    // Same as the broadcast path: revision moves, `active` untouched.
    for (const tid of affectedTenantIds) {
      bumpTenantEmergencyEpoch({ redis: this.redisService }, tid);
    }

    for (const target of publishTargets) {
      const signedMessage = this.signer.signMessage('MEDIA_ALERT', {
        messageId: target.id,
        severity,
        textBlob,
        mediaUrls,
        audioUrl,
        expiresAt: Math.floor(expiresAtDate.getTime() / 1000),
      });
      try {
        await this.redisService.publish(target.ch, signedMessage);
      } catch (error) {
        Sentry.withScope((s) => {
          s.setTag('emergency.action', 'media-alert');
          s.setTag('emergency.scopeType', scopeType);
          s.setUser({ id: user.id });
          s.setExtra('messageId', target.id);
          s.setExtra('channel', target.ch);
          Sentry.captureException(error);
        });
        console.warn(`[Emergency] Media alert redis publish failed for ${target.ch}. Falling back to HTTP polling. Error: ${error}`);
      }
    }

    return {
      success: true,
      messageId,
      affectedTenantIds,
      affectedTenantCount: affectedTenantIds.length,
      message: `Media alert dispatched to ${affectedTenantIds.length} location(s)`,
    };
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
    // ten-ok: resolve-then-verify — tenant ownership asserted with 403 directly below; SUPER_ADMIN cross-tenant by design
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
      // Scoped by the VERIFIED owning tenant (defense-in-depth vs the
      // ownership check above racing a re-parent — updateMany because a
      // compound {id, tenantId} isn't a Prisma unique input).
      this.prisma.client.emergencyMessage.updateMany({
        where: { id: messageId, tenantId: existing.tenantId },
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
    // Pushed SOS/TEXT_BROADCAST/MEDIA_ALERT overlays are cleared on the player
    // by the ALL_CLEAR_MESSAGE type (setPushedEmergencyMessage(null)); the bare
    // ALL_CLEAR type only triggers a manifest re-fetch (the secure path for
    // OVERRIDE lockdowns) and never drops a pushed message — so signing
    // ALL_CLEAR here left the overlay stuck on screen with no way to clear it.
    const signedMessage = this.signer.signMessage('ALL_CLEAR_MESSAGE', {
      messageId,
      clearedBy: user.id || 'admin_system',
    });
    // Same reasoning as the broadcast/SOS bumps: move the revision, leave
    // `active` alone (clearing a pushed message is not a tenant all-clear).
    bumpTenantEmergencyEpoch({ redis: this.redisService }, existing.tenantId);
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
    // ── DT-03 / DT-10 (2026-08-03) — device principals ──────────────────
    // `req.user.tenantId` for a device used to come straight off a claim
    // inside a multi-month token, so an unpaired / re-homed / dumpstered
    // screen kept reading its FORMER tenant's live lockdown traffic —
    // message text, media URLs, the active panic playlist — for the life
    // of the token. The global DeviceIdentityInterceptor now re-derives
    // that field from the live Screen row before any handler sees it (and
    // rejects a revoked credential outright), so `callerTenantId` below is
    // trustworthy for a device.
    //
    // The second half is scope: this handler applied NO per-scope filter,
    // so a device could read `device:`-scoped messages addressed to OTHER
    // rooms in the same tenant — precisely the isolation the sibling
    // `/messages` handler was built to enforce. A device principal now
    // gets the same membership filter.
    const isDevicePrincipal = req.user?.kind === 'device';
    const callerTenantId = req.user?.schoolId || req.user?.tenantId || req.user?.districtId;
    const isSuper = !isDevicePrincipal && req.user?.role === AppRole.SUPER_ADMIN;
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

    if (isDevicePrincipal) {
      const screenId = typeof req.user?.sub === 'string' ? req.user.sub : null;
      const groupId = req.user?.screenGroupId || null;
      const scopeOr: Array<{ scopeType: string; scopeId: string }> = [
        { scopeType: 'tenant', scopeId: tenantId },
      ];
      if (screenId) scopeOr.push({ scopeType: 'device', scopeId: screenId });
      if (groupId) scopeOr.push({ scopeType: 'group', scopeId: groupId });
      where.AND = [...(where.AND ?? []), { OR: scopeOr }];
    }

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

    // ten-ok: device SELF-lookup — id IS the HMAC-signed device principal (u.sub); the live row is the authoritative tenant source (stale-claim defense)
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

    // 2026-08-16 (efficiency audit) — these two reads are independent once
    // tenantId is known, and this endpoint runs every ~10s on EVERY device,
    // uncached by design (it is the emergency HTTP backstop). Sequential,
    // they serialized two ~212ms round trips; parallel they cost one. The
    // tenant read also used to pull the FULL 49-column row — including
    // cleverAccessToken — per poll, to use exactly two fields. Select only
    // those two: less wire, and an OAuth token has no business riding a
    // device-poll buffer every ten seconds.
    const [rows, tenant] = await Promise.all([
      this.prisma.client.emergencyMessage.findMany({
        where: {
          tenantId,
          clearedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          AND: [{ OR: scopeOr }],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.client.tenant.findUnique({
        where: { id: tenantId },
        select: { emergencyStatus: true, emergencyPlaylistId: true },
      }),
    ]);

    return {
      tenantId,
      tenantStatus: tenant?.emergencyStatus || 'INACTIVE',
      tenantPlaylistId: tenant?.emergencyPlaylistId || null,
      active: rows.map(r => this.toEmergencyMessageView(r)),
    };
  }
}
