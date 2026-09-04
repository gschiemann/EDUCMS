/**
 * SSE admission control.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Two suites live here:
 *
 * 1. `?ticket=` — the DT-08 stream ticket (2026-08-03). `EventSource` cannot
 *    set headers, so whatever authenticates the stream rides in the URL; the
 *    fix is to put a 60-second, single-screen, epoch-bound ticket there
 *    instead of the kiosk's 180-day device JWT. These tests prove the ticket
 *    is actually verified, that a revoked screen cannot open a stream, and
 *    that a superseded epoch is refused with no grace window.
 *
 * 2. `?token=` — the legacy device-JWT leg, kept until `apps/web` learns to
 *    mint a ticket (see the header of sse.controller.ts). Before this fix the
 *    `jwt_revoked_list` check was wrapped in `NODE_ENV === 'production'`, so a
 *    revoked device token could keep an SSE stream open in staging/dev; that
 *    gate was removed (Audit 38-authz LOW #1) and these tests pin it. As of
 *    2026-08-03 the leg ALSO enforces the DT-01 credential-epoch / REVOKED
 *    checks that every other device-authenticated route already ran.
 */
import * as jwt from 'jsonwebtoken';
import { Logger } from '@nestjs/common';
import { SseController } from './sse.controller';
import { mintStreamTicket, STREAM_TICKET_TTL_MS } from '../screens/stream-ticket';
import { invalidateDeviceCredentialCache } from '../screens/device-auth';

const DEVICE_JWT_SECRET = 'test-device-jwt-secret-0123456789abcdef';
const DEVICE_SECRET_KEY = 'test-device-secret-key-0123456789abcdef';

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
  sismember?: jest.Mock;
  screenTenantId?: string | null;
  screenRow?: any;
}) {
  const sismember = opts.sismember ?? jest.fn(async () => false);
  const sse = { register: jest.fn() };
  const defaultRow = opts.screenRow !== undefined
    ? opts.screenRow
    : opts.screenTenantId === undefined
      ? { tenantId: 'tenant-1' }
      : opts.screenTenantId === null
        ? null
        : { tenantId: opts.screenTenantId };
  const prisma = {
    client: { screen: { findUnique: jest.fn(async () => defaultRow) } },
  };
  const redis = { sismember };
  const controller = new SseController(sse as any, prisma as any, redis as any);
  return { controller, sse, redis, prisma };
}

function deviceToken(screenId = 'screen-1', extra: Record<string, unknown> = {}) {
  return jwt.sign({ kind: 'device', sub: screenId, ...extra }, DEVICE_JWT_SECRET);
}

const prevEnv = process.env.NODE_ENV;
const prevJwtSecret = process.env.DEVICE_JWT_SECRET;
const prevDeviceSecret = process.env.DEVICE_SECRET_KEY;

beforeEach(() => {
  // Explicitly NOT production — the revocation gate must run anyway.
  process.env.NODE_ENV = 'test';
  process.env.DEVICE_JWT_SECRET = DEVICE_JWT_SECRET;
  process.env.DEVICE_SECRET_KEY = DEVICE_SECRET_KEY;
  // SEC-001 realtime (2026-09-04): the `?token=` leg now shares the ONE
  // device-credential admission with HTTP and WS, which means it also shares
  // its per-screen credential snapshot (5 s, process-global, dropped by every
  // revocation writer). Every case below re-uses the id `screen-1` with a
  // DIFFERENT live row, so the snapshot has to be dropped between them or a
  // test reads the previous test's screen. This is a test-isolation
  // requirement, not a production one — in production the cache is
  // invalidated by the writer that retires the credential.
  invalidateDeviceCredentialCache();
});
afterEach(() => {
  process.env.NODE_ENV = prevEnv;
  if (prevJwtSecret === undefined) delete process.env.DEVICE_JWT_SECRET;
  else process.env.DEVICE_JWT_SECRET = prevJwtSecret;
  if (prevDeviceSecret === undefined) delete process.env.DEVICE_SECRET_KEY;
  else process.env.DEVICE_SECRET_KEY = prevDeviceSecret;
});

describe('SseController — stream-ticket admission (DT-08)', () => {
  it('accepts a valid ticket and registers the stream WITHOUT a token', async () => {
    const { controller, sse } = makeController({
      screenRow: { tenantId: 'tenant-1', screenGroupId: 'grp-hallway', status: 'ONLINE', credentialEpoch: 7 },
    });
    const res = makeRes();
    const { ticket } = mintStreamTicket('screen-1', 7);

    await controller.sseStream(ticket, undefined, { headers: {} } as any, res as any);

    expect(res.body).toBeUndefined();
    expect(sse.register).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        groupId: 'grp-hallway',
        deviceId: 'screen-1',
        // No long-lived credential is retained for a ticket-authed stream —
        // that is the entire point of DT-08.
        token: null,
        credentialEpoch: 7,
      }),
    );
  });

  it('never consults the token denylist on the ticket path (no token exists to burn)', async () => {
    const sismember = jest.fn(async () => false);
    const { controller } = makeController({
      sismember,
      screenRow: { tenantId: 'tenant-1', status: 'ONLINE', credentialEpoch: 0 },
    });
    const { ticket } = mintStreamTicket('screen-1', 0);

    await controller.sseStream(ticket, undefined, { headers: {} } as any, makeRes() as any);

    expect(sismember).not.toHaveBeenCalled();
  });

  it('REJECTS a forged ticket (bad signature)', async () => {
    const { controller, sse } = makeController({
      screenRow: { tenantId: 'tenant-1', status: 'ONLINE', credentialEpoch: 0 },
    });
    const res = makeRes();
    const { ticket } = mintStreamTicket('screen-1', 0);
    const forged = `${ticket.slice(0, ticket.lastIndexOf('.'))}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

    await controller.sseStream(forged, undefined, { headers: {} } as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'invalid ticket' });
    expect(sse.register).not.toHaveBeenCalled();
  });

  it('REJECTS a ticket minted for a DIFFERENT screen than it names (re-signing needed)', async () => {
    const { controller, sse } = makeController({
      screenRow: { tenantId: 'tenant-1', status: 'ONLINE', credentialEpoch: 0 },
    });
    const res = makeRes();
    const { ticket } = mintStreamTicket('screen-1', 0);
    // Swap the screenId field but keep the original signature.
    const parts = ticket.split('.');
    parts[1] = 'screen-victim';
    await controller.sseStream(parts.join('.'), undefined, { headers: {} } as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(sse.register).not.toHaveBeenCalled();
  });

  it('REJECTS an expired ticket', async () => {
    const { controller, sse } = makeController({
      screenRow: { tenantId: 'tenant-1', status: 'ONLINE', credentialEpoch: 0 },
    });
    const res = makeRes();
    // Mint one that expired a second ago.
    const { ticket } = mintStreamTicket('screen-1', 0, Date.now() - STREAM_TICKET_TTL_MS - 1_000);

    await controller.sseStream(ticket, undefined, { headers: {} } as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(sse.register).not.toHaveBeenCalled();
  });

  it('REJECTS a ticket for a REVOKED screen (DT-01 revocation must kill the stream)', async () => {
    const { controller, sse } = makeController({
      screenRow: { tenantId: 'tenant-1', status: 'REVOKED', credentialEpoch: 3 },
    });
    const res = makeRes();
    const { ticket } = mintStreamTicket('screen-1', 3);

    await controller.sseStream(ticket, undefined, { headers: {} } as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(sse.register).not.toHaveBeenCalled();
  });

  it('REJECTS a ticket whose epoch is one behind the live row — NO grace window', async () => {
    // The long-lived-credential path allows epoch-1 inside a 24h rotation
    // grace window. A ticket must not: revocation is a single bump, and a
    // 60-second ticket is trivially re-minted.
    const { controller, sse } = makeController({
      screenRow: {
        tenantId: 'tenant-1',
        status: 'ONLINE',
        credentialEpoch: 4,
        credentialEpochRotatedAt: new Date(),
      },
    });
    const res = makeRes();
    const { ticket } = mintStreamTicket('screen-1', 3);

    await controller.sseStream(ticket, undefined, { headers: {} } as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(sse.register).not.toHaveBeenCalled();
  });

  it('404s a ticket for a deleted / unpaired screen', async () => {
    const { controller, sse } = makeController({ screenRow: null });
    const res = makeRes();
    const { ticket } = mintStreamTicket('screen-1', 0);

    await controller.sseStream(ticket, undefined, { headers: {} } as any, res as any);

    expect(res.statusCode).toBe(404);
    expect(sse.register).not.toHaveBeenCalled();
  });

  it('401s when neither a ticket nor a token is supplied', async () => {
    const { controller, sse } = makeController({});
    const res = makeRes();

    await controller.sseStream(undefined, undefined, { headers: {} } as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'ticket required' });
    expect(sse.register).not.toHaveBeenCalled();
  });
});

describe('SseController — legacy ?token= leg (Audit 38-authz + DT-01)', () => {
  it('REJECTS a revoked device token with 401 even when NODE_ENV !== production', async () => {
    const sismember = jest.fn(async () => true); // token is in jwt_revoked_list
    const { controller, sse, redis } = makeController({ sismember });
    const res = makeRes();

    await controller.sseStream(undefined, deviceToken(), {} as any, res as any);

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

    await controller.sseStream(undefined, deviceToken(), { headers: {} } as any, res as any);

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

    await controller.sseStream(undefined, deviceToken(), { headers: {} } as any, res as any);

    expect(sse.register).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', groupId: 'grp-hallway', deviceId: 'screen-1' }),
    );
  });

  it('passes groupId: null when the screen belongs to no group', async () => {
    const sismember = jest.fn(async () => false);
    const { controller, sse } = makeController({ sismember }); // default screen has no screenGroupId
    const res = makeRes();

    await controller.sseStream(undefined, deviceToken(), { headers: {} } as any, res as any);

    expect(sse.register).toHaveBeenCalledWith(expect.objectContaining({ groupId: null }));
  });

  it('fails CLOSED (401) when the Redis revocation check errors', async () => {
    const sismember = jest.fn(async () => { throw new Error('redis down'); });
    const { controller, sse } = makeController({ sismember });
    const res = makeRes();

    await controller.sseStream(undefined, deviceToken(), {} as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(sse.register).not.toHaveBeenCalled();
  });

  // ── DT-01 parity, added 2026-08-03 ────────────────────────────────────
  // The denylist can only burn the ONE token string it is holding. An
  // operator revoke bumps `credentialEpoch` and flips `status`; this
  // endpoint used to check neither, so a revoked screen kept a live
  // realtime stream.

  it('REJECTS a token for a screen whose status is REVOKED', async () => {
    const { controller, sse } = makeController({
      screenRow: { tenantId: 'tenant-1', status: 'REVOKED', credentialEpoch: 0 },
    });
    const res = makeRes();

    await controller.sseStream(undefined, deviceToken(), { headers: {} } as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(sse.register).not.toHaveBeenCalled();
  });

  it('REJECTS a token whose credential epoch has been superseded past the grace window', async () => {
    const { controller, sse } = makeController({
      screenRow: {
        tenantId: 'tenant-1',
        status: 'ONLINE',
        credentialEpoch: 9,
        credentialEpochRotatedAt: new Date(),
      },
    });
    const res = makeRes();

    await controller.sseStream(undefined, deviceToken('screen-1', { ep: 2 }), { headers: {} } as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(sse.register).not.toHaveBeenCalled();
  });

  it('still accepts the immediately-previous epoch inside the rotation grace window', async () => {
    // A kiosk that re-registered and lost the response must not be locked
    // out of realtime — same tolerance verifyDeviceForScreen applies.
    const { controller, sse } = makeController({
      screenRow: {
        tenantId: 'tenant-1',
        status: 'ONLINE',
        credentialEpoch: 5,
        credentialEpochRotatedAt: new Date(),
      },
    });
    const res = makeRes();

    await controller.sseStream(undefined, deviceToken('screen-1', { ep: 4 }), { headers: {} } as any, res as any);

    expect(res.body).toBeUndefined();
    expect(sse.register).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'screen-1' }));
  });

  it('grandfathers a pre-DT-02 token with no `ep` claim against an epoch-0 screen', async () => {
    const { controller, sse } = makeController({
      screenRow: { tenantId: 'tenant-1', status: 'ONLINE', credentialEpoch: 0 },
    });
    const res = makeRes();

    await controller.sseStream(undefined, deviceToken(), { headers: {} } as any, res as any);

    expect(res.body).toBeUndefined();
    expect(sse.register).toHaveBeenCalled();
  });
});
