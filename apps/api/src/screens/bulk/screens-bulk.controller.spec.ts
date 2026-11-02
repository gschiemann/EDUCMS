/**
 * BULK SCREEN ACTIONS (2026-10-11) — select-all / select-group and push.
 *
 * What this pins:
 *   1. AUTHORIZATION PER SCREEN. Another tenant's screen id comes back
 *      `skipped: not-found` and is never touched (no publish, no write, no
 *      audit row on it); a group from another tenant is a 404; a screen-scoped
 *      person is refused by the interceptor for an out-of-scope id and, without
 *      the interceptor, filtered per screen by the controller.
 *   2. THE SINGLE-SCREEN COMMAND IS REUSED. Resync publishes the same signed
 *      REFRESH_WEB (scope 'screen') the per-screen endpoint publishes and rides
 *      the same durable `pendingRefreshAt` — ONE deployment, one value.
 *   3. AUDIT: one row per screen + one BULK_SCREEN_ACTION summary row. A dry
 *      run writes nothing at all.
 *   4. SKIPS CARRY A REASON (already-current, no-player-app, unchanged,
 *      emergency-hold, unsupported) and failures are named, never silent.
 *   5. THE CAP: more than 500 screens is a 400 before any database read.
 */
import { ForbiddenException, HttpException } from '@nestjs/common';
import { ScreensBulkController } from './screens-bulk.controller';
import {
  BULK_MAX_SCREENS,
  bulkHardwareRefusal,
  bulkOffHoursRefusal,
  mapWithConcurrency,
  parseMassPushOverride,
  playerIsCurrent,
  updateDecision,
  parseBulkTargets,
} from './bulk-screen-actions';
import { evaluateHardwareClasses, evaluateOffHours } from '../../player-ota/fleet-push-policy';
import { DisplayActionUnsupportedError } from '../../display/display.service';
import { UserScopeInterceptor } from '../../user-scope/user-scope.interceptor';
import { decideScopedRoute } from '../../user-scope/user-scope.policy';

jest.mock('../../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const A = 'tenant-a';
const B = 'tenant-b';

interface Row {
  id: string; name: string; tenantId: string; screenGroupId: string | null;
  playerVersion: string | null; playerVersionCode: number | null;
  autoUpdatePlayerOverride: boolean | null; displayCapabilities: unknown;
  lastPushConnectedAt: Date | null; pendingRefreshAt?: Date | null;
  // What the fleet push rules read (player-ota/fleet-push-policy.ts).
  hardwareModel?: string | null; lastVideoReport?: unknown; timezone?: string | null;
  deviceTimeZone?: string | null; latitude?: number | null; longitude?: number | null;
  tenant?: { timezone?: string | null } | null;
}

// (2026-10-31) The fixture screens are ONE known hardware class with a known
// zone: a Player update to more than one screen must be (fleet-push-policy.ts).
const screen = (id: string, over: Partial<Row> = {}): Row => ({
  id, name: `Screen ${id}`, tenantId: A, screenGroupId: 'g-lobby',
  playerVersion: '1.1.20', playerVersionCode: 10120, autoUpdatePlayerOverride: null,
  displayCapabilities: null, lastPushConnectedAt: new Date(), pendingRefreshAt: null,
  hardwareModel: 'goodview-ep6n', timezone: 'America/Chicago',
  ...over,
});

/** Fake only the clock (promises, timers and I/O stay real). */
const freezeClock = (at: number) => {
  jest.useFakeTimers({
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  jest.setSystemTime(at);
};
/** 03:00 and 12:00 in Chicago (CDT) on 2026-10-31. */
const CHICAGO_NIGHT = Date.UTC(2026, 9, 31, 8, 0);
const CHICAGO_NOON = Date.UTC(2026, 9, 31, 17, 0);

/** Tiny in-memory prisma that evaluates the `where` shapes this controller uses. */
function fakePrisma(rows: Row[], groups = [{ id: 'g-lobby', tenantId: A }, { id: 'g-foreign', tenantId: B }]) {
  const touched: Array<{ op: string; id: string; tenantId?: string }> = [];
  const match = (r: any, where: any) => {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === 'object' && 'in' in (v as any)) { if (!(v as any).in.includes(r[k])) return false; }
      else if (r[k] !== v) return false;
    }
    return true;
  };
  const client: any = {
    screen: {
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => match(r, where)).map((r) => ({ ...r }))),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => match(x, where));
        if (!r) throw new Error('not found');
        touched.push({ op: 'update', id: r.id, tenantId: r.tenantId });
        Object.assign(r, data);
        return r;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = rows.filter((x) => match(x, where));
        hit.forEach((r) => { touched.push({ op: 'updateMany', id: r.id, tenantId: r.tenantId }); Object.assign(r, data); });
        return { count: hit.length };
      }),
    },
    screenGroup: { findFirst: jest.fn(async ({ where }: any) => groups.find((g) => match(g, where)) ?? null) },
    screenDeviceInventory: { findMany: jest.fn(async () => []) },
    deployment: { create: jest.fn(async () => ({})) },
    screenEvent: { createMany: jest.fn(async () => ({ count: 0 })) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  return { prisma: { client } as any, touched };
}

function harness(rows: Row[], opts: { latest?: string | null; display?: any } = {}) {
  const { prisma, touched } = fakePrisma(rows);
  const redis: any = { publish: jest.fn(async () => undefined) };
  const signer: any = { signMessage: jest.fn((type: string, payload: any) => ({ type, payload, signature: 'sig' })) };
  const display: any = opts.display ?? {
    applyAction: jest.fn(async (o: any) => ({ success: true, action: o.action, delivered: true, deliveryReason: null })),
  };
  class TestController extends ScreensBulkController {
    protected async latestPlayerVersion() { return opts.latest === undefined ? '1.1.21' : opts.latest; }
  }
  const c = new TestController(prisma, redis, signer, display);
  return { c, prisma, touched, redis, signer, display };
}

const admin = (tenantId = A, extra: Record<string, unknown> = {}) => ({ user: { id: 'u1', userId: 'u1', tenantId, role: 'SCHOOL_ADMIN', ...extra } }) as any;
const audits = (prisma: any) => prisma.client.auditLog.create.mock.calls.map((c: any) => c[0].data);

describe('bulk resync', () => {
  it('reuses the per-screen REFRESH_WEB, rides ONE durable deployment, and audits each screen + one summary', async () => {
    const rows = [screen('s1'), screen('s2'), screen('s3', { screenGroupId: null })];
    const h = harness(rows);
    const out = await h.c.resync(admin(), { screenIds: ['s1', 's2', 's3'] });

    expect(out.summary).toEqual({ requested: 3, sent: 3, skipped: 0, failed: 0 });
    // Same signed message the single-screen endpoint sends — scope 'screen'.
    const msgs = h.signer.signMessage.mock.calls.filter((c: any) => c[0] === 'REFRESH_WEB');
    expect(msgs.map((c: any) => c[1].scopeId)).toEqual(['s1', 's2', 's3']);
    expect(msgs.every((c: any) => c[1].scope === 'screen' && c[1].tenantId === A && c[1].corrId === out.corrId)).toBe(true);
    expect(msgs[0][1].jitterMs).toBe(8000); // many screens → spread the reload
    expect(h.redis.publish).toHaveBeenCalledWith(`tenant:${A}`, expect.anything());

    // Durable: ONE deployment, every target stamped with the SAME value.
    expect(h.prisma.client.deployment.create).toHaveBeenCalledTimes(1);
    const dep = h.prisma.client.deployment.create.mock.calls[0][0].data;
    expect(dep.targetIds).toEqual(['s1', 's2', 's3']);
    expect(rows.every((r) => r.pendingRefreshAt?.getTime() === dep.value.getTime())).toBe(true);
    expect(rows.every((r) => (r as any).pendingRefreshSource === 'operator')).toBe(true);

    const a = audits(h.prisma);
    expect(a.filter((x: any) => x.action === 'REFRESH_WEB').map((x: any) => x.targetId)).toEqual(['s1', 's2', 's3']);
    const summary = a.filter((x: any) => x.action === 'BULK_SCREEN_ACTION');
    expect(summary).toHaveLength(1);
    expect(JSON.parse(summary[0].details)).toMatchObject({ action: 'resync', sent: 3, requested: 3 });
  });

  it("another tenant's screen id is skipped as not-found and never touched", async () => {
    const rows = [screen('s1'), screen('foreign', { tenantId: B, screenGroupId: 'g-foreign' })];
    const h = harness(rows);
    const out = await h.c.resync(admin(), { screenIds: ['s1', 'foreign'] });

    expect(out.results).toEqual([
      expect.objectContaining({ screenId: 's1', outcome: 'sent' }),
      expect.objectContaining({ screenId: 'foreign', outcome: 'skipped', reason: 'not-found', name: null }),
    ]);
    expect(h.touched.filter((t) => t.tenantId === B)).toEqual([]);
    expect(rows[1].pendingRefreshAt).toBeNull();
    expect(h.signer.signMessage.mock.calls.some((c: any) => c[1].scopeId === 'foreign')).toBe(false);
    expect(audits(h.prisma).some((x: any) => x.targetId === 'foreign' && x.action !== 'BULK_SCREEN_ACTION')).toBe(false);
  });

  it('a group from another tenant is a 404; a group in this tenant expands to its screens', async () => {
    const rows = [screen('s1'), screen('s2'), screen('s3', { screenGroupId: 'g-other' })];
    const h = harness(rows);
    await expect(h.c.resync(admin(), { screenGroupId: 'g-foreign' })).rejects.toMatchObject({ status: 404 });
    const out = await h.c.resync(admin(), { screenGroupId: 'g-lobby' });
    expect(out.results.map((r) => r.screenId).sort()).toEqual(['s1', 's2']);
    expect(JSON.parse(audits(h.prisma).find((x: any) => x.action === 'BULK_SCREEN_ACTION').details).screenGroupId).toBe('g-lobby');
  });

  it('a screen-scoped person: the controller filters out-of-scope ids per screen', async () => {
    const h = harness([screen('s1'), screen('s2')]);
    const req = admin();
    req.userScope = { screenIds: ['s1'], groupIds: [] };
    const out = await h.c.resync(req, { screenIds: ['s1', 's2'] });
    expect(out.results).toEqual([
      expect.objectContaining({ screenId: 's1', outcome: 'sent' }),
      expect.objectContaining({ screenId: 's2', outcome: 'skipped', reason: 'out-of-scope' }),
    ]);
    expect(h.signer.signMessage.mock.calls.some((c: any) => c[1].scopeId === 's2')).toBe(false);
  });

  it('a dry run sends and writes nothing', async () => {
    const h = harness([screen('s1'), screen('s2')]);
    const out = await h.c.resync(admin(), { screenIds: ['s1', 's2'], dryRun: true });
    expect(out.dryRun).toBe(true);
    expect(out.corrId).toBeNull();
    expect(out.summary.sent).toBe(2);
    expect(h.signer.signMessage).not.toHaveBeenCalled();
    expect(h.redis.publish).not.toHaveBeenCalled();
    expect(h.prisma.client.deployment.create).not.toHaveBeenCalled();
    expect(h.prisma.client.auditLog.create).not.toHaveBeenCalled();
  });

  it('a screen neither path reached is FAILED, never reported as sent', async () => {
    const h = harness([screen('s1')]);
    h.redis.publish.mockRejectedValue(new Error('redis down'));
    h.prisma.client.screen.updateMany.mockRejectedValue(new Error('db down'));
    const out = await h.c.resync(admin(), { screenIds: ['s1'] });
    expect(out.results[0]).toMatchObject({ outcome: 'failed', reason: 'not-delivered' });
  });

  it('refuses more than the cap before any database read', async () => {
    const h = harness([]);
    const ids = Array.from({ length: BULK_MAX_SCREENS + 1 }, (_, i) => `s${i}`);
    await expect(h.c.resync(admin(), { screenIds: ids })).rejects.toMatchObject({ status: 400 });
    expect(h.prisma.client.screen.findMany).not.toHaveBeenCalled();
    await expect(h.c.resync(admin(), {})).rejects.toBeInstanceOf(HttpException);
  });
});

describe('bulk update (Send Player update)', () => {
  // (2026-10-31) An update to more than one screen goes out only 22:00–06:00 in
  // every screen's own zone (fleet-push-policy.ts): run these at 03:00 Chicago.
  beforeEach(() => freezeClock(CHICAGO_NIGHT));
  afterEach(() => jest.useRealTimers());

  it('sends only to screens behind the latest Player, skips the rest with a reason, flags install prompts', async () => {
    const rows = [
      screen('old', { playerVersion: '1.1.19', playerVersionCode: 10119 }),
      screen('current', { playerVersion: '1.1.21', playerVersionCode: 10121 }),
      screen('browser', { playerVersion: null, playerVersionCode: null }),
      screen('silent', { playerVersion: '1.1.20', playerVersionCode: 10120 }),
    ];
    const h = harness(rows, { latest: '1.1.21' });
    h.prisma.client.screenDeviceInventory.findMany.mockResolvedValue([
      { screenId: 'silent', report: { app: { silentUpdateArmed: true, versionCode: 10120 } } },
    ]);

    const plan = await h.c.update(admin(), { screenIds: ['old', 'current', 'browser', 'silent'], dryRun: true });
    expect(plan.latestPlayerVersion).toBe('1.1.21');
    expect(plan.summary).toEqual({ requested: 4, sent: 2, skipped: 2, failed: 0 });
    expect(h.prisma.client.screen.update).not.toHaveBeenCalled();

    const out = await h.c.update(admin(), { screenIds: ['old', 'current', 'browser', 'silent'] });
    const by = Object.fromEntries(out.results.map((r) => [r.screenId, r]));
    expect(by.old).toMatchObject({ outcome: 'sent', installPrompt: true });
    expect(by.silent).toMatchObject({ outcome: 'sent', installPrompt: false });
    expect(by.current).toMatchObject({ outcome: 'skipped', reason: 'already-current' });
    expect(by.browser).toMatchObject({ outcome: 'skipped', reason: 'no-player-app' });

    // The single-screen command: force flag armed with the tenant in the where,
    // CHECK_FOR_UPDATES scoped to the screen.
    const writes = h.prisma.client.screen.update.mock.calls.map((c: any) => c[0].where);
    expect(writes).toEqual(expect.arrayContaining([{ id: 'old', tenantId: A }, { id: 'silent', tenantId: A }]));
    expect(writes).toHaveLength(2);
    expect(rows[0] as any).toMatchObject({ forceApkUpdateOverrideWindow: false, lastOtaErrorAt: null });
    const checks = h.signer.signMessage.mock.calls.filter((c: any) => c[0] === 'CHECK_FOR_UPDATES').map((c: any) => c[1].scopeId);
    expect(checks.sort()).toEqual(['old', 'silent']);
    const a = audits(h.prisma);
    expect(a.filter((x: any) => x.action === 'FORCE_APK_UPDATE').map((x: any) => x.targetId).sort()).toEqual(['old', 'silent']);
    expect(a.filter((x: any) => x.action === 'BULK_SCREEN_ACTION')).toHaveLength(1);
  });

  it('latest version unknown → the operator asked, so it is sent (the screen decides)', async () => {
    const h = harness([screen('s1')], { latest: null });
    const out = await h.c.update(admin(), { screenIds: ['s1'] });
    expect(out.results[0].outcome).toBe('sent');
  });
});

describe('bulk power', () => {
  it('runs the single-screen display control per screen; emergency hold and unsupported hardware are named skips', async () => {
    const display = {
      applyAction: jest.fn(async (o: any) => {
        if (o.screenId === 'held') throw new DisplayActionUnsupportedError('DISPLAY_EMERGENCY_HOLD', 'An emergency alert is active', {});
        if (o.screenId === 'nope') throw new DisplayActionUnsupportedError('DISPLAY_POWER_OFF_UNSUPPORTED', 'cannot', {});
        if (o.screenId === 'poll') return { success: true, delivered: false, deliveryReason: 'no_push_socket' };
        return { success: true, delivered: true, deliveryReason: null };
      }),
    };
    const h = harness([screen('ok'), screen('held'), screen('nope'), screen('poll')], { display });
    // The hold lookup reads emergency state; no emergency in this fake.
    h.prisma.client.tenant = { findFirst: jest.fn(async () => ({ emergencyStatus: null })), findUnique: jest.fn(async () => ({ emergencyStatus: null })) };
    h.prisma.client.screenEmergencyOverride = { findFirst: jest.fn(async () => null) };
    const out = await h.c.power(admin(), { screenIds: ['ok', 'held', 'nope', 'poll'], state: 'on' });
    const by = Object.fromEntries(out.results.map((r) => [r.screenId, r]));
    expect(display.applyAction).toHaveBeenCalledTimes(4);
    expect(display.applyAction.mock.calls.every((c: any) => c[0].action === 'POWER_ON' && c[0].tenantId === A)).toBe(true);
    expect(by.ok.outcome).toBe('sent');
    expect(by.held).toMatchObject({ outcome: 'skipped', reason: 'emergency-hold' });
    expect(by.nope).toMatchObject({ outcome: 'skipped', reason: 'unsupported' });
    expect(by.poll).toMatchObject({ outcome: 'failed', reason: 'no-live-connection' });
  });

  it('rejects a missing state', async () => {
    const h = harness([screen('s1')]);
    await expect(h.c.power(admin(), { screenIds: ['s1'] })).rejects.toMatchObject({ status: 400 });
  });
});

describe('bulk auto-update', () => {
  it('sets the per-screen override through the single-screen function; unchanged screens are skipped', async () => {
    const rows = [screen('s1', { autoUpdatePlayerOverride: null }), screen('s2', { autoUpdatePlayerOverride: true })];
    const h = harness(rows);
    const out = await h.c.autoUpdate(admin(), { screenIds: ['s1', 's2'], mode: 'on' });
    expect(out.results).toEqual([
      expect.objectContaining({ screenId: 's1', outcome: 'sent' }),
      expect.objectContaining({ screenId: 's2', outcome: 'skipped', reason: 'unchanged' }),
    ]);
    expect(rows[0].autoUpdatePlayerOverride).toBe(true);
    const a = audits(h.prisma).filter((x: any) => x.action === 'SCREEN_AUTO_UPDATE_SET');
    expect(a).toHaveLength(1);
    expect(JSON.parse(a[0].details)).toMatchObject({ from: 'inherit', to: 'on', bulk: true });
  });

  it('rejects an unknown mode', async () => {
    const h = harness([screen('s1')]);
    await expect(h.c.autoUpdate(admin(), { screenIds: ['s1'], mode: 'sometimes' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('user-scope interceptor on the bulk routes', () => {
  const interceptor = (scope: { screenIds: string[]; groupIds: string[] }) =>
    new UserScopeInterceptor({ resolve: async () => ({ allowed: true, screenScope: scope }), logFailure: () => undefined } as any, {} as any);
  const call = (i: UserScopeInterceptor, body: unknown) =>
    i.decide({ method: 'POST', originalUrl: '/api/v1/screens/bulk/resync', body } as any, 'u1', A);

  it('the policy decides the bulk routes by their body targets', () => {
    for (const a of ['resync', 'update', 'power', 'auto-update']) {
      expect(decideScopedRoute('POST', `/api/v1/screens/bulk/${a}`).check).toEqual({ kind: 'body', requireTarget: true });
    }
  });

  it('refuses a screen-scoped person who names a screen or group outside their scope, or nothing at all', async () => {
    const i = interceptor({ screenIds: ['s1'], groupIds: ['g1'] });
    await expect(call(i, { screenIds: ['s1'] })).resolves.toBeUndefined();
    await expect(call(i, { screenGroupId: 'g1' })).resolves.toBeUndefined();
    await expect(call(i, { screenIds: ['s1', 's2'] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(call(i, { screenGroupId: 'g2' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(call(i, {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('bulk helpers', () => {
  it('playerIsCurrent compares numerically and treats missing as unknown', () => {
    expect(playerIsCurrent('1.1.11', '1.1.9')).toBe(true);
    expect(playerIsCurrent('v1.1.9', '1.1.11')).toBe(false);
    expect(playerIsCurrent(null, '1.1.11')).toBeNull();
    expect(updateDecision('1.1.21', '1.1.21')).toEqual({ send: false, reason: 'already-current' });
    expect(updateDecision(null, '1.1.21')).toEqual({ send: false, reason: 'no-player-app' });
  });

  it('parseBulkTargets de-duplicates and validates', () => {
    expect(parseBulkTargets({ screenIds: ['a', 'a', ' b '] }).screenIds).toEqual(['a', 'b']);
    expect(() => parseBulkTargets({ screenIds: 'a' as any })).toThrow();
    expect(() => parseBulkTargets({ screenIds: [5] as any })).toThrow();
  });

  it('mapWithConcurrency keeps order and never exceeds the limit', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      live += 1; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
});

/**
 * 2026-10-31 — the owner's fleet push rules on "Send Player update"
 * (player-ota/fleet-push-policy.ts): an update to more than one screen must be
 * one hardware class and go out 22:00–06:00 in every screen's own time zone,
 * unless the request carries the explicit `overrideMassPushRules: true`, which
 * every FORCE_APK_UPDATE row and the summary row record.
 */
describe('bulk update — the owner’s fleet push rules', () => {
  beforeEach(() => freezeClock(CHICAGO_NIGHT));
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  /** A screen behind the latest Player (1.1.21), so the update would reach it. */
  const stale = (id: string, over: Partial<Row> = {}) => screen(id, { playerVersion: '1.1.19', playerVersionCode: 10119, ...over });
  const refusalOf = async (p: Promise<unknown>): Promise<{ status: number; body: any }> => {
    try {
      await p;
    } catch (e) {
      if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() };
      throw e;
    }
    throw new Error('expected a refusal');
  };
  const nothingSent = (h: ReturnType<typeof harness>) => {
    expect(h.prisma.client.screen.update).not.toHaveBeenCalled();
    expect(h.signer.signMessage).not.toHaveBeenCalled();
    expect(h.redis.publish).not.toHaveBeenCalled();
    expect(h.prisma.client.auditLog.create).not.toHaveBeenCalled();
  };
  const report = (cls: string) => ({ native: { device: { class: cls } } });

  it('two hardware classes are refused (422), naming them — the dry run says so first; nothing is sent', async () => {
    const h = harness([stale('a'), stale('b', { hardwareModel: 'maxhub-l55vec' })]);
    for (const dryRun of [true, false]) {
      expect(await refusalOf(h.c.update(admin(), { screenIds: ['a', 'b'], dryRun }))).toMatchObject({
        status: 422,
        body: { code: 'BULK_UPDATE_MIXED_HARDWARE', classes: ['goodview-ep6n', 'maxhub-l55vec'] },
      });
    }
    nothingSent(h);
  });

  it('THE 2026-10-12 SHAPE: a GUQ panel and an rk3288 unit, both generic-android, are two classes', async () => {
    const h = harness([
      stale('guq', { hardwareModel: 'generic-android', lastVideoReport: report('amlogic/android-13') }),
      stale('dh43', { hardwareModel: 'generic-android', lastVideoReport: report('rockchip/android-7') }),
    ]);
    expect(await refusalOf(h.c.update(admin(), { screenIds: ['guq', 'dh43'] }))).toMatchObject({
      status: 422,
      body: { code: 'BULK_UPDATE_MIXED_HARDWARE', classes: ['generic-android (amlogic/android-13)', 'generic-android (rockchip/android-7)'] },
    });
    nothingSent(h);
  });

  it('a screen of unknown hardware cannot be shown to be one class with the others (422, named)', async () => {
    const h = harness([stale('a'), stale('b', { name: 'Gym', hardwareModel: null })]);
    expect(await refusalOf(h.c.update(admin(), { screenIds: ['a', 'b'] }))).toMatchObject({
      status: 422,
      body: { code: 'BULK_UPDATE_HARDWARE_UNKNOWN', unknownScreens: [{ id: 'b', name: 'Gym' }] },
    });
    nothingSent(h);
  });

  it('daytime in a screen’s own zone is refused (409), naming the screens and their local time', async () => {
    freezeClock(CHICAGO_NOON);
    const h = harness([stale('a'), stale('b')]);
    expect(await refusalOf(h.c.update(admin(), { screenIds: ['a', 'b'] }))).toMatchObject({
      status: 409,
      body: {
        code: 'BULK_UPDATE_OUTSIDE_OFF_HOURS',
        offHours: { start: '22:00', end: '06:00' },
        screens: [
          { id: 'a', timeZone: 'America/Chicago', localTime: '12:00' },
          { id: 'b', timeZone: 'America/Chicago', localTime: '12:00' },
        ],
      },
    });
    nothingSent(h);
  });

  it('a screen with no time zone refuses it (422) — the device’s own zone is never used', async () => {
    const h = harness([stale('a'), stale('b', { name: 'Gym', timezone: null, deviceTimeZone: 'America/Chicago' })]);
    expect(await refusalOf(h.c.update(admin(), { screenIds: ['a', 'b'] }))).toMatchObject({
      status: 422,
      body: { code: 'BULK_UPDATE_TIME_ZONE_UNKNOWN', screens: [{ id: 'b', name: 'Gym' }] },
    });
    nothingSent(h);
  });

  it('the zone is the screen’s effective one: its location’s setting, or automatic from its coordinates', async () => {
    const h = harness([
      stale('a', { timezone: null, tenant: { timezone: 'America/Chicago' } }),
      stale('b', { timezone: null, latitude: 41.8781, longitude: -87.6298 }),
    ]);
    expect((await h.c.update(admin(), { screenIds: ['a', 'b'] })).summary).toMatchObject({ sent: 2, failed: 0 });
  });

  it('only the screens the update would reach count: an already-current screen of another kind is skipped, not a mix', async () => {
    freezeClock(CHICAGO_NOON);
    const h = harness([stale('a'), screen('cur', { hardwareModel: 'maxhub-l55vec', playerVersion: '1.1.21', playerVersionCode: 10121 })]);
    const out = await h.c.update(admin(), { screenIds: ['a', 'cur'] });
    expect(out.results).toEqual([
      expect.objectContaining({ screenId: 'a', outcome: 'sent' }),
      expect.objectContaining({ screenId: 'cur', outcome: 'skipped', reason: 'already-current' }),
    ]);
  });

  it('ONE screen is exempt from both rules — any hour, no zone, unknown hardware', async () => {
    freezeClock(CHICAGO_NOON);
    const h = harness([stale('a', { hardwareModel: null, timezone: null })]);
    expect((await h.c.update(admin(), { screenIds: ['a'] })).results[0]).toMatchObject({ outcome: 'sent' });
  });

  it('the explicit override sends it, and every FORCE_APK_UPDATE row and the summary record what it set aside', async () => {
    freezeClock(CHICAGO_NOON);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness([stale('a'), stale('b', { hardwareModel: 'maxhub-l55vec' })]);
    const out = await h.c.update(admin(), { screenIds: ['a', 'b'], overrideMassPushRules: true });
    expect(out.summary).toMatchObject({ sent: 2, failed: 0 });
    const rows = audits(h.prisma);
    const pushes = rows.filter((x: any) => x.action === 'FORCE_APK_UPDATE');
    expect(pushes.map((x: any) => x.targetId).sort()).toEqual(['a', 'b']);
    const summary = rows.filter((x: any) => x.action === 'BULK_SCREEN_ACTION');
    expect(summary).toHaveLength(1);
    for (const x of [...pushes, ...summary]) {
      expect(JSON.parse(x.details)).toMatchObject({ overrideMassPushRules: true, massPushRulesOverridden: ['hardware-class', 'off-hours'] });
    }
    expect(warn.mock.calls.some((c) => String(c[0]).includes('mass-push rules OVERRIDDEN (hardware-class, off-hours)'))).toBe(true);
  });

  it('a compliant update records that no override was needed; a malformed override is a 400 before any database read', async () => {
    const h = harness([stale('a'), stale('b')]);
    await h.c.update(admin(), { screenIds: ['a', 'b'] });
    const rows = audits(h.prisma).filter((x: any) => x.action === 'FORCE_APK_UPDATE' || x.action === 'BULK_SCREEN_ACTION');
    expect(rows).toHaveLength(3);
    for (const x of rows) expect(JSON.parse(x.details)).toMatchObject({ overrideMassPushRules: false, massPushRulesOverridden: [] });
    const h2 = harness([stale('a'), stale('b')]);
    expect(await refusalOf(h2.c.update(admin(), { screenIds: ['a', 'b'], overrideMassPushRules: 'yes' } as any))).toMatchObject({
      status: 400,
      body: { code: 'BULK_MASS_PUSH_OVERRIDE_INVALID' },
    });
    expect(h2.prisma.client.screen.findMany).not.toHaveBeenCalled();
  });

  it('resync and automatic-update settings are not OTA pushes: the rules do not touch them', async () => {
    freezeClock(CHICAGO_NOON);
    const rows = [screen('a', { hardwareModel: null, timezone: null }), screen('b', { hardwareModel: 'maxhub-l55vec' })];
    const h = harness(rows);
    expect((await h.c.resync(admin(), { screenIds: ['a', 'b'] })).summary).toMatchObject({ sent: 2 });
    expect((await h.c.autoUpdate(admin(), { screenIds: ['a', 'b'], mode: 'on' })).summary).toMatchObject({ sent: 2 });
  });

  it('the refusals’ words (the dashboard words each code in en / es / zh)', () => {
    expect(parseMassPushOverride({})).toBe(false);
    expect(parseMassPushOverride({ overrideMassPushRules: true })).toBe(true);
    expect(() => parseMassPushOverride({ overrideMassPushRules: 1 })).toThrow('overrideMassPushRules must be true or false.');
    const mixed = bulkHardwareRefusal(evaluateHardwareClasses([
      { id: 'a', hardwareModel: 'goodview-ep6n' },
      { id: 'b', hardwareModel: 'pi5' },
    ]));
    expect(mixed).toMatchObject({ status: 422, code: 'BULK_UPDATE_MIXED_HARDWARE' });
    expect(mixed.message).toBe('These screens are more than one kind of hardware: goodview-ep6n, pi5. Send the update to one kind at a time.');
    const night = new Date(CHICAGO_NIGHT);
    const outside = bulkOffHoursRefusal(evaluateOffHours([
      { id: 'a', name: 'Lobby', timeZone: 'America/Chicago' },
      { id: 'b', name: 'Gym', timeZone: 'Asia/Tokyo' },
    ], night));
    expect(outside).toMatchObject({ status: 409, code: 'BULK_UPDATE_OUTSIDE_OFF_HOURS' });
    expect(outside.message).toBe(
      "An update to more than one screen goes out only between 22:00 and 06:00 in each screen's own time zone. " +
        'It is 17:00 at Gym (Asia/Tokyo). Send it to one screen at a time, or wait.',
    );
    const noZone = bulkOffHoursRefusal(evaluateOffHours([{ id: 'a', name: 'Lobby', timeZone: null }, { id: 'b', timeZone: 'America/Chicago' }], night));
    expect(noZone).toMatchObject({ status: 422, code: 'BULK_UPDATE_TIME_ZONE_UNKNOWN' });
    expect(noZone.message).toMatch(/^Lobby has no time zone, .*Set its time zone, or send the update to it on its own\.$/);
  });
});
