/**
 * WEBAUTHN PASSKEYS — the second factor that is not an authenticator app, and
 * the passwordless front door.
 *
 * Operator, 2026-09-21: *"can we add pass key to our security? im sick of the
 * damn auth app"*. Two jobs, both served here:
 *
 *   (a) a passkey INSTEAD of a 6-digit code at the MFA challenge, and
 *   (b) a passkey ALONE as the whole sign-in.
 *
 * Nine routes, under /api/v1/auth:
 *
 *   MANAGEMENT (JwtAuthGuard — an operator acting on their own account):
 *     GET    /passkeys                       list
 *     POST   /passkeys/register/options      password re-auth → creation options
 *     POST   /passkeys/register/verify       store the credential (+ first-time
 *                                            backup codes)
 *     PATCH  /passkeys/:id                   rename
 *     DELETE /passkeys/:id                   password re-auth → remove
 *
 *   SECOND FACTOR (PUBLIC — authorized by the partial `mfaToken` that
 *   /auth/login mints only after a correct password, exactly the trust
 *   MfaController.challenge already runs on):
 *     POST   /mfa/challenge/passkey/options
 *     POST   /mfa/challenge/passkey
 *
 *   PASSWORDLESS (PUBLIC — the credential IS the authentication):
 *     POST   /passkeys/login/options
 *     POST   /passkeys/login/verify
 *
 * ── THE FOUR THINGS THAT MAKE THIS SAFE ───────────────────────────────────
 *
 * 1. USER VERIFICATION IS REQUIRED ON EVERY CEREMONY. `residentKey:
 *    'preferred'`, `userVerification: 'required'` when minting, and
 *    `requireUserVerification: true` when verifying. That is what lets a
 *    passkey stand in for TWO factors on the passwordless path: the
 *    authenticator proves possession, and the biometric/PIN it demands before
 *    signing proves the person. Drop it and passwordless login becomes
 *    single-factor "whoever is holding the laptop".
 *
 * 2. THE RELYING PARTY IS NEVER CLIENT-CHOSEN, and is PINNED for the whole
 *    ceremony. See webauthn-config.ts + webauthn-challenge-store.ts.
 *
 * 3. CHALLENGES ARE SINGLE-USE. `take()` destroys atomically, so a captured
 *    assertion cannot be presented twice. See webauthn-challenge-store.ts.
 *
 * 4. FAILURES ARE INDISTINGUISHABLE. An unknown credential id, a bad
 *    signature, a wrong origin, a revoked account and a spent challenge all
 *    answer the SAME `401 PASSKEY_VERIFICATION_FAILED`. Anything finer is an
 *    oracle for which credential ids and which accounts exist.
 *
 * ── AND THE TWO THINGS THAT MAKE IT NOT A LOCKOUT ─────────────────────────
 *
 * 5. A user whose FIRST factor is a passkey gets backup codes at registration.
 *    They have never been through TOTP enrollment, so without this a lost
 *    phone is a permanently closed account.
 *
 * 6. The last remaining factor cannot be deleted while the policy requires
 *    one (409 PASSKEY_LAST_FACTOR) — refusing the removal up front beats
 *    discovering at the next sign-in that there is no way back in.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import { randomUUID, createHash } from 'crypto';
import { z } from 'zod';
import type { Request } from 'express';

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { clientIpFromRequest } from '../security/client-ip';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { cryptoPlatformConfig } from './crypto.config';
import { requireSecret } from '../security/required-secret';
import { USER_JWT_ALGORITHMS } from './jwt-algorithms';
import { MFA_CHALLENGE_PURPOSE } from './mfa-challenge-token';
import { MfaRateLimiter } from './mfa-rate-limiter';
import { evaluateMfaPolicy } from './mfa-policy';
import { tenantMfaEnforced } from './tenant-mfa-enforcement';
import { isLoginEligible, loginEligibility } from './login-eligibility';
import { isSsoProvisionedNoPassword } from './sso-provisioned-account';
import { hasBackupCodes, issueBackupCodes } from './mfa-backup-codes';
import {
  resolveRelyingParty,
  requestOriginHeader,
  type WebAuthnRelyingParty,
} from './webauthn-config';
import {
  challengeKey,
  resolveChallengeStore,
  WEBAUTHN_CHALLENGE_TTL_MS,
  type WebAuthnChallengeRecord,
  type WebAuthnChallengeRedis,
} from './webauthn-challenge-store';

/**
 * Ten per account. High enough for a laptop, a phone, a tablet and a couple of
 * hardware keys with room to spare; low enough that a stolen session cannot
 * quietly salt an account with credentials, and that the `excludeCredentials`
 * list stays a sane size on every ceremony.
 */
export const MAX_PASSKEYS_PER_USER = 10;

/**
 * ES256 (-7), RS256 (-257), EdDSA (-8). The three every platform
 * authenticator and security key in the field actually implements.
 */
const SUPPORTED_ALGORITHM_IDS = [-7, -257, -8];

const LABEL_MAX = 60;

const RegisterOptionsSchema = z
  .object({ password: z.string().min(1).max(256) })
  .strict();
type RegisterOptionsBody = z.infer<typeof RegisterOptionsSchema>;

/**
 * `response` is `z.any()` on purpose. Its shape is
 * `RegistrationResponseJSON` / `AuthenticationResponseJSON`, and the
 * authority on whether a given blob is one of those is
 * `verifyRegistrationResponse` / `verifyAuthenticationResponse`, which parse
 * and cryptographically check every field. A hand-written Zod mirror of the
 * WebAuthn wire format would be a SECOND, weaker parser that drifts from the
 * library's — the exact "two copies of one rule" failure this codebase keeps
 * paying for. What Zod is doing here is what Zod is for at this boundary:
 * bounding the request so a 10 MB blob never reaches the CBOR decoder, and
 * refusing unknown top-level keys.
 */
const webauthnResponse = z
  .any()
  .refine((v) => !!v && typeof v === 'object' && !Array.isArray(v), {
    message: 'response must be a WebAuthn credential object',
  });

const RegisterVerifySchema = z
  .object({
    response: webauthnResponse,
    label: z.string().trim().min(1).max(LABEL_MAX).optional(),
  })
  .strict();
type RegisterVerifyBody = z.infer<typeof RegisterVerifySchema>;

const RenameSchema = z
  .object({ label: z.string().trim().min(1).max(LABEL_MAX) })
  .strict();
type RenameBody = z.infer<typeof RenameSchema>;

const DeleteSchema = z
  .object({ password: z.string().min(1).max(256) })
  .strict();
type DeleteBody = z.infer<typeof DeleteSchema>;

const MfaOptionsSchema = z
  .object({ mfaToken: z.string().min(10).max(2048) })
  .strict();
type MfaOptionsBody = z.infer<typeof MfaOptionsSchema>;

const MfaVerifySchema = z
  .object({
    mfaToken: z.string().min(10).max(2048),
    response: webauthnResponse,
  })
  .strict();
type MfaVerifyBody = z.infer<typeof MfaVerifySchema>;

/** `{}` — no input. `.strict()` so a stray field is a 400, not silently eaten. */
const LoginOptionsSchema = z.object({}).strict();

const LoginVerifySchema = z
  .object({
    challengeId: z.string().min(8).max(128),
    response: webauthnResponse,
    rememberMe: z.boolean().optional(),
  })
  .strict();
type LoginVerifyBody = z.infer<typeof LoginVerifySchema>;

/** The generic refusal. See point 4 in the header — one code for every cause. */
function verificationFailed(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'PASSKEY_VERIFICATION_FAILED',
    message: 'That passkey could not be verified. Please try again.',
  });
}

interface PasskeyRow {
  id: string;
  credentialId: string;
  publicKey: Uint8Array | Buffer;
  counter: bigint;
  transports: string[];
  deviceLabel: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

@Controller('api/v1/auth')
export class PasskeyController {
  private readonly logger = new Logger('PasskeyController');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly rateLimiter: MfaRateLimiter,
    private readonly redis: RedisService,
  ) {}

  // ── MANAGEMENT ──────────────────────────────────────────────────────────

  @Get('passkeys')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async list(@Req() req: Request) {
    const userId = this.requireUserId(req);
    // ten-ok: identity SELF-lookup — userId IS the authenticated JWT principal
    const rows = await this.prisma.client.passkey.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      passkeys: rows.map((r) => this.publicShape(r as PasskeyRow)),
      max: MAX_PASSKEYS_PER_USER,
    };
  }

  /**
   * Creation options — gated on the ACCOUNT PASSWORD, not just the session.
   *
   * A registered passkey is a permanent, independent way into the account. An
   * access token lives at most an hour and is readable by page JavaScript by
   * construction (it travels in `Authorization:`), so letting one mint a
   * permanent credential would turn any XSS or stolen tab into durable
   * account takeover. The password re-auth is the same control
   * `POST /auth/mfa/disable` already applies to the mirror-image action.
   */
  @Post('passkeys/register/options')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async registerOptions(
    @Body(new ZodValidationPipe(RegisterOptionsSchema))
    body: RegisterOptionsBody,
    @Req() req: Request,
  ) {
    const userId = this.requireUserId(req);
    // ten-ok: identity SELF-lookup — userId IS the authenticated JWT principal
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        tenantId: true,
        firstName: true,
        lastName: true,
        passwordHash: true,
        passkeys: { select: { credentialId: true, transports: true } },
      },
    });
    if (!user)
      throw new UnauthorizedException({
        code: 'PASSKEY_USER_NOT_FOUND',
        message: 'User not found',
      });

    // An account provisioned by an external identity source has no password
    // of its own — the stored hash is a sentinel, not a credential — so there
    // is nothing to re-authenticate against and the gate above cannot be
    // satisfied. Say so plainly instead of returning "wrong password" forever.
    if (isSsoProvisionedNoPassword(user.passwordHash)) {
      throw new HttpException(
        {
          code: 'PASSKEY_PASSWORD_REQUIRED',
          message:
            'This account signs in through your identity provider and has no password of its own, ' +
            'so a passkey cannot be added here. Add one with your identity provider instead.',
        },
        HttpStatus.CONFLICT,
      );
    }

    if (!(await this.checkPassword(user.passwordHash, body.password))) {
      await this.audit(req, user.tenantId, user.id, 'PASSKEY_AUTH_FAILED', {
        stage: 'register_options',
        reason: 'bad_password',
      });
      throw new UnauthorizedException({
        code: 'PASSKEY_BAD_PASSWORD',
        message: 'Password is incorrect.',
      });
    }

    if (user.passkeys.length >= MAX_PASSKEYS_PER_USER) {
      throw new HttpException(
        {
          code: 'PASSKEY_LIMIT',
          message: `You already have ${MAX_PASSKEYS_PER_USER} passkeys. Remove one before adding another.`,
        },
        HttpStatus.CONFLICT,
      );
    }

    const rp = this.requireRelyingParty(req);
    const options = await generateRegistrationOptions({
      rpName: rp.rpName,
      rpID: rp.rpID,
      userName: user.email,
      userDisplayName: this.displayName(user),
      userID: this.userHandle(user.id),
      attestationType: 'none',
      // `residentKey: 'preferred'` is what makes passwordless possible: a
      // discoverable credential can be offered by the authenticator with no
      // username typed first. 'preferred' rather than 'required' so a key
      // with no resident-credential slots left still registers as a second
      // factor instead of erroring out at the prompt.
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
      // Stops the SAME authenticator registering twice, which would leave the
      // user with two indistinguishable rows and burn a slot against the cap.
      excludeCredentials: user.passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports as any,
      })),
    });

    await this.putChallenge(
      challengeKey('reg', user.id),
      options.challenge,
      rp,
      user.id,
    );
    return { options };
  }

  @Post('passkeys/register/verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async registerVerify(
    @Body(new ZodValidationPipe(RegisterVerifySchema)) body: RegisterVerifyBody,
    @Req() req: Request,
  ) {
    const userId = this.requireUserId(req);
    // ten-ok: identity SELF-lookup — userId IS the authenticated JWT principal
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        tenantId: true,
        mfaBackupCodes: true,
        _count: { select: { passkeys: true } },
      },
    });
    if (!user)
      throw new UnauthorizedException({
        code: 'PASSKEY_USER_NOT_FOUND',
        message: 'User not found',
      });

    const pending = await this.takeChallenge(challengeKey('reg', user.id));
    if (!pending) throw verificationFailed();

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response as RegistrationResponseJSON,
        // All three expectations come from the STORED record, never from a
        // fresh resolution — see webauthn-config.ts.
        expectedChallenge: pending.challenge,
        expectedOrigin: pending.origin,
        expectedRPID: pending.rpID,
        requireUserVerification: true,
        supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
      });
    } catch {
      // The library throws on every malformed / mismatched / unverified
      // response. Collapse them all into the one generic failure.
      verification = null;
    }
    if (!verification?.verified || !verification.registrationInfo) {
      await this.audit(req, user.tenantId, user.id, 'PASSKEY_AUTH_FAILED', {
        stage: 'register_verify',
      });
      throw verificationFailed();
    }

    // Re-check the cap against the LIVE count. The options call checked it
    // minutes ago; a parallel ceremony could have landed since.
    if ((user._count?.passkeys ?? 0) >= MAX_PASSKEYS_PER_USER) {
      throw new HttpException(
        {
          code: 'PASSKEY_LIMIT',
          message: `You already have ${MAX_PASSKEYS_PER_USER} passkeys. Remove one before adding another.`,
        },
        HttpStatus.CONFLICT,
      );
    }

    const { credential } = verification.registrationInfo;
    let created;
    try {
      created = await this.prisma.client.passkey.create({
        data: {
          userId: user.id,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter ?? 0),
          transports: (credential.transports ?? []) as string[],
          deviceLabel: body.label ?? null,
        },
      });
    } catch (err: any) {
      // `credentialId` is globally unique. `excludeCredentials` normally
      // prevents this, but an authenticator is free to ignore it.
      if (err?.code === 'P2002') {
        throw new HttpException(
          {
            code: 'PASSKEY_ALREADY_REGISTERED',
            message: 'That passkey is already registered.',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }

    // ── THE LOCKOUT GUARD (point 5 in the header) ────────────────────────
    // A user whose first second-factor is a passkey has never been through
    // TOTP enrollment, so `mfaBackupCodes` is empty and they have NO recovery
    // path if the device is lost. Mint the same ten codes TOTP enrollment
    // mints, once, and hand them back with the credential.
    let backupCodes: string[] | undefined;
    if (!hasBackupCodes(user.mfaBackupCodes)) {
      const issued = await issueBackupCodes();
      // ten-ok: identity SELF-update — user was loaded by the authenticated JWT principal's own id
      await this.prisma.client.user.update({
        where: { id: user.id },
        data: { mfaBackupCodes: issued.stored as any },
      });
      backupCodes = issued.plain;
    }

    await this.audit(req, user.tenantId, user.id, 'PASSKEY_REGISTERED', {
      passkeyId: created.id,
      label: created.deviceLabel,
      backupCodesIssued: backupCodes ? backupCodes.length : 0,
    });

    return {
      passkey: this.publicShape(created as PasskeyRow),
      // SHOW ONCE — the client must surface "save these codes". Absent when
      // the account already had a set; an absent field is not an empty one.
      ...(backupCodes ? { backupCodes } : {}),
    };
  }

  @Patch('passkeys/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async rename(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RenameSchema)) body: RenameBody,
    @Req() req: Request,
  ) {
    const userId = this.requireUserId(req);
    // `updateMany` with BOTH ids in the where clause, not `update` by id: the
    // ownership check and the write are then one statement, so there is no
    // window between them and no way to rename another user's credential.
    // ten-ok: scoped by userId, which IS the authenticated JWT principal
    const res = await this.prisma.client.passkey.updateMany({
      where: { id, userId },
      data: { deviceLabel: body.label },
    });
    if (res.count === 0) {
      throw new HttpException(
        { code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found.' },
        HttpStatus.NOT_FOUND,
      );
    }
    // ten-ok: scoped by userId, which IS the authenticated JWT principal
    const row = await this.prisma.client.passkey.findFirst({
      where: { id, userId },
    });
    await this.audit(
      req,
      await this.tenantOf(userId),
      userId,
      'PASSKEY_RENAMED',
      {
        passkeyId: id,
        label: body.label,
      },
    );
    return { passkey: this.publicShape(row as PasskeyRow) };
  }

  /**
   * Remove a passkey. Password re-auth, then the last-factor check.
   */
  @Delete('passkeys/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async remove(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DeleteSchema)) body: DeleteBody,
    @Req() req: Request,
  ) {
    const userId = this.requireUserId(req);
    // ten-ok: identity SELF-lookup — userId IS the authenticated JWT principal
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        tenantId: true,
        passwordHash: true,
        role: true,
        canTriggerPanic: true,
        mfaRequired: true,
        mfaTotpVerifiedAt: true,
        tenant: { select: { mfaEnforced: true } },
        _count: { select: { passkeys: true } },
      },
    });
    if (!user)
      throw new UnauthorizedException({
        code: 'PASSKEY_USER_NOT_FOUND',
        message: 'User not found',
      });

    if (!(await this.checkPassword(user.passwordHash, body.password))) {
      await this.audit(req, user.tenantId, user.id, 'PASSKEY_AUTH_FAILED', {
        stage: 'delete',
        reason: 'bad_password',
      });
      throw new UnauthorizedException({
        code: 'PASSKEY_BAD_PASSWORD',
        message: 'Password is incorrect.',
      });
    }

    // ten-ok: scoped by userId, which IS the authenticated JWT principal
    const target = await this.prisma.client.passkey.findFirst({
      where: { id, userId },
    });
    if (!target) {
      throw new HttpException(
        { code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    // ── LAST-FACTOR GUARD (point 6 in the header) ────────────────────────
    // Evaluate the account AS IT WOULD BE AFTER the removal — one fewer
    // passkey — and refuse if the policy would then hold no factor at all.
    // Same question, and the same `.blocking` predicate, that
    // `POST /auth/mfa/disable` asks before clearing TOTP, so the two
    // mirror-image removals can never disagree about what the policy permits.
    const remainingPasskeys = Math.max(0, (user._count?.passkeys ?? 0) - 1);
    const wouldBlock = evaluateMfaPolicy(
      {
        role: user.role,
        canTriggerPanic: user.canTriggerPanic,
        mfaRequired: user.mfaRequired,
        // NOT nulled: removing a passkey does not touch TOTP, so a user who
        // also has an authenticator app keeps that factor and the removal is
        // fine.
        mfaTotpVerifiedAt: user.mfaTotpVerifiedAt,
        hasPasskey: remainingPasskeys > 0,
      },
      { tenantEnforced: tenantMfaEnforced(user.tenant) },
    ).blocking;
    if (wouldBlock) {
      await this.audit(req, user.tenantId, user.id, 'PASSKEY_AUTH_FAILED', {
        stage: 'delete',
        reason: 'policy_requires_factor',
        passkeyId: id,
      });
      throw new HttpException(
        {
          code: 'PASSKEY_LAST_FACTOR',
          message:
            'This is the only two-factor method on your account, and your organization requires one. ' +
            'Add an authenticator app or another passkey first.',
        },
        HttpStatus.CONFLICT,
      );
    }

    // ten-ok: scoped by userId, which IS the authenticated JWT principal
    await this.prisma.client.passkey.deleteMany({ where: { id, userId } });
    await this.audit(req, user.tenantId, user.id, 'PASSKEY_REMOVED', {
      passkeyId: id,
      label: target.deviceLabel,
    });
    return { ok: true };
  }

  // ── SECOND FACTOR ───────────────────────────────────────────────────────

  @Post('mfa/challenge/passkey/options')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async mfaPasskeyOptions(
    @Body(new ZodValidationPipe(MfaOptionsSchema)) body: MfaOptionsBody,
    @Req() req: Request,
  ) {
    const { userId } = await this.userIdFromMfaToken(body.mfaToken);
    // ten-ok: identity SELF-lookup — userId is the sub of the VERIFIED partial mfaToken minted at password-check
    const passkeys = await this.prisma.client.passkey.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });
    if (passkeys.length === 0) {
      throw new UnauthorizedException({
        code: 'PASSKEY_NOT_ENROLLED',
        message:
          'This account has no passkeys. Use your authenticator app instead.',
      });
    }

    const rp = this.requireRelyingParty(req);
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      // NON-discoverable is fine here and better UX: we already know who the
      // user is (the mfaToken says so), so naming their credentials lets a
      // security key be used without the account-picker step.
      allowCredentials: passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports as any,
      })),
      userVerification: 'required',
    });

    await this.putChallenge(
      challengeKey('mfa', userId),
      options.challenge,
      rp,
      userId,
    );
    return { options };
  }

  @Post('mfa/challenge/passkey')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async mfaPasskeyVerify(
    @Body(new ZodValidationPipe(MfaVerifySchema)) body: MfaVerifyBody,
    @Req() req: Request,
  ) {
    const { userId, rememberMe } = await this.userIdFromMfaToken(body.mfaToken);

    // The SAME per-user budget TOTP attempts spend, checked before any
    // expensive crypto. A second factor with its own separate allowance would
    // simply be the cheaper one to brute-force.
    this.rateLimiter.check(userId);

    // ten-ok: identity SELF-lookup — userId is the sub of the VERIFIED partial mfaToken minted at password-check
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
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
        // MUST be selected and forwarded to `login()` below — see the comment
        // at the call site. Omitting it mints a session claiming first-login
        // credential setup is complete when it is not.
        mustSetupCredentials: true,
        tenant: { select: { archivedAt: true } },
      },
    });
    // The mfaToken is minted at the password check and lives five minutes.
    // Re-grading eligibility here closes that window: an account disabled (or
    // a tenant archived) mid-challenge must not be able to finish it.
    if (!user || !isLoginEligible(user)) {
      this.rateLimiter.record(userId, false);
      throw verificationFailed();
    }

    const pending = await this.takeChallenge(challengeKey('mfa', userId));
    if (!pending) {
      this.rateLimiter.record(userId, false);
      throw verificationFailed();
    }

    const credentialId = this.credentialIdOf(body.response);
    // Scoped to THIS user. Without the `userId` in the where clause, any
    // valid passkey in the system would satisfy any user's challenge.
    // ten-ok: scoped by userId, the principal of the verified partial mfaToken
    const passkey = credentialId
      ? await this.prisma.client.passkey.findFirst({
          where: { credentialId, userId },
        })
      : null;

    const verified = passkey
      ? await this.verifyAssertion(
          body.response as AuthenticationResponseJSON,
          passkey as PasskeyRow,
          pending,
        )
      : null;

    this.rateLimiter.record(userId, !!verified);
    if (!verified || !passkey) {
      await this.audit(req, user.tenantId, user.id, 'PASSKEY_AUTH_FAILED', {
        stage: 'mfa_challenge',
      });
      throw verificationFailed();
    }

    await this.recordUse(passkey.id, verified.newCounter);
    await this.audit(req, user.tenantId, user.id, 'PASSKEY_MFA_SUCCESS', {
      passkeyId: passkey.id,
      label: passkey.deviceLabel,
    });

    return this.finalizeLogin(user, rememberMe);
  }

  // ── PASSWORDLESS ────────────────────────────────────────────────────────

  @Post('passkeys/login/options')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async loginOptions(
    @Body(new ZodValidationPipe(LoginOptionsSchema)) _body: unknown,
    @Req() req: Request,
  ) {
    const rp = this.requireRelyingParty(req);
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      // EMPTY, and that is the point: a discoverable ceremony. Naming
      // credentials here would require knowing the user first, which would
      // mean accepting an email on an unauthenticated endpoint and answering
      // "does this account have a passkey?" — an enumeration oracle.
      allowCredentials: [],
      userVerification: 'required',
    });

    // The challenge is keyed by an opaque id we mint, because there is no
    // subject to key it by yet. The id is unguessable and single-use, so it
    // discloses nothing and cannot be spent twice.
    const challengeId = randomUUID();
    await this.putChallenge(
      challengeKey('login', challengeId),
      options.challenge,
      rp,
      null,
    );
    return { options, challengeId };
  }

  @Post('passkeys/login/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async loginVerify(
    @Body(new ZodValidationPipe(LoginVerifySchema)) body: LoginVerifyBody,
    @Req() req: Request,
  ) {
    const pending = await this.takeChallenge(
      challengeKey('login', body.challengeId),
    );
    if (!pending) throw verificationFailed();

    const credentialId = this.credentialIdOf(body.response);
    // ten-ok: an UNAUTHENTICATED lookup by globally-unique credential id — it IS the identity claim being tested
    const passkey = credentialId
      ? await this.prisma.client.passkey.findUnique({ where: { credentialId } })
      : null;
    if (!passkey) {
      // Deliberately identical to a bad signature. Answering differently
      // would let anyone enumerate which credential ids exist.
      this.logger.warn(
        '[passkey] passwordless attempt with an unknown credential id',
      );
      throw verificationFailed();
    }

    // ten-ok: identity SELF-lookup — the passkey row's own owner
    const user = await this.prisma.client.user.findUnique({
      where: { id: passkey.userId },
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
        passwordHash: true,
        mustSetupCredentials: true,
        tenant: { select: { archivedAt: true } },
      },
    });

    // ── THE SAME GATES PASSWORD LOGIN APPLIES ────────────────────────────
    // Shared with `validateUser`, not re-implemented — see
    // `login-eligibility.ts`. A soft-deleted user, a DISABLED or INVITED
    // account, and a user of an archived tenant are refused here exactly as
    // they are at the password door.
    const eligibility = loginEligibility(user as any);
    if (!user || eligibility !== 'ok') {
      await this.audit(
        req,
        user?.tenantId ?? null,
        user?.id ?? null,
        'PASSKEY_AUTH_FAILED',
        {
          stage: 'passwordless',
          reason: eligibility,
          passkeyId: passkey.id,
        },
      );
      throw verificationFailed();
    }
    // The one gate that is NOT in the shared list, because the password path
    // gets it for free: an externally-provisioned account's stored hash is a
    // sentinel that argon2 always rejects, so `validateUser` needs no explicit
    // check. There is no argon2 call on this path to do that rejecting, so it
    // is explicit here. Such an account should never have been able to
    // register a passkey (register/options refuses it) — this is the
    // defence-in-depth half of that pair.
    if (isSsoProvisionedNoPassword(user.passwordHash)) {
      await this.audit(req, user.tenantId, user.id, 'PASSKEY_AUTH_FAILED', {
        stage: 'passwordless',
        reason: 'sso-provisioned',
        passkeyId: passkey.id,
      });
      throw verificationFailed();
    }

    const verified = await this.verifyAssertion(
      body.response as AuthenticationResponseJSON,
      passkey as PasskeyRow,
      pending,
    );
    if (!verified) {
      await this.audit(req, user.tenantId, user.id, 'PASSKEY_AUTH_FAILED', {
        stage: 'passwordless',
        passkeyId: passkey.id,
      });
      throw verificationFailed();
    }

    await this.recordUse(passkey.id, verified.newCounter);
    await this.audit(req, user.tenantId, user.id, 'PASSKEY_LOGIN_SUCCESS', {
      passkeyId: passkey.id,
      label: passkey.deviceLabel,
    });

    return this.finalizeLogin(user, body.rememberMe);
  }

  // ── INTERNAL HELPERS ────────────────────────────────────────────────────

  /**
   * Hand the session back through `AuthService.login` — never by minting a
   * token here. That one call is where `origIat`, the `msc` first-login gate,
   * the rememberMe class, the tenant slug/vertical the dashboard routes on,
   * and the MFA policy notice all come from, and a second mint would be a
   * second, drifting copy of the session contract.
   *
   * `mfaAlreadySatisfied` because the ceremony that just completed IS the
   * second factor. Without it, `login()` re-derives the requirement from the
   * live row, sees a user who holds a passkey, and issues a fresh challenge —
   * the infinite challenge→verify→challenge loop `auth.service.ts` calls the
   * most dangerous edge in that file.
   */
  private finalizeLogin(
    user: {
      id: string;
      email: string;
      tenantId: string;
      role: string;
      canTriggerPanic: boolean;
      firstName: string | null;
      lastName: string | null;
      mustSetupCredentials: boolean;
    },
    rememberMe: boolean | undefined,
  ) {
    return this.auth.login(
      {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
        canTriggerPanic: user.canTriggerPanic,
        firstName: user.firstName,
        lastName: user.lastName,
        // MUST be forwarded. `AuthService.login` derives the session's `msc`
        // claim as `!!user.mustSetupCredentials` from THIS object, not from a
        // fresh read — so omitting it silently mints a session claiming setup
        // is complete, which is how the first-login credential gate was
        // bypassed through the MFA challenge in September.
        mustSetupCredentials: user.mustSetupCredentials,
      },
      rememberMe,
      { mfaAlreadySatisfied: true },
    );
  }

  /**
   * Run the assertion check. Returns null for EVERY failure — bad signature,
   * wrong origin, wrong rpID hash, user-verification flag clear, and counter
   * regression (which the library throws on: it refuses when the presented
   * counter is ≤ the stored one and either is non-zero, so a cloned
   * authenticator is caught while a synced passkey reporting 0 forever is
   * not).
   */
  private async verifyAssertion(
    response: AuthenticationResponseJSON,
    passkey: PasskeyRow,
    pending: WebAuthnChallengeRecord,
  ): Promise<{ newCounter: number } | null> {
    try {
      const result = await verifyAuthenticationResponse({
        response,
        // From the stored record — the pinned pair, never a fresh resolution.
        expectedChallenge: pending.challenge,
        expectedOrigin: pending.origin,
        expectedRPID: pending.rpID,
        requireUserVerification: true,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(passkey.publicKey),
          counter: Number(passkey.counter),
          transports: passkey.transports as any,
        },
      });
      if (!result.verified) return null;
      return { newCounter: result.authenticationInfo.newCounter };
    } catch {
      return null;
    }
  }

  /** Persist the replay counter and the "last used" stamp after a success. */
  private async recordUse(
    passkeyId: string,
    newCounter: number,
  ): Promise<void> {
    // ten-ok: the row was already resolved and ownership-checked by the caller
    await this.prisma.client.passkey.update({
      where: { id: passkeyId },
      data: {
        counter: BigInt(Math.max(0, Math.trunc(newCounter))),
        lastUsedAt: new Date(),
      },
    });
  }

  /**
   * Verify a partial `mfaToken` and return its subject. Identical trust model
   * to `MfaController.challenge`: signed with JWT_SECRET, pinned algorithms,
   * carries `purpose: mfa_challenge`, minted only after a correct password,
   * expires in minutes.
   */
  private async userIdFromMfaToken(
    mfaToken: string,
  ): Promise<{ userId: string; rememberMe: boolean | undefined }> {
    let payload: { sub?: string; purpose?: string; rememberMe?: boolean };
    try {
      payload = await this.jwt.verifyAsync(mfaToken, {
        secret: requireSecret('JWT_SECRET', {
          devFallback: 'dev_only_jwt_secret_CHANGE_ME',
        }),
        algorithms: USER_JWT_ALGORITHMS,
      });
    } catch {
      throw new UnauthorizedException({
        code: 'MFA_TOKEN_INVALID',
        message: 'MFA token is invalid or expired. Sign in again.',
      });
    }
    // The `purpose` claim is the critical guard — a normal session JWT lacks
    // it, so a stolen access token cannot be traded for a second-factor pass.
    if (payload?.purpose !== MFA_CHALLENGE_PURPOSE || !payload?.sub) {
      throw new UnauthorizedException({
        code: 'MFA_TOKEN_INVALID',
        message: 'MFA token is invalid.',
      });
    }
    return { userId: payload.sub, rememberMe: payload.rememberMe };
  }

  private requireUserId(req: Request): string {
    const actor = (req as any).user;
    const userId: string | undefined = actor?.userId || actor?.id;
    // API keys and paired devices are machine identities with no person
    // behind them to hold a passkey; they must not reach these routes.
    if (!userId || actor?.kind === 'api-key' || actor?.kind === 'device') {
      throw new UnauthorizedException({
        code: 'PASSKEY_AUTH_REQUIRED',
        message: 'Only a signed-in user account can manage passkeys.',
      });
    }
    return userId;
  }

  private requireRelyingParty(req: Request): WebAuthnRelyingParty {
    const rp = resolveRelyingParty({ requestOrigin: requestOriginHeader(req) });
    if (!rp) {
      throw new HttpException(
        {
          code: 'PASSKEY_ORIGIN_NOT_ALLOWED',
          message: 'Passkeys are not available from this address.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    return rp;
  }

  /** The ioredis handle, or null when there is no Redis on this deploy. */
  private challengeRedis(): WebAuthnChallengeRedis | null {
    return (this.redis?.publisher as unknown as WebAuthnChallengeRedis) ?? null;
  }

  private async putChallenge(
    key: string,
    challenge: string,
    rp: WebAuthnRelyingParty,
    userId: string | null,
  ): Promise<void> {
    await resolveChallengeStore(this.challengeRedis()).put(
      key,
      {
        challenge,
        rpID: rp.rpID,
        origin: rp.origin,
        userId,
        issuedAt: Date.now(),
      },
      WEBAUTHN_CHALLENGE_TTL_MS,
    );
  }

  private async takeChallenge(
    key: string,
  ): Promise<WebAuthnChallengeRecord | null> {
    return resolveChallengeStore(this.challengeRedis()).take(key);
  }

  /** The credential id a client claims, bounded so it can never be a key DoS. */
  private credentialIdOf(response: unknown): string | null {
    const id = (response as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !id || id.length > 512) return null;
    return id;
  }

  /**
   * The WebAuthn user handle. A SHA-256 of the row id: stable (so a platform
   * authenticator keeps ONE discoverable credential per account across
   * re-registrations instead of accumulating duplicates), fixed-length, and
   * within the 64-byte cap. Deliberately not the raw uuid — the handle is
   * stored on the authenticator and echoed back in every assertion, and our
   * primary keys do not need to live there. Nothing resolves a user FROM it:
   * sign-in looks the credential id up, which is unique in its own right.
   */
  private userHandle(userId: string) {
    // `Uint8Array.from`, not `new Uint8Array(buffer)`: a Node Buffer is typed
    // `Uint8Array<ArrayBufferLike>`, which does not satisfy the library's
    // `Uint8Array<ArrayBuffer>`. Copying through `from` produces the concrete
    // backing type and detaches from the pooled Buffer allocator besides.
    return Uint8Array.from(createHash('sha256').update(userId).digest());
  }

  private displayName(user: {
    firstName?: string | null;
    lastName?: string | null;
    email: string;
  }): string {
    const name = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return name || user.email;
  }

  private publicShape(row: PasskeyRow) {
    return {
      id: row.id,
      label: row.deviceLabel ?? null,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt ?? null,
      transports: row.transports ?? [],
    };
  }

  private async tenantOf(userId: string): Promise<string | null> {
    try {
      // ten-ok: identity SELF-lookup — userId IS the authenticated JWT principal
      const row = await this.prisma.client.user.findUnique({
        where: { id: userId },
        select: { tenantId: true },
      });
      return row?.tenantId ?? null;
    } catch {
      return null;
    }
  }

  private async checkPassword(
    hash: string,
    candidate: string,
  ): Promise<boolean> {
    try {
      return await argon2.verify(hash, candidate, cryptoPlatformConfig);
    } catch {
      return false;
    }
  }

  /**
   * Immutable AuditLog row. Best-effort — an audit write must never fail an
   * authentication — and it NEVER carries a challenge, a signature, a public
   * key or a backup code. `details` holds the passkey's id and label, which
   * are the things an operator reading the trail needs and which disclose
   * nothing about the credential itself.
   *
   * The client IP rides INSIDE `details` as `ip`, because `AuditLog` has no
   * `ipAddress` column — `AuthController` records `AUTH_LOGIN_SUCCESS` the
   * same way. It is resolved through `client-ip.ts`, never `req.ip`: that
   * helper counts `X-Forwarded-For` from the right by trusted-hop count, so
   * the recorded address cannot be moved by a client sending its own header.
   */
  private async audit(
    req: Request,
    tenantId: string | null,
    userId: string | null,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    const ip = clientIpFromRequest(req);
    if (!tenantId) {
      // `AuditLog.tenantId` is NOT NULL and fabricating one would corrupt
      // another tenant's trail. The only path that reaches here is a
      // passwordless attempt whose credential resolved to no readable user,
      // which the caller has already logged.
      this.logger.warn(
        `[passkey] ${action} with no attributable tenant (ip=${ip ?? 'unknown'})`,
      );
      return;
    }
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: userId ?? undefined,
          action,
          targetType: 'Passkey',
          targetId:
            (details.passkeyId as string | undefined) ?? userId ?? undefined,
          details: JSON.stringify({ ...details, ip }),
        },
      });
    } catch {
      /* swallow — never throw from the audit path */
    }
  }
}
