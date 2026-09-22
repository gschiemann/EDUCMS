/**
 * Step-up password re-authentication — ONE implementation of "prove you are
 * still the person holding this session."
 *
 * Every endpoint that removes or replaces an authentication factor re-checks
 * the caller's password first, so a hijacked session alone cannot strip a
 * second factor. That check must be byte-identical everywhere: it has to use
 * the platform argon2 parameters (`cryptoPlatformConfig`) or a legitimate
 * password fails to verify, and it has to swallow argon2's throw on an
 * unparseable stored hash rather than 500 — a malformed hash is "wrong
 * password", not an outage.
 *
 * `MfaController.disable` and `PasskeyController` each carry a private
 * `checkPassword` that is exactly this function (both predate it, and both
 * files were owned by another change when this landed). They should be
 * switched to import from here so the three cannot drift — a FOURTH copy is
 * a bug. Same rule, and same reason, as the `ROLE_RANK` note in
 * ./role-assignment.ts.
 */
import * as argon2 from 'argon2';
import { cryptoPlatformConfig } from './crypto.config';
import { isSsoProvisionedNoPassword } from './sso-provisioned-account';

/**
 * True only when `candidate` is the live password behind `hash`.
 *
 * Fails CLOSED on everything else — absent hash, malformed hash, argon2
 * throwing — because the only safe answer to "I cannot tell" on a step-up is
 * "no". Callers that need to distinguish "this account has no password of its
 * own" from "wrong password" must test the hash BEFORE calling this (see
 * `accountHasNoOwnPassword`); a step-up that answers "wrong password" to an
 * SSO-provisioned admin leaves them at a dead end with no named next step.
 */
export async function verifyReauthPassword(
  hash: string | null | undefined,
  candidate: string,
): Promise<boolean> {
  if (typeof hash !== 'string' || hash.length === 0) return false;
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  try {
    return await argon2.verify(hash, candidate, cryptoPlatformConfig);
  } catch {
    return false;
  }
}

/**
 * Does this account have no password of its own, so that a password step-up
 * is impossible rather than merely failing?
 *
 * Three shapes exist in the wild and none of them is a verifiable credential:
 *   - the Clever sentinel `SSO_PROVISIONED_NO_PASSWORD_HASH`
 *     (see ./sso-provisioned-account.ts — the named, deliberate marker);
 *   - the random `sso:<rand>:<ts>` string `SsoService` writes when it
 *     provisions an account from an IdP assertion;
 *   - an empty / absent hash.
 *
 * The general rule below subsumes all three: an argon2 encoded hash always
 * begins `$argon2`, so anything else cannot be verified at all. The named
 * sentinel is still tested first so the INTENT is legible at the call site
 * and so this keeps answering correctly if that constant ever changes shape.
 */
export function accountHasNoOwnPassword(
  hash: string | null | undefined,
): boolean {
  if (typeof hash !== 'string' || hash.length === 0) return true;
  if (isSsoProvisionedNoPassword(hash)) return true;
  return !hash.startsWith('$argon2');
}
