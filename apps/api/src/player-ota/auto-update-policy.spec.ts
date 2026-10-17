/**
 * Automatic Player updates (2026-10-11, owner decisions): OPT-IN per org or
 * per screen, SILENT-ONLY, OFF-HOURS. An operator's "Send update" still works
 * for any screen at any time.
 */
import {
  autoUpdateEnabledFor,
  decideAutomaticOffer,
  isInsideWindowStrict,
  resolveAutoUpdateWindow,
  silentUpdateReadiness,
} from './auto-update-policy';
import { PlayerOtaController } from './player-ota.controller';

const VC = 10125;
const armed = { app: { silentUpdateArmed: true, selfIsInstallerOfRecord: true, sdkInt: 33, versionCode: VC } };
const notArmed = { app: { silentUpdateArmed: false, selfIsInstallerOfRecord: false, sdkInt: 33, versionCode: VC } };
// 03:30 in Chicago on 2026-10-11 (CDT, UTC-5) = 08:30Z; 14:00 Chicago = 19:00Z.
const NIGHT = new Date('2026-10-11T08:30:00Z');
const DAY = new Date('2026-10-11T19:00:00Z');
const CHI = resolveAutoUpdateWindow({ orgTimezone: 'America/Chicago' })!;

describe('the switch: org setting, overridden per screen', () => {
  it('defaults OFF everywhere', () => {
    expect(autoUpdateEnabledFor(false, null)).toEqual({ enabled: false, source: 'org' });
    expect(autoUpdateEnabledFor(undefined, undefined)).toEqual({ enabled: false, source: 'org' });
  });
  it('a screen override wins in both directions', () => {
    expect(autoUpdateEnabledFor(false, true)).toEqual({ enabled: true, source: 'screen' });
    expect(autoUpdateEnabledFor(true, false)).toEqual({ enabled: false, source: 'screen' });
    expect(autoUpdateEnabledFor(true, null)).toEqual({ enabled: true, source: 'org' });
  });
});

describe('silentUpdateReadiness', () => {
  it('armed for the running build → silent', () => {
    expect(silentUpdateReadiness(armed, VC)).toEqual({ readiness: 'silent', reason: 'armed' });
  });
  it('a report from an older build proves nothing about this one → unknown', () => {
    expect(silentUpdateReadiness(armed, VC + 1).readiness).toBe('unknown');
    expect(silentUpdateReadiness({ app: { silentUpdateArmed: true } }, VC).reason).toBe('report-predates-install');
  });
  it('no report → unknown; not armed → needs a tap, with the reason', () => {
    expect(silentUpdateReadiness(null, VC)).toEqual({ readiness: 'unknown', reason: 'no-report' });
    expect(silentUpdateReadiness({ app: {} }, VC).reason).toBe('no-report');
    expect(silentUpdateReadiness(notArmed, VC)).toEqual({ readiness: 'needs-tap', reason: 'installed-by-another-app' });
    expect(silentUpdateReadiness({ app: { silentUpdateArmed: false, sdkInt: 28, versionCode: VC } }, VC).reason).toBe('android-too-old');
  });
});

describe('the off-hours window', () => {
  it('defaults to 03:00–04:00 in the org window timezone, else the screen schedule timezone', () => {
    expect(CHI).toMatchObject({ start: '03:00', end: '04:00', timezone: 'America/Chicago', hoursSource: 'default', zoneSource: 'org' });
    expect(resolveAutoUpdateWindow({ scheduleTimezone: 'America/Denver' })).toMatchObject({ timezone: 'America/Denver', zoneSource: 'schedule' });
    expect(resolveAutoUpdateWindow({ orgStart: '01:00', orgEnd: '02:30', orgTimezone: 'America/New_York' }))
      .toMatchObject({ start: '01:00', end: '02:30', hoursSource: 'org' });
  });
  it('no usable timezone → no window (03:00 UTC is evening in the Americas)', () => {
    expect(resolveAutoUpdateWindow({})).toBeNull();
    expect(resolveAutoUpdateWindow({ orgTimezone: 'Not/AZone' })).toBeNull();
  });
  it('strict: malformed is never "inside"; wraparound works', () => {
    expect(isInsideWindowStrict(CHI, NIGHT)).toBe(true);
    expect(isInsideWindowStrict(CHI, DAY)).toBe(false);
    expect(isInsideWindowStrict({ start: '3am', end: '04:00', timezone: 'America/Chicago' }, NIGHT)).toBe(false);
    expect(isInsideWindowStrict({ start: '22:00', end: '04:00', timezone: 'America/Chicago' }, NIGHT)).toBe(true);
  });
});

describe('decideAutomaticOffer', () => {
  const base = {
    orgEnabled: true, screenOverride: null, callerSource: '', callerVersionCode: VC,
    inventoryReport: armed, window: CHI, now: NIGHT,
  };
  it('offers only when on + silent + Player worker + inside the window', () => {
    expect(decideAutomaticOffer(base).offer).toBe(true);
    expect(decideAutomaticOffer({ ...base, callerSource: 'player' }).offer).toBe(true);
  });
  it('holds every other case, with a greppable reason', () => {
    expect(decideAutomaticOffer({ ...base, orgEnabled: false })).toMatchObject({ offer: false, reason: 'auto-off-org' });
    expect(decideAutomaticOffer({ ...base, screenOverride: false })).toMatchObject({ offer: false, reason: 'auto-off-screen' });
    expect(decideAutomaticOffer({ ...base, inventoryReport: notArmed }).reason).toMatch(/^auto-not-silent-/);
    expect(decideAutomaticOffer({ ...base, callerSource: 'manager' }).reason).toBe('auto-not-player-worker-manager');
    expect(decideAutomaticOffer({ ...base, now: DAY }).reason).toMatch(/^auto-outside-window-03:00-04:00-America\/Chicago/);
    expect(decideAutomaticOffer({ ...base, window: null }).reason).toBe('auto-no-timezone');
  });
  it('a screen switched ON in an org that is OFF is offered (opt-in per screen)', () => {
    expect(decideAutomaticOffer({ ...base, orgEnabled: false, screenOverride: true }).offer).toBe(true);
  });
});

// ── The update-check gate itself ──────────────────────────────────────────
const SID = '11111111-1111-4111-8111-111111111111';
const TID = '22222222-2222-4222-8222-222222222222';

function harness(opts: {
  orgAuto?: boolean; override?: boolean | null; pending?: boolean; inventory?: unknown;
  tz?: string | null; scheduleTz?: string | null;
}) {
  const row = {
    id: SID, tenantId: TID, name: 'Lobby', status: 'ONLINE', screenGroupId: null,
    playerVersionCode: VC,
    forceApkUpdatePendingAt: opts.pending ? new Date() : null,
    forceApkUpdateOverrideWindow: false,
    autoUpdatePlayerOverride: opts.override ?? null,
    tenant: {
      autoUpdatePlayerEnabled: !!opts.orgAuto, canaryFleetPercent: 100,
      otaWindowStart: null, otaWindowEnd: null, otaWindowTimezone: opts.tz === undefined ? 'America/Chicago' : opts.tz,
    },
  };
  const prisma: any = {
    client: {
      screen: { findFirst: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn() },
      screenDeviceInventory: { findUnique: jest.fn().mockResolvedValue(opts.inventory === undefined ? { report: armed } : opts.inventory) },
      displaySchedule: { findMany: jest.fn().mockResolvedValue(opts.scheduleTz ? [{ screenId: SID, timezone: opts.scheduleTz }] : []) },
      auditLog: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
    },
  };
  const c = new PlayerOtaController(prisma, { sismember: jest.fn().mockResolvedValue(false) } as any);
  jest.spyOn(c as any, 'isDeviceAuthenticated').mockResolvedValue(true);
  jest.spyOn(c as any, 'persistReportedVersion').mockResolvedValue(undefined);
  const lines: string[] = [];
  jest.spyOn((c as any).logger, 'log').mockImplementation((m: unknown) => { lines.push(String(m)); });
  jest.spyOn((c as any).logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn((c as any).logger, 'error').mockImplementation(() => undefined);
  return { c, prisma, lines };
}

const realFetch = global.fetch;
describe('POST /player/update-check — automatic offers', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NIGHT, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    // Release resolution after the gate is not under test here.
    global.fetch = jest.fn().mockRejectedValue(new Error('offline in test')) as any;
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); global.fetch = realFetch; });

  const call = (h: ReturnType<typeof harness>, source?: string) =>
    h.c.updateCheck({ fingerprint: 'fp', versionCode: VC, versionName: '1.1.25', ...(source ? { source } : {}) } as any, { headers: {} } as any)
      .catch(() => undefined);
  const decision = (lines: string[]) => lines.find((l) => l.includes('[ota] decision=')) ?? '';

  it('org OFF, no override, no push → never offered, and no inventory read (default fleet pays nothing)', async () => {
    const h = harness({ orgAuto: false });
    await call(h);
    expect(decision(h.lines)).toContain('decision=uptoDate');
    expect(decision(h.lines)).toContain('auto-off-org');
    expect(h.prisma.client.screenDeviceInventory.findUnique).not.toHaveBeenCalled();
  });

  it('org ON + silent + 03:30 local → offered', async () => {
    const h = harness({ orgAuto: true });
    await call(h);
    expect(decision(h.lines)).toContain('decision=offer-latest');
    expect(decision(h.lines)).toContain('reason=auto-org-silent-inside-default-window-03:00-04:00-America/Chicago');
  });

  it('org ON but this screen cannot install silently → held (no prompt over content)', async () => {
    const h = harness({ orgAuto: true, inventory: { report: notArmed } });
    await call(h);
    expect(decision(h.lines)).toContain('decision=uptoDate');
    expect(decision(h.lines)).toContain('auto-not-silent-installed-by-another-app');
  });

  it('org ON, silent, but 14:00 local → held until the window', async () => {
    jest.setSystemTime(DAY);
    const h = harness({ orgAuto: true });
    await call(h);
    expect(decision(h.lines)).toContain('auto-outside-window');
  });

  it('org OFF but this screen switched ON → offered; org ON but screen switched OFF → held', async () => {
    const on = harness({ orgAuto: false, override: true });
    await call(on);
    expect(decision(on.lines)).toContain('reason=auto-screen-silent-inside');
    const off = harness({ orgAuto: true, override: false });
    await call(off);
    expect(decision(off.lines)).toContain('auto-off-screen');
  });

  it("the Manager's check never gets an automatic offer (its install would prompt)", async () => {
    // 2026-10-17: the Manager's own check is refused before the automatic
    // rules are even consulted — it is never offered the Player APK at all
    // (push-tracking-controller.spec.ts). decideAutomaticOffer's own
    // 'auto-not-player-worker-manager' rule is still pinned above.
    const h = harness({ orgAuto: true });
    await call(h, 'manager');
    expect(decision(h.lines)).toContain('decision=uptoDate-manager-check-player-installs-itself');
  });

  it('no org timezone → the screen schedule timezone is used; neither → held', async () => {
    const sched = harness({ orgAuto: true, tz: null, scheduleTz: 'America/Chicago' });
    await call(sched);
    expect(decision(sched.lines)).toContain('decision=offer-latest');
    const none = harness({ orgAuto: true, tz: null });
    await call(none);
    expect(decision(none.lines)).toContain('auto-no-timezone');
  });

  it("an operator's Send update still offers to a screen that needs a tap, at 14:00, with auto OFF", async () => {
    jest.setSystemTime(DAY);
    const h = harness({ orgAuto: false, pending: true, inventory: { report: notArmed }, tz: null });
    await call(h);
    expect(decision(h.lines)).toContain('decision=offer-latest');
    expect(decision(h.lines)).toMatch(/reason=force-pending-/);
  });
});
