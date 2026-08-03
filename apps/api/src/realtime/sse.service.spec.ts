import { SseService } from './sse.service';

/**
 * S15 (launch-readiness): an open SSE stream is re-checked for token
 * revocation, not only gated at open. FAIL-OPEN — a transient Redis error must
 * never drop a legitimate device's emergency stream.
 */
function fakeRes() {
  return {
    written: [] as string[],
    ended: false,
    write(s: string) { this.written.push(s); return true; },
    end() { this.ended = true; },
    on() { /* no-op close handler for the test */ },
    setHeader() {},
    flushHeaders() {},
  };
}

describe('SseService.tickRevocation (S15)', () => {
  function make(sismember: (key: string, member: string) => Promise<boolean>) {
    const redis = { sismember } as any;
    const svc = new SseService(redis);
    return svc;
  }

  it('closes a stream whose device token is now revoked', async () => {
    const svc = make(async (_k, token) => token === 'revoked-token');
    const res = fakeRes();
    svc.register({ tenantId: 't1', deviceId: 'screen-1', res: res as any, token: 'revoked-token' });

    const closed = await svc.tickRevocation();

    expect(closed.length).toBe(1);
    expect(res.ended).toBe(true);
    expect(res.written.some((w) => w.includes('TOKEN_REVOKED'))).toBe(true);
    expect(svc.size()).toBe(0);
  });

  it('leaves a stream with a still-valid token open', async () => {
    const svc = make(async () => false);
    const res = fakeRes();
    svc.register({ tenantId: 't1', deviceId: 'screen-1', res: res as any, token: 'good-token' });

    const closed = await svc.tickRevocation();

    expect(closed).toEqual([]);
    expect(res.ended).toBe(false);
    expect(svc.size()).toBe(1);
  });

  it('FAILS OPEN: a Redis error does not drop the stream', async () => {
    const svc = make(async () => { throw new Error('redis down'); });
    const res = fakeRes();
    svc.register({ tenantId: 't1', deviceId: 'screen-1', res: res as any, token: 'any-token' });

    const closed = await svc.tickRevocation();

    expect(closed).toEqual([]);
    expect(res.ended).toBe(false);
    expect(svc.size()).toBe(1);
  });

  it('skips clients with no token (internal/test streams)', async () => {
    const sismember = jest.fn(async () => true);
    const svc = new SseService({ sismember } as any);
    const res = fakeRes();
    svc.register({ tenantId: 't1', deviceId: null, res: res as any }); // no token

    const closed = await svc.tickRevocation();

    expect(closed).toEqual([]);
    expect(sismember).not.toHaveBeenCalled();
    expect(res.ended).toBe(false);
  });

  it('no-ops when Redis is unavailable (fail-open, no injection)', async () => {
    const svc = new SseService(); // redis undefined
    const res = fakeRes();
    svc.register({ tenantId: 't1', deviceId: 'screen-1', res: res as any, token: 'x' });
    await expect(svc.tickRevocation()).resolves.toEqual([]);
    expect(res.ended).toBe(false);
  });
});

/**
 * DT-08 follow-on: a stream opened with a 60-second stream ticket holds NO
 * token string, so the denylist sweep above has nothing to look up. Without
 * the credential-epoch leg, a ticket-authed stream would have had no
 * revocation sweep at all and would survive an operator revoke until the
 * kiosk happened to reconnect. These pin the epoch/status leg.
 */
describe('SseService.tickRevocation — credential-epoch sweep (DT-01/DT-08)', () => {
  function makeWithScreen(row: any | Error) {
    const findUnique = jest.fn(async () => {
      if (row instanceof Error) throw row;
      return row;
    });
    const prisma = { client: { screen: { findUnique, updateMany: jest.fn(async () => ({ count: 1 })) } } } as any;
    const redis = { sismember: jest.fn(async () => false) } as any;
    return { svc: new SseService(redis, prisma), findUnique };
  }

  it('closes a TICKET-authed stream (no token) whose screen was revoked', async () => {
    const { svc, findUnique } = makeWithScreen({ status: 'REVOKED', credentialEpoch: 4 });
    const res = fakeRes();
    svc.register({ tenantId: 't1', deviceId: 'screen-1', res: res as any, token: null, credentialEpoch: 4 });

    const closed = await svc.tickRevocation();

    expect(findUnique).toHaveBeenCalled();
    expect(closed.length).toBe(1);
    expect(res.ended).toBe(true);
    expect(res.written.some((w) => w.includes('screen credential revoked'))).toBe(true);
    expect(svc.size()).toBe(0);
  });

  it('closes a stream whose screen row has been deleted', async () => {
    const { svc } = makeWithScreen(null);
    const res = fakeRes();
    svc.register({ tenantId: 't1', deviceId: 'screen-1', res: res as any, token: null, credentialEpoch: 0 });

    expect((await svc.tickRevocation()).length).toBe(1);
    expect(res.ended).toBe(true);
  });

  it('closes a stream whose epoch fell outside the rotation grace window', async () => {
    const { svc } = makeWithScreen({
      status: 'ONLINE',
      credentialEpoch: 9,
      credentialEpochRotatedAt: new Date(),
    });
    const res = fakeRes();
    svc.register({ tenantId: 't1', deviceId: 'screen-1', res: res as any, token: null, credentialEpoch: 2 });

    const closed = await svc.tickRevocation();

    expect(closed.length).toBe(1);
    expect(res.written.some((w) => w.includes('screen credential rotated'))).toBe(true);
  });

  it('KEEPS a stream through a routine rotation (epoch-1, inside the grace window)', async () => {
    // A live emergency stream must not be dropped just because the kiosk
    // re-registered and rotated its credential.
    const { svc } = makeWithScreen({
      status: 'ONLINE',
      credentialEpoch: 5,
      credentialEpochRotatedAt: new Date(),
    });
    const res = fakeRes();
    svc.register({ tenantId: 't1', deviceId: 'screen-1', res: res as any, token: null, credentialEpoch: 4 });

    expect(await svc.tickRevocation()).toEqual([]);
    expect(res.ended).toBe(false);
    expect(svc.size()).toBe(1);
  });

  it('FAILS OPEN when the screen lookup throws (DB blip must not drop emergency streams)', async () => {
    const { svc } = makeWithScreen(new Error('pool timeout'));
    const res = fakeRes();
    svc.register({ tenantId: 't1', deviceId: 'screen-1', res: res as any, token: null, credentialEpoch: 1 });

    expect(await svc.tickRevocation()).toEqual([]);
    expect(res.ended).toBe(false);
  });

  it('does not query the DB for a client registered without an epoch', async () => {
    const { svc, findUnique } = makeWithScreen({ status: 'REVOKED', credentialEpoch: 99 });
    const res = fakeRes();
    svc.register({ tenantId: 't1', deviceId: 'screen-1', res: res as any, token: 'legacy' });

    expect(await svc.tickRevocation()).toEqual([]);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
