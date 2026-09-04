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

  it('does NOT change login for a user the policy does not cover (no regression)', async () => {
    const { service } = await makeService(await userRow());
    const res: any = await service.login({
      id: 'u1',
      email: 'writer@acme.edu',
      tenantId: 'tenant-1',
      // SEC-008 — must be a NON-privileged, NON-panic identity now: a
      // DISTRICT_ADMIN with mfaRequired:false is covered by the derived
      // policy, so the old fixture would have asserted the opposite of what
      // it reads. See the SEC-008 block below for the covered roles.
      role: 'CONTRIBUTOR',
      canTriggerPanic: false,
      mfaRequired: false,
      mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBe('mock_jwt_token');
    expect(res.mfaRequired).toBeUndefined();
  });
});

/**
 * SEC-008 (2026-09-04) — the policy that finally turns MFA on.
 *
 * ACC-03 made `mfaRequired` enforceable; nothing ever set it. These cases
 * cover the DERIVED requirement — privileged role or panic capability — at
 * `AuthService.login`, which is the point the assessment names: "require MFA
 * before issuing a full session."
 *
 * apps/api/test/jest.setup.ts pins MFA_REQUIRED_ENFORCE_AFTER=now for the
 * whole suite, so "blocking" here means the post-deadline steady state. The
 * grace window is driven explicitly in its own block below.
 */
describe('SEC-008 - privileged and panic-capable identities need a second factor', () => {
  const PRIVILEGED = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'];

  it.each(PRIVILEGED)('%s gets NO session until enrolled', async (role) => {
    const { service } = await makeService(await userRow());
    const res: any = await service.login({
      id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1', role,
      canTriggerPanic: false, mfaRequired: false, mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBeUndefined();
    expect(res.mfaRequired).toBe(true);
    expect(res.mfaEnrollmentRequired).toBe(true);
    expect(typeof res.mfaToken).toBe('string');
  });

  it.each(PRIVILEGED)('%s WITH a verified factor gets the normal TOTP challenge', async (role) => {
    const { service } = await makeService(await userRow());
    const res: any = await service.login({
      id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1', role,
      mfaRequired: false, mfaTotpVerifiedAt: new Date('2026-08-01'),
    });
    expect(res.mfaRequired).toBe(true);
    // Enrolled -> the CHALLENGE path, not the ENROLLMENT path.
    expect(res.mfaEnrollmentRequired).toBeUndefined();
    expect(res.access_token).toBeUndefined();
  });

  it('a panic-capable CONTRIBUTOR gets NO session until enrolled - the capability is the reason', async () => {
    const { service } = await makeService(await userRow());
    const res: any = await service.login({
      id: 'u1', email: 'coach@acme.edu', tenantId: 'tenant-1',
      role: 'CONTRIBUTOR', canTriggerPanic: true,
      mfaRequired: false, mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBeUndefined();
    expect(res.mfaEnrollmentRequired).toBe(true);
  });

  it('a panic-capable RESTRICTED_VIEWER is covered too', async () => {
    const { service } = await makeService(await userRow());
    const res: any = await service.login({
      id: 'u1', email: 'viewer@acme.edu', tenantId: 'tenant-1',
      role: 'RESTRICTED_VIEWER', canTriggerPanic: true, mfaTotpVerifiedAt: null,
    });
    expect(res.mfaEnrollmentRequired).toBe(true);
  });

  it('a non-panic CONTRIBUTOR is untouched', async () => {
    const { service } = await makeService(await userRow());
    const res: any = await service.login({
      id: 'u1', email: 'writer@acme.edu', tenantId: 'tenant-1',
      role: 'CONTRIBUTOR', canTriggerPanic: false, mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBe('mock_jwt_token');
  });

  /**
   * THE LOOP GUARD. MfaController hands `login` a curated user object with no
   * `mfa*` fields after it has just verified a TOTP code or completed
   * enrollment. Because SEC-008 derives the requirement from the ROLE, that
   * object would re-trigger the gate - challenge -> verify -> challenge, for
   * ever, for every admin. `mfaAlreadySatisfied` is the only thing standing
   * between the policy and a fleet-wide admin lockout.
   */
  it('mfaAlreadySatisfied finalizes the session for a privileged user (no challenge loop)', async () => {
    const { service } = await makeService(await userRow());
    const res: any = await service.login(
      { id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1', role: 'SUPER_ADMIN' },
      undefined,
      { mfaAlreadySatisfied: true },
    );
    expect(res.access_token).toBe('mock_jwt_token');
    expect(res.mfaRequired).toBeUndefined();
  });

  it('mfaAlreadySatisfied also skips the ENROLLED-user challenge branch', async () => {
    const { service } = await makeService(await userRow());
    const res: any = await service.login(
      {
        id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1', role: 'SUPER_ADMIN',
        mfaTotpVerifiedAt: new Date('2026-08-01'),
      },
      undefined,
      { mfaAlreadySatisfied: true },
    );
    expect(res.access_token).toBe('mock_jwt_token');
  });

  /**
   * The account-CREATION exemption (OnboardingService.signup / acceptInvite).
   * Bounded on purpose: no rememberMe, so a 1-hour session on a brand-new
   * account, and the next login is gated like everyone else's.
   */
  it('skipPolicyGate lets an account-creation path mint the first session', async () => {
    const { service } = await makeService(await userRow());
    const res: any = await service.login(
      { id: 'u1', email: 'new@acme.edu', tenantId: 'tenant-1', role: 'DISTRICT_ADMIN' },
      undefined,
      { skipPolicyGate: true },
    );
    expect(res.access_token).toBe('mock_jwt_token');
  });

  it('skipPolicyGate does NOT bypass a real enrolled factor (it is not a skip-MFA switch)', async () => {
    const { service } = await makeService(await userRow());
    const res: any = await service.login(
      {
        id: 'u1', email: 'new@acme.edu', tenantId: 'tenant-1', role: 'DISTRICT_ADMIN',
        mfaTotpVerifiedAt: new Date('2026-08-01'),
      },
      undefined,
      { skipPolicyGate: true },
    );
    expect(res.access_token).toBeUndefined();
    expect(res.mfaRequired).toBe(true);
  });
});

describe('SEC-008 - the grace window, driven explicitly', () => {
  const SAVED = process.env.MFA_REQUIRED_ENFORCE_AFTER;
  afterEach(() => {
    if (SAVED === undefined) delete process.env.MFA_REQUIRED_ENFORCE_AFTER;
    else process.env.MFA_REQUIRED_ENFORCE_AFTER = SAVED;
  });

  it('BEFORE the deadline a privileged user still gets a session, plus the nag block', async () => {
    process.env.MFA_REQUIRED_ENFORCE_AFTER = '2099-01-01T00:00:00Z';
    const { service } = await makeService(await userRow());
    const res: any = await service.login({
      id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1',
      role: 'DISTRICT_ADMIN', mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBe('mock_jwt_token');
    expect(res.mfaPolicy).toEqual({
      enrollmentRequired: true,
      enforceAfter: '2099-01-01T00:00:00.000Z',
    });
  });

  it('AFTER the deadline the same login is withheld', async () => {
    process.env.MFA_REQUIRED_ENFORCE_AFTER = '2020-01-01T00:00:00Z';
    const { service } = await makeService(await userRow());
    const res: any = await service.login({
      id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1',
      role: 'DISTRICT_ADMIN', mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBeUndefined();
    expect(res.mfaEnrollmentRequired).toBe(true);
  });

  it('the explicit per-user override ignores the grace window (ACC-03 is not weakened)', async () => {
    process.env.MFA_REQUIRED_ENFORCE_AFTER = '2099-01-01T00:00:00Z';
    const { service } = await makeService(await userRow());
    const res: any = await service.login({
      id: 'u1', email: 'writer@acme.edu', tenantId: 'tenant-1',
      role: 'CONTRIBUTOR', mfaRequired: true, mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBeUndefined();
    expect(res.mfaEnrollmentRequired).toBe(true);
  });

  it('break-glass releases the DERIVED policy but not the per-user override', async () => {
    process.env.MFA_REQUIRED_ENFORCE_AFTER = 'off';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { service } = await makeService(await userRow());

    const admin: any = await service.login({
      id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1',
      role: 'SUPER_ADMIN', mfaTotpVerifiedAt: null,
    });
    expect(admin.access_token).toBe('mock_jwt_token');
    // Break-glass is a release, not a state of grace - nothing to nag about.
    expect(admin.mfaPolicy).toBeUndefined();

    const forced: any = await service.login({
      id: 'u2', email: 'writer@acme.edu', tenantId: 'tenant-1',
      role: 'CONTRIBUTOR', mfaRequired: true, mfaTotpVerifiedAt: null,
    });
    expect(forced.access_token).toBeUndefined();
    warn.mockRestore();
  });

  it('no nag block for a user the policy does not cover', async () => {
    process.env.MFA_REQUIRED_ENFORCE_AFTER = '2099-01-01T00:00:00Z';
    const { service } = await makeService(await userRow());
    const res: any = await service.login({
      id: 'u1', email: 'writer@acme.edu', tenantId: 'tenant-1', role: 'CONTRIBUTOR',
    });
    expect(res.mfaPolicy).toBeUndefined();
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
