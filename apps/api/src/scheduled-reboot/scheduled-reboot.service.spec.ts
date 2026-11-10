import { DisplayActionUnsupportedError } from '../display/display.service';
import { jitterOffsetMs } from './scheduled-reboot-policy';
import { RUN_STATUS, SCHEDULED_REBOOT_AUDIT, ScheduledRebootService } from './scheduled-reboot.service';

const TENANT = 'tenant-a';
const OTHER = 'tenant-b';
const GROUP = 'group-a';
const S1 = '11111111-1111-4111-8111-111111111111';
const ZONE = 'America/Chicago';
const SLOT_START = Date.parse('2026-11-10T09:00:00Z'); // 03:00 CST
const NOW = new Date(SLOT_START + jitterOffsetMs(S1, '2026-11-10') + 1);

type Row = Record<string, any>;

/** Every `where` must carry tenantId unless it is the cross-tenant policy / open-run scan. */
function assertTenant(model: string, args: any) {
  const w = args?.where ?? {};
  if (model === 'tenant' || model === 'screenEmergencyOverride') return;
  if (model === 'screenRebootPolicy' && w.isActive === true && !w.tenantId) return;
  if (model === 'screenRebootRun' && args?.distinct) return;
  if (args?.data && !args?.where) {
    expect(args.data.tenantId).toBeDefined();
    return;
  }
  expect(w.tenantId).toBeDefined();
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(row[k]);
      if ('gte' in v) return row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      return true;
    }
    return row[k] === v;
  });
}

function screen(over: Row = {}): Row {
  return {
    id: S1,
    name: 'Lobby',
    tenantId: TENANT,
    screenGroupId: GROUP,
    timezone: ZONE,
    latitude: null,
    longitude: null,
    hardwareModel: 'goodview-guq',
    lastVideoReport: null,
    displayCapabilities: { verdict: { reboot: 'device-owner' } },
    lastPushConnectedAt: new Date(NOW.getTime() - 60_000),
    lastPingAt: new Date(NOW.getTime() - 30_000),
    nativeRuntimeReport: { elapsedRealtimeMs: 3 * 24 * 3600_000, interactive: true, proc: { pid: 1, at: 1, boot: 40 } },
    nativeRuntimeReportAt: new Date(NOW.getTime() - 60_000),
    softBlankAt: null,
    lastOtaState: null,
    lastOtaAt: null,
    forceApkUpdatePendingAt: null,
    forceApkUpdateHold: null,
    ...over,
  };
}

function build(opts: { screens?: Row[]; runs?: Row[]; emergency?: string; applyAction?: jest.Mock } = {}) {
  const runs: Row[] = opts.runs ?? [];
  const screens = opts.screens ?? [screen()];
  let n = 0;
  const calls: Array<[string, string, any]> = [];
  const wrap = (model: string, impl: Record<string, (a: any) => any>) =>
    Object.fromEntries(
      Object.entries(impl).map(([m, f]) => [
        m,
        jest.fn(async (a: any) => {
          calls.push([model, m, a]);
          assertTenant(model, a);
          return f(a);
        }),
      ]),
    );
  const prisma: any = {
    client: {
      screenRebootPolicy: wrap('screenRebootPolicy', {
        findMany: () => [
          { id: 'p1', tenantId: TENANT, screenGroupId: GROUP, cadence: 'DAILY', dayOfWeek: null, time: '03:00', isActive: true },
        ],
      }),
      screenRebootRun: wrap('screenRebootRun', {
        findMany: (a) => {
          const rows = runs.filter((r) => matches(r, a.where ?? {}));
          if (a.distinct) return [...new Set(rows.map((r) => r.tenantId))].map((tenantId) => ({ tenantId }));
          return rows;
        },
        count: (a) => runs.filter((r) => matches(r, a.where ?? {})).length,
        create: ({ data }) => {
          if (runs.some((r) => r.screenId === data.screenId && r.slotKey === data.slotKey)) {
            throw Object.assign(new Error('unique'), { code: 'P2002' });
          }
          const row = { id: `run-${++n}`, createdAt: NOW, restartProven: false, ...data };
          runs.push(row);
          return row;
        },
        updateMany: ({ where, data }) => {
          const hit = runs.filter((r) => matches(r, where));
          for (const r of hit) Object.assign(r, data);
          return { count: hit.length };
        },
      }),
      screen: wrap('screen', { findMany: (a) => screens.filter((s) => matches(s, a.where)) }),
      screenGroup: wrap('screenGroup', { findMany: () => [{ id: GROUP, syncMode: null, latitude: null, longitude: null }] }),
      tenant: wrap('tenant', {
        findUnique: () => ({ id: TENANT, timezone: ZONE, latitude: null, longitude: null, emergencyStatus: opts.emergency ?? 'INACTIVE', parentId: null, archivedAt: null }),
      }),
      displaySchedule: wrap('displaySchedule', { findMany: () => [] }),
      schedule: wrap('schedule', { findMany: () => [] }),
      screenEmergencyOverride: wrap('screenEmergencyOverride', { findUnique: () => null }),
    },
  };
  const applyAction =
    opts.applyAction ??
    jest.fn(async () => ({ success: true, action: 'REBOOT', delivered: true, deliveryReason: null, actionId: 'act-1' }));
  const display: any = { applyAction, writeAudit: jest.fn(async () => undefined) };
  const lease: any = { tryAcquire: jest.fn(async () => ({ name: 'x', leader: true, degraded: false, fence: 1 })) };
  const svc = new ScheduledRebootService(prisma, display, lease);
  return { svc, prisma, display, runs, calls, applyAction, lease };
}

describe('ScheduledRebootService.tick', () => {
  const env = process.env.SCHEDULED_REBOOTS_DISABLED;
  afterEach(() => {
    if (env === undefined) delete process.env.SCHEDULED_REBOOTS_DISABLED;
    else process.env.SCHEDULED_REBOOTS_DISABLED = env;
  });

  it('dispatches through the display path with no user, records the run and the boot count', async () => {
    const t = build();
    const r = await t.svc.tick(NOW);
    expect(r.sent).toBe(1);
    expect(t.applyAction).toHaveBeenCalledTimes(1);
    expect(t.applyAction.mock.calls[0][0]).toMatchObject({ screenId: S1, tenantId: TENANT, userId: null, action: 'REBOOT', reason: 'scheduled-restart:p1' });
    expect(t.runs).toHaveLength(1);
    expect(t.runs[0]).toMatchObject({ status: RUN_STATUS.SENT, bootBefore: 40, slotKey: '2026-11-10', tenantId: TENANT });
  });

  it('never sends the same slot twice', async () => {
    const t = build();
    await t.svc.tick(NOW);
    await t.svc.tick(new Date(NOW.getTime() + 5 * 60_000));
    expect(t.applyAction).toHaveBeenCalledTimes(1);
  });

  it('records cannot-restart and sends nothing on a screen with no reboot capability (today’s fleet)', async () => {
    const t = build({ screens: [screen({ displayCapabilities: { verdict: { reboot: 'none' } } })] });
    await t.svc.tick(NOW);
    expect(t.applyAction).not.toHaveBeenCalled();
    expect(t.runs[0]).toMatchObject({ status: RUN_STATUS.SKIPPED, reason: 'cannot-restart' });
  });

  it('waits during an emergency (tenant status), never sends', async () => {
    const t = build({ emergency: 'LOCKDOWN' });
    await t.svc.tick(NOW);
    expect(t.applyAction).not.toHaveBeenCalled();
    expect(t.runs[0]).toMatchObject({ status: RUN_STATUS.WAITING, reason: 'emergency' });
  });

  it('a wait becomes a skip once the window closes', async () => {
    const t = build({ emergency: 'LOCKDOWN' });
    await t.svc.tick(NOW);
    await t.svc.tick(new Date(SLOT_START + 61 * 60_000));
    expect(t.runs[0]).toMatchObject({ status: RUN_STATUS.SKIPPED, reason: 'emergency' });
  });

  it('records REFUSED when the API gate refuses', async () => {
    const applyAction = jest.fn(async () => {
      throw new DisplayActionUnsupportedError('DISPLAY_REBOOT_UNAVAILABLE', 'no', {});
    });
    const t = build({ applyAction });
    await t.svc.tick(NOW);
    expect(t.runs[0]).toMatchObject({ status: RUN_STATUS.REFUSED, reason: 'DISPLAY_REBOOT_UNAVAILABLE' });
  });

  it('records UNDELIVERED when there is no live channel', async () => {
    const applyAction = jest.fn(async () => ({ success: true, delivered: false, deliveryReason: 'no_push_socket', actionId: 'a' }));
    const t = build({ applyAction });
    await t.svc.tick(NOW);
    expect(t.runs[0]).toMatchObject({ status: RUN_STATUS.UNDELIVERED, reason: 'no_push_socket' });
  });

  it('one class at a time: a second class waits while the first is unproven', async () => {
    const S2 = '22222222-2222-4222-8222-222222222222';
    const at = new Date(SLOT_START + 46 * 60_000); // past every jitter offset
    const fresh = { lastPingAt: new Date(at.getTime() - 30_000), lastPushConnectedAt: new Date(at.getTime() - 30_000), nativeRuntimeReportAt: new Date(at.getTime() - 60_000) };
    const t = build({
      screens: [screen(fresh), screen({ ...fresh, id: S2, name: 'Gym', hardwareModel: 'tcl-x' })],
      runs: [
        {
          id: 'old', tenantId: TENANT, screenId: 'zzz', policyId: 'p1', slotKey: '2026-11-10', status: RUN_STATUS.SENT,
          hardwareClass: 'model:other', dispatchedAt: new Date(at.getTime() - 60_000), scheduledFor: new Date(SLOT_START), createdAt: at,
        },
      ],
    });
    await t.svc.tick(at);
    expect(t.applyAction).not.toHaveBeenCalled();
    const mine = t.runs.filter((r) => r.screenId !== 'zzz');
    expect(mine).toHaveLength(2);
    expect(mine.every((r) => r.status === RUN_STATUS.WAITING && r.reason === 'class-busy')).toBe(true);
  });

  it('the same class may proceed while its own restart is unproven, up to the tick cap', async () => {
    const at = new Date(SLOT_START + 46 * 60_000);
    const fresh = { lastPingAt: new Date(at.getTime() - 30_000), lastPushConnectedAt: new Date(at.getTime() - 30_000), nativeRuntimeReportAt: new Date(at.getTime() - 60_000) };
    const ids = ['a', 'b', 'c', 'd', 'e'].map((c) => `${c.repeat(8)}-aaaa-4aaa-8aaa-${c.repeat(12)}`);
    const t = build({ screens: ids.map((id) => screen({ ...fresh, id })) });
    await t.svc.tick(at);
    expect(t.applyAction).toHaveBeenCalledTimes(3); // PER_TENANT_PER_TICK
    expect(t.runs.filter((r) => r.status === RUN_STATUS.WAITING && r.reason === 'tenant-cap')).toHaveLength(2);
  });

  it('NOT_BACK after the return window, with an audit row; LATE when it checks in afterwards', async () => {
    const dispatchedAt = new Date(NOW.getTime() - 16 * 60_000);
    const s = screen({ lastPingAt: new Date(dispatchedAt.getTime() - 10_000) });
    const runs = [
      { id: 'r1', tenantId: TENANT, screenId: S1, policyId: 'p1', slotKey: '2026-11-10', status: RUN_STATUS.SENT, hardwareClass: 'model:goodview-guq', dispatchedAt, bootBefore: 40, scheduledFor: new Date(SLOT_START), createdAt: NOW },
    ];
    const t = build({ screens: [s], runs });
    await t.svc.tick(NOW);
    expect(runs[0].status).toBe(RUN_STATUS.NOT_BACK);
    expect(t.display.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: SCHEDULED_REBOOT_AUDIT.NOT_BACK, screenId: S1, tenantId: TENANT }));
    s.lastPingAt = new Date(NOW.getTime() + 60_000);
    await t.svc.tick(new Date(NOW.getTime() + 2 * 60_000));
    expect(runs[0].status).toBe(RUN_STATUS.LATE);
  });

  it('BACK, proven, when the boot count advanced after the dispatch', async () => {
    const dispatchedAt = new Date(NOW.getTime() - 4 * 60_000);
    const s = screen({
      lastPingAt: new Date(NOW.getTime() - 10_000),
      nativeRuntimeReportAt: new Date(NOW.getTime() - 10_000),
      nativeRuntimeReport: { elapsedRealtimeMs: 120_000, interactive: true, proc: { pid: 2, at: 2, boot: 41 } },
    });
    const runs = [
      { id: 'r1', tenantId: TENANT, screenId: S1, policyId: 'p1', slotKey: '2026-11-10', status: RUN_STATUS.SENT, hardwareClass: 'x', dispatchedAt, bootBefore: 40, scheduledFor: new Date(SLOT_START), createdAt: NOW },
    ];
    const t = build({ screens: [s], runs });
    await t.svc.tick(NOW);
    expect(runs[0]).toMatchObject({ status: RUN_STATUS.BACK, restartProven: true, bootAfter: 41 });
  });

  it('APP_RESTART where the device cannot reboot but its player can restart itself (2026-11-09)', async () => {
    const t = build({ screens: [screen({ displayCapabilities: { verdict: { reboot: 'none', appRestart: 'relaunch' } } })] });
    const r = await t.svc.tick(NOW);
    expect(r.sent).toBe(1);
    expect(t.applyAction.mock.calls[0][0]).toMatchObject({ action: 'APP_RESTART', userId: null, reason: 'scheduled-restart:p1' });
    expect(t.runs[0]).toMatchObject({ status: RUN_STATUS.SENT, actionId: 'act-1' });
  });

  it('an app restart is proven BACK by the new process acknowledging THIS action id — the boot count never moves', async () => {
    const dispatchedAt = new Date(NOW.getTime() - 2 * 60_000);
    const s = screen({
      displayCapabilities: { verdict: { reboot: 'none', appRestart: 'relaunch' } },
      lastPingAt: new Date(NOW.getTime() - 10_000),
      nativeRuntimeReportAt: new Date(NOW.getTime() - 10_000),
      nativeRuntimeReport: { elapsedRealtimeMs: 9e8, interactive: true, proc: { pid: 3, at: 2, boot: 40 }, appRestart: { id: 'act-9', o: 'landed' } },
    });
    const runs = [
      { id: 'r1', tenantId: TENANT, screenId: S1, policyId: 'p1', slotKey: '2026-11-10', status: RUN_STATUS.SENT, hardwareClass: 'x', dispatchedAt, actionId: 'act-9', bootBefore: 40, scheduledFor: new Date(SLOT_START), createdAt: NOW },
    ];
    const t = build({ screens: [s], runs });
    await t.svc.tick(NOW);
    expect(runs[0]).toMatchObject({ status: RUN_STATUS.BACK, restartProven: true });
  });

  it('kill switch: does nothing at all', async () => {
    process.env.SCHEDULED_REBOOTS_DISABLED = '1';
    const t = build();
    const r = await t.svc.tick(NOW);
    expect(r.ran).toBe(false);
    expect(t.calls).toHaveLength(0);
    expect(t.lease.tryAcquire).not.toHaveBeenCalled();
  });

  it('not the leader: does nothing', async () => {
    const t = build();
    t.lease.tryAcquire.mockResolvedValue({ name: 'x', leader: false, degraded: false, fence: 0 });
    await t.svc.tick(NOW);
    expect(t.applyAction).not.toHaveBeenCalled();
  });

  it('tenant isolation: every per-tenant read and write is scoped, and another tenant’s screen is never touched', async () => {
    const foreign = screen({ id: '33333333-3333-4333-8333-333333333333', tenantId: OTHER });
    const t = build({ screens: [screen(), foreign] });
    await t.svc.tick(NOW);
    // assertTenant ran on every call; the foreign screen was filtered by tenantId.
    expect(t.applyAction).toHaveBeenCalledTimes(1);
    expect(t.runs.every((r) => r.tenantId === TENANT && r.screenId === S1)).toBe(true);
  });
});
