/**
 * MFA (TOTP) controller — RFC 6238 second factor for user login.
 *
 * Five endpoints, all under /api/v1/auth/mfa:
 *   POST /enroll             — enrolled-user: generate fresh secret,
 *                              return otpauth URL + QR for the user's
 *                              Authenticator app. Secret is stored
 *                              encrypted but PROVISIONAL — login still
 *                              works password-only until /verify succeeds.
 *   POST /verify             — enrolled-user: confirm the user can read
 *                              codes from their app, flip the secret to
 *                              "verified", mint + return 10 single-use
 *                              backup codes (Argon2id-hashed at rest).
 *   POST /disable            — enrolled-user: password re-auth, clear
 *                              all MFA columns.
 *   POST /backup-codes       — enrolled-user: password re-auth,
 *                              regenerate the 10 backup codes
 *                              (invalidates any unused ones).
 *   POST /challenge          — UNAUTHENTICATED, takes the partial
 *                              `mfaToken` from /auth/login and a 6-digit
 *                              code OR backup code; returns the full
 *                              login envelope (access_token + user) on
 *                              success.
 *
 * Audit-logged every call (success AND failure). The MFA secret never
 * leaves this file's process scope in plaintext — sealed bytes go to
 * the DB, decrypted in-memory for verify, then discarded.
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import { z } from 'zod';
import type { Request } from 'express';

import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { cryptoPlatformConfig } from './crypto.config';
import { requireSecret } from '../security/required-secret';
import {
  generateTotpSecret,
  buildOtpauthUrl,
  verifyTotpCode,
  generateBackupCodes,
} from './totp';
import { sealMfaSecret, openMfaSecret } from './mfa-secret-cipher';
import { MfaRateLimiter } from './mfa-rate-limiter';
import { MFA_CHALLENGE_PURPOSE } from './mfa-challenge-token';

const PasswordReauthSchema = z
  .object({ password: z.string().min(1).max(256) })
  .strict();
type PasswordReauth = z.infer<typeof PasswordReauthSchema>;

const VerifyEnrollSchema = z
  .object({
    // Accept whitespace tolerance in the code — some Authenticator
    // apps render "123 456" rather than "123456" and users will copy
    // it as displayed.
    code: z.string().min(6).max(10),
  })
  .strict();
type VerifyEnroll = z.infer<typeof VerifyEnrollSchema>;

const ChallengeSchema = z
  .object({
    mfaToken: z.string().min(10).max(2048),
    code: z.string().min(6).max(10).optional(),
    backupCode: z.string().min(8).max(20).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.code) !== Boolean(v.backupCode), {
    message: 'Provide either code or backupCode, not both / neither.',
  });
type Challenge = z.infer<typeof ChallengeSchema>;

const ISSUER_NAME = process.env.MFA_ISSUER || 'VenueOS';

/**
 * Re-export of cryptoPlatformConfig with `raw` pinned to the string
 * branch. argon2's TS types use a discriminated union on `raw`; the
 * loosely-typed Options bag fails overload resolution. This narrows
 * to the "return string" overload that every callsite in this file
 * wants. Identical params (m=64MB / t=3 / p=4).
 */
const ARGON_HASH_OPTS = {
  type: cryptoPlatformConfig.type,
  memoryCost: cryptoPlatformConfig.memoryCost,
  timeCost: cryptoPlatformConfig.timeCost,
  parallelism: cryptoPlatformConfig.parallelism,
} as const;

// Reasonable shape for the hashed-backup-codes JSON blob.
// Each entry: { hash: argon2id-hash-of-plaintext, createdAt: iso }
interface StoredBackupCode {
  hash: string;
  createdAt: string;
}

@Controller('api/v1/auth/mfa')
export class MfaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly rateLimiter: MfaRateLimiter,
  ) {}

  /**
   * Generate a fresh TOTP secret + otpauth URL. The secret is stored
   * encrypted but marked PROVISIONAL — mfaTotpVerifiedAt stays null
   * until /verify succeeds. Calling /enroll twice replaces any
   * provisional secret with a new one (last-write-wins) so a user
   * who fails to scan can simply re-issue.
   */
  /**
   * GET /auth/mfa/status — is TOTP MFA enabled for the authenticated user?
   * Lets the settings UI render the correct enrolled state on a cold page
   * load (instead of inferring it only from an enroll-attempt 400). Reloads
   * the canonical DB row — JWT claims may be stale after a cross-session change.
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async status(@Req() req: Request) {
    const reqUser = (req as any).user;
    if (!reqUser?.id) {
      throw new UnauthorizedException('Authentication required');
    }
    const dbUser = await this.prisma.client.user.findUnique({
      where: { id: reqUser.id },
      select: { mfaTotpVerifiedAt: true },
    });
    return { enabled: !!dbUser?.mfaTotpVerifiedAt };
  }

  @Post('enroll')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  // 10/min/user is generous (typical enrollment is one call). The
  // tighter envelope is the JWT requirement — /enroll requires the
  // user already be authenticated.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async enroll(@Req() req: Request) {
    const reqUser = (req as any).user;
    if (!reqUser?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    // Re-load the user row so we have the canonical state (the JWT
    // claims may be stale if the user just changed MFA from another
    // session).
    const dbUser = await this.prisma.client.user.findUnique({
      where: { id: reqUser.id },
      select: {
        id: true,
        email: true,
        tenantId: true,
        mfaTotpVerifiedAt: true,
      },
    });
    if (!dbUser) {
      throw new UnauthorizedException('User not found');
    }

    // Already-enrolled users must /disable first. Otherwise an
    // attacker with a stolen JWT could enroll their OWN device and
    // hijack the second factor.
    if (dbUser.mfaTotpVerifiedAt) {
      throw new BadRequestException({
        message: 'MFA is already enabled. Disable it first to re-enroll.',
        code: 'MFA_ALREADY_ENABLED',
      });
    }

    const { secretBase32 } = generateTotpSecret();
    const otpauthUrl = buildOtpauthUrl(secretBase32, ISSUER_NAME, dbUser.email);

    await this.prisma.client.user.update({
      where: { id: dbUser.id },
      data: {
        mfaTotpSecret: sealMfaSecret(secretBase32),
        // Explicitly null — we're (re)issuing a provisional secret.
        mfaTotpVerifiedAt: null,
      },
    });

    await this.audit(dbUser.tenantId, dbUser.id, 'mfa.enroll_started', { provisional: true });

    return {
      // Per spec: the secret is shown ONCE so the user can manually
      // type it into their Authenticator if QR scan fails. After
      // /verify it never leaves the DB in plaintext form again.
      secret: secretBase32,
      otpauthUrl,
      // QR rendering deferred to the client. The otpauthUrl is the
      // canonical input; clients can pass it to qrcode.react / a
      // server-side renderer / a stand-alone qrcode-svg npm package
      // without us pulling another dep into the API. Returning the
      // URL as `qrSvg` would require shipping the renderer in the
      // API; that's a follow-up.
      qrSvg: null as string | null,
      issuer: ISSUER_NAME,
      label: dbUser.email,
    };
  }

  /**
   * Verify the user can read codes from their Authenticator. On
   * success: mark verified, mint 10 backup codes, hash them with
   * Argon2id, return the plaintext codes ONCE.
   */
  @Post('verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async verify(
    @Body(new ZodValidationPipe(VerifyEnrollSchema)) body: VerifyEnroll,
    @Req() req: Request,
  ) {
    const reqUser = (req as any).user;
    if (!reqUser?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    const dbUser = await this.prisma.client.user.findUnique({
      where: { id: reqUser.id },
      select: {
        id: true,
        tenantId: true,
        mfaTotpSecret: true,
        mfaTotpVerifiedAt: true,
      },
    });
    if (!dbUser?.mfaTotpSecret) {
      throw new BadRequestException({
        message: 'No pending MFA enrollment. Call /enroll first.',
        code: 'MFA_NOT_ENROLLED',
      });
    }
    if (dbUser.mfaTotpVerifiedAt) {
      throw new BadRequestException({
        message: 'MFA is already verified.',
        code: 'MFA_ALREADY_ENABLED',
      });
    }

    let secretBase32: string;
    try {
      secretBase32 = openMfaSecret(dbUser.mfaTotpSecret);
    } catch {
      // Corrupted / master-key mismatch. Refuse and require re-enroll.
      await this.audit(dbUser.tenantId, dbUser.id, 'mfa.verify_failed', {
        reason: 'cipher_open_failed',
      });
      throw new BadRequestException({
        message: 'MFA enrollment is corrupted. Please re-enroll.',
        code: 'MFA_CIPHER_INVALID',
      });
    }

    const ok = verifyTotpCode(secretBase32, body.code);
    if (!ok) {
      await this.audit(dbUser.tenantId, dbUser.id, 'mfa.verify_failed', {
        reason: 'invalid_code',
      });
      throw new UnauthorizedException({
        message: 'Code does not match. Try again from your Authenticator app.',
        code: 'MFA_INVALID_CODE',
      });
    }

    // Generate + hash backup codes.
    const plainCodes = generateBackupCodes(10);
    const stored: StoredBackupCode[] = [];
    for (const c of plainCodes) {
      stored.push({
        hash: await argon2.hash(c, ARGON_HASH_OPTS),
        createdAt: new Date().toISOString(),
      });
    }

    await this.prisma.client.user.update({
      where: { id: dbUser.id },
      data: {
        mfaTotpVerifiedAt: new Date(),
        mfaBackupCodes: stored as any, // Json column
      },
    });

    await this.audit(dbUser.tenantId, dbUser.id, 'mfa.enabled', {
      backupCodesIssued: stored.length,
    });

    return {
      success: true,
      // SHOW ONCE — frontend must surface "save these codes" UX.
      backupCodes: plainCodes,
    };
  }

  /**
   * Disable MFA. Requires password re-auth so a stolen session
   * cannot single-handedly remove the second factor.
   */
  @Post('disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async disable(
    @Body(new ZodValidationPipe(PasswordReauthSchema)) body: PasswordReauth,
    @Req() req: Request,
  ) {
    const reqUser = (req as any).user;
    if (!reqUser?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    const dbUser = await this.prisma.client.user.findUnique({
      where: { id: reqUser.id },
      select: { id: true, tenantId: true, email: true, passwordHash: true },
    });
    if (!dbUser) {
      throw new UnauthorizedException('User not found');
    }

    const passOk = await this.checkPassword(dbUser.passwordHash, body.password);
    if (!passOk) {
      await this.audit(dbUser.tenantId, dbUser.id, 'mfa.disable_failed', {
        reason: 'bad_password',
      });
      throw new UnauthorizedException({
        message: 'Password is incorrect.',
        code: 'MFA_BAD_PASSWORD',
      });
    }

    await this.prisma.client.user.update({
      where: { id: dbUser.id },
      data: {
        mfaTotpSecret: null,
        mfaTotpVerifiedAt: null,
        mfaBackupCodes: null as any,
      },
    });
    await this.audit(dbUser.tenantId, dbUser.id, 'mfa.disabled', {});
    return { success: true };
  }

  /**
   * Re-issue backup codes. Requires password re-auth. All previously
   * issued codes are invalidated atomically (the stored array is
   * replaced wholesale).
   */
  @Post('backup-codes')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async regenerateBackupCodes(
    @Body(new ZodValidationPipe(PasswordReauthSchema)) body: PasswordReauth,
    @Req() req: Request,
  ) {
    const reqUser = (req as any).user;
    if (!reqUser?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    const dbUser = await this.prisma.client.user.findUnique({
      where: { id: reqUser.id },
      select: {
        id: true,
        tenantId: true,
        passwordHash: true,
        mfaTotpVerifiedAt: true,
      },
    });
    if (!dbUser) {
      throw new UnauthorizedException('User not found');
    }
    if (!dbUser.mfaTotpVerifiedAt) {
      throw new BadRequestException({
        message: 'MFA is not enabled.',
        code: 'MFA_NOT_ENABLED',
      });
    }

    const passOk = await this.checkPassword(dbUser.passwordHash, body.password);
    if (!passOk) {
      await this.audit(dbUser.tenantId, dbUser.id, 'mfa.backup_codes_failed', {
        reason: 'bad_password',
      });
      throw new UnauthorizedException({
        message: 'Password is incorrect.',
        code: 'MFA_BAD_PASSWORD',
      });
    }

    const plainCodes = generateBackupCodes(10);
    const stored: StoredBackupCode[] = [];
    for (const c of plainCodes) {
      stored.push({
        hash: await argon2.hash(c, ARGON_HASH_OPTS),
        createdAt: new Date().toISOString(),
      });
    }

    await this.prisma.client.user.update({
      where: { id: dbUser.id },
      data: { mfaBackupCodes: stored as any },
    });
    await this.audit(dbUser.tenantId, dbUser.id, 'mfa.backup_codes_regenerated', {
      issued: stored.length,
    });

    return { success: true, backupCodes: plainCodes };
  }

  /**
   * Public (no JwtAuthGuard) — finishes a login that returned
   * `mfaRequired:true`. Verifies the partial mfaToken, runs the code
   * (TOTP or backup), then finalizes the session via authService.login.
   *
   * Rate-limited per user (in-memory limiter from this module) AND
   * per IP (Throttle decorator).
   */
  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async challenge(@Body(new ZodValidationPipe(ChallengeSchema)) body: Challenge) {
    // 1. Decode and verify the mfaToken's signature + claims.
    let payload: { sub?: string; purpose?: string; rememberMe?: boolean };
    try {
      payload = await this.jwt.verifyAsync(body.mfaToken, {
        secret: requireSecret('JWT_SECRET', {
          devFallback: 'dev_only_jwt_secret_CHANGE_ME',
        }),
      });
    } catch {
      throw new UnauthorizedException({
        message: 'MFA token is invalid or expired. Sign in again.',
        code: 'MFA_TOKEN_INVALID',
      });
    }
    if (payload?.purpose !== MFA_CHALLENGE_PURPOSE || !payload?.sub) {
      throw new UnauthorizedException({
        message: 'MFA token is invalid.',
        code: 'MFA_TOKEN_INVALID',
      });
    }

    const userId = payload.sub;
    // 2. Per-user rate limit check (BEFORE expensive cipher / argon
    //    verify operations).
    this.rateLimiter.check(userId);

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
        mfaTotpSecret: true,
        mfaTotpVerifiedAt: true,
        mfaBackupCodes: true,
      },
    });
    if (!dbUser || !dbUser.mfaTotpVerifiedAt || !dbUser.mfaTotpSecret) {
      // The user disabled MFA between login and challenge — treat as
      // an invalid challenge and force a fresh login.
      throw new UnauthorizedException({
        message: 'MFA is not enabled on this account.',
        code: 'MFA_NOT_ENABLED',
      });
    }

    // 3. Verify the code OR consume a backup code.
    let success = false;
    let usedBackup = false;
    let updatedBackupCodes: StoredBackupCode[] | null = null;

    if (body.code) {
      let secretBase32: string;
      try {
        secretBase32 = openMfaSecret(dbUser.mfaTotpSecret);
      } catch {
        // Cipher error is a hard fail — log + bail.
        await this.audit(dbUser.tenantId, dbUser.id, 'mfa.challenge_failed', {
          reason: 'cipher_open_failed',
        });
        throw new UnauthorizedException({
          message: 'MFA verification failed. Please contact support.',
          code: 'MFA_CIPHER_INVALID',
        });
      }
      success = verifyTotpCode(secretBase32, body.code);
    } else if (body.backupCode) {
      const cleaned = body.backupCode.replace(/\s+/g, '').toUpperCase();
      const stored = (dbUser.mfaBackupCodes as unknown as StoredBackupCode[] | null) || [];
      // Try each hash. Argon2 verify is intentionally slow (~45ms), so
      // 10 codes = ~450ms upper bound. Acceptable for a login flow.
      const remaining: StoredBackupCode[] = [];
      let matched = false;
      for (const entry of stored) {
        if (!matched) {
          try {
            const ok = await argon2.verify(entry.hash, cleaned, cryptoPlatformConfig);
            if (ok) {
              matched = true;
              continue; // consume this entry — do NOT push it back
            }
          } catch {
            // Skip malformed entries gracefully but keep the row.
          }
        }
        remaining.push(entry);
      }
      success = matched;
      usedBackup = matched;
      if (matched) updatedBackupCodes = remaining;
    }

    this.rateLimiter.record(userId, success);

    if (!success) {
      await this.audit(dbUser.tenantId, dbUser.id, 'mfa.challenge_failed', {
        reason: 'invalid_code',
        usedBackupCodePath: !!body.backupCode,
      });
      throw new UnauthorizedException({
        message: body.backupCode
          ? 'Backup code does not match. Each code is single-use.'
          : 'Code does not match. Try again from your Authenticator app.',
        code: 'MFA_INVALID_CODE',
      });
    }

    // 4. Persist backup-code consumption (atomic; we deliberately do
    //    this AFTER rate-limiter record so a DB error here doesn't
    //    burn a code without the user knowing).
    if (usedBackup && updatedBackupCodes) {
      await this.prisma.client.user.update({
        where: { id: dbUser.id },
        data: { mfaBackupCodes: updatedBackupCodes as any },
      });
    }

    await this.audit(dbUser.tenantId, dbUser.id, 'mfa.challenge_succeeded', {
      usedBackupCode: usedBackup,
      backupCodesRemaining: updatedBackupCodes?.length ?? null,
    });

    // 5. Finalize the login envelope using the same code path as a
    //    normal password login.
    return this.auth.login(
      {
        id: dbUser.id,
        email: dbUser.email,
        tenantId: dbUser.tenantId,
        role: dbUser.role,
        canTriggerPanic: dbUser.canTriggerPanic,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
      },
      payload.rememberMe,
    );
  }

  // ---- Internal helpers --------------------------------------------

  private async checkPassword(hash: string, candidate: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, candidate, cryptoPlatformConfig);
    } catch {
      return false;
    }
  }

  private async audit(
    tenantId: string,
    userId: string | null,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    // Audit writes are best-effort — never throw from the audit
    // path. Same shape as the AI key controller (proven pattern).
    // AuditLog.tenantId is NOT NULL in the schema; every MFA endpoint
    // here authenticates via JwtAuthGuard which loads tenantId from
    // the JWT claim, so it is always known.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: userId ?? undefined,
          action,
          targetType: 'User',
          targetId: userId ?? undefined,
          details: JSON.stringify(details),
        },
      });
    } catch {
      /* swallow */
    }
  }
}

