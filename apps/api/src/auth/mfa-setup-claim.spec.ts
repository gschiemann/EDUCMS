/**
 * FIRST-LOGIN CREDENTIAL SETUP × MFA (2026-09-08, widened 2026-09-21).
 *
 * Every MFA session-mint path hands `AuthService.login` a HAND-BUILT user
 * object rather than a fresh row. `login` derives the session's `msc` claim as
 * `!!user.mustSetupCredentials` from that object, so an omitted field is not a
 * missing claim — it is an affirmative `false`.
 *
 * Measured against production before the fix: a privileged account with
 * `must_setup_credentials = true` logged in, was held by the MFA policy,
 * enrolled TOTP, and received a session whose `msc` was false. `GET
 * /api/v1/tenants` answered 200 — full access, while the shared provisioning
 * password was still valid on the account. The forced-setup gate never fired.
 *
 * This pins the contract at the seam that broke: whatever object those paths
 * construct MUST carry `mustSetupCredentials`, and `login` must reflect it.
 *
 * ── WHY IT NOW READS TWO FILES ────────────────────────────────────────────
 * It counted mint sites in `mfa.controller.ts` alone, which was the whole
 * story in September. It is not any more: `passkey.controller.ts` mints a
 * session for the passkey second factor, for passwordless sign-in, and (since
 * 2026-09-21) for forced enrollment WITH a passkey — the same
 * policy-blocked, `mustSetupCredentials`-carrying account that produced the
 * original bug, arriving through a different controller. A gate that only
 * watched the old file would have said nothing.
 */
describe('MFA session mint preserves the setup-required claim', () => {
  const claimFor = (user: any) => ({ msc: !!user.mustSetupCredentials });

  it('stamps msc=true when the account still owes a credential claim', () => {
    expect(claimFor({ id: 'u1', mustSetupCredentials: true }).msc).toBe(true);
  });

  it('stamps msc=false once the account has claimed its credentials', () => {
    expect(claimFor({ id: 'u1', mustSetupCredentials: false }).msc).toBe(false);
  });

  it('THE BUG: an omitted field must never be read as "setup complete"', () => {
    // This is the shape both MFA paths used to build. `!!undefined` is false,
    // which is indistinguishable from a genuinely-claimed account.
    const handBuilt: any = { id: 'u1', email: 'a@b.c', role: 'DISTRICT_ADMIN' };
    expect(handBuilt.mustSetupCredentials).toBeUndefined();
    expect(claimFor(handBuilt).msc).toBe(false); // documents WHY omission is unsafe
  });

  it('every MFA mint site forwards the field, and the rows feeding them load it', () => {
    const read = (f: string) =>
      require('fs').readFileSync(__dirname + '/' + f, 'utf8') as string;
    const count = (src: string, needle: string) => src.split(needle).length - 1;

    const mfaSrc = read('mfa.controller.ts');
    const passkeySrc = read('passkey.controller.ts');

    // THREE places in the codebase mint a real session off a proven second
    // factor: /auth/mfa/challenge and /auth/mfa/required/verify (TOTP), and
    // PasskeyController.finalizeLogin, which every passkey lane funnels
    // through. If a fourth appears, this fails and whoever added it has to
    // think about the claim — that is the point.
    const mfaMintSites = count(mfaSrc, 'this.auth.login(');
    const passkeyMintSites = count(passkeySrc, 'this.auth.login(');
    expect(mfaMintSites).toBe(2);
    expect(passkeyMintSites).toBe(1);
    expect(mfaMintSites + passkeyMintSites).toBe(3);

    // Each one forwards the field explicitly (not spread, so it stays visible
    // at the call site where the bug was).
    expect(count(mfaSrc, 'mustSetupCredentials: dbUser.mustSetupCredentials')).toBe(
      mfaMintSites,
    );
    expect(count(passkeySrc, 'mustSetupCredentials: user.mustSetupCredentials')).toBe(
      passkeyMintSites,
    );

    // And every loader behind them SELECTS it. The counts differ because
    // `finalizeLogin` is one mint site fed by three separate queries — the
    // MFA-challenge lane, the passwordless lane, and (2026-09-21) the
    // forced-enrollment lane in `requiredEnrollmentUser`. A new lane that
    // forgets the column would reach the shared, correct-looking
    // `finalizeLogin` carrying `undefined`, which is exactly the shape that
    // shipped the production bypass.
    expect(count(mfaSrc, 'mustSetupCredentials: true,')).toBe(2);
    expect(count(passkeySrc, 'mustSetupCredentials: true,')).toBe(3);
  });

  it('the forced-enrollment PASSKEY lane loads the column in its own select', () => {
    // Named on its own because it is the lane whose account is, by
    // definition, the one the original bug was measured on: policy-blocked,
    // no factor yet, and quite possibly still owing a credential claim from
    // provisioning. The generic count above would stay green if this lane's
    // select were dropped and some other query gained one.
    const src = require('fs').readFileSync(
      __dirname + '/passkey.controller.ts',
      'utf8',
    ) as string;
    const loader = src.slice(src.indexOf('private async requiredEnrollmentUser('));
    expect(loader).toContain('private async requiredEnrollmentUser(');
    // Bound the window to this method so a neighbouring select cannot satisfy it.
    const body = loader.slice(0, loader.indexOf('private requireUserId('));
    expect(body).toContain('mustSetupCredentials: true,');
    // The other two keys the gate is typed to require, in the same window.
    expect(body).toContain('_count: { select: { passkeys: true } }');
    expect(body).toContain('tenant: { select: { mfaEnforced: true, archivedAt: true } }');
  });
});
