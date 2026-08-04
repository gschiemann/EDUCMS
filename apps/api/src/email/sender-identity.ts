/**
 * Outbound-sender identity + the "SENT vs SENT_UNVERIFIED" honesty gate.
 *
 * WHY THIS FILE EXISTS (2026-08-03). The gate originally lived as private
 * state inside `EmailService`, so only the transactional mail that flows
 * through `EmailService.#enqueue` told the truth. Two OTHER services POST to
 * Resend directly — `StorageWatchdogService` (storage-outage alerts) and
 * `EfficiencyAlertingService` (egress-cost alerts) — and each recorded a
 * confident `status: 'SENT'` on any Resend 2xx. Those are precisely the
 * alerts that say "the platform is broken", so the mail most likely to be
 * silently dropped was also the mail most confident it had been delivered.
 *
 * THE UNDERLYING FACT. `EMAIL_FROM` defaults to `onboarding@resend.dev`, the
 * shared Resend sender. Resend accepts a message from it with a 200 and then
 * DELIVERS it only to the address that OWNS the Resend account; every other
 * recipient (other admins, on-call, the operator's alert alias) is silently
 * dropped or spam-filed. A 200 therefore proves "accepted", never "delivered
 * to this recipient".
 *
 * THE CONTRACT. Every outbound sender in the API must resolve its FROM via
 * `resolveEmailFrom()` and derive the `email_logs.status` it writes on a
 * Resend 2xx from `resendAcceptedStatus()` — never a hard-coded `'SENT'`.
 * `sharedSenderWarning()` produces the matching log line so the operator sees
 * the reason, not just the status token.
 *
 * Deliberately dependency-free (no Nest DI, no Prisma) so a background
 * service can import it without pulling `EmailModule` into its graph.
 */

/**
 * The Resend "shared" sender we fall back to when EMAIL_FROM is unset.
 * Keep in sync with the CLAUDE.md EMAIL_FROM row.
 */
export const DEFAULT_EMAIL_FROM = 'VenueOS <onboarding@resend.dev>';

/**
 * Matches any EMAIL_FROM whose address is the shared Resend sender — bare,
 * or wrapped in a display name like "Foo <onboarding@resend.dev>".
 */
const SHARED_RESEND_SENDER_RE = /onboarding@resend\.dev/i;

/** The FROM header every sender must use. */
export function resolveEmailFrom(): string {
  return process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM;
}

/**
 * True only when EMAIL_FROM is a real, domain-verified sender — i.e. Resend
 * will actually deliver to ARBITRARY recipients, not just the Resend account
 * owner.
 *
 * Checks the sender IDENTITY only (independent of RESEND_API_KEY) so "can
 * this FROM reach anyone?" stays orthogonal to "is a key present?".
 *   - unset / blank → false (falls back to the shared sender)
 *   - shared sender → false (bare or "Name <onboarding@resend.dev>")
 *   - custom domain → true
 */
export function isDeliverableToArbitraryRecipients(): boolean {
  const from = (process.env.EMAIL_FROM || '').trim();
  if (!from) return false;
  return !SHARED_RESEND_SENDER_RE.test(from);
}

/**
 * The `email_logs.status` to persist after Resend ACCEPTS a message (2xx).
 * `'SENT'` only when the sender can actually reach arbitrary recipients;
 * otherwise `'SENT_UNVERIFIED'` — accepted by Resend, delivery unproven.
 */
export function resendAcceptedStatus(): 'SENT' | 'SENT_UNVERIFIED' {
  return isDeliverableToArbitraryRecipients() ? 'SENT' : 'SENT_UNVERIFIED';
}

/**
 * The warn-level line to emit alongside a `SENT_UNVERIFIED` row, so the
 * reason is legible in Railway logs and not just a status token in the DB.
 */
export function sharedSenderWarning(params: {
  kind: string;
  to: string;
  from?: string;
}): string {
  const from = params.from ?? resolveEmailFrom();
  return (
    `[email] Handed "${params.kind}" to Resend from the shared sender ` +
    `(${from}), but Resend only DELIVERS that to the Resend account owner — ` +
    `every other recipient (to=${params.to}) is silently dropped. Set ` +
    `EMAIL_FROM to a verified custom sending domain to deliver to anyone. ` +
    `Marking email_log SENT_UNVERIFIED.`
  );
}
