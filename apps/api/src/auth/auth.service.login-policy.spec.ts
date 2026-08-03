/**
 * Login-policy gates on AuthService (2026-08-01 security wave).
 *
 * ACC-03 — `User.mfaRequired` was a DEAD COLUMN. It shipped with an
 *   "admin can force 2FA on this user" comment and had NO reader anywhere in
 *   the API or the web app (verified by grep across apps/ + packages/), so an
 *   administrator who turned it on believed the account was protected and it
 *   was not. It is now enforced on the password path: no session until the
 *   user enrols. The SSO path deliberately delegates MFA to the IdP — that
 *   decision is recorded on SsoService.completeSsoLogin.
 *
 * ACC-05 — archiving a tenant was a DISPLAY-layer change only. Its users kept
 *   logging in normally and an admin among them could still fire
 *   /emergency/trigger at real screens belonging to a "retired" location.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { cryptoPlatformConfig } from './crypto.config';

const PASSWORD = 'correct-horse-battery-1';

async function makeService(userRow: any) {
  const findUnique = jest.fn().mockResolvedValue(userRow);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('mock_jwt_token') } },
      {
        provide: PrismaService,
        useValue: {
          client: {
            user: { findUnique, update: jest.fn() },
            tenant: { findUnique: jest.fn().mockResolvedValue({ slug: 'acme', vertical: 'K12', name: 'Acme' }) },
          },
        },
      },
    ],
  }).compile();
  return { service: module.get<AuthService>(AuthService), findUnique };
}

async function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'admin@acme.edu',
    role: 'DISTRICT_ADMIN',
    tenantId: 'tenant-1',
    status: 'ACTIVE',
    deletedAt: null,
    canTriggerPanic: false,
    mfaRequired: false,
    mfaTotpVerifiedAt: null,
    passwordHash: await argon2.hash(PASSWORD, {
      type: cryptoPlatformConfig.type,
      memoryCost: cryptoPlatformConfig.memoryCost,
      timeCost: cryptoPlatformConfig.timeCost,
      parallelism: cryptoPlatformConfig.parallelism,
    }),
    tenant: { archivedAt: null },
    ...overrides,
  };
}

describe('ACC-05 — a user of an ARCHIVED tenant cannot log in', () => {
  it('refuses the CORRECT password when the tenant is archived', async () => {
    const { service } = await makeService(
      await userRow({ tenant: { archivedAt: new Date('2026-07-23') } }),
    );
    // Correct credentials, archived workspace → no user, therefore no session.
    await expect(service.validateUser('admin@acme.edu', PASSWORD)).resolves.toBeNull();
  });

  it('still authenticates when the tenant is NOT archived (no regression)', async () => {
    const { service } = await makeService(await userRow());
    const u = await service.validateUser('admin@acme.edu', PASSWORD);
    expect(u).toBeTruthy();
    expect(u.id).toBe('u1');
    // The archive join must not leak into the returned user shape.
    expect(u.passwordHash).toBeUndefined();
    expect(u.tenant).toBeUndefined();
  });

  it('pulls the archive state in the SAME query (no extra round-trip on the auth hot path)', async () => {
    const { service, findUnique } = await makeService(await userRow());
    await service.validateUser('admin@acme.edu', PASSWORD);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique.mock.calls[0][0].include).toEqual({
      tenant: { select: { archivedAt: true } },
    });
  });

  it('is indistinguishable from a wrong password (no archived-tenant oracle)', async () => {
    // Both branches return null — an attacker cannot use login responses to
    // enumerate which workspaces have been archived.
    const { service } = await makeService(
      await userRow({ tenant: { archivedAt: new Date() } }),
    );
    await expect(service.validateUser('admin@acme.edu', PASSWORD)).resolves.toBeNull();
    await expect(service.validateUser('admin@acme.edu', 'wrong')).resolves.toBeNull();
  });
});

describe('ACC-03 — mfaRequired is enforced on the password path', () => {
  it('withholds the session when mfaRequired is set and the user has NOT enrolled', async () => {
    const { service } = await makeService(await userRow());
    const res: any = await service.login({
      id: 'u1',
      email: 'admin@acme.edu',
      tenantId: 'tenant-1',
      role: 'DISTRICT_ADMIN',
      mfaRequired: true,
      mfaTotpVerifiedAt: null,
    });
    // No session — a challenge envelope flagged for ENROLLMENT.
    expect(res.access_token).toBeUndefined();
    expect(res.mfaRequired).toBe(true);
    expect(res.mfaEnrollmentRequired).toBe(true);
    expect(typeof res.mfaToken).toBe('string');
  });

  it('issues the normal TOTP challenge (not enrollment) when the user IS enrolled', async () => {
    const { service } = await makeService(await userRow());
    const res: any = await service.login({
      id: 'u1',
      email: 'admin@acme.edu',
      tenantId: 'tenant-1',
      role: 'DISTRICT_ADMIN',
      mfaRequired: true,
      mfaTotpVerifiedAt: new Date(),
    });
    expect(res.mfaRequired).toBe(true);
    expect(res.mfaEnrollmentRequired).toBeUndefined();
    expect(res.access_token).toBeUndefined();
  });

  it('does NOT change login for a user without the policy (no regression)', async () => {
    const { service } = await makeService(await userRow());
    const res: any = await service.login({
      id: 'u1',
      email: 'admin@acme.edu',
      tenantId: 'tenant-1',
      role: 'DISTRICT_ADMIN',
      canTriggerPanic: false,
      mfaRequired: false,
      mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBe('mock_jwt_token');
    expect(res.mfaRequired).toBeUndefined();
  });
});

describe('ACC-02 — signSessionToken pins iat for post-credential-change reissue', () => {
  it('signs with the supplied iat so the new token outlives the revocation cut', async () => {
    const sign = jest.fn().mockReturnValue('tok');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: { sign } },
        { provide: PrismaService, useValue: { client: { user: {}, tenant: {} } } },
      ],
    }).compile();
    const service = module.get<AuthService>(AuthService);

    service.signSessionToken(
      { id: 'u1', email: 'a@b.c', tenantId: 't1', role: 'CONTRIBUTOR' },
      { iatSeconds: 1_770_000_000 },
    );
    expect(sign.mock.calls[0][0]).toEqual(
      expect.objectContaining({ sub: 'u1', tenantId: 't1', iat: 1_770_000_000 }),
    );
  });
});
