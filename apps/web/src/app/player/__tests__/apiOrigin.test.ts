import {
  DIRECT_FAILURES_BEFORE_GATEWAY,
  GATEWAY_FALLBACK_STORAGE_KEY,
  failureThreshold,
  initialApiOriginState,
  isNetworkClassFailure,
  onControlPlaneFailure,
  onControlPlaneSuccess,
  readPersistedFallback,
  writePersistedFallback,
  type ApiOriginState,
} from '../apiOrigin';

/**
 * P0-1 — direct-first, same-origin-gateway fallback.
 *
 * The device this exists for (Android-9 Goodview) loads the player shell from
 * the web origin and cannot reach the API origin at all: "Connecting to your
 * CMS…" forever. These tests pin the four properties that make the fallback
 * safe rather than merely clever:
 *
 *   1. Only TRANSPORT failures count. A 4xx/5xx means the API answered, so an
 *      origin switch cannot help and would hide a real server fault.
 *   2. The switch takes N CONSECUTIVE failures — a single blip must not move
 *      a healthy fleet onto the longer path.
 *   3. It moves the WHOLE control plane at once (a single mode, consumed by
 *      the one getApiRoot accessor) — never registration alone.
 *   4. It SELF-HEALS: every boot re-probes direct, and a direct success drops
 *      the persisted suspicion.
 */

function fail(state: ApiOriginState, err: unknown, times: number): ApiOriginState {
  let s = state;
  for (let i = 0; i < times; i += 1) s = onControlPlaneFailure(s, err);
  return s;
}

const NETWORK_ERR = new TypeError('Failed to fetch');
const HTTP_ERR = new Error('Registration HTTP 429 SCREEN_REGISTER_RATE_LIMITED — slow down');

describe('isNetworkClassFailure', () => {
  it('classifies every engine\'s transport failure as network', () => {
    // Chromium / Android WebView
    expect(isNetworkClassFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkClassFailure(new Error('net::ERR_CERT_AUTHORITY_INVALID'))).toBe(true);
    // WebKit / Safari + iOS
    expect(isNetworkClassFailure(new Error('Load failed'))).toBe(true);
    expect(isNetworkClassFailure(new Error('The network connection was lost.'))).toBe(true);
    // Firefox
    expect(
      isNetworkClassFailure(new Error('NetworkError when attempting to fetch resource.')),
    ).toBe(true);
    // TLS / DNS wording seen on OEM WebViews
    expect(isNetworkClassFailure(new Error('SSL handshake failed'))).toBe(true);
    expect(isNetworkClassFailure(new Error('getaddrinfo ENOTFOUND api.example.com'))).toBe(true);
    // Our own bounded-fetch deadline (fetchTimeout.ts) aborts.
    const abort = new Error('The operation was aborted.');
    abort.name = 'AbortError';
    expect(isNetworkClassFailure(abort)).toBe(true);
  });

  it('NEVER classifies an HTTP status failure as network — the API answered', () => {
    expect(isNetworkClassFailure(HTTP_ERR)).toBe(false);
    expect(isNetworkClassFailure(new Error('Registration HTTP 500'))).toBe(false);
    expect(isNetworkClassFailure(new Error('Manifest HTTP 401'))).toBe(false);
    // Even wording that would otherwise match, once a status is present.
    expect(isNetworkClassFailure(new Error('Registration HTTP 504 — gateway timeout'))).toBe(false);
  });

  it('is conservative about anything it cannot classify', () => {
    expect(isNetworkClassFailure(null)).toBe(false);
    expect(isNetworkClassFailure(undefined)).toBe(false);
    expect(isNetworkClassFailure(new Error('Registration returned an empty body'))).toBe(false);
    expect(isNetworkClassFailure({})).toBe(false);
  });
});

describe('the switch to the gateway', () => {
  it('takes exactly N consecutive network failures', () => {
    expect(DIRECT_FAILURES_BEFORE_GATEWAY).toBe(3);
    let s = initialApiOriginState(false);
    expect(failureThreshold(s)).toBe(3);

    s = fail(s, NETWORK_ERR, 2);
    expect(s.mode).toBe('direct');
    expect(s.networkFailures).toBe(2);

    s = onControlPlaneFailure(s, NETWORK_ERR);
    expect(s.mode).toBe('gateway');
    expect(s.persistedFallback).toBe(true);
  });

  it('never happens on HTTP failures, however many', () => {
    const s = fail(initialApiOriginState(false), HTTP_ERR, 25);
    expect(s.mode).toBe('direct');
    expect(s.persistedFallback).toBe(false);
  });

  it('an HTTP failure BREAKS a run of network failures (they must be consecutive)', () => {
    let s = fail(initialApiOriginState(false), NETWORK_ERR, 2);
    s = onControlPlaneFailure(s, HTTP_ERR); // API reachable again
    expect(s.networkFailures).toBe(0);
    s = onControlPlaneFailure(s, NETWORK_ERR);
    expect(s.mode).toBe('direct'); // count restarted, no switch
  });

  it('a success BREAKS a run too', () => {
    let s = fail(initialApiOriginState(false), NETWORK_ERR, 2);
    s = onControlPlaneSuccess(s);
    expect(s.networkFailures).toBe(0);
    s = fail(s, NETWORK_ERR, 2);
    expect(s.mode).toBe('direct');
  });

  it('never flaps back to direct mid-session once on the gateway', () => {
    let s = fail(initialApiOriginState(false), NETWORK_ERR, 3);
    expect(s.mode).toBe('gateway');
    s = fail(s, NETWORK_ERR, 10);
    expect(s.mode).toBe('gateway');
    s = onControlPlaneSuccess(s);
    expect(s.mode).toBe('gateway');
    expect(s.persistedFallback).toBe(true);
  });
});

describe('boot behaviour + self-heal', () => {
  it('ALWAYS boots on direct, even with a persisted fallback (the re-probe)', () => {
    const s = initialApiOriginState(true);
    expect(s.mode).toBe('direct');
    expect(s.persistedFallback).toBe(true);
  });

  it('a device with a known-bad direct path switches on the FIRST failure', () => {
    const s = initialApiOriginState(true);
    expect(failureThreshold(s)).toBe(1);
    expect(onControlPlaneFailure(s, NETWORK_ERR).mode).toBe('gateway');
  });

  it('a direct success DROPS the persisted fallback — the device self-heals', () => {
    const healed = onControlPlaneSuccess(initialApiOriginState(true));
    expect(healed.mode).toBe('direct');
    expect(healed.persistedFallback).toBe(false);
    // …and it is back on the generous 3-failure threshold.
    expect(failureThreshold(healed)).toBe(3);
  });

  it('a gateway success does NOT clear the suspicion (direct was never retried)', () => {
    const s = onControlPlaneSuccess(fail(initialApiOriginState(false), NETWORK_ERR, 3));
    expect(s.persistedFallback).toBe(true);
  });
});

describe('persistence', () => {
  function memStorage() {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
  }

  it('round-trips the flag', () => {
    const s = memStorage();
    expect(readPersistedFallback(s)).toBe(false);
    writePersistedFallback(s, true);
    expect(s.map.get(GATEWAY_FALLBACK_STORAGE_KEY)).toBe('1');
    expect(readPersistedFallback(s)).toBe(true);
    writePersistedFallback(s, false);
    expect(readPersistedFallback(s)).toBe(false);
  });

  it('survives unusable storage (private mode / partitioned WebView)', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(readPersistedFallback(broken)).toBe(false);
    expect(() => writePersistedFallback(broken, true)).not.toThrow();
    expect(readPersistedFallback(null)).toBe(false);
    expect(() => writePersistedFallback(null, true)).not.toThrow();
  });
});
