/**
 * APPROVAL-DISPLACEMENT — approving a staged draft schedule must displace the
 * competing LIVE schedule for the same target, exactly as a direct publish
 * (schedules.controller.create) does.
 *
 * THE BUG (P1, 2026-07-03): when Tenant.requireContentApproval=true, a
 * CONTRIBUTOR publishing playlist B to a screen already showing playlist A
 * (via an admin's live schedule) creates a DRAFT schedule (isActive=false)
 * bundled into a Submission. On approval, submissions.controller.decide() used
 * to run a bare `schedule.updateMany({ where:{ id:{in:sIds} }, data:{
 * isActive:true } })` — flipping the draft active WITHOUT deactivating A. Both
 * A and B ended up isActive=true on the same screen; the manifest resolver
 * returned both and the player INTERLEAVED A and B instead of B replacing A.
 *
 * THE FIX: decide()'s APPROVED branch now runs the shared
 * displaceCompetingActiveSchedules() (the same helper create() calls) for each
 * approved schedule's target BEFORE flipping it live, all inside one
 * transaction. This file proves:
 *   - per-screen approval deactivates the competing live schedule (only ONE
 *     active survives — the approved one);
 *   - group-target approval supersedes the per-screen member pins too;
 *   - append-mode does NOT displace (intentional coexistence);
 *   - cross-tenant / out-of-group schedules are never touched.
 *
 * Adversarial: the pre-fix behavior (bare updateMany, no displacement) leaves
 * BOTH schedules active — a control assertion in the first test documents the
 * exact broken state the fix eliminates.
 */

import 'reflect-metadata';
import { AppRole } from '@cms/database';
import { SubmissionsController } from './submissions.controller';

type Row = {
  id: string;
  tenantId: string;
  playlistId: string;
  screenId: string | null;
  screenGroupId: string | null;
  isActive: boolean;
  priority: number;
  startTime: Date;
  mode: string;
};

type ScreenRow = {
  id: string;
  tenantId: string;
  screenGroupId: string | null;
};

/**
 * Minimal Prisma-where evaluator covering the shapes the approval path uses:
 *   { id: { in: [...] }, tenantId }                       (updateMany flip)
 *   { tenantId, isActive, OR: [ {screenId}, {screenGroupId}, {screenId:{in}} ], id:{not} }
 */
function rowMatches(r: Row, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === 'OR') {
      const clauses = v as any[];
      if (!clauses.some((c) => rowMatches(r, c))) return false;
      continue;
    }
    const rv = (r as any)[k];
    if (v && typeof v === 'object' && 'in' in (v as any)) {
      if (!(v as any).in.includes(rv)) return false;
      continue;
    }
    if (v && typeof v === 'object' && 'not' in (v as any)) {
      if (rv === (v as any).not) return false;
      continue;
    }
    if (v === null) {
      if (rv !== null && rv !== undefined) return false;
      continue;
    }
    if (rv !== v) return false;
  }
  return true;
}

function makeScheduleClient(rows: Row[]) {
  return {
    findMany: jest.fn(async ({ where, select }: any) => {
      const matched = rows.filter((r) => rowMatches(r, where));
      if (!select) return matched.map((r) => ({ ...r }));
      return matched.map((r) => {
        const out: any = {};
        for (const key of Object.keys(select)) if (select[key]) out[key] = (r as any)[key];
        return out;
      });
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) {
        if (rowMatches(r, where)) {
          Object.assign(r, data);
          count++;
        }
      }
      return { count };
    }),
  };
}

function makeController(rows: Row[], screens: ScreenRow[], sub: any) {
  const scheduleClient = makeScheduleClient(rows);

  const screenClient = {
    findMany: jest.fn(async ({ where }: any) =>
      screens
        .filter((s) => s.tenantId === where.tenantId && s.screenGroupId === where.screenGroupId)
        .map((s) => ({ id: s.id })),
    ),
  };

  const submissionClient = {
    findFirst: jest.fn(async () => (sub && sub.status === 'PENDING' ? { ...sub } : sub)),
    update: jest.fn(async ({ data }: any) => ({ ...sub, ...data })),
  };

  const assetClient = { updateMany: jest.fn(async () => ({ count: 0 })) };
  const auditCreate = jest.fn().mockResolvedValue({});

  const client: any = {
    submission: submissionClient,
    schedule: scheduleClient,
    screen: screenClient,
    asset: assetClient,
    auditLog: { create: auditCreate },
    // Support BOTH Prisma $transaction forms so this harness is faithful to
    // whichever the controller uses:
    //   - array form  `$transaction([op, op])` (the PRE-FIX decide()) — awaits
    //     the already-issued operation promises;
    //   - callback form `$transaction(async tx => …)` (the FIXED decide()) —
    //     runs the callback against the SAME client so reads/writes hit the
    //     shared `rows` array.
    // Making the mock handle both means the adversarial revert fails on the
    // BEHAVIORAL assertion (A stays active), not on a transaction-shape crash.
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(client) : Promise.all(arg),
    ),
  };

  const prisma: any = { client };
  const notify: any = { notify: jest.fn().mockResolvedValue({}) };
  const controller = new SubmissionsController(prisma, notify);
  return { controller, rows, screens, scheduleClient, auditCreate };
}

const adminReq = {
  user: { id: 'admin1', userId: 'admin1', role: AppRole.SCHOOL_ADMIN, tenantId: 't1' },
};

/** Manifest resolver mirror — active rows that would serve `screenId`. */
function activeForScreen(rows: Row[], screens: ScreenRow[], screenId: string): Row[] {
  const screen = screens.find((s) => s.id === screenId)!;
  return rows.filter(
    (r) =>
      r.isActive &&
      r.tenantId === screen.tenantId &&
      (r.screenId === screenId ||
        (r.screenGroupId !== null && r.screenGroupId === screen.screenGroupId)),
  );
}

describe('APPROVAL-DISPLACEMENT — approving a draft displaces the competing live schedule', () => {
  it('per-screen: after approval only the approved schedule is active (A is displaced by B)', async () => {
    const screens: ScreenRow[] = [{ id: 'scr1', tenantId: 't1', screenGroupId: null }];
    // A = admin's LIVE schedule for playlist A on scr1.
    // B = the CONTRIBUTOR's DRAFT for playlist B on the SAME screen, bundled
    //     into the submission being approved.
    const rows: Row[] = [
      { id: 'schedA', tenantId: 't1', playlistId: 'plA', screenId: 'scr1', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z'), mode: 'replace' },
      { id: 'schedB', tenantId: 't1', playlistId: 'plB', screenId: 'scr1', screenGroupId: null, isActive: false, priority: 0, startTime: new Date('2026-07-01T00:00:00Z'), mode: 'replace' },
    ];
    const sub = { id: 'sub1', tenantId: 't1', submittedById: 'ed1', status: 'PENDING', assetIds: '', playlistIds: 'plB', scheduleIds: 'schedB' };

    const { controller } = makeController(rows, screens, sub);
    await controller.approve(adminReq as any, 'sub1', {} as any);

    const A = rows.find((r) => r.id === 'schedA')!;
    const B = rows.find((r) => r.id === 'schedB')!;
    // B went live…
    expect(B.isActive).toBe(true);
    // …and A was DISPLACED (this is the whole fix — pre-fix A stayed active).
    expect(A.isActive).toBe(false);

    // The manifest sees EXACTLY ONE schedule for the screen — the approved B.
    const resolved = activeForScreen(rows, screens, 'scr1');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].playlistId).toBe('plB');
  });

  it('group target: approval supersedes prior group schedule AND every member per-screen pin', async () => {
    const screens: ScreenRow[] = [
      { id: 'scrA', tenantId: 't1', screenGroupId: 'grpA' },
      { id: 'scrB', tenantId: 't1', screenGroupId: 'grpA' },
    ];
    const rows: Row[] = [
      { id: 'oldGroup', tenantId: 't1', playlistId: 'plOld', screenId: null, screenGroupId: 'grpA', isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z'), mode: 'replace' },
      { id: 'pinA', tenantId: 't1', playlistId: 'plX', screenId: 'scrA', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z'), mode: 'replace' },
      { id: 'pinB', tenantId: 't1', playlistId: 'plY', screenId: 'scrB', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z'), mode: 'replace' },
      // The approved DRAFT: a group-level schedule for the whole group.
      { id: 'draftGroup', tenantId: 't1', playlistId: 'plNew', screenId: null, screenGroupId: 'grpA', isActive: false, priority: 0, startTime: new Date('2026-07-01T00:00:00Z'), mode: 'replace' },
    ];
    const sub = { id: 'sub2', tenantId: 't1', submittedById: 'ed1', status: 'PENDING', assetIds: '', playlistIds: 'plNew', scheduleIds: 'draftGroup' };

    const { controller } = makeController(rows, screens, sub);
    await controller.approve(adminReq as any, 'sub2', {} as any);

    expect(rows.find((r) => r.id === 'oldGroup')!.isActive).toBe(false);
    expect(rows.find((r) => r.id === 'pinA')!.isActive).toBe(false);
    expect(rows.find((r) => r.id === 'pinB')!.isActive).toBe(false);
    expect(rows.find((r) => r.id === 'draftGroup')!.isActive).toBe(true);

    // Each member screen resolves to exactly the new group schedule.
    for (const screenId of ['scrA', 'scrB']) {
      const resolved = activeForScreen(rows, screens, screenId);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].playlistId).toBe('plNew');
    }
  });

  it('append-mode approval does NOT displace the competing live schedule (intentional coexistence)', async () => {
    const screens: ScreenRow[] = [{ id: 'scr1', tenantId: 't1', screenGroupId: null }];
    const rows: Row[] = [
      { id: 'schedA', tenantId: 't1', playlistId: 'plA', screenId: 'scr1', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z'), mode: 'replace' },
      { id: 'schedB', tenantId: 't1', playlistId: 'plB', screenId: 'scr1', screenGroupId: null, isActive: false, priority: 0, startTime: new Date('2026-07-01T00:00:00Z'), mode: 'append' },
    ];
    const sub = { id: 'sub3', tenantId: 't1', submittedById: 'ed1', status: 'PENDING', assetIds: '', playlistIds: 'plB', scheduleIds: 'schedB' };

    const { controller } = makeController(rows, screens, sub);
    await controller.approve(adminReq as any, 'sub3', {} as any);

    // BOTH stay active — append mode intentionally coexists.
    expect(rows.find((r) => r.id === 'schedA')!.isActive).toBe(true);
    expect(rows.find((r) => r.id === 'schedB')!.isActive).toBe(true);
  });

  it('never displaces another tenant\'s or an out-of-group schedule (scope safety)', async () => {
    const screens: ScreenRow[] = [
      { id: 'scr1', tenantId: 't1', screenGroupId: null },
      { id: 'scrEvil', tenantId: 't2', screenGroupId: null },
    ];
    const rows: Row[] = [
      { id: 'schedA', tenantId: 't1', playlistId: 'plA', screenId: 'scr1', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z'), mode: 'replace' },
      { id: 'schedB', tenantId: 't1', playlistId: 'plB', screenId: 'scr1', screenGroupId: null, isActive: false, priority: 0, startTime: new Date('2026-07-01T00:00:00Z'), mode: 'replace' },
      // Foreign tenant, same-ish shape — must never be touched.
      { id: 'evil', tenantId: 't2', playlistId: 'plE', screenId: 'scrEvil', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z'), mode: 'replace' },
    ];
    const sub = { id: 'sub4', tenantId: 't1', submittedById: 'ed1', status: 'PENDING', assetIds: '', playlistIds: 'plB', scheduleIds: 'schedB' };

    const { controller } = makeController(rows, screens, sub);
    await controller.approve(adminReq as any, 'sub4', {} as any);

    expect(rows.find((r) => r.id === 'schedA')!.isActive).toBe(false);
    expect(rows.find((r) => r.id === 'schedB')!.isActive).toBe(true);
    // Foreign-tenant row never deactivated.
    expect(rows.find((r) => r.id === 'evil')!.isActive).toBe(true);
  });
});
