import { Controller, Post, Get, Put, Delete, Body, Param, Req, Res, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import type { Request as ExpressReq, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import * as crypto from 'crypto';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';

function generatePairingCode(): string {
  // 6-char alphanumeric, uppercase, easy to read (no 0/O/I/1)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

@Controller('api/v1/screens')
export class ScreensController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly signer: WebsocketSignerService
  ) {}

  private async notifySync(tenantId: string) {
    try {
      const message = this.signer.signMessage('SYNC', { source: 'screen_update' });
      await this.redisService.publish(`tenant:${tenantId}`, message);
    } catch (e) {}
  }

  // ─── PUBLIC: Device self-registration (no auth) ───
  // The player opens, sends its device info, gets back a pairing code
  @Post('register')
  async register(@Body() body: {
    deviceFingerprint: string;
    resolution?: string;
    osInfo?: string;
    browserInfo?: string;
    userAgent?: string;
  }, @Req() req: ExpressReq) {
    if (!body.deviceFingerprint) {
      throw new HttpException('Device fingerprint is required', HttpStatus.BAD_REQUEST);
    }

    // Check if this device is already registered
    const existing = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: body.deviceFingerprint },
    });

    if (existing) {
      // Update device info + last ping
      const updated = await this.prisma.client.screen.update({
        where: { id: existing.id },
        data: {
          resolution: body.resolution || existing.resolution,
          osInfo: body.osInfo || existing.osInfo,
          browserInfo: body.browserInfo || existing.browserInfo,
          userAgent: body.userAgent || existing.userAgent,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          lastPingAt: new Date(),
          status: existing.tenantId ? 'ONLINE' : 'PENDING',
        },
      });
      return {
        screenId: updated.id,
        pairingCode: updated.pairingCode,
        paired: !!updated.tenantId,
        name: updated.name,
      };
    }

    // New device — create with pairing code
    let pairingCode = generatePairingCode();
    // Ensure uniqueness
    for (let attempt = 0; attempt < 10; attempt++) {
      const exists = await this.prisma.client.screen.findUnique({ where: { pairingCode } });
      if (!exists) break;
      pairingCode = generatePairingCode();
    }

    const screen = await this.prisma.client.screen.create({
      data: {
        name: `Screen-${pairingCode}`,
        deviceFingerprint: body.deviceFingerprint,
        pairingCode,
        status: 'PENDING',
        resolution: body.resolution || null,
        osInfo: body.osInfo || null,
        browserInfo: body.browserInfo || null,
        userAgent: body.userAgent || null,
        ipAddress: req.ip || req.socket.remoteAddress || null,
        lastPingAt: new Date(),
      },
    });

    return {
      screenId: screen.id,
      pairingCode: screen.pairingCode,
      paired: false,
      name: screen.name,
    };
  }

  // ─── PUBLIC: Device heartbeat / status check ───
  @Get('status/:deviceFingerprint')
  async deviceStatus(@Param('deviceFingerprint') fingerprint: string) {
    const screen = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: fingerprint },
    });
    if (!screen) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    // Update lastPingAt
    await this.prisma.client.screen.update({
      where: { id: screen.id },
      data: { lastPingAt: new Date(), status: screen.tenantId ? 'ONLINE' : 'PENDING' },
    });

    return {
      screenId: screen.id,
      paired: !!screen.tenantId,
      name: screen.name,
      pairingCode: screen.pairingCode,
    };
  }

  // ─── ADMIN: List all screens in tenant ───
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any) {
    return this.prisma.client.screen.findMany({
      where: { tenantId: req.user.tenantId },
      include: { screenGroup: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  // ─── ADMIN: Pair a screen by code ───
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post('pair')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async pair(
    @Request() req: any,
    @Body() body: { pairingCode: string; name?: string; screenGroupId?: string },
  ) {
    const code = body.pairingCode?.trim().toUpperCase();
    if (!code) throw new HttpException('Pairing code is required', HttpStatus.BAD_REQUEST);

    const screen = await this.prisma.client.screen.findUnique({
      where: { pairingCode: code },
    });

    if (!screen) throw new HttpException('Invalid pairing code. Make sure the code matches what is shown on the screen.', HttpStatus.NOT_FOUND);

    if (screen.tenantId && screen.tenantId !== req.user.tenantId) {
      throw new HttpException('This screen is already paired to another organization', HttpStatus.CONFLICT);
    }

    const updated = await this.prisma.client.screen.update({
      where: { id: screen.id },
      data: {
        tenantId: req.user.tenantId,
        name: body.name?.trim() || screen.name,
        screenGroupId: body.screenGroupId || null,
        status: 'ONLINE',
        pairedAt: new Date(),
        pairingCode: null, // Clear the code after pairing
      },
      include: { screenGroup: { select: { id: true, name: true } } },
    });

    this.notifySync(req.user.tenantId);
    return updated;
  }

  // ─── ADMIN: Update a screen ───
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Put(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { name?: string; location?: string; screenGroupId?: string | null },
  ) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    const updated = await this.prisma.client.screen.update({
      where: { id },
      data: {
        name: body.name?.trim() || screen.name,
        location: body.location !== undefined ? (body.location?.trim() || null) : screen.location,
        screenGroupId: body.screenGroupId !== undefined ? (body.screenGroupId || null) : screen.screenGroupId,
      },
      include: { screenGroup: { select: { id: true, name: true } } },
    });
    this.notifySync(req.user.tenantId);
    return updated;
  }

  // ─── ADMIN: Delete a screen ───
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    await this.prisma.client.schedule.deleteMany({ where: { screenId: id } });
    await this.prisma.client.screen.delete({ where: { id } });
    this.notifySync(req.user.tenantId);
    return { deleted: true };
  }

  // ─── Player manifest (what the screen device fetches) ───
  @UseGuards(JwtAuthGuard)
  @Get(':id/manifest')
  async getManifest(@Param('id') id: string, @Req() req: ExpressReq, @Res() res: Response) {
    const activeDeviceHash = req.headers['if-none-match'];

    const screen = await this.prisma.client.screen.findUnique({
      where: { id },
      include: { screenGroup: true }
    });

    if (!screen || screen.status === 'REVOKED') {
      return res.status(403).json({ error: 'Device invalid or revoked' });
    }

    if (screen.tenantId) {
      const tenant = await this.prisma.client.tenant.findUnique({
        where: { id: screen.tenantId },
        select: { emergencyStatus: true, emergencyPlaylistId: true }
      });

      // If an emergency is active, ALWAYS force an emergency override
      if (tenant?.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE') {
        let playlists: any[] = [];
        
        // Try to load the assigned emergency media if it exists
        if (tenant.emergencyPlaylistId) {
          const emergencyPlaylist = await this.prisma.client.playlist.findUnique({
            where: { id: tenant.emergencyPlaylistId },
            include: {
              items: {
                include: { asset: true },
                orderBy: { sequenceOrder: 'asc' }
              }
            }
          });

          if (emergencyPlaylist && emergencyPlaylist.items.length > 0) {
            playlists = [{
              id: emergencyPlaylist.id,
              name: emergencyPlaylist.name,
              items: emergencyPlaylist.items.map(item => ({
                url: item.asset.fileUrl,
                duration_ms: item.durationMs,
                sequence: item.sequenceOrder
              }))
            }];
          }
        }

        // BULLETPROOF FALLBACK: If the admin failed to assign an emergency playlist or it was empty, 
        // we MUST still lock the screen down to protect the school.
        if (playlists.length === 0) {
          playlists = [{
             id: "DEFAULT_EMERGENCY",
             name: `SYSTEM DEFAULT - ${tenant.emergencyStatus}`,
             template: {
               name: "EMERGENCY OVERRIDE",
               bgColor: tenant.emergencyStatus === 'CRITICAL' ? '#dc2626' : '#d97706',
               screenWidth: 1920,
               screenHeight: 1080,
               zones: [
                 {
                   id: "emergency-zone",
                   x: 0, y: 0, width: 100, height: 100, zIndex: 1,
                   widgetType: "TEXT",
                   defaultConfig: {
                     content: `EMERGENCY NOTIFICATION\n\n${tenant.emergencyStatus} PROTOCOL ACTIVE\n\nPlease follow standard procedures`,
                     fontSize: 100,
                     color: "white",
                     alignment: "center",
                     bold: true
                   }
                 }
               ]
             },
             items: []
          }];
        }

        return res.status(200).json({
          screenId: screen.id,
          generatedAt: new Date().toISOString(),
          isEmergency: true,
          playlists
        });
      }
    }

    const now = new Date();
    const schedules = await this.prisma.client.schedule.findMany({
      where: {
        AND: [
          {
            OR: [
              { screenGroupId: screen.screenGroupId },
              { screenId: screen.id }
            ]
          },
          { startTime: { lte: now } },
          { OR: [{ endTime: { gte: now } }, { endTime: null }] },
          { isActive: true },
        ]
      },
      include: {
        playlist: {
          include: {
            items: { orderBy: { sequenceOrder: 'asc' }, include: { asset: true } },
            template: {
              include: {
                zones: { orderBy: { sortOrder: 'asc' } },
              },
            },
          }
        }
      }
    });

    if (!schedules.length) {
      return res.status(404).json({ error: 'No active content mapped' });
    }

    const dynamicPlaylists = schedules.map(s => ({
      id: s.playlistId,
      // Include template data when playlist is template-based
      ...(s.playlist.template ? {
        template: {
          id: s.playlist.template.id,
          name: s.playlist.template.name,
          screenWidth: s.playlist.template.screenWidth,
          screenHeight: s.playlist.template.screenHeight,
          bgColor: s.playlist.template.bgColor,
          bgGradient: s.playlist.template.bgGradient,
          bgImage: s.playlist.template.bgImage,
          zones: s.playlist.template.zones.map(z => ({
            id: z.id,
            name: z.name,
            widgetType: z.widgetType,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: z.zIndex,
            sortOrder: z.sortOrder,
            defaultConfig: z.defaultConfig ? JSON.parse(z.defaultConfig) : null,
          })),
        },
      } : {}),
      items: s.playlist.items.map(pi => ({
        url: pi.asset.fileUrl,
        duration_ms: pi.durationMs,
        sequence: pi.sequenceOrder
      }))
    }));

    const manifestPayload: Record<string, any> = {
      version: "1.0",
      screenId: id,
      tenantId: screen.tenantId,
      generatedAt: now.toISOString(),
      playlists: dynamicPlaylists
    };

    const signatureString = JSON.stringify(manifestPayload.playlists) + id;
    const versionHash = crypto.createHash('sha256').update(signatureString).digest('hex');
    res.setHeader('ETag', versionHash);

    if (activeDeviceHash === versionHash) {
      return res.status(304).send();
    }

    manifestPayload['hash'] = versionHash;
    return res.status(200).json(manifestPayload);
  }

  // ─── Admin: per-screen cache readiness report ───
  // Surfaces in the dashboard so admins can verify each screen has actually
  // pre-cached the emergency assets. The screen reports back via
  // POST /:id/cache-status; we just read what was last reported.
  @Get(':id/cache-status')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getCacheStatus(@Param('id') id: string, @Request() req: any) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true, name: true, lastCacheReport: true, lastCacheReportAt: true },
    });
    if (!screen) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    const report = (screen.lastCacheReport as any) || null;
    return {
      screenId: screen.id,
      screenName: screen.name,
      reportedAt: screen.lastCacheReportAt,
      report,
      // Compute "all emergency assets cached?" against the current emergency
      // asset set so the dashboard can show a green check or red warning.
      emergencyReady: !!(report && report.emergency && report.emergency.count > 0),
    };
  }

  // The player POSTs a small status payload here ~every 30s so admins can
  // see which screens are actually serving offline. No auth needed (the
  // payload is harmless metadata) but rate-limited via global throttler.
  @Post(':id/cache-status')
  async reportCacheStatus(
    @Param('id') id: string,
    @Body() body: { playlist?: { count: number; bytes: number }; emergency?: { count: number; bytes: number } },
  ) {
    const screen = await this.prisma.client.screen.findUnique({ where: { id }, select: { id: true } });
    if (!screen) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    await this.prisma.client.screen.update({
      where: { id },
      data: {
        lastCacheReport: body as any,
        lastCacheReportAt: new Date(),
      },
    });
    return { ok: true };
  }

  // ─── PUBLIC: Emergency assets list (for offline pre-cache) ───
  // The player calls this on startup AND after every successful manifest sync
  // to keep its `emergency-assets` Service-Worker cache tier hot. The cache
  // tier is NEVER evicted, so when an emergency fires the player can serve
  // every asset from local disk in under a second — no network required.
  //
  // Returns assets across all 4 panic-type playlists configured on the
  // tenant (lockdown / evacuate / weather / emergency-default), each with a
  // SHA-256 hash so the SW can detect tampered or stale files and re-download.
  @Get(':id/emergency-assets')
  async getEmergencyAssets(@Param('id') id: string) {
    const screen = await this.prisma.client.screen.findUnique({
      where: { id },
      select: { tenantId: true },
    });
    if (!screen?.tenantId) {
      throw new HttpException('Screen not found or not paired', HttpStatus.NOT_FOUND);
    }

    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: screen.tenantId },
      select: {
        id: true,
        emergencyPlaylistId: true,
        panicLockdownPlaylistId: true,
        panicEvacuatePlaylistId: true,
        panicWeatherPlaylistId: true,
      },
    });
    if (!tenant) {
      throw new HttpException('Tenant not found', HttpStatus.NOT_FOUND);
    }

    const playlistIds = [
      tenant.emergencyPlaylistId,
      tenant.panicLockdownPlaylistId,
      tenant.panicEvacuatePlaylistId,
      tenant.panicWeatherPlaylistId,
    ].filter((x): x is string => !!x);

    const assets: Array<{ url: string; sha256: string; size: number; kind: string }> = [];

    if (playlistIds.length > 0) {
      const playlists = await this.prisma.client.playlist.findMany({
        where: { id: { in: playlistIds } },
        include: {
          items: {
            include: {
              asset: { select: { fileUrl: true, fileSize: true, mimeType: true, fileHash: true } },
            },
          },
        },
      });
      const seen = new Set<string>();
      for (const pl of playlists) {
        for (const item of pl.items) {
          if (!item.asset?.fileUrl) continue;
          if (seen.has(item.asset.fileUrl)) continue;
          seen.add(item.asset.fileUrl);
          // Asset.fileHash is the canonical SHA-256 if the upload pipeline
          // computed it; otherwise we synthesize a stable id from the URL +
          // fileSize so the SW can still de-dupe (re-download only when
          // either changes).
          const hash = item.asset.fileHash
            ?? crypto.createHash('sha256').update(`${item.asset.fileUrl}:${item.asset.fileSize ?? 0}`).digest('hex');
          assets.push({
            url: item.asset.fileUrl,
            sha256: hash,
            size: item.asset.fileSize ?? 0,
            kind: item.asset.mimeType?.startsWith('video/') ? 'video' : 'image',
          });
        }
      }
    }

    // Stable hash of the whole asset set so the player can short-circuit
    // pre-cache when nothing has changed.
    const setHash = crypto
      .createHash('sha256')
      .update(assets.map(a => `${a.url}:${a.sha256}`).sort().join('|'))
      .digest('hex');

    return {
      tenantId: tenant.id,
      screenId: id,
      generatedAt: new Date().toISOString(),
      assets,
      assetCount: assets.length,
      totalBytes: assets.reduce((sum, a) => sum + a.size, 0),
      setHash,
    };
  }
}
