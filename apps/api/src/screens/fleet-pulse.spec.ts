import { FleetPulseSamplerCron } from './fleet-pulse.cron';
import { FleetPulseController } from './fleet-pulse.controller';

/**
 * Fleet pulse — sampler math + read scoping. The chart is only as honest as
 * these two: the sampler must never invent screens, and the read must never
 * cross a tenant boundary.
 */

function makePrisma(over: Partial<Record<string, any>> = {}) {
  return {
    client: {
      fleetSample: {
        findFirst: jest.fn(async () => over.recentSample ?? null),
        createMany: jest.fn(async () => ({ count: 1 })),
        deleteMany: jest.fn(async () => ({ count: 0 })),
        findMany: jest.fn(async () => over.samples ?? []),
      },
      screen: {
        groupBy: jest.fn(async (args: any) => {
          // Distinguish the three grouped reads by their where-shape.
          if (args.where.lastRenderedAt) return over.painting ?? [];
          if (args.where.lastPingAt) return over.online ?? [];
          return over.totals ?? [];
        }),
      },
      tenant: {
        findMany: jest.fn(async () => over.children ?? []),
      },
    },
  } as any;
}

describe('FleetPulseSamplerCron.sample', () => {
  it('writes one row per tenant with online/offline/notPainting derived from the three grouped reads', async () => {
    const prisma = makePrisma({
      totals: [{ tenantId: 't1', _count: { _all: 10 } }, { tenantId: 't2', _count: { _all: 3 } }],
      online: [{ tenantId: 't1', _count: { _all: 8 } }],
      painting: [{ tenantId: 't1', _count: { _all: 6 } }],
    });
    const cron = new FleetPulseSamplerCron(prisma);
    await cron.sample(1_000_000);
    const rows = prisma.client.fleetSample.createMany.mock.calls[0][0].data;
    expect(rows).toEqual([
      { tenantId: 't1', online: 8, offline: 2, notPainting: 2, total: 10 },
      { tenantId: 't2', online: 0, offline: 3, notPainting: 0, total: 3 },
    ]);
    // Retention prune rides the same tick.
    expect(prisma.client.fleetSample.deleteMany).toHaveBeenCalled();
  });

  it('stands down when another replica sampled within half a cadence', async () => {
    const prisma = makePrisma({ recentSample: { id: 'x' } });
    const cron = new FleetPulseSamplerCron(prisma);
    await cron.sample();
    expect(prisma.client.screen.groupBy).not.toHaveBeenCalled();
    expect(prisma.client.fleetSample.createMany).not.toHaveBeenCalled();
  });
});

describe('FleetPulseController.pulse', () => {
  const req = { user: { tenantId: 'root', role: 'DISTRICT_ADMIN' } };

  it('scopes to self + non-archived children and sums per-tick fleet buckets', async () => {
    const t = 1_700_000_040_000; // exact minute boundary
    const prisma = makePrisma({
      children: [{ id: 'child' }],
      samples: [
        { tenantId: 'root', online: 5, offline: 1, notPainting: 1, total: 6, createdAt: new Date(t) },
        { tenantId: 'child', online: 2, offline: 0, notPainting: 0, total: 2, createdAt: new Date(t + 1_000) },
      ],
    });
    const ctl = new FleetPulseController(prisma);
    const out: any = await ctl.pulse(req);
    // Tenant scoping is on the QUERY — assert the where actually carried it.
    const where = prisma.client.fleetSample.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toEqual({ in: ['root', 'child'] });
    // Same minute → one fleet bucket, summed.
    expect(out.fleet).toHaveLength(1);
    expect(out.fleet[0]).toMatchObject({ online: 7, offline: 1, notPainting: 1, total: 8 });
    // Per-location series keyed by tenant for the table sparklines.
    expect(Object.keys(out.locations).sort()).toEqual(['child', 'root']);
  });

  it('refuses a caller with no tenant context', async () => {
    const ctl = new FleetPulseController(makePrisma());
    await expect(ctl.pulse({ user: {} } as any)).rejects.toThrow();
  });
});
