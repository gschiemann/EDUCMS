/**
 * SELF-SERVE TRIAL → PAID (2026-10-11) — the server side, end to end over
 * hand-rolled fakes (no Stripe, no database):
 *   - Checkout keeps the remaining trial days (trial_end), pre-fills quantity
 *     (adjustable, never below what is paired) and the email;
 *   - the webhook turns a trialing subscription into a paid License (seats =
 *     quantity, trialEndsAt mirrored), and past_due / unpaid / canceled land
 *     where the dashboard can still fix them;
 *   - "Add 1 screen" updates the Stripe quantity WITH proration and audits it;
 *   - the quantity sync only ever raises;
 *   - reminder emails go out once per stage, never for invoice customers;
 *   - pairing after an ended trial is a clear 402 TRIAL_ENDED; a full card
 *     plan answers LICENSE_EXHAUSTED with `canAddSeat`;
 *   - the read-only gate never touches screens, emergency, GETs or billing.
 */
import { of, lastValueFrom } from 'rxjs';
import { StripeService, SeatChangeError } from './stripe.service';
import { TrialReminderCron } from './trial-reminder.cron';
import { BillingReadOnlyGate, BillingReadOnlyInterceptor } from './billing-gate.interceptor';
import { LicenseService } from '../license/license.service';
import { TRIAL_NOTICE } from './trial-policy';

const DAY = 86_400_000;
const NOW = new Date('2026-10-11T12:00:00Z');
const KEYS = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_MONTHLY: 'price_m', STRIPE_PRICE_ANNUAL: 'price_a' };

function withBilling() {
  Object.assign(process.env, KEYS);
}
function withoutBilling() {
  for (const k of Object.keys(KEYS)) delete process.env[k];
}
afterEach(() => withoutBilling());

type Lic = Record<string, any>;

function fakePrisma(opts: { licenses?: Lic[]; paired?: number; users?: Lic[]; tenants?: Lic[] } = {}) {
  const licenses = opts.licenses ?? [];
  const audit: Lic[] = [];
  const tx: any = {
    license: {
      findUnique: async ({ where }: any) => licenses.find((l) => l.tenantId === where.tenantId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const cur = licenses.find((l) => l.tenantId === where.tenantId);
        if (cur) return Object.assign(cur, update);
        const row = { id: `lic-${where.tenantId}`, ...create };
        licenses.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const l of licenses) {
          if (where.id && l.id !== where.id) continue;
          if (where.tenantId && l.tenantId !== where.tenantId) continue;
          if (where.trialNoticeStage?.lt !== undefined && !((l.trialNoticeStage ?? 0) < where.trialNoticeStage.lt)) continue;
          Object.assign(l, data);
          count++;
        }
        return { count };
      },
      findFirst: async ({ where }: any) =>
        licenses.find(
          (l) =>
            (where.stripeCustomerId && l.stripeCustomerId === where.stripeCustomerId) ||
            (where.stripeSubscriptionId && l.stripeSubscriptionId === where.stripeSubscriptionId),
        ) ?? null,
      findMany: async () => licenses.map((l) => ({ ...l, tenant: { name: 'Taco Town', slug: 'taco' } })),
    },
    auditLog: { create: async ({ data }: any) => (audit.push(data), data), findFirst: async () => null },
    screen: { count: async () => opts.paired ?? 0 },
    user: { findMany: async () => opts.users ?? [] },
    tenant: {
      findUnique: async ({ where }: any) => {
        const t = (opts.tenants ?? [{ id: where.id, parentId: null }]).find((x) => x.id === where.id);
        if (!t) return null;
        return { id: t.id, parentId: t.parentId ?? null, license: licenses.find((l) => l.tenantId === t.id) ?? null, parent: null };
      },
    },
    processedStripeEvent: { create: async () => ({}), delete: async () => ({}) },
  };
  const client: any = { ...tx, $transaction: async (fn: any) => fn(tx) };
  return { prisma: { client } as any, licenses, audit };
}

function trialLicense(endsInDays: number, extra: Lic = {}): Lic {
  return {
    id: 'lic-t1',
    tenantId: 't1',
    tier: 'FREE_TRIAL',
    billingMode: 'CARD',
    status: 'ACTIVE',
    seatLimit: 3,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeLastEventCreatedAt: null,
    trialEndsAt: new Date(NOW.getTime() + endsInDays * DAY),
    trialNoticeStage: 0,
    ...extra,
  };
}

describe('Checkout — pre-filled, trial-preserving', () => {
  it('a card added on day 4 bills from the ORIGINAL trial end; quantity = paired, adjustable; email pre-filled', async () => {
    withBilling();
    const { prisma } = fakePrisma({ licenses: [trialLicense(10)], paired: 2 });
    const svc = new StripeService(prisma);
    const create = jest.fn(async (_p: any) => ({ url: 'https://checkout.stripe.test/s' }));
    jest.spyOn(svc, 'getClient').mockReturnValue({ checkout: { sessions: { create } } } as any);
    const res = await svc.checkoutForTenant({ tenantId: 't1', period: 'annual', successUrl: 's', cancelUrl: 'c', customerEmail: 'owner@taco.test', now: NOW });
    expect(res.url).toBe('https://checkout.stripe.test/s');
    const p = create.mock.calls[0][0];
    expect(p.mode).toBe('subscription');
    expect(p.line_items[0]).toEqual({
      price: 'price_a',
      quantity: 2,
      adjustable_quantity: { enabled: true, minimum: 2, maximum: 1000 },
    });
    expect(p.subscription_data.trial_end).toBe(Math.ceil((NOW.getTime() + 10 * DAY) / 1000));
    expect(p.payment_method_collection).toBe('always');
    expect(p.customer_email).toBe('owner@taco.test');
    expect(p.client_reference_id).toBe('t1');
    expect(p.metadata).toMatchObject({ tenantId: 't1', period: 'annual', trialConversion: '1' });
  });

  it('after the trial ended, billing starts today (no trial_end); quantity floor is 1', async () => {
    withBilling();
    const { prisma } = fakePrisma({ licenses: [trialLicense(-3)], paired: 0 });
    const svc = new StripeService(prisma);
    const create = jest.fn(async (_p: any) => ({ url: 'u' }));
    jest.spyOn(svc, 'getClient').mockReturnValue({ checkout: { sessions: { create } } } as any);
    await svc.checkoutForTenant({ tenantId: 't1', period: 'monthly', successUrl: 's', cancelUrl: 'c', now: NOW });
    const p = create.mock.calls[0][0];
    expect(p.subscription_data.trial_end).toBeUndefined();
    expect(p.line_items[0].quantity).toBe(1);
    expect(p.line_items[0].price).toBe('price_m');
  });
});

describe('Webhook — trial → active → past_due → cancelled', () => {
  const sub = (status: string, extra: Lic = {}) => ({
    id: 'sub_1',
    customer: 'cus_1',
    status,
    metadata: { tenantId: 't1' },
    trial_end: Math.floor((NOW.getTime() + 10 * DAY) / 1000),
    items: { data: [{ id: 'si_1', quantity: 4, price: { unit_amount: 2500, recurring: { interval: 'month' } } }] },
    ...extra,
  });
  const evt = (type: string, object: Lic, created: number) => ({ id: `evt_${type}_${created}`, type, created, data: { object } });

  it('trialing subscription → MONTHLY, ACTIVE, seats = quantity, trial end mirrored (state trial_card)', async () => {
    withBilling();
    const { prisma, licenses, audit } = fakePrisma({ licenses: [trialLicense(10)] });
    const svc = new StripeService(prisma);
    jest.spyOn(svc, 'getClient').mockReturnValue({} as any);
    await svc.handleWebhookEvent(evt('customer.subscription.created', sub('trialing'), 1000) as any);
    expect(licenses[0]).toMatchObject({
      tier: 'MONTHLY',
      status: 'ACTIVE',
      seatLimit: 4,
      stripeSubscriptionId: 'sub_1',
      billingMode: 'CARD',
    });
    expect(licenses[0].trialEndsAt.getTime()).toBe(Math.floor((NOW.getTime() + 10 * DAY) / 1000) * 1000);
    expect(audit.some((a) => a.action === 'STRIPE_WEBHOOK_CUSTOMER_SUBSCRIPTION_CREATED')).toBe(true);
  });

  it('past_due lands on PAST_DUE (fixable from Billing); unpaid (all retries failed) on CANCELLED = view-only — never the owner SUSPENDED lock', async () => {
    withBilling();
    const { prisma, licenses } = fakePrisma({ licenses: [trialLicense(10)] });
    const svc = new StripeService(prisma);
    jest.spyOn(svc, 'getClient').mockReturnValue({} as any);
    await svc.handleWebhookEvent(evt('customer.subscription.updated', sub('past_due'), 2000) as any);
    expect(licenses[0].status).toBe('PAST_DUE');
    // Greg 2026-10-11: card failure ends in view-only. `unpaid` = the dashboard's
    // "mark as unpaid" after the last retry — same outcome as "cancel".
    await svc.handleWebhookEvent(evt('customer.subscription.updated', sub('unpaid'), 3000) as any);
    expect(licenses[0].status).toBe('CANCELLED');
    await svc.handleWebhookEvent(evt('customer.subscription.updated', sub('active'), 4000) as any);
    expect(licenses[0].status).toBe('ACTIVE');
  });

  it('customer.subscription.deleted → CANCELLED', async () => {
    withBilling();
    const { prisma, licenses } = fakePrisma({ licenses: [trialLicense(10, { stripeSubscriptionId: 'sub_1', tier: 'MONTHLY' })] });
    const svc = new StripeService(prisma);
    jest.spyOn(svc, 'getClient').mockReturnValue({} as any);
    await svc.handleWebhookEvent(evt('customer.subscription.deleted', { id: 'sub_1' }, 5000) as any);
    expect(licenses[0].status).toBe('CANCELLED');
  });
});

describe('Seats — add a screen with proration', () => {
  const paidLicense = (extra: Lic = {}) =>
    trialLicense(-30, { tier: 'MONTHLY', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', seatLimit: 3, ...extra });

  it('updates the Stripe quantity with create_prorations, mirrors seatLimit, audits who did it', async () => {
    withBilling();
    const { prisma, licenses, audit } = fakePrisma({ licenses: [paidLicense()], paired: 3 });
    const svc = new StripeService(prisma);
    const update = jest.fn(async () => ({}));
    jest.spyOn(svc, 'getClient').mockReturnValue({
      subscriptions: { retrieve: async () => ({ items: { data: [{ id: 'si_1', quantity: 3 }] } }) },
      subscriptionItems: { update },
    } as any);
    const r = await svc.setSeatQuantity({ tenantId: 't1', quantity: 4, actorUserId: 'u1' });
    expect(r).toEqual({ seatLimit: 4, previous: 3 });
    expect(update).toHaveBeenCalledWith('si_1', { quantity: 4, proration_behavior: 'create_prorations' });
    expect(licenses[0].seatLimit).toBe(4);
    expect(audit).toContainEqual(expect.objectContaining({ action: 'BILLING_SEATS_CHANGED', userId: 'u1' }));
  });

  it('refuses fewer seats than paired screens, a past-due plan, and a customer with no card plan', async () => {
    withBilling();
    const stripeFake = {
      subscriptions: { retrieve: async () => ({ items: { data: [{ id: 'si_1', quantity: 3 }] } }) },
      subscriptionItems: { update: jest.fn() },
    } as any;
    const a = fakePrisma({ licenses: [paidLicense()], paired: 3 });
    const svcA = new StripeService(a.prisma);
    jest.spyOn(svcA, 'getClient').mockReturnValue(stripeFake);
    await expect(svcA.setSeatQuantity({ tenantId: 't1', quantity: 2, actorUserId: null })).rejects.toMatchObject({ code: 'BILLING_SEATS_INVALID' });

    const b = fakePrisma({ licenses: [paidLicense({ status: 'PAST_DUE' })], paired: 3 });
    const svcB = new StripeService(b.prisma);
    jest.spyOn(svcB, 'getClient').mockReturnValue(stripeFake);
    await expect(svcB.setSeatQuantity({ tenantId: 't1', quantity: 4, actorUserId: null })).rejects.toBeInstanceOf(SeatChangeError);

    const c = fakePrisma({ licenses: [trialLicense(5)], paired: 3 });
    const svcC = new StripeService(c.prisma);
    jest.spyOn(svcC, 'getClient').mockReturnValue(stripeFake);
    await expect(svcC.setSeatQuantity({ tenantId: 't1', quantity: 4, actorUserId: null })).rejects.toMatchObject({ code: 'BILLING_NO_SUBSCRIPTION' });
    expect(stripeFake.subscriptionItems.update).not.toHaveBeenCalled();
  });

  it('the quantity sync only RAISES (pre-bought seats are never taken away)', async () => {
    withBilling();
    const update = jest.fn(async () => ({}));
    const fakeStripe = (q: number) =>
      ({ subscriptions: { retrieve: async () => ({ items: { data: [{ id: 'si_1', quantity: q }] } }) }, subscriptionItems: { update } }) as any;

    const above = fakePrisma({ licenses: [paidLicense({ seatLimit: 10 })], paired: 3 });
    const s1 = new StripeService(above.prisma);
    jest.spyOn(s1, 'getClient').mockReturnValue(fakeStripe(10));
    expect(await s1.syncSubscriptionQuantity('t1')).toMatchObject({ status: 'in-sync' });
    expect(update).not.toHaveBeenCalled();

    const below = fakePrisma({ licenses: [paidLicense({ seatLimit: 2 })], paired: 3 });
    const s2 = new StripeService(below.prisma);
    jest.spyOn(s2, 'getClient').mockReturnValue(fakeStripe(2));
    expect(await s2.syncSubscriptionQuantity('t1')).toMatchObject({ status: 'corrected', from: 2, to: 3 });
    expect(update).toHaveBeenCalledWith('si_1', { quantity: 3, proration_behavior: 'create_prorations' });
    expect(below.licenses[0].seatLimit).toBe(3);
  });
});

describe('Trial reminder emails', () => {
  const email = () => ({ sendBillingNotice: jest.fn(async () => 'SENT') }) as any;
  const admins = [{ email: 'owner@taco.test' }, { email: 'starter@x.setup.venueos.invalid' }];

  it('sends the 7-day notice once, in the signup language, to real admin addresses only', async () => {
    withBilling();
    const { prisma, licenses, audit } = fakePrisma({ licenses: [trialLicense(6, { noticeLocale: 'es' })], users: admins });
    const mail = email();
    const cron = new TrialReminderCron(prisma, mail);
    expect(await cron.runAll(NOW)).toMatchObject({ sent: 1 });
    expect(mail.sendBillingNotice).toHaveBeenCalledTimes(1);
    const arg = mail.sendBillingNotice.mock.calls[0][0];
    expect(arg.to).toBe('owner@taco.test');
    expect(arg.kind).toBe('TRIAL_REMINDER_7D');
    expect(arg.subject).toMatch(/prueba gratuita/);
    expect(arg.body).toContain('/taco/settings/billing');
    expect(licenses[0].trialNoticeStage).toBe(TRIAL_NOTICE.SEVEN_DAYS);
    expect(audit.some((a) => a.action === 'BILLING_TRIAL_NOTICE_SENT')).toBe(true);
    // second pass: nothing new
    expect(await cron.runAll(NOW)).toMatchObject({ sent: 0 });
    expect(mail.sendBillingNotice).toHaveBeenCalledTimes(1);
  });

  it('1-day and ended notices; the ended mail says screens keep playing', async () => {
    withBilling();
    const { prisma } = fakePrisma({ licenses: [trialLicense(-0.2, { trialNoticeStage: 2 })], users: admins });
    const mail = email();
    await new TrialReminderCron(prisma, mail).runAll(NOW);
    const arg = mail.sendBillingNotice.mock.calls[0][0];
    expect(arg.kind).toBe('TRIAL_ENDED');
    expect(arg.body).toMatch(/keep showing their content/);
    expect(arg.body).toMatch(/emergency alerts keep working/);
  });

  it('never runs while card billing is not live', async () => {
    const { prisma } = fakePrisma({ licenses: [trialLicense(6)], users: admins });
    const mail = email();
    expect(await new TrialReminderCron(prisma, mail).runAll(NOW)).toEqual({ scanned: 0, sent: 0, skipped: 0 });
    expect(mail.sendBillingNotice).not.toHaveBeenCalled();
  });

  it('invoice / comp customers and customers with a card get nothing', async () => {
    withBilling();
    const { prisma } = fakePrisma({
      licenses: [
        trialLicense(6, { tenantId: 'a', id: 'a', billingMode: 'INVOICE' }),
        trialLicense(6, { tenantId: 'b', id: 'b', billingMode: 'COMP' }),
        trialLicense(6, { tenantId: 'c', id: 'c', stripeSubscriptionId: 'sub_c' }),
      ],
      users: admins,
    });
    const mail = email();
    expect(await new TrialReminderCron(prisma, mail).runAll(NOW)).toMatchObject({ sent: 0 });
    expect(mail.sendBillingNotice).not.toHaveBeenCalled();
  });
});

describe('Pairing gate (LicenseService.assertSeatAvailable)', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
  });
  afterAll(() => jest.useRealTimers());

  it('trial ended → 402 TRIAL_ENDED with an upgrade path', async () => {
    withBilling();
    const { prisma } = fakePrisma({ licenses: [trialLicense(-1)], paired: 1 });
    await expect(new LicenseService(prisma).assertSeatAvailable('t1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TRIAL_ENDED', canUpgrade: true }),
    });
  });

  it('trial ended but billing not live → still pairs (nobody could pay)', async () => {
    const { prisma } = fakePrisma({ licenses: [trialLicense(-1)], paired: 1 });
    await expect(new LicenseService(prisma).assertSeatAvailable('t1')).resolves.toBeUndefined();
  });

  it('trial at its 3 screens → LICENSE_EXHAUSTED with canUpgrade', async () => {
    withBilling();
    const { prisma } = fakePrisma({ licenses: [trialLicense(5)], paired: 3 });
    await expect(new LicenseService(prisma).assertSeatAvailable('t1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'LICENSE_EXHAUSTED', canUpgrade: true }),
    });
  });

  it('card plan full → LICENSE_EXHAUSTED with canAddSeat + the per-screen price (one tap, not a dead end)', async () => {
    withBilling();
    const { prisma } = fakePrisma({
      licenses: [trialLicense(-30, { tier: 'MONTHLY', stripeSubscriptionId: 'sub_1', seatLimit: 3, monthlyPriceCents: 2500 })],
      paired: 3,
    });
    await expect(new LicenseService(prisma).assertSeatAvailable('t1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'LICENSE_EXHAUSTED', canAddSeat: true, perScreenMonthlyCents: 2500 }),
    });
  });
});

describe('Read-only gate (locked trial / cancelled plan)', () => {
  // Trial fixtures use NOW; the interceptor must observe that same clock.
  beforeAll(() => { jest.useFakeTimers({ now: NOW }); });
  afterAll(() => jest.useRealTimers());

  const ctx = (req: Lic) =>
    ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) }) as any;
  const next = { handle: () => of('passed') };
  const person = (method: string, url: string, extra: Lic = {}) => ({ method, originalUrl: url, user: { tenantId: 't1', role: 'DISTRICT_ADMIN', ...extra } });

  function interceptorFor(lic: Lic | null) {
    const { prisma } = fakePrisma({ licenses: lic ? [lic] : [] });
    return new BillingReadOnlyInterceptor(new BillingReadOnlyGate(new LicenseService(prisma)));
  }
  const run = (i: BillingReadOnlyInterceptor, req: Lic) => lastValueFrom(i.intercept(ctx(req), next) as any);

  it('locked: a change is refused with BILLING_READ_ONLY; reads, billing, emergency, devices and super admins pass', async () => {
    withBilling();
    const i = interceptorFor(trialLicense(-30));
    await expect(run(i, person('POST', '/api/v1/playlists'))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BILLING_READ_ONLY' }),
    });
    await expect(run(i, person('GET', '/api/v1/playlists'))).resolves.toBe('passed');
    await expect(run(i, person('POST', '/api/v1/billing/checkout'))).resolves.toBe('passed');
    await expect(run(i, person('POST', '/api/v1/emergency/trigger'))).resolves.toBe('passed');
    await expect(run(i, person('POST', '/api/v1/screens/s1/render-proof', { kind: 'device' }))).resolves.toBe('passed');
    await expect(run(i, person('POST', '/api/v1/playlists', { role: 'SUPER_ADMIN' }))).resolves.toBe('passed');
  });

  it('inside the grace period, an invoice customer, or with billing not live: nothing is refused', async () => {
    withBilling();
    await expect(run(interceptorFor(trialLicense(-2)), person('POST', '/api/v1/playlists'))).resolves.toBe('passed');
    await expect(run(interceptorFor(trialLicense(-30, { billingMode: 'INVOICE' })), person('POST', '/api/v1/playlists'))).resolves.toBe('passed');
    withoutBilling();
    await expect(run(interceptorFor(trialLicense(-30)), person('POST', '/api/v1/playlists'))).resolves.toBe('passed');
  });
});
