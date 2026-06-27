/**
 * CC-2 (2026-06-27 launch beta) — a screen must NEVER silently go dark.
 *
 * Publishing a schedule deactivates the prior active one for the same
 * target; DELETING (or deactivating) that survivor previously left the
 * screen with ZERO active schedules → the manifest resolver returned an
 * empty playlist set → the physical screen went BLANK.
 *
 * These tests prove the go-dark fallback:
 *   - DELETE the active schedule on a target that has another (inactive)
 *     schedule → that other schedule is re-activated + an AUTO_REACTIVATED
 *     AuditLog row is written.
 *   - It picks the HIGHEST-priority candidate (startTime as tiebreak).
 *   - It does NOTHING when an active schedule already covers the target
 *     (idempotent) or when no other schedule exists (genuinely empty).
 *   - DEACTIVATE via /toggle gets the same protection.
 *   - PUT now honors isActive and routes a deactivation through the same
 *     fallback (no more /toggle-only inconsistency).
 *
 * Unit-level: the controller is constructed directly with a mocked Prisma
 * whose `$transaction` runs the callback against the same `tx` mocks, so we
 * can assert exactly which rows the fallback re-activated.
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

/**
 * Build a controller whose Prisma client is backed by an in-memory list of
 * Schedule rows. schedule.delete / update / findFirst all operate on `rows`
 * so the fallback's queries see the realistic post-delete state.
 */
function makeController(rows: Row[]) {
  const auditCreate = jest.fn().mockResolvedValue({});

  const scheduleClient = {
    findFirst: jest.fn(async ({ where, orderBy }: any) => {
      let matches = rows.filter((r) => matchWhere(r, where));
      if (orderBy) matches = sortByOrderBy(matches, orderBy);
      return matches[0] ?? null;
    }),
    delete: jest.fn(async ({ where }: any) => {
      const idx = rows.findIndex((r) => r.id === where.id);
      if (idx >= 0) rows.splice(idx, 1);
      return {};
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error('row not found: ' + where.id);
      Object.assign(row, data);
      return { ...row };
    }),
  };

  const tx = { schedule: scheduleClient, auditLog: { create: auditCreate } };

  const prisma: any = {
    client: {
      schedule: {
        // findFirst used by remove/toggle/update to load the target row
        // (with tenant scope) BEFORE the transaction.
        findFirst: jest.fn(async ({ where }: any) =>
          rows.find((r) => matchWhere(r, where)) ?? null,
        ),
        ...scheduleClient,
      },
      auditLog: { create: auditCreate },
      // Run the callback against the same tx mocks above.
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      // Playlist/screen/group ownership checks (only used by update()).
      playlist: { findFirst: jest.fn().mockResolvedValue({ id: 'pl' }) },
      screen: { findFirst: jest.fn().mockResolvedValue({ id: 'scr' }) },
      screenGroup: { findFirst: jest.fn().mockResolvedValue({ id: 'grp' }) },
    },
  };
  const redis: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const signer: any = { signMessage: jest.fn().mockReturnValue('signed') };
  const notify: any = { notify: jest.fn().mockResolvedValue({}) };

  const controller = new SchedulesController(prisma, redis, signer, notify);
  return { controller, rows, auditCreate, scheduleClient };
}

// Minimal Prisma-where evaluator covering the shapes the controller uses:
//   { id, tenantId, isActive, screenId, screenGroupId, id: { not } }
function matchWhere(r: Row, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === 'id' && v && typeof v === 'object' && 'not' in (v as any)) {
      if (r.id === (v as any).not) return false;
      continue;
    }
    if (v === undefined) continue;
    if ((r as any)[k] !== v) return false;
  }
  return true;
}

function sortByOrderBy(list: Row[], orderBy: any): Row[] {
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...list].sort((a, b) => {
    for (const clause of clauses) {
      const [field, dir] = Object.entries(clause)[0] as [keyof Row, 'asc' | 'desc'];
      const av = a[field] as any;
      const bv = b[field] as any;
      let cmp = 0;
      if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime();
      else if (av < bv) cmp = -1;
      else if (av > bv) cmp = 1;
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

const adminReq = {
  user: { id: 'a1', userId: 'a1', role: AppRole.SCHOOL_ADMIN, tenantId: 't1' },
};

function row(over: Partial<Row> & Pick<Row, 'id'>): Row {
  return {
    tenantId: 't1',
    playlistId: 'pl-' + over.id,
    screenId: 'scr1',
    screenGroupId: null,
    isActive: false,
    priority: 0,
    startTime: new Date('2026-06-01T00:00:00Z'),
    ...over,
  };
}

describe('CC-2 — delete the active schedule promotes another so the screen never goes dark', () => {
  it('reactivates the remaining inactive schedule on the same screen', async () => {
    const rows = [
      row({ id: 'live', isActive: true }),
      row({ id: 'prev', isActive: false, priority: 0 }),
    ];
    const { controller, auditCreate } = makeController(rows);

    await controller.remove(adminReq as any, 'live');

    // The deleted one is gone; the survivor is now ACTIVE.
    expect(rows.find((r) => r.id === 'live')).toBeUndefined();
    const prev = rows.find((r) => r.id === 'prev')!;
    expect(prev.isActive).toBe(true);

    // An AUTO_REACTIVATED audit row was written for the promoted schedule.
    const autoRow = auditCreate.mock.calls
      .map((c) => c[0].data)
      .find((d: any) => d.action === 'SCHEDULE_AUTO_REACTIVATED');
    expect(autoRow).toBeTruthy();
    expect(autoRow.targetId).toBe('prev');
    expect(JSON.parse(autoRow.details).removedScheduleId).toBe('live');
  });

  it('promotes the HIGHEST-priority candidate (startTime as tiebreak)', async () => {
    const rows = [
      row({ id: 'live', isActive: true }),
      row({ id: 'lowpri', isActive: false, priority: 1, startTime: new Date('2026-06-10T00:00:00Z') }),
      row({ id: 'hipri', isActive: false, priority: 5, startTime: new Date('2026-06-02T00:00:00Z') }),
    ];
    const { controller } = makeController(rows);

    await controller.remove(adminReq as any, 'live');

    expect(rows.find((r) => r.id === 'hipri')!.isActive).toBe(true);
    expect(rows.find((r) => r.id === 'lowpri')!.isActive).toBe(false);
  });

  it('does nothing when another active schedule already covers the screen', async () => {
    const rows = [
      row({ id: 'live', isActive: true }),
      row({ id: 'other-live', isActive: true }),
      row({ id: 'draft', isActive: false }),
    ];
    const { controller, auditCreate } = makeController(rows);

    await controller.remove(adminReq as any, 'live');

    // The other live schedule still covers the screen — the draft stays a draft.
    expect(rows.find((r) => r.id === 'draft')!.isActive).toBe(false);
    expect(
      auditCreate.mock.calls.some((c) => c[0].data.action === 'SCHEDULE_AUTO_REACTIVATED'),
    ).toBe(false);
  });

  it('does nothing when the screen genuinely has no other schedule', async () => {
    const rows = [row({ id: 'live', isActive: true })];
    const { controller, auditCreate } = makeController(rows);

    await controller.remove(adminReq as any, 'live');

    expect(rows.length).toBe(0);
    expect(
      auditCreate.mock.calls.some((c) => c[0].data.action === 'SCHEDULE_AUTO_REACTIVATED'),
    ).toBe(false);
  });

  it('does NOT promote a different target (cross-screen safety)', async () => {
    const rows = [
      row({ id: 'live', isActive: true, screenId: 'scrA' }),
      // An inactive schedule on a DIFFERENT screen must NOT be auto-promoted.
      row({ id: 'otherScreen', isActive: false, screenId: 'scrB' }),
    ];
    const { controller, auditCreate } = makeController(rows);

    await controller.remove(adminReq as any, 'live');

    expect(rows.find((r) => r.id === 'otherScreen')!.isActive).toBe(false);
    expect(
      auditCreate.mock.calls.some((c) => c[0].data.action === 'SCHEDULE_AUTO_REACTIVATED'),
    ).toBe(false);
  });

  it('does not run the fallback when the DELETED schedule was already a draft', async () => {
    const rows = [
      // Deleting a draft can't take the screen off the air — the live one
      // (if any) is untouched; the fallback should not fire.
      row({ id: 'draft', isActive: false }),
      row({ id: 'live', isActive: true }),
    ];
    const { controller, auditCreate } = makeController(rows);

    await controller.remove(adminReq as any, 'draft');

    expect(rows.find((r) => r.id === 'live')!.isActive).toBe(true);
    expect(
      auditCreate.mock.calls.some((c) => c[0].data.action === 'SCHEDULE_AUTO_REACTIVATED'),
    ).toBe(false);
  });
});

describe('CC-2 — deactivating (not deleting) also keeps the screen lit', () => {
  it('toggle OFF the active schedule promotes the next-best one', async () => {
    const rows = [
      row({ id: 'live', isActive: true }),
      row({ id: 'prev', isActive: false }),
    ];
    const { controller } = makeController(rows);

    await controller.toggle(adminReq as any, 'live');

    expect(rows.find((r) => r.id === 'live')!.isActive).toBe(false);
    expect(rows.find((r) => r.id === 'prev')!.isActive).toBe(true);
  });

  it('PUT isActive:false honors the flag AND runs the fallback', async () => {
    const rows = [
      row({ id: 'live', isActive: true }),
      row({ id: 'prev', isActive: false }),
    ];
    const { controller, auditCreate } = makeController(rows);

    await controller.update(adminReq as any, 'live', { isActive: false } as any);

    // PUT actually flipped the row (previously isActive was silently ignored).
    expect(rows.find((r) => r.id === 'live')!.isActive).toBe(false);
    // And the survivor was promoted.
    expect(rows.find((r) => r.id === 'prev')!.isActive).toBe(true);
    // The deactivation was audited via the put path.
    const toggled = auditCreate.mock.calls
      .map((c) => c[0].data)
      .find((d: any) => d.action === 'SCHEDULE_TOGGLED');
    expect(toggled).toBeTruthy();
    expect(JSON.parse(toggled.details).via).toBe('put');
  });
});

describe('CC-2 — group-target fallback', () => {
  it('deleting an active group schedule promotes another group schedule', async () => {
    const rows = [
      row({ id: 'live', isActive: true, screenId: null, screenGroupId: 'grpA' }),
      row({ id: 'prev', isActive: false, screenId: null, screenGroupId: 'grpA' }),
    ];
    const { controller } = makeController(rows);

    await controller.remove(adminReq as any, 'live');

    expect(rows.find((r) => r.id === 'prev')!.isActive).toBe(true);
  });
});
