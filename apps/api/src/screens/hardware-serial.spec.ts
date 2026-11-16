jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) =>
    o?.devFallback ?? 'test_secret',
}));

import { invalidateDeviceCredentialCache } from './device-auth';
import {
  HARDWARE_SERIAL_HEADER,
  hardwareSerialWrite,
  isPlaceholderSerial,
  normalizeHardwareSerial,
  parseHardwareSerialHeader,
} from './hardware-serial';
import { SCREEN_TELEMETRY_ONLY_FIELDS, shouldBumpManifestRev } from './manifest-hot-cache';
import { ScreensController } from './screens.controller';

/**
 * The panel's hardware serial (2026-11-16): parsed strictly, written only on a
 * change under the device credential, never cleared by an empty report, never
 * a manifest cache-buster, and returned only inside the caller's own tenant.
 * Every serial here is synthetic.
 */

const hdr = (o: Record<string, unknown>) => JSON.stringify({ v: 1, ...o });

describe('hardware serial — validation', () => {
  it('keeps a real serial, trimmed', () => {
    expect(normalizeHardwareSerial('  TESTSERIAL-0001 ')).toBe('TESTSERIAL-0001');
    expect(normalizeHardwareSerial('a'.repeat(63) + 'b')).toHaveLength(64);
  });

  it('refuses empty, over-long, non-printable and non-string values', () => {
    expect(normalizeHardwareSerial('')).toBeNull();
    expect(normalizeHardwareSerial('   ')).toBeNull();
    expect(normalizeHardwareSerial('x'.repeat(64) + 'y')).toBeNull();
    expect(normalizeHardwareSerial('TEST\nSERIAL')).toBeNull();
    expect(normalizeHardwareSerial('TESTéSERIAL')).toBeNull();
    expect(normalizeHardwareSerial(12345 as unknown)).toBeNull();
    expect(normalizeHardwareSerial(null)).toBeNull();
  });

  it('refuses the placeholders Android and OEM builds hand out', () => {
    for (const p of ['unknown', 'UNKNOWN', '0123456789ABCDEF', '0000000000000000', 'ffffffff', 'null', '1234567890']) {
      expect(isPlaceholderSerial(p)).toBe(true);
      expect(normalizeHardwareSerial(p)).toBeNull();
    }
    expect(isPlaceholderSerial('TESTSERIAL0001')).toBe(false);
  });

  it('parses the header strictly', () => {
    expect(parseHardwareSerialHeader(hdr({ s: 'TESTSERIAL0001', src: 'prop:ro.serialno' })))
      .toEqual({ serial: 'TESTSERIAL0001', source: 'prop:ro.serialno' });
    expect(parseHardwareSerialHeader(hdr({ src: 'none' }))).toEqual({ serial: null, source: 'none' });
    // A named source carrying a placeholder is "nothing readable".
    expect(parseHardwareSerialHeader(hdr({ s: 'unknown', src: 'build-serial' }))).toEqual({ serial: null, source: 'none' });
    for (const bad of [
      undefined, '', 'not json', '[]', JSON.stringify({ v: 2, s: 'TESTSERIAL0001', src: 'device-owner' }),
      hdr({ s: 'TESTSERIAL0001', src: 'made-up' }), hdr({ s: 'TESTSERIAL0001' }), 'x'.repeat(300),
    ]) {
      expect(parseHardwareSerialHeader(bad)).toBeNull();
    }
  });
});

describe('hardware serial — what is written', () => {
  const report = { serial: 'TESTSERIAL0001', source: 'prop:ro.serialno' };

  it('writes a new or changed serial, nothing when unchanged', () => {
    expect(hardwareSerialWrite({}, report)).toEqual({ hardwareSerial: 'TESTSERIAL0001', hardwareSerialSource: 'prop:ro.serialno' });
    expect(hardwareSerialWrite({ hardwareSerial: 'TESTSERIAL0001', hardwareSerialSource: 'prop:ro.serialno' }, report)).toEqual({});
    expect(hardwareSerialWrite({ hardwareSerial: 'TESTSERIAL0000', hardwareSerialSource: 'prop:ro.serialno' }, report))
      .toEqual({ hardwareSerial: 'TESTSERIAL0001', hardwareSerialSource: 'prop:ro.serialno' });
  });

  it('never clears a stored serial; records `none` once while nothing is stored', () => {
    const none = { serial: null, source: 'none' };
    expect(hardwareSerialWrite({ hardwareSerial: 'TESTSERIAL0001', hardwareSerialSource: 'build-serial' }, none)).toEqual({});
    expect(hardwareSerialWrite({}, none)).toEqual({ hardwareSerialSource: 'none' });
    expect(hardwareSerialWrite({ hardwareSerial: null, hardwareSerialSource: 'none' }, none)).toEqual({});
    expect(hardwareSerialWrite({ hardwareSerial: 'TESTSERIAL0001' }, null)).toEqual({});
  });

  it('both columns are telemetry-only for the manifest cache', () => {
    expect(SCREEN_TELEMETRY_ONLY_FIELDS.has('hardwareSerial')).toBe(true);
    expect(SCREEN_TELEMETRY_ONLY_FIELDS.has('hardwareSerialSource')).toBe(true);
    expect(shouldBumpManifestRev('Screen', 'update', ['lastPingAt', 'status', 'hardwareSerial', 'hardwareSerialSource'])).toBe(false);
  });
});

function harness(opts: { proved?: boolean; paired?: boolean; id?: string; serial?: string | null; source?: string | null } = {}) {
  const proved = opts.proved ?? true;
  const paired = opts.paired ?? true;
  const row = {
    id: opts.id ?? 'wall-hs',
    playerVersion: '1.1.60',
    playerVersionCode: 10160,
    tenantId: paired ? 'tenant-a' : null,
    deviceFingerprint: 'android-wall',
    nativeRuntimeReport: null as unknown,
    nativePowerOnAt: null,
    pairingCode: null,
    faceOfScreenId: null,
    forceApkUpdatePendingAt: null,
    hardwareSerial: opts.serial ?? null,
    hardwareSerialSource: opts.source ?? null,
  };
  const screen = {
    findUnique: jest.fn().mockResolvedValue(row),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest
      .fn<Promise<typeof row>, [input: { data: Record<string, unknown> }]>()
      .mockResolvedValue(row),
    count: jest.fn().mockResolvedValue(0),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };
  const controller = new ScreensController(
    { client: { screen, auditLog } } as never,
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
  return { row, screen, controller };
}

function poll(controller: ScreensController, value: unknown) {
  return controller.deviceStatus('android-wall', '1.1.60', '10160', undefined, {
    headers: value === undefined ? {} : { [HARDWARE_SERIAL_HEADER]: value },
  });
}

beforeEach(() => invalidateDeviceCredentialCache());

describe('GET /screens/status/:fp — hardware serial', () => {
  it('stores the serial from a credentialed, paired unit', async () => {
    const { controller, screen } = harness({ id: 'wall-hs-1' });
    await poll(controller, hdr({ s: ' TESTSERIAL0001 ', src: 'prop:ro.serialno' }));
    expect(screen.update).toHaveBeenCalledTimes(1);
    const call = screen.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: 'wall-hs-1' });
    expect(call.data.hardwareSerial).toBe('TESTSERIAL0001');
    expect(call.data.hardwareSerialSource).toBe('prop:ro.serialno');
  });

  it('ignores the header from an anonymous or unpaired caller', async () => {
    for (const [proved, paired, id] of [
      [false, true, 'wall-hs-2'],
      [true, false, 'wall-hs-3'],
    ] as const) {
      const { controller, screen } = harness({ proved, paired, id });
      await poll(controller, hdr({ s: 'TESTSERIAL0001', src: 'device-owner' }));
      for (const c of screen.update.mock.calls) {
        expect(c[0].data).not.toHaveProperty('hardwareSerial');
        expect(c[0].data).not.toHaveProperty('hardwareSerialSource');
      }
    }
  });

  it('an unchanged serial forces no write; an empty report never clears one', async () => {
    const { controller, screen } = harness({ id: 'wall-hs-4', serial: 'TESTSERIAL0001', source: 'prop:ro.serialno' });
    // First beat takes the due liveness write; the serial is not in it.
    await poll(controller, hdr({ s: 'TESTSERIAL0001', src: 'prop:ro.serialno' }));
    for (const c of screen.update.mock.calls) expect(c[0].data).not.toHaveProperty('hardwareSerial');
    screen.update.mockClear();
    // Inside the liveness debounce: unchanged → no write at all.
    await poll(controller, hdr({ s: 'TESTSERIAL0001', src: 'prop:ro.serialno' }));
    expect(screen.update).not.toHaveBeenCalled();
    // A report without a serial (ROM started blocking the read) → no write.
    await poll(controller, hdr({ src: 'none' }));
    await poll(controller, hdr({ s: '', src: 'prop:ro.serialno' }));
    expect(screen.update).not.toHaveBeenCalled();
    // A CHANGED serial forces its write even inside the debounce.
    await poll(controller, hdr({ s: 'TESTSERIAL0002', src: 'prop:ro.serialno' }));
    expect(screen.update).toHaveBeenCalledTimes(1);
    expect(screen.update.mock.calls[0][0].data.hardwareSerial).toBe('TESTSERIAL0002');
  });

  it('an older APK (no header) changes nothing', async () => {
    const { controller, screen } = harness({ id: 'wall-hs-5' });
    await poll(controller, undefined);
    for (const c of screen.update.mock.calls) {
      expect(c[0].data).not.toHaveProperty('hardwareSerial');
      expect(c[0].data).not.toHaveProperty('hardwareSerialSource');
    }
  });
});

describe('GET /screens — hardware serial is tenant-scoped', () => {
  it("returns the caller's own tenant's serials and queries no other tenant", async () => {
    const own = {
      id: 'own-1', name: 'Lobby', tenantId: 'tenant-a', status: 'ONLINE', lastPingAt: new Date(),
      latitude: null, longitude: null, screenGroupId: null, screenGroup: null,
      hardwareSerial: 'TESTSERIAL0001', hardwareSerialSource: 'prop:ro.serialno',
    };
    const findMany = jest.fn().mockResolvedValue([own]);
    const controller = new ScreensController(
      {
        client: {
          screen: { findMany },
          tenant: { findUnique: jest.fn().mockResolvedValue(null) },
          playlist: { findMany: jest.fn().mockResolvedValue([]) },
          schedule: { findMany: jest.fn().mockResolvedValue([]) },
        },
      } as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
    );
    const rows = (await controller.list({ user: { tenantId: 'tenant-a', role: 'SCHOOL_ADMIN' } })) as Array<Record<string, unknown>>;
    expect(findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 'tenant-a' });
    expect(rows[0].hardwareSerial).toBe('TESTSERIAL0001');
    expect(rows[0].hardwareSerialSource).toBe('prop:ro.serialno');
  });
});
