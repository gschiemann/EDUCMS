/**
 * ACC-03 (2026-08-01) — the enrollment path that makes `mfaRequired`
 * ENFORCEABLE rather than a lockout.
 *
 * `User.mfaRequired` shipped as a dead column: no reader anywhere. Enforcing
 * it at login (AuthService.login now withholds the session) creates an
 * immediate problem — /auth/mfa/enroll and /verify are `@UseGuards(
 * JwtAuthGuard)`, so they need the very session the policy is withholding.
 * Without these two token-gated routes, "enforce mfaRequired" would have meant
 * "brick every account the policy is applied to". That is the trap this suite
 * exists to keep closed.
 *
 * The authorization is the partial `mfaToken`: signed with JWT_SECRET, carries
 * `purpose: MFA_CHALLENGE_PURPOSE`, minutes-long TTL, and only ever minted
 * AFTER a correct password — the same trust the existing /challenge runs on.
 * These routes must do NOTHING else: not re-enroll an already-enrolled user
 * (a stolen partial token must not be able to swap someone's second factor),
 * and not serve a user without the policy.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { MfaController } from './mfa.controller';
import { MfaRateLimiter } from './mfa-rate-limiter';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { generateTotpSecret, TotpInternals, base32Decode } from './totp';
import { sealMfaSecret } from './mfa-secret-cipher';
import { MFA_CHALLENGE_PURPOSE } from './mfa-challenge-token';

/**
 * Canonical 6-digit TOTP for a secret at a pinned clock time — mirrors the
 * verifier's math so the tests never depend on real wall-clock time. Same
 * helper as mfa.controller.spec.ts.
 */
function computeTotpCodeForSecret(secretBase32: string, nowMs: number): string {
  const counter = Math.floor(nowMs / 1000 / TotpInternals.TOTP_PERIOD_SECONDS);
  return TotpInternals.hotp(base32Decode(secretBase32), counter);
}

process.env.DEVICE_SECRET_KEY =
  process.env.DEVICE_SECRET_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const FIXED_NOW = 1_700_000_000_000;
const TOKEN = 'partial.mfa.token';

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'user@example.com',
    tenantId: 'tenant-1',
    role: 'SCHOOL_ADMIN',
    canTriggerPanic: false,
    firstName: null,
    lastName: null,
    mfaRequired: true,
    mfaTotpSecret: null,
    mfaTotpVerifiedAt: null,
    ...overrides,
  };
}

describe('MfaController — required-MFA enrollment (ACC-03)', () => {
  let controller: MfaController;
  let prisma: any;
  let jwt: any;
  let auth: any;

  beforeEach(async () => {
    prisma = {
      client: {
        user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      },
    };
    jwt = {
      sign: jest.fn().mockReturnValue('signed-token'),
      signAsync: jest.fn().mockResolvedValue('signed-token'),
      // Valid partial token by default.
      verifyAsync: jest
        .fn()
        .mockResolvedValue({ sub: 'user-1', purpose: MFA_CHALLENGE_PURPOSE, rememberMe: true }),
    };
    auth = {
      login: jest
        .fn()
        .mockResolvedValue({ access_token: 'final-jwt', user: { id: 'user-1' } }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MfaController,
        MfaRateLimiter,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: AuthService, useValue: auth },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MfaController>(MfaController);
  });

  describe('required/enroll', () => {
    it('issues a provisional secret WITHOUT a session (the whole point)', async () => {
      prisma.client.user.findUnique.mockResolvedValue(baseUser());

      const out = await controller.requiredEnroll({ mfaToken: TOKEN });

      expect(out.secret).toMatch(/^[A-Z2-7]+$/);
      expect(out.otpauthUrl).toMatch(/^otpauth:\/\/totp\/VenueOS:user%40example\.com\?/);
      const update = prisma.client.user.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'user-1' });
      // Provisional until verified — an interrupted enrollment can't lock
      // anyone out or half-arm the factor.
      expect(update.data.mfaTotpVerifiedAt).toBeNull();
      expect(update.data.mfaTotpSecret).not.toBe(out.secret); // sealed at rest
    });

    it('REJECTS an invalid / expired partial token', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('bad token'));
      await expect(
        controller.requiredEnroll({ mfaToken: TOKEN }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.client.user.update).not.toHaveBeenCalled();
    });

    it('REJECTS a token minted for a different purpose (no token reuse)', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', purpose: 'password-reset' });
      await expect(
        controller.requiredEnroll({ mfaToken: TOKEN }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('REJECTS an already-enrolled user — a stolen partial token cannot swap the factor', async () => {
      prisma.client.user.findUnique.mockResolvedValue(
        baseUser({ mfaTotpVerifiedAt: new Date() }),
      );
      await expect(
        controller.requiredEnroll({ mfaToken: TOKEN }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.client.user.update).not.toHaveBeenCalled();
    });

    it('REJECTS a user who does not carry the policy (narrow scope)', async () => {
      prisma.client.user.findUnique.mockResolvedValue(baseUser({ mfaRequired: false }));
      await expect(
        controller.requiredEnroll({ mfaToken: TOKEN }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.client.user.update).not.toHaveBeenCalled();
    });
  });

  describe('required/verify', () => {
    const nowSpy = () => jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);

    function enrolledPending() {
      const { secretBase32 } = generateTotpSecret();
      prisma.client.user.findUnique.mockResolvedValue(
        baseUser({ mfaTotpSecret: sealMfaSecret(secretBase32) }),
      );
      return secretBase32;
    }

    afterEach(() => jest.restoreAllMocks());

    it('completes the held-back login on a valid code', async () => {
      const secret = enrolledPending();
      nowSpy();
      const code = computeTotpCodeForSecret(secret, FIXED_NOW);

      const out: any = await controller.requiredVerify({ mfaToken: TOKEN, code });

      // Enrollment persisted…
      const update = prisma.client.user.update.mock.calls[0][0];
      expect(update.data.mfaTotpVerifiedAt).toBeInstanceOf(Date);
      expect(Array.isArray(update.data.mfaBackupCodes)).toBe(true);
      expect(update.data.mfaBackupCodes).toHaveLength(10);
      // …and the REAL session is returned (this is what unblocks the user).
      expect(out.access_token).toBe('final-jwt');
      expect(out.backupCodes).toHaveLength(10);
    });

    it('finalizes without looping back into another challenge', async () => {
      // login() branches on mfaTotpVerifiedAt, which is NOW set on the DB row.
      // The object handed to login must therefore carry no mfa* fields, or the
      // user would be bounced into a second challenge and never get in.
      const secret = enrolledPending();
      nowSpy();
      await controller.requiredVerify({
        mfaToken: TOKEN,
        code: computeTotpCodeForSecret(secret, FIXED_NOW),
      });
      const passed = auth.login.mock.calls[0][0];
      expect(passed.mfaTotpVerifiedAt).toBeUndefined();
      expect(passed.mfaRequired).toBeUndefined();
      // rememberMe from the partial token is honored.
      expect(auth.login.mock.calls[0][1]).toBe(true);
    });

    it('REJECTS an invalid code and does NOT enroll', async () => {
      enrolledPending();
      nowSpy();
      await expect(
        controller.requiredVerify({ mfaToken: TOKEN, code: '000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.client.user.update).not.toHaveBeenCalled();
      expect(auth.login).not.toHaveBeenCalled();
    });

    it('REJECTS when no provisional secret exists (must call enroll first)', async () => {
      prisma.client.user.findUnique.mockResolvedValue(baseUser({ mfaTotpSecret: null }));
      await expect(
        controller.requiredVerify({ mfaToken: TOKEN, code: '123456' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('REJECTS an already-enrolled user', async () => {
      prisma.client.user.findUnique.mockResolvedValue(
        baseUser({ mfaTotpVerifiedAt: new Date(), mfaTotpSecret: 'x' }),
      );
      await expect(
        controller.requiredVerify({ mfaToken: TOKEN, code: '123456' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(auth.login).not.toHaveBeenCalled();
    });

    it('audits the enrollment as policy-driven', async () => {
      const secret = enrolledPending();
      nowSpy();
      await controller.requiredVerify({
        mfaToken: TOKEN,
        code: computeTotpCodeForSecret(secret, FIXED_NOW),
      });
      const enabled = prisma.client.auditLog.create.mock.calls
        .map((c: any[]) => c[0].data)
        .find((d: any) => d.action === 'mfa.enabled');
      expect(enabled).toBeDefined();
      expect(JSON.parse(enabled.details).policy).toBe('mfaRequired');
    });
  });
});
