/**
 * CARD FAILURE → VIEW-ONLY, WITH HELP — the pure rules (2026-10-11, Greg's decision).
 *
 * The lifecycle of a card that stops working:
 *
 *   active ─► invoice.payment_failed ─► past_due   (Stripe's Smart Retries keep trying;
 *                │                                  everything works except pairing NEW screens)
 *                │   email 1  "your card was declined — update it"
 *                │   email 2  "reminder: update your card before the dashboard goes view-only"
 *                │            (3 days after the first failure, or at once when Stripe says
 *                │             there is no further retry)
 *                └─ all retries fail ─► Stripe cancels the subscription ─► cancelled (VIEW-ONLY)
 *                    email 3  "your dashboard is now view-only — restart in one step"
 *
 * WHAT NEVER CHANGES: screens keep playing and emergency alerts keep working in
 * every state (trial-policy.ts / billing-gate.interceptor.ts — device principals
 * and /emergency are outside every billing gate).
 *
 * "View-only" is the existing `cancelled` billing state. The Stripe dashboard is
 * set to "If all retries for a payment fail → Cancel the subscription"; if it is
 * left on "mark the subscription as unpaid" the API still treats `unpaid` as
 * CANCELLED (stripe.service.ts mapSubscriptionStatus), so the outcome is the same
 * either way.
 *
 * Each email goes out AT MOST ONCE PER INVOICE: the webhook stamps the failing
 * invoice id on the License (a NEW invoice resets the stage), and the cron claims
 * a stage with a conditional update before sending (billing-notice.cron).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const DUNNING_NOTICE = { NONE: 0, DECLINED: 1, REMINDER: 2, VIEW_ONLY: 3 } as const;
export type DunningNoticeStage = 1 | 2 | 3;

/** The reminder goes out this long after the first failure (if the card is still failing). */
export const DUNNING_REMINDER_AFTER_MS = 3 * DAY_MS;
/** A failure older than this sends nothing more (a stale row, e.g. a restored backup). */
export const DUNNING_MAX_AGE_MS = 60 * DAY_MS;

export interface DunningLicenseLike {
  billingMode?: string | null;
  status?: string | null;
  stripeSubscriptionId?: string | null;
  dunningInvoiceId?: string | null;
  dunningNoticeStage?: number | null;
  dunningFailedAt?: Date | string | null;
  dunningNextAttemptAt?: Date | string | null;
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Which card-failure email is due now (the highest reached), or null.
 * A stage at or below the one already sent is never due again; a lower stage is
 * skipped when a higher one is already due (a customer whose plan ended overnight
 * gets ONE email, the one that is true now).
 */
export function dueDunningNotice(lic: DunningLicenseLike, now: Date): DunningNoticeStage | null {
  if ((lic.billingMode ?? 'CARD') !== 'CARD') return null;
  if (!lic.stripeSubscriptionId || !lic.dunningInvoiceId) return null;
  const failedAt = asDate(lic.dunningFailedAt);
  if (!failedAt) return null;
  if (now.getTime() - failedAt.getTime() > DUNNING_MAX_AGE_MS) return null;

  let due: DunningNoticeStage | null = null;
  if (lic.status === 'CANCELLED') {
    due = DUNNING_NOTICE.VIEW_ONLY;
  } else if (lic.status === 'PAST_DUE') {
    const lastTry = !asDate(lic.dunningNextAttemptAt);
    due =
      lastTry || now.getTime() - failedAt.getTime() >= DUNNING_REMINDER_AFTER_MS
        ? DUNNING_NOTICE.REMINDER
        : DUNNING_NOTICE.DECLINED;
  }
  if (due == null) return null;
  return due > (lic.dunningNoticeStage ?? 0) ? due : null;
}

/**
 * The License columns to write when Stripe reports a failed invoice payment.
 * `sameInvoice` = the License already tracks this invoice (keep its stage and
 * first-failure time; only move the next retry date).
 */
export function dunningOnFailure(input: {
  invoiceId: string;
  nextPaymentAttempt: number | null | undefined;
  eventCreated: number;
}): { dunningInvoiceId: string; dunningFailedAt: Date; dunningNextAttemptAt: Date | null } {
  const next =
    typeof input.nextPaymentAttempt === 'number' && input.nextPaymentAttempt > 0
      ? new Date(input.nextPaymentAttempt * 1000)
      : null;
  return {
    dunningInvoiceId: input.invoiceId,
    dunningFailedAt: new Date(input.eventCreated * 1000),
    dunningNextAttemptAt: next,
  };
}

/** Columns that clear a card failure (a payment went through). */
export const DUNNING_CLEARED = {
  dunningInvoiceId: null,
  dunningNoticeStage: 0,
  dunningFailedAt: null,
  dunningNextAttemptAt: null,
} as const;
