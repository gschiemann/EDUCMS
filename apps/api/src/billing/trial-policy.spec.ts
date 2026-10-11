/**
 * The trial → paid rules, one state per test. These are the SAME function the
 * banner, the pairing gate, the read-only gate and the reminder emails use.
 */
import {
  billingStateOf,
  cardBillingReady,
  checkoutTrialEnd,
  dueTrialNotice,
  isBillingGateExemptPath,
  newTrialEndsAt,
  TRIAL_DAYS,
  TRIAL_GRACE_DAYS,
  TRIAL_NOTICE,
} from './trial-policy';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-11T12:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const trial = (endsInDays: number, extra: Record<string, unknown> = {}) => ({
  tier: 'FREE_TRIAL',
  status: 'ACTIVE',
  billingMode: 'CARD',
  stripeSubscriptionId: null,
  trialEndsAt: at(endsInDays),
  ...extra,
});

describe('billingStateOf', () => {
  it('no license = legacy pilot: nothing to show, nothing enforced', () => {
    expect(billingStateOf(null, NOW, true)).toMatchObject({ state: 'none', pairingBlocked: false, readOnly: false });
  });

  it('trial with days left: counts whole days UP, nothing blocked', () => {
    const r = billingStateOf(trial(11.5), NOW, true);
    expect(r).toMatchObject({ state: 'trial', daysLeft: 12, pairingBlocked: false, readOnly: false, cardOnFile: false });
  });

  it('trial ended inside the grace period: pairing blocked, dashboard still editable', () => {
    const r = billingStateOf(trial(-2), NOW, true);
    expect(r).toMatchObject({ state: 'trial_ended', daysLeft: 0, pairingBlocked: true, readOnly: false });
    expect(r.graceEndsAt!.getTime()).toBe(at(-2 + TRIAL_GRACE_DAYS).getTime());
  });

  it('grace over: read-only', () => {
    const r = billingStateOf(trial(-(TRIAL_GRACE_DAYS + 1)), NOW, true);
    expect(r).toMatchObject({ state: 'locked', pairingBlocked: true, readOnly: true });
  });

  it('billing NOT live on this deploy: an ended trial is never enforced (nobody could pay)', () => {
    const r = billingStateOf(trial(-30), NOW, false);
    expect(r).toMatchObject({ state: 'trial_ended', pairingBlocked: false, readOnly: false });
  });

  it('card added during the trial: trial_card until the original end date, then active', () => {
    const lic = { ...trial(5), tier: 'MONTHLY', stripeSubscriptionId: 'sub_1' };
    expect(billingStateOf(lic, NOW, true)).toMatchObject({ state: 'trial_card', daysLeft: 5, cardOnFile: true, pairingBlocked: false });
    expect(billingStateOf(lic, at(6), true)).toMatchObject({ state: 'active', cardOnFile: true });
  });

  it('past due: pairing blocked, editing kept (Stripe is retrying the card)', () => {
    const lic = { tier: 'MONTHLY', status: 'PAST_DUE', billingMode: 'CARD', stripeSubscriptionId: 'sub_1' };
    expect(billingStateOf(lic, NOW, true)).toMatchObject({ state: 'past_due', pairingBlocked: true, readOnly: false });
  });

  it('cancelled card subscription: read-only while billing is live', () => {
    const lic = { tier: 'MONTHLY', status: 'CANCELLED', billingMode: 'CARD', stripeSubscriptionId: 'sub_1' };
    expect(billingStateOf(lic, NOW, true)).toMatchObject({ state: 'cancelled', readOnly: true });
    expect(billingStateOf(lic, NOW, false)).toMatchObject({ state: 'cancelled', readOnly: false });
  });

  it('INVOICE / PURCHASE_ORDER / COMP are offline — never a trial, never a card gate', () => {
    for (const billingMode of ['INVOICE', 'PURCHASE_ORDER', 'COMP']) {
      expect(billingStateOf(trial(-30, { billingMode }), NOW, true)).toMatchObject({
        state: 'offline',
        pairingBlocked: false,
        readOnly: false,
      });
    }
  });

  it('owner-suspended stays its own state (the suspension gate handles it)', () => {
    expect(billingStateOf(trial(5, { status: 'SUSPENDED' }), NOW, true).state).toBe('suspended');
  });

  it('a non-trial card license with no subscription (e.g. console-made CARD customer) is none', () => {
    expect(billingStateOf({ tier: 'MONTHLY', status: 'ACTIVE', billingMode: 'CARD' }, NOW, true).state).toBe('none');
  });
});

describe('checkoutTrialEnd — adding a card never costs trial days', () => {
  it('keeps the original trial end', () => {
    expect(checkoutTrialEnd(trial(10), NOW)).toBe(Math.ceil(at(10).getTime() / 1000));
  });
  it('extends a trial with < 48 h left to just past Stripe’s 48 h floor', () => {
    const ts = checkoutTrialEnd(trial(1), NOW)!;
    expect(ts * 1000).toBeGreaterThan(NOW.getTime() + 48 * 60 * 60 * 1000);
    expect(ts * 1000).toBeLessThan(NOW.getTime() + 49 * 60 * 60 * 1000);
  });
  it('an expired trial bills today (no trial_end)', () => {
    expect(checkoutTrialEnd(trial(-1), NOW)).toBeNull();
  });
  it('a non-trial license never gets a trial_end', () => {
    expect(checkoutTrialEnd({ tier: 'MONTHLY', trialEndsAt: at(10) }, NOW)).toBeNull();
    expect(checkoutTrialEnd(null, NOW)).toBeNull();
  });
});

describe('dueTrialNotice', () => {
  it('nothing due with more than 7 days left', () => {
    expect(dueTrialNotice(trial(9), NOW)).toBeNull();
  });
  it('7-day, 1-day and ended stages, each once', () => {
    expect(dueTrialNotice(trial(6.9), NOW)).toBe(TRIAL_NOTICE.SEVEN_DAYS);
    expect(dueTrialNotice(trial(6.9, { trialNoticeStage: 1 }), NOW)).toBeNull();
    expect(dueTrialNotice(trial(0.5, { trialNoticeStage: 1 }), NOW)).toBe(TRIAL_NOTICE.ONE_DAY);
    expect(dueTrialNotice(trial(-0.1, { trialNoticeStage: 2 }), NOW)).toBe(TRIAL_NOTICE.ENDED);
    expect(dueTrialNotice(trial(-0.1, { trialNoticeStage: 3 }), NOW)).toBeNull();
  });
  it('a missed stage is skipped, not sent late', () => {
    expect(dueTrialNotice(trial(0.5), NOW)).toBe(TRIAL_NOTICE.ONE_DAY);
  });
  it('no reminders once a card is on file, or for invoice / comp customers', () => {
    expect(dueTrialNotice(trial(3, { stripeSubscriptionId: 'sub_1' }), NOW)).toBeNull();
    expect(dueTrialNotice(trial(3, { billingMode: 'INVOICE' }), NOW)).toBeNull();
    expect(dueTrialNotice(trial(3, { billingMode: 'COMP' }), NOW)).toBeNull();
  });
});

describe('misc', () => {
  it('cardBillingReady needs the key AND both prices', () => {
    expect(cardBillingReady({})).toBe(false);
    expect(cardBillingReady({ STRIPE_SECRET_KEY: 'sk' })).toBe(false);
    expect(cardBillingReady({ STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_MONTHLY: 'p', STRIPE_PRICE_ANNUAL: 'q' })).toBe(true);
  });
  it('a new trial is TRIAL_DAYS long', () => {
    expect(newTrialEndsAt(NOW).getTime() - NOW.getTime()).toBe(TRIAL_DAYS * DAY);
  });
  it('billing, emergency, auth stay reachable in read-only mode; content routes do not', () => {
    for (const p of ['/api/v1/billing/checkout', '/api/v1/emergency/trigger', '/api/v1/panic-content/x', '/api/v1/auth/logout', '/api/v1/users/me', '/api/v1/license/me?x=1']) {
      expect(isBillingGateExemptPath(p)).toBe(true);
    }
    for (const p of ['/api/v1/playlists', '/api/v1/screens/pair', '/api/v1/users/me/password', '/api/v1/billingx']) {
      expect(isBillingGateExemptPath(p)).toBe(false);
    }
  });
});
