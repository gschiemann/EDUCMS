/**
 * gateway-scale.spec.ts — P0-7 finding #4, the behavioural proof.
 *
 * TWO DEFECTS, measured in the 1,000-screen load test (2026-09-04):
 *
 *   1. `enforceDeviceSocketCap` walked EVERY entry of `clients` to count ONE
 *      device's sockets, once per successful AUTH. Full-fleet reconnect
 *      handling was therefore O(fleet²) — ~10⁶ iterations across the measured
 *      ~20 s restart window at 1,000 screens, ~10⁸ at 10,000, on the event
 *      loop that also serves the emergency manifest poll.
 *
 *   2. A caller could hold an unauthenticated socket for 10 s, unbounded in
 *      number. Connection exhaustion needed no credential at all — and the
 *      same 10 s timer was applied to real kiosks whose HELLO was being
 *      admitted against a cold pool, which is a plausible cause of the 49 of
 *      1,000 screens that had not re-authenticated 15 s after a restart.
 *
 * SEC-001's admission (`admitDeviceCredential` + the 30 s revalidation sweep)
 * is untouched — this is bookkeeping, not admission — and
 * `sec-001-realtime-admission.spec.ts` remains its proof.
 */

import { WebSocket } from 'ws';
import { RealtimeGateway } from './realtime.gateway';

function makeSocket() {
  return {
    send: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
    readyState: WebSocket.OPEN,
  } as unknown as WebSocket;
}

function makeGateway() {
  const redis: any = {
    publisher: null,
    subscriber: {},
    setGateway: jest.fn(),
    publish: jest.fn().mockResolvedValue(undefined),
    sismember: jest.fn(async () => false),
  };
  const prisma: any = { client: { screen: { updateMany: jest.fn(async () => ({ count: 1 })) } } };
  const gateway = new RealtimeGateway(redis, prisma, {
    now: () => Date.now(),
    status: () => ({ offsetMs: 0, sampledAt: 0, rttMs: null, source: 'local' as const }),
  } as any);
  (gateway as any).logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return gateway;
}

/** An already-authenticated context, registered the way processHello does. */
function admit(gateway: RealtimeGateway, deviceId: string, tenantId = 't1') {
  const socket = makeSocket();
  const ctx: any = {
    connectionId: `c-${Math.random().toString(36).slice(2)}`,
    deviceId,
    tenantId,
    isAuthenticated: true,
    socket,
    connectedAt: Date.now(),
    telemetryTokens: 30,
    telemetryRefilledAt: Date.now(),
  };
  (gateway as any).clients.set(socket, ctx);
  (gateway as any).trackAuthenticated(ctx);
  return ctx;
}

const drain = (gateway: RealtimeGateway) => {
  for (const ctx of (gateway as any).clients.values()) {
    if (ctx.authTimeout) clearTimeout(ctx.authTimeout);
  }
  (gateway as any).clients.clear();
  (gateway as any).onModuleDestroy();
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. The per-device cap is now an index lookup
// ─────────────────────────────────────────────────────────────────────────────

describe('per-device socket cap — O(1), same semantics', () => {
  it('still holds at 3 sockets, evicting oldest-first and never the newest', () => {
    const gateway = makeGateway();
    const opened = Array.from({ length: 10 }, () => {
      const ctx = admit(gateway, 'screen-A');
      (gateway as any).enforceDeviceSocketCap(ctx);
      return ctx;
    });

    const live = (gateway as any).socketsByDevice.get('screen-A');
    expect(live.size).toBe(3);
    // The last three admitted are the survivors, in order.
    expect([...live]).toEqual(opened.slice(-3));
    // The newest is never the victim — that property keeps a reconnecting
    // kiosk on the push tier (RT-02).
    expect((opened[9].socket.close as jest.Mock)).not.toHaveBeenCalled();
    // The seven oldest were CLOSED, not merely forgotten.
    for (const old of opened.slice(0, 7)) {
      expect(old.socket.close).toHaveBeenCalledWith(4009, 'Too Many Connections');
      expect((gateway as any).clients.has(old.socket)).toBe(false);
    }
    drain(gateway);
  });

  it('does not read the client map at all — the O(fleet²) walk is gone', () => {
    // The proof: run the cap with `clients` EMPTIED. If the count still came
    // from a walk of every client it would see zero sockets and evict nothing.
    const gateway = makeGateway();
    const mine = Array.from({ length: 6 }, () => admit(gateway, 'screen-A'));
    (gateway as any).clients.clear();

    (gateway as any).enforceDeviceSocketCap(mine[5]);

    expect((gateway as any).socketsByDevice.get('screen-A').size).toBe(3);
    for (const old of mine.slice(0, 3)) expect(old.socket.close).toHaveBeenCalled();
    drain(gateway);
  });

  it('is unaffected by fleet size — 3 evictions whether 10 or 10,000 screens are connected', () => {
    const gateway = makeGateway();
    for (let i = 0; i < 10_000; i++) admit(gateway, `screen-${i}`);
    const mine = Array.from({ length: 6 }, () => admit(gateway, 'screen-A'));

    (gateway as any).enforceDeviceSocketCap(mine[5]);

    expect((gateway as any).socketsByDevice.get('screen-A').size).toBe(3);
    // Nobody else's socket was touched.
    expect((gateway as any).socketsByDevice.get('screen-4242').size).toBe(1);
    drain(gateway);
  });

  it('counts per device — one screen cannot evict another', () => {
    const gateway = makeGateway();
    for (let i = 0; i < 8; i++) {
      const ctx = admit(gateway, 'screen-A');
      (gateway as any).enforceDeviceSocketCap(ctx);
    }
    const b = admit(gateway, 'screen-B');
    (gateway as any).enforceDeviceSocketCap(b);

    expect((gateway as any).socketsByDevice.get('screen-A').size).toBe(3);
    expect((gateway as any).socketsByDevice.get('screen-B').size).toBe(1);
    expect(b.socket.close).not.toHaveBeenCalled();
    drain(gateway);
  });

  it('drops the index entry when a device disconnects entirely', () => {
    const gateway = makeGateway();
    const ctx = admit(gateway, 'screen-A');
    gateway.handleDisconnect(ctx.socket);
    expect((gateway as any).socketsByDevice.has('screen-A')).toBe(false);
    drain(gateway);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The pre-auth socket is bounded
// ─────────────────────────────────────────────────────────────────────────────

describe('pre-auth sockets are bounded', () => {
  const req = (ip: string) => ({ headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` } }) as any;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('closes a SILENT socket in 5s — it used to get 10s', () => {
    const gateway = makeGateway();
    const socket = makeSocket();
    gateway.handleConnection(socket, req('203.0.113.7'));

    jest.advanceTimersByTime(4_999);
    expect(socket.close).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2);
    expect(socket.close).toHaveBeenCalledWith(4001, 'Auth Timeout');
    expect((gateway as any).clients.has(socket)).toBe(false);
    drain(gateway);
  });

  it('does NOT close a socket whose HELLO is being admitted at the 5s mark', async () => {
    // The tail this protects: a real kiosk reconnecting into a cold API. The
    // single old 10s timer could guillotine it mid-admission.
    const gateway = makeGateway();
    const socket = makeSocket();
    gateway.handleConnection(socket, req('203.0.113.7'));

    // A HELLO that never resolves — exactly the slow-admission shape.
    (gateway as any).processHello(socket, { token: 'never.resolves.here' });
    jest.advanceTimersByTime(9_000);
    expect(socket.close).not.toHaveBeenCalledWith(4001, 'Auth Timeout');

    // …but it is not unbounded either.
    jest.advanceTimersByTime(30_000);
    expect(socket.close).toHaveBeenCalledWith(4001, 'Auth Timeout');
    drain(gateway);
  });

  it('caps SILENT sockets per address at 32, evicting oldest and keeping the newest', () => {
    const gateway = makeGateway();
    const sockets = Array.from({ length: 40 }, () => {
      const s = makeSocket();
      gateway.handleConnection(s, req('198.51.100.9'));
      return s;
    });

    const bucket = (gateway as any).silentPreAuthByIp.get('198.51.100.9');
    expect(bucket.size).toBe(32);
    // Oldest eight closed…
    for (const s of sockets.slice(0, 8)) {
      expect(s.close).toHaveBeenCalledWith(4001, 'Too Many Unauthenticated Connections');
    }
    // …newest untouched (the RT-02 posture: never refuse the freshest).
    expect(sockets[39].close).not.toHaveBeenCalled();
    drain(gateway);
  });

  it('does not let one address evict another address\'s silent sockets', () => {
    const gateway = makeGateway();
    const victimIp = makeSocket();
    gateway.handleConnection(victimIp, req('192.0.2.5'));
    for (let i = 0; i < 40; i++) gateway.handleConnection(makeSocket(), req('198.51.100.9'));

    expect(victimIp.close).not.toHaveBeenCalled();
    drain(gateway);
  });

  it('caps SILENT sockets globally at 512 even when spread across addresses', () => {
    const gateway = makeGateway();
    for (let i = 0; i < 600; i++) {
      gateway.handleConnection(makeSocket(), req(`198.51.100.${i % 250}`));
    }
    expect((gateway as any).silentPreAuth.size).toBe(512);
    drain(gateway);
  });

  it('a socket that says HELLO leaves the silent population, so a real fleet never hits the cap', () => {
    const gateway = makeGateway();
    const sockets = Array.from({ length: 100 }, () => {
      const s = makeSocket();
      gateway.handleConnection(s, req('198.51.100.9'));
      // A real player sends HELLO synchronously from ws.onopen.
      (gateway as any).processHello(s, { token: 'x.y.z' });
      return s;
    });
    // 100 screens behind ONE address all reconnecting: none evicted.
    expect((gateway as any).silentPreAuthByIp.has('198.51.100.9')).toBe(false);
    for (const s of sockets) {
      expect(s.close).not.toHaveBeenCalledWith(4001, 'Too Many Unauthenticated Connections');
    }
    drain(gateway);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Nothing happens before AUTH_OK
// ─────────────────────────────────────────────────────────────────────────────

describe('a pre-auth socket is inert', () => {
  it('receives no fan-out on any emergency scope', () => {
    const gateway = makeGateway();
    const socket = makeSocket();
    gateway.handleConnection(socket, undefined);
    // Give it the identity it would have had, but no authentication.
    const ctx = (gateway as any).clients.get(socket);
    ctx.deviceId = 'screen-A';
    ctx.tenantId = 't1';
    ctx.groupId = 'g1';

    gateway.broadcastToScope('tenant', 't1', { type: 'OVERRIDE', payload: {} });
    gateway.broadcastToScope('group', 'g1', { type: 'OVERRIDE', payload: {} });
    gateway.broadcastToScope('device', 'screen-A', { type: 'OVERRIDE', payload: {} });

    expect(socket.send).not.toHaveBeenCalled();
    drain(gateway);
  });

  it('admits ONE HELLO at a time — a burst cannot fan out concurrent admissions', async () => {
    const gateway = makeGateway();
    const socket = makeSocket();
    gateway.handleConnection(socket, undefined);
    const ctx = (gateway as any).clients.get(socket);

    let started = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => (release = r));
    // The real `processHello` runs; only the admission it awaits is stubbed,
    // so what is measured is the handler's own concurrency control.
    jest.spyOn(gateway as any, 'consumeTelemetryToken').mockImplementation(() => true);
    const admitSpy = jest
      .spyOn(require('../screens/device-auth'), 'admitDeviceCredential')
      .mockImplementation(async () => {
        started += 1;
        await gate;
        return { ok: false, reason: 'test' } as any;
      });

    const flight = Array.from({ length: 5 }, () =>
      (gateway as any).processHello(socket, { token: 'a.b.c' }),
    );
    expect(started).toBe(1);
    expect(ctx.helloInFlight).toBe(true);

    release!();
    await Promise.all(flight);
    expect(started).toBe(1);
    admitSpy.mockRestore();
    drain(gateway);
  });
});
