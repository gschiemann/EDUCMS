/**
 * POST /screens/force-update — "update EVERY screen of the location" in one
 * write — under the owner's fleet push rules (2026-10-31; update-push-rules.ts
 * → player-ota/fleet-push-policy.ts). The rules read exactly the screens the
 * route marks (every screen of the tenant): one hardware class, 22:00–06:00 in
 * every screen's own time zone, unless the explicit `overrideMassPushRules`
 * is on the request — which the route's audit row then records. A refusal
 * marks, publishes and audits nothing. Same codes as the bulk route.
 */
jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import { HttpException } from '@nestjs/common';
import { ScreensController } from './screens.controller';
import { UPDATE_RULES_READ_CAP } from './update-push-rules';

const T = 'tenant-1';
/** 03:00 and 12:00 in Chicago (CDT) on 2026-10-31. */
const CHICAGO_NIGHT = Date.UTC(2026, 9, 31, 8, 0);
const CHICAGO_NOON = Date.UTC(2026, 9, 31, 17, 0);

const freezeClock = (at: number) => {
  jest.useFakeTimers({
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  jest.setSystemTime(at);
};

type Row = Record<string, unknown> & { id: string; tenantId: string };
const row = (id: string, over: Record<string, unknown> = {}): Row => ({
  id,
  name: `Screen ${id}`,
  tenantId: T,
  hardwareModel: 'goodview-ep6n',
  lastVideoReport: null,
  timezone: 'America/Chicago',
  latitude: null,
  longitude: null,
  screenGroup: null,
  tenant: null,
  ...over,
});
const report = (cls: string) => ({ native: { device: { class: cls } } });

function harness(rows: Row[]) {
  const prisma: any = {
    client: {
      screen: {
        // The tenant's own screens, at most `take` — the read the rules make.
        findMany: jest.fn(async (args: any) =>
          rows.filter((r) => r.tenantId === args?.where?.tenantId).slice(0, args?.take ?? Infinity),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: rows.length }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    },
  };
  const redis: any = { publish: jest.fn().mockResolvedValue(1), sismember: jest.fn().mockResolvedValue(false) };
  const signer: any = { signMessage: jest.fn(() => 'signed') };
  const controller = new ScreensController(prisma, redis, signer, {} as any, { syncSubscriptionQuantity: jest.fn() } as any, {} as any);
  return { controller, prisma, redis, signer };
}
const adminReq = () => ({ user: { tenantId: T, role: 'SCHOOL_ADMIN', id: 'u1', userId: 'u1' } }) as any;
const auditDetails = (prisma: any) =>
  prisma.client.auditLog.create.mock.calls.map((c: any) => c[0].data).filter((d: any) => d.action === 'FORCE_APK_UPDATE').map((d: any) => JSON.parse(d.details));

async function refusalOf(p: Promise<unknown>): Promise<{ status: number; body: any }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() };
    throw e;
  }
  throw new Error('expected a refusal');
}
const nothingMarked = (h: ReturnType<typeof harness>) => {
  expect(h.prisma.client.screen.updateMany).not.toHaveBeenCalled();
  expect(h.signer.signMessage).not.toHaveBeenCalled();
  expect(h.redis.publish).not.toHaveBeenCalled();
  expect(h.prisma.client.auditLog.create).not.toHaveBeenCalled();
};

beforeEach(() => freezeClock(CHICAGO_NIGHT));
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('POST /screens/force-update — every screen of the location, under the fleet push rules', () => {
  it('one class at night: marks them all, exactly as before, and the audit row says no override was needed', async () => {
    const h = harness([row('a'), row('b'), row('elsewhere', { tenantId: 'tenant-2', hardwareModel: 'pi5' })]);
    expect(await h.controller.forceUpdateAll(adminReq())).toEqual({ ok: true, scope: 'tenant' });
    // The rules read exactly the screens the write marks: every screen of THIS tenant.
    expect(h.prisma.client.screen.findMany.mock.calls[0][0].where).toEqual({ tenantId: T });
    expect(h.prisma.client.screen.updateMany.mock.calls[0][0].where).toEqual({ tenantId: T });
    expect(h.signer.signMessage).toHaveBeenCalledWith('CHECK_FOR_UPDATES', expect.objectContaining({ scope: 'tenant', scopeId: T }));
    expect(h.redis.publish).toHaveBeenCalledWith(`tenant:${T}`, 'signed');
    expect(auditDetails(h.prisma)).toEqual([{ scope: 'tenant', overrideMassPushRules: false, massPushRulesOverridden: [] }]);
  });

  it('two hardware classes are refused (422), naming them; nothing is marked, sent or audited', async () => {
    const h = harness([row('a'), row('b', { hardwareModel: 'maxhub-l55vec' })]);
    expect(await refusalOf(h.controller.forceUpdateAll(adminReq()))).toMatchObject({
      status: 422,
      body: { code: 'BULK_UPDATE_MIXED_HARDWARE', classes: ['goodview-ep6n', 'maxhub-l55vec'] },
    });
    nothingMarked(h);
  });

  it('THE 2026-10-12 SHAPE: a GUQ panel and an rk3288 unit, both generic-android, are two classes', async () => {
    const h = harness([
      row('guq', { hardwareModel: 'generic-android', lastVideoReport: report('amlogic/android-13') }),
      row('dh43', { hardwareModel: 'generic-android', lastVideoReport: report('rockchip/android-7') }),
    ]);
    expect(await refusalOf(h.controller.forceUpdateAll(adminReq()))).toMatchObject({
      status: 422,
      body: { code: 'BULK_UPDATE_MIXED_HARDWARE', classes: ['generic-android (amlogic/android-13)', 'generic-android (rockchip/android-7)'] },
    });
    nothingMarked(h);
  });

  it('a screen of unknown hardware cannot be shown to be one class with the others (422, named)', async () => {
    const h = harness([row('a'), row('b', { name: 'Gym', hardwareModel: null })]);
    expect(await refusalOf(h.controller.forceUpdateAll(adminReq()))).toMatchObject({
      status: 422,
      body: { code: 'BULK_UPDATE_HARDWARE_UNKNOWN', unknownScreens: [{ id: 'b', name: 'Gym' }] },
    });
    nothingMarked(h);
  });

  it('daytime in a screen’s own zone is refused (409); a screen with no zone is refused (422) — never the device’s zone', async () => {
    freezeClock(CHICAGO_NOON);
    const day = harness([row('a'), row('b')]);
    expect(await refusalOf(day.controller.forceUpdateAll(adminReq()))).toMatchObject({
      status: 409,
      body: { code: 'BULK_UPDATE_OUTSIDE_OFF_HOURS', screens: [{ id: 'a', localTime: '12:00' }, { id: 'b', localTime: '12:00' }] },
    });
    nothingMarked(day);
    freezeClock(CHICAGO_NIGHT);
    const noZone = harness([row('a'), row('b', { name: 'Gym', timezone: null, deviceTimeZone: 'America/Chicago' })]);
    expect(await refusalOf(noZone.controller.forceUpdateAll(adminReq()))).toMatchObject({
      status: 422,
      body: { code: 'BULK_UPDATE_TIME_ZONE_UNKNOWN', screens: [{ id: 'b', name: 'Gym' }] },
    });
    nothingMarked(noZone);
  });

  it('a location of one screen (or none) is exempt — any hour, any hardware', async () => {
    freezeClock(CHICAGO_NOON);
    for (const rows of [[row('a', { hardwareModel: null, timezone: null })], []]) {
      const h = harness(rows);
      expect(await h.controller.forceUpdateAll(adminReq())).toEqual({ ok: true, scope: 'tenant' });
      expect(h.prisma.client.screen.updateMany).toHaveBeenCalledTimes(1);
    }
  });

  it('more screens than can be read at once cannot be shown to be one class (422)', async () => {
    const many = Array.from({ length: UPDATE_RULES_READ_CAP + 1 }, (_, i) => row(`s${i}`));
    const h = harness(many);
    expect(await refusalOf(h.controller.forceUpdateAll(adminReq()))).toMatchObject({
      status: 422,
      body: { code: 'BULK_UPDATE_HARDWARE_UNKNOWN', incomplete: true },
    });
    expect(h.prisma.client.screen.findMany.mock.calls[0][0].take).toBe(UPDATE_RULES_READ_CAP + 1);
    nothingMarked(h);
  });

  it('the explicit override marks them anyway, and the audit row records the rules it set aside', async () => {
    freezeClock(CHICAGO_NOON);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness([row('a'), row('b', { hardwareModel: 'maxhub-l55vec' })]);
    expect(await h.controller.forceUpdateAll(adminReq(), { overrideMassPushRules: true })).toEqual({ ok: true, scope: 'tenant' });
    expect(h.prisma.client.screen.updateMany).toHaveBeenCalledTimes(1);
    expect(auditDetails(h.prisma)).toEqual([
      { scope: 'tenant', overrideMassPushRules: true, massPushRulesOverridden: ['hardware-class', 'off-hours'] },
    ]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('mass-push rules OVERRIDDEN (hardware-class, off-hours)'))).toBe(true);
  });

  it('a malformed override is a 400 before anything is read; no body at all is today’s call, unchanged', async () => {
    const h = harness([row('a'), row('b')]);
    expect(await refusalOf(h.controller.forceUpdateAll(adminReq(), { overrideMassPushRules: 'yes' }))).toMatchObject({
      status: 400,
      body: { code: 'BULK_MASS_PUSH_OVERRIDE_INVALID' },
    });
    expect(h.prisma.client.screen.findMany).not.toHaveBeenCalled();
    nothingMarked(h);
    expect(await h.controller.forceUpdateAll(adminReq(), undefined)).toEqual({ ok: true, scope: 'tenant' });
    expect(await h.controller.forceUpdateAll(adminReq(), {})).toEqual({ ok: true, scope: 'tenant' });
  });
});
