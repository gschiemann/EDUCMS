import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AuthService } from '../auth/auth.service';
import { SessionRefreshService } from '../auth/session-refresh.service';
import { EmailService } from '../email/email.service';
import { accountHasNoOwnPassword, verifyReauthPassword } from '../auth/password-reauth';
import { ASSIGNABLE_ROLES_BY_CALLER } from '../auth/role-assignment';
import { clientIpFromRequest } from '../security/client-ip';
import { requireSecret } from '../security/required-secret';
import {
  MFA_EMAIL_CODE_TTL_MS,
  generateEmailCode,
  hashClientIp,
  hashEmailCode,
  normalizeEmailCode,
} from '../auth/mfa-email-code';
import {
  SETUP_EMAIL_CODE_ACCOUNT_WINDOW_MS,
  SETUP_EMAIL_CODE_SENDS_PER_ACCOUNT,
  adminEmailChangeChallengeHash,
  emailOwnershipProofRequired,
} from '../auth/setup-email-verification';
import { claimEmailCodeAttempt, spendEmailCode } from '../auth/email-code-claim';
import {
  SETUP_LINK_TTL_MS,
  generateSetupLinkToken,
  hashSetupLinkToken,
  setupLinkState,
  setupLinkUrl,
} from '../auth/account-setup-link';
import { loadManageableTarget, manageableTenantIds, type ManageableTarget } from './manageable-target';

/** Same bounded shape every credential endpoint validates (EmailString). */
function normalizeNewEmail(raw: unknown): string {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException({ code: 'USER_EMAIL_INVALID', message: 'Enter a valid email address.' });
  }
  return email;
}

type Actor = { id: string; email: string; firstName: string | null; lastName: string | null; passwordHash: string };

/**
 * ACCOUNT ADMINISTRATION (2026-10-10) — two things an organisation's admins
 * could not do for the people they manage:
 *
 *  1. CHANGE SOMEONE'S SIGN-IN EMAIL. A mistyped address stranded every
 *     password reset and emailed code, and `PUT /users/me` only changes names.
 *     SUPER_ADMIN may change anyone's; DISTRICT_ADMIN / SCHOOL_ADMIN only
 *     accounts in their own organisation / locations and strictly below their
 *     rank — the `loadManageableTarget` gate every lifecycle route uses. When
 *     this deploy can reach arbitrary inboxes the NEW address must be proven
 *     with a 6-digit code first (the same machinery and mode switch as
 *     first-login setup); otherwise the change applies directly and the
 *     response says it was not verified.
 *
 *  2. ONE-TIME SETUP LINKS for accounts still on provisioning starter
 *     credentials (see auth/account-setup-link.ts).
 *
 * Every route here needs the ACTOR's own password (step-up, checked BEFORE
 * the target is resolved so a stolen session learns nothing — the
 * `POST :id/mfa/reset` rule), answers 404 for an account out of scope, and a
 * wrong password is 403, never 401 (the dashboard signs the operator out on
 * any 401). Separate from UsersController so that controller's constructor —
 * which a dozen specs build positionally — does not change.
 */
@Controller('api/v1/users')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AccountAdminController {
  private readonly logger = new Logger('AccountAdminController');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sessions: SessionRefreshService,
    private readonly email: EmailService,
    private readonly auth: AuthService,
  ) {}

  // ── shared steps ────────────────────────────────────────────────────────

  /** The actor's own row + the password step-up. Refusals are audited. */
  private async stepUp(req: any, password: unknown, action: string, targetId: string | null): Promise<Actor> {
    const actorId: string = req?.user?.id;
    const pw = typeof password === 'string' ? password : '';
    if (!pw || pw.length > 256) {
      throw new BadRequestException({
        code: 'ACCOUNT_ADMIN_PASSWORD_REQUIRED',
        message: 'Enter your own password to confirm this change.',
      });
    }
    // ten-ok: identity SELF-lookup — id IS the authenticated JWT principal; the step-up
    // can only ever read the caller's own credential
    const actor = await this.prisma.client.user.findUnique({
      where: { id: actorId },
      select: { id: true, email: true, firstName: true, lastName: true, passwordHash: true },
    });
    if (!actor) throw new HttpException({ code: 'USER_NOT_FOUND', message: 'User not found' }, HttpStatus.NOT_FOUND);
    if (accountHasNoOwnPassword(actor.passwordHash)) {
      await this.auditDenied(req, action, targetId, 'actor_has_no_password');
      throw new HttpException(
        {
          code: 'PASSWORD_REQUIRED',
          message:
            'Your account signs in through your identity provider and has no password to confirm with. ' +
            'Ask an administrator who signs in with a password.',
        },
        HttpStatus.CONFLICT,
      );
    }
    if (!(await verifyReauthPassword(actor.passwordHash, pw))) {
      await this.auditDenied(req, action, targetId, 'bad_password');
      // 403, never 401 — see the class docblock.
      throw new ForbiddenException({ code: 'ACCOUNT_ADMIN_BAD_PASSWORD', message: 'Password is incorrect.' });
    }
    return actor as Actor;
  }

  private async target(req: any, id: string, action: string): Promise<ManageableTarget> {
    try {
      return await loadManageableTarget(this.prisma.client, req, id, { notFoundOnScopeMiss: true });
    } catch (e: any) {
      const status = typeof e?.getStatus === 'function' ? e.getStatus() : 0;
      await this.auditDenied(req, action, id, status === HttpStatus.NOT_FOUND ? 'not_found_or_out_of_scope' : 'rank_or_self');
      throw e;
    }
  }

  /** Both session stores, best-effort and never silent (the 2026-05-21 lesson). */
  private async endSessions(userId: string, reason: string): Promise<boolean> {
    let ok = true;
    try {
      await this.redis.markUserTokensInvalid(userId);
    } catch (e: any) {
      ok = false;
      this.logger.warn(`Access-token revoke for ${userId} (${reason}) did not take: ${e?.message ?? e}`);
    }
    try {
      await this.sessions.revokeAllForUser(userId, reason);
    } catch (e: any) {
      ok = false;
      this.logger.warn(`Durable session revoke for ${userId} (${reason}) did not take: ${e?.message ?? e}`);
    }
    return ok;
  }

  private displayName(a: { firstName?: string | null; lastName?: string | null; email: string }): string {
    const name = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
    return name || a.email;
  }

  private async auditDenied(req: any, action: string, targetId: string | null, reason: string): Promise<void> {
    const tenantId: string | undefined = req?.user?.tenantId;
    if (!tenantId) return;
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: req?.user?.id ?? null,
          action: `${action}_DENIED`,
          targetType: 'user',
          targetId,
          details: JSON.stringify({ reason, byRole: req?.user?.role, ip: clientIpFromRequest(req) }),
        },
      });
    } catch (e: any) {
      this.logger.warn(`audit(${action}_DENIED) failed: ${e?.message ?? e}`);
    }
  }

  private codeSecret(): string {
    return requireSecret('JWT_SECRET', { devFallback: 'dev_only_jwt_secret_CHANGE_ME' });
  }

  /** What an email change may not do, checked against the LIVE target row. */
  private async assertEmailChangeable(target: ManageableTarget, email: string): Promise<{ mustSetupCredentials: boolean }> {
    if (target.status === 'INVITED') {
      throw new ConflictException({
        code: 'USER_EMAIL_CHANGE_INVITED',
        message: 'This person has not accepted their invitation yet. Remove them and invite the right address instead.',
      });
    }
    // ten-ok: the target was just resolved and scope-checked by loadManageableTarget
    const live = await this.prisma.client.user.findFirst({
      where: { id: target.id, tenantId: target.tenantId, deletedAt: null } as any,
      select: { mustSetupCredentials: true },
    });
    if (live?.mustSetupCredentials) {
      throw new ConflictException({
        code: 'USER_EMAIL_CHANGE_SETUP_PENDING',
        message:
          'This account has not been set up yet — its owner chooses their own email at first sign-in. ' +
          'Send them a setup link instead.',
      });
    }
    if (email === target.email.trim().toLowerCase()) {
      throw new BadRequestException({ code: 'USER_EMAIL_UNCHANGED', message: 'That is already this person’s email.' });
    }
    // ten-ok: a GLOBAL uniqueness probe — `users.email` is @unique platform-wide
    const taken = await this.prisma.client.user.findUnique({ where: { email }, select: { id: true } });
    if (taken && taken.id !== target.id) {
      throw new ConflictException({ code: 'USER_EMAIL_IN_USE', message: 'That email is already in use by another account.' });
    }
    return { mustSetupCredentials: !!live?.mustSetupCredentials };
  }

  // ── 1. change email ─────────────────────────────────────────────────────

  /**
   * POST /users/:id/email/code — step 1 when the new address must be proven:
   * email a 6-digit code to it. `{ required: false }` when this deploy cannot
   * reach arbitrary inboxes (the change then applies directly on step 2).
   */
  @Post(':id/email/code')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async sendEmailChangeCode(@Request() req: any, @Param('id') id: string, @Body() body: { email?: string; password?: string }) {
    const actor = await this.stepUp(req, body?.password, 'USER_EMAIL_CHANGE', id);
    const target = await this.target(req, id, 'USER_EMAIL_CHANGE');
    const email = normalizeNewEmail(body?.email);
    await this.assertEmailChangeable(target, email);
    if (!emailOwnershipProofRequired(this.email)) return { required: false };

    const now = Date.now();
    // ten-ok: scoped to the target account the caller was just authorised to act on
    const recent = await this.prisma.client.mfaEmailCode.count({
      where: { userId: target.id, createdAt: { gte: new Date(now - SETUP_EMAIL_CODE_ACCOUNT_WINDOW_MS) } },
    });
    if (recent >= SETUP_EMAIL_CODE_SENDS_PER_ACCOUNT) {
      throw new HttpException(
        { code: 'USER_EMAIL_CODE_TOO_MANY', message: 'Too many codes were sent for this account. Try again in 15 minutes.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const challengeHash = adminEmailChangeChallengeHash(target.id, email);
    const code = generateEmailCode();
    await this.prisma.client.$transaction([
      // ten-ok: the hash binds the scope-checked target id
      this.prisma.client.mfaEmailCode.deleteMany({ where: { challengeHash } }),
      // ten-ok: created for the scope-checked target
      this.prisma.client.mfaEmailCode.create({
        data: {
          userId: target.id,
          challengeHash,
          codeHash: hashEmailCode(this.codeSecret(), challengeHash, code),
          ipHash: hashClientIp(clientIpFromRequest(req)),
          expiresAt: new Date(now + MFA_EMAIL_CODE_TTL_MS),
        },
      }),
    ]);
    const status = await this.email.sendEmailChangeCode({ to: email, code, actorName: this.displayName(actor) });
    if (status === 'FAILED') {
      // ten-ok: the hash binds the scope-checked target id
      await this.prisma.client.mfaEmailCode.deleteMany({ where: { challengeHash } }).catch(() => undefined);
      throw new HttpException(
        { code: 'USER_EMAIL_CODE_NOT_SENT', message: "We couldn't send the code. Check the address and try again in a minute." },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: target.tenantId,
          userId: actor.id,
          action: 'USER_EMAIL_CHANGE_CODE_SENT',
          targetType: 'user',
          targetId: target.id,
          // Never the code.
          details: JSON.stringify({ currentEmail: target.email, newEmail: email, byRole: req.user.role, ip: clientIpFromRequest(req) }),
        },
      });
    } catch (e: any) {
      this.logger.warn(`audit(USER_EMAIL_CHANGE_CODE_SENT) failed: ${e?.message ?? e}`);
    }
    return { required: true, sent: true, expiresInSeconds: Math.floor(MFA_EMAIL_CODE_TTL_MS / 1000) };
  }

  /**
   * PUT /users/:id/email — make the change. With verification on, `code` is
   * the 6-digit code from step 1: the attempt is claimed atomically and the
   * code is spent in the SAME transaction as the email write and the audit
   * row. Ends every session the account holds (both stores) and tells the
   * OLD address.
   */
  @Put(':id/email')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async changeEmail(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { email?: string; password?: string; code?: string },
  ) {
    const actor = await this.stepUp(req, body?.password, 'USER_EMAIL_CHANGE', id);
    const target = await this.target(req, id, 'USER_EMAIL_CHANGE');
    const email = normalizeNewEmail(body?.email);
    await this.assertEmailChangeable(target, email);

    const verified = emailOwnershipProofRequired(this.email);
    let codeRowId: string | null = null;
    if (verified) {
      const code = normalizeEmailCode(body?.code);
      if (!code) {
        throw new BadRequestException({
          code: 'USER_EMAIL_CODE_REQUIRED',
          message: 'Enter the 6-digit code that was emailed to the new address.',
        });
      }
      const check = await claimEmailCodeAttempt(this.prisma.client, {
        challengeHash: adminEmailChangeChallengeHash(target.id, email),
        userId: target.id,
        code,
        secret: this.codeSecret(),
      });
      if (!check.ok) {
        if (check.reason === 'expired') {
          throw new BadRequestException({ code: 'USER_EMAIL_CODE_EXPIRED', message: 'That code has expired. Send a new one.' });
        }
        if (check.reason === 'locked') {
          throw new HttpException(
            { code: 'USER_EMAIL_CODE_LOCKED', message: 'Too many wrong codes. Send a new one.' },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        throw new BadRequestException({ code: 'USER_EMAIL_CODE_INVALID', message: "That code isn't right." });
      }
      codeRowId = check.rowId;
    }

    const ip = clientIpFromRequest(req);
    try {
      await this.prisma.client.$transaction(async (tx: any) => {
        if (codeRowId && !(await spendEmailCode(tx, codeRowId))) {
          throw new BadRequestException({ code: 'USER_EMAIL_CODE_INVALID', message: "That code isn't right." });
        }
        // Compare-and-set on the OLD address: two admins changing the same
        // account at once cannot both "win" with different stories.
        const cnt = await tx.user.updateMany({
          where: { id: target.id, tenantId: target.tenantId, email: target.email, deletedAt: null },
          data: { email },
        });
        if (cnt.count !== 1) {
          throw new ConflictException({ code: 'USER_EMAIL_CHANGED_ELSEWHERE', message: 'This account changed while you were editing it. Reload and try again.' });
        }
        await tx.auditLog.create({
          data: {
            tenantId: target.tenantId,
            userId: actor.id,
            action: 'USER_EMAIL_CHANGED',
            targetType: 'user',
            targetId: target.id,
            details: JSON.stringify({
              previousEmail: target.email,
              newEmail: email,
              verifiedByCode: verified,
              role: target.role,
              byRole: req.user.role,
              byTenant: req.user.tenantId,
              ip,
            }),
          },
        });
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException({ code: 'USER_EMAIL_IN_USE', message: 'That email is already in use by another account.' });
      }
      throw e;
    }

    const sessionsRevoked = await this.endSessions(target.id, 'email-changed-by-admin');
    void this.email
      .sendEmailChangedNotice({ to: target.email, actorName: this.displayName(actor) })
      .catch((err: unknown) => this.logger.warn(`email-changed notice failed: ${(err as Error)?.message ?? err}`));

    return { ok: true as const, email, verified, sessionsRevoked };
  }

  // ── 2. one-time setup links ─────────────────────────────────────────────

  /**
   * Issue ONE link for ONE scope-checked account: retire older links, retire
   * the starter password, audit — one transaction — then end every session.
   * The live row is re-read INSIDE the transaction, so a link is never issued
   * for an account that finished setup (or gained a factor) a moment ago.
   */
  private async issueSetupLink(req: any, actorId: string, target: ManageableTarget) {
    const token = generateSetupLinkToken();
    const expiresAt = new Date(Date.now() + SETUP_LINK_TTL_MS);
    // An unknown password nobody holds — the starter credential stops working now.
    const retiredHash = await this.auth.hashPassword(randomBytes(32).toString('base64url'));
    const ip = clientIpFromRequest(req);

    const revokedPrevious: number = await this.prisma.client.$transaction(async (tx: any) => {
      const live = await tx.user.findFirst({
        where: { id: target.id, tenantId: target.tenantId, deletedAt: null },
        select: { mustSetupCredentials: true, status: true, mfaTotpVerifiedAt: true, _count: { select: { passkeys: true } } },
      });
      if (!live || !live.mustSetupCredentials) {
        throw new ConflictException({
          code: 'SETUP_LINK_NOT_APPLICABLE',
          message: 'This account has already been set up by its owner. Use password reset instead.',
        });
      }
      if (live.status !== 'ACTIVE') {
        throw new ConflictException({ code: 'SETUP_LINK_ACCOUNT_INACTIVE', message: 'This account is turned off. Turn it on first.' });
      }
      if (live.mfaTotpVerifiedAt || (live._count?.passkeys ?? 0) > 0) {
        throw new ConflictException({
          code: 'SETUP_LINK_HAS_FACTOR',
          message: 'This account already has two-step sign-in. Reset its two-step sign-in first, then send a setup link.',
        });
      }
      const now = new Date();
      const revoked = await tx.accountSetupLink.updateMany({
        where: { userId: target.id, tenantId: target.tenantId, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.accountSetupLink.create({
        data: {
          tenantId: target.tenantId,
          userId: target.id,
          tokenHash: hashSetupLinkToken(token),
          createdById: actorId,
          expiresAt,
        },
      });
      const retired = await tx.user.updateMany({
        where: { id: target.id, tenantId: target.tenantId, mustSetupCredentials: true },
        data: { passwordHash: retiredHash },
      });
      if (retired.count !== 1) {
        throw new ConflictException({
          code: 'SETUP_LINK_NOT_APPLICABLE',
          message: 'This account has already been set up by its owner. Use password reset instead.',
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: target.tenantId,
          userId: actorId,
          action: 'ACCOUNT_SETUP_LINK_CREATED',
          targetType: 'user',
          targetId: target.id,
          // Never the token or its hash.
          details: JSON.stringify({
            email: target.email,
            expiresAt: expiresAt.toISOString(),
            replacedLinks: revoked.count,
            starterPasswordRetired: true,
            byRole: req.user.role,
            byTenant: req.user.tenantId,
            ip,
          }),
        },
      });
      return revoked.count;
    });

    const sessionsRevoked = await this.endSessions(target.id, 'setup-link-issued');
    return { url: setupLinkUrl(token), expiresAt: expiresAt.toISOString(), replacedLinks: revokedPrevious, sessionsRevoked };
  }

  /** POST /users/:id/setup-link — generate (or regenerate) one account's link. */
  @Post(':id/setup-link')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async createSetupLink(@Request() req: any, @Param('id') id: string, @Body() body: { password?: string }) {
    const actor = await this.stepUp(req, body?.password, 'ACCOUNT_SETUP_LINK', id);
    const target = await this.target(req, id, 'ACCOUNT_SETUP_LINK');
    const link = await this.issueSetupLink(req, actor.id, target);
    return { ok: true as const, userId: target.id, email: target.email, ...link };
  }

  /**
   * The accounts in scope that still owe first-login setup, newest link state
   * included. Rank-filtered exactly like the per-account gate, so the list
   * never offers an account the generate route would refuse.
   */
  private async pendingAccounts(req: any) {
    const tenantIds = await manageableTenantIds(this.prisma.client, req);
    if (tenantIds.length === 0) return [];
    // ten-ok: scoped to the caller's own tenant subtree (manageableTenantIds)
    const rows = await this.prisma.client.user.findMany({
      where: { tenantId: { in: tenantIds }, deletedAt: null, mustSetupCredentials: true } as any,
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        firstName: true,
        lastName: true,
        tenantId: true,
        mfaTotpVerifiedAt: true,
        tenant: { select: { name: true } },
        _count: { select: { passkeys: true } },
        setupLinks: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { usedAt: true, revokedAt: true, expiresAt: true, createdAt: true },
        },
      } as any,
      orderBy: [{ tenantId: 'asc' }, { email: 'asc' }] as any,
    });
    const callerId: string = req?.user?.id;
    const callerRole: string = req?.user?.role;
    return (rows as any[])
      .filter((r) => r.id !== callerId && (ASSIGNABLE_ROLES_BY_CALLER[callerRole] ?? []).includes(r.role))
      .map((r) => {
        const newest = r.setupLinks?.[0] ?? null;
        return {
          id: r.id,
          email: r.email,
          role: r.role,
          status: r.status,
          firstName: r.firstName ?? null,
          lastName: r.lastName ?? null,
          tenantId: r.tenantId,
          tenantName: r.tenant?.name ?? null,
          hasTwoStep: !!r.mfaTotpVerifiedAt || (r._count?.passkeys ?? 0) > 0,
          link: setupLinkState(newest),
          linkExpiresAt: newest && !newest.usedAt && !newest.revokedAt ? newest.expiresAt.toISOString() : null,
        };
      });
  }

  /** GET /users/setup-links — who still owes first-login setup, and their link state. */
  @Get('setup-links')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async listSetupLinks(@Request() req: any) {
    return { accounts: await this.pendingAccounts(req) };
  }

  /**
   * POST /users/setup-links/bulk — a fresh link for EVERY account in scope
   * that still owes setup (this organisation and its locations), for the
   * dashboard's CSV download. Each account goes through the same per-account
   * issue as the single route; one that cannot have a link is reported, not
   * fatal. Every previous link for those accounts stops working.
   */
  @Post('setup-links/bulk')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  async bulkSetupLinks(@Request() req: any, @Body() body: { password?: string }) {
    const actor = await this.stepUp(req, body?.password, 'ACCOUNT_SETUP_LINKS_BULK', null);
    const candidates = (await this.pendingAccounts(req)).filter((a) => a.status === 'ACTIVE' && !a.hasTwoStep);
    const links: Array<Record<string, unknown>> = [];
    const skipped: Array<{ email: string; code: string }> = [];
    for (const a of candidates) {
      try {
        const target = await loadManageableTarget(this.prisma.client, req, a.id, { notFoundOnScopeMiss: true });
        const link = await this.issueSetupLink(req, actor.id, target);
        links.push({
          userId: a.id,
          email: a.email,
          firstName: a.firstName,
          lastName: a.lastName,
          location: a.tenantName,
          role: a.role,
          url: link.url,
          expiresAt: link.expiresAt,
        });
      } catch (e: any) {
        const code = e?.response?.code ?? 'SETUP_LINK_FAILED';
        skipped.push({ email: a.email, code });
        if (!e?.response?.code) this.logger.warn(`bulk setup link for ${a.id} failed: ${e?.message ?? e}`);
      }
    }
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: actor.id,
          action: 'ACCOUNT_SETUP_LINKS_EXPORTED',
          targetType: 'tenant',
          targetId: req.user.tenantId,
          details: JSON.stringify({
            issued: links.length,
            skipped: skipped.length,
            byRole: req.user.role,
            ip: clientIpFromRequest(req),
          }),
        },
      });
    } catch (e: any) {
      this.logger.warn(`audit(ACCOUNT_SETUP_LINKS_EXPORTED) failed: ${e?.message ?? e}`);
    }
    return { links, skipped };
  }
}
