import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Optional,
  Param,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { loadManageableTarget } from '../users/manageable-target';
import { assertSupportReach } from '../support-access/support-access.context';
import { UserScopeService } from './user-scope.service';
import { UserScopeInputError, isScopableRole, parseIdList, MAX_SCOPE_ITEMS } from './user-scope.policy';

/** How many screens / groups per location the editor is offered. */
const OPTIONS_CAP = 1_000;

interface ScopeSet {
  screenIds: string[];
  screenGroupIds: string[];
}

/**
 * USER SCOPING (2026-10-11) — Settings → People → "Locations & screens".
 *
 *   GET /api/v1/users/:id/access   what the editor shows for one person
 *   PUT /api/v1/users/:id/access   save it (audited before → after)
 *
 * WHO MAY DO WHAT
 *   - The person is resolved through `loadManageableTarget` — the SAME gate
 *     as every other People action: tenant subtree, strictly-below rank, a
 *     scope miss answers 404.
 *   - LOCATIONS (extra locations of the organisation): org admins only
 *     (DISTRICT_ADMIN, or SUPER_ADMIN under support access). A location admin
 *     sees them read-only.
 *   - SCREEN LIMITS: an org admin for any location the person can reach; a
 *     location admin for their own location only.
 *   - Only the location roles can be given either (SCOPABLE_ROLES): an org
 *     admin already reaches everything and is never screen-scoped.
 */
@Controller('api/v1/users')
@UseGuards(JwtAuthGuard, RbacGuard)
export class UserAccessController {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly scope?: UserScopeService,
  ) {}

  @Get(':id/access')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getAccess(@Request() req: any, @Param('id') id: string) {
    const target = await loadManageableTarget(this.prisma.client, req, id, { notFoundOnScopeMiss: true });
    const ctx = await this.context(req, target);
    const current = await this.currentAccess(target.id, ctx.orgLocationIds);
    const reachable = [target.tenantId, ...current.locationIds];
    const scopeEditable = reachable.filter((t) => ctx.scopeEditableTenantIds.includes(t));
    const options: Record<string, { screens: any[]; groups: any[] }> = {};
    for (const t of scopeEditable) options[t] = await this.optionsFor(t);
    return {
      user: { id: target.id, email: target.email, role: target.role, homeTenantId: target.tenantId },
      scopable: isScopableRole(target.role),
      canEditLocations: ctx.canEditLocations,
      // A location admin sees only the person's own locations (read-only);
      // an org admin sees the whole organisation to choose from.
      locations: ctx.orgLocations
        .map((l) => ({
          id: l.id,
          name: l.name,
          isHome: l.id === target.tenantId,
          granted: l.id === target.tenantId || current.locationIds.includes(l.id),
          scopeEditable: ctx.scopeEditableTenantIds.includes(l.id),
        }))
        .filter((l) => ctx.canEditLocations || l.granted),
      screenScopes: current.screenScopes,
      options,
    };
  }

  @Put(':id/access')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setAccess(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { locationIds?: unknown; screenScopes?: unknown },
  ) {
    const target = await loadManageableTarget(this.prisma.client, req, id, { notFoundOnScopeMiss: true });
    const ctx = await this.context(req, target);
    const before = await this.currentAccess(target.id, ctx.orgLocationIds);

    let locationIds: string[];
    let scopesIn: Record<string, ScopeSet | null>;
    try {
      locationIds =
        body?.locationIds === undefined ? before.locationIds : parseIdList(body.locationIds, 'locationIds').filter((l) => l !== target.tenantId);
      scopesIn = parseScopes(body?.screenScopes);
    } catch (e) {
      if (e instanceof UserScopeInputError) throw new HttpException({ code: e.code, message: e.message }, HttpStatus.BAD_REQUEST);
      throw e;
    }

    const scopable = isScopableRole(target.role);
    const anyScopeRequested = Object.values(scopesIn).some((s) => s && (s.screenIds.length || s.screenGroupIds.length));
    if (!scopable && (locationIds.length > 0 || anyScopeRequested)) {
      throw new HttpException(
        {
          code: 'USER_ACCESS_ROLE_NOT_SCOPABLE',
          message: 'Organization admins already reach every location and every screen. Change their role first to limit them.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Locations: org admins only; every id must be a live location of this organisation.
    const locationsChanged = !sameSet(locationIds, before.locationIds);
    if (locationsChanged && !ctx.canEditLocations) {
      throw new HttpException(
        { code: 'USER_ACCESS_LOCATIONS_ORG_ADMIN_ONLY', message: 'Only an organization admin can change which locations a person can use.' },
        HttpStatus.FORBIDDEN,
      );
    }
    for (const l of locationIds) {
      if (!ctx.orgLocationIds.includes(l)) {
        throw new HttpException({ code: 'USER_ACCESS_LOCATION_INVALID', message: 'That location is not part of this organization.' }, HttpStatus.BAD_REQUEST);
      }
    }
    if (locationsChanged) {
      // A super admin reaches a customer location only under a grant that covers it.
      for (const l of symmetricDiff(locationIds, before.locationIds)) await assertSupportReach(req.user, l);
    }

    // Screen limits: only for a location the person can reach, by someone allowed to edit it there.
    const reachable = new Set([target.tenantId, ...locationIds]);
    const finalScopes: Record<string, ScopeSet> = {};
    for (const [t, s] of Object.entries(before.screenScopes)) if (reachable.has(t)) finalScopes[t] = s;
    for (const [t, s] of Object.entries(scopesIn)) {
      if (!reachable.has(t)) {
        throw new HttpException(
          { code: 'USER_ACCESS_LOCATION_INVALID', message: 'Give the person that location before limiting their screens there.' },
          HttpStatus.BAD_REQUEST,
        );
      }
      const prior = before.screenScopes[t] ?? { screenIds: [], screenGroupIds: [] };
      const next = s ?? { screenIds: [], screenGroupIds: [] };
      const changed = !sameSet(prior.screenIds, next.screenIds) || !sameSet(prior.screenGroupIds, next.screenGroupIds);
      if (!changed) continue;
      if (!ctx.scopeEditableTenantIds.includes(t)) {
        throw new HttpException(
          { code: 'USER_ACCESS_SCOPE_NOT_YOURS', message: 'You can only limit screens in a location you manage.' },
          HttpStatus.FORBIDDEN,
        );
      }
      await assertSupportReach(req.user, t);
      await this.assertTargetsBelong(t, next);
      if (next.screenIds.length || next.screenGroupIds.length) finalScopes[t] = next;
      else delete finalScopes[t];
    }

    const after = { locationIds: [...locationIds].sort(), screenScopes: sortScopes(finalScopes) };
    const beforeSnap = { locationIds: [...before.locationIds].sort(), screenScopes: sortScopes(before.screenScopes) };
    if (JSON.stringify(after) === JSON.stringify(beforeSnap)) {
      return { success: true, changed: false, ...after };
    }

    const client: any = this.prisma.client;
    await client.$transaction(async (tx: any) => {
      const removedLocations = before.locationIds.filter((l) => !locationIds.includes(l));
      const addedLocations = locationIds.filter((l) => !before.locationIds.includes(l));
      if (removedLocations.length) {
        await tx.userLocationAccess.deleteMany({ where: { userId: target.id, tenantId: { in: removedLocations } } });
      }
      for (const l of addedLocations) {
        await tx.userLocationAccess.create({ data: { userId: target.id, tenantId: l, grantedByUserId: req.user?.id ?? null } });
      }
      // Rewrite the scope rows of every location whose scope changed (or that was removed).
      const touched = new Set([...Object.keys(before.screenScopes), ...Object.keys(finalScopes)]);
      for (const t of touched) {
        const prior = before.screenScopes[t];
        const next = finalScopes[t];
        if (JSON.stringify(sortScope(prior)) === JSON.stringify(sortScope(next))) continue;
        await tx.userScreenScope.deleteMany({ where: { userId: target.id, tenantId: t } });
        if (next) {
          const rows = [
            ...next.screenIds.map((screenId) => ({ userId: target.id, tenantId: t, screenId, screenGroupId: null })),
            ...next.screenGroupIds.map((screenGroupId) => ({ userId: target.id, tenantId: t, screenId: null, screenGroupId })),
          ];
          if (rows.length) await tx.userScreenScope.createMany({ data: rows });
        }
      }
      await tx.auditLog.create({
        data: {
          tenantId: target.tenantId,
          userId: req.user?.id ?? null,
          action: 'USER_ACCESS_UPDATED',
          targetType: 'user',
          targetId: target.id,
          details: JSON.stringify({ email: target.email, actorTenantId: req.user?.tenantId ?? null, before: beforeSnap, after }),
        },
      });
    });
    this.scope?.invalidateUser(target.id);
    return { success: true, changed: true, ...after };
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  /** The organisation the person belongs to, and what this caller may edit in it. */
  private async context(req: any, target: { tenantId: string }) {
    const client: any = this.prisma.client;
    const role: string = req.user?.role;
    const home = await client.tenant.findUnique({ where: { id: target.tenantId }, select: { id: true, parentId: true } });
    const rootId: string = home?.parentId ?? target.tenantId;
    // ten-ok: the organisation of the TARGET (already verified manageable) — root + its direct locations is the scope being computed
    const orgLocations: Array<{ id: string; name: string }> = await client.tenant.findMany({
      where: { archivedAt: null, OR: [{ id: rootId }, { parentId: rootId }] },
      select: { id: true, name: true, parentId: true },
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
    });
    const orgLocationIds = orgLocations.map((l) => l.id);
    const isOrgAdmin = role === AppRole.SUPER_ADMIN || role === AppRole.DISTRICT_ADMIN;
    const callerTenantId: string | undefined = req.user?.tenantId;
    return {
      orgLocations,
      orgLocationIds,
      canEditLocations: isOrgAdmin,
      scopeEditableTenantIds: isOrgAdmin ? orgLocationIds : callerTenantId ? [callerTenantId] : [],
    };
  }

  private async currentAccess(userId: string, orgLocationIds: string[]) {
    const client: any = this.prisma.client;
    const [memberships, scopes] = await Promise.all([
      client.userLocationAccess.findMany({ where: { userId, tenantId: { in: orgLocationIds } }, select: { tenantId: true } }),
      client.userScreenScope.findMany({
        where: { userId, tenantId: { in: orgLocationIds } },
        select: { tenantId: true, screenId: true, screenGroupId: true },
      }),
    ]);
    const screenScopes: Record<string, ScopeSet> = {};
    for (const r of scopes as Array<{ tenantId: string; screenId: string | null; screenGroupId: string | null }>) {
      const s = (screenScopes[r.tenantId] ??= { screenIds: [], screenGroupIds: [] });
      if (r.screenId && !s.screenIds.includes(r.screenId)) s.screenIds.push(r.screenId);
      if (r.screenGroupId && !s.screenGroupIds.includes(r.screenGroupId)) s.screenGroupIds.push(r.screenGroupId);
    }
    return { locationIds: (memberships as Array<{ tenantId: string }>).map((m) => m.tenantId), screenScopes };
  }

  private async optionsFor(tenantId: string) {
    const client: any = this.prisma.client;
    const [screens, groups] = await Promise.all([
      client.screen.findMany({
        where: { tenantId, faceOfScreenId: null },
        select: { id: true, name: true, screenGroupId: true },
        orderBy: { name: 'asc' },
        take: OPTIONS_CAP,
      }),
      client.screenGroup.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: OPTIONS_CAP }),
    ]);
    return { screens, groups };
  }

  private async assertTargetsBelong(tenantId: string, s: ScopeSet) {
    const client: any = this.prisma.client;
    const [screens, groups] = await Promise.all([
      s.screenIds.length ? client.screen.findMany({ where: { tenantId, id: { in: s.screenIds } }, select: { id: true } }) : [],
      s.screenGroupIds.length
        ? client.screenGroup.findMany({ where: { tenantId, id: { in: s.screenGroupIds } }, select: { id: true } })
        : [],
    ]);
    if ((screens as any[]).length !== s.screenIds.length || (groups as any[]).length !== s.screenGroupIds.length) {
      throw new HttpException(
        { code: 'USER_ACCESS_SCREEN_INVALID', message: 'One of those screens or groups is not in that location.' },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

function parseScopes(v: unknown): Record<string, ScopeSet | null> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new UserScopeInputError('USER_ACCESS_INVALID', 'screenScopes must be an object.');
  const out: Record<string, ScopeSet | null> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > MAX_SCOPE_ITEMS) throw new UserScopeInputError('USER_ACCESS_INVALID', 'Too many locations.');
  for (const [t, raw] of entries) {
    if (!t) throw new UserScopeInputError('USER_ACCESS_INVALID', 'screenScopes keys must be location ids.');
    if (raw === null) {
      out[t] = null;
      continue;
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new UserScopeInputError('USER_ACCESS_INVALID', 'Each screen limit must be an object.');
    out[t] = {
      screenIds: parseIdList((raw as any).screenIds, 'screenIds'),
      screenGroupIds: parseIdList((raw as any).screenGroupIds, 'screenGroupIds'),
    };
  }
  return out;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

function symmetricDiff(a: string[], b: string[]): string[] {
  return [...a.filter((x) => !b.includes(x)), ...b.filter((x) => !a.includes(x))];
}

function sortScope(s: ScopeSet | undefined): ScopeSet | null {
  if (!s) return null;
  return { screenIds: [...s.screenIds].sort(), screenGroupIds: [...s.screenGroupIds].sort() };
}

function sortScopes(m: Record<string, ScopeSet>): Record<string, ScopeSet> {
  const out: Record<string, ScopeSet> = {};
  for (const k of Object.keys(m).sort()) out[k] = sortScope(m[k]) as ScopeSet;
  return out;
}
