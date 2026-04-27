import { Controller, Post, Get, Put, Delete, Body, Param, Query, Req, Res, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
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
import {
  getTenantState,
  setTenantState,
  shouldSkipLastPingWrite,
  markLastPingWritten,
  shouldSkipEmergencyAudit,
  markEmergencyAuditWritten,
} from './manifest-hot-cache';

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

    // Preview mode fingerprints (set by the dashboard's "Open in Browser" button)
    // must NEVER create a Screen row or update lastPingAt on an existing row.
    // Return a synthetic not-paired payload so the preview player can still
    // render content via the manifest endpoint (using its admin JWT).
    if (body.deviceFingerprint.startsWith('preview-')) {
      return {
        screenId: null,
        pairingCode: null,
        paired: false,
        name: 'Preview',
        deviceToken: null,
        isPreview: true,
      };
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
  async deviceStatus(
    @Param('deviceFingerprint') fingerprint: string,
    @Query('v') versionName?: string,
    @Query('vc') versionCode?: string,
    @Query('mv') managerVersionName?: string,
    @Request() req?: any,
  ) {
    // Preview fingerprints must never write lastPingAt — they would push
    // the real paired kiosk's status to ONLINE even after closing the tab.
    if (fingerprint.startsWith('preview-')) {
      return { screenId: null, paired: false, name: 'Preview', pairingCode: null, isPreview: true };
    }

    const screen = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: fingerprint },
    });
    if (!screen) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    // Update lastPingAt — and if the kiosk passed its app version on
    // this heartbeat, capture it too. Operator (2026-04-27): "we
    // shouldnt have to wait 6 hours to see an updated version, why
    // not grab that everytime the screen checks in?"
    //
    // The Kotlin HeartbeatService sends ?v=BuildConfig.VERSION_NAME
    // (and optionally ?vc=BuildConfig.VERSION_CODE) on every 30s
    // heartbeat — same fields the OTA endpoint already accepts but
    // 720× more often. Old kiosks that don't pass the params still
    // work; they just won't update the version field until their
    // next /update-check.
    const data: any = {
      lastPingAt: new Date(),
      status: screen.tenantId ? 'ONLINE' : 'PENDING',
    };
    const vn = (versionName || '').trim();
    if (vn) {
      data.playerVersion = vn;
      data.playerVersionAt = new Date();
      const vc = Number(versionCode);
      if (Number.isFinite(vc) && vc > 0) data.playerVersionCode = vc;
    }
    // v1.0.13 — Manager APK version, queried by Player via
    // PackageManager and passed as ?mv=. Empty string means
    // "Manager not installed" (vs absent which means "old Player
    // doesn't know about Manager"). We treat both as no-update so
    // we don't accidentally clear a previously-reported value.
    const mv = (managerVersionName || '').trim();
    if (mv) {
      data.managerVersion = mv;
      data.managerVersionAt = new Date();
    }
    // Diagnostic — operator caught dashboard chip stuck blank on
    // 2026-04-27 even with v1.0.11 installed. Log every heartbeat
    // with the FULL request URL so we can see in Railway logs
    // exactly what the kiosk is sending and pinpoint where ?v=
    // is being dropped (URL nav, header strip, route mismatch).
    // Verbose for now while diagnosing; tighten once root cause is fixed.
    const fpShort = fingerprint.slice(0, 18);
    const versionChanged = vn && vn !== screen.playerVersion;
    const rawUrl = req?.originalUrl || req?.url || '(unknown)';
    const userAgent = req?.headers?.['user-agent'] || '(no-ua)';
    const isApkUa = /EduCmsPlayer/i.test(userAgent);
    console.log(
      `[heartbeat] fp=${fpShort}… v=${vn || '(NONE)'} vc=${versionCode || '(NONE)'} ` +
      `prior=${screen.playerVersion || '(none)'} changed=${versionChanged} ` +
      `apk-ua=${isApkUa} url=${String(rawUrl).slice(0, 200)}`,
    );
    await this.prisma.client.screen.update({
      where: { id: screen.id },
      data,
    });

    return {
      screenId: screen.id,
      paired: !!screen.tenantId,
      name: screen.name,
      pairingCode: screen.pairingCode,
    };
  }

  // ─── PUBLIC: Per-phase OTA state report from the device ──────────
  // Called by OtaUpdateWorker on the Android player at each phase of
  // an OTA install so the dashboard can show real progress instead of
  // stopwatch theater.
  //
  // Body shape (all optional except state):
  //   { state: 'CHECKING'|'DOWNLOADING'|'VERIFYING'|'INSTALLING'|'INSTALLED'|'ERROR',
  //     progress?: 0-100,   // download %, only meaningful during DOWNLOADING
  //     message?: string }  // human-readable detail (used for ERROR)
  //
  // Public (no auth) for the same reason /screens/status is public:
  // the kiosk has a device JWT but using it adds latency; this
  // endpoint just records non-sensitive progress + is rate-limited
  // implicitly by the caller's heartbeat cadence (a worker firing
  // every minute would still only generate 5-7 reports per OTA).
  @Post('status/:deviceFingerprint/ota-state')
  async reportOtaState(
    @Param('deviceFingerprint') fingerprint: string,
    @Body() body: { state?: string; progress?: number; message?: string },
  ) {
    if (fingerprint.startsWith('preview-')) return { ok: true, ignored: 'preview' };
    const screen = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: fingerprint },
      select: { id: true, name: true, lastOtaState: true },
    });
    if (!screen) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    const ALLOWED = new Set([
      'CHECKING', 'DOWNLOADING', 'VERIFYING', 'INSTALLING', 'INSTALLED', 'ERROR',
    ]);
    const state = String(body?.state || '').toUpperCase().trim();
    if (!ALLOWED.has(state)) {
      throw new HttpException(`Invalid state: ${state}`, HttpStatus.BAD_REQUEST);
    }
    const progress = typeof body?.progress === 'number' && Number.isFinite(body.progress)
      ? Math.max(0, Math.min(100, Math.round(body.progress)))
      : null;
    const message = body?.message ? String(body.message).slice(0, 500) : null;

    await this.prisma.client.screen.update({
      where: { id: screen.id },
      data: {
        lastOtaState: state,
        lastOtaProgress: progress,
        lastOtaMessage: message,
        lastOtaAt: new Date(),
      } as any,
    });

    console.log(
      `[ota-state] fp=${fingerprint.slice(0, 18)}… state=${state} ` +
      `progress=${progress ?? '-'} message=${(message || '').slice(0, 80)}`,
    );

    return { ok: true };
  }

  // ─── PUBLIC: Crash report from Player or Manager APK (Phase 2) ───
  // Called by an UncaughtExceptionHandler in each APK when something
  // throws fatally. Dashboard surfaces the most recent crash so we
  // can correlate with versionCode and ship a fix without waiting
  // for an operator to hand-walk through logcat.
  //
  // Body shape:
  //   { source: 'player'|'manager',
  //     versionName: string,
  //     versionCode?: number,
  //     message: string,
  //     stack: string }
  //
  // Stack trace truncated at 8KB on the server side — large enough
  // for any Kotlin trace, small enough to keep Postgres rows from
  // bloating. Operator can pull the full trace via the existing
  // PlayerLogger.uploadDiagnostics path if more depth is needed.
  @Post('status/:deviceFingerprint/crash-report')
  async reportCrash(
    @Param('deviceFingerprint') fingerprint: string,
    @Body() body: {
      source?: string;
      versionName?: string;
      versionCode?: number;
      message?: string;
      stack?: string;
    },
  ) {
    if (fingerprint.startsWith('preview-')) return { ok: true, ignored: 'preview' };
    const screen = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: fingerprint },
      select: { id: true, name: true },
    });
    if (!screen) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    const source = (body?.source || '').toLowerCase().trim();
    if (source !== 'player' && source !== 'manager') {
      throw new HttpException(
        `Invalid source: ${source} (expected player or manager)`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const message = (body?.message || '').slice(0, 500) || null;
    const stack = (body?.stack || '').slice(0, 8 * 1024) || null;
    const versionName = body?.versionName ? String(body.versionName).slice(0, 40) : null;

    await this.prisma.client.screen.update({
      where: { id: screen.id },
      data: {
        lastCrashAt: new Date(),
        lastCrashSource: source,
        lastCrashVersion: versionName,
        lastCrashMessage: message,
        lastCrashStack: stack,
      } as any,
    });

    // Loud Railway log — these are real crashes; we want them
    // visible in the operator's daily-glance scroll, not buried.
    console.error(
      `[crash] fp=${fingerprint.slice(0, 18)}… source=${source} version=${versionName ?? '-'} ` +
      `message="${(message || '').slice(0, 200)}"`,
    );

    return { ok: true };
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

  // ─── Sprint 8b — per-screen emergency content config ───
  // Lets the operator set, for each of the 6 emergency types
  // (LOCKDOWN / EVACUATE / WEATHER / HOLD / SECURE / MEDICAL), either:
  //   • a specific Playlist id  → that playlist plays on THIS screen
  //                              when this type fires
  //   • null                    → falls back to Tenant.panic*PlaylistId
  // The manifest endpoint resolves these per-screen settings BEFORE
  // the tenant defaults so "different content per room" works without
  // a manual trigger event.
  //
  // Body shape — all 6 keys optional. Pass null to clear an override
  // (resume tenant default). Unspecified keys are left untouched.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Put(':id/emergency-content')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setEmergencyContent(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: {
      lockdownPlaylistId?: string | null;
      evacuatePlaylistId?: string | null;
      weatherPlaylistId?: string | null;
      holdPlaylistId?: string | null;
      securePlaylistId?: string | null;
      medicalPlaylistId?: string | null;
      // Per-type custom asset URL — single uploaded image/video shown
      // full-screen for that emergency. Setting either playlistId OR
      // assetUrl for a type wins over tenant defaults; manifest checks
      // playlist first, falls back to asset, falls back to tenant.
      lockdownAssetUrl?: string | null;
      evacuateAssetUrl?: string | null;
      weatherAssetUrl?: string | null;
      holdAssetUrl?: string | null;
      secureAssetUrl?: string | null;
      medicalAssetUrl?: string | null;
      // Portrait variants. Same six types again. Manifest picks
      // landscape vs portrait based on the screen's physical
      // resolution. Operator usually configures both so the right
      // poster shows on each kiosk regardless of orientation.
      lockdownPortraitPlaylistId?: string | null;
      evacuatePortraitPlaylistId?: string | null;
      weatherPortraitPlaylistId?: string | null;
      holdPortraitPlaylistId?: string | null;
      securePortraitPlaylistId?: string | null;
      medicalPortraitPlaylistId?: string | null;
      lockdownPortraitAssetUrl?: string | null;
      evacuatePortraitAssetUrl?: string | null;
      weatherPortraitAssetUrl?: string | null;
      holdPortraitAssetUrl?: string | null;
      securePortraitAssetUrl?: string | null;
      medicalPortraitAssetUrl?: string | null;
    },
  ) {
    const tenantId = req.user.tenantId;
    const screen = await this.prisma.client.screen.findFirst({ where: { id, tenantId } });
    if (!screen) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    // Validate every supplied playlist id belongs to the same tenant.
    // Cross-tenant assignment is silently dropped to null with an
    // audit log entry so we know about it.
    const ids: string[] = [
      body.lockdownPlaylistId, body.evacuatePlaylistId, body.weatherPlaylistId,
      body.holdPlaylistId, body.securePlaylistId, body.medicalPlaylistId,
      body.lockdownPortraitPlaylistId, body.evacuatePortraitPlaylistId, body.weatherPortraitPlaylistId,
      body.holdPortraitPlaylistId, body.securePortraitPlaylistId, body.medicalPortraitPlaylistId,
    ].filter((v): v is string => typeof v === 'string' && v.length > 0);
    let validIds = new Set<string>();
    if (ids.length > 0) {
      const playlists = await this.prisma.client.playlist.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true },
      });
      validIds = new Set(playlists.map((p) => p.id));
    }
    const sanitize = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;     // leave field untouched
      if (v === null || v === '') return null;   // clear override
      return validIds.has(v) ? v : null;         // unknown id → drop to null
    };
    // Asset URLs are validated lightly — must be a non-empty string
    // that looks like a URL. The asset itself was uploaded via
    // /assets/upload (which already enforces tenant scoping + MIME
    // allowlist), so we trust the URL it returned.
    const sanitizeUrl = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return null;
      const s = v.trim();
      if (!/^(https?:\/\/|\/)/.test(s)) return null;  // reject mailto:, data:, etc.
      return s.slice(0, 2048);
    };

    const data: any = {};
    if (body.lockdownPlaylistId !== undefined) data.emergencyLockdownPlaylistId = sanitize(body.lockdownPlaylistId);
    if (body.evacuatePlaylistId !== undefined) data.emergencyEvacuatePlaylistId = sanitize(body.evacuatePlaylistId);
    if (body.weatherPlaylistId  !== undefined) data.emergencyWeatherPlaylistId  = sanitize(body.weatherPlaylistId);
    if (body.holdPlaylistId     !== undefined) data.emergencyHoldPlaylistId     = sanitize(body.holdPlaylistId);
    if (body.securePlaylistId   !== undefined) data.emergencySecurePlaylistId   = sanitize(body.securePlaylistId);
    if (body.medicalPlaylistId  !== undefined) data.emergencyMedicalPlaylistId  = sanitize(body.medicalPlaylistId);
    if (body.lockdownAssetUrl   !== undefined) data.emergencyLockdownAssetUrl   = sanitizeUrl(body.lockdownAssetUrl);
    if (body.evacuateAssetUrl   !== undefined) data.emergencyEvacuateAssetUrl   = sanitizeUrl(body.evacuateAssetUrl);
    if (body.weatherAssetUrl    !== undefined) data.emergencyWeatherAssetUrl    = sanitizeUrl(body.weatherAssetUrl);
    if (body.holdAssetUrl       !== undefined) data.emergencyHoldAssetUrl       = sanitizeUrl(body.holdAssetUrl);
    if (body.secureAssetUrl     !== undefined) data.emergencySecureAssetUrl     = sanitizeUrl(body.secureAssetUrl);
    if (body.medicalAssetUrl    !== undefined) data.emergencyMedicalAssetUrl    = sanitizeUrl(body.medicalAssetUrl);
    // Portrait variants — same model, _portrait suffix on the column.
    if (body.lockdownPortraitPlaylistId !== undefined) data.emergencyLockdownPortraitPlaylistId = sanitize(body.lockdownPortraitPlaylistId);
    if (body.evacuatePortraitPlaylistId !== undefined) data.emergencyEvacuatePortraitPlaylistId = sanitize(body.evacuatePortraitPlaylistId);
    if (body.weatherPortraitPlaylistId  !== undefined) data.emergencyWeatherPortraitPlaylistId  = sanitize(body.weatherPortraitPlaylistId);
    if (body.holdPortraitPlaylistId     !== undefined) data.emergencyHoldPortraitPlaylistId     = sanitize(body.holdPortraitPlaylistId);
    if (body.securePortraitPlaylistId   !== undefined) data.emergencySecurePortraitPlaylistId   = sanitize(body.securePortraitPlaylistId);
    if (body.medicalPortraitPlaylistId  !== undefined) data.emergencyMedicalPortraitPlaylistId  = sanitize(body.medicalPortraitPlaylistId);
    if (body.lockdownPortraitAssetUrl   !== undefined) data.emergencyLockdownPortraitAssetUrl   = sanitizeUrl(body.lockdownPortraitAssetUrl);
    if (body.evacuatePortraitAssetUrl   !== undefined) data.emergencyEvacuatePortraitAssetUrl   = sanitizeUrl(body.evacuatePortraitAssetUrl);
    if (body.weatherPortraitAssetUrl    !== undefined) data.emergencyWeatherPortraitAssetUrl    = sanitizeUrl(body.weatherPortraitAssetUrl);
    if (body.holdPortraitAssetUrl       !== undefined) data.emergencyHoldPortraitAssetUrl       = sanitizeUrl(body.holdPortraitAssetUrl);
    if (body.securePortraitAssetUrl     !== undefined) data.emergencySecurePortraitAssetUrl     = sanitizeUrl(body.securePortraitAssetUrl);
    if (body.medicalPortraitAssetUrl    !== undefined) data.emergencyMedicalPortraitAssetUrl    = sanitizeUrl(body.medicalPortraitAssetUrl);

    const updated = await this.prisma.client.screen.update({
      where: { id },
      data,
      select: {
        id: true,
        emergencyLockdownPlaylistId: true,
        emergencyEvacuatePlaylistId: true,
        emergencyWeatherPlaylistId: true,
        emergencyHoldPlaylistId: true,
        emergencySecurePlaylistId: true,
        emergencyMedicalPlaylistId: true,
        emergencyLockdownAssetUrl: true,
        emergencyEvacuateAssetUrl: true,
        emergencyWeatherAssetUrl: true,
        emergencyHoldAssetUrl: true,
        emergencySecureAssetUrl: true,
        emergencyMedicalAssetUrl: true,
        emergencyLockdownPortraitPlaylistId: true,
        emergencyEvacuatePortraitPlaylistId: true,
        emergencyWeatherPortraitPlaylistId: true,
        emergencyHoldPortraitPlaylistId: true,
        emergencySecurePortraitPlaylistId: true,
        emergencyMedicalPortraitPlaylistId: true,
        emergencyLockdownPortraitAssetUrl: true,
        emergencyEvacuatePortraitAssetUrl: true,
        emergencyWeatherPortraitAssetUrl: true,
        emergencyHoldPortraitAssetUrl: true,
        emergencySecurePortraitAssetUrl: true,
        emergencyMedicalPortraitAssetUrl: true,
      } as any,
    });

    // Audit log — operator changed which playlist plays on a specific
    // screen during a specific emergency type. Record what they set.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: req.user.id,
          action: 'UPDATE_SCREEN_EMERGENCY_CONTENT',
          targetType: 'screen',
          targetId: id,
          details: JSON.stringify({ patch: data }),
        },
      });
    } catch { /* swallow */ }

    this.notifySync(tenantId);
    return updated;
  }

  // ─── ADMIN: Push an OTA update check to paired screens ───
  // When an admin clicks "Push APK update" in the dashboard we fire a
  // signed CHECK_FOR_UPDATES WebSocket message scoped to either one
  // screen or the whole tenant. The web player's WS handler relays to
  // the native APK shell via WebAppBridge.checkForUpdates → enqueues a
  // one-shot OtaUpdateWorker run on the kiosk. Requires APK ≥ 1.0.6
  // (the bridge method didn't exist before that build); older installs
  // silently ignore the event and pick up the update on their next
  // 6h periodic poll instead.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post('force-update')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async forceUpdateAll(@Request() req: any) {
    const tenantId = req.user.tenantId;
    if (!tenantId) throw new HttpException('No tenant context', HttpStatus.BAD_REQUEST);
    // Mark every screen in the tenant as force-pending so the next
    // /update-check from each one gets the latest APK (gated 30 min).
    // Safe even when tenant.autoUpdatePlayerEnabled is false — the
    // force flag is the explicit opt-in for THIS push only.
    await this.prisma.client.screen.updateMany({
      where: { tenantId },
      data: { forceApkUpdatePendingAt: new Date() } as any,
    }).catch((e) => {
      console.warn('[force-update] forceApkUpdatePendingAt write failed', (e as Error).message);
    });
    const signed = this.signer.signMessage('CHECK_FOR_UPDATES', {
      scope: 'tenant',
      scopeId: tenantId,
      requestedBy: req.user.userId || req.user.id || null,
    });
    try {
      await this.redisService.publish(`tenant:${tenantId}`, signed);
    } catch (e) {
      console.warn('[force-update] redis publish failed', (e as Error).message);
    }
    await this.prisma.client.auditLog.create({
      data: {
        action: 'FORCE_APK_UPDATE',
        targetType: 'tenant',
        targetId: tenantId,
        tenantId,
        userId: req.user.id,
        details: JSON.stringify({ scope: 'tenant' }),
      },
    }).catch(() => { /* audit best-effort */ });
    return { ok: true, scope: 'tenant' };
  }

  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post(':id/force-update')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async forceUpdateOne(@Request() req: any, @Param('id') id: string) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    // Set the per-screen force flag — the next update-check from
    // this kiosk returns the latest APK (gated 30 min).
    await this.prisma.client.screen.update({
      where: { id },
      data: { forceApkUpdatePendingAt: new Date() } as any,
    }).catch((e) => {
      console.warn('[force-update one] forceApkUpdatePendingAt write failed', (e as Error).message);
    });
    const signed = this.signer.signMessage('CHECK_FOR_UPDATES', {
      scope: 'screen',
      scopeId: id,
      tenantId: screen.tenantId,
      requestedBy: req.user.userId || req.user.id || null,
    });
    // Publish on the tenant channel — all kiosks receive, but only the
    // targeted screen acts on it (the payload includes scopeId).
    try {
      await this.redisService.publish(`tenant:${screen.tenantId}`, signed);
    } catch (e) {
      console.warn('[force-update one] redis publish failed', (e as Error).message);
    }
    await this.prisma.client.auditLog.create({
      data: {
        action: 'FORCE_APK_UPDATE',
        targetType: 'screen',
        targetId: id,
        tenantId: screen.tenantId!,
        userId: req.user.id,
        details: JSON.stringify({ scope: 'screen', screenName: screen.name }),
      },
    }).catch(() => { /* audit best-effort */ });
    return { ok: true, scope: 'screen', screenId: id };
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
    // derives ONLINE/OFFLINE from lastPingAt < 2min) reflects reality.
    // DEBOUNCED to at most once per 25s per screen: the 2min ONLINE
    // threshold tolerates up to 25s of staleness, and the previous
    // unthrottled write-per-poll pattern was saturating the Supabase
    // pool (500 screens × 5s polls = 100 writes/sec, each grabbing a
    // connection). Non-blocking either way — if Prisma hiccups we
    // still return the manifest; next fetch re-checks the debounce.
    if (!shouldSkipLastPingWrite(screen.id)) {
      markLastPingWritten(screen.id);
      this.prisma.client.screen
        .update({ where: { id: screen.id }, data: { lastPingAt: new Date() } })
        .catch(() => { /* non-fatal; next manifest fetch will retry */ });
    }

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

    // ─── Sprint 8b — per-screen emergency override (PRECEDES tenant-wide) ───
    // The player checks for a row in ScreenEmergencyOverride scoped to
    // this exact screen FIRST. If one exists and isn't expired, we
    // synthesize the same emergency state shape the tenant-wide path
    // produces, but using the override's type/severity/playlist. The
    // tenant-wide block below stays untouched — if no per-screen
    // override is active we fall through to it like always.
    //
    // This is the load-bearing change for Sprint 8b: "different alert
    // per room" works because the manifest path always picks per-screen
    // before tenant. No additional protocol on the player side — same
    // emergencyStatus shape goes out the door.
    let activeScreenOverride: any = null;
    try {
      activeScreenOverride = await (this.prisma.client as any).screenEmergencyOverride.findUnique({
        where: { screenId: screen.id },
      });
      if (activeScreenOverride?.expiresAt) {
        const exp = new Date(activeScreenOverride.expiresAt).getTime();
        if (Number.isFinite(exp) && exp < Date.now()) {
          // Expired override — treat as cleared. Don't delete here
          // (manifest endpoint should be read-only); a janitor / cron
          // can prune. Just ignore for this manifest fetch.
          activeScreenOverride = null;
        }
      }
    } catch { /* schema mismatch / missing table — fall back to tenant-wide */ }

    if (screen.tenantId) {
      // Hot-path cache: the emergency-state lookup for this tenant is
      // shared across every screen in the tenant polling manifest.
      // Cache for 2s; emergency controllers explicitly invalidate on
      // trigger/all-clear so the state propagates faster than TTL.
      let tenant = getTenantState(screen.tenantId) as any;
      if (!tenant) {
        tenant = await this.prisma.client.tenant.findUnique({
          where: { id: screen.tenantId },
          // Pull both orientation pointers so we can pick the right one
          // for this specific screen. Cast select through `any` so the
          // controller compiles even before @prisma/client picks up the
          // new emergency_portrait_playlist_id column (handled by the
          // 20260420180000_add_emergency_portrait_variants migration +
          // db:generate on next boot).
          select: {
            emergencyStatus: true,
            emergencyPlaylistId: true,
            emergencyPortraitPlaylistId: true,
            // Sprint 8b — location-based mode toggle. When false, the
            // manifest treats every screen as if it has no per-screen
            // overrides set (admin hasn't opted in yet, or has opted
            // back out — flipping the toggle off should immediately
            // restore the simpler "every screen plays the tenant
            // default" behavior without needing to wipe data).
            locationBasedEmergencyEnabled: true,
          } as any,
        }) as any;
        if (tenant) setTenantState(screen.tenantId, tenant);
      }

      // Sprint 8b — per-screen override wins over tenant-wide. If we
      // found a non-expired ScreenEmergencyOverride for this screen
      // above, treat the manifest as if an emergency is active
      // EVEN WHEN the tenant-wide status is INACTIVE. The override's
      // type becomes the surfaced emergencyStatus; its playlist (if
      // set) is preferred over the tenant default. Critical: a
      // per-screen override may also be in effect during a tenant-wide
      // alert — in that case the per-screen content trumps. e.g.,
      // tenant is in WEATHER but the gym screen carries a LOCKDOWN
      // override because of a localized incident. The gym renders
      // LOCKDOWN, every other screen renders WEATHER.
      const emergencyActiveForThisScreen =
        !!activeScreenOverride ||
        (tenant?.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE');

      if (emergencyActiveForThisScreen) {
        let playlists: any[] = [];

        // Parse the screen's stored resolution ("2160×3840" / "2160x3840")
        // to decide which playlist variant to serve. Portrait = height
        // strictly greater than width. If resolution is null or
        // unparseable we default to landscape (safe: the original
        // emergencyPlaylistId is what every tenant already has wired up).
        const isPortrait = (() => {
          const r = (screen.resolution || '').trim();
          const m = r.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
          if (!m) return false;
          return parseInt(m[2], 10) > parseInt(m[1], 10);
        })();

        // Sprint 8b — per-screen emergency content config takes
        // priority over the tenant defaults. FOUR tiers, in order:
        //   1. Per-trigger override `playlistId`  (manual incident)
        //   2. Per-screen `emergency*PlaylistId`   (config column)
        //   3. Per-screen `emergency*AssetUrl`     (single uploaded file)
        //   4. Tenant-wide `panic*PlaylistId`      (school-wide default)
        // Operator can mix-and-match: gym screens can show a custom
        // "evacuate via north exit" playlist on EVACUATE while every
        // other screen uses the tenant default — no manual trigger
        // required, configured once and forgotten.
        const screenAny = screen as any;
        const emergencyTypeKey = (activeScreenOverride?.type || tenant?.emergencyStatus || '').toUpperCase();
        // Operator can configure separate landscape + portrait variants
        // per emergency type per screen. The screen's actual physical
        // orientation (computed below from `screen.resolution`) decides
        // which set the manifest reads. We FALL BACK to the other
        // orientation if only one was configured — mirrors the tenant-
        // wide behavior where a single configured orientation covers
        // every kiosk regardless of mounting.
        const perScreenForType = ((): string | null => {
          if (isPortrait) {
            switch (emergencyTypeKey) {
              case 'LOCKDOWN': return screenAny.emergencyLockdownPortraitPlaylistId || screenAny.emergencyLockdownPlaylistId || null;
              case 'EVACUATE': return screenAny.emergencyEvacuatePortraitPlaylistId || screenAny.emergencyEvacuatePlaylistId || null;
              case 'WEATHER':  return screenAny.emergencyWeatherPortraitPlaylistId  || screenAny.emergencyWeatherPlaylistId  || null;
              case 'HOLD':     return screenAny.emergencyHoldPortraitPlaylistId     || screenAny.emergencyHoldPlaylistId     || null;
              case 'SECURE':   return screenAny.emergencySecurePortraitPlaylistId   || screenAny.emergencySecurePlaylistId   || null;
              case 'MEDICAL':  return screenAny.emergencyMedicalPortraitPlaylistId  || screenAny.emergencyMedicalPlaylistId  || null;
              default:         return null;
            }
          }
          switch (emergencyTypeKey) {
            case 'LOCKDOWN': return screenAny.emergencyLockdownPlaylistId || screenAny.emergencyLockdownPortraitPlaylistId || null;
            case 'EVACUATE': return screenAny.emergencyEvacuatePlaylistId || screenAny.emergencyEvacuatePortraitPlaylistId || null;
            case 'WEATHER':  return screenAny.emergencyWeatherPlaylistId  || screenAny.emergencyWeatherPortraitPlaylistId  || null;
            case 'HOLD':     return screenAny.emergencyHoldPlaylistId     || screenAny.emergencyHoldPortraitPlaylistId     || null;
            case 'SECURE':   return screenAny.emergencySecurePlaylistId   || screenAny.emergencySecurePortraitPlaylistId   || null;
            case 'MEDICAL':  return screenAny.emergencyMedicalPlaylistId  || screenAny.emergencyMedicalPortraitPlaylistId  || null;
            default:         return null;
          }
        })();
        const perScreenAssetForType = ((): string | null => {
          if (isPortrait) {
            switch (emergencyTypeKey) {
              case 'LOCKDOWN': return screenAny.emergencyLockdownPortraitAssetUrl || screenAny.emergencyLockdownAssetUrl || null;
              case 'EVACUATE': return screenAny.emergencyEvacuatePortraitAssetUrl || screenAny.emergencyEvacuateAssetUrl || null;
              case 'WEATHER':  return screenAny.emergencyWeatherPortraitAssetUrl  || screenAny.emergencyWeatherAssetUrl  || null;
              case 'HOLD':     return screenAny.emergencyHoldPortraitAssetUrl     || screenAny.emergencyHoldAssetUrl     || null;
              case 'SECURE':   return screenAny.emergencySecurePortraitAssetUrl   || screenAny.emergencySecureAssetUrl   || null;
              case 'MEDICAL':  return screenAny.emergencyMedicalPortraitAssetUrl  || screenAny.emergencyMedicalAssetUrl  || null;
              default:         return null;
            }
          }
          switch (emergencyTypeKey) {
            case 'LOCKDOWN': return screenAny.emergencyLockdownAssetUrl || screenAny.emergencyLockdownPortraitAssetUrl || null;
            case 'EVACUATE': return screenAny.emergencyEvacuateAssetUrl || screenAny.emergencyEvacuatePortraitAssetUrl || null;
            case 'WEATHER':  return screenAny.emergencyWeatherAssetUrl  || screenAny.emergencyWeatherPortraitAssetUrl  || null;
            case 'HOLD':     return screenAny.emergencyHoldAssetUrl     || screenAny.emergencyHoldPortraitAssetUrl     || null;
            case 'SECURE':   return screenAny.emergencySecureAssetUrl   || screenAny.emergencySecurePortraitAssetUrl   || null;
            case 'MEDICAL':  return screenAny.emergencyMedicalAssetUrl  || screenAny.emergencyMedicalPortraitAssetUrl  || null;
            default:         return null;
          }
        })();

        // Sprint 8b mode gate. Per-screen config columns (and per-screen
        // custom uploads) only matter if the tenant has opted into
        // location-based mode. The columns themselves are kept (so
        // toggling the mode back on is non-destructive), but the
        // manifest behaves like they're empty until the flag flips.
        // Per-trigger ScreenEmergencyOverride entries are ALWAYS
        // honored — those are explicit, audit-logged operator actions
        // that pre-date the per-screen-config layer and must never be
        // gated by a settings toggle.
        const locationModeOn = !!tenant?.locationBasedEmergencyEnabled;
        const effectivePerScreenPlaylist = locationModeOn ? perScreenForType : null;
        const effectivePerScreenAsset    = locationModeOn ? perScreenAssetForType : null;

        // Pick the playlist for this screen's orientation. Graceful
        // fallback in BOTH directions: a portrait screen uses the
        // landscape playlist if no portrait was configured, and
        // vice-versa.
        const chosenPlaylistId =
          activeScreenOverride?.playlistId ||                          // 1. manual trigger override (always honored)
          effectivePerScreenPlaylist ||                                 // 2. per-screen config (gated by location mode)
          (isPortrait                                                   // 3. tenant default
            ? (tenant?.emergencyPortraitPlaylistId || tenant?.emergencyPlaylistId || null)
            : (tenant?.emergencyPlaylistId || tenant?.emergencyPortraitPlaylistId || null));

        if (chosenPlaylistId) {
          const emergencyPlaylist = await this.prisma.client.playlist.findUnique({
            where: { id: chosenPlaylistId },
            include: {
              items: {
                // Sprint 1.5 approval gate. Issue #1: previously the
                // manifest delivered every item regardless of asset
                // approval state — meaning a CONTRIBUTOR's pending
                // asset reached screens before any admin approved it.
                // Filter to PUBLISHED only. Emergency assets are
                // admin-uploaded and auto-publish so this is a strict
                // tightening with no behavior change for the existing
                // admin-content path.
                where: { asset: { status: 'PUBLISHED' } },
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
                sequence: item.sequenceOrder,
                mime_type: item.asset.mimeType ?? null,
              }))
            }];
          }
        }

        // If no playlist was selected/found AND the operator uploaded a
        // single custom asset for this emergency type, synthesize a
        // one-item playlist around it. The player renders the asset
        // full-screen for the standard emergency duration. Image vs
        // video MIME is inferred from the URL extension. Gated by the
        // same location-mode toggle as the playlist column above —
        // see `effectivePerScreenAsset` for rationale.
        if (playlists.length === 0 && effectivePerScreenAsset) {
          const url = effectivePerScreenAsset;
          const ext = (url.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
          const mime =
            ['mp4','mov','webm','m4v'].includes(ext) ? `video/${ext === 'mov' ? 'quicktime' : ext}` :
            ['png','jpg','jpeg','webp','gif','svg','bmp'].includes(ext) ? `image/${ext === 'jpg' ? 'jpeg' : ext}` :
            ext === 'pdf' ? 'application/pdf' :
            null;
          playlists = [{
            id: `screen-asset-${emergencyTypeKey.toLowerCase()}`,
            name: `${emergencyTypeKey} (custom asset)`,
            items: [{
              url,
              duration_ms: 60_000,  // 60s default for a single-asset emergency loop
              sequence: 0,
              mime_type: mime,
            }],
          }];
        }

        // Effective emergency type for THIS screen — per-screen
        // override wins; falls back to the tenant-wide emergencyStatus.
        const effectiveType =
          activeScreenOverride?.type ||
          tenant?.emergencyStatus ||
          'EMERGENCY';
        const effectiveSeverity =
          activeScreenOverride?.severity ||
          tenant?.emergencyStatus ||
          'HIGH';

        // BULLETPROOF FALLBACK: If the admin failed to assign an emergency playlist or it was empty,
        // we MUST still lock the screen down to protect the school.
        // Swap template width/height for portrait screens so the TEXT
        // zone fills the full canvas correctly (1920×1080 → 1080×1920).
        // The per-screen override's textBlob (operator-typed message)
        // and scope_note land in the fallback content so the rendered
        // text matches the trigger UX exactly.
        if (playlists.length === 0) {
          const canvasW = isPortrait ? 1080 : 1920;
          const canvasH = isPortrait ? 1920 : 1080;
          // Pick the most specific text we have — operator's textBlob
          // first, then the scope_note ("Gym wing — hold position"),
          // then a SYSTEM DEFAULT message that includes the type.
          const fallbackContent =
            activeScreenOverride?.textBlob
              ? activeScreenOverride.textBlob
              : activeScreenOverride?.scopeNote
                ? `${effectiveType} — ${activeScreenOverride.scopeNote}\n\nFollow standard procedures.`
                : `EMERGENCY NOTIFICATION\n\n${effectiveType} PROTOCOL ACTIVE\n\nPlease follow standard procedures`;
          const fallbackBg =
            effectiveSeverity === 'CRITICAL' ? '#dc2626' :
            effectiveSeverity === 'HIGH'     ? '#dc2626' :
            effectiveSeverity === 'MEDIUM'   ? '#d97706' :
            '#d97706';
          playlists = [{
             id: "DEFAULT_EMERGENCY",
             name: `SYSTEM DEFAULT - ${effectiveType}`,
             template: {
               name: "EMERGENCY OVERRIDE",
               bgColor: fallbackBg,
               screenWidth: canvasW,
               screenHeight: canvasH,
               zones: [
                 {
                   id: "emergency-zone",
                   x: 0, y: 0, width: 100, height: 100, zIndex: 1,
                   widgetType: "TEXT",
                   defaultConfig: {
                     content: fallbackContent,
                     fontSize: isPortrait ? 140 : 100,
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
          // Sprint 8b — surface the active type so the player can show
          // the right banner / icon. Per-screen wins over tenant.
          emergencyType: effectiveType,
          emergencySeverity: effectiveSeverity,
          // Operator-typed scope note ("Gym — hold position") so the
          // player can render it as a sub-banner. Empty when only the
          // tenant-wide alert is active.
          emergencyScopeNote: activeScreenOverride?.scopeNote || null,
          // Tells the player whether it's running a per-screen or
          // tenant-wide override. Useful for the Stopped splash too.
          emergencyScope: activeScreenOverride ? 'screen' : 'tenant',
          orientation: isPortrait ? 'portrait' : 'landscape',
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
            // Sprint 1.5 approval gate (Issue #1). PENDING_APPROVAL
            // assets are silently dropped from the manifest so a
            // CONTRIBUTOR's submitted-but-not-yet-approved content
            // never reaches a screen. Approve flips the asset's status
            // PENDING_APPROVAL→PUBLISHED and the next manifest poll
            // includes it. All admin-uploaded assets land directly at
            // PUBLISHED so this is a strict tightening with no impact
            // on the existing admin-content flow.
            items: {
              where: { asset: { status: 'PUBLISHED' } },
              orderBy: { sequenceOrder: 'asc' },
              include: { asset: true },
            },
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

    // Sum item file sizes per playlist so the player can show operators
    // how much disk a playlist uses from the Stopped splash. Items with
    // no captured fileSize (e.g. URL-type assets, pre-hash uploads)
    // simply contribute 0.
    const dynamicPlaylists = schedules.map(s => ({
      id: s.playlistId,
      // Name + schedule metadata — lets the player surface "what's
      // loaded and when it plays" without a separate API round-trip.
      // Operator-facing fields, not load-bearing for playback, so
      // omitting any of them is safe.
      name: s.playlist.name,
      schedule: {
        daysOfWeek: s.daysOfWeek || null,  // "Mon,Tue,Wed,Thu,Fri" or null
        timeStart: s.timeStart || null,    // "08:00" or null
        timeEnd: s.timeEnd || null,        // "15:00" or null
      },
      totalBytes: s.playlist.items.reduce(
        (sum, pi) => sum + (pi.asset.fileSize || 0),
        0,
      ),
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
        sequence: pi.sequenceOrder,
        // Surface mimeType so the player knows whether to render the
        // item as <video>, <img>, or <iframe>. Without this the player
        // had to guess from the URL extension (`/\.(mp4|webm)$/i`),
        // which breaks for URL assets (text/html — no extension match
        // → silently rendered as a broken <img>) and PDF assets.
        // The Asset row always has a real mimeType set: 'text/html'
        // for URL assets via /assets/url, 'application/pdf' for PDFs,
        // 'video/*' or 'image/*' for uploads.
        mime_type: pi.asset.mimeType ?? null,
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
    //
    // 2026-04-24: Debounce the write to at-most-once-per-(screen,setHash)
    // per 15 minutes. A paired screen re-calls this every 5 minutes by
    // design; without the debounce the audit table (and the dashboard's
    // Recent Activity card) was filling with identical entries. A genuine
    // content change produces a different setHash and therefore a fresh
    // audit row, so we don't lose the forensic signal.
    try {
      if (!shouldSkipEmergencyAudit(id, setHash)) {
        markEmergencyAuditWritten(id, setHash);
        await this.prisma.client.auditLog.create({
          data: {
            action: 'DEVICE_FETCH_EMERGENCY_ASSETS',
            targetType: 'screen',
            targetId: id,
            tenantId: tenant.id,
            details: JSON.stringify({ assetCount: assets.length, setHash }),
          },
        });
      }
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
