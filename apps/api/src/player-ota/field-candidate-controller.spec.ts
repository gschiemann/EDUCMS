import { PlayerOtaController } from './player-ota.controller';
import * as field from './field-candidate';
const id = '11111111-1111-4111-8111-111111111111',
  tenant = '22222222-2222-4222-8222-222222222222';
const release = {
  versionName: '1.1.25-field.1',
  versionCode: 10125,
  sha256: 'a'.repeat(64),
  size: 8,
  sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/1',
};
const saved = { ...process.env };
const realFetch = global.fetch;
beforeEach(() => {
  process.env.PLAYER_APK_FIELD_CANDIDATE = release.versionName;
  process.env.PLAYER_APK_FIELD_TENANT_ID = tenant;
  process.env.PLAYER_APK_FIELD_SCREEN_IDS = id;
  process.env.PLAYER_APK_FIELD_EXPIRES_AT = new Date(
    Date.now() + 60_000,
  ).toISOString();
  process.env.DEVICE_SECRET_KEY = 'fake-test-key';
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => [] });
  jest.spyOn(field, 'configuredFieldRelease').mockReturnValue(release);
  jest.spyOn(field, 'verifiedFieldBytes').mockResolvedValue(Buffer.alloc(8));
});
afterEach(() => {
  jest.restoreAllMocks();
  process.env = saved;
  global.fetch = realFetch;
});
function harness({
  auth = true,
  pending = true,
  auto = false,
  screenId = id,
  tenantId = tenant,
  canary = 100,
  window = false,
} = {}) {
  const row = {
    id: screenId,
    tenantId,
    status: 'ONLINE',
    playerVersionCode: 10123,
    forceApkUpdatePendingAt: pending ? new Date() : null,
    tenant: { autoUpdatePlayerEnabled: auto, canaryFleetPercent: canary, ...(window ? {otaWindowStart:'01:00',otaWindowEnd:'02:00',otaWindowTimezone:'UTC'} : {}) },
  };
  const prisma: any = {
    client: {
      screen: {
        findFirst: jest.fn().mockResolvedValue(row),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    },
  };
  const c = new PlayerOtaController(prisma, {
    sismember: jest.fn().mockResolvedValue(false),
  } as any);
  jest.spyOn(c as any, 'isDeviceAuthenticated').mockResolvedValue(auth);
  jest.spyOn(c as any, 'persistReportedVersion').mockResolvedValue(undefined);
  return { c, prisma };
}
const body = {
  fingerprint: 'fake-fp',
  versionCode: 10123,
  versionName: '1.1.23',
  abi: 'armeabi-v7a',
};
const req = {
  headers: {},
  protocol: 'https',
  get: () => 'api-production-39a1.up.railway.app',
} as any;
describe('field APK uses existing exact-screen operator authorization', () => {
  it('offers pinned bytes only after a device-authenticated operator push and required audit', async () => {
    const { c, prisma } = harness();
    const result: any = await c.updateCheck(body, req);
    expect(result.latest).toMatchObject({
      versionCode: 10125,
      versionName: release.versionName,
      sha256: release.sha256,
    });
    expect(result.latest.apkUrl).toContain(
      `/field-apk/${release.sha256}?ticket=`,
    );
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PLAYER_FIELD_APK_OFFER',
          tenantId: tenant,
          targetId: id,
        }),
      }),
    );
  });
  it.each([
    { auth: false },
    { pending: false },
    { pending: false, auto: true },
  ])(
    'cannot turn fingerprint knowledge or tenant auto-update into a field install: %s',
    async (opts) => {
      const { c } = harness(opts);
      expect(await c.updateCheck(body, req)).toEqual({ uptoDate: true });
      expect(field.verifiedFieldBytes).not.toHaveBeenCalled();
    },
  );
  it('never replaces the offer for an untargeted screen or different tenant', async () => {
    for (const opts of [{ screenId: tenant }, { tenantId: id }]) {
      const { c } = harness(opts);
      await c.updateCheck(body, req);
    }
    expect(field.verifiedFieldBytes).not.toHaveBeenCalled();
  });
  it('does not offer a downgrade or an artifact without an audit', async () => {
    const { c, prisma } = harness();
    expect(await c.updateCheck({ ...body, versionCode: 10125 }, req)).toEqual({
      uptoDate: true,
    });
    prisma.client.auditLog.create.mockRejectedValue(Error('unavailable'));
    expect(await c.updateCheck(body, req)).toEqual({ uptoDate: true });
  });
  it('fails closed when a private candidate has no committed record or bytes', async () => {
    const { c } = harness();
    jest.mocked(field.configuredFieldRelease).mockReturnValue(null);
    expect(await c.updateCheck(body, req)).toEqual({ uptoDate: true });
    jest.mocked(field.configuredFieldRelease).mockReturnValue(release);
    jest
      .mocked(field.verifiedFieldBytes)
      .mockRejectedValue(Error('bad-digest'));
    expect(await c.updateCheck(body, req)).toEqual({ uptoDate: true });
  });
  it('requires a current ticket and non-revoked tenant-bound screen on download', async () => {
    const { c, prisma } = harness();
    const r: any = await c.updateCheck(body, req);
    const ticket = new URL(r.latest.apkUrl).searchParams.get('ticket');
    const res: any = { setHeader: jest.fn(), end: jest.fn() };
    await expect(
      c.streamFieldApk(
        release.sha256,
        { query: { ticket: 'bad' } } as any,
        res,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await c.streamFieldApk(release.sha256, { query: { ticket } } as any, res);
    expect(prisma.client.screen.findFirst).toHaveBeenLastCalledWith({
      where: { id, tenantId: tenant, status: { not: 'REVOKED' } },
      select: { id: true },
    });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    prisma.client.screen.findFirst.mockResolvedValue(null);
    await expect(
      c.streamFieldApk(release.sha256, { query: { ticket } } as any, res),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('retains maintenance-window and canary holds, including on an auto-enabled tenant', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-09T15:00:00Z'));
    process.env.PLAYER_APK_FIELD_EXPIRES_AT = new Date(
      Date.now() + 60_000,
    ).toISOString();
    try {
      for (const opts of [{ window: true, auto: true }, { canary: 0 }]) {
        const { c } = harness(opts);
        expect(await c.updateCheck(body, req)).toEqual({ uptoDate: true });
      }
      expect(field.verifiedFieldBytes).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
  it('a real pending operator push can reach an auto-enabled selected test device', async () => {
    const { c } = harness({ auto: true });
    const result: any = await c.updateCheck(body, req);
    expect(result.latest.versionName).toBe(release.versionName);
  });
});
