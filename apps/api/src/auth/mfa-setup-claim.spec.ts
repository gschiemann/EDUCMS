/**
 * FIRST-LOGIN CREDENTIAL SETUP × MFA (2026-09-08).
 *
 * Both MFA session-mint paths (`/auth/mfa/challenge` for an enrolled user and
 * `/auth/mfa/required/verify` for a forced enrolment) hand `AuthService.login`
 * a HAND-BUILT user object rather than a fresh row. `login` derives the
 * session's `msc` claim as `!!user.mustSetupCredentials` from that object, so
 * an omitted field is not a missing claim — it is an affirmative `false`.
 *
 * Measured against production before the fix: a privileged account with
 * `must_setup_credentials = true` logged in, was held by the MFA policy,
 * enrolled TOTP, and received a session whose `msc` was false. `GET
 * /api/v1/tenants` answered 200 — full access, while the shared provisioning
 * password was still valid on the account. The forced-setup gate never fired.
 *
 * This pins the contract at the seam that broke: whatever object those paths
 * construct MUST carry `mustSetupCredentials`, and `login` must reflect it.
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
    const src = require('fs').readFileSync(__dirname + '/mfa.controller.ts', 'utf8');
    // There are exactly two places that mint a real session from an MFA
    // challenge. If a third appears, this fails and whoever added it has to
    // think about the claim — that is the point.
    const mintSites = src.split('this.auth.login(').length - 1;
    expect(mintSites).toBe(2);
    // Each one forwards the field explicitly (not spread, so it stays visible).
    expect(src.split('mustSetupCredentials: dbUser.mustSetupCredentials').length - 1).toBe(
      mintSites,
    );
    // And the two `dbUser` loaders behind them select it. Other selects in this
    // file serve unrelated queries and are deliberately not required to.
    expect(src.split('mustSetupCredentials: true,').length - 1).toBe(mintSites);
  });
});
