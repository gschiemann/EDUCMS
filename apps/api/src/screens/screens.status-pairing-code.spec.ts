/**
 * DT-09 — `GET /screens/status/:deviceFingerprint` handed out the pairing
 * code for an arbitrary fingerprint (2026-08-03).
 *
 * THE FINDING. The route is anonymous by design: it is the kiosk heartbeat
 * that keeps `lastPingAt` fresh, and the shipped Kotlin `HeartbeatService`
 * sends no `Authorization` header. It also returned `Screen.pairingCode`.
 * That code is the CLAIM credential — typed into `POST /screens/pair` it
 * moves a physical display into the typist's tenant, and via
 * `POST /devices/pair` it mints a device token. The only thing standing in
 * front of it was the secrecy of the device fingerprint, and fingerprints
 * are not secret in practice: the dashboard renders one with a copy button,
 * `GET /screens` carries them, and they show up in support tickets and OTA
 * logs.
 *
 * THE FIX. The code is returned only to a caller that proves possession of
 * that screen's own device credential, through the same
 * `verifyDeviceForScreen` gate every other device route uses — so it is also
 * bound to `credentialEpoch` and refused for a REVOKED screen. Everything
 * else about the heartbeat is untouched: no shipped client reads this field
 * (the pairing splash sources its code from the `POST /screens/register`
 * response), and a kiosk that DOES hold a token still gets it.
 */

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import { invalidateDeviceCredentialCache } from './device-auth';

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const FP = 'android-9f3a-not-actually-a-secret';

const baseScreen = {
  id: 'screen-1',
  name: 'Gym Entrance',
  tenantId: null as string | null,
  deviceFingerprint: FP,
  pairingCode: 'K7QP2M',
  status: 'PENDING',
  screenGroupId: null,
  credentialEpoch: 3,
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

function harness(overrides: Partial<typeof baseScreen> = {}, redisOverrides: any = {}) {
  const screen = { ...baseScreen, ...overrides };
  const prisma: any = {
    client: {
      screen: {
        // One mock serves both lookups the request makes: the fingerprint
        // lookup in the handler and the live-row read inside the device-auth
        // gate. Dispatch on the `where` clause so both are realistic.
        findUnique: jest.fn(async ({ where }: any) =>
          where?.deviceFingerprint || where?.id === screen.id ? screen : null,
        ),
        update: jest.fn(async () => screen),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    },
  };
  const redis: any = { sismember: jest.fn(async () => false), publish: jest.fn(), ...redisOverrides };
  const controller = new ScreensController(
    prisma, redis, { signMessage: jest.fn() } as any, {} as any,
    { syncSubscriptionQuantity: jest.fn() } as any, {} as any,
  );
  return { controller, prisma, redis, screen };
}

const deviceReq = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as any;
const anonReq = () => ({ headers: {} }) as any;

function deviceToken(opts: { sub?: string; ep?: number } = {}) {
  return jwt.sign(
    { kind: 'device', sub: opts.sub ?? 'screen-1', ep: opts.ep ?? 3 },
    DEVICE_JWT_SECRET,
    { expiresIn: '180d' },
  );
}

beforeEach(() => invalidateDeviceCredentialCache());

describe('GET /screens/status/:fp — pairing code requires proof of possession (DT-09)', () => {
  it('WITHHOLDS the pairing code from an anonymous caller who knows the fingerprint', async () => {
    const { controller } = harness();

    const res: any = await controller.deviceStatus(FP, undefined, undefined, undefined, anonReq());

    expect(res.pairingCode).toBeNull();
    expect(res.pairingCodeWithheld).toBe(true);
    // The heartbeat itself is unchanged — this must stay a working liveness
    // signal for a kiosk that sends no credential.
    expect(res.screenId).toBe('screen-1');
    expect(res.paired).toBe(false);
    expect(res.name).toBe('Gym Entrance');
  });

  it('does not even attempt device auth when no credential is presented (hot-path cost)', async () => {
    const { controller, redis } = harness();

    await controller.deviceStatus(FP, undefined, undefined, undefined, anonReq());

    // A kiosk hits this route every 30-45 s; an unconditional Redis/DB round
    // trip for a field nobody reads would be a fleet-scale regression.
    expect(redis.sismember).not.toHaveBeenCalled();
  });

  it('RETURNS the pairing code to the device that proves possession of the screen credential', async () => {
    const { controller } = harness();

    const res: any = await controller.deviceStatus(
      FP, undefined, undefined, undefined, deviceReq(deviceToken()),
    );

    expect(res.pairingCode).toBe('K7QP2M');
    expect(res.pairingCodeWithheld).toBeUndefined();
  });

  it('withholds it from a token minted for a DIFFERENT screen', async () => {
    const { controller } = harness();

    const res: any = await controller.deviceStatus(
      FP, undefined, undefined, undefined, deviceReq(deviceToken({ sub: 'screen-999' })),
    );

    expect(res.pairingCode).toBeNull();
    expect(res.pairingCodeWithheld).toBe(true);
  });

  it('withholds it from a superseded credential epoch (DT-01/DT-02 binding)', async () => {
    const { controller } = harness({ credentialEpoch: 9, credentialEpochRotatedAt: new Date() });

    const res: any = await controller.deviceStatus(
      FP, undefined, undefined, undefined, deviceReq(deviceToken({ ep: 1 })),
    );

    expect(res.pairingCode).toBeNull();
  });

  it('withholds it from a REVOKED screen — a revoke is exactly when this matters', async () => {
    const { controller } = harness({ status: 'REVOKED' });

    const res: any = await controller.deviceStatus(
      FP, undefined, undefined, undefined, deviceReq(deviceToken()),
    );

    expect(res.pairingCode).toBeNull();
    expect(res.pairingCodeWithheld).toBe(true);
  });

  it('withholds it when the token string has been denylisted', async () => {
    const { controller } = harness({}, { sismember: jest.fn(async () => true) });

    const res: any = await controller.deviceStatus(
      FP, undefined, undefined, undefined, deviceReq(deviceToken()),
    );

    expect(res.pairingCode).toBeNull();
  });

  it('withholds it from a garbage bearer token without breaking the heartbeat', async () => {
    const { controller } = harness();

    const res: any = await controller.deviceStatus(
      FP, undefined, undefined, undefined, deviceReq('not.a.jwt'),
    );

    expect(res.pairingCode).toBeNull();
    expect(res.screenId).toBe('screen-1'); // heartbeat still answered
  });

  it('reports no withholding for a claimed screen, which has no code to leak', async () => {
    // `POST /screens/pair` nulls the code on claim; nothing to gate.
    const { controller } = harness({ tenantId: 'tenant-1', pairingCode: null as any, status: 'ONLINE' });

    const res: any = await controller.deviceStatus(FP, undefined, undefined, undefined, anonReq());

    expect(res.pairingCode).toBeNull();
    expect(res.pairingCodeWithheld).toBeUndefined();
    expect(res.paired).toBe(true);
  });

  it('leaves the preview short-circuit alone', async () => {
    const { controller, prisma } = harness();

    const res: any = await controller.deviceStatus('preview-abc', undefined, undefined, undefined, anonReq());

    expect(res).toMatchObject({ isPreview: true, pairingCode: null, screenId: null });
    expect(prisma.client.screen.findUnique).not.toHaveBeenCalled();
  });
});
