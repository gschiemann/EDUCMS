/**
 * GET /screens/status/:fp → `faceCount` — THE ACTIVATION PATH for a
 * double-sided display's back side (2026-09-19).
 *
 * The 1.1.18 native host could put a second WebView on the DH43's second panel,
 * but nothing ever told it to: `face_count` could only be set over adb. This
 * reply is the channel the native heartbeat already reads, it is decided by the
 * server, and no page takes part — so a hostile frame cannot make a box host
 * anything.
 *
 * What matters, in order: nothing is hosted until an operator adds a side; the
 * existing fleet pays NOTHING for the feature; and a failed count never
 * UN-hosts a side that is playing.
 */
jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import { ScreensController } from './screens.controller';
import { invalidateDeviceCredentialCache } from './device-auth';

const FP = 'android-dh43-front-not-a-secret';
const FACE_APK = '10118';

const baseScreen = {
  id: 'screen-front',
  name: 'DH43',
  tenantId: 'tenant-1' as string | null,
  faceOfScreenId: null as string | null,
  deviceFingerprint: FP,
  pairingCode: null as string | null,
  status: 'ONLINE',
  screenGroupId: null,
  credentialEpoch: 1,
  credentialEpochRotatedAt: null as Date | null,
  playerVersion: null,
  playerVersionCode: null,
  managerVersion: null,
  forceApkUpdatePendingAt: null,
  lastOtaState: null,
  lastOtaProgress: null,
  lastOtaMessage: null,
  lastOtaAt: null,
  userAgent: null,
  osInfo: null,
};

function harness(overrides: Partial<typeof baseScreen> = {}, sides: number | Error = 0) {
  const screen = { ...baseScreen, ...overrides };
  const count = jest.fn(async () => {
    if (sides instanceof Error) throw sides;
    return sides;
  });
  const prisma: any = {
    client: {
      screen: {
        findUnique: jest.fn(async ({ where }: any) =>
          where?.deviceFingerprint || where?.id === screen.id ? screen : null,
        ),
        update: jest.fn(async () => screen),
        count,
      },
      auditLog: { create: jest.fn(async () => ({})) },
    },
  };
  const redis: any = { sismember: jest.fn(async () => false), publish: jest.fn() };
  const controller = new ScreensController(
    prisma, redis, { signMessage: jest.fn() } as any, {} as any,
    { syncSubscriptionQuantity: jest.fn() } as any, {} as any,
  );
  return { controller, count };
}

const anon = () => ({ headers: {} }) as any;
const status = (c: ScreensController, vc?: string) =>
  c.deviceStatus(FP, '1.1.18', vc, undefined, anon()) as Promise<any>;

beforeEach(() => invalidateDeviceCredentialCache());

describe('faceCount on the native heartbeat reply', () => {
  it('is 1 until an operator adds a side — nothing is hosted anywhere by default', async () => {
    const { controller } = harness({}, 0);
    expect((await status(controller, FACE_APK)).faceCount).toBe(1);
  });

  it('is 2 once the back side exists, scoped to this screen AND its tenant', async () => {
    const { controller, count } = harness({}, 1);
    expect((await status(controller, FACE_APK)).faceCount).toBe(2);
    expect(count).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1', faceOfScreenId: 'screen-front' } });
  });

  it('never exceeds the supported number of sides', async () => {
    const { controller } = harness({}, 40);
    expect((await status(controller, FACE_APK)).faceCount).toBe(4);
  });

  it('THE EXISTING FLEET PAYS NOTHING — an APK that cannot host a face is never counted for', async () => {
    for (const vc of ['10117', '10063', '0', 'abc', undefined]) {
      const { controller, count } = harness({}, 1);
      const res = await status(controller, vc);
      expect(count).not.toHaveBeenCalled();
      expect(res.faceCount).toBe(1);
    }
  });

  it('an UNPAIRED screen has no sides and is never counted for', async () => {
    const { controller, count } = harness({ tenantId: null, status: 'PENDING' }, 1);
    expect((await status(controller, FACE_APK)).faceCount).toBe(1);
    expect(count).not.toHaveBeenCalled();
  });

  it('a FACE row answers 1 — the box hosts faces, a face hosts nothing', async () => {
    const { controller, count } = harness({ id: 'screen-back', faceOfScreenId: 'screen-front' }, 1);
    expect((await status(controller, FACE_APK)).faceCount).toBe(1);
    expect(count).not.toHaveBeenCalled();
  });

  it('a FAILED count says NOTHING rather than "1" — it must never un-host a side that is playing', async () => {
    const { controller } = harness({}, new Error('pool exhausted'));
    const res = await status(controller, FACE_APK);
    expect(res).not.toHaveProperty('faceCount');
    // …and the heartbeat itself still answers.
    expect(res.screenId).toBe('screen-front');
    expect(res.paired).toBe(true);
  });
});
