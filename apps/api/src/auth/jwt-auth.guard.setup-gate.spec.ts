/**
 * JwtAuthGuard — FIRST-LOGIN CREDENTIAL SETUP gate (2026-09-03).
 *
 * A location account provisioned with a placeholder email
 * (`riot-jacksonville@riotcolor.com`) and a shared starter password must not be
 * able to USE the product until it has claimed its own credentials. These tests
 * pin the whole contract:
 *
 *   - everything is refused with a machine-readable `SETUP_REQUIRED` 403;
 *   - EMERGENCY routes are refused too — an account that has not established
 *     who it belongs to must not be able to fire a district-wide lockdown, and
 *     could not name an actor in the audit row if it did;
 *   - exactly three routes pass: complete-setup, logout, and the session read
 *     — the minimum set that lets the account finish setup, get out, or let
 *     the dashboard learn to render the setup screen;
 *   - the fast path answers from the token's `msc` claim with NO database work;
 *   - a token with NO claim is VERIFIED against the row rather than trusted,
 *     so a mint path that forgets the claim can never become a bypass;
 *   - machine identities (device tokens) are never gated — a paired screen has
 *     no credentials to set up and must keep playing content.
 */
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard, SETUP_REQUIRED_ALLOWED_ROUTES } from './jwt-auth.guard';

const TEST_SECRET = 'dev_only_jwt_secret_CHANGE_ME';
const DEVICE_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';

function ctxFor(token: string, method: string, url: string) {
  const request: any = {
    headers: { authorization: `Bearer ${token}` },
    method,
    originalUrl: url,
    url,
    user: undefined,
  };
  return {
    ctx: { switchToHttp: () => ({ getRequest: () => request }) } as any,
    request,
  };
}

/** Redis mock with nothing revoked — this suite is about the setup gate only. */
function makeRedis() {
  return {
    sismember: jest.fn(async () => false),
    getTokenInvalidBefore: jest.fn(async () => null),
  };
}

function makePrisma(opts: { mustSetup?: boolean; findThrows?: boolean } = {}) {
  const findUnique = jest.fn(async () => {
    if (opts.findThrows) throw new Error('database unreachable');
    return { mustSetupCredentials: !!opts.mustSetup };
  });
  return {
    prisma: { client: { user: { findUnique }, tenant: { findUnique: jest.fn(async () => null) } } },
    findUnique,
  };
}

describe('JwtAuthGuard — first-login credential setup gate', () => {
  const jwt = new JwtService({ secret: TEST_SECRET });
  const deviceJwt = new JwtService({ secret: DEVICE_SECRET });
  const prevJwtSecret = process.env.JWT_SECRET;
  const prevDeviceSecret = process.env.DEVICE_JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.DEVICE_JWT_SECRET = DEVICE_SECRET;
  });
  afterAll(() => {
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
    if (prevDeviceSecret === undefined) delete process.env.DEVICE_JWT_SECRET;
    else process.env.DEVICE_JWT_SECRET = prevDeviceSecret;
  });

  /** A session token for a user still in setup state (`msc: true`). */
  function gatedToken() {
    return jwt.sign({ sub: 'user-1', role: 'DISTRICT_ADMIN', tenantId: 't1', msc: true });
  }
  /** A normal session token — setup already done. */
  function normalToken() {
    return jwt.sign({ sub: 'user-1', role: 'DISTRICT_ADMIN', tenantId: 't1', msc: false });
  }
  /** A token minted before the claim existed (or by a path that omits it). */
  function claimlessToken() {
    return jwt.sign({ sub: 'user-1', role: 'DISTRICT_ADMIN', tenantId: 't1' });
  }

  describe('a gated account is refused everywhere else', () => {
    it.each([
      ['GET', '/api/v1/screens'],
      ['POST', '/api/v1/playlists'],
      ['GET', '/api/v1/templates'],
      ['PUT', '/api/v1/users/me'],
      ['POST', '/api/v1/auth/change-password'],
    ])('refuses %s %s with SETUP_REQUIRED', async (method, url) => {
      const { prisma } = makePrisma();
      const guard = new JwtAuthGuard(jwt, makeRedis() as any, undefined, prisma as any);
      const { ctx } = ctxFor(gatedToken(), method, url);

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: { code: 'SETUP_REQUIRED' },
      });
    });

    // The load-bearing one. `/emergency/trigger` puts a district into LOCKDOWN
    // and writes an immutable audit row naming the actor — which a placeholder
    // account cannot supply.
    it.each([
      ['POST', '/api/v1/emergency/trigger'],
      ['POST', '/api/v1/emergency/override-123/all-clear'],
      ['POST', '/api/v1/emergency/sos'],
    ])('refuses the life-safety route %s %s', async (method, url) => {
      const { prisma } = makePrisma();
      const guard = new JwtAuthGuard(jwt, makeRedis() as any, undefined, prisma as any);
      const { ctx } = ctxFor(gatedToken(), method, url);

      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: { code: 'SETUP_REQUIRED' },
      });
    });

    it('matches on the exact path, so a lookalike route is still refused', async () => {
      const { prisma } = makePrisma();
      const guard = new JwtAuthGuard(jwt, makeRedis() as any, undefined, prisma as any);
      // Prefix-shaped near-misses of the three allowed routes.
      for (const [method, url] of [
        ['POST', '/api/v1/auth/complete-setup/evil'],
        ['GET', '/api/v1/users/me/notifications'],
        ['POST', '/api/v1/users/me'],
      ] as const) {
        const { ctx } = ctxFor(gatedToken(), method, url);
        await expect(guard.canActivate(ctx)).rejects.toMatchObject({
          response: { code: 'SETUP_REQUIRED' },
        });
      }
    });

    it('refuses regardless of query string or path casing', async () => {
      const { prisma } = makePrisma();
      const guard = new JwtAuthGuard(jwt, makeRedis() as any, undefined, prisma as any);
      const { ctx } = ctxFor(gatedToken(), 'GET', '/API/v1/Screens?tenantId=t1');
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: { code: 'SETUP_REQUIRED' },
      });
    });
  });

  describe('the three escape routes stay open', () => {
    it.each(SETUP_REQUIRED_ALLOWED_ROUTES.map((r) => [r.method, r.path]))(
      'allows %s %s',
      async (method, path) => {
        const { prisma } = makePrisma();
        const guard = new JwtAuthGuard(jwt, makeRedis() as any, undefined, prisma as any);
        const { ctx, request } = ctxFor(gatedToken(), method, path);

        await expect(guard.canActivate(ctx)).resolves.toBe(true);
        expect(request.user).toMatchObject({ id: 'user-1', tenantId: 't1' });
      },
    );

    it('allows them with a query string attached', async () => {
      const { prisma } = makePrisma();
      const guard = new JwtAuthGuard(jwt, makeRedis() as any, undefined, prisma as any);
      const { ctx } = ctxFor(gatedToken(), 'GET', '/api/v1/users/me?fresh=1');
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('is exactly three routes — widening this list must be deliberate', () => {
      expect(SETUP_REQUIRED_ALLOWED_ROUTES).toEqual([
        { method: 'POST', path: '/api/v1/auth/complete-setup' },
        { method: 'POST', path: '/api/v1/auth/logout' },
        { method: 'GET', path: '/api/v1/users/me' },
      ]);
    });
  });

  describe('an account that is NOT in setup state is untouched', () => {
    it('passes through with no database read at all', async () => {
      const { prisma, findUnique } = makePrisma();
      const guard = new JwtAuthGuard(jwt, makeRedis() as any, undefined, prisma as any);
      const { ctx } = ctxFor(normalToken(), 'GET', '/api/v1/screens');

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      // The claim answered it — the hot auth path pays nothing.
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('can still reach emergency routes', async () => {
      const { prisma } = makePrisma();
      const guard = new JwtAuthGuard(jwt, makeRedis() as any, undefined, prisma as any);
      const { ctx } = ctxFor(normalToken(), 'POST', '/api/v1/emergency/trigger');
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('a token with NO claim is verified, never trusted', () => {
    it('reads the live row and refuses a flagged user', async () => {
      const { prisma, findUnique } = makePrisma({ mustSetup: true });
      const guard = new JwtAuthGuard(jwt, makeRedis() as any, undefined, prisma as any);
      const { ctx } = ctxFor(claimlessToken(), 'GET', '/api/v1/screens');

      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: { code: 'SETUP_REQUIRED' },
      });
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { mustSetupCredentials: true },
      });
    });

    it('reads the live row and allows an unflagged user', async () => {
      const { prisma, findUnique } = makePrisma({ mustSetup: false });
      const guard = new JwtAuthGuard(jwt, makeRedis() as any, undefined, prisma as any);
      const { ctx } = ctxFor(claimlessToken(), 'GET', '/api/v1/screens');

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it('caches the answer, so a burst of requests costs ONE read', async () => {
      const { prisma, findUnique } = makePrisma({ mustSetup: false });
      const guard = new JwtAuthGuard(jwt, makeRedis() as any, undefined, prisma as any);
      for (let i = 0; i < 5; i++) {
        const { ctx } = ctxFor(claimlessToken(), 'GET', '/api/v1/screens');
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
      }
      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it('ALLOWS when the lookup itself fails (availability, per the guard note)', async () => {
      const { prisma } = makePrisma({ findThrows: true });
      const guard = new JwtAuthGuard(jwt, makeRedis() as any, undefined, prisma as any);
      const { ctx } = ctxFor(claimlessToken(), 'GET', '/api/v1/screens');
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('machine identities are never gated', () => {
    it('lets a device token through untouched', async () => {
      const { prisma, findUnique } = makePrisma({ mustSetup: true });
      const guard = new JwtAuthGuard(jwt, makeRedis() as any, undefined, prisma as any);
      const token = deviceJwt.sign({ sub: 'screen-1', kind: 'device', tenantId: 't1' });
      const { ctx, request } = ctxFor(token, 'GET', '/api/v1/screens/screen-1/manifest');

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request.user).toMatchObject({ kind: 'device', id: 'screen-1' });
      expect(findUnique).not.toHaveBeenCalled();
    });
  });
});
