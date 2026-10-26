/**
 * A location's time zone on the tenant routes (2026-10-24).
 *
 *   1. PATCH /tenants/me — `timezone` is validated BEFORE any read (unknown →
 *      400, nothing touched), stored trimmed, cleared by null / '', and left
 *      alone when absent; the audit row carries the patch like every field.
 *   2. GET /tenants — answers the resolved view: the setting when there is
 *      one, else the automatic zone from the saved coordinates, else null.
 *   3. GET /tenants/children — every active child row carries the same view.
 */
import { TenantsController, locationTimeZoneView } from './tenants.controller';

const LA = { latitude: 34.0522, longitude: -118.2437 };

function makeController() {
  const tenant = {
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  };
  const tenantSSOConfig = { findUnique: jest.fn().mockResolvedValue(null) };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };
  const prisma: any = {
    client: {
      tenant,
      tenantSSOConfig,
      auditLog,
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      screen: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (cb: any) =>
        cb({ auditLog, tenant, tenantSSOConfig }),
      ),
    },
  };
  const jwt: any = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
  const redis: any = {
    markUserTokensInvalid: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new TenantsController(prisma, jwt, redis);
  return { controller, tenant, auditLog, prisma };
}

const REQ = {
  user: { userId: 'u1', id: 'u1', tenantId: 't1', role: 'DISTRICT_ADMIN' },
};

describe('locationTimeZoneView — a location’s zone as the dashboard shows it', () => {
  it('setting > automatic from coordinates > null', () => {
    expect(
      locationTimeZoneView({ timezone: 'America/Chicago', ...LA }),
    ).toEqual({
      timeZone: 'America/Chicago',
      timeZoneSource: 'location',
      timeZoneAuto: 'America/Los_Angeles',
    });
    expect(locationTimeZoneView({ timezone: null, ...LA })).toEqual({
      timeZone: 'America/Los_Angeles',
      timeZoneSource: 'auto',
      timeZoneAuto: 'America/Los_Angeles',
    });
    expect(
      locationTimeZoneView({ timezone: null, latitude: null, longitude: null }),
    ).toEqual({ timeZone: null, timeZoneSource: 'device', timeZoneAuto: null });
    expect(locationTimeZoneView({})).toEqual({
      timeZone: null,
      timeZoneSource: 'device',
      timeZoneAuto: null,
    });
  });
});

describe('PATCH /tenants/me — timezone', () => {
  it('stores a valid zone (trimmed) and audits it; null / "" clear it; absent leaves it alone', async () => {
    const { controller, tenant, auditLog } = makeController();
    tenant.findUnique.mockResolvedValue({
      name: 'Springfield',
      slug: 'springfield',
    });
    tenant.update.mockImplementation(async (args: any) => ({
      id: 't1',
      name: 'Springfield',
      slug: 'springfield',
      vertical: 'K12',
      address: null,
      ...args.data,
    }));

    await controller.updateMyTenant(REQ as any, {
      timezone: ' America/Denver ',
    });
    expect(tenant.update.mock.calls[0][0].data.timezone).toBe('America/Denver');
    expect(
      JSON.parse(auditLog.create.mock.calls[0][0].data.details).timezone,
    ).toBe('America/Denver');

    await controller.updateMyTenant(REQ as any, { timezone: null });
    expect(tenant.update.mock.calls[1][0].data.timezone).toBeNull();
    await controller.updateMyTenant(REQ as any, { timezone: '' });
    expect(tenant.update.mock.calls[2][0].data.timezone).toBeNull();

    await controller.updateMyTenant(REQ as any, { name: 'Springfield' });
    expect(
      Object.prototype.hasOwnProperty.call(
        tenant.update.mock.calls[3][0].data,
        'timezone',
      ),
    ).toBe(false);
  });

  it('refuses an unknown zone with 400 before any read or write', async () => {
    const { controller, tenant } = makeController();
    await expect(
      controller.updateMyTenant(REQ as any, { timezone: 'Mars/Olympus' }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'TENANT_TIMEZONE_INVALID' },
    });
    expect(tenant.findUnique).not.toHaveBeenCalled();
    expect(tenant.update).not.toHaveBeenCalled();
  });
});

describe('GET /tenants and GET /tenants/children — the resolved view', () => {
  it('GET /tenants answers the setting, the automatic zone, and where it came from', async () => {
    const { controller, tenant } = makeController();
    tenant.findUnique.mockResolvedValue({
      id: 't1',
      name: 'Springfield',
      slug: 'springfield',
      parentId: null,
      vertical: 'K12',
      address: 'LA',
      ...LA,
      timezone: null,
      emergencyStatus: 'INACTIVE',
      emergencyIsDrill: false,
      emergencyEnabled: null,
      mfaEnforced: null,
      usbIngestEnabled: false,
    });
    const out: any = await controller.getTenantInfo(REQ as any);
    expect(out).toMatchObject({
      timezone: null,
      timeZone: 'America/Los_Angeles',
      timeZoneSource: 'auto',
      timeZoneAuto: 'America/Los_Angeles',
    });
  });

  it('GET /tenants/children carries the view on every row', async () => {
    const { controller, tenant } = makeController();
    tenant.findUnique.mockResolvedValue({ id: 't1', parentId: null });
    tenant.findMany.mockResolvedValue([
      {
        id: 'c1',
        name: 'Austin',
        slug: 'austin',
        createdAt: new Date(),
        address: 'ATX',
        latitude: 30.2672,
        longitude: -97.7431,
        timezone: null,
        _count: { screens: 2, users: 1 },
      },
      {
        id: 'c2',
        name: 'Dallas',
        slug: 'dallas',
        createdAt: new Date(),
        address: null,
        latitude: null,
        longitude: null,
        timezone: 'America/Chicago',
        _count: { screens: 0, users: 0 },
      },
      {
        id: 'c3',
        name: 'Nowhere',
        slug: 'nowhere',
        createdAt: new Date(),
        address: null,
        latitude: null,
        longitude: null,
        timezone: null,
        _count: { screens: 0, users: 0 },
      },
    ]);
    const out: any = await controller.listChildren(REQ as any);
    expect(out.children[0]).toMatchObject({
      timeZone: 'America/Chicago',
      timeZoneSource: 'auto',
      timeZoneAuto: 'America/Chicago',
    });
    expect(out.children[1]).toMatchObject({
      timeZone: 'America/Chicago',
      timeZoneSource: 'location',
      timeZoneAuto: null,
    });
    expect(out.children[2]).toMatchObject({
      timeZone: null,
      timeZoneSource: 'device',
      timeZoneAuto: null,
    });
    // The select asks for what the view needs.
    expect(tenant.findMany.mock.calls[0][0].select).toMatchObject({
      address: true,
      latitude: true,
      longitude: true,
      timezone: true,
    });
  });
});
