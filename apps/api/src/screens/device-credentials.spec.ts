/**
 * Regression tests for the device-credential revocation WRITER (DT-01).
 *
 * The finding: `Screen.status='REVOKED'` was read in eight places and
 * written in ZERO, `jwt_revoked_list` had no device writer and a 30-day
 * Redis TTL against a year-long token, and deleting the Screen row (losing
 * its schedules and history) was the only kill switch that worked.
 */

import { revokeScreenCredentials, rotateScreenCredentialEpoch } from './device-credentials';
import { invalidateDeviceCredentialCache, verifyDeviceForScreen } from './device-auth';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

function makeDeps(updated: any = { id: 's1', credentialEpoch: 1 }) {
  return {
    prisma: {
      client: {
        screen: { update: jest.fn().mockResolvedValue(updated) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      },
    } as any,
    redis: {
      sadd: jest.fn().mockResolvedValue(1),
      mirrorRevokedTokenDurable: jest.fn().mockResolvedValue(undefined),
    },
  };
}

beforeEach(() => invalidateDeviceCredentialCache());

describe('revokeScreenCredentials', () => {
  it('bumps the credential epoch — retiring EVERY token ever minted for the screen', async () => {
    // The whole point of keying revocation on the screen rather than on a
    // token string: an operator revoking a dumpstered screen is not holding
    // its token, and a self-renewing credential mints a new string every
    // cycle. A denylist can reach neither.
    const deps = makeDeps();
    const res = await revokeScreenCredentials(deps, { screenId: 's1', reason: 'admin_revoke' });
    const call = deps.prisma.client.screen.update.mock.calls[0][0];
    expect(call.data.credentialEpoch).toEqual({ increment: 1 });
    expect(call.data.credentialEpochRotatedAt).toBeInstanceOf(Date);
    expect(res.credentialEpoch).toBe(1);
  });

  it('writes status=REVOKED for an operator revoke — the state nothing ever wrote', async () => {
    const deps = makeDeps();
    await revokeScreenCredentials(deps, {
      screenId: 's1',
      reason: 'admin_revoke',
      markRevokedStatus: true,
    });
    const call = deps.prisma.client.screen.update.mock.calls[0][0];
    expect(call.data.status).toBe('REVOKED');
    expect(call.data.credentialRevokedAt).toBeInstanceOf(Date);
  });

  it('does NOT write REVOKED for an unpair — the screen is meant to come back', async () => {
    const deps = makeDeps();
    await revokeScreenCredentials(deps, { screenId: 's1', reason: 'device_unpair' });
    const call = deps.prisma.client.screen.update.mock.calls[0][0];
    expect(call.data.status).toBeUndefined();
    // …but the credential is retired all the same.
    expect(call.data.credentialEpoch).toEqual({ increment: 1 });
  });

  it('mirrors a presented token into the DURABLE store (expiry from the JWT `exp`, not 30 days)', async () => {
    const deps = makeDeps();
    await revokeScreenCredentials(deps, {
      screenId: 's1',
      reason: 'device_unpair',
      presentedToken: 'the.raw.token',
    });
    expect(deps.redis.mirrorRevokedTokenDurable).toHaveBeenCalledWith('the.raw.token');
  });

  it('writes an immutable AuditLog row for every revocation', async () => {
    const deps = makeDeps();
    await revokeScreenCredentials(deps, {
      screenId: 's1',
      reason: 'admin_revoke',
      markRevokedStatus: true,
      tenantId: 't1',
      userId: 'u1',
    });
    const row = deps.prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(row.action).toBe('SCREEN_CREDENTIAL_REVOKED');
    expect(row.tenantId).toBe('t1');
    expect(row.userId).toBe('u1');
    expect(JSON.parse(row.details).reason).toBe('admin_revoke');
  });

  it('never lets a best-effort leg fail the revocation', async () => {
    // The epoch bump is the only write allowed to fail the caller. A Redis
    // blip or an audit-table hiccup must not leave a compromised screen
    // holding a live credential because the bookkeeping errored.
    const deps = makeDeps();
    deps.redis.mirrorRevokedTokenDurable.mockRejectedValue(new Error('redis down'));
    deps.prisma.client.auditLog.create.mockRejectedValue(new Error('audit down'));
    await expect(
      revokeScreenCredentials(deps, {
        screenId: 's1',
        reason: 'admin_revoke',
        presentedToken: 'tok',
      }),
    ).resolves.toMatchObject({ credentialEpoch: 1 });
  });

  it('a revoked credential is refused by the verifier on the next request', async () => {
    // End-to-end of the DT-01 loop: write → read.
    const row = {
      id: 's1',
      tenantId: 't1',
      screenGroupId: null,
      status: 'REVOKED',
      credentialEpoch: 1,
      credentialEpochRotatedAt: new Date(),
    };
    const prisma = { client: { screen: { findUnique: jest.fn().mockResolvedValue(row) } } } as any;
    const jwt = require('jsonwebtoken');
    const tok = jwt.sign(
      { sub: 's1', kind: 'device', ep: 0 },
      'dev_only_device_jwt_secret_CHANGE_ME',
      { expiresIn: '180d' },
    );
    const res = await verifyDeviceForScreen(
      { prisma },
      { headers: { authorization: `Bearer ${tok}` } } as any,
      's1',
    );
    expect(res).toMatchObject({ ok: false, reason: 'screen_revoked' });
  });
});

/**
 * The Redis tier of that revocation (2026-08-03).
 *
 * `RedisService` shipped `sismember` but no `sadd`, so the line above —
 * `await deps.redis.sadd?.('jwt_revoked_list', token)` — resolved to
 * `undefined` on every real revocation. Optional chaining made the missing
 * method a silent no-op: the durable Postgres mirror was written and the
 * epoch was bumped (so revocation still HELD), but the hot set that
 * `JwtAuthGuard` / the SSE controller / the WS gateway / `verifyDeviceForScreen`
 * all check FIRST was never populated, and nothing said so.
 *
 * These tests exercise the REAL `RedisService`, not a stub, so a future
 * refactor that drops the method again fails here instead of silently.
 */
describe('revokeScreenCredentials — Redis hot tier (real RedisService)', () => {
  const jwtLib = require('jsonwebtoken');
  const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';

  function prismaMock(updated: any = { id: 's1', credentialEpoch: 4 }) {
    return {
      client: {
        screen: { update: jest.fn().mockResolvedValue(updated) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      },
    } as any;
  }

  /** A RedisService in the "Redis is up" state with a capturing publisher. */
  function liveRedis(overrides: Record<string, any> = {}) {
    const { RedisService } = require('../realtime/redis.service');
    const svc = new RedisService();
    const publisher = {
      sadd: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(60 * 60 * 24 * 30), // the existing 30d key TTL
      expire: jest.fn().mockResolvedValue(1),
      ...overrides,
    };
    (svc as any).publisher = publisher;
    (svc as any).connected = true;
    jest.spyOn(svc, 'mirrorRevokedTokenDurable').mockResolvedValue(undefined);
    return { svc, publisher };
  }

  it('lands the token in BOTH tiers — Redis hot set and durable Postgres mirror', async () => {
    const prisma = prismaMock();
    const { svc, publisher } = liveRedis();
    const token = jwtLib.sign({ kind: 'device', sub: 's1' }, DEVICE_JWT_SECRET, { expiresIn: '180d' });

    const out = await revokeScreenCredentials(
      { prisma, redis: svc },
      { screenId: 's1', reason: 'admin_revoke', markRevokedStatus: true, presentedToken: token },
    );

    expect(out.credentialEpoch).toBe(4);
    expect(publisher.sadd).toHaveBeenCalledWith('jwt_revoked_list', token);
    expect(svc.mirrorRevokedTokenDurable).toHaveBeenCalledWith(token);

    const details = JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details);
    expect(details.redisDenylisted).toBe(true);
    expect(details.durableMirrored).toBe(true);
  });

  it('extends the shared key TTL to outlive a 180-day device token', async () => {
    // `jwt_revoked_list` wears a 30-day TTL (the rememberMe ceiling for a
    // USER session). A device credential lives 6× longer; without the
    // extension the hot tier would forget the revocation months early.
    const { svc, publisher } = liveRedis();
    const token = jwtLib.sign({ kind: 'device', sub: 's1' }, DEVICE_JWT_SECRET, { expiresIn: '180d' });

    await revokeScreenCredentials(
      { prisma: prismaMock(), redis: svc },
      { screenId: 's1', reason: 'admin_revoke', presentedToken: token },
    );

    expect(publisher.expire).toHaveBeenCalledTimes(1);
    expect(publisher.expire.mock.calls[0][1]).toBeGreaterThan(60 * 60 * 24 * 170);
  });

  it('never SHORTENS a key that already outlives the token being burned', async () => {
    const { svc, publisher } = liveRedis({ ttl: jest.fn().mockResolvedValue(60 * 60 * 24 * 365) });
    const token = jwtLib.sign({ kind: 'device', sub: 's1' }, DEVICE_JWT_SECRET, { expiresIn: '30d' });

    await revokeScreenCredentials(
      { prisma: prismaMock(), redis: svc },
      { screenId: 's1', reason: 'admin_revoke', presentedToken: token },
    );

    expect(publisher.expire).not.toHaveBeenCalled();
  });

  it('leaves a persistent (TTL -1) key alone', async () => {
    const { svc, publisher } = liveRedis({ ttl: jest.fn().mockResolvedValue(-1) });
    await revokeScreenCredentials(
      { prisma: prismaMock(), redis: svc },
      { screenId: 's1', reason: 'admin_revoke', presentedToken: 'not-a-jwt' },
    );
    expect(publisher.expire).not.toHaveBeenCalled();
  });

  // ── Fail-safe: Redis must never be able to fail a revocation ──────────

  it('still revokes via Postgres when the Redis SADD throws', async () => {
    const prisma = prismaMock();
    const { svc } = liveRedis({ sadd: jest.fn().mockRejectedValue(new Error('redis down')) });

    const out = await revokeScreenCredentials(
      { prisma, redis: svc },
      { screenId: 's1', reason: 'admin_revoke', markRevokedStatus: true, presentedToken: 'tok' },
    );

    expect(out.credentialEpoch).toBe(4);
    expect(prisma.client.screen.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ credentialEpoch: { increment: 1 }, status: 'REVOKED' }),
      }),
    );
    expect(svc.mirrorRevokedTokenDurable).toHaveBeenCalledWith('tok');

    // The audit row is honest about which tier did NOT take the write.
    const details = JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details);
    expect(details.redisDenylisted).toBe(false);
    expect(details.durableMirrored).toBe(true);
  });

  it('still revokes when Redis is not connected at all', async () => {
    const { RedisService } = require('../realtime/redis.service');
    const svc = new RedisService(); // no publisher, connected = false
    jest.spyOn(svc, 'mirrorRevokedTokenDurable').mockResolvedValue(undefined);
    const prisma = prismaMock();

    await expect(
      revokeScreenCredentials(
        { prisma, redis: svc },
        { screenId: 's1', reason: 'device_unpair', presentedToken: 'tok' },
      ),
    ).resolves.toEqual({ credentialEpoch: 4 });

    expect(svc.mirrorRevokedTokenDurable).toHaveBeenCalled();
    const details = JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details);
    expect(details.redisDenylisted).toBe(false);
  });

  it('sadd never throws, even when the TTL read fails', async () => {
    const { svc, publisher } = liveRedis({ ttl: jest.fn().mockRejectedValue(new Error('boom')) });
    await expect(svc.sadd('jwt_revoked_list', 'tok', { ttlSeconds: 999 })).resolves.toBe(true);
    expect(publisher.sadd).toHaveBeenCalled();
  });

  it('sadd reports false (never throws) when Redis is down', async () => {
    const { RedisService } = require('../realtime/redis.service');
    const svc = new RedisService();
    await expect(svc.sadd('jwt_revoked_list', 'tok')).resolves.toBe(false);
  });
});

/**
 * The read side of the same tier: a revocation that made it into Redis ONLY
 * (durable mirror not yet consulted, because Redis is up) must be honoured
 * by the hot path.
 */
describe('the hot path honours a Redis-only revocation hit', () => {
  const jwtLib = require('jsonwebtoken');
  const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
  const healthyScreen = {
    id: 's1',
    tenantId: 't1',
    screenGroupId: null,
    status: 'ONLINE',
    credentialEpoch: 0,
    credentialEpochRotatedAt: null,
  };
  const prismaFor = (row: any) =>
    ({ client: { screen: { findUnique: jest.fn().mockResolvedValue(row) } } }) as any;
  const req = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as any;
  const token = () => jwtLib.sign({ kind: 'device', sub: 's1' }, DEVICE_JWT_SECRET);

  it('REJECTS a token in jwt_revoked_list even though the screen row is healthy', async () => {
    const tok = token();
    const redis = { sismember: jest.fn().mockResolvedValue(true) };

    const res = await verifyDeviceForScreen({ prisma: prismaFor(healthyScreen), redis }, req(tok), 's1');

    expect(redis.sismember).toHaveBeenCalledWith('jwt_revoked_list', tok);
    expect(res).toEqual({ ok: false, reason: 'token_revoked' });
  });

  it('accepts the same token once it is no longer in the set', async () => {
    const redis = { sismember: jest.fn().mockResolvedValue(false) };
    const res = await verifyDeviceForScreen({ prisma: prismaFor(healthyScreen), redis }, req(token()), 's1');
    expect(res.ok).toBe(true);
  });

  it('fails CLOSED when the revocation lookup itself errors', async () => {
    const redis = { sismember: jest.fn().mockRejectedValue(new Error('redis down')) };
    const res = await verifyDeviceForScreen({ prisma: prismaFor(healthyScreen), redis }, req(token()), 's1');
    expect(res).toEqual({ ok: false, reason: 'revocation_check_unavailable' });
  });
});

describe('rotateScreenCredentialEpoch (DT-02)', () => {
  it('advances the epoch without the REVOKED semantics or an audit row', async () => {
    const deps = makeDeps({ credentialEpoch: 9 });
    const next = await rotateScreenCredentialEpoch(deps, 's1');
    expect(next).toBe(9);
    const call = deps.prisma.client.screen.update.mock.calls[0][0];
    expect(call.data.credentialEpoch).toEqual({ increment: 1 });
    expect(call.data.status).toBeUndefined();
    expect(deps.prisma.client.auditLog.create).not.toHaveBeenCalled();
  });
});
