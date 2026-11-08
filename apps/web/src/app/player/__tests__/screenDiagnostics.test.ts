/**
 * The page half of screen diagnostics (2026-11-08): parse, answer once by
 * value, bounded probes, read-only emergency tier, the 30-minute storage report.
 */
import {
  DIAG_DONE_KEY,
  STORAGE_REPORT_EVERY_MS,
  answerDiagnosticsRequest,
  chromeMajor,
  claimRequest,
  collectPageFacts,
  maybeReportStorage,
  readDiagnosticsRequest,
  storageReportDue,
} from '../screenDiagnostics';

const ID = '3f2b8c1e-9a4d-4e7b-8f10-2a3b4c5d6e7f';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const okFetch = () => jest.fn(async () => ({ ok: true, status: 201 }) as unknown as Response);

describe('reading a request', () => {
  it('accepts the manifest and the push shapes; refuses another screen or garbage', () => {
    expect(readDiagnosticsRequest({ id: ID, kind: 'SELF_TEST' }, 's1')).toEqual({ id: ID, kind: 'SELF_TEST' });
    expect(readDiagnosticsRequest({ requestId: ID, kind: 'LOGS', screenId: 's1' }, 's1')).toEqual({ id: ID, kind: 'LOGS' });
    expect(readDiagnosticsRequest({ requestId: ID, kind: 'SELF_TEST', screenId: 's2' }, 's1')).toBeNull();
    expect(readDiagnosticsRequest({ id: 'x', kind: 'SELF_TEST' }, 's1')).toBeNull();
    expect(readDiagnosticsRequest({ id: ID, kind: 'REBOOT' }, 's1')).toBeNull();
    expect(readDiagnosticsRequest(null, 's1')).toBeNull();
  });
  it('reads the Chrome major from a WebView UA', () => {
    expect(chromeMajor('Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 Chrome/66.0.3359.158 Mobile Safari/537.36')).toBe(66);
    expect(chromeMajor('Mozilla/5.0 (Macintosh) Version/17.0 Safari/605.1.15')).toBeNull();
  });
});

describe('value identity', () => {
  it('an id is answered once, whichever ride brought it', () => {
    const s = mem();
    expect(claimRequest(s, ID)).toBe(true);
    expect(claimRequest(s, ID)).toBe(false);
    expect(s.m.get(DIAG_DONE_KEY)).toBe(ID);
    expect(claimRequest(s, '00000000-0000-4000-8000-000000000001')).toBe(true);
  });

  it('posts the page half once, with the device credential, to that id', async () => {
    const fetchImpl = okFetch();
    const s = mem();
    const deps = {
      apiRoot: 'https://api.example', token: 'tok', screenId: 's1', manifestAppliedAtMs: 1_000, now: () => 31_000,
      fetchImpl, storage: s, estimate: { estimate: async () => ({ usage: 10, quota: 100 }) },
      cacheStatus: async () => ({ supported: true, emergency: { count: 4, bytes: 99 } }),
      document: { querySelector: () => null } as any, userAgent: 'Chrome/120.0.1 Safari',
    };
    expect(await answerDiagnosticsRequest({ id: ID, kind: 'SELF_TEST' }, deps)).toBe(201);
    expect(await answerDiagnosticsRequest({ id: ID, kind: 'SELF_TEST' }, deps)).toBeNull();
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const post = calls.find(([u]) => u.endsWith(`/diagnostics/${ID}/page`))!;
    expect(post[1].headers).toMatchObject({ Authorization: 'Bearer tok' });
    const body = JSON.parse(String(post[1].body));
    expect(body).toMatchObject({ chromeMajor: 120, legacyPolyfills: false, manifestAgeMs: 30_000, apiOk: true,
      origin: { usage: 10, quota: 100 }, emergency: { readable: true, entries: 4, bytes: 99 } });
  });

  it('a LOGS request is the native side’s job: the page sends nothing', async () => {
    const fetchImpl = okFetch();
    expect(await answerDiagnosticsRequest({ id: ID, kind: 'LOGS' }, { apiRoot: 'x', token: 't', screenId: 's', manifestAppliedAtMs: 0, fetchImpl, storage: mem() })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('probes are bounded and read-only', () => {
  it('an API that never answers is reported as not ok, inside the timeout', async () => {
    jest.useFakeTimers();
    try {
      const hang = jest.fn((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      }));
      const p = collectPageFacts({ apiRoot: 'https://api.example', token: 't', screenId: 's', manifestAppliedAtMs: 0,
        fetchImpl: hang as any, estimate: null, cacheStatus: async () => null, document: null, userAgent: '' });
      await jest.advanceTimersByTimeAsync(6_500);
      const facts = await p;
      expect(facts.apiOk).toBe(false);
      expect(facts.apiRoundTripMs).toBeNull();
      // A worker that did not answer is "not readable", never invented zeroes.
      expect(facts.emergency).toEqual({ readable: false, entries: null, bytes: null });
      expect(facts.manifestAgeMs).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the storage report', () => {
  it('goes out at most every 30 minutes', async () => {
    expect(storageReportDue(1_000, 0)).toBe(true);
    expect(storageReportDue(STORAGE_REPORT_EVERY_MS, 1)).toBe(false);
    expect(storageReportDue(STORAGE_REPORT_EVERY_MS + 2, 1)).toBe(true);
    const fetchImpl = okFetch();
    const s = mem();
    const deps = { apiRoot: 'https://api.example', token: 't', screenId: 's1', manifestAppliedAtMs: 0, now: () => 5_000_000,
      fetchImpl, storage: s, estimate: { estimate: async () => ({ usage: 150, quota: 160 }) },
      cacheStatus: async () => ({ supported: true, emergency: { count: 2, bytes: 5 } }) };
    expect(await maybeReportStorage(deps)).toBe(201);
    expect(await maybeReportStorage(deps)).toBeNull();
    const [url, init] = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>)[0];
    expect(url).toBe('https://api.example/api/v1/screens/s1/storage-health');
    expect(JSON.parse(String(init.body))).toEqual({ origin: { usage: 150, quota: 160 }, emergency: { readable: true, entries: 2, bytes: 5 } });
  });
});
