/**
 * GROUP-SUPERSESSION — publishing a playlist to a GROUP must knock out the
 * per-screen pins on ALL of its member screens, so the single group schedule
 * cleanly wins on every poster (not just one).
 *
 * Background (schedules.controller.ts create(), lines ~124-154, 2026-06-26):
 *
 *   "the 'publish reaches only 1 of N posters' bug. The old query only matched
 *    the SAME target (screenId→screenId, group→group), so publishing a
 *    playlist to a GROUP deactivated old GROUP schedules but LEFT every member
 *    screen's per-screen pin active. The manifest then returned both the new
 *    group schedule AND the stale per-screen one, so each poster kept whatever
 *    was individually pinned to it … Fix: publishing to a group also supersedes
 *    the per-screen pins on all of its member screens, so the single group
 *    schedule cleanly wins."
 *
 * That fix was shipped as a code comment + a `replaceOr` clause that resolves
 * the group's member screen ids and adds `{ screenId: { in: memberIds } }` to
 * the deactivation `updateMany`. No test proved it actually ran. This file is
 * that proof. The 2026-06-27 launch-readiness audit (02-DEEPWAVE2 Lane 3)
 * flagged it as a [P0][NEEDS-FOLLOWUP].
 *
 * Unit-level: the controller is constructed directly with an in-memory Prisma
 * whose schedule.updateMany / deleteMany / create operate on the same `rows`
 * array, plus a screen table so the member-screen resolution is realistic. We
 * then assert that after an admin publishes ONE schedule to the group, EVERY
 * member's pre-existing per-screen schedule row is isActive=false and the only
 * active row resolving for each member is the new group schedule.
 *
 * Test-only coverage of already-shipped behavior — no production code touched.
 */

import 'reflect-metadata';
import { AppRole } from '@cms/database';
import { SchedulesController } from './schedules.controller';

type Row = {
  id: string;
  tenantId: string;
  playlistId: string;
  screenId: string | null;
  screenGroupId: string | null;
  isActive: boolean;
  priority: number;
  startTime: Date;
};

type ScreenRow = {
  id: string;
  tenantId: string;
  screenGroupId: string | null;
};

/**
 * Minimal Prisma-where evaluator covering the shapes create()'s deactivation
 * + cleanup use:
 *   { tenantId, isActive, OR: [ {screenId}, {screenGroupId}, {screenId:{in}} ] }
 *   { tenantId, playlistId, screenId, screenGroupId, isActive }
 */
function rowMatches(r: Row, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === 'OR') {
      const clauses = v as any[];
      const ok = clauses.some((c) => rowMatches(r, c));
      if (!ok) return false;
      continue;
    }
    const rv = (r as any)[k];
    // { in: [...] }
    if (v && typeof v === 'object' && 'in' in (v as any)) {
      if (!(v as any).in.includes(rv)) return false;
      continue;
    }
    // explicit null means "match rows whose column IS NULL"
    if (v === null) {
      if (rv !== null && rv !== undefined) return false;
      continue;
    }
    if (rv !== v) return false;
  }
  return true;
}

let idSeq = 0;

function makeController(rows: Row[], screens: ScreenRow[]) {
  const auditCreate = jest.fn().mockResolvedValue({});

  const scheduleClient = {
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
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rowMatches(rows[i], where)) {
          rows.splice(i, 1);
          count++;
        }
      }
      return { count };
    }),
    create: jest.fn(async ({ data }: any) => {
      const r: Row = {
        id: 'new-' + ++idSeq,
        tenantId: data.tenantId,
        playlistId: data.playlistId,
        screenId: data.screenId ?? null,
        screenGroupId: data.screenGroupId ?? null,
        isActive: data.isActive,
        priority: data.priority ?? 0,
        startTime: data.startTime,
      };
      rows.push(r);
      // create() includes playlist/screenGroup/screen — return a shape with id.
      return { ...r, playlist: { id: r.playlistId, name: 'pl' }, screenGroup: null, screen: null };
    }),
  };

  const prisma: any = {
    client: {
      schedule: scheduleClient,
      screen: {
        findFirst: jest.fn().mockResolvedValue({ id: 'scr' }),
        findMany: jest.fn(async ({ where }: any) =>
          screens
            .filter(
              (s) =>
                s.tenantId === where.tenantId &&
                s.screenGroupId === where.screenGroupId,
            )
            .map((s) => ({ id: s.id })),
        ),
      },
      screenGroup: { findFirst: jest.fn().mockResolvedValue({ id: 'grp' }) },
      playlist: { findFirst: jest.fn().mockResolvedValue({ id: 'pl' }) },
      tenant: {
        // Only consulted for CONTRIBUTOR actors (approval gate). Admins skip it.
        findUnique: jest.fn().mockResolvedValue({ requireContentApproval: false }),
      },
      auditLog: { create: auditCreate },
      submission: { create: jest.fn().mockResolvedValue({ id: 'sub1' }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };

  const redis: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const signer: any = { signMessage: jest.fn().mockReturnValue('signed') };
  const notify: any = { notify: jest.fn().mockResolvedValue({}) };

  const controller = new SchedulesController(prisma, redis, signer, notify);
  return { controller, rows, screens, scheduleClient, prisma };
}

const adminReq = {
  user: { id: 'a1', userId: 'a1', role: AppRole.SCHOOL_ADMIN, tenantId: 't1' },
};

/**
 * Resolve which active schedule(s) the manifest would serve for `screenId` —
 * mirrors the screens-controller manifest query: the active schedule for the
 * screen's exact pin OR for the group it belongs to (same tenant). Returns the
 * matching active rows so a test can assert "exactly one, the group schedule".
 */
function activeForScreen(rows: Row[], screens: ScreenRow[], screenId: string): Row[] {
  const screen = screens.find((s) => s.id === screenId)!;
  return rows.filter(
    (r) =>
      r.isActive &&
      r.tenantId === screen.tenantId &&
      ((r.screenId === screenId) ||
        (r.screenGroupId !== null && r.screenGroupId === screen.screenGroupId)),
  );
}

describe('GROUP-SUPERSESSION — publishing to a group deactivates every member per-screen pin', () => {
  beforeEach(() => {
    idSeq = 0;
  });

  it('deactivates the per-screen pin on ALL group members and leaves only the group schedule active', async () => {
    // A group "grpA" with THREE member screens, each carrying its OWN active
    // per-screen schedule pinned to a DIFFERENT playlist.
    const screens: ScreenRow[] = [
      { id: 'scrA', tenantId: 't1', screenGroupId: 'grpA' },
      { id: 'scrB', tenantId: 't1', screenGroupId: 'grpA' },
      { id: 'scrC', tenantId: 't1', screenGroupId: 'grpA' },
    ];
    const rows: Row[] = [
      { id: 'pinA', tenantId: 't1', playlistId: 'plX', screenId: 'scrA', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z') },
      { id: 'pinB', tenantId: 't1', playlistId: 'plY', screenId: 'scrB', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z') },
      { id: 'pinC', tenantId: 't1', playlistId: 'plZ', screenId: 'scrC', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z') },
    ];

    const { controller } = makeController(rows, screens);

    // Publish ONE schedule to the whole group with a NEW playlist.
    await controller.create(adminReq as any, {
      playlistId: 'plGroup',
      screenGroupId: 'grpA',
      startTime: '2026-06-27T00:00:00Z',
      mode: 'replace',
    } as any);

    // Every member's pre-existing per-screen pin is now deactivated.
    for (const id of ['pinA', 'pinB', 'pinC']) {
      expect(rows.find((r) => r.id === id)!.isActive).toBe(false);
    }

    // The group schedule was created and is the SOLE active row.
    const actives = rows.filter((r) => r.isActive);
    expect(actives).toHaveLength(1);
    expect(actives[0].screenGroupId).toBe('grpA');
    expect(actives[0].playlistId).toBe('plGroup');

    // And for EACH member screen, the manifest resolver sees exactly the group
    // schedule — no stale per-screen pin survives to compete.
    for (const screenId of ['scrA', 'scrB', 'scrC']) {
      const resolved = activeForScreen(rows, screens, screenId);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].playlistId).toBe('plGroup');
      expect(resolved[0].screenGroupId).toBe('grpA');
    }
  });

  it('also deactivates a prior GROUP-level schedule on the same group (not just per-screen pins)', async () => {
    const screens: ScreenRow[] = [
      { id: 'scrA', tenantId: 't1', screenGroupId: 'grpA' },
      { id: 'scrB', tenantId: 't1', screenGroupId: 'grpA' },
    ];
    const rows: Row[] = [
      // Prior group schedule (old playlist) + per-screen pins on each member.
      { id: 'oldGroup', tenantId: 't1', playlistId: 'plOld', screenId: null, screenGroupId: 'grpA', isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z') },
      { id: 'pinA', tenantId: 't1', playlistId: 'plX', screenId: 'scrA', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z') },
      { id: 'pinB', tenantId: 't1', playlistId: 'plY', screenId: 'scrB', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z') },
    ];

    const { controller } = makeController(rows, screens);

    await controller.create(adminReq as any, {
      playlistId: 'plGroup',
      screenGroupId: 'grpA',
      startTime: '2026-06-27T00:00:00Z',
      mode: 'replace',
    } as any);

    expect(rows.find((r) => r.id === 'oldGroup')!.isActive).toBe(false);
    expect(rows.find((r) => r.id === 'pinA')!.isActive).toBe(false);
    expect(rows.find((r) => r.id === 'pinB')!.isActive).toBe(false);

    const actives = rows.filter((r) => r.isActive);
    expect(actives).toHaveLength(1);
    expect(actives[0].playlistId).toBe('plGroup');
  });

  it('does NOT deactivate a per-screen pin on a screen OUTSIDE the group (scope safety)', async () => {
    const screens: ScreenRow[] = [
      { id: 'scrIn', tenantId: 't1', screenGroupId: 'grpA' },
      // scrOut is in a DIFFERENT group; its pin must survive.
      { id: 'scrOut', tenantId: 't1', screenGroupId: 'grpB' },
    ];
    const rows: Row[] = [
      { id: 'pinIn', tenantId: 't1', playlistId: 'plX', screenId: 'scrIn', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z') },
      { id: 'pinOut', tenantId: 't1', playlistId: 'plY', screenId: 'scrOut', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z') },
    ];

    const { controller } = makeController(rows, screens);

    await controller.create(adminReq as any, {
      playlistId: 'plGroup',
      screenGroupId: 'grpA',
      startTime: '2026-06-27T00:00:00Z',
      mode: 'replace',
    } as any);

    // Member pin knocked out…
    expect(rows.find((r) => r.id === 'pinIn')!.isActive).toBe(false);
    // …but the out-of-group pin is untouched.
    expect(rows.find((r) => r.id === 'pinOut')!.isActive).toBe(true);
  });

  it('does NOT touch another tenant\'s schedules even on a same-named group (cross-tenant safety)', async () => {
    const screens: ScreenRow[] = [
      { id: 'scrA', tenantId: 't1', screenGroupId: 'grpA' },
      // Foreign-tenant screen also in a group called "grpA".
      { id: 'scrEvil', tenantId: 't2', screenGroupId: 'grpA' },
    ];
    const rows: Row[] = [
      { id: 'pinA', tenantId: 't1', playlistId: 'plX', screenId: 'scrA', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z') },
      { id: 'pinEvil', tenantId: 't2', playlistId: 'plE', screenId: 'scrEvil', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z') },
    ];

    const { controller } = makeController(rows, screens);

    await controller.create(adminReq as any, {
      playlistId: 'plGroup',
      screenGroupId: 'grpA',
      startTime: '2026-06-27T00:00:00Z',
      mode: 'replace',
    } as any);

    expect(rows.find((r) => r.id === 'pinA')!.isActive).toBe(false);
    // The other tenant's pin is never deactivated.
    expect(rows.find((r) => r.id === 'pinEvil')!.isActive).toBe(true);
  });

  it('does NOT supersede member pins for a DRAFT (isActive:false) group schedule', async () => {
    // Staging a group draft must NOT knock the live per-screen content off the
    // wall — a plan, not a go-live. (willBeActive=false skips the displacement.)
    const screens: ScreenRow[] = [
      { id: 'scrA', tenantId: 't1', screenGroupId: 'grpA' },
      { id: 'scrB', tenantId: 't1', screenGroupId: 'grpA' },
    ];
    const rows: Row[] = [
      { id: 'pinA', tenantId: 't1', playlistId: 'plX', screenId: 'scrA', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z') },
      { id: 'pinB', tenantId: 't1', playlistId: 'plY', screenId: 'scrB', screenGroupId: null, isActive: true, priority: 0, startTime: new Date('2026-06-01T00:00:00Z') },
    ];

    const { controller } = makeController(rows, screens);

    await controller.create(adminReq as any, {
      playlistId: 'plGroup',
      screenGroupId: 'grpA',
      startTime: '2026-06-27T00:00:00Z',
      mode: 'replace',
      isActive: false,
    } as any);

    // Live member pins survive an unpublished draft.
    expect(rows.find((r) => r.id === 'pinA')!.isActive).toBe(true);
    expect(rows.find((r) => r.id === 'pinB')!.isActive).toBe(true);
  });
});
