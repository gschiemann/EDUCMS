/**
 * GET /screens/fleet — HQ fleet roll-up (2026-06-02).
 * ─────────────────────────────────────────────────────────
 *
 * The manager-console read-only roll-up: a parent ("Corporate") sees every
 * DIRECT child location's screens in one list/map, each tagged with its
 * store, with roll-up stats. Asymmetric (parent reads children) + read-only
 * (no mutation; acting happens by switching into the store). A leaf location
 * with no children resolves to just its own screens.
 *
 * Asserted:
 *   1. Parent reads self + children's screens; each carries `sourceTenant`;
 *      live status derived from lastPingAt; geo falls back to the store; stats
 *      (total/online/offline/locationCount) + locations list are correct.
 *   2. A leaf (no children) sees ONLY its own screens (query scoped to [self]).
 */
import { ScreensController } from './screens.controller';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) =>
    o?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

function makeController(opts: { self: any; children: any[]; screens: any[] }) {
  const prisma: any = {
    client: {
      tenantBranding: { findMany: jest.fn(async () => []) },
      tenant: {
        findUnique: jest.fn().mockResolvedValue(opts.self),
        findMany: jest.fn().mockResolvedValue(opts.children),
      },
      screen: { findMany: jest.fn().mockResolvedValue(opts.screens) },
    },
  };
  const c = new ScreensController(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { c, prisma };
}

const res = () => ({ setHeader: jest.fn() }) as any;
const req = (tenantId: string, role = 'DISTRICT_ADMIN') => ({ user: { tenantId, role } }) as any;
const T = (id: string, name: string, slug: string) => ({ id, name, slug, latitude: 30, longitude: -97, address: `${name} addr` });

describe('ScreensController.fleet — HQ roll-up', () => {
  it('parent reads self + children screens, tagged by store, with correct stats', async () => {
    const now = Date.now();
    const corp = T('corp', 'Corporate', 'corp');
    const A = T('loc-a', 'Austin', 'austin');
    const B = T('loc-b', 'Dallas', 'dallas');
    const screens = [
      { id: 's1', name: 'A Drive-Thru', status: 'ONLINE', tenantId: 'loc-a', lastPingAt: new Date(now), latitude: null, longitude: null },
      { id: 's2', name: 'A Lobby', status: 'ONLINE', tenantId: 'loc-a', lastPingAt: new Date(now - 10 * 60 * 1000), latitude: null, longitude: null },
      { id: 's3', name: 'B Counter', status: 'ONLINE', tenantId: 'loc-b', lastPingAt: new Date(now), latitude: null, longitude: null },
    ];
    const { c, prisma } = makeController({ self: corp, children: [A, B], screens });

    const out: any = await c.fleet(req('corp'), res());

    expect(out.screens).toHaveLength(3);
    expect(out.stats).toEqual({ total: 3, online: 2, offline: 1, locationCount: 3 });
    expect(out.locations.map((l: any) => l.slug)).toEqual(['corp', 'austin', 'dallas']);
    // screens queried across self + both children.
    expect(prisma.client.screen.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: { in: ['corp', 'loc-a', 'loc-b'] } } }),
    );

    const s1 = out.screens.find((x: any) => x.id === 's1');
    expect(s1.sourceTenant).toEqual({ id: 'loc-a', name: 'Austin', slug: 'austin', vertical: null });
    expect(s1.status).toBe('ONLINE');
    expect(s1.effectiveLatitude).toBe(30); // fell back to the store's geo
    expect(s1.geoSource).toBe('tenant');

    const s2 = out.screens.find((x: any) => x.id === 's2');
    expect(s2.status).toBe('OFFLINE'); // stale heartbeat → offline
  });

  it('a leaf location (no children) sees only its own screens', async () => {
    const leaf = T('loc-a', 'Austin', 'austin');
    const screens = [{ id: 's1', name: 'x', status: 'ONLINE', tenantId: 'loc-a', lastPingAt: new Date(), latitude: null, longitude: null }];
    const { c, prisma } = makeController({ self: leaf, children: [], screens });

    const out: any = await c.fleet(req('loc-a'), res());

    expect(out.stats.locationCount).toBe(1);
    expect(out.screens).toHaveLength(1);
    expect(prisma.client.screen.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: { in: ['loc-a'] } } }),
    );
  });
});

describe('ScreensController.fleet — ?tenantId re-root (child-location dashboard, 2026-08-31)', () => {
  const corp = T('corp', 'Corporate', 'corp');
  const A = T('loc-a', 'Austin', 'austin');
  const B = T('loc-b', 'Dallas', 'dallas');

  /** Mocks that answer BY ARGUMENT — the override path queries the tenant
   *  tables twice with different shapes (caller's children for the
   *  membership check, then the re-rooted tenant + ITS children). */
  function makeHierarchyController(screens: any[]) {
    const byId: Record<string, any> = { corp, 'loc-a': A, 'loc-b': B };
    const childrenOf: Record<string, any[]> = { corp: [A, B], 'loc-a': [], 'loc-b': [] };
    const prisma: any = {
      client: {
        tenantBranding: { findMany: jest.fn(async () => []) },
      tenant: {
          findUnique: jest.fn(async (args: any) => byId[args.where.id] ?? null),
          findMany: jest.fn(async (args: any) => childrenOf[args.where.parentId] ?? []),
        },
        screen: {
          findMany: jest.fn(async (args: any) =>
            screens.filter((s) => (args.where.tenantId.in as string[]).includes(s.tenantId))),
        },
      },
    };
    const c = new ScreensController(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { c, prisma };
  }

  const screens = [
    { id: 's1', name: 'A Drive-Thru', status: 'ONLINE', tenantId: 'loc-a', lastPingAt: new Date(), latitude: null, longitude: null },
    { id: 's3', name: 'B Counter', status: 'ONLINE', tenantId: 'loc-b', lastPingAt: new Date(), latitude: null, longitude: null },
  ];

  it('an HQ admin re-roots the read at one child and sees ONLY that location', async () => {
    const { c, prisma } = makeHierarchyController(screens);
    const out: any = await c.fleet(req('corp'), res(), 'loc-a');
    expect(out.root?.id).toBe('loc-a');
    expect(out.locations.map((l: any) => l.id)).toEqual(['loc-a']);
    expect(out.screens.map((s: any) => s.id)).toEqual(['s1']);
    expect(prisma.client.screen.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: { in: ['loc-a'] } } }),
    );
  });

  it('a tenant outside the caller fleet is refused, not silently ignored', async () => {
    const { c } = makeHierarchyController(screens);
    await expect(c.fleet(req('corp'), res(), 'someone-elses-org')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('passing your own id is a no-op, not a permission check', async () => {
    const { c, prisma } = makeHierarchyController(screens);
    const out: any = await c.fleet(req('loc-a', 'SCHOOL_ADMIN'), res(), 'loc-a');
    expect(out.locations.map((l: any) => l.id)).toEqual(['loc-a']);
    // Membership never queried — short-circuits before readableTenantIds.
    expect(prisma.client.tenant.findMany).toHaveBeenCalledTimes(1); // only rootId's children
  });
});
