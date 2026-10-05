/**
 * Ten per account. High enough for a laptop, a phone, a tablet and a couple of
 * hardware keys with room to spare; low enough that a stolen session cannot
 * quietly salt an account with credentials, and that the `excludeCredentials`
 * list stays a sane size on every ceremony.
 *
 * Its own module (2026-10-05) because two files now read it:
 * `passkey.controller.ts` (the cap on registration, re-exported from there for
 * the existing importers) and `passkey-enrollment-grant.ts` (no "add a passkey
 * for this device" offer to an account that is already at the cap). The grant
 * module cannot import the controller — the controller imports the grant.
 */
export const MAX_PASSKEYS_PER_USER = 10;
