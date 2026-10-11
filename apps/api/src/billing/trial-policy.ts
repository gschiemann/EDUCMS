/**
 * SELF-SERVE TRIAL → PAID — the pure rules (2026-10-11).
 *
 * Everything here is a function of its arguments (license row, clock, whether
 * card billing is live on this deploy). No Prisma, no Nest, no Stripe SDK, so
 * every state is pinned shape by shape in trial-policy.spec.ts and the SAME
 * function decides the dashboard banner, the pairing gate, the read-only gate
 * and the reminder emails — they can never disagree.
 *
 * THE LIFECYCLE a self-serve customer lives:
 *
 *   signup ─► trial (14 days, 3 screens, no card)
 *              │  add a card any time ─► trial_card (card on file; Stripe's
 *              │                         subscription is `trialing` and bills
 *              │                         on the ORIGINAL trial end date —
 *              │                         nobody loses trial days for paying early)
 *              │                              └─► active ─► past_due ─► (cancelled)
 *              └─ trial ends, no card ─► trial_ended (7-day grace: everything
 *                                        still works except pairing NEW screens)
 *                                          └─► locked (dashboard read-only)
 *
 * WHAT NEVER CHANGES, IN ANY STATE: screens keep playing what they were last
 * given, and every emergency route keeps working. Device principals and
 * /emergency + /panic-content are outside both gates (see billing-gate.ts).
 *
 * CARD BILLING MUST BE LIVE BEFORE ANYTHING IS ENFORCED. `billingReady` is
 * STRIPE_SECRET_KEY + both price ids. When it is false (production today) a
 * customer cannot pay, so nothing may lock them out for not paying: signup
 * creates no trial, and an existing trial never escalates past `trial_ended`.
 */

export const TRIAL_DAYS = 14;
/** The advertised trial screen count (FREE_TRIAL in @cms/api-types billing catalog). */
export const TRIAL_SCREENS = 3;
/** Days after the trial ends before the dashboard goes read-only. */
export const TRIAL_GRACE_DAYS = 7;
/** Per-screen list prices (USD cents) — the same numbers as the MONTHLY / ANNUAL catalog tiers. */
export const PRICE_MONTHLY_CENTS = 2500;
export const PRICE_ANNUAL_CENTS = 24000;
/** Checkout's adjustable-quantity ceiling — far above any real self-serve fleet. */
export const MAX_SELF_SERVE_SCREENS = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stripe refuses a Checkout `subscription_data.trial_end` less than 48 h out. */
export const STRIPE_MIN_TRIAL_END_MS = 48 * 60 * 60 * 1000;

/** True when a customer could actually pay by card on this deploy. */
export function cardBillingReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_MONTHLY && env.STRIPE_PRICE_ANNUAL);
}

export type BillingState =
  | 'none' // no self-serve billing applies (legacy pilot tenant with no license)
  | 'offline' // INVOICE / PURCHASE_ORDER / COMP — billed by ARC, never a card
  | 'trial' // free trial, no card yet
  | 'trial_card' // card on file, still inside the trial; billing starts at trialEndsAt
  | 'trial_ended' // trial over, no card, inside the grace period
  | 'locked' // grace over: dashboard read-only until a card is added
  | 'active'
  | 'past_due' // a card payment failed; Stripe is retrying
  | 'cancelled' // the card subscription ended
  | 'suspended'; // suspended by VenueOS (owner console) — its own gate

export interface TrialLicenseLike {
  tier?: string | null;
  status?: string | null;
  billingMode?: string | null;
  stripeSubscriptionId?: string | null;
  trialEndsAt?: Date | string | null;
  seatLimit?: number | null;
}

export interface BillingStateResult {
  state: BillingState;
  trialEndsAt: Date | null;
  /** Whole days left in the trial (rounded UP; 0 once it has ended). */
  daysLeft: number | null;
  /** When the dashboard goes read-only (trial_ended only). */
  graceEndsAt: Date | null;
  /** New screens cannot be paired (other seat rules still apply on top). */
  pairingBlocked: boolean;
  /** The dashboard refuses edits (screens + emergency untouched). */
  readOnly: boolean;
  /** A card subscription exists (portal is the place to manage it). */
  cardOnFile: boolean;
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isFreeTrialTier(tier: string | null | undefined): boolean {
  return tier === 'FREE_TRIAL';
}

export function billingStateOf(
  lic: TrialLicenseLike | null | undefined,
  now: Date,
  billingReady: boolean,
): BillingStateResult {
  const base: BillingStateResult = {
    state: 'none',
    trialEndsAt: null,
    daysLeft: null,
    graceEndsAt: null,
    pairingBlocked: false,
    readOnly: false,
    cardOnFile: false,
  };
  if (!lic) return base;
  if (lic.status === 'SUSPENDED') return { ...base, state: 'suspended', pairingBlocked: true };
  const mode = lic.billingMode ?? 'CARD';
  if (mode !== 'CARD') return { ...base, state: 'offline' };

  const trialEndsAt = asDate(lic.trialEndsAt);
  const cardOnFile = !!lic.stripeSubscriptionId;
  const daysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS)) : null;

  if (!cardOnFile) {
    if (!isFreeTrialTier(lic.tier) || !trialEndsAt) return base;
    if (now.getTime() < trialEndsAt.getTime()) {
      return { ...base, state: 'trial', trialEndsAt, daysLeft };
    }
    const graceEndsAt = new Date(trialEndsAt.getTime() + TRIAL_GRACE_DAYS * DAY_MS);
    // Billing not live → nobody can pay, so nothing may be enforced.
    if (!billingReady) return { ...base, state: 'trial_ended', trialEndsAt, daysLeft: 0, graceEndsAt };
    if (now.getTime() < graceEndsAt.getTime()) {
      return { ...base, state: 'trial_ended', trialEndsAt, daysLeft: 0, graceEndsAt, pairingBlocked: true };
    }
    return { ...base, state: 'locked', trialEndsAt, daysLeft: 0, graceEndsAt, pairingBlocked: true, readOnly: true };
  }

  const withCard = { ...base, cardOnFile: true, trialEndsAt };
  if (lic.status === 'CANCELLED') {
    return { ...withCard, state: 'cancelled', pairingBlocked: true, readOnly: billingReady };
  }
  if (lic.status === 'PAST_DUE') return { ...withCard, state: 'past_due', pairingBlocked: true };
  if (trialEndsAt && now.getTime() < trialEndsAt.getTime()) {
    return { ...withCard, state: 'trial_card', daysLeft };
  }
  return { ...withCard, state: 'active' };
}

/**
 * The Checkout `subscription_data.trial_end` (UNIX seconds) that keeps the
 * customer's remaining trial days, or null when billing should start now.
 * Stripe requires ≥ 48 h, so a trial with less than that left is extended to
 * just past 48 h (a customer paying on day 13 gets ~one bonus day rather than
 * being billed early). Expired trial → null (billing starts today).
 */
export function checkoutTrialEnd(lic: TrialLicenseLike | null | undefined, now: Date): number | null {
  if (!lic || !isFreeTrialTier(lic.tier) || lic.stripeSubscriptionId) return null;
  const end = asDate(lic.trialEndsAt);
  if (!end || end.getTime() <= now.getTime()) return null;
  const floor = now.getTime() + STRIPE_MIN_TRIAL_END_MS + 5 * 60 * 1000;
  return Math.ceil(Math.max(end.getTime(), floor) / 1000);
}

/** Reminder stages. Stored on License.trialNoticeStage; each is sent at most once. */
export const TRIAL_NOTICE = { NONE: 0, SEVEN_DAYS: 1, ONE_DAY: 2, ENDED: 3 } as const;
export type TrialNoticeStage = 1 | 2 | 3;
/** An "ended" notice older than this is not sent at all (e.g. the first run after a deploy). */
export const ENDED_NOTICE_MAX_AGE_MS = 3 * DAY_MS;

/**
 * Which reminder is due now (the highest stage reached), or null. Only a
 * card-less free trial gets reminders. A stage at or below `sentStage` is never
 * due again, and lower stages are skipped when a higher one is already due.
 */
export function dueTrialNotice(
  lic: TrialLicenseLike & { trialNoticeStage?: number | null },
  now: Date,
): TrialNoticeStage | null {
  if ((lic.billingMode ?? 'CARD') !== 'CARD' || lic.stripeSubscriptionId || !isFreeTrialTier(lic.tier)) return null;
  if (lic.status && lic.status !== 'ACTIVE') return null;
  const end = asDate(lic.trialEndsAt);
  if (!end) return null;
  const left = end.getTime() - now.getTime();
  const due: TrialNoticeStage | null =
    left <= 0 ? TRIAL_NOTICE.ENDED : left <= 1 * DAY_MS ? TRIAL_NOTICE.ONE_DAY : left <= 7 * DAY_MS ? TRIAL_NOTICE.SEVEN_DAYS : null;
  if (due == null) return null;
  return due > (lic.trialNoticeStage ?? 0) ? due : null;
}

/** New trial dates for a signup at `now`. */
export function newTrialEndsAt(now: Date): Date {
  return new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
}

/**
 * Routes a person can still use while the dashboard is read-only for billing.
 * A superset of the suspension list plus billing itself — the customer must be
 * able to reach the page that fixes it. Device principals are never gated.
 */
const BILLING_GATE_EXEMPT_PREFIXES = [
  '/api/v1/emergency',
  '/api/v1/panic-content',
  '/api/v1/auth',
  '/api/v1/health',
  '/api/v1/security/csrf',
  '/api/v1/billing',
  '/api/v1/license',
  '/api/v1/bugs',
];
const BILLING_GATE_EXEMPT_EXACT = ['/api/v1/users/me'];

export function isBillingGateExemptPath(path: string): boolean {
  const p = (path || '').split('?')[0].replace(/\/+$/, '') || '/';
  if (BILLING_GATE_EXEMPT_EXACT.includes(p)) return true;
  return BILLING_GATE_EXEMPT_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
