/**
 * Bounded fetch (2026-08-30 deep audit, D-1 + adversarial finding F1).
 * The contract: ONE deadline across connect + headers + BODY. The v1 test
 * suite asserted the timer died at headers — codifying the exact hole a
 * stalling proxy exploits — so these tests stall the body on purpose.
 */
import { fetchJsonBounded, DEFAULT_FETCH_TIMEOUT_MS } from '../fetchTimeout';

/** A Response-like whose body read behavior is scripted. */
function fakeRes(opts: {
  status?: number;
  json?: () => Promise<any>;
}): any {
  return {
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    headers: { get: () => null },
    json: opts.json ?? (() => Promise.resolve({})),
  };
}

describe('fetchJsonBounded', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('F1, THE HEADERS-ONLY HOLE, CLOSED: 200 headers + never-ending BODY rejects at the deadline', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url: any, init: any) =>
      Promise.resolve(
        fakeRes({
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('The operation was aborted.', 'AbortError')));
            }),
        }),
      )) as any;

    const p = fetchJsonBounded('https://api.example/manifest', {}, 5_000);
    const settled = jest.fn();
    p.catch(settled);
    await jest.advanceTimersByTimeAsync(4_999);
    expect(settled).not.toHaveBeenCalled(); // still inside the deadline
    await jest.advanceTimersByTimeAsync(2);
    expect(settled).toHaveBeenCalledTimes(1); // body stall = failure, not success
    expect(settled.mock.calls[0][0]?.name).toBe('AbortError');
  });

  it('a stalled CONNECTION (never even headers) rejects at the deadline', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url: any, init: any) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')));
      })) as any;
    const settled = jest.fn();
    fetchJsonBounded('https://api.example/x', {}, 3_000).catch(settled);
    await jest.advanceTimersByTimeAsync(3_001);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('a normal JSON response resolves with parsed body and clears the timer', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(() =>
      Promise.resolve(fakeRes({ json: () => Promise.resolve({ hello: 1 }) }))) as any;
    const out = await fetchJsonBounded('https://api.example/x');
    expect(out.json).toEqual({ hello: 1 });
    expect(out.res.status).toBe(200);
    await jest.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS + 1_000);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('an empty/non-JSON body (304/204) yields json:null WITHOUT throwing', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(fakeRes({ status: 304, json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')) }))) as any;
    const out = await fetchJsonBounded('https://api.example/manifest');
    expect(out.res.status).toBe(304);
    expect(out.json).toBeNull();
  });

  it('a network failure rejects untouched', async () => {
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as any;
    await expect(fetchJsonBounded('https://api.example/x')).rejects.toThrow('Failed to fetch');
  });

  it('F2 PREEMPT LANE: an external controller aborts an in-flight request immediately', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url: any, init: any) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')));
      })) as any;
    const ctl = new AbortController();
    const settled = jest.fn();
    fetchJsonBounded('https://api.example/manifest', {}, 20_000, ctl).catch(settled);
    await jest.advanceTimersByTimeAsync(50);
    expect(settled).not.toHaveBeenCalled();
    ctl.abort(); // the OVERRIDE just arrived — stop waiting on stale normal content
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled.mock.calls[0][0]?.name).toBe('AbortError');
  });

  it('passes method/headers/body through and injects a signal', async () => {
    let seen: any;
    global.fetch = jest.fn((_u: any, init: any) => {
      seen = init;
      return Promise.resolve(fakeRes({}));
    }) as any;
    await fetchJsonBounded('https://api.example/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    expect(seen.method).toBe('POST');
    expect(seen.body).toBe('{"a":1}');
    expect(seen.signal).toBeDefined();
  });
});
