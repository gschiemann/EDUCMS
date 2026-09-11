/**
 * MFA enforcement — does THIS tenant enforce the derived two-factor policy?
 *
 * THE DECISION THIS ENCODES (Greg, 2026-09-11): *"i want people to have the
 * options but for my riot accounts, leave it turned on, we will keep that
 * security so just new customers."* So:
 *
 *   - NEW tenants default to OPTIONAL — a brand-new customer is not met at
 *     their first sign-in with "enrol an authenticator or you're not getting
 *     in". They can turn it on whenever they like.
 *   - EVERY TENANT THAT EXISTED WHEN THIS SHIPPED STAYS ENFORCED. That is not
 *     done here, in the resolver — it is done ONCE, in the migration, which
 *     writes `true` to every existing row. A tenant that has MFA today must
 *     never lose it because a default moved, and a default is exactly the kind
 *     of thing a later edit moves.
 *
 * The column is a NULLABLE TRI-STATE, the same shape as
 * `Tenant.emergencyEnabled`:
 *
 *   true   → this organization enforces the derived MFA policy
 *   false  → optional: only a per-user `mfaRequired` override still blocks
 *   null   → never stated; use {@link DEFAULT_MFA_ENFORCED}
 *
 * WHAT "ENFORCED" COVERS, PRECISELY. This flag gates the DERIVED half of
 * `evaluateMfaPolicy` — the privileged-role and panic-capable requirements
 * that SEC-008 added. It does NOT sweep every member of the organization into
 * mandatory TOTP, and it does NOT touch the per-user `mfaRequired` override,
 * which stays unconditional and immediately blocking in every tenant. So:
 *
 *   - Turning it OFF can only ever REMOVE the derived requirement. An admin
 *     who deliberately forced 2FA onto one account keeps it (ACC-03).
 *   - Turning it ON adds exactly what the platform policy already described:
 *     SUPER_ADMIN / DISTRICT_ADMIN / SCHOOL_ADMIN and anyone who can fire a
 *     panic must hold a second factor. It does not newly conscript
 *     CONTRIBUTOR / RESTRICTED_VIEWER, because "sweeping a whole district's
 *     content staff into mandatory TOTP is the kind of unrequested friction
 *     that gets a security control switched off" (mfa-policy.ts) — and
 *     because the migration backfills every existing tenant to `true`, any
 *     wider reading would have silently locked out every contributor in the
 *     product on one deploy.
 *
 * NO VERTICAL OVERRIDE, unlike `effectiveEmergencyEnabled`. Emergency is
 * locked ON for K–12 because a school must never be one mis-click from a
 * fleet that ignores a lockdown. MFA enforcement is a sign-in policy, the
 * operator asked for it to be the customer's choice, and the existing-tenant
 * protection is carried by the backfill rather than by a vertical rule. If
 * that call is ever revisited, it is one line here plus a spec — deliberately.
 *
 * PURE — no React, no Prisma, no network. Shared by the API (authority) and
 * the web dashboard (presentation) so the two can never disagree, which is
 * the whole reason `emergency-enablement.ts` next door exists.
 */

/**
 * What a tenant that has never stated a preference gets: OPTIONAL.
 *
 * ⚠️ Read the header before changing this. It is the NEW-CUSTOMER default
 * only. Existing tenants do not ride it — the migration wrote `true` on all
 * of them — so lowering it cannot silently disarm an organization that is
 * enforcing today, and raising it would force enrollment on every tenant
 * created since.
 */
export const DEFAULT_MFA_ENFORCED = false;

/**
 * Resolve the EFFECTIVE enforcement from the stored tri-state column.
 *
 * `undefined` is treated the same as `null` HERE because this function's only
 * input is the column value itself. The dangerous case — a caller that never
 * LOADED the column, so `row.mfaEnforced` is `undefined` — is caught one layer
 * up by `tenantMfaEnforced()` in the API, which fails CLOSED for it. Do not
 * "simplify" by calling this function with a raw row property; call the API
 * helper, which knows the difference between "never stated" and "never read".
 */
export function effectiveMfaEnforced(stored: boolean | null | undefined): boolean {
  if (stored === true) return true;
  if (stored === false) return false;
  return DEFAULT_MFA_ENFORCED;
}
