import { Controller, Get, Put, Post, Patch, Delete, Body, Param, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { isVertical, effectiveEmergencyEnabled, emergencyEnablementLocked } from '@cms/api-types';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'crypto';

@Controller('api/v1/tenants')
@UseGuards(JwtAuthGuard, RbacGuard)
export class TenantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    // ACC-05 — archiving a tenant must also END its users' live sessions.
    // RealtimeModule is @Global so this resolves without an extra import.
    private readonly redis: RedisService,
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
        where: { archivedAt: null }, // archived (retired/test) tenants hidden from the switcher
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
        where: { AND: [{ archivedAt: null }, { OR: [{ id: districtId }, { parentId: districtId }] }] },
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
    if (!me) throw new HttpException({ code: 'TENANT_NOT_FOUND', message: 'Tenant not found' }, HttpStatus.NOT_FOUND);
    // If the current user is on a child tenant, treat their parent as the
    // district. If they're already on the district itself, use their own id.
    const districtId = me.parentId ?? me.id;
    const children = await this.prisma.client.tenant.findMany({
      where: { parentId: districtId, archivedAt: null }, // archived children excluded from the locations list + count
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
    @Body() body: { name?: string; slug?: string; address?: string; latitude?: number; longitude?: number },
  ) {
    const name = (body?.name || '').trim();
    // 2026-05-25 — operator: "why even show URL Slug...we dont need
    // to show the /name at all, it just happens." Slug is now
    // ALWAYS derived from name silently; the form no longer collects
    // it. Body.slug kept as a back-compat override for cron / API
    // callers but defaulted from name otherwise.
    const rawSlug = (body?.slug || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    if (!name) throw new HttpException({ code: 'TENANT_LOCATION_NAME_REQUIRED', message: 'Location name is required' }, HttpStatus.BAD_REQUEST);
    if (!rawSlug || rawSlug.length < 2) throw new HttpException({ code: 'TENANT_SLUG_TOO_SHORT', message: 'Name must produce a slug of at least 2 characters' }, HttpStatus.BAD_REQUEST);
    // 2026-05-25 — optional address. Bounded length. If the client
    // used the AddressAutocomplete picker, lat/lng come along too
    // and we skip Sprint 8's geocoder roundtrip entirely. Bounds-
    // check the coords against world ranges so a broken payload
    // can't write garbage values. Coords only stored when BOTH
    // are present (a single coord alone is meaningless).
    const address = (body?.address || '').trim().slice(0, 500) || null;
    const lat =
      typeof body?.latitude === 'number' && body.latitude >= -90 && body.latitude <= 90
        ? body.latitude
        : null;
    const lon =
      typeof body?.longitude === 'number' && body.longitude >= -180 && body.longitude <= 180
        ? body.longitude
        : null;
    const coordsValid = lat !== null && lon !== null;

    const callerTenantId = req.user.tenantId as string;
    const callerTenant = await this.prisma.client.tenant.findUnique({
      where: { id: callerTenantId },
      select: { id: true, parentId: true, name: true, vertical: true },
    });
    if (!callerTenant) throw new HttpException({ code: 'TENANT_CALLER_NOT_FOUND', message: 'Caller tenant not found' }, HttpStatus.NOT_FOUND);
    // The district is either the caller (top-level) or its parent (if
    // they're already a child). Enforces that DISTRICT_ADMIN of a child
    // can't accidentally spawn siblings — they go to the district.
    const districtId = callerTenant.parentId ?? callerTenant.id;
    // 2026-08-31 — children INHERIT the organization's vertical. Without
    // this every "Add a gym" child defaulted to K12 and was then graded
    // against the K12 emergency set ("No content wired for: Lockdown,
    // Hold, Secure…" on a gym — the operator's screenshot). Read the
    // DISTRICT row's vertical (the caller may itself be a child).
    const districtVertical =
      districtId === callerTenant.id
        ? ((callerTenant as any).vertical as string | null)
        : (
            await this.prisma.client.tenant.findUnique({
              where: { id: districtId },
              select: { vertical: true },
            })
          )?.vertical ?? null;

    // Slug uniqueness is global across all tenants, not just per-district.
    const existing = await this.prisma.client.tenant.findUnique({ where: { slug: rawSlug } });
    if (existing) throw new HttpException({ code: 'TENANT_SLUG_TAKEN', message: 'That slug is already taken' }, HttpStatus.CONFLICT);

    const child = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name,
          slug: rawSlug,
          parentId: districtId,
          address,
          ...(districtVertical ? { vertical: districtVertical } : {}),
          ...(coordsValid ? { latitude: lat, longitude: lon } : {}),
        } as any,
        select: { id: true, name: true, slug: true, parentId: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: districtId,
          userId: req.user.userId,
          action: 'CHILD_TENANT_CREATED',
          targetType: 'Tenant',
          targetId: created.id,
          // Audit records WHICH fields were provided (hasAddress)
          // but not the raw address itself (PII).
          details: JSON.stringify({ name, slug: rawSlug, parentTenantId: districtId, hasAddress: !!address, hasCoords: coordsValid }),
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
    if (!targetId) throw new HttpException({ code: 'TENANT_ID_REQUIRED', message: 'tenantId is required' }, HttpStatus.BAD_REQUEST);

    const role = req.user.role as string;
    const callerTenantId = req.user.tenantId as string;

    const target = await this.prisma.client.tenant.findUnique({
      where: { id: targetId },
      // `vertical` is REQUIRED here: the returned user object carries
      // tenantVertical, which the dashboard's useTenantCopy reads to pick
      // the industry-aware UI. Omitting it (the pre-2026-06-01 bug) made
      // EVERY account switch reset the displayed industry to the K12
      // ("school") default, because the client stored a user with no
      // vertical. Mirror the login response shape exactly.
      select: { id: true, name: true, slug: true, parentId: true, vertical: true },
    });
    if (!target) throw new HttpException({ code: 'TENANT_TARGET_NOT_FOUND', message: 'Target tenant not found' }, HttpStatus.NOT_FOUND);

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
      throw new HttpException({ code: 'TENANT_SWITCH_NOT_AUTHORIZED', message: 'You are not authorized to switch into that tenant' }, HttpStatus.FORBIDDEN);
    }

    // Pull the user record so we have canTriggerPanic etc. in the new payload
    // ten-ok: identity SELF-lookup — id is the authenticated JWT principal building its own switch payload
    const user = await this.prisma.client.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, role: true, canTriggerPanic: true },
    });
    if (!user) throw new HttpException({ code: 'TENANT_USER_NOT_FOUND', message: 'User not found' }, HttpStatus.NOT_FOUND);

    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: target.id,
      role: user.role,
      canTriggerPanic: user.canTriggerPanic,
    };
    // ── ACC-07 (2026-08-01) — a tenant switch must not EXTEND the session ──
    // This unconditionally signed a 30-DAY token. A user who logged in
    // WITHOUT "remember me" holds a 1-hour session (auth.module signOptions),
    // and one click of the workspace switcher — a navigation action, not an
    // authentication one — silently upgraded it to the 30-day rememberMe
    // ceiling. On a shared district workstation that turns "I closed the tab"
    // into a month-long live credential, and it made the rememberMe policy
    // trivially bypassable. The replacement token now expires no later than
    // the one that authorized it: switching workspaces changes SCOPE, never
    // LIFETIME. (A floor of 60s keeps a switch made in the last seconds of a
    // session from handing back an already-dead token.)
    const nowSec = Math.floor(Date.now() / 1000);
    const currentExp = typeof req.user?.tokenExp === 'number' ? req.user.tokenExp : null;
    const remainingSec = currentExp !== null ? currentExp - nowSec : null;
    // ── Trust-wave D hardening (2026-08-09) — the ANCHOR rides through too ──
    // A switch-minted token used to omit `origIat`; POST /auth/refresh then
    // anchored its sliding cap at that token's own iat, so one click of
    // switch-to-HOME re-anchored the 12h/30d ceiling — a stolen token could
    // slide forever by re-switching. Same principle as ACC-07 above: a switch
    // changes SCOPE — never LIFETIME, and never the refresh ANCHOR. origIat
    // (and the rememberMe class marker) carry forward unchanged from the
    // token that authorized the switch; absent both (legacy token), the
    // incoming token's iat is the honest anchor — never "now".
    const [, priorRawToken] = req.headers?.authorization?.split(' ') ?? [];
    const prior = (priorRawToken ? this.jwtService.decode(priorRawToken) : null) as
      | Record<string, unknown>
      | null;
    const priorOrigIat =
      typeof prior?.origIat === 'number'
        ? prior.origIat
        : typeof prior?.iat === 'number'
          ? prior.iat
          : nowSec;
    const access_token = this.jwtService.sign(
      { ...payload, origIat: priorOrigIat, ...(prior?.rm === true ? { rm: true } : {}) },
      // No `exp` on the incoming token (shouldn't happen — every issuer sets
      // one) → fall back to the module default rather than inventing 30 days.
      remainingSec !== null ? { expiresIn: Math.max(60, remainingSec) } : undefined,
    );

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
        // 2026-06-01 — carry the TARGET tenant's industry + name so a
        // switch keeps the vertical-aware UI on the account you switched
        // INTO (was missing → every switch fell back to K12/"school").
        // Raw value; the client (useTenantCopy → normalizeVertical) maps
        // legacy aliases + falls back to K12 only for unknown.
        tenantVertical: (target as any).vertical || 'K12',
        tenantName: target.name ?? null,
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
    @Body() body: { vertical?: string; name?: string; address?: string | null; latitude?: number; longitude?: number },
  ) {
    const tenantId = req.user.tenantId;
    const data: any = {};
    if (body.vertical) {
      const v = body.vertical.toUpperCase();
      // Validated against the canonical VERTICALS list
      // (packages/api-types/src/verticals.ts) — single source of truth.
      if (!isVertical(v)) throw new HttpException({ code: 'TENANT_VERTICAL_INVALID', message: 'Invalid vertical' }, HttpStatus.BAD_REQUEST);
      data.vertical = v;
    }
    if (body.name && body.name.trim()) data.name = body.name.trim();
    // 2026-05-25 — address editable here. Empty string explicitly
    // clears the field (operator might want to remove a wrong
    // address); null is also treated as "clear." A NON-empty trimmed
    // string overwrites. Anything outside those branches (e.g. the
    // body field absent entirely) leaves the column untouched.
    if (body.address !== undefined) {
      const trimmed = (body.address ?? '').trim().slice(0, 500);
      data.address = trimmed || null;
      // Whenever address changes we MUST invalidate the cached
      // lat/lng — Sprint 8's geocoder will re-run on the new value.
      // Without this, an operator who corrects "123 Main St" → "456
      // Oak St" would keep the old coords until manual refresh.
      data.latitude = null;
      data.longitude = null;
    }
    // 2026-05-25 — when the client used AddressAutocomplete it sends
    // lat/lng alongside the address. These OVERWRITE the null-out
    // above (since they're for the new address). Bounds-checked
    // against world ranges. Skipped if address change wasn't part
    // of this PATCH (lat/lng without an address change is also
    // accepted — operator might manually correct coords without
    // changing the string).
    if (typeof body.latitude === 'number' && body.latitude >= -90 && body.latitude <= 90) {
      data.latitude = body.latitude;
    }
    if (typeof body.longitude === 'number' && body.longitude >= -180 && body.longitude <= 180) {
      data.longitude = body.longitude;
    }
    if (Object.keys(data).length === 0) throw new HttpException({ code: 'TENANT_NOTHING_TO_UPDATE', message: 'Nothing to update' }, HttpStatus.BAD_REQUEST);

    const updated = await this.prisma.client.tenant.update({
      where: { id: tenantId },
      data,
      select: { id: true, name: true, slug: true, vertical: true, address: true } as any,
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
    if (!id) throw new HttpException({ code: 'TENANT_ID_REQUIRED', message: 'Tenant id required' }, HttpStatus.BAD_REQUEST);
    if (id === req.user.tenantId) {
      throw new HttpException({ code: 'TENANT_CANNOT_DELETE_CURRENT', message: 'You cannot delete the tenant you are currently in. Switch out first.' }, HttpStatus.BAD_REQUEST);
    }

    const target = await this.prisma.client.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, parentId: true, emergencyStatus: true },
    });
    if (!target) throw new HttpException({ code: 'TENANT_NOT_FOUND', message: 'Tenant not found' }, HttpStatus.NOT_FOUND);

    // Authorization — only SUPER_ADMIN or DISTRICT_ADMIN of the parent
    if (req.user.role !== AppRole.SUPER_ADMIN) {
      const callerTenant = await this.prisma.client.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: { id: true, parentId: true },
      });
      const districtId = callerTenant?.parentId ?? callerTenant?.id;
      if (target.parentId !== districtId) {
        throw new HttpException({ code: 'TENANT_DELETE_NOT_AUTHORIZED', message: 'You are not authorized to delete that tenant' }, HttpStatus.FORBIDDEN);
      }
    }

    // Safety checks
    // 2026-07-21 (functional depth audit) — the guard used to treat anything
    // other than 'NORMAL'/'' as an active emergency, but the fleet's at-rest
    // value is 'INACTIVE' (all-clear writes it; every calm tenant carries it)
    // — so EVERY tenant 409'd as "active emergency" and location deletion
    // NEVER worked, with an alarming false message. Calm set below; anything
    // else is a real severity written by the trigger path (e.g. CRITICAL).
    const CALM_EMERGENCY_STATUSES = ['', 'NORMAL', 'INACTIVE'];
    if (target.emergencyStatus && !CALM_EMERGENCY_STATUSES.includes(target.emergencyStatus)) {
      throw new HttpException({ code: 'TENANT_DELETE_ACTIVE_EMERGENCY', message: 'Cannot delete a tenant with an active emergency. Clear the alert first.' }, HttpStatus.CONFLICT);
    }
    const [childCount, screenCount] = await Promise.all([
      this.prisma.client.tenant.count({ where: { parentId: id } }),
      this.prisma.client.screen.count({ where: { tenantId: id } }),
    ]);
    if (childCount > 0) {
      throw new HttpException({ code: 'TENANT_DELETE_HAS_CHILDREN', message: `Cannot delete: this tenant has ${childCount} child tenant(s). Delete those first.` }, HttpStatus.CONFLICT);
    }
    if (screenCount > 0) {
      throw new HttpException({ code: 'TENANT_DELETE_HAS_SCREENS', message: `Cannot delete: this tenant has ${screenCount} paired screen(s). Unpair them first or contact support to migrate.` }, HttpStatus.CONFLICT);
    }

    // Audit + delete ATOMICALLY. Previously the audit write was
    // `.catch(() => {})` and the delete ran regardless — so if the audit
    // insert failed, an entire tenant (users, assets, playlists, screens)
    // was destroyed with NO record. Now both run in one transaction: if the
    // audit can't be written, the delete rolls back and nothing is lost.
    // The audit is scoped to the PARENT tenant (when present) so it survives
    // the child's cascade delete.
    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.auditLog.create({
          data: {
            tenantId: target.parentId || target.id,
            userId: req.user.userId,
            action: 'CHILD_TENANT_DELETED',
            targetType: 'Tenant',
            targetId: target.id,
            details: JSON.stringify({ name: target.name, slug: target.slug, parentTenantId: target.parentId }),
          },
        });
        await tx.tenant.delete({ where: { id } });
      });
    } catch (e: any) {
      // 2026-07-21 (functional depth audit) — a tenant that has EVER done an
      // audited action carries audit_logs rows that are FK-RESTRICT'd AND
      // protected by the DB-level immutability trigger (§16 — never weaken).
      // Hard delete is therefore architecturally impossible for any tenant
      // with history; the old behavior surfaced that as an opaque 500
      // DATABASE_ERROR. Be honest instead. The real product answer is
      // archive/soft-delete (same precedent as user soft-delete, which hit
      // this exact wall) — tracked as a follow-up.
      if (e?.code === 'P2003') {
        throw new HttpException({
          code: 'TENANT_DELETE_HAS_HISTORY',
          message: 'This location has activity history (audit records) that is retained for compliance, so it cannot be permanently deleted. Location archiving is the supported path — contact support if you need this location hidden.',
        }, HttpStatus.CONFLICT);
      }
      throw e;
    }
    return { success: true, deletedId: id };
  }

  // ── Tenant archive (soft-delete) ──────────────────────────────────────
  // Hard delete is architecturally impossible for any tenant with audit
  // history (audit_logs FK RESTRICT + §16 immutability trigger). Archiving is
  // the supported retire/cleanup path: it's REVERSIBLE (unarchive), sets
  // archived_at, and every fleet/list/count/cascade query filters archivedAt:
  // null — so an archived location stops making a parent read as multi-location
  // "HQ" (the map goes away) and drops out of the switcher, without a data wipe.
  private readonly CALM_EMERGENCY = ['', 'NORMAL', 'INACTIVE'];

  private async setArchived(reqUser: any, id: string, archived: boolean) {
    if (!id) throw new HttpException({ code: 'TENANT_ID_REQUIRED', message: 'Tenant id required' }, HttpStatus.BAD_REQUEST);
    if (id === reqUser.tenantId) {
      throw new HttpException({ code: 'TENANT_CANNOT_ARCHIVE_CURRENT', message: 'You cannot archive the tenant you are currently in. Switch out first.' }, HttpStatus.BAD_REQUEST);
    }
    const target = await this.prisma.client.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, parentId: true, emergencyStatus: true, archivedAt: true },
    });
    if (!target) throw new HttpException({ code: 'TENANT_NOT_FOUND', message: 'Tenant not found' }, HttpStatus.NOT_FOUND);
    // Scope (2026-08-30 — operator: "once I add a location I have no way to
    // delete it"): DISTRICT_ADMIN may archive/unarchive ONLY a direct child
    // of their own tenant. SUPER_ADMIN keeps the global reach. Never
    // cross-district, never self (guarded above), never an unrelated id.
    if (reqUser.role !== 'SUPER_ADMIN' && target.parentId !== reqUser.tenantId) {
      throw new HttpException(
        { code: 'TENANT_ARCHIVE_FORBIDDEN', message: 'You can only remove locations that belong to your organization.' },
        HttpStatus.FORBIDDEN,
      );
    }
    // Never archive a tenant mid-emergency (would hide an active life-safety
    // surface). Only a real severity blocks it; the at-rest 'INACTIVE' is calm.
    if (archived && target.emergencyStatus && !this.CALM_EMERGENCY.includes(target.emergencyStatus)) {
      throw new HttpException({ code: 'TENANT_ARCHIVE_ACTIVE_EMERGENCY', message: 'Cannot archive a tenant with an active emergency. Clear the alert first.' }, HttpStatus.CONFLICT);
    }
    // Audit + flip atomically. Audit is scoped to the PARENT when present so it
    // survives independent of the (now-hidden) child.
    await this.prisma.client.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: target.parentId || target.id,
          userId: reqUser.userId,
          action: archived ? 'TENANT_ARCHIVED' : 'TENANT_UNARCHIVED',
          targetType: 'Tenant',
          targetId: target.id,
          details: JSON.stringify({ name: target.name, slug: target.slug, parentTenantId: target.parentId }),
        },
      });
      await tx.tenant.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    });

    // ── ACC-05 (2026-08-01) — archiving must END the tenant's sessions ─────
    // Archiving was a DISPLAY-layer change only: the tenant vanished from
    // lists and maps while every one of its users kept logging in normally,
    // and an admin among them could still fire /emergency/trigger at real
    // screens belonging to a "retired" location. Blocking LOGIN (AuthService
    // + SsoService) closes the front door, but a token already issued stays
    // valid for up to 30 days — so archiving also revokes every live session
    // for the tenant's users, using the same per-user invalid-before marker
    // the role-downgrade path uses.
    //
    // Best-effort per user: archiving is an admin housekeeping action and
    // must not 500 because one Redis write failed. Failures are counted and
    // returned so the operator sees a partial outcome instead of a false
    // "done", and the runtime backstop in JwtAuthGuard still refuses
    // emergency actions from an archived tenant either way.
    let sessionsRevoked = 0;
    let sessionRevocationFailures = 0;
    if (archived) {
      const members = await this.prisma.client.user.findMany({
        where: { tenantId: id },
        select: { id: true },
      });
      for (const m of members) {
        try {
          await this.redis.markUserTokensInvalid(m.id);
          sessionsRevoked += 1;
        } catch {
          sessionRevocationFailures += 1;
        }
      }
      if (sessionRevocationFailures > 0) {
        console.warn(
          `[Tenants] archive ${id}: ${sessionRevocationFailures}/${members.length} session ` +
            `revocations failed; those tokens remain valid until they expire.`,
        );
      }
    }

    return { success: true, id, archived, sessionsRevoked, sessionRevocationFailures };
  }

  // DISTRICT_ADMIN allowed 2026-08-30 (direct children only — enforced in
  // setArchived). The UI affordance lives on the settings locations card.
  @Post(':id/archive')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  async archiveTenant(@Request() req: any, @Param('id') id: string) {
    return this.setArchived(req.user, id, true);
  }

  @Post(':id/unarchive')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  async unarchiveTenant(@Request() req: any, @Param('id') id: string) {
    return this.setArchived(req.user, id, false);
  }

  // Bulk archive — SUPER_ADMIN cleanup of a reviewed id list. Per-id failures
  // (emergency / current / not-found) are collected, never aborting the batch.
  @Post('archive-bulk')
  @RequireRoles(AppRole.SUPER_ADMIN)
  async archiveBulk(@Request() req: any, @Body() body: { ids?: string[] }) {
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
    if (!ids.length) throw new HttpException({ code: 'TENANT_IDS_REQUIRED', message: 'ids[] required' }, HttpStatus.BAD_REQUEST);
    const archived: string[] = [];
    const skipped: Array<{ id: string; code: string }> = [];
    for (const id of ids) {
      try { await this.setArchived(req.user, id, true); archived.push(id); }
      catch (e: any) { skipped.push({ id, code: e?.response?.code || e?.code || 'ERROR' }); }
    }
    return { success: true, archivedCount: archived.length, archived, skipped };
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
        // 2026-08-31 — child-location Fleet Command: the dashboard decides
        // "is this a child location?" from parentId (a child gets the same
        // command surface scoped to itself; a standalone leaf org keeps the
        // classic dashboard).
        parentId: true,
        vertical: true,
        // 2026-05-25 — expose address (+ future lat/lng) on the
        // current-tenant info endpoint so the edit-location UI
        // can prefill what's already stored.
        address: true,
        latitude: true,
        longitude: true,
        emergencyStatus: true,
        panicLockdownPlaylistId: true,
        panicWeatherPlaylistId: true,
        panicEvacuatePlaylistId: true,
        // Org-wide "require approval before content goes live" gate. Exposed
        // here so the settings page can render the current toggle state.
        requireContentApproval: true,
        // 2026-09-01 — standard LED poster module size (one panel). NULL on
        // both means "the built-in default" (DEFAULT_POSTER_STANDARD below);
        // the dashboard's LED-canvas picker and the settings card both read
        // it from here rather than from a second endpoint.
        posterStandardW: true,
        posterStandardH: true,
        // 2026-09-01 — emergency capability enablement. The RAW column is
        // nullable ("never stated"); `emergencyEnabledEffective` below is the
        // resolved answer the dashboard renders. Both ship because the
        // Settings editor has to distinguish "explicitly off" from "riding
        // the vertical default" (handoff §9.3 inheritance states).
        emergencyEnabled: true,
      } as any,
    });
    if (!tenant) return tenant;
    const row = tenant as any;
    return {
      ...row,
      emergencyEnabledEffective: effectiveEmergencyEnabled(row.vertical, row.emergencyEnabled),
      /** True for verticals that may never turn the capability off (K–12). */
      emergencyEnabledLocked: emergencyEnablementLocked(row.vertical),
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Emergency capability enablement (2026-09-01, handoff §19.5).
  //
  // Replaces the browser-localStorage gate `emergencyEnabled:${tenantId}`,
  // which was per-device, per-profile and invisible to the server — two
  // admins in the same organization could see opposite answers about a
  // life-safety capability, and clearing a cache silently "turned it off".
  //
  // SCOPE: configuration only. This flag does NOT gate
  // POST /emergency/trigger or /all-clear, and it is NOT in the screen
  // manifest — nothing on the player path reads it, so nothing on the
  // player path changes. It decides whether the dashboard presents the
  // emergency configuration surface as an enabled capability.
  //
  // K–12 IS LOCKED ON. A school may not turn the capability off; the
  // request is refused with a message that says so rather than silently
  // succeeding or silently no-op'ing.
  // ──────────────────────────────────────────────────────────────────
  @Put('me/emergency-enabled')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setEmergencyEnabled(@Request() req: any, @Body() body: { enabled?: boolean }) {
    const tenantId = req.user.tenantId as string;
    const enabled = !!body?.enabled;

    const current = (await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { vertical: true, emergencyEnabled: true } as any,
    })) as any;
    if (!current) {
      throw new HttpException(
        { code: 'TENANT_NOT_FOUND', message: 'Tenant not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (!enabled && emergencyEnablementLocked(current.vertical)) {
      throw new HttpException(
        {
          code: 'EMERGENCY_ENABLEMENT_LOCKED',
          message:
            'Emergency alerts stay on for K-12 organizations and cannot be turned off. Change the organization industry first if this is not a school.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // Update + immutable audit row in one transaction — the same shape the
    // other emergency-adjacent tenant mutations use. Details carry the
    // previous/next value only; no secrets (handoff §19.6).
    const previousEffective = effectiveEmergencyEnabled(current.vertical, current.emergencyEnabled);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const t = (await tx.tenant.update({
        where: { id: tenantId },
        data: { emergencyEnabled: enabled } as any,
        select: { vertical: true, emergencyEnabled: true } as any,
      })) as any;
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req.user.userId,
          action: 'EMERGENCY_ENABLED_CHANGED',
          targetType: 'Tenant',
          targetId: tenantId,
          details: JSON.stringify({
            scopeType: 'organization',
            scopeId: tenantId,
            changedFields: ['emergencyEnabled'],
            previous: { emergencyEnabled: current.emergencyEnabled ?? null, effective: previousEffective },
            next: { emergencyEnabled: enabled, effective: enabled },
          }),
        },
      });
      return t;
    });

    // Re-read authoritative state and return it — the editor shows success
    // only after the server confirms (§13.2, no optimistic success).
    return {
      ok: true,
      emergencyEnabled: updated.emergencyEnabled ?? null,
      emergencyEnabledEffective: effectiveEmergencyEnabled(updated.vertical, updated.emergencyEnabled),
      emergencyEnabledLocked: emergencyEnablementLocked(updated.vertical),
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Standard LED poster size (2026-09-01).
  //
  // A NovaStar TB poster CANNOT report its own LED module size — the
  // controller only knows its output raster, not how many millimetres of
  // pitch are bolted in front of it. So the operator states it once, per
  // tenant, and every poster in that org inherits it until a screen sets
  // its own canvas. The stock 1.86 mm poster is 320×1080; a 1.56 mm one is
  // ~360×1200; both are in the fleet, hence the setting.
  //
  // NULL/NULL is a real value, not "unset-and-broken": it means "use the
  // built-in default", so an org that never opens this card behaves exactly
  // as it did before this shipped.
  //
  // Scope: the caller's OWN tenant only (`me` is accepted as an alias for
  // it). Any other id — including a sibling school, and including one a
  // SUPER_ADMIN could otherwise reach — is a 404, matching the panic-settings
  // rule that a tenant setting is written from INSIDE that tenant.
  // ──────────────────────────────────────────────────────────────────
  static readonly POSTER_STANDARD_MIN = 32;
  static readonly POSTER_STANDARD_MAX = 8192;

  @Put(':id/poster-standard')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setPosterStandard(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { w?: number | null; h?: number | null },
  ) {
    const tenantId = req.user.tenantId as string;
    if (id !== 'me' && id !== tenantId) {
      throw new HttpException(
        { code: 'TENANT_NOT_FOUND', message: 'Tenant not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    const rawW = body?.w ?? null;
    const rawH = body?.h ?? null;
    let w: number | null = null;
    let h: number | null = null;
    // Both null = clear to the built-in default. Anything else must be a
    // COMPLETE pair — a half-set standard (width only) would silently pair a
    // custom width with a default height on every poster in the org.
    if (rawW !== null || rawH !== null) {
      const min = TenantsController.POSTER_STANDARD_MIN;
      const max = TenantsController.POSTER_STANDARD_MAX;
      const ok = (v: unknown): v is number =>
        typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
      if (!ok(rawW) || !ok(rawH)) {
        throw new HttpException(
          {
            code: 'TENANT_POSTER_STANDARD_INVALID',
            message: `w and h must both be integers between ${min} and ${max}, or both null to reset to the default.`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      w = rawW;
      h = rawH;
    }

    const before = (await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { posterStandardW: true, posterStandardH: true } as any,
    })) as any;
    if (!before) {
      throw new HttpException(
        { code: 'TENANT_NOT_FOUND', message: 'Tenant not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    // Write + immutable audit row in one transaction, through prisma.client
    // (never raw SQL) so the per-screen manifest hot cache busts on the write.
    const updated = (await this.prisma.client.$transaction(async (tx) => {
      const t = (await tx.tenant.update({
        where: { id: tenantId },
        data: { posterStandardW: w, posterStandardH: h } as any,
        select: { posterStandardW: true, posterStandardH: true } as any,
      })) as any;
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req.user.userId,
          action: 'TENANT_POSTER_STANDARD_CHANGED',
          targetType: 'Tenant',
          targetId: tenantId,
          details: JSON.stringify({
            from: { w: before.posterStandardW ?? null, h: before.posterStandardH ?? null },
            to: { w, h },
          }),
        },
      });
      return t;
    })) as any;

    return {
      success: true,
      posterStandardW: updated.posterStandardW ?? null,
      posterStandardH: updated.posterStandardH ?? null,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Org-wide "Require approval before any content goes live" gate
  // (Appspace-parity enterprise control, 2026-06-26).
  //
  // OFF (default): a CONTRIBUTOR can stage + send content for review via
  // the explicit "Send for review" flow, but nothing forces it — single-
  // operator tenants keep today's behavior.
  //
  // ON: every CONTRIBUTOR publish/schedule is routed through the existing
  // submit-for-review queue instead of going live directly (enforced in
  // schedules.controller.ts). Admins bypass — they ARE the approvers.
  //
  // The flag itself is settable ONLY by DISTRICT_ADMIN / SUPER_ADMIN
  // (SCHOOL_ADMIN can read but not flip — it's an org-wide policy). Every
  // change writes an immutable AuditLog row.
  // ──────────────────────────────────────────────────────────────────
  @Get('me/content-approval')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getContentApprovalConfig(@Request() req: any) {
    const t = await this.prisma.client.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { requireContentApproval: true } as any,
    }) as any;
    if (!t) throw new HttpException({ code: 'TENANT_CONTENT_APPROVAL_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    return { enabled: !!t.requireContentApproval };
  }

  @Put('me/content-approval')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  async setContentApprovalEnabled(@Request() req: any, @Body() body: { enabled?: boolean }) {
    const enabled = !!body?.enabled;
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id: req.user.tenantId },
        data: { requireContentApproval: enabled } as any,
        select: { requireContentApproval: true } as any,
      }) as any;
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          // Match the rest of this controller — req.user.userId is the
          // canonical id field on the JWT payload.
          userId: req.user.userId,
          action: 'tenant.content_approval.toggled',
          targetType: 'Tenant',
          targetId: req.user.tenantId,
          details: JSON.stringify({ enabled }),
        },
      });
      return t;
    });
    return { ok: true, enabled: !!updated.requireContentApproval };
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

    // SECURITY (lane-2 P0): verify every referenced playlist belongs to the
    // caller's tenant. Without this a SCHOOL_ADMIN could paste another tenant's
    // playlist UUID, and on the next panic trigger the foreign content would
    // render on every screen in this tenant. Life-safety regression.
    const candidates = [
      body.panicLockdownPlaylistId,
      body.panicWeatherPlaylistId,
      body.panicEvacuatePlaylistId,
    ].filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (candidates.length > 0) {
      const owned = await this.prisma.client.playlist.findMany({
        where: { id: { in: candidates }, tenantId },
        select: { id: true },
      });
      const ownedSet = new Set(owned.map((p) => p.id));
      const foreign = candidates.filter((id) => !ownedSet.has(id));
      if (foreign.length > 0) {
        throw new HttpException({ code: 'TENANT_PANIC_PLAYLIST_NOT_FOUND', message: `Playlist(s) not found in this tenant: ${foreign.join(', ')}` }, HttpStatus.NOT_FOUND);
      }
    }

    // Update + immutable audit row in one transaction (matches the pattern
    // used by every other emergency-adjacent mutation in this codebase).
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          panicLockdownPlaylistId: body.panicLockdownPlaylistId || null,
          panicWeatherPlaylistId: body.panicWeatherPlaylistId || null,
          panicEvacuatePlaylistId: body.panicEvacuatePlaylistId || null,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req.user.userId,
          action: 'PANIC_SETTINGS_UPDATED',
          targetType: 'Tenant',
          targetId: tenantId,
          details: JSON.stringify({
            panicLockdownPlaylistId: body.panicLockdownPlaylistId || null,
            panicWeatherPlaylistId: body.panicWeatherPlaylistId || null,
            panicEvacuatePlaylistId: body.panicEvacuatePlaylistId || null,
          }),
        },
      });
      return t;
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
    if (!t) throw new HttpException({ code: 'TENANT_LOCATION_EMERGENCY_CONFIG_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    return { enabled: !!t.locationBasedEmergencyEnabled };
  }

  @Put('me/location-based-emergency')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setLocationBasedEmergencyEnabled(@Request() req: any, @Body() body: { enabled: boolean }) {
    // AUDIT (2026-09-08): this changes WHICH SCREENS a lockdown reaches. After
    // an incident, "was location scoping on at the time" is a question the
    // forensic record has to answer on its own — the flag's current value
    // cannot answer it retroactively.
    await this.prisma.client.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: req.user.tenantId },
        data: { locationBasedEmergencyEnabled: !!body.enabled } as any,
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user.userId,
          action: 'LOCATION_BASED_EMERGENCY_TOGGLED',
          targetType: 'Tenant',
          targetId: req.user.tenantId,
          details: JSON.stringify({ enabled: !!body.enabled }),
        },
      });
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
    if (!t) throw new HttpException({ code: 'TENANT_AUTO_UPDATE_CONFIG_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
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

  // Sprint 11 Phase A — OTA maintenance window.
  // Tenant configures the daily window when APK installs are allowed
  // to APPLY. Outside the window the kiosk still downloads in the
  // background but defers the install until the window opens.
  @Get('me/ota-window')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getOtaWindow(@Request() req: any) {
    const t = await this.prisma.client.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: {
        otaWindowStart: true,
        otaWindowEnd: true,
        otaWindowTimezone: true,
      } as any,
    }) as any;
    if (!t) throw new HttpException({ code: 'TENANT_OTA_WINDOW_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    return {
      start: t.otaWindowStart ?? null,
      end: t.otaWindowEnd ?? null,
      timezone: t.otaWindowTimezone ?? null,
    };
  }

  @Put('me/ota-window')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setOtaWindow(
    @Request() req: any,
    @Body() body: { start?: string | null; end?: string | null; timezone?: string | null },
  ) {
    // Allow clearing the window by sending {start:null,end:null,timezone:null}
    // (or omitting fields). Allow setting all three.
    const start = body.start === undefined ? undefined : (body.start || null);
    const end = body.end === undefined ? undefined : (body.end || null);
    const timezone = body.timezone === undefined ? undefined : (body.timezone || null);

    // Validate HH:MM format when set
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (start && !hhmm.test(start)) {
      throw new HttpException({ code: 'TENANT_OTA_WINDOW_START_INVALID', message: `Invalid start "${start}" — expected HH:MM` }, HttpStatus.BAD_REQUEST);
    }
    if (end && !hhmm.test(end)) {
      throw new HttpException({ code: 'TENANT_OTA_WINDOW_END_INVALID', message: `Invalid end "${end}" — expected HH:MM` }, HttpStatus.BAD_REQUEST);
    }
    // Validate timezone via Intl
    if (timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      } catch {
        throw new HttpException({ code: 'TENANT_OTA_WINDOW_TIMEZONE_INVALID', message: `Invalid timezone "${timezone}"` }, HttpStatus.BAD_REQUEST);
      }
    }

    const data: any = {};
    if (start !== undefined) data.otaWindowStart = start;
    if (end !== undefined) data.otaWindowEnd = end;
    if (timezone !== undefined) data.otaWindowTimezone = timezone;

    const updated = await this.prisma.client.tenant.update({
      where: { id: req.user.tenantId },
      data,
      select: {
        otaWindowStart: true,
        otaWindowEnd: true,
        otaWindowTimezone: true,
      } as any,
    }) as any;

    await this.prisma.client.auditLog.create({
      data: {
        action: 'OTA_WINDOW_UPDATED',
        targetType: 'tenant',
        targetId: req.user.tenantId,
        tenantId: req.user.tenantId,
        userId: req.user.id,
        details: JSON.stringify({
          start: updated.otaWindowStart,
          end: updated.otaWindowEnd,
          timezone: updated.otaWindowTimezone,
        }),
      },
    }).catch(() => { /* audit best-effort */ });

    return {
      start: updated.otaWindowStart ?? null,
      end: updated.otaWindowEnd ?? null,
      timezone: updated.otaWindowTimezone ?? null,
    };
  }

  // ─── Sprint 11 Phase B — staged canary rollout ──────────────
  // Get / set the tenant's canary fleet percentage.
  //
  // canaryFleetPercent < 100 means only the hash-deterministic cohort
  // of screens is eligible for the latest APK. Combined with the
  // canarySoakHours timer + canaryAutoPromote flag, a cron will
  // auto-bump back to 100 once the soak elapses without install
  // errors — at which point the full fleet picks up the update.
  //
  // Setting percent to a lower value (e.g. dropping 100 → 10) stamps
  // canarySetAt so the soak timer starts. Setting percent back to
  // 100 manually clears canarySetAt.
  @Get('me/canary-rollout')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getCanaryRollout(@Request() req: any) {
    const t = await this.prisma.client.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: {
        canaryFleetPercent: true,
        canarySetAt: true,
        canaryAutoPromote: true,
        canarySoakHours: true,
      } as any,
    }) as any;
    if (!t) throw new HttpException({ code: 'TENANT_CANARY_ROLLOUT_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    return {
      percent: t.canaryFleetPercent ?? 100,
      setAt: t.canarySetAt ?? null,
      autoPromote: t.canaryAutoPromote ?? true,
      soakHours: t.canarySoakHours ?? 24,
    };
  }

  @Put('me/canary-rollout')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setCanaryRollout(
    @Request() req: any,
    @Body() body: {
      percent?: number;
      autoPromote?: boolean;
      soakHours?: number;
    },
  ) {
    const data: any = {};

    if (body.percent !== undefined) {
      const pct = Math.floor(Number(body.percent));
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new HttpException({ code: 'TENANT_CANARY_PERCENT_INVALID', message: `Invalid percent "${body.percent}" — expected 0..100` }, HttpStatus.BAD_REQUEST);
      }
      data.canaryFleetPercent = pct;
      // Stamp the soak-window start whenever percent moves BELOW 100.
      // 100 (full rollout) clears the timer.
      data.canarySetAt = pct < 100 ? new Date() : null;
    }
    if (body.autoPromote !== undefined) {
      data.canaryAutoPromote = !!body.autoPromote;
    }
    if (body.soakHours !== undefined) {
      const hours = Math.floor(Number(body.soakHours));
      if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
        throw new HttpException({ code: 'TENANT_CANARY_SOAK_HOURS_INVALID', message: `Invalid soakHours "${body.soakHours}" — expected 1..720` }, HttpStatus.BAD_REQUEST);
      }
      data.canarySoakHours = hours;
    }

    if (Object.keys(data).length === 0) {
      throw new HttpException({ code: 'TENANT_CANARY_NOTHING_TO_UPDATE', message: 'No fields to update' }, HttpStatus.BAD_REQUEST);
    }

    const updated = await this.prisma.client.tenant.update({
      where: { id: req.user.tenantId },
      data,
      select: {
        canaryFleetPercent: true,
        canarySetAt: true,
        canaryAutoPromote: true,
        canarySoakHours: true,
      } as any,
    }) as any;

    await this.prisma.client.auditLog.create({
      data: {
        action: 'CANARY_ROLLOUT_UPDATED',
        targetType: 'tenant',
        targetId: req.user.tenantId,
        tenantId: req.user.tenantId,
        userId: req.user.id,
        details: JSON.stringify({
          percent: updated.canaryFleetPercent,
          autoPromote: updated.canaryAutoPromote,
          soakHours: updated.canarySoakHours,
          changedBy: req.user.email || req.user.id,
        }),
      },
    }).catch(() => { /* audit best-effort */ });

    return {
      percent: updated.canaryFleetPercent ?? 100,
      setAt: updated.canarySetAt ?? null,
      autoPromote: updated.canaryAutoPromote ?? true,
      soakHours: updated.canarySoakHours ?? 24,
    };
  }

  @Get('me/usb-ingest')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getUsbIngestConfig(@Request() req: any) {
    const t = await this.prisma.client.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { usbIngestEnabled: true, usbIngestKeyRotatedAt: true, usbIngestKey: true },
    });
    if (!t) throw new HttpException({ code: 'TENANT_USB_INGEST_CONFIG_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    return {
      enabled: t.usbIngestEnabled,
      hasKey: !!t.usbIngestKey,
      keyRotatedAt: t.usbIngestKeyRotatedAt,
    };
  }

  @Put('me/usb-ingest')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setUsbIngestEnabled(@Request() req: any, @Body() body: { enabled: boolean }) {
    // AUDIT (2026-09-08): this switch decides whether content signed OUTSIDE
    // this system may be ingested from physical media. Turning it on widens
    // the trust boundary, so "who turned it on, and when" has to survive.
    // Written in the SAME transaction as the flag — a flip with no row is
    // exactly the state the audit trail exists to make impossible.
    await this.prisma.client.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: req.user.tenantId },
        data: { usbIngestEnabled: !!body.enabled },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user.userId,
          action: 'USB_INGEST_TOGGLED',
          targetType: 'Tenant',
          targetId: req.user.tenantId,
          details: JSON.stringify({ enabled: !!body.enabled }),
        },
      });
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
    // AUDIT (2026-09-08): rotating this key invalidates every bundle signed
    // with the old one, so a rotation an operator did not expect looks exactly
    // like content mysteriously failing to ingest. The row records WHO rotated
    // and WHEN. The key itself is NEVER written to the audit row — only the
    // fact of the rotation.
    await this.prisma.client.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: req.user.tenantId },
        data: {
          usbIngestKey: newKey,
          usbIngestKeyRotatedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user.userId,
          action: 'USB_INGEST_KEY_ROTATED',
          targetType: 'Tenant',
          targetId: req.user.tenantId,
          details: JSON.stringify({ rotated: true }),
        },
      });
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
      throw new HttpException({ code: 'TENANT_USB_INGEST_FIELDS_REQUIRED', message: 'screenId and outcome required' }, HttpStatus.BAD_REQUEST);
    }

    // ── DT-07 (2026-08-03) — the screen must be the CALLER, not a path param.
    // This route has no @RequireRoles, so RbacGuard short-circuits and a
    // roleless device principal from ANY tenant reached it. `screenId` came
    // from the URL and was never tied to the caller, so a device token for
    // screen S in tenant T could write a `UsbIngestEvent` attributed to
    // screen X in tenant U — with attacker-chosen deviceSerial,
    // bundleVersion, assetCount, outcome and reason. That table is the
    // record an incident reviewer consults to answer "what content was
    // sideloaded onto this screen, and by whom".
    //
    // The old comment claimed "the screenId derivation alone closes the
    // IDOR". It closed the TENANT IDOR (the tenant is derived from the
    // screen row, not supplied) but not the SCREEN-TARGETING one. Bind it
    // to the token, exactly as every other device telemetry route does.
    // Operators (dashboard-driven ingest review) keep their access via the
    // tenant check below.
    const principal = req.user || {};
    if (principal.kind === 'device') {
      if (principal.sub !== screenId) {
        throw new HttpException(
          { code: 'TENANT_USB_INGEST_SCREEN_MISMATCH', message: 'Device may only report USB ingest for its own screen' },
          HttpStatus.FORBIDDEN,
        );
      }
    } else if (!principal.role) {
      // Neither a device bound to this screen nor a roled user → no basis
      // on which to write into anyone's forensic trail.
      throw new HttpException(
        { code: 'TENANT_USB_INGEST_FORBIDDEN', message: 'Device or operator authentication required' },
        HttpStatus.FORBIDDEN,
      );
    }

    // ten-ok: device-reported telemetry — the screen row IS the tenant resolver; usbIngestEnabled + optional HMAC verified directly below
    const screen = await this.prisma.client.screen.findUnique({
      where: { id: screenId },
      include: {
        tenant: { select: { id: true, usbIngestEnabled: true, usbIngestKey: true } },
      },
    });
    if (!screen?.tenantId || !screen.tenant) {
      throw new HttpException({ code: 'TENANT_USB_INGEST_SCREEN_UNKNOWN', message: 'Unknown or unpaired screen' }, HttpStatus.NOT_FOUND);
    }
    if (!screen.tenant.usbIngestEnabled) {
      throw new HttpException({ code: 'TENANT_USB_INGEST_DISABLED', message: 'USB ingest is disabled for this tenant' }, HttpStatus.FORBIDDEN);
    }
    // DT-07, operator leg: a roled user may only write into their OWN
    // tenant's ingest trail. SUPER_ADMIN is cross-tenant by design.
    if (principal.kind !== 'device' && principal.role !== AppRole.SUPER_ADMIN) {
      const callerTenantId = principal.tenantId || principal.schoolId || principal.districtId || null;
      if (!callerTenantId || callerTenantId !== screen.tenantId) {
        throw new HttpException(
          { code: 'TENANT_USB_INGEST_SCREEN_UNKNOWN', message: 'Unknown or unpaired screen' },
          HttpStatus.NOT_FOUND,
        );
      }
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
          throw new HttpException({ code: 'TENANT_USB_INGEST_SIGNATURE_INVALID', message: 'Invalid event signature' }, HttpStatus.FORBIDDEN);
        }
      } catch (e) {
        if (e instanceof HttpException) throw e;
        throw new HttpException({ code: 'TENANT_USB_INGEST_SIGNATURE_VERIFICATION_FAILED', message: 'Signature verification failed' }, HttpStatus.FORBIDDEN);
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
