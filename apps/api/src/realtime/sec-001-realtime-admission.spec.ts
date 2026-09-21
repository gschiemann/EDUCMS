/**
 * SEC-001 realtime (2026-09-04) — a BOOTSTRAP credential is not a realtime
 * principal.
 *
 * ── THE BUG ────────────────────────────────────────────────────────────────
 * SEC-001 marked the credential minted from a bare device FINGERPRINT
 * (`POST /screens/register {deviceFingerprint}`) with `unproven: true` and
 * `aud: venueos:device-bootstrap`, and taught the HTTP verifier to refuse it.
 * The two REALTIME transports never learned:
 *
 *   • `realtime.gateway.ts` `processHello` verified a signature, checked the
 *     exact-token denylist, read the screen row for its tenant binding — and
 *     set `isAuthenticated = true`. It never checked `kind`, never pinned the
 *     algorithm, never read `Screen.status` or `credentialEpoch`, and never
 *     looked at either bootstrap marker.
 *   • `sse.controller.ts`'s legacy `?token=` leg checked kind, status and
 *     epoch — but not the bootstrap markers, and it verified the JWT with no
 *     `algorithms` allowlist.
 *
 * So anyone holding a leaked fingerprint — a value the dashboard shows with a
 * copy button, that `GET /screens` carries, and that turns up in support
 * tickets and fleet exports — became a realtime principal for that screen:
 * received its tenant-, group- and device-scoped emergency traffic, forged
 * delivery ACKs and heartbeat liveness so a dark screen reported healthy, and
 * (because an admitted socket counts against `MAX_SOCKETS_PER_DEVICE`) evicted
 * the real kiosk's socket at will, knocking it down to the polling fallback.
 *
 * ── WHY THE TOKENS HERE COME FROM THE REAL REGISTER PATH ───────────────────
 * Every credential in this file is minted by driving the ACTUAL
 * `ScreensController.register` handler, not by hand-signing a JWT that looks
 * like one. A hand-shaped fixture proves only that the code refuses the shape
 * the test author imagined; the whole class of bug being closed here is a
 * verifier and a minter that disagree about what a credential is.
 *
 * ── THE LINE THAT MUST NOT MOVE ────────────────────────────────────────────
 * `GET /screens/:id/manifest` STILL serves a bootstrap credential. That is
 * CLAUDE.md emergency safeguard #4 — the HTTP-polling backstop that delivers a
 * lockdown to a screen whose credential has gone unproven. The last suite in
 * this file drives the real interceptor and the real manifest handler to prove
 * an OVERRIDE still reaches such a screen, so a future tightening of the
 * realtime gate cannot quietly take the life-safety fallback with it.
 */

import * as jwt from 'jsonwebtoken';
import { lastValueFrom, of } from 'rxjs';
import { WebSocket } from 'ws';

import { RealtimeGateway } from './realtime.gateway';
import { SseController } from './sse.controller';
import { DeviceIdentityInterceptor } from '../security/device-identity.interceptor';
import {
  ScreensController,
  _registerFpCooldown,
} from '../screens/screens.controller';
import {
  DEVICE_TOKEN_AUD_BOOTSTRAP,
  invalidateDeviceCredentialCache,
  isUnprovenDeviceClaim,
} from '../screens/device-auth';
import { resetManifestCacheForTests } from '../screens/manifest-hot-cache';

const DEVICE_JWT_SECRET = 'sec001_realtime_device_jwt_secret_0123456789ab';
const SCREEN_ID = 'screen-sec001-realtime';
const TENANT_ID = 'tenant-sec001';
const GROUP_ID = 'group-sec001';
const FINGERPRINT = 'fp-sec001-realtime';

const prevJwtSecret = process.env.DEVICE_JWT_SECRET;
const prevDeviceSecret = process.env.DEVICE_SECRET_KEY;
const prevNodeEnv = process.env.NODE_ENV;

beforeAll(() => {
  // A real (long-enough) secret rather than a `requireSecret` mock: the mint
  // path, the WS gateway, the SSE controller and the interceptor must all
  // resolve the SAME key the way production does, or this file proves nothing
  // about whether they agree.
  process.env.DEVICE_JWT_SECRET = DEVICE_JWT_SECRET;
  process.env.DEVICE_SECRET_KEY = 'sec001_realtime_device_secret_0123456789ab';
  process.env.NODE_ENV = 'test';
});

afterAll(() => {
  if (prevJwtSecret === undefined) delete process.env.DEVICE_JWT_SECRET;
  else process.env.DEVICE_JWT_SECRET = prevJwtSecret;
  if (prevDeviceSecret === undefined) delete process.env.DEVICE_SECRET_KEY;
  else process.env.DEVICE_SECRET_KEY = prevDeviceSecret;
  process.env.NODE_ENV = prevNodeEnv;
});

beforeEach(() => {
  // The shared admission memoises the live Screen row per screen id for 5 s,
  // process-globally. Cases below reuse one screen id with different rows.
  invalidateDeviceCredentialCache();
  resetManifestCacheForTests();
  _registerFpCooldown.clear();
});

// ── The REAL register path ────────────────────────────────────────────────

/** A paired screen row as `register` reads it. */
const pairedRow = (overrides: Record<string, unknown> = {}) => ({
  id: SCREEN_ID,
  deviceFingerprint: FINGERPRINT,
  pairingCode: null,
  tenantId: TENANT_ID,
  screenGroupId: GROUP_ID,
  status: 'ONLINE',
  credentialEpoch: 0,
  credentialEpochRotatedAt: null,
  resolution: null,
  osInfo: null,
  browserInfo: null,
  userAgent: null,
  name: 'Lobby',
  authState: 'PROVEN',
  ...overrides,
});

/**
 * Drive the real `POST /screens/register` and return the token it minted.
 *
 * `priorDeviceToken` absent  → the BOOTSTRAP credential (`requiresRePair`).
 * `priorDeviceToken` present and current → the PROVEN 180-day credential.
 */
async function registerForToken(opts: {
  priorDeviceToken?: string;
  row?: Record<string, unknown>;
  rotatedEpoch?: number;
} = {}): Promise<{ deviceToken: string; requiresRePair?: boolean }> {
  const row = pairedRow(opts.row);
  const prisma: any = {
    client: {
      screen: {
        findUnique: jest.fn(async () => row),
        create: jest.fn(),
        update: jest
          .fn()
          .mockResolvedValueOnce({ id: SCREEN_ID, pairingCode: null, tenantId: TENANT_ID, name: 'Lobby' })
          .mockResolvedValue({ credentialEpoch: opts.rotatedEpoch ?? 1 }),
      },
      auditLog: { create: jest.fn(async () => ({})) },
      screenEvent: { create: jest.fn(async () => ({})) },
    },
  };
  const controller = new ScreensController(
    prisma,
    { publish: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const res: any = await controller.register(
    { deviceFingerprint: FINGERPRINT, ...(opts.priorDeviceToken ? { priorDeviceToken: opts.priorDeviceToken } : {}) },
    { ip: '10.0.0.9', socket: { remoteAddress: '10.0.0.9' }, headers: {} } as any,
  );
  return res;
}

/**
 * The genuine bootstrap credential, straight out of the register handler.
 *
 * Minted against a screen already at epoch 1 — the same epoch every harness
 * row below carries — because a fingerprint-only re-register is DOWNGRADED and
 * does not rotate (P5-1c). That matters: if the bootstrap token carried a
 * different epoch from the live row, a refusal downstream could be the EPOCH
 * check rather than the bootstrap markers, and these tests would pass for the
 * wrong reason. (It is not hypothetical — the first draft of this file did
 * exactly that on the SSE leg.)
 */
async function bootstrapToken(): Promise<string> {
  const res = await registerForToken({ row: { credentialEpoch: 1 } });
  const claims = jwt.decode(res.deviceToken) as any;
  expect(claims.ep).toBe(1);
  expect(isUnprovenDeviceClaim(claims)).toBe(true);
  return res.deviceToken;
}

/**
 * The genuine PROVEN credential. Minted by presenting a current prior token,
 * which is the only way the register handler issues a full-lifetime one.
 * `ep: 1` because proving possession rotates the epoch to 1 (DT-02).
 */
async function provenToken(): Promise<string> {
  const prior = jwt.sign({ sub: SCREEN_ID, kind: 'device', ep: 0 }, DEVICE_JWT_SECRET, {
    expiresIn: '180d',
  });
  const res = await registerForToken({ priorDeviceToken: prior, rotatedEpoch: 1 });
  return res.deviceToken;
}

// ── Harnesses ─────────────────────────────────────────────────────────────

function makeSocket() {
  return {
    send: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
    readyState: WebSocket.OPEN,
  } as unknown as WebSocket;
}

const liveRow = (overrides: Record<string, unknown> = {}) => ({
  id: SCREEN_ID,
  tenantId: TENANT_ID,
  screenGroupId: GROUP_ID,
  status: 'ONLINE',
  credentialEpoch: 1,
  credentialEpochRotatedAt: null,
  ...overrides,
});

function makeGateway(opts: { row?: Record<string, unknown>; sismember?: jest.Mock } = {}): {
  gateway: RealtimeGateway;
  redis: any;
  prisma: any;
  logger: { log: jest.Mock; warn: jest.Mock; debug: jest.Mock; error: jest.Mock };
} {
  const redis: any = {
    publisher: {
      sadd: jest.fn().mockResolvedValue(1),
      hset: jest.fn().mockResolvedValue(1),
      publish: jest.fn().mockResolvedValue(1),
    },
    subscriber: {},
    setGateway: jest.fn(),
    publish: jest.fn().mockResolvedValue(undefined),
    sismember: opts.sismember ?? jest.fn(async () => false),
  };
  const prisma: any = {
    client: {
      screen: {
        findUnique: jest.fn(async () => liveRow(opts.row)),
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => ({})),
      },
    },
  };
  const gateway = new RealtimeGateway(redis, prisma, {
    now: () => Date.now(),
    status: () => ({ offsetMs: 0, sampledAt: 0, rttMs: null, source: 'local' as const }),
  } as any);
  const logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  (gateway as any).logger = logger;
  return { gateway, redis, prisma, logger };
}

/** Run the real HELLO handler on a fresh socket and hand back its context. */
async function hello(gateway: RealtimeGateway, token: string) {
  const ws = makeSocket();
  gateway.handleConnection(ws);
  await (gateway as any).processHello(ws, { token });
  const ctx = (gateway as any).clients.get(ws);
  return { ws, ctx };
}

/** Clear the auth timers handleConnection arms, so Jest can exit. */
function drainGateway(gateway: RealtimeGateway) {
  const clients = (gateway as any).clients as Map<unknown, { authTimeout?: NodeJS.Timeout }>;
  for (const ctx of clients.values()) if (ctx.authTimeout) clearTimeout(ctx.authTimeout);
  clients.clear();
  (gateway as any).onModuleDestroy();
}

function makeSseRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status: jest.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    json: jest.fn(function (this: any, b: unknown) { this.body = b; return this; }),
    setHeader: jest.fn(function (this: any, k: string, v: string) { this.headers[k] = v; }),
    flushHeaders: jest.fn(),
  };
  return res;
}

function makeSse(opts: { row?: Record<string, unknown> } = {}) {
  const sse = { register: jest.fn() };
  const prisma: any = {
    client: { screen: { findUnique: jest.fn(async () => liveRow(opts.row)) } },
  };
  const redis: any = { sismember: jest.fn(async () => false) };
  const controller = new SseController(sse as any, prisma, redis);
  // Captured so a refusal can be asserted on its REASON, not just its status.
  const logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  (controller as any).logger = logger;
  return { controller, sse, logger };
}

/** Every reason string the mocked logger saw, joined — for reason assertions. */
const loggedReasons = (logger: { warn: jest.Mock }) =>
  logger.warn.mock.calls.map((c) => String(c[0])).join(' | ');

// ─────────────────────────────────────────────────────────────────────────
describe('SEC-001 realtime — the fixture really is the register path’s own token', () => {
  it('a fingerprint-only re-register mints a BOOTSTRAP credential (both markers, ~1h)', async () => {
    const res = await registerForToken();
    expect(res.requiresRePair).toBe(true);

    const claims = jwt.decode(res.deviceToken) as any;
    // Two independent markers, because a mint path that forgets one must
    // still be refused by the other.
    expect(claims.unproven).toBe(true);
    expect(claims.aud).toBe(DEVICE_TOKEN_AUD_BOOTSTRAP);
    expect(isUnprovenDeviceClaim(claims)).toBe(true);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3630);
    // It carries no tenant claim — identity comes from the live row.
    expect(claims.tenantId).toBeUndefined();
  });

  it('proving possession mints a PROVEN credential carrying neither marker', async () => {
    const token = await provenToken();
    const claims = jwt.decode(token) as any;
    expect(claims.unproven).toBeUndefined();
    expect(claims.aud).toBeUndefined();
    expect(isUnprovenDeviceClaim(claims)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('SEC-001 realtime — WebSocket', () => {
  it('a BOOTSTRAP token gets AUTH_FAIL and the socket is closed', async () => {
    const { gateway, logger } = makeGateway();
    const { ws, ctx } = await hello(gateway, await bootstrapToken());

    expect(ctx.isAuthenticated).toBe(false);
    const frames = (ws.send as jest.Mock).mock.calls.map((c) => JSON.parse(c[0]));
    expect(frames.map((f) => f.type)).toEqual(['AUTH_FAIL']);
    expect(frames[0].payload).toMatchObject({ code: 401, reason: 'INVALID_TOKEN' });
    expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized');
    // …and refused for the RIGHT reason. Everything else about this token is
    // current — signature, kind, epoch, live row — so only the bootstrap
    // markers can be what stopped it.
    expect(loggedReasons(logger)).toContain('credential_unproven');
    drainGateway(gateway);
  });

  it('a BOOTSTRAP token cannot SUBSCRIBE — no scope registration, no broadcast delivery', async () => {
    const { gateway, redis } = makeGateway();
    await hello(gateway, await bootstrapToken());

    // Never joined the tenant/group device sets…
    expect(redis.publisher.sadd).not.toHaveBeenCalled();

    // …and receives nothing on any of the three scopes an emergency uses.
    const before = (gateway as any).clients.size;
    gateway.broadcastToScope('tenant', TENANT_ID, { type: 'EMERGENCY_OVERRIDE', payload: {} });
    gateway.broadcastToScope('group', GROUP_ID, { type: 'EMERGENCY_OVERRIDE', payload: {} });
    gateway.broadcastToScope('device', SCREEN_ID, { type: 'EMERGENCY_OVERRIDE', payload: {} });
    for (const ctx of (gateway as any).clients.values()) {
      const types = (ctx.socket.send as jest.Mock).mock.calls.map((c: any[]) => JSON.parse(c[0]).type);
      expect(types).not.toContain('EMERGENCY_OVERRIDE');
    }
    expect(before).toBeGreaterThanOrEqual(0);
    drainGateway(gateway);
  });

  it('a BOOTSTRAP token cannot stamp online status, ACK or heartbeat', async () => {
    const { gateway, redis, prisma } = makeGateway();
    const { ws } = await hello(gateway, await bootstrapToken());

    // push-health is what makes a screen look CONNECTED in the fleet UI.
    expect(prisma.client.screen.updateMany).not.toHaveBeenCalled();

    // The refused socket's later telemetry frames are inert: both handlers
    // return early on `!ctx.isAuthenticated`.
    (gateway as any).processHeartbeat(ws, { metrics: { forged: true } });
    (gateway as any).processAck(ws, { receivedEventId: 'evt-1', status: 'DELIVERED' });
    expect(redis.publisher.hset).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
    drainGateway(gateway);
  });

  it('a refused BOOTSTRAP caller consumes NO socket slot — the real kiosk is never evicted', async () => {
    const { gateway } = makeGateway();
    const proven = await provenToken();
    const bootstrap = await bootstrapToken();

    // The device's legitimate allowance, filled.
    const legit = [];
    for (let i = 0; i < 3; i++) legit.push(await hello(gateway, proven));
    for (const l of legit) expect(l.ctx.isAuthenticated).toBe(true);

    // A flood of bootstrap connects. Before this fix each one authenticated
    // and pushed a real socket past MAX_SOCKETS_PER_DEVICE, evicting the
    // oldest kiosk connection with close(4009).
    for (let i = 0; i < 8; i++) await hello(gateway, bootstrap);

    for (const l of legit) {
      expect(l.ctx.isAuthenticated).toBe(true);
      expect(l.ws.close).not.toHaveBeenCalled();
    }
    const authed = [...(gateway as any).clients.values()].filter((c: any) => c.isAuthenticated);
    expect(authed).toHaveLength(3);
    drainGateway(gateway);
  });

  it('a PROVEN token still authenticates and gets the live tenant + group scope', async () => {
    const { gateway, redis } = makeGateway();
    const { ws, ctx } = await hello(gateway, await provenToken());

    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.deviceId).toBe(SCREEN_ID);
    expect(ctx.tenantId).toBe(TENANT_ID);
    expect(ctx.groupId).toBe(GROUP_ID);
    const types = (ws.send as jest.Mock).mock.calls.map((c) => JSON.parse(c[0]).type);
    expect(types).toContain('AUTH_OK');
    expect(redis.publisher.sadd).toHaveBeenCalledWith(`tenant:${TENANT_ID}:devices`, SCREEN_ID);
    drainGateway(gateway);
  });

  it('refuses a REVOKED screen — a check the gateway never made before', async () => {
    const { gateway } = makeGateway({ row: { status: 'REVOKED' } });
    const { ctx } = await hello(gateway, await provenToken());
    expect(ctx.isAuthenticated).toBe(false);
    drainGateway(gateway);
  });

  it('refuses a credential whose epoch has been retired past the grace window', async () => {
    const { gateway } = makeGateway({
      row: {
        credentialEpoch: 9,
        credentialEpochRotatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      },
    });
    const { ctx } = await hello(gateway, await provenToken());
    expect(ctx.isAuthenticated).toBe(false);
    drainGateway(gateway);
  });

  it('refuses a token that is not `kind: device` — the shape check that was missing', async () => {
    const { gateway } = makeGateway();
    const notADevice = jwt.sign({ sub: SCREEN_ID, kind: 'user', ep: 1 }, DEVICE_JWT_SECRET, {
      expiresIn: '1h',
    });
    const { ctx } = await hello(gateway, notADevice);
    expect(ctx.isAuthenticated).toBe(false);
    drainGateway(gateway);
  });

  it('fails CLOSED when revocation state cannot be established', async () => {
    const { gateway } = makeGateway({
      sismember: jest.fn(async () => {
        throw new Error('redis down');
      }),
    });
    const { ctx } = await hello(gateway, await provenToken());
    expect(ctx.isAuthenticated).toBe(false);
    drainGateway(gateway);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('SEC-001 realtime — WebSocket re-validation of ALREADY-OPEN sockets', () => {
  it('closes an open socket once its screen is REVOKED', async () => {
    const { gateway, prisma } = makeGateway();
    const { ws, ctx } = await hello(gateway, await provenToken());
    expect(ctx.isAuthenticated).toBe(true);

    // The operator revokes. Every revocation writer invalidates the snapshot.
    prisma.client.screen.findUnique.mockResolvedValue(liveRow({ status: 'REVOKED' }));
    invalidateDeviceCredentialCache();

    const closed = await gateway.tickCredentialRevalidation();
    expect(closed).toEqual([ctx.connectionId]);
    expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized');
    const frames = (ws.send as jest.Mock).mock.calls.map((c) => JSON.parse(c[0]));
    expect(frames.map((f) => f.type)).toContain('AUTH_FAIL');
    // Gone from the client map, so it stops receiving fan-out immediately.
    expect((gateway as any).clients.get(ws)).toBeUndefined();
    drainGateway(gateway);
  });

  it('closes an open socket once its credential epoch is rotated past the grace window', async () => {
    const { gateway, prisma } = makeGateway();
    const { ws } = await hello(gateway, await provenToken());

    prisma.client.screen.findUnique.mockResolvedValue(
      liveRow({
        credentialEpoch: 12,
        credentialEpochRotatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      }),
    );
    invalidateDeviceCredentialCache();

    expect(await gateway.tickCredentialRevalidation()).toHaveLength(1);
    expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized');
    drainGateway(gateway);
  });

  it('closes an open socket once its exact token string is denylisted', async () => {
    const sismember = jest.fn(async () => false);
    const { gateway, redis } = makeGateway({ sismember });
    const { ws } = await hello(gateway, await provenToken());

    redis.sismember.mockImplementation(async () => true);
    expect(await gateway.tickCredentialRevalidation()).toHaveLength(1);
    expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized');
    drainGateway(gateway);
  });

  it('closes an open socket when the screen row is deleted (deletion = full revocation)', async () => {
    const { gateway, prisma } = makeGateway();
    const { ws } = await hello(gateway, await provenToken());

    prisma.client.screen.findUnique.mockResolvedValue(null);
    invalidateDeviceCredentialCache();

    expect(await gateway.tickCredentialRevalidation()).toHaveLength(1);
    expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized');
    drainGateway(gateway);
  });

  it('KEEPS the socket when revocation state is merely indeterminate (fail-open on the push channel)', async () => {
    // The inverse of admission's posture, deliberately: dropping the fleet's
    // push tier because a store blinked would cut lockdown delivery during
    // exactly the incident most likely to coincide with a real emergency.
    const { gateway, redis } = makeGateway();
    const { ws } = await hello(gateway, await provenToken());

    redis.sismember.mockImplementation(async () => {
      throw new Error('redis down');
    });
    expect(await gateway.tickCredentialRevalidation()).toEqual([]);
    expect(ws.close).not.toHaveBeenCalled();
    drainGateway(gateway);
  });

  it('KEEPS the socket when the database throws', async () => {
    const { gateway, prisma } = makeGateway();
    const { ws } = await hello(gateway, await provenToken());

    prisma.client.screen.findUnique.mockRejectedValue(new Error('pool timeout'));
    invalidateDeviceCredentialCache();

    expect(await gateway.tickCredentialRevalidation()).toEqual([]);
    expect(ws.close).not.toHaveBeenCalled();
    drainGateway(gateway);
  });

  it('closes an open socket whose screen was re-homed to another tenant', async () => {
    const { gateway, prisma } = makeGateway();
    const { ws } = await hello(gateway, await provenToken());

    prisma.client.screen.findUnique.mockResolvedValue(liveRow({ tenantId: 'tenant-OTHER' }));
    invalidateDeviceCredentialCache();

    expect(await gateway.tickCredentialRevalidation()).toHaveLength(1);
    expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized');
    drainGateway(gateway);
  });

  it('a group move inside the same tenant updates routing without dropping the socket', async () => {
    const { gateway, prisma } = makeGateway();
    const { ws, ctx } = await hello(gateway, await provenToken());

    prisma.client.screen.findUnique.mockResolvedValue(liveRow({ screenGroupId: 'group-MOVED' }));
    invalidateDeviceCredentialCache();

    expect(await gateway.tickCredentialRevalidation()).toEqual([]);
    expect(ws.close).not.toHaveBeenCalled();
    expect(ctx.groupId).toBe('group-MOVED');
    drainGateway(gateway);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('SEC-001 realtime — SSE', () => {
  it('a BOOTSTRAP token gets 401 and opens no stream', async () => {
    const { controller, sse, logger } = makeSse();
    const res = makeSseRes();

    await controller.sseStream(undefined, await bootstrapToken(), { headers: {} } as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'invalid token' });
    expect(sse.register).not.toHaveBeenCalled();
    // The reason matters: this leg ALREADY refused a stale epoch and a REVOKED
    // screen, so a 401 alone would not prove the bootstrap gate exists. The
    // token here is current on every other axis.
    expect(loggedReasons(logger)).toContain('credential_unproven');
  });

  it('a PROVEN token still opens a stream with the live tenant + group scope', async () => {
    const { controller, sse } = makeSse();
    const res = makeSseRes();

    await controller.sseStream(undefined, await provenToken(), { headers: {} } as any, res as any);

    expect(res.body).toBeUndefined();
    expect(sse.register).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: SCREEN_ID, tenantId: TENANT_ID, groupId: GROUP_ID }),
    );
  });

  it('rejects an `alg: none` token — now by an EXPLICIT allowlist, not a library default', async () => {
    // HONEST SCOPE: this case already passed before SEC-001-realtime, because
    // `jsonwebtoken` refuses `alg: none` when a secret is supplied. What
    // changed is WHY it passes — the leg used to depend on that library
    // default (`jwt.verify(token, secret)` with no options) and now states
    // `algorithms: ['HS256']` itself, the same way `device-auth.ts` has since
    // DT-12. This test pins the outcome so a jsonwebtoken major bump that
    // relaxes the default cannot silently reopen it.
    const { controller, sse } = makeSse();
    const res = makeSseRes();
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer
      .from(JSON.stringify({ sub: SCREEN_ID, kind: 'device', ep: 1 }))
      .toString('base64url')}.`;

    await controller.sseStream(undefined, unsigned, { headers: {} } as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(sse.register).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
/**
 * The constraint this whole fix had to respect. `GET /screens/:id/manifest` is
 * the HTTP-polling backstop (CLAUDE.md emergency safeguard #4). A screen whose
 * credential has gone unproven — an APK re-sideload, cleared WebView storage,
 * a token expired over summer break — must STILL receive a lockdown. If a
 * future change to the realtime gate ever takes this with it, this suite is
 * what fails.
 */
describe('SEC-001 realtime — the life-safety fallback is UNCHANGED', () => {
  const emergencyPrisma = () => {
    const screenRow = {
      id: SCREEN_ID,
      tenantId: TENANT_ID,
      screenGroupId: null,
      status: 'ONLINE',
      resolution: '1920x1080',
      orientation: 'LANDSCAPE',
      canvasW: null,
      canvasH: null,
      repeats: 1,
      config: null,
      hardwareModel: null,
      activeBoardGameId: null,
      activeBoardSurface: null,
      syncOffsetMs: 0,
      // Matches the epoch `bootstrapToken()` mints against: a fingerprint-only
      // re-register is DOWNGRADED and does not rotate (P5-1c), so the token
      // carries the screen's existing epoch and the epoch check is a no-op
      // here — leaving the bootstrap markers as the only thing under test.
      credentialEpoch: 1,
      credentialEpochRotatedAt: null,
      displayCapabilities: null,
      screenGroup: null,
      tenant: { name: 'Sec001 School' },
    };
    return {
      client: {
        screen: {
          findUnique: jest.fn(async () => ({ ...screenRow })),
          update: jest.fn(async () => ({})),
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
        tenant: {
          findUnique: jest.fn(async () => ({
            id: TENANT_ID,
            name: 'Sec001 School',
            parentId: null,
            archivedAt: null,
            emergencyStatus: 'CRITICAL', // the SEVERITY — the incident type lives in emergencyType
            emergencyType: 'LOCKDOWN',
            emergencyPlaylistId: null,
            panicLockdownPlaylistId: null,
          })),
          findMany: jest.fn(async () => []),
        },
        screenEmergencyOverride: { findUnique: jest.fn(async () => null) },
        schedule: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
        playlist: { findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null) },
        game: { findFirst: jest.fn(async () => null) },
        emergencyMessage: { findMany: jest.fn(async () => []) },
        auditLog: { create: jest.fn(async () => ({})) },
        displaySchedule: { findMany: jest.fn(async () => []) },
        displayVendorRecipe: { findMany: jest.fn(async () => []) },
        $transaction: jest.fn((x: any) => (typeof x === 'function' ? x({}) : Promise.all(x))),
      },
    } as any;
  };

  /** The principal `JwtAuthGuard` builds for a device bearer token. */
  const deviceReq = (token: string, method = 'GET') => ({
    method,
    headers: { authorization: `Bearer ${token}` },
    user: { id: SCREEN_ID, sub: SCREEN_ID, kind: 'device' },
  });

  it('an OVERRIDE still reaches a BOOTSTRAP-credentialled screen through the manifest poll', async () => {
    const token = await bootstrapToken();
    const prisma = emergencyPrisma();

    // 1. The real global interceptor admits the read and stamps the principal.
    const req: any = deviceReq(token);
    await lastValueFrom(
      new DeviceIdentityInterceptor(prisma).intercept(
        { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) } as any,
        { handle: () => of('ok') } as any,
      ),
    );
    expect(req.user.unproven).toBe(true);
    expect(req.user.tenantId).toBe(TENANT_ID);

    // 2. The real manifest handler serves the live lockdown to it.
    const controller = new ScreensController(
      prisma,
      { publish: jest.fn(), sismember: jest.fn(async () => false) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    let body: any = null;
    let status = 200;
    const res: any = {
      setHeader: jest.fn(),
      status: jest.fn((s: number) => { status = s; return res; }),
      json: jest.fn((p: any) => { body = p; return res; }),
      send: jest.fn(() => res),
    };
    await controller.getManifest(SCREEN_ID, req, res);

    expect(status).toBe(200);
    expect(body.isEmergency).toBe(true);
    expect(String(body.emergencyType).toLowerCase()).toContain('lockdown');
  });

  it('…and that same credential still cannot WRITE anything', async () => {
    const token = await bootstrapToken();
    const prisma = emergencyPrisma();
    const req: any = deviceReq(token, 'POST');

    await expect(
      lastValueFrom(
        new DeviceIdentityInterceptor(prisma).intercept(
          { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) } as any,
          { handle: () => of('ok') } as any,
        ),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});
