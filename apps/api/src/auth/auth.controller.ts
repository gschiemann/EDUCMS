import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, HttpCode, HttpException, HttpStatus, Logger, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { createHash } from 'crypto';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { EmailString, LoginInputSchema, type LoginInput } from '@cms/api-types';
import { AuthService } from './auth.service';
import { evaluateMfaPolicy } from './mfa-policy';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_TENANT_ID, ensureSystemTenant } from '../security/system-tenant';
import { clientIpFromRequest } from '../security/client-ip';
import type { Request } from 'express';

/**
 * ACC-02 — body shape for POST /auth/change-password.
 *
 * `currentPassword` is capped like the login password (a 10MB string reaching
 * argon2.verify is a request-thread DoS). `newPassword` enforces the same
 * 8-char floor the reset + invite paths enforce, so the change-password door
 * can't be used to set a weaker password than the front door allows.
 */
const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(8).max(200),
  })
  .strict();
type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/**
 * FIRST-LOGIN CREDENTIAL SETUP (2026-09-03) — body shape for
 * POST /auth/complete-setup.
 *
 * `email` reuses `EmailString`, the one bounded email shape every credential
 * endpoint in the product validates against (login, signup, password reset) —
 * RFC-lenient enough for on-prem addresses, capped at the RFC 5321 254-char
 * envelope max so nothing oversized reaches the `@unique` column.
 *
 * `password` mirrors `ChangePasswordSchema.newPassword` EXACTLY (min 8 / max
 * 200 — the platform policy `validatePassword` enforces on signup, invite
 * accept and admin-direct-create). Deliberately the same literal bounds rather
 * than a second, subtly different rule: a setup door that admitted a weaker
 * password than the front door would be a downgrade dressed as onboarding.
 */
export const CompleteSetupSchema = z
  .object({
    email: EmailString,
    password: z.string().min(8).max(200),
  })
  .strict();
type CompleteSetupInput = z.infer<typeof CompleteSetupSchema>;

@Controller('api/v1/auth')
export class AuthController {
  private readonly authLogger = new Logger('AuthController');
  /** One-shot guard: the sentinel "system" tenant row only needs to be
   *  ensured once per process. After the first successful upsert we skip
   *  the round-trip on every subsequent unknown-email failed login. */
  private systemTenantEnsured = false;

  constructor(
    private authService: AuthService,
    private redisService: RedisService,
    private prisma: PrismaService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  // Per-IP rate limit: 10 attempts per minute. argon2's cost slows brute
  // force but doesn't stop it; without a per-IP gate, credential stuffing
  // against a leaked email list runs unbounded. Matches signup's pattern
  // (5/min) but a touch looser since legitimate users sometimes mistype
  // their password 3-4 times before resetting. The global 600/min default
  // throttle covers nothing for credential attacks because attackers
  // rotate IPs; this PER-IP one is the real defense.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(
    // Bounded shape — email is format-checked + length-capped (max 254
    // per RFC 5321), password length-capped (max 256). Pre-Zod the
    // body was `Record<string, any>`, which let a 10MB string reach
    // argon2.verify() and DoS the request thread for ~30s.
    @Body(new ZodValidationPipe(LoginInputSchema)) body: LoginInput,
    @Req() req: Request,
  ) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      // P0-4 (2026-05-28) — credential check failed. Audit it for
      // forensics (credential stuffing: when, from which IP, against
      // which accounts). The throttler counter alone doesn't survive a
      // restart and isn't queryable per-account.
      await this.auditLoginAttempt(req, body.email, null, 'AUTH_LOGIN_FAILED', {
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' });
    }
    const result = await this.authService.login(user, body.rememberMe);
    // P0-4 — credential check passed. `result` may be an MFA challenge
    // envelope (mfaRequired) rather than a full session; either way the
    // password proved out, so this is the success-of-credentials event.
    // The subsequent MFA step is audited separately in mfa.controller
    // (mfa.challenge_succeeded). We have the real user here, so the
    // tenant attribution is exact.
    //
    // SEC-008 — record WHY the policy did or did not hold. "This admin got a
    // password-only session on 2026-09-20" has to be answerable per login,
    // and after the grace deadline `graceRemaining: true` is the row that
    // proves an account slipped through a window rather than a hole. The
    // reasons live here rather than in the HTTP response on purpose (see
    // mfaPolicyNotice) — the forensic record is the right place for them.
    const mfaDecision = evaluateMfaPolicy(user);
    await this.auditLoginAttempt(req, user.email, user.tenantId, 'AUTH_LOGIN_SUCCESS', {
      mfaRequired: !!(result as any)?.mfaRequired,
      mfaEnrollmentRequired: !!(result as any)?.mfaEnrollmentRequired,
      mfaPolicy: {
        required: mfaDecision.required,
        reasons: mfaDecision.reasons,
        enrolled: mfaDecision.enrolled,
        graceRemaining: mfaDecision.inGrace,
        enforceAfter: mfaDecision.enforceAfter,
      },
    });
    return result;
  }

  /**
   * ACC-02 (2026-08-01) — authenticated password change.
   *
   * THE HOLE: there was NO change-password endpoint at all. The only way to
   * rotate a password was the emailed reset link, so a user who suspected
   * their session was compromised had no in-product way to lock it down, and
   * (until the sibling fix in OnboardingService) the reset didn't end sessions
   * either.
   *
   * The flow, in order:
   *   1. re-verify the CURRENT password via `validateUser` — a stolen session
   *      alone must not be enough to change the credential. Reusing
   *      `validateUser` also inherits its guards for free: soft-deleted users,
   *      non-ACTIVE (INVITED) users, ARCHIVED tenants (ACC-05), and the
   *      argon2 timing equalizer;
   *   2. hash the new one with the platform Argon2id config (`hashPassword` —
   *      one config, not a second copy that can drift);
   *   3. REVOKE every live session for the user, then hand back a replacement
   *      token pinned to the revocation epoch — so the attacker's tokens die
   *      and the legitimate caller is not signed out by their own action;
   *   4. audit it.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  // Tight per-IP cap: this endpoint runs two argon2 operations (~90ms) and is
  // never called in a loop by a legitimate client.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async changePassword(
    @Body(new ZodValidationPipe(ChangePasswordSchema)) body: ChangePasswordInput,
    @Req() req: Request,
  ) {
    const actor = (req as any).user;
    const userId: string | undefined = actor?.userId || actor?.id;
    // API keys and device tokens are machine identities with no password to
    // change; they must not reach this path.
    if (!userId || actor?.kind === 'api-key' || actor?.kind === 'device') {
      throw new UnauthorizedException({
        code: 'AUTH_PASSWORD_CHANGE_NOT_APPLICABLE',
        message: 'Only a signed-in user account can change its password.',
      });
    }

    // ten-ok: identity SELF-lookup — id IS the authenticated JWT principal
    const dbUser = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, tenantId: true, canTriggerPanic: true },
    });
    if (!dbUser) {
      throw new UnauthorizedException({ code: 'AUTH_USER_NOT_FOUND', message: 'User not found' });
    }

    // 1. Re-auth with the CURRENT password.
    const verified = await this.authService.validateUser(dbUser.email, body.currentPassword);
    if (!verified) {
      await this.auditPasswordChange(dbUser.tenantId, dbUser.id, req, false, 'invalid_current_password');
      throw new UnauthorizedException({
        code: 'AUTH_CURRENT_PASSWORD_INVALID',
        message: 'Your current password is incorrect.',
      });
    }
    if (body.newPassword === body.currentPassword) {
      throw new BadRequestException({
        code: 'AUTH_PASSWORD_UNCHANGED',
        message: 'Choose a password different from your current one.',
      });
    }

    // 2. Rotate the hash.
    const passwordHash = await this.authService.hashPassword(body.newPassword);
    // ten-ok: identity SELF-update — only touches the authenticated principal's own row
    await this.prisma.client.user.update({ where: { id: dbUser.id }, data: { passwordHash } });

    // 3. Kill every live session, then re-issue exactly one.
    //    `markUserTokensInvalid(userId, nowSec)` stores `nowSec + 1`; pinning
    //    the replacement token's `iat` to that same epoch makes it the first
    //    token that survives the cut (guard rejects on `iat < epoch`). Every
    //    other token the account holds — including a stolen one — is strictly
    //    older and is now dead.
    const nowSec = Math.floor(Date.now() / 1000);
    const revocationEpoch = nowSec + 1;
    let sessionsRevoked = true;
    try {
      await this.redisService.markUserTokensInvalid(dbUser.id, nowSec);
    } catch (e: any) {
      // The password IS changed at this point. Surface the partial outcome
      // rather than silently claiming a clean containment.
      sessionsRevoked = false;
      this.authLogger.error(
        `changePassword(${dbUser.id}): password rotated but session revocation FAILED: ${e?.message ?? e}`,
      );
    }
    const access_token = this.authService.signSessionToken(dbUser, {
      iatSeconds: revocationEpoch,
    });

    // 4. Audit.
    await this.auditPasswordChange(dbUser.tenantId, dbUser.id, req, true, null, sessionsRevoked);

    return {
      success: true,
      // Client swaps its stored token for this one; every other device is
      // signed out. `sessionsRevoked:false` means the revocation store was
      // unreachable — the UI should tell the user to sign out everywhere.
      access_token,
      sessionsRevoked,
    };
  }

  /**
   * FIRST-LOGIN CREDENTIAL SETUP (2026-09-03) — POST /auth/complete-setup.
   *
   * WHY. A multi-location operator provisions one account per site before
   * knowing who will run it, so each is created with a PLACEHOLDER email
   * (`riot-jacksonville@riotcolor.com`) and a per-location starter password.
   * That credential is handed around; the mailbox belongs to nobody. This is
   * the ONE door out of that state, and the only route (besides logout and the
   * session read) such an account can reach — see
   * `SETUP_REQUIRED_ALLOWED_ROUTES` in jwt-auth.guard.ts.
   *
   * THIS IS NOT A GENERAL EMAIL-CHANGE ROUTE. It is refused for any account
   * whose live `mustSetupCredentials` is false, checked against the DATABASE
   * ROW and never the token claim — otherwise a stale/forged claim would open
   * an unauthenticated-by-password identity change on any account. Changing
   * an established user's email stays an admin action.
   *
   * The flow, in order:
   *   1. resolve the LIVE row and confirm it is genuinely in setup state;
   *   2. reject the placeholder email being kept, and the starter password
   *      being kept — either would leave exactly the credential this exists to
   *      retire (the password check is one argon2 verify on a once-per-account
   *      call, which is cheap for what it buys);
   *   3. rotate BOTH credentials and clear the flag in ONE write, so an
   *      account can never end up with a new email and a live setup gate;
   *   4. REVOKE every other live session and hand back a single replacement
   *      token pinned past the revocation epoch — anyone still holding the
   *      shared starter credential's session is cut off at the moment of
   *      handover, and the legitimate caller is not signed out by their own
   *      action (the ACC-02 pattern, reused);
   *   5. audit it (§16 — this changes a login identity, which is about as
   *      privileged as an action gets).
   *
   * NOTE ON RE-AUTH: unlike `change-password`, this does NOT ask for the
   * current password. The user typed it seconds ago at the login screen that
   * produced this session, and asking a first-time operator to re-enter a
   * starter password they were handed on a sticky note is the kind of friction
   * that ends in a support call. The session itself is the proof, and step 4
   * limits what a stolen one could keep.
   */
  @Post('complete-setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  // Two argon2 operations (~90ms), and one SUCCESS ends the account's ability
  // to call this at all. Looser than change-password's 5/min for one concrete
  // reason: provisioning day clusters. A manager walking six new location
  // operators through setup on the office wifi shares one NAT address, and a
  // 5/min cap would start refusing them mid-training. 10/min still costs at
  // most ~1s of argon2 per minute per IP — nowhere near an abuse lane, and
  // this endpoint is reachable only with a valid session for an account the
  // DB says is in setup state.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async completeSetup(
    @Body(new ZodValidationPipe(CompleteSetupSchema)) body: CompleteSetupInput,
    @Req() req: Request,
  ) {
    const actor = (req as any).user;
    const userId: string | undefined = actor?.userId || actor?.id;
    // API keys and device tokens are machine identities with no human to hand
    // the account to; they must not reach this path.
    if (!userId || actor?.kind === 'api-key' || actor?.kind === 'device') {
      throw new UnauthorizedException({
        code: 'AUTH_SETUP_NOT_APPLICABLE',
        message: 'Only a signed-in user account can complete first-login setup.',
      });
    }

    // ten-ok: identity SELF-lookup — id IS the authenticated JWT principal
    const dbUser = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        canTriggerPanic: true,
        firstName: true,
        lastName: true,
        passwordHash: true,
        mustSetupCredentials: true,
      },
    });
    if (!dbUser) {
      throw new UnauthorizedException({ code: 'AUTH_USER_NOT_FOUND', message: 'User not found' });
    }

    // 1. The LIVE row is the only thing that authorises this endpoint.
    if (!dbUser.mustSetupCredentials) {
      throw new ForbiddenException({
        code: 'SETUP_NOT_REQUIRED',
        message:
          'This account has already been set up. Change your email or password from ' +
          'Settings instead.',
      });
    }

    const email = body.email.trim().toLowerCase();

    // 2. Neither provisioning credential may survive.
    if (email === dbUser.email.trim().toLowerCase()) {
      throw new BadRequestException({
        code: 'SETUP_EMAIL_UNCHANGED',
        message:
          'Enter your own work email — this is the temporary address the account was ' +
          'created with.',
      });
    }
    if (await this.authService.verifyPassword(dbUser.passwordHash, body.password)) {
      throw new BadRequestException({
        code: 'SETUP_PASSWORD_UNCHANGED',
        message: 'Choose a new password — this is the starter password you were given.',
      });
    }

    // Pre-check the globally-`@unique` email so the common case answers with a
    // clean 409 instead of a Prisma error. The write below still catches P2002:
    // this check and the update are not atomic, and two operators claiming the
    // same address in the same second must not produce a 500.
    const taken = await this.prisma.client.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (taken && taken.id !== dbUser.id) {
      throw new ConflictException({
        code: 'SETUP_EMAIL_IN_USE',
        message: 'That email is already in use. Try another, or ask your administrator.',
      });
    }

    const passwordHash = await this.authService.hashPassword(body.password);

    // 3. ONE write. Splitting the email change from the flag clear would leave
    //    a window where the account has its real email but is still gated.
    try {
      // ten-ok: identity SELF-update — only touches the authenticated principal's own row
      await this.prisma.client.user.update({
        where: { id: dbUser.id },
        data: { email, passwordHash, mustSetupCredentials: false },
      });
    } catch (e: any) {
      // P2002 = unique constraint. Only `email` is unique on this write, so
      // someone claimed the address between the check above and here.
      if (e?.code === 'P2002') {
        throw new ConflictException({
          code: 'SETUP_EMAIL_IN_USE',
          message: 'That email is already in use. Try another, or ask your administrator.',
        });
      }
      throw e;
    }

    // 4. Kill every live session, then re-issue exactly one. Same mechanism +
    //    same epoch-pinning as change-password: `markUserTokensInvalid(id,
    //    nowSec)` stores `nowSec + 1`, and pinning the replacement token's
    //    `iat` there makes it the first token to survive the cut. Every other
    //    token this account holds — including one minted from the starter
    //    credential on someone else's laptop — is strictly older and now dead.
    const nowSec = Math.floor(Date.now() / 1000);
    const revocationEpoch = nowSec + 1;
    let sessionsRevoked = true;
    try {
      await this.redisService.markUserTokensInvalid(dbUser.id, nowSec);
    } catch (e: any) {
      // The credentials ARE changed at this point. Surface the partial outcome
      // rather than silently claiming a clean containment.
      sessionsRevoked = false;
      this.authLogger.error(
        `completeSetup(${dbUser.id}): credentials rotated but session revocation FAILED: ` +
          `${e?.message ?? e}`,
      );
    }
    const access_token = this.authService.signSessionToken(
      { ...dbUser, email, mustSetupCredentials: false },
      { iatSeconds: revocationEpoch },
    );

    // 5. Audit. The emails are stored in the clear here ON PURPOSE and unlike
    //    the failed-login rows, which hash them: this row is the ONLY record of
    //    which real person took ownership of which provisioned location
    //    account, and a hash cannot answer that question. Both addresses are
    //    already stored in the clear in `users.email` anyway (before and after),
    //    so this adds no disclosure — it adds the WHEN and the FROM-WHERE.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: dbUser.tenantId,
          userId: dbUser.id,
          action: 'USER_CREDENTIAL_SETUP_COMPLETED',
          targetType: 'User',
          targetId: dbUser.id,
          details: JSON.stringify({
            ip: clientIpFromRequest(req),
            ua: ((req.headers['user-agent'] as string | undefined) || '').slice(0, 256),
            previousEmail: dbUser.email,
            newEmail: email,
            sessionsRevoked,
          }),
        },
      });
    } catch (e: any) {
      // Best-effort, never silent (2026-05-21 lesson).
      this.authLogger.warn(`audit(USER_CREDENTIAL_SETUP_COMPLETED) failed: ${e?.message ?? e}`);
    }

    // Mirror the login response's user shape so the client can replace its
    // stored session wholesale — the email it cached is now WRONG, and the
    // gate flag it is rendering from must flip to false.
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: dbUser.tenantId },
      select: { slug: true, vertical: true, name: true },
    });

    return {
      success: true,
      access_token,
      // `false` means the revocation store was unreachable — the UI should tell
      // the user to sign out everywhere.
      sessionsRevoked,
      user: {
        id: dbUser.id,
        email,
        role: dbUser.role,
        firstName: dbUser.firstName ?? null,
        lastName: dbUser.lastName ?? null,
        tenantId: dbUser.tenantId,
        tenantSlug: tenant?.slug || dbUser.tenantId,
        tenantName: tenant?.name || null,
        tenantVertical: tenant?.vertical || 'K12',
        canTriggerPanic: dbUser.canTriggerPanic,
        mustSetupCredentials: false,
      },
    };
  }

  /**
   * Trust-wave D (2026-08-06) — sliding session refresh.
   *
   * A scorekeeper who logs in during warm-ups holds a 1h JWT (auth.module
   * signOptions) and was bounced to /login in the third quarter. The web
   * client now trades a STILL-VALID token for a fresh one here before it
   * expires; AuthService.refreshSession enforces the sliding cap (12h from
   * the original login for plain sessions, the existing 30d for rememberMe).
   *
   * Security posture — nothing is weakened:
   *   - guarded by the SAME JwtAuthGuard as every authed route, so an
   *     expired token, a token in `jwt_revoked_list`, and a token behind the
   *     per-user invalid-before epoch are all refused BEFORE this handler —
   *     refresh can never resurrect a revoked session;
   *   - claims are re-minted from the LIVE user row (see refreshSession);
   *   - CSRF: authed POSTs carry `Authorization: Bearer`, which the CSRF
   *     middleware already treats as non-forgeable (browsers never attach a
   *     Bearer header cross-site) — same path every other authed POST takes;
   *     the client still sends X-CSRF-Token like any mutation.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  // A legitimate client refreshes ~once per 45min; 10/min per IP is generous
  // headroom for a shared-NAT press box without enabling a mint loop.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async refresh(@Req() req: Request) {
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException({ code: 'AUTH_NO_BEARER_TOKEN', message: 'No bearer token' });
    }
    const actor = (req as any).user;
    const userId: string | undefined = actor?.userId || actor?.id;
    // Machine identities have their own lifecycles (API keys don't expire
    // mid-game; device tokens have a dedicated rotation path) — only a human
    // session slides here.
    if (!userId || actor?.kind === 'api-key' || actor?.kind === 'device') {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_NOT_APPLICABLE',
        message: 'Only a signed-in user session can be refreshed.',
      });
    }

    const result = await this.authService.refreshSession(userId, token);

    // §16 — audit every privileged action. Low-noise by design: one row per
    // successful re-mint (~1/45min per active operator); a REFUSED refresh
    // changes no state and already surfaces in the request log as a 401.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: result.user.tenantId,
          userId: result.user.id,
          action: 'AUTH_TOKEN_REFRESH',
          targetType: 'User',
          targetId: result.user.id,
          details: JSON.stringify({
            ip: clientIpFromRequest(req),
            rememberMe: result.rememberClass,
          }),
        },
      });
    } catch (e: any) {
      // Best-effort, never silent (2026-05-21 lesson).
      this.authLogger.warn(`audit(AUTH_TOKEN_REFRESH) failed: ${e?.message ?? e}`);
    }

    // Mirror login's token response shape.
    return { access_token: result.access_token, user: result.user };
  }

  /** Immutable forensic row for a password-change attempt (success or not). */
  private async auditPasswordChange(
    tenantId: string,
    userId: string,
    req: Request,
    success: boolean,
    reason: string | null,
    sessionsRevoked?: boolean,
  ): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId,
          action: success ? 'PASSWORD_CHANGED' : 'PASSWORD_CHANGE_FAILED',
          targetType: 'User',
          targetId: userId,
          details: JSON.stringify({
            ip: clientIpFromRequest(req),
            ua: ((req.headers['user-agent'] as string | undefined) || '').slice(0, 256),
            ...(reason ? { reason } : {}),
            ...(sessionsRevoked === undefined ? {} : { sessionsRevoked }),
          }),
        },
      });
    } catch (e: any) {
      this.authLogger.warn(`auditPasswordChange failed: ${e?.message ?? e}`);
    }
  }

  /**
   * P0-4 (2026-05-28) — write a login attempt to the immutable AuditLog.
   * Best-effort (a DB hiccup must never block or fail the login), but
   * NOT silent: failures are logged at warn so a broken audit path is
   * visible instead of masquerading as success — the lesson from the
   * 2026-05-21 safeguard-theater incident.
   *
   * `AuditLog.tenantId` is NOT NULL. On a FAILED attempt against a real
   * account we look the tenant up so the row lands on the right tenant.
   * On a failed attempt against an **unknown email** there is no natural
   * tenant — but credential-stuffing recon against non-existent accounts
   * is exactly the signal a SOC wants queryable in the durable trail, so
   * we attribute it to the dedicated sentinel `SYSTEM_TENANT_ID` (the row
   * carries `unknownAccount: true` in `details` so it's unmistakable and
   * never pollutes a real tenant's trail). The sentinel tenant row is
   * ensured idempotently here so the FK insert always lands.
   */
  private async auditLoginAttempt(
    req: Request,
    email: string,
    tenantId: string | null,
    action: 'AUTH_LOGIN_SUCCESS' | 'AUTH_LOGIN_FAILED',
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    // Resolve a real tenant for the FAILED-against-real-account case.
    let resolvedTenantId = tenantId;
    if (!resolvedTenantId && action === 'AUTH_LOGIN_FAILED') {
      resolvedTenantId = await this.authService.tenantIdForEmail(email);
    }

    const ip = clientIpFromRequest(req);
    const ua = ((req.headers['user-agent'] as string | undefined) || '').slice(0, 256);
    // Don't store the raw email in `details` (PII); a SHA-256 prefix is
    // enough to correlate repeated attempts against the same account
    // across rows without persisting the address in cleartext.
    const emailHash = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);

    // Unknown email on a failed login → no natural tenant. Attribute the
    // row to the sentinel "system" tenant so the recon attempt IS in the
    // durable, queryable trail (not just stdout, which doesn't survive a
    // restart and isn't queryable per-account). `unknownAccount` flags it
    // so forensics never confuse it with a real-tenant event.
    const unknownAccount = !resolvedTenantId;
    // After this, the tenant is always defined: a real tenant for a known
    // account, or the sentinel for an unknown one. (`resolvedTenantId` stays
    // `string | null` to TS, so pin the final value in a non-null const.)
    const auditTenantId: string = unknownAccount ? SYSTEM_TENANT_ID : (resolvedTenantId as string);

    const details = JSON.stringify({ ip, ua, emailHash, unknownAccount, ...extra });

    try {
      // Ensure the sentinel tenant exists before the FK insert. One-shot
      // per process for known-email rows it's never needed; for the
      // unknown-email path it's a cheap idempotent upsert that becomes a
      // no-op after the first call.
      if (unknownAccount && !this.systemTenantEnsured) {
        await ensureSystemTenant(this.prisma.client);
        this.systemTenantEnsured = true;
      }
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: auditTenantId,
          userId: null, // not the actor's own action; identified via emailHash
          action,
          targetType: 'User',
          targetId: null,
          details,
        },
      });
    } catch (e: any) {
      // Best-effort — a DB hiccup must never block or fail the login. NOT
      // silent: warn so a broken audit path is visible (2026-05-21 lesson)
      // instead of masquerading as success.
      this.authLogger.warn(`auditLoginAttempt(${action}) failed: ${e?.message ?? e}`);
    }
  }

  /**
   * Server-side logout: revokes the bearer token by adding it to the Redis
   * revocation set, so JwtAuthGuard rejects it on the next request. Lane-1
   * P0 fix — previously "logout" was a pure client-side cookie clear and
   * the JWT remained valid for up to 30 days (rememberMe ceiling) even
   * after the user clicked "Log out."
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: Request) {
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException({ code: 'AUTH_NO_BEARER_TOKEN', message: 'No bearer token' });
    }
    const user = (req as any).user;
    // Durable mirror FIRST (2026-07-10 durable-revocation fix; best-effort,
    // never throws): mirror the revocation to Postgres so it survives a
    // Redis outage/flush — JwtAuthGuard/SSE/WS fall back to this row when
    // Redis can't answer. Written before the Redis calls so the row lands
    // even on the 503 paths below; a mirror failure never fails the logout.
    await this.redisService.mirrorRevokedTokenDurable(token);
    // ─── 2026-08-03 — logout must not be able to SHORTEN a revocation ─────
    //
    // THE BUG. This used to reach past RedisService and call
    // `publisher.sadd(...)` + `publisher.expire('jwt_revoked_list', 30d)` on
    // the RAW client. `jwt_revoked_list` is ONE SHARED SET whose TTL is
    // per-KEY, not per-member: device revocation (`revokeScreenCredentials`)
    // deliberately EXTENDS that TTL to outlive a 180-day device token. A user
    // logging out therefore re-stamped the key at 30 days and quietly
    // un-protected every device token in the set — the revoked kiosk token
    // became valid again the moment the shortened expiry fired.
    //
    // `RedisService.sadd` already implements the extend-only TTL rule (and its
    // docblock named THIS call as the last remaining hole). Route through it.
    //
    // FAIL-CLOSED SEMANTICS PRESERVED. `sadd` never throws — it returns false
    // when Redis is unreachable or the write failed. Redis is still the
    // PRIMARY revocation store, so a false answer means we cannot confirm the
    // logout took on the hot path: 503 exactly as before (the durable mirror
    // above is a backstop, not the success criterion). Pairs with
    // jwt-auth.guard.ts, which fails CLOSED on Redis errors.
    const revoked = await this.redisService.sadd('jwt_revoked_list', token, {
      // 30 days = rememberMe ceiling — the JWT itself expires by then, so the
      // set never grows unboundedly. Applied as a FLOOR: only lengthens.
      ttlSeconds: 60 * 60 * 24 * 30,
    });
    if (!revoked) {
      throw new HttpException({ code: 'AUTH_REVOCATION_SERVICE_UNAVAILABLE', message: 'Revocation service unavailable; try again' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    // Lane-1 P2 fix: AuditLog every logout for incident forensics
    // ("when did the attacker burn the session?"). Best-effort — never
    // fail the logout if the audit row fails.
    //
    // `AuditLog.tenantId` is NOT NULL. A normal user JWT always carries
    // tenantId, but an unusual token state (e.g. an api-key/device
    // identity reaching here) can resolve to null — that `create` would
    // be guaranteed to throw on the FK/not-null. Guard it: skip the audit
    // row rather than fire a write we know can't land. The token
    // revocation above already happened, so the logout is still honored.
    const auditTenantId = user?.tenantId || user?.schoolId || user?.districtId || null;
    if (auditTenantId) {
      try {
        await this.prisma.client.auditLog.create({
          data: {
            tenantId: auditTenantId,
            userId: user?.userId || user?.id || null,
            action: 'AUTH_LOGOUT',
            targetType: 'User',
            targetId: user?.userId || user?.id || null,
            details: JSON.stringify({
              ip: clientIpFromRequest(req),
              ua: (req.headers['user-agent'] || '').slice(0, 256),
            }),
          },
        });
      } catch { /* best-effort */ }
    }
    return { success: true };
  }
}
