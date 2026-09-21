/**
 * MAY THIS ACCOUNT OBTAIN A SESSION AT ALL — independently of how it proved
 * itself.
 *
 * These are the gates `AuthService.validateUser` has always applied AFTER
 * finding the row and BEFORE (well, around) the password check: they are
 * properties of the ACCOUNT, not of the credential. They were inlined there,
 * which was fine while password was the only way in.
 *
 * Passkeys add a second front door (`POST /auth/passkeys/login/verify`) that
 * mints a session without ever calling `validateUser`. Re-implementing the
 * list there is how the two drift: the next gate someone adds to the password
 * path — as ACC-05 added the archived-tenant one in August — would silently
 * not apply to passkey sign-in, and a disabled user or a retired location's
 * admin would keep a working door into a life-safety platform. So the list
 * lives HERE, once, and both paths call it.
 *
 * NOT in this list, deliberately:
 *   • the password comparison itself (that is the credential, not the account);
 *   • `mustSetupCredentials` — it does not deny a session, it CONSTRAINS one
 *     (JwtAuthGuard gates such a session down to setup / logout / me), and
 *     the flag rides into the token via `login()`'s `msc` claim;
 *   • the MFA policy — a separate module with its own six gates
 *     (`mfa-policy.ts`), evaluated after eligibility, not instead of it;
 *   • `isSsoProvisionedNoPassword` — on the password path the sentinel hash
 *     simply fails argon2, so it never needed a gate. A passkey path has no
 *     argon2 to do that rejecting, so it checks the sentinel explicitly at its
 *     own call site; see `passkey.controller.ts`.
 */

/** Why a row may not become a session. `ok` is the only passing value. */
export type LoginIneligibility =
  | 'not-found'
  | 'deleted'
  | 'tenant-archived'
  | 'inactive';
export type LoginEligibility = 'ok' | LoginIneligibility;

/**
 * The columns the gates read. Any live `User` row satisfies this, PROVIDED the
 * query joined the tenant — a row that selected no `tenant` reads as
 * "tenant not archived", which is the permissive direction.
 *
 * That is why `tenant` is a REQUIRED key rather than an optional one (the
 * same reasoning `MfaPolicyOptions.tenantEnforced` spells out): a caller that
 * forgets the join fails type-check instead of silently admitting every user
 * of an archived tenant. `null` is allowed and means "no tenant row", which
 * `loginEligibility` treats as not-archived — matching the pre-existing
 * `!!found?.tenant?.archivedAt` behaviour exactly.
 */
export interface LoginEligibilitySubject {
  deletedAt?: Date | string | null;
  status?: string | null;
  tenant: { archivedAt?: Date | string | null } | null;
}

/**
 * Grade a user row. Order matters only for the REASON reported (used for
 * audit detail); every non-`ok` value is refused identically by callers, and
 * must be — distinguishing "no such user" from "disabled user" in an HTTP
 * response is an account-enumeration oracle.
 */
export function loginEligibility(
  row: LoginEligibilitySubject | null | undefined,
): LoginEligibility {
  if (!row) return 'not-found';
  // 2026-06-16 — a soft-deleted user must never authenticate. The delete path
  // also anonymizes the email, but this defends in depth.
  if (row.deletedAt) return 'deleted';
  // ACC-05 (2026-08-01) — archiving a tenant used to be a display-layer change
  // only: every one of its users could still sign in, and an admin among them
  // could still fire /emergency/trigger at real screens.
  if (row.tenant?.archivedAt) return 'tenant-archived';
  // Audit fix #8 — users still in the INVITED state must accept their invite
  // and set a password first; DISABLED accounts must stay out.
  if (row.status && row.status !== 'ACTIVE') return 'inactive';
  return 'ok';
}

/** Convenience predicate for the common `if (!eligible) refuse` shape. */
export function isLoginEligible(
  row: LoginEligibilitySubject | null | undefined,
): boolean {
  return loginEligibility(row) === 'ok';
}
