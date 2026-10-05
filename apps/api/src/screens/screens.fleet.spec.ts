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
import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) =>
    o?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

function makeController(opts: { self: any; children: any[]; screens: any[] }) {
  const prisma = {
    client: {
      tenantBranding: { findMany: jest.fn(async () => []) },
      tenant: {
        findUnique: jest.fn().mockResolvedValue(opts.self),
        findMany: jest.fn().mockResolvedValue(opts.children),
      },
      screen: { findMany: jest.fn().mockResolvedValue(opts.screens) },
      screenGroup: { findMany: jest.fn().mockResolvedValue([]) },
      schedule: { findMany: jest.fn().mockResolvedValue([]) },
      playlist: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };
  const c = new ScreensController(
    prisma as unknown as PrismaService,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { c, prisma };
}

const res = () => ({ setHeader: jest.fn() }) as any;
const req = (tenantId: string, role = 'DISTRICT_ADMIN') => ({ user: { tenantId, role } });
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

  it('carries what the district ProofDrawer needs to say what a screen is doing: the download report stamp and the credential verdict', async () => {
    const now = Date.now();
    const corp = T('corp', 'Corporate', 'corp');
    const reportAt = new Date(now - 20_000);
    const screens = [
      {
        id: 's1', name: 'Lobby', status: 'ONLINE', tenantId: 'corp', lastPingAt: new Date(now),
        latitude: null, longitude: null,
        lastRenderedAt: new Date(now - 5_000), lastRenderedHash: 'idle:content-downloading',
        lastCacheReport: { playlist: { count: 1 }, downloading: { file: 'promo.mp4', bytesLoaded: 62, bytesTotal: 100, deferredCommit: false } },
        lastCacheReportAt: reportAt,
        authState: 'REPAIR_REQUIRED',
      },
      { id: 's2', name: 'Gym', status: 'ONLINE', tenantId: 'corp', lastPingAt: new Date(now), latitude: null, longitude: null },
    ];
    const { c } = makeController({ self: corp, children: [], screens });
    const out: any = await c.fleet(req('corp'), res());
    const s1 = out.screens.find((x: any) => x.id === 's1');
    expect(s1.lastCacheReportAt).toBe(reportAt);
    expect(s1.lastCacheReport.downloading).toMatchObject({ file: 'promo.mp4', bytesLoaded: 62 });
    expect(s1.authState).toBe('REPAIR_REQUIRED');
    expect(s1.lastRenderedHash).toBe('idle:content-downloading');
    const s2 = out.screens.find((x: any) => x.id === 's2');
    expect(s2.lastCacheReportAt).toBeNull();
    expect(s2.authState).toBeNull();
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

describe('fleet operations context', () => {
  it('bulk-scopes groups, schedules and playlists and returns operational details without child pairing secrets', async () => {
    const { c, prisma } = makeController({
      self: T('corp', 'Corporate', 'corp'),
      children: [T('a', 'Office A', 'a')],
      screens: [
        {
          id: 'own',
          name: 'Corporate lobby',
          tenantId: 'corp',
          status: 'ONLINE',
          lastPingAt: new Date(),
          deviceFingerprint: 'own-fp',
          pairingCode: 'OWN123',
          deviceSecret: 'secret',
          hardwareModel: 'Test model',
          ipAddress: '192.0.2.1',
        },
        {
          id: 'child',
          name: 'Child lobby',
          tenantId: 'a',
          status: 'ONLINE',
          lastPingAt: new Date(),
          screenGroupId: 'group-a',
          screenGroup: { id: 'group-a', name: 'Lobby' },
          deviceFingerprint: 'child-fp',
          pairingCode: 'CHILD1',
          deviceSecret: 'secret',
          resolution: '1920x1080',
        },
      ],
    });
    prisma.client.screenGroup.findMany.mockResolvedValue([
      { id: 'group-a', tenantId: 'a', name: 'Lobby' },
    ]);
    prisma.client.schedule.findMany.mockResolvedValue([
      {
        id: 'schedule',
        tenantId: 'a',
        screenGroupId: 'group-a',
        isActive: true,
        startTime: new Date(Date.now() - 1000),
        endTime: null,
        playlist: { id: 'playlist', name: 'Welcome', syncPlayback: true },
      },
    ]);
    prisma.client.playlist.findMany.mockResolvedValue([
      { id: 'playlist', tenantId: 'a', name: 'Welcome', items: [] },
    ]);
    const result = await c.fleet(req('corp'), res(), undefined, 'operations');
    for (const model of ['screenGroup', 'schedule', 'playlist'] as const) {
      expect(prisma.client[model].findMany).toHaveBeenCalledTimes(1);
      expect(prisma.client[model].findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: { in: ['corp', 'a'] } }),
        }),
      );
    }
    expect(result.screens[0]).toMatchObject({
      tenantId: 'corp',
      hardwareModel: 'Test model',
      ipAddress: '192.0.2.1',
      deviceFingerprint: 'own-fp',
    });
    expect(result.screens[1]).toMatchObject({
      tenantId: 'a',
      screenGroupId: 'group-a',
      resolution: '1920x1080',
      syncActive: true,
    });
    expect(result.screens[1]).not.toHaveProperty('deviceFingerprint');
    for (const screen of result.screens) {
      expect(screen).not.toHaveProperty('pairingCode');
      expect(screen).not.toHaveProperty('deviceSecret');
    }
    expect(result.operations.groups[0]).toMatchObject({
      sourceTenant: { id: 'a', name: 'Office A' },
      syncActive: true,
    });
    expect(result.operations.playlists[0].name).toBe('Welcome');
  });

  it('the summary read does not fetch operations or grow the ordinary payload', async () => {
    const { c, prisma } = makeController({
      self: T('corp', 'Corporate', 'corp'),
      children: [],
      screens: [],
    });
    const result = await c.fleet(req('corp'), res());
    expect(result).not.toHaveProperty('operations');
    for (const model of ['screenGroup', 'schedule', 'playlist'] as const)
      expect(prisma.client[model].findMany).not.toHaveBeenCalled();
  });

  it('cannot re-root operations into an unrelated tenant', async () => {
    const { c, prisma } = makeController({
      self: T('corp', 'Corporate', 'corp'),
      children: [],
      screens: [],
    });
    await expect(
      c.fleet(req('corp'), res(), 'unrelated', 'operations'),
    ).rejects.toThrow();
    expect(prisma.client.screen.findMany).not.toHaveBeenCalled();
    expect(prisma.client.schedule.findMany).not.toHaveBeenCalled();
  });
});
