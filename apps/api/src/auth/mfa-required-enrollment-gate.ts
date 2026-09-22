/**
 * THE GATE ON THE UNAUTHENTICATED ENROLLMENT DOOR — extracted 2026-09-21.
 *
 * `/auth/mfa/required/*` exists because `AuthService.login` withholds the
 * session from a privileged user who owes a second factor, while the
 * session-gated `/auth/mfa/enroll` needs the very session being withheld.
 * Without a door that opens WITHOUT a session, the policy is a lockout rather
 * than a control.
 *
 * This function is that door's whole authorization beyond the signed partial
 * `mfaToken`, and it moves in the OPPOSITE logical direction from every other
 * gate in the product: it OPENS when the policy BLOCKS. That inversion is why
 * it gets its own module.
 *
 * ── WHY IT LEFT `MfaController` ───────────────────────────────────────────
 * It was a private method there, which was fine while TOTP was the only thing
 * a held-back user could enrol. `/auth/mfa/required/passkey/*` (2026-09-21)
 * is a SECOND door with exactly the same preconditions, on a different
 * controller — and a copy of this logic is precisely the "two copies of one
 * rule" failure this codebase keeps paying for. A copy that drifted by one
 * condition would not be a warning; on the permissive side it is an
 * unauthenticated second-factor takeover, and on the strict side it is a
 * bricked account. So there is one function, here, and both doors call it.
 *
 * ⚠️ SEC-008 — IT MUST STAY IN LOCKSTEP WITH `AuthService.login`. Both read
 * `evaluateMfaPolicy` and nothing else. The failure mode if they ever diverge
 * is not a warning, it is a BRICKED ACCOUNT: login refuses the session
 * ("enrol first") while this refuses the enrollment ("not required for you"),
 * and the user has no third door. That is precisely why the policy lives in
 * one module instead of being re-derived here — an earlier version read the
 * raw `mfaRequired` column, which stopped being the whole policy the moment
 * role and panic-capability joined it.
 */

import { BadRequestException } from '@nestjs/common';

import { evaluateMfaPolicy } from './mfa-policy';
import { tenantMfaEnforced, type TenantMfaPolicyRow } from './tenant-mfa-enforcement';

/**
 * The row shape the gate reads. Two keys are REQUIRED while the rest are
 * optional, and that asymmetry is the entire compile-time defence — see each
 * field's note.
 */
export interface RequiredEnrollmentSubject {
  role?: string | null;
  canTriggerPanic?: boolean | null;
  mfaRequired?: boolean | null;
  mfaTotpVerifiedAt?: Date | null;
  /**
   * REQUIRED KEY (2026-09-11). Every other field here is optional, which is
   * precisely why a per-tenant setting could not be one of them: an omitted
   * optional field reads as an affirmative "do not enforce", and this door
   * would then answer MFA_NOT_REQUIRED to a user login is holding back —
   * the bricked account the block comment above describes. Typed required
   * so the loader that feeds this function cannot drop the join and compile.
   */
  tenant: TenantMfaPolicyRow | null;
  /**
   * REQUIRED KEY, for the same reason and with a sharper edge (2026-09-21).
   * `MfaPolicySubject.hasPasskey` is optional platform-wide because omitting
   * it is the STRICT direction at every gate that refuses when the policy
   * blocks. This gate refuses when it does NOT block, so here an omitted
   * value is the PERMISSIVE direction — it would open an unauthenticated
   * enrollment door over a passkey-only account. Typed required so the
   * loader cannot drop the count and still compile.
   */
  _count: { passkeys: number } | null;
}

/**
 * Throw unless this account is one the MFA policy is currently holding back
 * AND it has no second factor of any kind.
 *
 * Anyone else — not covered, or already holding a factor — must use the
 * session-gated `/auth/mfa/enroll` + `/verify` or `/auth/passkeys/register/*`.
 * That is what stops a stolen partial token from installing a factor over
 * someone's existing one.
 */
export function assertEnrollmentRequired(
  dbUser: RequiredEnrollmentSubject,
): void {
  if (dbUser.mfaTotpVerifiedAt) {
    throw new BadRequestException({
      message:
        'MFA is already enabled on this account. Complete sign-in with your Authenticator code.',
      code: 'MFA_ALREADY_ENABLED',
    });
  }
  // A passkey IS a second factor. Such an account is not "held back" by the
  // policy at all — login offers it a passkey challenge — so it has no
  // business at this unauthenticated escape hatch, and letting it enrol a
  // fresh factor here would be a second-factor takeover (see the selects in
  // the two loaders that feed this function). The policy check below reaches
  // the same verdict via `enrolled`; this is the named, explicit refusal so
  // the reason is legible in the response and in a stack trace.
  if ((dbUser._count?.passkeys ?? 0) > 0) {
    throw new BadRequestException({
      message:
        'This account already has a passkey. Complete sign-in with your passkey, ' +
        'then add an authenticator app from Settings if you want one.',
      code: 'MFA_ALREADY_ENABLED',
    });
  }
  // `blocking`, not `required`: during the grace window a privileged user
  // still gets a normal session at login, so they do NOT need this
  // unauthenticated door — they can enrol from Settings with a real session,
  // which is the better-audited path. Once the deadline lands, `blocking`
  // becomes true here at exactly the same instant it becomes true in login.
  //
  // WALK THE RECOVERY PATH: `tenantMfaEnforced` fails CLOSED, and this gate
  // OPENS when the policy blocks. Those two directions compose correctly —
  // an unreadable tenant makes login withhold the session AND makes this
  // door open, so a user held back always has somewhere to go. The reverse
  // bias would refuse both and brick the account (the 2026-09-04 shape).
  if (
    !evaluateMfaPolicy(
      { ...dbUser, hasPasskey: (dbUser._count?.passkeys ?? 0) > 0 },
      { tenantEnforced: tenantMfaEnforced(dbUser.tenant) },
    ).blocking
  ) {
    throw new BadRequestException({
      message:
        'MFA enrollment is not required for this account. Sign in and enroll from Settings.',
      code: 'MFA_NOT_REQUIRED',
    });
  }
}
