/**
 * StripeService — webhook idempotency + out-of-order + audit-log tests.
 *
 * Covers the 2026-05-26 P0-7 audit fix:
 *   1. Stripe redelivery of the same event.id is a no-op (P2002 ledger).
 *   2. Stale events older than the last-applied one don't flip License
 *      state (e.g. a late ACTIVE update can't undo a fresher PAST_DUE).
 *   3. Customer Portal events lacking metadata.tenantId still sync via
 *      a fallback lookup by stripeCustomerId.
 *   4. Every License mutation writes an AuditLog row in the same
 *      $transaction.
 *
 * The service is unit-tested with a hand-rolled Prisma mock — Jest can't
 * spin up the real Prisma client in a 2-second unit test.
 */
import { StripeService, StripeWebhookEvent } from './stripe.service';

type ProcessedStripeEventRow = {
  id: string;
  type: string;
  processedAt: Date;
};

type LicenseRow = {
  id: string;
  tenantId: string;
  status: string;
  tier: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeLastEventCreatedAt: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
};

type AuditLogRow = {
  tenantId: string | null;
  userId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  details: string | null;
};

/** A hand-rolled in-memory Prisma stand-in. Models exactly the surface
 *  StripeService.handleWebhookEvent touches; nothing else. */
function makeFakePrisma() {
  const processed = new Map<string, ProcessedStripeEventRow>();
  const licenses = new Map<string, LicenseRow>(); // keyed by tenantId
  const auditLogs: AuditLogRow[] = [];

  const tx = {
    license: {
      // TOCTOU fix (2026-07-04): the watermark read now happens INSIDE the
      // serializable tx, so the tx handle needs findUnique too.
      findUnique: jest.fn(async (args: any) => {
        const tenantId = args.where.tenantId as string;
        return licenses.get(tenantId) ?? null;
      }),
      upsert: jest.fn(async (args: any) => {
        const tenantId = args.where.tenantId as string;
        const existing = licenses.get(tenantId);
        if (existing) {
          const updated: LicenseRow = { ...existing, ...args.update };
          licenses.set(tenantId, updated);
          return updated;
        }
        const created: LicenseRow = {
          id: 'lic_' + tenantId,
          tenantId,
          status: 'ACTIVE',
          tier: 'MONTHLY',
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          stripeLastEventCreatedAt: null,
          ...args.create,
        };
        licenses.set(tenantId, created);
        return created;
      }),
      update: jest.fn(async (args: any) => {
        // update by `where.id` is the only shape used by the new code
        const id = args.where.id as string;
        for (const [k, v] of licenses) {
          if (v.id === id) {
            const updated: LicenseRow = { ...v, ...args.data };
            licenses.set(k, updated);
            return updated;
          }
        }
        throw Object.assign(new Error('not found'), { code: 'P2025' });
      }),
    },
    auditLog: {
      create: jest.fn(async (args: any) => {
        auditLogs.push(args.data);
        return args.data;
      }),
    },
  };

  const client = {
    processedStripeEvent: {
      create: jest.fn(async (args: any) => {
        const { id, type } = args.data;
        if (processed.has(id)) {
          throw Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
          });
        }
        const row: ProcessedStripeEventRow = {
          id,
          type,
          processedAt: new Date(),
        };
        processed.set(id, row);
        return row;
      }),
    },
    license: {
      findUnique: jest.fn(async (args: any) => {
        const tenantId = args.where.tenantId as string;
        return licenses.get(tenantId) ?? null;
      }),
      findFirst: jest.fn(async (args: any) => {
        const { stripeCustomerId, stripeSubscriptionId } = args.where ?? {};
        for (const v of licenses.values()) {
          if (stripeCustomerId && v.stripeCustomerId === stripeCustomerId) {
            return v;
          }
          if (
            stripeSubscriptionId &&
            v.stripeSubscriptionId === stripeSubscriptionId
          ) {
            return v;
          }
        }
        return null;
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };

  return {
    prismaService: { client } as any,
    inspect: { processed, licenses, auditLogs, txMocks: tx, clientMocks: client },
  };
}

/** Build a StripeWebhookEvent with sensible defaults. */
function buildEvent(overrides: Partial<StripeWebhookEvent> = {}): StripeWebhookEvent {
  return {
    id: overrides.id ?? 'evt_test_' + Math.random().toString(36).slice(2, 10),
    type: overrides.type ?? 'customer.subscription.updated',
    created: overrides.created ?? Math.floor(Date.now() / 1000),
    data: overrides.data ?? {
      object: {
        id: 'sub_test_1',
        customer: 'cus_test_1',
        status: 'active',
        metadata: { tenantId: 'tenant_A' },
        items: {
          data: [
            {
              id: 'si_1',
              price: { unit_amount: 1500, recurring: { interval: 'month' } },
              // Pinned API version (2026-04-22.dahlia, stripe SDK 22.1.1)
              // moved current_period_start/end off the top-level
              // Subscription onto each SubscriptionItem — this fixture
              // mirrors the REAL webhook payload shape.
              current_period_start: 1_700_000_000,
              current_period_end: 1_702_500_000,
            },
          ],
        },
      },
    },
  };
}

describe('StripeService.handleWebhookEvent — P0-7 audit fixes', () => {
  let svc: StripeService;
  let fake: ReturnType<typeof makeFakePrisma>;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
    fake = makeFakePrisma();
    svc = new StripeService(fake.prismaService);
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('idempotency: same event.id processed twice is a no-op on the second call', async () => {
    const event = buildEvent({ id: 'evt_dup_1' });
    const first = await svc.handleWebhookEvent(event);
    const second = await svc.handleWebhookEvent(event);

    expect(first).toEqual({});
    expect(second).toEqual({ duplicate: true });

    // First call wrote one License + one AuditLog. Second call wrote
    // nothing additional — the ledger short-circuited before any
    // mutation method was called a second time.
    expect(fake.inspect.licenses.size).toBe(1);
    expect(fake.inspect.auditLogs).toHaveLength(1);
  });

  it('out-of-order: a stale customer.subscription.updated cannot undo a fresher invoice.payment_failed', async () => {
    // 1) First: invoice.payment_failed at t = NOW flips License → PAST_DUE.
    const failureCreated = Math.floor(Date.now() / 1000);
    const failureEvent: StripeWebhookEvent = {
      id: 'evt_payment_failed',
      type: 'invoice.payment_failed',
      created: failureCreated,
      data: {
        object: {
          id: 'in_1',
          customer: 'cus_test_1',
        },
      },
    };
    // Seed a License row for the customer so the payment-failed path
    // has something to update.
    fake.inspect.licenses.set('tenant_A', {
      id: 'lic_tenant_A',
      tenantId: 'tenant_A',
      status: 'ACTIVE',
      tier: 'MONTHLY',
      stripeCustomerId: 'cus_test_1',
      stripeSubscriptionId: 'sub_test_1',
      stripeLastEventCreatedAt: null,
    });
    await svc.handleWebhookEvent(failureEvent);
    expect(fake.inspect.licenses.get('tenant_A')?.status).toBe('PAST_DUE');

    // 2) Then: a STALE customer.subscription.updated (status=active) at
    //    t = NOW - 60s arrives out-of-order. Without the guard, this
    //    would flip the License back to ACTIVE. The guard must skip it.
    const staleEvent = buildEvent({
      id: 'evt_stale_active',
      type: 'customer.subscription.updated',
      created: failureCreated - 60,
    });
    const result = await svc.handleWebhookEvent(staleEvent);
    expect(result).toEqual({ staleOutOfOrder: true });
    expect(fake.inspect.licenses.get('tenant_A')?.status).toBe('PAST_DUE'); // unchanged
  });

  it('tenant fallback: subscription event with NO metadata.tenantId still syncs by stripeCustomerId', async () => {
    // Seed a License linked to a customer but no tenantId metadata in
    // the incoming event (the Customer Portal scenario from the audit).
    fake.inspect.licenses.set('tenant_A', {
      id: 'lic_tenant_A',
      tenantId: 'tenant_A',
      status: 'ACTIVE',
      tier: 'MONTHLY',
      stripeCustomerId: 'cus_portal',
      stripeSubscriptionId: 'sub_portal',
      stripeLastEventCreatedAt: null,
    });

    const portalEvent: StripeWebhookEvent = {
      id: 'evt_portal_change',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_portal',
          customer: 'cus_portal',
          status: 'active',
          metadata: {}, // <-- the bug: empty metadata
          items: {
            data: [
              {
                id: 'si_portal',
                price: {
                  unit_amount: 15000,
                  recurring: { interval: 'year' },
                },
              },
            ],
          },
        },
      },
    };
    const result = await svc.handleWebhookEvent(portalEvent);

    expect(result).toEqual({});
    // The License was found by stripeCustomerId, upserted as ANNUAL.
    expect(fake.inspect.licenses.get('tenant_A')?.tier).toBe('ANNUAL');
  });

  it('audit log: every License mutation writes a STRIPE_WEBHOOK_* AuditLog row', async () => {
    // updated → expect one audit row
    await svc.handleWebhookEvent(
      buildEvent({ id: 'evt_audit_1', type: 'customer.subscription.updated' }),
    );

    expect(fake.inspect.auditLogs).toHaveLength(1);
    const row = fake.inspect.auditLogs[0];
    expect(row.action).toBe('STRIPE_WEBHOOK_CUSTOMER_SUBSCRIPTION_UPDATED');
    expect(row.targetType).toBe('License');
    expect(row.tenantId).toBe('tenant_A');
    // details must be JSON-parseable and contain the event id +
    // fromStatus / toStatus / fromTier / toTier per the audit spec.
    const details = JSON.parse(row.details as string);
    expect(details.eventId).toBe('evt_audit_1');
    expect(details.toStatus).toBe('ACTIVE');
    expect(details.toTier).toBe('MONTHLY');
  });

  it('billing period: reads current_period_start/end off subscription.items.data[0] (moved off the top-level Subscription in the pinned API version)', async () => {
    const event = buildEvent({ id: 'evt_period_1' });
    await svc.handleWebhookEvent(event);

    const license = fake.inspect.licenses.get('tenant_A');
    expect(license?.currentPeriodStart).toEqual(new Date(1_700_000_000 * 1000));
    expect(license?.currentPeriodEnd).toEqual(new Date(1_702_500_000 * 1000));
  });

  it('billing period: a subscription with no items array populates null periods instead of throwing', async () => {
    const event: StripeWebhookEvent = {
      id: 'evt_period_no_items',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_no_items',
          customer: 'cus_no_items',
          status: 'active',
          metadata: { tenantId: 'tenant_A' },
          // no `items` key at all — must not throw.
        },
      },
    };
    const result = await svc.handleWebhookEvent(event);

    expect(result).toEqual({});
    const license = fake.inspect.licenses.get('tenant_A');
    expect(license?.currentPeriodStart ?? null).toBeNull();
    expect(license?.currentPeriodEnd ?? null).toBeNull();
  });

  it('audit log: invoice.payment_failed records fromStatus=ACTIVE → toStatus=PAST_DUE', async () => {
    fake.inspect.licenses.set('tenant_A', {
      id: 'lic_tenant_A',
      tenantId: 'tenant_A',
      status: 'ACTIVE',
      tier: 'MONTHLY',
      stripeCustomerId: 'cus_payfail',
      stripeSubscriptionId: 'sub_payfail',
      stripeLastEventCreatedAt: null,
    });

    await svc.handleWebhookEvent({
      id: 'evt_payfail_1',
      type: 'invoice.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'in_payfail', customer: 'cus_payfail' } },
    });

    expect(fake.inspect.auditLogs).toHaveLength(1);
    const details = JSON.parse(fake.inspect.auditLogs[0].details as string);
    expect(details.fromStatus).toBe('ACTIVE');
    expect(details.toStatus).toBe('PAST_DUE');
    expect(fake.inspect.auditLogs[0].action).toBe(
      'STRIPE_WEBHOOK_INVOICE_PAYMENT_FAILED',
    );
  });

  it('invoice tx is retried on a transient pgbouncer blip — the downgrade is NOT lost to the idempotency gate', async () => {
    fake.inspect.licenses.set('tenant_A', {
      id: 'lic_tenant_A', tenantId: 'tenant_A', status: 'ACTIVE', tier: 'MONTHLY',
      stripeCustomerId: 'cus_retry', stripeSubscriptionId: 'sub_retry', stripeLastEventCreatedAt: null,
    });
    // First $transaction attempt throws a transient pool timeout (P2024); the
    // second succeeds. Without the withDbRetry wrapper the throw bubbles → the
    // webhook controller returns 500 → Stripe retries the SAME event.id → the
    // commit-before-work idempotency gate short-circuits it as a duplicate and
    // the PAST_DUE downgrade is permanently lost (unpaid tenant stays ACTIVE).
    let attempts = 0;
    fake.inspect.clientMocks.$transaction.mockImplementation(async (fn: any) => {
      attempts += 1;
      if (attempts === 1) { const e: any = new Error('pgbouncer pool timeout'); e.code = 'P2024'; throw e; }
      return fn(fake.inspect.txMocks);
    });

    await svc.handleWebhookEvent({
      id: 'evt_retry_1', type: 'invoice.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'in_retry', customer: 'cus_retry' } },
    });

    expect(attempts).toBeGreaterThanOrEqual(2); // retried, not lost
    expect(fake.inspect.licenses.get('tenant_A')?.status).toBe('PAST_DUE'); // downgrade applied
  });

  it('audit log: customer.subscription.deleted records fromStatus → CANCELLED', async () => {
    fake.inspect.licenses.set('tenant_A', {
      id: 'lic_tenant_A',
      tenantId: 'tenant_A',
      status: 'ACTIVE',
      tier: 'ANNUAL',
      stripeCustomerId: 'cus_del',
      stripeSubscriptionId: 'sub_del',
      stripeLastEventCreatedAt: null,
    });

    await svc.handleWebhookEvent({
      id: 'evt_del_1',
      type: 'customer.subscription.deleted',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'sub_del', customer: 'cus_del' } },
    });

    expect(fake.inspect.licenses.get('tenant_A')?.status).toBe('CANCELLED');
    expect(fake.inspect.auditLogs).toHaveLength(1);
    const details = JSON.parse(fake.inspect.auditLogs[0].details as string);
    expect(details.fromStatus).toBe('ACTIVE');
    expect(details.toStatus).toBe('CANCELLED');
  });

  it('no-tenant fallback: a subscription with no metadata AND no matching customer is a no-op', async () => {
    const result = await svc.handleWebhookEvent({
      id: 'evt_orphan',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_orphan',
          customer: 'cus_unknown',
          status: 'active',
          metadata: {},
          items: {
            data: [
              {
                id: 'si_orphan',
                price: { unit_amount: 1500, recurring: { interval: 'month' } },
              },
            ],
          },
        },
      },
    });

    expect(result).toEqual({ noTenantId: true });
    expect(fake.inspect.licenses.size).toBe(0);
    expect(fake.inspect.auditLogs).toHaveLength(0);
  });

  // ── 2026-07-04 Fable — launch-floor billing cluster ──────────────

  it('checkout idempotency (Fix B): an existing non-cancelled subscription routes to the Customer Portal instead of creating a DUPLICATE', async () => {
    process.env.STRIPE_PRICE_MONTHLY = 'price_monthly_x';
    fake.inspect.licenses.set('tenant_A', {
      id: 'lic_tenant_A',
      tenantId: 'tenant_A',
      status: 'ACTIVE',
      tier: 'MONTHLY',
      stripeCustomerId: 'cus_existing',
      stripeSubscriptionId: 'sub_existing',
      stripeLastEventCreatedAt: null,
    });
    const checkoutCreate = jest.fn();
    const fakeStripe = {
      checkout: { sessions: { create: checkoutCreate } },
      billingPortal: { sessions: { create: jest.fn(async () => ({ url: 'https://portal.stripe/x' })) } },
    };
    jest.spyOn(svc, 'getClient').mockReturnValue(fakeStripe as any);

    const res = await svc.checkoutForTenant({
      tenantId: 'tenant_A',
      period: 'monthly',
      successUrl: 's',
      cancelUrl: 'c',
    });
    expect(res).toEqual({ url: 'https://portal.stripe/x', existing: true });
    // THE load-bearing assertion: no SECOND subscription was ever created.
    expect(checkoutCreate).not.toHaveBeenCalled();
    delete process.env.STRIPE_PRICE_MONTHLY;
  });

  it('invoice.payment_succeeded (Fix A): recovers PAST_DUE → ACTIVE via a LIVE subscription refetch', async () => {
    fake.inspect.licenses.set('tenant_A', {
      id: 'lic_tenant_A',
      tenantId: 'tenant_A',
      status: 'PAST_DUE',
      tier: 'MONTHLY',
      stripeCustomerId: 'cus_recover',
      stripeSubscriptionId: 'sub_recover',
      stripeLastEventCreatedAt: null,
    });
    const retrieve = jest.fn(async () => ({ status: 'active' }));
    jest.spyOn(svc, 'getClient').mockReturnValue({ subscriptions: { retrieve } } as any);

    await svc.handleWebhookEvent({
      id: 'evt_paid_1',
      type: 'invoice.payment_succeeded',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'in_recover', customer: 'cus_recover', subscription: 'sub_recover' } },
    });
    expect(retrieve).toHaveBeenCalledWith('sub_recover');
    expect(fake.inspect.licenses.get('tenant_A')?.status).toBe('ACTIVE');
  });

  it('Fix A (the P0): a benign quantity-sync does NOT let a later-arriving, older-timestamped invoice.payment_failed be swallowed', async () => {
    fake.inspect.licenses.set('tenant_A', {
      id: 'lic_tenant_A',
      tenantId: 'tenant_A',
      status: 'ACTIVE',
      tier: 'MONTHLY',
      stripeCustomerId: 'cus_pp',
      stripeSubscriptionId: 'sub_pp',
      stripeLastEventCreatedAt: null,
    });
    const retrieve = jest.fn(async () => ({ status: 'past_due' }));
    jest.spyOn(svc, 'getClient').mockReturnValue({ subscriptions: { retrieve } } as any);

    // A benign quantity-sync (status active) at a LATER timestamp advances the
    // subscription watermark first (this is what our own syncSubscriptionQuantity
    // does on every screen pair/unpair).
    await svc.handleWebhookEvent(
      buildEvent({
        id: 'evt_qty_sync',
        type: 'customer.subscription.updated',
        created: 2_000_000_000,
        data: {
          object: {
            id: 'sub_pp',
            customer: 'cus_pp',
            status: 'active',
            metadata: { tenantId: 'tenant_A' },
            items: { data: [{ id: 'si', price: { unit_amount: 1500, recurring: { interval: 'month' } } }] },
          },
        },
      }),
    );
    expect(fake.inspect.licenses.get('tenant_A')?.status).toBe('ACTIVE');

    // Now the REAL card decline, created EARLIER (Stripe delivers out of order).
    // OLD code read-gated on the shared watermark (2e9 > 1e9) and SWALLOWED it —
    // the unpaid tenant kept full paid service forever. NEW code processes it
    // ordering-immune (live-refetch → past_due).
    await svc.handleWebhookEvent({
      id: 'evt_fail_ooo',
      type: 'invoice.payment_failed',
      created: 1_000_000_000,
      data: { object: { id: 'in_pp', customer: 'cus_pp', subscription: 'sub_pp' } },
    });
    expect(fake.inspect.licenses.get('tenant_A')?.status).toBe('PAST_DUE');
  });
});
