/**
 * P1 (2026-07-03) — fleet publish-to-locations must be per-location
 * transactional, must NEVER leave a screen dark, and must report an HONEST
 * partial result instead of a blanket "Publish failed" throw.
 *
 * THE BUG this proves is fixed (PlaylistDistributionService.publishToFleet):
 *   (a) The old loop had no try/catch — the FIRST location to fail aborted the
 *       whole method. Locations processed EARLIER had already committed their
 *       schedules live, but the caller saw a thrown error and the UI read it as
 *       total failure. Partial success masqueraded as total failure.
 *   (b) scheduleLive did deactivate-all → delete → create. A failure between the
 *       deactivate and the create left the screen with NO active schedule —
 *       DARK — and the failed location never rolled back to its previous
 *       working schedule.
 *
 * The fix:
 *   - Each location is wrapped in try/catch. A failure is collected into
 *     `failures[]`; already-published locations stay live; the method returns an
 *     honest breakdown (`ok`, `locationsSucceeded`, `locationsFailed`,
 *     `failures`, `perLocation`). Only an ALL-locations-failed publish throws.
 *   - scheduleLive is create(active)-THEN-deactivate-others, wrapped in one
 *     interactive $transaction, so the screen has ≥1 active schedule at every
 *     committed point AND a mid-swap failure rolls the screen back to its
 *     PREVIOUS working schedule.
 *
 * The suite is unit-level: PrismaService is mocked with an in-memory schedule
 * store whose $transaction runs the interactive callback against the same rows
 * (and is TRULY atomic — a throw inside the callback rolls back every mutation
 * it made), so we can assert the realistic committed state a real Postgres
 * transaction would produce.
 */

import 'reflect-metadata';
import { PlaylistDistributionService } from './playlist-distribution.service';

type ScheduleRow = {
  id: string;
  tenantId: string;
  playlistId: string;
  screenId: string | null;
  screenGroupId: string | null;
  isActive: boolean;
  priority: number;
  mode: string;
  startTime: Date;
  endTime: Date | null;
};

function matchScheduleWhere(r: ScheduleRow, where: any): boolean {
  if (!where) return true;
  if (where.tenantId !== undefined && r.tenantId !== where.tenantId) return false;
  if (where.playlistId !== undefined && r.playlistId !== where.playlistId) return false;
  if (where.isActive !== undefined && r.isActive !== where.isActive) return false;
  if (where.screenId !== undefined && r.screenId !== where.screenId) return false;
  if (where.screenGroupId !== undefined && r.screenGroupId !== where.screenGroupId) return false;
  if (where.id !== undefined) {
    if (typeof where.id === 'object' && where.id?.not !== undefined) {
      if (r.id === where.id.not) return false;
    } else if (r.id !== where.id) return false;
  }
  return true;
}

let seq = 0;

/**
 * Build a mocked PrismaService.
 *
 * @param scheduleRows          the shared in-memory schedule store
 * @param opts.failChildTenant  a childTenantId whose copyPlaylistIntoChild path
 *                              should throw (simulates a mid-loop location error)
 * @param opts.failCreateOnScreen a screenId whose schedule.create should throw
 *                              (simulates a mid-swap failure inside scheduleLive)
 */
function makePrisma(
  scheduleRows: ScheduleRow[],
  opts: { failChildTenant?: string; failCreateOnScreen?: string } = {},
) {
  const auditRows: any[] = [];
  const playlistCreates: any[] = [];

  function makeTx(store: ScheduleRow[]) {
    return {
      schedule: {
        deleteMany: jest.fn(async ({ where }: any) => {
          let n = 0;
          for (let i = store.length - 1; i >= 0; i--) {
            if (matchScheduleWhere(store[i], where)) {
              store.splice(i, 1);
              n++;
            }
          }
          return { count: n };
        }),
        create: jest.fn(async ({ data }: any) => {
          if (opts.failCreateOnScreen && data.screenId === opts.failCreateOnScreen) {
            throw new Error('simulated schedule.create failure (mid-swap)');
          }
          const rowNew: ScheduleRow = {
            id: `s-new-${++seq}`,
            tenantId: data.tenantId,
            playlistId: data.playlistId,
            screenId: data.screenId ?? null,
            screenGroupId: data.screenGroupId ?? null,
            isActive: data.isActive ?? true,
            priority: data.priority ?? 0,
            mode: data.mode ?? 'replace',
            startTime: data.startTime ?? new Date(),
            endTime: data.endTime ?? null,
          };
          store.push(rowNew);
          return { id: rowNew.id };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let n = 0;
          for (const r of store) {
            if (matchScheduleWhere(r, where)) {
              Object.assign(r, data);
              n++;
            }
          }
          return { count: n };
        }),
      },
    };
  }

  // The FIXED scheduleLive uses the interactive $transaction form; the OLD
  // (buggy) scheduleLive calls client.schedule.{updateMany,deleteMany,create}
  // directly and non-atomically. We define BOTH so the SAME spec runs against
  // the buggy code too (git-stash proof) — there it takes the direct path and
  // demonstrates the real dark-window + dishonest-throw behavior, rather than
  // crashing on an undefined method.
  const directSchedule = makeTx(scheduleRows).schedule;

  const client: any = {
    schedule: directSchedule,
    // Interactive form used by the FIXED scheduleLive.
    $transaction: jest.fn(async (cb: any) => {
      // Snapshot so a thrown callback rolls the store back (real tx semantics).
      const snapshot = scheduleRows.map((r) => ({ ...r }));
      try {
        return await cb(makeTx(scheduleRows));
      } catch (e) {
        scheduleRows.length = 0;
        for (const r of snapshot) scheduleRows.push(r);
        throw e;
      }
    }),
    playlist: {
      // copyPlaylistIntoChild → findFirst(existing copy) then create.
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        if (opts.failChildTenant && data.tenantId === opts.failChildTenant) {
          throw new Error('simulated copyPlaylistIntoChild failure');
        }
        const id = `copy-${data.tenantId}`;
        playlistCreates.push({ id, ...data });
        return { id };
      }),
    },
    // copyPlaylistIntoChild copies assets; our source has none, so these are
    // no-ops, but keep them defined so the service doesn't NPE.
    asset: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'asset-x' })),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditRows.push(data);
        return data;
      }),
    },
  };

  const prisma = { client } as any;
  return { prisma, auditRows, playlistCreates, scheduleRows };
}

function activeForScreen(rows: ScheduleRow[], screenId: string): ScheduleRow[] {
  return rows.filter((r) => r.screenId === screenId && r.isActive);
}

describe('PlaylistDistributionService — no dark window + honest partial (P1)', () => {
  // A parent "Corporate" (t-parent) with two child locations (t-A, t-B) and one
  // screen each. Each child screen already has a PREVIOUS active schedule
  // (their existing working content) that must survive a failed publish.
  function seedTwoLocations(): ScheduleRow[] {
    return [
      {
        id: 's-prev-A', tenantId: 't-A', playlistId: 'pl-old-A', screenId: 'scrA',
        screenGroupId: null, isActive: true, priority: 0, mode: 'replace',
        startTime: new Date('2026-01-01'), endTime: null,
      },
      {
        id: 's-prev-B', tenantId: 't-B', playlistId: 'pl-old-B', screenId: 'scrB',
        screenGroupId: null, isActive: true, priority: 0, mode: 'replace',
        startTime: new Date('2026-01-01'), endTime: null,
      },
    ];
  }

  // Minimal source-playlist stub (no items, null template) — publishToFleet is
  // given the pre-resolved source, children, screens via injected prisma reads.
  // We call the private helpers' entry point publishToFleet, so we mock the
  // tenant/screen reads it performs up front.
  function wireReads(
    prisma: any,
    screens: Array<{ id: string; name: string; tenantId: string }>,
  ) {
    prisma.client.playlist.findFirst = jest.fn(async ({ where }: any) => {
      // First call = the source lookup (has items/template include); later
      // calls = copyPlaylistIntoChild's existing-copy lookup (returns null).
      if (where?.id === 'pl-src' && where?.tenantId === 't-parent') {
        return {
          id: 'pl-src', tenantId: 't-parent', name: 'Fleet Menu',
          templateId: null, template: null, isProtected: false, items: [],
        };
      }
      return null;
    });
    prisma.client.tenant = {
      findMany: jest.fn(async () => [
        { id: 't-A', name: 'Location A' },
        { id: 't-B', name: 'Location B' },
      ]),
      findUnique: jest.fn(async () => ({ name: 'Corporate' })),
    };
    prisma.client.screen = {
      findMany: jest.fn(async () => screens),
    };
  }

  it('a mid-loop location failure leaves already-published locations LIVE, leaves the failed location on its PREVIOUS schedule (never dark), and surfaces an HONEST partial result', async () => {
    const rows = seedTwoLocations();
    // Make LOCATION B's copy throw. Location A must still go live; B must keep
    // its previous schedule.
    const { prisma, auditRows } = makePrisma(rows, { failChildTenant: 't-B' });
    wireReads(prisma, [
      { id: 'scrA', name: 'Screen A', tenantId: 't-A' },
      { id: 'scrB', name: 'Screen B', tenantId: 't-B' },
    ]);
    const svc = new PlaylistDistributionService(prisma);

    const out = await svc.publishToFleet({
      parentTenantId: 't-parent',
      actorUserId: 'u1',
      sourcePlaylistId: 'pl-src',
      screenIds: ['scrA', 'scrB'],
    });

    // ── HONEST PARTIAL RESULT ──────────────────────────────────────────────
    // The publish did NOT throw (some locations succeeded) and reports the
    // truthful breakdown.
    expect(out.ok).toBe(false);
    expect(out.locationsSucceeded).toBe(1);
    expect(out.locationsFailed).toBe(1);
    expect(out.perLocation.map((l) => l.tenantId)).toEqual(['t-A']);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].tenantId).toBe('t-B');
    expect(out.failures[0].tenantName).toBe('Location B');
    expect(out.screensScheduled).toBe(1);

    // ── LOCATION A WENT LIVE ───────────────────────────────────────────────
    // Its previous schedule was stood down and the new copy is active.
    const aActive = activeForScreen(rows, 'scrA');
    expect(aActive).toHaveLength(1);
    expect(aActive[0].playlistId).toBe('copy-t-A');
    expect(rows.find((r) => r.id === 's-prev-A')?.isActive).toBe(false);

    // ── LOCATION B NEVER WENT DARK ─────────────────────────────────────────
    // The failed location kept EXACTLY its previous working schedule — still
    // active, still pointing at its old playlist. No new copy schedule, no
    // deactivation of its previous coverage.
    const bActive = activeForScreen(rows, 'scrB');
    expect(bActive).toHaveLength(1);
    expect(bActive[0].id).toBe('s-prev-B');
    expect(bActive[0].playlistId).toBe('pl-old-B');
    expect(rows.some((r) => r.playlistId === 'copy-t-B')).toBe(false);

    // Audit written only for the location that actually published.
    expect(auditRows.filter((a) => a.action === 'PLAYLIST_FLEET_PUBLISHED')).toHaveLength(1);
    expect(auditRows[0].tenantId).toBe('t-A');
  });

  it('scheduleLive never leaves the screen with zero active schedules — a mid-swap create failure rolls the screen back to its PREVIOUS active schedule', async () => {
    const rows = seedTwoLocations();
    // Make the schedule.create throw for location A's screen — the swap must
    // roll back so scrA keeps its previous active schedule (not dark).
    // Location B succeeds, so the method returns a partial result (rather than
    // the total-failure throw) and we can inspect the rolled-back scrA state.
    const { prisma } = makePrisma(rows, { failCreateOnScreen: 'scrA' });
    wireReads(prisma, [
      { id: 'scrA', name: 'Screen A', tenantId: 't-A' },
      { id: 'scrB', name: 'Screen B', tenantId: 't-B' },
    ]);
    const svc = new PlaylistDistributionService(prisma);

    const out = await svc.publishToFleet({
      parentTenantId: 't-parent',
      actorUserId: 'u1',
      sourcePlaylistId: 'pl-src',
      screenIds: ['scrA', 'scrB'],
    });

    // Location A failed (its screen's swap threw + rolled back); B succeeded.
    expect(out.ok).toBe(false);
    expect(out.locationsFailed).toBe(1);
    expect(out.failures[0].tenantId).toBe('t-A');
    expect(out.locationsSucceeded).toBe(1);

    // CRITICAL: scrA still has its PREVIOUS active schedule — NEVER dark.
    const aActive = activeForScreen(rows, 'scrA');
    expect(aActive).toHaveLength(1);
    expect(aActive[0].id).toBe('s-prev-A');
    expect(aActive[0].playlistId).toBe('pl-old-A');
    // The previous schedule was NOT deactivated by a half-completed swap.
    expect(rows.find((r) => r.id === 's-prev-A')?.isActive).toBe(true);
    // …and no orphan copy schedule was left behind for scrA.
    expect(rows.some((r) => r.screenId === 'scrA' && r.playlistId === 'copy-t-A')).toBe(false);

    // Location B went live cleanly (proves the failure was isolated to A).
    const bActive = activeForScreen(rows, 'scrB');
    expect(bActive).toHaveLength(1);
    expect(bActive[0].playlistId).toBe('copy-t-B');
  });

  it('a fully-successful publish activates the new content on every screen and stands down the previous — ok:true, no failures (happy path preserved)', async () => {
    const rows = seedTwoLocations();
    const { prisma } = makePrisma(rows, {}); // nothing fails
    wireReads(prisma, [
      { id: 'scrA', name: 'Screen A', tenantId: 't-A' },
      { id: 'scrB', name: 'Screen B', tenantId: 't-B' },
    ]);
    const svc = new PlaylistDistributionService(prisma);

    const out = await svc.publishToFleet({
      parentTenantId: 't-parent',
      actorUserId: 'u1',
      sourcePlaylistId: 'pl-src',
      screenIds: ['scrA', 'scrB'],
    });

    expect(out.ok).toBe(true);
    expect(out.locationsSucceeded).toBe(2);
    expect(out.locationsFailed).toBe(0);
    expect(out.failures).toHaveLength(0);
    expect(out.screensScheduled).toBe(2);

    // Both screens now show their NEW copy, exactly one active row each.
    for (const [screenId, tenant] of [['scrA', 't-A'], ['scrB', 't-B']] as const) {
      const active = activeForScreen(rows, screenId);
      expect(active).toHaveLength(1);
      expect(active[0].playlistId).toBe(`copy-${tenant}`);
    }
    // Previous schedules stood down.
    expect(rows.find((r) => r.id === 's-prev-A')?.isActive).toBe(false);
    expect(rows.find((r) => r.id === 's-prev-B')?.isActive).toBe(false);
  });

  it('when EVERY targeted location fails, publishToFleet throws (genuine total failure — nothing went live, nothing to report as partial)', async () => {
    const rows = [
      {
        id: 's-prev-A', tenantId: 't-A', playlistId: 'pl-old-A', screenId: 'scrA',
        screenGroupId: null, isActive: true, priority: 0, mode: 'replace',
        startTime: new Date('2026-01-01'), endTime: null,
      },
    ] as ScheduleRow[];
    const { prisma } = makePrisma(rows, { failChildTenant: 't-A' });
    wireReads(prisma, [{ id: 'scrA', name: 'Screen A', tenantId: 't-A' }]);
    const svc = new PlaylistDistributionService(prisma);

    await expect(
      svc.publishToFleet({
        parentTenantId: 't-parent',
        actorUserId: 'u1',
        sourcePlaylistId: 'pl-src',
        screenIds: ['scrA'],
      }),
    ).rejects.toThrow(/Publish failed for all/);

    // Even on total failure, the one screen kept its previous active schedule.
    const aActive = activeForScreen(rows, 'scrA');
    expect(aActive).toHaveLength(1);
    expect(aActive[0].id).toBe('s-prev-A');
  });
});
