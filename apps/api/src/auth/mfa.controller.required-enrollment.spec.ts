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
      // SEC-008 — the role matters now: a SCHOOL_ADMIN with mfaRequired:false
      // IS covered (privileged role), so "no policy" has to mean a
      // non-privileged, non-panic identity or this asserts the opposite of
      // what it reads.
      prisma.client.user.findUnique.mockResolvedValue(
        baseUser({ mfaRequired: false, role: 'CONTRIBUTOR', canTriggerPanic: false }),
      );
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

/**
 * SEC-008 — THE LOCKSTEP TEST. The one that stops a bricked account.
 *
 * `AuthService.login` withholds the session from a privileged / panic-capable
 * user who has not enrolled. These two routes are the ONLY door such a user
 * has, because /auth/mfa/enroll and /verify need the very session login is
 * withholding. If the two ever disagree — login says "enrol first", this says
 * "enrollment is not required for you" — the account has no third door and is
 * locked out permanently.
 *
 * Before SEC-008 this method read the raw `mfaRequired` column while login
 * read the policy. That is precisely the divergence these cases exist to
 * prevent, so they assert the DOOR OPENS for every identity the gate closes
 * on, and stays shut for everyone else.
 */
describe('MfaController — SEC-008 enrollment door tracks the login gate exactly', () => {
  let controller: MfaController;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      client: {
        user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MfaController],
      providers: [
        MfaRateLimiter,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('signed-token'),
            verifyAsync: jest
              .fn()
              .mockResolvedValue({ sub: 'user-1', purpose: MFA_CHALLENGE_PURPOSE }),
          },
        },
        {
          provide: AuthService,
          useValue: { login: jest.fn().mockResolvedValue({ access_token: 'final-jwt' }) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get<MfaController>(MfaController);
  });

  /** The door is open when /required/enroll returns a provisional secret. */
  async function doorOpen(row: Record<string, unknown>): Promise<boolean> {
    prisma.client.user.findUnique.mockResolvedValue(
      baseUser({ mfaRequired: false, canTriggerPanic: false, ...row }),
    );
    try {
      const out: any = await controller.requiredEnroll({ mfaToken: TOKEN } as any);
      return typeof out?.secret === 'string';
    } catch (e) {
      if (e instanceof BadRequestException) return false;
      throw e;
    }
  }

  it.each(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'])(
    'OPENS for %s — the role login just refused a session to',
    async (role) => {
      await expect(doorOpen({ role })).resolves.toBe(true);
    },
  );

  it('OPENS for a panic-capable CONTRIBUTOR', async () => {
    await expect(doorOpen({ role: 'CONTRIBUTOR', canTriggerPanic: true })).resolves.toBe(true);
  });

  it('OPENS for the explicit per-user override on a plain CONTRIBUTOR (ACC-03 unchanged)', async () => {
    await expect(doorOpen({ role: 'CONTRIBUTOR', mfaRequired: true })).resolves.toBe(true);
  });

  it('STAYS SHUT for a plain CONTRIBUTOR — this is not a general enrollment route', async () => {
    await expect(doorOpen({ role: 'CONTRIBUTOR' })).resolves.toBe(false);
  });

  it('STAYS SHUT for a RESTRICTED_VIEWER with no panic capability', async () => {
    await expect(doorOpen({ role: 'RESTRICTED_VIEWER' })).resolves.toBe(false);
  });

  it('STAYS SHUT for an already-enrolled admin — a stolen partial token cannot swap the factor', async () => {
    await expect(
      doorOpen({ role: 'SUPER_ADMIN', mfaTotpVerifiedAt: new Date('2026-08-01') }),
    ).resolves.toBe(false);
  });

  it('during the GRACE window the door stays shut — a session still works, so enrol from Settings', async () => {
    const saved = process.env.MFA_REQUIRED_ENFORCE_AFTER;
    process.env.MFA_REQUIRED_ENFORCE_AFTER = '2099-01-01T00:00:00Z';
    try {
      await expect(doorOpen({ role: 'SUPER_ADMIN' })).resolves.toBe(false);
      // …but the explicit override has no grace, so its door is open even then.
      await expect(doorOpen({ role: 'CONTRIBUTOR', mfaRequired: true })).resolves.toBe(true);
    } finally {
      if (saved === undefined) delete process.env.MFA_REQUIRED_ENFORCE_AFTER;
      else process.env.MFA_REQUIRED_ENFORCE_AFTER = saved;
    }
  });
});
