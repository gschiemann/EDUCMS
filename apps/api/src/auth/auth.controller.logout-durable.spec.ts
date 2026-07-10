/**
 * Logout dual-write (2026-07-10 — durable revocation backstop).
 *
 * The logout revocation used to live ONLY in Redis (`jwt_revoked_list`
 * SADD). These tests pin the new contract:
 *  - every logout ALSO mirrors the revocation to Postgres via
 *    RedisService.mirrorRevokedTokenDurable (best-effort),
 *  - the mirror runs BEFORE the Redis write, so the durable row lands
 *    even on the Redis-down 503 paths (revocation is then enforced by
 *    the guard's Postgres fallback during the outage),
 *  - the Redis-primary success semantics are unchanged: Redis down /
 *    erroring still 503s (AUTH_REVOCATION_SERVICE_UNAVAILABLE).
 */
import { HttpException } from '@nestjs/common';
import { AuthController } from './auth.controller';

function makeController(opts: { publisher: any }) {
  const mirrorRevokedTokenDurable = jest.fn(async () => undefined);
  const redisService = { publisher: opts.publisher, mirrorRevokedTokenDurable };
  const prisma = {
    client: { auditLog: { create: jest.fn(async () => ({})) } },
  };
  const controller = new AuthController(
    {} as any,
    redisService as any,
    prisma as any,
  );
  return { controller, mirrorRevokedTokenDurable, prisma };
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
    const { controller, mirrorRevokedTokenDurable } = makeController({
      publisher: { sadd, expire },
    });

    await expect(controller.logout(reqWith('tok-123'))).resolves.toEqual({
      success: true,
    });

    expect(mirrorRevokedTokenDurable).toHaveBeenCalledWith('tok-123');
    expect(sadd).toHaveBeenCalledWith('jwt_revoked_list', 'tok-123');
    expect(expire).toHaveBeenCalledWith('jwt_revoked_list', 60 * 60 * 24 * 30);
    // Mirror ran BEFORE the Redis write.
    expect(mirrorRevokedTokenDurable.mock.invocationCallOrder[0]).toBeLessThan(
      sadd.mock.invocationCallOrder[0],
    );
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

  it('redis write throws: still mirrors durably, then 503s as before', async () => {
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
