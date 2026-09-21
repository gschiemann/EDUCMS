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

/**
 * @param tenantRow what `tenant.findUnique` returns to `login`. DEFAULT OMITS
 *   `mfaEnforced` ON PURPOSE (2026-09-11): that is the shape a narrow select
 *   produces, and `tenantMfaEnforced` must read it as ENFORCED. A fixture that
 *   defaulted to `{ mfaEnforced: false }` would quietly re-tune every SEC-008
 *   case in this file to the permissive world.
 */
async function makeService(
  userRow: any,
  tenantRow: any = { slug: 'acme', vertical: 'K12', name: 'Acme' },
  // WEBAUTHN (2026-09-21) — how many passkeys the account holds. Defaults to
  // ZERO, which is the STRICT world: a passkey satisfies the policy, so a
  // fixture that defaulted to one would quietly release every SEC-008 case in
  // this file. Individual tests raise it to exercise the passkey path.
  passkeyCount = 0,
) {
  const findUnique = jest.fn().mockResolvedValue(userRow);
  const tenantFindUnique = jest.fn().mockResolvedValue(tenantRow);
  const passkeyCountFn = jest.fn().mockResolvedValue(passkeyCount);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('mock_jwt_token') } },
      {
        provide: PrismaService,
        useValue: {
          client: {
            user: { findUnique, update: jest.fn() },
            tenant: { findUnique: tenantFindUnique },
            passkey: { count: passkeyCountFn },
          },
        },
      },
    ],
  }).compile();
  return {
    service: module.get<AuthService>(AuthService),
    findUnique,
    tenantFindUnique,
    passkeyCountFn,
  };
}

/** A tenant that has opted out of the derived MFA policy. */
const OPTIONAL_TENANT = { slug: 'acme', vertical: 'RETAIL', name: 'Acme', mfaEnforced: false };
/** A tenant that enforces it (what every pre-2026-09-11 row was backfilled to). */
const ENFORCING_TENANT = { slug: 'acme', vertical: 'K12', name: 'Acme', mfaEnforced: true };

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
      // WEBAUTHN (2026-09-21) — "does this account hold a passkey?" is a
      // policy input, and it rides THIS query rather than costing a second
      // round-trip on the auth hot path. Asserted here for the same reason
      // the tenant join is: so a future edit that splits it out has to say so.
      _count: { select: { passkeys: true } },
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

/**
 * PER-TENANT MFA ENFORCEMENT at the LOGIN gate (2026-09-11).
 *
 * Greg: "i want people to have the options but for my riot accounts, leave it
 * turned on, we will keep that security so just new customers."
 *
 * FAIL-OPEN #1 from the recon lives here, and it is one line: `validateUser`
 * returns `const { passwordHash, tenant, ...result }` — the joined tenant is
 * DELETED before the object ever reaches this gate. A tenant policy read off
 * `user.tenant.*` would be `undefined`, which reads as "this organization does
 * not enforce", which is a full session on a password alone with a 200 and no
 * log line. The gate therefore reads the tenant itself, and it does so BEFORE
 * deciding (fail-open #3, the ordering trap: the tenant used to load thirteen
 * lines AFTER the gate).
 */
describe('per-tenant MFA enforcement — the login gate', () => {
  it('a privileged user in an OPTED-OUT tenant gets a normal session', async () => {
    const { service } = await makeService(await userRow(), OPTIONAL_TENANT);
    const res: any = await service.login({
      id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1',
      role: 'DISTRICT_ADMIN', canTriggerPanic: false,
      mfaRequired: false, mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBe('mock_jwt_token');
    expect(res.mfaRequired).toBeUndefined();
    expect(res.mfaEnrollmentRequired).toBeUndefined();
  });

  it('the SAME user in an ENFORCING tenant is still withheld', async () => {
    const { service } = await makeService(await userRow(), ENFORCING_TENANT);
    const res: any = await service.login({
      id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1',
      role: 'DISTRICT_ADMIN', canTriggerPanic: false,
      mfaRequired: false, mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBeUndefined();
    expect(res.mfaEnrollmentRequired).toBe(true);
  });

  it('a panic-capable CONTRIBUTOR is released by the tenant opt-out too', async () => {
    const { service } = await makeService(await userRow(), OPTIONAL_TENANT);
    const res: any = await service.login({
      id: 'u1', email: 'coach@acme.edu', tenantId: 'tenant-1',
      role: 'CONTRIBUTOR', canTriggerPanic: true, mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBe('mock_jwt_token');
  });

  // ── NON-NEGOTIABLE: optional ≠ "your existing factor is ignored" ────────
  it('an ALREADY-ENROLLED user is STILL challenged in an opted-out tenant', async () => {
    const { service } = await makeService(await userRow(), OPTIONAL_TENANT);
    const res: any = await service.login({
      id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1',
      role: 'DISTRICT_ADMIN', mfaTotpVerifiedAt: new Date('2026-08-01'),
    });
    // The TOTP challenge, not the enrollment envelope, and NO session.
    expect(res.mfaRequired).toBe(true);
    expect(res.mfaEnrollmentRequired).toBeUndefined();
    expect(res.access_token).toBeUndefined();
  });

  it('…and so is a plain CONTRIBUTOR who chose to set one up', async () => {
    // The enrolled-user branch keys on `mfaTotpVerifiedAt` ALONE and runs
    // BEFORE any policy. Implementing "optional" by short-circuiting ahead of
    // it would silently drop every voluntarily-enrolled user to password-only.
    const { service } = await makeService(await userRow(), OPTIONAL_TENANT);
    const res: any = await service.login({
      id: 'u1', email: 'writer@acme.edu', tenantId: 'tenant-1',
      role: 'CONTRIBUTOR', canTriggerPanic: false,
      mfaTotpVerifiedAt: new Date('2026-08-01'),
    });
    expect(res.mfaRequired).toBe(true);
    expect(res.access_token).toBeUndefined();
  });

  it('the per-user override still blocks inside an opted-out tenant (ACC-03)', async () => {
    const { service } = await makeService(await userRow(), OPTIONAL_TENANT);
    const res: any = await service.login({
      id: 'u1', email: 'writer@acme.edu', tenantId: 'tenant-1',
      role: 'CONTRIBUTOR', mfaRequired: true, mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBeUndefined();
    expect(res.mfaEnrollmentRequired).toBe(true);
  });

  // ── THE FAIL-OPEN REGRESSIONS ───────────────────────────────────────────
  it('FAILS CLOSED when the tenant select does not carry the column', async () => {
    // Exactly what a narrow/legacy select returns. Reading `undefined` as
    // "not enforcing" here is fail-open #1 and #2 in one.
    const { service } = await makeService(await userRow(), {
      slug: 'acme', vertical: 'K12', name: 'Acme',
    });
    const res: any = await service.login({
      id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1',
      role: 'SCHOOL_ADMIN', mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBeUndefined();
    expect(res.mfaEnrollmentRequired).toBe(true);
  });

  it('FAILS CLOSED when the tenant row is missing entirely', async () => {
    const { service } = await makeService(await userRow(), null);
    const res: any = await service.login({
      id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1',
      role: 'SCHOOL_ADMIN', mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBeUndefined();
  });

  it('FAILS CLOSED when the tenant read THROWS', async () => {
    const { service, tenantFindUnique } = await makeService(await userRow());
    tenantFindUnique.mockRejectedValue(new Error('pool exhausted'));
    const res: any = await service.login({
      id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1',
      role: 'SCHOOL_ADMIN', mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBeUndefined();
  });

  it('reads the tenant BEFORE it decides — the ordering trap', async () => {
    // If the read ever slides back below the gate this goes red: a withheld
    // login would never have queried the tenant at all.
    const { service, tenantFindUnique } = await makeService(await userRow(), ENFORCING_TENANT);
    const res: any = await service.login({
      id: 'u1', email: 'admin@acme.edu', tenantId: 'tenant-1',
      role: 'SCHOOL_ADMIN', mfaTotpVerifiedAt: null,
    });
    expect(res.mfaEnrollmentRequired).toBe(true);
    expect(tenantFindUnique).toHaveBeenCalledTimes(1);
    expect(tenantFindUnique.mock.calls[0][0].select).toEqual(
      expect.objectContaining({ mfaEnforced: true }),
    );
  });

  it('costs no extra round trip — one tenant read serves the gate AND the payload', async () => {
    const { service, tenantFindUnique } = await makeService(await userRow(), OPTIONAL_TENANT);
    const res: any = await service.login({
      id: 'u1', email: 'writer@acme.edu', tenantId: 'tenant-1', role: 'CONTRIBUTOR',
    });
    expect(tenantFindUnique).toHaveBeenCalledTimes(1);
    // …and the payload fields still arrive from that same row.
    expect(res.user.tenantSlug).toBe('acme');
    expect(res.user.tenantVertical).toBe('RETAIL');
  });

  it('mfaPolicyForUser gives the audit row the SAME verdict the gate used', async () => {
    const { service } = await makeService(await userRow(), OPTIONAL_TENANT);
    const d = await service.mfaPolicyForUser({
      id: 'u1', tenantId: 'tenant-1', role: 'DISTRICT_ADMIN', mfaTotpVerifiedAt: null,
    });
    expect(d.tenantEnforced).toBe(false);
    expect(d.required).toBe(false);
    expect(d.blocking).toBe(false);
  });
});

/**
 * WEBAUTHN (2026-09-21) — A PASSKEY IS A SECOND FACTOR AT THE LOGIN GATE.
 *
 * Operator: *"can we add pass key to our security? im sick of the damn auth
 * app"*. That sentence has a precise requirement behind it: a user whose only
 * factor is a passkey must (a) still be CHALLENGED — password alone is not a
 * session — and (b) never be pushed into TOTP enrollment, because being
 * pushed into TOTP enrollment is exactly what they are trying to stop doing.
 * Those are opposite failure modes and the gate has to thread both.
 */
describe('passkeys at the login gate', () => {
  /** SCHOOL_ADMIN in an enforcing tenant: blocking-required with no factor. */
  const admin = {
    id: 'u1',
    email: 'admin@acme.edu',
    tenantId: 'tenant-1',
    role: 'SCHOOL_ADMIN',
    canTriggerPanic: false,
    mfaRequired: false,
    mfaTotpVerifiedAt: null,
  };

  it('a passkey-only user is CHALLENGED, not enrolled — and mfaMethods says which door', async () => {
    const { service } = await makeService(await userRow(), ENFORCING_TENANT, 1);
    const res: any = await service.login(admin);

    // Challenged...
    expect(res.mfaRequired).toBe(true);
    expect(res.access_token).toBeUndefined();
    expect(typeof res.mfaToken).toBe('string');
    // ...but NOT into TOTP enrollment. This is the whole point: the account
    // already holds a factor, so the forced-enrollment lane must not fire.
    expect(res.mfaEnrollmentRequired).toBeUndefined();
    // And the client is told to offer the passkey rather than a code box it
    // has no app for.
    expect(res.mfaMethods).toEqual(['passkey']);
  });

  it('a user with BOTH factors is offered both, passkey first', async () => {
    const { service } = await makeService(await userRow(), ENFORCING_TENANT, 2);
    const res: any = await service.login({ ...admin, mfaTotpVerifiedAt: new Date('2026-08-01') });
    expect(res.mfaMethods).toEqual(['passkey', 'totp']);
  });

  it('a TOTP-only user is unchanged — mfaMethods is additive, not a rewrite', async () => {
    const { service } = await makeService(await userRow(), ENFORCING_TENANT, 0);
    const res: any = await service.login({ ...admin, mfaTotpVerifiedAt: new Date('2026-08-01') });
    expect(res.mfaRequired).toBe(true);
    expect(res.mfaMethods).toEqual(['totp']);
  });

  it('the enrollment envelope carries an EMPTY mfaMethods — there is no door yet', async () => {
    const { service } = await makeService(await userRow(), ENFORCING_TENANT, 0);
    const res: any = await service.login(admin);
    expect(res.mfaEnrollmentRequired).toBe(true);
    expect(res.mfaMethods).toEqual([]);
  });

  it('A PASSKEY ALONE STILL COSTS A CHALLENGE for an unprivileged user', async () => {
    // THE DOWNGRADE THIS PREVENTS: before the gate read passkeys, a
    // CONTRIBUTOR who registered a passkey and never enrolled TOTP sailed
    // past the challenge branch and got a full session on their password —
    // silently un-protecting an account that had opted INTO a second factor.
    const { service } = await makeService(await userRow(), OPTIONAL_TENANT, 1);
    const res: any = await service.login({
      id: 'u1', email: 'writer@acme.edu', tenantId: 'tenant-1',
      role: 'CONTRIBUTOR', canTriggerPanic: false, mfaRequired: false, mfaTotpVerifiedAt: null,
    });
    expect(res.access_token).toBeUndefined();
    expect(res.mfaRequired).toBe(true);
    expect(res.mfaMethods).toEqual(['passkey']);
  });

  it('mfaAlreadySatisfied finalizes a passkey login — NO challenge loop', async () => {
    // The passkey controller calls `login(..., { mfaAlreadySatisfied: true })`
    // after a verified assertion. Without the flag the gate would see an
    // account that holds a passkey and challenge it again, forever.
    const { service } = await makeService(await userRow(), ENFORCING_TENANT, 1);
    const res: any = await service.login(admin, false, { mfaAlreadySatisfied: true });
    expect(res.access_token).toBe('mock_jwt_token');
    expect(res.mfaRequired).toBeUndefined();
  });

  it('a passkey satisfies the explicit per-user override too', async () => {
    // `mfaRequired: true` is an admin's explicit "this account must hold a
    // second factor". A passkey IS one, so it satisfies the override exactly
    // as verified TOTP does — the override demands a factor, not a brand.
    const { service } = await makeService(await userRow(), OPTIONAL_TENANT, 1);
    const res: any = await service.login({
      id: 'u1', email: 'writer@acme.edu', tenantId: 'tenant-1',
      role: 'CONTRIBUTOR', mfaRequired: true, mfaTotpVerifiedAt: null,
    });
    expect(res.mfaEnrollmentRequired).toBeUndefined();
    expect(res.mfaRequired).toBe(true);
    expect(res.mfaMethods).toEqual(['passkey']);
  });

  it('reads the count from the login query when it is joined — no extra round trip', async () => {
    const { service, passkeyCountFn } = await makeService(await userRow(), ENFORCING_TENANT, 0);
    // `validateUser` joins `_count`, so an object carrying it must not
    // trigger the fallback query. This is what keeps the hot path at its
    // pre-passkey query count.
    const res: any = await service.login({ ...admin, _count: { passkeys: 1 } });
    expect(passkeyCountFn).not.toHaveBeenCalled();
    expect(res.mfaMethods).toEqual(['passkey']);
  });

  it('falls back to a real count for a hand-built user object (the MFA-controller shape)', async () => {
    const { service, passkeyCountFn } = await makeService(await userRow(), ENFORCING_TENANT, 3);
    // MfaController and PasskeyController finalize with curated objects that
    // carry no relation counts. A silent `false` there would tell the policy
    // an enrolled user is unenrolled.
    await service.login(admin);
    expect(passkeyCountFn).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('mfaPolicyForUser reports the passkey too, so the audit row cannot lie', async () => {
    const { service } = await makeService(await userRow(), ENFORCING_TENANT, 1);
    const d = await service.mfaPolicyForUser({
      id: 'u1', tenantId: 'tenant-1', role: 'DISTRICT_ADMIN', mfaTotpVerifiedAt: null,
    });
    // `required` stays true (the role still carries the requirement) but the
    // account IS enrolled, so nothing is blocking.
    expect(d.required).toBe(true);
    expect(d.enrolled).toBe(true);
    expect(d.blocking).toBe(false);
  });
});
