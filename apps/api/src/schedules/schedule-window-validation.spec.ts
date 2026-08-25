/**
 * P5 (2026-08-25 audit) — the API accepted a "windowed" schedule (a
 * same-day time-of-day restriction) with ZERO days selected: a schedule
 * that can never run, silently. P7 already blocks this client-side
 * (apps/web/src/lib/blast-radius.ts `reachWarnings`, the "no-days"
 * blocking warning) — but `POST /schedules` and `PUT /schedules/:id` are
 * reachable directly (the HQ fleet endpoint, imports, raw API clients),
 * bypassing the UI gate entirely. This suite proves the SAME rule now
 * lives at the API boundary too.
 *
 * Two layers:
 *   1. Pure logic — isZeroDayWindowedSchedule / resolveEffectiveScheduleWindow
 *      / assertScheduleWindowIsReachable in isolation, covering every edge
 *      case called out in schedule-window-validation.ts's own doc comment
 *      (null vs omitted vs explicitly-empty daysOfWeek; the "clear
 *      everything together" idiom; a time window on either side alone).
 *   2. Controller-level — SchedulesController.create()/update() against an
 *      in-memory Prisma mock (same harness pattern as the existing
 *      schedule-group-supersession.spec.ts / schedule-go-dark-fallback.spec.ts
 *      files in this directory), proving the guard is actually WIRED IN —
 *      not just correct in isolation — and that the 400 has the exact
 *      code/message the audit finding specifies.
 */

import 'reflect-metadata';
import { AppRole } from '@cms/database';
import { SchedulesController } from './schedules.controller';
import {
  isZeroDayWindowedSchedule,
  resolveEffectiveScheduleWindow,
  assertScheduleWindowIsReachable,
  SCHEDULE_ZERO_DAYS_WINDOWED_CODE,
  SCHEDULE_ZERO_DAYS_WINDOWED_MESSAGE,
} from './schedule-window-validation';

// ─────────────────────────────────────────────────────────────────────────
// Layer 1 — pure logic
// ─────────────────────────────────────────────────────────────────────────

describe('isZeroDayWindowedSchedule — pure logic', () => {
  it('rejects: explicit empty daysOfWeek + BOTH timeStart and timeEnd set', () => {
    expect(
      isZeroDayWindowedSchedule({
        daysOfWeek: '',
        timeStart: '08:00',
        timeEnd: '15:00',
      }),
    ).toBe(true);
  });

  it('rejects: explicit empty daysOfWeek + ONLY timeStart set', () => {
    expect(
      isZeroDayWindowedSchedule({
        daysOfWeek: '',
        timeStart: '08:00',
        timeEnd: null,
      }),
    ).toBe(true);
  });

  it('rejects: explicit empty daysOfWeek + ONLY timeEnd set', () => {
    expect(
      isZeroDayWindowedSchedule({
        daysOfWeek: '',
        timeStart: null,
        timeEnd: '15:00',
      }),
    ).toBe(true);
  });

  it('allows: null daysOfWeek (no day restriction) + a time window — "every day, 8-3" is legitimate and must keep working', () => {
    expect(
      isZeroDayWindowedSchedule({
        daysOfWeek: null,
        timeStart: '08:00',
        timeEnd: '15:00',
      }),
    ).toBe(false);
  });

  it('allows: omitted (undefined) daysOfWeek + a time window', () => {
    expect(
      isZeroDayWindowedSchedule({
        daysOfWeek: undefined,
        timeStart: '08:00',
        timeEnd: '15:00',
      }),
    ).toBe(false);
  });

  it('allows: explicit empty daysOfWeek with NO time window at all — not provably never-runs (today it is functionally identical to null)', () => {
    expect(
      isZeroDayWindowedSchedule({
        daysOfWeek: '',
        timeStart: null,
        timeEnd: null,
      }),
    ).toBe(false);
    expect(
      isZeroDayWindowedSchedule({
        daysOfWeek: '',
        timeStart: undefined,
        timeEnd: undefined,
      }),
    ).toBe(false);
  });

  it('allows: real days selected + a time window', () => {
    expect(
      isZeroDayWindowedSchedule({
        daysOfWeek: 'Mon,Wed,Fri',
        timeStart: '08:00',
        timeEnd: '15:00',
      }),
    ).toBe(false);
  });

  it('allows: real days selected, no time window (day-restricted, all-day)', () => {
    expect(
      isZeroDayWindowedSchedule({
        daysOfWeek: 'Mon,Wed,Fri',
        timeStart: null,
        timeEnd: null,
      }),
    ).toBe(false);
  });

  it('allows: fully unrestricted always-on — null/null/null', () => {
    expect(
      isZeroDayWindowedSchedule({
        daysOfWeek: null,
        timeStart: null,
        timeEnd: null,
      }),
    ).toBe(false);
  });

  it('allows: empty-string timeStart/timeEnd (the "clear the window" idiom) alongside empty daysOfWeek — clearing everything together, not a zero-day window', () => {
    expect(
      isZeroDayWindowedSchedule({ daysOfWeek: '', timeStart: '', timeEnd: '' }),
    ).toBe(false);
  });

  it('deliberately NOT rejected: timeStart === timeEnd (zero-width window) — the player evaluates this range inclusively on both ends, so it still matches during that exact minute once a day; not provably never-runs', () => {
    // This case is a documented non-goal — see schedule-window-validation.ts.
    // Asserted here as a permanent record that a real day selection paired
    // with timeStart===timeEnd is NOT something this guard touches.
    expect(
      isZeroDayWindowedSchedule({
        daysOfWeek: 'Mon',
        timeStart: '08:00',
        timeEnd: '08:00',
      }),
    ).toBe(false);
  });
});

describe('assertScheduleWindowIsReachable — throws the documented 400', () => {
  it('throws an HttpException with the EXACT code + message the audit finding specifies', () => {
    let caught: any = null;
    try {
      assertScheduleWindowIsReachable({
        daysOfWeek: '',
        timeStart: '08:00',
        timeEnd: '15:00',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught.getStatus()).toBe(400);
    expect(caught.getResponse()).toEqual({
      code: SCHEDULE_ZERO_DAYS_WINDOWED_CODE,
      message: SCHEDULE_ZERO_DAYS_WINDOWED_MESSAGE,
    });
    expect(SCHEDULE_ZERO_DAYS_WINDOWED_MESSAGE).toBe(
      'This schedule would never run — it has a time window but no days selected. Pick at least one day or remove the window.',
    );
  });

  it('is a no-op for the ordinary always-on case (null or omitted everything)', () => {
    expect(() =>
      assertScheduleWindowIsReachable({
        daysOfWeek: null,
        timeStart: null,
        timeEnd: null,
      }),
    ).not.toThrow();
    expect(() =>
      assertScheduleWindowIsReachable({
        daysOfWeek: undefined,
        timeStart: undefined,
        timeEnd: undefined,
      }),
    ).not.toThrow();
  });
});

describe('resolveEffectiveScheduleWindow — PUT merge semantics', () => {
  const existing = {
    daysOfWeek: 'Mon,Tue',
    timeStart: '08:00',
    timeEnd: '15:00',
  };

  it('a body field wins when explicitly sent, even an empty string', () => {
    expect(
      resolveEffectiveScheduleWindow({ daysOfWeek: '' }, existing),
    ).toEqual({
      daysOfWeek: '',
      timeStart: '08:00',
      timeEnd: '15:00',
    });
  });

  it('falls back to the existing row value when the body omits the key', () => {
    expect(
      resolveEffectiveScheduleWindow({ timeStart: '09:00' }, existing),
    ).toEqual({
      daysOfWeek: 'Mon,Tue',
      timeStart: '09:00',
      timeEnd: '15:00',
    });
  });

  it('an explicit null in the body clears the field rather than falling back to the stored value', () => {
    expect(
      resolveEffectiveScheduleWindow({ daysOfWeek: null }, existing),
    ).toEqual({
      daysOfWeek: null,
      timeStart: '08:00',
      timeEnd: '15:00',
    });
  });

  it('an empty body is a pure passthrough of the existing row', () => {
    expect(resolveEffectiveScheduleWindow({}, existing)).toEqual(existing);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Layer 2 — controller-level (proves the guard is actually wired in)
// ─────────────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  tenantId: string;
  playlistId: string;
  screenId: string | null;
  screenGroupId: string | null;
  daysOfWeek: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  isActive: boolean;
  priority: number;
  startTime: Date;
  endTime: Date | null;
  mode: string;
  mutedOverride: boolean | null;
};

function matchWhere(r: Row, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === 'OR') {
      if (!(v as any[]).some((c) => matchWhere(r, c))) return false;
      continue;
    }
    if (k === 'AND') {
      if (!(v as any[]).every((c) => matchWhere(r, c))) return false;
      continue;
    }
    const rv = (r as any)[k];
    if (v && typeof v === 'object' && 'not' in (v as any)) {
      if (rv === (v as any).not) return false;
      continue;
    }
    if (v && typeof v === 'object' && 'in' in (v as any)) {
      if (!(v as any).in.includes(rv)) return false;
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

let idSeq = 0;

/** Same in-memory-Prisma harness pattern as schedule-group-supersession.spec.ts
 *  and schedule-go-dark-fallback.spec.ts in this directory: the controller is
 *  constructed directly with a mocked Prisma whose schedule.{create,update,
 *  updateMany,deleteMany,findFirst} all operate on one shared `rows` array
 *  (both the top-level client AND the $transaction `tx` handle share it), so
 *  create()'s displacement/upsert-cleanup and update()'s transaction see
 *  realistic state. */
function makeController(rows: Row[]) {
  const auditRows: any[] = [];

  const scheduleClient = {
    findFirst: jest.fn(
      async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    ),
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matchWhere(rows[i], where)) {
          rows.splice(i, 1);
          count++;
        }
      }
      return { count };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) {
        if (matchWhere(r, where)) {
          Object.assign(r, data);
          count++;
        }
      }
      return { count };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const r = rows.find((row) => row.id === where.id);
      if (!r) throw new Error('row not found: ' + where.id);
      Object.assign(r, data);
      return { ...r };
    }),
    create: jest.fn(async ({ data }: any) => {
      const r: Row = {
        id: 'new-' + ++idSeq,
        tenantId: data.tenantId,
        playlistId: data.playlistId,
        screenId: data.screenId ?? null,
        screenGroupId: data.screenGroupId ?? null,
        daysOfWeek: data.daysOfWeek ?? null,
        timeStart: data.timeStart ?? null,
        timeEnd: data.timeEnd ?? null,
        isActive: data.isActive,
        priority: data.priority ?? 0,
        startTime: data.startTime,
        endTime: data.endTime ?? null,
        mode: data.mode ?? 'replace',
        mutedOverride: data.mutedOverride ?? null,
      };
      rows.push(r);
      return {
        ...r,
        playlist: { id: r.playlistId, name: 'pl' },
        screenGroup: null,
        screen: null,
      };
    }),
  };

  const auditLogClient = {
    create: jest.fn(async (a: any) => {
      auditRows.push(a.data);
      return a.data;
    }),
  };

  const tx = { schedule: scheduleClient, auditLog: auditLogClient };

  const prisma: any = {
    client: {
      schedule: scheduleClient,
      screen: {
        findFirst: jest.fn().mockResolvedValue({ id: 'scr1' }),
        findMany: jest.fn(async () => []),
      },
      screenGroup: { findFirst: jest.fn().mockResolvedValue({ id: 'grp1' }) },
      playlist: { findFirst: jest.fn().mockResolvedValue({ id: 'pl1' }) },
      auditLog: auditLogClient,
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    },
  };

  const redis: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const signer: any = { signMessage: jest.fn().mockReturnValue('signed') };
  const notify: any = { notify: jest.fn().mockResolvedValue({}) };

  const controller = new SchedulesController(prisma, redis, signer, notify);
  return { controller, rows, auditRows };
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
    daysOfWeek: null,
    timeStart: null,
    timeEnd: null,
    isActive: true,
    priority: 0,
    startTime: new Date('2026-06-01T00:00:00Z'),
    endTime: null,
    mode: 'replace',
    mutedOverride: null,
    ...over,
  };
}

describe('SchedulesController.create() — P5 guard wired in', () => {
  beforeEach(() => {
    idSeq = 0;
  });

  it('rejects: windowed (a time window is set) + explicitly empty daysOfWeek', async () => {
    const { controller, rows } = makeController([]);
    await expect(
      controller.create(
        adminReq as any,
        {
          playlistId: 'pl1',
          screenId: 'scr1',
          startTime: '2026-08-25T00:00:00Z',
          daysOfWeek: '',
          timeStart: '08:00',
          timeEnd: '15:00',
        } as any,
      ),
    ).rejects.toThrow(/would never run/);
    // Nothing was written — the guard fires before any DB call.
    expect(rows).toHaveLength(0);
  });

  it('rejects with the EXACT 400 code + message from the audit finding', async () => {
    const { controller } = makeController([]);
    let caught: any = null;
    try {
      await controller.create(
        adminReq as any,
        {
          playlistId: 'pl1',
          screenId: 'scr1',
          startTime: '2026-08-25T00:00:00Z',
          daysOfWeek: '',
          timeStart: '08:00',
          timeEnd: '15:00',
        } as any,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught.getStatus()).toBe(400);
    expect(caught.getResponse()).toEqual({
      code: 'SCHEDULE_ZERO_DAYS_WINDOWED',
      message:
        'This schedule would never run — it has a time window but no days selected. Pick at least one day or remove the window.',
    });
  });

  it('accepts: null/omitted daysOfWeek (always-on) — unaffected, keeps working exactly as today', async () => {
    const { controller, rows } = makeController([]);
    const res = await controller.create(
      adminReq as any,
      {
        playlistId: 'pl1',
        screenId: 'scr1',
        startTime: '2026-08-25T00:00:00Z',
      } as any,
    );
    expect(res.daysOfWeek).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it('accepts: windowed WITH real days selected', async () => {
    const { controller, rows } = makeController([]);
    const res = await controller.create(
      adminReq as any,
      {
        playlistId: 'pl1',
        screenId: 'scr1',
        startTime: '2026-08-25T00:00:00Z',
        daysOfWeek: 'Mon,Wed,Fri',
        timeStart: '08:00',
        timeEnd: '15:00',
      } as any,
    );
    expect(res.daysOfWeek).toBe('Mon,Wed,Fri');
    expect(rows).toHaveLength(1);
  });

  it('accepts: fully always-on (no days, no window at all)', async () => {
    const { controller, rows } = makeController([]);
    const res = await controller.create(
      adminReq as any,
      {
        playlistId: 'pl1',
        screenId: 'scr1',
        startTime: '2026-08-25T00:00:00Z',
        daysOfWeek: undefined,
        timeStart: undefined,
        timeEnd: undefined,
      } as any,
    );
    expect(res.daysOfWeek).toBeNull();
    expect(res.timeStart).toBeNull();
    expect(res.timeEnd).toBeNull();
    expect(rows).toHaveLength(1);
  });
});

describe('SchedulesController.update() — P5 guard wired in, evaluated against the EFFECTIVE merged state', () => {
  it('rejects: the PUT itself sets daysOfWeek="" together with a time window in the same request', async () => {
    const rows = [
      row({ id: 's1', daysOfWeek: 'Mon,Tue', timeStart: null, timeEnd: null }),
    ];
    const { controller } = makeController(rows);
    await expect(
      controller.update(adminReq as any, 's1', {
        daysOfWeek: '',
        timeStart: '08:00',
        timeEnd: '15:00',
      } as any),
    ).rejects.toThrow(/would never run/);
    // Row untouched — the write never happened.
    expect(rows[0].daysOfWeek).toBe('Mon,Tue');
    expect(rows[0].timeStart).toBeNull();
  });

  it('rejects: clearing daysOfWeek to "" on a row that ALREADY has a stored time window (merge, not just this request\'s fields)', async () => {
    const rows = [
      row({
        id: 's1',
        daysOfWeek: 'Mon,Tue',
        timeStart: '08:00',
        timeEnd: '15:00',
      }),
    ];
    const { controller } = makeController(rows);
    await expect(
      controller.update(adminReq as any, 's1', { daysOfWeek: '' } as any),
    ).rejects.toThrow(/would never run/);
    expect(rows[0].daysOfWeek).toBe('Mon,Tue');
  });

  it('rejects: adding a time window on a row whose stored daysOfWeek is already the empty string (defensive — legacy/edge data, merge in the other direction)', async () => {
    const rows = [
      row({ id: 's1', daysOfWeek: '', timeStart: null, timeEnd: null }),
    ];
    const { controller } = makeController(rows);
    await expect(
      controller.update(adminReq as any, 's1', {
        timeStart: '08:00',
        timeEnd: '15:00',
      } as any),
    ).rejects.toThrow(/would never run/);
  });

  it('accepts: clearing daysOfWeek + timeStart + timeEnd TOGETHER ("Always Show") even though the row previously had a window', async () => {
    const rows = [
      row({
        id: 's1',
        daysOfWeek: 'Mon,Tue',
        timeStart: '08:00',
        timeEnd: '15:00',
      }),
    ];
    const { controller } = makeController(rows);
    const res = await controller.update(adminReq as any, 's1', {
      daysOfWeek: null,
      timeStart: null,
      timeEnd: null,
    } as any);
    expect(res.daysOfWeek).toBeNull();
    expect(res.timeStart).toBeNull();
    expect(res.timeEnd).toBeNull();
  });

  it('accepts: a PUT that does not touch daysOfWeek/timeStart/timeEnd at all — regression check (e.g. only priority changes)', async () => {
    const rows = [
      row({
        id: 's1',
        daysOfWeek: 'Mon,Tue',
        timeStart: '08:00',
        timeEnd: '15:00',
        priority: 0,
      }),
    ];
    const { controller } = makeController(rows);
    const res = await controller.update(adminReq as any, 's1', {
      priority: 5,
    } as any);
    expect(res.priority).toBe(5);
    expect(rows[0].daysOfWeek).toBe('Mon,Tue');
  });

  it('accepts: setting real days on a row that already has a time window', async () => {
    const rows = [
      row({ id: 's1', daysOfWeek: null, timeStart: '08:00', timeEnd: '15:00' }),
    ];
    const { controller } = makeController(rows);
    const res = await controller.update(adminReq as any, 's1', {
      daysOfWeek: 'Mon,Wed,Fri',
    } as any);
    expect(res.daysOfWeek).toBe('Mon,Wed,Fri');
  });

  it('accepts: explicitly clearing daysOfWeek to null on a windowed row — "no day restriction" must keep working exactly as today', async () => {
    const rows = [
      row({
        id: 's1',
        daysOfWeek: 'Mon,Tue',
        timeStart: '08:00',
        timeEnd: '15:00',
      }),
    ];
    const { controller } = makeController(rows);
    const res = await controller.update(adminReq as any, 's1', {
      daysOfWeek: null,
    } as any);
    expect(res.daysOfWeek).toBeNull();
    expect(res.timeStart).toBe('08:00');
    expect(res.timeEnd).toBe('15:00');
  });
});
