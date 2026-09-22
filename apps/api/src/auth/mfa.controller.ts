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
import { generateTotpSecret, buildOtpauthUrl, verifyTotpCode } from './totp';
import { issueBackupCodes, type StoredBackupCode } from './mfa-backup-codes';
import { sealMfaSecret, openMfaSecret } from './mfa-secret-cipher';
import { MfaRateLimiter } from './mfa-rate-limiter';
import { MFA_CHALLENGE_PURPOSE } from './mfa-challenge-token';
import { USER_JWT_ALGORITHMS } from './jwt-algorithms';
import { evaluateMfaPolicy } from './mfa-policy';
import { tenantMfaEnforced } from './tenant-mfa-enforcement';
// The gate on this file's unauthenticated enrollment door. It lived here as a
// private method until 2026-09-21, when `/auth/mfa/required/passkey/*` gave it
// a SECOND caller on another controller — see the module's header for why a
// copy of an inverted gate is not survivable.
import { assertEnrollmentRequired } from './mfa-required-enrollment-gate';

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

/**
 * ACC-03 — bodies for the REQUIRED-MFA enrollment pair. Both carry the
 * short-lived partial `mfaToken` that /auth/login hands back when a user has
 * `mfaRequired` set but has not enrolled yet; that token IS the authorization
 * (it is only minted after a successful password check).
 */
const RequiredEnrollSchema = z
  .object({ mfaToken: z.string().min(10).max(2048) })
  .strict();
type RequiredEnroll = z.infer<typeof RequiredEnrollSchema>;

const RequiredVerifySchema = z
  .object({
    mfaToken: z.string().min(10).max(2048),
    code: z.string().min(6).max(10),
  })
  .strict();
type RequiredVerify = z.infer<typeof RequiredVerifySchema>;

const ISSUER_NAME = process.env.MFA_ISSUER || 'VenueOS';

// The hashed-backup-codes JSON blob shape, and the code that mints it, both
// live in ./mfa-backup-codes — one issuer, because the passkey path is now a
// fifth caller and a divergent copy would mint codes that never verify here.

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
      throw new UnauthorizedException({ code: 'MFA_AUTH_REQUIRED', message: 'Authentication required' });
    }
    // ten-ok: identity SELF-lookup — id IS the authenticated JWT principal; no narrower scope exists
    const dbUser = await this.prisma.client.user.findUnique({
      where: { id: reqUser.id },
      select: { mfaTotpVerifiedAt: true, _count: { select: { passkeys: true } } },
    });
    return {
      // Unchanged meaning: TOTP specifically. The settings UI's "Authenticator
      // app" toggle reads this, and widening it to "has any factor" would make
      // that toggle claim TOTP is on for a passkey-only user.
      enabled: !!dbUser?.mfaTotpVerifiedAt,
      // Additive (2026-09-21) — lets the same screen render the passkey list
      // header and decide whether turning TOTP off would leave no factor.
      passkeyCount: dbUser?._count?.passkeys ?? 0,
    };
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
      throw new UnauthorizedException({ code: 'MFA_AUTH_REQUIRED', message: 'Authentication required' });
    }

    // Re-load the user row so we have the canonical state (the JWT
    // claims may be stale if the user just changed MFA from another
    // session).
    // ten-ok: identity SELF-lookup — id IS the authenticated JWT principal; no narrower scope exists
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
      throw new UnauthorizedException({ code: 'MFA_USER_NOT_FOUND', message: 'User not found' });
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

    // ten-ok: identity SELF-update — dbUser was loaded by the authenticated JWT principal's own id
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
      throw new UnauthorizedException({ code: 'MFA_AUTH_REQUIRED', message: 'Authentication required' });
    }

    // ten-ok: identity SELF-lookup — id IS the authenticated JWT principal; no narrower scope exists
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
    // One issuer for the whole platform — see mfa-backup-codes.ts.
    const { plain: plainCodes, stored } = await issueBackupCodes();

    // ten-ok: identity SELF-update — dbUser was loaded by the authenticated JWT principal's own id
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
   *
   * ── 2026-09-11 — IT NOW CONSULTS THE POLICY, WHICH IT NEVER DID ────────
   * Until today the whole authorization was one password re-check followed by
   * an unconditional clear: a SCHOOL_ADMIN in an enforcing organization could
   * simply delete the factor their policy requires. That was bounded only
   * because both refresh gates re-evaluate against the live row, so the live
   * session died within the hour — a bound that depends on an unrelated
   * mechanism staying exactly as it is, which is not a control.
   *
   * So: refuse when the effective policy (per-user override OR the tenant's
   * derived requirement) still requires a second factor on this account. The
   * user is told to have the requirement lifted first, which is a real,
   * named path — not "contact support".
   *
   * The evaluation is deliberately done WITHOUT the user's current
   * `mfaTotpVerifiedAt`: the question is "would removing this leave the
   * account non-compliant?", and evaluating the row as it stands would answer
   * "enrolled, therefore not blocking" and permit every removal.
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
      throw new UnauthorizedException({ code: 'MFA_AUTH_REQUIRED', message: 'Authentication required' });
    }

    // ten-ok: identity SELF-lookup — id IS the authenticated JWT principal; no narrower scope exists
    const dbUser = await this.prisma.client.user.findUnique({
      where: { id: reqUser.id },
      select: {
        id: true,
        tenantId: true,
        email: true,
        passwordHash: true,
        // 2026-09-11 — the policy inputs. This select carried none of them,
        // so the route could not have consulted the policy even if it wanted
        // to. `tenant` is the per-tenant enforcement setting.
        role: true,
        canTriggerPanic: true,
        mfaRequired: true,
        tenant: { select: { mfaEnforced: true } },
        // WEBAUTHN (2026-09-21) — THE OPERATOR'S ACTUAL GOAL. "I'm sick of the
        // damn auth app" means turning TOTP off while keeping a second factor,
        // and this gate is what stood in the way: it evaluates the account as
        // it WOULD BE after the removal, and without the passkey count that
        // hypothetical account has no factor at all, so an enforcing policy
        // refuses every such removal. With it, a user holding a passkey is
        // still enrolled after TOTP goes, and the removal is allowed.
        _count: { select: { passkeys: true } },
      },
    });
    if (!dbUser) {
      throw new UnauthorizedException({ code: 'MFA_USER_NOT_FOUND', message: 'User not found' });
    }

    const passOk = await this.checkPassword(dbUser.passwordHash, body.password);
    if (!passOk) {
      await this.audit(dbUser.tenantId, dbUser.id, 'mfa.disable_failed', {
        reason: 'bad_password',
      });
      throw new ForbiddenException({
        message: 'Password is incorrect.',
        code: 'MFA_BAD_PASSWORD',
      });
    }

    // The password is right. The POLICY still may not be. Evaluate the account
    // AS IT WOULD BE after the removal — `mfaTotpVerifiedAt: null` — so the
    // question is "does this account still owe a second factor?" rather than
    // "is it compliant right now?" (it is, which is why the naive check
    // permits every removal).
    const wouldBlock = evaluateMfaPolicy(
      {
        role: dbUser.role,
        canTriggerPanic: dbUser.canTriggerPanic,
        mfaRequired: dbUser.mfaRequired,
        mfaTotpVerifiedAt: null,
        // NOT nulled out, unlike `mfaTotpVerifiedAt` above: disabling TOTP
        // does not touch passkeys, so the account this hypothetical describes
        // still holds every one of them. Zeroing it here would model a
        // removal that is not happening and refuse a compliant change.
        hasPasskey: (dbUser._count?.passkeys ?? 0) > 0,
      },
      { tenantEnforced: tenantMfaEnforced(dbUser.tenant) },
    ).blocking;
    if (wouldBlock) {
      await this.audit(dbUser.tenantId, dbUser.id, 'mfa.disable_refused', {
        reason: 'policy_requires_mfa',
      });
      throw new ForbiddenException({
        code: 'MFA_REQUIRED_BY_POLICY',
        message:
          'Two-factor authentication is required for this account, so it cannot be turned off. ' +
          'An administrator has to lift the requirement first.',
      });
    }

    // ten-ok: identity SELF-update — dbUser was loaded by the authenticated JWT principal's own id
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
      throw new UnauthorizedException({ code: 'MFA_AUTH_REQUIRED', message: 'Authentication required' });
    }

    // ten-ok: identity SELF-lookup — id IS the authenticated JWT principal; no narrower scope exists
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
      throw new UnauthorizedException({ code: 'MFA_USER_NOT_FOUND', message: 'User not found' });
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
      throw new ForbiddenException({
        message: 'Password is incorrect.',
        code: 'MFA_BAD_PASSWORD',
      });
    }

    // One issuer for the whole platform — see mfa-backup-codes.ts.
    const { plain: plainCodes, stored } = await issueBackupCodes();

    // ten-ok: identity SELF-update — dbUser was loaded by the authenticated JWT principal's own id
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
        // Pinned, same as the session guard — see jwt-algorithms.ts.
        algorithms: USER_JWT_ALGORITHMS,
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

    // ten-ok: identity SELF-lookup — userId is the sub of the VERIFIED partial mfaToken minted at password-check
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
        // Same reason as the enrollment path's select — see the comment at the
        // login() call below. An already-enrolled user who still owes a
        // credential claim must not exit /challenge with an unrestricted
        // session.
        mustSetupCredentials: true,
        _count: { select: { passkeys: true } },
      },
    });
    // "MFA enabled" = an authenticator app OR a passkey (2026-09-21).
    //
    // This guard used to read `mfaTotpVerifiedAt` alone, for BOTH proofs this
    // endpoint accepts. With passkeys that is a LOCKOUT: someone who adds a
    // passkey, turns the authenticator app off (the whole point — "im sick of
    // the damn auth app"), and then loses the phone reaches this endpoint
    // with a valid RECOVERY CODE in hand and was answered MFA_NOT_ENABLED.
    // The controller specs all passed; the lead's end-to-end run (real
    // browser, virtual authenticator removed to simulate the lost device)
    // is what found it. Walk the recovery path before you ship the gate.
    //
    //  • a BACKUP code is accepted when EITHER factor is enrolled — the codes
    //    live on the User row and are issued with the first factor of either
    //    kind (mfa-backup-codes.ts);
    //  • an AUTHENTICATOR code still requires the authenticator app — there
    //    is no secret to check it against otherwise.
    const hasTotp = !!dbUser?.mfaTotpVerifiedAt && !!dbUser?.mfaTotpSecret;
    const hasPasskey = (dbUser?._count?.passkeys ?? 0) > 0;
    if (!dbUser || (!hasTotp && !hasPasskey)) {
      // The user removed their last factor between login and challenge —
      // treat as an invalid challenge and force a fresh login.
      throw new UnauthorizedException({
        message: 'MFA is not enabled on this account.',
        code: 'MFA_NOT_ENABLED',
      });
    }
    if (body.code && !hasTotp) {
      // Not a guess at a secret (there is none), so it does not burn the
      // per-user attempt budget — it is a wrong DOOR, and the copy says which
      // doors exist.
      throw new UnauthorizedException({
        message:
          'This account has no authenticator app set up. Use your passkey, or a backup code.',
        code: 'MFA_TOTP_NOT_ENABLED',
      });
    }

    // 3. Verify the code OR consume a backup code.
    let success = false;
    let usedBackup = false;
    let updatedBackupCodes: StoredBackupCode[] | null = null;

    if (body.code) {
      let secretBase32: string;
      try {
        // `hasTotp` above guarantees the secret is present on this branch.
        secretBase32 = openMfaSecret(dbUser.mfaTotpSecret as string);
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
      // ten-ok: identity SELF-update — dbUser was loaded by the verified mfaToken principal's own id
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
    //
    //    `mfaAlreadySatisfied` (SEC-008): the second factor was just proven,
    //    two dozen lines up. The curated object below deliberately carries no
    //    `mfa*` fields, so without this flag AuthService.login would re-derive
    //    the requirement from the ROLE and challenge an admin who has this
    //    instant passed their challenge — a permanent login loop.
    return this.auth.login(
      {
        id: dbUser.id,
        email: dbUser.email,
        tenantId: dbUser.tenantId,
        role: dbUser.role,
        canTriggerPanic: dbUser.canTriggerPanic,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        // MUST be forwarded. `AuthService.login` derives the session's `msc`
        // claim as `!!user.mustSetupCredentials` from THIS object, not from a
        // fresh read — so omitting it silently mints a session claiming setup
        // is complete. That bypassed the whole first-login credential gate for
        // every privileged account that had not yet claimed its own password
        // (measured 2026-09-08 against production: GET /tenants returned 200
        // on a session minted here while the live row still said true).
        mustSetupCredentials: dbUser.mustSetupCredentials,
      },
      payload.rememberMe,
      { mfaAlreadySatisfied: true },
    );
  }

  // ---- ACC-03: REQUIRED-MFA ENROLLMENT (unauthenticated, token-gated) ----
  //
  // WHY THESE EXIST. `User.mfaRequired` is now enforced at login
  // (AuthService.login): a user carrying the policy who has not enrolled gets
  // NO session, only a partial `mfaToken`. But /enroll and /verify above are
  // `@UseGuards(JwtAuthGuard)` — they need the very session the policy is
  // withholding. Without these two routes the policy would be a lockout, not
  // a control, so "enforce mfaRequired" would have meant "brick the account".
  //
  // The authorization here is the partial mfaToken itself: it is signed with
  // JWT_SECRET, carries `purpose: MFA_CHALLENGE_PURPOSE`, expires in minutes,
  // and is only ever minted AFTER a correct password. That is the same trust
  // the existing /challenge endpoint runs on. These routes deliberately do
  // NOTHING beyond enrollment: they cannot be used by an already-enrolled
  // user (they reject when `mfaTotpVerifiedAt` is set, so a stolen partial
  // token cannot re-enroll a device over someone's existing factor), and they
  // cannot be used by a user without the policy.

  /**
   * Issue a provisional TOTP secret for a user who MUST enroll before they
   * can finish signing in. Mirrors /enroll, but authorized by the partial
   * mfaToken instead of a session.
   */
  @Post('required/enroll')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async requiredEnroll(
    @Body(new ZodValidationPipe(RequiredEnrollSchema)) body: RequiredEnroll,
  ) {
    const dbUser = await this.userFromChallengeToken(body.mfaToken);
    assertEnrollmentRequired(dbUser);

    const { secretBase32 } = generateTotpSecret();
    const otpauthUrl = buildOtpauthUrl(secretBase32, ISSUER_NAME, dbUser.email);

    // ten-ok: identity SELF-update — dbUser was loaded by the verified mfaToken principal's own id
    await this.prisma.client.user.update({
      where: { id: dbUser.id },
      data: { mfaTotpSecret: sealMfaSecret(secretBase32), mfaTotpVerifiedAt: null },
    });

    await this.audit(dbUser.tenantId, dbUser.id, 'mfa.enroll_started', {
      provisional: true,
      policy: 'mfaRequired',
    });

    return { secret: secretBase32, otpauthUrl, qrSvg: null as string | null, issuer: ISSUER_NAME, label: dbUser.email };
  }

  /**
   * Confirm the provisional secret and COMPLETE the held-back login. On
   * success the account is enrolled (backup codes issued once) and the caller
   * receives the real session envelope — the same shape /auth/login would
   * have returned had the policy not been in force.
   */
  @Post('required/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async requiredVerify(
    @Body(new ZodValidationPipe(RequiredVerifySchema)) body: RequiredVerify,
  ) {
    const { dbUser, rememberMe } = await this.userFromChallengeTokenWithOpts(body.mfaToken);
    assertEnrollmentRequired(dbUser);
    if (!dbUser.mfaTotpSecret) {
      throw new BadRequestException({
        message: 'No pending MFA enrollment. Call /auth/mfa/required/enroll first.',
        code: 'MFA_NOT_ENROLLED',
      });
    }

    // Per-user throttle BEFORE the cipher/TOTP work, same as /challenge.
    this.rateLimiter.check(dbUser.id);

    let secretBase32: string;
    try {
      secretBase32 = openMfaSecret(dbUser.mfaTotpSecret);
    } catch {
      await this.audit(dbUser.tenantId, dbUser.id, 'mfa.verify_failed', {
        reason: 'cipher_open_failed',
        policy: 'mfaRequired',
      });
      throw new BadRequestException({
        message: 'MFA enrollment is corrupted. Please re-enroll.',
        code: 'MFA_CIPHER_INVALID',
      });
    }

    const ok = verifyTotpCode(secretBase32, body.code);
    this.rateLimiter.record(dbUser.id, ok);
    if (!ok) {
      await this.audit(dbUser.tenantId, dbUser.id, 'mfa.verify_failed', {
        reason: 'invalid_code',
        policy: 'mfaRequired',
      });
      throw new UnauthorizedException({
        message: 'Code does not match. Try again from your Authenticator app.',
        code: 'MFA_INVALID_CODE',
      });
    }

    // One issuer for the whole platform — see mfa-backup-codes.ts.
    const { plain: plainCodes, stored } = await issueBackupCodes();

    // ten-ok: identity SELF-update — dbUser was loaded by the verified mfaToken principal's own id
    await this.prisma.client.user.update({
      where: { id: dbUser.id },
      data: { mfaTotpVerifiedAt: new Date(), mfaBackupCodes: stored as any },
    });

    await this.audit(dbUser.tenantId, dbUser.id, 'mfa.enabled', {
      backupCodesIssued: stored.length,
      policy: 'mfaRequired',
    });

    // Finalize the login. The object passed here deliberately carries NO
    // mfa* fields (same as /challenge), and `mfaAlreadySatisfied` tells
    // AuthService.login that enrollment COMPLETED in this request — the row
    // it would otherwise re-read is the one we just wrote. Without the flag
    // the SEC-008 role-derived policy would challenge the user again the
    // instant they finished enrolling.
    const session = await this.auth.login(
      {
        id: dbUser.id,
        email: dbUser.email,
        tenantId: dbUser.tenantId,
        role: dbUser.role,
        canTriggerPanic: dbUser.canTriggerPanic,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        // MUST be forwarded. `AuthService.login` derives the session's `msc`
        // claim as `!!user.mustSetupCredentials` from THIS object, not from a
        // fresh read — so omitting it silently mints a session claiming setup
        // is complete. That bypassed the whole first-login credential gate for
        // every privileged account that had not yet claimed its own password
        // (measured 2026-09-08 against production: GET /tenants returned 200
        // on a session minted here while the live row still said true).
        mustSetupCredentials: dbUser.mustSetupCredentials,
      },
      rememberMe,
      { mfaAlreadySatisfied: true },
    );

    return { ...session, backupCodes: plainCodes };
  }

  // ---- Internal helpers --------------------------------------------

  /** Verify a partial mfaToken and load its user. Throws 401 on any doubt. */
  private async userFromChallengeTokenWithOpts(mfaToken: string) {
    let payload: { sub?: string; purpose?: string; rememberMe?: boolean };
    try {
      payload = await this.jwt.verifyAsync(mfaToken, {
        secret: requireSecret('JWT_SECRET', { devFallback: 'dev_only_jwt_secret_CHANGE_ME' }),
        // Pinned, same as the session guard — see jwt-algorithms.ts.
        algorithms: USER_JWT_ALGORITHMS,
      });
    } catch {
      throw new UnauthorizedException({
        message: 'MFA token is invalid or expired. Sign in again.',
        code: 'MFA_TOKEN_INVALID',
      });
    }
    if (payload?.purpose !== MFA_CHALLENGE_PURPOSE || !payload?.sub) {
      throw new UnauthorizedException({ message: 'MFA token is invalid.', code: 'MFA_TOKEN_INVALID' });
    }
    // ten-ok: identity SELF-lookup — sub is the principal of the VERIFIED partial mfaToken minted at password-check
    const dbUser = await this.prisma.client.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        canTriggerPanic: true,
        firstName: true,
        lastName: true,
        mfaRequired: true,
        mfaTotpSecret: true,
        mfaTotpVerifiedAt: true,
        // FIRST-LOGIN CREDENTIAL SETUP (2026-09-08). Without this column the
        // hand-built object below carries `mustSetupCredentials: undefined`,
        // AuthService.login stamps `msc: !!undefined` = false, and a user who
        // has NOT claimed their credentials walks out of MFA with a full,
        // unrestricted session. See the comment at both login() call sites.
        mustSetupCredentials: true,
        // PER-TENANT MFA ENFORCEMENT (2026-09-11). The escape hatch must reach
        // the SAME verdict as AuthService.login or the account BRICKS (see
        // `mfa-required-enrollment-gate.ts`) — and login now reads the tenant.
        // A selected `tenantId` is NOT the policy; this join is. Removing it
        // is a build failure at `assertEnrollmentRequired()`, whose `tenant`
        // key is typed REQUIRED for exactly that reason.
        tenant: { select: { mfaEnforced: true } },
        // ⚠️ WEBAUTHN (2026-09-21) — THE MOST LOAD-BEARING LINE IN THIS SELECT.
        // `assertEnrollmentRequired` is the one gate in the policy that runs
        // BACKWARDS: it OPENS when the policy blocks. Omitting `hasPasskey`
        // grades a passkey-only account as unenrolled, which makes the policy
        // "block", which OPENS this unauthenticated door — and the door
        // enrols a brand-new TOTP secret. A stolen partial `mfaToken` (minted
        // at password check, so: anyone with the password) could then install
        // their own authenticator over an account whose second factor is a
        // passkey, and walk in. With the count, such an account is graded
        // enrolled, the door answers MFA_NOT_REQUIRED, and the only way to add
        // a factor stays the session-gated one.
        _count: { select: { passkeys: true } },
      },
    });
    if (!dbUser) {
      throw new UnauthorizedException({ message: 'User not found.', code: 'MFA_USER_NOT_FOUND' });
    }
    return { dbUser, rememberMe: payload.rememberMe };
  }

  private async userFromChallengeToken(mfaToken: string) {
    return (await this.userFromChallengeTokenWithOpts(mfaToken)).dbUser;
  }

  // The gate these two routes run on — `assertEnrollmentRequired` — moved to
  // `mfa-required-enrollment-gate.ts` on 2026-09-21, unchanged, when
  // `/auth/mfa/required/passkey/*` became its second caller. Its block comment
  // (including the SEC-008 lockstep warning and why two of its keys are typed
  // REQUIRED) went with it; read it there before touching either door.

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

