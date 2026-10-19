import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppRole } from '@cms/database';

import { ROLES_KEY } from '../auth/roles.decorator';
import { openCredentials } from '../streaming/creds-cipher';
import { DeviceSettingsController } from './device-settings.controller';

/**
 * The operator half against an in-memory screen + row: who may read and
 * write, tenant scoping, the optimistic revision (an identity is never
 * issued twice), the audit row's before/after, and the passphrase rules
 * (sealed at rest, never returned, never in the audit).
 */

type Row = {
  screenId: string;
  tenantId: string;
  revision: number;
  settings: unknown;
  wifiSecret: string | null;
  report: unknown;
  reportChangedAt: Date | null;
  updatedByUserId?: string | null;
};

function harness(opts: { row?: Row | null; screenTenant?: string | null; face?: string | null } = {}) {
  let row: Row | null = opts.row ?? null;
  const screenRow = {
    id: 'screen-1',
    tenantId: opts.screenTenant === undefined ? 'tenant-a' : opts.screenTenant,
    faceOfScreenId: opts.face ?? null,
    deviceSettingsRev: row?.revision ?? 0,
    deviceSettingsReportAt: new Date('2026-10-18T11:59:00.000Z'),
  };
  const audits: Array<{ action: string; userId: string | null; details: Record<string, unknown> }> = [];
  const concurrent = { bumpBeforeWrite: 0 };
  const desiredDeviceSettings = {
    // Every read is scoped: the screen id AND the tenant.
    findFirst: jest.fn(async ({ where }: { where: { screenId: string; tenantId: string } }) =>
      row && row.screenId === where.screenId && row.tenantId === where.tenantId ? row : null,
    ),
    findUnique: jest.fn(async () => {
      throw new Error('the operator path must never read a settings row by the bare screen id');
    }),
    updateMany: jest.fn(async ({ where, data }: { where: { screenId: string; tenantId: string; revision: number }; data: Partial<Row> }) => {
      if (concurrent.bumpBeforeWrite > 0) {
        concurrent.bumpBeforeWrite -= 1;
        row = { ...(row as Row), revision: (row as Row).revision + 1 };
      }
      if (!row || row.tenantId !== where.tenantId || row.revision !== where.revision) return { count: 0 };
      row = { ...row, ...data } as Row;
      return { count: 1 };
    }),
    create: jest.fn(async ({ data }: { data: Row }) => {
      // The primary key is the screen id, whatever tenant the row is filed under.
      if (row && row.screenId === data.screenId) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      row = { report: null, reportChangedAt: null, ...data } as Row;
      return row;
    }),
  };
  const screen = {
    findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId: { in: string[] } } }) =>
      where.id === screenRow.id && screenRow.tenantId !== null && where.tenantId.in.includes(screenRow.tenantId)
        ? screenRow
        : null,
    ),
    updateMany: jest.fn(async ({ where, data }: { where: { id: string; tenantId: string }; data: { deviceSettingsRev: number } }) => {
      if (where.id !== screenRow.id || where.tenantId !== screenRow.tenantId) return { count: 0 };
      screenRow.deviceSettingsRev = data.deviceSettingsRev;
      return { count: 1 };
    }),
    update: jest.fn(async () => {
      throw new Error('the operator path must never write the screen row by the bare id');
    }),
  };
  const auditLog = {
    create: jest.fn(async ({ data }: { data: { action: string; userId: string | null; details: string } }) => {
      audits.push({ action: data.action, userId: data.userId, details: JSON.parse(data.details) });
      return {};
    }),
  };
  // tenant-a's child locations (a district's schools).
  const tenant = {
    findMany: jest.fn(async ({ where }: { where: { parentId: string } }) =>
      where.parentId === 'district-a' ? [{ id: 'tenant-a' }] : [],
    ),
  };
  const client = {
    desiredDeviceSettings,
    screen,
    auditLog,
    tenant,
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ desiredDeviceSettings, screen }),
  };
  const controller = new DeviceSettingsController({ client } as never);
  return {
    controller,
    screenRow,
    audits,
    concurrent,
    desiredDeviceSettings,
    get row() {
      return row;
    },
  };
}

const admin = { user: { id: 'u-1', role: AppRole.SCHOOL_ADMIN, tenantId: 'tenant-a' } };
const otherTenant = { user: { id: 'u-9', role: AppRole.SCHOOL_ADMIN, tenantId: 'tenant-b' } };

async function status(p: Promise<unknown>): Promise<{ status: number; code?: string }> {
  try {
    await p;
    return { status: 200 };
  } catch (e) {
    const h = e as HttpException;
    const body = h.getResponse?.() as { code?: string } | undefined;
    return { status: h.getStatus?.() ?? 500, code: body?.code };
  }
}

describe('DeviceSettingsController — roles', () => {
  const reflector = new Reflector();
  it('reading is open to contributors; writing takes the same roles as display control', () => {
    expect(reflector.get(ROLES_KEY, DeviceSettingsController.prototype.get)).toEqual([
      AppRole.SUPER_ADMIN,
      AppRole.DISTRICT_ADMIN,
      AppRole.SCHOOL_ADMIN,
      AppRole.CONTRIBUTOR,
    ]);
    expect(reflector.get(ROLES_KEY, DeviceSettingsController.prototype.put)).toEqual([
      AppRole.SUPER_ADMIN,
      AppRole.DISTRICT_ADMIN,
      AppRole.SCHOOL_ADMIN,
    ]);
  });
});

describe('DeviceSettingsController — scope', () => {
  it('another organisation gets a 404, never a 403', async () => {
    const h = harness();
    expect(await status(h.controller.get('screen-1', otherTenant))).toEqual({ status: 404, code: 'SCREEN_NOT_FOUND' });
    expect(await status(h.controller.put('screen-1', otherTenant, { brightness: 80 }))).toEqual({
      status: 404,
      code: 'SCREEN_NOT_FOUND',
    });
    expect(h.desiredDeviceSettings.create).not.toHaveBeenCalled();
  });

  it('a district admin reaches a screen at one of its locations', async () => {
    const h = harness();
    const district = { user: { id: 'u-2', role: AppRole.DISTRICT_ADMIN, tenantId: 'district-a' } };
    const res = await h.controller.put('screen-1', district, { volume: 40 });
    expect(res.desired.volume).toMatchObject({ value: 40 });
    expect(h.audits[0].userId).toBe('u-2');
  });

  it('a side of a double-sided unit is set on its main side', async () => {
    const h = harness({ face: 'screen-0' });
    expect(await status(h.controller.put('screen-1', admin, { brightness: 80 }))).toEqual({
      status: 409,
      code: 'DEVICE_SETTINGS_ON_PRIMARY_SIDE',
    });
  });

  it('a row left from another organisation is never shown', async () => {
    const h = harness({
      row: {
        screenId: 'screen-1',
        tenantId: 'tenant-old',
        revision: 9,
        settings: { brightness: { v: 20, id: 'r9', at: 'x', by: null } },
        wifiSecret: 'sealed',
        report: { schema: 1, rev: 9, obs: { wifi: { ssid: 'OldSchool', approval: 'approved' } } },
        reportChangedAt: new Date(),
      },
    });
    const view = await h.controller.get('screen-1', admin);
    expect(view).toMatchObject({ revision: 0, desired: {}, report: null });
    expect(JSON.stringify(view)).not.toContain('OldSchool');
  });
});

describe('DeviceSettingsController — PUT', () => {
  it('stores the values, bumps the revision on the row AND the screen marker, and audits before/after', async () => {
    const h = harness();
    const res = await h.controller.put('screen-1', admin, { brightness: 80, screenOffTimeoutMs: 2_147_483_647 });
    expect(res.changed).toEqual(['brightness', 'screenOffTimeoutMs']);
    expect(res.revision).toBe(1);
    expect(res.desired.brightness).toMatchObject({ value: 80, id: 'r1' });
    expect(h.screenRow.deviceSettingsRev).toBe(1);
    expect(h.audits).toEqual([
      {
        action: 'SCREEN_DEVICE_SETTINGS_CHANGED',
        userId: 'u-1',
        details: {
          revision: 1,
          changed: ['brightness', 'screenOffTimeoutMs'],
          before: {},
          after: { brightness: 80, screenOffTimeoutMs: 2_147_483_647 },
        },
      },
    ]);

    // The same values again: no write, no audit, the identity stays.
    const again = await h.controller.put('screen-1', admin, { brightness: 80 });
    expect(again.changed).toEqual([]);
    expect(again.revision).toBe(1);
    expect(h.audits).toHaveLength(1);

    const third = await h.controller.put('screen-1', admin, { brightness: null, volume: 30 });
    expect(third.revision).toBe(2);
    expect(third.desired.brightness).toBeUndefined();
    expect(third.desired.volume).toMatchObject({ id: 'r2' });
    expect(third.desired.screenOffTimeoutMs).toMatchObject({ id: 'r1' });
    expect(h.audits[1].details).toMatchObject({
      before: { brightness: 80, screenOffTimeoutMs: 2_147_483_647 },
      after: { volume: 30, screenOffTimeoutMs: 2_147_483_647 },
    });
  });

  it('seals the Wi-Fi passphrase at rest and never returns or audits it', async () => {
    const h = harness();
    const res = await h.controller.put('screen-1', admin, {
      wifi: { ssid: 'Lobby', security: 'wpa2', passphrase: 'correct horse' },
    });
    expect(res.desired.wifi!.value).toEqual({ ssid: 'Lobby', security: 'wpa2', hidden: false, passphraseSaved: true });
    expect(JSON.stringify(res)).not.toContain('correct horse');
    expect(JSON.stringify(h.audits)).not.toContain('correct horse');
    expect(h.audits[0].details).toMatchObject({ wifiPassphrase: 'changed' });
    expect(h.row!.wifiSecret).not.toContain('correct horse');
    expect(openCredentials(JSON.parse(h.row!.wifiSecret!))).toEqual({ passphrase: 'correct horse' });
    expect(JSON.stringify(h.row!.settings)).not.toContain('correct horse');
  });

  it('asks for the passphrase for a secured network it has none for', async () => {
    const h = harness();
    expect(await status(h.controller.put('screen-1', admin, { wifi: { ssid: 'Lobby', security: 'wpa2' } }))).toEqual({
      status: 400,
      code: 'DEVICE_SETTINGS_WIFI_PASSPHRASE_REQUIRED',
    });
  });

  it('a concurrent change costs a retry, never a duplicated identity', async () => {
    const h = harness({
      row: { screenId: 'screen-1', tenantId: 'tenant-a', revision: 3, settings: {}, wifiSecret: null, report: null, reportChangedAt: null },
    });
    h.concurrent.bumpBeforeWrite = 1; // someone else's PUT lands between our read and our write
    const res = await h.controller.put('screen-1', admin, { volume: 40 });
    expect(res.revision).toBe(5);
    expect(res.desired.volume).toMatchObject({ id: 'r5' });
    expect(h.desiredDeviceSettings.updateMany).toHaveBeenCalledTimes(2);
  });

  it('gives up with a clear 409 when it keeps losing the race', async () => {
    const h = harness({
      row: { screenId: 'screen-1', tenantId: 'tenant-a', revision: 3, settings: {}, wifiSecret: null, report: null, reportChangedAt: null },
    });
    h.concurrent.bumpBeforeWrite = 99;
    expect(await status(h.controller.put('screen-1', admin, { volume: 40 }))).toEqual({
      status: 409,
      code: 'DEVICE_SETTINGS_CONFLICT',
    });
  });

  it('never reads, merges or overwrites a row still filed under the old organisation of a re-paired screen', async () => {
    const old = {
      screenId: 'screen-1',
      tenantId: 'tenant-old',
      revision: 9,
      settings: { brightness: { v: 20, id: 'r9', at: 'x', by: null } },
      wifiSecret: 'sealed-old',
      report: null,
      reportChangedAt: null,
    };
    const h = harness({ row: old });
    expect(await status(h.controller.put('screen-1', admin, { volume: 40 }))).toEqual({
      status: 409,
      code: 'DEVICE_SETTINGS_SCREEN_MOVED',
    });
    // Untouched — the unit's own heartbeat resets it (device-settings.heartbeat.spec.ts).
    expect(h.row).toEqual(old);
    expect(h.screenRow.deviceSettingsRev).toBe(9);
    expect(h.audits).toEqual([]);
  });

  it('a screen that leaves the tenant mid-write is a 404 (the transaction rolls back)', async () => {
    const h = harness();
    h.screenRow.tenantId = 'tenant-a';
    const screenApi = (h as unknown as { controller: { prisma: { client: { screen: { updateMany: jest.Mock } } } } })
      .controller.prisma.client.screen;
    screenApi.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await status(h.controller.put('screen-1', admin, { volume: 40 }))).toEqual({
      status: 404,
      code: 'SCREEN_NOT_FOUND',
    });
  });
});
