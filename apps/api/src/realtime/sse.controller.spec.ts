/**
 * SSE device-JWT revocation runs in ALL envs (Audit 38-authz LOW #1).
 * ──────────────────────────────────────────────────────────────────────
 *
 * Before this fix the `jwt_revoked_list` check was wrapped in
 * `if (process.env.NODE_ENV === 'production')`, so a revoked device token
 * could keep an SSE stream open in staging/dev. jwt-auth.guard.ts had this
 * gate removed in P1-4; SSE must match. These tests run with NODE_ENV unset
 * (i.e. NOT 'production') and prove:
 *   1. A revoked token is rejected with 401 (revocation actually runs).
 *   2. A non-revoked token is accepted (stream registered).
 *   3. The check fails CLOSED (401) when Redis errors.
 */
import * as jwt from 'jsonwebtoken';
import { Logger } from '@nestjs/common';
import { SseController } from './sse.controller';

const DEVICE_JWT_SECRET = 'test-device-jwt-secret-0123456789abcdef';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined as any);
});
afterAll(() => jest.restoreAllMocks());

function makeRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status: jest.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    json: jest.fn(function (this: any, b: unknown) { this.body = b; return this; }),
    setHeader: jest.fn(function (this: any, k: string, v: string) { this.headers[k] = v; }),
    flushHeaders: jest.fn(),
  };
  return res;
}

function makeController(opts: {
  sismember: jest.Mock;
  screenTenantId?: string | null;
}) {
  const sse = { register: jest.fn() };
  const prisma = {
    client: {
      screen: {
        findUnique: jest.fn(async () => (opts.screenTenantId === undefined
          ? { tenantId: 'tenant-1' }
          : opts.screenTenantId === null
            ? null
            : { tenantId: opts.screenTenantId })),
      },
    },
  };
  const redis = { sismember: opts.sismember };
  const controller = new SseController(sse as any, prisma as any, redis as any);
  return { controller, sse, redis, prisma };
}

function deviceToken(screenId = 'screen-1') {
  return jwt.sign({ kind: 'device', sub: screenId }, DEVICE_JWT_SECRET);
}

describe('SseController — JWT revocation (non-prod, Audit 38-authz)', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.DEVICE_JWT_SECRET;

  beforeEach(() => {
    // Explicitly NOT production — this is the whole point of the test.
    process.env.NODE_ENV = 'test';
    process.env.DEVICE_JWT_SECRET = DEVICE_JWT_SECRET;
  });
  afterEach(() => {
    process.env.NODE_ENV = prevEnv;
    if (prevSecret === undefined) delete process.env.DEVICE_JWT_SECRET;
    else process.env.DEVICE_JWT_SECRET = prevSecret;
  });

  it('REJECTS a revoked device token with 401 even when NODE_ENV !== production', async () => {
    const sismember = jest.fn(async () => true); // token is in jwt_revoked_list
    const { controller, sse, redis } = makeController({ sismember });
    const res = makeRes();

    await controller.sseStream(deviceToken(), {} as any, res as any);

    // Revocation actually ran (the bug was that it was skipped in non-prod).
    expect(redis.sismember).toHaveBeenCalledWith('jwt_revoked_list', expect.any(String));
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'invalid token' });
    // Stream must NOT have been opened for a revoked token.
    expect(sse.register).not.toHaveBeenCalled();
  });

  it('accepts a non-revoked device token (stream registered)', async () => {
    const sismember = jest.fn(async () => false);
    const { controller, sse, redis } = makeController({ sismember });
    const res = makeRes();

    await controller.sseStream(deviceToken(), { headers: {} } as any, res as any);

    expect(redis.sismember).toHaveBeenCalled();
    expect(sse.register).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', deviceId: 'screen-1' }),
    );
    // No 401 path was taken.
    expect(res.body).toBeUndefined();
  });

  // Group-scoped delivery (2026-06-01): the SSE service already supported a
  // group scope (SseClient.groupId + group match in broadcastToScope), but the
  // controller never passed it. Without this, a group-scoped emergency (e.g. a
  // hallway-group lockdown) never reached an SSE-fallback kiosk in real time.
  // Sourced from the live screen row (not the JWT) — see sse.controller.ts.
  it('passes the live screen group scope to register (group-scoped emergency delivery)', async () => {
    const sismember = jest.fn(async () => false);
    const { controller, sse, prisma } = makeController({ sismember });
    prisma.client.screen.findUnique.mockResolvedValueOnce({ tenantId: 'tenant-1', screenGroupId: 'grp-hallway' });
    const res = makeRes();

    await controller.sseStream(deviceToken(), { headers: {} } as any, res as any);

    expect(sse.register).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', groupId: 'grp-hallway', deviceId: 'screen-1' }),
    );
  });

  it('passes groupId: null when the screen belongs to no group', async () => {
    const sismember = jest.fn(async () => false);
    const { controller, sse } = makeController({ sismember }); // default screen has no screenGroupId
    const res = makeRes();

    await controller.sseStream(deviceToken(), { headers: {} } as any, res as any);

    expect(sse.register).toHaveBeenCalledWith(expect.objectContaining({ groupId: null }));
  });

  it('fails CLOSED (401) when the Redis revocation check errors', async () => {
    const sismember = jest.fn(async () => { throw new Error('redis down'); });
    const { controller, sse } = makeController({ sismember });
    const res = makeRes();

    await controller.sseStream(deviceToken(), {} as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(sse.register).not.toHaveBeenCalled();
  });
});
