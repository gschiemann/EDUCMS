import { readFileSync } from 'fs';
import { join } from 'path';
import {
  OFFSET_RELEARN_MAX_ROUND_TRIP_MS,
  OFFSET_RELEARN_MIN_GAP_MS,
  STALE_PREEMPT_MIN_GAP_MS,
  STALE_RECONCILE_MIN_GAP_MS,
  createStaleDropState,
  offsetFromTimeSample,
  planStaleDropRecovery,
  relearnServerClockOffset,
} from '../staleDropRecovery';
import { checkSensitivePush } from '../pushGate';

const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);

describe('planStaleDropRecovery', () => {
  test('the first stale drop pre-empts the manifest and re-measures the clock', () => {
    const state = createStaleDropState();
    expect(planStaleDropRecovery(state, 1_000, T0)).toEqual({ reconcile: 'preempt', relearn: true });
  });

  test('a burst of refused frames triggers one reconcile, not one per frame', () => {
    const state = createStaleDropState();
    planStaleDropRecovery(state, 1_000, T0);
    for (let i = 1; i <= 20; i++) {
      expect(planStaleDropRecovery(state, 1_000 + i * 100, T0 + i * 100)).toEqual({ reconcile: 'none', relearn: false });
    }
  });

  test('inside the manifest deadline a later drop only coalesces, so it cannot abort the request the first one started', () => {
    const state = createStaleDropState();
    planStaleDropRecovery(state, 0, T0);
    const gap = STALE_RECONCILE_MIN_GAP_MS;
    expect(planStaleDropRecovery(state, gap, T0 + gap).reconcile).toBe('coalesce');
    expect(planStaleDropRecovery(state, 2 * gap, T0 + 2 * gap).reconcile).toBe('coalesce');
    expect(planStaleDropRecovery(state, STALE_PREEMPT_MIN_GAP_MS, T0 + STALE_PREEMPT_MIN_GAP_MS).reconcile).toBe('preempt');
  });

  test('the pre-empt window is longer than the 20 s manifest deadline', () => {
    expect(STALE_PREEMPT_MIN_GAP_MS).toBeGreaterThan(20_000);
  });

  test('the clock is re-measured again only after its own window', () => {
    const state = createStaleDropState();
    planStaleDropRecovery(state, 0, T0);
    expect(planStaleDropRecovery(state, 10_000, T0 + 10_000).relearn).toBe(false);
    expect(planStaleDropRecovery(state, OFFSET_RELEARN_MIN_GAP_MS, T0 + OFFSET_RELEARN_MIN_GAP_MS).relearn).toBe(true);
  });

  test('a wall clock that jumps (forward or back) never suppresses the recovery', () => {
    const forward = createStaleDropState();
    planStaleDropRecovery(forward, 0, T0);
    expect(planStaleDropRecovery(forward, 200, T0 + 6 * 3_600_000)).toEqual({ reconcile: 'preempt', relearn: true });
    const back = createStaleDropState();
    planStaleDropRecovery(back, 0, T0);
    expect(planStaleDropRecovery(back, 200, T0 - 6 * 3_600_000)).toEqual({ reconcile: 'preempt', relearn: true });
  });

  test('a monotonic clock that stood still during sleep never suppresses the recovery', () => {
    const state = createStaleDropState();
    planStaleDropRecovery(state, 5_000, T0);
    // performance.now() barely moved, but an hour of wall time passed.
    expect(planStaleDropRecovery(state, 5_010, T0 + 3_600_000)).toEqual({ reconcile: 'preempt', relearn: true });
  });
});

describe('offsetFromTimeSample', () => {
  test('is what to ADD to local Date.now(), with half the round trip credited to the server', () => {
    // Device clock is 2 h behind the server; the request took 200 ms.
    const deviceNow = T0;
    const serverRead = T0 + 7_200_000 - 100;
    expect(offsetFromTimeSample(serverRead, 200, deviceNow)).toBe(7_200_000);
  });

  test.each([
    ['a string', '1762689600000'], ['null', null], ['NaN', NaN], ['Infinity', Infinity], ['zero', 0], ['negative', -5],
  ])('rejects %s as the server time', (_label, value) => {
    expect(offsetFromTimeSample(value, 50, T0)).toBeNull();
  });

  test('rejects a sample too slow or too odd to trust', () => {
    expect(offsetFromTimeSample(T0, OFFSET_RELEARN_MAX_ROUND_TRIP_MS + 1, T0)).toBeNull();
    expect(offsetFromTimeSample(T0, -1, T0)).toBeNull();
    expect(offsetFromTimeSample(T0, NaN, T0)).toBeNull();
    expect(offsetFromTimeSample(T0, 50, NaN)).toBeNull();
  });
});

describe('relearnServerClockOffset', () => {
  const okResponse = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

  test('asks the API clock endpoint and returns the offset', async () => {
    const fetchImpl = jest.fn(async () => okResponse({ serverNow: T0 + 90_000 }));
    let mono = 0;
    const offset = await relearnServerClockOffset({
      apiRoot: 'https://api.example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      monoNow: () => (mono += 50),
      wallNow: () => T0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe('https://api.example.test/api/v1/realtime/time');
    expect((fetchImpl.mock.calls[0] as unknown[])[1]).toMatchObject({ cache: 'no-store' });
    expect(offset).toBe(90_025);
  });

  test.each([
    ['a network failure', async () => { throw new TypeError('Failed to fetch'); }],
    ['a non-200 answer', async () => ({ ok: false, json: async () => ({ serverNow: T0 }) })],
    ['a body that is not JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } })],
    ['a body without the clock', async () => ({ ok: true, json: async () => ({}) })],
  ])('returns null on %s and never throws', async (_label, impl) => {
    await expect(relearnServerClockOffset({
      apiRoot: 'https://api.example.test', fetchImpl: impl as unknown as typeof fetch,
    })).resolves.toBeNull();
  });

  test('a request that never answers is aborted at the timeout', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
      const pending = relearnServerClockOffset({
        apiRoot: 'https://api.example.test', fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 1_000,
      });
      jest.advanceTimersByTime(1_001);
      await expect(pending).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the scenario this exists for: the wall clock steps after sign-in', () => {
  test('a fresh signed OVERRIDE is refused with the old offset and accepted with the re-learned one', () => {
    const serverNow = T0;
    const deviceNow = T0 - 2 * 3_600_000; // the box woke up two hours behind
    const frame = { type: 'OVERRIDE', eventId: 'evt-1', timestamp: serverNow, signature: 'sig' };
    const realNow = Date.now;
    Date.now = () => deviceNow;
    try {
      const staleOffset = 0; // learned at sign-in, before the clock stepped
      expect(checkSensitivePush(frame, { seenEventIds: new Map(), serverClockOffsetMs: staleOffset })).toEqual({ accepted: false, reason: 'stale' });
      const relearned = offsetFromTimeSample(serverNow, 80, deviceNow);
      expect(relearned).not.toBeNull();
      const next = { ...frame, eventId: 'evt-2' };
      expect(checkSensitivePush(next, { seenEventIds: new Map(), serverClockOffsetMs: relearned as number }).accepted).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });
});

describe('player/page.tsx wiring', () => {
  const page = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8');

  test('both transports start the recovery on a stale verdict, and only on a stale one', () => {
    expect(page).toContain("if (verdict.reason === 'stale') recoverFromStaleDrop('SSE');");
    expect(page).toContain("if (wsVerdict.reason === 'stale') recoverFromStaleDrop('WS');");
    expect(page.split('recoverFromStaleDrop(').length - 1).toBe(2);
  });

  test('a refused frame is still refused: the recovery sits before the return, inside the not-accepted branch', () => {
    const sse = page.slice(page.indexOf('const gateSse'), page.indexOf('const handle = (name'));
    expect(sse).toMatch(/if \(!verdict\.accepted\) \{[\s\S]*recoverFromStaleDrop\('SSE'\);\s*return false;\s*\}/);
    const wsStart = page.indexOf('const wsVerdict = checkSensitivePush(');
    const ws = page.slice(wsStart, wsStart + 1_400);
    expect(ws).toMatch(/if \(!wsVerdict\.accepted\) \{[\s\S]*recoverFromStaleDrop\('WS'\);\s*return;\s*\}/);
  });

  test('the recovery asks the manifest and re-measures the offset; it never applies anything itself', () => {
    const start = page.indexOf('const recoverFromStaleDrop = useCallback(');
    const body = page.slice(start, page.indexOf('}, [preemptReconcile, fetchContent]);', start));
    expect(start).toBeGreaterThan(0);
    expect(body).toContain('planStaleDropRecovery(staleDropStateRef.current, performance.now(), Date.now())');
    expect(body).toContain('preemptReconcile()');
    expect(body).toContain('relearnServerClockOffset({ apiRoot: getApiRoot() })');
    expect(body).toContain('serverClockOffsetRef.current = offset');
    expect(body).not.toMatch(/setActiveEmergency|raiseFromSignedPush|setEmergencyActive|activeEmergencyRef\.current\s*=/);
  });

  test('persistent storage is requested once, never in preview mode', () => {
    const at = page.indexOf('void requestPersistentStorage(');
    expect(at).toBeGreaterThan(0);
    expect(page.split('requestPersistentStorage(').length - 1).toBe(1);
    expect(page.slice(at - 200, at)).toContain('if (isPreviewMode()) return;');
  });
});
