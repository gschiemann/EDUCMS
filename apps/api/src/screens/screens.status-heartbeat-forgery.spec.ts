/**
 * HEARTBEAT FORGERY — `GET /screens/status/:deviceFingerprint` wrote for
 * anyone who knew a fingerprint (school-security audit item 3 / internal F-D,
 * 2026-09-08).
 *
 * THE FINDING. The route is anonymous by design — it is the PAIRING poll, and
 * the shipped Kotlin `HeartbeatService` sends no `Authorization` header — but
 * it also WROTE to the screen row on every request: `lastPingAt`, `status`,
 * `playerVersion` / `playerVersionCode`, `managerVersion`, and on a version
 * bump it cleared `forceApkUpdatePendingAt` while stamping
 * `lastOtaState='INSTALLED'`, `lastOtaProgress=100`. DT-09's
 * `heartbeatProvesDevice` gated only whether `Screen.pairingCode` came back in
 * the RESPONSE; it never gated the write.
 *
 * A device fingerprint is not a secret (the dashboard renders one with a copy
 * button, `GET /screens` carries it, support tickets and OTA logs are full of
 * them), so with one value a stranger could:
 *   • hold a dead, stolen or unplugged screen at ONLINE forever, defeating the
 *     offline detection an operator relies on to know a screen is NOT showing
 *     their emergency content;
 *   • falsify the fleet's own view of what firmware is deployed;
 *   • forge OTA completion, so a failed rollout reads as successful.
 *
 * WHAT THESE TESTS PIN. Every one of them was MUTATION-CHECKED: each half of
 * the fix was reverted in turn and the tests below were confirmed to FAIL, so
 * none of them passes both ways. The mapping is in the fix report at
 * docs/research/2026-09-08-school-security/HEARTBEAT-forgery-fix.md.
 *
 * NOTE ON ISOLATION. Every harness gets a FRESH screen id, because the 25 s
 * `shouldSkipLastPingWrite` debounce is module state keyed on that id — two
 * cases sharing an id would silently debounce the second one's write and a
 * "no write happened" assertion would pass for the wrong reason.
 */

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import { invalidateDeviceCredentialCache } from './device-auth';
import {
  __resetStatusPollThrottle,
  STATUS_POLL_MAX_PER_WINDOW,
} from './status-poll-throttle';
import { __resetDeviceThrottleMemo } from '../security/device-throttle-key';

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';

let seq = 0;

interface Row {
  id: string;
  name: string;
  tenantId: string | null;
  deviceFingerprint: string;
  pairingCode: string | null;
  status: string;
  screenGroupId: string | null;
  credentialEpoch: number;
  credentialEpochRotatedAt: Date | null;
  playerVersion: string | null;
  playerVersionCode: number | null;
  managerVersion: string | null;
  forceApkUpdatePendingAt: Date | null;
  lastOtaState: string | null;
  lastOtaProgress: number | null;
  lastOtaMessage: string | null;
  lastOtaAt: Date | null;
  userAgent: string | null;
  osInfo: string | null;
}

function makeRow(kind: 'paired' | 'unpaired', overrides: Partial<Row> = {}): Row {
  const n = ++seq;
  const base: Row = {
    id: `screen-${kind}-${n}`,
    name: kind === 'paired' ? 'Gym Entrance' : 'Screen-K7QP2M',
    tenantId: kind === 'paired' ? 'tenant-1' : null,
    deviceFingerprint: `android-${kind}-${n}-not-a-secret`,
    // `POST /screens/pair` nulls the code on claim, so a paired row has none.
    pairingCode: kind === 'paired' ? null : 'K7QP2M',
    status: kind === 'paired' ? 'ONLINE' : 'PENDING',
    screenGroupId: null,
    credentialEpoch: 3,
    credentialEpochRotatedAt: null,
    playerVersion: '1.1.8',
    playerVersionCode: 118,
    managerVersion: '1.0.3',
    // An operator has pushed an APK and is waiting for the install to land.
    forceApkUpdatePendingAt: kind === 'paired' ? new Date('2026-09-08T10:00:00Z') : null,
    lastOtaState: 'DOWNLOADING',
    lastOtaProgress: 40,
    lastOtaMessage: null,
    lastOtaAt: null,
    userAgent: null,
    osInfo: null,
  };
  return { ...base, ...overrides };
}

function harness(screen: Row) {
  const prisma: any = {
    client: {
      screen: {
        findUnique: jest.fn(async ({ where }: any) =>
          where?.deviceFingerprint === screen.deviceFingerprint || where?.id === screen.id
            ? screen
            : null,
        ),
        update: jest.fn(async () => screen),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    },
  };
  const redis: any = { sismember: jest.fn(async () => false), publish: jest.fn() };
  const controller = new ScreensController(
    prisma, redis, { signMessage: jest.fn() } as any, {} as any,
    { syncSubscriptionQuantity: jest.fn() } as any, {} as any,
  );
  const token = (opts: { sub?: string; ep?: number } = {}) =>
    jwt.sign(
      { kind: 'device', sub: opts.sub ?? screen.id, ep: opts.ep ?? 3 },
      DEVICE_JWT_SECRET,
      { expiresIn: '180d' },
    );
  return { controller, prisma, redis, screen, token };
}

const deviceReq = (t: string) => ({ headers: { authorization: `Bearer ${t}` } }) as any;
const anonReq = () => ({ headers: {} }) as any;

/** The `data` object of the ONE `screen.update` the handler may issue. */
const writtenData = (prisma: any): Record<string, any> | null => {
  const call = prisma.client.screen.update.mock.calls[0];
  return call ? call[0].data : null;
};

/** HTTP status of a rejected handler call, or 0 when it resolved. */
async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e: any) {
    return typeof e?.getStatus === 'function' ? e.getStatus() : e?.status;
  }
}

beforeEach(() => {
  invalidateDeviceCredentialCache();
  __resetStatusPollThrottle();
  __resetDeviceThrottleMemo();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. PAIRED screen — the forgery itself
// ─────────────────────────────────────────────────────────────────────────────

describe('PAIRED screen — an anonymous poll writes NOTHING', () => {
  it('cannot move lastPingAt / status (the ONLINE forgery)', async () => {
    const { controller, prisma, screen } = harness(makeRow('paired'));

    await controller.deviceStatus(
      screen.deviceFingerprint, undefined, undefined, undefined, anonReq(),
    );

    // The single most important assertion in this file: a stranger with a
    // fingerprint must not be able to keep a dark screen looking alive.
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('cannot stamp playerVersion / playerVersionCode (the firmware lie)', async () => {
    const { controller, prisma, screen } = harness(makeRow('paired'));

    await controller.deviceStatus(screen.deviceFingerprint, '9.9.9', '999', undefined, anonReq());

    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('cannot forge OTA completion — no INSTALLED, no cleared force-push', async () => {
    const { controller, prisma, screen } = harness(makeRow('paired'));

    // A version code ABOVE the stored 118 with a pending force-push is exactly
    // the shape that used to clear the push and stamp INSTALLED / 100.
    await controller.deviceStatus(screen.deviceFingerprint, '9.9.9', '999', undefined, anonReq());

    expect(prisma.client.screen.update).not.toHaveBeenCalled();
    // Belt and braces: even if a write were ever re-introduced here, it must
    // not be allowed to carry these three keys.
    const data = writtenData(prisma);
    expect(data?.lastOtaState).toBeUndefined();
    expect(data?.lastOtaProgress).toBeUndefined();
    expect(data && 'forceApkUpdatePendingAt' in data).toBeFalsy();
  });

  it('cannot clear managerVersion with the explicit empty-string signal', async () => {
    const { controller, prisma, screen } = harness(makeRow('paired'));

    // `?mv=` present-but-empty is the "Manager was uninstalled" signal. An
    // anonymous caller must not be able to blank the dashboard chip.
    await controller.deviceStatus(screen.deviceFingerprint, undefined, undefined, '', anonReq());

    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('still ANSWERS the poll — the read is what the OTA fallback needs', async () => {
    const { controller, screen } = harness(makeRow('paired'));

    const res: any = await controller.deviceStatus(
      screen.deviceFingerprint, undefined, undefined, undefined, anonReq(),
    );

    // Refusing the write must not turn this into a 404/401 for the shipped
    // native heartbeat, which reads `forceUpdatePending` off this response.
    expect(res.screenId).toBe(screen.id);
    expect(res.paired).toBe(true);
    expect(res.name).toBe('Gym Entrance');
    expect(res.ota).toMatchObject({ state: 'DOWNLOADING', progress: 40 });
    expect(res.versions).toMatchObject({ player: '1.1.8', manager: '1.0.3' });
  });
});

describe('PAIRED screen — a DEVICE-AUTHENTICATED poll still writes everything', () => {
  it('stamps liveness on a credentialed poll', async () => {
    const { controller, prisma, screen, token } = harness(makeRow('paired'));

    await controller.deviceStatus(
      screen.deviceFingerprint, undefined, undefined, undefined, deviceReq(token()),
    );

    expect(prisma.client.screen.update).toHaveBeenCalledTimes(1);
    const data = writtenData(prisma)!;
    expect(data.lastPingAt).toBeInstanceOf(Date);
    expect(data.status).toBe('ONLINE');
  });

  it('stamps the version AND the OTA-install completion on a real version bump', async () => {
    const { controller, prisma, screen, token } = harness(makeRow('paired'));

    await controller.deviceStatus(
      screen.deviceFingerprint, '1.1.9', '119', '1.0.4', deviceReq(token()),
    );

    const data = writtenData(prisma)!;
    expect(data.playerVersion).toBe('1.1.9');
    expect(data.playerVersionCode).toBe(119);
    expect(data.managerVersion).toBe('1.0.4');
    // The force-push clear + INSTALLED stamp — unchanged behaviour for a
    // caller that proves possession.
    expect(data.forceApkUpdatePendingAt).toBeNull();
    expect(data.lastOtaState).toBe('INSTALLED');
    expect(data.lastOtaProgress).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. A presented credential that fails must not become anonymity
// ─────────────────────────────────────────────────────────────────────────────

describe('PAIRED screen — a credential that fails to verify is 401, not a downgrade', () => {
  it('refuses a garbage bearer token', async () => {
    const { controller, prisma, screen } = harness(makeRow('paired'));
    const status = await statusOf(
      controller.deviceStatus(screen.deviceFingerprint, '9.9.9', '999', undefined,
        deviceReq('not.a.jwt')),
    );
    expect(status).toBe(401);
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('refuses a token minted for a DIFFERENT screen', async () => {
    const { controller, prisma, screen, token } = harness(makeRow('paired'));
    const status = await statusOf(
      controller.deviceStatus(screen.deviceFingerprint, '9.9.9', '999', undefined,
        deviceReq(token({ sub: 'screen-999' }))),
    );
    expect(status).toBe(401);
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('refuses a superseded credential epoch', async () => {
    const { controller, prisma, screen, token } = harness(
      makeRow('paired', { credentialEpoch: 9, credentialEpochRotatedAt: new Date() }),
    );
    const status = await statusOf(
      controller.deviceStatus(screen.deviceFingerprint, undefined, undefined, undefined,
        deviceReq(token({ ep: 1 }))),
    );
    expect(status).toBe(401);
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('refuses a REVOKED screen — a revoke is exactly when this matters', async () => {
    const { controller, prisma, screen, token } = harness(
      makeRow('paired', { status: 'REVOKED' }),
    );
    const status = await statusOf(
      controller.deviceStatus(screen.deviceFingerprint, undefined, undefined, undefined,
        deviceReq(token())),
    );
    expect(status).toBe(401);
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. UNPAIRED screen — the pairing flow must keep working, end to end
// ─────────────────────────────────────────────────────────────────────────────

describe('UNPAIRED screen — pairing still works with no credential', () => {
  it('an anonymous poll still stamps lastPingAt + PENDING', async () => {
    const { controller, prisma, screen } = harness(makeRow('unpaired'));

    await controller.deviceStatus(
      screen.deviceFingerprint, undefined, undefined, undefined, anonReq(),
    );

    expect(prisma.client.screen.update).toHaveBeenCalledTimes(1);
    const data = writtenData(prisma)!;
    expect(data.lastPingAt).toBeInstanceOf(Date);
    expect(data.status).toBe('PENDING');
  });

  it('but an anonymous poll may NOT stamp version / manager / OTA even here', async () => {
    const { controller, prisma, screen } = harness(makeRow('unpaired'));

    await controller.deviceStatus(screen.deviceFingerprint, '9.9.9', '999', '6.6.6', anonReq());

    const data = writtenData(prisma)!;
    // Liveness only — nothing fleet-visible.
    expect(Object.keys(data).sort()).toEqual(['lastPingAt', 'status']);
  });

  it('a credential that fails to verify DEGRADES rather than 401s (unpaired tokens live 15 min)', async () => {
    const { controller, screen } = harness(makeRow('unpaired'));

    const res: any = await controller.deviceStatus(
      screen.deviceFingerprint, undefined, undefined, undefined, deviceReq('not.a.jwt'),
    );

    expect(res.screenId).toBe(screen.id);
    expect(res.paired).toBe(false);
  });

  it('the full pairing poll → prove → claimed round trip', async () => {
    // 1. Splash polls anonymously and is told it is not yet claimed. The code
    //    is WITHHELD (DT-09) but the poll answers and liveness lands.
    const row = makeRow('unpaired');
    const before = harness(row);
    const poll1: any = await before.controller.deviceStatus(
      row.deviceFingerprint, undefined, undefined, undefined, anonReq(),
    );
    expect(poll1.paired).toBe(false);
    expect(poll1.pairingCode).toBeNull();
    expect(poll1.pairingCodeWithheld).toBe(true);
    expect(before.prisma.client.screen.update).toHaveBeenCalledTimes(1);

    // 2. The device presents the credential it holds and reads its own code.
    const proving = harness(row);
    const poll2: any = await proving.controller.deviceStatus(
      row.deviceFingerprint, undefined, undefined, undefined, deviceReq(proving.token()),
    );
    expect(poll2.pairingCode).toBe('K7QP2M');

    // 3. An operator claims it; the next poll reports paired.
    const claimed = { ...row, tenantId: 'tenant-1', pairingCode: null, status: 'ONLINE' };
    const after = harness(claimed);
    const poll3: any = await after.controller.deviceStatus(
      row.deviceFingerprint, undefined, undefined, undefined, anonReq(),
    );
    expect(poll3.paired).toBe(true);
    expect(poll3.screenId).toBe(row.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The throttle actually engages
// ─────────────────────────────────────────────────────────────────────────────

describe('per-fingerprint throttle', () => {
  it('429s an anonymous flood at the cap, with ZERO database work on the refused call', async () => {
    const { controller, prisma, screen } = harness(makeRow('unpaired'));

    for (let i = 0; i < STATUS_POLL_MAX_PER_WINDOW; i++) {
      await controller.deviceStatus(
        screen.deviceFingerprint, undefined, undefined, undefined, anonReq(),
      );
    }
    const readsBefore = prisma.client.screen.findUnique.mock.calls.length;

    const status = await statusOf(
      controller.deviceStatus(
        screen.deviceFingerprint, undefined, undefined, undefined, anonReq(),
      ),
    );
    expect(status).toBe(429);

    // The refusal must land BEFORE the `Screen.findUnique` — the whole point
    // is that a flood costs the database nothing.
    expect(prisma.client.screen.findUnique.mock.calls.length).toBe(readsBefore);
  });

  it('does not leak across fingerprints — one screen cannot exhaust another', async () => {
    const a = harness(makeRow('unpaired'));
    for (let i = 0; i < STATUS_POLL_MAX_PER_WINDOW; i++) {
      await a.controller.deviceStatus(
        a.screen.deviceFingerprint, undefined, undefined, undefined, anonReq(),
      );
    }

    const b = harness(makeRow('paired'));
    await expect(
      b.controller.deviceStatus(
        b.screen.deviceFingerprint, undefined, undefined, undefined, anonReq(),
      ),
    ).resolves.toMatchObject({ screenId: b.screen.id });
  });

  it('a verified device credential is NOT starved by a fingerprint flood', async () => {
    const { controller, screen, token } = harness(makeRow('paired'));
    for (let i = 0; i < STATUS_POLL_MAX_PER_WINDOW + 5; i++) {
      // Burn the fingerprint's budget anonymously, the way a stranger would.
      await statusOf(
        controller.deviceStatus(
          screen.deviceFingerprint, undefined, undefined, undefined, anonReq(),
        ),
      );
    }

    // The real screen still gets through, because it holds the credential.
    await expect(
      controller.deviceStatus(
        screen.deviceFingerprint, undefined, undefined, undefined, deviceReq(token()),
      ),
    ).resolves.toMatchObject({ screenId: screen.id });
  });

  it('leaves the preview short-circuit above the throttle untouched', async () => {
    const { controller, prisma } = harness(makeRow('paired'));
    for (let i = 0; i < STATUS_POLL_MAX_PER_WINDOW + 5; i++) {
      const res: any = await controller.deviceStatus(
        'preview-abc', undefined, undefined, undefined, anonReq(),
      );
      expect(res.isPreview).toBe(true);
    }
    expect(prisma.client.screen.findUnique).not.toHaveBeenCalled();
  });
});
