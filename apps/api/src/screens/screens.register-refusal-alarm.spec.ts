/**
 * `POST /screens/register` feeds the owner's device-credential refusal alarm
 * (2026-10-23, notifications/fleet-alarms/): a register that 401s the prior
 * token it was handed (SCREEN_TOKEN_MISMATCH) is counted against the screen
 * the fingerprint resolved — its id only — and the 401 itself is unchanged.
 * A register that issues a credential (renewal or 1-hour downgrade) is not a
 * refusal and is not counted.
 */
import * as jwt from 'jsonwebtoken';
import { ScreensController, _registerFpCooldown } from './screens.controller';
import {
  __resetDeviceCredentialRefusalsForTests,
  readDeviceCredentialRefusals,
} from '../notifications/fleet-alarms/device-credential-refusals';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) => opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const TEST_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_ID = '00000000-0000-4000-8000-00000000b001';

const mockPrisma: any = {
  client: {
    screen: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    screenEvent: { create: jest.fn().mockResolvedValue({}) },
  },
};
mockPrisma.client.$transaction = jest.fn((fn: (tx: any) => Promise<unknown>) => fn(mockPrisma.client));
mockPrisma.client.$queryRaw = jest.fn().mockResolvedValue([{ id: SCREEN_ID }]);

const paired = () => ({
  id: SCREEN_ID,
  deviceFingerprint: 'fp-refusal-alarm',
  pairingCode: null,
  tenantId: 'tenant-refusal-alarm',
  status: 'ONLINE',
  credentialEpoch: 0,
  credentialEpochRotatedAt: null,
  resolution: null,
  osInfo: null,
  browserInfo: null,
  userAgent: null,
  name: 'Fixture Screen',
});
const makeReq = () => ({ ip: '10.0.0.1', socket: { remoteAddress: '10.0.0.1' }, headers: {} }) as any;
const mint = (sub: string) => jwt.sign({ sub, kind: 'device', ep: 0 }, TEST_JWT_SECRET, { expiresIn: '180d' });

async function recorded(): Promise<string[]> {
  const { buckets } = await readDeviceCredentialRefusals(undefined, Date.now());
  return [...buckets.values()].flatMap((s) => [...s]).sort();
}

let controller: ScreensController;
beforeEach(() => {
  jest.clearAllMocks();
  _registerFpCooldown.clear();
  __resetDeviceCredentialRefusalsForTests();
  mockPrisma.client.screen.findUnique.mockResolvedValue(paired());
  mockPrisma.client.screen.update.mockResolvedValue({ id: SCREEN_ID, pairingCode: null, tenantId: 'tenant-refusal-alarm', name: 'Fixture Screen' });
  controller = new ScreensController(mockPrisma, { publish: jest.fn() } as any, { signMessage: jest.fn() } as any, { assertSeatAvailable: jest.fn() } as any, {} as any, {} as any);
});

describe('POST /screens/register → device-credential refusal alarm', () => {
  it('a prior token the register refuses (401 SCREEN_TOKEN_MISMATCH) is counted for this screen', async () => {
    await expect(
      controller.register({ deviceFingerprint: 'fp-refusal-alarm', priorDeviceToken: mint('00000000-0000-4000-8000-00000000b999') }, makeReq()),
    ).rejects.toMatchObject({ status: 401 });
    expect(await recorded()).toEqual([`${SCREEN_ID}|register|register`]);
  });

  it('a register that issues a credential — a renewal, or a 1-hour downgrade with no prior — is not counted', async () => {
    const renewed = await controller.register({ deviceFingerprint: 'fp-refusal-alarm', priorDeviceToken: mint(SCREEN_ID) }, makeReq());
    expect(renewed.deviceToken).toBeTruthy();
    _registerFpCooldown.clear();
    const downgraded = await controller.register({ deviceFingerprint: 'fp-refusal-alarm' }, makeReq());
    expect(downgraded).toMatchObject({ requiresRePair: true });
    expect(await recorded()).toEqual([]);
  });
});
