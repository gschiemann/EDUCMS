import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, BadRequestException, ForbiddenException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import * as argon2 from 'argon2';
// auth-002 / BUG-005: role-escalation hardening. A caller can only
// assign roles strictly below their own rank. Shared with the
// onboarding invite / direct-create paths so the two cannot drift.
import { assertCallerCanAssignRole } from '../auth/role-assignment';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// P1-1 (2026-05-28) — privilege rank, HIGH→LOW. Used only to detect a
// role DOWNGRADE so we can revoke the target's live tokens on a
// tightening (never on a widening — a promotion already takes effect at
// the next privilege check that reads the live DB row, and revoking on
// promote would needlessly log the user out). Lower index = more
// privileged. An unknown role sorts to the bottom (least privileged) so
// any move INTO a known role from "unknown" is treated as a widening
// (no revoke), and any move to "unknown" is treated as a downgrade.
const ROLE_RANK: Record<string, number> = {
  [AppRole.SUPER_ADMIN]: 0,
  [AppRole.DISTRICT_ADMIN]: 1,
  [AppRole.SCHOOL_ADMIN]: 2,
  [AppRole.CONTRIBUTOR]: 3,
  [AppRole.RESTRICTED_VIEWER]: 4,
};

function isRoleDowngrade(fromRole: string, toRole: string): boolean {
  const from = ROLE_RANK[fromRole] ?? Number.MAX_SAFE_INTEGER;
  const to = ROLE_RANK[toRole] ?? Number.MAX_SAFE_INTEGER;
  // Higher rank number = less privileged. A downgrade is moving to a
  // strictly-less-privileged role.
  return to > from;
}

function validatePassword(password: string): void {
  if (!password || password.length < 8) {
    throw new BadRequestException({ code: 'USER_PASSWORD_TOO_SHORT', message: 'Password must be at least 8 characters.' });
  }
  if (password.length > 200) {
    throw new BadRequestException({ code: 'USER_PASSWORD_TOO_LONG', message: 'Password is too long.' });
  }
}

@Controller('api/v1/users')
@UseGuards(JwtAuthGuard, RbacGuard)
export class UsersController {
  private readonly logger = new Logger('UsersController');

  constructor(
    private readonly prisma: PrismaService,
    // P1-1 — RedisService is the per-user token-revocation store
    // (RealtimeModule is @Global, so no module wiring needed). Used to
    // burn a target user's live tokens the moment their privileges are
    // tightened. Optional-by-construction is unnecessary: every prod
    // boot has RealtimeModule, and the revoke path tolerates a missing
    // Redis publisher itself (see revokeUserTokens).
    private readonly redis: RedisService,
  ) {}

  /**
   * P1-1 (2026-05-28) — revoke ALL of a user's live JWTs after a
   * privilege TIGHTENING (role downgrade, canTriggerPanic→false).
   *
   * Why this exists: `role` + `canTriggerPanic` are baked into the JWT
   * claim (auth.service.ts) and read straight off the token by
   * jwt-auth.guard.ts / rbac.guard.ts on the emergency path — they are
   * never re-checked against the live DB row. So a demoted user, or one
   * whose panic capability was just turned off, keeps the elevated
   * capability until their token expires — up to 30 days with
   * rememberMe. This stamps a per-user "invalid-before" epoch in Redis;
   * the guard then rejects every token issued before now, across all of
   * that user's devices/sessions.
   *
   * Best-effort by design: a Redis hiccup must not make the role/panic
   * write fail (the DB row — the durable source of truth — already
   * committed, and the guard itself fails CLOSED on Redis errors, so a
   * Redis outage can't be the thing that lets a stale token through).
   * We log a warning so a broken revocation path is visible rather than
   * silent — the lesson from the 2026-05-21 safeguard-theater incident.
   */
  private async revokeUserTokens(userId: string, reason: string): Promise<void> {
    try {
      await this.redis.markUserTokensInvalid(userId);
    } catch (e: any) {
      this.logger.warn(
        `Token revocation for user ${userId} (${reason}) did not take: ${e?.message ?? e}. ` +
          `DB row is updated; stale tokens persist until expiry if Redis stays down.`,
      );
    }
  }

  /**
   * 2026-08-03 — THE ONE GATE for "may this caller act ON this account?"
   *
   * WHY THIS EXISTS. Demote, disable and delete were all `@RequireRoles(
   * SUPER_ADMIN)`. A district that fired a staff member could not cut off
   * their own employee's access — they had to phone the vendor. The
   * revocation machinery underneath (`markUserTokensInvalid`, the durable
   * revocation list, soft-delete) was built and correct; it was simply
   * unreachable by the people who actually need it. Rather than sprinkle
   * bespoke scope checks across three endpoints, every lifecycle action now
   * resolves its target through here.
   *
   * THE RULES, all of which must pass:
   *   1. the row exists and is not already soft-deleted;
   *   2. SELF is refused unless the endpoint explicitly opts in (`allowSelf`)
   *      — see `updateRole`, where self-demote is deliberately legal;
   *   3. TENANT SUBTREE — SUPER_ADMIN is cross-tenant by design; a
   *      DISTRICT_ADMIN reaches their own tenant plus any tenant whose
   *      `parentId` is their tenant (exactly the reach `createInvite` already
   *      grants for adding users, so firing mirrors hiring); everyone else is
   *      confined to their own tenant;
   *   4. RANK — `assertCallerCanAssignRole` (strictly below my own rank).
   *      Nobody may act on a PEER or a SUPERIOR. This is the same table the
   *      role-grant paths use, so "who can I fire" can never drift from "who
   *      can I hire". It also subsumes the old CYCLE-4 auth-BUG-011 rule
   *      (a SUPER_ADMIN cannot strip another SUPER_ADMIN) — SUPER_ADMIN is
   *      absent from its own assignable list, so a peer super-admin is
   *      refused here for every action, not just role changes.
   *
   * SELF is exempt from the rank check only (never from #1/#3), because a
   * self-action is consented to by definition; the `allowSelf` flag is what
   * decides whether the endpoint permits it at all.
   */
  private async loadManageableTarget(
    req: any,
    id: string,
    opts: { allowSelf?: boolean } = {},
  ): Promise<{ id: string; email: string; role: string; tenantId: string; status: string }> {
    const callerRole: string = req?.user?.role;
    const callerTenantId: string = req?.user?.tenantId;
    const callerId: string = req?.user?.id;

    // ten-ok: resolve-then-verify — the tenant subtree is asserted a few lines
    // below (403 on miss) and SUPER_ADMIN is cross-tenant by design, so the
    // lookup cannot be pre-scoped to the caller's tenant without breaking the
    // district→school reach this endpoint family needs.
    const target = await this.prisma.client.user.findFirst({
      where: { id, deletedAt: null } as any,
      select: { id: true, email: true, role: true, tenantId: true, status: true } as any,
    });
    if (!target) {
      throw new HttpException({ code: 'USER_NOT_FOUND', message: 'User not found' }, HttpStatus.NOT_FOUND);
    }

    const isSelf = !!callerId && (target as any).id === callerId;
    if (isSelf && !opts.allowSelf) {
      throw new HttpException(
        { code: 'USER_CANNOT_ACT_ON_SELF', message: 'You cannot do that to your own account.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (callerRole !== AppRole.SUPER_ADMIN && (target as any).tenantId !== callerTenantId) {
      let inSubtree = false;
      if (callerRole === AppRole.DISTRICT_ADMIN && (target as any).tenantId) {
        const t = await this.prisma.client.tenant.findUnique({
          where: { id: (target as any).tenantId },
          select: { parentId: true } as any,
        });
        inSubtree = !!t && (t as any).parentId === callerTenantId;
      }
      if (!inSubtree) {
        throw new ForbiddenException({ code: 'USER_NOT_IN_TENANT', message: 'Target user is not in your tenant.' });
      }
    }

    // Rank last, so a cross-tenant probe cannot use the (more specific) rank
    // error to learn a stranger's role.
    if (!isSelf) assertCallerCanAssignRole(callerRole, (target as any).role);

    return target as any;
  }

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async list(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const users = await this.prisma.client.user.findMany({
      where: { tenantId, deletedAt: null } as any,
      // 2026-05-11 — return firstName/lastName so the team list can
      // show real names instead of email prefixes.
      //
      // 2026-08-03 — `mfaRequired` + whether they have actually enrolled.
      // ACC-03 made `mfaRequired` a real login gate but nothing returned it,
      // so the Team Members list could not show (or set) the policy. The
      // enrolled flag is derived, never the timestamp itself: an admin has no
      // business knowing WHEN a colleague set up their authenticator, only
      // that the policy is satisfied.
      //
      // 2026-08-03 — `status`, so the Team Members list can show (and toggle)
      // who is disabled. Without it the new PUT /:id/disabled control would be
      // a button with no state to render.
      select: {
        id: true, email: true, role: true, createdAt: true,
        firstName: true, lastName: true,
        mfaRequired: true, mfaTotpVerifiedAt: true,
        status: true,
      } as any,
      orderBy: { createdAt: 'desc' },
    });
    return users.map((u: any) => {
      const { mfaTotpVerifiedAt, ...rest } = u;
      return { ...rest, mfaEnrolled: !!mfaTotpVerifiedAt };
    });
  }

  // 2026-05-11 — self-profile endpoints. Operator: "let's say Hi Greg
  // not gschiemann." Returns the caller's own profile + lets them
  // edit firstName / lastName. Any signed-in role can use these —
  // they only touch the caller's own row (resolved via req.user.id).
  // Restricted-viewer is also allowed to set their own name since
  // it's purely cosmetic and doesn't change permissions.
  @Get('me')
  async getMe(@Request() req: any) {
    // ten-ok: identity SELF-lookup — id IS the authenticated JWT principal; no narrower scope exists
    const me = await this.prisma.client.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, role: true,
        firstName: true, lastName: true,
        canTriggerPanic: true, tenantId: true, createdAt: true,
      } as any,
    });
    if (!me) throw new HttpException({ code: 'USER_NOT_FOUND', message: 'User not found' }, HttpStatus.NOT_FOUND);
    // 2026-06-01 — resolve the ACTIVE tenant from the JWT claim
    // (req.user.tenantId), NOT the user's home tenant relation. For a
    // multi-tenant user who switched accounts, this is the tenant they're
    // VIEWING. The flattened tenantVertical / tenantName / tenantSlug
    // mirror the login + switch response shapes so the dashboard's
    // ProfileHydrator can self-heal a stale cached session to the right
    // industry (else the UI would show "school" for a gym until logout).
    const activeTenantId: string = (req.user?.tenantId as string) || (me as any).tenantId;
    const tenant = activeTenantId
      ? await this.prisma.client.tenant.findUnique({
          where: { id: activeTenantId },
          select: { vertical: true, name: true, slug: true } as any,
        })
      : null;
    return {
      ...me,
      tenantId: activeTenantId,
      tenantVertical: (tenant as any)?.vertical || 'K12',
      tenantName: (tenant as any)?.name ?? null,
      tenantSlug: (tenant as any)?.slug ?? activeTenantId,
    };
  }

  @Put('me')
  async updateMe(
    @Request() req: any,
    @Body() body: { firstName?: string | null; lastName?: string | null },
  ) {
    // Cap names at 80 chars — generous, mostly protects the DB
    // column from a runaway client. Empty string → null so the
    // greeting falls back to email-prefix cleanly.
    const trim = (v: unknown): string | null => {
      if (typeof v !== 'string') return null;
      const t = v.trim();
      if (t.length === 0) return null;
      if (t.length > 80) throw new BadRequestException({ code: 'USER_NAME_TOO_LONG', message: 'Name too long (max 80 characters)' });
      return t;
    };
    const data: any = {};
    if (body.firstName !== undefined) data.firstName = trim(body.firstName);
    if (body.lastName !== undefined) data.lastName = trim(body.lastName);
    if (Object.keys(data).length === 0) {
      throw new BadRequestException({ code: 'USER_NOTHING_TO_UPDATE', message: 'Nothing to update' });
    }
    // ten-ok: identity SELF-update — only touches the authenticated JWT principal's own row
    const updated = await this.prisma.client.user.update({
      where: { id: req.user.id },
      data,
      select: {
        id: true, email: true, role: true,
        firstName: true, lastName: true,
        canTriggerPanic: true, tenantId: true,
      } as any,
    });
    return updated;
  }

  @Post()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  async create(@Request() req: any, @Body() body: { email: string; password: string; role: string; firstName?: string; lastName?: string }) {
    const tenantId = req.user.tenantId;

    // CYCLE-1 auth-002: validate inputs and gate the role assignment so a
    // DISTRICT_ADMIN cannot escalate by posting role: 'SUPER_ADMIN'.
    const email = (body?.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) {
      throw new BadRequestException({ code: 'USER_EMAIL_INVALID', message: 'A valid email is required.' });
    }
    validatePassword(body?.password);
    if (!body?.role || typeof body.role !== 'string') {
      throw new BadRequestException({ code: 'USER_ROLE_REQUIRED', message: 'Role is required.' });
    }
    assertCallerCanAssignRole(req.user.role, body.role);

    const passwordHash = await argon2.hash(body.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    // 2026-05-11 — names captured at create time so the dashboard
    // greets new admins by name from day one instead of "Hi Pjones."
    const trim = (v: unknown): string | null => {
      if (typeof v !== 'string') return null;
      const t = v.trim();
      if (!t) return null;
      if (t.length > 80) throw new BadRequestException({ code: 'USER_NAME_TOO_LONG', message: 'Name too long (max 80 characters)' });
      return t;
    };

    // Create the user AND its immutable audit row atomically — a privileged
    // action (account + role grant) must never land without a forensic trail,
    // and the trail must not exist for a user that failed to create.
    const user = await this.prisma.client.$transaction(async (tx: any) => {
      const u = await tx.user.create({
        data: {
          tenantId,
          email,
          passwordHash,
          role: body.role,
          firstName: trim(body.firstName),
          lastName: trim(body.lastName),
        } as any,
        select: { id: true, email: true, role: true, createdAt: true, firstName: true, lastName: true } as any,
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req.user.id,
          action: 'USER_CREATED',
          targetType: 'user',
          targetId: u.id,
          details: JSON.stringify({ email, role: body.role, byRole: req.user.role }),
        },
      });
      return u;
    });

    return user;
  }

  /**
   * 2026-08-03 — DISTRICT_ADMIN / SCHOOL_ADMIN can now demote inside their own
   * tenant subtree. This was SUPER_ADMIN-only, which meant a district could not
   * strip a departing employee's privileges without phoning the vendor.
   *
   * Two independent gates, both enforced:
   *   - `loadManageableTarget` — the target must be in the caller's subtree AND
   *     strictly below the caller's rank (so nobody demotes a peer or a
   *     superior). Self is permitted here because self-demote is a legitimate,
   *     consented action; it is the ONE lifecycle endpoint that allows it.
   *   - `assertCallerCanAssignRole(callerRole, body.role)` — the NEW role must
   *     also be strictly below the caller's rank, so this cannot be used to
   *     escalate (a DISTRICT_ADMIN posting role:'SUPER_ADMIN' is refused, on
   *     themselves as well as on anyone else).
   */
  @Put(':id/role')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async updateRole(@Request() req: any, @Param('id') id: string, @Body() body: { role: string }) {
    // CYCLE-1 BUG-005: the role string was previously written into Prisma
    // without enum validation. A typo or a malicious caller riding a stolen
    // admin session could corrupt the role column. Validate against the
    // assignable allowlist.
    if (!body?.role || typeof body.role !== 'string') {
      throw new BadRequestException({ code: 'USER_ROLE_REQUIRED', message: 'Role is required.' });
    }
    assertCallerCanAssignRole(req.user.role, body.role);

    // Subtree + rank gate. Self-demote stays legal (CYCLE-4 auth-BUG-011: a
    // SUPER_ADMIN may drop their own privileges, but one SUPER_ADMIN can never
    // strip a peer's — that rule is now enforced generically by the rank check
    // inside the helper, for every role and every lifecycle action).
    const user = await this.loadManageableTarget(req, id, { allowSelf: true });
    // The user's OWN tenant owns this write and its audit row — not the
    // caller's, which differs when a DISTRICT_ADMIN acts on a child school.
    const tenantId = user.tenantId;
    // Snapshot the BEFORE role: it is what the audit row and the
    // downgrade-detection below both mean, and reading it after the write has
    // run is how a "revoke on tightening" check silently stops firing.
    const fromRole = user.role;

    // Role change + audit row atomically. "Who made this account an admin?"
    // must always be answerable; a privilege escalation with no record is
    // exactly the gap this closes.
    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      // Scoped by the TARGET's tenant — defense-in-depth on a PRIVILEGE
      // write (the same {id, tenantId} pair verified above; updateMany
      // because a compound {id, tenantId} isn't a Prisma unique input).
      const cnt = await tx.user.updateMany({
        where: { id, tenantId },
        data: { role: body.role },
      });
      if (cnt.count !== 1) {
        throw new HttpException({ code: 'USER_NOT_FOUND', message: 'User not found' }, HttpStatus.NOT_FOUND);
      }
      const u = { id, email: user.email, role: body.role };
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req.user.id,
          action: 'USER_ROLE_CHANGED',
          targetType: 'user',
          targetId: id,
          details: JSON.stringify({ email: user.email, fromRole, toRole: body.role }),
        },
      });
      return u;
    });

    // P1-1 — on a DOWNGRADE only, revoke the target's live tokens so the
    // demotion takes effect immediately instead of lingering in their JWT
    // claim for up to 30 days (rememberMe ceiling). A widening (promotion)
    // is NOT revoked: the new privileges flow in at next login, and force-
    // logging-out a just-promoted user would be pure annoyance.
    if (isRoleDowngrade(fromRole, body.role)) {
      await this.revokeUserTokens(id, `role downgrade ${fromRole}→${body.role}`);
    }

    return updated;
  }

  /**
   * 2026-05-26 audit fix — close the "documented-but-unwritable
   * canTriggerPanic" gap.
   *
   * CLAUDE.md "Emergency System" section says: an admin in the
   * dashboard (Settings → Team Members → toggle "Can trigger panic")
   * grants a non-admin user (receptionist, security guard, nurse,
   * physical panic-button operator) the ability to fire emergency
   * triggers WITHOUT meeting the @RequireRoles requirement on
   * /emergency/trigger. The bypass path in RbacGuard
   * (apps/api/src/auth/rbac.guard.ts:69) correctly reads
   * `typedUser.canTriggerPanic` and grants when true — but no writer
   * endpoint existed, so the field was always `false` in the JWT and
   * the bypass was UNREACHABLE in production. Documented capability
   * with no writer = audit theater. This endpoint is the missing
   * writer.
   *
   * Rules:
   *   - Only DISTRICT_ADMIN / SCHOOL_ADMIN / SUPER_ADMIN can flip
   *     the flag (same as /:id/role).
   *   - Target must belong to the caller's tenant (RBAC guard +
   *     tenantId scoping).
   *   - RESTRICTED_VIEWER is read-only by definition — flipping the
   *     flag on a RESTRICTED_VIEWER is rejected to keep the
   *     defense-in-depth invariant from RbacGuard intact.
   *   - SUPER_ADMIN can act cross-tenant; everyone else is tenant-
   *     scoped via the user lookup.
   *   - Every flip writes an immutable AuditLog row with
   *     before/after so privilege creep is detectable post-hoc.
   *   - P1-1 (2026-05-28) — TIGHTENING now revokes immediately. When
   *     the flag is set to FALSE we burn the target's live tokens via
   *     RedisService.markUserTokensInvalid, so the just-removed panic
   *     capability stops working on the next request instead of
   *     lingering in the user's JWT claim for up to 30 days
   *     (rememberMe). Setting the flag to TRUE is a WIDENING and is NOT
   *     revoked — the new capability takes effect at their next login,
   *     and force-logging-out a user we just empowered would be pointless.
   */
  @Put(':id/can-trigger-panic')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setCanTriggerPanic(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { canTriggerPanic: boolean },
  ) {
    if (typeof body?.canTriggerPanic !== 'boolean') {
      throw new BadRequestException({ code: 'USER_CAN_TRIGGER_PANIC_INVALID', message: 'canTriggerPanic must be a boolean.' });
    }
    const callerTenantId = req.user.tenantId;
    const isSuper = req.user.role === AppRole.SUPER_ADMIN;

    // Tenant scoping: SUPER_ADMIN may target any user; others are
    // confined to their own tenant. Mirrors the /:id/role endpoint.
    // ten-ok: resolve-then-verify — target tenant asserted with 403 directly below; SUPER_ADMIN cross-tenant by design
    const target = await this.prisma.client.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, tenantId: true, canTriggerPanic: true } as any,
    });
    if (!target) throw new HttpException({ code: 'USER_NOT_FOUND', message: 'User not found' }, HttpStatus.NOT_FOUND);
    if (!isSuper && (target as any).tenantId !== callerTenantId) {
      throw new ForbiddenException({ code: 'USER_NOT_IN_TENANT', message: 'Target user is not in your tenant.' });
    }

    // Defense-in-depth: never let a RESTRICTED_VIEWER carry the
    // bypass flag, regardless of how they got it. RbacGuard already
    // refuses the bypass for this role at request time
    // (rbac.guard.ts:72), but storing `canTriggerPanic=true` on a
    // RESTRICTED_VIEWER would be a footgun if that defense ever
    // regressed — refuse at the writer too.
    if (
      body.canTriggerPanic &&
      (target as any).role === AppRole.RESTRICTED_VIEWER
    ) {
      throw new ForbiddenException({ code: 'USER_RESTRICTED_VIEWER_PANIC_FORBIDDEN', message: 'RESTRICTED_VIEWER cannot receive panic-trigger capability.' });
    }

    const auditTenantId = (target as any).tenantId || callerTenantId;
    const fromValue = !!(target as any).canTriggerPanic;
    const toValue = body.canTriggerPanic;

    // No-op if already at the desired value — still audit-log it so
    // a forensic timeline shows "admin attempted to flip but it was
    // already there". Cheap; the value is small.
    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      // ten-ok: write follows the resolve-then-verify above (403 on tenant mismatch); SUPER_ADMIN cross-tenant by design
      const u = await tx.user.update({
        where: { id },
        data: { canTriggerPanic: toValue } as any,
        select: { id: true, email: true, role: true, canTriggerPanic: true } as any,
      });
      await tx.auditLog.create({
        data: {
          tenantId: auditTenantId,
          userId: req.user.id,
          action: 'USER_CAN_TRIGGER_PANIC_CHANGED',
          targetType: 'user',
          targetId: id,
          details: JSON.stringify({
            email: (target as any).email,
            fromValue,
            toValue,
            byTenant: callerTenantId,
          }),
        },
      });
      return u;
    });

    // P1-1 — capability REMOVED (true→false) is a tightening: revoke the
    // target's live tokens so the stale `canTriggerPanic:true` claim
    // can't keep firing /emergency/trigger for up to 30 days. Only act
    // on an actual transition (skip a no-op false→false flip — nothing
    // to revoke, and we'd needlessly churn the Redis marker).
    if (fromValue && !toValue) {
      await this.revokeUserTokens(id, 'canTriggerPanic removed');
    }

    return updated;
  }

  /**
   * ACC-03 follow-up (2026-08-03) — the missing WRITER for `User.mfaRequired`.
   *
   * `mfaRequired` shipped as a schema column with an "admin can force 2FA"
   * story and no reader; ACC-03 (2026-08-01) made `AuthService.login` enforce
   * it. But nothing has ever WRITTEN it, so the enforcement was unreachable —
   * and the moment anyone set it by hand (a script, Prisma Studio) the target
   * had no way to satisfy it, because /auth/mfa/enroll needs the very session
   * the policy withholds. This endpoint plus the login page's
   * `mfaEnrollmentRequired` step are the two halves that make the flag a
   * CONTROL instead of a lockout. Do not ship one without the other.
   *
   * Rules:
   *   - DISTRICT_ADMIN / SCHOOL_ADMIN / SUPER_ADMIN only (same as
   *     /:id/can-trigger-panic);
   *   - the caller must OUTRANK the target (`assertCallerCanAssignRole`).
   *     Forcing a login policy onto an account is a privilege action over
   *     that account, so it obeys the same strictly-below-my-own-rank table
   *     as granting a role. It also means no admin can force the policy onto
   *     a PEER or onto themselves — self-service 2FA is Settings → Security,
   *     which needs no privilege at all;
   *   - target must be in the caller's tenant (SUPER_ADMIN is cross-tenant,
   *     matching /:id/can-trigger-panic);
   *   - every flip writes an immutable AuditLog row with before/after.
   *
   * TURNING IT ON REVOKES the target's live sessions. That is deliberate: a
   * policy that only takes effect at their next natural login leaves a
   * possibly-compromised session running for up to 30 days (rememberMe), so
   * the tightening would not actually tighten anything. Turning it OFF is a
   * widening and is NOT revoked — same asymmetry as the role and panic-flag
   * endpoints above.
   */
  @Put(':id/mfa-required')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setMfaRequired(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { mfaRequired: boolean },
  ) {
    if (typeof body?.mfaRequired !== 'boolean') {
      throw new BadRequestException({
        code: 'USER_MFA_REQUIRED_INVALID',
        message: 'mfaRequired must be a boolean.',
      });
    }
    const callerTenantId = req.user.tenantId;
    const isSuper = req.user.role === AppRole.SUPER_ADMIN;

    // ten-ok: resolve-then-verify — target tenant asserted with 403 directly below; SUPER_ADMIN cross-tenant by design
    const target = await this.prisma.client.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, tenantId: true, mfaRequired: true } as any,
    });
    if (!target) {
      throw new HttpException({ code: 'USER_NOT_FOUND', message: 'User not found' }, HttpStatus.NOT_FOUND);
    }
    if (!isSuper && (target as any).tenantId !== callerTenantId) {
      throw new ForbiddenException({ code: 'USER_NOT_IN_TENANT', message: 'Target user is not in your tenant.' });
    }

    // Rank gate. Throws 403 naming both roles, which is the message the UI
    // surfaces — so an admin who tries it on a peer learns why in one read.
    assertCallerCanAssignRole(req.user.role, (target as any).role);

    const fromValue = !!(target as any).mfaRequired;
    const toValue = body.mfaRequired;

    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      // ten-ok: write follows the resolve-then-verify above (403 on tenant mismatch); SUPER_ADMIN cross-tenant by design
      const u = await tx.user.update({
        where: { id },
        data: { mfaRequired: toValue } as any,
        select: { id: true, email: true, role: true, mfaRequired: true } as any,
      });
      await tx.auditLog.create({
        data: {
          tenantId: (target as any).tenantId || callerTenantId,
          userId: req.user.id,
          action: 'USER_MFA_REQUIRED_CHANGED',
          targetType: 'user',
          targetId: id,
          details: JSON.stringify({
            email: (target as any).email,
            fromValue,
            toValue,
            byRole: req.user.role,
            byTenant: callerTenantId,
          }),
        },
      });
      return u;
    });

    if (!fromValue && toValue) {
      await this.revokeUserTokens(id, 'mfaRequired enabled');
    }

    return updated;
  }

  /**
   * 2026-08-03 — "our admin can't fire an employee", the reversible half.
   *
   * Delete is destructive and irreversible from the UI; DISABLE is the control
   * an operator actually reaches for when someone leaves, goes on leave, or is
   * under investigation. It was missing entirely: `User.status` gates login
   * (`AuthService.validateUser` refuses anything that is not `ACTIVE`) but
   * nothing outside the invite flow had ever written it.
   *
   * DISABLING IS A REAL CUT-OFF, not a display flag. Blocking login alone
   * would leave an already-issued JWT working for up to 30 days (the
   * rememberMe ceiling), so turning it on ALSO burns every live session via
   * the durable revocation list. Re-enabling is a widening and is not
   * revoked — same asymmetry as the role / panic / mfa endpoints.
   *
   * Only the ACTIVE ⇄ DISABLED pair is allowed. An `INVITED` row is refused in
   * both directions on purpose: "enabling" one would flip it to ACTIVE while
   * it still carries the random placeholder password from invite creation,
   * turning a lifecycle button into an account in an unknown credential state.
   * Those users are cancelled by deleting them or letting the invite lapse.
   */
  @Put(':id/disabled')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setDisabled(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { disabled: boolean },
  ) {
    if (typeof body?.disabled !== 'boolean') {
      throw new BadRequestException({ code: 'USER_DISABLED_INVALID', message: 'disabled must be a boolean.' });
    }
    // Self is refused: an admin disabling themselves is always a mistake, and
    // it can strand a single-admin tenant with nobody able to re-enable them.
    const target = await this.loadManageableTarget(req, id);

    const fromStatus = target.status || 'ACTIVE';
    const toStatus = body.disabled ? 'DISABLED' : 'ACTIVE';
    if (fromStatus !== 'ACTIVE' && fromStatus !== 'DISABLED') {
      throw new BadRequestException({
        code: 'USER_STATUS_NOT_TOGGLEABLE',
        message: `This account is ${fromStatus.toLowerCase()} and cannot be enabled or disabled. Remove them instead.`,
      });
    }
    const tenantId = target.tenantId;

    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      // Tenant-scoped write (defense-in-depth; the audit row rolls back if the
      // verified row moved between check and write).
      const cnt = await tx.user.updateMany({
        where: { id, tenantId },
        data: { status: toStatus } as any,
      });
      if (cnt.count !== 1) {
        throw new HttpException({ code: 'USER_NOT_FOUND', message: 'User not found' }, HttpStatus.NOT_FOUND);
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req.user.id,
          action: body.disabled ? 'USER_DISABLED' : 'USER_ENABLED',
          targetType: 'user',
          targetId: id,
          details: JSON.stringify({
            email: target.email,
            role: target.role,
            fromStatus,
            toStatus,
            byRole: req.user.role,
            byTenant: req.user.tenantId,
          }),
        },
      });
      return { id, email: target.email, role: target.role, status: toStatus };
    });

    // TIGHTENING → revoke. Without this, `status` would only be consulted at
    // the next login and an existing token would keep working for up to 30
    // days — i.e. the "fire this person" button would not fire anyone.
    if (body.disabled) {
      await this.revokeUserTokens(id, 'account disabled');
    }

    return updated;
  }

  /**
   * 2026-08-03 — opened to DISTRICT_ADMIN / SCHOOL_ADMIN. Same subtree + rank
   * gate as demote/disable (`loadManageableTarget`): own tenant, or a child
   * school for a DISTRICT_ADMIN, and strictly below the caller's own rank.
   */
  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    // CYCLE-4 auth-BUG-013: error responses were returning 200 with
    // `{ error: '...' }` bodies, which let callers' status-code-only
    // checks swallow the failure. Standardize on HttpException so the
    // HTTP status matches the outcome.
    // Prevent self-deletion (kept ahead of the shared gate so the long-standing
    // USER_CANNOT_DELETE_SELF code keeps its exact meaning for API clients).
    if (id === req.user.id) {
      throw new HttpException({ code: 'USER_CANNOT_DELETE_SELF', message: 'Cannot delete your own account' }, HttpStatus.BAD_REQUEST);
    }

    const user = await this.loadManageableTarget(req, id);
    // The deleted user's OWN tenant owns the write + the audit row.
    const tenantId = user.tenantId;

    // Soft-delete + audit atomically. A hard delete 500'd on any user with
    // history (3 required User relations default to FK Restrict, and the
    // audit_logs userId relation can't SetNull because audit_logs has an
    // immutability trigger). Soft-delete retains the row so every FK reference
    // and the audit trail stay intact; we anonymize the email to free the
    // @unique slot for re-invite and stamp deletedAt so the list + login
    // exclude it. (Wave 2 — full-company audit P1.)
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req.user.id,
          action: 'USER_DELETED',
          targetType: 'user',
          targetId: id,
          details: JSON.stringify({ email: user.email, role: user.role }),
        },
      });
      // Tenant-scoped soft-delete (defense-in-depth; the audit row above
      // rolls back if the verified row vanished between check and write).
      const cnt = await tx.user.updateMany({
        where: { id, tenantId },
        data: {
          deletedAt: new Date(),
          email: `deleted+${id}@deleted.local`,
        } as any,
      });
      if (cnt.count !== 1) {
        throw new HttpException({ code: 'USER_NOT_FOUND', message: 'User not found' }, HttpStatus.NOT_FOUND);
      }
    });
    // Burn the deleted user's live sessions immediately. Best-effort: the row
    // is already soft-deleted and the email freed, so they cannot re-login even
    // if this Redis call can't run.
    try {
      await this.redis.markUserTokensInvalid(id);
    } catch (e) {
      this.logger.warn(
        `markUserTokensInvalid failed for deleted user ${id}: ${e instanceof Error ? e.message : e}`,
      );
    }
    return { deleted: true };
  }
}
