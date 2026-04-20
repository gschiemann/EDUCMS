import { Controller, Post, Get, Put, Delete, Body, Param, Req, Res, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import type { Request as ExpressReq, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { LicenseService } from '../license/license.service';
import { requireSecret } from '../security/required-secret';

const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePairingCode(): string {
  // sec-fix(wave1) #3: use crypto.randomInt (CSPRNG) instead of
  // Math.random() (predictable xorshift). Same 6-char alphabet & length.
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += PAIRING_CODE_ALPHABET[crypto.randomInt(0, PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Verify a device JWT from the Authorization: Bearer header against the
 * given screenId. Returns { ok: true, sub } on success or { ok: false, reason }.
 * Used by the player-side endpoints that used to be unauthenticated
 * (#4 emergency-assets, #5 cache-status).
 *
 * Backward-compat: also accepts a short-lived HMAC of `${screenId}:${ts}`
 * signed with DEVICE_SECRET_KEY, passed as header X-Device-Auth:
 *   `${timestampMs}.${hex(hmac_sha256(DEVICE_SECRET_KEY, screenId + ':' + timestampMs))}`
 * Valid for 2 minutes from the signed timestamp. Preferred path is the
 * device JWT — this alt exists so already-shipped player binaries can
 * keep posting while they roll forward to the JWT-required build.
 */
function verifyDeviceForScreen(req: ExpressReq, screenId: string): { ok: true; sub: string } | { ok: false; reason: string } {
  const auth = req.headers.authorization;
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    try {
      const secret = requireSecret('DEVICE_JWT_SECRET', { devFallback: 'dev_only_device_jwt_secret_CHANGE_ME' });
      const decoded = jwt.verify(token, secret) as any;
      if (decoded?.kind !== 'device') return { ok: false, reason: 'wrong_token_kind' };
      if (decoded?.sub !== screenId) return { ok: false, reason: 'subject_mismatch' };
      return { ok: true, sub: decoded.sub };
    } catch (e) {
      return { ok: false, reason: `jwt_invalid:${(e as Error).message}` };
    }
  }

  const hmacHeader = req.headers['x-device-auth'];
  if (typeof hmacHeader === 'string' && hmacHeader.includes('.')) {
    const [tsStr, sig] = hmacHeader.split('.');
    const ts = Number(tsStr);
    if (!Number.isFinite(ts)) return { ok: false, reason: 'hmac_ts_bad' };
    if (Math.abs(Date.now() - ts) > 2 * 60 * 1000) return { ok: false, reason: 'hmac_expired' };
    const secret = requireSecret('DEVICE_SECRET_KEY', { devFallback: 'dev_only_device_secret_CHANGE_ME' });
    const expected = crypto.createHmac('sha256', secret).update(`${screenId}:${ts}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length) return { ok: false, reason: 'hmac_sig_bad' };
    if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'hmac_sig_bad' };
    return { ok: true, sub: screenId };
  }

  return { ok: false, reason: 'no_auth' };
}

@Controller('api/v1/screens')
export class ScreensController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly signer: WebsocketSignerService,
    private readonly license: LicenseService,
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

    // Device JWT — tied to this screenId + fingerprint. Browser players
    // have no /devices/pair code-exchange flow (the pairing code is null'd
    // as soon as an admin claims), so /screens/register mints the token
    // here and the player stores it. Before admin claim the token can't
    // see any tenant data (manifest 404s); after claim the same token
    // gains access to the newly-bound tenant's manifest automatically.
    const mintDeviceJwt = (screenId: string) =>
      jwt.sign(
        { sub: screenId, kind: 'device', fp: body.deviceFingerprint },
        requireSecret('DEVICE_JWT_SECRET', { devFallback: 'dev_only_device_jwt_secret_CHANGE_ME' }),
        { expiresIn: '365d' },
      );

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
        deviceToken: mintDeviceJwt(updated.id),
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
      deviceToken: mintDeviceJwt(screen.id),
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
  async list(@Request() req: any, @Res({ passthrough: true }) res?: any) {
    // Force-no-cache — the fleet list is a live feed. Without this some
    // intermediaries / service workers were serving the same payload
    // for minutes after it changed, so a user who uninstalled an APK
    // still saw ONLINE until they manually cleared site data.
    if (res?.setHeader) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    const rows = await this.prisma.client.screen.findMany({
      where: { tenantId: req.user.tenantId },
      include: { screenGroup: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    // Compute live online/offline from lastPingAt recency. The stored
    // `status` column only flips on register/pair/ping and never back,
    // so a player that dies silently was showing ONLINE forever. Two
    // minutes matches the heartbeat cadence (30s) + 4x grace.
    // Near-real-time fleet status. Heartbeat cadence is 30s; grace is
    // tightened to 35s (was 45s) so a dead player flips OFFLINE ~5s after
    // its first missed ping. Paired with the dashboard's 10s refetch,
    // worst case device-dies → admin-sees-OFFLINE is ~45s (previously
    // 55s). 5s buffer is enough for normal network jitter without
    // causing false offlines; a screen that legitimately loses a single
    // ping will recover by the next 30s tick.
    const STALE_MS = 35 * 1000;
    const now = Date.now();
    return rows.map((s) => {
      // If a device is actively pinging, mark ONLINE regardless of
      // stored column. If stale, flip to OFFLINE unless the stored
      // state is something stronger (PENDING means never paired, keep;
      // REVOKED trumps all; ONLINE that's gone stale becomes OFFLINE).
      let liveStatus: string = s.status;
      if (s.status !== 'REVOKED') {
        const last = s.lastPingAt ? new Date(s.lastPingAt).getTime() : 0;
        const isAlive = last && (now - last) < STALE_MS;
        if (isAlive && s.tenantId) liveStatus = 'ONLINE';
        else if (s.status === 'ONLINE' || s.tenantId) liveStatus = 'OFFLINE';
      }
      return { ...s, status: liveStatus };
    });
  }

  // ─── ADMIN: Pair a screen by code ───
  // NOTE: this endpoint also handles re-pairing an existing tenant's
  // screen (e.g. the operator regenerates a code and another admin in
  // the same tenant claims it). When the resulting tenantId differs
  // from the previously-bound tenantId we publish a TENANT_CHANGED
  // signal on the OLD tenant's channel so the device wipes its USB
  // key + cache before binding to the new tenant — closes the
  // cross-tenant content leak (audit fix #6).
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

    // Audit fix #10: wrap the seat-availability check + the screen claim
    // in a SERIALIZABLE transaction so two admins can't simultaneously pass
    // assertSeatAvailable and overshoot the seat limit. PostgreSQL retries
    // on serialization conflict; one of the racing claims will get a
    // structured 402 LICENSE_EXHAUSTED instead of silently sneaking past.
    // Re-pairing a screen that already belongs to this tenant is free.
    const isNewPair = !screen.tenantId;
    const updated = await this.prisma.client.$transaction(
      async (tx) => {
        if (isNewPair) {
          await this.license.assertSeatAvailable(req.user.tenantId, tx);
        }
        return tx.screen.update({
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
      },
      {
        isolationLevel: 'Serializable',
        // Default is 5s but Supabase's pgbouncer + SERIALIZABLE can
        // push past that on first connection. Raise to 20s so we
        // don't 500 on slow networks; user sees a crisp error either
        // way if the actual work exceeds 20s (which means something
        // is very wrong). maxWait bumps the pool acquisition timeout
        // so we don't fail before the transaction even starts.
        timeout: 20000,
        maxWait: 10000,
      },
    );

    // Audit fix #6: if this re-pair changed the tenant, blast a
    // TENANT_CHANGED message on the OLD tenant's channel so the
    // physical device wipes its DataStore (token, tenantId,
    // usbIngestKey) and its filesDir/usb-cache before re-pairing
    // against the new tenant. Without this, a kiosk physically moved
    // between districts would keep serving its old tenant's emergency
    // assets from disk.
    const previousTenantId = screen.tenantId;
    if (previousTenantId && previousTenantId !== req.user.tenantId) {
      try {
        const signed = this.signer.signMessage('TENANT_CHANGED', {
          screenId: screen.id,
          previousTenantId,
          newTenantId: req.user.tenantId,
        });
        await this.redisService.publish(`tenant:${previousTenantId}`, signed);
      } catch (e) {
        console.warn('[pair] failed to notify previous tenant of TENANT_CHANGED', e);
      }
    }

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

  // ─── Sprint 8 — set screen geo location (map view) ───
  // Admin types an address (or pastes lat/lng); we forward to the
  // OpenStreetMap Nominatim public endpoint to geocode, store all three.
  // Nominatim is rate-limited to ~1 req/sec per IP; the request fires
  // server-side from this NestJS process, so the rate limit is per-deploy
  // and easily fits typical admin usage.
  //
  // No third-party API key required. If Nominatim is offline or refuses,
  // we still save the raw address and any caller-provided coordinates.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Put(':id/location')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setLocation(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { address?: string | null; latitude?: number | null; longitude?: number | null; photoUrl?: string | null },
  ) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    let lat = body.latitude ?? screen.latitude ?? null;
    let lng = body.longitude ?? screen.longitude ?? null;
    const addressChanged = body.address !== undefined && body.address !== screen.address;

    // Geocode if the operator gave us a fresh address but no explicit
    // coordinates. Use OSM Nominatim (free, no key). Polite single
    // request with a descriptive User-Agent (their ToS).
    if (addressChanged && body.address && body.latitude === undefined && body.longitude === undefined) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(body.address)}`;
        const r = await fetch(url, {
          headers: { 'User-Agent': 'EduCMS/1.0 (+https://educms.app)' },
        });
        if (r.ok) {
          const arr = (await r.json()) as Array<{ lat: string; lon: string }>;
          if (arr[0]) {
            lat = parseFloat(arr[0].lat);
            lng = parseFloat(arr[0].lon);
          }
        }
      } catch {
        // Geocode failure is non-fatal — admin can manually set lat/lng.
      }
    }

    const updated = await this.prisma.client.screen.update({
      where: { id },
      data: {
        address: body.address !== undefined ? (body.address?.trim() || null) : screen.address,
        latitude: lat,
        longitude: lng,
        photoUrl: body.photoUrl !== undefined ? (body.photoUrl?.trim() || null) : screen.photoUrl,
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

    // Any successful manifest fetch means the device is alive + talking
    // to us — touch lastPingAt so the dashboard list endpoint (which
    // derives ONLINE/OFFLINE from lastPingAt < 2min) reflects reality
    // without depending on the older web-player bundle that only polls
    // /screens/status/:fp. Non-blocking — if Prisma hiccups we still
    // return the manifest; next fetch will update.
    this.prisma.client.screen
      .update({ where: { id: screen.id }, data: { lastPingAt: new Date() } })
      .catch(() => { /* non-fatal; next manifest fetch will retry */ });

    // MED-1 audit fix: tenant-scope the read so a user from Tenant A can't
    // fetch Tenant B's manifest by guessing the screen UUID. Three valid
    // callers:
    //   1. Device JWT (kind: 'device', sub: screenId) — must match this
    //      screen.id directly.
    //   2. SUPER_ADMIN — cross-tenant by design.
    //   3. User JWT — req.user.tenantId must match screen.tenantId.
    const u: any = (req as any).user;
    if (u) {
      const isDeviceJwt = u.kind === 'device';
      const isSuper = u.role === AppRole.SUPER_ADMIN;
      if (isDeviceJwt) {
        if (u.sub !== screen.id) {
          return res.status(403).json({ error: 'Device token does not match screen' });
        }
      } else if (!isSuper) {
        const callerTenantId = u.schoolId || u.tenantId || u.districtId;
        if (!screen.tenantId || screen.tenantId !== callerTenantId) {
          return res.status(404).json({ error: 'Screen not found' }); // 404 not 403 to avoid existence-leak
        }
      }
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
      // 200 with empty playlists — NOT 404. A paired screen with no
      // scheduled content is a valid "waiting for assignment" state,
      // not a connection failure. Previously the player saw 404 and
      // displayed 'Unable to Connect' which looked identical to a
      // real network/auth error — admin had no way to tell the
      // difference.
      return res.status(200).json({
        screenId: screen.id,
        tenantId: screen.tenantId,
        playlists: [],
        emergencyStatus: 'INACTIVE',
        emptyReason: 'NO_SCHEDULE',
        message: 'This screen is paired but no playlist is scheduled. Assign a playlist from the dashboard.',
        hash: 'empty',
      });
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
  // see which screens are actually serving offline.
  //
  // sec-fix(wave1) #5: now requires a device JWT whose `sub` equals the
  // screenId. Without this, any unauthenticated client could spoof
  // "offline" or "emergency cached" statuses for any screen in the fleet
  // and cripple the admin dashboard's ability to detect real outages.
  @Post(':id/cache-status')
  async reportCacheStatus(
    @Param('id') id: string,
    @Req() req: ExpressReq,
    @Body() body: { playlist?: { count: number; bytes: number }; emergency?: { count: number; bytes: number } },
  ) {
    const authResult = verifyDeviceForScreen(req, id);
    if (!authResult.ok) {
      throw new HttpException(`Device auth required (${authResult.reason})`, HttpStatus.UNAUTHORIZED);
    }
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
  async getEmergencyAssets(@Param('id') id: string, @Req() req: ExpressReq) {
    // sec-fix(wave1) #4: this endpoint previously had NO auth — any
    // unauthenticated caller could enumerate emergency media URLs for
    // any screen in any tenant. Now requires a device JWT bound to the
    // screenId (or the short-lived HMAC fallback for backward compat).
    // Every successful fetch is audit-logged so we can forensically
    // answer "who asked for the lockdown video set, and when?"
    const authResult = verifyDeviceForScreen(req, id);
    if (!authResult.ok) {
      throw new HttpException(`Device auth required (${authResult.reason})`, HttpStatus.UNAUTHORIZED);
    }

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

    // sec-fix(wave1) #4: audit every emergency-asset fetch. Forensically
    // crucial — if someone abuses a stolen device token to enumerate
    // lockdown media, we need the log trail.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          action: 'DEVICE_FETCH_EMERGENCY_ASSETS',
          targetType: 'screen',
          targetId: id,
          tenantId: tenant.id,
          details: JSON.stringify({ assetCount: assets.length, setHash }),
        },
      });
    } catch (e) {
      // Non-fatal: we prefer to serve the player even if audit logging
      // is degraded.
      console.warn('[emergency-assets] audit log failed', (e as Error).message);
    }

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
