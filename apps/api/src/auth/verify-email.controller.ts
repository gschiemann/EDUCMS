import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { requireSecret } from '../security/required-secret';
import { clientIpFromRequest } from '../security/client-ip';
import {
  MFA_EMAIL_CODE_TTL_MS,
  generateEmailCode,
  hashClientIp,
  hashEmailCode,
  normalizeEmailCode,
} from './mfa-email-code';
import { claimEmailCodeAttempt, spendEmailCode } from './email-code-claim';
import {
  SETUP_EMAIL_CODE_ACCOUNT_WINDOW_MS,
  SETUP_EMAIL_CODE_SENDS_PER_ACCOUNT,
} from './setup-email-verification';

/**
 * SELF-SIGNUP EMAIL VERIFICATION (2026-10-11, launch security re-audit).
 *
 * Public self-signup stays open (14-day self-serve trials), but it used to hand
 * a stranger an ACTIVE DISTRICT_ADMIN for an email nobody had proven — the
 * entry point for both V-1 (POS OAuth) and V-2 (SSO domain claims). When this
 * deploy can deliver mail (`SETUP_EMAIL_VERIFICATION`: `auto` on a verified
 * sending domain, or `required`), signup marks the new admin
 * `emailVerificationPending` and JwtAuthGuard admits only these two routes plus
 * logout and /users/me (`EMAIL_VERIFICATION_ALLOWED_ROUTES`) until the code we
 * email to the SIGNUP address is entered.
 *
 * The code machinery is the first-login setup's (same table, hashing, 10-minute
 * life, 5-try cap, atomic attempt claim); the challenge hash is domain-separated
 * so a code for one flow can never complete the other. Never logged, never
 * returned, never written to an audit row.
 */
export function verifyEmailChallengeHash(userId: string, email: string): string {
  return createHash('sha256')
    .update(`venueos-signup-verify-email|${userId}|${email.trim().toLowerCase()}`)
    .digest('hex');
}

const ConfirmSchema = z.object({ code: z.string().min(1).max(32) }).strict();
type ConfirmInput = z.infer<typeof ConfirmSchema>;

@Controller('api/v1/auth/verify-email')
@UseGuards(JwtAuthGuard)
export class VerifyEmailController {
  private readonly logger = new Logger('VerifyEmailController');

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    @Optional() private readonly emailService?: EmailService,
  ) {}

  private secret(): string {
    return requireSecret('JWT_SECRET', { devFallback: 'dev_only_jwt_secret_CHANGE_ME' });
  }

  private async pendingSelf(req: Request) {
    const actor = (req as any).user;
    const userId: string | undefined = actor?.userId || actor?.id;
    if (!userId || actor?.kind === 'api-key' || actor?.kind === 'device') {
      throw new UnauthorizedException({ code: 'AUTH_VERIFY_EMAIL_NOT_APPLICABLE', message: 'Only a signed-in person can verify an email.' });
    }
    // ten-ok: identity SELF-lookup — id IS the authenticated JWT principal
    const u = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, tenantId: true, role: true, canTriggerPanic: true,
        mustSetupCredentials: true, emailVerificationPending: true,
      },
    });
    if (!u) throw new UnauthorizedException({ code: 'AUTH_USER_NOT_FOUND', message: 'User not found' });
    if (!u.emailVerificationPending) {
      throw new ForbiddenException({ code: 'EMAIL_ALREADY_VERIFIED', message: 'This email address is already confirmed.' });
    }
    return u;
  }

  /** Email a 6-digit code to the account's own (signup) address. */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async send(@Req() req: Request) {
    const u = await this.pendingSelf(req);
    const now = Date.now();
    // ten-ok: scoped to the verified principal's own id
    const recent = await this.prisma.client.mfaEmailCode.count({
      where: { userId: u.id, createdAt: { gte: new Date(now - SETUP_EMAIL_CODE_ACCOUNT_WINDOW_MS) } },
    });
    if (recent >= SETUP_EMAIL_CODE_SENDS_PER_ACCOUNT) {
      throw new HttpException(
        { code: 'VERIFY_EMAIL_CODE_TOO_MANY', message: 'Too many codes requested. Try again in a few minutes.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const challengeHash = verifyEmailChallengeHash(u.id, u.email);
    const code = generateEmailCode();
    await this.prisma.client.$transaction([
      // ten-ok: the hash binds the verified principal's own id
      this.prisma.client.mfaEmailCode.deleteMany({ where: { challengeHash } }),
      // ten-ok: the row is created for the verified principal
      this.prisma.client.mfaEmailCode.create({
        data: {
          userId: u.id,
          challengeHash,
          codeHash: hashEmailCode(this.secret(), challengeHash, code),
          ipHash: hashClientIp(clientIpFromRequest(req)),
          expiresAt: new Date(now + MFA_EMAIL_CODE_TTL_MS),
        },
      }),
    ]);
    const status = (await this.emailService?.sendSetupEmailCode({ to: u.email, code })) ?? 'FAILED';
    if (status === 'FAILED') {
      // ten-ok: the hash binds the verified principal's own id
      await this.prisma.client.mfaEmailCode.deleteMany({ where: { challengeHash } }).catch(() => undefined);
      throw new HttpException(
        { code: 'VERIFY_EMAIL_CODE_NOT_SENT', message: "We couldn't send the code. Try again in a minute." },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.audit(u, 'USER_EMAIL_VERIFICATION_CODE_SENT', { ip: clientIpFromRequest(req) });
    return { sent: true, expiresInSeconds: Math.floor(MFA_EMAIL_CODE_TTL_MS / 1000) };
  }

  /** Prove the code; the gate lifts and a fresh session token comes back. */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async confirm(@Body(new ZodValidationPipe(ConfirmSchema)) body: ConfirmInput, @Req() req: Request) {
    const u = await this.pendingSelf(req);
    const code = normalizeEmailCode(body.code);
    if (!code) {
      throw new BadRequestException({ code: 'VERIFY_EMAIL_CODE_REQUIRED', message: 'Enter the 6-digit code we emailed you.' });
    }
    const result = await claimEmailCodeAttempt(this.prisma.client, {
      challengeHash: verifyEmailChallengeHash(u.id, u.email),
      userId: u.id,
      code,
      secret: this.secret(),
    });
    if (!result.ok) {
      if (result.reason === 'expired') {
        throw new BadRequestException({ code: 'VERIFY_EMAIL_CODE_EXPIRED', message: 'That code has expired. Ask for a new one.' });
      }
      if (result.reason === 'locked') {
        throw new HttpException({ code: 'VERIFY_EMAIL_CODE_LOCKED', message: 'Too many wrong codes. Ask for a new one.' }, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw new BadRequestException({ code: 'VERIFY_EMAIL_CODE_INVALID', message: "That code isn't right. Check the email and try again." });
    }
    await this.prisma.client.$transaction(async (tx: any) => {
      if (!(await spendEmailCode(tx, result.rowId))) {
        throw new BadRequestException({ code: 'VERIFY_EMAIL_CODE_INVALID', message: "That code isn't right. Check the email and try again." });
      }
      // ten-ok: identity SELF-update — only the authenticated principal's own row
      await tx.user.update({ where: { id: u.id }, data: { emailVerificationPending: false } });
    });
    await this.audit(u, 'USER_EMAIL_VERIFIED', { ip: clientIpFromRequest(req), method: 'signup-code' });
    const access_token = this.authService.signSessionToken(
      { ...u, emailVerificationPending: false },
      { iatSeconds: Math.floor(Date.now() / 1000) },
    );
    return { verified: true, access_token };
  }

  private async audit(u: { id: string; tenantId: string }, action: string, details: Record<string, unknown>) {
    try {
      await this.prisma.client.auditLog.create({
        data: { tenantId: u.tenantId, userId: u.id, action, targetType: 'User', targetId: u.id, details: JSON.stringify(details) },
      });
    } catch (e: any) {
      this.logger.warn(`audit(${action}) failed: ${e?.message ?? e}`);
    }
  }
}
