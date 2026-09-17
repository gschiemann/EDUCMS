/**
 * Double-sided displays — AN ALERT REACHES BOTH SIDES (2026-09-16).
 *
 * A face is an ordinary `Screen` row in the tenant, so TENANT- and
 * GROUP-scoped alerts already reach it with no new code. The gap this file
 * closes is the DEVICE scope: `scopeId` names one Screen row, and on a
 * double-sided unit that row is one PANE. An alert that lit the front while
 * the back kept advertising the lunch menu is precisely the failure this
 * product exists to prevent.
 *
 * What is pinned here:
 *   1. TRIGGER on the front writes a per-screen override for the BACK too —
 *      that override row is what the HTTP polling backstop reads, so this is
 *      the half that survives a dead push channel.
 *   2. TRIGGER pushes to the back's OWN device channel (it is its own Screen
 *      row, so it has one).
 *   3. Naming a FACE reaches the whole display, not just that pane.
 *   4. ALL-CLEAR is SYMMETRIC — it clears every pane the trigger lit. An
 *      asymmetry here is exactly how a screen gets stranded on a lockdown
 *      nobody can clear (the emergency-003 bug class).
 *   5. A single-sided screen behaves exactly as it always did.
 */

import { EmergencyController } from './emergency.controller';

const TENANT = 'tenant-ds';
const FRONT = 'screen-front';
const BACK = 'screen-back';

type Row = Record<string, any>;

const front: Row = {
  id: FRONT,
  tenantId: TENANT,
  screenGroupId: null,
  resolution: '1920x1080',
  faceOfScreenId: null,
  faceIndex: null,
};
const back: Row = {
  id: BACK,
  tenantId: TENANT,
  screenGroupId: null,
  resolution: '1920x1080',
  faceOfScreenId: FRONT,
  faceIndex: 1,
};
const solo: Row = {
  id: 'screen-solo',
  tenantId: TENANT,
  screenGroupId: null,
  resolution: '1920x1080',
  faceOfScreenId: null,
  faceIndex: null,
};

/**
 * Prisma double that answers `screen.findMany` from a fixed row set by
 * honouring the WHERE the controller actually builds (`id`, `id: {in}`,
 * `faceOfScreenId`, `faceOfScreenId: {in}`, `screenGroupId`), so the test
 * exercises the real query shape rather than a stub that always says yes.
 */
function makeHarness(rows: Row[]) {
  const upserts: any[] = [];
  const deletes: any[] = [];
  const published: string[] = [];

  const matches = (row: Row, where: any): boolean => {
    if (!where) return true;
    if (where.tenantId && row.tenantId !== where.tenantId) return false;
    if (Array.isArray(where.OR)) {
      return where.OR.some((clause: any) => matches(row, { ...clause, tenantId: undefined }));
    }
    if (where.id !== undefined) {
      if (typeof where.id === 'string') return row.id === where.id;
      if (Array.isArray(where.id?.in)) return where.id.in.includes(row.id);
      return false;
    }
    if (where.faceOfScreenId !== undefined) {
      if (typeof where.faceOfScreenId === 'string') return row.faceOfScreenId === where.faceOfScreenId;
      if (Array.isArray(where.faceOfScreenId?.in)) {
        return !!row.faceOfScreenId && where.faceOfScreenId.in.includes(row.faceOfScreenId);
      }
      return false;
    }
    if (where.screenGroupId !== undefined) return row.screenGroupId === where.screenGroupId;
    return true;
  };

  const prisma: any = {
    client: {
      screen: {
        findMany: jest.fn(async (args: any) => rows.filter((r) => matches(r, args?.where))),
        findUnique: jest.fn(async (args: any) => rows.find((r) => r.id === args?.where?.id) ?? null),
      },
      tenant: {
        findUnique: jest.fn(async () => ({
          id: TENANT,
          parentId: null,
          panicLockdownPlaylistId: null,
          emergencyPlaylistId: null,
          emergencyPortraitPlaylistId: null,
        })),
      },
      screenEmergencyOverride: {
        upsert: jest.fn((args: any) => {
          upserts.push(args);
          return args;
        }),
        deleteMany: jest.fn((args: any) => {
          deletes.push(args);
          return args;
        }),
      },
      auditLog: { create: jest.fn((args: any) => args) },
      playlist: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(async (ops: any) =>
        Array.isArray(ops) ? ops : typeof ops === 'function' ? ops(prisma.client) : ops,
      ),
    },
  };

  const redis: any = {
    publish: jest.fn(async (channel: string) => {
      published.push(channel);
    }),
    isConnected: () => true,
    getString: jest.fn(async () => null),
    setString: jest.fn(async () => true),
    delKey: jest.fn(async () => true),
  };

  const controller = new EmergencyController(
    redis,
    prisma,
    { signMessage: jest.fn(() => ({ type: 'OVERRIDE', signature: 'sig' })) } as any,
    { dispatch: jest.fn() } as any,
    { driveStatusLampForEmergency: jest.fn() } as any,
    {} as any,
  );

  return { controller, prisma, redis, upserts, deletes, published };
}

const adminReq = { user: { id: 'user-1', tenantId: TENANT, role: 'SCHOOL_ADMIN' } } as any;

const triggerBody = (scopeId: string) =>
  ({
    scopeType: 'device',
    scopeId,
    overridePayload: { type: 'LOCKDOWN', severity: 'CRITICAL' },
  }) as any;

/** Screen ids that received a per-screen emergency override row. */
const upsertedScreenIds = (upserts: any[]): string[] =>
  upserts.map((u) => u?.where?.screenId).filter(Boolean);

describe('device-scoped TRIGGER reaches every side of the display', () => {
  it('naming the FRONT writes an override for the BACK as well', async () => {
    // The override row is what the HTTP polling backstop reads. Without it a
    // poll-only back panel misses the lockdown entirely — the most degraded
    // screen must not be the one that misses the alert.
    const h = makeHarness([front, back]);
    await h.controller.triggerEmergency(triggerBody(FRONT), adminReq);

    expect(upsertedScreenIds(h.upserts).sort()).toEqual([BACK, FRONT].sort());
  });

  it("pushes to the back's own device channel", async () => {
    const h = makeHarness([front, back]);
    await h.controller.triggerEmergency(triggerBody(FRONT), adminReq);

    expect(h.published).toEqual(expect.arrayContaining([`device:${FRONT}`, `device:${BACK}`]));
  });

  it('naming a FACE reaches the whole display, not just that pane', async () => {
    // The physical display is the thing in the room; the pane is not.
    const h = makeHarness([front, back]);
    await h.controller.triggerEmergency(triggerBody(BACK), adminReq);

    expect(upsertedScreenIds(h.upserts).sort()).toEqual([BACK, FRONT].sort());
    expect(h.published).toEqual(expect.arrayContaining([`device:${FRONT}`, `device:${BACK}`]));
  });

  it('an ordinary single-sided screen is reached exactly as before', async () => {
    const h = makeHarness([solo, front, back]);
    await h.controller.triggerEmergency(triggerBody(solo.id), adminReq);

    expect(upsertedScreenIds(h.upserts)).toEqual([solo.id]);
    expect(h.published).not.toEqual(expect.arrayContaining([`device:${BACK}`]));
  });
});

describe('device-scoped ALL-CLEAR is symmetric with the trigger', () => {
  it('clears the override on every side the trigger lit', async () => {
    // The set that goes into an alert must be the set that comes out of it.
    const h = makeHarness([front, back]);
    await h.controller.clearEmergency('ovr_1', { scopeType: 'device', scopeId: FRONT } as any, adminReq);

    const cleared = h.deletes.flatMap((d) => {
      const s = d?.where?.screenId;
      if (typeof s === 'string') return [s];
      return Array.isArray(s?.in) ? s.in : [];
    });
    expect(cleared).toEqual(expect.arrayContaining([FRONT, BACK]));
  });

  it('pushes the all-clear to the back’s own channel too', async () => {
    // A back panel that never hears the all-clear stays locked down until
    // someone notices — the emergency-003 failure, one pane over.
    const h = makeHarness([front, back]);
    await h.controller.clearEmergency('ovr_1', { scopeType: 'device', scopeId: FRONT } as any, adminReq);

    expect(h.published).toEqual(expect.arrayContaining([`device:${BACK}`]));
  });

  it('clearing from the FACE clears the whole display', async () => {
    const h = makeHarness([front, back]);
    await h.controller.clearEmergency('ovr_1', { scopeType: 'device', scopeId: BACK } as any, adminReq);

    const cleared = h.deletes.flatMap((d) => {
      const s = d?.where?.screenId;
      if (typeof s === 'string') return [s];
      return Array.isArray(s?.in) ? s.in : [];
    });
    expect(cleared).toEqual(expect.arrayContaining([FRONT, BACK]));
  });

  it('a single-sided screen clears exactly itself', async () => {
    const h = makeHarness([solo, front, back]);
    await h.controller.clearEmergency(
      'ovr_1',
      { scopeType: 'device', scopeId: solo.id } as any,
      adminReq,
    );

    const cleared = h.deletes.flatMap((d) => {
      const s = d?.where?.screenId;
      if (typeof s === 'string') return [s];
      return Array.isArray(s?.in) ? s.in : [];
    });
    expect(cleared).toEqual([solo.id]);
  });
});
