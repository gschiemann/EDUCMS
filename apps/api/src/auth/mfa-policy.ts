/**
 * SEC-008 — WHO MUST HOLD A SECOND FACTOR.
 *
 * THE HOLE the 2026-09-04 independent assessment found: TOTP, encrypted
 * secrets, backup codes, partial challenge tokens and a complete forced-
 * enrollment flow were all built and tested — and then nothing ever turned
 * them on. `User.mfaRequired` defaults to false and the only writer is an
 * admin toggling one account at a time. So on a multi-tenant LIFE-SAFETY
 * platform, a stolen or reused password was, by itself, enough to reach
 * `/emergency/trigger` and put a lockdown message on every screen in a
 * district. Optional MFA on a panic-capable identity is not a policy.
 *
 * THIS FILE IS THE POLICY, and it is the ONLY place that decides. Nothing
 * else in the codebase may re-derive "is MFA required" — a second copy is
 * how `mfaRequired` and its enforcement drifted apart in the first place
 * (ACC-03, 2026-08-01). Three call sites consume it, and they must agree
 * or the policy becomes a LOCKOUT rather than a control:
 *
 *   1. `AuthService.login`         — withholds the full session.
 *   2. `MfaController.assertEnrollmentRequired` — lets the held-back user
 *      ENROL without a session (the escape hatch). If this disagreed with
 *      (1), a privileged user would be refused a session at login AND
 *      refused enrollment at `/auth/mfa/required/enroll`. That is a bricked
 *      account, which is exactly why they share this module.
 *   3. `AuthService.refreshSession` — refuses to EXTEND a non-compliant
 *      privileged session, so the pre-existing 12h/30d sessions drain
 *      instead of riding past the deadline.
 *
 * ── WHY DERIVED, NOT BACKFILLED ────────────────────────────────────────
 * The obvious fix is `UPDATE users SET mfa_required = true WHERE role IN
 * (...)`. That is a POINT-IN-TIME fact: a CONTRIBUTOR promoted to
 * DISTRICT_ADMIN tomorrow, or granted `canTriggerPanic` next week, silently
 * escapes it, and every future provisioning path has to remember to set the
 * column. Deriving the requirement from the live row at every session mint
 * closes that class permanently and needs no migration (V1 rule: additive-
 * only — and no migration at all beats an additive one). `mfaRequired`
 * keeps its existing meaning as an ADDITIVE per-user override: an admin can
 * still force MFA onto a CONTRIBUTOR, and that override stays IMMEDIATELY
 * blocking with no grace, because weakening it would be a regression on a
 * control that already shipped.
 *
 * ── THE GRACE WINDOW ───────────────────────────────────────────────────
 * Flipping this on with no runway would meet every live admin — including
 * the operator, mid-demo — with "enrol now or you're not getting in". So
 * the derived requirement is ADVISORY until an absolute deadline and
 * BLOCKING after it. The deadline is a dated constant in this file, not an
 * env default, so the policy self-activates on a deploy that never sets a
 * variable; `MFA_REQUIRED_ENFORCE_AFTER` only moves it. There is no
 * "forever grace" state that a forgotten env var can produce.
 *
 * During grace the login response carries an `mfaPolicy` block naming the
 * deadline, which is additive — no existing client field changes.
 */

import { AppRole } from '@cms/database';

/**
 * Roles that hold administrative authority over screens, users, branding,
 * billing or emergency configuration. RESTRICTED_VIEWER and CONTRIBUTOR are
 * deliberately absent: they cannot change who can do what, and sweeping a
 * whole district's content staff into mandatory TOTP is the kind of
 * unrequested friction that gets a security control switched off.
 * A CONTRIBUTOR who holds `canTriggerPanic` is covered by the capability
 * rule below, not by their role.
 */
export const MFA_REQUIRED_ROLES: readonly string[] = Object.freeze([
  AppRole.SUPER_ADMIN,
  AppRole.DISTRICT_ADMIN,
  AppRole.SCHOOL_ADMIN,
]);

/**
 * The built-in enforcement deadline: 30 days after the SEC-008 fix landed
 * (2026-09-04). Chosen so a district that logs in weekly still meets the
 * banner several times before it bites, and so the operator can enrol on
 * his own schedule rather than at a login prompt during a customer demo.
 *
 * This is a CONSTANT, not an env default, on purpose — see the header. To
 * change it for a deployment, set `MFA_REQUIRED_ENFORCE_AFTER`.
 */
export const MFA_POLICY_DEFAULT_ENFORCE_AFTER = '2026-10-04T00:00:00.000Z';

/** Env var that overrides {@link MFA_POLICY_DEFAULT_ENFORCE_AFTER}. */
export const MFA_POLICY_ENV_VAR = 'MFA_REQUIRED_ENFORCE_AFTER';

/** Accepted spellings for "enforce from this instant onward, no grace". */
const IMMEDIATE_TOKENS = new Set(['now', 'immediate', 'immediately', 'always']);

/**
 * Accepted spellings for the BREAK-GLASS: derived (role/panic) enforcement
 * off platform-wide. Documented in CLAUDE.md and in the SEC-008 report.
 * An explicit per-user `mfaRequired` is NOT affected — break-glass removes
 * the new derived policy, never an operator's deliberate per-account
 * decision. (Same shape as the `PLAYER_APK_QUARANTINE` rule: a kill switch
 * may only ever SUBTRACT the thing this change added.)
 */
const DISABLED_TOKENS = new Set(['off', 'false', '0', 'never', 'disabled', 'no']);

export type MfaPolicyReason = 'privileged-role' | 'panic-capable' | 'per-user-override';

/** The fields the policy reads. Any live `User` row satisfies this. */
export interface MfaPolicySubject {
  role?: string | null;
  canTriggerPanic?: boolean | null;
  mfaRequired?: boolean | null;
  mfaTotpVerifiedAt?: Date | string | null;
}

export interface MfaPolicyDecision {
  /** Policy says this identity ought to hold a second factor. */
  required: boolean;
  /** Why — surfaced in the audit row, never in the HTTP response. */
  reasons: MfaPolicyReason[];
  /** TOTP enrollment is complete (`mfaTotpVerifiedAt` is set). */
  enrolled: boolean;
  /**
   * Enrollment is BLOCKING right now: no full session until it is done.
   * True when `required && !enrolled` AND (the per-user override is set OR
   * the enforcement deadline has passed).
   */
  blocking: boolean;
  /**
   * ISO instant after which the DERIVED requirement blocks. `null` when
   * break-glass has disabled derived enforcement.
   */
  enforceAfter: string | null;
  /**
   * Nag now, block later: the requirement stands, the user has not enrolled,
   * and a deadline EXISTS that has not yet arrived. Deliberately false under
   * break-glass — with no deadline there is nothing to count down to, and a
   * banner reading "required by null" is worse than no banner.
   */
  inGrace: boolean;
}

let warnedBreakGlass = false;

/**
 * Resolve the enforcement instant. Returns `null` for break-glass.
 *
 * An UNPARSEABLE value falls back to the built-in deadline rather than to
 * "off": a typo in an env var must never silently downgrade the security
 * posture of a life-safety platform. That is the same fail-safe direction
 * `TRUSTED_PROXY_HOPS` takes on a bad value.
 */
export function resolveMfaEnforceAfter(
  raw: string | undefined = process.env[MFA_POLICY_ENV_VAR],
): Date | null {
  const value = (raw ?? '').trim();
  if (!value) return new Date(MFA_POLICY_DEFAULT_ENFORCE_AFTER);

  const lowered = value.toLowerCase();
  if (IMMEDIATE_TOKENS.has(lowered)) return new Date(0);
  if (DISABLED_TOKENS.has(lowered)) {
    if (!warnedBreakGlass) {
      warnedBreakGlass = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[mfa-policy] BREAK-GLASS ACTIVE: ${MFA_POLICY_ENV_VAR}="${value}" disables required MFA ` +
          'for privileged and panic-capable accounts. Admin passwords are now a SINGLE factor for ' +
          'emergency control. Unset this variable to restore the policy.',
      );
    }
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    // eslint-disable-next-line no-console
    console.warn(
      `[mfa-policy] ${MFA_POLICY_ENV_VAR}="${value}" is not an ISO-8601 instant — ` +
        `falling back to the built-in deadline ${MFA_POLICY_DEFAULT_ENFORCE_AFTER}.`,
    );
    return new Date(MFA_POLICY_DEFAULT_ENFORCE_AFTER);
  }
  return parsed;
}

/** Test seam: forget that the break-glass warning was already printed. */
export function __resetMfaPolicyWarningForTests(): void {
  warnedBreakGlass = false;
}

/**
 * The whole policy, in one pure function. `now` and `enforceAfter` are
 * injectable so tests never depend on the wall clock or the environment.
 */
export function evaluateMfaPolicy(
  subject: MfaPolicySubject | null | undefined,
  opts: { now?: Date; enforceAfter?: Date | null } = {},
): MfaPolicyDecision {
  const now = opts.now ?? new Date();
  const enforceAfter =
    opts.enforceAfter !== undefined ? opts.enforceAfter : resolveMfaEnforceAfter();

  const role = subject?.role ?? null;
  const reasons: MfaPolicyReason[] = [];

  // The per-user override first — it is the operator's own explicit
  // decision and it is the one reason that does NOT get a grace window.
  const perUserOverride = subject?.mfaRequired === true;
  if (perUserOverride) reasons.push('per-user-override');

  const derived =
    (typeof role === 'string' && MFA_REQUIRED_ROLES.includes(role)) ||
    subject?.canTriggerPanic === true;
  if (typeof role === 'string' && MFA_REQUIRED_ROLES.includes(role)) {
    reasons.push('privileged-role');
  }
  if (subject?.canTriggerPanic === true) reasons.push('panic-capable');

  const enrolled = !!subject?.mfaTotpVerifiedAt;
  const required = perUserOverride || derived;

  // Break-glass removes ONLY the derived requirement.
  const derivedBlocking =
    derived && enforceAfter !== null && now.getTime() >= enforceAfter.getTime();
  const blocking = !enrolled && (perUserOverride || derivedBlocking);

  return {
    required,
    reasons,
    enrolled,
    blocking,
    enforceAfter: enforceAfter ? enforceAfter.toISOString() : null,
    inGrace: required && !enrolled && !blocking && enforceAfter !== null,
  };
}

/**
 * The additive `mfaPolicy` block attached to a FULL session response while a
 * privileged user is still inside the grace window. Purely informational —
 * it exists so the dashboard can nag with a real date instead of "soon".
 * Returns `undefined` when there is nothing to say, so the response shape is
 * unchanged for everyone else.
 *
 * Deliberately carries no `reasons`: telling a browser "you are panic-capable"
 * adds nothing the client can act on and widens what a stolen response
 * discloses. The reasons go to the AuditLog instead.
 */
export function mfaPolicyNotice(
  decision: MfaPolicyDecision,
): { enrollmentRequired: true; enforceAfter: string | null } | undefined {
  if (!decision.inGrace) return undefined;
  return { enrollmentRequired: true, enforceAfter: decision.enforceAfter };
}
