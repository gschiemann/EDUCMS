/**
 * CARD FAILURE → VIEW-ONLY, WITH HELP (2026-10-11, Greg's decision) — the rules
 * and the server side end to end over hand-rolled fakes (no Stripe, no DB):
 *   - dueDunningNotice: declined → reminder (3 days, or Stripe's last try) →
 *     view-only; a stage is never due twice; non-card / stale rows send nothing;
 *   - the webhook stamps the failing invoice, a NEW invoice resets the stage,
 *     a payment clears it, and `unpaid` lands on CANCELLED (view-only);
 *   - the cron sends each email once (en / es / zh), to admins only;
 *   - "Update card" opens Stripe on the payment-method flow, and the retry
 *     charges the open invoice with the NEW default card, audited;
 *   - restarting after the plan ended cancels a leftover unpaid subscription
 *     so the customer is never billed twice.
 */
import { StripeService } from './stripe.service';
import { TrialReminderCron } from './trial-reminder.cron';
import { DUNNING_NOTICE, DUNNING_REMINDER_AFTER_MS, dueDunningNotice } from './dunning-policy';
import { dunningEmail } from './dunning-emails';
import { billingStateOf } from './trial-policy';

const DAY = 86_400_000;
const NOW = new Date('2026-10-11T12:00:00Z');
const sec = (d: Date) => Math.floor(d.getTime() / 1000);

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
});

type Lic = Record<string, any>;

function paidLicense(extra: Lic = {}): Lic {
  return {
    id: 'lic-1',
    tenantId: 't1',
    tier: 'MONTHLY',
    billingMode: 'CARD',
    status: 'ACTIVE',
    seatLimit: 3,
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    stripeLastEventCreatedAt: null,
    dunningInvoiceId: null,
    dunningNoticeStage: 0,
    dunningFailedAt: null,
    dunningNextAttemptAt: null,
    noticeLocale: null,
    ...extra,
  };
}

function fakePrisma(licenses: Lic[], users: Lic[] = []) {
  const audit: Lic[] = [];
  const tx: any = {
    license: {
      findUnique: async ({ where }: any) => licenses.find((l) => l.tenantId === where.tenantId) ?? null,
      findFirst: async ({ where }: any) =>
        licenses.find(
          (l) =>
            (where.stripeCustomerId && l.stripeCustomerId === where.stripeCustomerId) ||
            (where.stripeSubscriptionId && l.stripeSubscriptionId === where.stripeSubscriptionId),
        ) ?? null,
      upsert: async ({ where, update }: any) => Object.assign(licenses.find((l) => l.tenantId === where.tenantId)!, update),
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const l of licenses) {
          if (where.id && l.id !== where.id) continue;
          if (where.tenantId && l.tenantId !== where.tenantId) continue;
          if ('dunningInvoiceId' in where && l.dunningInvoiceId !== where.dunningInvoiceId) continue;
          if (where.dunningNoticeStage?.lt !== undefined && !((l.dunningNoticeStage ?? 0) < where.dunningNoticeStage.lt)) continue;
          Object.assign(l, data);
          count++;
        }
        return { count };
      },
      findMany: async ({ where }: any) =>
        licenses
          .filter((l) => !where?.status?.in || where.status.in.includes(l.status))
          .filter((l) => !where?.dunningInvoiceId || l.dunningInvoiceId)
          .map((l) => ({ ...l, tenant: { name: 'Taco Town', slug: 'taco' } })),
    },
    auditLog: { create: async ({ data }: any) => (audit.push(data), data) },
    user: {
      findMany: async ({ where }: any) => users.filter((u) => where.role.in.includes(u.role) && u.status === 'ACTIVE'),
    },
    processedStripeEvent: { create: async () => ({}), delete: async () => ({}) },
  };
  const client: any = { ...tx, $transaction: async (fn: any) => fn(tx) };
  return { prisma: { client } as any, audit };
}

describe('dueDunningNotice — the pure rules', () => {
  const failing = (extra: Lic = {}) =>
    paidLicense({
      status: 'PAST_DUE',
      dunningInvoiceId: 'in_1',
      dunningFailedAt: new Date(NOW.getTime() - 1 * DAY),
      dunningNextAttemptAt: new Date(NOW.getTime() + 2 * DAY),
      ...extra,
    });

  it('first failure → "card declined"', () => {
    expect(dueDunningNotice(failing(), NOW)).toBe(DUNNING_NOTICE.DECLINED);
  });
  it('still failing 3 days later → the reminder before view-only', () => {
    expect(
      dueDunningNotice(failing({ dunningNoticeStage: 1, dunningFailedAt: new Date(NOW.getTime() - DUNNING_REMINDER_AFTER_MS) }), NOW),
    ).toBe(DUNNING_NOTICE.REMINDER);
  });
  it("Stripe's LAST try failed (no next attempt) → the reminder at once", () => {
    expect(dueDunningNotice(failing({ dunningNoticeStage: 1, dunningNextAttemptAt: null }), NOW)).toBe(DUNNING_NOTICE.REMINDER);
  });
  it('plan ended after a card failure → "now view-only" (lower stages skipped)', () => {
    expect(dueDunningNotice(failing({ status: 'CANCELLED' }), NOW)).toBe(DUNNING_NOTICE.VIEW_ONLY);
  });
  it('never twice: a stage at or below the one sent is not due', () => {
    expect(dueDunningNotice(failing({ dunningNoticeStage: 1 }), NOW)).toBeNull();
    expect(dueDunningNotice(failing({ status: 'CANCELLED', dunningNoticeStage: 3 }), NOW)).toBeNull();
  });
  it('nothing for invoice / PO / comp, a healthy plan, a voluntary cancel, or a stale failure', () => {
    expect(dueDunningNotice(failing({ billingMode: 'INVOICE' }), NOW)).toBeNull();
    expect(dueDunningNotice(failing({ status: 'ACTIVE' }), NOW)).toBeNull();
    expect(dueDunningNotice(paidLicense({ status: 'CANCELLED' }), NOW)).toBeNull();
    expect(dueDunningNotice(failing({ dunningFailedAt: new Date(NOW.getTime() - 90 * DAY) }), NOW)).toBeNull();
  });
  it('the view-only state is the existing `cancelled` state: read-only, pairing blocked', () => {
    const b = billingStateOf(paidLicense({ status: 'CANCELLED' }), NOW, true);
    expect(b).toMatchObject({ state: 'cancelled', readOnly: true, pairingBlocked: true });
    const p = billingStateOf(paidLicense({ status: 'PAST_DUE' }), NOW, true);
    expect(p).toMatchObject({ state: 'past_due', readOnly: false, pairingBlocked: true });
  });
});

describe('dunningEmail — en / es / zh', () => {
  it.each(['en', 'es', 'zh'])('%s: every stage names the link, and says screens + alerts keep working', (locale) => {
    for (const stage of [1, 2, 3] as const) {
      const m = dunningEmail({ stage, locale, orgName: 'Taco Town', nextAttemptAt: new Date(NOW.getTime() + 2 * DAY), billingUrl: 'https://app/taco/settings/billing' });
      expect(m.body).toContain('https://app/taco/settings/billing');
      expect(m.body).toContain('Taco Town');
      expect(m.subject.length).toBeGreaterThan(5);
      expect(m.kind).toBe(['BILLING_CARD_DECLINED', 'BILLING_CARD_REMINDER', 'BILLING_VIEW_ONLY'][stage - 1]);
    }
  });
  it('a different language really is different', () => {
    const en = dunningEmail({ stage: 1, locale: 'en', orgName: 'X', nextAttemptAt: null, billingUrl: 'u' });
    const es = dunningEmail({ stage: 1, locale: 'es', orgName: 'X', nextAttemptAt: null, billingUrl: 'u' });
    const zh = dunningEmail({ stage: 1, locale: 'zh', orgName: 'X', nextAttemptAt: null, billingUrl: 'u' });
    expect(new Set([en.subject, es.subject, zh.subject]).size).toBe(3);
  });
});

describe('Webhook — stamps, resets per invoice, clears', () => {
  const invoiceEvt = (type: string, id: string, created: number, next: number | null) => ({
    id: `evt_${type}_${id}_${created}`,
    type,
    created,
    data: { object: { id, customer: 'cus_1', subscription: 'sub_1', next_payment_attempt: next } },
  });

  function svcWith(licenses: Lic[], subStatus: { v: string }) {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    const { prisma, audit } = fakePrisma(licenses);
    const svc = new StripeService(prisma);
    jest.spyOn(svc, 'getClient').mockReturnValue({
      subscriptions: { retrieve: async () => ({ id: 'sub_1', status: subStatus.v }) },
    } as any);
    return { svc, audit };
  }

  it('payment_failed → PAST_DUE + the invoice, first-failure time and next retry stamped', async () => {
    const lic = paidLicense();
    const next = sec(NOW) + 3 * 86400;
    const { svc } = svcWith([lic], { v: 'past_due' });
    await svc.handleWebhookEvent(invoiceEvt('invoice.payment_failed', 'in_1', sec(NOW), next) as any);
    expect(lic.status).toBe('PAST_DUE');
    expect(lic.dunningInvoiceId).toBe('in_1');
    expect(lic.dunningNoticeStage).toBe(0);
    expect(lic.dunningFailedAt.getTime()).toBe(sec(NOW) * 1000);
    expect(lic.dunningNextAttemptAt.getTime()).toBe(next * 1000);
  });

  it('a retry of the SAME invoice keeps the stage and first-failure time; only the next retry moves', async () => {
    const first = new Date(NOW.getTime() - 2 * DAY);
    const lic = paidLicense({ status: 'PAST_DUE', dunningInvoiceId: 'in_1', dunningNoticeStage: 1, dunningFailedAt: first });
    const { svc } = svcWith([lic], { v: 'past_due' });
    await svc.handleWebhookEvent(invoiceEvt('invoice.payment_failed', 'in_1', sec(NOW), null) as any);
    expect(lic.dunningNoticeStage).toBe(1);
    expect(lic.dunningFailedAt).toBe(first);
    expect(lic.dunningNextAttemptAt).toBeNull();
  });

  it('a NEW failing invoice resets the stage — each email at most once PER INVOICE', async () => {
    const lic = paidLicense({ status: 'PAST_DUE', dunningInvoiceId: 'in_old', dunningNoticeStage: 2, dunningFailedAt: new Date(NOW.getTime() - 40 * DAY) });
    const { svc } = svcWith([lic], { v: 'past_due' });
    await svc.handleWebhookEvent(invoiceEvt('invoice.payment_failed', 'in_new', sec(NOW), sec(NOW) + 86400) as any);
    expect(lic.dunningInvoiceId).toBe('in_new');
    expect(lic.dunningNoticeStage).toBe(0);
  });

  it('a payment that goes through clears the failure and recovers ACTIVE', async () => {
    const lic = paidLicense({ status: 'PAST_DUE', dunningInvoiceId: 'in_1', dunningNoticeStage: 1, dunningFailedAt: NOW });
    const { svc } = svcWith([lic], { v: 'active' });
    await svc.handleWebhookEvent(invoiceEvt('invoice.paid', 'in_1', sec(NOW) + 10, null) as any);
    expect(lic).toMatchObject({ status: 'ACTIVE', dunningInvoiceId: null, dunningNoticeStage: 0, dunningFailedAt: null });
  });

  it('all retries failed + dashboard left on "mark unpaid" → CANCELLED (view-only), failure kept for the email', async () => {
    const lic = paidLicense({ status: 'PAST_DUE', dunningInvoiceId: 'in_1', dunningNoticeStage: 2, dunningFailedAt: NOW });
    const { svc } = svcWith([lic], { v: 'unpaid' });
    await svc.handleWebhookEvent(invoiceEvt('invoice.payment_failed', 'in_1', sec(NOW) + 20, null) as any);
    expect(lic.status).toBe('CANCELLED');
    expect(lic.dunningInvoiceId).toBe('in_1');
  });
});

describe('BillingNotice cron — card-failure emails, once each', () => {
  const admins = [
    { email: 'owner@taco.test', role: 'DISTRICT_ADMIN', status: 'ACTIVE' },
    { email: 'starter@taco.invalid', role: 'SCHOOL_ADMIN', status: 'ACTIVE' },
    { email: 'staff@taco.test', role: 'CONTRIBUTOR', status: 'ACTIVE' },
  ];

  it('declined → reminder → view-only, each sent once, to real admin addresses only, audited', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    const lic = paidLicense({
      status: 'PAST_DUE',
      dunningInvoiceId: 'in_1',
      dunningFailedAt: NOW,
      dunningNextAttemptAt: new Date(NOW.getTime() + 3 * DAY),
      noticeLocale: 'es',
    });
    const { prisma, audit } = fakePrisma([lic], admins);
    const sent: any[] = [];
    const email: any = { sendBillingNotice: async (m: any) => (sent.push(m), 'queued') };
    const cron = new TrialReminderCron(prisma, email);

    await cron.runDunning(NOW);
    await cron.runDunning(new Date(NOW.getTime() + 60_000)); // same day again → nothing
    expect(sent.map((m) => m.kind)).toEqual(['BILLING_CARD_DECLINED']);
    expect(sent[0].to).toBe('owner@taco.test');
    expect(sent[0].subject).toMatch(/tarjeta/);

    await cron.runDunning(new Date(NOW.getTime() + 3 * DAY));
    expect(sent.map((m) => m.kind)).toEqual(['BILLING_CARD_DECLINED', 'BILLING_CARD_REMINDER']);

    lic.status = 'CANCELLED';
    await cron.runDunning(new Date(NOW.getTime() + 8 * DAY));
    await cron.runDunning(new Date(NOW.getTime() + 9 * DAY));
    expect(sent.map((m) => m.kind)).toEqual(['BILLING_CARD_DECLINED', 'BILLING_CARD_REMINDER', 'BILLING_VIEW_ONLY']);
    expect(audit.filter((a) => a.action === 'BILLING_CARD_NOTICE_SENT')).toHaveLength(3);
  });

  it('does nothing when Stripe is not configured', async () => {
    const { prisma } = fakePrisma([paidLicense({ status: 'PAST_DUE', dunningInvoiceId: 'in_1', dunningFailedAt: NOW })], admins);
    const email: any = { sendBillingNotice: jest.fn() };
    const r = await new TrialReminderCron(prisma, email).runDunning(NOW);
    expect(r.sent).toBe(0);
    expect(email.sendBillingNotice).not.toHaveBeenCalled();
  });
});

describe('Update card → Stripe → "You\'re all set"', () => {
  it('the portal opens straight on the payment-method flow and returns to ?card=updated', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    const { prisma } = fakePrisma([paidLicense({ status: 'PAST_DUE' })]);
    const svc = new StripeService(prisma);
    const create = jest.fn(async (_p: any) => ({ url: 'https://billing.stripe.test/p' }));
    jest.spyOn(svc, 'getClient').mockReturnValue({ billingPortal: { sessions: { create } } } as any);
    await svc.portalForTenant('t1', 'https://app/taco/settings/billing', {
      updateCard: { completedUrl: 'https://app/taco/settings/billing?card=updated' },
    });
    expect(create.mock.calls[0][0]).toMatchObject({
      customer: 'cus_1',
      flow_data: {
        type: 'payment_method_update',
        after_completion: { type: 'redirect', redirect: { return_url: 'https://app/taco/settings/billing?card=updated' } },
      },
    });
  });

  it('retry charges the open invoice with the NEW default card, recovers ACTIVE, clears the failure, audits', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    const lic = paidLicense({ status: 'PAST_DUE', dunningInvoiceId: 'in_1', dunningFailedAt: NOW });
    const { prisma, audit } = fakePrisma([lic]);
    const svc = new StripeService(prisma);
    let paid = false;
    const pay = jest.fn(async () => ((paid = true), {}));
    jest.spyOn(svc, 'getClient').mockReturnValue({
      subscriptions: {
        retrieve: async () => ({ id: 'sub_1', status: paid ? 'active' : 'past_due', latest_invoice: { id: 'in_1', status: 'open' } }),
      },
      customers: { retrieve: async () => ({ invoice_settings: { default_payment_method: 'pm_new' } }) },
      invoices: { pay },
    } as any);
    const r = await svc.retryAfterCardUpdate('t1', 'u-admin');
    expect(r).toEqual({ result: 'paid' });
    expect(pay).toHaveBeenCalledWith('in_1', { payment_method: 'pm_new' });
    expect(lic).toMatchObject({ status: 'ACTIVE', dunningInvoiceId: null });
    expect(audit.find((a) => a.action === 'BILLING_PAYMENT_RETRIED')).toMatchObject({ userId: 'u-admin' });
  });

  it('a declined new card says so and changes nothing', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    const lic = paidLicense({ status: 'PAST_DUE', dunningInvoiceId: 'in_1', dunningFailedAt: NOW });
    const { prisma } = fakePrisma([lic]);
    const svc = new StripeService(prisma);
    jest.spyOn(svc, 'getClient').mockReturnValue({
      subscriptions: { retrieve: async () => ({ id: 'sub_1', status: 'past_due', latest_invoice: { id: 'in_1', status: 'open' } }) },
      customers: { retrieve: async () => ({ invoice_settings: { default_payment_method: 'pm_bad' } }) },
      invoices: { pay: async () => { throw new Error('Your card was declined.'); } },
    } as any);
    const r = await svc.retryAfterCardUpdate('t1', 'u-admin');
    expect(r).toEqual({ result: 'declined', message: 'Your card was declined.' });
    expect(lic.status).toBe('PAST_DUE');
    expect(lic.dunningInvoiceId).toBe('in_1');
  });
});

describe('Restart after view-only — never two subscriptions', () => {
  it('cancels a leftover unpaid subscription before opening Checkout', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_MONTHLY = 'price_m';
    const { prisma } = fakePrisma([paidLicense({ status: 'CANCELLED' })]);
    (prisma.client as any).screen = { count: async () => 2 };
    const svc = new StripeService(prisma);
    const cancel = jest.fn(async () => ({}));
    const create = jest.fn(async () => ({ url: 'https://checkout.stripe.test/s' }));
    jest.spyOn(svc, 'getClient').mockReturnValue({
      subscriptions: { retrieve: async () => ({ id: 'sub_1', status: 'unpaid' }), cancel },
      checkout: { sessions: { create } },
    } as any);
    const r = await svc.checkoutForTenant({ tenantId: 't1', period: 'monthly', successUrl: 's', cancelUrl: 'c', now: NOW });
    delete process.env.STRIPE_PRICE_MONTHLY;
    expect(cancel).toHaveBeenCalledWith('sub_1');
    expect(r.url).toBe('https://checkout.stripe.test/s');
    expect((create.mock.calls[0] as any)[0].customer).toBe('cus_1');
  });
});
