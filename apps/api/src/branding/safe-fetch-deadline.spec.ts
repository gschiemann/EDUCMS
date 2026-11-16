/**
 * safeFetch / safeFetchPost — total wall-clock deadline.
 *
 * The socket idle timeout never fires against an upstream that keeps the
 * connection busy by sending a byte at a time. A total deadline must destroy
 * the request regardless. The transport is faked: the response drips one
 * byte every 20 ms and never ends unless the request is destroyed.
 */

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:http', () => {
  const { EventEmitter: EE } = require('node:events');
  return {
    request: (_url: unknown, _opts: unknown, cb: (res: any) => void) => {
      const req: any = new EE();
      const state = (global as any).__sfDrip as { destroyed: number; redirectsLeft: number };
      let timer: ReturnType<typeof setInterval> | null = null;
      req.end = () => {
        const res: any = new EE();
        res.resume = () => undefined;
        res.destroy = () => {
          if (timer) clearInterval(timer);
        };
        if (state.redirectsLeft > 0) {
          state.redirectsLeft -= 1;
          res.statusCode = 302;
          res.headers = { location: 'http://example.com/next' };
          setTimeout(() => cb(res), 150);
          return;
        }
        res.statusCode = 200;
        res.headers = {};
        cb(res);
        timer = setInterval(() => res.emit('data', Buffer.from('x')), 20);
      };
      req.destroy = () => {
        state.destroyed += 1;
        if (timer) clearInterval(timer);
      };
      req.write = () => true;
      return req;
    },
  };
});

import { lookup } from 'node:dns/promises';
import { safeFetch, safeFetchPost, FetchDeadlineError, SsrfError, defaultDeadlineMs } from './safe-fetch';

const mockedLookup = lookup as unknown as jest.Mock;

beforeEach(() => {
  mockedLookup.mockReset();
  mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  (global as any).__sfDrip = { destroyed: 0, redirectsLeft: 0 };
});
afterEach(() => {
  delete (global as any).__sfDrip;
});

describe('total deadline', () => {
  it('safeFetch: a slow-drip body is destroyed at the deadline', async () => {
    const started = Date.now();
    const err = await safeFetch('http://example.com/slow', { timeoutMs: 5000, deadlineMs: 300 }).catch((e) => e);
    expect(err).toBeInstanceOf(FetchDeadlineError);
    expect(err).toBeInstanceOf(SsrfError);
    expect(err.publicMessage).toBe('Upstream request timed out');
    expect(Date.now() - started).toBeLessThan(2000);
    expect((global as any).__sfDrip.destroyed).toBeGreaterThanOrEqual(1);
  });

  it('safeFetch: the deadline spans redirects (it is not reset per hop)', async () => {
    (global as any).__sfDrip.redirectsLeft = 3; // 3 × 150 ms before the body
    const started = Date.now();
    const err = await safeFetch('http://example.com/a', { timeoutMs: 5000, deadlineMs: 350 }).catch((e) => e);
    expect(err).toBeInstanceOf(FetchDeadlineError);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('safeFetchPost: a slow-drip response is destroyed at the deadline', async () => {
    const started = Date.now();
    const err = await safeFetchPost('http://example.com/hook', {
      body: '{}',
      timeoutMs: 5000,
      deadlineMs: 300,
      maxBytes: 1024 * 1024,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(FetchDeadlineError);
    expect(Date.now() - started).toBeLessThan(2000);
    expect((global as any).__sfDrip.destroyed).toBeGreaterThanOrEqual(1);
  });

  it('defaults to a deadline that is longer than the idle timeout', () => {
    expect(defaultDeadlineMs(8000)).toBe(24_000);
    expect(defaultDeadlineMs(1000)).toBe(15_000);
  });
});
