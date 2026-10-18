/**
 * "On latest — push anyway" (2026-10-18, tracked pushes).
 *
 * A push used to expire after 24 h whatever happened, so a push to a screen
 * that was already current simply vanished a day later. Pushes are now held
 * visibly instead — so a screen that asks, is already on (or past) the
 * newest release, and therefore will never be offered anything, must END its
 * push there and then, or it would turn "EXPIRED — send it again" on a screen
 * that is perfectly current. Only a device-authenticated check may clear it
 * (OTA-01), and only the push that was read.
 *
 * Its own file because it needs a populated release catalogue, and the
 * catalogue is cached per module.
 */
import { PlayerOtaController } from './player-ota.controller';

const SCREEN = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const realFetch = global.fetch;

beforeAll(() => {
  // Hermetic: ONE published Player release, v1.1.29. The "already current"
  // answer comes before any digest or download work.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [{
      tag_name: 'player-v1.1.29',
      assets: [{ name: 'edu-cms-player-v1.1.29.apk', browser_download_url: 'https://github.com/gschiemann/EDUCMS/releases/download/player-v1.1.29/edu-cms-player-v1.1.29.apk' }],
    }],
  }) as any;
});
afterAll(() => { global.fetch = realFetch; });
afterEach(() => jest.restoreAllMocks());

function harness(auth: boolean) {
  const pushAt = new Date(Date.now() - 5 * 60_000);
  const row = {
    id: SCREEN, tenantId: TENANT, name: 'Lobby', status: 'ONLINE', screenGroupId: null,
    autoUpdatePlayerOverride: null, playerVersionCode: 10129,
    forceApkUpdatePendingAt: pushAt, forceApkUpdateOverrideWindow: false,
    forceApkUpdateHold: null, forceApkUpdateOfferCount: 0, forceApkUpdateLastOfferAt: null,
    forceApkUpdateTargetVersion: null, forceApkUpdateTargetVersionCode: null,
    lastOtaState: null, lastOtaMessage: null, lastOtaAt: null,
    tenant: { autoUpdatePlayerEnabled: false, otaWindowStart: null, otaWindowEnd: null, otaWindowTimezone: null, canaryFleetPercent: 100 },
  };
  const prisma: any = {
    client: {
      screen: {
        findFirst: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      screenDeviceInventory: { findUnique: jest.fn().mockResolvedValue(null) },
      displaySchedule: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
    },
  };
  const c = new PlayerOtaController(prisma, { sismember: jest.fn().mockResolvedValue(false) } as any);
  jest.spyOn(c as any, 'isDeviceAuthenticated').mockResolvedValue(auth);
  jest.spyOn(c as any, 'persistReportedVersion').mockResolvedValue(undefined);
  jest.spyOn((c as any).logger, 'log').mockImplementation(() => undefined);
  return { c, prisma, pushAt };
}

const req = { headers: {}, protocol: 'https', get: () => 'api.example.test' } as any;
const current = { fingerprint: 'android-lobby', versionCode: 10129, versionName: '1.1.29', abi: 'arm64-v8a' } as any;

describe('a push to a screen already on the newest release', () => {
  it('is cleared by the screen\'s own authenticated check — that push only', async () => {
    const { c, prisma, pushAt } = harness(true);
    await expect(c.updateCheck(current, req)).resolves.toEqual({ uptoDate: true, latestVersionName: '1.1.29' });
    expect(prisma.client.screen.updateMany).toHaveBeenCalledWith({
      where: { id: SCREEN, tenantId: TENANT, forceApkUpdatePendingAt: pushAt },
      data: { forceApkUpdatePendingAt: null, forceApkUpdateOverrideWindow: false },
    });
  });

  it('is NOT cleared by an anonymous check (OTA-01: clearing a push is the privileged write)', async () => {
    const { c, prisma } = harness(false);
    await expect(c.updateCheck(current, req)).resolves.toEqual({ uptoDate: true, latestVersionName: '1.1.29' });
    expect(prisma.client.screen.updateMany).not.toHaveBeenCalled();
  });
});
