/**
 * FLT-02 (2026-11-23) — field builds go only to bench screens, and the bench
 * list fails CLOSED (fleet-push-policy.ts rule 2), through the REAL
 * update-check handler with a populated stable catalogue.
 *
 * With no PLAYER_FIELD_BENCH_SCREENS, no screen is a bench screen. A screen
 * inside an armed field window that is not a bench screen is not a field
 * target at all: it is never offered the field build, and the stable ladder
 * answers it exactly as outside a window. So an operator's "Send update" gets
 * the stable build its confirm sheet names, a panel tap works, and a screen
 * already running a field build is still offered stable when stable is newer.
 * A listed bench screen behaves exactly as before, and the lead's escape
 * PLAYER_FIELD_BENCH_FAIL_OPEN=1 restores the old reading of an unset list.
 *
 * Its own file because it needs a populated release catalogue, and the
 * catalogue is cached per module (push-tracking-already-current.spec.ts).
 */
import { createHash } from 'node:crypto';
import { PlayerOtaController } from './player-ota.controller';
import * as field from './field-candidate';
import { semverGte } from './release-policy';

const SCREEN = '11111111-1111-4111-8111-111111111111';
const OTHER_SCREEN = '33333333-3333-4333-8333-333333333333';
const TENANT = '22222222-2222-4222-8222-222222222222';
const MIN = 60_000;
const realFetch = global.fetch;
const saved = { ...process.env };

/** The stable channel: ONE published Player release, unpinned (so the fake bytes pass). */
const STABLE = '1.1.68';
const STABLE_VC = 10168;
const STABLE_BYTES = Buffer.from('test-only-stable-apk-bytes');
const STABLE_SHA = createHash('sha256').update(STABLE_BYTES).digest('hex');
const REPO_API = 'https://api.github.com/repos/gschiemann/EDUCMS';

/** The armed field candidate, above stable. */
const FIELD = {
  versionName: '1.1.69-field.1',
  versionCode: 10169,
  sha256: 'c'.repeat(64),
  size: 8,
  sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/1',
};

beforeAll(() => {
  // Hermetic GitHub: the release list, the release by tag, and its asset bytes.
  global.fetch = jest.fn(async (url: any) => {
    const u = String(url);
    if (u === `${REPO_API}/releases?per_page=30`) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            tag_name: `player-v${STABLE}`,
            assets: [
              {
                name: `venueos-player-v${STABLE}.apk`,
                browser_download_url: `https://github.com/gschiemann/EDUCMS/releases/download/player-v${STABLE}/venueos-player-v${STABLE}.apk`,
              },
            ],
          },
        ],
      };
    }
    if (u === `${REPO_API}/releases/tags/player-v${STABLE}`) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          assets: [
            {
              id: 68,
              name: `venueos-player-v${STABLE}.apk`,
              size: STABLE_BYTES.length,
              url: `${REPO_API}/releases/assets/68`,
            },
          ],
        }),
      };
    }
    if (u === `${REPO_API}/releases/assets/68`) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          STABLE_BYTES.buffer.slice(
            STABLE_BYTES.byteOffset,
            STABLE_BYTES.byteOffset + STABLE_BYTES.length,
          ),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as any;
});
afterAll(() => {
  global.fetch = realFetch;
});

beforeEach(() => {
  // A field window armed by the variables for EVERY screen of the customer
  // organisation — the shape that used to turn its own "Send update" into a
  // field install.
  process.env.PLAYER_APK_FIELD_CANDIDATE = FIELD.versionName;
  process.env.PLAYER_APK_FIELD_TENANT_ID = TENANT;
  process.env.PLAYER_APK_FIELD_SCREEN_IDS = 'all';
  process.env.PLAYER_APK_FIELD_EXPIRES_AT = new Date(
    Date.now() + 60 * MIN,
  ).toISOString();
  process.env.DEVICE_SECRET_KEY = 'fake-test-key';
  delete process.env.PLAYER_FIELD_BENCH_SCREENS;
  delete process.env.PLAYER_FIELD_BENCH_FAIL_OPEN;
  field.setActiveFieldWindow(null);
  jest.spyOn(field, 'configuredFieldRelease').mockReturnValue(FIELD as any);
  jest.spyOn(field, 'verifiedFieldBytes').mockResolvedValue(Buffer.alloc(8));
  ((PlayerOtaController as any).userTapAuditAt as Map<string, number>).clear();
});
afterEach(() => {
  jest.restoreAllMocks();
  process.env = { ...saved };
});

function screenRow(over: Record<string, unknown> = {}) {
  return {
    id: SCREEN,
    tenantId: TENANT,
    name: 'Gym',
    status: 'ONLINE',
    screenGroupId: null,
    autoUpdatePlayerOverride: null,
    playerVersionCode: 10123,
    // A tenant admin's "Send update" (screen-commands.ts armScreenApkUpdate).
    forceApkUpdatePendingAt: new Date(Date.now() - 2 * MIN),
    forceApkUpdateOverrideWindow: false,
    forceApkUpdateHold: null,
    forceApkUpdateOfferCount: 0,
    forceApkUpdateLastOfferAt: null,
    forceApkUpdateTargetVersion: null,
    forceApkUpdateTargetVersionCode: null,
    lastOtaState: null,
    lastOtaMessage: null,
    lastOtaAt: null,
    lastRenderedHash: null,
    lastRenderedAt: null,
    faceOfScreenId: null,
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

function harness(row: any) {
  const prisma: any = {
    client: {
      // No alert anywhere: the OTA emergency hold (FLT-04) reads these before
      // an install offer, and holds when it cannot.
      screenEmergencyOverride: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      tenant: {
        findUnique: jest.fn(async ({ where }: any) => ({
          id: where.id,
          parentId: null,
          archivedAt: null,
          emergencyStatus: 'INACTIVE',
        })),
      },
      emergencyMessage: { findFirst: jest.fn().mockResolvedValue(null) },
      screen: {
        findFirst: jest.fn(async () => ({ ...row })),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      screenDeviceInventory: { findUnique: jest.fn().mockResolvedValue(null) },
      displaySchedule: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    },
  };
  const c = new PlayerOtaController(prisma, {
    sismember: jest.fn().mockResolvedValue(false),
  } as any);
  jest.spyOn(c as any, 'isDeviceAuthenticated').mockResolvedValue(true);
  jest.spyOn(c as any, 'persistReportedVersion').mockResolvedValue(undefined);
  const lines: string[] = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    jest.spyOn((c as any).logger, level).mockImplementation((m: any) => {
      lines.push(String(m));
    });
  }
  return { c, prisma, lines };
}

const req = {
  headers: {},
  protocol: 'https',
  get: () => 'api.example.test',
} as any;
const check = (versionName: string, versionCode: number, source?: string) =>
  ({
    fingerprint: 'android-gym',
    versionName,
    versionCode,
    abi: 'armeabi-v7a',
    ...(source ? { source } : {}),
  }) as any;
const fieldOfferAudits = (prisma: any) =>
  prisma.client.auditLog.create.mock.calls
    .map((x: any) => x[0].data)
    .filter((d: any) => d.action === 'PLAYER_FIELD_APK_OFFER');

/** The answer is the stable build — never the field one — and no private bytes were touched. */
function expectStable(result: any, prisma: any) {
  expect(result.latest).toMatchObject({
    versionName: STABLE,
    sha256: STABLE_SHA,
    forced: false,
  });
  expect(result.latest.apkUrl).toMatch(
    new RegExp(
      `^https://api\\.example\\.test/api/v1/player/apk/v/${STABLE_VC}`,
    ),
  );
  expect(JSON.stringify(result)).not.toContain('field-apk');
  expect(field.verifiedFieldBytes).not.toHaveBeenCalled();
  expect(fieldOfferAudits(prisma)).toHaveLength(0);
}

describe('no bench list (unset or blank): no screen is a bench screen', () => {
  for (const [label, value] of [
    ['unset', undefined],
    ['blank', '  '],
  ] as const) {
    it(`${label}: a tenant admin's "Send update" inside an armed field window gets the stable build, never the field build`, async () => {
      if (value !== undefined) process.env.PLAYER_FIELD_BENCH_SCREENS = value;
      const { c, prisma, lines } = harness(screenRow());
      const result: any = await c.updateCheck(check('1.1.23', 10123), req);
      expectStable(result, prisma);
      // The push records the build it was offered: the stable one its confirm sheet named.
      expect(prisma.client.screen.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            forceApkUpdateTargetVersion: STABLE,
            forceApkUpdateTargetVersionCode: STABLE_VC,
          }),
        }),
      );
      const log = lines.join('\n');
      expect(log).toMatch(
        new RegExp(
          `\\[ota\\] field-window-not-bench screen=${SCREEN} .*reason=no-bench-list`,
        ),
      );
      expect(log).toContain(
        `decision=install-gh caller=1.1.23 target=v${STABLE}`,
      );
      expect(log).not.toContain('install-private-field');
    });
  }

  it('a panel tap inside the window is answered from the stable ladder too (it was never a field install)', async () => {
    const { c, prisma, lines } = harness(
      screenRow({ forceApkUpdatePendingAt: null }),
    );
    const result: any = await c.updateCheck(
      check('1.1.23', 10123, 'user'),
      req,
    );
    expectStable(result, prisma);
    expect(lines.join('\n')).toMatch(
      /decision=offer-latest .*reason=panel-user-tap/,
    );
  });

  it('an anonymous fingerprint check is still never offered anything without a push', async () => {
    const { c, prisma } = harness(screenRow({ forceApkUpdatePendingAt: null }));
    jest.spyOn(c as any, 'isDeviceAuthenticated').mockResolvedValue(false);
    expect(await c.updateCheck(check('1.1.23', 10123), req)).toEqual({
      uptoDate: true,
    });
    expect(field.verifiedFieldBytes).not.toHaveBeenCalled();
    expect(fieldOfferAudits(prisma)).toHaveLength(0);
  });
});

describe('a screen that already runs a field build is never stranded', () => {
  it('the repo’s own comparison: a field build sorts below the stable release of the same version, above the one before', () => {
    expect(semverGte('1.1.67-field.1', STABLE)).toBe(false);
    expect(semverGte('1.1.68-field.1', STABLE)).toBe(false);
    expect(semverGte('1.1.69-field.1', STABLE)).toBe(true);
    // Today's stable target is behind the newest field builds on customer glass.
    expect(semverGte('1.1.67-field.1', '1.1.29')).toBe(true);
  });

  for (const [vn, vc] of [
    ['1.1.67-field.1', 10167],
    ['1.1.68-field.1', 10168],
  ] as const) {
    it(`${vn}, inside the window, not a bench screen: offered stable ${STABLE}`, async () => {
      const { c, prisma } = harness(screenRow({ playerVersionCode: vc }));
      const result: any = await c.updateCheck(check(vn, vc), req);
      expectStable(result, prisma);
      // Strictly above the caller's own versionCode, so the APK's gate proceeds.
      expect(result.latest.versionCode).toBeGreaterThan(vc);
    });

    it(`${vn}, outside any window: offered stable ${STABLE} (the window changes nothing for a customer screen)`, async () => {
      delete process.env.PLAYER_APK_FIELD_CANDIDATE;
      delete process.env.PLAYER_APK_FIELD_TENANT_ID;
      delete process.env.PLAYER_APK_FIELD_SCREEN_IDS;
      delete process.env.PLAYER_APK_FIELD_EXPIRES_AT;
      const { c, prisma } = harness(screenRow({ playerVersionCode: vc }));
      expectStable(await c.updateCheck(check(vn, vc), req), prisma);
    });
  }

  it('a field build ahead of stable is told it is current by the stable ladder — and its push ends, not held as a field push', async () => {
    const { c, prisma, lines } = harness(
      screenRow({ playerVersionCode: 10169 }),
    );
    expect(await c.updateCheck(check('1.1.69-field.1', 10169), req)).toEqual({
      uptoDate: true,
      latestVersionName: STABLE,
    });
    expect(field.verifiedFieldBytes).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain(
      'reason=caller-at-or-past-latest-published-tag',
    );
    expect(prisma.client.screen.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ forceApkUpdatePendingAt: null }),
      }),
    );
  });
});

describe('a configured bench list', () => {
  it('a listed bench screen behaves exactly as before: the pushed screen is offered the field build', async () => {
    process.env.PLAYER_FIELD_BENCH_SCREENS = `${OTHER_SCREEN}, ${SCREEN.toUpperCase()}`;
    const { c, prisma, lines } = harness(screenRow());
    const result: any = await c.updateCheck(check('1.1.23', 10123), req);
    expect(result.latest).toMatchObject({
      versionName: FIELD.versionName,
      versionCode: FIELD.versionCode,
      sha256: FIELD.sha256,
    });
    expect(result.latest.apkUrl).toContain(
      `/api/v1/player/field-apk/${FIELD.sha256}?ticket=`,
    );
    expect(fieldOfferAudits(prisma)).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('field-window-not-bench');
  });

  it('a screen the list does not name gets the stable build — no longer held on its current one', async () => {
    process.env.PLAYER_FIELD_BENCH_SCREENS = OTHER_SCREEN;
    const { c, prisma, lines } = harness(screenRow());
    expectStable(await c.updateCheck(check('1.1.23', 10123), req), prisma);
    expect(lines.join('\n')).toMatch(
      /field-window-not-bench .*reason=not-listed/,
    );
  });
});

describe('the escape PLAYER_FIELD_BENCH_FAIL_OPEN', () => {
  it.each(['1', 'true', 'YES'])(
    '=%s with no list restores the old behaviour: the pushed screen is offered the field build',
    async (on) => {
      process.env.PLAYER_FIELD_BENCH_FAIL_OPEN = on;
      const { c, prisma } = harness(screenRow());
      const result: any = await c.updateCheck(check('1.1.23', 10123), req);
      expect(result.latest).toMatchObject({
        versionName: FIELD.versionName,
        sha256: FIELD.sha256,
      });
      expect(fieldOfferAudits(prisma)).toHaveLength(1);
    },
  );

  it('never widens a list that is set: a screen the list does not name still gets stable', async () => {
    process.env.PLAYER_FIELD_BENCH_FAIL_OPEN = '1';
    process.env.PLAYER_FIELD_BENCH_SCREENS = OTHER_SCREEN;
    const { c, prisma } = harness(screenRow());
    expectStable(await c.updateCheck(check('1.1.23', 10123), req), prisma);
  });

  it('any other value keeps the gate closed', async () => {
    process.env.PLAYER_FIELD_BENCH_FAIL_OPEN = 'on';
    const { c, prisma } = harness(screenRow());
    expectStable(await c.updateCheck(check('1.1.23', 10123), req), prisma);
  });
});
