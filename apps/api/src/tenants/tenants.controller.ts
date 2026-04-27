import { Controller, Get, Put, Post, Patch, Delete, Body, Param, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'crypto';

@Controller('api/v1/tenants')
@UseGuards(JwtAuthGuard, RbacGuard)
export class TenantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

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

  /**
   * District-only — list child schools (tenants whose parentId === current
   * district id). Includes a quick screen count per child so the UI can
   * show "Lincoln HS · 12 screens" without a second query.
   */
  @Get('children')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  async listChildren(@Request() req: any) {
    const tenantId = req.user.tenantId as string;
    const me = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, parentId: true },
    });
    if (!me) throw new HttpException('Tenant not found', HttpStatus.NOT_FOUND);
    // If the current user is on a child tenant, treat their parent as the
    // district. If they're already on the district itself, use their own id.
    const districtId = me.parentId ?? me.id;
    const children = await this.prisma.client.tenant.findMany({
      where: { parentId: districtId },
      select: {
        id: true, name: true, slug: true, createdAt: true,
        _count: { select: { screens: true, users: true } },
      },
      orderBy: { name: 'asc' },
    });
    return { districtId, children };
  }

  /**
   * District-only — create a new child school under the current district.
   * Caller must be DISTRICT_ADMIN of the parent (or SUPER_ADMIN). The new
   * tenant inherits the parent's emergency settings as defaults but is
   * otherwise independent.
   */
  @Post('children')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async createChild(
    @Request() req: any,
    @Body() body: { name?: string; slug?: string },
  ) {
    const name = (body?.name || '').trim();
    const rawSlug = (body?.slug || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    if (!name) throw new HttpException('School name is required', HttpStatus.BAD_REQUEST);
    if (!rawSlug || rawSlug.length < 2) throw new HttpException('Slug must be at least 2 characters', HttpStatus.BAD_REQUEST);

    const callerTenantId = req.user.tenantId as string;
    const callerTenant = await this.prisma.client.tenant.findUnique({
      where: { id: callerTenantId },
      select: { id: true, parentId: true, name: true },
    });
    if (!callerTenant) throw new HttpException('Caller tenant not found', HttpStatus.NOT_FOUND);
    // The district is either the caller (top-level) or its parent (if
    // they're already a child). Enforces that DISTRICT_ADMIN of a child
    // can't accidentally spawn siblings — they go to the district.
    const districtId = callerTenant.parentId ?? callerTenant.id;

    // Slug uniqueness is global across all tenants, not just per-district.
    const existing = await this.prisma.client.tenant.findUnique({ where: { slug: rawSlug } });
    if (existing) throw new HttpException('That slug is already taken', HttpStatus.CONFLICT);

    const child = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: { name, slug: rawSlug, parentId: districtId },
        select: { id: true, name: true, slug: true, parentId: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: districtId,
          userId: req.user.userId,
          action: 'CHILD_TENANT_CREATED',
          targetType: 'Tenant',
          targetId: created.id,
          details: JSON.stringify({ name, slug: rawSlug, parentTenantId: districtId }),
        },
      });
      return created;
    });

    return { success: true, child };
  }

  /**
   * Switch the caller into a different tenant they're authorized to
   * access (parent's children, or any tenant for SUPER_ADMIN). Issues
   * a NEW JWT scoped to the target tenant — without this, navigating
   * to /child-slug/dashboard leaves the old JWT in place and queries
   * still scope to the original tenant.
   *
   * Auth rules:
   *   - SUPER_ADMIN: can switch into any tenant
   *   - DISTRICT_ADMIN: can switch into their own tenant + any child of it
   *   - Other roles: 403
   *
   * The user's role is preserved on switch (DISTRICT_ADMIN of parent
   * becomes DISTRICT_ADMIN of the child). They retain full admin
   * powers in the child workspace.
   */
  @Post('switch')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async switchTenant(
    @Request() req: any,
    @Body() body: { tenantId?: string },
  ) {
    const targetId = (body?.tenantId || '').trim();
    if (!targetId) throw new HttpException('tenantId is required', HttpStatus.BAD_REQUEST);

    const role = req.user.role as string;
    const callerTenantId = req.user.tenantId as string;

    const target = await this.prisma.client.tenant.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, slug: true, parentId: true },
    });
    if (!target) throw new HttpException('Target tenant not found', HttpStatus.NOT_FOUND);

    // Authorization
    let authorized = false;
    if (role === AppRole.SUPER_ADMIN) {
      authorized = true;
    } else if (role === AppRole.DISTRICT_ADMIN) {
      // Allow if target is the caller's own tenant, the caller's parent,
      // or a sibling/child of either (covers both directions of the tree).
      const callerTenant = await this.prisma.client.tenant.findUnique({
        where: { id: callerTenantId },
        select: { id: true, parentId: true },
      });
      const districtId = callerTenant?.parentId ?? callerTenant?.id;
      authorized = target.id === districtId || target.parentId === districtId;
    }
    if (!authorized) {
      throw new HttpException('You are not authorized to switch into that tenant', HttpStatus.FORBIDDEN);
    }

    // Pull the user record so we have canTriggerPanic etc. in the new payload
    const user = await this.prisma.client.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, role: true, canTriggerPanic: true },
    });
    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: target.id,
      role: user.role,
      canTriggerPanic: user.canTriggerPanic,
    };
    const access_token = this.jwtService.sign(payload, { expiresIn: '30d' });

    // Audit: this is a privileged action; log who switched into where.
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: target.id,
        userId: user.id,
        action: 'TENANT_SWITCH',
        targetType: 'Tenant',
        targetId: target.id,
        details: JSON.stringify({ fromTenantId: callerTenantId, toTenantId: target.id, slug: target.slug }),
      },
    }).catch(() => { /* don't fail the switch on audit write */ });

    return {
      success: true,
      access_token,
      user: {
        id: user.id, email: user.email, role: user.role,
        tenantId: target.id, tenantSlug: target.slug,
        canTriggerPanic: user.canTriggerPanic,
      },
      tenant: target,
    };
  }

  /**
   * Update mutable fields on the CALLER'S tenant (not children). Currently
   * just `vertical` and `name`. DISTRICT_ADMIN + SUPER_ADMIN only.
   */
  @Patch('me')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  async updateMyTenant(
    @Request() req: any,
    @Body() body: { vertical?: string; name?: string },
  ) {
    const tenantId = req.user.tenantId;
    const data: any = {};
    if (body.vertical) {
      const v = body.vertical.toUpperCase();
      const allowed = ['K12', 'RESTAURANT', 'RETAIL', 'HEALTHCARE', 'FITNESS', 'CORPORATE', 'OTHER'];
      if (!allowed.includes(v)) throw new HttpException('Invalid vertical', HttpStatus.BAD_REQUEST);
      data.vertical = v;
    }
    if (body.name && body.name.trim()) data.name = body.name.trim();
    if (Object.keys(data).length === 0) throw new HttpException('Nothing to update', HttpStatus.BAD_REQUEST);

    const updated = await this.prisma.client.tenant.update({
      where: { id: tenantId },
      data,
      select: { id: true, name: true, slug: true, vertical: true },
    });
    await this.prisma.client.auditLog.create({
      data: {
        tenantId, userId: req.user.userId,
        action: 'TENANT_UPDATED',
        targetType: 'Tenant', targetId: tenantId,
        details: JSON.stringify(data),
      },
    }).catch(() => { /* noop */ });
    return updated;
  }

  /**
   * Delete a child tenant. SUPER_ADMIN + DISTRICT_ADMIN of the parent.
   * Refuses to delete a tenant that:
   *   - has its own children (delete those first)
   *   - has any registered screens (would orphan paired devices)
   *   - has an active emergency override (life-safety guard)
   *   - is the caller's own current tenant (would lock them out)
   * Cascades via Prisma onDelete: Cascade for things like users,
   * playlists, assets, audit logs (per schema).
   */
  @Delete('children/:id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  async deleteChild(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    if (!id) throw new HttpException('Tenant id required', HttpStatus.BAD_REQUEST);
    if (id === req.user.tenantId) {
      throw new HttpException('You cannot delete the tenant you are currently in. Switch out first.', HttpStatus.BAD_REQUEST);
    }

    const target = await this.prisma.client.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, parentId: true, emergencyStatus: true },
    });
    if (!target) throw new HttpException('Tenant not found', HttpStatus.NOT_FOUND);

    // Authorization — only SUPER_ADMIN or DISTRICT_ADMIN of the parent
    if (req.user.role !== AppRole.SUPER_ADMIN) {
      const callerTenant = await this.prisma.client.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: { id: true, parentId: true },
      });
      const districtId = callerTenant?.parentId ?? callerTenant?.id;
      if (target.parentId !== districtId) {
        throw new HttpException('You are not authorized to delete that tenant', HttpStatus.FORBIDDEN);
      }
    }

    // Safety checks
    if (target.emergencyStatus && target.emergencyStatus !== 'NORMAL' && target.emergencyStatus !== '') {
      throw new HttpException('Cannot delete a tenant with an active emergency. Clear the alert first.', HttpStatus.CONFLICT);
    }
    const [childCount, screenCount] = await Promise.all([
      this.prisma.client.tenant.count({ where: { parentId: id } }),
      this.prisma.client.screen.count({ where: { tenantId: id } }),
    ]);
    if (childCount > 0) {
      throw new HttpException(`Cannot delete: this tenant has ${childCount} child tenant(s). Delete those first.`, HttpStatus.CONFLICT);
    }
    if (screenCount > 0) {
      throw new HttpException(`Cannot delete: this tenant has ${screenCount} paired screen(s). Unpair them first or contact support to migrate.`, HttpStatus.CONFLICT);
    }

    // Audit BEFORE delete so the log entry survives the cascade
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: target.parentId || target.id,
        userId: req.user.userId,
        action: 'CHILD_TENANT_DELETED',
        targetType: 'Tenant',
        targetId: target.id,
        details: JSON.stringify({ name: target.name, slug: target.slug, parentTenantId: target.parentId }),
      },
    }).catch(() => { /* noop */ });

    await this.prisma.client.tenant.delete({ where: { id } });
    return { success: true, deletedId: id };
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
        vertical: true,
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
  // ──────────────────────────────────────────────────────────────────
  // Sprint 8b — Location-based emergency mode toggle.
  //
  // OFF (default): every screen plays the same panic content from
  // `Tenant.panic*PlaylistId`. This is the simple, opinionated path
  // every new pilot lands on.
  //
  // ON: floor-plan editor + per-screen emergency content overrides
  // become live. The manifest endpoint reads `Screen.emergency*PlaylistId`
  // and `Screen.emergency*AssetUrl` to override the tenant default per
  // screen. Toggling back OFF is non-destructive — the per-screen rows
  // are kept in case the admin re-enables, but the manifest behaves
  // as if they were null.
  //
  // Admin-only by RBAC. Audit logging of the flip is intentionally
  // light here (it's a settings toggle, not an emergency action) —
  // the manifest's behavioral change is logged at trigger time.
  // ──────────────────────────────────────────────────────────────────
  @Get('me/location-based-emergency')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getLocationBasedEmergencyConfig(@Request() req: any) {
    const t = await this.prisma.client.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { locationBasedEmergencyEnabled: true } as any,
    }) as any;
    if (!t) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return { enabled: !!t.locationBasedEmergencyEnabled };
  }

  @Put('me/location-based-emergency')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setLocationBasedEmergencyEnabled(@Request() req: any, @Body() body: { enabled: boolean }) {
    await this.prisma.client.tenant.update({
      where: { id: req.user.tenantId },
      data: { locationBasedEmergencyEnabled: !!body.enabled } as any,
    });
    return { ok: true, enabled: !!body.enabled };
  }

  // ──────────────────────────────────────────────────────────────────
  // Auto-update player toggle (2026-04-27).
  //
  // OFF (default): paired Android players are pinned at their current
  // APK version. /player/update-check returns uptoDate=true unless the
  // admin clicked "Push update" on a specific screen. Operator's exact
  // rationale: "i would hate to break a perfectly good working screen
  // with an update."
  //
  // ON: kiosks pull APK updates on their own 6h cadence. Same as the
  // pre-2026-04-27 behavior.
  //
  // Tenant-level. Admin-only. The flag is read at update-check time by
  // resolving the calling screen's tenant.
  // ──────────────────────────────────────────────────────────────────
  @Get('me/auto-update-player')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getAutoUpdatePlayerConfig(@Request() req: any) {
    const t = await this.prisma.client.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { autoUpdatePlayerEnabled: true } as any,
    }) as any;
    if (!t) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return { enabled: !!t.autoUpdatePlayerEnabled };
  }

  @Put('me/auto-update-player')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setAutoUpdatePlayerEnabled(@Request() req: any, @Body() body: { enabled: boolean }) {
    await this.prisma.client.tenant.update({
      where: { id: req.user.tenantId },
      data: { autoUpdatePlayerEnabled: !!body.enabled } as any,
    });
    return { ok: true, enabled: !!body.enabled };
  }

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
