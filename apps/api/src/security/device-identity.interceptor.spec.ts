/**
 * Regression tests for DT-03 — roleless routes trusted the 180-day
 * `tenantId` CLAIM instead of the live Screen row.
 *
 * The consequence: a screen that had been unpaired, re-homed to another
 * district, or pulled out of a school and dumpstered went on reading its
 * FORMER tenant's live emergency traffic — message text, media URLs, the
 * active panic playlist, plus the tenant's address and outage feed — for the
 * life of the token. For a K-12 life-safety product that is the
 * highest-consequence read in the system.
 *
 * Fixing it handler-by-handler is whack-a-mole (the next roleless route
 * inherits the trap), so the principal itself is fixed once, globally.
 */

import * as jwt from 'jsonwebtoken';
import { lastValueFrom, of } from 'rxjs';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import { DeviceIdentityInterceptor, routeAllowsUnpairedDevice } from './device-identity.interceptor';
import { AllowUnpairedDevice } from './allow-unpaired-device.decorator';
import { invalidateDeviceCredentialCache } from '../screens/device-auth';

const SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_ID = 'screen-dt3';

const deviceToken = (claims: Record<string, unknown> = {}) =>
  jwt.sign({ sub: SCREEN_ID, kind: 'device', ep: 0, ...claims }, SECRET, { expiresIn: '180d' });

function ctx(req: any) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}
const next = { handle: () => of('handler-ran') } as any;

/** Two stand-in controllers: one route opted in to unpaired screens, one not. */
class AllowsUnpaired {
  @AllowUnpairedDevice()
  read() { return 'read'; }
}
class Ordinary {
  read() { return 'read'; }
}
/** The context Nest hands an interceptor for `cls.prototype[method]`. */
function routeCtx(req: any, cls: any, method: string) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => cls.prototype[method],
    getClass: () => cls,
  } as any;
}

function interceptorFor(row: any) {
  const prisma: any = { client: { screen: { findUnique: jest.fn().mockResolvedValue(row) } } };
  return new DeviceIdentityInterceptor(prisma);
}

const liveRow = (overrides: Record<string, unknown> = {}) => ({
  id: SCREEN_ID,
  tenantId: 'tenant-CURRENT',
  screenGroupId: 'group-CURRENT',
  status: 'ONLINE',
  credentialEpoch: 0,
  credentialEpochRotatedAt: null,
  ...overrides,
});

function deviceReq(claims: Record<string, unknown> = {}, userOverrides: Record<string, unknown> = {}) {
  const tok = deviceToken(claims);
  return {
    headers: { authorization: `Bearer ${tok}` },
    user: { id: SCREEN_ID, sub: SCREEN_ID, kind: 'device', tenantId: 'tenant-FORMER', ...userOverrides },
  };
}

beforeEach(() => invalidateDeviceCredentialCache());

describe('DeviceIdentityInterceptor (DT-03)', () => {
  it('replaces the token’s stale tenant claim with the LIVE Screen row', async () => {
    const req = deviceReq({ tenantId: 'tenant-FORMER' });
    await lastValueFrom(await interceptorFor(liveRow()).intercept(ctx(req), next));
    expect(req.user.tenantId).toBe('tenant-CURRENT');
    expect(req.user.screenGroupId).toBe('group-CURRENT');
  });

  it('leaves an UNPAIRED screen with NO tenant on a route that allows one, so tenant-scoped reads fail closed', async () => {
    // This is the dumpstered-screen case. The claim still says the old
    // school; the row says nothing. `requireTenantId*` then refuses rather
    // than resolving a stale tenant. Since SDW-01 only an
    // `@AllowUnpairedDevice()` route gets this far (see the block below).
    const req = deviceReq();
    await lastValueFrom(
      await interceptorFor(liveRow({ tenantId: null })).intercept(routeCtx(req, AllowsUnpaired, 'read'), next),
    );
    expect(req.user.tenantId).toBeUndefined();
    expect(req.user.schoolId).toBeUndefined();
  });

  it('clears the alternate tenant keys handlers read (schoolId / districtId)', async () => {
    // Several handlers resolve `schoolId || tenantId || districtId`. Leaving
    // any of them populated from a claim would reopen the same hole through
    // a different key.
    const req = deviceReq({}, { schoolId: 'school-FORMER', districtId: 'district-FORMER' });
    await lastValueFrom(await interceptorFor(liveRow()).intercept(ctx(req), next));
    expect(req.user.schoolId).toBe('tenant-CURRENT');
    expect(req.user.districtId).toBeUndefined();
  });

  it('DT-01: rejects a device whose screen row is REVOKED', async () => {
    const req = deviceReq();
    await expect(
      lastValueFrom(await interceptorFor(liveRow({ status: 'REVOKED' })).intercept(ctx(req), next)),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('DT-01: rejects a device whose credential epoch has been retired', async () => {
    const req = deviceReq({ ep: 1 });
    const row = liveRow({ credentialEpoch: 6, credentialEpochRotatedAt: new Date(0) });
    await expect(
      lastValueFrom(await interceptorFor(row).intercept(ctx(req), next)),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('DT-01: rejects a device whose screen row is gone (deletion = complete revocation)', async () => {
    const req = deviceReq();
    await expect(
      lastValueFrom(await interceptorFor(null).intercept(ctx(req), next)),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('accepts a grandfathered token with no `ep` claim against the default epoch 0', async () => {
    // The whole deployed fleet is in this state on the day this ships.
    const tok = jwt.sign({ sub: SCREEN_ID, kind: 'device' }, SECRET, { expiresIn: '365d' });
    const req = {
      headers: { authorization: `Bearer ${tok}` },
      user: { sub: SCREEN_ID, kind: 'device', tenantId: 'tenant-FORMER' },
    };
    await expect(
      lastValueFrom(await interceptorFor(liveRow()).intercept(ctx(req), next)),
    ).resolves.toBe('handler-ran');
    expect(req.user.tenantId).toBe('tenant-CURRENT');
  });

  it('is a strict NO-OP for a user principal', async () => {
    const prisma: any = { client: { screen: { findUnique: jest.fn() } } };
    const req = { headers: {}, user: { sub: 'u1', kind: 'user', role: 'SCHOOL_ADMIN', tenantId: 't1' } };
    await expect(
      lastValueFrom(await new DeviceIdentityInterceptor(prisma).intercept(ctx(req), next)),
    ).resolves.toBe('handler-ran');
    expect(prisma.client.screen.findUnique).not.toHaveBeenCalled();
    expect(req.user.tenantId).toBe('t1');
  });

  it('is a strict NO-OP for an anonymous request', async () => {
    const prisma: any = { client: { screen: { findUnique: jest.fn() } } };
    const req = { headers: {} };
    await expect(
      lastValueFrom(await new DeviceIdentityInterceptor(prisma).intercept(ctx(req), next)),
    ).resolves.toBe('handler-ran');
    expect(prisma.client.screen.findUnique).not.toHaveBeenCalled();
  });
});

/**
 * SEC-001 (2026-09-04) — the guard-protected half of the device surface.
 *
 * `verifyDeviceForScreen` refuses a bootstrap credential outright. This
 * interceptor covers the OTHER device path: every route behind
 * `@UseGuards(JwtAuthGuard)` that a `kind: 'device'` principal can reach —
 * `/screens/:id/manifest`, `/emergency/status`, `/emergency/messages`,
 * `/tenants/me`, the template + asset playback reads, `/analytics/touch-events`.
 *
 * The rule is capability-shaped, not a route list, so a device-reachable
 * mutation added later is covered without anyone remembering this file:
 * an unproven credential may READ what its own screen already displays;
 * it may never WRITE.
 */
describe('DeviceIdentityInterceptor (SEC-001 — unproven credentials)', () => {
  const readReq = (claims: Record<string, unknown> = {}) => ({
    ...deviceReq(claims),
    method: 'GET',
  });
  const writeReq = (claims: Record<string, unknown> = {}, method = 'POST') => ({
    ...deviceReq(claims),
    method,
  });

  it('lets an unproven credential READ — the manifest is the emergency backstop', async () => {
    // Refusing this would darken every screen in REPAIR_REQUIRED: no content,
    // and no lockdown delivery over the documented HTTP-polling fallback.
    const req = readReq({ unproven: true });
    await expect(
      lastValueFrom(await interceptorFor(liveRow()).intercept(ctx(req), next)),
    ).resolves.toBe('handler-ran');
    expect((req.user as Record<string, unknown>).unproven).toBe(true);
    expect(req.user.tenantId).toBe('tenant-CURRENT');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'REFUSES an unproven credential on %s',
    async (method) => {
      const req = writeReq({ unproven: true }, method);
      await expect(
        lastValueFrom(await interceptorFor(liveRow()).intercept(ctx(req), next)),
      ).rejects.toThrow(/unproven/i);
    },
  );

  it('refuses the bootstrap AUDIENCE marker too, with no `unproven` claim present', async () => {
    const req = writeReq({ aud: 'venueos:device-bootstrap' });
    await expect(
      lastValueFrom(await interceptorFor(liveRow()).intercept(ctx(req), next)),
    ).rejects.toThrow(/unproven/i);
  });

  it('a PROVEN credential still writes — no fleet regression', async () => {
    const req = writeReq();
    await expect(
      lastValueFrom(await interceptorFor(liveRow()).intercept(ctx(req), next)),
    ).resolves.toBe('handler-ran');
    expect((req.user as Record<string, unknown>).unproven).toBe(false);
  });

  it('stamps `unproven` on the principal so handlers need not re-decode', async () => {
    const req = readReq({ unproven: true });
    await lastValueFrom(await interceptorFor(liveRow()).intercept(ctx(req), next));
    expect((req.user as Record<string, unknown>).unproven).toBe(true);
  });
});

/**
 * SDW-01 (2026-11-23) — a device principal must belong to a tenant.
 *
 * A screen holds a valid device credential before it is paired (the pairing
 * splash needs one). On the guard surface, a device principal whose live
 * screen row has no tenant is refused unless the route opts in with
 * `@AllowUnpairedDevice()`, so every other handler can rely on a device
 * principal's `tenantId` being a real tenant.
 */
describe('DeviceIdentityInterceptor (SDW-01 — tenantless device principals)', () => {
  const unpaired = () => liveRow({ tenantId: null, screenGroupId: null, status: 'PENDING' });
  // The registration token for a brand-new screen: no tenant claim, not unproven.
  const registrationReq = (method = 'GET') => ({
    ...deviceReq({ deviceId: SCREEN_ID }, { tenantId: undefined }),
    method,
  });

  it.each(['GET', 'POST'])('refuses an unpaired screen on an ordinary route (%s) with 401', async (method) => {
    const req = registrationReq(method);
    await expect(
      lastValueFrom(await interceptorFor(unpaired()).intercept(routeCtx(req, Ordinary, 'read'), next)),
    ).rejects.toMatchObject({ status: 401, response: { code: 'DEVICE_SCREEN_UNPAIRED' } });
  });

  it('refuses when the context names no handler at all — the refusal is the default', async () => {
    const req = registrationReq();
    await expect(
      lastValueFrom(await interceptorFor(unpaired()).intercept(ctx(req), next)),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('admits an unpaired screen on an @AllowUnpairedDevice() route, with no tenant on the principal', async () => {
    const req = registrationReq();
    await expect(
      lastValueFrom(await interceptorFor(unpaired()).intercept(routeCtx(req, AllowsUnpaired, 'read'), next)),
    ).resolves.toBe('handler-ran');
    expect(req.user.tenantId).toBeUndefined();
    expect((req.user as Record<string, unknown>).schoolId).toBeUndefined();
  });

  it('a stale tenant CLAIM does not count: the live row decides', async () => {
    // An unpaired screen still holding a token that names its former school.
    const req = { ...deviceReq({ tenantId: 'tenant-FORMER' }), method: 'GET' };
    await expect(
      lastValueFrom(await interceptorFor(unpaired()).intercept(routeCtx(req, Ordinary, 'read'), next)),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('a PAIRED screen is admitted on an ordinary route exactly as before', async () => {
    const req = { ...deviceReq(), method: 'POST' };
    await expect(
      lastValueFrom(await interceptorFor(liveRow()).intercept(routeCtx(req, Ordinary, 'read'), next)),
    ).resolves.toBe('handler-ran');
    expect(req.user.tenantId).toBe('tenant-CURRENT');
  });

  it('an unproven write from an unpaired screen keeps its own refusal', async () => {
    const req = { ...deviceReq({ unproven: true }), method: 'POST' };
    await expect(
      lastValueFrom(await interceptorFor(unpaired()).intercept(routeCtx(req, AllowsUnpaired, 'read'), next)),
    ).rejects.toThrow(/unproven/i);
  });

  it('never touches a user principal, tenant or not', async () => {
    const prisma: any = { client: { screen: { findUnique: jest.fn() } } };
    const req = { headers: {}, method: 'GET', user: { sub: 'u1', kind: 'user', role: 'SCHOOL_ADMIN' } };
    await expect(
      lastValueFrom(await new DeviceIdentityInterceptor(prisma).intercept(routeCtx(req, Ordinary, 'read'), next)),
    ).resolves.toBe('handler-ran');
    expect(prisma.client.screen.findUnique).not.toHaveBeenCalled();
  });

  it('routeAllowsUnpairedDevice reads handler metadata only', () => {
    expect(routeAllowsUnpairedDevice(routeCtx({}, AllowsUnpaired, 'read'))).toBe(true);
    expect(routeAllowsUnpairedDevice(routeCtx({}, Ordinary, 'read'))).toBe(false);
    expect(routeAllowsUnpairedDevice(ctx({}))).toBe(false);
  });
});
