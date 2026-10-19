import { DEVICE_SETTING_KEYS } from '@cms/api-types';

import { sealCredentials } from '../streaming/creds-cipher';
import { applyPatch, reportSignature } from './device-settings';
import { deviceSettingsHeartbeat } from './device-settings.heartbeat';

/**
 * The heartbeat half against an in-memory row: what it reads, what it writes,
 * what it says to the unit — and, above all, that an unchanged unit costs
 * nothing and a passphrase only travels while the unit still needs it.
 */

const now = new Date('2026-10-18T12:00:00.000Z');

type Row = {
  screenId: string;
  tenantId: string;
  revision: number;
  settings: unknown;
  wifiSecret: string | null;
  report: unknown;
  reportChangedAt: Date | null;
};

function fakePrisma(initial: Row | null) {
  let row = initial;
  const audits: Array<{ action: string; details: Record<string, unknown> }> = [];
  const matches = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v);
  const desiredDeviceSettings = {
    findUnique: jest.fn(async () => row),
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => (row && matches(row, where) ? row : null)),
    // Every write names the tenant (and the reset also the revision it read).
    updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      if (!row || !('tenantId' in where) || !matches(row, where)) return { count: 0 };
      row = { ...row, ...data };
      return { count: 1 };
    }),
    create: jest.fn(async ({ data }: { data: Row }) => {
      if (row) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      row = { wifiSecret: null, ...data };
      return row;
    }),
    upsert: jest.fn(async () => {
      throw new Error('the heartbeat must not upsert by the bare screen id');
    }),
  };
  const markers: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const screen = {
    updateMany: jest.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      markers.push(args);
      return { count: 'tenantId' in args.where ? 1 : 0 };
    }),
  };
  const auditLog = {
    create: jest.fn(async ({ data }: { data: { action: string; details: string } }) => {
      audits.push({ action: data.action, details: JSON.parse(data.details) });
      return {};
    }),
  };
  return {
    prisma: { client: { desiredDeviceSettings, auditLog, screen } } as never,
    desiredDeviceSettings,
    audits,
    markers,
    get row() {
      return row;
    },
  };
}

const stored = applyPatch(
  {},
  { brightness: 80, autoTime: true, wifi: { ssid: 'Lobby', security: 'wpa2', passphrase: 'correct horse' } },
  { revision: 4, now, userId: 'u-1', hasSecret: false },
).next;
const sealed = JSON.stringify(sealCredentials({ passphrase: 'correct horse' }));
const rowAt4 = (): Row => ({
  screenId: 'screen-1',
  tenantId: 'tenant-a',
  revision: 4,
  settings: stored,
  wifiSecret: sealed,
  report: null,
  reportChangedAt: null,
});

const report = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 1, rev: 4, need: false, sdk: 33, cap: { brightness: 'ok' }, obs: { brightness: 80 }, ...over });

const screenAt = (sig: string | null, rev = 4) => ({
  id: 'screen-1',
  tenantId: 'tenant-a',
  deviceSettingsRev: rev,
  deviceSettingsReportSig: sig,
});

describe('deviceSettingsHeartbeat', () => {
  it('says nothing to an older player or a malformed header, and nothing for an unpaired screen', async () => {
    const f = fakePrisma(rowAt4());
    expect(await deviceSettingsHeartbeat(f.prisma, screenAt(null), undefined, now)).toBeNull();
    expect(await deviceSettingsHeartbeat(f.prisma, screenAt(null), '{"schema":9}', now)).toBeNull();
    expect(await deviceSettingsHeartbeat(f.prisma, { ...screenAt(null), tenantId: null }, report(), now)).toBeNull();
    expect(f.desiredDeviceSettings.findUnique).not.toHaveBeenCalled();
  });

  it('an unchanged unit holding the current set costs no query and no write', async () => {
    const f = fakePrisma(rowAt4());
    const header = report();
    const sig = reportSignature(JSON.parse(header));
    const r = await deviceSettingsHeartbeat(f.prisma, screenAt(sig), header, now);
    expect(r).toEqual({ data: { deviceSettingsReportAt: now }, mustWrite: false, reply: { schema: 1, rev: 4, same: true } });
    expect(f.desiredDeviceSettings.findUnique).not.toHaveBeenCalled();
  });

  it('nothing stored: an explicit empty set, still without a query', async () => {
    const f = fakePrisma(null);
    const header = report({ rev: 0 });
    const r = await deviceSettingsHeartbeat(f.prisma, screenAt(reportSignature(JSON.parse(header)), 0), header, now);
    expect(r!.reply).toEqual({ schema: 1, rev: 0, items: {} });
    expect(f.desiredDeviceSettings.findUnique).not.toHaveBeenCalled();
  });

  it('a unit on an older set gets the whole set — with the passphrase, because it has not finished that network', async () => {
    const f = fakePrisma(rowAt4());
    const header = report({ rev: 3 });
    const r = await deviceSettingsHeartbeat(f.prisma, screenAt(reportSignature(JSON.parse(header))), header, now);
    expect(r!.reply).toEqual({
      schema: 1,
      rev: 4,
      items: {
        brightness: { id: 'r4', v: 80 },
        autoTime: { id: 'r4', v: true },
        wifi: { id: 'r4', v: { ssid: 'Lobby', security: 'wpa2', hidden: false, passphrase: 'correct horse' } },
      },
    });
    expect(r!.mustWrite).toBe(false);
  });

  it('once the unit reports that network applied, the passphrase stops travelling', async () => {
    const f = fakePrisma(rowAt4());
    const header = report({ rev: 3, ack: { wifi: { id: 'r4', st: 'applied', n: 1 } } });
    const r = await deviceSettingsHeartbeat(f.prisma, screenAt(null), header, now);
    const items = (r!.reply as { items: Record<string, { v: unknown }> }).items;
    expect(items.wifi.v).toEqual({ ssid: 'Lobby', security: 'wpa2', hidden: false });
    expect(JSON.stringify(r)).not.toContain('correct horse');
  });

  it('a unit asking for the passphrase (need) gets the full set even on the current revision', async () => {
    const f = fakePrisma(rowAt4());
    const header = report({ need: true, ack: { wifi: { id: 'r4', st: 'pending', n: 0, why: 'needs-secret' } } });
    const r = await deviceSettingsHeartbeat(f.prisma, screenAt(reportSignature(JSON.parse(header))), header, now);
    expect(JSON.stringify(r!.reply)).toContain('correct horse');
  });

  it('a changed report is stored once, marks the row, and audits each newly applied or failed value', async () => {
    const f = fakePrisma(rowAt4());
    const header = report({
      obs: { brightness: 79 },
      ack: {
        brightness: { id: 'r4', st: 'applied', n: 1, at: 1_760_000_000_000 },
        autoTime: { id: 'r4', st: 'unsupported', n: 0, why: 'no-secure-settings' },
      },
    });
    const r = await deviceSettingsHeartbeat(f.prisma, screenAt('old-sig'), header, now);
    expect(r!.mustWrite).toBe(true);
    expect(r!.data.deviceSettingsReportSig).toBe(reportSignature(JSON.parse(header)));
    expect(f.desiredDeviceSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { screenId: 'screen-1', tenantId: 'tenant-a' } }),
    );
    expect((f.row!.report as { obs: { brightness: number } }).obs.brightness).toBe(79);
    expect(f.audits).toEqual([
      {
        action: 'SCREEN_DEVICE_SETTING_APPLIED',
        details: expect.objectContaining({ setting: 'brightness', id: 'r4', observed: 79, desired: 80 }),
      },
    ]);
    // The same report again: nothing to store, nothing to audit.
    const again = await deviceSettingsHeartbeat(f.prisma, screenAt(r!.data.deviceSettingsReportSig as string), header, now);
    expect(again!.mustWrite).toBe(false);
    expect(f.audits).toHaveLength(1);
  });

  it('every setting that settles in the same report gets its own audit row — all of them, none dropped', async () => {
    const f = fakePrisma(rowAt4());
    const ack = Object.fromEntries(DEVICE_SETTING_KEYS.map((k) => [k, { id: 'r4', st: 'applied', n: 1, at: 1_760_000_000_000 }]));
    await deviceSettingsHeartbeat(f.prisma, screenAt('old-sig'), report({ ack }), now);
    expect(f.audits.map((a) => a.details.setting)).toEqual([...DEVICE_SETTING_KEYS]);
    // The old fixed bound was 8: this test is only meaningful with more keys than that.
    expect(DEVICE_SETTING_KEYS.length).toBeGreaterThan(8);
  });

  it('moves a stale marker only from the value it read — never a blind write a newer PUT could lose', async () => {
    const f = fakePrisma({ ...rowAt4(), revision: 5 });
    const header = report();
    const r = await deviceSettingsHeartbeat(f.prisma, screenAt(null, 4), header, now);
    expect(f.markers).toEqual([{ where: { id: 'screen-1', tenantId: 'tenant-a', deviceSettingsRev: 4 }, data: { deviceSettingsRev: 5 } }]);
    // Not folded into the heartbeat's own (later, unconditional) screen write.
    expect(r!.data).not.toHaveProperty('deviceSettingsRev');
    expect((r!.reply as { rev: number }).rev).toBe(5);
  });

  it('a marker that already matches the row is never written', async () => {
    const f = fakePrisma(rowAt4());
    await deviceSettingsHeartbeat(f.prisma, screenAt(null, 4), report({ rev: 3 }), now);
    expect(f.markers).toEqual([]);
  });

  it('a screen re-paired into another organisation never receives the old intent or its Wi-Fi passphrase', async () => {
    const f = fakePrisma({ ...rowAt4(), tenantId: 'tenant-old' });
    const header = report({ rev: 4 });
    const r = await deviceSettingsHeartbeat(f.prisma, screenAt(null, 4), header, now);
    expect(f.row!.tenantId).toBe('tenant-a');
    expect(f.row!.wifiSecret).toBeNull();
    expect(f.row!.revision).toBe(5);
    expect(r!.reply).toEqual({ schema: 1, rev: 5, items: {} });
    expect(f.markers).toEqual([{ where: { id: 'screen-1', tenantId: 'tenant-a', deviceSettingsRev: 4 }, data: { deviceSettingsRev: 5 } }]);
    expect(JSON.stringify(r)).not.toContain('correct horse');
    expect(f.audits[0]).toMatchObject({
      action: 'SCREEN_DEVICE_SETTINGS_CHANGED',
      details: { reason: 'screen-moved-tenant', revision: 5 },
    });
  });

  it('a reset never wipes a save the new organisation made in between', async () => {
    const f = fakePrisma({ ...rowAt4(), tenantId: 'tenant-old' });
    // The new organisation's PUT lands between this beat's read and its reset.
    const fresh: Row = { ...rowAt4(), tenantId: 'tenant-a', revision: 5, wifiSecret: null };
    f.desiredDeviceSettings.findUnique.mockResolvedValueOnce({ ...rowAt4(), tenantId: 'tenant-old' });
    f.desiredDeviceSettings.findFirst.mockResolvedValueOnce(fresh);
    f.desiredDeviceSettings.updateMany.mockResolvedValueOnce({ count: 0 });
    const r = await deviceSettingsHeartbeat(f.prisma, screenAt(null, 4), report({ rev: 4 }), now);
    expect((r!.reply as { rev: number; items: Record<string, unknown> }).rev).toBe(5);
    expect(Object.keys((r!.reply as { items: Record<string, unknown> }).items)).toEqual(['brightness', 'autoTime', 'wifi']);
    expect(f.audits.filter((a) => a.details.reason === 'screen-moved-tenant')).toEqual([]);
  });

  it('a first report creates the row under the screen’s own tenant; a lost create race moves no signature', async () => {
    const f = fakePrisma(null);
    const header = report({ rev: 0 });
    const r = await deviceSettingsHeartbeat(f.prisma, screenAt(null, 0), header, now);
    expect(f.row).toMatchObject({ screenId: 'screen-1', tenantId: 'tenant-a', revision: 0 });
    expect(r!.data.deviceSettingsReportSig).toBe(reportSignature(JSON.parse(header)));

    const g = fakePrisma(null);
    g.desiredDeviceSettings.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    const lost = await deviceSettingsHeartbeat(g.prisma, screenAt(null, 0), header, now);
    expect(lost!.data).not.toHaveProperty('deviceSettingsReportSig');
    expect(lost!.mustWrite).toBe(false);
  });

  it('a database fault never fails the heartbeat: the unit hears nothing, the markers stay', async () => {
    const f = fakePrisma(rowAt4());
    f.desiredDeviceSettings.findUnique.mockRejectedValueOnce(new Error('pool exhausted'));
    const r = await deviceSettingsHeartbeat(f.prisma, screenAt(null, 4), report({ rev: 3 }), now);
    expect(r).toEqual({ data: {}, mustWrite: false, reply: null });
  });
});
