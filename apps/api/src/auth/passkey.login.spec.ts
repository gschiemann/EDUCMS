/**
 * Passkey SIGN-IN — the second-factor lane and the passwordless lane.
 *
 * Every assertion here is produced by a real P-256 software authenticator and
 * checked by the real `@simplewebauthn/server` verifier. The forgery cases
 * (wrong origin, wrong rpID, cleared UV flag, regressed counter, replayed
 * challenge) are therefore genuine cryptographic failures, not string
 * comparisons a stub agreed to fail.
 *
 * The property the whole file is really about: EVERY refusal looks the same
 * from outside. An unknown credential, a bad signature, a spent challenge, a
 * disabled account and an archived tenant all answer
 * `401 PASSKEY_VERIFICATION_FAILED`, because anything finer is an oracle for
 * which credentials and which accounts exist.
 */

import {
  buildHarness,
  makeUser,
  pinAllowedOrigins,
  CEREMONY,
  TEST_PASSWORD,
  type Harness,
} from '../../test/passkey-harness';
import {
  softAuthenticator,
  type SoftAuthenticator,
} from '../../test/webauthn-test-authenticator';

jest.setTimeout(30_000);

const MFA_TOKEN = 'm'.repeat(40);

let restoreEnv: () => void;
beforeAll(() => {
  restoreEnv = pinAllowedOrigins();
});
afterAll(() => restoreEnv());

/** Register a passkey through the real ceremony so the row is genuine. */
async function enrolled(
  h: Harness,
  userId = 'user-1',
): Promise<SoftAuthenticator> {
  const device = softAuthenticator();
  const { options } = await h.controller.registerOptions(
    { password: TEST_PASSWORD },
    h.req({ userId }),
  );
  await h.controller.registerVerify(
    {
      response: device.register({ ...CEREMONY, challenge: options.challenge }),
    } as any,
    h.req({ userId }),
  );
  return device;
}

/** Everything in this file expects the SAME opaque refusal. */
const REFUSED = { response: { code: 'PASSKEY_VERIFICATION_FAILED' } };

describe('second factor — POST /auth/mfa/challenge/passkey', () => {
  async function ready(userOverrides = {}) {
    const h = await buildHarness([await makeUser(userOverrides)]);
    const device = await enrolled(h);
    h.jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      purpose: 'mfa_challenge',
    });
    return { h, device };
  }

  it("options name THIS user's credentials and demand user verification", async () => {
    const { h, device } = await ready();
    const { options } = await h.controller.mfaPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req(),
    );
    expect(options.rpId).toBe(CEREMONY.rpID);
    expect(options.userVerification).toBe('required');
    // Known user, so naming the credential is safe here and saves the
    // account-picker step on a security key.
    expect(options.allowCredentials?.map((c) => c.id)).toEqual([
      device.credentialId,
    ]);
  });

  it('verify returns EXACTLY the payload the TOTP challenge returns', async () => {
    const { h, device } = await ready();
    const { options } = await h.controller.mfaPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req(),
    );
    const response = device.authenticate({
      ...CEREMONY,
      challenge: options.challenge,
    });

    const session = await h.controller.mfaPasskeyVerify(
      { mfaToken: MFA_TOKEN, response } as any,
      h.req(),
    );

    // Both lanes finish through the SAME `AuthService.login` call, so the
    // envelope cannot drift between "I typed a code" and "I used my face".
    expect(session).toEqual({
      access_token: 'final-jwt',
      user: { id: 'user-1' },
    });
    expect(h.auth.login).toHaveBeenCalledTimes(1);
    const [userArg, rememberArg, optsArg] = h.auth.login.mock.calls[0];
    expect(optsArg).toEqual({ mfaAlreadySatisfied: true });
    expect(rememberArg).toBeUndefined();
    // The first-login credential gate must ride along — omitting it is how
    // the MFA lane bypassed it in September.
    expect(userArg).toMatchObject({
      id: 'user-1',
      mustSetupCredentials: false,
    });
    expect(h.auditActions()).toContain('PASSKEY_MFA_SUCCESS');
  });

  it('carries rememberMe through from the partial token', async () => {
    const { h, device } = await ready();
    h.jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      purpose: 'mfa_challenge',
      rememberMe: true,
    });
    const { options } = await h.controller.mfaPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req(),
    );
    const response = device.authenticate({
      ...CEREMONY,
      challenge: options.challenge,
    });
    await h.controller.mfaPasskeyVerify(
      { mfaToken: MFA_TOKEN, response } as any,
      h.req(),
    );
    expect(h.auth.login.mock.calls[0][1]).toBe(true);
  });

  it('forwards mustSetupCredentials when the account still owes a claim', async () => {
    const { h, device } = await ready({ mustSetupCredentials: true });
    const { options } = await h.controller.mfaPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req(),
    );
    const response = device.authenticate({
      ...CEREMONY,
      challenge: options.challenge,
    });
    await h.controller.mfaPasskeyVerify(
      { mfaToken: MFA_TOKEN, response } as any,
      h.req(),
    );
    expect(h.auth.login.mock.calls[0][0]).toMatchObject({
      mustSetupCredentials: true,
    });
  });

  it('REFUSES a session JWT presented as an mfaToken (the purpose claim)', async () => {
    const { h } = await ready();
    // A normal access token lacks `purpose`, so a stolen one cannot be traded
    // for a second-factor pass.
    h.jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    await expect(
      h.controller.mfaPasskeyOptions({ mfaToken: MFA_TOKEN }, h.req()),
    ).rejects.toMatchObject({ response: { code: 'MFA_TOKEN_INVALID' } });
  });

  it('REFUSES when the token does not verify at all', async () => {
    const { h } = await ready();
    h.jwt.verifyAsync.mockRejectedValue(new Error('bad signature'));
    await expect(
      h.controller.mfaPasskeyOptions({ mfaToken: MFA_TOKEN }, h.req()),
    ).rejects.toMatchObject({ response: { code: 'MFA_TOKEN_INVALID' } });
  });

  it('says PASSKEY_NOT_ENROLLED when the account has none — that is not a secret', async () => {
    const h = await buildHarness([await makeUser()]);
    h.jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      purpose: 'mfa_challenge',
    });
    // The caller already proved the password to get this token, so "you have
    // no passkeys, use your app" discloses nothing they could not learn from
    // their own settings page — and a generic failure here would strand them.
    await expect(
      h.controller.mfaPasskeyOptions({ mfaToken: MFA_TOKEN }, h.req()),
    ).rejects.toMatchObject({ response: { code: 'PASSKEY_NOT_ENROLLED' } });
  });

  it("REFUSES ANOTHER USER'S passkey against this challenge", async () => {
    const h = await buildHarness([
      await makeUser(),
      await makeUser({ id: 'user-2', email: 'other@example.test' }),
    ]);
    await enrolled(h, 'user-1');
    const theirs = await enrolled(h, 'user-2');
    h.jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      purpose: 'mfa_challenge',
    });

    const { options } = await h.controller.mfaPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req(),
    );
    // A perfectly valid assertion — from the wrong account. Without the
    // userId in the lookup's WHERE clause, ANY passkey would satisfy ANY
    // user's challenge.
    const response = theirs.authenticate({
      ...CEREMONY,
      challenge: options.challenge,
    });
    await expect(
      h.controller.mfaPasskeyVerify(
        { mfaToken: MFA_TOKEN, response } as any,
        h.req(),
      ),
    ).rejects.toMatchObject(REFUSED);
    expect(h.auth.login).not.toHaveBeenCalled();
  });

  it('spends the SAME per-user attempt budget TOTP spends', async () => {
    const { h, device } = await ready();
    const check = jest.spyOn(h.rateLimiter, 'check');
    const record = jest.spyOn(h.rateLimiter, 'record');

    const { options } = await h.controller.mfaPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req(),
    );
    const response = device.authenticate({
      ...CEREMONY,
      challenge: options.challenge,
    });
    await h.controller.mfaPasskeyVerify(
      { mfaToken: MFA_TOKEN, response } as any,
      h.req(),
    );

    // A second factor with its own separate allowance would simply be the
    // cheaper one to brute-force.
    expect(check).toHaveBeenCalledWith('user-1');
    expect(record).toHaveBeenCalledWith('user-1', true);
  });

  it('a failed attempt is RECORDED as a failure, not silently dropped', async () => {
    const { h, device } = await ready();
    const record = jest.spyOn(h.rateLimiter, 'record');
    const { options } = await h.controller.mfaPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req(),
    );
    const response = device.authenticate(
      { ...CEREMONY, challenge: options.challenge },
      { origin: 'https://phish.example' },
    );
    await expect(
      h.controller.mfaPasskeyVerify(
        { mfaToken: MFA_TOKEN, response } as any,
        h.req(),
      ),
    ).rejects.toMatchObject(REFUSED);
    expect(record).toHaveBeenCalledWith('user-1', false);
    expect(h.auditActions()).toContain('PASSKEY_AUTH_FAILED');
  });

  it('locks out after the same 5 failures TOTP allows', async () => {
    const { h, device } = await ready();
    for (let i = 0; i < 5; i++) {
      const { options } = await h.controller.mfaPasskeyOptions(
        { mfaToken: MFA_TOKEN },
        h.req(),
      );
      const bad = device.authenticate(
        { ...CEREMONY, challenge: options.challenge },
        { origin: 'https://phish.example' },
      );
      await expect(
        h.controller.mfaPasskeyVerify(
          { mfaToken: MFA_TOKEN, response: bad } as any,
          h.req(),
        ),
      ).rejects.toMatchObject(REFUSED);
    }
    // The 6th attempt never reaches the crypto — 429 from the shared limiter.
    const { options } = await h.controller.mfaPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req(),
    );
    const good = device.authenticate({
      ...CEREMONY,
      challenge: options.challenge,
    });
    await expect(
      h.controller.mfaPasskeyVerify(
        { mfaToken: MFA_TOKEN, response: good } as any,
        h.req(),
      ),
    ).rejects.toMatchObject({ response: { code: 'MFA_LOCKED_OUT' } });
  });

  it('REFUSES an account disabled BETWEEN the password check and the challenge', async () => {
    const { h, device } = await ready();
    const { options } = await h.controller.mfaPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req(),
    );
    // The partial token lives five minutes. Closing that window is why the
    // eligibility gates are re-read here rather than trusted from login.
    h.users.get('user-1')!.status = 'DISABLED';
    const response = device.authenticate({
      ...CEREMONY,
      challenge: options.challenge,
    });
    await expect(
      h.controller.mfaPasskeyVerify(
        { mfaToken: MFA_TOKEN, response } as any,
        h.req(),
      ),
    ).rejects.toMatchObject(REFUSED);
    expect(h.auth.login).not.toHaveBeenCalled();
  });
});

describe('passwordless — POST /auth/passkeys/login/{options,verify}', () => {
  async function ready(userOverrides = {}) {
    const h = await buildHarness([await makeUser(userOverrides)]);
    const device = await enrolled(h);
    h.auth.login.mockClear();
    return { h, device };
  }

  /** Start a discoverable ceremony and return what the client would need. */
  async function beginLogin(h: Harness) {
    const { options, challengeId } = await h.controller.loginOptions(
      {},
      h.req({ userId: null }),
    );
    return { options, challengeId };
  }

  it('options are DISCOVERABLE — no allowCredentials, so no enumeration', async () => {
    const { h } = await ready();
    const { options, challengeId } = await beginLogin(h);
    // Naming credentials would require knowing the user first, which would
    // mean answering "does this email have a passkey?" on a public endpoint.
    expect(options.allowCredentials).toEqual([]);
    expect(options.userVerification).toBe('required');
    expect(options.rpId).toBe(CEREMONY.rpID);
    expect(typeof challengeId).toBe('string');
    expect(challengeId.length).toBeGreaterThan(16);
  });

  it('a fresh challengeId per call — two sign-ins never share a nonce', async () => {
    const { h } = await ready();
    const a = await beginLogin(h);
    const b = await beginLogin(h);
    expect(a.challengeId).not.toBe(b.challengeId);
    expect(a.options.challenge).not.toBe(b.options.challenge);
  });

  it('HAPPY PATH — a verified assertion mints the same envelope /auth/login does', async () => {
    const { h, device } = await ready();
    const { options, challengeId } = await beginLogin(h);
    const response = device.authenticate({
      ...CEREMONY,
      challenge: options.challenge,
    });

    const session = await h.controller.loginVerify(
      { challengeId, response, rememberMe: true } as any,
      h.req({ userId: null }),
    );

    expect(session).toEqual({
      access_token: 'final-jwt',
      user: { id: 'user-1' },
    });
    // Through `login()`, so a forced-credential-setup response or the MFA
    // policy notice arrive exactly as they would on the password path.
    const [userArg, rememberArg, optsArg] = h.auth.login.mock.calls[0];
    expect(userArg).toMatchObject({
      id: 'user-1',
      email: 'operator@example.test',
    });
    expect(rememberArg).toBe(true);
    // The assertion IS the second factor — user verification was required.
    expect(optsArg).toEqual({ mfaAlreadySatisfied: true });
    expect(h.auditActions()).toContain('PASSKEY_LOGIN_SUCCESS');
  });

  it('stamps lastUsedAt and advances the stored counter', async () => {
    const h = await buildHarness([await makeUser()]);
    // A counting authenticator (a security key), unlike a synced passkey.
    const device = softAuthenticator({ signCount: 5 });
    const { options: reg } = await h.controller.registerOptions(
      { password: TEST_PASSWORD },
      h.req(),
    );
    await h.controller.registerVerify(
      {
        response: device.register({ ...CEREMONY, challenge: reg.challenge }),
      } as any,
      h.req(),
    );
    expect(h.passkeys[0].counter).toBe(5n);
    expect(h.passkeys[0].lastUsedAt).toBeNull();

    const { options, challengeId } = await beginLogin(h);
    await h.controller.loginVerify(
      {
        challengeId,
        response: device.authenticate({
          ...CEREMONY,
          challenge: options.challenge,
        }),
      } as any,
      h.req({ userId: null }),
    );
    expect(h.passkeys[0].counter).toBe(6n);
    expect(h.passkeys[0].lastUsedAt).toBeInstanceOf(Date);
  });

  it('a SYNCED passkey reporting 0 forever is accepted repeatedly', async () => {
    // The counter rule is "reject only when the stored counter is > 0 and the
    // new one is ≤ it". Getting this wrong locks every iCloud/Google passkey
    // out after its first use.
    const { h, device } = await ready();
    for (let i = 0; i < 3; i++) {
      const { options, challengeId } = await beginLogin(h);
      const response = device.authenticate({
        ...CEREMONY,
        challenge: options.challenge,
      });
      await expect(
        h.controller.loginVerify(
          { challengeId, response } as any,
          h.req({ userId: null }),
        ),
      ).resolves.toMatchObject({ access_token: 'final-jwt' });
    }
    expect(h.passkeys[0].counter).toBe(0n);
  });

  describe('forgeries and replays — all refused identically', () => {
    it('a REPLAYED response (same challenge twice)', async () => {
      const { h, device } = await ready();
      const { options, challengeId } = await beginLogin(h);
      const response = device.authenticate({
        ...CEREMONY,
        challenge: options.challenge,
      });

      await h.controller.loginVerify(
        { challengeId, response } as any,
        h.req({ userId: null }),
      );
      // Byte-identical, a second time. The challenge was destroyed on first use.
      await expect(
        h.controller.loginVerify(
          { challengeId, response } as any,
          h.req({ userId: null }),
        ),
      ).rejects.toMatchObject(REFUSED);
      expect(h.auth.login).toHaveBeenCalledTimes(1);
    });

    it('a response signed for a DIFFERENT challenge', async () => {
      const { h, device } = await ready();
      const stale = await beginLogin(h);
      const fresh = await beginLogin(h);
      // Signed against the first ceremony, presented against the second.
      const response = device.authenticate({
        ...CEREMONY,
        challenge: stale.options.challenge,
      });
      await expect(
        h.controller.loginVerify(
          { challengeId: fresh.challengeId, response } as any,
          h.req({ userId: null }),
        ),
      ).rejects.toMatchObject(REFUSED);
    });

    it('an unknown challengeId', async () => {
      const { h, device } = await ready();
      const { options } = await beginLogin(h);
      const response = device.authenticate({
        ...CEREMONY,
        challenge: options.challenge,
      });
      await expect(
        h.controller.loginVerify(
          { challengeId: 'not-a-real-challenge-id', response } as any,
          h.req({ userId: null }),
        ),
      ).rejects.toMatchObject(REFUSED);
    });

    it('the WRONG ORIGIN — a phishing page collecting real assertions', async () => {
      const { h, device } = await ready();
      const { options, challengeId } = await beginLogin(h);
      const response = device.authenticate(
        { ...CEREMONY, challenge: options.challenge },
        { origin: 'https://venueos-login.evil.example' },
      );
      await expect(
        h.controller.loginVerify(
          { challengeId, response } as any,
          h.req({ userId: null }),
        ),
      ).rejects.toMatchObject(REFUSED);
    });

    it('the WRONG rpID hash', async () => {
      const { h, device } = await ready();
      const { options, challengeId } = await beginLogin(h);
      const response = device.authenticate(
        { ...CEREMONY, challenge: options.challenge },
        { rpID: 'evil.example' },
      );
      await expect(
        h.controller.loginVerify(
          { challengeId, response } as any,
          h.req({ userId: null }),
        ),
      ).rejects.toMatchObject(REFUSED);
    });

    it('the USER-VERIFICATION flag clear — possession without the person', async () => {
      const { h, device } = await ready();
      const { options, challengeId } = await beginLogin(h);
      // This is what makes a passkey count for two factors. Accept it with UV
      // clear and passwordless sign-in becomes "whoever holds the laptop".
      const response = device.authenticate(
        { ...CEREMONY, challenge: options.challenge },
        { userVerified: false },
      );
      await expect(
        h.controller.loginVerify(
          { challengeId, response } as any,
          h.req({ userId: null }),
        ),
      ).rejects.toMatchObject(REFUSED);
    });

    it('a COUNTER REGRESSION — the cloned-authenticator signal', async () => {
      const h = await buildHarness([await makeUser()]);
      const device = softAuthenticator({ signCount: 10 });
      const { options: reg } = await h.controller.registerOptions(
        { password: TEST_PASSWORD },
        h.req(),
      );
      await h.controller.registerVerify(
        {
          response: device.register({ ...CEREMONY, challenge: reg.challenge }),
        } as any,
        h.req(),
      );
      const { options, challengeId } = await beginLogin(h);
      const response = device.authenticate(
        { ...CEREMONY, challenge: options.challenge },
        { signCount: 4 },
      );
      await expect(
        h.controller.loginVerify(
          { challengeId, response } as any,
          h.req({ userId: null }),
        ),
      ).rejects.toMatchObject(REFUSED);
      // And the stored counter did NOT move backwards.
      expect(h.passkeys[0].counter).toBe(10n);
    });

    it('an UNKNOWN credential id — the same 401, no enumeration oracle', async () => {
      const { h } = await ready();
      const stranger = softAuthenticator();
      const { options, challengeId } = await beginLogin(h);
      const response = stranger.authenticate({
        ...CEREMONY,
        challenge: options.challenge,
      });
      await expect(
        h.controller.loginVerify(
          { challengeId, response } as any,
          h.req({ userId: null }),
        ),
      ).rejects.toMatchObject(REFUSED);
    });

    it('a TAMPERED signature', async () => {
      const { h, device } = await ready();
      const { options, challengeId } = await beginLogin(h);
      const response: any = device.authenticate({
        ...CEREMONY,
        challenge: options.challenge,
      });
      const sig = Buffer.from(response.response.signature, 'base64url');
      sig[sig.length - 1] ^= 0xff;
      response.response.signature = sig.toString('base64url');
      await expect(
        h.controller.loginVerify(
          { challengeId, response } as any,
          h.req({ userId: null }),
        ),
      ).rejects.toMatchObject(REFUSED);
    });
  });

  describe('THE SAME ELIGIBILITY GATES PASSWORD LOGIN APPLIES', () => {
    /**
     * `validateUser` refuses these four before it ever compares a password.
     * A passkey is a second front door into the same account, so it has to
     * refuse them too — and it does so through the SHARED
     * `login-eligibility.ts`, not a re-implementation that drifts the next
     * time a gate is added.
     */
    async function refusedFor(mutate: (h: Harness) => void) {
      const { h, device } = await ready();
      const { options, challengeId } = await beginLogin(h);
      mutate(h);
      const response = device.authenticate({
        ...CEREMONY,
        challenge: options.challenge,
      });
      await expect(
        h.controller.loginVerify(
          { challengeId, response } as any,
          h.req({ userId: null }),
        ),
      ).rejects.toMatchObject(REFUSED);
      // No session, by any route.
      expect(h.auth.login).not.toHaveBeenCalled();
      return h;
    }

    it('a SOFT-DELETED user gets no session', async () => {
      const h = await refusedFor((h) => {
        h.users.get('user-1')!.deletedAt = new Date('2026-09-01');
      });
      expect(h.auditDetails('PASSKEY_AUTH_FAILED')).toMatchObject({
        reason: 'deleted',
      });
    });

    it('a user of an ARCHIVED tenant gets no session', async () => {
      // ACC-05: archiving used to be display-only, and an admin of a retired
      // location could still fire /emergency/trigger at real screens.
      const h = await refusedFor((h) => {
        h.users.get('user-1')!.tenant = {
          mfaEnforced: true,
          archivedAt: new Date('2026-09-01'),
        };
      });
      expect(h.auditDetails('PASSKEY_AUTH_FAILED')).toMatchObject({
        reason: 'tenant-archived',
      });
    });

    it('a DISABLED user gets no session', async () => {
      const h = await refusedFor((h) => {
        h.users.get('user-1')!.status = 'DISABLED';
      });
      expect(h.auditDetails('PASSKEY_AUTH_FAILED')).toMatchObject({
        reason: 'inactive',
      });
    });

    it('an INVITED user gets no session', async () => {
      await refusedFor((h) => {
        h.users.get('user-1')!.status = 'INVITED';
      });
    });

    it('an SSO-PROVISIONED account gets no session', async () => {
      // On the password path the sentinel hash simply fails argon2. There is
      // no argon2 call here to do that rejecting, so it is explicit.
      const h = await refusedFor((h) => {
        h.users.get('user-1')!.passwordHash = 'clever-sso-no-password';
      });
      expect(h.auditDetails('PASSKEY_AUTH_FAILED')).toMatchObject({
        reason: 'sso-provisioned',
      });
    });
  });

  it('records the client IP from the forwarded chain, not req.ip', async () => {
    const { h, device } = await ready();
    const { options, challengeId } = await beginLogin(h);
    const response = device.authenticate({
      ...CEREMONY,
      challenge: options.challenge,
    });
    const req = h.req({ userId: null });
    // Two trusted appenders (the Railway default): the real client is at
    // len-2, and the attacker-supplied prefix is ignored.
    req.headers['x-forwarded-for'] = '9.9.9.9, 203.0.113.7, 10.0.0.1';
    req.ip = '10.0.0.1';

    await h.controller.loginVerify({ challengeId, response } as any, req);
    expect(h.auditDetails('PASSKEY_LOGIN_SUCCESS')).toMatchObject({
      ip: '203.0.113.7',
    });
  });

  it('NEVER writes a challenge, a signature, a public key or a backup code to the audit log', async () => {
    const { h, device } = await ready();
    const { options, challengeId } = await beginLogin(h);
    const response: any = device.authenticate({
      ...CEREMONY,
      challenge: options.challenge,
    });
    await h.controller.loginVerify(
      { challengeId, response } as any,
      h.req({ userId: null }),
    );

    const serialized = JSON.stringify(h.audits);
    for (const secret of [
      options.challenge,
      response.response.signature,
      response.response.authenticatorData,
      Buffer.from(device.cosePublicKey()).toString('base64url'),
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
