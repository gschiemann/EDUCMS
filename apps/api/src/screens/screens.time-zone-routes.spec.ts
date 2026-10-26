/**
 * Per-screen time zones on the operator and device routes (2026-10-24).
 *
 *   1. PUT /screens/:id — `timezone` is validated BEFORE any read (an unknown
 *      zone is a 400 and touches nothing), stored trimmed, cleared by null
 *      or '', and left alone when absent.
 *   2. POST /screens/register — `deviceTimeZone` is telemetry: a valid IANA
 *      id is stored on the paired re-register, the unpaired re-register and
 *      the first-ever create; an invalid one is dropped, never stored.
 *   3. GET /screens — every row carries the four time-zone fields by the
 *      manifest's own resolver (override > location setting > automatic).
 *
 * Harness: the hardware-model / register specs' minimal Prisma double.
 */
import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import { SCREEN_TELEMETRY_ONLY_FIELDS } from './manifest-hot-cache';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const TEST_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';

function makeController(prisma: any) {
  const redis: any = { publish: jest.fn(), isConnected: () => false };
  const signer: any = {
    signMessage: jest.fn(() => ({
      type: 'SYNC',
      signature: 'x',
      timestamp: Date.now(),
    })),
  };
  const license: any = { assertSeatAvailable: jest.fn() };
  return new ScreensController(
    prisma,
    redis,
    signer,
    license,
    {} as any,
    {} as any,
  );
}

const ADMIN_REQ = {
  user: {
    id: 'user-admin',
    userId: 'user-admin',
    tenantId: 'tenant-tz',
    role: 'SCHOOL_ADMIN',
  },
};

describe('PUT /screens/:id — timezone override', () => {
  const row = {
    id: 'screen-1',
    tenantId: 'tenant-tz',
    name: 'Lobby',
    location: null,
    screenGroupId: null,
    hardwareModel: null,
    timezone: null,
  };
  let prisma: any;
  beforeEach(() => {
    prisma = {
      client: {
        tenant: { findMany: jest.fn(async () => []) },
        screen: {
          findFirst: jest.fn(async () => row),
          update: jest.fn(async (args: any) => ({
            ...row,
            ...args.data,
            screenGroup: null,
          })),
        },
      },
    };
  });

  it('stores a valid IANA zone, trimmed', async () => {
    const c = makeController(prisma);
    const out: any = await c.update(ADMIN_REQ as any, row.id, {
      timezone: ' America/Denver ',
    });
    expect(out.timezone).toBe('America/Denver');
    expect(prisma.client.screen.update.mock.calls[0][0].data.timezone).toBe(
      'America/Denver',
    );
  });

  it('null and "" clear the override (back to automatic); absent leaves it alone', async () => {
    const c = makeController(prisma);
    await c.update(ADMIN_REQ as any, row.id, { timezone: null });
    expect(
      prisma.client.screen.update.mock.calls[0][0].data.timezone,
    ).toBeNull();
    await c.update(ADMIN_REQ as any, row.id, { timezone: '' });
    expect(
      prisma.client.screen.update.mock.calls[1][0].data.timezone,
    ).toBeNull();
    await c.update(ADMIN_REQ as any, row.id, { name: 'Lobby 2' });
    expect(
      Object.prototype.hasOwnProperty.call(
        prisma.client.screen.update.mock.calls[2][0].data,
        'timezone',
      ),
    ).toBe(false);
  });

  it('refuses an unknown zone with 400 BEFORE reading or writing anything', async () => {
    const c = makeController(prisma);
    await expect(
      c.update(ADMIN_REQ as any, row.id, { timezone: 'Mars/Olympus' }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'SCREEN_TIMEZONE_INVALID' },
    });
    await expect(
      c.update(ADMIN_REQ as any, row.id, { timezone: 42 as unknown as string }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.client.screen.findFirst).not.toHaveBeenCalled();
    expect(prisma.client.screen.update).not.toHaveBeenCalled();
  });
});

describe('POST /screens/register — deviceTimeZone telemetry', () => {
  function pairedScreen(over: Record<string, any> = {}) {
    return {
      id: 'screen-paired-001',
      deviceFingerprint: 'fp-paired-001',
      pairingCode: null,
      tenantId: 'tenant-tz',
      status: 'ONLINE',
      credentialEpoch: 0,
      credentialEpochRotatedAt: null,
      resolution: null,
      osInfo: null,
      browserInfo: null,
      userAgent: null,
      name: 'Screen-Paired',
      deviceTimeZone: null,
      ...over,
    };
  }
  function makePrisma(existing: Record<string, any> | null) {
    const client: any = {
      screen: {
        findUnique: jest.fn(async () => existing),
        create: jest.fn(async (args: any) => ({
          id: 'screen-new',
          pairingCode: 'ABC123',
          ...args.data,
        })),
        update: jest.fn(async (args: any) => ({
          ...(existing ?? {}),
          ...args.data,
        })),
      },
      auditLog: { create: jest.fn(async () => ({})) },
      screenEvent: { create: jest.fn(async () => ({})) },
    };
    client.$transaction = jest.fn((fn: (tx: any) => Promise<unknown>) =>
      fn(client),
    );
    client.$queryRaw = jest.fn(async () => [{ id: 'screen-paired-001' }]);
    return { client };
  }
  const req = () => ({
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
    headers: {},
  });
  const prior = () =>
    jwt.sign(
      { sub: 'screen-paired-001', kind: 'device', ep: 0 },
      TEST_JWT_SECRET,
      { expiresIn: '180d' },
    );

  it('a paired re-register stores the device’s zone; an unknown one is dropped', async () => {
    const good = makePrisma(pairedScreen());
    await makeController(good).register(
      {
        deviceFingerprint: 'fp-paired-001',
        priorDeviceToken: prior(),
        deviceTimeZone: 'Asia/Shanghai',
      },
      req() as any,
    );
    const write = good.client.screen.update.mock.calls[0][0].data;
    expect(write.deviceTimeZone).toBe('Asia/Shanghai');

    const bad = makePrisma(pairedScreen());
    await makeController(bad).register(
      {
        deviceFingerprint: 'fp-paired-001',
        priorDeviceToken: prior(),
        deviceTimeZone: 'Mars/Olympus',
      },
      req() as any,
    );
    expect(
      Object.prototype.hasOwnProperty.call(
        bad.client.screen.update.mock.calls[0][0].data,
        'deviceTimeZone',
      ),
    ).toBe(false);
  });

  it('an unpaired re-register and a first-ever register store it too', async () => {
    const unpaired = makePrisma(
      pairedScreen({
        tenantId: null,
        status: 'PENDING',
        pairingCode: 'ABC123',
      }),
    );
    await makeController(unpaired).register(
      { deviceFingerprint: 'fp-paired-001', deviceTimeZone: 'America/Chicago' },
      req() as any,
    );
    expect(
      unpaired.client.screen.update.mock.calls[0][0].data.deviceTimeZone,
    ).toBe('America/Chicago');

    const fresh = makePrisma(null);
    await makeController(fresh).register(
      {
        deviceFingerprint: 'fp-brand-new',
        deviceTimeZone: 'America/Los_Angeles',
      },
      req() as any,
    );
    expect(
      fresh.client.screen.create.mock.calls[0][0].data.deviceTimeZone,
    ).toBe('America/Los_Angeles');
  });

  it('is a telemetry-only column: a boot-wave re-register must not bust the manifest cache', () => {
    expect(SCREEN_TELEMETRY_ONLY_FIELDS.has('deviceTimeZone')).toBe(true);
  });
});

describe('GET /screens — the time-zone fields on every row', () => {
  const LA = { latitude: 34.0522, longitude: -118.2437 };
  function makePrisma(rows: any[], tenant: any) {
    return {
      client: {
        screen: { findMany: jest.fn(async () => rows) },
        tenant: {
          findUnique: jest.fn(async () => tenant),
          findMany: jest.fn(async () => []),
        },
        schedule: { findMany: jest.fn(async () => []) },
        playlist: { findMany: jest.fn(async () => []) },
        screenGroup: { findMany: jest.fn(async () => []) },
      },
    } as any;
  }
  const base = (over: Record<string, any> = {}) => ({
    id: 's1',
    name: 'Lobby',
    status: 'ONLINE',
    tenantId: 'tenant-tz',
    screenGroupId: null,
    screenGroup: null,
    lastPingAt: new Date(),
    latitude: null,
    longitude: null,
    address: null,
    timezone: null,
    deviceTimeZone: null,
    ...over,
  });

  it('automatic from the location, the location’s setting, the screen’s override — and the device’s own zone beside it', async () => {
    const auto = await makeController(
      makePrisma([base({ deviceTimeZone: 'Asia/Shanghai' })], {
        ...LA,
        address: 'LA',
        timezone: null,
      }),
    ).list(ADMIN_REQ as any);
    expect(auto[0]).toMatchObject({
      timeZone: 'America/Los_Angeles',
      timeZoneSource: 'auto',
      timeZoneAuto: 'America/Los_Angeles',
      timeZoneAutoFrom: 'location',
      deviceTimeZone: 'Asia/Shanghai',
    });

    const setting = await makeController(
      makePrisma([base()], {
        ...LA,
        address: 'LA',
        timezone: 'America/Chicago',
      }),
    ).list(ADMIN_REQ as any);
    expect(setting[0]).toMatchObject({
      timeZone: 'America/Chicago',
      timeZoneSource: 'location',
      timeZoneAuto: 'America/Los_Angeles',
    });

    const override = await makeController(
      makePrisma([base({ timezone: 'America/Denver' })], {
        ...LA,
        address: 'LA',
        timezone: 'America/Chicago',
      }),
    ).list(ADMIN_REQ as any);
    expect(override[0]).toMatchObject({
      timeZone: 'America/Denver',
      timeZoneSource: 'screen',
      timezone: 'America/Denver',
    });

    const none = await makeController(
      makePrisma([base()], {
        latitude: null,
        longitude: null,
        address: null,
        timezone: null,
      }),
    ).list(ADMIN_REQ as any);
    expect(none[0]).toMatchObject({
      timeZone: null,
      timeZoneSource: 'device',
      timeZoneAuto: null,
      timeZoneAutoFrom: null,
    });
  });
});
