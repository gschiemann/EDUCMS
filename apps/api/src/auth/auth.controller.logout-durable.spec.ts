/**
 * Logout revocation contract.
 *
 * (1) 2026-07-10 — durable revocation backstop. The logout revocation used to
 * live ONLY in Redis (`jwt_revoked_list` SADD). These tests pin:
 *  - every logout ALSO mirrors the revocation to Postgres via
 *    RedisService.mirrorRevokedTokenDurable (best-effort),
 *  - the mirror runs BEFORE the Redis write, so the durable row lands
 *    even on the Redis-down 503 paths (revocation is then enforced by
 *    the guard's Postgres fallback during the outage),
 *  - the Redis-primary success semantics are unchanged: Redis down /
 *    erroring still 503s (AUTH_REVOCATION_SERVICE_UNAVAILABLE).
 *
 * (2) 2026-08-03 — logout must not SHORTEN a revocation TTL. `jwt_revoked_list`
 * is one shared set with a per-KEY expiry, and device revocation deliberately
 * EXTENDS it to outlive a 180-day device token. Logout used to reach past
 * RedisService and call `publisher.expire('jwt_revoked_list', 30d)` on the raw
 * client, re-stamping the key DOWN to 30 days and quietly re-validating every
 * revoked device token in the set. It now routes through
 * `RedisService.sadd(key, member, { ttlSeconds })`, whose TTL handling is
 * extend-only. The last block pins both directions of that rule against the
 * REAL RedisService method.
 */
import { HttpException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { RedisService } from '../realtime/redis.service';

function makeController(opts: { publisher: any }) {
  const mirrorRevokedTokenDurable = jest.fn(async () => undefined);
  // Stand-in for RedisService.sadd mirroring the real fail-safe contract:
  // never throws, returns false when the publisher is missing or the write
  // failed. (The extend-only TTL behaviour itself is pinned separately below,
  // against the real implementation.)
  const sadd = jest.fn(async (key: string, member: string) => {
    if (!opts.publisher) return false;
    try {
      await opts.publisher.sadd(key, member);
    } catch {
      return false;
    }
    return true;
  });
  const redisService = { publisher: opts.publisher, mirrorRevokedTokenDurable, sadd };
  const prisma = {
    client: { auditLog: { create: jest.fn(async () => ({})) } },
  };
  const controller = new AuthController(
    {} as any,
    redisService as any,
    prisma as any,
  );
  return { controller, mirrorRevokedTokenDurable, sadd, prisma };
}

function reqWith(token: string) {
  return {
    headers: { authorization: `Bearer ${token}` },
    user: { userId: 'user-1', tenantId: 't1' },
    ip: '127.0.0.1',
  } as any;
}

describe('POST /auth/logout — durable dual-write', () => {
  it('happy path: mirrors to Postgres AND revokes in Redis', async () => {
    const sadd = jest.fn(async () => 1);
    const expire = jest.fn(async () => 1);
    const { controller, mirrorRevokedTokenDurable, sadd: svcSadd } = makeController({
      publisher: { sadd, expire },
    });

    await expect(controller.logout(reqWith('tok-123'))).resolves.toEqual({
      success: true,
    });

    expect(mirrorRevokedTokenDurable).toHaveBeenCalledWith('tok-123');
    expect(sadd).toHaveBeenCalledWith('jwt_revoked_list', 'tok-123');
    // Mirror ran BEFORE the Redis write.
    expect(mirrorRevokedTokenDurable.mock.invocationCallOrder[0]).toBeLessThan(
      sadd.mock.invocationCallOrder[0],
    );
    // 2026-08-03 — the TTL rides through RedisService.sadd as a FLOOR
    // (extend-only), never as a raw `expire` that could shorten the key.
    expect(svcSadd).toHaveBeenCalledWith('jwt_revoked_list', 'tok-123', {
      ttlSeconds: 60 * 60 * 24 * 30,
    });
    expect(expire).not.toHaveBeenCalled();
  });

  it('redis unavailable (no publisher): still mirrors durably, then 503s as before', async () => {
    const { controller, mirrorRevokedTokenDurable } = makeController({
      publisher: null,
    });

    await expect(controller.logout(reqWith('tok-123'))).rejects.toThrow(
      HttpException,
    );
    expect(mirrorRevokedTokenDurable).toHaveBeenCalledWith('tok-123');
  });

  it('redis write fails (sadd reports false, never throws): still mirrors durably, then 503s as before', async () => {
    const sadd = jest.fn(async () => {
      throw new Error('redis down');
    });
    const { controller, mirrorRevokedTokenDurable } = makeController({
      publisher: { sadd, expire: jest.fn() },
    });

    await expect(controller.logout(reqWith('tok-123'))).rejects.toThrow(
      HttpException,
    );
    expect(mirrorRevokedTokenDurable).toHaveBeenCalledWith('tok-123');
  });

  it('no bearer token → 401 without touching either store', async () => {
    const sadd = jest.fn();
    const { controller, mirrorRevokedTokenDurable } = makeController({
      publisher: { sadd, expire: jest.fn() },
    });

    await expect(controller.logout({ headers: {} } as any)).rejects.toThrow(
      'No bearer token',
    );
    expect(mirrorRevokedTokenDurable).not.toHaveBeenCalled();
    expect(sadd).not.toHaveBeenCalled();
  });
});

describe('jwt_revoked_list TTL is extend-only (RedisService.sadd)', () => {
  function liveRedis(ttlNow: number) {
    const publisher = {
      sadd: jest.fn(async () => 1),
      ttl: jest.fn(async () => ttlNow),
      expire: jest.fn(async () => 1),
    };
    const svc = new RedisService(undefined as any);
    (svc as any).publisher = publisher;
    (svc as any).connected = true;
    return { svc, publisher };
  }

  const THIRTY_DAYS = 60 * 60 * 24 * 30;
  const ONE_EIGHTY_DAYS = 60 * 60 * 24 * 180;

  it('EXTENDS: the logout 30-day floor lengthens a key that currently expires sooner', async () => {
    const { svc, publisher } = liveRedis(60 * 60); // 1h left
    await expect(
      svc.sadd('jwt_revoked_list', 'tok', { ttlSeconds: THIRTY_DAYS }),
    ).resolves.toBe(true);
    expect(publisher.expire).toHaveBeenCalledWith('jwt_revoked_list', THIRTY_DAYS);
  });

  it('REFUSES to shorten: a logout cannot pull a 180-day device window down to 30 days', async () => {
    const { svc, publisher } = liveRedis(ONE_EIGHTY_DAYS);
    await expect(
      svc.sadd('jwt_revoked_list', 'tok', { ttlSeconds: THIRTY_DAYS }),
    ).resolves.toBe(true);
    // Member still lands…
    expect(publisher.sadd).toHaveBeenCalledWith('jwt_revoked_list', 'tok');
    // …but the longer expiry is left alone.
    expect(publisher.expire).not.toHaveBeenCalled();
  });

  it('REFUSES to shorten a key with NO expiry at all (ttl === -1)', async () => {
    const { svc, publisher } = liveRedis(-1);
    await expect(
      svc.sadd('jwt_revoked_list', 'tok', { ttlSeconds: THIRTY_DAYS }),
    ).resolves.toBe(true);
    expect(publisher.expire).not.toHaveBeenCalled();
  });
});
