/**
 * board-poll engine spec (Trust wave Domain B, 2026-08-06).
 *
 * Fake timers + a mocked fetch. Math.random is pinned to 0.5 in most
 * tests, which makes the ±10% jitter exactly 0 — so cadence assertions
 * are deterministic; a dedicated test pins it to 1 to prove jitter is
 * actually applied.
 */
import { startBoardPoll } from '../board-poll';

type MockResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
};

function makeRes({
  status = 200,
  etag = null,
  serverTime = null,
  body = {},
}: {
  status?: number;
  etag?: string | null;
  serverTime?: string | null;
  body?: unknown;
} = {}): MockResponse {
  const h: Record<string, string> = {};
  if (etag) h.etag = etag;
  if (serverTime) h['x-server-time'] = serverTime;
  return {
    ok: status >= 200 && status < 300,
    status,
    // Case-insensitive like the real Headers interface.
    headers: { get: (name: string) => h[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  };
}

function sentHeaders(call: unknown[]): Record<string, string> {
  return (call[1] as { headers: Record<string, string> }).headers;
}

/** Drain the fetch/json microtask chain (fake timers leave microtasks real). */
async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

describe('startBoardPoll', () => {
  let fetchMock: jest.Mock;
  const realFetch = (global as { fetch?: unknown }).fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // jitter = 0
    fetchMock = jest.fn();
    (global as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    (global as { fetch: unknown }).fetch = realFetch;
  });

  it('self-chains at intervalMs and never overlaps a slow response', async () => {
    // First response resolves only when WE release it — the engine must
    // not fire attempt #2 while #1 is in flight, no matter how long.
    let release!: (r: MockResponse) => void;
    fetchMock.mockImplementationOnce(() => new Promise((res) => { release = res; }));
    fetchMock.mockImplementation(() => Promise.resolve(makeRes()));

    const onPayload = jest.fn();
    const stop = startBoardPoll({ url: 'http://x/board/1', intervalMs: 750, onPayload });
    expect(fetchMock).toHaveBeenCalledTimes(1); // immediate first attempt

    // Three full intervals pass while #1 is still in flight — no overlap.
    jest.advanceTimersByTime(2250);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(makeRes({ body: { n: 1 } }));
    await flush();
    expect(onPayload).toHaveBeenCalledWith({ n: 1 });

    // Next attempt fires exactly one interval AFTER the settle.
    jest.advanceTimersByTime(749);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });

  it('sends If-None-Match once an ETag is known; 304 → onServerTime only', async () => {
    fetchMock
      .mockImplementationOnce(() =>
        Promise.resolve(makeRes({ etag: '"v1"', body: { score: 3 } })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(makeRes({ status: 304, serverTime: '1723000000123' })),
      );

    const onPayload = jest.fn();
    const onServerTime = jest.fn();
    const onStatus = jest.fn();
    const stop = startBoardPoll({
      url: 'http://x/board/1',
      intervalMs: 750,
      onPayload,
      onServerTime,
      onStatus,
    });
    await flush();
    expect(onPayload).toHaveBeenCalledTimes(1);
    // First request carries no conditional header (no validator yet).
    expect(sentHeaders(fetchMock.mock.calls[0])['If-None-Match']).toBeUndefined();

    jest.advanceTimersByTime(750);
    await flush();
    expect(sentHeaders(fetchMock.mock.calls[1])['If-None-Match']).toBe('"v1"');
    expect(onServerTime).toHaveBeenCalledWith(1723000000123);
    expect(onPayload).toHaveBeenCalledTimes(1); // the 304 delivered NO payload
    // A 304 is a GOOD poll — status must read online with zero failures.
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        consecutiveFailures: 0,
        online: true,
        lastError: null,
        lastHttpStatus: 304,
        lastGoodAt: Date.now(),
      }),
    );
    stop();
  });

  it('backs off 1500/3000/5000 (capped) on failures and resets on success', async () => {
    const onStatus = jest.fn();
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const stop = startBoardPoll({
      url: 'http://x/board/1',
      intervalMs: 750,
      onPayload: jest.fn(),
      onStatus,
    });
    await flush();
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        consecutiveFailures: 1,
        online: false,
        lastError: 'Failed to fetch',
        lastHttpStatus: null,
      }),
    );

    // failure #1 → retry after 1500 (jitter pinned to 0)
    jest.advanceTimersByTime(1499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await flush();

    // failure #2 → 3000
    jest.advanceTimersByTime(2999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await flush();

    // failure #3 → 5000…
    jest.advanceTimersByTime(4999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await flush();

    // …and it stays capped at 5000 for failure #4+.
    jest.advanceTimersByTime(5000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await flush();

    // Recovery: the next attempt succeeds → failures reset, cadence
    // returns to intervalMs.
    fetchMock.mockImplementation(() => Promise.resolve(makeRes()));
    jest.advanceTimersByTime(5000);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    await flush();
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        consecutiveFailures: 0,
        online: true,
        lastError: null,
        lastGoodAt: Date.now(),
      }),
    );
    jest.advanceTimersByTime(750);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    stop();
  });

  it('applies ±10% jitter to backoff delays', async () => {
    (Math.random as unknown as jest.Mock).mockReturnValue(1); // full +10%
    fetchMock.mockImplementation(() => Promise.reject(new Error('down')));
    const stop = startBoardPoll({ url: 'http://x/board/1', intervalMs: 750, onPayload: jest.fn() });
    await flush();
    // failure #1: base 1500 → 1650 at +10% jitter.
    jest.advanceTimersByTime(1649);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });

  it('a non-ok HTTP status counts as a failure and reports it in status', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(makeRes({ status: 404 })));
    const onStatus = jest.fn();
    const onPayload = jest.fn();
    const stop = startBoardPoll({
      url: 'http://x/board/1',
      intervalMs: 750,
      onPayload,
      onStatus,
    });
    await flush();
    expect(onPayload).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        consecutiveFailures: 1,
        online: false,
        lastError: 'HTTP 404',
        lastHttpStatus: 404,
      }),
    );
    stop();
  });

  it('never sends If-None-Match against a server that returns no ETag', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(makeRes({ body: { ok: 1 } })));
    const onPayload = jest.fn();
    const stop = startBoardPoll({ url: 'http://x/board/1', intervalMs: 750, onPayload });
    await flush();
    jest.advanceTimersByTime(750);
    await flush();
    jest.advanceTimersByTime(750);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(sentHeaders(call)['If-None-Match']).toBeUndefined();
    }
    expect(onPayload).toHaveBeenCalledTimes(3); // plain 200s keep flowing
    stop();
  });

  it('stop() suppresses callbacks from a still-in-flight attempt', async () => {
    let release!: (r: MockResponse) => void;
    fetchMock.mockImplementationOnce(() => new Promise((res) => { release = res; }));
    const onPayload = jest.fn();
    const onStatus = jest.fn();
    const stop = startBoardPoll({
      url: 'http://x/board/1',
      intervalMs: 750,
      onPayload,
      onStatus,
    });
    stop();
    release(makeRes({ body: { late: true } }));
    await flush();
    expect(onPayload).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // nothing rescheduled
  });

  it('stop() after a settled poll cancels the pending timer', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(makeRes()));
    const stop = startBoardPoll({ url: 'http://x/board/1', intervalMs: 750, onPayload: jest.fn() });
    await flush();
    stop();
    jest.advanceTimersByTime(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
