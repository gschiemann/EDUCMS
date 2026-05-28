/**
 * LicenseReconcileCron — P1-5 audit fix tests.
 *
 * The daily safety-net cron that re-syncs Stripe subscription quantity
 * to the live paired-screen count, in case an event-driven
 * pair/unpair/delete sync silently failed.
 *
 * Covers:
 *   1. DRIFT  → calls syncSubscriptionQuantity AND writes a
 *      LICENSE_RECONCILED AuditLog row.
 *   2. MATCH  → calls sync (idempotent no-op) but writes NO audit row.
 *   3. Stripe disabled / no card subscriptions → does nothing.
 *   4. Multi-replica dedup: an existing LICENSE_RECONCILED row for the
 *      tenant in today's bucket suppresses a second audit write.
 *   5. A per-tenant sync throw is swallowed (one tenant's failure never
 *      aborts the whole run).
 *
 * Unit-tested with hand-rolled fakes (matches stripe.service.spec.ts).
 */
import { LicenseReconcileCron } from './license-reconcile.cron';
import type { StripeService, SyncQuantityResult } from './stripe.service';

type AuditRow = {
  tenantId: string | null;
  userId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  details: string | null;
  createdAt: Date;
};

function makeFakePrisma(opts: {
  licenses: Array<{ tenantId: string }>;
  existingAudits?: AuditRow[];
}) {
  const auditLogs: AuditRow[] = [...(opts.existingAudits ?? [])];
  const client = {
    license: {
      findMany: jest.fn(async (_args: any) =>
        opts.licenses.map((l) => ({ tenantId: l.tenantId })),
      ),
    },
    auditLog: {
      findFirst: jest.fn(async (args: any) => {
        const { tenantId, action, createdAt } = args.where;
        const gte: Date | undefined = createdAt?.gte;
        return (
          auditLogs.find(
            (r) =>
              r.tenantId === tenantId &&
              r.action === action &&
              (!gte || r.createdAt.getTime() >= gte.getTime()),
          ) ?? null
        );
      }),
      create: jest.fn(async (args: any) => {
        const row: AuditRow = {
          createdAt: new Date(),
          ...args.data,
        };
        auditLogs.push(row);
        return row;
      }),
    },
  };
  return { prisma: { client } as any, auditLogs };
}

function makeFakeStripe(opts: {
  enabled: boolean;
  sync?: (tenantId: string) => Promise<SyncQuantityResult>;
}): StripeService {
  return {
    enabled: () => opts.enabled,
    syncSubscriptionQuantity:
      opts.sync ??
      jest.fn(async (): Promise<SyncQuantityResult> => ({ status: 'in-sync' })),
  } as unknown as StripeService;
}

describe('LicenseReconcileCron.runAll', () => {
  it('writes a LICENSE_RECONCILED audit row when a tenant drifts', async () => {
    const { prisma, auditLogs } = makeFakePrisma({
      licenses: [{ tenantId: 't1' }],
    });
    const syncSpy = jest.fn(
      async (): Promise<SyncQuantityResult> => ({
        status: 'corrected',
        from: 2,
        to: 5,
      }),
    );
    const stripe = makeFakeStripe({ enabled: true, sync: syncSpy });
    const cron = new LicenseReconcileCron(prisma, stripe);

    const summary = await cron.runAll();

    expect(syncSpy).toHaveBeenCalledWith('t1');
    expect(summary).toEqual({ scanned: 1, corrected: 1, inSync: 0, skipped: 0 });
    const row = auditLogs.find((r) => r.action === 'LICENSE_RECONCILED');
    expect(row).toBeDefined();
    expect(row!.tenantId).toBe('t1');
    expect(row!.targetType).toBe('License');
    expect(row!.userId).toBeNull(); // system-initiated
    const details = JSON.parse(row!.details!);
    expect(details.fromQuantity).toBe(2);
    expect(details.toQuantity).toBe(5);
  });

  it('writes NO audit row when the tenant is already in lockstep', async () => {
    const { prisma, auditLogs } = makeFakePrisma({
      licenses: [{ tenantId: 't1' }],
    });
    const syncSpy = jest.fn(
      async (): Promise<SyncQuantityResult> => ({ status: 'in-sync', from: 4, to: 4 }),
    );
    const stripe = makeFakeStripe({ enabled: true, sync: syncSpy });
    const cron = new LicenseReconcileCron(prisma, stripe);

    const summary = await cron.runAll();

    expect(syncSpy).toHaveBeenCalledWith('t1');
    expect(summary).toEqual({ scanned: 1, corrected: 0, inSync: 1, skipped: 0 });
    expect(auditLogs.find((r) => r.action === 'LICENSE_RECONCILED')).toBeUndefined();
  });

  it('does nothing (no DB query) when Stripe is unconfigured on this deploy', async () => {
    const { prisma } = makeFakePrisma({ licenses: [{ tenantId: 't1' }] });
    const stripe = makeFakeStripe({ enabled: false });
    const cron = new LicenseReconcileCron(prisma, stripe);

    const summary = await cron.runAll();

    expect(summary).toEqual({ scanned: 0, corrected: 0, inSync: 0, skipped: 0 });
    expect(prisma.client.license.findMany).not.toHaveBeenCalled();
    expect(stripe.syncSubscriptionQuantity).not.toHaveBeenCalled();
  });

  it('suppresses the audit write when a reconcile row already exists today (multi-replica dedup)', async () => {
    const { prisma, auditLogs } = makeFakePrisma({
      licenses: [{ tenantId: 't1' }],
      existingAudits: [
        {
          tenantId: 't1',
          userId: null,
          action: 'LICENSE_RECONCILED',
          targetType: 'License',
          targetId: 't1',
          details: '{}',
          createdAt: new Date(), // now → inside today's bucket
        },
      ],
    });
    const stripe = makeFakeStripe({
      enabled: true,
      sync: jest.fn(async (): Promise<SyncQuantityResult> => ({ status: 'corrected', from: 1, to: 9 })),
    });
    const cron = new LicenseReconcileCron(prisma, stripe);

    const summary = await cron.runAll();

    // The correction still counted, but only the pre-existing row remains —
    // a second replica racing the same tenant doesn't double-write.
    expect(summary.corrected).toBe(1);
    expect(auditLogs.filter((r) => r.action === 'LICENSE_RECONCILED')).toHaveLength(1);
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
  });

  it('swallows a per-tenant sync failure and keeps processing the rest', async () => {
    const { prisma, auditLogs } = makeFakePrisma({
      licenses: [{ tenantId: 't1' }, { tenantId: 't2' }],
    });
    const syncSpy = jest.fn(async (tenantId: string): Promise<SyncQuantityResult> => {
      if (tenantId === 't1') throw new Error('Stripe 503');
      return { status: 'corrected', from: 1, to: 2 };
    });
    const stripe = makeFakeStripe({ enabled: true, sync: syncSpy });
    const cron = new LicenseReconcileCron(prisma, stripe);

    const summary = await cron.runAll();

    expect(syncSpy).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({ scanned: 2, corrected: 1, inSync: 0, skipped: 1 });
    // t2 still got its audit row despite t1 throwing.
    expect(auditLogs.filter((r) => r.action === 'LICENSE_RECONCILED')).toHaveLength(1);
    expect(auditLogs[0].tenantId).toBe('t2');
  });
});
