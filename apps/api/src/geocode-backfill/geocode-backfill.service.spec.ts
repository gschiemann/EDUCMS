/**
 * Task #60 — legacy Tenant geocode back-fill. Pinned behaviors:
 *   1. Dry-run (default) resolves addresses but writes nothing.
 *   2. A tenant with address set + lat/lng null is eligible.
 *   3. A tenant that already has lat/lng is skipped (idempotent re-run).
 *   4. A single tenant's geocode failure is isolated — the batch continues
 *      and other tenants still get processed/geocoded.
 *   5. `limit` caps how many candidates are pulled/processed per call.
 *   6. A real (non-dry-run) run writes lat/lng AND creates an AuditLog row
 *      per tenant actually geocoded.
 *
 * GeocodingService is mocked (network-free); the DELAY_MS pacing sleep is
 * neutralized via fake timers so the suite stays fast.
 */
import { GeocodeBackfillService } from './geocode-backfill.service';
import type { GeocodingService } from '../geocoding/geocoding.service';
import type { PrismaService } from '../prisma/prisma.service';

interface TenantRow {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

function makePrismaMock(initialTenants: TenantRow[]) {
  const tenants = new Map<string, TenantRow>();
  for (const t of initialTenants) tenants.set(t.id, { ...t });
  const auditRows: any[] = [];

  const client = {
    tenant: {
      findMany: jest.fn(async ({ where, take }: any) => {
        let rows = Array.from(tenants.values());
        // Minimal WHERE emulation matching what the service actually sends:
        // address: {not: null}, latitude: null, longitude: null, optional id.
        if (where?.address?.not === null) {
          rows = rows.filter((r) => r.address !== null);
        }
        if ('latitude' in (where || {}) && where.latitude === null) {
          rows = rows.filter((r) => r.latitude === null);
        }
        if ('longitude' in (where || {}) && where.longitude === null) {
          rows = rows.filter((r) => r.longitude === null);
        }
        if (where?.id) {
          rows = rows.filter((r) => r.id === where.id);
        }
        rows.sort((a, b) => a.name.localeCompare(b.name));
        if (typeof take === 'number') rows = rows.slice(0, take);
        return rows.map((r) => ({ ...r }));
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = tenants.get(where.id);
        if (!row) throw new Error('tenant not found');
        Object.assign(row, data);
        return { ...row };
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditRows.push(data);
        return { id: `audit-${auditRows.length}`, ...data };
      }),
    },
  };

  return {
    prisma: { client } as unknown as PrismaService,
    tenants,
    auditRows,
    client,
  };
}

function makeGeocodingMock(searchImpl: (q: string) => any) {
  return {
    search: jest.fn(async (q: string) => searchImpl(q)),
  } as unknown as GeocodingService;
}

describe('GeocodeBackfillService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  /** Runs `promise` while auto-advancing fake timers so the service's
   *  inter-call rate-limit `sleep()` doesn't hang the test. */
  async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    void promise.finally(() => {
      done = true;
    });
    while (!done) {
      await Promise.resolve();
      jest.advanceTimersByTime(2000);
    }
    return promise;
  }

  it('a null-lat/lng tenant with an address is eligible and geocoded in a real run', async () => {
    const { prisma, tenants } = makePrismaMock([
      { id: 't1', name: 'Alpha School', address: '150 Chardon Ave, Chardon, OH', latitude: null, longitude: null },
    ]);
    const geocoding = makeGeocodingMock(() => [
      { display_name: '150 Chardon Ave, Chardon, OH, 44024', lat: '41.5894', lon: '-81.2006', source: 'census' },
    ]);
    const svc = new GeocodeBackfillService(prisma, geocoding);

    const summary = await runWithTimers(svc.run({ dryRun: false }));

    expect(summary.eligible).toBe(1);
    expect(summary.geocoded).toBe(1);
    expect(summary.wouldGeocode).toBe(0);
    expect(tenants.get('t1')!.latitude).toBeCloseTo(41.5894);
    expect(tenants.get('t1')!.longitude).toBeCloseTo(-81.2006);
  });

  it('DRY-RUN (default) resolves the address but writes nothing to the DB', async () => {
    const { prisma, tenants, client } = makePrismaMock([
      { id: 't1', name: 'Alpha School', address: '150 Chardon Ave, Chardon, OH', latitude: null, longitude: null },
    ]);
    const geocoding = makeGeocodingMock(() => [
      { display_name: '150 Chardon Ave, Chardon, OH, 44024', lat: '41.5894', lon: '-81.2006', source: 'census' },
    ]);
    const svc = new GeocodeBackfillService(prisma, geocoding);

    // No dryRun passed at all — must default to true (safest default).
    const summary = await runWithTimers(svc.run());

    expect(summary.dryRun).toBe(true);
    expect(summary.wouldGeocode).toBe(1);
    expect(summary.geocoded).toBe(0);
    // Nothing written: tenant row unchanged, no update() call, no audit.
    expect(tenants.get('t1')!.latitude).toBeNull();
    expect(tenants.get('t1')!.longitude).toBeNull();
    expect(client.tenant.update).not.toHaveBeenCalled();
    expect(client.auditLog.create).not.toHaveBeenCalled();
  });

  it('a tenant that ALREADY has lat/lng is excluded by the query and never geocoded (idempotent re-run)', async () => {
    const { prisma, client } = makePrismaMock([
      { id: 't1', name: 'Already Placed', address: '1 Main St', latitude: 40.0, longitude: -80.0 },
      { id: 't2', name: 'Needs Geocoding', address: '2 Main St', latitude: null, longitude: null },
    ]);
    const geocoding = makeGeocodingMock(() => [
      { display_name: '2 Main St', lat: '1', lon: '2', source: 'nominatim' },
    ]);
    const svc = new GeocodeBackfillService(prisma, geocoding);

    // A fleet-wide run (no tenantId filter) — t1 already has coordinates and
    // must never reach the geocoder or be re-written; t2 is the only one
    // that should be touched. Running this repeatedly is exactly the
    // "safe to re-run" idempotency the task calls for.
    const summary = await runWithTimers(svc.run({ dryRun: false }));

    expect(summary.eligible).toBe(1);
    expect(summary.geocoded).toBe(1);
    expect(geocoding.search).toHaveBeenCalledTimes(1);
    expect(geocoding.search).toHaveBeenCalledWith('2 Main St', expect.anything());
    expect(client.tenant.update).toHaveBeenCalledTimes(1);
    expect(client.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't2' } }),
    );
  });

  it('the service-level guard also skips a coords-having row even if it slips past the DB filter (defense in depth)', async () => {
    // Simulates a stale/hand-built WHERE (or a race) that let an
    // already-geocoded row through to the service layer anyway — the
    // service's own per-row check must catch it independently of the SQL.
    const { prisma, client } = makePrismaMock([]);
    (prisma.client.tenant.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 't1', name: 'Already Placed', address: '1 Main St', latitude: 40.0, longitude: -80.0 },
    ]);
    const geocoding = makeGeocodingMock(() => {
      throw new Error('should never be called for an already-geocoded tenant');
    });
    const svc = new GeocodeBackfillService(prisma, geocoding);

    const summary = await runWithTimers(svc.run({ dryRun: false }));

    expect(summary.skipped).toBe(1);
    expect(summary.geocoded).toBe(0);
    expect(summary.details[0]).toMatchObject({ status: 'skipped', reason: 'already_has_coordinates' });
    expect(geocoding.search).not.toHaveBeenCalled();
    expect(client.tenant.update).not.toHaveBeenCalled();
  });

  it('a geocode failure on one tenant is isolated — the batch continues and other tenants still geocode', async () => {
    const { prisma, tenants } = makePrismaMock([
      { id: 't1', name: 'Bad Address Co', address: 'complete gibberish address', latitude: null, longitude: null },
      { id: 't2', name: 'Good Address Co', address: '1600 Pennsylvania Ave NW', latitude: null, longitude: null },
    ]);
    const geocoding = makeGeocodingMock((q: string) => {
      if (q.includes('gibberish')) throw new Error('provider blew up');
      return [{ display_name: '1600 Pennsylvania Ave NW', lat: '38.8977', lon: '-77.0365', source: 'nominatim' }];
    });
    const svc = new GeocodeBackfillService(prisma, geocoding);

    const summary = await runWithTimers(svc.run({ dryRun: false }));

    expect(summary.eligible).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.geocoded).toBe(1);
    expect(tenants.get('t1')!.latitude).toBeNull(); // failed tenant untouched
    expect(tenants.get('t2')!.latitude).toBeCloseTo(38.8977); // good tenant still written
    const failedDetail = summary.details.find((d) => d.tenantId === 't1');
    expect(failedDetail?.status).toBe('failed');
  });

  it('a geocode call that returns no hits is treated as a failure, not a crash', async () => {
    const { prisma } = makePrismaMock([
      { id: 't1', name: 'Nowhere Co', address: 'nowhere at all', latitude: null, longitude: null },
    ]);
    const geocoding = makeGeocodingMock(() => []);
    const svc = new GeocodeBackfillService(prisma, geocoding);

    const summary = await runWithTimers(svc.run({ dryRun: false }));

    expect(summary.failed).toBe(1);
    expect(summary.details[0]).toMatchObject({ status: 'failed', reason: 'no_geocode_match' });
  });

  it('`limit` caps how many tenants are processed in one invocation', async () => {
    const many: TenantRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      name: `Tenant ${i}`,
      address: `${i} Main St`,
      latitude: null,
      longitude: null,
    }));
    const { prisma } = makePrismaMock(many);
    const geocoding = makeGeocodingMock(() => [
      { display_name: 'Some Address', lat: '10', lon: '20', source: 'nominatim' },
    ]);
    const svc = new GeocodeBackfillService(prisma, geocoding);

    const summary = await runWithTimers(svc.run({ dryRun: true, limit: 2 }));

    expect(summary.scanned).toBe(2);
    expect(summary.eligible).toBe(2);
    expect(summary.wouldGeocode).toBe(2);
    expect(geocoding.search).toHaveBeenCalledTimes(2);
  });

  it('defaults limit to 50 when omitted, and clamps an absurd limit to the hard ceiling (500)', async () => {
    const { prisma, client } = makePrismaMock([
      { id: 't1', name: 'A', address: '1 A St', latitude: null, longitude: null },
    ]);
    const geocoding = makeGeocodingMock(() => [
      { display_name: 'A', lat: '1', lon: '2', source: 'nominatim' },
    ]);
    const svc = new GeocodeBackfillService(prisma, geocoding);

    await runWithTimers(svc.run({ dryRun: true }));
    expect(client.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );

    await runWithTimers(svc.run({ dryRun: true, limit: 999999 }));
    expect(client.tenant.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 500 }),
    );
  });

  it('a real run writes an AuditLog row for every tenant actually geocoded (not for skipped/failed ones)', async () => {
    const { prisma, auditRows } = makePrismaMock([
      { id: 't1', name: 'Geocode Me', address: '1 Main St', latitude: null, longitude: null },
      { id: 't2', name: 'Already Placed', address: '2 Main St', latitude: 5, longitude: 6 },
    ]);
    const geocoding = makeGeocodingMock(() => [
      { display_name: '1 Main St', lat: '10', lon: '20', source: 'nominatim' },
    ]);
    const svc = new GeocodeBackfillService(prisma, geocoding);

    await runWithTimers(svc.run({ dryRun: false, actorUserId: 'user-1' }));

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      tenantId: 't1',
      userId: 'user-1',
      action: 'GEOCODE_BACKFILL',
      targetType: 'Tenant',
      targetId: 't1',
    });
  });

  it('a tenant with a blank/too-short address is skipped, never sent to the geocoder', async () => {
    const { prisma } = makePrismaMock([
      { id: 't1', name: 'Blank Address Co', address: '  ', latitude: null, longitude: null },
    ]);
    const geocoding = makeGeocodingMock(() => {
      throw new Error('should never be called for a blank address');
    });
    const svc = new GeocodeBackfillService(prisma, geocoding);

    const summary = await runWithTimers(svc.run({ dryRun: true }));

    expect(summary.skipped).toBe(1);
    expect(geocoding.search).not.toHaveBeenCalled();
  });
});
