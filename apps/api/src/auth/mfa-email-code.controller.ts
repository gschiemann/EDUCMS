/**
 * THE EMAILED SIGN-IN CODE — the two routes (2026-10-05).
 *
 *   POST /api/v1/auth/mfa/challenge/email/send   { mfaToken }          → { challenge, expiresAt }
 *   POST /api/v1/auth/mfa/challenge/email        { challenge, code }   → the session envelope
 *
 * Both are PUBLIC (no session yet — that is the point) and CSRF-exempt for the
 * same reason as `/auth/mfa/challenge` (see csrf.middleware.ts). What
 * authorizes them:
 *
 *   send   — the partial `mfaToken`, minted by /auth/login ONLY after a
 *            correct password, five minutes, `purpose: mfa_challenge`. A
 *            normal session token lacks the purpose claim and is refused.
 *   verify — the opaque 32-byte `challenge` that ONLY the send response ever
 *            carried (to the page that held the mfaToken), plus the code from
 *            the inbox. The row was created only after the mfaToken proved the
 *            password, so the password step stays mandatory even though
 *            verify itself does not re-present the (five-minute) token: the
 *            code gets its full ten minutes without a second password prompt.
 *
 * The rules — 10 minutes, single use, 5 attempts, 3 sends per account per 15
 * minutes, 10 sends per IP per hour, never right after a password reset, never
 * for an account without a second factor, never when mail is not configured —
 * and why each exists are in `mfa-email-code.ts`. Every send, refusal, success
 * and failure writes an AuditLog row; a success also mails "New sign-in to
 * your VenueOS account on <device>" and (mint site 3) leaves the single-use
 * grant for the "add a passkey for this device" offer.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { Request } from 'express';

import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { EmailService } from '../email/email.service';
import { clientIpFromRequest } from '../security/client-ip';
import { requireSecret } from '../security/required-secret';
import { AuthService } from './auth.service';
import { MfaRateLimiter } from './mfa-rate-limiter';
import { verifyMfaChallengeToken } from './mfa-challenge-token';
import { loginEligibility } from './login-eligibility';
import {
  grantRedisFrom,
  withPasskeyEnrollmentOffer,
} from './passkey-enrollment-grant';
import {
  MFA_EMAIL_CODE_ACCOUNT_WINDOW_MS,
  MFA_EMAIL_CODE_IP_WINDOW_MS,
  MFA_EMAIL_CODE_MAX_ATTEMPTS,
  MFA_EMAIL_CODE_SENDS_PER_ACCOUNT,
  MFA_EMAIL_CODE_SENDS_PER_IP,
  MFA_EMAIL_CODE_TTL_MS,
  deviceNameFromUserAgent,
  emailCodeDeliveryConfigured,
  emailCodeEligibility,
  emailCodeHashesMatch,
  generateEmailCode,
  generateEmailCodeChallenge,
  hashClientIp,
  hashEmailCode,
  hashEmailCodeChallenge,
  isEmailCodeChallengeShape,
  lastPasswordResetAt,
  normalizeEmailCode,
} from './mfa-email-code';

const SendSchema = z
  .object({ mfaToken: z.string().min(10).max(2048) })
  .strict();
type SendBody = z.infer<typeof SendSchema>;

const VerifySchema = z
  .object({
    challenge: z.string().min(1).max(128),
    // Bounded, not shaped: "123 456" is forgiven by normalizeEmailCode.
    code: z.string().min(1).max(20),
  })
  .strict();
type VerifyBody = z.infer<typeof VerifySchema>;

/** A log-safe sentence for whatever was thrown. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The one answer for an expired / missing / spent partial token. */
function tokenInvalid(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'MFA_TOKEN_INVALID',
    message: 'Your sign-in attempt timed out. Sign in again.',
  });
}

/** Used, superseded, expired — all one sentence: send a new code. */
function codeExpired(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'MFA_EMAIL_CODE_EXPIRED',
    message: 'This code has expired or was already used. Send a new code.',
  });
}

function codeLocked(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'MFA_EMAIL_CODE_LOCKED',
    message: 'Too many wrong codes. Send a new code.',
    attemptsLeft: 0,
  });
}

@Controller('api/v1/auth/mfa/challenge/email')
export class MfaEmailCodeController {
  private readonly logger = new Logger('MfaEmailCodeController');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly rateLimiter: MfaRateLimiter,
    private readonly email: EmailService,
    // ONLY for the post-sign-in passkey offer's grant — optional for the same
    // reason MfaController's is: no Redis means the memory backend, never a
    // failed sign-in.
    @Optional() private readonly redis?: RedisService,
  ) {}

  @Post('send')
  @HttpCode(HttpStatus.OK)
  // Per IP. The per-ACCOUNT and longer per-IP windows are counted from the
  // table below, so they hold across restarts and replicas.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async send(
    @Body(new ZodValidationPipe(SendSchema)) body: SendBody,
    @Req() req: Request,
  ) {
    const token = await verifyMfaChallengeToken(this.jwt, body.mfaToken);
    if (!token) throw tokenInvalid();

    // ten-ok: identity SELF-lookup — userId is the sub of the VERIFIED partial mfaToken minted at password-check
    const user = await this.prisma.client.user.findUnique({
      where: { id: token.userId },
      select: {
        id: true,
        email: true,
        tenantId: true,
        status: true,
        deletedAt: true,
        mfaTotpVerifiedAt: true,
        tenant: { select: { archivedAt: true } },
        _count: { select: { passkeys: true } },
      },
    });
    // Disabled, deleted, archived tenant — or gone — between the password and
    // now: the same answer as an expired token. No oracle for account state.
    if (!user || loginEligibility(user) !== 'ok') {
      if (user) {
        await this.audit(
          req,
          user.tenantId,
          user.id,
          'MFA_EMAIL_CODE_REFUSED',
          {
            reason: loginEligibility(user),
          },
        );
      }
      throw tokenInvalid();
    }

    const eligibility = emailCodeEligibility({
      deliveryConfigured: emailCodeDeliveryConfigured(),
      holdsFactor: !!user.mfaTotpVerifiedAt || (user._count?.passkeys ?? 0) > 0,
      lastPasswordResetAt: await lastPasswordResetAt(
        this.prisma.client,
        user.id,
      ),
    });
    if (eligibility !== 'ok') {
      await this.audit(req, user.tenantId, user.id, 'MFA_EMAIL_CODE_REFUSED', {
        reason: eligibility,
      });
      throw new HttpException(
        eligibility === 'recent-password-reset'
          ? {
              code: 'MFA_EMAIL_CODE_AFTER_RESET',
              message:
                'Your password was reset recently, so a code by email is not available for a few days. ' +
                'Use your passkey, your authenticator app or a backup code.',
            }
          : {
              code: 'MFA_EMAIL_CODE_UNAVAILABLE',
              message:
                'A code by email is not available for this sign-in. Sign in on the device that has your passkey.',
            },
        HttpStatus.CONFLICT,
      );
    }

    const now = Date.now();
    const ip = clientIpFromRequest(req);
    const ipHash = hashClientIp(ip);

    // ── RATE LIMITS, counted from the table (multi-replica safe) ──────────
    // ten-ok: identity SELF-lookup — scoped by the verified principal's own id
    const recentForAccount = await this.prisma.client.mfaEmailCode.findMany({
      where: {
        userId: user.id,
        createdAt: { gte: new Date(now - MFA_EMAIL_CODE_ACCOUNT_WINDOW_MS) },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    if (recentForAccount.length >= MFA_EMAIL_CODE_SENDS_PER_ACCOUNT) {
      const oldest = recentForAccount[0].createdAt.getTime();
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + MFA_EMAIL_CODE_ACCOUNT_WINDOW_MS - now) / 1000),
      );
      await this.audit(
        req,
        user.tenantId,
        user.id,
        'MFA_EMAIL_CODE_RATE_LIMITED',
        {
          scope: 'account',
          retryAfterSeconds,
        },
      );
      throw new HttpException(
        {
          code: 'MFA_EMAIL_CODE_TOO_MANY',
          message: `Too many codes requested. Try again in ${Math.ceil(retryAfterSeconds / 60)} minutes, or use another way.`,
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (ipHash) {
      const recentForIp = await this.prisma.client.mfaEmailCode.count({
        where: {
          ipHash,
          createdAt: { gte: new Date(now - MFA_EMAIL_CODE_IP_WINDOW_MS) },
        },
      });
      if (recentForIp >= MFA_EMAIL_CODE_SENDS_PER_IP) {
        await this.audit(
          req,
          user.tenantId,
          user.id,
          'MFA_EMAIL_CODE_RATE_LIMITED',
          {
            scope: 'ip',
          },
        );
        throw new HttpException(
          {
            code: 'MFA_EMAIL_CODE_TOO_MANY',
            message:
              'Too many codes requested from this network. Try again later, or use another way.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // ── MINT ──────────────────────────────────────────────────────────────
    const challenge = generateEmailCodeChallenge();
    const challengeHash = hashEmailCodeChallenge(challenge);
    const code = generateEmailCode();
    const expiresAt = new Date(now + MFA_EMAIL_CODE_TTL_MS);
    const [, row] = await this.prisma.client.$transaction([
      // The newest code is the only live one: a resend retires the others.
      // ten-ok: identity SELF-update — scoped by the verified principal's own id
      this.prisma.client.mfaEmailCode.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
          expiresAt: { gt: new Date(now) },
        },
        data: { expiresAt: new Date(now) },
      }),
      this.prisma.client.mfaEmailCode.create({
        data: {
          userId: user.id,
          challengeHash,
          codeHash: hashEmailCode(this.codeSecret(), challengeHash, code),
          rememberMe: token.rememberMe,
          ipHash,
          expiresAt,
        },
        select: { id: true },
      }),
    ]);

    let delivery: string;
    try {
      delivery = await this.email.sendSignInCode({ to: user.email, code });
    } catch (err: unknown) {
      this.logger.warn(
        `[mfa-email] send failed before dispatch: ${errorText(err)}`,
      );
      delivery = 'FAILED';
    }
    if (delivery === 'FAILED') {
      // Nobody received it; make sure nobody can ever use it either.
      // ten-ok: the row was created a few lines up for this verified principal
      await this.prisma.client.mfaEmailCode.updateMany({
        where: { id: row.id },
        data: { expiresAt: new Date() },
      });
      await this.audit(
        req,
        user.tenantId,
        user.id,
        'MFA_EMAIL_CODE_SEND_FAILED',
        {
          codeId: row.id,
        },
      );
      throw new HttpException(
        {
          code: 'MFA_EMAIL_CODE_SEND_FAILED',
          message:
            "We couldn't send the code right now. Try again, or use another way.",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    await this.audit(req, user.tenantId, user.id, 'MFA_EMAIL_CODE_SENT', {
      codeId: row.id,
      delivery,
      expiresAt: expiresAt.toISOString(),
    });
    return { challenge, expiresAt: expiresAt.toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async verify(
    @Body(new ZodValidationPipe(VerifySchema)) body: VerifyBody,
    @Req() req: Request,
  ) {
    if (!isEmailCodeChallengeShape(body.challenge)) throw codeExpired();
    const code = normalizeEmailCode(body.code);
    if (!code) {
      // Not a guess at the secret — a typo in the shape. Burns nothing.
      throw new HttpException(
        {
          code: 'MFA_EMAIL_CODE_FORMAT',
          message: 'Enter the 6-digit code from the email.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const challengeHash = hashEmailCodeChallenge(body.challenge);
    // ten-ok: an UNAUTHENTICATED lookup by a 256-bit single-use handle's hash — the handle IS the claim being tested
    const row = await this.prisma.client.mfaEmailCode.findUnique({
      where: { challengeHash },
      select: {
        id: true,
        userId: true,
        codeHash: true,
        attempts: true,
        rememberMe: true,
        expiresAt: true,
        usedAt: true,
      },
    });
    if (!row) throw codeExpired();

    // The SAME per-user budget TOTP and passkey attempts spend, checked before
    // anything else — a second factor with its own allowance would simply be
    // the cheaper one to hammer.
    this.rateLimiter.check(row.userId);

    const now = new Date();
    if (row.usedAt || row.expiresAt.getTime() <= now.getTime())
      throw codeExpired();
    if (row.attempts >= MFA_EMAIL_CODE_MAX_ATTEMPTS) throw codeLocked();

    // CLAIM an attempt atomically BEFORE comparing, so concurrent guesses can
    // never add up to more than MAX_ATTEMPTS between them.
    // ten-ok: the row was resolved by its single-use handle just above
    const claimed = await this.prisma.client.mfaEmailCode.updateMany({
      where: {
        id: row.id,
        usedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: MFA_EMAIL_CODE_MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw row.attempts + 1 >= MFA_EMAIL_CODE_MAX_ATTEMPTS
        ? codeLocked()
        : codeExpired();
    }
    const attemptNumber = row.attempts + 1;

    // ten-ok: identity SELF-lookup — the code row's own owner
    const user = await this.prisma.client.user.findUnique({
      where: { id: row.userId },
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        canTriggerPanic: true,
        firstName: true,
        lastName: true,
        status: true,
        deletedAt: true,
        // MUST be forwarded to `login()` — see the same comment in
        // MfaController.challenge. Omitting it mints a session claiming
        // first-login credential setup is complete when it is not.
        mustSetupCredentials: true,
        tenant: { select: { archivedAt: true } },
        // The post-sign-in offer's cap check.
        _count: { select: { passkeys: true } },
      },
    });

    const matches = emailCodeHashesMatch(
      hashEmailCode(this.codeSecret(), challengeHash, code),
      row.codeHash,
    );
    if (!matches) {
      this.rateLimiter.record(row.userId, false);
      const attemptsLeft = Math.max(
        0,
        MFA_EMAIL_CODE_MAX_ATTEMPTS - attemptNumber,
      );
      if (user) {
        await this.audit(req, user.tenantId, user.id, 'MFA_EMAIL_CODE_FAILED', {
          codeId: row.id,
          attempt: attemptNumber,
          attemptsLeft,
        });
      }
      if (attemptsLeft === 0) throw codeLocked();
      throw new UnauthorizedException({
        code: 'MFA_EMAIL_CODE_INVALID',
        message: "That code doesn't match. Check the email and try again.",
        attemptsLeft,
      });
    }

    // SINGLE USE — the claim that wins is the only one that signs in.
    // ten-ok: the row was resolved by its single-use handle above
    const spent = await this.prisma.client.mfaEmailCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (spent.count !== 1) throw codeExpired();
    this.rateLimiter.record(row.userId, true);

    // Eligibility AGAIN: the account may have been disabled (or its tenant
    // archived) since the code was sent. Same opaque answer as a dead code.
    if (!user || loginEligibility(user) !== 'ok') {
      if (user) {
        await this.audit(req, user.tenantId, user.id, 'MFA_EMAIL_CODE_FAILED', {
          codeId: row.id,
          reason: loginEligibility(user),
        });
      }
      throw codeExpired();
    }

    const device = deviceNameFromUserAgent(this.userAgent(req));
    await this.audit(req, user.tenantId, user.id, 'MFA_EMAIL_CODE_SUCCESS', {
      codeId: row.id,
      attempt: attemptNumber,
      device,
    });

    // `mfaAlreadySatisfied`: the emailed code that just matched IS this
    // sign-in's second step. Without it `login()` would see an account that
    // holds a factor and challenge it again — the loop auth.service.ts calls
    // the most dangerous edge in that file.
    const session = await this.auth.login(
      {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
        canTriggerPanic: user.canTriggerPanic,
        firstName: user.firstName,
        lastName: user.lastName,
        mustSetupCredentials: user.mustSetupCredentials,
      },
      row.rememberMe,
      { mfaAlreadySatisfied: true },
    );

    // THE SAFEGUARD the owner chose for offering this to every role: the
    // account hears about every sign-in that used an emailed code. Not
    // awaited — a mail provider must never hold a sign-in up — and a failure
    // is already recorded as a FAILED email_logs row by EmailService.
    void this.email
      .sendNewSignInNotice({ to: user.email, device })
      .catch((err: unknown) =>
        this.logger.warn(
          `[mfa-email] new-sign-in notice failed: ${errorText(err)}`,
        ),
      );

    // THE POST-SIGN-IN PASSKEY OFFER — mint site 3 (passkey-enrollment-grant
    // .spec pins the count). This sign-in did not use a passkey, so this
    // device is exactly the one to offer "add a passkey for this device".
    return withPasskeyEnrollmentOffer(
      session,
      user,
      grantRedisFrom(this.redis),
    );
  }

  // ── helpers ───────────────────────────────────────────────────────────

  /** The HMAC key's root. Derived per purpose inside `hashEmailCode`. */
  private codeSecret(): string {
    return requireSecret('JWT_SECRET', {
      devFallback: 'dev_only_jwt_secret_CHANGE_ME',
    });
  }

  private userAgent(req: Request): string {
    const raw = (req as { headers?: Record<string, unknown> })?.headers?.[
      'user-agent'
    ];
    return typeof raw === 'string' ? raw : '';
  }

  /**
   * Immutable AuditLog row, best-effort (an audit write must never fail a
   * sign-in) and NEVER carrying the code, the handle or either hash. The IP
   * rides inside `details`, resolved through `client-ip.ts` — the same shape
   * PasskeyController and AuthController record.
   */
  private async audit(
    req: Request,
    tenantId: string | null,
    userId: string,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (!tenantId) return;
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId,
          action,
          targetType: 'User',
          targetId: userId,
          details: JSON.stringify({ ...details, ip: clientIpFromRequest(req) }),
        },
      });
    } catch {
      /* swallow — never throw from the audit path */
    }
  }
}
