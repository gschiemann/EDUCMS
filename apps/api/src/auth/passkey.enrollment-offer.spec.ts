/**
 * THE POST-SIGN-IN PASSKEY OFFER, end to end through the controllers.
 *
 * Operator: "when i try to login with a passkey to my main account it says i
 * dont have one saved. shouldnt it walk me thru getting one?"
 *
 * Walked here with the REAL `@simplewebauthn/server` verifiers and a real
 * P-256 software authenticator — nothing about the ceremony is stubbed:
 *
 *   sign in (password [+ authenticator code])
 *     → the response carries `passkeyEnrollment.grant`
 *     → POST /auth/passkeys/register/options { enrollmentGrant }   (no password)
 *     → the authenticator creates a credential
 *     → POST /auth/passkeys/register/verify                        (unchanged)
 *     → PASSKEY_REGISTERED, audited with `reauth: 'enrollment-grant'`.
 *
 * And the refusals that make it safe: single-use, user-bound, expiring, 403
 * never 401, and useless at every other door — while the password door keeps
 * working exactly as before.
 */

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import {
  buildHarness,
  makeUser,
  pinAllowedOrigins,
  CEREMONY,
  TEST_PASSWORD,
  type Harness,
} from '../../test/passkey-harness';
import { softAuthenticator } from '../../test/webauthn-test-authenticator';
import { RegisterOptionsSchema } from './passkey.controller';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { AuthController } from './auth.controller';
import {
  __resetPasskeyEnrollmentGrantsForTests,
  mintPasskeyEnrollmentGrant,
  PASSKEY_ENROLLMENT_GRANT_TTL_MS,
  redeemPasskeyEnrollmentGrant,
} from './passkey-enrollment-grant';
import { SSO_PROVISIONED_NO_PASSWORD_HASH } from './sso-provisioned-account';
import { MFA_CHALLENGE_PURPOSE } from './mfa-challenge-token';
import { sealMfaSecret } from './mfa-secret-cipher';
import { base32Decode, generateTotpSecret, TotpInternals } from './totp';

jest.setTimeout(30_000);

let restoreEnv: () => void;
beforeAll(() => {
  restoreEnv = pinAllowedOrigins();
});
afterAll(() => restoreEnv());

beforeEach(() => {
  __resetPasskeyEnrollmentGrantsForTests();
});
afterEach(() => {
  jest.restoreAllMocks();
});

/** The harness runs with no Redis, so the grant lives in the memory backend
 *  — exactly where the controller (whose Redis publisher is null) looks. */
async function grantFor(userId: string): Promise<string> {
  const minted = await mintPasskeyEnrollmentGrant(null, userId);
  if (!minted) throw new Error('mint failed');
  return minted.grant;
}

/** Status + code of a rejected controller call, whatever it threw. */
async function refusal(
  p: Promise<unknown>,
): Promise<{ status: number; code: unknown }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HttpException) {
      const body = err.getResponse() as { code?: unknown } | string;
      return {
        status: err.getStatus(),
        code: typeof body === 'object' ? body.code : undefined,
      };
    }
    throw err;
  }
  throw new Error('expected the call to be refused');
}

/** Run the WHOLE registration with a grant instead of a password. */
async function registerWithGrant(h: Harness, grant: string, userId = 'user-1') {
  const device = softAuthenticator();
  const { options } = await h.controller.registerOptions(
    { enrollmentGrant: grant },
    h.req({ userId }),
  );
  const response = device.register({
    ...CEREMONY,
    challenge: options.challenge,
  });
  const result = await h.controller.registerVerify(
    { response, label: 'MacBook' } as any,
    h.req({ userId }),
  );
  return { options, result, device };
}

// ───────────────────────────────────────────────────────────────────────
describe('registration with the sign-in grant instead of a password', () => {
  it('opens the ORDINARY ceremony, verifies a real credential, and audits which door it came through', async () => {
    const h = await buildHarness([await makeUser()]);
    const { options, result, device } = await registerWithGrant(
      h,
      await grantFor('user-1'),
    );

    // Byte-for-byte the parameters the password door issues.
    expect(options.rp).toEqual({ id: CEREMONY.rpID, name: 'VenueOS' });
    expect(options.attestation).toBe('none');
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: 'preferred',
      userVerification: 'required',
    });

    expect(result.passkey).toMatchObject({ label: 'MacBook' });
    expect(h.passkeys).toHaveLength(1);
    expect(h.passkeys[0].credentialId).toBe(device.credentialId);
    expect(h.auditDetails('PASSKEY_REGISTERED')).toMatchObject({
      reauth: 'enrollment-grant',
    });
  });

  it('a first factor still comes with its ten backup codes — the lockout guard is not bypassed', async () => {
    // A password-only account (no MFA) accepting the offer: this passkey is now
    // its ONLY second factor, so it must leave with a recovery path.
    const h = await buildHarness([await makeUser()]);
    const { result } = await registerWithGrant(h, await grantFor('user-1'));
    expect(result.backupCodes).toHaveLength(10);
  });

  it('an account that already has codes (e.g. the authenticator app) gets none re-issued', async () => {
    const h = await buildHarness([
      await makeUser({
        mfaTotpVerifiedAt: new Date(),
        mfaTotpSecret: 'sealed',
        mfaBackupCodes: [{ hash: 'x', createdAt: '2026-09-01T00:00:00Z' }],
      }),
    ]);
    const { result } = await registerWithGrant(h, await grantFor('user-1'));
    expect(result.backupCodes).toBeUndefined();
  });

  it('the PASSWORD door is unchanged — and audited as the password door', async () => {
    const h = await buildHarness([await makeUser()]);
    const device = softAuthenticator();
    const { options } = await h.controller.registerOptions(
      { password: TEST_PASSWORD },
      h.req(),
    );
    await h.controller.registerVerify(
      {
        response: device.register({
          ...CEREMONY,
          challenge: options.challenge,
        }),
      } as any,
      h.req(),
    );
    expect(h.auditDetails('PASSKEY_REGISTERED')).toMatchObject({
      reauth: 'password',
    });
    // A wrong password is still the same 403 it was.
    expect(
      await refusal(
        h.controller.registerOptions({ password: 'nope' }, h.req()),
      ),
    ).toEqual({
      status: 403,
      code: 'PASSKEY_BAD_PASSWORD',
    });
  });

  it('is SINGLE-USE — the second presentation is a 403 (never 401) and is audited', async () => {
    const h = await buildHarness([await makeUser()]);
    const grant = await grantFor('user-1');
    await h.controller.registerOptions({ enrollmentGrant: grant }, h.req());

    const second = await refusal(
      h.controller.registerOptions({ enrollmentGrant: grant }, h.req()),
    );
    // 403: apiFetch signs the operator out on ANY 401, and a spent offer is
    // not an expired session.
    expect(second).toEqual({ status: 403, code: 'PASSKEY_GRANT_INVALID' });
    expect(h.auditDetails('PASSKEY_AUTH_FAILED')).toMatchObject({
      stage: 'register_options',
      reason: 'invalid_enrollment_grant',
    });
  });

  it('is USER-BOUND — another signed-in account cannot use it, and cannot burn it', async () => {
    const h = await buildHarness([
      await makeUser({ id: 'victim', email: 'victim@example.test' }),
      await makeUser({ id: 'attacker', email: 'attacker@example.test' }),
    ]);
    const grant = await grantFor('victim');

    expect(
      await refusal(
        h.controller.registerOptions(
          { enrollmentGrant: grant },
          h.req({ userId: 'attacker' }),
        ),
      ),
    ).toEqual({ status: 403, code: 'PASSKEY_GRANT_INVALID' });
    expect(h.passkeys).toHaveLength(0);

    // The owner's grant survived the attempt.
    await registerWithGrant(h, grant, 'victim');
    expect(h.passkeys.map((p) => p.userId)).toEqual(['victim']);
  });

  it('EXPIRES — ten minutes after the sign-in it is refused', async () => {
    const h = await buildHarness([await makeUser()]);
    const t0 = Date.now();
    const grant = await grantFor('user-1');
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(t0 + PASSKEY_ENROLLMENT_GRANT_TTL_MS + 1);
    expect(
      await refusal(
        h.controller.registerOptions({ enrollmentGrant: grant }, h.req()),
      ),
    ).toEqual({
      status: 403,
      code: 'PASSKEY_GRANT_INVALID',
    });
  });

  it('a session token or an mfaToken presented AS the grant is refused', async () => {
    const h = await buildHarness([await makeUser()]);
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    for (const impostor of [
      jwt.sign({ sub: 'user-1', role: 'SCHOOL_ADMIN', tenantId: 'tenant-1' }),
      jwt.sign({ sub: 'user-1', purpose: MFA_CHALLENGE_PURPOSE }),
      'x'.repeat(43), // right shape, never minted
    ]) {
      expect(
        await refusal(
          h.controller.registerOptions({ enrollmentGrant: impostor }, h.req()),
        ),
      ).toEqual({ status: 403, code: 'PASSKEY_GRANT_INVALID' });
    }
  });

  it('does not open a door the password could not: an externally-provisioned account is still refused', async () => {
    const h = await buildHarness([
      await makeUser({ passwordHash: SSO_PROVISIONED_NO_PASSWORD_HASH }),
    ]);
    expect(
      await refusal(
        h.controller.registerOptions(
          { enrollmentGrant: await grantFor('user-1') },
          h.req(),
        ),
      ),
    ).toEqual({ status: 409, code: 'PASSKEY_PASSWORD_REQUIRED' });
  });

  it('machine identities cannot spend one either', async () => {
    const h = await buildHarness([await makeUser()]);
    const grant = await grantFor('user-1');
    for (const kind of ['api-key', 'device']) {
      await expect(
        h.controller.registerOptions(
          { enrollmentGrant: grant },
          h.req({ kind }),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    // …and the refusal happened before the grant was touched.
    expect(await redeemPasskeyEnrollmentGrant(null, 'user-1', grant)).toBe(
      true,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('the body takes EXACTLY one re-authentication', () => {
  const pipe = new ZodValidationPipe(RegisterOptionsSchema);
  const parse = (body: unknown) =>
    pipe.transform(body, { type: 'body' } as any);

  it('accepts a password, or a grant', () => {
    expect(parse({ password: 'pw' })).toEqual({ password: 'pw' });
    expect(parse({ enrollmentGrant: 'g' })).toEqual({ enrollmentGrant: 'g' });
  });

  it.each([
    ['both', { password: 'pw', enrollmentGrant: 'g' }],
    ['neither', {}],
    ['an unknown key', { enrollmentGrant: 'g', rememberMe: true }],
    ['an empty grant', { enrollmentGrant: '' }],
    ['an oversized grant', { enrollmentGrant: 'g'.repeat(257) }],
  ])('refuses %s with a 400', (_label, body) => {
    expect(() => parse(body)).toThrow(BadRequestException);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('ONE PURPOSE — the grant is useless at every other door, and not even spent there', () => {
  it('every partial-mfaToken door refuses it, as do the password re-auth doors', async () => {
    const h = await buildHarness([await makeUser()]);
    // The REAL verifier behind every mfaToken door, not the harness's mock.
    const real = new JwtService({ secret: process.env.JWT_SECRET });
    h.jwt.verifyAsync.mockImplementation(
      (token: string, opts: Parameters<JwtService['verifyAsync']>[1]) =>
        real.verifyAsync(token, opts),
    );

    // A passkey to try removing, added through the untouched password door.
    const device = softAuthenticator();
    const { options } = await h.controller.registerOptions(
      { password: TEST_PASSWORD },
      h.req(),
    );
    await h.controller.registerVerify(
      {
        response: device.register({
          ...CEREMONY,
          challenge: options.challenge,
        }),
      } as any,
      h.req(),
    );

    const grant = await grantFor('user-1');
    const req = h.req() as Parameters<typeof h.controller.registerOptions>[1];

    expect(
      await refusal(h.mfa.challenge({ mfaToken: grant, code: '123456' })),
    ).toEqual({
      status: 401,
      code: 'MFA_TOKEN_INVALID',
    });
    expect(await refusal(h.mfa.requiredEnroll({ mfaToken: grant }))).toEqual({
      status: 401,
      code: 'MFA_TOKEN_INVALID',
    });
    expect(
      await refusal(h.controller.mfaPasskeyOptions({ mfaToken: grant }, req)),
    ).toEqual({
      status: 401,
      code: 'MFA_TOKEN_INVALID',
    });
    expect(
      await refusal(
        h.controller.requiredPasskeyOptions({ mfaToken: grant }, req),
      ),
    ).toEqual({
      status: 401,
      code: 'MFA_TOKEN_INVALID',
    });
    // Not a password, either.
    expect(
      await refusal(h.controller.registerOptions({ password: grant }, req)),
    ).toEqual({
      status: 403,
      code: 'PASSKEY_BAD_PASSWORD',
    });
    expect(
      await refusal(
        h.controller.remove(h.passkeys[0].id, { password: grant }, req),
      ),
    ).toEqual({
      status: 403,
      code: 'PASSKEY_BAD_PASSWORD',
    });
    expect(h.passkeys).toHaveLength(1);

    // None of those doors even READ the grant store: it still redeems, once,
    // at the one door that honours it.
    const redeemed = await h.controller.registerOptions(
      { enrollmentGrant: grant },
      req,
    );
    expect(redeemed.options.challenge).toEqual(expect.any(String));
  });
});

// ───────────────────────────────────────────────────────────────────────
/** The slice of a sign-in response these specs read. */
type SignInResponse = {
  access_token?: string;
  passkeyEnrollment?: { grant: string; expiresAt: string };
};

describe('MINT SITE 1 — POST /auth/login (password, no second factor owed)', () => {
  function controllerFor(validUser: unknown, loginResult: unknown) {
    const auditCreate = jest.fn<
      Promise<unknown>,
      [{ data: { details: string } }]
    >(() => Promise.resolve({}));
    /** The AUTH_LOGIN_SUCCESS row's details, parsed. */
    const auditDetails = () =>
      JSON.parse(auditCreate.mock.calls[0][0].data.details) as Record<
        string,
        unknown
      >;
    const authService = {
      validateUser: jest.fn().mockResolvedValue(validUser),
      tenantIdForEmail: jest.fn().mockResolvedValue(null),
      login: jest.fn().mockResolvedValue(loginResult),
      mfaPolicyForUser: jest.fn().mockResolvedValue({
        required: false,
        reasons: [],
        enrolled: false,
        blocking: false,
        enforceAfter: null,
        tenantEnforced: true,
        inGrace: false,
      }),
    };
    const controller = new AuthController(
      authService as unknown as ConstructorParameters<typeof AuthController>[0],
      { publisher: null } as unknown as ConstructorParameters<
        typeof AuthController
      >[1],
      {
        client: {
          auditLog: { create: auditCreate },
          tenant: { upsert: jest.fn() },
        },
      } as unknown as ConstructorParameters<typeof AuthController>[2],
    );
    /** POST /auth/login with these credentials, typed for what we read. */
    const signIn = async (password = 'pw') =>
      (await controller.login(
        { email: 'teacher@example.test', password },
        req,
      )) as SignInResponse;
    return { signIn, auditDetails };
  }
  const req = {
    ip: '203.0.113.9',
    headers: { 'user-agent': 'jest' },
  } as unknown as Parameters<AuthController['login']>[1];
  const passwordOnly = {
    id: 'user-1',
    email: 'teacher@example.test',
    tenantId: 'tenant-1',
    mustSetupCredentials: false,
    _count: { passkeys: 0 },
  };
  const SESSION = { access_token: 'session-jwt', user: { id: 'user-1' } };

  it('a completed password sign-in carries a grant that opens registration', async () => {
    const { signIn, auditDetails } = controllerFor(passwordOnly, SESSION);
    const res = await signIn();

    expect(res.access_token).toBe('session-jwt');
    const offer = res.passkeyEnrollment!;
    expect(offer.grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(offer.expiresAt)).toBeGreaterThan(Date.now());
    // The forensic row says the offer was made.
    expect(auditDetails().passkeyEnrollmentOffered).toBe(true);
    // And it is the real thing: it opens the ceremony, once.
    const h = await buildHarness([await makeUser()]);
    await h.controller.registerOptions(
      { enrollmentGrant: offer.grant },
      h.req(),
    );
    expect(
      await refusal(
        h.controller.registerOptions({ enrollmentGrant: offer.grant }, h.req()),
      ),
    ).toEqual({ status: 403, code: 'PASSKEY_GRANT_INVALID' });
  });

  it('a sign-in that still owes a second factor carries NO grant', async () => {
    const { signIn, auditDetails } = controllerFor(
      { ...passwordOnly, mfaTotpVerifiedAt: new Date() },
      { mfaRequired: true, mfaMethods: ['totp'], mfaToken: 'partial' },
    );
    const res = await signIn();
    expect(res.passkeyEnrollment).toBeUndefined();
    expect(auditDetails().passkeyEnrollmentOffered).toBe(false);
  });

  it('an account behind the first-login setup gate carries NO grant', async () => {
    const { signIn } = controllerFor(
      { ...passwordOnly, mustSetupCredentials: true },
      SESSION,
    );
    expect((await signIn()).passkeyEnrollment).toBeUndefined();
  });

  it('a wrong password mints nothing at all', async () => {
    const { signIn } = controllerFor(null, SESSION);
    await expect(signIn('wrong')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('MINT SITE 2 — POST /auth/mfa/challenge (password + authenticator code)', () => {
  // The CURRENT code, computed exactly as an authenticator app would. Real
  // time, not a frozen clock: the grant minted by the same call must still be
  // inside its ten minutes when the test redeems it afterwards. (The verifier
  // accepts the adjacent step, so a 30-second boundary mid-test is harmless.)
  const totpCode = (secretBase32: string) =>
    TotpInternals.hotp(
      base32Decode(secretBase32),
      Math.floor(Date.now() / 1000 / TotpInternals.TOTP_PERIOD_SECONDS),
    );

  it("THE OPERATOR'S CASE: authenticator app, zero passkeys → the grant rides the session, and a passkey can be added with it", async () => {
    const { secretBase32 } = generateTotpSecret();
    const h = await buildHarness([
      await makeUser({
        role: 'SUPER_ADMIN',
        mfaTotpSecret: sealMfaSecret(secretBase32),
        mfaTotpVerifiedAt: new Date('2026-09-01'),
        mfaBackupCodes: [{ hash: 'x', createdAt: '2026-09-01T00:00:00Z' }],
      }),
    ]);
    h.jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      purpose: MFA_CHALLENGE_PURPOSE,
    });

    const session = (await h.mfa.challenge({
      mfaToken: 'x'.repeat(20),
      code: totpCode(secretBase32),
    })) as SignInResponse;

    expect(session.access_token).toBe('final-jwt');
    const offer = session.passkeyEnrollment!;
    expect(offer.grant).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await registerWithGrant(h, offer.grant);
    expect(h.passkeys).toHaveLength(1);
    expect(h.auditDetails('PASSKEY_REGISTERED')).toMatchObject({
      reauth: 'enrollment-grant',
      // They already had codes from the authenticator app.
      backupCodesIssued: 0,
    });
  });

  it('an account that already has a passkey (signing in with a backup code) gets NO grant', async () => {
    const h = await buildHarness([await makeUser()]);
    // A passkey through the password door; it mints the account's codes.
    const device = softAuthenticator();
    const { options } = await h.controller.registerOptions(
      { password: TEST_PASSWORD },
      h.req(),
    );
    const { backupCodes } = await h.controller.registerVerify(
      {
        response: device.register({
          ...CEREMONY,
          challenge: options.challenge,
        }),
      } as any,
      h.req(),
    );
    h.jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      purpose: MFA_CHALLENGE_PURPOSE,
    });

    const session = (await h.mfa.challenge({
      mfaToken: 'x'.repeat(20),
      backupCode: backupCodes![0],
    })) as SignInResponse;
    expect(session.access_token).toBe('final-jwt');
    expect(session.passkeyEnrollment).toBeUndefined();
  });

  it('a WRONG code mints nothing', async () => {
    const { secretBase32 } = generateTotpSecret();
    const h = await buildHarness([
      await makeUser({
        mfaTotpSecret: sealMfaSecret(secretBase32),
        mfaTotpVerifiedAt: new Date(),
      }),
    ]);
    h.jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      purpose: MFA_CHALLENGE_PURPOSE,
    });
    await expect(
      h.mfa.challenge({ mfaToken: 'x'.repeat(20), code: '000000' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a refused grant is a ForbiddenException, the class apiFetch does NOT sign out on', async () => {
    const h = await buildHarness([await makeUser()]);
    await expect(
      h.controller.registerOptions(
        { enrollmentGrant: 'y'.repeat(43) },
        h.req(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
