/**
 * The update-check answers that end the 48-download loop (2026-10-17,
 * unattended-updates piece 2), through the REAL handler:
 *
 *   * the companion Manager's own 30-minute check is never offered the
 *     Player APK — that check was the source of the M24's 48 downloads, and
 *     with no device owner (owner decision 2026-10-17) its install can never
 *     be silent. The vc=0 bootstrap (no Player on the device yet) is untouched;
 *   * a pending push whose screen said NEEDS_TAP is answered `uptoDate` with
 *     `needsTap: true` — nothing resolved, hashed or downloaded — until a
 *     person presses Update on the panel.
 */
import { PlayerOtaController } from './player-ota.controller';
import { isManagerLaneNoise, resetManagerLaneNoise } from './manager-lane-noise';

const SCREEN = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const MIN = 60_000;
const realFetch = global.fetch;

beforeEach(() => {
  // Hermetic: no GitHub. An empty release list means "no release" — enough
  // for every gate-level answer below.
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }) as any;
});
afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = realFetch;
  resetManagerLaneNoise();
});

function screenRow(over: Record<string, unknown> = {}) {
  return {
    id: SCREEN,
    tenantId: TENANT,
    name: 'M24',
    status: 'ONLINE',
    screenGroupId: null,
    autoUpdatePlayerOverride: null,
    playerVersionCode: 10123,
    forceApkUpdatePendingAt: new Date(Date.now() - 40 * MIN),
    forceApkUpdateOverrideWindow: true,
    lastOtaState: null,
    lastOtaAt: null,
    tenant: {
      autoUpdatePlayerEnabled: false,
      otaWindowStart: null,
      otaWindowEnd: null,
      otaWindowTimezone: null,
      canaryFleetPercent: 100,
    },
    ...over,
  };
}

function harness(row: any, auth = true) {
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
  // The version-persist side path is covered by update-check-authz.spec.ts.
  jest.spyOn(c as any, 'persistReportedVersion').mockResolvedValue(undefined);
  const lines: string[] = [];
  jest.spyOn((c as any).logger, 'log').mockImplementation((m: any) => { lines.push(String(m)); });
  jest.spyOn((c as any).logger, 'warn').mockImplementation((m: any) => { lines.push(String(m)); });
  return { c, prisma, lines };
}

const req = { headers: {}, protocol: 'https', get: () => 'api.example.test' } as any;
const playerBody = { fingerprint: 'android-m24', versionCode: 10123, versionName: '1.1.23', abi: 'armeabi-v7a' } as any;
const managerBody = { ...playerBody, source: 'manager' };

describe("the Manager's own check never installs the Player", () => {
  it('M24 SHAPE: Manager 1.0.24\'s 30-minute check with a push pending → refused before any release lookup', async () => {
    const { c, lines } = harness(screenRow());
    await expect(c.updateCheck(managerBody, req)).resolves.toEqual({ uptoDate: true, installVia: 'player' });
    expect(lines.join('\n')).toContain('decision=uptoDate-manager-check-player-installs-itself');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("the refusal is remembered, so the Manager's UP_TO_DATE echo is not stored as the Player's", async () => {
    const { c } = harness(screenRow());
    await c.updateCheck(managerBody, req);
    expect(isManagerLaneNoise('android-m24', 'UP_TO_DATE', 'v1.1.23 — no newer release offered')).toBe(true);
  });

  it('refused with no push too, whatever else it claims', async () => {
    const { c } = harness(screenRow({ forceApkUpdatePendingAt: null }));
    await expect(c.updateCheck({ ...managerBody, deviceOwner: true } as any, req))
      .resolves.toEqual({ uptoDate: true, installVia: 'player' });
  });

  it('48 Manager checks in 24 h → 0 offers, 0 downloads', async () => {
    const { c } = harness(screenRow());
    for (let i = 0; i < 48; i++) {
      const res: any = await c.updateCheck(managerBody, req);
      expect(res.latest).toBeUndefined();
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('the bootstrap call (no Player installed, vc=0) is never refused', async () => {
    const bare = harness(screenRow({ forceApkUpdatePendingAt: null }));
    await bare.c.updateCheck({ ...managerBody, versionCode: 0, versionName: '0.0.0' }, req);
    expect(bare.lines.join('\n')).toContain('bootstrap-bypass');
    expect(bare.lines.join('\n')).not.toContain('manager-check-player-installs-itself');
  });

  it("the Player's own check on the same screen is not refused", async () => {
    const { c, lines } = harness(screenRow());
    await c.updateCheck(playerBody, req);
    expect(lines.join('\n')).not.toContain('manager-check-player-installs-itself');
    expect(lines.join('\n')).toContain('decision=offer-latest');
  });
});

describe('a push the screen said NEEDS_TAP for is answered needsTap', () => {
  const tapRow = () => screenRow({ lastOtaState: 'NEEDS_TAP', lastOtaAt: new Date(Date.now() - 30 * MIN) });

  it('the Player\'s unattended check → uptoDate + needsTap, nothing resolved or downloaded', async () => {
    const { c, lines, prisma } = harness(tapRow());
    await expect(c.updateCheck(playerBody, req)).resolves.toEqual({ uptoDate: true, needsTap: true });
    expect(lines.join('\n')).toContain('decision=uptoDate-force-pending-needs-tap');
    expect(global.fetch).not.toHaveBeenCalled();
    // The push is NOT cleared: it is waiting for a person, not stalled.
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });

  it('…for an unauthenticated caller too (holding back an offer can never install anything)', async () => {
    const { c } = harness(tapRow(), false);
    await expect(c.updateCheck(playerBody, req)).resolves.toEqual({ uptoDate: true, needsTap: true });
  });

  it('a person pressing Update on the panel is offered (panel-user-tap precedes the push gate)', async () => {
    const { c, lines } = harness(tapRow());
    await c.updateCheck({ ...playerBody, source: 'user' }, req);
    expect(lines.join('\n')).toContain('reason=panel-user-tap');
    expect(lines.join('\n')).not.toContain('needs-tap');
  });

  it('a NEEDS_TAP from before the push (an earlier attempt) does not hold a NEW push', async () => {
    const { c, lines } = harness(screenRow({
      forceApkUpdatePendingAt: new Date(Date.now() - 5 * MIN),
      lastOtaState: 'NEEDS_TAP',
      lastOtaAt: new Date(Date.now() - 60 * MIN),
    }));
    await c.updateCheck(playerBody, req);
    expect(lines.join('\n')).toContain('decision=offer-latest');
  });

  it('the stalled-install and 24-hour rules are unchanged for every other state', async () => {
    const stalled = harness(screenRow({ lastOtaState: 'INSTALLING', lastOtaAt: new Date(Date.now() - 30 * MIN) }));
    await stalled.c.updateCheck(playerBody, req);
    expect(stalled.lines.join('\n')).toContain('force-pending-but-stalled-INSTALLING');
    const stale = harness(screenRow({ forceApkUpdatePendingAt: new Date(Date.now() - 25 * 60 * MIN) }));
    await stale.c.updateCheck(playerBody, req);
    expect(stale.lines.join('\n')).toContain('force-pending-stale-');
  });
});
