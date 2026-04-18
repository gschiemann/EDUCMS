import { Controller, Get, Put, Post, Body, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'crypto';

@Controller('api/v1/tenants')
@UseGuards(JwtAuthGuard, RbacGuard)
export class TenantsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the list of tenants (schools) the current user is allowed to switch into.
   * - SUPER_ADMIN: all tenants
   * - DISTRICT_ADMIN: the user's district plus its child schools
   * - Others: just their own tenant
   */
  @Get('accessible')
  async listAccessible(@Request() req: any) {
    const role = req.user.role as string;
    const tenantId = req.user.tenantId as string;

    if (role === AppRole.SUPER_ADMIN) {
      const all = await this.prisma.client.tenant.findMany({
        select: { id: true, name: true, slug: true, parentId: true },
        orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      });
      return { current: tenantId, tenants: all };
    }

    if (role === AppRole.DISTRICT_ADMIN) {
      const me = await this.prisma.client.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true, parentId: true },
      });
      // District admins may belong to the district OR be represented via parent.
      const districtId = me?.parentId ?? me?.id;
      if (!districtId) return { current: tenantId, tenants: me ? [me] : [] };
      const tenants = await this.prisma.client.tenant.findMany({
        where: { OR: [{ id: districtId }, { parentId: districtId }] },
        select: { id: true, name: true, slug: true, parentId: true },
        orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      });
      return { current: tenantId, tenants };
    }

    // Single-school admins / contributors / viewers
    const me = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true, parentId: true },
    });
    return { current: tenantId, tenants: me ? [me] : [] };
  }

  @Get()
  async getTenantInfo(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        emergencyStatus: true,
        panicLockdownPlaylistId: true,
        panicWeatherPlaylistId: true,
        panicEvacuatePlaylistId: true,
      }
    });
    return tenant;
  }

  @Put('panic-settings')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async updatePanicSettings(
    @Request() req: any,
    @Body() body: {
      panicLockdownPlaylistId?: string;
      panicWeatherPlaylistId?: string;
      panicEvacuatePlaylistId?: string;
    }
  ) {
    const tenantId = req.user.tenantId;

    const updated = await this.prisma.client.tenant.update({
      where: { id: tenantId },
      data: {
        panicLockdownPlaylistId: body.panicLockdownPlaylistId || null,
        panicWeatherPlaylistId: body.panicWeatherPlaylistId || null,
        panicEvacuatePlaylistId: body.panicEvacuatePlaylistId || null,
      },
    });

    return {
      success: true,
      panicLockdownPlaylistId: updated.panicLockdownPlaylistId,
      panicWeatherPlaylistId: updated.panicWeatherPlaylistId,
      panicEvacuatePlaylistId: updated.panicEvacuatePlaylistId,
    };
  }

  // ─── USB sneakernet ingestion (Sprint 7B) ───
  // Read current USB ingest config for the calling tenant. Never returns
  // the raw HMAC key over the wire — admins must explicitly rotate to see
  // a new one (rotation is the only time the key is exposed).
  @Get('me/usb-ingest')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getUsbIngestConfig(@Request() req: any) {
    const t = await this.prisma.client.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { usbIngestEnabled: true, usbIngestKeyRotatedAt: true, usbIngestKey: true },
    });
    if (!t) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return {
      enabled: t.usbIngestEnabled,
      hasKey: !!t.usbIngestKey,
      keyRotatedAt: t.usbIngestKeyRotatedAt,
    };
  }

  @Put('me/usb-ingest')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setUsbIngestEnabled(@Request() req: any, @Body() body: { enabled: boolean }) {
    await this.prisma.client.tenant.update({
      where: { id: req.user.tenantId },
      data: { usbIngestEnabled: !!body.enabled },
    });
    return { ok: true, enabled: !!body.enabled };
  }

  // Rotate the HMAC key. Returns the new raw key in the response — this is
  // the ONLY time the admin will see it. Display once, then store nowhere
  // (admin downloads a .key file alongside the bundler CLI).
  @Post('me/usb-ingest/rotate-key')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async rotateUsbIngestKey(@Request() req: any) {
    const newKey = randomBytes(32).toString('hex');
    await this.prisma.client.tenant.update({
      where: { id: req.user.tenantId },
      data: {
        usbIngestKey: newKey,
        usbIngestKeyRotatedAt: new Date(),
      },
    });
    return {
      key: newKey,
      rotatedAt: new Date().toISOString(),
      warning: 'This key is shown ONCE. Save it now — the dashboard will never show it again. Use it with the usb-bundler CLI to sign content bundles.',
    };
  }

  // List recent USB ingest events for audit / dashboard display.
  @Get('me/usb-ingest/events')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async listUsbIngestEvents(@Request() req: any) {
    const events = await this.prisma.client.usbIngestEvent.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    // BigInt → string for JSON serialization
    return events.map(e => ({ ...e, totalBytes: e.totalBytes.toString() }));
  }

  // Public — the player POSTs here from the Android shell after every USB
  // ingest attempt. Hardened in audit fix #3:
  //   1. tenantId is derived from the trusted Screen.tenantId via the
  //      screenId in the URL — NOT from the body. Previously the body
  //      tenantId was trusted, allowing audit-log injection across tenants.
  //   2. operatorPin is SHA-256 hashed before storage; raw PINs were
  //      visible in plaintext in the audit log otherwise.
  //   3. Optional HMAC signature on the body — when present we verify it
  //      against the tenant's USB ingest key. The Android client should
  //      include `signature` (HMAC-SHA256 of canonical JSON body sans the
  //      signature field) once it knows the key; until then, the screenId
  //      derivation alone closes the IDOR.
  //   4. Rate-limited to 6 events / minute per IP — sticks plug in
  //      one-at-a-time, so anything faster is suspicious.
  @Post('me/usb-ingest/screens/:screenId/event')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async recordUsbIngestEvent(
    @Request() req: any,
    @Body() body: {
      deviceSerial?: string;
      bundleVersion?: string;
      assetCount?: number;
      totalBytes?: string;
      emergencyAssets?: boolean;
      outcome: string;
      reason?: string;
      operatorPin?: string;
      signature?: string; // hex HMAC-SHA256 (optional, forward-compat)
    },
  ) {
    const screenId = req.params?.screenId;
    if (!screenId || !body.outcome) {
      throw new HttpException('screenId and outcome required', HttpStatus.BAD_REQUEST);
    }

    const screen = await this.prisma.client.screen.findUnique({
      where: { id: screenId },
      include: {
        tenant: { select: { id: true, usbIngestEnabled: true, usbIngestKey: true } },
      },
    });
    if (!screen?.tenantId || !screen.tenant) {
      throw new HttpException('Unknown or unpaired screen', HttpStatus.NOT_FOUND);
    }
    if (!screen.tenant.usbIngestEnabled) {
      throw new HttpException('USB ingest is disabled for this tenant', HttpStatus.FORBIDDEN);
    }

    // Optional HMAC signature verification (defense-in-depth).
    if (body.signature && screen.tenant.usbIngestKey) {
      try {
        const { signature, ...payload } = body;
        const canonical = JSON.stringify(payload);
        const expected = createHmac('sha256', Buffer.from(screen.tenant.usbIngestKey, 'hex'))
          .update(canonical)
          .digest('hex');
        const a = Buffer.from(expected);
        const b = Buffer.from(signature);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          throw new HttpException('Invalid event signature', HttpStatus.FORBIDDEN);
        }
      } catch (e) {
        if (e instanceof HttpException) throw e;
        throw new HttpException('Signature verification failed', HttpStatus.FORBIDDEN);
      }
    }

    // Hash operator PIN before storage so the raw value never lands in the DB.
    const pinHash = body.operatorPin
      ? createHash('sha256').update(body.operatorPin).digest('hex')
      : null;

    await this.prisma.client.usbIngestEvent.create({
      data: {
        tenantId: screen.tenantId,           // trusted, derived from Screen lookup
        screenId,
        deviceSerial: body.deviceSerial || null,
        bundleVersion: body.bundleVersion || null,
        assetCount: body.assetCount || 0,
        totalBytes: BigInt(body.totalBytes || '0'),
        emergencyAssets: !!body.emergencyAssets,
        outcome: body.outcome,
        reason: body.reason || null,
        operatorPin: pinHash,                // SHA-256 hex of the raw PIN
      },
    });
    return { ok: true };
  }
}
