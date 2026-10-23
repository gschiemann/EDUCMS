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
      updateMany: jest.fn(async (args: any) => {
        // TEN-001 burn-down: webhook license writes are {id, tenantId}-scoped.
        const id = args.where.id as string;
        let count = 0;
        for (const [k, v] of licenses) {
          if (v.id === id && (args.where.tenantId === undefined || v.tenantId === args.where.tenantId)) {
            licenses.set(k, { ...v, ...args.data });
            count++;
          }
        }
        return { count };
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
      // BILL-01 — the service releases its idempotency claim when the work
      // throws, so Stripe's retry does real work instead of being acked as a
      // duplicate. Modelled here so that release is observable.
      delete: jest.fn(async (args: any) => {
        const id = args.where.id as string;
        const row = processed.get(id);
        if (!row) {
          throw Object.assign(new Error('Record to delete does not exist'), { code: 'P2025' });
        }
        processed.delete(id);
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

describe('BILL-01 — a failed webhook must not be silently swallowed', () => {
  let svc: StripeService;
  let fake: ReturnType<typeof makeFakePrisma>;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
    fake = makeFakePrisma();
    svc = new StripeService(fake.prismaService);
  });
  afterEach(() => { delete process.env.STRIPE_SECRET_KEY; });

  // THE BUG: the idempotency ledger row is INSERTed and committed on its own
  // connection BEFORE any work runs. That is what makes dedup atomic across
  // pods — but it meant a throw during the work permanently ATE the event: we
  // 500, Stripe re-delivers the same event.id, the P2002 branch finds the
  // committed row and acks it as a duplicate with a silent 200. Gone forever.
  //
  // For billing that is not a wash: a dropped customer.subscription.deleted
  // leaves a cancelled tenant billed and licensed.

  it('releases the idempotency claim when the handler throws', async () => {
    const event = buildEvent({ id: 'evt_fail_1' });
    // Make the work fail after the ledger row is committed.
    // Fail the work AFTER the ledger row is committed. Every handler's writes
    // go through $transaction, and a plain Error is NOT in withDbRetry's
    // transient set, so it surfaces immediately instead of being retried away.
    fake.inspect.clientMocks.$transaction.mockRejectedValueOnce(
      new Error('pool exhausted'),
    );

    await expect(svc.handleWebhookEvent(event)).rejects.toThrow('pool exhausted');

    // THE POINT: the claim is gone, so Stripe's retry is not treated as a dup.
    expect(fake.inspect.processed.has('evt_fail_1')).toBe(false);
    expect(fake.inspect.clientMocks.processedStripeEvent.delete).toHaveBeenCalledWith({
      where: { id: 'evt_fail_1' },
    });
  });

  it("Stripe's retry after a failure does REAL work instead of acking a duplicate", async () => {
    const event = buildEvent({ id: 'evt_fail_2' });
    fake.inspect.clientMocks.$transaction.mockRejectedValueOnce(
      new Error('transient blip'),
    );

    await expect(svc.handleWebhookEvent(event)).rejects.toThrow('transient blip');

    // The redelivery — this used to return { duplicate: true } and drop it.
    const retry = await svc.handleWebhookEvent(event);
    expect(retry).not.toEqual({ duplicate: true });
    expect(fake.inspect.licenses.size).toBeGreaterThan(0);
  });

  it('still dedups a genuine redelivery of a SUCCESSFUL event', async () => {
    // The release must not weaken the dedup it sits inside: only failures
    // release the claim.
    const event = buildEvent({ id: 'evt_ok_1' });
    const first = await svc.handleWebhookEvent(event);
    const second = await svc.handleWebhookEvent(event);

    expect(first).toEqual({});
    expect(second).toEqual({ duplicate: true });
    expect(fake.inspect.clientMocks.processedStripeEvent.delete).not.toHaveBeenCalled();
  });

  it('does not release the claim when the INSERT itself lost the P2002 race', async () => {
    // A concurrent pod already holds the claim. Deleting here would hand the
    // event to a third delivery while the winner is still working on it.
    const event = buildEvent({ id: 'evt_race_1' });
    await svc.handleWebhookEvent(event); // pod A claims + completes
    (fake.inspect.clientMocks.processedStripeEvent.delete as jest.Mock).mockClear();

    const second = await svc.handleWebhookEvent(event); // pod B loses the race
    expect(second).toEqual({ duplicate: true });
    expect(fake.inspect.clientMocks.processedStripeEvent.delete).not.toHaveBeenCalled();
  });
});

/**
 * Billing go-live (2026-10-22) — two bugs found by driving signed events through the real
 * webhook route against a scratch Postgres (docs/research/2026-10-22-billing-golive/01-report.md).
 */
describe('StripeService webhook — billing go-live fixes (2026-10-22)', () => {
  let svc: StripeService;
  let fake: ReturnType<typeof makeFakePrisma>;
  const retrieve = jest.fn();

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
    fake = makeFakePrisma();
    svc = new StripeService(fake.prismaService);
    retrieve.mockReset();
    (svc as any).client = { subscriptions: { retrieve } };
  });
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  const seed = (over: Record<string, unknown> = {}) =>
    fake.inspect.licenses.set('tenant_A', {
      id: 'lic_tenant_A',
      tenantId: 'tenant_A',
      status: 'ACTIVE',
      tier: 'MONTHLY',
      stripeCustomerId: 'cus_test_1',
      stripeSubscriptionId: 'sub_new',
      stripeLastEventCreatedAt: null,
      ...over,
    } as any);

  it("a late invoice.payment_failed of an EARLIER subscription never touches the customer's new plan", async () => {
    seed();
    retrieve.mockResolvedValue({ id: 'sub_old', status: 'canceled' });
    const r = await svc.handleWebhookEvent({
      id: 'evt_old_invoice',
      type: 'invoice.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'in_old', customer: 'cus_test_1', parent: { subscription_details: { subscription: 'sub_old' } } } },
    });
    expect(r).toEqual({ ignored: true });
    expect(retrieve).not.toHaveBeenCalled();
    expect(fake.inspect.licenses.get('tenant_A')?.status).toBe('ACTIVE');
    expect(fake.inspect.auditLogs).toHaveLength(0);
  });

  it('an invoice of the CURRENT subscription still applies (live status re-fetched)', async () => {
    seed();
    retrieve.mockResolvedValue({ id: 'sub_new', status: 'past_due' });
    await svc.handleWebhookEvent({
      id: 'evt_cur_invoice',
      type: 'invoice.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'in_cur', customer: 'cus_test_1', parent: { subscription_details: { subscription: 'sub_new' } } } },
    });
    expect(retrieve).toHaveBeenCalledWith('sub_new');
    expect(fake.inspect.licenses.get('tenant_A')?.status).toBe('PAST_DUE');
  });

  it('an invoice with no subscription id keeps the old path (event-implied status)', async () => {
    seed();
    await svc.handleWebhookEvent({
      id: 'evt_nosub_invoice',
      type: 'invoice.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'in_x', customer: 'cus_test_1' } },
    });
    expect(fake.inspect.licenses.get('tenant_A')?.status).toBe('PAST_DUE');
  });

  it('a subscription with no trial CLEARS an old trial end (no phantom "trial_card" / trial AI)', async () => {
    seed({ trialEndsAt: new Date(Date.now() + 9 * 86_400_000), stripeSubscriptionId: 'sub_old', status: 'CANCELLED' });
    await svc.handleWebhookEvent(
      buildEvent({
        id: 'evt_restart',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_new',
            customer: 'cus_test_1',
            status: 'active',
            trial_end: null,
            metadata: { tenantId: 'tenant_A' },
            items: { data: [{ id: 'si_new', quantity: 2, price: { id: 'price_m', unit_amount: 2000, recurring: { interval: 'month' } } }] },
          },
        },
      }),
    );
    const lic = fake.inspect.licenses.get('tenant_A') as any;
    expect(lic.status).toBe('ACTIVE');
    expect(lic.stripeSubscriptionId).toBe('sub_new');
    expect(lic.trialEndsAt).toBeNull();
  });

  it('a trialing subscription still mirrors its trial end', async () => {
    seed({ stripeSubscriptionId: null, tier: 'FREE_TRIAL' });
    const end = Math.floor(Date.now() / 1000) + 5 * 86_400;
    await svc.handleWebhookEvent(
      buildEvent({
        id: 'evt_trialing',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_new',
            customer: 'cus_test_1',
            status: 'trialing',
            trial_end: end,
            metadata: { tenantId: 'tenant_A' },
            items: { data: [{ id: 'si_new', quantity: 3, price: { id: 'price_m', unit_amount: 2000, recurring: { interval: 'month' } } }] },
          },
        },
      }),
    );
    expect((fake.inspect.licenses.get('tenant_A') as any).trialEndsAt).toEqual(new Date(end * 1000));
  });
});

describe('StripeService.verifyPriceConfig', () => {
  const ENV = ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_ANNUAL', 'STRIPE_PRICE_MONTHLY_AI', 'STRIPE_PRICE_ANNUAL_AI'];
  afterEach(() => ENV.forEach((k) => delete process.env[k]));

  it('null when Stripe is not configured', async () => {
    const svc = new StripeService(makeFakePrisma().prismaService);
    expect(await svc.verifyPriceConfig()).toBeNull();
  });

  it('retrieves each configured price and reports a wrong one by slot; never echoes the key', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_unitsecretvalue';
    process.env.STRIPE_PRICE_MONTHLY = 'price_m';
    process.env.STRIPE_PRICE_ANNUAL = 'price_y';
    const svc = new StripeService(makeFakePrisma().prismaService);
    const prices: Record<string, any> = {
      price_m: { active: true, livemode: true, currency: 'usd', type: 'recurring', billing_scheme: 'per_unit', unit_amount: 2000, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } },
      price_y: { active: true, livemode: true, currency: 'usd', type: 'recurring', billing_scheme: 'per_unit', unit_amount: 24000, recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } },
    };
    (svc as any).client = { prices: { retrieve: jest.fn(async (id: string) => prices[id]) } };
    const r = (await svc.verifyPriceConfig())!;
    expect(r.keyMode).toBe('live');
    expect(r.ok).toBe(false);
    expect(r.slots.find((s) => s.slot === 'STRIPE_PRICE_MONTHLY')?.state).toBe('ok');
    expect(r.slots.find((s) => s.slot === 'STRIPE_PRICE_ANNUAL')?.problems.join(' ')).toMatch(/\$240\.00.*\$200\.00/);
    expect(r.aiPlanOffered).toBe(false);
    expect(JSON.stringify(r)).not.toContain('unitsecretvalue');
  });

  it("an unreadable price is reported without Stripe's masked key fragment", async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_unitsecretvalue';
    process.env.STRIPE_PRICE_MONTHLY = 'price_m';
    const svc = new StripeService(makeFakePrisma().prismaService);
    (svc as any).client = {
      prices: { retrieve: jest.fn(async () => { throw new Error('Invalid API Key provided: sk_live_**********alue'); }) },
    };
    const r = (await svc.verifyPriceConfig())!;
    const m = r.slots.find((s) => s.slot === 'STRIPE_PRICE_MONTHLY')!;
    expect(m.state).toBe('unreadable');
    expect(m.problems[0]).toContain('Invalid API Key provided: [key]');
    expect(JSON.stringify(r)).not.toMatch(/sk_live/);
  });
});
