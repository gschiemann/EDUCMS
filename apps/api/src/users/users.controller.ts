import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, BadRequestException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import * as argon2 from 'argon2';

// CYCLE-1 auth-002 / BUG-005: role escalation hardening.
// Mirrors the pattern in onboarding.service.ts (ALLOWED_INVITE_ROLES + isValidEmail
// + validatePassword). Roles are validated against a per-caller allowlist so a
// DISTRICT_ADMIN cannot post role: 'SUPER_ADMIN' into Prisma directly.
const ASSIGNABLE_ROLES_BY_CALLER: Record<string, string[]> = {
  [AppRole.SUPER_ADMIN]: [
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  ],
  [AppRole.DISTRICT_ADMIN]: [
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  ],
  [AppRole.SCHOOL_ADMIN]: [
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  ],
};

function assertCallerCanAssignRole(callerRole: string, targetRole: string): void {
  const allowed = ASSIGNABLE_ROLES_BY_CALLER[callerRole] || [];
  if (!allowed.includes(targetRole)) {
    throw new ForbiddenException(
      `Your role (${callerRole}) cannot assign role '${targetRole}'. Allowed: ${allowed.join(', ') || 'none'}`,
    );
  }
}

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

    const user = await this.prisma.client.user.create({
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

    const updated = await this.prisma.client.user.update({
      where: { id },
      data: { role: body.role },
      select: { id: true, email: true, role: true },
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

    await this.prisma.client.user.delete({ where: { id } });
    return { deleted: true };
  }
}
