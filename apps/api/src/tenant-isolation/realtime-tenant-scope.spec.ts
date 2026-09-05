/**
 * SEC-009 — TWO-TENANT ISOLATION MATRIX: THE REALTIME TRANSPORTS (2026-09-05).
 *
 * The audit's P1 asked for "a generated two-tenant role matrix over HTTP AND
 * REALTIME paths". `two-tenant-role-matrix.spec.ts` is the HTTP half. This is
 * the realtime half, and it is a genuinely different question: an HTTP route
 * refuses a foreign id, whereas a socket or an event stream is admitted ONCE
 * and then keeps receiving whatever the fan-out decides belongs to it. Two
 * things therefore have to hold, and only the first has ever been tested:
 *
 *   1. ADMISSION — a credential for tenant A's screen may not be admitted with
 *      tenant B's scope. (`sec-001-realtime-admission.spec.ts` proves a
 *      BOOTSTRAP credential is refused; it does not compare two tenants.)
 *   2. FAN-OUT — a tenant-B broadcast, including an emergency OVERRIDE, must
 *      not reach a tenant-A socket or stream. That is the property an operator
 *      actually cares about: a lockdown for one district must never appear on
 *      another district's glass.
 *
 * WHAT THIS FILE DOES NOT DO: it does not modify the transports. SEC-001 had
 * just reworked `realtime.gateway.ts` and `sse.controller.ts` (the shared
 * `admitDeviceCredential` admission); this suite only observes them. Every
 * credential is minted by driving the REAL `ScreensController.register`
 * handler, for the same reason the SEC-001 suite does it: a hand-shaped JWT
 * proves only that the code refuses the shape the test author imagined.
 */

import * as jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';

import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SseController } from '../realtime/sse.controller';
import { SseService } from '../realtime/sse.service';
import { ScreensController, _registerFpCooldown } from '../screens/screens.controller';
import { invalidateDeviceCredentialCache, isUnprovenDeviceClaim } from '../screens/device-auth';
import { mintStreamTicket } from '../screens/stream-ticket';

const DEVICE_JWT_SECRET = 'sec009_realtime_device_jwt_secret_0123456789ab';

const A = {
  tenantId: 't-alpha',
  screenId: 'scr-alpha',
  groupId: 'grp-alpha',
  fingerprint: 'fp-alpha',
} as const;
const B = {
  tenantId: 't-beta',
  screenId: 'scr-beta',
  groupId: 'grp-beta',
  fingerprint: 'fp-beta',
} as const;

const prevJwtSecret = process.env.DEVICE_JWT_SECRET;
const prevDeviceSecret = process.env.DEVICE_SECRET_KEY;
const prevNodeEnv = process.env.NODE_ENV;

beforeAll(() => {
  process.env.DEVICE_JWT_SECRET = DEVICE_JWT_SECRET;
  process.env.DEVICE_SECRET_KEY = 'sec009_realtime_device_secret_0123456789ab';
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
  // process-globally — two tenants in one file would otherwise borrow each
  // other's snapshot.
  invalidateDeviceCredentialCache();
  _registerFpCooldown.clear();
});

// ── The two-tenant screen table ───────────────────────────────────────────

type Party = typeof A | typeof B;

/** The live row shape every admission path reads. */
function liveRow(p: Party, overrides: Record<string, unknown> = {}) {
  return {
    id: p.screenId,
    deviceFingerprint: p.fingerprint,
    pairingCode: null,
    tenantId: p.tenantId,
    screenGroupId: p.groupId,
    status: 'ONLINE',
    credentialEpoch: 1,
    credentialEpochRotatedAt: null,
    resolution: null,
    osInfo: null,
    browserInfo: null,
    userAgent: null,
    name: `Screen ${p.screenId}`,
    authState: 'PROVEN',
    ...overrides,
  };
}

/**
 * A prisma double backed by BOTH tenants' rows, resolved by whichever key the
 * caller filtered on. If a transport ever looked up a screen by something
 * other than its id or fingerprint, this returns null rather than guessing —
 * a silently-permissive double would make the whole suite theatre.
 */
function twoTenantPrisma(rows: Record<string, any>) {
  const find = async ({ where }: any = {}) => {
    if (where?.id) return rows[where.id] ?? null;
    if (where?.deviceFingerprint) {
      return Object.values(rows).find((r: any) => r.deviceFingerprint === where.deviceFingerprint) ?? null;
    }
    return null;
  };
  return {
    client: {
      screen: {
        findUnique: jest.fn(find),
        findFirst: jest.fn(find),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      auditLog: { create: jest.fn(async () => ({})) },
      screenEvent: { create: jest.fn(async () => ({})) },
    },
  } as any;
}

/**
 * Mint a PROVEN device credential for `p` by driving the real register
 * handler with a current prior token — the only path that issues a
 * full-lifetime credential. Returns the token the server actually minted.
 */
async function provenTokenFor(p: Party): Promise<string> {
  const prior = jwt.sign({ sub: p.screenId, kind: 'device', ep: 0 }, DEVICE_JWT_SECRET, {
    expiresIn: '180d',
  });
  // The mint sees the screen at epoch 0 and rotates it to 1 — which is the
  // epoch every live row in this file carries, so a refusal downstream can
  // only be about TENANT, never about a stale epoch.
  const prisma: any = twoTenantPrisma({ [p.screenId]: liveRow(p, { credentialEpoch: 0 }) });
  prisma.client.screen.update = jest
    .fn()
    .mockResolvedValueOnce({ id: p.screenId, pairingCode: null, tenantId: p.tenantId, name: 'x' })
    .mockResolvedValue({ credentialEpoch: 1 });
  const controller = new ScreensController(
    prisma,
    { publish: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const res: any = await controller.register(
    { deviceFingerprint: p.fingerprint, priorDeviceToken: prior },
    { ip: '10.0.0.9', socket: { remoteAddress: '10.0.0.9' }, headers: {} } as any,
  );
  const claims: any = jwt.decode(res.deviceToken);
  // Guard against passing for the wrong reason: a downgraded credential is
  // refused by admission on other grounds entirely.
  expect(isUnprovenDeviceClaim(claims)).toBe(false);
  expect(claims.sub).toBe(p.screenId);
  return res.deviceToken;
}

// ── WebSocket harness ─────────────────────────────────────────────────────

interface FakeSocket {
  sent: Array<{ type: string; payload: any }>;
  send: jest.Mock;
  close: jest.Mock;
  on: jest.Mock;
  readyState: number;
}

function makeSocket(): FakeSocket {
  const sent: Array<{ type: string; payload: any }> = [];
  return {
    sent,
    send: jest.fn((raw: string) => {
      try {
        const m = JSON.parse(raw);
        sent.push({ type: m.type, payload: m.payload });
      } catch {
        /* non-JSON frame — not a broadcast */
      }
    }),
    close: jest.fn(),
    on: jest.fn(),
    readyState: WebSocket.OPEN,
  };
}

function makeGateway(rows: Record<string, any>) {
  const redis: any = {
    publisher: {
      sadd: jest.fn().mockResolvedValue(1),
      hset: jest.fn().mockResolvedValue(1),
      publish: jest.fn().mockResolvedValue(1),
    },
    subscriber: {},
    setGateway: jest.fn(),
    publish: jest.fn().mockResolvedValue(undefined),
    sismember: jest.fn(async () => false),
  };
  const prisma = twoTenantPrisma(rows);
  const gateway = new RealtimeGateway(redis, prisma, {
    now: () => Date.now(),
    status: () => ({ offsetMs: 0, sampledAt: 0, rttMs: null, source: 'local' as const }),
  } as any);
  (gateway as any).logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return { gateway, prisma, redis };
}

async function hello(gateway: RealtimeGateway, token: string) {
  const ws = makeSocket();
  gateway.handleConnection(ws as unknown as WebSocket);
  await (gateway as any).processHello(ws, { token });
  const ctx = (gateway as any).clients.get(ws);
  return { ws, ctx };
}

function drainGateway(gateway: RealtimeGateway) {
  const clients = (gateway as any).clients as Map<unknown, { authTimeout?: NodeJS.Timeout }>;
  for (const ctx of clients.values()) if (ctx.authTimeout) clearTimeout(ctx.authTimeout);
  clients.clear();
}

/** An emergency envelope in the shape the Redis fan-out hands to the gateway. */
function overrideMessage(tenantId: string) {
  return {
    type: 'OVERRIDE',
    payload: { emergencyType: 'LOCKDOWN', severity: 'CRITICAL', forTenant: tenantId },
    signature: 'sig',
    eventId: `evt-${tenantId}`,
    timestamp: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
describe('SEC-009 realtime — WebSocket gateway', () => {
  const rows = { [A.screenId]: liveRow(A), [B.screenId]: liveRow(B) };

  it("admits tenant A's screen with tenant A's scope, never tenant B's", async () => {
    const { gateway } = makeGateway(rows);
    const token = await provenTokenFor(A);
    const { ctx } = await hello(gateway, token);

    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.tenantId).toBe(A.tenantId);
    expect(ctx.groupId).toBe(A.groupId);
    expect(ctx.deviceId).toBe(A.screenId);
    // The negative half matters as much: no field may carry tenant B.
    expect([ctx.tenantId, ctx.groupId, ctx.deviceId]).not.toContain(B.tenantId);
    expect([ctx.tenantId, ctx.groupId, ctx.deviceId]).not.toContain(B.groupId);
    expect([ctx.tenantId, ctx.groupId, ctx.deviceId]).not.toContain(B.screenId);
    drainGateway(gateway);
  });

  it("a tenant-B emergency does not reach a tenant-A socket (tenant scope)", async () => {
    const { gateway } = makeGateway(rows);
    const { ws } = await hello(gateway, await provenTokenFor(A));
    ws.sent.length = 0;

    gateway.broadcastToScope('tenant', B.tenantId, overrideMessage(B.tenantId));
    expect(ws.sent).toEqual([]);

    // …and the control: the SAME call for tenant A does arrive, so the
    // assertion above is about the tenant and not about a dead socket.
    gateway.broadcastToScope('tenant', A.tenantId, overrideMessage(A.tenantId));
    expect(ws.sent.map((m) => m.type)).toEqual(['OVERRIDE']);
    drainGateway(gateway);
  });

  it("a tenant-B group lockdown does not reach a tenant-A socket (group scope)", async () => {
    const { gateway } = makeGateway(rows);
    const { ws } = await hello(gateway, await provenTokenFor(A));
    ws.sent.length = 0;

    gateway.broadcastToScope('group', B.groupId, overrideMessage(B.tenantId));
    expect(ws.sent).toEqual([]);

    gateway.broadcastToScope('group', A.groupId, overrideMessage(A.tenantId));
    expect(ws.sent.map((m) => m.type)).toEqual(['OVERRIDE']);
    drainGateway(gateway);
  });

  it("a per-screen override aimed at tenant B's screen does not reach tenant A's socket (device scope)", async () => {
    const { gateway } = makeGateway(rows);
    const { ws } = await hello(gateway, await provenTokenFor(A));
    ws.sent.length = 0;

    gateway.broadcastToScope('device', B.screenId, overrideMessage(B.tenantId));
    expect(ws.sent).toEqual([]);

    gateway.broadcastToScope('device', A.screenId, overrideMessage(A.tenantId));
    expect(ws.sent.map((m) => m.type)).toEqual(['OVERRIDE']);
    drainGateway(gateway);
  });

  it('with both tenants connected, each emergency reaches exactly its own socket', async () => {
    const { gateway } = makeGateway(rows);
    const a = await hello(gateway, await provenTokenFor(A));
    const b = await hello(gateway, await provenTokenFor(B));
    a.ws.sent.length = 0;
    b.ws.sent.length = 0;

    gateway.broadcastToScope('tenant', A.tenantId, overrideMessage(A.tenantId));
    expect(a.ws.sent.map((m) => m.type)).toEqual(['OVERRIDE']);
    expect(b.ws.sent).toEqual([]);

    a.ws.sent.length = 0;
    gateway.broadcastToScope('tenant', B.tenantId, overrideMessage(B.tenantId));
    expect(b.ws.sent.map((m) => m.type)).toEqual(['OVERRIDE']);
    expect(a.ws.sent).toEqual([]);
    drainGateway(gateway);
  });

  it('refuses a credential whose tenant CLAIM disagrees with the live row', async () => {
    // The screen was moved from tenant B to tenant A after its token was
    // minted. The claim says B; the row says A. Re-scoping a live socket
    // silently is the failure this refusal exists to prevent (DT-03).
    const movedRows = { [A.screenId]: liveRow(A) };
    const { gateway } = makeGateway(movedRows);
    const stale = jwt.sign(
      { sub: A.screenId, kind: 'device', ep: 1, tenantId: B.tenantId },
      DEVICE_JWT_SECRET,
      { expiresIn: '180d' },
    );
    const { ctx } = await hello(gateway, stale);
    expect(ctx.isAuthenticated).toBeFalsy();
    expect(ctx.tenantId).toBeUndefined();
    drainGateway(gateway);
  });

  it('an UNAUTHENTICATED socket receives no broadcast at all', async () => {
    const { gateway } = makeGateway(rows);
    const ws = makeSocket();
    gateway.handleConnection(ws as unknown as WebSocket);
    ws.sent.length = 0;

    for (const [type, id] of [
      ['tenant', A.tenantId],
      ['tenant', B.tenantId],
      ['group', A.groupId],
      ['device', A.screenId],
    ] as const) {
      gateway.broadcastToScope(type, id, overrideMessage(id));
    }
    expect(ws.sent).toEqual([]);
    drainGateway(gateway);
  });
});

// ── SSE harness ───────────────────────────────────────────────────────────

function makeRes() {
  const written: string[] = [];
  const res: any = {
    written,
    headersSent: false,
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    status: jest.fn(() => res),
    json: jest.fn((b: any) => { res.body = b; return res; }),
    write: jest.fn((chunk: string) => { written.push(chunk); return true; }),
    end: jest.fn(),
    on: jest.fn(),
    body: undefined as any,
  };
  return res;
}

function makeSse() {
  const sse = new SseService(undefined as any, undefined as any);
  // The service arms a 25s keepalive and a revocation sweep on construction;
  // both are unref'd, but clear them so Jest never waits on one.
  const anySse = sse as any;
  if (anySse.keepaliveTimer) clearInterval(anySse.keepaliveTimer);
  if (anySse.revocationTimer) clearInterval(anySse.revocationTimer);
  return sse;
}

describe('SEC-009 realtime — SSE', () => {
  const rows = { [A.screenId]: liveRow(A), [B.screenId]: liveRow(B) };

  it("a stream ticket for tenant A's screen opens a tenant-A stream, never a tenant-B one", async () => {
    const sse = makeSse();
    const controller = new SseController(sse, twoTenantPrisma(rows), {} as any);
    const res = makeRes();
    const { ticket } = mintStreamTicket(A.screenId, 1);

    await controller.sseStream(ticket, undefined, { headers: {} } as any, res);

    const clients = [...((sse as any).clients as Map<string, any>).values()];
    expect(clients).toHaveLength(1);
    expect(clients[0].tenantId).toBe(A.tenantId);
    expect(clients[0].groupId).toBe(A.groupId);
    expect(clients[0].deviceId).toBe(A.screenId);
    expect(clients[0].tenantId).not.toBe(B.tenantId);
  });

  it('the legacy ?token= leg scopes the stream from the LIVE row, not a claim', async () => {
    const sse = makeSse();
    const controller = new SseController(sse, twoTenantPrisma(rows), {} as any);
    const res = makeRes();
    // A credential for screen A carrying a stale tenant-B claim. The stream
    // must follow the row (tenant A) — a claim never widens scope.
    const token = jwt.sign(
      { sub: A.screenId, kind: 'device', ep: 1, tenantId: B.tenantId },
      DEVICE_JWT_SECRET,
      { expiresIn: '180d' },
    );

    await controller.sseStream(undefined, token, { headers: {} } as any, res);

    const clients = [...((sse as any).clients as Map<string, any>).values()];
    expect(clients).toHaveLength(1);
    expect(clients[0].tenantId).toBe(A.tenantId);
    expect(clients[0].tenantId).not.toBe(B.tenantId);
  });

  it('a tenant-B broadcast does not reach a tenant-A stream, on any of the three scopes', async () => {
    const sse = makeSse();
    const controller = new SseController(sse, twoTenantPrisma(rows), {} as any);

    const resA = makeRes();
    const resB = makeRes();
    await controller.sseStream(mintStreamTicket(A.screenId, 1).ticket, undefined, { headers: {} } as any, resA);
    await controller.sseStream(mintStreamTicket(B.screenId, 1).ticket, undefined, { headers: {} } as any, resB);
    resA.written.length = 0;
    resB.written.length = 0;

    for (const [type, id] of [
      ['tenant', B.tenantId],
      ['group', B.groupId],
      ['device', B.screenId],
    ] as const) {
      sse.broadcastToScope(type, id, { type: 'OVERRIDE', emergencyType: 'LOCKDOWN' });
    }
    expect(resA.written).toEqual([]);
    expect(resB.written.join('')).toContain('OVERRIDE');

    // Control: tenant A's own broadcast does arrive on A and not on B.
    resB.written.length = 0;
    sse.broadcastToScope('tenant', A.tenantId, { type: 'OVERRIDE', emergencyType: 'LOCKDOWN' });
    expect(resA.written.join('')).toContain('OVERRIDE');
    expect(resB.written).toEqual([]);
  });

  it('a ticket for a screen that no longer exists opens no stream at all', async () => {
    const sse = makeSse();
    const controller = new SseController(sse, twoTenantPrisma({ [A.screenId]: liveRow(A) }), {} as any);
    const res = makeRes();

    await controller.sseStream(mintStreamTicket(B.screenId, 1).ticket, undefined, { headers: {} } as any, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect([...((sse as any).clients as Map<string, any>).values()]).toHaveLength(0);
  });
});
