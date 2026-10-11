import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isScopableRole, type ScreenScope } from './user-scope.policy';

/**
 * USER SCOPING (2026-10-11) — reads a person's access for the location their
 * session is working in. One indexed query per (person, location), plus two
 * small screen reads only when the person is screen-scoped; the answer is held
 * for CACHE_TTL_MS in this process. Writes through PUT /users/:id/access clear
 * this replica at once; another replica catches up within the TTL.
 */
const CACHE_TTL_MS = 10_000;
const CACHE_MAX = 5_000;

export interface ResolvedAccess {
  /** `User.tenantId`. */
  homeTenantId: string;
  /** The active location is home, or a `user_location_access` row covers it. */
  allowed: boolean;
  /** Null = not screen-scoped in the active location. */
  screenScope: ScreenScope | null;
}

interface CacheEntry {
  at: number;
  value: ResolvedAccess | null;
}

@Injectable()
export class UserScopeService {
  private readonly logger = new Logger('UserScope');
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Null when the user row is gone (deleted) — the caller refuses. Never
   * called for SUPER_ADMIN / DISTRICT_ADMIN / devices / API keys.
   */
  async resolve(userId: string, activeTenantId: string, now = Date.now()): Promise<ResolvedAccess | null> {
    const key = `${userId}:${activeTenantId}`;
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await this.load(userId, activeTenantId);
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(key, { at: now, value });
    return value;
  }

  /** PUT /users/:id/access calls this so the change is immediate on this replica. */
  invalidateUser(userId: string): void {
    for (const k of this.cache.keys()) if (k.startsWith(`${userId}:`)) this.cache.delete(k);
  }

  private async load(userId: string, activeTenantId: string): Promise<ResolvedAccess | null> {
    const client: any = this.prisma.client;
    // ten-ok: identity SELF-lookup — id IS the authenticated JWT principal; the
    // nested reads are constrained to the session's ACTIVE tenant.
    const user = await client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        tenantId: true,
        role: true,
        locationAccess: { where: { tenantId: activeTenantId }, select: { id: true } },
        screenScopes: { where: { tenantId: activeTenantId }, select: { screenId: true, screenGroupId: true } },
      },
    });
    if (!user) return null;
    const homeTenantId: string = user.tenantId;
    const allowed = homeTenantId === activeTenantId || (user.locationAccess?.length ?? 0) > 0;
    const rows: Array<{ screenId: string | null; screenGroupId: string | null }> = user.screenScopes ?? [];
    // Scope rows are honoured for the location roles only; an org admin is
    // never screen-scoped (policy header).
    if (!allowed || rows.length === 0 || !isScopableRole(user.role)) {
      return { homeTenantId, allowed, screenScope: null };
    }
    return { homeTenantId, allowed, screenScope: await this.effectiveScope(activeTenantId, rows) };
  }

  /**
   * Listed screens + screens in listed groups, widened to whole physical
   * displays (a double-sided unit's other face), all inside `tenantId`.
   */
  async effectiveScope(
    tenantId: string,
    rows: Array<{ screenId: string | null; screenGroupId: string | null }>,
  ): Promise<ScreenScope> {
    const client: any = this.prisma.client;
    const listedScreens = [...new Set(rows.map((r) => r.screenId).filter((x): x is string => !!x))];
    const listedGroups = [...new Set(rows.map((r) => r.screenGroupId).filter((x): x is string => !!x))];
    const groups: Array<{ id: string }> = listedGroups.length
      ? await client.screenGroup.findMany({ where: { tenantId, id: { in: listedGroups } }, select: { id: true } })
      : [];
    const groupIds = groups.map((g) => g.id);
    const or: any[] = [];
    if (listedScreens.length) or.push({ id: { in: listedScreens } });
    if (groupIds.length) or.push({ screenGroupId: { in: groupIds } });
    if (or.length === 0) return { screenIds: [], groupIds };
    const base: Array<{ id: string; faceOfScreenId: string | null }> = await client.screen.findMany({
      where: { tenantId, OR: or },
      select: { id: true, faceOfScreenId: true },
    });
    const units = new Set<string>();
    for (const s of base) {
      units.add(s.id);
      if (s.faceOfScreenId) units.add(s.faceOfScreenId);
    }
    if (units.size === 0) return { screenIds: [], groupIds };
    const unitIds = [...units];
    const whole: Array<{ id: string }> = await client.screen.findMany({
      where: { tenantId, OR: [{ id: { in: unitIds } }, { faceOfScreenId: { in: unitIds } }] },
      select: { id: true },
    });
    return { screenIds: [...new Set(whole.map((s) => s.id))], groupIds };
  }

  logFailure(what: string, e: unknown): void {
    this.logger.warn(`${what}: ${(e as any)?.message ?? e}`);
  }
}
