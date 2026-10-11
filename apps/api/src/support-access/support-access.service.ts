import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveRootTenantId, collectDescendantTenantIds } from '../emergency/tenant-hierarchy';
import {
  BREAK_GLASS_MAX_MINUTES,
  SUPPORT_ACCESS_REQUIRED,
  SupportAccessInputError,
  approvedDurationMinutes,
  expiryFor,
  grantCoversTenant,
  grantHasLapsed,
  grantIsActive,
  parseDurationMinutes,
  parseOptionalDurationMinutes,
  parseReason,
  parseScopeTenantIds,
  summarizeGrant,
  type GrantKind,
} from './support-access.policy';

/**
 * CUSTOMER-APPROVED SUPPORT ACCESS (2026-10-11).
 *
 * THE RULE. VenueOS has no standing access to a customer's data. A SUPER_ADMIN
 * may switch into, read or change a customer organisation only while an ACTIVE
 * SupportAccessGrant covers the tenant they are touching. Exempt by design:
 *   - an INTERNAL organisation (`Tenant.isInternal` on the root — VisionCore,
 *     the owner's demo / bench / test orgs);
 *   - the super admin's OWN home tenant (`User.tenantId`) — so the owner can
 *     never lock himself out, whatever the flag says.
 *
 * `reach()` is the single decision; `assertReach()` is the same decision as a
 * 403. Both are cached per process for a few seconds, and every grant
 * mutation clears this replica's cache (another replica catches up within
 * CACHE_TTL_MS — a revoke is honoured fleet-wide inside ten seconds).
 *
 * EXPIRY is lazy and exact: an ACTIVE row past `expiresAt` never counts, and
 * the first read that sees it stamps it EXPIRED with an audit row. No cron.
 *
 * FAILS CLOSED. If the database cannot answer "is there a grant?", the answer
 * is no. This is a data-access control on a super admin, not a customer-facing
 * availability path: a 403 for the owner during a blip is the right failure.
 */
const CACHE_TTL_MS = 10_000;
const CACHE_MAX = 5_000;

export type ReachBasis = 'internal' | 'home' | 'grant';
export interface ReachDecision {
  allowed: boolean;
  basis: ReachBasis | null;
  grantId: string | null;
  rootTenantId: string | null;
}

export interface Principal {
  id?: string | null;
  userId?: string | null;
  email?: string | null;
  role?: string | null;
  tenantId?: string | null;
  kind?: string | null;
}

const principalId = (p: Principal | null | undefined): string | null =>
  (typeof p?.id === 'string' && p.id) || (typeof p?.userId === 'string' && p.userId) || null;

@Injectable()
export class SupportAccessService {
  private readonly logger = new Logger('SupportAccess');
  private readonly reachCache = new Map<string, { at: number; decision: ReachDecision }>();
  private readonly tenantCache = new Map<string, { at: number; rootId: string; internal: boolean }>();
  private readonly homeCache = new Map<string, { at: number; tenantId: string | null }>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly email?: EmailService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** Grant / tenant-flag changes call this so the decision is immediate on this replica. */
  invalidate(): void {
    this.reachCache.clear();
    this.tenantCache.clear();
    this.homeCache.clear();
  }

  // ─── The decision ────────────────────────────────────────────────────────

  /** May `user` (a SUPER_ADMIN) touch `tenantId`'s data right now? Non-super callers are not this service's business. */
  async reach(user: Principal, tenantId: string, now = new Date()): Promise<ReachDecision> {
    const uid = principalId(user) ?? '';
    const key = `${uid}:${tenantId}`;
    const hit = this.reachCache.get(key);
    if (hit && now.getTime() - hit.at < CACHE_TTL_MS) return hit.decision;

    let decision: ReachDecision;
    try {
      decision = await this.decideReach(uid, tenantId, now);
    } catch (e: any) {
      this.logger.warn(`reach lookup failed for tenant ${tenantId} (user ${uid}) — refusing: ${e?.message ?? e}`);
      decision = { allowed: false, basis: null, grantId: null, rootTenantId: null };
      return decision; // never cache a failure
    }
    if (this.reachCache.size >= CACHE_MAX) this.reachCache.clear();
    this.reachCache.set(key, { at: now.getTime(), decision });
    return decision;
  }

  /** `reach()` as a 403 SUPPORT_ACCESS_REQUIRED. A no-op for anyone who is not a SUPER_ADMIN person. */
  async assertReach(user: Principal | null | undefined, tenantId: string | null | undefined, now = new Date()): Promise<ReachDecision | null> {
    if (!user || user.kind === 'device' || user.kind === 'api-key') return null;
    if (user.role !== AppRole.SUPER_ADMIN) return null;
    if (!tenantId) return null;
    const d = await this.reach(user, tenantId, now);
    if (!d.allowed) throw SupportAccessService.refusal();
    return d;
  }

  static refusal(): ForbiddenException {
    return new ForbiddenException({
      code: SUPPORT_ACCESS_REQUIRED,
      message:
        'VenueOS support does not currently have access to this organization. Ask the customer to approve support access (or give it from their Settings), then try again.',
    });
  }

  private async decideReach(userId: string, tenantId: string, now: Date): Promise<ReachDecision> {
    const t = await this.tenantInfo(tenantId, now);
    if (!t) return { allowed: false, basis: null, grantId: null, rootTenantId: null };
    if (t.internal) return { allowed: true, basis: 'internal', grantId: null, rootTenantId: t.rootId };
    if (userId) {
      const home = await this.homeTenantOf(userId, now);
      if (home && (home === tenantId || home === t.rootId)) {
        return { allowed: true, basis: 'home', grantId: null, rootTenantId: t.rootId };
      }
    }
    const grant = await this.activeGrantFor(t.rootId, now);
    if (grant && grantCoversTenant(grant, tenantId, t.rootId)) {
      return { allowed: true, basis: 'grant', grantId: grant.id, rootTenantId: t.rootId };
    }
    return { allowed: false, basis: null, grantId: null, rootTenantId: t.rootId };
  }

  private async tenantInfo(tenantId: string, now: Date): Promise<{ rootId: string; internal: boolean } | null> {
    const hit = this.tenantCache.get(tenantId);
    if (hit && now.getTime() - hit.at < CACHE_TTL_MS * 6) return hit;
    const client = this.prisma.client as any;
    const row = await client.tenant.findUnique({ where: { id: tenantId }, select: { id: true, parentId: true, isInternal: true } });
    if (!row) return null;
    const rootId = row.parentId ? await resolveRootTenantId(client.tenant, tenantId) : tenantId;
    let internal = !!row.isInternal;
    if (!internal && rootId !== tenantId) {
      const root = await client.tenant.findUnique({ where: { id: rootId }, select: { isInternal: true } });
      internal = !!root?.isInternal;
    }
    const info = { at: now.getTime(), rootId, internal };
    if (this.tenantCache.size >= CACHE_MAX) this.tenantCache.clear();
    this.tenantCache.set(tenantId, info);
    return info;
  }

  private async homeTenantOf(userId: string, now: Date): Promise<string | null> {
    const hit = this.homeCache.get(userId);
    if (hit && now.getTime() - hit.at < CACHE_TTL_MS * 6) return hit.tenantId;
    // ten-ok: identity SELF-lookup — the super admin's own home row
    const row = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { tenantId: true } });
    const tenantId = row?.tenantId ?? null;
    this.homeCache.set(userId, { at: now.getTime(), tenantId });
    return tenantId;
  }

  /** The one ACTIVE, unexpired grant on an organisation root (stamping a lapsed one EXPIRED on the way). */
  async activeGrantFor(rootTenantId: string, now = new Date()): Promise<any | null> {
    const client = this.prisma.client as any;
    const rows: any[] = await client.supportAccessGrant.findMany({
      where: { tenantId: rootTenantId, status: 'ACTIVE' },
      orderBy: { expiresAt: 'desc' },
    });
    let live: any | null = null;
    for (const g of rows) {
      if (grantHasLapsed(g, now)) {
        await this.stampExpired(g, now);
        continue;
      }
      if (grantIsActive(g, now) && !live) live = g;
    }
    return live;
  }

  private async stampExpired(grant: any, now: Date): Promise<void> {
    const client = this.prisma.client as any;
    try {
      const r = await client.supportAccessGrant.updateMany({
        where: { id: grant.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED', updatedAt: now },
      });
      if (r?.count) {
        await client.auditLog.create({
          data: {
            tenantId: grant.tenantId,
            userId: null,
            action: 'SUPPORT_ACCESS_EXPIRED',
            targetType: 'SupportAccessGrant',
            targetId: grant.id,
            supportGrantId: grant.id,
            details: JSON.stringify({ kind: grant.kind, expiresAt: grant.expiresAt }),
          },
        });
      }
    } catch (e: any) {
      this.logger.warn(`could not stamp grant ${grant.id} EXPIRED: ${e?.message ?? e}`);
    }
    this.invalidate();
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /** Root organisation id for a tenant, or null when the tenant does not exist. */
  async rootOf(tenantId: string): Promise<string | null> {
    const t = await this.tenantInfo(tenantId, new Date());
    return t?.rootId ?? null;
  }

  async isInternalOrg(tenantId: string): Promise<boolean> {
    const t = await this.tenantInfo(tenantId, new Date());
    return !!t?.internal;
  }

  /** Everything about an organisation's support access: the active grant, open requests, history. */
  async listForOrg(rootTenantId: string, now = new Date()) {
    const active = await this.activeGrantFor(rootTenantId, now); // stamps lapsed rows first
    const client = this.prisma.client as any;
    const rows: any[] = await client.supportAccessGrant.findMany({
      where: { tenantId: rootTenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const locations: any[] = await client.tenant.findMany({
      where: { parentId: rootTenantId, archivedAt: null },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    });
    return {
      tenantId: rootTenantId,
      active: active ? summarizeGrant(active, now) : null,
      pending: rows.filter((g) => g.status === 'REQUESTED').map((g) => summarizeGrant(g, now)),
      history: rows.filter((g) => g.status !== 'REQUESTED').map((g) => summarizeGrant(g, now)),
      locations,
    };
  }

  /**
   * For the tenant switcher: which of these tenants a super admin may enter
   * right now, and why — in TWO queries, not two per tenant. `rows` is the
   * switcher's own list (id, parentId, isInternal); roots are resolved in
   * memory from it, so a location whose root is not in the list reads as
   * unreachable (archived roots are excluded from the list by design).
   */
  async reachableBasisBulk(
    user: Principal,
    rows: Array<{ id: string; parentId: string | null; isInternal?: boolean | null }>,
    now = new Date(),
  ): Promise<Map<string, ReachBasis | null>> {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const rootOf = (id: string): string => {
      let cur = id;
      for (let hop = 0; hop < 8; hop++) {
        const p = byId.get(cur)?.parentId;
        if (!p || !byId.has(p)) return cur;
        cur = p;
      }
      return cur;
    };
    const uid = principalId(user);
    const home = uid ? await this.homeTenantOf(uid, now) : null;
    const grants: any[] = await (this.prisma.client as any).supportAccessGrant.findMany({ where: { status: 'ACTIVE' } });
    const liveByRoot = new Map<string, any>();
    for (const g of grants) if (grantIsActive(g, now)) liveByRoot.set(g.tenantId, g);
    const out = new Map<string, ReachBasis | null>();
    for (const r of rows) {
      const root = rootOf(r.id);
      if (r.isInternal || byId.get(root)?.isInternal) out.set(r.id, 'internal');
      else if (home && (home === r.id || home === root)) out.set(r.id, 'home');
      else {
        const g = liveByRoot.get(root);
        out.set(r.id, g && grantCoversTenant(g, r.id, root) ? 'grant' : null);
      }
    }
    return out;
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /** (A) VenueOS asks. A super admin requests access to an organisation; its admins decide. */
  async request(orgId: string, actor: Principal, body: unknown, now = new Date()) {
    const b = (body ?? {}) as Record<string, unknown>;
    const input = this.inputs(() => ({
      reason: parseReason(b.reason, { required: true })!,
      durationMinutes: parseDurationMinutes(b.durationMinutes),
      scopeTenantIds: parseScopeTenantIds(b.scopeTenantIds),
    }));
    const org = await this.requireOrgRoot(orgId);
    await this.assertScopeInOrg(org.id, input.scopeTenantIds);
    const client = this.prisma.client as any;
    const existing = await this.activeGrantFor(org.id, now);
    if (existing) {
      throw new HttpException({ code: 'SUPPORT_ACCESS_ALREADY_ACTIVE', message: 'VenueOS already has access to this organization.' }, HttpStatus.CONFLICT);
    }
    const open = await client.supportAccessGrant.findFirst({ where: { tenantId: org.id, status: 'REQUESTED' }, select: { id: true } });
    if (open) {
      throw new HttpException({ code: 'SUPPORT_ACCESS_REQUEST_PENDING', message: 'A request is already waiting for this organization.' }, HttpStatus.CONFLICT);
    }
    const grant = await client.$transaction(async (tx: any) => {
      const row = await tx.supportAccessGrant.create({
        data: {
          tenantId: org.id,
          kind: 'REQUEST',
          status: 'REQUESTED',
          reason: input.reason,
          scopeTenantIds: input.scopeTenantIds,
          requestedDurationMinutes: input.durationMinutes,
          requestedByUserId: principalId(actor),
          requestedByEmail: actor.email ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: org.id,
          userId: principalId(actor),
          action: 'SUPPORT_ACCESS_REQUESTED',
          targetType: 'SupportAccessGrant',
          targetId: row.id,
          supportGrantId: row.id,
          details: JSON.stringify({ reason: input.reason, durationMinutes: input.durationMinutes, scopeTenantIds: input.scopeTenantIds }),
        },
      });
      return row;
    });
    this.invalidate();
    await this.notifyAdmins(org, 'requested', grant);
    return summarizeGrant(grant, now);
  }

  /** The customer approves (optionally shortening) or denies a request. */
  async decide(grantId: string, orgId: string, actor: Principal, approve: boolean, body: unknown, now = new Date()) {
    const b = (body ?? {}) as Record<string, unknown>;
    const input = this.inputs(() => ({
      durationMinutes: parseOptionalDurationMinutes(b.durationMinutes),
      note: parseReason(b.note, { required: false, field: 'note' }),
    }));
    const client = this.prisma.client as any;
    const grant = await client.supportAccessGrant.findFirst({ where: { id: grantId, tenantId: orgId } });
    if (!grant) throw new NotFoundException({ code: 'SUPPORT_ACCESS_NOT_FOUND', message: 'Request not found.' });
    if (grant.status !== 'REQUESTED') {
      throw new HttpException({ code: 'SUPPORT_ACCESS_NOT_PENDING', message: 'This request has already been decided.' }, HttpStatus.CONFLICT);
    }
    const minutes = approve ? approvedDurationMinutes(grant.requestedDurationMinutes, input.durationMinutes) : null;
    const expiresAt = approve ? expiryFor(now, minutes!) : null;
    const updated = await client.$transaction(async (tx: any) => {
      const r = await tx.supportAccessGrant.updateMany({
        where: { id: grant.id, status: 'REQUESTED' },
        data: {
          status: approve ? 'ACTIVE' : 'DENIED',
          note: input.note,
          decidedByUserId: principalId(actor),
          decidedByEmail: actor.email ?? null,
          decidedAt: now,
          startsAt: approve ? now : null,
          expiresAt,
          updatedAt: now,
        },
      });
      if (!r.count) {
        throw new HttpException({ code: 'SUPPORT_ACCESS_NOT_PENDING', message: 'This request has already been decided.' }, HttpStatus.CONFLICT);
      }
      await tx.auditLog.create({
        data: {
          tenantId: orgId,
          userId: principalId(actor),
          action: approve ? 'SUPPORT_ACCESS_APPROVED' : 'SUPPORT_ACCESS_DENIED',
          targetType: 'SupportAccessGrant',
          targetId: grant.id,
          supportGrantId: grant.id,
          details: JSON.stringify({
            requestedDurationMinutes: grant.requestedDurationMinutes,
            durationMinutes: minutes,
            expiresAt,
            note: input.note,
            scopeTenantIds: grant.scopeTenantIds,
          }),
        },
      });
      return tx.supportAccessGrant.findUnique({ where: { id: grant.id } });
    });
    this.invalidate();
    if (approve) await this.notifyRequester(updated, 'approved');
    else await this.notifyRequester(updated, 'denied');
    return summarizeGrant(updated, now);
  }

  /** (B) The customer invites VenueOS in. Active at once. */
  async invite(orgId: string, actor: Principal, body: unknown, now = new Date()) {
    const b = (body ?? {}) as Record<string, unknown>;
    const input = this.inputs(() => ({
      durationMinutes: parseDurationMinutes(b.durationMinutes),
      note: parseReason(b.note, { required: false, field: 'note' }),
      scopeTenantIds: parseScopeTenantIds(b.scopeTenantIds),
    }));
    const org = await this.requireOrgRoot(orgId);
    await this.assertScopeInOrg(org.id, input.scopeTenantIds);
    if (await this.activeGrantFor(org.id, now)) {
      throw new HttpException({ code: 'SUPPORT_ACCESS_ALREADY_ACTIVE', message: 'VenueOS already has access. End it first to change the duration or scope.' }, HttpStatus.CONFLICT);
    }
    const expiresAt = expiryFor(now, input.durationMinutes);
    const client = this.prisma.client as any;
    const grant = await client.$transaction(async (tx: any) => {
      const row = await tx.supportAccessGrant.create({
        data: {
          tenantId: org.id,
          kind: 'INVITE',
          status: 'ACTIVE',
          note: input.note,
          scopeTenantIds: input.scopeTenantIds,
          requestedDurationMinutes: input.durationMinutes,
          decidedByUserId: principalId(actor),
          decidedByEmail: actor.email ?? null,
          decidedAt: now,
          startsAt: now,
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: org.id,
          userId: principalId(actor),
          action: 'SUPPORT_ACCESS_INVITED',
          targetType: 'SupportAccessGrant',
          targetId: row.id,
          supportGrantId: row.id,
          details: JSON.stringify({ durationMinutes: input.durationMinutes, expiresAt, note: input.note, scopeTenantIds: input.scopeTenantIds }),
        },
      });
      return row;
    });
    this.invalidate();
    await this.notifyVenueOs(org, grant);
    return summarizeGrant(grant, now);
  }

  /** Either side ends an active grant (or withdraws an open request). */
  async revoke(grantId: string, orgId: string, actor: Principal, side: 'customer' | 'venueos', body: unknown, now = new Date()) {
    const b = (body ?? {}) as Record<string, unknown>;
    const note = this.inputs(() => parseReason(b.note, { required: false, field: 'note' }));
    const client = this.prisma.client as any;
    const grant = await client.supportAccessGrant.findFirst({ where: { id: grantId, tenantId: orgId } });
    if (!grant) throw new NotFoundException({ code: 'SUPPORT_ACCESS_NOT_FOUND', message: 'Grant not found.' });
    if (grant.status !== 'ACTIVE' && grant.status !== 'REQUESTED') {
      throw new HttpException({ code: 'SUPPORT_ACCESS_NOT_ACTIVE', message: 'This access has already ended.' }, HttpStatus.CONFLICT);
    }
    const wasRequest = grant.status === 'REQUESTED';
    const updated = await client.$transaction(async (tx: any) => {
      const r = await tx.supportAccessGrant.updateMany({
        where: { id: grant.id, status: grant.status },
        data: {
          status: wasRequest ? 'DENIED' : 'REVOKED',
          revokedByUserId: principalId(actor),
          revokedByEmail: actor.email ?? null,
          revokedAt: now,
          note: note ?? grant.note,
          updatedAt: now,
        },
      });
      if (!r.count) {
        throw new HttpException({ code: 'SUPPORT_ACCESS_NOT_ACTIVE', message: 'This access has already ended.' }, HttpStatus.CONFLICT);
      }
      await tx.auditLog.create({
        data: {
          tenantId: orgId,
          userId: principalId(actor),
          action: wasRequest ? 'SUPPORT_ACCESS_WITHDRAWN' : 'SUPPORT_ACCESS_REVOKED',
          targetType: 'SupportAccessGrant',
          targetId: grant.id,
          supportGrantId: grant.id,
          details: JSON.stringify({ by: side, note, kind: grant.kind, expiresAt: grant.expiresAt }),
        },
      });
      return tx.supportAccessGrant.findUnique({ where: { id: grant.id } });
    });
    this.invalidate();
    if (side === 'venueos' && !wasRequest) {
      const org = await this.requireOrgRoot(orgId);
      await this.notifyAdmins(org, 'ended', updated);
    }
    return summarizeGrant(updated, now);
  }

  /**
   * BREAK-GLASS. A genuine incident when nobody at the customer can answer: at
   * most one hour, a mandatory reason, an audit row, an email to every admin
   * of the organisation at once, and it shows on their banner like any grant.
   * A separate, explicit action — never the default path.
   */
  async breakGlass(orgId: string, actor: Principal, body: unknown, now = new Date()) {
    const b = (body ?? {}) as Record<string, unknown>;
    const input = this.inputs(() => ({
      reason: parseReason(b.reason, { required: true })!,
      durationMinutes: Math.min(BREAK_GLASS_MAX_MINUTES, b.durationMinutes === undefined ? BREAK_GLASS_MAX_MINUTES : parseDurationMinutes(b.durationMinutes)),
    }));
    const org = await this.requireOrgRoot(orgId);
    if (await this.activeGrantFor(org.id, now)) {
      throw new HttpException({ code: 'SUPPORT_ACCESS_ALREADY_ACTIVE', message: 'VenueOS already has access to this organization.' }, HttpStatus.CONFLICT);
    }
    const expiresAt = expiryFor(now, input.durationMinutes);
    const client = this.prisma.client as any;
    const grant = await client.$transaction(async (tx: any) => {
      const row = await tx.supportAccessGrant.create({
        data: {
          tenantId: org.id,
          kind: 'BREAK_GLASS',
          status: 'ACTIVE',
          reason: input.reason,
          scopeTenantIds: [],
          requestedDurationMinutes: input.durationMinutes,
          requestedByUserId: principalId(actor),
          requestedByEmail: actor.email ?? null,
          decidedByUserId: principalId(actor),
          decidedByEmail: actor.email ?? null,
          decidedAt: now,
          startsAt: now,
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: org.id,
          userId: principalId(actor),
          action: 'SUPPORT_ACCESS_BREAK_GLASS',
          targetType: 'SupportAccessGrant',
          targetId: row.id,
          supportGrantId: row.id,
          details: JSON.stringify({ reason: input.reason, durationMinutes: input.durationMinutes, expiresAt }),
        },
      });
      return row;
    });
    this.invalidate();
    await this.notifyAdmins(org, 'break-glass', grant);
    return summarizeGrant(grant, now);
  }

  /** The audit row the interceptor writes for every mutation a super admin makes under a grant. */
  async recordAction(grantId: string, tenantId: string, actor: Principal, method: string, path: string): Promise<void> {
    try {
      await (this.prisma.client as any).auditLog.create({
        data: {
          tenantId,
          userId: principalId(actor),
          action: 'SUPPORT_ACCESS_ACTION',
          targetType: 'SupportAccessGrant',
          targetId: grantId,
          supportGrantId: grantId,
          details: JSON.stringify({ method, path: path.split('?')[0].slice(0, 300) }),
        },
      });
    } catch (e: any) {
      this.logger.warn(`could not record support action ${method} ${path}: ${e?.message ?? e}`);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private inputs<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof SupportAccessInputError) throw new HttpException({ code: e.code, message: e.message }, HttpStatus.BAD_REQUEST);
      throw e;
    }
  }

  private async requireOrgRoot(orgId: string): Promise<{ id: string; name: string; slug: string; parentId: string | null; isInternal: boolean }> {
    const client = this.prisma.client as any;
    const row = await client.tenant.findUnique({ where: { id: orgId }, select: { id: true, name: true, slug: true, parentId: true, isInternal: true } });
    if (!row) throw new NotFoundException({ code: 'SUPPORT_ACCESS_ORG_NOT_FOUND', message: 'Organization not found.' });
    if (row.parentId) {
      throw new HttpException({ code: 'SUPPORT_ACCESS_NOT_AN_ORG', message: 'Support access is granted per organization, not per location.' }, HttpStatus.BAD_REQUEST);
    }
    return row;
  }

  private async assertScopeInOrg(rootId: string, scopeTenantIds: string[]): Promise<void> {
    if (scopeTenantIds.length === 0) return;
    const members = new Set([rootId, ...(await collectDescendantTenantIds((this.prisma.client as any).tenant, rootId))]);
    const stray = scopeTenantIds.filter((id) => !members.has(id));
    if (stray.length) {
      throw new HttpException({ code: 'SUPPORT_ACCESS_SCOPE_INVALID', message: 'Every location in the scope must belong to this organization.' }, HttpStatus.BAD_REQUEST);
    }
  }

  /** The people who decide: DISTRICT_ADMINs anywhere in the organisation, plus SCHOOL_ADMINs on the root itself (single-location owners). */
  async orgAdmins(rootId: string): Promise<Array<{ id: string; email: string; tenantId: string }>> {
    const client = this.prisma.client as any;
    const ids = [rootId, ...(await collectDescendantTenantIds(client.tenant, rootId))];
    const rows: any[] = await client.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        OR: [
          { tenantId: { in: ids }, role: AppRole.DISTRICT_ADMIN },
          { tenantId: rootId, role: AppRole.SCHOOL_ADMIN },
        ],
      },
      select: { id: true, email: true, tenantId: true },
    });
    return rows.filter((u) => typeof u.email === 'string' && !u.email.endsWith('.invalid'));
  }

  /** Is `user` one of the organisation's deciding admins? */
  async isOrgAdmin(user: Principal, rootId: string): Promise<boolean> {
    if (!user?.tenantId || !user.role) return false;
    const userRoot = await this.rootOf(user.tenantId);
    if (userRoot !== rootId) return false;
    if (user.role === AppRole.DISTRICT_ADMIN) return true;
    return user.role === AppRole.SCHOOL_ADMIN && user.tenantId === rootId;
  }

  private async notifyAdmins(org: { id: string; name: string; slug: string }, event: 'requested' | 'break-glass' | 'ended', grant: any): Promise<void> {
    const admins = await this.orgAdmins(org.id).catch(() => []);
    const link = `/settings/support-access`;
    const title =
      event === 'requested'
        ? 'VenueOS is asking for support access'
        : event === 'break-glass'
          ? 'VenueOS used emergency support access'
          : 'VenueOS support access has ended';
    const body =
      event === 'requested'
        ? `${grant.requestedByEmail ?? 'VenueOS support'} asked for access to ${org.name} for ${describeMinutes(grant.requestedDurationMinutes)}: "${grant.reason}". Approve or deny it in Settings → Support access.`
        : event === 'break-glass'
          ? `${grant.requestedByEmail ?? 'VenueOS support'} opened emergency access to ${org.name} until ${fmt(grant.expiresAt)}: "${grant.reason}". You can end it now in Settings → Support access.`
          : `VenueOS ended its support access to ${org.name}.`;
    for (const a of admins) {
      await this.notifications?.notify({
        tenantId: a.tenantId,
        userId: a.id,
        kind: 'INFO',
        title,
        body,
        link,
        dedupeKey: `support-access:${grant.id}:${event}:${a.id}`,
      });
    }
    if (!this.email || event === 'ended') return;
    for (const a of admins) {
      try {
        if (event === 'requested') {
          await this.email.sendSupportAccessRequested({
            to: a.email,
            orgName: org.name,
            tenantSlug: org.slug,
            requestedBy: grant.requestedByEmail ?? 'VenueOS support',
            reason: grant.reason ?? '',
            durationLabel: describeMinutes(grant.requestedDurationMinutes),
            scoped: (grant.scopeTenantIds ?? []).length > 0,
          });
        } else {
          await this.email.sendSupportAccessBreakGlass({
            to: a.email,
            orgName: org.name,
            tenantSlug: org.slug,
            openedBy: grant.requestedByEmail ?? 'VenueOS support',
            reason: grant.reason ?? '',
            expiresAt: grant.expiresAt,
          });
        }
      } catch (e: any) {
        this.logger.warn(`support-access ${event} email to ${a.email} failed: ${e?.message ?? e}`);
      }
    }
  }

  /** Tell the VenueOS side (every active super admin) that a customer decided or invited. In-app only. */
  private async notifyRequester(grant: any, outcome: 'approved' | 'denied'): Promise<void> {
    await this.notifyVenueOs(null, grant, outcome);
  }

  private async notifyVenueOs(org: { id: string; name: string } | null, grant: any, outcome: 'approved' | 'denied' | 'invited' = 'invited'): Promise<void> {
    try {
      const client = this.prisma.client as any;
      const orgRow = org ?? (await client.tenant.findUnique({ where: { id: grant.tenantId }, select: { id: true, name: true } }));
      const supers: any[] = await client.user.findMany({
        where: { role: AppRole.SUPER_ADMIN, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, tenantId: true },
      });
      const title =
        outcome === 'approved'
          ? `${orgRow?.name ?? 'A customer'} approved support access`
          : outcome === 'denied'
            ? `${orgRow?.name ?? 'A customer'} denied support access`
            : `${orgRow?.name ?? 'A customer'} gave VenueOS support access`;
      const body = grant.expiresAt ? `Access until ${fmt(grant.expiresAt)}.` : grant.note ?? undefined;
      for (const s of supers) {
        await this.notifications?.notify({
          tenantId: s.tenantId,
          userId: s.id,
          kind: 'INFO',
          title,
          body,
          link: `/super/customers/${grant.tenantId}`,
          dedupeKey: `support-access:${grant.id}:${outcome}:${s.id}`,
        });
      }
    } catch (e: any) {
      this.logger.warn(`could not notify VenueOS of ${outcome}: ${e?.message ?? e}`);
    }
  }
}

export function describeMinutes(minutes: number | null | undefined): string {
  if (!minutes) return 'an unspecified time';
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? '1 day' : `${d} days`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  return `${minutes} minutes`;
}

const fmt = (d: Date | string | null | undefined): string => {
  if (!d) return 'unknown';
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? 'unknown' : x.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
};

export type { GrantKind };
