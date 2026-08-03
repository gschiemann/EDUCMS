/**
 * ACC-02 (HIGH, 2026-08-01) — credential change must END the attacker's
 * session, and there must BE a way to change a password.
 *
 * TWO holes, one finding:
 *   (a) `POST /auth/password-reset/complete` rotated `passwordHash` and
 *       nothing else. A stolen JWT (up to 30 days on a rememberMe token)
 *       kept working AFTER the victim reset their password — the reset was
 *       not a containment action. Covered in onboarding.service.spec.
 *   (b) there was NO authenticated change-password endpoint AT ALL. A user
 *       who suspected compromise had no in-product way to rotate. Covered
 *       here.
 *
 * The endpoint's contract, pinned below:
 *   1. re-verify the CURRENT password (a stolen session alone is not enough);
 *   2. rotate with the platform Argon2id config;
 *   3. revoke EVERY live session, then hand back exactly one replacement
 *      token pinned to the revocation epoch — the attacker's tokens die, the
 *      legitimate caller is not signed out by their own action;
 *   4. audit success AND failure.
 */
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';

const DB_USER = {
  id: 'u1',
  email: 'admin@school.edu',
  role: 'DISTRICT_ADMIN',
  tenantId: 'tenant-7',
  canTriggerPanic: false,
};

function makeReq(user: any = { userId: 'u1', id: 'u1' }): any {
  return {
    ip: '203.0.113.9',
    headers: { 'user-agent': 'jest-agent/1.0' },
    user,
  };
}

function setup(opts: { currentPasswordValid?: boolean; revokeThrows?: boolean } = {}) {
  const auditCreate = jest.fn().mockResolvedValue({});
  const userUpdate = jest.fn().mockResolvedValue({});
  const userFindUnique = jest.fn().mockResolvedValue(DB_USER);
  const markUserTokensInvalid = jest.fn(async () => {
    if (opts.revokeThrows) throw new Error('redis down');
  });
  const signSessionToken = jest.fn().mockReturnValue('fresh.jwt.token');

  const authService = {
    validateUser: jest
      .fn()
      .mockResolvedValue(opts.currentPasswordValid === false ? null : DB_USER),
    hashPassword: jest.fn().mockResolvedValue('$argon2id$new-hash'),
    signSessionToken,
    tenantIdForEmail: jest.fn(),
    login: jest.fn(),
  };
  const redisService = { publisher: null, markUserTokensInvalid };
  const prisma = {
    client: {
      auditLog: { create: auditCreate },
      tenant: { upsert: jest.fn() },
      user: { findUnique: userFindUnique, update: userUpdate },
    },
  };
  const controller = new AuthController(
    authService as any,
    redisService as any,
    prisma as any,
  );
  return { controller, authService, auditCreate, userUpdate, markUserTokensInvalid, signSessionToken };
}

const BODY = { currentPassword: 'old-password-1', newPassword: 'brand-new-password-2' };

describe('AuthController.changePassword (ACC-02)', () => {
  describe('the legitimate flow still works', () => {
    it('rotates the hash and returns a usable replacement token', async () => {
      const { controller, authService, userUpdate } = setup();

      const res: any = await controller.changePassword(BODY as any, makeReq());

      expect(authService.validateUser).toHaveBeenCalledWith(
        'admin@school.edu',
        'old-password-1',
      );
      expect(authService.hashPassword).toHaveBeenCalledWith('brand-new-password-2');
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { passwordHash: '$argon2id$new-hash' },
      });
      expect(res.success).toBe(true);
      expect(res.access_token).toBe('fresh.jwt.token');
      expect(res.sessionsRevoked).toBe(true);
    });

    it('writes a PASSWORD_CHANGED audit row', async () => {
      const { controller, auditCreate } = setup();
      await controller.changePassword(BODY as any, makeReq());

      const row = auditCreate.mock.calls.find(
        (c: any[]) => c[0]?.data?.action === 'PASSWORD_CHANGED',
      );
      expect(row).toBeDefined();
      expect(row![0].data.tenantId).toBe('tenant-7');
      expect(row![0].data.userId).toBe('u1');
      const details = JSON.parse(row![0].data.details);
      expect(details.ip).toBe('203.0.113.9');
      expect(details.sessionsRevoked).toBe(true);
      // Never persist the passwords themselves.
      expect(JSON.stringify(row![0].data)).not.toContain('old-password-1');
      expect(JSON.stringify(row![0].data)).not.toContain('brand-new-password-2');
    });
  });

  describe('the hole is closed — sessions are burned', () => {
    it('revokes EVERY live session for the user', async () => {
      const { controller, markUserTokensInvalid } = setup();
      await controller.changePassword(BODY as any, makeReq());
      expect(markUserTokensInvalid).toHaveBeenCalledTimes(1);
      expect(markUserTokensInvalid.mock.calls[0][0]).toBe('u1');
    });

    it('pins the replacement token AT the revocation epoch, so it survives its own revocation', async () => {
      // markUserTokensInvalid(userId, nowSec) stores nowSec + 1, and
      // JwtAuthGuard rejects on `iat < epoch`. A token signed with the ambient
      // clock would land on iat === nowSec < epoch and be rejected instantly —
      // the user would be bounced to the login screen by their own password
      // change. Pinning iat to the epoch makes the new session the FIRST valid
      // one after the cut, while every older token stays dead.
      const { controller, markUserTokensInvalid, signSessionToken } = setup();
      await controller.changePassword(BODY as any, makeReq());

      const revokeAt = markUserTokensInvalid.mock.calls[0][1] as number;
      const storedEpoch = revokeAt + 1; // RedisService.markUserTokensInvalid semantics
      const signedIat = signSessionToken.mock.calls[0][1].iatSeconds;
      expect(signedIat).toBe(storedEpoch);
      expect(signedIat < storedEpoch).toBe(false); // i.e. the guard will accept it
    });

    it('reports sessionsRevoked:false (rather than lying) when the revocation store is down', async () => {
      // The password IS already rotated here; failing the request would hide a
      // completed change. Report the partial outcome instead.
      const { controller, auditCreate } = setup({ revokeThrows: true });
      const res: any = await controller.changePassword(BODY as any, makeReq());
      expect(res.success).toBe(true);
      expect(res.sessionsRevoked).toBe(false);
      const row = auditCreate.mock.calls.find(
        (c: any[]) => c[0]?.data?.action === 'PASSWORD_CHANGED',
      );
      expect(JSON.parse(row![0].data.details).sessionsRevoked).toBe(false);
    });
  });

  describe('a stolen session alone cannot rotate the credential', () => {
    it('rejects a wrong current password and does NOT write the new hash', async () => {
      const { controller, userUpdate, markUserTokensInvalid } = setup({
        currentPasswordValid: false,
      });
      await expect(
        controller.changePassword(BODY as any, makeReq()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userUpdate).not.toHaveBeenCalled();
      expect(markUserTokensInvalid).not.toHaveBeenCalled();
    });

    it('audits the failed attempt (PASSWORD_CHANGE_FAILED)', async () => {
      const { controller, auditCreate } = setup({ currentPasswordValid: false });
      await expect(
        controller.changePassword(BODY as any, makeReq()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      const row = auditCreate.mock.calls.find(
        (c: any[]) => c[0]?.data?.action === 'PASSWORD_CHANGE_FAILED',
      );
      expect(row).toBeDefined();
      expect(JSON.parse(row![0].data.details).reason).toBe('invalid_current_password');
    });

    it('refuses to "change" a password to the same value', async () => {
      const { controller } = setup();
      await expect(
        controller.changePassword(
          { currentPassword: 'same-password-1', newPassword: 'same-password-1' } as any,
          makeReq(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('machine identities have no password to change', () => {
    it('rejects an API-key identity', async () => {
      const { controller, userUpdate } = setup();
      await expect(
        controller.changePassword(
          BODY as any,
          makeReq({ kind: 'api-key', userId: null, id: null, apiKeyId: 'k1' }),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('rejects a device identity', async () => {
      const { controller, userUpdate } = setup();
      await expect(
        controller.changePassword(BODY as any, makeReq({ kind: 'device', id: 'screen-1' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userUpdate).not.toHaveBeenCalled();
    });
  });
});
