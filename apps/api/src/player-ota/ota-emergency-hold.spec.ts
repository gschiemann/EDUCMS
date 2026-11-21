/**
 * FLT-04 (launch audit 2026-11-21) — no app install while an alert is on the glass.
 *
 * Before this change `POST /player/update-check` read no emergency state at
 * all: an operator push, a field-build push, an automatic offer or a panel
 * tap handed the device an APK during a lockdown, and the package replace
 * took the alert off the glass until the new build relaunched. These specs
 * drive the REAL handler and pin:
 *   • held during a tenant alert, an ancestor (district) alert, a drill, a
 *     per-screen override, a pushed message, and an alert the screen itself
 *     reports painting — with the answer every shipped build reads as
 *     "up to date" (`{ uptoDate: true, heldFor: 'emergency' }`, no `latest`);
 *   • a held push is DEFERRED: nothing counted, audited or cleared, and the
 *     same push is offered on the first check after the all-clear;
 *   • unreadable emergency state holds (fail-closed);
 *   • OTA_EMERGENCY_HOLD_DISABLED=1 restores the old behaviour exactly;
 *   • the Manager bootstrap (no Player installed) is not held, and the
 *     re-opened legacy Manager lane is.
 * Every "held" case below fails on the code before this change: it offered.
 */
import { PlayerOtaController } from './player-ota.controller';
import * as field from './field-candidate';
import {
  OTA_GLASS_EMERGENCY_PROOF_MS,
  glassReportsEmergency,
  heldForEmergencyAnswer,
  otaEmergencyHoldDisabled,
  resolveOtaEmergencyHold,
} from './ota-emergency-hold';
import { legacyWorkerWouldDownload } from './manager-update-lane';

const SCREEN = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const DISTRICT = '33333333-3333-4333-8333-333333333333';
const GROUP = '44444444-4444-4444-8444-444444444444';
const MIN = 60_000;
const realFetch = global.fetch;
const saved = { ...process.env };

const release = {
  versionName: '1.1.41-field.1',
  versionCode: 10141,
  sha256: 'b'.repeat(64),
  size: 8,
  sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/1',
};

const HELD = { uptoDate: true, heldFor: 'emergency' };

/** Emergency facts the hold reads, mutable per test. */
interface EmState {
  override: any;
  tenants: Record<string, any>;
  messages: any[];
  fail: null | 'override' | 'tenant' | 'message';
}
const calm = (): EmState => ({
  override: null,
  tenants: {
    [TENANT]: {
      id: TENANT,
      parentId: DISTRICT,
      archivedAt: null,
      emergencyStatus: 'INACTIVE',
      emergencyIsDrill: false,
    },
    [DISTRICT]: {
      id: DISTRICT,
      parentId: null,
      archivedAt: null,
      emergencyStatus: 'INACTIVE',
      emergencyIsDrill: false,
    },
  },
  messages: [],
  fail: null,
});

function emergencyDelegates(em: EmState) {
  return {
    screenEmergencyOverride: {
      findUnique: jest.fn(async () => {
        if (em.fail === 'override') throw new Error('pool timeout');
        return em.override;
      }),
    },
    tenant: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (em.fail === 'tenant') throw new Error('pool timeout');
        return em.tenants[where.id] ?? null;
      }),
    },
    emergencyMessage: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (em.fail === 'message') throw new Error('pool timeout');
        // The where is the device poll's own (tenant-scoped); a row here is
        // "an active message this screen may see".
        expect(where.tenantId).toBe(TENANT);
        expect(where.clearedAt).toBeNull();
        return em.messages[0] ?? null;
      }),
    },
  };
}

function screenRow(over: Record<string, unknown> = {}) {
  return {
    id: SCREEN,
    tenantId: TENANT,
    name: 'Gym lobby',
    status: 'ONLINE',
    screenGroupId: GROUP,
    autoUpdatePlayerOverride: null,
    playerVersionCode: 10123,
    forceApkUpdatePendingAt: new Date(Date.now() - 5 * MIN),
    forceApkUpdateOverrideWindow: true,
    forceApkUpdateHold: null,
    forceApkUpdateOfferCount: 0,
    forceApkUpdateLastOfferAt: null,
    forceApkUpdateTargetVersion: null,
    forceApkUpdateTargetVersionCode: null,
    lastOtaState: null,
    lastOtaMessage: null,
    lastOtaAt: null,
    lastRenderedHash: 'pl:abc123',
    lastRenderedAt: new Date(),
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

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date
    ? a != null &&
      b != null &&
      new Date(a as any).getTime() === new Date(b as any).getTime()
    : a === b;

/** The real controller over ONE mutable screen row and a mutable emergency state. */
function harness(initial: any, em: EmState, opts: { auth?: boolean } = {}) {
  const row: any = { ...initial };
  const updateMany = jest.fn(async ({ where, data }: any) => {
    const matches = Object.entries(where).every(([k, v]) =>
      sameValue(row[k], v),
    );
    if (!matches) return { count: 0 };
    for (const [k, v] of Object.entries(data)) {
      row[k] =
        v && typeof v === 'object' && 'increment' in (v as any)
          ? (Number(row[k]) || 0) + (v as any).increment
          : v;
    }
    return { count: 1 };
  });
  const prisma: any = {
    client: {
      ...emergencyDelegates(em),
      screen: {
        findFirst: jest.fn(async () => ({ ...row })),
        update: jest.fn().mockResolvedValue({}),
        updateMany,
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
  jest
    .spyOn(c as any, 'isDeviceAuthenticated')
    .mockResolvedValue(opts.auth ?? true);
  jest.spyOn(c as any, 'persistReportedVersion').mockResolvedValue(undefined);
  const lines: string[] = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    jest.spyOn((c as any).logger, level).mockImplementation((m: any) => {
      lines.push(String(m));
    });
  }
  return { c, prisma, row, lines };
}

const req = {
  headers: {},
  protocol: 'https',
  get: () => 'api.example.test',
} as any;
const playerBody = {
  fingerprint: 'android-gym',
  versionCode: 10123,
  versionName: '1.1.23',
  abi: 'armeabi-v7a',
} as any;
const audits = (prisma: any, action: string) =>
  prisma.client.auditLog.create.mock.calls
    .map((x: any) => x[0].data)
    .filter((d: any) => d.action === action);

beforeEach(() => {
  // Hermetic: no GitHub. An empty catalogue answers "no release" — enough to
  // see whether a check got past the hold to the release lookup at all.
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => [] }) as any;
  delete process.env.OTA_EMERGENCY_HOLD_DISABLED;
  delete process.env.MANAGER_SELF_UPDATE_LEGACY_LANE;
  process.env.DEVICE_SECRET_KEY = 'fake-test-key';
});
afterEach(() => {
  jest.restoreAllMocks();
  process.env = { ...saved };
  global.fetch = realFetch;
});

// ─────────────────────────────────────────────────────────────────────────
// A pushed field build (the private, exact-screen offer) — the path that
// returns a full `latest` answer without GitHub, so "offered" is visible.
// ─────────────────────────────────────────────────────────────────────────
describe('a pushed build during an alert (field-build push)', () => {
  beforeEach(() => {
    process.env.PLAYER_APK_FIELD_CANDIDATE = release.versionName;
    process.env.PLAYER_APK_FIELD_TENANT_ID = TENANT;
    process.env.PLAYER_APK_FIELD_SCREEN_IDS = SCREEN;
    process.env.PLAYER_APK_FIELD_EXPIRES_AT = new Date(
      Date.now() + 60 * MIN,
    ).toISOString();
    jest.spyOn(field, 'configuredFieldRelease').mockReturnValue(release as any);
  });

  it('control: with no alert anywhere the push is offered (the harness can see an offer)', async () => {
    const bytes = jest
      .spyOn(field, 'verifiedFieldBytes')
      .mockResolvedValue(Buffer.alloc(8));
    const { c, row } = harness(screenRow(), calm());
    const res: any = await c.updateCheck(playerBody, req);
    expect(res.latest?.versionName).toBe(release.versionName);
    expect(bytes).toHaveBeenCalled();
    expect(row.forceApkUpdateOfferCount).toBe(1);
  });

  it('tenant alert: held with the up-to-date shape; push untouched — not counted, not audited, not cleared', async () => {
    const bytes = jest
      .spyOn(field, 'verifiedFieldBytes')
      .mockResolvedValue(Buffer.alloc(8));
    const em = calm();
    em.tenants[TENANT].emergencyStatus = 'CRITICAL';
    const initial = screenRow();
    const { c, row, prisma, lines } = harness(initial, em);

    const res: any = await c.updateCheck(playerBody, req);

    expect(res).toEqual(HELD);
    expect(res.latest).toBeUndefined();
    // Every shipped Manager/Player reads "no latest" as up to date.
    expect(legacyWorkerWouldDownload(res, playerBody.versionCode)).toBe(false);
    // Nothing resolved, nothing audited, the push record exactly as it was.
    expect(bytes).not.toHaveBeenCalled();
    expect(audits(prisma, 'PLAYER_FIELD_APK_OFFER')).toHaveLength(0);
    expect(prisma.client.screen.updateMany).not.toHaveBeenCalled();
    expect(row.forceApkUpdatePendingAt).toEqual(
      initial.forceApkUpdatePendingAt,
    );
    expect(row.forceApkUpdateOfferCount).toBe(0);
    expect(row.forceApkUpdateHold).toBeNull();
    expect(lines.join('\n')).toMatch(
      /decision=uptoDate-held-for-emergency .*source=tenant .*push stays pending/,
    );
  });

  it('the held push is offered on the first check after the all-clear (deferred, never dropped)', async () => {
    jest.spyOn(field, 'verifiedFieldBytes').mockResolvedValue(Buffer.alloc(8));
    const em = calm();
    em.tenants[TENANT].emergencyStatus = 'CRITICAL';
    const { c, row, prisma } = harness(screenRow(), em);

    expect(await c.updateCheck(playerBody, req)).toEqual(HELD);
    expect(await c.updateCheck(playerBody, req)).toEqual(HELD);

    em.tenants[TENANT].emergencyStatus = 'INACTIVE'; // all-clear
    const after: any = await c.updateCheck(playerBody, req);
    expect(after.latest?.versionName).toBe(release.versionName);
    expect(row.forceApkUpdateOfferCount).toBe(1);
    expect(row.forceApkUpdateTargetVersionCode).toBe(release.versionCode);
    expect(audits(prisma, 'PLAYER_FIELD_APK_OFFER')).toHaveLength(1);
  });

  it('ancestor (district) alert: held', async () => {
    jest.spyOn(field, 'verifiedFieldBytes').mockResolvedValue(Buffer.alloc(8));
    const em = calm();
    em.tenants[DISTRICT].emergencyStatus = 'HIGH';
    const { c, lines } = harness(screenRow(), em);
    expect(await c.updateCheck(playerBody, req)).toEqual(HELD);
    expect(lines.join('\n')).toContain('source=ancestor');
  });

  it('drill: held exactly like a live alert', async () => {
    jest.spyOn(field, 'verifiedFieldBytes').mockResolvedValue(Buffer.alloc(8));
    const em = calm();
    em.tenants[TENANT].emergencyStatus = 'HIGH';
    em.tenants[TENANT].emergencyIsDrill = true;
    const { c } = harness(screenRow(), em);
    expect(await c.updateCheck(playerBody, req)).toEqual(HELD);
  });

  it('per-screen override: held while it runs; offered once it has expired', async () => {
    jest.spyOn(field, 'verifiedFieldBytes').mockResolvedValue(Buffer.alloc(8));
    const em = calm();
    em.override = {
      screenId: SCREEN,
      type: 'LOCKDOWN',
      expiresAt: new Date(Date.now() + 10 * MIN),
    };
    const { c, lines } = harness(screenRow(), em);
    expect(await c.updateCheck(playerBody, req)).toEqual(HELD);
    expect(lines.join('\n')).toContain('source=screen');

    em.override = {
      screenId: SCREEN,
      type: 'LOCKDOWN',
      expiresAt: new Date(Date.now() - MIN),
    };
    const after: any = await c.updateCheck(playerBody, req);
    expect(after.latest).toBeDefined();
  });

  it('a pushed message the screen may see (broadcast, SOS, district copy): held', async () => {
    jest.spyOn(field, 'verifiedFieldBytes').mockResolvedValue(Buffer.alloc(8));
    const em = calm();
    em.messages = [{ id: 'msg-1' }];
    const { c, lines } = harness(screenRow(), em);
    expect(await c.updateCheck(playerBody, req)).toEqual(HELD);
    expect(lines.join('\n')).toContain('source=message');
  });

  it("the screen's own fresh render proof shows an alert: held even when the server records none", async () => {
    jest.spyOn(field, 'verifiedFieldBytes').mockResolvedValue(Buffer.alloc(8));
    const { c, lines, prisma } = harness(
      screenRow({
        lastRenderedHash: 'em:lockdown-1',
        lastRenderedAt: new Date(Date.now() - MIN),
      }),
      calm(),
    );
    expect(await c.updateCheck(playerBody, req)).toEqual(HELD);
    expect(lines.join('\n')).toContain('source=glass');
    // The device's own evidence answers first — no emergency query needed.
    expect(
      prisma.client.screenEmergencyOverride.findUnique,
    ).not.toHaveBeenCalled();
  });

  it.each(['override', 'tenant', 'message'] as const)(
    'unreadable emergency state (%s read fails): held — an update delayed is safe',
    async (fail) => {
      jest
        .spyOn(field, 'verifiedFieldBytes')
        .mockResolvedValue(Buffer.alloc(8));
      const em = calm();
      em.fail = fail;
      const { c, row } = harness(screenRow(), em);
      expect(await c.updateCheck(playerBody, req)).toEqual(HELD);
      expect(row.forceApkUpdateOfferCount).toBe(0);
    },
  );

  it.each(['1', 'true', 'YES'])(
    'kill switch OTA_EMERGENCY_HOLD_DISABLED=%s: offered during an alert, nothing read',
    async (v) => {
      jest
        .spyOn(field, 'verifiedFieldBytes')
        .mockResolvedValue(Buffer.alloc(8));
      process.env.OTA_EMERGENCY_HOLD_DISABLED = v;
      const em = calm();
      em.tenants[TENANT].emergencyStatus = 'CRITICAL';
      em.fail = 'override'; // would hold if anything were read
      const { c, prisma } = harness(screenRow(), em);
      const res: any = await c.updateCheck(playerBody, req);
      expect(res.latest?.versionName).toBe(release.versionName);
      expect(res.heldFor).toBeUndefined();
      expect(
        prisma.client.screenEmergencyOverride.findUnique,
      ).not.toHaveBeenCalled();
      expect(prisma.client.emergencyMessage.findFirst).not.toHaveBeenCalled();
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────
// The stable path (GitHub catalogue): the hold answers before any release
// lookup. The catalogue is empty and cached per module, so "got past the
// hold" is read from the controller's own decision line, not from fetch.
// ─────────────────────────────────────────────────────────────────────────
describe('stable channel offers during an alert', () => {
  beforeEach(() => {
    delete process.env.PLAYER_APK_FIELD_CANDIDATE;
    delete process.env.PLAYER_APK_FIELD_TENANT_ID;
    delete process.env.PLAYER_APK_FIELD_SCREEN_IDS;
    delete process.env.PLAYER_APK_FIELD_EXPIRES_AT;
    (
      (PlayerOtaController as any).userTapAuditAt as Map<string, number>
    ).clear();
  });

  it('operator push: held before any release lookup; offered after the all-clear', async () => {
    const em = calm();
    em.tenants[TENANT].emergencyStatus = 'CRITICAL';
    const { c, lines } = harness(
      screenRow({ forceApkUpdateOverrideWindow: false }),
      em,
    );
    expect(await c.updateCheck(playerBody, req)).toEqual(HELD);
    expect(lines.join('\n')).toContain('decision=uptoDate-held-for-emergency');
    expect(lines.join('\n')).not.toContain('decision=offer-latest');

    em.tenants[TENANT].emergencyStatus = 'INACTIVE';
    lines.length = 0;
    const after: any = await c.updateCheck(playerBody, req);
    expect(after.heldFor).toBeUndefined();
    expect(lines.join('\n')).toContain('decision=offer-latest');
    expect(lines.join('\n')).not.toContain('held-for-emergency');
  });

  it('panel tap during a lockdown: held, and no PANEL_USER_UPDATE row (nothing was updated)', async () => {
    const em = calm();
    em.tenants[TENANT].emergencyStatus = 'CRITICAL';
    const { c, prisma, lines } = harness(
      screenRow({ forceApkUpdatePendingAt: null }),
      em,
    );
    const res = await c.updateCheck({ ...playerBody, source: 'user' }, req);
    expect(res).toEqual(HELD);
    expect(audits(prisma, 'PANEL_USER_UPDATE')).toHaveLength(0);
    expect(lines.join('\n')).toMatch(
      /held-for-emergency .*would-have=panel-user-tap/,
    );
  });

  it('automatic off-hours offer during an overnight weather alert: held', async () => {
    const em = calm();
    em.tenants[DISTRICT].emergencyStatus = 'HIGH';
    const { c, lines } = harness(
      screenRow({
        forceApkUpdatePendingAt: null,
        tenant: { ...screenRow().tenant, autoUpdatePlayerEnabled: true },
      }),
      em,
    );
    jest
      .spyOn(c as any, 'automaticOfferFor')
      .mockResolvedValue({ offer: true, reason: 'auto-silent-off-hours' });
    expect(await c.updateCheck(playerBody, req)).toEqual(HELD);
    expect(lines.join('\n')).toMatch(
      /held-for-emergency .*source=ancestor .*would-have=auto-silent-off-hours/,
    );
  });

  it('the Manager bootstrap (no Player installed, versionCode 0) is NOT held: that install puts the alert on the glass', async () => {
    const em = calm();
    em.tenants[TENANT].emergencyStatus = 'CRITICAL';
    const { c, lines } = harness(
      screenRow({ forceApkUpdatePendingAt: null }),
      em,
    );
    const res: any = await c.updateCheck(
      {
        fingerprint: 'android-gym',
        versionCode: 0,
        versionName: '0',
        source: 'manager',
      } as any,
      req,
    );
    expect(res.heldFor).toBeUndefined();
    expect(lines.join('\n')).toContain('bootstrap-bypass');
    expect(lines.join('\n')).toMatch(
      /decision=offer-latest .*reason=bootstrap-bypass/,
    );
    expect(lines.join('\n')).not.toContain('held-for-emergency');
  });

  it('no offer to make (no push, auto off): the answer is unchanged and no emergency state is read', async () => {
    const em = calm();
    em.tenants[TENANT].emergencyStatus = 'CRITICAL';
    const { c, prisma } = harness(
      screenRow({ forceApkUpdatePendingAt: null }),
      em,
    );
    expect(await c.updateCheck(playerBody, req)).toEqual({ uptoDate: true });
    expect(
      prisma.client.screenEmergencyOverride.findUnique,
    ).not.toHaveBeenCalled();
  });
});

describe('the Manager self-update lane', () => {
  const mgrBody = {
    fingerprint: 'android-gym',
    versionCode: 10024,
    versionName: '1.0.24',
  } as any;

  it('retired lane (default): unchanged answer, nothing read', async () => {
    const em = calm();
    em.tenants[TENANT].emergencyStatus = 'CRITICAL';
    const { c, prisma } = harness(screenRow(), em);
    expect(await c.managerUpdateCheck(mgrBody, req)).toEqual({
      uptoDate: true,
      installVia: 'player',
    });
    expect(
      prisma.client.screenEmergencyOverride.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('re-opened legacy lane: held during an alert before any release lookup; looked up again after the all-clear', async () => {
    process.env.MANAGER_SELF_UPDATE_LEGACY_LANE = 'on';
    const em = calm();
    em.tenants[TENANT].emergencyStatus = 'CRITICAL';
    const { c, lines } = harness(screenRow(), em);
    const res = await c.managerUpdateCheck(mgrBody, req);
    expect(res).toEqual(HELD);
    expect(legacyWorkerWouldDownload(res as any, mgrBody.versionCode)).toBe(
      false,
    );
    expect(lines.join('\n')).toMatch(
      /\[mgr-ota\] decision=uptoDate-held-for-emergency .*source=tenant/,
    );

    em.tenants[TENANT].emergencyStatus = 'INACTIVE';
    lines.length = 0;
    const after: any = await c.managerUpdateCheck(mgrBody, req);
    expect(after.heldFor).toBeUndefined();
    // Past the hold: the lane resolved the (empty) catalogue as before.
    expect(lines.join('\n')).toContain(
      '[mgr-ota] decision=uptoDate-no-release',
    );
  });

  it('re-opened legacy lane: a failed screen lookup holds', async () => {
    process.env.MANAGER_SELF_UPDATE_LEGACY_LANE = 'on';
    const { c, prisma } = harness(screenRow(), calm());
    prisma.client.screen.findFirst.mockRejectedValueOnce(
      new Error('pool timeout'),
    );
    expect(await c.managerUpdateCheck(mgrBody, req)).toEqual(HELD);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The pure pieces.
// ─────────────────────────────────────────────────────────────────────────
describe('ota-emergency-hold pieces', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');

  it('the held answer is the up-to-date shape plus heldFor', () => {
    expect(heldForEmergencyAnswer()).toEqual(HELD);
  });

  it('kill switch accepts exactly 1 / true / yes (any case, trimmed)', () => {
    for (const v of ['1', 'true', 'TRUE', ' yes '])
      expect(otaEmergencyHoldDisabled({ OTA_EMERGENCY_HOLD_DISABLED: v })).toBe(
        true,
      );
    for (const v of [undefined, '', '0', 'false', 'off', 'disable']) {
      expect(otaEmergencyHoldDisabled({ OTA_EMERGENCY_HOLD_DISABLED: v })).toBe(
        false,
      );
    }
  });

  it('glass evidence: an em:/pending|em:/unconfirmed|em: proof inside the window counts; content, idle or stale does not', () => {
    const fresh = new Date(now - MIN);
    expect(glassReportsEmergency('em:x', fresh, now)).toBe(true);
    expect(glassReportsEmergency('pending|em:x', fresh, now)).toBe(true);
    expect(glassReportsEmergency('unconfirmed|em:x', fresh, now)).toBe(true);
    expect(glassReportsEmergency('pl:x', fresh, now)).toBe(false);
    expect(glassReportsEmergency('idle:content-unavailable', fresh, now)).toBe(
      false,
    );
    expect(glassReportsEmergency(null, fresh, now)).toBe(false);
    expect(glassReportsEmergency('em:x', null, now)).toBe(false);
    expect(
      glassReportsEmergency(
        'em:x',
        new Date(now - OTA_GLASS_EMERGENCY_PROOF_MS - 1),
        now,
      ),
    ).toBe(false);
  });

  it('an unpaired screen (no tenant) is not held and no message query runs', async () => {
    const em = calm();
    const prisma: any = { client: emergencyDelegates(em) };
    const v = await resolveOtaEmergencyHold(
      prisma,
      { id: SCREEN, tenantId: null },
      { env: {}, now: new Date(now) },
    );
    expect(v).toEqual({ held: false, source: null, disabled: false });
    expect(prisma.client.emergencyMessage.findFirst).not.toHaveBeenCalled();
  });

  it("the message query is the device poll's own scope: tenant, group, this screen, not cleared, not expired", async () => {
    const em = calm();
    const prisma: any = { client: emergencyDelegates(em) };
    await resolveOtaEmergencyHold(
      prisma,
      { id: SCREEN, tenantId: TENANT, screenGroupId: GROUP },
      { env: {}, now: new Date(now) },
    );
    const where =
      prisma.client.emergencyMessage.findFirst.mock.calls[0][0].where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.clearedAt).toBeNull();
    expect(JSON.stringify(where.AND)).toContain(SCREEN);
    expect(JSON.stringify(where.AND)).toContain(GROUP);
    expect(JSON.stringify(where.OR)).toContain(new Date(now).toISOString());
  });
});
