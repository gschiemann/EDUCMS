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
