import { EmergencyReadinessService } from './emergency-readiness.service';

/**
 * EmergencyReadinessService.computeDistrict — the DISTRICT rollup
 * (2026-08-24, district command-center wave).
 *
 * Three things this suite pins, because all three are load-bearing:
 *
 *  1. BATCHING. The query count must be CONSTANT in school count. A district
 *     can run 40 schools against a connection_limit=10 pool; a
 *     5-queries-per-school fan-out would be 200 queries per dashboard open.
 *     The 3-school and 40-school cases are asserted to issue the SAME number
 *     of queries.
 *  2. THE VERDICT CONTRACT. A delivery WARN (Redis in polling fallback) must
 *     NOT repaint every school amber — that would drown the per-school signal
 *     the rollup exists to surface. A delivery MISSING (db/signer down) must
 *     force every school NOT_CONFIGURED, because nothing can be alerted.
 *  3. TENANT SCOPE. Every query is constrained to the caller's own tenant or
 *     its direct children, and archived children are excluded (the TEN-001
 *     class + the 2026-07-23 archived-test-tenant incident).
 */

interface DistrictMockOpts {
  /** Per-school panic wiring; keys are tenant ids. */
  wiring?: Record<string, Record<string, string | null>>;
  /** Per-school vertical; a school not listed here has none stored (→ K12 default). */
  verticals?: Record<string, string>;
  /** Per-school `Tenant.emergencyEnabled`; unlisted ⇒ null ("never stated"). */
  enabled?: Record<string, boolean | null>;
  /** Per-school [total, online] screen counts. */
  screens?: Record<string, [number, number]>;
  schoolCount?: number;
  redisState?: 'ok' | 'none' | 'fail';
  signerThrows?: boolean;
  dbFails?: boolean;
}

const ALL_WIRED = {
  panicLockdownPlaylistId: 'pl1',
  panicSecurePlaylistId: 'pl2',
  panicHoldPlaylistId: 'pl3',
  panicEvacuatePlaylistId: 'pl4',
  panicWeatherPlaylistId: 'pl5',
  panicMedicalPlaylistId: 'pl6',
};

function makeDistrictMocks(opts: DistrictMockOpts = {}) {
  const n = opts.schoolCount ?? 3;
  // 'district' is the parent's own row; 'school-1..n' are its children.
  const ids = ['district', ...Array.from({ length: n }, (_, i) => `school-${i + 1}`)];
  const wheres: any[] = [];
  let dbQueries = 0;

  const prisma = {
    client: {
      tenant: {
        findMany: jest.fn(async (args: any) => {
          dbQueries += 1;
          wheres.push(args.where);
          return ids.map((id) => ({
            id,
            name: id === 'district' ? 'District Office' : `School ${id.split('-')[1]}`,
            slug: id,
            ...(opts.verticals?.[id] ? { vertical: opts.verticals[id] } : {}),
            emergencyEnabled: opts.enabled?.[id] ?? null,
            ...ALL_WIRED,
            ...(opts.wiring?.[id] ?? {}),
          }));
        }),
      },
      screen: {
        groupBy: jest.fn(async (args: any) => {
          dbQueries += 1;
          wheres.push(args.where);
          const isOnlineQuery = !!args.where?.lastPingAt;
          return ids
            .map((id) => {
              const [total, online] = opts.screens?.[id] ?? [4, 4];
              return { tenantId: id, _count: { _all: isOnlineQuery ? online : total } };
            })
            .filter((r) => r._count._all > 0);
        }),
      },
      $queryRaw: opts.dbFails
        ? jest.fn(async () => { dbQueries += 1; throw new Error('db down'); })
        : jest.fn(async () => { dbQueries += 1; return 1; }),
    },
  } as any;

  const redis = {
    publisher: opts.redisState === 'none'
      ? null
      : {
          status: 'ready',
          ping: opts.redisState === 'fail'
            ? jest.fn(async () => { throw new Error('no pong'); })
            : jest.fn(async () => 'PONG'),
        },
  } as any;

  const wsSigner = {
    signMessage: opts.signerThrows
      ? jest.fn(() => { throw new Error('no key'); })
      : jest.fn(() => ({ signature: 'sig' })),
  } as any;

  return { prisma, redis, wsSigner, wheres, queryCount: () => dbQueries };
}

const svcFor = (m: ReturnType<typeof makeDistrictMocks>) =>
  new EmergencyReadinessService(m.prisma, m.redis, m.wsSigner);

describe('EmergencyReadinessService.computeDistrict', () => {
  it('healthy district → every school READY, notReadyCount 0', async () => {
    const m = makeDistrictMocks();
    const r = await svcFor(m).computeDistrict('district');
    expect(r.schools).toHaveLength(4); // the office + 3 schools
    expect(r.schools.every((s) => s.verdict === 'READY')).toBe(true);
    expect(r.notReadyCount).toBe(0);
    expect(r.delivery.status).toBe('ok');
  });

  it('marks the district\'s own row isSelf, children not', async () => {
    const m = makeDistrictMocks();
    const r = await svcFor(m).computeDistrict('district');
    expect(r.schools.filter((s) => s.isSelf).map((s) => s.tenantId)).toEqual(['district']);
    expect(r.schools.filter((s) => !s.isSelf)).toHaveLength(3);
  });

  it('a school missing lockdown content → NOT_CONFIGURED, others untouched', async () => {
    const m = makeDistrictMocks({
      wiring: {
        'school-2': {
          panicLockdownPlaylistId: null, panicSecurePlaylistId: null,
          panicHoldPlaylistId: null, panicEvacuatePlaylistId: null,
          panicWeatherPlaylistId: null, panicMedicalPlaylistId: null,
        },
      },
    });
    const r = await svcFor(m).computeDistrict('district');
    const bad = r.schools.find((s) => s.tenantId === 'school-2')!;
    expect(bad.verdict).toBe('NOT_CONFIGURED');
    expect(bad.lockdownWired).toBe(false);
    expect(bad.contentWired).toBe(0);
    expect(bad.missingTypes).toContain('Lockdown');
    expect(r.notReadyCount).toBe(1);
    expect(r.schools.filter((s) => s.tenantId !== 'school-2').every((s) => s.verdict === 'READY')).toBe(true);
  });

  // ── Enablement (2026-09-24) ─────────────────────────────────────────
  // Greg, on a print-shop location the dashboard had painted red: "why are we
  // showing an alert that we cant play emergency content but i havent even
  // enabled it?" The report graded every tenant as if alerts were on.
  const NOTHING_WIRED = {
    panicLockdownPlaylistId: null,
    panicSecurePlaylistId: null,
    panicHoldPlaylistId: null,
    panicEvacuatePlaylistId: null,
    panicWeatherPlaylistId: null,
    panicMedicalPlaylistId: null,
  };

  it('a non-K-12 location that never turned alerts on is DISABLED — not a gap, not counted, no fix list', async () => {
    const m = makeDistrictMocks({
      verticals: { 'school-2': 'BAR' },
      wiring: { 'school-2': NOTHING_WIRED },
    });
    const r = await svcFor(m).computeDistrict('district');
    const bar = r.schools.find((s) => s.tenantId === 'school-2')!;
    expect(bar.verdict).toBe('DISABLED');
    expect(bar.enabled).toBe(false);
    expect(bar.locked).toBe(false);
    expect(bar.missingTypes).toEqual([]);
    expect(r.notReadyCount).toBe(0);
    expect(r.disabledCount).toBe(1);
  });

  it('a non-K-12 location that turned alerts ON is graded like any other', async () => {
    const m = makeDistrictMocks({
      verticals: { 'school-2': 'BAR' },
      enabled: { 'school-2': true },
      wiring: {
        'school-2': {
          panicEvacuatePlaylistId: null,
          panicWeatherPlaylistId: null,
          panicMedicalPlaylistId: null,
        },
      },
    });
    const r = await svcFor(m).computeDistrict('district');
    const bar = r.schools.find((s) => s.tenantId === 'school-2')!;
    expect(bar.enabled).toBe(true);
    expect(bar.locked).toBe(false);
    expect(bar.verdict).toBe('NOT_CONFIGURED');
    expect(bar.missingTypes).toEqual(['Fire / Evacuate', 'Weather', 'Medical']);
    expect(r.notReadyCount).toBe(1);
    expect(r.disabledCount).toBe(0);
  });

  it('a K-12 location is graded even with a stored false — the lock wins', async () => {
    const m = makeDistrictMocks({ enabled: { 'school-1': false } });
    const r = await svcFor(m).computeDistrict('district');
    const school = r.schools.find((s) => s.tenantId === 'school-1')!;
    expect(school.enabled).toBe(true);
    expect(school.locked).toBe(true);
    expect(school.verdict).toBe('READY');
    expect(r.disabledCount).toBe(0);
  });

  it('every row carries the enablement facts; rows with no stored vertical grade as K-12: on and locked', async () => {
    const r = await svcFor(makeDistrictMocks()).computeDistrict('district');
    expect(
      r.schools.every((s) => s.enabled === true && s.locked === true),
    ).toBe(true);
    expect(r.disabledCount).toBe(0);
  });

  it('lockdown wired but other types missing → NEEDS_ATTENTION naming the gaps', async () => {
    const m = makeDistrictMocks({
      wiring: { 'school-1': { panicEvacuatePlaylistId: null, panicMedicalPlaylistId: null } },
    });
    const r = await svcFor(m).computeDistrict('district');
    const s1 = r.schools.find((s) => s.tenantId === 'school-1')!;
    expect(s1.verdict).toBe('NEEDS_ATTENTION');
    expect(s1.contentWired).toBe(4);
    expect(s1.contentTotal).toBe(6);
    expect(s1.missingTypes).toEqual(['Fire / Evacuate', 'Medical']);
  });

  it('partly-offline school → NEEDS_ATTENTION with honest online/total', async () => {
    const m = makeDistrictMocks({ screens: { 'school-3': [6, 4] } });
    const r = await svcFor(m).computeDistrict('district');
    const s3 = r.schools.find((s) => s.tenantId === 'school-3')!;
    expect(s3.verdict).toBe('NEEDS_ATTENTION');
    expect(s3.screensTotal).toBe(6);
    expect(s3.screensOnline).toBe(4);
  });

  it('school with zero screens → NEEDS_ATTENTION, not NOT_CONFIGURED (parity with compute())', async () => {
    const m = makeDistrictMocks({ screens: { 'district': [0, 0] } });
    const r = await svcFor(m).computeDistrict('district');
    const office = r.schools.find((s) => s.isSelf)!;
    expect(office.screensTotal).toBe(0);
    expect(office.verdict).toBe('NEEDS_ATTENTION');
  });

  it('delivery WARN (redis fallback) does NOT downgrade any school', async () => {
    const m = makeDistrictMocks({ redisState: 'none' });
    const r = await svcFor(m).computeDistrict('district');
    expect(r.delivery.status).toBe('warn');
    expect(r.delivery.detail).toMatch(/polling/i);
    // The whole point: a platform-level WARN must not repaint 40 rows amber.
    expect(r.schools.every((s) => s.verdict === 'READY')).toBe(true);
    expect(r.notReadyCount).toBe(0);
  });

  it('delivery MISSING (signer down) forces every school NOT_CONFIGURED', async () => {
    const m = makeDistrictMocks({ signerThrows: true });
    const r = await svcFor(m).computeDistrict('district');
    expect(r.delivery.status).toBe('missing');
    expect(r.schools.every((s) => s.verdict === 'NOT_CONFIGURED')).toBe(true);
    expect(r.notReadyCount).toBe(r.schools.length);
  });

  it('delivery MISSING (db probe fails) forces every school NOT_CONFIGURED', async () => {
    const m = makeDistrictMocks({ dbFails: true });
    const r = await svcFor(m).computeDistrict('district');
    expect(r.delivery.status).toBe('missing');
    expect(r.schools.every((s) => s.verdict === 'NOT_CONFIGURED')).toBe(true);
  });

  it('BATCHING: query count is CONSTANT in school count (3 vs 40 schools)', async () => {
    const small = makeDistrictMocks({ schoolCount: 3 });
    await svcFor(small).computeDistrict('district');
    const big = makeDistrictMocks({ schoolCount: 40 });
    const rBig = await svcFor(big).computeDistrict('district');

    expect(rBig.schools).toHaveLength(41);
    expect(big.queryCount()).toBe(small.queryCount());
    // 1 tenant findMany + 2 screen groupBy + 1 `SELECT 1` delivery probe.
    expect(big.queryCount()).toBe(4);
    // And never a per-school count() fan-out.
    expect(big.prisma.client.screen.groupBy).toHaveBeenCalledTimes(2);
    expect(big.prisma.client.tenant.findMany).toHaveBeenCalledTimes(1);
  });

  it('TENANT SCOPE: every query is bounded to the caller + its direct children', async () => {
    const m = makeDistrictMocks();
    await svcFor(m).computeDistrict('district');
    // The tenant read is the self-or-direct-child window, archived excluded.
    expect(m.wheres[0]).toEqual({
      OR: [{ id: 'district' }, { parentId: 'district', archivedAt: null }],
    });
    // Every screen groupBy is constrained to that resolved id set.
    for (const w of m.wheres.slice(1)) {
      expect(Array.isArray(w.tenantId?.in)).toBe(true);
      expect(w.tenantId.in).toContain('district');
      expect(w.tenantId.in).toContain('school-1');
    }
  });
});
