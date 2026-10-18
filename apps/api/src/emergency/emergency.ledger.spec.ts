/**
 * The interruption ledger on the emergency paths (2026-10-18,
 * screens/events/screen-events.ts) — against the real controllers and the
 * shared stateful world of emergency.targeting.spec.ts.
 *
 * What this pins, the emergency safeguards first:
 *   1. the ledger write comes AFTER the alert's own audit rows, is never
 *      awaited (a ledger that hangs or fails cannot delay, fail or change an
 *      alert or an all-clear), and a refused drill writes nothing;
 *   2. emergency-start / emergency-clear: one row per screen the alert
 *      reached — every screen of the affected tenants for tenant scope
 *      (descendants included), exactly the targeted displays for group /
 *      device scope — each with its own tenant and `drill: true|false`;
 *   3. drills are left out of the launch gate's count;
 *   4. the per-screen emergency controller writes the same two kinds.
 */
import { EmergencyController } from './emergency.controller';
import { ScreenEmergencyController } from './screen-emergency.controller';
import { ScreenEventsService } from '../screens/events/screen-events.service';
import { summarizeLedgerRows } from '../screens/events/screen-events';
import { invalidateTenantState, resetManifestCacheForTests } from '../screens/manifest-hot-cache';
import { resetEmergencyRevForTests } from '../screens/emergency-rev';
import {
  DISTRICT, SCHOOL, SIBLING, OTHER, GYM, SCHOOL_IDS,
  makeWorld, schoolAdmin, districtAdmin, trigger, clear,
} from './emergency.targeting.world';

/** Let the fire-and-forget ledger write finish. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

function withLedger(opts: { createMany?: (args: any) => Promise<any> } = {}) {
  const w = makeWorld();
  const rows: any[] = [];
  const order: string[] = [];
  w.client.screenEvent = {
    createMany: jest.fn(opts.createMany ?? (async ({ data }: any) => {
      order.push('ledger');
      rows.push(...data);
      return { count: data.length };
    })),
    create: jest.fn(async ({ data }: any) => {
      order.push('ledger');
      rows.push(data);
      return { id: 'ev' };
    }),
  };
  const audit = w.client.auditLog.create;
  w.client.auditLog.create = jest.fn(async (args: any) => {
    order.push(`audit:${args.data.action}`);
    return audit(args);
  });
  const ledger = new ScreenEventsService({ client: w.client } as any);
  const emergency = new EmergencyController(
    w.redis,
    { client: w.client } as any,
    { signMessage: jest.fn((type: string, payload: any) => ({ type, payload, signature: 'sig', timestamp: Date.now() })) } as any,
    { dispatch: jest.fn() } as any,
    { driveStatusLampForEmergency: jest.fn(async () => ({ touched: 0 })) } as any,
    ledger,
  );
  const perScreen = new ScreenEmergencyController(
    { client: w.client } as any,
    w.redis,
    { signMessage: jest.fn((type: string, payload: any) => ({ type, payload, signature: 'sig' })) } as any,
    ledger,
  );
  return { w, rows, order, emergency, perScreen };
}

const ids = (rows: any[], kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.screenId).sort();

beforeEach(() => {
  resetManifestCacheForTests();
  resetEmergencyRevForTests('origin-ledger');
  for (const id of [DISTRICT, SCHOOL, SIBLING, OTHER]) invalidateTenantState(id);
});

describe('1. the alert first, the ledger after — never awaited, never in the way', () => {
  it('rows are written after the trigger and the all-clear audit rows', async () => {
    const { order, emergency } = withLedger();
    const res: any = await emergency.triggerEmergency(trigger('tenant', SCHOOL), schoolAdmin);
    await flush();
    await emergency.clearEmergency(res.overrideId, clear('tenant', SCHOOL), schoolAdmin);
    await flush();
    expect(order).toEqual(['audit:TRIGGER_EMERGENCY', 'ledger', 'audit:CLEAR_EMERGENCY', 'ledger']);
  });

  it('a ledger that fails, or never answers, changes nothing about the alert or its all-clear', async () => {
    for (const createMany of [async () => { throw new Error('pool timeout'); }, () => new Promise(() => undefined)]) {
      const { w, emergency } = withLedger({ createMany });
      const res: any = await emergency.triggerEmergency(trigger('tenant', SCHOOL), schoolAdmin);
      expect(res).toMatchObject({ success: true, affectedTenantIds: [SCHOOL] });
      expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyStatus: 'CRITICAL' });
      const cleared: any = await emergency.clearEmergency(res.overrideId, clear('tenant', SCHOOL), schoolAdmin);
      expect(cleared).toMatchObject({ success: true });
      expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyStatus: 'INACTIVE' });
      await flush();
      expect(w.auditLogs.map((a) => a.action)).toEqual(['TRIGGER_EMERGENCY', 'CLEAR_EMERGENCY']);
    }
  });

  it('a refused drill (a live alert is active) writes nothing', async () => {
    const { rows, emergency } = withLedger();
    await emergency.triggerEmergency(trigger('tenant', SCHOOL), schoolAdmin);
    await flush();
    rows.length = 0;
    await expect(
      emergency.triggerEmergency({ ...trigger('group', GYM), overridePayload: { type: 'lockdown', isDrill: true } } as any, schoolAdmin),
    ).rejects.toMatchObject({ status: 409 });
    await flush();
    expect(rows).toEqual([]);
  });
});

describe('2. one row per screen the alert reached', () => {
  it('tenant scope: every screen of the school, cause = the alert type, drill: false', async () => {
    const { rows, emergency } = withLedger();
    const res: any = await emergency.triggerEmergency(trigger('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    await flush();
    expect(ids(rows, 'emergency-start')).toEqual([...SCHOOL_IDS].sort());
    expect(rows[0]).toMatchObject({
      tenantId: SCHOOL, cause: 'lockdown', source: 'operator',
      detail: { drill: false, overrideId: res.overrideId, scope: 'tenant', severity: 'CRITICAL' },
    });
  });

  it('district scope: the district and every school under it, each row with the screen’s OWN tenant', async () => {
    const { rows, emergency, w } = withLedger();
    await emergency.triggerEmergency(trigger('tenant', DISTRICT, 'weather'), districtAdmin);
    await flush();
    const reached = [...w.screens.values()].filter((s) => [DISTRICT, SCHOOL, SIBLING].includes(s.tenantId)).map((s) => s.id).sort();
    expect(ids(rows, 'emergency-start')).toEqual(reached);
    for (const r of rows) expect(r.tenantId).toBe(w.screens.get(r.screenId)!.tenantId);
    expect(rows.some((r) => r.tenantId === OTHER)).toBe(false);
  });

  it('group scope: exactly the group, and its all-clear exactly the screens it changed', async () => {
    const { rows, emergency } = withLedger();
    const res: any = await emergency.triggerEmergency(trigger('group', GYM, 'hold'), schoolAdmin);
    await flush();
    expect(ids(rows, 'emergency-start')).toEqual(['gym-1', 'gym-2']);
    await emergency.clearEmergency(res.overrideId, clear('group', GYM), schoolAdmin);
    await flush();
    expect(ids(rows, 'emergency-clear')).toEqual(['gym-1', 'gym-2']);
    expect(rows.find((r) => r.kind === 'emergency-clear')).toMatchObject({ cause: 'all-clear', detail: { drill: false, scope: 'group' } });
  });

  it('device scope: the whole display — both sides', async () => {
    const { rows, emergency } = withLedger();
    await emergency.triggerEmergency(trigger('device', 'front', 'medical'), schoolAdmin);
    await flush();
    expect(ids(rows, 'emergency-start')).toEqual(['back', 'front']);
  });
});

describe('3. drills are recorded, and left out of the count', () => {
  it('a drill and its all-clear carry drill: true; the gate counts 0 interruptions and 1 drill per screen', async () => {
    const { rows, emergency } = withLedger();
    const res: any = await emergency.triggerEmergency(
      { scopeType: 'tenant', scopeId: SCHOOL, overridePayload: { type: 'lockdown', severity: 'CRITICAL', isDrill: true } } as any,
      schoolAdmin,
    );
    await flush();
    await emergency.clearEmergency(res.overrideId, clear('tenant', SCHOOL), schoolAdmin);
    await flush();
    const gym = rows.filter((r) => r.screenId === 'gym-1');
    expect(gym.map((r) => `${r.kind}:${r.detail.drill}`)).toEqual(['emergency-start:true', 'emergency-clear:true']);
    expect(summarizeLedgerRows(gym)).toMatchObject({ interruptions: 0, drills: 1 });
  });

  it('a live alert counts', async () => {
    const { rows, emergency } = withLedger();
    await emergency.triggerEmergency(trigger('tenant', SCHOOL), schoolAdmin);
    await flush();
    expect(summarizeLedgerRows(rows.filter((r) => r.screenId === 'gym-1'))).toMatchObject({ interruptions: 1, drills: 0 });
  });
});

describe('4. the per-screen emergency controller', () => {
  it('trigger → emergency-start, all-clear → emergency-clear; an all-clear of a clear screen writes nothing', async () => {
    const { rows, perScreen } = withLedger();
    const res: any = await perScreen.trigger(schoolAdmin, 'lobby', { type: 'evacuate', severity: 'HIGH' });
    await flush();
    await perScreen.allClear(schoolAdmin, 'lobby');
    await flush();
    await perScreen.allClear(schoolAdmin, 'lobby');
    await flush();
    expect(rows).toEqual([
      expect.objectContaining({ screenId: 'lobby', tenantId: SCHOOL, kind: 'emergency-start', cause: 'evacuate', detail: expect.objectContaining({ drill: false, overrideId: res.overrideId, scope: 'screen' }) }),
      expect.objectContaining({ screenId: 'lobby', tenantId: SCHOOL, kind: 'emergency-clear', cause: 'all-clear', detail: expect.objectContaining({ drill: false, scope: 'screen' }) }),
    ]);
  });

  it('a ledger that fails changes nothing about the per-screen alert', async () => {
    const { w, perScreen } = withLedger();
    w.client.screenEvent.create = jest.fn(async () => { throw new Error('pool timeout'); });
    await expect(perScreen.trigger(schoolAdmin, 'lobby', { type: 'lockdown' })).resolves.toMatchObject({ success: true });
    await flush();
    expect(w.overrides.get('lobby')).toMatchObject({ type: 'LOCKDOWN' });
  });
});
