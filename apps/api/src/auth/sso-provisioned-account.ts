/**
 * The placeholder `passwordHash` written for accounts that are provisioned by
 * an external identity source and have NO password of their own.
 *
 * Today that is the Clever roster sync (`clever.service.ts` `syncTenant`),
 * which creates local `User` rows from a district's Clever roster.
 *
 * ── WHY THIS IS A SHARED CONSTANT ─────────────────────────────────────────
 * CLV-02/CLV-03 (2026-09-02). The value is not just a marker — it is load
 * bearing in TWO places that must agree exactly:
 *
 *   • the WRITER (Clever sync) relies on it not being a valid PHC string, so
 *     argon2 rejects every password-login attempt against such an account;
 *   • the READER (`onboarding.service.requestPasswordReset`) refuses to mint
 *     a reset token for one, because otherwise the "blocks password login"
 *     claim is false: a rogue or compromised connected Clever district can
 *     provision a DISTRICT_ADMIN at an address it controls and then simply
 *     SET a password on it via the public password-reset flow, turning a
 *     roster feed into a standing admin credential.
 *
 * A typo in either copy silently re-opens that path, which is exactly why the
 * literal lives here and nowhere else.
 *
 * If a future feature needs to let such an account adopt a password, that has
 * to be a deliberate, audited "convert to password account" action — not a
 * side effect of the unauthenticated reset endpoint.
 */
export const SSO_PROVISIONED_NO_PASSWORD_HASH = 'clever-sso-no-password';

/** True when this account has no password of its own and never should. */
export function isSsoProvisionedNoPassword(passwordHash: string | null | undefined): boolean {
  return passwordHash === SSO_PROVISIONED_NO_PASSWORD_HASH;
}
