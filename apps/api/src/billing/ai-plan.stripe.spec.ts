/**
 * The VenueOS + AI plan in Stripe (2026-10-12) — over hand-rolled fakes (no Stripe, no database):
 *   - Checkout picks the AI or non-AI price for the chosen interval;
 *   - the webhook stamps License.aiIncluded from the subscription's PRICE id (never metadata), and
 *     leaves it alone for a price this deploy does not know;
 *   - "switch AI on/off" moves the subscription item to the same interval's other price with
 *     proration, writes aiIncluded at once and audits it; refuses without a live card plan.
 */
import { StripeService, SeatChangeError } from './stripe.service';

const KEYS = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PRICE_MONTHLY: 'price_m',
  STRIPE_PRICE_ANNUAL: 'price_y',
  STRIPE_PRICE_MONTHLY_AI: 'price_m_ai',
  STRIPE_PRICE_ANNUAL_AI: 'price_y_ai',
};
beforeEach(() => Object.assign(process.env, KEYS));
afterEach(() => {
  for (const k of Object.keys(KEYS)) delete process.env[k];
});

type Lic = Record<string, any>;

function fakePrisma(licenses: Lic[], paired = 2) {
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
          Object.assign(l, data);
          count++;
        }
        return { count };
      },
      findFirst: async ({ where }: any) =>
        licenses.find((l) => (where.stripeCustomerId && l.stripeCustomerId === where.stripeCustomerId) || (where.stripeSubscriptionId && l.stripeSubscriptionId === where.stripeSubscriptionId)) ?? null,
    },
    auditLog: { create: async ({ data }: any) => (audit.push(data), data) },
    screen: { count: async () => paired },
    processedStripeEvent: { create: async () => ({}), delete: async () => ({}) },
  };
  const client: any = { ...tx, $transaction: async (fn: any) => fn(tx) };
  return { prisma: { client } as any, licenses, audit };
}

const cardLicense = (extra: Lic = {}): Lic => ({
  id: 'lic-t1',
  tenantId: 't1',
  tier: 'MONTHLY',
  billingMode: 'CARD',
  status: 'ACTIVE',
  seatLimit: 4,
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  stripeLastEventCreatedAt: null,
  aiIncluded: false,
  ...extra,
});

const sub = (priceId: string, interval: 'month' | 'year', unit: number) => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  metadata: { tenantId: 't1' },
  items: { data: [{ id: 'si_1', quantity: 4, price: { id: priceId, unit_amount: unit, recurring: { interval } } }] },
});
const evt = (object: Lic, created: number) => ({ id: `evt_${created}`, type: 'customer.subscription.updated', created, data: { object } });

describe('Checkout — the plan the customer chose', () => {
  it.each([
    ['monthly', false, 'price_m'],
    ['annual', false, 'price_y'],
    ['monthly', true, 'price_m_ai'],
    ['annual', true, 'price_y_ai'],
  ] as const)('%s, ai=%s → %s', async (period, ai, price) => {
    const { prisma } = fakePrisma([]);
    const svc = new StripeService(prisma);
    const create = jest.fn(async (_p: any) => ({ url: 'https://checkout.stripe.test/s' }));
    jest.spyOn(svc, 'getClient').mockReturnValue({ checkout: { sessions: { create } } } as any);
    await svc.checkoutForTenant({ tenantId: 't1', period, ai, successUrl: 's', cancelUrl: 'c' });
    expect(create.mock.calls[0][0].line_items[0].price).toBe(price);
    expect(create.mock.calls[0][0].metadata.plan).toBe(ai ? 'ai' : 'standard');
  });

  it('AI price not configured → a clear error, never the non-AI price instead', async () => {
    delete process.env.STRIPE_PRICE_ANNUAL_AI;
    const { prisma } = fakePrisma([]);
    const svc = new StripeService(prisma);
    const create = jest.fn();
    jest.spyOn(svc, 'getClient').mockReturnValue({ checkout: { sessions: { create } } } as any);
    await expect(svc.checkoutForTenant({ tenantId: 't1', period: 'annual', ai: true, successUrl: 's', cancelUrl: 'c' })).rejects.toThrow(
      /STRIPE_PRICE_ANNUAL_AI/,
    );
    expect(create).not.toHaveBeenCalled();
  });
});

describe('Webhook — aiIncluded from the subscription price', () => {
  it.each([
    ['price_m_ai', 'month', 2500, true, 2500],
    ['price_y_ai', 'year', 25000, true, 2083],
    ['price_m', 'month', 2000, false, 2000],
    ['price_y', 'year', 20000, false, 1667],
  ] as const)('%s → aiIncluded %s', async (priceId, interval, unit, ai, perMonth) => {
    const { prisma, licenses, audit } = fakePrisma([cardLicense({ aiIncluded: !ai })]);
    const svc = new StripeService(prisma);
    jest.spyOn(svc, 'getClient').mockReturnValue({} as any);
    await svc.handleWebhookEvent(evt(sub(priceId, interval, unit), 1000) as any);
    expect(licenses[0]).toMatchObject({ aiIncluded: ai, monthlyPriceCents: perMonth, tier: interval === 'year' ? 'ANNUAL' : 'MONTHLY' });
    const details = JSON.parse(audit.find((a) => a.action === 'STRIPE_WEBHOOK_CUSTOMER_SUBSCRIPTION_UPDATED').details);
    expect(details).toMatchObject({ priceId, aiIncluded: ai });
  });

  it('a first subscription (no license yet) is created with the stamp', async () => {
    const { prisma, licenses } = fakePrisma([]);
    const svc = new StripeService(prisma);
    jest.spyOn(svc, 'getClient').mockReturnValue({} as any);
    await svc.handleWebhookEvent(evt(sub('price_y_ai', 'year', 25000), 1000) as any);
    expect(licenses[0]).toMatchObject({ tenantId: 't1', aiIncluded: true });
  });

  it('a price this deploy does not know (legacy $25 / env drift) leaves aiIncluded exactly as it was', async () => {
    const { prisma, licenses, audit } = fakePrisma([cardLicense({ aiIncluded: true })]);
    const svc = new StripeService(prisma);
    jest.spyOn(svc, 'getClient').mockReturnValue({} as any);
    await svc.handleWebhookEvent(evt(sub('price_legacy', 'month', 2500), 1000) as any);
    expect(licenses[0].aiIncluded).toBe(true);
    expect(JSON.parse(audit[0].details).aiIncluded).toBe('unchanged');
  });

  it('metadata can never grant AI — only the price can', async () => {
    const { prisma, licenses } = fakePrisma([cardLicense()]);
    const svc = new StripeService(prisma);
    jest.spyOn(svc, 'getClient').mockReturnValue({} as any);
    const s = { ...sub('price_m', 'month', 2000), metadata: { tenantId: 't1', plan: 'ai' } };
    await svc.handleWebhookEvent(evt(s, 1000) as any);
    expect(licenses[0].aiIncluded).toBe(false);
  });
});

describe('Switch AI on / off (setAiPlan)', () => {
  function stripeWith(priceId: string) {
    const update = jest.fn(async () => ({}));
    const client = {
      subscriptions: { retrieve: jest.fn(async () => ({ items: { data: [{ id: 'si_1', quantity: 4, price: { id: priceId } }] } })) },
      subscriptionItems: { update },
    };
    return { client, update };
  }

  it('AI on: same interval, AI price, prorated; aiIncluded written at once; audited', async () => {
    const { prisma, licenses, audit } = fakePrisma([cardLicense({ tier: 'ANNUAL' })]);
    const svc = new StripeService(prisma);
    const { client, update } = stripeWith('price_y');
    jest.spyOn(svc, 'getClient').mockReturnValue(client as any);
    expect(await svc.setAiPlan({ tenantId: 't1', ai: true, actorUserId: 'u1' })).toEqual({ aiIncluded: true, changed: true });
    expect(update).toHaveBeenCalledWith('si_1', { price: 'price_y_ai', quantity: 4, proration_behavior: 'create_prorations' });
    expect(licenses[0].aiIncluded).toBe(true);
    expect(audit[0]).toMatchObject({ action: 'BILLING_AI_PLAN_CHANGED', userId: 'u1', tenantId: 't1' });
    expect(JSON.parse(audit[0].details)).toMatchObject({ from: false, to: true, period: 'annual', toPrice: 'price_y_ai' });
  });

  it('AI off: back to the plan without AI', async () => {
    const { prisma, licenses } = fakePrisma([cardLicense({ aiIncluded: true })]);
    const svc = new StripeService(prisma);
    const { client, update } = stripeWith('price_m_ai');
    jest.spyOn(svc, 'getClient').mockReturnValue(client as any);
    await svc.setAiPlan({ tenantId: 't1', ai: false, actorUserId: 'u1' });
    expect(update).toHaveBeenCalledWith('si_1', expect.objectContaining({ price: 'price_m' }));
    expect(licenses[0].aiIncluded).toBe(false);
  });

  it('already on that plan → no Stripe write (and a drifted aiIncluded is healed)', async () => {
    const { prisma, licenses } = fakePrisma([cardLicense({ aiIncluded: false })]);
    const svc = new StripeService(prisma);
    const { client, update } = stripeWith('price_m_ai');
    jest.spyOn(svc, 'getClient').mockReturnValue(client as any);
    expect(await svc.setAiPlan({ tenantId: 't1', ai: true, actorUserId: 'u1' })).toEqual({ aiIncluded: true, changed: false });
    expect(update).not.toHaveBeenCalled();
    expect(licenses[0].aiIncluded).toBe(true);
  });

  it('refuses without a live card subscription, and for a custom price', async () => {
    const none = fakePrisma([cardLicense({ stripeSubscriptionId: null })]);
    const a = new StripeService(none.prisma);
    jest.spyOn(a, 'getClient').mockReturnValue(stripeWith('price_m').client as any);
    await expect(a.setAiPlan({ tenantId: 't1', ai: true, actorUserId: null })).rejects.toBeInstanceOf(SeatChangeError);

    const custom = fakePrisma([cardLicense()]);
    const b = new StripeService(custom.prisma);
    const s = stripeWith('price_custom_deal');
    jest.spyOn(b, 'getClient').mockReturnValue(s.client as any);
    await expect(b.setAiPlan({ tenantId: 't1', ai: true, actorUserId: null })).rejects.toMatchObject({ code: 'BILLING_PLAN_UNKNOWN' });
    expect(s.update).not.toHaveBeenCalled();
  });
});
