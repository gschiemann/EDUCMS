/**
 * ACC-06 follow-up (2026-08-03) — the guard half of per-key least privilege,
 * plus first-class forensic attribution on the rows it writes.
 *
 * Kept in its own file so `jwt-auth.guard.api-key.spec.ts` (the ACC-06
 * behaviour contract: emergency default-deny + attributable rows) stays
 * exactly as it was and keeps proving that the new code did not move it.
 */
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

const TEST_SECRET = 'dev_only_jwt_secret_CHANGE_ME';
const KEY = 'vos_' + 'b'.repeat(32);

function ctxFor(opts: { path?: string; method?: string } = {}) {
  const request: any = {
    headers: { authorization: `Bearer ${KEY}`, 'user-agent': 'script/1.0' },
    originalUrl: opts.path ?? '/api/v1/screens',
    method: opts.method ?? 'GET',
    ip: '203.0.113.9',
    user: undefined,
  };
  return { ctx: { switchToHttp: () => ({ getRequest: () => request }) } as any, request };
}

function makeDeps(scopes: string[] | null | undefined) {
  const auditCreate = jest.fn().mockResolvedValue({});
  const apiKeys = {
    verify: jest.fn().mockResolvedValue({
      id: 'key-1',
      tenantId: 'tenant-7',
      role: 'DISTRICT_ADMIN',
      ...(scopes === undefined ? {} : { scopes }),
    }),
  };
  const redis = {
    sismember: jest.fn().mockResolvedValue(false),
    getTokenInvalidBefore: jest.fn().mockResolvedValue(null),
  };
  const prisma = {
    client: {
      auditLog: { create: auditCreate },
      tenant: { findUnique: jest.fn().mockResolvedValue({ archivedAt: null }) },
    },
  };
  return { apiKeys, redis, prisma, auditCreate };
}

function guardFor(scopes: string[] | null | undefined) {
  const deps = makeDeps(scopes);
  const jwt = new JwtService({ secret: TEST_SECRET });
  return {
    guard: new JwtAuthGuard(jwt, deps.redis as any, deps.apiKeys as any, deps.prisma as any),
    ...deps,
  };
}

describe('JwtAuthGuard — per-key scopes (ACC-06 follow-up)', () => {
  const prevSecret = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = TEST_SECRET; });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
  });

  it('an UNRESTRICTED key (scopes null) still reaches every non-emergency route', async () => {
    // Every key minted before the column existed is null. This is the test
    // that says "this migration does not break a single live integration".
    const { guard } = guardFor(null);
    const c = ctxFor({ path: '/api/v1/playlists', method: 'POST' });
    await expect(guard.canActivate(c.ctx)).resolves.toBe(true);
    expect(c.request.user).toEqual(
      expect.objectContaining({ kind: 'api-key', apiKeyId: 'key-1' }),
    );
  });

  it('a key whose verify() omits scopes entirely is treated as unrestricted, not as an error', async () => {
    // Defensive: a partially-selected row must not throw inside the auth path.
    const { guard } = guardFor(undefined);
    await expect(guard.canActivate(ctxFor({ path: '/api/v1/screens' }).ctx)).resolves.toBe(true);
  });

  it('allows a request the key holds the scope for', async () => {
    const { guard } = guardFor(['content:write']);
    const c = ctxFor({ path: '/api/v1/playlists', method: 'POST' });
    await expect(guard.canActivate(c.ctx)).resolves.toBe(true);
    expect(c.request.user.apiKeyId).toBe('key-1');
  });

  it('refuses a family the key was not granted, and never attaches an identity', async () => {
    const { guard } = guardFor(['content:write']);
    const c = ctxFor({ path: '/api/v1/screens/s1', method: 'DELETE' });
    await expect(guard.canActivate(c.ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(c.request.user).toBeUndefined();
  });

  it('refuses a write when the key only holds read', async () => {
    const { guard } = guardFor(['content:read']);
    await expect(
      guard.canActivate(ctxFor({ path: '/api/v1/playlists', method: 'POST' }).ctx),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('names the missing scope in the error so the operator can fix it in one step', async () => {
    const { guard } = guardFor(['content:read']);
    await expect(
      guard.canActivate(ctxFor({ path: '/api/v1/playlists', method: 'POST' }).ctx),
    ).rejects.toThrow(/content:write/);
  });

  it('a scoped key is STILL denied the emergency path, before scopes are consulted', async () => {
    // The prefix deny is the floor: there is no emergency scope to grant, and
    // the check runs first so no scope evaluation can reach past it.
    const { guard, auditCreate } = guardFor(['content:write', 'screens:write']);
    await expect(
      guard.canActivate(ctxFor({ path: '/api/v1/emergency/trigger', method: 'POST' }).ctx),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const row = auditCreate.mock.calls.find(
      (c: any[]) => c[0]?.data?.action === 'API_KEY_REQUEST_DENIED',
    );
    expect(JSON.parse(row![0].data.details).reason).toBe('emergency-path');
  });

  describe('forensic attribution', () => {
    it('stamps apiKeyId as a first-class column on the ALLOWED row', async () => {
      const { guard, auditCreate } = guardFor(['content:write']);
      await guard.canActivate(ctxFor({ path: '/api/v1/playlists', method: 'POST' }).ctx);
      await Promise.resolve();
      const row = auditCreate.mock.calls.find(
        (c: any[]) => c[0]?.data?.action === 'API_KEY_REQUEST',
      );
      // Not just inside `details` JSON — the column is what makes
      // "everything key X did" an indexed query instead of a scan + parse.
      expect(row![0].data.apiKeyId).toBe('key-1');
      expect(row![0].data.userId).toBeNull();
    });

    it('stamps apiKeyId on the DENIED row too', async () => {
      const { guard, auditCreate } = guardFor([]);
      await expect(
        guard.canActivate(ctxFor({ path: '/api/v1/playlists', method: 'POST' }).ctx),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const row = auditCreate.mock.calls.find(
        (c: any[]) => c[0]?.data?.action === 'API_KEY_REQUEST_DENIED',
      );
      expect(row![0].data.apiKeyId).toBe('key-1');
      expect(JSON.parse(row![0].data.details).requiredScope).toBe('content:write');
    });

    it('records the grant verbatim so "granted everything" is distinguishable from "granted nothing"', async () => {
      const { guard, auditCreate } = guardFor(null);
      await guard.canActivate(ctxFor({ path: '/api/v1/playlists', method: 'POST' }).ctx);
      await Promise.resolve();
      const row = auditCreate.mock.calls.find(
        (c: any[]) => c[0]?.data?.action === 'API_KEY_REQUEST',
      );
      expect(JSON.parse(row![0].data.details).scopes).toBeNull();
    });

    it('suppresses a repeated identical denial so a looping integration cannot flood audit_logs', async () => {
      const { guard, auditCreate } = guardFor(['content:read']);
      for (let i = 0; i < 5; i++) {
        await expect(
          guard.canActivate(ctxFor({ path: '/api/v1/playlists', method: 'POST' }).ctx),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      // Denied every time (the suppression is about LOG volume, not access)…
      const denies = auditCreate.mock.calls.filter(
        (c: any[]) => c[0]?.data?.action === 'API_KEY_REQUEST_DENIED',
      );
      expect(denies).toHaveLength(1);
    });

    it('does NOT suppress the emergency deny — that one is always worth a row', async () => {
      const { guard, auditCreate } = guardFor(['content:write']);
      for (let i = 0; i < 3; i++) {
        await expect(
          guard.canActivate(ctxFor({ path: '/api/v1/emergency/trigger', method: 'POST' }).ctx),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      const denies = auditCreate.mock.calls.filter(
        (c: any[]) => c[0]?.data?.action === 'API_KEY_REQUEST_DENIED',
      );
      expect(denies).toHaveLength(3);
    });
  });
});
