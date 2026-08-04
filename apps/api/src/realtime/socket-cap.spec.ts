/**
 * RT-02 (2026-08-04) — concurrent connections per device are now bounded on
 * BOTH realtime transports.
 *
 * THE GAP: every other realtime guard is PER SOCKET. The R-07 telemetry token
 * bucket and the RT-01 HELLO limits all hang off the per-connection context,
 * so opening a second connection re-mints a fresh bucket and resets every
 * per-socket cap. Nothing bounded the number of connections, which made "open
 * more sockets" the general bypass for all of them — and the RT-01 fix
 * (e8b549b8) made that MORE load-bearing, not less, by tightening the
 * per-socket path.
 *
 * THE SHAPE OF THE FIX, and why: evict-OLDEST, never refuse-newest. The player
 * reconnects on any close code, so refusing a new connection would let a
 * half-open zombie hold a kiosk's slot and lock it out of the push tier — an
 * outage on the channel that carries lockdown alerts. Evicting the oldest
 * always leaves the freshest connection live.
 *
 * Deliberately NOT paired with a per-IP cap: a district's whole kiosk fleet
 * shares one NAT egress IP, so any per-IP ceiling low enough to matter would
 * black out a school.
 */

import { SseService } from './sse.service';

const CAP = 3;

function fakeRes() {
  const handlers: Record<string, () => void> = {};
  return {
    ended: false,
    write: jest.fn(),
    end: jest.fn(function (this: any) { this.ended = true; }),
    on: (ev: string, cb: () => void) => { handlers[ev] = cb; },
    flush: jest.fn(),
    setHeader: jest.fn(),
    writeHead: jest.fn(),
    __fire: (ev: string) => handlers[ev]?.(),
  } as any;
}

function makeService() {
  const svc = new SseService(undefined as any, undefined as any);
  // Silence the connect/evict logging in test output.
  (svc as any).logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return svc;
}

const clientsOf = (svc: SseService) => (svc as any).clients as Map<string, any>;
const streamsFor = (svc: SseService, deviceId: string) =>
  [...clientsOf(svc).values()].filter((c) => c.deviceId === deviceId);

describe('RT-02 — SSE streams per device are capped', () => {
  it(`holds at ${CAP} streams for one device, no matter how many are opened`, () => {
    const svc = makeService();
    const opened = Array.from({ length: 10 }, () => {
      const res = fakeRes();
      svc.register({ tenantId: 't1', deviceId: 'screen-A', res });
      return res;
    });

    expect(streamsFor(svc, 'screen-A')).toHaveLength(CAP);
    // The overflow was closed, not merely forgotten.
    expect(opened.filter((r) => r.ended)).toHaveLength(10 - CAP);
  });

  it('evicts the OLDEST and always keeps the newest alive', () => {
    const svc = makeService();
    const ids = Array.from({ length: CAP + 2 }, () => {
      const res = fakeRes();
      return { id: svc.register({ tenantId: 't1', deviceId: 'screen-A', res }), res };
    });

    const surviving = streamsFor(svc, 'screen-A').map((c) => c.id);
    // The last CAP registered are the survivors, in order.
    expect(surviving).toEqual(ids.slice(-CAP).map((x) => x.id));
    // The freshest connection is never the victim — that is the property that
    // keeps a reconnecting kiosk on the push tier.
    expect(ids[ids.length - 1].res.ended).toBe(false);
    // The two oldest were the ones closed.
    expect(ids[0].res.ended).toBe(true);
    expect(ids[1].res.ended).toBe(true);
  });

  it('counts per device — one screen cannot evict another screen', () => {
    const svc = makeService();
    for (let i = 0; i < CAP + 3; i++) {
      svc.register({ tenantId: 't1', deviceId: 'screen-A', res: fakeRes() });
    }
    const bRes = fakeRes();
    svc.register({ tenantId: 't1', deviceId: 'screen-B', res: bRes });

    expect(streamsFor(svc, 'screen-A')).toHaveLength(CAP);
    expect(streamsFor(svc, 'screen-B')).toHaveLength(1);
    expect(bRes.ended).toBe(false);
  });

  it('leaves device-less streams alone (internal/dashboard callers)', () => {
    // A null deviceId has nothing to key a cap on; capping them by accident
    // would throttle dashboard/internal consumers.
    const svc = makeService();
    for (let i = 0; i < CAP + 4; i++) {
      svc.register({ tenantId: 't1', deviceId: null, res: fakeRes() });
    }
    expect(clientsOf(svc).size).toBe(CAP + 4);
  });
});

describe('RT-02 — the WS gateway applies the same ceiling', () => {
  // The gateway's eviction runs inside processHello, which needs a signed
  // token + Redis to reach. The cap logic itself is what regressed, so it is
  // pinned against source alongside the behavioural SSE coverage above.
  const src: string = require('fs').readFileSync(
    require('path').join(__dirname, 'realtime.gateway.ts'),
    'utf8',
  );

  it('declares the same cap as the SSE transport', () => {
    expect(src).toMatch(/const MAX_SOCKETS_PER_DEVICE = 3;/);
  });

  it('enforces it at authentication time, before AUTH_OK', () => {
    const hello = src.slice(src.indexOf('ctx.isAuthenticated = true;'));
    const evictAt = hello.indexOf('this.enforceDeviceSocketCap(ctx)');
    // Match the actual SEND, not the token — 'AUTH_OK' also appears in prose
    // above the call, which would make a bare indexOf assert the reverse.
    const authOkSendAt = hello.indexOf("this.send(client, 'AUTH_OK'");
    expect(evictAt).toBeGreaterThan(-1);
    expect(authOkSendAt).toBeGreaterThan(-1);
    // Evicting before AUTH_OK is what guarantees the new socket is not the victim.
    expect(evictAt).toBeLessThan(authOkSendAt);
  });

  it('evicts oldest-first and never the socket just admitted', () => {
    const m = src.slice(src.indexOf('private enforceDeviceSocketCap'));
    expect(m).toContain('mine.slice(0, mine.length - MAX_SOCKETS_PER_DEVICE)');
    expect(m).toContain('if (victim === newest) continue;');
    // Removed from the map BEFORE close, so it stops receiving fan-out at once.
    expect(m.indexOf('this.clients.delete(victim.socket)')).toBeLessThan(m.indexOf('victim.socket.close('));
    // handleDisconnect will not see it, so its timer must be cleared here.
    expect(m).toContain('clearTimeout(victim.authTimeout)');
  });
});
