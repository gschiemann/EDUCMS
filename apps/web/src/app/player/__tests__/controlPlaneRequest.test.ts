import { createControlPlaneRequest } from '../controlPlaneRequest';
import { initialApiOriginState, onControlPlaneFailure, onControlPlaneSuccess } from '../apiOrigin';

const originalFetch = global.fetch;
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });

it('switches the origin after transport failures during established playback', async () => {
  let state = initialApiOriginState(false);
  const request = createControlPlaneRequest({
    success: () => { state = onControlPlaneSuccess(state); },
    failure: error => { state = onControlPlaneFailure(state, error); },
  });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ playlists: [] }) });
  await request('https://direct.invalid/manifest'); // already booted, healthy
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  for (let i = 0; i < 3; i++) await expect(request('https://direct.invalid/manifest')).rejects.toThrow('Failed to fetch');
  expect(state).toMatchObject({ mode: 'gateway', persistedFallback: true });
});

it.each([401, 429, 500])('keeps HTTP %s as a reachable answer for the caller to handle', async status => {
  const success = jest.fn(); const failure = jest.fn();
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) });
  const result = await createControlPlaneRequest({ success, failure })('https://direct.invalid/manifest');
  expect(result.res.status).toBe(status);
  expect(success).toHaveBeenCalledTimes(1);
  expect(failure).not.toHaveBeenCalled();
});

it('bounds a legacy-status body stall and permits the next retry', async () => {
  const success = jest.fn(); const failure = jest.fn();
  global.fetch = jest.fn().mockImplementation((_url, init: RequestInit) => Promise.resolve({
    status: 200,
    json: () => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('deadline', 'AbortError')))),
  }));
  const request = createControlPlaneRequest({ success, failure });
  const stalled = request('https://direct.invalid/status/fingerprint', {}, 10_000);
  const rejected = expect(stalled).rejects.toThrow('deadline');
  await jest.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(success).toHaveBeenCalledTimes(1); // headers arrived; do not switch
  expect(failure).not.toHaveBeenCalled();
  global.fetch = jest.fn().mockResolvedValue({ status: 200, json: async () => ({ paired: true }) });
  expect((await request('https://direct.invalid/status/fingerprint')).json).toEqual({ paired: true });
});

it('does not count intentional preemption as a failed origin', async () => {
  const success = jest.fn(); const failure = jest.fn();
  global.fetch = jest.fn().mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('preempted', 'AbortError')));
  }));
  const caller = new AbortController();
  const pending = createControlPlaneRequest({ success, failure })('https://direct.invalid/manifest', {}, 10_000, caller);
  caller.abort();
  await expect(pending).rejects.toThrow('preempted');
  expect(success).not.toHaveBeenCalled();
  expect(failure).not.toHaveBeenCalled();
});

it('counts an unanswered deadline while leaving the caller cancellation signal intact', async () => {
  const success = jest.fn(); const failure = jest.fn();
  global.fetch = jest.fn().mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('deadline', 'AbortError')));
  }));
  const caller = new AbortController();
  const pending = createControlPlaneRequest({ success, failure })('https://direct.invalid/manifest', {}, 10_000, caller);
  const rejected = expect(pending).rejects.toThrow('deadline');
  await jest.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(caller.signal.aborted).toBe(false);
  expect(failure).toHaveBeenCalledTimes(1);
  expect(success).not.toHaveBeenCalled();
});
