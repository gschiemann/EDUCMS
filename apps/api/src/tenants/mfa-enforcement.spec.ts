/**
 * The SHARED per-tenant MFA resolver, tested directly.
 *
 * It lives in `@cms/api-types` so the API (authority) and the dashboard
 * (presentation) import the SAME function and cannot disagree about whether an
 * organization enforces two-factor — the same reason `effectiveEmergencyEnabled`
 * next door is shared, and the reason its spec sits here too: this is the
 * suite that actually runs (packages/api-types has no jest project).
 *
 * Greg, 2026-09-11: "i want people to have the options but for my riot
 * accounts, leave it turned on, we will keep that security so just new
 * customers."
 */
import { effectiveMfaEnforced, DEFAULT_MFA_ENFORCED } from '@cms/api-types';

describe('effectiveMfaEnforced — the tri-state column', () => {
  it('true is enforced', () => {
    expect(effectiveMfaEnforced(true)).toBe(true);
  });

  it('false is optional — an explicit opt-out is honoured', () => {
    expect(effectiveMfaEnforced(false)).toBe(false);
  });

  it('null ("never stated") resolves to the NEW-CUSTOMER default: optional', () => {
    expect(effectiveMfaEnforced(null)).toBe(false);
    expect(effectiveMfaEnforced(undefined)).toBe(false);
  });

  it('the default is OPTIONAL, and it is named so a change is one reviewed line', () => {
    // If this constant ever flips, every tenant created since the migration
    // starts enforcing at its members' next sign-in. That is a deliberate
    // product decision, not a tidy-up — the assertion is here to make anyone
    // changing it read the header.
    expect(DEFAULT_MFA_ENFORCED).toBe(false);
  });

  it('EXISTING tenants do not ride the default — the migration backfilled them', () => {
    // The protection for organizations that were enforcing on 2026-09-11 is
    // the `UPDATE tenants SET mfa_enforced = true` in
    // 20260911120000_tenant_mfa_enforced, NOT a branch in this function. So a
    // backfilled row answers `true` here through the ordinary `true` case,
    // and moving the default can never silently disarm it.
    expect(effectiveMfaEnforced(true)).toBe(true);
  });

  it('is pure — same input, same answer, no environment', () => {
    expect(effectiveMfaEnforced(true)).toBe(effectiveMfaEnforced(true));
    expect(effectiveMfaEnforced(null)).toBe(effectiveMfaEnforced(null));
  });
});
