/**
 * Unit tests for the MFA controller — verifies the core security
 * properties listed in the audit ticket (P0-4):
 *
 *   - enroll generates a secret + valid otpauth URL
 *   - verify accepts a valid TOTP code, rejects an invalid one
 *   - backup codes are exactly 10 entries, each exactly 8 chars
 *   - disable requires password re-auth
 *   - challenge consumes backup codes (single-use)
 *
 * Tests are unit-level — Prisma + JwtService + AuthService are
 * mocked. The TOTP / cipher logic is tested through the controller
 * surface, with the totp module's deterministic `nowMs` parameter
 * threaded via spies where needed.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';

import { MfaController } from './mfa.controller';
import { MfaRateLimiter } from './mfa-rate-limiter';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { cryptoPlatformConfig } from './crypto.config';
import {
  generateTotpSecret,
  verifyTotpCode,
  buildOtpauthUrl,
  generateBackupCodes,
  TotpInternals,
  base32Decode,
} from './totp';
import { sealMfaSecret } from './mfa-secret-cipher';
import { MFA_CHALLENGE_PURPOSE } from './mfa-challenge-token';

// Use a deterministic secret + master key for tests so the cipher
// round-trip is reproducible.
process.env.DEVICE_SECRET_KEY =
  process.env.DEVICE_SECRET_KEY ||
  // 64 hex chars = 32 bytes. Pinned for reproducibility; never used
  // outside test scope.
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

interface FakeUser {
  id: string;
  email: string;
  tenantId: string;
  role: string;
  canTriggerPanic: boolean;
  passwordHash: string;
  firstName: string | null;
  lastName: string | null;
  mfaTotpSecret: string | null;
  mfaTotpVerifiedAt: Date | null;
  mfaBackupCodes: any;
}

function makeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    tenantId: 'tenant-1',
    role: 'SCHOOL_ADMIN',
    canTriggerPanic: false,
    passwordHash: '', // filled in by individual tests as needed
    firstName: null,
    lastName: null,
    mfaTotpSecret: null,
    mfaTotpVerifiedAt: null,
    mfaBackupCodes: null,
    ...overrides,
  };
}

describe('MfaController', () => {
  let controller: MfaController;
  let prisma: {
    client: {
      user: {
        findUnique: jest.Mock;
        update: jest.Mock;
      };
      auditLog: {
        create: jest.Mock;
      };
    };
  };
  let jwt: { signAsync: jest.Mock; sign: jest.Mock; verifyAsync: jest.Mock };
  let auth: { login: jest.Mock };

  // Stable timestamp for TOTP verification — tests pin time so the
  // generated code is reproducible.
  const FIXED_NOW = 1_700_000_000_000;

  beforeEach(async () => {
    prisma = {
      client: {
        user: {
          findUnique: jest.fn(),
          update: jest.fn().mockResolvedValue({}),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      },
    };
    jwt = {
      signAsync: jest.fn().mockResolvedValue('signed-token'),
      sign: jest.fn().mockReturnValue('signed-token'),
      verifyAsync: jest.fn(),
    };
    auth = {
      login: jest.fn().mockResolvedValue({
        access_token: 'final-jwt',
        user: { id: 'user-1' },
      }),
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
      // We call the controller methods directly in these tests (no
      // HTTP layer), so the guard is never consulted — but Nest tries
      // to construct it for the metadata graph anyway. Override with
      // a stub that always allows the request through.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MfaController>(MfaController);
  });

  // ---- enroll ------------------------------------------------------

  describe('enroll', () => {
    it('returns a base32 secret + valid otpauth URL', async () => {
      prisma.client.user.findUnique.mockResolvedValue(makeUser());
      const req = { user: { id: 'user-1' } } as any;
      const out = await controller.enroll(req);

      expect(out.secret).toMatch(/^[A-Z2-7]+$/);
      expect(out.secret.length).toBeGreaterThanOrEqual(16);
      expect(out.otpauthUrl).toMatch(/^otpauth:\/\/totp\/VenueOS:user%40example\.com\?/);
      expect(out.otpauthUrl).toContain('secret=');
      expect(out.otpauthUrl).toContain('issuer=VenueOS');
      expect(out.otpauthUrl).toContain('algorithm=SHA1');
      expect(out.otpauthUrl).toContain('digits=6');
      expect(out.otpauthUrl).toContain('period=30');

      // Persisted as a SEALED blob (base64), not the raw secret.
      const update = prisma.client.user.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'user-1' });
      expect(update.data.mfaTotpVerifiedAt).toBeNull();
      expect(update.data.mfaTotpSecret).toBeTruthy();
      expect(update.data.mfaTotpSecret).not.toBe(out.secret); // encrypted
      // Audit log entry written.
      expect(prisma.client.auditLog.create).toHaveBeenCalled();
      const audit = prisma.client.auditLog.create.mock.calls[0][0].data;
      expect(audit.action).toBe('mfa.enroll_started');
    });

    it('refuses enrollment when MFA is already verified', async () => {
      prisma.client.user.findUnique.mockResolvedValue(
        makeUser({ mfaTotpVerifiedAt: new Date() }),
      );
      const req = { user: { id: 'user-1' } } as any;
      await expect(controller.enroll(req)).rejects.toThrow(BadRequestException);
    });

    it('requires an authenticated request', async () => {
      const req = { user: null } as any;
      await expect(controller.enroll(req)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ---- verify ------------------------------------------------------

  describe('verify', () => {
    it('accepts a valid TOTP code and issues 10 backup codes of 8 chars', async () => {
      const { secretBase32 } = generateTotpSecret();
      prisma.client.user.findUnique.mockResolvedValue(
        makeUser({
          mfaTotpSecret: sealMfaSecret(secretBase32),
          mfaTotpVerifiedAt: null,
        }),
      );

      // Build the current code from the secret.
      const code = computeTotpCodeForSecret(secretBase32, FIXED_NOW);
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);

      const req = { user: { id: 'user-1' } } as any;
      const out = await controller.verify({ code }, req);

      expect(out.success).toBe(true);
      expect(out.backupCodes).toHaveLength(10);
      for (const bc of out.backupCodes) {
        expect(bc).toMatch(/^[A-Z2-7]{8}$/);
      }
      // Persistence: mfaTotpVerifiedAt set + backup codes stored as
      // an array of { hash, createdAt } objects.
      const update = prisma.client.user.update.mock.calls[0][0];
      expect(update.data.mfaTotpVerifiedAt).toBeInstanceOf(Date);
      expect(update.data.mfaBackupCodes).toHaveLength(10);
      for (const entry of update.data.mfaBackupCodes) {
        expect(entry.hash).toMatch(/^\$argon2id\$/);
      }
      // Audit log: success.
      const audits = prisma.client.auditLog.create.mock.calls.map(
        (c: any[]) => c[0].data.action,
      );
      expect(audits).toContain('mfa.enabled');
    });

    it('rejects an invalid TOTP code', async () => {
      const { secretBase32 } = generateTotpSecret();
      prisma.client.user.findUnique.mockResolvedValue(
        makeUser({
          mfaTotpSecret: sealMfaSecret(secretBase32),
          mfaTotpVerifiedAt: null,
        }),
      );
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
      const req = { user: { id: 'user-1' } } as any;
      await expect(controller.verify({ code: '000000' }, req)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.client.user.update).not.toHaveBeenCalled();
    });

    it('refuses if no enrollment exists', async () => {
      prisma.client.user.findUnique.mockResolvedValue(makeUser());
      const req = { user: { id: 'user-1' } } as any;
      await expect(controller.verify({ code: '123456' }, req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses if MFA is already verified', async () => {
      const { secretBase32 } = generateTotpSecret();
      prisma.client.user.findUnique.mockResolvedValue(
        makeUser({
          mfaTotpSecret: sealMfaSecret(secretBase32),
          mfaTotpVerifiedAt: new Date(),
        }),
      );
      const req = { user: { id: 'user-1' } } as any;
      await expect(controller.verify({ code: '123456' }, req)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ---- disable -----------------------------------------------------

  describe('disable', () => {
    it('requires password re-auth — rejects bad password', async () => {
      const passwordHash = await argon2.hash('correctpw', cryptoPlatformConfig);
      prisma.client.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash, mfaTotpVerifiedAt: new Date() }),
      );
      const req = { user: { id: 'user-1' } } as any;
      await expect(controller.disable({ password: 'wrongpw' }, req)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.client.user.update).not.toHaveBeenCalled();
    });

    it('clears all MFA columns with correct password', async () => {
      const passwordHash = await argon2.hash('correctpw', cryptoPlatformConfig);
      prisma.client.user.findUnique.mockResolvedValue(
        makeUser({
          passwordHash,
          mfaTotpSecret: 'sealed-blob',
          mfaTotpVerifiedAt: new Date(),
          mfaBackupCodes: [{ hash: 'h', createdAt: 'x' }],
        }),
      );
      const req = { user: { id: 'user-1' } } as any;
      const out = await controller.disable({ password: 'correctpw' }, req);
      expect(out.success).toBe(true);
      const update = prisma.client.user.update.mock.calls[0][0];
      expect(update.data.mfaTotpSecret).toBeNull();
      expect(update.data.mfaTotpVerifiedAt).toBeNull();
      expect(update.data.mfaBackupCodes).toBeNull();
      const audits = prisma.client.auditLog.create.mock.calls.map(
        (c: any[]) => c[0].data.action,
      );
      expect(audits).toContain('mfa.disabled');
    });
  });

  // ---- challenge ---------------------------------------------------

  describe('challenge', () => {
    it('finalizes login on valid TOTP code', async () => {
      const { secretBase32 } = generateTotpSecret();
      const user = makeUser({
        mfaTotpSecret: sealMfaSecret(secretBase32),
        mfaTotpVerifiedAt: new Date(),
      });
      prisma.client.user.findUnique.mockResolvedValue(user);
      jwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        purpose: MFA_CHALLENGE_PURPOSE,
        rememberMe: true,
      });
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
      const code = computeTotpCodeForSecret(secretBase32, FIXED_NOW);

      const out = await controller.challenge({ mfaToken: 't', code });
      expect(out).toEqual({ access_token: 'final-jwt', user: { id: 'user-1' } });
      expect(auth.login).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' }),
        true,
      );
    });

    it('rejects an invalid TOTP code', async () => {
      const { secretBase32 } = generateTotpSecret();
      prisma.client.user.findUnique.mockResolvedValue(
        makeUser({
          mfaTotpSecret: sealMfaSecret(secretBase32),
          mfaTotpVerifiedAt: new Date(),
        }),
      );
      jwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        purpose: MFA_CHALLENGE_PURPOSE,
      });
      await expect(
        controller.challenge({ mfaToken: 't', code: '000000' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an mfaToken without the right purpose claim', async () => {
      jwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        purpose: 'something_else',
      });
      await expect(
        controller.challenge({ mfaToken: 't', code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('consumes a backup code on use (single-use)', async () => {
      const plainCode = 'ABCDEFGH';
      const hash = await argon2.hash(plainCode, cryptoPlatformConfig);
      const otherHash = await argon2.hash('UNUSED11', cryptoPlatformConfig);
      const storedCodes = [
        { hash, createdAt: '2026-01-01T00:00:00Z' },
        { hash: otherHash, createdAt: '2026-01-01T00:00:00Z' },
      ];
      prisma.client.user.findUnique.mockResolvedValue(
        makeUser({
          mfaTotpSecret: sealMfaSecret(generateTotpSecret().secretBase32),
          mfaTotpVerifiedAt: new Date(),
          mfaBackupCodes: storedCodes,
        }),
      );
      jwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        purpose: MFA_CHALLENGE_PURPOSE,
      });

      const out = await controller.challenge({
        mfaToken: 't',
        backupCode: plainCode,
      });
      expect(out).toEqual({ access_token: 'final-jwt', user: { id: 'user-1' } });
      // The consumed code should be REMOVED from the stored array.
      const update = prisma.client.user.update.mock.calls[0][0];
      const remaining = update.data.mfaBackupCodes as Array<{ hash: string }>;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].hash).toBe(otherHash);
    });

    it('rejects a backup code that has already been consumed', async () => {
      // Simulate the post-consumption state: the entry for 'USEDCODE'
      // is no longer in the stored array.
      const otherHash = await argon2.hash('UNUSED11', cryptoPlatformConfig);
      prisma.client.user.findUnique.mockResolvedValue(
        makeUser({
          mfaTotpSecret: sealMfaSecret(generateTotpSecret().secretBase32),
          mfaTotpVerifiedAt: new Date(),
          mfaBackupCodes: [{ hash: otherHash, createdAt: 'x' }],
        }),
      );
      jwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        purpose: MFA_CHALLENGE_PURPOSE,
      });
      await expect(
        controller.challenge({ mfaToken: 't', backupCode: 'USEDCODE' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ---- backup-codes regeneration -----------------------------------

  describe('regenerateBackupCodes', () => {
    it('returns exactly 10 codes of exactly 8 chars after password re-auth', async () => {
      const passwordHash = await argon2.hash('correctpw', cryptoPlatformConfig);
      prisma.client.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash, mfaTotpVerifiedAt: new Date() }),
      );
      const req = { user: { id: 'user-1' } } as any;
      const out = await controller.regenerateBackupCodes(
        { password: 'correctpw' },
        req,
      );
      expect(out.success).toBe(true);
      expect(out.backupCodes).toHaveLength(10);
      for (const c of out.backupCodes) {
        expect(c).toHaveLength(8);
        expect(c).toMatch(/^[A-Z2-7]{8}$/);
      }
    });

    it('rejects without password re-auth', async () => {
      const passwordHash = await argon2.hash('correctpw', cryptoPlatformConfig);
      prisma.client.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash, mfaTotpVerifiedAt: new Date() }),
      );
      const req = { user: { id: 'user-1' } } as any;
      await expect(
        controller.regenerateBackupCodes({ password: 'wrong' }, req),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

// ---- helpers --------------------------------------------------------

/**
 * Compute the canonical 6-digit TOTP for a given secret + clock time.
 * Mirrors the verifier's math so tests can hand the controller a code
 * we know is correct without depending on real wall-clock time.
 */
function computeTotpCodeForSecret(secretBase32: string, nowMs: number): string {
  const counter = Math.floor(nowMs / 1000 / TotpInternals.TOTP_PERIOD_SECONDS);
  const secret = base32Decode(secretBase32);
  return TotpInternals.hotp(secret, counter);
}
