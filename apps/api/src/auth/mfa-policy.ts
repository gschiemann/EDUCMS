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
 * (ACC-03, 2026-08-01). SIX enforcing call sites consume it, and they must
 * agree or the policy becomes a LOCKOUT rather than a control. (This list
 * said "three" until 2026-09-11 while there were five — exactly the drift
 * CLAUDE.md's footer warns about. Keep it current.)
 *
 *   1. `AuthService.login`         — withholds the full session.
 *   2. `MfaController.assertEnrollmentRequired` — lets the held-back user
 *      ENROL without a session (the escape hatch). If this disagreed with
 *      (1), a privileged user would be refused a session at login AND
 *      refused enrollment at `/auth/mfa/required/enroll`. That is a bricked
 *      account, which is exactly why they share this module. NOTE it moves
 *      in the OPPOSITE logical direction from every other gate: it refuses
 *      when the policy does NOT block.
 *   3. `AuthService.refreshSession` — refuses to EXTEND a non-compliant
 *      privileged session, so the pre-existing 12h/30d sessions drain
 *      instead of riding past the deadline.
 *   4. `SessionController.refresh` — the SEC-010 HttpOnly-cookie refresh.
 *      Same rule as (3); a cookie must not be a way around it.
 *   5. `TenantsController.switchTenant` — a switch mints a session scoped to
 *      a DIFFERENT tenant, so it is evaluated against the TARGET tenant's
 *      policy. Without this, per-tenant enforcement is advisory for every
 *      multi-tenant admin (2026-09-11).
 *   6. `MfaController.disable` — refuses to remove a factor the policy
 *      requires. Password + session used to be enough (2026-09-11).
 *
 * Plus one AUDIT-ONLY reader that gates nothing: `AuthController.login`.
 *
 * ── PASSKEYS ARE A SECOND FACTOR (2026-09-21) ──────────────────────────
 * `enrolled` used to mean exactly "TOTP verified". It now means "holds a
 * second factor", which is TOTP **or** at least one WebAuthn passkey — every
 * passkey ceremony in this product requires user verification, so an
 * assertion proves possession plus a biometric/PIN. That makes `hasPasskey`
 * a policy INPUT, carried on {@link MfaPolicySubject}, and every one of the
 * gates below has to supply it or a passkey-only admin is refused a session
 * and pushed at an authenticator app they deliberately replaced.
 *
 * ── PER-TENANT ENFORCEMENT (2026-09-11) ────────────────────────────────
 * `Tenant.mfaEnforced` decides whether the DERIVED half below applies to an
 * organization at all: NEW customers default to optional, every tenant that
 * existed when it shipped was backfilled to enforced. It arrives as the
 * REQUIRED `opts.tenantEnforced`, never as another optional property on the
 * subject — see MfaPolicyOptions for why that distinction is the whole fix.
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
  /**
   * WEBAUTHN (2026-09-21) — does this account hold at least one passkey?
   *
   * A passkey IS a second factor: every ceremony in this product runs with
   * `userVerification: 'required'`, so an assertion proves possession of the
   * authenticator AND a biometric or PIN. A user who has one has satisfied
   * the policy; forcing them into TOTP as well would make the operator's
   * actual goal ("I'm sick of the damn auth app") unreachable.
   *
   * ⚠️ UNLIKE `MfaPolicyOptions.tenantEnforced`, THIS ONE IS CORRECTLY
   * OPTIONAL, and the asymmetry is deliberate. `tenantEnforced` had to be
   * required because an omitted value there reads as "do not enforce" — a
   * silent DOWNGRADE. Here an omitted value reads as "no passkey", i.e. NOT
   * enrolled, i.e. MORE enforcement. A call site that forgets it is stricter
   * than intended, never laxer: the worst case is a passkey-holding user
   * being asked for TOTP, which is annoying and visible, not a bypass.
   *
   * It is still wired into every gate — see the six call sites in the header.
   * The one that MUST have it is `MfaController.assertEnrollmentRequired`: it
   * is the gate that runs BACKWARDS (it opens when the policy blocks), so
   * there an omitted value is the permissive direction and would let a
   * stolen partial `mfaToken` enrol a fresh TOTP device over a passkey-only
   * account — a complete second-factor takeover.
   */
  hasPasskey?: boolean | null;
}

/**
 * The injectable inputs. `now` and `enforceAfter` keep tests off the wall
 * clock and the environment; `tenantEnforced` is the per-tenant policy.
 *
 * ⚠️ `tenantEnforced` IS REQUIRED, AND `opts` NO LONGER HAS A DEFAULT. That
 * is the entire point of its shape (2026-09-11). The obvious implementation —
 * another optional field on {@link MfaPolicySubject} — is the 7a14ce38 bypass
 * rebuilt from scratch: every field there is optional, `AuthService.login`
 * takes `user: any`, and an OMITTED field is not a missing input, it is an
 * affirmative "do not enforce". A call site that forgets this one must fail
 * TYPE-CHECK, loudly, at build time. Resolve it with `tenantMfaEnforced()`
 * from ./tenant-mfa-enforcement, which fails CLOSED on anything it cannot
 * establish — never pass a bare `!!row.mfaEnforced`.
 */
export interface MfaPolicyOptions {
  now?: Date;
  enforceAfter?: Date | null;
  /** Does the acting tenant enforce the DERIVED (role / panic) requirement? */
  tenantEnforced: boolean;
}

export interface MfaPolicyDecision {
  /** Policy says this identity ought to hold a second factor. */
  required: boolean;
  /** Why — surfaced in the audit row, never in the HTTP response. */
  reasons: MfaPolicyReason[];
  /**
   * The account holds a second factor: TOTP enrollment is complete
   * (`mfaTotpVerifiedAt` is set) OR at least one passkey is registered.
   * Either satisfies the requirement; neither is privileged over the other.
   */
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
   * Did the acting tenant's policy enforce the derived half? Echoed back so
   * the AuditLog row can answer "this admin got a password-only session — was
   * that the tenant's setting, the break-glass switch, or a hole?" without
   * anyone having to re-derive it.
   */
  tenantEnforced: boolean;
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
 * injectable so tests never depend on the wall clock or the environment, and
 * `tenantEnforced` is REQUIRED so no gate can forget the per-tenant setting
 * (see {@link MfaPolicyOptions}).
 *
 * ── WHICH HALF THE TENANT SETTING GATES ────────────────────────────────
 * The DERIVED half only: privileged role and `canTriggerPanic`. The per-user
 * `mfaRequired` override is UNCONDITIONAL in every tenant — an operator who
 * deliberately forced 2FA onto one account does not lose it because their
 * organization's global setting is "optional". Tenant policy may only ever
 * ADD enforcement, never subtract an explicit per-account decision. That is
 * the same asymmetry break-glass already has (`derivedBlocking` below), and
 * breaking it would regress ACC-03, which shipped a year before this did.
 */
export function evaluateMfaPolicy(
  subject: MfaPolicySubject | null | undefined,
  opts: MfaPolicyOptions,
): MfaPolicyDecision {
  const now = opts.now ?? new Date();
  const enforceAfter =
    opts.enforceAfter !== undefined ? opts.enforceAfter : resolveMfaEnforceAfter();
  // Mirrors the `enforceAfter !== undefined` idiom above: `tenantEnforced` is
  // typed required, but `login(user: any)` and a dozen test doubles mean a
  // literal `undefined` can still arrive at runtime. It must read as ENFORCE,
  // never as "this tenant opted out" — the fail-closed direction.
  const tenantEnforced = opts.tenantEnforced !== false;

  const role = subject?.role ?? null;
  const reasons: MfaPolicyReason[] = [];

  // The per-user override first — it is the operator's own explicit
  // decision and it is the one reason that does NOT get a grace window,
  // and (since 2026-09-11) the one reason a tenant setting cannot remove.
  const perUserOverride = subject?.mfaRequired === true;
  if (perUserOverride) reasons.push('per-user-override');

  const privilegedRole = typeof role === 'string' && MFA_REQUIRED_ROLES.includes(role);
  const panicCapable = subject?.canTriggerPanic === true;
  // The tenant setting gates the DERIVED half. A reason is pushed only when it
  // actually makes MFA required, so the AuditLog row never claims a user was
  // covered by "privileged-role" in an organization that does not enforce it.
  const derived = tenantEnforced && (privilegedRole || panicCapable);
  if (tenantEnforced && privilegedRole) reasons.push('privileged-role');
  if (tenantEnforced && panicCapable) reasons.push('panic-capable');

  // A second factor of EITHER kind satisfies the requirement (2026-09-21).
  // See `MfaPolicySubject.hasPasskey` for why this field may be optional
  // while `tenantEnforced` may not be: omitting it is the STRICT direction.
  const enrolled = !!subject?.mfaTotpVerifiedAt || subject?.hasPasskey === true;
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
    tenantEnforced,
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
