/**
 * ACC-06 (MEDIUM, 2026-08-01) — an API key could fire a district-wide
 * lockdown, never expired, and was forensically anonymous.
 *
 * A tenant API key is a long-lived bearer string that lives in a script, a CI
 * secret or a vendor's integration config. Minted with DISTRICT_ADMIN (the
 * role the UI offers first) it satisfied `@RequireRoles` on POST
 * /api/v1/emergency/trigger — so a leaked key could put every screen in a
 * district into LOCKDOWN. `/emergency/sos` was reachable at CONTRIBUTOR too.
 * Meanwhile every AuditLog row an API key produced carried `userId: null` with
 * no key reference, so "which key did this?" was unanswerable.
 *
 * Also covers the ACC-05 runtime backstop: an emergency request from a user
 * whose tenant is ARCHIVED is refused at the guard.
 */
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard, API_KEY_DENIED_PATH_PREFIXES } from './jwt-auth.guard';

const TEST_SECRET = 'dev_only_jwt_secret_CHANGE_ME';
const KEY = 'vos_' + 'a'.repeat(32);

function ctxFor(token: string, opts: { path?: string; method?: string } = {}) {
  const request: any = {
    headers: { authorization: `Bearer ${token}`, 'user-agent': 'script/1.0' },
    originalUrl: opts.path ?? '/api/v1/screens',
    method: opts.method ?? 'GET',
    ip: '203.0.113.9',
    user: undefined,
  };
  return {
    ctx: { switchToHttp: () => ({ getRequest: () => request }) } as any,
    request,
  };
}

function makeDeps(opts: { tenantArchivedAt?: Date | null } = {}) {
  const auditCreate = jest.fn().mockResolvedValue({});
  const apiKeys = {
    verify: jest.fn().mockResolvedValue({
      id: 'key-1',
      tenantId: 'tenant-7',
      role: 'DISTRICT_ADMIN',
    }),
  };
  const redis = {
    sismember: jest.fn().mockResolvedValue(false),
    getTokenInvalidBefore: jest.fn().mockResolvedValue(null),
  };
  const prisma = {
    client: {
      auditLog: { create: auditCreate },
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ archivedAt: opts.tenantArchivedAt ?? null }),
      },
    },
  };
  return { apiKeys, redis, prisma, auditCreate };
}

describe('JwtAuthGuard — API keys and emergency routes (ACC-06)', () => {
  const jwt = new JwtService({ secret: TEST_SECRET });
  const prevSecret = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = TEST_SECRET; });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
  });

  it('denies an API key on POST /api/v1/emergency/trigger', async () => {
    const { apiKeys, redis, prisma } = makeDeps();
    const guard = new JwtAuthGuard(jwt, redis as any, apiKeys as any, prisma as any);
    const { ctx, request } = ctxFor(KEY, {
      path: '/api/v1/emergency/trigger',
      method: 'POST',
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    // The identity is never even attached — nothing downstream can see an
    // api-key actor on an emergency request.
    expect(request.user).toBeUndefined();
  });

  it('denies an API key on EVERY emergency sub-route, including /sos and all-clear', async () => {
    const paths = [
      '/api/v1/emergency/trigger',
      '/api/v1/emergency/sos',
      '/api/v1/emergency/broadcast',
      '/api/v1/emergency/media-alert',
      '/api/v1/emergency/abc123/all-clear',
      '/api/v1/emergency/messages/m1/all-clear',
    ];
    for (const path of paths) {
      const { apiKeys, redis, prisma } = makeDeps();
      const guard = new JwtAuthGuard(jwt, redis as any, apiKeys as any, prisma as any);
      await expect(
        guard.canActivate(ctxFor(KEY, { path, method: 'POST' }).ctx),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('is default-DENY by prefix, so a NEW emergency route is covered automatically', () => {
    // Documented intent: no per-route annotation to forget.
    expect(API_KEY_DENIED_PATH_PREFIXES).toContain('/api/v1/emergency');
    expect('/api/v1/emergency/some-future-route'.startsWith(API_KEY_DENIED_PATH_PREFIXES[0])).toBe(true);
  });

  it('records the DENIED attempt against the specific key', async () => {
    const { apiKeys, redis, prisma, auditCreate } = makeDeps();
    const guard = new JwtAuthGuard(jwt, redis as any, apiKeys as any, prisma as any);
    await expect(
      guard.canActivate(ctxFor(KEY, { path: '/api/v1/emergency/trigger', method: 'POST' }).ctx),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const row = auditCreate.mock.calls.find(
      (c: any[]) => c[0]?.data?.action === 'API_KEY_REQUEST_DENIED',
    );
    expect(row).toBeDefined();
    expect(row![0].data.tenantId).toBe('tenant-7');
    expect(row![0].data.targetId).toBe('key-1');
    expect(JSON.parse(row![0].data.details).apiKeyId).toBe('key-1');
  });

  it('still allows an API key on ordinary routes (integrations keep working)', async () => {
    const { apiKeys, redis, prisma } = makeDeps();
    const guard = new JwtAuthGuard(jwt, redis as any, apiKeys as any, prisma as any);
    const { ctx, request } = ctxFor(KEY, { path: '/api/v1/screens', method: 'GET' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual(
      expect.objectContaining({ kind: 'api-key', apiKeyId: 'key-1', tenantId: 'tenant-7' }),
    );
  });

  describe('forensic attribution (the rows used to be anonymous)', () => {
    it('writes an attributable API_KEY_REQUEST row for a state-changing request', async () => {
      const { apiKeys, redis, prisma, auditCreate } = makeDeps();
      const guard = new JwtAuthGuard(jwt, redis as any, apiKeys as any, prisma as any);
      await guard.canActivate(
        ctxFor(KEY, { path: '/api/v1/playlists', method: 'POST' }).ctx,
      );
      // The write is fire-and-forget; let the microtask land.
      await Promise.resolve();

      const row = auditCreate.mock.calls.find(
        (c: any[]) => c[0]?.data?.action === 'API_KEY_REQUEST',
      );
      expect(row).toBeDefined();
      const details = JSON.parse(row![0].data.details);
      // Correlating (tenantId, timestamp) now resolves an otherwise anonymous
      // action row to a specific key, route and IP.
      expect(details.apiKeyId).toBe('key-1');
      expect(details.method).toBe('POST');
      expect(details.path).toBe('/api/v1/playlists');
      expect(details.ip).toBe('203.0.113.9');
      expect(details.outcome).toBe('ALLOWED');
    });

    it('does not log reads (attribution is about CHANGES, not noise)', async () => {
      const { apiKeys, redis, prisma, auditCreate } = makeDeps();
      const guard = new JwtAuthGuard(jwt, redis as any, apiKeys as any, prisma as any);
      await guard.canActivate(ctxFor(KEY, { path: '/api/v1/screens', method: 'GET' }).ctx);
      await Promise.resolve();
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it('never fails the request when the audit write fails', async () => {
      const { apiKeys, redis, prisma, auditCreate } = makeDeps();
      auditCreate.mockRejectedValue(new Error('db down'));
      const guard = new JwtAuthGuard(jwt, redis as any, apiKeys as any, prisma as any);
      await expect(
        guard.canActivate(ctxFor(KEY, { path: '/api/v1/playlists', method: 'POST' }).ctx),
      ).resolves.toBe(true);
    });
  });
});

describe('JwtAuthGuard — archived tenant cannot trigger emergencies (ACC-05 backstop)', () => {
  const jwt = new JwtService({ secret: TEST_SECRET });
  const prevSecret = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = TEST_SECRET; });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
  });

  const userToken = () =>
    jwt.sign({ sub: 'u1', role: 'DISTRICT_ADMIN', tenantId: 'tenant-7' });

  it('refuses an emergency trigger from a user whose tenant is archived', async () => {
    const { apiKeys, redis, prisma } = makeDeps({ tenantArchivedAt: new Date() });
    const guard = new JwtAuthGuard(jwt, redis as any, apiKeys as any, prisma as any);
    await expect(
      guard.canActivate(
        ctxFor(userToken(), { path: '/api/v1/emergency/trigger', method: 'POST' }).ctx,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the trigger when the tenant is live', async () => {
    const { apiKeys, redis, prisma } = makeDeps({ tenantArchivedAt: null });
    const guard = new JwtAuthGuard(jwt, redis as any, apiKeys as any, prisma as any);
    await expect(
      guard.canActivate(
        ctxFor(userToken(), { path: '/api/v1/emergency/trigger', method: 'POST' }).ctx,
      ),
    ).resolves.toBe(true);
  });

  it('does NOT pay a tenant lookup on ordinary (non-emergency) routes', async () => {
    const { apiKeys, redis, prisma } = makeDeps();
    const guard = new JwtAuthGuard(jwt, redis as any, apiKeys as any, prisma as any);
    await guard.canActivate(ctxFor(userToken(), { path: '/api/v1/screens' }).ctx);
    expect(prisma.client.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('ALLOWS the trigger when the archive lookup itself fails (life-safety availability)', async () => {
    // Deliberate asymmetry with the token-revocation checks, which fail
    // CLOSED. This one is a housekeeping control, not a threat gate: a DB
    // hiccup must never be the reason a lockdown does not fire.
    const { apiKeys, redis, prisma } = makeDeps();
    prisma.client.tenant.findUnique = jest.fn().mockRejectedValue(new Error('db down'));
    const guard = new JwtAuthGuard(jwt, redis as any, apiKeys as any, prisma as any);
    await expect(
      guard.canActivate(
        ctxFor(userToken(), { path: '/api/v1/emergency/trigger', method: 'POST' }).ctx,
      ),
    ).resolves.toBe(true);
  });

  it('exposes the session exp so a tenant switch can cap the reissued token (ACC-07)', async () => {
    const { apiKeys, redis, prisma } = makeDeps();
    const guard = new JwtAuthGuard(jwt, redis as any, apiKeys as any, prisma as any);
    const { ctx, request } = ctxFor(jwt.sign({ sub: 'u1', role: 'DISTRICT_ADMIN', tenantId: 't1' }, { expiresIn: '1h' }));
    await guard.canActivate(ctx);
    expect(typeof request.user.tokenExp).toBe('number');
    expect(request.user.tokenExp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
