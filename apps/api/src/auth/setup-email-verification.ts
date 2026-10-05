import { createHash } from 'node:crypto';

/**
 * FIRST-LOGIN EMAIL VERIFICATION (2026-10-06).
 *
 * First-login setup (`POST /auth/complete-setup`) replaces the account's
 * placeholder email with the person's own. Nothing used to check that the
 * mailbox exists or is theirs, so a typo — or an address that was never a real
 * inbox (Greg's own RIOT Corporate claim, 2026-10-05) — stranded every
 * sign-in code and password reset, and the profile has no way to change an
 * email afterwards. Setup now sends a 6-digit code to the NEW address and
 * finishes only with it.
 *
 * `SETUP_EMAIL_VERIFICATION`:
 *   auto (default) — required exactly when our sender can reach arbitrary
 *                    inboxes (a verified sending domain). On the shared
 *                    `onboarding@resend.dev` sender nobody but the Resend
 *                    account owner receives mail, so requiring a code would
 *                    make setup impossible for everyone else.
 *   required       — always (use once mail is known to work).
 *   off            — never (break-glass).
 * Anything else reads as `auto`.
 */
export type SetupEmailVerificationMode = 'auto' | 'required' | 'off';

export function setupEmailVerificationMode(
  raw: string | undefined = process.env.SETUP_EMAIL_VERIFICATION,
): SetupEmailVerificationMode {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'required' || v === 'on' || v === 'true' || v === '1') return 'required';
  if (v === 'off' || v === 'false' || v === '0') return 'off';
  return 'auto';
}

export function setupEmailVerificationRequired(input: {
  /** Can mail from our sender reach an arbitrary inbox? */
  deliverable: boolean;
  mode?: SetupEmailVerificationMode;
}): boolean {
  const mode = input.mode ?? setupEmailVerificationMode();
  if (mode === 'required') return true;
  if (mode === 'off') return false;
  return input.deliverable;
}

/** Setup codes per account per window (shared table with the sign-in codes). */
export const SETUP_EMAIL_CODE_SENDS_PER_ACCOUNT = 6;
export const SETUP_EMAIL_CODE_ACCOUNT_WINDOW_MS = 15 * 60_000;
/** Per network address per hour — an office walking six managers through setup shares one. */
export const SETUP_EMAIL_CODE_SENDS_PER_IP = 30;
export const SETUP_EMAIL_CODE_IP_WINDOW_MS = 60 * 60_000;

/**
 * The code is bound to (account, address): a code emailed to one address can
 * never complete setup with another. The rows live in `mfa_email_codes`
 * (same lifetime, attempt cap and hashing as the emailed sign-in code); this
 * deterministic value is their `challengeHash`, which nobody can reach from
 * the sign-in flow because that flow looks rows up by the hash of a random
 * client-held challenge.
 */
export function setupEmailChallengeHash(userId: string, email: string): string {
  return createHash('sha256')
    .update(`venueos-setup-email|${userId}|${email.trim().toLowerCase()}`)
    .digest('hex');
}
