/**
 * ACC-03 follow-up (2026-08-03) — `User.mfaRequired` finally has a writer.
 *
 * ACC-03 made the column a real login gate. Nothing had ever written it, so
 * the only way to set it was a manual DB edit — which, before the login
 * page's `mfaEnrollmentRequired` step existed, LOCKED THE TARGET OUT: the
 * enrollment endpoints they needed were session-guarded by the very session
 * the policy withholds. These tests pin the privilege rules on the writer.
 */
import { ForbiddenException, BadRequestException, HttpException } from '@nestjs/common';
import { UsersController } from './users.controller';

function makeDeps(target: any) {
  const auditCreate = jest.fn().mockResolvedValue({});
  const update = jest.fn().mockImplementation(async ({ data }: any) => ({
    id: target?.id,
    email: target?.email,
    role: target?.role,
    mfaRequired: data.mfaRequired,
  }));
  const prisma: any = {
    client: {
      user: { findUnique: jest.fn().mockResolvedValue(target) },
      $transaction: (fn: any) => fn({ user: { update }, auditLog: { create: auditCreate } }),
    },
  };
  const redis: any = { markUserTokensInvalid: jest.fn().mockResolvedValue(undefined) };
  return { prisma, redis, auditCreate, update };
}

const TARGET = {
  id: 'u-target',
  email: 'teacher@school.test',
  role: 'CONTRIBUTOR',
  tenantId: 'tenant-1',
  mfaRequired: false,
};

const CALLER = { id: 'u-admin', role: 'DISTRICT_ADMIN', tenantId: 'tenant-1' };

describe('PUT /users/:id/mfa-required', () => {
  it('sets the policy on a lower-ranked user in the caller tenant', async () => {
    const d = makeDeps(TARGET);
    const c = new UsersController(d.prisma, d.redis);
    const res = await c.setMfaRequired({ user: CALLER }, 'u-target', { mfaRequired: true });
    expect(res.mfaRequired).toBe(true);
    expect(d.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mfaRequired: true } }),
    );
  });

  it('writes an immutable before/after audit row', async () => {
    const d = makeDeps(TARGET);
    const c = new UsersController(d.prisma, d.redis);
    await c.setMfaRequired({ user: CALLER }, 'u-target', { mfaRequired: true });
    const row = d.auditCreate.mock.calls[0][0].data;
    expect(row.action).toBe('USER_MFA_REQUIRED_CHANGED');
    expect(row.userId).toBe('u-admin');
    expect(row.targetId).toBe('u-target');
    expect(JSON.parse(row.details)).toEqual(
      expect.objectContaining({ fromValue: false, toValue: true, byRole: 'DISTRICT_ADMIN' }),
    );
  });

  it('REVOKES live sessions when the policy is turned on', async () => {
    // Otherwise the policy only bites at the target's next natural login and
    // a possibly-compromised session runs for up to 30 days (rememberMe).
    const d = makeDeps(TARGET);
    const c = new UsersController(d.prisma, d.redis);
    await c.setMfaRequired({ user: CALLER }, 'u-target', { mfaRequired: true });
    expect(d.redis.markUserTokensInvalid).toHaveBeenCalledWith('u-target');
  });

  it('does NOT revoke when the policy is turned off (a widening)', async () => {
    const d = makeDeps({ ...TARGET, mfaRequired: true });
    const c = new UsersController(d.prisma, d.redis);
    await c.setMfaRequired({ user: CALLER }, 'u-target', { mfaRequired: false });
    expect(d.redis.markUserTokensInvalid).not.toHaveBeenCalled();
  });

  it('refuses a PEER — forcing a login policy is a privilege action over the account', async () => {
    const d = makeDeps({ ...TARGET, role: 'DISTRICT_ADMIN' });
    const c = new UsersController(d.prisma, d.redis);
    await expect(
      c.setMfaRequired({ user: CALLER }, 'u-target', { mfaRequired: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(d.update).not.toHaveBeenCalled();
  });

  it('refuses a target in another tenant', async () => {
    const d = makeDeps({ ...TARGET, tenantId: 'other-tenant' });
    const c = new UsersController(d.prisma, d.redis);
    await expect(
      c.setMfaRequired({ user: CALLER }, 'u-target', { mfaRequired: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets SUPER_ADMIN act cross-tenant, matching /:id/can-trigger-panic', async () => {
    const d = makeDeps({ ...TARGET, tenantId: 'other-tenant' });
    const c = new UsersController(d.prisma, d.redis);
    await expect(
      c.setMfaRequired(
        { user: { id: 'sa', role: 'SUPER_ADMIN', tenantId: 'tenant-1' } },
        'u-target',
        { mfaRequired: true },
      ),
    ).resolves.toEqual(expect.objectContaining({ mfaRequired: true }));
  });

  it('refuses a non-boolean body', async () => {
    const d = makeDeps(TARGET);
    const c = new UsersController(d.prisma, d.redis);
    await expect(
      c.setMfaRequired({ user: CALLER }, 'u-target', { mfaRequired: 'yes' as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s on an unknown user', async () => {
    const d = makeDeps(null);
    const c = new UsersController(d.prisma, d.redis);
    await expect(
      c.setMfaRequired({ user: CALLER }, 'nope', { mfaRequired: true }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

describe('GET /users — the team list can now render the policy', () => {
  it('returns mfaRequired and a derived mfaEnrolled, never the raw timestamp', async () => {
    // An admin needs to know the policy is SATISFIED, not when a colleague
    // set up their authenticator.
    const prisma: any = {
      client: {
        user: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'u1', email: 'a@b.c', role: 'CONTRIBUTOR', mfaRequired: true, mfaTotpVerifiedAt: new Date() },
            { id: 'u2', email: 'd@e.f', role: 'CONTRIBUTOR', mfaRequired: false, mfaTotpVerifiedAt: null },
          ]),
        },
      },
    };
    const c = new UsersController(prisma, {} as any);
    const rows: any[] = await c.list({ user: CALLER });
    expect(rows[0]).toEqual(expect.objectContaining({ mfaRequired: true, mfaEnrolled: true }));
    expect(rows[1]).toEqual(expect.objectContaining({ mfaRequired: false, mfaEnrolled: false }));
    expect(rows[0].mfaTotpVerifiedAt).toBeUndefined();
  });
});
