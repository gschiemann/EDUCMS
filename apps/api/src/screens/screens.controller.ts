import { Controller, Post, Get, Put, Delete, Body, Param, Req, Res, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import type { Request as ExpressReq, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import * as crypto from 'crypto';

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
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.client.screen.update({
      where: { id },
      data: {
        name: body.name?.trim() || screen.name,
        location: body.location !== undefined ? (body.location?.trim() || null) : screen.location,
        screenGroupId: body.screenGroupId !== undefined ? (body.screenGroupId || null) : screen.screenGroupId,
      },
      include: { screenGroup: { select: { id: true, name: true } } },
    });
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

      // If an emergency is active AND a specific playlist was assigned to it
      if (tenant?.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE' && tenant.emergencyPlaylistId) {
        const emergencyPlaylist = await this.prisma.client.playlist.findUnique({
          where: { id: tenant.emergencyPlaylistId },
          include: {
            items: {
              include: { asset: true },
              orderBy: { sequenceOrder: 'asc' }
            }
          }
        });

        if (emergencyPlaylist) {
          return res.status(200).json({
            screenId: screen.id,
            generatedAt: new Date().toISOString(),
            isEmergency: true,
            playlists: [
              {
                id: emergencyPlaylist.id,
                name: emergencyPlaylist.name,
                items: emergencyPlaylist.items.map(item => ({
                  url: item.asset.fileUrl,
                  duration_ms: item.durationMs,
                  sequence: item.sequenceOrder
                }))
              }
            ]
          });
        }
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
            items: { orderBy: { sequenceOrder: 'asc' }, include: { asset: true } }
          }
        }
      }
    });

    if (!schedules.length) {
      return res.status(404).json({ error: 'No active content mapped' });
    }

    const dynamicPlaylists = schedules.map(s => ({
      id: s.playlistId,
      items: s.playlist.items.map(pi => ({
        url: pi.asset.fileUrl,
        duration_ms: pi.durationMs,
        sequence: pi.sequenceOrder
      }))
    }));

    const manifestPayload: Record<string, any> = {
      version: "1.0",
      screenId: id,
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
}
