/**
 * FORCED ENROLLMENT WITH A PASSKEY — `/auth/mfa/required/passkey/*`.
 *
 * The lane exists because MFA becomes mandatory for privileged roles on
 * 2026-10-04 and the only escape hatch a blocked account had installed an
 * AUTHENTICATOR APP. That is the thing the operator asked to stop making
 * people install, and 41 non-technical location managers are about to meet it.
 *
 * ── WHAT THIS FILE IS REALLY GUARDING ─────────────────────────────────────
 * The gate on this door runs BACKWARDS: it OPENS when the policy BLOCKS.
 * Every other gate in the product refuses on the blocking side, so the usual
 * intuition about which direction is "safe" is inverted here, and the
 * dangerous mistake is not a refusal — it is an ACCEPTANCE. An account that
 * already holds a second factor is not blocked, so it must never reach this
 * door; if it did, anyone holding its password could mint a partial token and
 * install THEIR OWN credential alongside the owner's. `already has a passkey
 * → REFUSED` is therefore the single most load-bearing case below.
 *
 * Every ceremony here is produced by a real P-256 software authenticator and
 * checked by the real `@simplewebauthn/server` verifier — nothing about the
 * cryptography is stubbed, because "would a forged response be refused?" is
 * the only question worth asking and a mocked verifier cannot answer it.
 */

import { BadRequestException, HttpException } from '@nestjs/common';

import {
  buildHarness,
  makeUser,
  pinAllowedOrigins,
  CEREMONY,
  TEST_PASSWORD,
  type Harness,
} from '../../test/passkey-harness';
import { softAuthenticator } from '../../test/webauthn-test-authenticator';
import { MFA_CHALLENGE_PURPOSE } from './mfa-challenge-token';

jest.setTimeout(60_000);

const MFA_TOKEN = 'r'.repeat(40);
/** Every refusal on this lane that is not a policy refusal looks like this. */
const REFUSED = { response: { code: 'PASSKEY_VERIFICATION_FAILED' } };

let restoreEnv: () => void;
beforeAll(() => {
  restoreEnv = pinAllowedOrigins();
});
afterAll(() => restoreEnv());

/**
 * A harness whose partial `mfaToken` verifies to `user-1`.
 *
 * `makeUser`'s default is deliberately the account this lane serves: a
 * SCHOOL_ADMIN in an enforcing tenant with no factor, which the suite-wide
 * `MFA_REQUIRED_ENFORCE_AFTER=now` makes BLOCKING.
 */
async function harness(overrides: Record<string, unknown> = {}): Promise<Harness> {
  const h = await buildHarness([await makeUser(overrides as any)]);
  h.jwt.verifyAsync.mockResolvedValue({
    sub: 'user-1',
    purpose: MFA_CHALLENGE_PURPOSE,
    rememberMe: true,
  });
  return h;
}

/** Run the whole forced-enrollment ceremony and return the controller's reply. */
async function enrol(
  h: Harness,
  opts: { label?: string; device?: ReturnType<typeof softAuthenticator> } = {},
) {
  const device = opts.device ?? softAuthenticator();
  const { options } = await h.controller.requiredPasskeyOptions(
    { mfaToken: MFA_TOKEN },
    h.req({ userId: null }),
  );
  const response = device.register({ ...CEREMONY, challenge: options.challenge });
  const result: any = await h.controller.requiredPasskeyVerify(
    { mfaToken: MFA_TOKEN, response, label: opts.label } as any,
    h.req({ userId: null }),
  );
  return { result, device, options };
}

// ───────────────────────────────────────────────────────────────────────────
// THE HAPPY PATH
// ───────────────────────────────────────────────────────────────────────────
describe('the way out for a blocked account', () => {
  it('hands back a real session, ten backup codes, and a stored credential', async () => {
    const h = await harness();

    const { result, device } = await enrol(h, { label: 'iPhone' });

    // The session — the thing the policy was withholding.
    expect(result.access_token).toBe('final-jwt');
    // SHOWN ONCE: same key, same length as /auth/mfa/required/verify returns,
    // so the login page's "save your codes → continue" hand-off needs no
    // branch for this lane.
    expect(result.backupCodes).toHaveLength(10);
    expect(new Set(result.backupCodes).size).toBe(10);

    // The credential really landed, with what a later assertion needs.
    expect(h.passkeys).toHaveLength(1);
    expect(h.passkeys[0].credentialId).toBe(device.credentialId);
    expect(Buffer.from(h.passkeys[0].publicKey)).toEqual(
      Buffer.from(device.cosePublicKey()),
    );
    expect(h.passkeys[0].deviceLabel).toBe('iPhone');
    expect(h.passkeys[0].userId).toBe('user-1');

    // …and so did the codes, on the SAME account, in the same call.
    const stored = h.users.get('user-1')!.mfaBackupCodes as unknown[];
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toHaveLength(10);
    // Hashes at rest, never the plaintext the operator is looking at.
    for (const code of result.backupCodes) {
      expect(JSON.stringify(stored)).not.toContain(code);
    }
  });

  it('mints the ceremony with the parameters that make a passkey a SECOND factor', async () => {
    const h = await harness();
    const { options } = await h.controller.requiredPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req({ userId: null }),
    );

    expect(options.rp).toEqual({ id: CEREMONY.rpID, name: 'VenueOS' });
    expect(options.attestation).toBe('none');
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: 'preferred',
      // Without this the credential proves possession only — and possession
      // alone is exactly what the policy blocking this account rejects.
      userVerification: 'required',
    });
    // ES256 (-7), EdDSA (-8), RS256 (-257). Numeric sort: the default
    // Array#sort is lexicographic and would put -7 before -8.
    expect(options.pubKeyCredParams.map((p: any) => p.alg).sort((a: number, b: number) => a - b))
      .toEqual([-257, -8, -7]);
    expect(options.user.name).toBe('operator@example.test');
  });

  it('writes BOTH rows in one transaction — a credential without codes is the lockout', async () => {
    const h = await harness();
    await enrol(h);
    // The interactive form, not two loose awaits. The double cannot prove
    // Postgres would roll back, but it can prove the call site asks for it.
    expect((h as any).controller.prisma.client.$transaction).toHaveBeenCalled();
  });

  it('the codes it issued actually work at the EXISTING /auth/mfa/challenge door', async () => {
    // The end of the recovery path, walked rather than assumed. A set of
    // codes minted by a different issuer, or written to a column the verifier
    // does not read, would pass every assertion above and still leave a lost
    // phone as a permanently closed account.
    const h = await harness();
    const { result } = await enrol(h);

    const session: any = await h.mfa.challenge({
      mfaToken: MFA_TOKEN,
      backupCode: result.backupCodes[3],
    } as any);
    expect(session.access_token).toBe('final-jwt');

    // Single-use: the same code is refused the second time.
    await expect(
      h.mfa.challenge({ mfaToken: MFA_TOKEN, backupCode: result.backupCodes[3] } as any),
    ).rejects.toMatchObject({ response: { code: 'MFA_INVALID_CODE' } });
    expect((h.users.get('user-1')!.mfaBackupCodes as unknown[])).toHaveLength(9);
  });

  it('honours rememberMe from the token and tells login the factor is already proven', async () => {
    const h = await harness();
    await enrol(h);

    const [passed, rememberMe, opts] = h.auth.login.mock.calls[0];
    expect(rememberMe).toBe(true);
    // Without this the just-enrolled passkey would make login() re-derive a
    // requirement and issue another challenge — the enrol→challenge→enrol
    // loop `auth.service.ts` calls its most dangerous edge.
    expect(opts).toEqual({ mfaAlreadySatisfied: true });
    // The hand-built object carries no mfa* fields, same as every other lane.
    expect(passed.mfaTotpVerifiedAt).toBeUndefined();
    expect(passed.mfaRequired).toBeUndefined();
  });

  it('audits the registration as policy-driven, and leaks nothing about the credential', async () => {
    const h = await harness();
    const { result } = await enrol(h, { label: 'Windows PC' });

    expect(h.auditActions()).toContain('PASSKEY_REGISTERED');
    const details = h.auditDetails('PASSKEY_REGISTERED')!;
    expect(details.stage).toBe('required_enrollment');
    expect(details.label).toBe('Windows PC');
    expect(details.backupCodesIssued).toBe(10);

    // A challenge, a signature, a public key or a backup code in the audit
    // trail would turn an append-only forensic log into a credential store.
    const everything = JSON.stringify(h.audits);
    for (const code of result.backupCodes) expect(everything).not.toContain(code);
    expect(everything).not.toContain(
      Buffer.from(h.passkeys[0].publicKey).toString('base64url'),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE GATE — the door opens ONLY for an account the policy is blocking
// ───────────────────────────────────────────────────────────────────────────
describe('the gate', () => {
  it('REFUSES an account that already has a PASSKEY — the takeover case', async () => {
    // ⚠️ THE ONE THAT MATTERS MOST. Such an account is not blocked at all:
    // login offers it a passkey challenge. If this door opened for it, the
    // partial token — which anyone holding the password can mint — would buy
    // an ATTACKER'S OWN credential on someone else's account, with user
    // verification satisfied by the attacker's own face or PIN.
    const h = await harness();
    await enrol(h); // the owner's passkey
    expect(h.passkeys).toHaveLength(1);

    await expect(
      h.controller.requiredPasskeyOptions({ mfaToken: MFA_TOKEN }, h.req({ userId: null })),
    ).rejects.toMatchObject({ response: { code: 'MFA_ALREADY_ENABLED' } });

    // And the verify half independently, because a caller that kept an old
    // options response must not be able to walk past the options refusal.
    const attacker = softAuthenticator();
    await expect(
      h.controller.requiredPasskeyVerify(
        {
          mfaToken: MFA_TOKEN,
          response: attacker.register({ ...CEREMONY, challenge: 'anything' }),
        } as any,
        h.req({ userId: null }),
      ),
    ).rejects.toMatchObject({ response: { code: 'MFA_ALREADY_ENABLED' } });

    // Nothing was added, and the owner's credential is untouched.
    expect(h.passkeys).toHaveLength(1);
    expect(h.passkeys[0].credentialId).not.toBe(attacker.credentialId);
  });

  it('REFUSES an account with a verified AUTHENTICATOR APP', async () => {
    // Same argument: it holds a factor, so it is not held back, so it has no
    // business at an unauthenticated door. It can add a passkey from Settings
    // with a real session and a password re-auth.
    const h = await harness({ mfaTotpVerifiedAt: new Date('2026-09-01') });
    await expect(
      h.controller.requiredPasskeyOptions({ mfaToken: MFA_TOKEN }, h.req({ userId: null })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.passkeys).toHaveLength(0);
  });

  it('REFUSES an account the policy does not block — this is not a general enrollment route', async () => {
    const h = await harness({
      role: 'CONTRIBUTOR',
      canTriggerPanic: false,
      mfaRequired: false,
    });
    await expect(
      h.controller.requiredPasskeyOptions({ mfaToken: MFA_TOKEN }, h.req({ userId: null })),
    ).rejects.toMatchObject({ response: { code: 'MFA_NOT_REQUIRED' } });
  });

  it('OPENS for exactly the identities the TOTP door opens for', async () => {
    // LOCKSTEP. Both doors call one `assertEnrollmentRequired`, and this
    // proves the passkey door did not acquire its own opinion. A divergence
    // is not cosmetic: on the strict side it is a bricked account, because
    // login refuses the session while the door refuses the enrollment.
    const cases: Array<[string, Record<string, unknown>, boolean]> = [
      ['SUPER_ADMIN', { role: 'SUPER_ADMIN' }, true],
      ['DISTRICT_ADMIN', { role: 'DISTRICT_ADMIN' }, true],
      ['panic-capable CONTRIBUTOR', { role: 'CONTRIBUTOR', canTriggerPanic: true }, true],
      ['per-user override', { role: 'CONTRIBUTOR', mfaRequired: true }, true],
      ['plain CONTRIBUTOR', { role: 'CONTRIBUTOR' }, false],
      ['RESTRICTED_VIEWER', { role: 'RESTRICTED_VIEWER' }, false],
      [
        'admin in an opted-out organization',
        { role: 'SUPER_ADMIN', tenant: { mfaEnforced: false, archivedAt: null } },
        false,
      ],
      [
        'admin whose tenant row is unreadable (fails CLOSED, matching login)',
        { role: 'SCHOOL_ADMIN', tenant: null },
        true,
      ],
    ];

    for (const [name, row, shouldOpen] of cases) {
      const h = await harness(row);
      const open = await h.controller
        .requiredPasskeyOptions({ mfaToken: MFA_TOKEN }, h.req({ userId: null }))
        .then((r: any) => typeof r?.options?.challenge === 'string')
        .catch((e) => {
          if (e instanceof BadRequestException) return false;
          throw e;
        });
      expect(`${name}: ${open}`).toBe(`${name}: ${shouldOpen}`);
    }
  });

  it('REFUSES an invalid, expired or wrong-purpose partial token', async () => {
    const h = await harness();

    h.jwt.verifyAsync.mockRejectedValueOnce(new Error('bad signature'));
    await expect(
      h.controller.requiredPasskeyOptions({ mfaToken: MFA_TOKEN }, h.req({ userId: null })),
    ).rejects.toMatchObject({ response: { code: 'MFA_TOKEN_INVALID' } });

    // A normal ACCESS token has no `purpose` claim. That is what stops a
    // stolen session from being traded for a permanent credential here.
    h.jwt.verifyAsync.mockResolvedValueOnce({ sub: 'user-1' });
    await expect(
      h.controller.requiredPasskeyOptions({ mfaToken: MFA_TOKEN }, h.req({ userId: null })),
    ).rejects.toMatchObject({ response: { code: 'MFA_TOKEN_INVALID' } });

    h.jwt.verifyAsync.mockResolvedValueOnce({ sub: 'user-1', purpose: 'password-reset' });
    await expect(
      h.controller.requiredPasskeyVerify(
        { mfaToken: MFA_TOKEN, response: softAuthenticator().register({ ...CEREMONY, challenge: 'x' }) } as any,
        h.req({ userId: null }),
      ),
    ).rejects.toMatchObject({ response: { code: 'MFA_TOKEN_INVALID' } });

    expect(h.passkeys).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ELIGIBILITY — the gates the password door applies, re-applied here
// ───────────────────────────────────────────────────────────────────────────
describe('login eligibility is re-graded before anything is minted', () => {
  // The partial token is minted at the password check and lives minutes. An
  // account disabled — or a tenant archived — inside that window must not be
  // able to finish. Every one answers the SAME opaque refusal, because
  // "your account is disabled" on an unauthenticated endpoint is an oracle.
  const ineligible: Array<[string, Record<string, unknown>]> = [
    ['soft-deleted', { deletedAt: new Date('2026-09-01') }],
    ['disabled', { status: 'DISABLED' }],
    ['still INVITED', { status: 'INVITED' }],
    ['tenant archived', { tenant: { mfaEnforced: true, archivedAt: new Date('2026-09-01') } }],
  ];

  it.each(ineligible)('refuses a %s account at options', async (_name, row) => {
    const h = await harness(row);
    await expect(
      h.controller.requiredPasskeyOptions({ mfaToken: MFA_TOKEN }, h.req({ userId: null })),
    ).rejects.toMatchObject(REFUSED);
    expect(h.passkeys).toHaveLength(0);
  });

  it.each(ineligible)('refuses a %s account at verify, mid-ceremony', async (_name, row) => {
    // The realistic shape: the account was fine when the options were issued
    // and was revoked while the operator was touching their sensor.
    const h = await harness();
    const { options } = await h.controller.requiredPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req({ userId: null }),
    );
    Object.assign(h.users.get('user-1')!, row);

    const device = softAuthenticator();
    await expect(
      h.controller.requiredPasskeyVerify(
        {
          mfaToken: MFA_TOKEN,
          response: device.register({ ...CEREMONY, challenge: options.challenge }),
        } as any,
        h.req({ userId: null }),
      ),
    ).rejects.toMatchObject(REFUSED);
    expect(h.passkeys).toHaveLength(0);
    expect(h.auth.login).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE CRYPTOGRAPHY — real forgeries, refused for real reasons
// ───────────────────────────────────────────────────────────────────────────
describe('a response that is not what this ceremony asked for', () => {
  /** Issue options, let `make` build a response against them, expect 401. */
  async function refuses(
    make: (challenge: string, device: ReturnType<typeof softAuthenticator>) => any,
  ) {
    const h = await harness();
    const device = softAuthenticator();
    const { options } = await h.controller.requiredPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req({ userId: null }),
    );
    await expect(
      h.controller.requiredPasskeyVerify(
        { mfaToken: MFA_TOKEN, response: make(options.challenge, device) } as any,
        h.req({ userId: null }),
      ),
    ).rejects.toMatchObject(REFUSED);
    expect(h.passkeys).toHaveLength(0);
    // Nothing partial was written: no codes either.
    expect(h.users.get('user-1')!.mfaBackupCodes).toBeNull();
    return h;
  }

  it('refuses a response signed for a DIFFERENT ORIGIN', async () => {
    // The phishing case. A page on evil.example collects a real ceremony and
    // relays it here; the origin is inside the signed clientDataJSON.
    await refuses((challenge, device) =>
      device.register({ ...CEREMONY, challenge }, { origin: 'https://evil.example' }),
    );
  });

  it('refuses a response signed for a DIFFERENT rpID', async () => {
    await refuses((challenge, device) =>
      device.register({ ...CEREMONY, challenge }, { rpID: 'evil.example' }),
    );
  });

  it('refuses a response with USER VERIFICATION not performed', async () => {
    // Possession without a biometric or PIN is one factor, and this account
    // is here precisely because one factor is not enough for it.
    await refuses((challenge, device) =>
      device.register({ ...CEREMONY, challenge }, { userVerified: false }),
    );
  });

  it('refuses a response signed over somebody else’s challenge', async () => {
    await refuses((_challenge, device) =>
      device.register({ ...CEREMONY, challenge: 'bm90LXRoZS1jaGFsbGVuZ2U' }),
    );
  });

  it('refuses a REPLAY — the challenge is spent by the first presentation', async () => {
    const h = await harness();
    const device = softAuthenticator();
    const { options } = await h.controller.requiredPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req({ userId: null }),
    );
    const response = device.register({ ...CEREMONY, challenge: options.challenge });

    await h.controller.requiredPasskeyVerify(
      { mfaToken: MFA_TOKEN, response } as any,
      h.req({ userId: null }),
    );
    // Second presentation of the identical bytes. It fails at the gate now
    // (the account has a factor) — but even with the gate removed the
    // challenge is gone, which the next case proves in isolation.
    await expect(
      h.controller.requiredPasskeyVerify(
        { mfaToken: MFA_TOKEN, response } as any,
        h.req({ userId: null }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(h.passkeys).toHaveLength(1);
  });

  it('a FAILED verify still spends the challenge — no unlimited retries against one', async () => {
    const h = await harness();
    const device = softAuthenticator();
    const { options } = await h.controller.requiredPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req({ userId: null }),
    );
    // Burn the challenge on a forgery…
    await expect(
      h.controller.requiredPasskeyVerify(
        {
          mfaToken: MFA_TOKEN,
          response: device.register({ ...CEREMONY, challenge: options.challenge }, { userVerified: false }),
        } as any,
        h.req({ userId: null }),
      ),
    ).rejects.toMatchObject(REFUSED);
    // …then present a PERFECT response for the same challenge. It must fail,
    // because the record was destroyed on read, not on success.
    await expect(
      h.controller.requiredPasskeyVerify(
        {
          mfaToken: MFA_TOKEN,
          response: device.register({ ...CEREMONY, challenge: options.challenge }),
        } as any,
        h.req({ userId: null }),
      ),
    ).rejects.toMatchObject(REFUSED);
    expect(h.passkeys).toHaveLength(0);
  });

  it('a forced-enrollment challenge is NOT spendable at the signed-in register door', async () => {
    // `reg-required` and `reg` are separate purposes on purpose: one is
    // minted behind a session AND a password, the other at an
    // unauthenticated door. Sharing a key would let the weaker door's
    // challenge be spent at the stronger one.
    const h = await harness();
    const device = softAuthenticator();
    const { options } = await h.controller.requiredPasskeyOptions(
      { mfaToken: MFA_TOKEN },
      h.req({ userId: null }),
    );
    await expect(
      h.controller.registerVerify(
        { response: device.register({ ...CEREMONY, challenge: options.challenge }) } as any,
        h.req({ userId: 'user-1' }),
      ),
    ).rejects.toMatchObject(REFUSED);
  });

  it('refuses a ceremony started from an origin this deploy does not serve', async () => {
    const h = await harness();
    await expect(
      h.controller.requiredPasskeyOptions(
        { mfaToken: MFA_TOKEN },
        h.req({ userId: null, origin: 'https://evil.example' }),
      ),
    ).rejects.toMatchObject({ response: { code: 'PASSKEY_ORIGIN_NOT_ALLOWED' } });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// RATE LIMITING — the same budget a TOTP attempt spends
// ───────────────────────────────────────────────────────────────────────────
describe('rate limiting', () => {
  it('failures count against the SHARED per-user MFA budget', async () => {
    // A second-factor lane with its own separate allowance is simply the
    // cheaper one to hammer.
    const h = await harness();
    const bogus = softAuthenticator().register({ ...CEREMONY, challenge: 'x' });

    for (let i = 0; i < 5; i++) {
      await expect(
        h.controller.requiredPasskeyVerify(
          { mfaToken: MFA_TOKEN, response: bogus } as any,
          h.req({ userId: null }),
        ),
      ).rejects.toMatchObject(REFUSED);
    }
    await expect(
      h.controller.requiredPasskeyVerify(
        { mfaToken: MFA_TOKEN, response: bogus } as any,
        h.req({ userId: null }),
      ),
    ).rejects.toMatchObject({ response: { code: 'MFA_LOCKED_OUT' } });

    // …and the TOTP door sees the same lockout, because it is one budget.
    await expect(
      h.mfa.challenge({ mfaToken: MFA_TOKEN, backupCode: 'AAAA-BBBB' } as any),
    ).rejects.toMatchObject({ response: { code: 'MFA_LOCKED_OUT' } });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// FIRST-LOGIN CREDENTIAL SETUP
// ───────────────────────────────────────────────────────────────────────────
describe('the msc claim survives this lane', () => {
  it('an account that still owes a credential claim gets msc: TRUE', async () => {
    // The 2026-09-08 production bug, on the newest lane. A privileged account
    // provisioned with a shared password is BOTH policy-blocked and
    // `mustSetupCredentials`, so this lane is exactly where those two meet —
    // and `AuthService.login` derives the claim from the hand-built object it
    // is given, never from a fresh read. An omitted field is not a missing
    // claim; it is an affirmative `false`.
    const h = await harness({ mustSetupCredentials: true });
    // Mirrors `auth.service.ts` ("msc: !!user.mustSetupCredentials") so the
    // assertion is about a CLAIM, not about an argument.
    h.auth.login.mockImplementation(async (user: any) => ({
      access_token: 'final-jwt',
      msc: !!user.mustSetupCredentials,
      user: { id: user.id },
    }));

    const { result } = await enrol(h);

    expect(result.msc).toBe(true);
    // And the seam itself: the object handed to login carries the field.
    expect(h.auth.login.mock.calls[0][0].mustSetupCredentials).toBe(true);
    // It is still a completed enrollment — the constrained session is the
    // point, not a refusal.
    expect(result.backupCodes).toHaveLength(10);
  });

  it('an account that has claimed its credentials gets msc: FALSE', async () => {
    const h = await harness({ mustSetupCredentials: false });
    h.auth.login.mockImplementation(async (user: any) => ({
      access_token: 'final-jwt',
      msc: !!user.mustSetupCredentials,
      user: { id: user.id },
    }));

    const { result } = await enrol(h);

    expect(result.msc).toBe(false);
    // Explicitly present and false — not absent, which is the shape that
    // made the bug invisible.
    expect(h.auth.login.mock.calls[0][0]).toHaveProperty('mustSetupCredentials', false);
  });
});
