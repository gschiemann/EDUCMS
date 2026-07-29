import { Controller, Get, Post, Put, Delete, Body, Param, Res, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import {
  ScreenGroupCreateSchema, type ScreenGroupCreateInput,
  ScreenGroupUpdateSchema, type ScreenGroupUpdateInput,
  ScreenGroupAssignScreensSchema, type ScreenGroupAssignScreensInput,
} from '@cms/api-types';

// Same staleness threshold as screens.controller.ts list() — keep in
// sync. Source of truth is the screens controller; this duplicate
// exists because the dashboard's Screens page renders from
// /screen-groups (not /screens), and the stored `status` column only
// updates on register/pair/ping and never back to OFFLINE. Without
// this derivation a screen that silently dies shows ONLINE forever in
// the grouped list.
const STALE_MS = 35 * 1000;

@Controller('api/v1/screen-groups')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ScreenGroupsController {
  constructor(
    private readonly prisma: PrismaService,
    // 2026-07-28 tier-3 — camera calibration needs the signed device
    // fan-out (RedisService is @Global; signer is app-module-provided).
    private readonly redisService: RedisService,
    private readonly signer: WebsocketSignerService,
  ) {}

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any, @Res({ passthrough: true }) res?: any) {
    // Force-no-cache — fleet state is live. Without this some
    // intermediaries / service workers held the previous payload for
    // minutes after the screens actually went down.
    if (res?.setHeader) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    const tenantId = req.user.tenantId;
    const groups = await this.prisma.client.screenGroup.findMany({
      where: { tenantId },
      include: {
        screens: {
          // BUG FIX 2026-04-27: this `select` was missing
          // `playerVersion` / `playerVersionCode` / `playerVersionAt`
          // / `forceApkUpdatePendingAt` / `userAgent`. Dashboard
          // renders from `group.screens` (NOT useScreens()), so the
          // PlayerKindChip read `screen.playerVersion`, got undefined,
          // and fell back to "—" forever even though the field WAS
          // populated in Postgres + the /screens list endpoint
          // (different code path) returned it correctly. Operator
          // burned ~3 hours debugging a phantom kiosk-side bug
          // because of one missing field in this select.
          select: {
            id: true, name: true, location: true, status: true,
            lastPingAt: true, resolution: true, osInfo: true,
            browserInfo: true, userAgent: true, ipAddress: true,
            pairedAt: true, deviceFingerprint: true, tenantId: true,
            screenGroupId: true, latitude: true, longitude: true,
            address: true, lastCacheReport: true, lastCacheReportAt: true,
            playerVersion: true, playerVersionCode: true, playerVersionAt: true,
            forceApkUpdatePendingAt: true,
            // v1.0.12 — per-phase OTA state. Adding here proactively
            // so the dashboard chip can read it without repeating the
            // exact bug we just spent 3 hours on.
            lastOtaState: true, lastOtaProgress: true,
            lastOtaMessage: true, lastOtaAt: true,
            // Phase 2 — last crash from Player or Manager APK.
            // Same proactive add for the same reason.
            lastCrashAt: true, lastCrashVersion: true,
            lastCrashSource: true, lastCrashMessage: true,
            // v1.0.13 — Manager APK version (Player heartbeats this
            // for the kiosk). Add proactively to screen-groups
            // select for the same dashboard-bug reason.
            managerVersion: true, managerVersionAt: true,
            // 2026-05-26 — orientation + canvasW/canvasH. Same bug
            // class as the 2026-04-27 fix: dashboard ScreenDiagnostics
            // reads these directly off screenGroup.screens[N], and a
            // missing field reads as undefined → orientation always
            // displayed as "Landscape" and the LED canvas picker
            // always stuck on "Off". Operator hit the exact "burned
            // 3 hours on a phantom kiosk-side bug" pattern AGAIN.
            // Adding all 3 here so they're propagated to the list.
            orientation: true,
            canvasW: true, canvasH: true, repeats: true,
            // 2026-07-28 — frame-locked sync. Dashboard renders the
            // per-screen "SYNC ±Xms" badge + trim input from
            // group.screens[N] (NOT useScreens()) — same bug class as
            // the 2026-04-27 fix above: omit these and the badge reads
            // undefined forever while Postgres has the data.
            syncOffsetMs: true, lastSyncReport: true, lastSyncReportAt: true,
            // lastCrashStack deliberately omitted from the list
            // endpoint — 8KB per row × N screens is too much for a
            // dashboard that re-fetches every 10s. Stack lives on the
            // detail endpoint only (Phase 2.5: add a per-screen
            // /screens/:id/crash-detail).
          },
        },
        schedules: {
          where: { isActive: true },
          include: { playlist: { select: { id: true, name: true } } },
          orderBy: { startTime: 'desc' },
        },
        _count: { select: { schedules: true } },
      },
      orderBy: { name: 'asc' },
    });
    // Apply the same live-derive logic as screens.controller.ts list().
    // A paired screen whose lastPingAt is stale flips to OFFLINE; a
    // screen with fresh ping stays ONLINE. Unpaired/REVOKED states
    // pass through unchanged.
    const now = Date.now();
    return groups.map((g) => ({
      ...g,
      screens: g.screens.map((s) => {
        let liveStatus: string = s.status;
        if (s.status !== 'REVOKED') {
          const last = s.lastPingAt ? new Date(s.lastPingAt).getTime() : 0;
          const isAlive = last && (now - last) < STALE_MS;
          if (isAlive && s.tenantId) liveStatus = 'ONLINE';
          else if (s.status === 'ONLINE' || s.tenantId) liveStatus = 'OFFLINE';
        }
        return { ...s, status: liveStatus };
      }),
    }));
  }

  @Post()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async create(@Request() req: any, @Body(new ZodValidationPipe(ScreenGroupCreateSchema)) body: ScreenGroupCreateInput) {
    return this.prisma.client.screenGroup.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name,
        description: body.description,
      },
    });
  }

  @Put(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async update(@Request() req: any, @Param('id') id: string, @Body(new ZodValidationPipe(ScreenGroupUpdateSchema)) body: ScreenGroupUpdateInput) {
    const group = await this.prisma.client.screenGroup.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!group) throw new HttpException({ code: 'SCREEN_GROUP_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // 2026-07-28 — frame-locked sync toggle rides the normal group update.
    // Behavior-changing for every screen in the group, so it gets an
    // AuditLog row (§16: audit every privileged mutation); name/description
    // edits stay un-audited as before. Screens pick the change up on their
    // next manifest poll (the sync block is part of the ETag-hashed payload).
    const syncModeChanged =
      body.syncMode !== undefined && (body.syncMode ?? null) !== ((group as any).syncMode ?? null);

    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.screenGroup.update({
        where: { id },
        data: {
          name: body.name,
          description: body.description,
          ...(body.syncMode !== undefined ? { syncMode: body.syncMode } : {}),
        } as any,
      });
      if (syncModeChanged) {
        // Same tx as the mutation (canvas-route pattern): the toggle and
        // its audit row land or fail together — never a silent flip.
        await tx.auditLog.create({
          data: {
            tenantId: req.user.tenantId,
            userId: req.user?.id ?? null,
            action: 'SCREEN_GROUP_SYNC_MODE_CHANGED',
            targetType: 'ScreenGroup',
            targetId: id,
            details: JSON.stringify({
              from: (group as any).syncMode ?? null,
              to: body.syncMode ?? null,
            }),
          },
        });
      }
      return updated;
    });
  }

  /**
   * 2026-07-28 tier-3 — camera auto-calibration: arm/disarm the synced
   * flash pattern on every screen in this group. The dashboard wizard
   * calls {on:true} before measuring with the phone camera and {on:false}
   * when done; players ALSO auto-expire after durationSec (and again
   * player-side) so a screen can never stick in flash mode. Signed
   * per-device fan-out — same transport as CANVAS_CHANGE. Visual-only +
   * self-expiring, so deliberately not a SENSITIVE_TYPES message.
   */
  @Post(':id/calibrate-flash')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async calibrateFlash(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { on?: boolean; durationSec?: number },
  ) {
    const group = await this.prisma.client.screenGroup.findFirst({
      where: { id, tenantId: req.user.tenantId },
      include: { screens: { select: { id: true } } },
    });
    if (!group) throw new HttpException({ code: 'SCREEN_GROUP_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const on = body?.on !== false;
    const durationSec = Math.max(5, Math.min(120, Math.round(Number(body?.durationSec)) || 60));

    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user?.id ?? null,
          action: 'SCREEN_GROUP_CALIBRATE_FLASH',
          targetType: 'ScreenGroup',
          targetId: id,
          details: JSON.stringify({ on, durationSec, screenCount: group.screens.length }),
        },
      });
    } catch { /* visual-diagnostic toggle — never block on audit-log hiccup */ }

    let sent = 0;
    for (const s of group.screens) {
      try {
        const signed = this.signer.signMessage('CALIBRATE_FLASH', {
          screenId: s.id,
          on,
          durationSec,
        });
        await this.redisService.publish(`device:${s.id}`, signed);
        sent++;
      } catch { /* screen offline / redis blip — wizard shows which screens flash */ }
    }
    return { ok: true, on, durationSec, screens: group.screens.length, sent };
  }

  @Put(':id/screens')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async assignScreens(@Request() req: any, @Param('id') id: string, @Body(new ZodValidationPipe(ScreenGroupAssignScreensSchema)) body: ScreenGroupAssignScreensInput) {
    const group = await this.prisma.client.screenGroup.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!group) throw new HttpException({ code: 'SCREEN_GROUP_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // Assign screens to this group (tenant-scoped)
    await this.prisma.client.screen.updateMany({
      where: { id: { in: body.screenIds }, tenantId: req.user.tenantId },
      data: { screenGroupId: id },
    });

    return this.prisma.client.screenGroup.findUnique({
      where: { id },
      include: { screens: true },
    });
  }

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const group = await this.prisma.client.screenGroup.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!group) throw new HttpException({ code: 'SCREEN_GROUP_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // 2026-05-23 launch audit P1: deleting a screen group orphans
    // every Schedule that targeted it (those rows still exist but
    // their screenGroupId now points to a deleted record). Audit-log
    // the delete so operators can diagnose "where did my group go"
    // and forensics can identify the actor.
    await this.prisma.client.$transaction(async (tx) => {
      const unassigned = await tx.screen.updateMany({
        where: { screenGroupId: id },
        data: { screenGroupId: null },
      });
      await tx.screenGroup.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user.id,
          action: 'SCREEN_GROUP_DELETED',
          targetType: 'ScreenGroup',
          targetId: id,
          details: JSON.stringify({
            name: group.name,
            screensUnassigned: unassigned.count,
          }),
        },
      });
    });
    return { deleted: true };
  }
}
