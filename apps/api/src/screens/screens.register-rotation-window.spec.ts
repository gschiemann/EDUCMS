/**
 * The rotation window (2026-10-03) — one PROVEN-renewal rotation per screen
 * per CREDENTIAL_ROTATION_MIN_INTERVAL_MS.
 *
 * The field shape this pins (a screen reloaded by a Resync and then by the
 * wedge detector, 2026-09-29): every page load registers with its current
 * token, and every such register used to rotate. Four registers in 46 s
 * rotated the epoch four times; the grace window covers one, so a token
 * store on the device that had missed two of those writes presented
 * current-2, was graded `stale`, and the screen fell to "re-pair required".
 *
 * The screen row here is STATEFUL — the register handler reads it, the
 * rotation increments it — so a sequence of registers behaves like the real
 * endpoint against one database row.
 */

import * as jwt from 'jsonwebtoken';
import { ScreensController, _registerFpCooldown } from './screens.controller';
import {
  CREDENTIAL_ROTATION_MIN_INTERVAL_MS,
  rotatedWithinRotationWindow,
} from './device-credentials';
import { ScreenWedgeDetectorCron } from './screen-wedge-detector.cron';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN = 'screen-window-001';
const FP = 'fp-window-001';
const HOUR = 60 * 60 * 1000;

type Row = {
  id: string;
  deviceFingerprint: string;
  pairingCode: null;
  tenantId: string;
  status: string;
  name: string;
  credentialEpoch: number;
  credentialEpochRotatedAt: Date | null;
  authState: string | null;
  resolution: null;
  osInfo: null;
  browserInfo: null;
  userAgent: null;
};

function setup(row: Partial<Row>) {
  const state: Row = {
    id: SCREEN,
    deviceFingerprint: FP,
    pairingCode: null,
    tenantId: 'tenant-window',
    status: 'ONLINE',
    name: 'Window test screen',
    credentialEpoch: 0,
    credentialEpochRotatedAt: null,
    authState: 'PROVEN',
    resolution: null,
    osInfo: null,
    browserInfo: null,
    userAgent: null,
    ...row,
  };
  const audit: Array<Record<string, unknown>> = [];
  type UpdateData = {
    credentialEpoch?: { increment: number };
    credentialEpochRotatedAt?: Date;
    authState?: string;
    status?: string;
  };
  const prisma = {
    client: {
      screen: {
        findUnique: jest.fn(() => Promise.resolve({ ...state })),
        update: jest.fn(({ data }: { data: UpdateData }) => {
          if (data.credentialEpoch?.increment) {
            state.credentialEpoch += data.credentialEpoch.increment;
            state.credentialEpochRotatedAt =
              data.credentialEpochRotatedAt ?? null;
            return Promise.resolve({ credentialEpoch: state.credentialEpoch });
          }
          if (data.authState !== undefined) state.authState = data.authState;
          if (data.status !== undefined) state.status = data.status;
          return Promise.resolve({ ...state });
        }),
      },
      auditLog: {
        create: jest.fn(
          ({ data }: { data: { action: string; details: string } }) => {
            audit.push({
              action: data.action,
              ...(JSON.parse(data.details) as Record<string, unknown>),
            });
            return Promise.resolve({});
          },
        ),
      },
      screenEvent: { create: jest.fn().mockResolvedValue({}) },
    },
  };
  Object.assign(prisma.client, {
    $transaction: jest.fn((fn: (tx: any) => Promise<unknown>) => fn(prisma.client)),
    $queryRaw: jest.fn().mockResolvedValue([{ id: SCREEN }]),
  });
  const controller = new ScreensController(
    ...([
      prisma,
      { publish: jest.fn() },
      { signMessage: jest.fn() },
      { assertSeatAvailable: jest.fn() },
      {},
      {},
    ] as unknown as ConstructorParameters<typeof ScreensController>),
  );
  const register = async (prior?: string) => {
    const res = (await controller.register(
      { deviceFingerprint: FP, ...(prior ? { priorDeviceToken: prior } : {}) },
      {
        ip: '10.0.0.1',
        socket: { remoteAddress: '10.0.0.1' },
        headers: {},
      } as unknown as Parameters<ScreensController['register']>[1],
    )) as { deviceToken: string; requiresRePair?: boolean };
    // The audit write is fire-and-forget in the handler; let it land.
    await new Promise((resolve) => setImmediate(resolve));
    return {
      token: res.deviceToken,
      epoch: (jwt.decode(res.deviceToken) as { ep: number }).ep,
      requiresRePair: res.requiresRePair === true,
    };
  };
  return { state, audit, register };
}

const tokenAt = (ep: number, extra: Record<string, unknown> = {}) =>
  jwt.sign(
    { sub: SCREEN, deviceId: SCREEN, kind: 'device', ep, ...extra },
    SECRET,
    {
      expiresIn: '180d',
    },
  );

beforeEach(() => {
  jest.clearAllMocks();
  _registerFpCooldown.clear();
});

describe('a reload burst rotates the credential once', () => {
  it('four proven registers in a burst move the epoch by ONE, and a store that missed every write since is still accepted', async () => {
    const t = setup({
      credentialEpoch: 5,
      credentialEpochRotatedAt: new Date(Date.now() - 2 * HOUR),
    });
    const t5 = tokenAt(5);

    const boot1 = await t.register(t5); // Resync, first page load
    expect(boot1.epoch).toBe(6);
    const boot2 = await t.register(boot1.token); // the durable-refresh reload, ~9 s later
    const boot3 = await t.register(boot2.token); // wedge refresh
    const boot4 = await t.register(boot3.token); // its durable reload
    expect([boot2.epoch, boot3.epoch, boot4.epoch]).toEqual([6, 6, 6]);
    expect(t.state.credentialEpoch).toBe(6);
    expect([boot1, boot2, boot3, boot4].every((r) => !r.requiresRePair)).toBe(
      true,
    );

    // The device's slowest store still holds the token from BEFORE the burst.
    const lagging = await t.register(t5);
    expect(lagging.requiresRePair).toBe(false);
    expect(lagging.epoch).toBe(6);
    expect(t.state.credentialEpoch).toBe(6);

    // Forensics: the skipped rotations are named, not inferred.
    const renewed = t.audit.filter((a) => a.action === 'SCREEN_TOKEN_RENEWED');
    expect(renewed.map((a) => a.rotationSkipped ?? null)).toEqual([
      null, // boot1 rotated
      'rotated-within-window',
      'rotated-within-window',
      'rotated-within-window',
      null, // the lagging store renewed through the grace window
    ]);
    expect(renewed.map((a) => a.priorTokenStatus)).toEqual([
      'valid',
      'valid',
      'valid',
      'valid',
      'valid-grace',
    ]);
  });

  it('a lost register response is replayed with the old token and converges on the current epoch', async () => {
    const t = setup({
      credentialEpoch: 6,
      credentialEpochRotatedAt: new Date(Date.now() - 2 * HOUR),
    });
    const t6 = tokenAt(6);
    await t.register(t6); // rotates to 7; the device never sees the answer
    expect(t.state.credentialEpoch).toBe(7);
    const replay = await t.register(t6);
    expect(replay.requiresRePair).toBe(false);
    expect(replay.epoch).toBe(7);
    expect(t.state.credentialEpoch).toBe(7);
  });

  it('the first proven register AFTER the window rotates again — DT-02 still retires the presented token', async () => {
    const t = setup({
      credentialEpoch: 6,
      credentialEpochRotatedAt: new Date(
        Date.now() - CREDENTIAL_ROTATION_MIN_INTERVAL_MS - 1_000,
      ),
    });
    const res = await t.register(tokenAt(6));
    expect(res.epoch).toBe(7);
    expect(t.state.credentialEpoch).toBe(7);
  });
});

describe('what the window does NOT change', () => {
  it('a stolen token two epochs old is refused even inside the window — no renewal, no rotation', async () => {
    const t = setup({
      credentialEpoch: 7,
      credentialEpochRotatedAt: new Date(Date.now() - 5_000),
    });
    const res = await t.register(tokenAt(5));
    expect(res.requiresRePair).toBe(true);
    expect(t.state.credentialEpoch).toBe(7);
  });

  it('a stolen previous-epoch token is refused once the grace window has passed', async () => {
    const t = setup({
      credentialEpoch: 7,
      credentialEpochRotatedAt: new Date(Date.now() - 25 * HOUR),
    });
    const res = await t.register(tokenAt(6));
    expect(res.requiresRePair).toBe(true);
    expect(t.state.credentialEpoch).toBe(7);
  });

  it('an unproven token at the current epoch is still refused inside the window (DEVAUTH-01)', async () => {
    const t = setup({
      credentialEpoch: 7,
      credentialEpochRotatedAt: new Date(Date.now() - 5_000),
    });
    const res = await t.register(
      tokenAt(7, { unproven: true, aud: 'venueos:device-bootstrap' }),
    );
    expect(res.requiresRePair).toBe(true);
    expect(t.state.credentialEpoch).toBe(7);
  });

  it('a fingerprint alone is still a 1-hour credential inside the window', async () => {
    const t = setup({
      credentialEpoch: 7,
      credentialEpochRotatedAt: new Date(Date.now() - 5_000),
    });
    const res = await t.register();
    expect(res.requiresRePair).toBe(true);
    expect(t.state.credentialEpoch).toBe(7);
  });

  it('the operator-repair restore still ROTATES inside the window — its one-shot guarantee is the rotation', async () => {
    // The operator just re-paired (epoch 4 → 5, seconds ago); the screen
    // presents its pre-pair unproven token.
    const t = setup({
      credentialEpoch: 5,
      credentialEpochRotatedAt: new Date(Date.now() - 5_000),
      authState: 'PROVEN',
    });
    const unprovenPrePair = tokenAt(4, {
      unproven: true,
      aud: 'venueos:device-bootstrap',
    });
    const restored = await t.register(unprovenPrePair);
    expect(restored.requiresRePair).toBe(false);
    expect(t.state.credentialEpoch).toBe(6);
    // …so the same pre-pair token cannot restore a second time.
    const again = await t.register(unprovenPrePair);
    expect(again.requiresRePair).toBe(true);
  });
});

describe('rotatedWithinRotationWindow', () => {
  const now = Date.UTC(2026, 9, 3, 12, 0, 0);
  it.each([
    [null, false],
    [undefined, false],
    ['not a date', false],
    [new Date(now - 1), true],
    [new Date(now - CREDENTIAL_ROTATION_MIN_INTERVAL_MS + 1), true],
    [new Date(now - CREDENTIAL_ROTATION_MIN_INTERVAL_MS), false],
    [new Date(now + 5_000), false], // a future stamp is not "recent"
  ])('%p → %p', (at, expected) => {
    expect(rotatedWithinRotationWindow(at as Date | null, now)).toBe(expected);
  });

  it('leaves a boot inside the window at least two minutes of the wedge detector’s post-boot grace', () => {
    // `credentialEpochRotatedAt` is the wedge detector's "just booted" signal;
    // a boot inside the window does not move it, so its grace runs from the
    // rotation before it.
    expect(
      ScreenWedgeDetectorCron.BOOT_GRACE_MS -
        CREDENTIAL_ROTATION_MIN_INTERVAL_MS,
    ).toBeGreaterThanOrEqual(2 * 60_000);
  });
});
