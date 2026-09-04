/**
 * Jest setup for the API suite. Wired via `jest.setupFiles` in
 * apps/api/package.json, so it runs before every spec file.
 *
 * ── SEC-008: the MFA policy must not depend on the wall clock ────────────
 *
 * `evaluateMfaPolicy` blocks a privileged / panic-capable user who has not
 * enrolled, but only AFTER a dated deadline (see mfa-policy.ts). Left to the
 * default, that makes a chunk of this suite a time bomb: every spec that
 * signs a SCHOOL_ADMIN or DISTRICT_ADMIN in and expects an `access_token`
 * passes today and starts failing on 2026-10-04, in CI, with no code change.
 *
 * So the suite pins the STRICTEST posture — full enforcement, no grace —
 * rather than the most convenient one. Two things follow, both deliberate:
 *
 *   1. Every existing spec that logs a privileged identity in had to say
 *      explicitly how it satisfies MFA (enrolled, or a non-privileged role).
 *      That is the point: the assumption is now written down instead of
 *      inherited from a calendar.
 *   2. A NEW spec that logs an admin in without a second factor fails
 *      immediately and loudly here, instead of passing in CI and surprising
 *      the operator in production after the deadline.
 *
 * A spec that needs the grace-window behaviour sets the variable itself
 * (see auth.service.login-policy.spec.ts, which drives both sides of the
 * deadline through the injectable `enforceAfter` option). An explicit value
 * in the environment always wins, so a developer can still run the suite
 * against a different posture on purpose.
 */
process.env.MFA_REQUIRED_ENFORCE_AFTER =
  process.env.MFA_REQUIRED_ENFORCE_AFTER ?? 'now';
