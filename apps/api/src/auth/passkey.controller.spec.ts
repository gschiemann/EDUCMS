/**
 * Passkey MANAGEMENT — register, list, rename, delete — plus the two lockout
 * guards that make the feature safe to actually use: first-time backup codes,
 * and the last-factor refusal.
 *
 * These specs run the REAL `@simplewebauthn/server` verifiers against a real
 * P-256 software authenticator (`test/webauthn-test-authenticator.ts`).
 * Nothing about the cryptography is stubbed, because "would a forged
 * response be refused?" is the only question worth asking here and a mocked
 * verifier cannot answer it.
 */

import {
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

import {
  buildHarness,
  makeUser,
  pinAllowedOrigins,
  CEREMONY,
  TEST_PASSWORD,
  type Harness,
} from '../../test/passkey-harness';
import { softAuthenticator } from '../../test/webauthn-test-authenticator';
import { MAX_PASSKEYS_PER_USER } from './passkey.controller';
import { SSO_PROVISIONED_NO_PASSWORD_HASH } from './sso-provisioned-account';

jest.setTimeout(30_000);

let restoreEnv: () => void;
beforeAll(() => {
  restoreEnv = pinAllowedOrigins();
});
afterAll(() => restoreEnv());

/** Run one full registration ceremony and return the controller's response. */
async function register(
  h: Harness,
  opts: {
    label?: string;
    userId?: string;
    auth?: ReturnType<typeof softAuthenticator>;
  } = {},
) {
  const userId = opts.userId ?? 'user-1';
  const device = opts.auth ?? softAuthenticator();
  const { options } = await h.controller.registerOptions(
    { password: TEST_PASSWORD },
    h.req({ userId }),
  );
  const response = device.register({
    ...CEREMONY,
    challenge: options.challenge,
  });
  const result = await h.controller.registerVerify(
    { response, label: opts.label } as any,
    h.req({ userId }),
  );
  return { result, device, options };
}

describe('registration', () => {
  it('registers a passkey and stores exactly what a later assertion needs', async () => {
    const h = await buildHarness([await makeUser()]);
    const device = softAuthenticator();

    const { options } = await h.controller.registerOptions(
      { password: TEST_PASSWORD },
      h.req(),
    );

    // The parameters the contract fixes, asserted on the real output.
    expect(options.rp).toEqual({ id: CEREMONY.rpID, name: 'VenueOS' });
    expect(options.attestation).toBe('none');
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: 'preferred',
      // The property that lets a passkey stand in for two factors.
      userVerification: 'required',
    });
    // ES256 (-7), EdDSA (-8), RS256 (-257). Numeric sort — the default
    // Array#sort is lexicographic and would put -7 before -8.
    expect(
      options.pubKeyCredParams.map((p) => p.alg).sort((a, b) => a - b),
    ).toEqual([-257, -8, -7]);
    expect(options.user.name).toBe('operator@example.test');
    expect(options.user.displayName).toBe('Test Operator');

    const response = device.register({
      ...CEREMONY,
      challenge: options.challenge,
    });
    const { passkey } = await h.controller.registerVerify(
      { response, label: 'Greg MacBook' } as any,
      h.req(),
    );

    expect(passkey).toMatchObject({ label: 'Greg MacBook', lastUsedAt: null });
    const stored = h.passkeys[0];
    expect(stored.credentialId).toBe(device.credentialId);
    expect(Buffer.from(stored.publicKey)).toEqual(
      Buffer.from(device.cosePublicKey()),
    );
    expect(stored.counter).toBe(0n);
    expect(h.auditActions()).toContain('PASSKEY_REGISTERED');
  });

  it('the user handle is STABLE across ceremonies for the same account', async () => {
    const h = await buildHarness([await makeUser()]);
    const a = await h.controller.registerOptions(
      { password: TEST_PASSWORD },
      h.req(),
    );
    const b = await h.controller.registerOptions(
      { password: TEST_PASSWORD },
      h.req(),
    );
    // An unstable handle makes a platform authenticator accumulate a second
    // discoverable credential per re-registration instead of replacing one.
    expect(a.options.user.id).toBe(b.options.user.id);
    // ...and it is not simply the row id echoed to the authenticator.
    expect(a.options.user.id).not.toContain('user-1');
  });

  it('excludeCredentials names what is already registered', async () => {
    const h = await buildHarness([await makeUser()]);
    const { device } = await register(h);
    const { options } = await h.controller.registerOptions(
      { password: TEST_PASSWORD },
      h.req(),
    );
    expect(options.excludeCredentials?.map((c) => c.id)).toEqual([
      device.credentialId,
    ]);
  });

  it('REFUSES a wrong password at the options step', async () => {
    const h = await buildHarness([await makeUser()]);
    // A ≤1h access token is readable by page JavaScript by construction, so a
    // session alone must not be able to mint a permanent credential.
    await expect(
      h.controller.registerOptions({ password: 'not-the-password' }, h.req()),
    ).rejects.toThrow(UnauthorizedException);
    expect(h.auditDetails('PASSKEY_AUTH_FAILED')).toMatchObject({
      reason: 'bad_password',
    });
  });

  it('REFUSES an SSO-provisioned account with PASSKEY_PASSWORD_REQUIRED', async () => {
    const h = await buildHarness([
      await makeUser({ passwordHash: SSO_PROVISIONED_NO_PASSWORD_HASH }),
    ]);
    // Such an account has no password to re-authenticate with, so the gate
    // above could never be satisfied. Say so rather than answering "wrong
    // password" forever.
    await expect(
      h.controller.registerOptions({ password: TEST_PASSWORD }, h.req()),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'PASSKEY_PASSWORD_REQUIRED' },
    });
  });

  it('REFUSES an origin that is not on the allowlist', async () => {
    const h = await buildHarness([await makeUser()]);
    await expect(
      h.controller.registerOptions(
        { password: TEST_PASSWORD },
        h.req({ origin: 'https://evil.example' }),
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { code: 'PASSKEY_ORIGIN_NOT_ALLOWED' },
    });
  });

  it('REFUSES an API key or a paired device — machine identities hold no passkeys', async () => {
    const h = await buildHarness([await makeUser()]);
    for (const kind of ['api-key', 'device']) {
      await expect(
        h.controller.registerOptions(
          { password: TEST_PASSWORD },
          h.req({ kind }),
        ),
      ).rejects.toThrow(UnauthorizedException);
    }
  });

  it('REFUSES the 11th passkey', async () => {
    const h = await buildHarness([await makeUser()]);
    for (let i = 0; i < MAX_PASSKEYS_PER_USER; i++) {
      await register(h, { label: `key ${i}` });
    }
    expect(h.passkeys).toHaveLength(MAX_PASSKEYS_PER_USER);
    await expect(
      h.controller.registerOptions({ password: TEST_PASSWORD }, h.req()),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'PASSKEY_LIMIT' },
    });
  });

  it('re-checks the cap at VERIFY, not only at options', async () => {
    const h = await buildHarness([await makeUser()]);
    const device = softAuthenticator();
    // Start a ceremony while there is room...
    const { options } = await h.controller.registerOptions(
      { password: TEST_PASSWORD },
      h.req(),
    );
    // ...then let rows land from elsewhere (another tab, another replica)
    // before it finishes. Inserted directly rather than through more
    // ceremonies, because a second options call would REPLACE this one's
    // challenge and we would be testing single-use instead of the cap.
    for (let i = 0; i < MAX_PASSKEYS_PER_USER; i++) {
      h.passkeys.push({
        id: `parallel-${i}`,
        userId: 'user-1',
        credentialId: `parallel-cred-${i}`,
        publicKey: Buffer.alloc(1),
        counter: 0n,
        transports: [],
        deviceLabel: null,
        createdAt: new Date(),
        lastUsedAt: null,
      });
    }
    const response = device.register({
      ...CEREMONY,
      challenge: options.challenge,
    });
    await expect(
      h.controller.registerVerify({ response } as any, h.req()),
    ).rejects.toMatchObject({
      response: { code: 'PASSKEY_LIMIT' },
    });
    // The signature was valid — the cap is what refused it, so no row landed.
    expect(
      h.passkeys.filter((p) => p.credentialId === device.credentialId),
    ).toHaveLength(0);
  });

  it('REFUSES a registration signed for a different origin', async () => {
    const h = await buildHarness([await makeUser()]);
    const device = softAuthenticator();
    const { options } = await h.controller.registerOptions(
      { password: TEST_PASSWORD },
      h.req(),
    );
    const response = device.register(
      { ...CEREMONY, challenge: options.challenge },
      { origin: 'https://phish.example' },
    );
    await expect(
      h.controller.registerVerify({ response } as any, h.req()),
    ).rejects.toMatchObject({
      response: { code: 'PASSKEY_VERIFICATION_FAILED' },
    });
    expect(h.passkeys).toHaveLength(0);
  });

  it('REFUSES a registration with the user-verification flag clear', async () => {
    const h = await buildHarness([await makeUser()]);
    const device = softAuthenticator();
    const { options } = await h.controller.registerOptions(
      { password: TEST_PASSWORD },
      h.req(),
    );
    const response = device.register(
      { ...CEREMONY, challenge: options.challenge },
      { userVerified: false },
    );
    await expect(
      h.controller.registerVerify({ response } as any, h.req()),
    ).rejects.toMatchObject({
      response: { code: 'PASSKEY_VERIFICATION_FAILED' },
    });
  });

  it('REFUSES a verify with no pending challenge, and a REPLAY of a spent one', async () => {
    const h = await buildHarness([await makeUser()]);
    const device = softAuthenticator();

    // No options call at all.
    await expect(
      h.controller.registerVerify(
        {
          response: device.register({ ...CEREMONY, challenge: 'never-issued' }),
        } as any,
        h.req(),
      ),
    ).rejects.toMatchObject({
      response: { code: 'PASSKEY_VERIFICATION_FAILED' },
    });

    const { options } = await h.controller.registerOptions(
      { password: TEST_PASSWORD },
      h.req(),
    );
    const response = device.register({
      ...CEREMONY,
      challenge: options.challenge,
    });
    await h.controller.registerVerify({ response } as any, h.req());
    // The identical response a second time: the challenge is spent.
    await expect(
      h.controller.registerVerify({ response } as any, h.req()),
    ).rejects.toMatchObject({
      response: { code: 'PASSKEY_VERIFICATION_FAILED' },
    });
    expect(h.passkeys).toHaveLength(1);
  });
});

describe('list / rename / delete', () => {
  it('lists own passkeys with the cap, and never the key material', async () => {
    const h = await buildHarness([await makeUser()]);
    await register(h, { label: 'Laptop' });
    const listed = await h.controller.list(h.req());
    expect(listed.max).toBe(MAX_PASSKEYS_PER_USER);
    expect(listed.passkeys).toHaveLength(1);
    expect(Object.keys(listed.passkeys[0]).sort()).toEqual(
      ['createdAt', 'id', 'label', 'lastUsedAt', 'transports'].sort(),
    );
    // The public key and the counter are not the operator's business and are
    // not disclosed.
    expect(JSON.stringify(listed)).not.toContain('publicKey');
  });

  it('renames only the caller OWN passkey', async () => {
    const h = await buildHarness([
      await makeUser(),
      await makeUser({ id: 'user-2', email: 'b@example.test' }),
    ]);
    await register(h, { label: 'Before' });
    const id = h.passkeys[0].id;

    const { passkey } = await h.controller.rename(
      id,
      { label: 'After' },
      h.req(),
    );
    expect(passkey.label).toBe('After');
    expect(h.auditActions()).toContain('PASSKEY_RENAMED');

    // Another user cannot reach it — ownership is in the WHERE clause, so
    // there is no window between the check and the write.
    await expect(
      h.controller.rename(
        id,
        { label: 'Hijacked' },
        h.req({ userId: 'user-2' }),
      ),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    expect(h.passkeys[0].deviceLabel).toBe('After');
  });

  it('deletes with a password, and refuses a wrong one', async () => {
    // CONTRIBUTOR in a non-enforcing tenant: no policy requirement, so the
    // last-factor guard is not what is under test here.
    const h = await buildHarness([
      await makeUser({
        role: 'CONTRIBUTOR',
        tenant: { mfaEnforced: false, archivedAt: null },
      }),
    ]);
    await register(h);
    const id = h.passkeys[0].id;

    await expect(
      h.controller.remove(id, { password: 'wrong' }, h.req()),
    ).rejects.toThrow(UnauthorizedException);
    expect(h.passkeys).toHaveLength(1);

    expect(
      await h.controller.remove(id, { password: TEST_PASSWORD }, h.req()),
    ).toEqual({ ok: true });
    expect(h.passkeys).toHaveLength(0);
    expect(h.auditActions()).toContain('PASSKEY_REMOVED');
  });

  it('a full happy path: register → list → rename → delete', async () => {
    const h = await buildHarness([
      await makeUser({
        role: 'CONTRIBUTOR',
        tenant: { mfaEnforced: false, archivedAt: null },
      }),
    ]);
    await register(h, { label: 'Phone' });
    expect((await h.controller.list(h.req())).passkeys).toHaveLength(1);
    const id = h.passkeys[0].id;
    await h.controller.rename(id, { label: 'Work phone' }, h.req());
    expect((await h.controller.list(h.req())).passkeys[0].label).toBe(
      'Work phone',
    );
    await h.controller.remove(id, { password: TEST_PASSWORD }, h.req());
    expect((await h.controller.list(h.req())).passkeys).toHaveLength(0);
  });
});

describe('LAST-FACTOR guard — deleting a passkey cannot strand the account', () => {
  it('REFUSES 409 PASSKEY_LAST_FACTOR when the policy requires a factor and this is the only one', async () => {
    // SCHOOL_ADMIN + enforcing tenant + suite-pinned `ENFORCE_AFTER=now`.
    const h = await buildHarness([await makeUser()]);
    await register(h);
    await expect(
      h.controller.remove(
        h.passkeys[0].id,
        { password: TEST_PASSWORD },
        h.req(),
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'PASSKEY_LAST_FACTOR' },
    });
    expect(h.passkeys).toHaveLength(1);
  });

  it('ALLOWS it when a SECOND passkey remains', async () => {
    const h = await buildHarness([await makeUser()]);
    await register(h, { label: 'one' });
    await register(h, { label: 'two' });
    await h.controller.remove(
      h.passkeys[0].id,
      { password: TEST_PASSWORD },
      h.req(),
    );
    expect(h.passkeys).toHaveLength(1);
  });

  it('ALLOWS it when verified TOTP remains', async () => {
    const h = await buildHarness([
      await makeUser({ mfaTotpVerifiedAt: new Date('2026-08-01') }),
    ]);
    await register(h);
    // Removing a passkey does not touch TOTP, so the account keeps a factor.
    await h.controller.remove(
      h.passkeys[0].id,
      { password: TEST_PASSWORD },
      h.req(),
    );
    expect(h.passkeys).toHaveLength(0);
  });

  it('ALLOWS it when the policy requires nothing of this account', async () => {
    const h = await buildHarness([
      await makeUser({
        role: 'CONTRIBUTOR',
        tenant: { mfaEnforced: false, archivedAt: null },
      }),
    ]);
    await register(h);
    await h.controller.remove(
      h.passkeys[0].id,
      { password: TEST_PASSWORD },
      h.req(),
    );
    expect(h.passkeys).toHaveLength(0);
  });

  it('REFUSES for a panic-capable CONTRIBUTOR — capability, not just role', async () => {
    const h = await buildHarness([
      await makeUser({ role: 'CONTRIBUTOR', canTriggerPanic: true }),
    ]);
    await register(h);
    await expect(
      h.controller.remove(
        h.passkeys[0].id,
        { password: TEST_PASSWORD },
        h.req(),
      ),
    ).rejects.toMatchObject({ response: { code: 'PASSKEY_LAST_FACTOR' } });
  });
});

describe('BACKUP CODES — a passkey-only account is not one lost device from a lockout', () => {
  it('issues 10 codes with the FIRST passkey when the account has none', async () => {
    const h = await buildHarness([await makeUser()]);
    const { result } = await register(h);
    expect(result.backupCodes).toHaveLength(10);
    // Stored as Argon2id hashes, never plaintext.
    const stored = h.users.get('user-1')!.mfaBackupCodes as Array<{
      hash: string;
    }>;
    expect(stored).toHaveLength(10);
    for (const entry of stored) expect(entry.hash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(stored)).not.toContain(result.backupCodes![0]);
  });

  it('does NOT re-issue on the second passkey', async () => {
    const h = await buildHarness([await makeUser()]);
    const first = await register(h, { label: 'one' });
    const second = await register(h, { label: 'two' });
    expect(first.result.backupCodes).toHaveLength(10);
    // Silently rotating them would invalidate the codes the user already saved.
    expect(second.result.backupCodes).toBeUndefined();
  });

  it('does NOT re-issue for a user who already has codes from TOTP enrollment', async () => {
    const h = await buildHarness([
      await makeUser({
        mfaBackupCodes: [{ hash: '$argon2id$existing', createdAt: 'x' }],
      }),
    ]);
    const { result } = await register(h);
    expect(result.backupCodes).toBeUndefined();
    expect(h.users.get('user-1')!.mfaBackupCodes).toHaveLength(1);
  });

  it('DOES re-issue when every code has been spent', async () => {
    const h = await buildHarness([await makeUser({ mfaBackupCodes: [] })]);
    // An empty array is exactly as locked-out as never having had any.
    expect((await register(h)).result.backupCodes).toHaveLength(10);
  });

  it('the issued codes WORK through the existing backup-code challenge path', async () => {
    const h = await buildHarness([await makeUser()]);
    const { result } = await register(h);
    const code = result.backupCodes![0];

    // The account must look TOTP-enrolled for `/auth/mfa/challenge` to accept
    // a backup code at all — that is the pre-existing shape of that route.
    const user = h.users.get('user-1')!;
    user.mfaTotpVerifiedAt = new Date();
    user.mfaTotpSecret = 'sealed-but-unused-on-the-backup-code-branch';
    h.jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      purpose: 'mfa_challenge',
    });

    const session = await h.mfa.challenge({
      mfaToken: 'x'.repeat(20),
      backupCode: code,
    } as any);
    expect(session).toMatchObject({ access_token: 'final-jwt' });
    // Single-use: consumed from the stored set.
    expect(h.users.get('user-1')!.mfaBackupCodes).toHaveLength(9);

    // And the same code a second time is refused.
    await expect(
      h.mfa.challenge({ mfaToken: 'x'.repeat(20), backupCode: code } as any),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe('POST /auth/mfa/disable under a required policy — the operator goal', () => {
  const enrolledAdmin = () =>
    makeUser({
      mfaTotpVerifiedAt: new Date('2026-08-01'),
      mfaTotpSecret: 'sealed',
    });

  it('ALLOWS dropping the authenticator app when a passkey remains', async () => {
    const h = await buildHarness([await enrolledAdmin()]);
    await register(h, { label: 'Touch ID' });

    // "im sick of the damn auth app" — with a passkey on the account this is
    // a compliant change, not a downgrade.
    expect(await h.mfa.disable({ password: TEST_PASSWORD }, h.req())).toEqual({
      success: true,
    });
    const user = h.users.get('user-1')!;
    expect(user.mfaTotpVerifiedAt).toBeNull();
    expect(user.mfaTotpSecret).toBeNull();
    // The passkey is untouched — the account still holds a second factor.
    expect(h.passkeys).toHaveLength(1);
  });

  it('REFUSES when there is no passkey to fall back on', async () => {
    const h = await buildHarness([await enrolledAdmin()]);
    await expect(
      h.mfa.disable({ password: TEST_PASSWORD }, h.req()),
    ).rejects.toMatchObject({
      response: { code: 'MFA_REQUIRED_BY_POLICY' },
    });
    expect(h.users.get('user-1')!.mfaTotpVerifiedAt).not.toBeNull();
  });

  it('still REFUSES a wrong password even with a passkey present', async () => {
    const h = await buildHarness([await enrolledAdmin()]);
    await register(h);
    await expect(h.mfa.disable({ password: 'wrong' }, h.req())).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('GET /auth/mfa/status', () => {
  it('reports TOTP and the passkey count separately', async () => {
    const h = await buildHarness([await makeUser()]);
    expect(await h.mfa.status(h.req())).toEqual({
      enabled: false,
      passkeyCount: 0,
    });
    await register(h);
    // `enabled` keeps meaning TOTP specifically — widening it would make the
    // settings screen claim an authenticator app is configured when it is not.
    expect(await h.mfa.status(h.req())).toEqual({
      enabled: false,
      passkeyCount: 1,
    });
  });
});

describe('the unauthenticated TOTP-enrollment door is CLOSED to a passkey holder', () => {
  it('REFUSES /auth/mfa/required/enroll for an account that holds a passkey', async () => {
    // THE TAKEOVER THIS PREVENTS: a passkey-only admin's login returns a
    // partial mfaToken (minted after a correct password). If this door graded
    // them "not enrolled" it would open, and whoever held that token could
    // install THEIR authenticator as the account's second factor.
    const h = await buildHarness([await makeUser()]);
    await register(h);
    h.jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      purpose: 'mfa_challenge',
    });

    await expect(
      h.mfa.requiredEnroll({ mfaToken: 'x'.repeat(20) } as any),
    ).rejects.toMatchObject({
      response: { code: 'MFA_ALREADY_ENABLED' },
    });
    // No provisional secret was written.
    expect(h.users.get('user-1')!.mfaTotpSecret).toBeNull();
  });

  it('is still OPEN to an account with no factor at all (the recovery lane)', async () => {
    const h = await buildHarness([await makeUser()]);
    h.jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      purpose: 'mfa_challenge',
    });
    // Unchanged behaviour: a blocking-required user with nothing must still
    // be able to enrol, or the policy is a lockout rather than a control.
    const enrolled = await h.mfa.requiredEnroll({
      mfaToken: 'x'.repeat(20),
    } as any);
    expect(enrolled.secret).toEqual(expect.any(String));
  });
});
