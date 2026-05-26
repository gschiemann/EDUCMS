import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, BadRequestException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

function validatePassword(password: string): void {
  if (!password || password.length < 8) {
    throw new BadRequestException('Password must be at least 8 characters.');
  }
  if (password.length > 200) {
    throw new BadRequestException('Password is too long.');
  }
}

@Controller('api/v1/users')
@UseGuards(JwtAuthGuard, RbacGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async list(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const users = await this.prisma.client.user.findMany({
      where: { tenantId },
      // 2026-05-11 — return firstName/lastName so the team list can
      // show real names instead of email prefixes.
      select: { id: true, email: true, role: true, createdAt: true, firstName: true, lastName: true } as any,
      orderBy: { createdAt: 'desc' },
    });
    return users;
  }

  // 2026-05-11 — self-profile endpoints. Operator: "let's say Hi Greg
  // not gschiemann." Returns the caller's own profile + lets them
  // edit firstName / lastName. Any signed-in role can use these —
  // they only touch the caller's own row (resolved via req.user.id).
  // Restricted-viewer is also allowed to set their own name since
  // it's purely cosmetic and doesn't change permissions.
  @Get('me')
  async getMe(@Request() req: any) {
    const me = await this.prisma.client.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, role: true,
        firstName: true, lastName: true,
        canTriggerPanic: true, tenantId: true, createdAt: true,
      } as any,
    });
    if (!me) throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    return me;
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
      if (t.length > 80) throw new BadRequestException('Name too long (max 80 characters)');
      return t;
    };
    const data: any = {};
    if (body.firstName !== undefined) data.firstName = trim(body.firstName);
    if (body.lastName !== undefined) data.lastName = trim(body.lastName);
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update');
    }
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
      throw new BadRequestException('A valid email is required.');
    }
    validatePassword(body?.password);
    if (!body?.role || typeof body.role !== 'string') {
      throw new BadRequestException('Role is required.');
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
      if (t.length > 80) throw new BadRequestException('Name too long (max 80 characters)');
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

  @Put(':id/role')
  @RequireRoles(AppRole.SUPER_ADMIN)
  async updateRole(@Request() req: any, @Param('id') id: string, @Body() body: { role: string }) {
    const tenantId = req.user.tenantId;

    // CYCLE-1 BUG-005: even though this endpoint is gated to SUPER_ADMIN, the
    // role string was previously written into Prisma without enum validation.
    // A typo or a malicious caller riding a stolen SUPER_ADMIN session could
    // corrupt the role column. Validate against the assignable allowlist.
    if (!body?.role || typeof body.role !== 'string') {
      throw new BadRequestException('Role is required.');
    }
    assertCallerCanAssignRole(req.user.role, body.role);

    // Ensure user belongs to same tenant
    const user = await this.prisma.client.user.findFirst({
      where: { id, tenantId },
    });
    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    // CYCLE-4 auth-BUG-011: SUPER_ADMIN cannot strip another SUPER_ADMIN's
    // privileges. A SUPER_ADMIN may demote themselves (self-demote is
    // allowed — the caller is consenting to losing their own privileges).
    // But one SUPER_ADMIN cannot unilaterally take another SUPER_ADMIN's
    // role away — that would let a single compromised account knock out
    // every peer admin in the tenant.
    if (
      user.role === AppRole.SUPER_ADMIN &&
      user.id !== req.user.id &&
      body.role !== AppRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'SUPER_ADMIN accounts cannot demote another SUPER_ADMIN. The target user must self-demote.',
      );
    }

    // Role change + audit row atomically. "Who made this account an admin?"
    // must always be answerable; a privilege escalation with no record is
    // exactly the gap this closes.
    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      const u = await tx.user.update({
        where: { id },
        data: { role: body.role },
        select: { id: true, email: true, role: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req.user.id,
          action: 'USER_ROLE_CHANGED',
          targetType: 'user',
          targetId: id,
          details: JSON.stringify({ email: user.email, fromRole: user.role, toRole: body.role }),
        },
      });
      return u;
    });

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
   *   - JWT-claim staleness caveat: the user's CURRENT JWT keeps the
   *     old value until refresh / re-login. That's acceptable in v1
   *     because the bypass only widens AT login time, never tightens
   *     past it. To revoke immediately, the admin can also force a
   *     /auth/logout on the target user (Sprint 2+ feature) or the
   *     target user can sign out + back in. Documented in the
   *     emergency-system help doc.
   */
  @Put(':id/can-trigger-panic')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setCanTriggerPanic(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { canTriggerPanic: boolean },
  ) {
    if (typeof body?.canTriggerPanic !== 'boolean') {
      throw new BadRequestException('canTriggerPanic must be a boolean.');
    }
    const callerTenantId = req.user.tenantId;
    const isSuper = req.user.role === AppRole.SUPER_ADMIN;

    // Tenant scoping: SUPER_ADMIN may target any user; others are
    // confined to their own tenant. Mirrors the /:id/role endpoint.
    const target = await this.prisma.client.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, tenantId: true, canTriggerPanic: true } as any,
    });
    if (!target) throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    if (!isSuper && (target as any).tenantId !== callerTenantId) {
      throw new ForbiddenException('Target user is not in your tenant.');
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
      throw new ForbiddenException(
        'RESTRICTED_VIEWER cannot receive panic-trigger capability.',
      );
    }

    const auditTenantId = (target as any).tenantId || callerTenantId;
    const fromValue = !!(target as any).canTriggerPanic;
    const toValue = body.canTriggerPanic;

    // No-op if already at the desired value — still audit-log it so
    // a forensic timeline shows "admin attempted to flip but it was
    // already there". Cheap; the value is small.
    const updated = await this.prisma.client.$transaction(async (tx: any) => {
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

    return updated;
  }

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user.tenantId;

    // CYCLE-4 auth-BUG-013: error responses were returning 200 with
    // `{ error: '...' }` bodies, which let callers' status-code-only
    // checks swallow the failure. Standardize on HttpException so the
    // HTTP status matches the outcome.
    // Prevent self-deletion
    if (id === req.user.id) {
      throw new HttpException('Cannot delete your own account', HttpStatus.BAD_REQUEST);
    }

    const user = await this.prisma.client.user.findFirst({
      where: { id, tenantId },
    });
    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    // Delete + audit atomically so an account deletion always leaves a record
    // (captured BEFORE the row is gone, in the same transaction).
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
      await tx.user.delete({ where: { id } });
    });
    return { deleted: true };
  }
}
