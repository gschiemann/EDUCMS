/**
 * Regression tests for the GPIO emergency path (DT-05 + DT-06).
 *
 * `/screens/:id/gpio-event` is the ONE device-authenticated route that can
 * raise a real life-safety alert: an active edge on a mapped pin persists a
 * genuine ScreenEmergencyOverride and publishes a SIGNED `OVERRIDE` —
 * indistinguishable downstream from a wall-station press. Its auth helper
 * used to be a private copy that checked only signature + kind + sub, so a
 * revoked screen's token could still fabricate a LOCKDOWN.
 */

import * as jwt from 'jsonwebtoken';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import { GpioController, hardwareCanRaiseGpioEmergency } from './gpio.controller';
import { invalidateDeviceCredentialCache } from './device-auth';

const SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_ID = 'screen-gpio-1';

const tok = (overrides: Record<string, unknown> = {}) =>
  jwt.sign({ sub: SCREEN_ID, kind: 'device', ep: 0, ...overrides }, SECRET, { expiresIn: '180d' });

const req = (t = tok()) => ({ headers: { authorization: `Bearer ${t}` } }) as any;

function harness(screen: any) {
  const prisma: any = {
    client: { screen: { findUnique: jest.fn().mockResolvedValue(screen) } },
  };
  const gpio: any = { handleInputEvent: jest.fn().mockResolvedValue({ accepted: true, action: 'logged' }) };
  const redis: any = { sismember: jest.fn().mockResolvedValue(false) };
  return { controller: new GpioController(prisma, gpio, redis), prisma, gpio };
}

const wiredScreen = (overrides: Record<string, unknown> = {}) => ({
  id: SCREEN_ID,
  tenantId: 'tenant-1',
  screenGroupId: null,
  status: 'ONLINE',
  credentialEpoch: 0,
  credentialEpochRotatedAt: null,
  hardwareModel: 'goodview-ep6n',
  config: { wiring: { gpio_in1: 'panic_button' } },
  ...overrides,
});

const EVENT = { pin: 'in1', state: 'edge_rising' };

beforeEach(() => invalidateDeviceCredentialCache());

describe('hardwareCanRaiseGpioEmergency (DT-06)', () => {
  it('allows hardware that actually has GPIO inputs', () => {
    expect(hardwareCanRaiseGpioEmergency('goodview-ep6n')).toBe(true);
  });

  it('refuses a KNOWN SKU with zero GPIO inputs — there is no contact to close', () => {
    expect(hardwareCanRaiseGpioEmergency('unknown')).toBe(true); // catalog's own "unidentified" bucket
    // A real zero-GPIO entry from the catalog.
    const { HARDWARE_CATALOG } = require('@cms/api-types');
    const zeroGpio = Object.entries(HARDWARE_CATALOG).find(
      ([id, e]: any) => id !== 'unknown' && e?.caps?.gpioIn === 0,
    );
    expect(zeroGpio).toBeDefined();
    expect(hardwareCanRaiseGpioEmergency((zeroGpio as any)[0])).toBe(false);
  });

  it('FAILS OPEN on an undetected model — never break real panic-button hardware', () => {
    // hardwareModel is auto-detected from the user agent and is null on
    // plenty of legitimately-paired screens. Refusing those would take a
    // real wall station offline, which is not an acceptable trade here.
    expect(hardwareCanRaiseGpioEmergency(null)).toBe(true);
    expect(hardwareCanRaiseGpioEmergency('')).toBe(true);
    expect(hardwareCanRaiseGpioEmergency('some-sku-we-have-never-seen')).toBe(true);
  });
});

describe('POST /screens/:id/gpio-event auth (DT-05)', () => {
  it('accepts a valid credential on GPIO-capable hardware and passes the wiring through', async () => {
    const { controller, gpio } = harness(wiredScreen());
    await controller.gpioEvent(SCREEN_ID, req(), EVENT);
    expect(gpio.handleInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        screenId: SCREEN_ID,
        tenantId: 'tenant-1',
        config: { wiring: { gpio_in1: 'panic_button' } },
      }),
    );
  });

  it('DT-05: refuses a REVOKED screen — an operator can now cut a compromised kiosk off the emergency path', async () => {
    const { controller, gpio } = harness(wiredScreen({ status: 'REVOKED' }));
    await expect(controller.gpioEvent(SCREEN_ID, req(), EVENT)).rejects.toMatchObject({ status: 401 });
    expect(gpio.handleInputEvent).not.toHaveBeenCalled();
  });

  it('DT-05: refuses a retired credential epoch', async () => {
    const { controller, gpio } = harness(
      wiredScreen({ credentialEpoch: 3, credentialEpochRotatedAt: new Date(0) }),
    );
    await expect(controller.gpioEvent(SCREEN_ID, req(tok({ ep: 0 })), EVENT)).rejects.toMatchObject({
      status: 401,
    });
    expect(gpio.handleInputEvent).not.toHaveBeenCalled();
  });

  it('DT-05: refuses a token bound to a different screen', async () => {
    const { controller } = harness(wiredScreen());
    const other = jwt.sign({ sub: 'screen-OTHER', kind: 'device', ep: 0 }, SECRET, { expiresIn: '1h' });
    await expect(controller.gpioEvent(SCREEN_ID, req(other), EVENT)).rejects.toMatchObject({ status: 401 });
  });

  it('DT-06: a zero-GPIO device gets its event LOGGED but cannot raise an emergency', async () => {
    // The realistic attack: a stolen token from a browser player or a TV
    // box POSTs a fabricated edge. Passing config `null` routes the service
    // down its existing "no wiring on this pin → log only" branch, so the
    // refusal is still audited and no override is synthesized.
    const { HARDWARE_CATALOG } = require('@cms/api-types');
    const zeroGpioId = Object.entries(HARDWARE_CATALOG).find(
      ([id, e]: any) => id !== 'unknown' && e?.caps?.gpioIn === 0,
    )![0];

    const { controller, gpio } = harness(wiredScreen({ hardwareModel: zeroGpioId }));
    await controller.gpioEvent(SCREEN_ID, req(), EVENT);
    expect(gpio.handleInputEvent).toHaveBeenCalledWith(expect.objectContaining({ config: null }));
  });

  it('refuses an unpaired screen — no tenant, no emergency to raise', async () => {
    const { controller } = harness(wiredScreen({ tenantId: null }));
    await expect(controller.gpioEvent(SCREEN_ID, req(), EVENT)).rejects.toMatchObject({ status: 401 });
  });
});
