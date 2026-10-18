jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) =>
    o?.devFallback ?? 'test_secret',
}));

import { reportSignature } from '../device-settings/device-settings';
import { invalidateDeviceCredentialCache } from './device-auth';
import { SCREEN_TELEMETRY_ONLY_FIELDS, shouldBumpManifestRev } from './manifest-hot-cache';
import { ScreensController } from './screens.controller';

/**
 * The heartbeat route's device-settings lines, through the real handler:
 * gated like the native report, folded into the heartbeat's own write, and
 * never a cache-buster.
 */

const settings = {
  brightness: { v: 80, id: 'r2', at: '2026-10-18T12:00:00.000Z', by: 'u-1' },
};
const header = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 1, rev: 1, sdk: 33, cap: { brightness: 'ok' }, obs: { brightness: 60 }, ...over });

function harness(opts: { proved?: boolean; paired?: boolean; id?: string; rev?: number; sig?: string | null } = {}) {
  const proved = opts.proved ?? true;
  const paired = opts.paired ?? true;
  const row = {
    id: opts.id ?? 'wall-ds',
    playerVersion: '1.1.43',
    playerVersionCode: 10143,
    tenantId: paired ? 'tenant-a' : null,
    deviceFingerprint: 'android-wall',
    nativeRuntimeReport: null as unknown,
    nativePowerOnAt: null,
    pairingCode: null,
    faceOfScreenId: null,
    forceApkUpdatePendingAt: null,
    deviceSettingsRev: opts.rev ?? 2,
    deviceSettingsReportSig: opts.sig ?? null,
  };
  const screen = {
    findUnique: jest.fn().mockResolvedValue(row),
    update: jest
      .fn<Promise<typeof row>, [input: { data: Record<string, unknown> }]>()
      .mockResolvedValue(row),
    count: jest.fn().mockResolvedValue(0),
  };
  const desiredDeviceSettings = {
    findUnique: jest.fn().mockResolvedValue({
      screenId: row.id,
      tenantId: 'tenant-a',
      revision: 2,
      settings,
      wifiSecret: null,
      report: null,
      reportChangedAt: null,
    }),
    upsert: jest.fn().mockResolvedValue({}),
    update: jest.fn(),
  };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };
  const controller = new ScreensController(
    { client: { screen, desiredDeviceSettings, auditLog } } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  jest
    .spyOn(
      controller as unknown as {
        heartbeatProvesDevice: () => Promise<{ presented: boolean; proved: boolean }>;
      },
      'heartbeatProvesDevice',
    )
    .mockResolvedValue({ presented: proved, proved });
  return { row, screen, desiredDeviceSettings, controller };
}

function poll(controller: ScreensController, value: unknown = header()) {
  return controller.deviceStatus('android-wall', '1.1.43', '10143', undefined, {
    headers: { 'x-venueos-device-settings': value },
  }) as Promise<Record<string, unknown>>;
}

/** An older player: the header is simply not there. */
function pollWithoutHeader(controller: ScreensController) {
  return controller.deviceStatus('android-wall', '1.1.43', '10143', undefined, {
    headers: {},
  }) as Promise<Record<string, unknown>>;
}

beforeEach(() => invalidateDeviceCredentialCache());

describe('GET /screens/status/:fp — device settings', () => {
  it('hands a credentialed unit on an older set its desired values, and stores its changed report', async () => {
    const { controller, screen, desiredDeviceSettings } = harness({ id: 'wall-ds-1' });
    const res = await poll(controller);
    expect(res.deviceSettings).toEqual({ schema: 1, rev: 2, items: { brightness: { id: 'r2', v: 80 } } });
    expect(desiredDeviceSettings.upsert).toHaveBeenCalledTimes(1);
    const data = screen.update.mock.calls[0][0].data;
    expect(data.deviceSettingsReportSig).toBe(reportSignature(JSON.parse(header())));
    expect(data.deviceSettingsReportAt).toBeInstanceOf(Date);
  });

  it('withholds desired values and writes nothing for anonymous or unpaired callers', async () => {
    for (const [proved, paired, id] of [
      [false, true, 'wall-ds-2'],
      [true, false, 'wall-ds-3'],
    ] as const) {
      const { controller, screen, desiredDeviceSettings } = harness({ proved, paired, id });
      const res = await poll(controller);
      expect(res).not.toHaveProperty('deviceSettings');
      expect(desiredDeviceSettings.findUnique).not.toHaveBeenCalled();
      for (const call of screen.update.mock.calls) {
        expect(call[0].data).not.toHaveProperty('deviceSettingsReportSig');
      }
    }
  });

  it('says nothing to a player that sends no settings header (the existing fleet)', async () => {
    const { controller, desiredDeviceSettings } = harness({ id: 'wall-ds-4' });
    expect(await pollWithoutHeader(controller)).not.toHaveProperty('deviceSettings');
    expect(await poll(controller, 'not json')).not.toHaveProperty('deviceSettings');
    expect(desiredDeviceSettings.findUnique).not.toHaveBeenCalled();
  });

  it('a unit holding the current set with an unchanged report: `same`, no settings query, no forced write', async () => {
    const h = header({ rev: 2 });
    const { controller, screen, desiredDeviceSettings } = harness({
      id: 'wall-ds-5',
      sig: reportSignature(JSON.parse(h)),
    });
    // First beat takes the due liveness write (the debounce) — the settings
    // markers must not be in it as forced fields beyond the report timestamp.
    expect((await poll(controller, h)).deviceSettings).toEqual({ schema: 1, rev: 2, same: true });
    expect(desiredDeviceSettings.findUnique).not.toHaveBeenCalled();
    // Inside the debounce, an unchanged report forces no write at all.
    screen.update.mockClear();
    expect((await poll(controller, h)).deviceSettings).toEqual({ schema: 1, rev: 2, same: true });
    expect(screen.update).not.toHaveBeenCalled();
  });

  it('every Screen column the heartbeat and the PUT write is telemetry-only for the manifest cache', () => {
    for (const k of ['deviceSettingsRev', 'deviceSettingsReportSig', 'deviceSettingsReportAt']) {
      expect(SCREEN_TELEMETRY_ONLY_FIELDS.has(k)).toBe(true);
    }
    expect(shouldBumpManifestRev('Screen', 'update', ['deviceSettingsRev'])).toBe(false);
    expect(
      shouldBumpManifestRev('Screen', 'update', ['lastPingAt', 'status', 'deviceSettingsReportAt', 'deviceSettingsReportSig']),
    ).toBe(false);
    // The desired-settings table feeds no manifest at all.
    expect(shouldBumpManifestRev('DesiredDeviceSettings', 'upsert', ['report'])).toBe(false);
  });
});
