/**
 * UsersController — token revocation on privilege tightening (P1-1, 2026-05-28).
 *
 * `role` + `canTriggerPanic` live in the JWT claim and are read straight
 * off the token on the emergency path (never re-checked vs the live DB
 * row). So a demoted user, or one whose panic capability was just turned
 * off, kept the elevated capability until token expiry — up to 30 days
 * with rememberMe. These tests pin that:
 *   - a role DOWNGRADE revokes the target's live tokens,
 *   - a role UPGRADE does NOT (widening takes effect at next login),
 *   - canTriggerPanic TRUE→FALSE revokes,
 *   - canTriggerPanic FALSE→TRUE (and no-op FALSE→FALSE) does NOT,
 *   - a Redis hiccup never fails the role/panic write (best-effort revoke).
 */
import { AppRole } from '@cms/database';
import { UsersController } from './users.controller';

function makePrisma() {
  // $transaction(cb) runs cb against a tx client that mirrors the real one.
  const tx = {
    user: {
      update: jest.fn(async ({ data }: any) => ({ id: 'target-1', email: 't@s.edu', ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const client = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: tx.user.update,
      updateMany: tx.user.updateMany,
    },
    auditLog: { create: tx.auditLog.create },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  return { client } as any;
}

function makeRedis() {
  return { markUserTokensInvalid: jest.fn(async () => undefined) };
}

const SUPER = { id: 'admin-1', role: AppRole.SUPER_ADMIN, tenantId: 't1' };

describe('UsersController — revoke on tightening (P1-1)', () => {
  describe('updateRole', () => {
    it('REVOKES the target tokens on a downgrade (SCHOOL_ADMIN → CONTRIBUTOR)', async () => {
      const prisma = makePrisma();
      const redis = makeRedis();
      prisma.client.user.findFirst.mockResolvedValue({
        id: 'target-1', email: 't@s.edu', role: AppRole.SCHOOL_ADMIN, tenantId: 't1',
      });
      const ctrl = new UsersController(prisma, redis as any);

      await ctrl.updateRole({ user: SUPER }, 'target-1', { role: AppRole.CONTRIBUTOR });

      expect(redis.markUserTokensInvalid).toHaveBeenCalledTimes(1);
      expect(redis.markUserTokensInvalid).toHaveBeenCalledWith('target-1');
    });

    it('does NOT revoke on an upgrade (CONTRIBUTOR → SCHOOL_ADMIN)', async () => {
      const prisma = makePrisma();
      const redis = makeRedis();
      prisma.client.user.findFirst.mockResolvedValue({
        id: 'target-1', email: 't@s.edu', role: AppRole.CONTRIBUTOR, tenantId: 't1',
      });
      const ctrl = new UsersController(prisma, redis as any);

      await ctrl.updateRole({ user: SUPER }, 'target-1', { role: AppRole.SCHOOL_ADMIN });

      expect(redis.markUserTokensInvalid).not.toHaveBeenCalled();
    });

    it('never lets a Redis revocation failure break the role write', async () => {
      const prisma = makePrisma();
      const redis = makeRedis();
      redis.markUserTokensInvalid.mockRejectedValueOnce(new Error('redis down'));
      prisma.client.user.findFirst.mockResolvedValue({
        id: 'target-1', email: 't@s.edu', role: AppRole.SCHOOL_ADMIN, tenantId: 't1',
      });
      const ctrl = new UsersController(prisma, redis as any);

      await expect(
        ctrl.updateRole({ user: SUPER }, 'target-1', { role: AppRole.RESTRICTED_VIEWER }),
      ).resolves.toBeDefined();
      // DB write committed regardless.
      expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('setCanTriggerPanic', () => {
    it('REVOKES the target tokens when capability is removed (true → false)', async () => {
      const prisma = makePrisma();
      const redis = makeRedis();
      prisma.client.user.findUnique.mockResolvedValue({
        id: 'target-1', email: 't@s.edu', role: AppRole.CONTRIBUTOR, tenantId: 't1', canTriggerPanic: true,
      });
      const ctrl = new UsersController(prisma, redis as any);

      await ctrl.setCanTriggerPanic({ user: SUPER }, 'target-1', { canTriggerPanic: false });

      expect(redis.markUserTokensInvalid).toHaveBeenCalledTimes(1);
      expect(redis.markUserTokensInvalid).toHaveBeenCalledWith('target-1');
    });

    it('does NOT revoke when capability is granted (false → true)', async () => {
      const prisma = makePrisma();
      const redis = makeRedis();
      prisma.client.user.findUnique.mockResolvedValue({
        id: 'target-1', email: 't@s.edu', role: AppRole.CONTRIBUTOR, tenantId: 't1', canTriggerPanic: false,
      });
      const ctrl = new UsersController(prisma, redis as any);

      await ctrl.setCanTriggerPanic({ user: SUPER }, 'target-1', { canTriggerPanic: true });

      expect(redis.markUserTokensInvalid).not.toHaveBeenCalled();
    });

    it('does NOT revoke on a no-op (false → false)', async () => {
      const prisma = makePrisma();
      const redis = makeRedis();
      prisma.client.user.findUnique.mockResolvedValue({
        id: 'target-1', email: 't@s.edu', role: AppRole.CONTRIBUTOR, tenantId: 't1', canTriggerPanic: false,
      });
      const ctrl = new UsersController(prisma, redis as any);

      await ctrl.setCanTriggerPanic({ user: SUPER }, 'target-1', { canTriggerPanic: false });

      expect(redis.markUserTokensInvalid).not.toHaveBeenCalled();
    });
  });
});
