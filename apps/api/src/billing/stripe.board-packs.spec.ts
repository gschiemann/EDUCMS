/**
 * AI BOARD PACKS through Stripe (2026-09-23) — the one-off Checkout, and the webhook that credits it.
 *
 * FIXTURES ARE THE PRODUCER'S SHAPE. Every session below is typed as the Stripe SDK's own Checkout
 * Session (stripe-node 22.1.1, the version this API ships), so a misspelled or
 * invented field is a compile error under `tsc -p apps/api/tsconfig.json`, and the event envelope
 * is the same `{ id, type, created, data: { object } }` the existing billing specs use. The values
 * are what Stripe sends for a completed card payment: mode 'payment', status 'complete',
 * payment_status 'paid', amount_total in cents, subscription null.
 *
 * The Prisma double enforces the one invariant that matters here the way Postgres does: a second
 * purchase row with the same stripe_session_id is a P2002 (proved against a real database in
 * apps/api/scripts/verify-board-credits-sql.ts).
 */
import type StripeCtor from 'stripe';
import { StripeService, type StripeWebhookEvent } from './stripe.service';

// stripe-node 22 exports the constructor, not the resource namespace — so the Session type is taken
// from the SDK's own retrieve() signature: exactly what Stripe returns for a Checkout Session.
type Session = Partial<Awaited<ReturnType<InstanceType<typeof StripeCtor>['checkout']['sessions']['retrieve']>>>;

function makeFake(orgs: string[] = ['org_A', 'school_A1']) {
  const processed = new Map<string, { id: string; type: string }>();
  const purchases: any[] = [];
  const auditLogs: any[] = [];
  const licenses = new Map<string, any>();
  const tx = {
    aiCreditPurchase: {
      create: jest.fn(async ({ data }: any) => {
        if (purchases.some((p) => p.stripeSessionId === data.stripeSessionId)) {
          throw Object.assign(new Error('Unique constraint failed on the fields: (`stripe_session_id`)'), { code: 'P2002' });
        }
        const row = { id: `pur_${purchases.length + 1}`, ...data };
        purchases.push(row);
        return row;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }),
    },
    license: {
      findUnique: jest.fn(async ({ where }: any) => licenses.get(where.tenantId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const row = { id: `lic_${where.tenantId}`, tenantId: where.tenantId, ...(licenses.get(where.tenantId) ? update : create) };
        licenses.set(where.tenantId, row);
        return row;
      }),
    },
  };
  const client = {
    processedStripeEvent: {
      create: jest.fn(async ({ data }: any) => {
        if (processed.has(data.id)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        processed.set(data.id, data);
        return data;
      }),
      delete: jest.fn(async ({ where }: any) => {
        processed.delete(where.id);
        return { id: where.id };
      }),
    },
    tenant: {
      findUnique: jest.fn(async ({ where }: any) => (orgs.includes(where.id) ? { id: where.id } : null)),
    },
    license: {
      findUnique: jest.fn(async ({ where }: any) => licenses.get(where.tenantId) ?? null),
      findFirst: jest.fn(async () => null),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  return { prisma: { client } as any, purchases, auditLogs, processed, licenses, client, tx };
}

/** A completed, PAID card payment for the 'standard' pack, as Stripe sends it. */
function packSession(over: Session = {}): Session {
  return {
    id: 'cs_test_b1PackStandard',
    object: 'checkout.session',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    amount_subtotal: 1900,
    amount_total: 1900,
    currency: 'usd',
    client_reference_id: 'org_A',
    customer: 'cus_test_org_A',
    payment_intent: 'pi_test_1',
    subscription: null,
    livemode: false,
    created: 1_790_000_000,
    success_url: 'https://app.example/org-a/settings/billing?boards=success',
    cancel_url: 'https://app.example/org-a/settings/billing?boards=cancelled',
    metadata: {
      kind: 'ai_board_pack',
      orgTenantId: 'org_A',
      tenantId: 'school_A1',
      userId: 'user_1',
      pack: 'standard',
      boards: '30',
      usdMicros: '19000000',
    },
    ...over,
  };
}

let seq = 0;
function eventFor(type: string, session: Session, id?: string): StripeWebhookEvent {
  seq += 1;
  return { id: id ?? `evt_test_${seq}`, type, created: 1_790_000_100 + seq, data: { object: session as Record<string, any> } };
}

describe('AI board packs — the webhook credits a PAID session exactly once', () => {
  let fake: ReturnType<typeof makeFake>;
  let svc: StripeService;
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
    fake = makeFake();
    svc = new StripeService(fake.prisma);
  });
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('a paid pack session → ONE purchase row (as sold, at what was charged, good for 12 months) + its audit row', async () => {
    const before = Date.now();
    const res = await svc.handleWebhookEvent(eventFor('checkout.session.completed', packSession()));
    expect(res).toEqual({});
    expect(fake.purchases).toHaveLength(1);
    const p = fake.purchases[0];
    expect(p).toMatchObject({ orgTenantId: 'org_A', stripeSessionId: 'cs_test_b1PackStandard', pack: 'standard', boards: 30, usdMicros: 19_000_000 });
    const expires = new Date(p.createdAt);
    expires.setUTCMonth(expires.getUTCMonth() + 12);
    expect(p.expiresAt.getTime()).toBe(expires.getTime());
    expect(p.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(fake.auditLogs).toHaveLength(1);
    expect(fake.auditLogs[0]).toMatchObject({ tenantId: 'org_A', userId: null, action: 'AI_BOARD_PACK_PURCHASED', targetType: 'AiCreditPurchase', targetId: 'pur_1' });
    expect(JSON.parse(fake.auditLogs[0].details)).toMatchObject({
      sessionId: 'cs_test_b1PackStandard', paymentIntent: 'pi_test_1', pack: 'standard', boards: 30, amountPaidCents: 1900,
      currency: 'usd', purchaserTenantId: 'school_A1', purchaserUserId: 'user_1',
    });
  });

  it('boards are credited as SOLD (the session metadata), and the price recorded is what Stripe charged', async () => {
    await svc.handleWebhookEvent(eventFor('checkout.session.completed', packSession({
      id: 'cs_test_sold_as',
      amount_total: 1500, // e.g. a price that changed between checkout and today
      metadata: { kind: 'ai_board_pack', orgTenantId: 'org_A', tenantId: 'org_A', userId: '', pack: 'standard', boards: '25', usdMicros: '15000000' },
    })));
    expect(fake.purchases[0]).toMatchObject({ boards: 25, usdMicros: 15_000_000 });
  });

  it('the same EVENT delivered twice → acked as a duplicate, still ONE row', async () => {
    const e = eventFor('checkout.session.completed', packSession(), 'evt_same');
    expect(await svc.handleWebhookEvent(e)).toEqual({});
    expect(await svc.handleWebhookEvent(e)).toEqual({ duplicate: true });
    expect(fake.purchases).toHaveLength(1);
    expect(fake.auditLogs).toHaveLength(1);
  });

  it('the same SESSION under a NEW event id → acked as already credited: still ONE row, no 500, the claim kept', async () => {
    await svc.handleWebhookEvent(eventFor('checkout.session.completed', packSession(), 'evt_one'));
    const again = await svc.handleWebhookEvent(eventFor('checkout.session.async_payment_succeeded', packSession(), 'evt_two'));
    expect(again).toEqual({ alreadyCredited: true });
    expect(fake.purchases).toHaveLength(1);
    expect(fake.auditLogs).toHaveLength(1);
    // Acked, not released: Stripe will not retry a success forever.
    expect(fake.processed.has('evt_two')).toBe(true);
    expect(fake.client.processedStripeEvent.delete).not.toHaveBeenCalled();
  });

  it('a session that completes UNPAID is not credited; its async success is — once', async () => {
    const unpaid = packSession({ id: 'cs_test_ach', payment_status: 'unpaid' });
    expect(await svc.handleWebhookEvent(eventFor('checkout.session.completed', unpaid))).toEqual({ notPaid: true });
    expect(fake.purchases).toHaveLength(0);
    const paid = packSession({ id: 'cs_test_ach', payment_status: 'paid' });
    expect(await svc.handleWebhookEvent(eventFor('checkout.session.async_payment_succeeded', paid))).toEqual({});
    expect(fake.purchases).toHaveLength(1);
  });

  it('never credits metadata it cannot trust: unknown pack, no organisation, bad boards, a deleted organisation, a non-payment session', async () => {
    const md = packSession().metadata!;
    const cases: Array<[Session, object]> = [
      [packSession({ id: 'cs_u1', metadata: { ...md, pack: 'mega' } }), { ignored: true }],
      [packSession({ id: 'cs_u2', metadata: { ...md, orgTenantId: '' } }), { ignored: true }],
      [packSession({ id: 'cs_u3', metadata: { ...md, boards: '-5' } }), { ignored: true }],
      [packSession({ id: 'cs_u4', metadata: { ...md, boards: 'thirty' } }), { ignored: true }],
      [packSession({ id: 'cs_u5', metadata: { ...md, orgTenantId: 'org_gone' } }), { noTenantId: true }],
      [packSession({ id: 'cs_u6', mode: 'subscription' }), { ignored: true }],
    ];
    for (const [session, want] of cases) {
      expect(await svc.handleWebhookEvent(eventFor('checkout.session.completed', session))).toEqual(want);
    }
    expect(fake.purchases).toHaveLength(0);
    expect(fake.auditLogs).toHaveLength(0);
  });

  it('a failed write releases the event claim and bubbles (500 → Stripe retries), and the retry credits once', async () => {
    fake.client.$transaction.mockRejectedValueOnce(new Error('pool exhausted'));
    const e = eventFor('checkout.session.completed', packSession(), 'evt_retry');
    await expect(svc.handleWebhookEvent(e)).rejects.toThrow('pool exhausted');
    expect(fake.processed.has('evt_retry')).toBe(false);
    expect(await svc.handleWebhookEvent(e)).toEqual({});
    expect(fake.purchases).toHaveLength(1);
  });

  it('a SUBSCRIPTION checkout never touches the pack path; a non-pack async success is a no-op', async () => {
    const retrieve = jest.fn(async () => ({
      id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { tenantId: 'org_A' },
      items: { data: [{ id: 'si_1', price: { unit_amount: 2000, recurring: { interval: 'month' } } }] },
    }));
    jest.spyOn(svc, 'getClient').mockReturnValue({ subscriptions: { retrieve } } as any);
    const sub: Session = { id: 'cs_test_sub', object: 'checkout.session', mode: 'subscription', status: 'complete', payment_status: 'paid', subscription: 'sub_1', client_reference_id: 'org_A', metadata: { tenantId: 'org_A', period: 'monthly' } };
    await svc.handleWebhookEvent(eventFor('checkout.session.completed', sub));
    expect(retrieve).toHaveBeenCalledWith('sub_1');
    expect(fake.purchases).toHaveLength(0);
    expect(fake.licenses.get('org_A')).toMatchObject({ stripeSubscriptionId: 'sub_1', status: 'ACTIVE' });
    expect(await svc.handleWebhookEvent(eventFor('checkout.session.async_payment_succeeded', sub))).toEqual({});
  });
});

describe('AI board packs — the Stripe-hosted checkout', () => {
  let fake: ReturnType<typeof makeFake>;
  let svc: StripeService;
  let create: jest.Mock;
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
    fake = makeFake();
    svc = new StripeService(fake.prisma);
    create = jest.fn(async () => ({ id: 'cs_test_new', url: 'https://checkout.stripe.com/c/pay/cs_test_new' }));
    jest.spyOn(svc, 'getClient').mockReturnValue({ checkout: { sessions: { create } } } as any);
  });
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  const bulk = { id: 'bulk', boards: 100, usd: 49 };

  it('payment mode, card only, inline price_data from the pack, metadata on the session AND its PaymentIntent', async () => {
    const out = await svc.checkoutBoardPack({
      tenantId: 'school_A1', orgTenantId: 'org_A', userId: 'user_1', pack: bulk,
      successUrl: 'https://app.example/s?boards=success', cancelUrl: 'https://app.example/s?boards=cancelled',
    });
    expect(out).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_new' });
    const params = create.mock.calls[0][0];
    const metadata = { kind: 'ai_board_pack', orgTenantId: 'org_A', tenantId: 'school_A1', userId: 'user_1', pack: 'bulk', boards: '100', usdMicros: '49000000' };
    expect(params).toEqual({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 4900,
            product_data: { name: '100 AI board credits', description: expect.stringContaining('good for 12 months') },
          },
        },
      ],
      client_reference_id: 'org_A',
      success_url: 'https://app.example/s?boards=success',
      cancel_url: 'https://app.example/s?boards=cancelled',
      metadata,
      payment_intent_data: { metadata },
    });
    // every metadata value is a string (Stripe's rule)
    expect(Object.values(params.metadata).every((v) => typeof v === 'string')).toBe(true);
  });

  it('reuses the buyer\'s Stripe customer — else its organisation\'s', async () => {
    fake.licenses.set('org_A', { tenantId: 'org_A', stripeCustomerId: 'cus_org' });
    await svc.checkoutBoardPack({ tenantId: 'school_A1', orgTenantId: 'org_A', pack: bulk, successUrl: 's', cancelUrl: 'c' });
    expect(create.mock.calls[0][0].customer).toBe('cus_org');
    fake.licenses.set('school_A1', { tenantId: 'school_A1', stripeCustomerId: 'cus_school' });
    await svc.checkoutBoardPack({ tenantId: 'school_A1', orgTenantId: 'org_A', pack: bulk, successUrl: 's', cancelUrl: 'c' });
    expect(create.mock.calls[1][0].customer).toBe('cus_school');
  });

  it('Stripe not configured → throws (the controller answers enabled:false before it ever gets here)', async () => {
    jest.spyOn(svc, 'getClient').mockReturnValue(null);
    await expect(svc.checkoutBoardPack({ tenantId: 't', orgTenantId: 't', pack: bulk, successUrl: 's', cancelUrl: 'c' })).rejects.toThrow(
      'Stripe is not configured',
    );
  });
});
