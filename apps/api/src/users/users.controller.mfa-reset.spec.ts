/**
 * POST /users/:id/mfa/reset — an admin resets ANOTHER user's second factor
 * (2026-09-21).
 *
 * THE GAP THIS CLOSES. `mfaTotp*: null` had exactly one writer in the product
 * — `POST /auth/mfa/disable`, acting on the CALLER. So a privileged user who
 * lost their phone and had spent their ten backup codes was locked out
 * permanently and support had no lever, while MFA becomes mandatory for
 * privileged roles on `MFA_REQUIRED_ENFORCE_AFTER`. Passkeys made it worse,
 * not better: an account can now be passkey-only, so "use your authenticator"
 * is not even a fallback.
 *
 * WHAT THESE TESTS PIN, in the order the route enforces it:
 *   - SELF is refused with its own code (Settings → Security is the door);
 *   - the password STEP-UP runs BEFORE the scope check, so a hijacked session
 *     that cannot produce the password learns nothing about who exists;
 *   - a wrong password is 403, never 401 — the web client signs the operator
 *     out on ANY 401, which would log an admin out for a typo mid-recovery;
 *   - an SSO-provisioned actor gets a named 409, not "wrong password";
 *   - authority is `loadManageableTarget`, the SAME gate PUT :id/disabled
 *     uses — own subtree, strictly below my rank, peers and superiors refused
 *     for every role including SUPER_ADMIN against SUPER_ADMIN;
 *   - out of scope answers 404, never 403: this is the one lifecycle route
 *     whose target id gets GUESSED, so a 403 would be an existence oracle;
 *   - the effect is ONE transaction — TOTP secret, verified stamp, backup
 *     codes and EVERY passkey — and it never touches the password;
 *   - both session stores are burned, so the device someone else is holding
 *     stops working;
 *   - refusals are audited too, so a probing admin leaves a trail;
 *   - a mail failure never fails the reset;
 *   - and the REAL `AuthService.login` routes the reset user into the
 *     existing forced-enrollment flow — which is what makes this a recovery
 *     path rather than a bypass.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppRole } from '@cms/database';
import { UsersController } from './users.controller';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { cryptoPlatformConfig } from '../auth/crypto.config';
import { SSO_PROVISIONED_NO_PASSWORD_HASH } from '../auth/sso-provisioned-account';
import { ROLES_KEY } from '../auth/roles.decorator';

const ACTOR_PASSWORD = 'correct-horse-battery-7';

/**
 * A REAL argon2 hash, so the step-up really runs `argon2.verify` — but encoded
 * with cheap parameters rather than the platform's 64MB/3-pass ones.
 *
 * WHY THAT DOES NOT WEAKEN ANYTHING: argon2 reads its cost parameters from the
 * ENCODED HASH, not from the options handed to `verify`, so this exercises the
 * identical code path — same `verifyReauthPassword`, same real verification,
 * same `$argon2` prefix that `accountHasNoOwnPassword` keys on, and a wrong
 * password is still genuinely rejected. What changes is only the CPU: ~1ms per
 * verify instead of ~130ms, and no 64MB allocation per call. That matters
 * because this suite runs in a worker beside the argon2-heavy MFA suites, and
 * ~15 platform-cost verifies here is enough contention to push THEIR 5s
 * per-test timeouts over the edge (observed: 6 timeouts in
 * mfa.controller*.spec.ts, none of them assertion failures).
 *
 * The platform parameters themselves are `crypto.config.ts`'s contract and are
 * covered by the auth suites; they are not what this file is testing.
 */
let ACTOR_HASH = '';
beforeAll(async () => {
  ACTOR_HASH = await argon2.hash(ACTOR_PASSWORD, {
    type: cryptoPlatformConfig.type,
    memoryCost: 1024,
    timeCost: 1,
    parallelism: 1,
  });
}, 30_000);

type UserRow = {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  status?: string;
  deletedAt?: Date | null;
  passwordHash?: string;
  firstName?: string | null;
  lastName?: string | null;
  mfaTotpSecret?: string | null;
  mfaTotpVerifiedAt?: Date | null;
  mfaBackupCodes?: unknown;
  mfaRequired?: boolean;
  canTriggerPanic?: boolean;
  mustSetupCredentials?: boolean;
};

/** `district` (root), `school` (child of district), `other` (unrelated root). */
const TENANTS: Record<string, { id: string; parentId: string | null }> = {
  district: { id: 'district', parentId: null },
  school: { id: 'school', parentId: 'district' },
  other: { id: 'other', parentId: null },
};

/** Does `row` satisfy a Prisma-style `where` this harness understands? */
function matches(row: UserRow, where: any): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.tenantId !== undefined && row.tenantId !== where.tenantId)
    return false;
  if (where.deletedAt === null && row.deletedAt) return false;
  if (where.email !== undefined && row.email !== where.email) return false;
  return true;
}

function makeDeps(
  rows: UserRow[],
  passkeys: Array<{ id: string; userId: string }> = [],
) {
  const audits: any[] = [];
  const updates: any[] = [];
  const deletedPasskeys: string[] = [];

  const userStore = {
    findFirst: jest.fn(async ({ where }: any) => {
      const r = rows.find((x) => matches(x, where));
      // A COPY, like real Prisma: a live reference would let an
      // in-transaction write mutate the caller's "before" snapshot, which is
      // exactly the class of bug that hides a missing clear.
      return r ? { ...r } : null;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const r = rows.find((x) => matches(x, where));
      return r ? { ...r } : null;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const r = rows.find((x) => matches(x, where));
      if (!r) return { count: 0 };
      updates.push({ where, data });
      Object.assign(r, data);
      return { count: 1 };
    }),
  };

  const passkeyStore = {
    deleteMany: jest.fn(async ({ where }: any) => {
      const doomed = passkeys.filter((p) => p.userId === where.userId);
      for (const p of doomed) {
        deletedPasskeys.push(p.id);
        passkeys.splice(passkeys.indexOf(p), 1);
      }
      return { count: doomed.length };
    }),
    count: jest.fn(
      async ({ where }: any) =>
        passkeys.filter((p) => p.userId === where.userId).length,
    ),
  };

  const auditStore = {
    create: jest.fn(async ({ data }: any) => {
      audits.push(data);
      return data;
    }),
  };

  // The transaction client is the SAME store: a rollback is not modelled, so
  // every assertion about "nothing changed" is made on a path that threw
  // BEFORE any write, never on one that wrote and was rolled back. That is a
  // deliberate limit of the double and it is why the refusal tests all assert
  // `updates` is empty rather than trusting a rollback that never happens.
  const tx = { user: userStore, passkey: passkeyStore, auditLog: auditStore };

  const prisma: any = {
    client: {
      user: {
        ...userStore,
        findMany: jest.fn(async () => rows.map((r) => ({ ...r }))),
      },
      passkey: passkeyStore,
      auditLog: auditStore,
      tenant: {
        findUnique: jest.fn(
          async ({ where }: any) => TENANTS[where.id] ?? null,
        ),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    },
  };

  const redis: any = { markUserTokensInvalid: jest.fn(async () => undefined) };
  const sessions: any = { revokeAllForUser: jest.fn(async () => undefined) };
  const email: any = {
    isConfigured: jest.fn(() => true),
    sendMfaReset: jest.fn(async () => undefined),
  };

  return {
    prisma,
    redis,
    sessions,
    email,
    audits,
    updates,
    deletedPasskeys,
    rows,
    passkeys,
  };
}

function controllerFor(d: ReturnType<typeof makeDeps>) {
  return new UsersController(d.prisma, d.redis, d.sessions, d.email);
}

/** The ACTOR row — a real argon2 hash, so the step-up is really exercised. */
function actorRow(over: Partial<UserRow> = {}): UserRow {
  return {
    id: 'a-district-admin',
    email: 'admin@district.test',
    role: AppRole.DISTRICT_ADMIN,
    tenantId: 'district',
    status: 'ACTIVE',
    deletedAt: null,
    firstName: 'Dee',
    lastName: 'Admin',
    passwordHash: ACTOR_HASH,
    ...over,
  };
}

/** A fully-enrolled target: verified TOTP + backup codes. */
function targetRow(over: Partial<UserRow> = {}): UserRow {
  return {
    id: 'u-target',
    email: 'staffer@school.test',
    role: AppRole.CONTRIBUTOR,
    tenantId: 'district',
    status: 'ACTIVE',
    deletedAt: null,
    firstName: 'Tara',
    lastName: 'Target',
    passwordHash: 'target-password-hash-untouched',
    mfaTotpSecret: 'sealed-secret-bytes',
    mfaTotpVerifiedAt: new Date('2026-09-01T00:00:00.000Z'),
    mfaBackupCodes: [{ hash: '$argon2id$fake' }],
    mfaRequired: false,
    canTriggerPanic: false,
    ...over,
  };
}

const req = (actor: UserRow, headers: Record<string, string> = {}) => ({
  user: { id: actor.id, role: actor.role, tenantId: actor.tenantId },
  headers,
  ip: '203.0.113.7',
});

const body = (over: Record<string, unknown> = {}) => ({
  password: ACTOR_PASSWORD,
  ...over,
});

// ───────────────────────────── the happy path ─────────────────────────────

describe('POST /users/:id/mfa/reset — the recovery path', () => {
  it('clears TOTP, the verified stamp and the backup codes, and removes EVERY passkey, in ONE transaction', async () => {
    const actor = actorRow();
    const target = targetRow();
    const d = makeDeps(
      [actor, target],
      [
        { id: 'pk-1', userId: 'u-target' },
        { id: 'pk-2', userId: 'u-target' },
        { id: 'pk-other', userId: 'someone-else' },
      ],
    );
    const c = controllerFor(d);

    const res = await c.resetUserMfa(
      req(actor),
      'u-target',
      body({ reason: 'Lost phone, verified in person' }),
    );

    expect(res).toEqual({
      ok: true,
      hadTotp: true,
      passkeysRemoved: 2,
      sessionsRevoked: true,
    });

    // The three MFA columns are null and NOTHING else was written.
    const write = d.updates.find((u) => 'mfaTotpSecret' in u.data)!;
    expect(write.data).toEqual({
      mfaTotpSecret: null,
      mfaTotpVerifiedAt: null,
      mfaBackupCodes: null,
    });
    expect(target.mfaTotpSecret).toBeNull();
    expect(target.mfaTotpVerifiedAt).toBeNull();
    expect(target.mfaBackupCodes).toBeNull();

    // The write is tenant-scoped — defence in depth on a privilege write.
    expect(write.where).toEqual({ id: 'u-target', tenantId: 'district' });

    // A possibly-compromised passkey must not survive a reset — and only
    // THIS user's passkeys go.
    expect(d.deletedPasskeys.sort()).toEqual(['pk-1', 'pk-2']);
    expect(d.passkeys.map((p) => p.id)).toEqual(['pk-other']);

    // One transaction covers the clear, the passkey delete AND the audit row:
    // a reset without a forensic trail must not be possible.
    expect(d.prisma.client.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does NOT touch the password, the role, the status or mfaRequired', async () => {
    const actor = actorRow();
    const target = targetRow({ mfaRequired: true });
    const d = makeDeps([actor, target]);

    await controllerFor(d).resetUserMfa(req(actor), 'u-target', body());

    // This endpoint removes a FACTOR. It must never hand anybody a way IN.
    expect(target.passwordHash).toBe('target-password-hash-untouched');
    expect(target.role).toBe(AppRole.CONTRIBUTOR);
    expect(target.status).toBe('ACTIVE');
    expect(target.mfaRequired).toBe(true);
    for (const u of d.updates) {
      expect(Object.keys(u.data).sort()).toEqual([
        'mfaBackupCodes',
        'mfaTotpSecret',
        'mfaTotpVerifiedAt',
      ]);
    }
  });

  it('BURNS BOTH session stores — the access-token epoch AND the durable refresh family', async () => {
    // Only burning the Redis epoch would leave the SEC-010 refresh cookie able
    // to mint a fresh access token, so the reset would not end the session it
    // exists to end — the device someone else is holding keeps working.
    const actor = actorRow();
    const d = makeDeps([actor, targetRow()]);

    await controllerFor(d).resetUserMfa(req(actor), 'u-target', body());

    expect(d.redis.markUserTokensInvalid).toHaveBeenCalledWith('u-target');
    expect(d.sessions.revokeAllForUser).toHaveBeenCalledTimes(1);
    expect(d.sessions.revokeAllForUser.mock.calls[0][0]).toBe('u-target');
  });

  it('writes an immutable USER_MFA_RESET row naming actor, target, tenant, what was removed, the reason and the IP', async () => {
    const actor = actorRow();
    const d = makeDeps(
      [actor, targetRow()],
      [{ id: 'pk-1', userId: 'u-target' }],
    );

    await controllerFor(d).resetUserMfa(
      // The measured Railway shape: client, then the edge. TRUSTED_PROXY_HOPS
      // defaults to 2 and counts from the RIGHT, so the client is index 0.
      {
        ...req(actor),
        headers: { 'x-forwarded-for': '198.51.100.9, 10.0.0.1' },
      },
      'u-target',
      body({ reason: 'Ticket 4412' }),
    );

    const row = d.audits.find((a) => a.action === 'USER_MFA_RESET')!;
    expect(row).toMatchObject({
      tenantId: 'district',
      userId: 'a-district-admin',
      targetType: 'user',
      targetId: 'u-target',
    });
    expect(JSON.parse(row.details)).toMatchObject({
      email: 'staffer@school.test',
      role: AppRole.CONTRIBUTOR,
      hadTotp: true,
      passkeysRemoved: 1,
      reason: 'Ticket 4412',
      byRole: AppRole.DISTRICT_ADMIN,
      byTenant: 'district',
      // Right-counted from a 3-entry chain with the default 2 trusted hops.
      ip: '198.51.100.9',
    });
    // The password must never reach the audit trail, in any field.
    expect(row.details).not.toContain(ACTOR_PASSWORD);
  });

  it('reports hadTotp FALSE for a passkey-only account, and still removes the passkey', async () => {
    // The list calls such an account "Passkey", so a response claiming we
    // removed an authenticator would contradict what the admin was shown.
    const actor = actorRow();
    const target = targetRow({
      mfaTotpSecret: null,
      mfaTotpVerifiedAt: null,
      mfaBackupCodes: null,
    });
    const d = makeDeps([actor, target], [{ id: 'pk-1', userId: 'u-target' }]);

    const res = await controllerFor(d).resetUserMfa(
      req(actor),
      'u-target',
      body(),
    );

    expect(res).toMatchObject({ ok: true, hadTotp: false, passkeysRemoved: 1 });
  });

  it('a DISTRICT_ADMIN reaches a CHILD school, and the write + audit row are owned by the CHILD tenant', async () => {
    const actor = actorRow();
    const target = targetRow({ tenantId: 'school' });
    const d = makeDeps([actor, target]);

    await controllerFor(d).resetUserMfa(req(actor), 'u-target', body());

    expect(d.updates.find((u) => 'mfaTotpSecret' in u.data)!.where).toEqual({
      id: 'u-target',
      tenantId: 'school',
    });
    expect(d.audits.find((a) => a.action === 'USER_MFA_RESET')!.tenantId).toBe(
      'school',
    );
  });

  it('SUPER_ADMIN may reset a user in ANY tenant (cross-tenant by design)', async () => {
    const actor = actorRow({
      id: 'a-super',
      role: AppRole.SUPER_ADMIN,
      email: 'owner@venueos.test',
    });
    const d = makeDeps([actor, targetRow({ tenantId: 'other' })]);

    await expect(
      controllerFor(d).resetUserMfa(req(actor), 'u-target', body()),
    ).resolves.toMatchObject({
      ok: true,
    });
  });
});

// ───────────────────────────── the step-up ─────────────────────────────

describe('the password step-up', () => {
  it('a WRONG password is 403 with USER_MFA_RESET_BAD_PASSWORD — never 401', async () => {
    // apps/web/src/lib/api-client.ts treats EVERY 401 on an authenticated
    // request as "session expired" and signs the operator out. A 401 here
    // would log an admin out of their own session for a typo, mid-recovery.
    const actor = actorRow();
    const target = targetRow();
    const d = makeDeps([actor, target]);

    const err = await controllerFor(d)
      .resetUserMfa(
        req(actor),
        'u-target',
        body({ password: 'not-my-password' }),
      )
      .then(
        () => null,
        (e) => e,
      );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toMatchObject({
      code: 'USER_MFA_RESET_BAD_PASSWORD',
    });

    // NOTHING changed.
    expect(d.updates).toEqual([]);
    expect(d.prisma.client.$transaction).not.toHaveBeenCalled();
    expect(target.mfaTotpVerifiedAt).toBeInstanceOf(Date);
    expect(d.redis.markUserTokensInvalid).not.toHaveBeenCalled();
    expect(d.sessions.revokeAllForUser).not.toHaveBeenCalled();

    // …and the attempt is on the record.
    const denied = d.audits.find((a) => a.action === 'USER_MFA_RESET_DENIED')!;
    expect(denied).toMatchObject({
      tenantId: 'district',
      userId: 'a-district-admin',
      targetId: 'u-target',
    });
    expect(JSON.parse(denied.details)).toMatchObject({
      reasonClass: 'bad_password',
    });
    expect(denied.details).not.toContain('not-my-password');
  });

  it('runs BEFORE the scope check, so a session thief cannot enumerate targets', async () => {
    // A caller who cannot produce the password must get the SAME answer for a
    // target in their tenant, a target in a stranger's tenant, and an id that
    // does not exist. Ordering the scope check first would turn this route
    // into a free enumeration primitive for a hijacked session.
    const actor = actorRow();
    const d = makeDeps([actor, targetRow({ tenantId: 'other' })]);
    const c = controllerFor(d);

    const codes: string[] = [];
    for (const id of ['u-target', 'no-such-user']) {
      const e = await c
        .resetUserMfa(req(actor), id, body({ password: 'wrong' }))
        .then(
          () => null,
          (x) => x,
        );
      codes.push(`${e.getStatus()}:${e.getResponse().code}`);
    }
    expect(new Set(codes).size).toBe(1);
    expect(codes[0]).toBe('403:USER_MFA_RESET_BAD_PASSWORD');
    // The target was never even looked up.
    expect(d.prisma.client.user.findFirst).not.toHaveBeenCalled();
  });

  it('an SSO-provisioned actor gets 409 PASSWORD_REQUIRED, not "wrong password"', async () => {
    // This is a RECOVERY feature. Telling an admin who has no password that
    // their password is wrong is the dead end the feature exists to remove.
    const actor = actorRow({ passwordHash: SSO_PROVISIONED_NO_PASSWORD_HASH });
    const d = makeDeps([actor, targetRow()]);

    const err = await controllerFor(d)
      .resetUserMfa(req(actor), 'u-target', body({ password: 'anything' }))
      .then(
        () => null,
        (e) => e,
      );

    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: 'PASSWORD_REQUIRED' });
    expect(d.updates).toEqual([]);
    expect(
      JSON.parse(
        d.audits.find((a) => a.action === 'USER_MFA_RESET_DENIED')!.details,
      ),
    ).toMatchObject({
      reasonClass: 'actor_has_no_password',
    });
  });

  it('also answers 409 for the random `sso:` hash SsoService writes', async () => {
    const actor = actorRow({ passwordHash: 'sso:k3j4h5:1758412800000' });
    const d = makeDeps([actor, targetRow()]);

    const err = await controllerFor(d)
      .resetUserMfa(req(actor), 'u-target', body())
      .then(
        () => null,
        (e) => e,
      );

    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: 'PASSWORD_REQUIRED' });
  });

  it('refuses a missing or empty password before doing anything at all', async () => {
    const actor = actorRow();
    const d = makeDeps([actor, targetRow()]);
    const c = controllerFor(d);

    for (const b of [{}, { password: '' }, { password: 42 as any }]) {
      await expect(
        c.resetUserMfa(req(actor), 'u-target', b as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(d.prisma.client.user.findUnique).not.toHaveBeenCalled();
    expect(d.updates).toEqual([]);
  });

  it('refuses a reason longer than 200 characters', async () => {
    const actor = actorRow();
    const d = makeDeps([actor, targetRow()]);

    await expect(
      controllerFor(d).resetUserMfa(
        req(actor),
        'u-target',
        body({ reason: 'x'.repeat(201) }),
      ),
    ).rejects.toMatchObject({
      response: { code: 'USER_MFA_RESET_REASON_TOO_LONG' },
    });
    expect(d.updates).toEqual([]);
  });
});

// ───────────────────────────── authority ─────────────────────────────

describe('authority — the SAME gate PUT :id/disabled uses', () => {
  it('REFUSES self with USE_SELF_SERVICE (Settings → Security is the door)', async () => {
    const actor = actorRow();
    const d = makeDeps([actor]);

    const err = await controllerFor(d)
      .resetUserMfa(req(actor), actor.id, body())
      .then(
        () => null,
        (e) => e,
      );

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'USE_SELF_SERVICE' });
    expect(d.updates).toEqual([]);
    expect(
      JSON.parse(
        d.audits.find((a) => a.action === 'USER_MFA_RESET_DENIED')!.details,
      ),
    ).toMatchObject({
      reasonClass: 'self',
    });
  });

  it('REFUSES a PEER (DISTRICT_ADMIN → DISTRICT_ADMIN) with 403, and changes nothing', async () => {
    const actor = actorRow();
    const target = targetRow({ role: AppRole.DISTRICT_ADMIN });
    const d = makeDeps([actor, target]);

    const err = await controllerFor(d)
      .resetUserMfa(req(actor), 'u-target', body())
      .then(
        () => null,
        (e) => e,
      );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(d.updates).toEqual([]);
    expect(target.mfaTotpVerifiedAt).toBeInstanceOf(Date);
    expect(d.redis.markUserTokensInvalid).not.toHaveBeenCalled();
    expect(d.sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('REFUSES a SUPERIOR (SCHOOL_ADMIN → DISTRICT_ADMIN)', async () => {
    const actor = actorRow({
      id: 'a-school',
      role: AppRole.SCHOOL_ADMIN,
      tenantId: 'school',
    });
    const target = targetRow({
      role: AppRole.DISTRICT_ADMIN,
      tenantId: 'school',
    });
    const d = makeDeps([actor, target]);

    await expect(
      controllerFor(d).resetUserMfa(req(actor), 'u-target', body()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(d.updates).toEqual([]);
  });

  it('REFUSES one SUPER_ADMIN acting on another (auth-BUG-011, via the shared rank gate)', async () => {
    // SUPER_ADMIN is absent from its own assignable list, so the gate that
    // covers every other lifecycle action covers this one too. This is a
    // DEVIATION from a literal reading of "equal rank is allowed for
    // SUPER_ADMIN" and it is deliberate: reusing the disable predicate
    // verbatim is worth more than a second, subtly different hierarchy.
    const actor = actorRow({ id: 'a-super', role: AppRole.SUPER_ADMIN });
    const d = makeDeps([actor, targetRow({ role: AppRole.SUPER_ADMIN })]);

    await expect(
      controllerFor(d).resetUserMfa(req(actor), 'u-target', body()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(d.updates).toEqual([]);
  });

  it('a target OUTSIDE the actor subtree answers 404, never 403 — no existence oracle', async () => {
    const actor = actorRow();
    const target = targetRow({ tenantId: 'other' });
    const d = makeDeps([actor, target]);

    const err = await controllerFor(d)
      .resetUserMfa(req(actor), 'u-target', body())
      .then(
        () => null,
        (e) => e,
      );

    expect(err.getStatus()).toBe(404);
    expect(err.getResponse()).toMatchObject({ code: 'USER_NOT_FOUND' });
    // Byte-identical to a genuinely unknown id.
    const missing = await controllerFor(d)
      .resetUserMfa(req(actor), 'no-such-user', body())
      .then(
        () => null,
        (e) => e,
      );
    expect(missing.getStatus()).toBe(404);
    expect(missing.getResponse()).toEqual(err.getResponse());

    expect(d.updates).toEqual([]);
    expect(target.mfaTotpVerifiedAt).toBeInstanceOf(Date);
    expect(target.mfaTotpSecret).toBe('sealed-secret-bytes');
    expect(d.prisma.client.$transaction).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        d.audits.find((a) => a.action === 'USER_MFA_RESET_DENIED')!.details,
      ),
    ).toMatchObject({
      reasonClass: 'not_found_or_out_of_scope',
    });
  });

  it('a SOFT-DELETED target answers 404 and changes nothing', async () => {
    const actor = actorRow();
    const target = targetRow({ deletedAt: new Date('2026-09-10') });
    const d = makeDeps([actor, target]);

    await expect(
      controllerFor(d).resetUserMfa(req(actor), 'u-target', body()),
    ).rejects.toMatchObject({
      response: { code: 'USER_NOT_FOUND' },
    });
    expect(d.updates).toEqual([]);
  });
});

// ───────────── SEC-009: two-tenant × every-role isolation matrix ─────────────

describe('SEC-009 — two-tenant × every-role matrix for POST :id/mfa/reset', () => {
  const ALL_ROLES = [
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  ];

  for (const role of ALL_ROLES) {
    it(`${role} of tenant A cannot reset a user in tenant B`, async () => {
      const actor = actorRow({ id: `a-${role}`, role, tenantId: 'district' });
      const target = targetRow({ tenantId: 'other' });
      const d = makeDeps([actor, target]);

      if (role === AppRole.SUPER_ADMIN) {
        // The ONE deliberate exception: the platform owner IS cross-tenant,
        // exactly as they are for disable and delete. Asserting the opposite
        // here would make this file a place where "cross-tenant is fine" is a
        // thing tests say about ordinary roles.
        await expect(
          controllerFor(d).resetUserMfa(req(actor), 'u-target', body()),
        ).resolves.toMatchObject({
          ok: true,
        });
        return;
      }

      await expect(
        controllerFor(d).resetUserMfa(req(actor), 'u-target', body()),
      ).rejects.toBeDefined();
      expect(d.updates).toEqual([]);
      expect(d.deletedPasskeys).toEqual([]);
      expect(target.mfaTotpVerifiedAt).toBeInstanceOf(Date);
      expect(target.mfaTotpSecret).toBe('sealed-secret-bytes');
    });

    it(`${role} of tenant A: own-tenant reach matches the rank table exactly`, async () => {
      const actor = actorRow({ id: `a-${role}`, role, tenantId: 'district' });
      const target = targetRow({
        tenantId: 'district',
        role: AppRole.CONTRIBUTOR,
      });
      const d = makeDeps([actor, target]);

      // CONTRIBUTOR and RESTRICTED_VIEWER have an EMPTY assignable list, so
      // even reaching the method body (bypassing RbacGuard, as a direct call
      // does) they cannot act on anyone. That is the defence-in-depth layer
      // under the route decorator asserted below.
      const canReachContributor = [
        AppRole.SUPER_ADMIN,
        AppRole.DISTRICT_ADMIN,
        AppRole.SCHOOL_ADMIN,
      ].includes(role as any);

      if (canReachContributor) {
        await expect(
          controllerFor(d).resetUserMfa(req(actor), 'u-target', body()),
        ).resolves.toMatchObject({
          ok: true,
        });
      } else {
        await expect(
          controllerFor(d).resetUserMfa(req(actor), 'u-target', body()),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(d.updates).toEqual([]);
      }
    });
  }

  it('the route decorator keeps CONTRIBUTOR and RESTRICTED_VIEWER off this write', async () => {
    const roles: string[] | undefined = Reflect.getMetadata(
      ROLES_KEY,
      (UsersController as any).prototype.resetUserMfa,
    );
    expect(roles).toBeDefined();
    expect(roles).toEqual([
      AppRole.SUPER_ADMIN,
      AppRole.DISTRICT_ADMIN,
      AppRole.SCHOOL_ADMIN,
    ]);
    expect(roles).not.toContain(AppRole.CONTRIBUTOR);
    expect(roles).not.toContain(AppRole.RESTRICTED_VIEWER);
  });
});

// ───────────────────────── the notice email ─────────────────────────

describe('the notice email', () => {
  it('tells the target who reset it and what was removed', async () => {
    const actor = actorRow();
    const d = makeDeps(
      [actor, targetRow()],
      [{ id: 'pk-1', userId: 'u-target' }],
    );

    await controllerFor(d).resetUserMfa(req(actor), 'u-target', body());

    expect(d.email.sendMfaReset).toHaveBeenCalledWith({
      to: 'staffer@school.test',
      actorName: 'Dee Admin',
      hadTotp: true,
      passkeysRemoved: 1,
    });
  });

  it('A MAIL FAILURE NEVER FAILS THE RESET', async () => {
    // The factor is already gone and the sessions are already burned. Failing
    // the request to "retry the email" would be a worse outcome than a
    // missing email, and re-running the reset would not help.
    const actor = actorRow();
    const d = makeDeps([actor, targetRow()]);
    d.email.sendMfaReset.mockRejectedValue(new Error('resend 500'));

    await expect(
      controllerFor(d).resetUserMfa(req(actor), 'u-target', body()),
    ).resolves.toMatchObject({
      ok: true,
    });
  });

  it('a SYNCHRONOUS throw from the mailer never fails the reset either', async () => {
    const actor = actorRow();
    const d = makeDeps([actor, targetRow()]);
    d.email.isConfigured.mockImplementation(() => {
      throw new Error('email provider exploded');
    });

    await expect(
      controllerFor(d).resetUserMfa(req(actor), 'u-target', body()),
    ).resolves.toMatchObject({
      ok: true,
    });
  });

  it('sends nothing when email is not configured for this deploy', async () => {
    const actor = actorRow();
    const d = makeDeps([actor, targetRow()]);
    d.email.isConfigured.mockReturnValue(false);

    await controllerFor(d).resetUserMfa(req(actor), 'u-target', body());

    expect(d.email.sendMfaReset).not.toHaveBeenCalled();
  });

  it('a session-revocation failure never rolls back the reset (the DB row is authoritative)', async () => {
    const actor = actorRow();
    const target = targetRow();
    const d = makeDeps([actor, target]);
    d.redis.markUserTokensInvalid.mockRejectedValueOnce(
      new Error('redis down'),
    );
    d.sessions.revokeAllForUser.mockRejectedValueOnce(new Error('pg down'));

    await expect(
      controllerFor(d).resetUserMfa(req(actor), 'u-target', body()),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(target.mfaTotpVerifiedAt).toBeNull();
  });
});

// ───────── the list tells the truth about which factors exist ─────────

describe('GET /users — mfaMethods', () => {
  function listPrisma(rows: any[]) {
    return {
      client: { user: { findMany: jest.fn(async () => rows) } },
    } as any;
  }
  const CALLER = {
    user: { id: 'me', role: AppRole.DISTRICT_ADMIN, tenantId: 'district' },
  };

  it('names TOTP-only, passkey-only, both and none — from ONE query', async () => {
    // `mfaEnrolled` used to be derived from `mfaTotpVerifiedAt` alone, so a
    // passkey-only user read as "not set up" in the only list an admin sees.
    const prisma = listPrisma([
      {
        id: 'totp',
        email: 'a@x.test',
        role: 'CONTRIBUTOR',
        mfaRequired: true,
        mfaTotpVerifiedAt: new Date(),
        _count: { passkeys: 0 },
      },
      {
        id: 'pk',
        email: 'b@x.test',
        role: 'CONTRIBUTOR',
        mfaRequired: false,
        mfaTotpVerifiedAt: null,
        _count: { passkeys: 2 },
      },
      {
        id: 'both',
        email: 'c@x.test',
        role: 'CONTRIBUTOR',
        mfaRequired: true,
        mfaTotpVerifiedAt: new Date(),
        _count: { passkeys: 1 },
      },
      {
        id: 'none',
        email: 'd@x.test',
        role: 'CONTRIBUTOR',
        mfaRequired: false,
        mfaTotpVerifiedAt: null,
        _count: { passkeys: 0 },
      },
    ]);
    const rows: any[] = await new UsersController(
      prisma,
      {} as any,
      {} as any,
      {} as any,
    ).list(CALLER);

    expect(rows.map((r) => r.mfaMethods)).toEqual([
      ['totp'],
      ['passkey'],
      ['totp', 'passkey'],
      [],
    ]);
    expect(rows.map((r) => r.mfaEnrolled)).toEqual([true, true, true, false]);

    // NO N+1: the passkey count rides the list query.
    expect(prisma.client.user.findMany).toHaveBeenCalledTimes(1);
    const select = prisma.client.user.findMany.mock.calls[0][0].select;
    expect(select._count).toEqual({ select: { passkeys: true } });

    // The raw enrollment timestamp still never leaves the API, and neither
    // does the internal `_count` shape.
    for (const r of rows) {
      expect(r.mfaTotpVerifiedAt).toBeUndefined();
      expect(r._count).toBeUndefined();
    }
  });

  it('falls back to TOTP-only truth when an older row carries no _count', async () => {
    const prisma = listPrisma([
      {
        id: 'u1',
        email: 'a@x.test',
        role: 'CONTRIBUTOR',
        mfaRequired: true,
        mfaTotpVerifiedAt: new Date(),
      },
      {
        id: 'u2',
        email: 'b@x.test',
        role: 'CONTRIBUTOR',
        mfaRequired: false,
        mfaTotpVerifiedAt: null,
      },
    ]);
    const rows: any[] = await new UsersController(
      prisma,
      {} as any,
      {} as any,
      {} as any,
    ).list(CALLER);
    expect(rows[0]).toMatchObject({ mfaEnrolled: true, mfaMethods: ['totp'] });
    expect(rows[1]).toMatchObject({ mfaEnrolled: false, mfaMethods: [] });
  });
});

// ───── the reset lands the user in the EXISTING forced-enrollment flow ─────

describe('after a reset, the REAL AuthService.login routes the user to enrollment', () => {
  /**
   * The property that makes this a RECOVERY path and not a bypass: removing
   * the factor must not remove the REQUIREMENT. This runs the real
   * `AuthService.login` — not a mock, not a re-derivation of the policy —
   * against the row the controller actually wrote.
   */
  async function loginAfterResetting(
    targetOverrides: Partial<UserRow>,
    tenantRow: any,
  ): Promise<any> {
    const actor = actorRow();
    const target = targetRow(targetOverrides);
    const d = makeDeps([actor, target], [{ id: 'pk-1', userId: 'u-target' }]);

    await controllerFor(d).resetUserMfa(req(actor), 'u-target', body());

    // Same in-memory rows, now carrying the controller's writes.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('mock_jwt_token') },
        },
        {
          provide: PrismaService,
          useValue: {
            client: {
              user: {
                findUnique: d.prisma.client.user.findUnique,
                update: jest.fn(),
              },
              tenant: { findUnique: jest.fn(async () => tenantRow) },
              passkey: { count: d.prisma.client.passkey.count },
            },
          },
        },
      ],
    }).compile();

    const auth = module.get<AuthService>(AuthService);
    return auth.login({ ...target }, false);
  }

  it('a per-user mfaRequired target is sent to mfaEnrollmentRequired (no grace, clock-free)', async () => {
    const res = await loginAfterResetting(
      { mfaRequired: true, role: AppRole.CONTRIBUTOR },
      { slug: 'd', vertical: 'K12', name: 'D', mfaEnforced: true },
    );
    expect(res).toMatchObject({
      mfaRequired: true,
      mfaEnrollmentRequired: true,
    });
    expect(res.access_token).toBeUndefined();
    expect(res.mfaToken).toEqual(expect.any(String));
  });

  it('a privileged target is sent there too once the derived deadline has passed', async () => {
    const prev = process.env.MFA_REQUIRED_ENFORCE_AFTER;
    process.env.MFA_REQUIRED_ENFORCE_AFTER = 'now';
    try {
      const res = await loginAfterResetting(
        { role: AppRole.SCHOOL_ADMIN, mfaRequired: false },
        { slug: 'd', vertical: 'K12', name: 'D', mfaEnforced: true },
      );
      expect(res).toMatchObject({
        mfaRequired: true,
        mfaEnrollmentRequired: true,
      });
    } finally {
      if (prev === undefined) delete process.env.MFA_REQUIRED_ENFORCE_AFTER;
      else process.env.MFA_REQUIRED_ENFORCE_AFTER = prev;
    }
  });

  it('an UNPRIVILEGED target with no policy gets an ordinary session — the reset is not a lockout', async () => {
    // The reverse direction matters just as much: this endpoint must not turn
    // "I lost my phone" into "I can never sign in again" for someone the
    // policy never covered.
    const res = await loginAfterResetting(
      { role: AppRole.CONTRIBUTOR, mfaRequired: false },
      { slug: 'd', vertical: 'RETAIL', name: 'D', mfaEnforced: false },
    );
    expect(res.mfaRequired).toBeUndefined();
    expect(res.access_token).toEqual(expect.any(String));
  });
});
