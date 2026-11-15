import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DIRECT_FAILURES_BEFORE_GATEWAY,
  DIRECT_PROOF_FRESH_MS,
  GATEWAY_FALLBACK_STORAGE_KEY,
  MAX_FAILED_HEALS_PER_SESSION,
  MIN_GATEWAY_DWELL_MS,
  failureThreshold,
  gatewayApiRoot,
  initialApiOriginState,
  isNetworkClassFailure,
  onControlPlaneFailure,
  onControlPlaneSuccess,
  onDirectOriginProven,
  pushProvesDirect,
  readPersistedFallback,
  writePersistedFallback,
  type ApiOriginState,
} from '../apiOrigin';
import { normalizeApiRoot } from '../trustGuards';

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

/**
 * 2026-11-15 (cost audit) - THE WAY BACK, MID-SESSION.
 *
 * Until this date the only way off the gateway was the single probe a boot
 * makes. 27% of all screen traffic was reaching the API through Vercel, on a
 * fleet where the gateway exists for a handful of units. These tests pin the
 * properties that make the return safe:
 *
 *   1. Only INDEPENDENT proof of the direct origin moves the mode - never an
 *      HTTP outcome on the gateway (the test above still holds).
 *   2. The return is a PROBE, not a verdict: the suspicion stays set, so one
 *      failed direct request goes straight back to the gateway.
 *   3. It waits out a dwell, so the outage that caused the switch can end.
 *   4. A device the proof is wrong about stops being offered the return
 *      after a small budget; a device it is right about never runs out.
 */
describe('the way back to direct, mid-session', () => {
  const T0 = 1_000_000;
  /** On the gateway since T0, entered the ordinary way. */
  const onGateway = (): ApiOriginState => {
    let s = initialApiOriginState(false);
    s = onControlPlaneFailure(s, NETWORK_ERR, T0 - 2);
    s = onControlPlaneFailure(s, NETWORK_ERR, T0 - 1);
    s = onControlPlaneFailure(s, NETWORK_ERR, T0);
    expect(s.mode).toBe('gateway');
    expect(s.gatewaySinceMs).toBe(T0);
    return s;
  };
  const AFTER_DWELL = T0 + MIN_GATEWAY_DWELL_MS;

  it('does nothing on direct - same object, so the caller sees no transition', () => {
    const s = initialApiOriginState(false);
    expect(onDirectOriginProven(s, T0)).toBe(s);
    const suspicious = initialApiOriginState(true);
    expect(onDirectOriginProven(suspicious, T0)).toBe(suspicious);
  });

  it('waits out the dwell: proof one millisecond early changes nothing', () => {
    const s = onGateway();
    expect(onDirectOriginProven(s, T0)).toBe(s);
    expect(onDirectOriginProven(s, AFTER_DWELL - 1)).toBe(s);
  });

  it('after the dwell it returns to direct AS A PROBE: suspicion kept, threshold 1', () => {
    const healed = onDirectOriginProven(onGateway(), AFTER_DWELL);
    expect(healed.mode).toBe('direct');
    expect(healed.persistedFallback).toBe(true);
    expect(healed.healUnproven).toBe(true);
    expect(healed.networkFailures).toBe(0);
    expect(failureThreshold(healed)).toBe(1);
  });

  it('ONE failed direct request after the return goes straight back to the gateway, and is counted', () => {
    const healed = onDirectOriginProven(onGateway(), AFTER_DWELL);
    const back = onControlPlaneFailure(healed, NETWORK_ERR, AFTER_DWELL + 9_000);
    expect(back.mode).toBe('gateway');
    expect(back.persistedFallback).toBe(true);
    expect(back.failedHeals).toBe(1);
    // The dwell starts again from the moment it fell back.
    expect(back.gatewaySinceMs).toBe(AFTER_DWELL + 9_000);
    expect(onDirectOriginProven(back, AFTER_DWELL + 9_000 + MIN_GATEWAY_DWELL_MS - 1)).toBe(back);
  });

  it('ONE successful direct request proves the return and drops the suspicion', () => {
    const healed = onDirectOriginProven(onGateway(), AFTER_DWELL);
    const proven = onControlPlaneSuccess(healed);
    expect(proven.mode).toBe('direct');
    expect(proven.persistedFallback).toBe(false);
    expect(proven.healUnproven).toBeUndefined();
    expect(failureThreshold(proven)).toBe(3);
  });

  it('an HTTP refusal after the return is the API answering - it does not send the screen back', () => {
    const healed = onDirectOriginProven(onGateway(), AFTER_DWELL);
    const s = onControlPlaneFailure(healed, HTTP_ERR, AFTER_DWELL + 1);
    expect(s.mode).toBe('direct');
  });

  it('a device the proof is WRONG about runs out of returns; the gateway is then final for the session', () => {
    let s = onGateway();
    let now = T0;
    for (let i = 0; i < MAX_FAILED_HEALS_PER_SESSION; i += 1) {
      now += MIN_GATEWAY_DWELL_MS;
      s = onDirectOriginProven(s, now);
      expect(s.mode).toBe('direct');
      now += 5_000;
      s = onControlPlaneFailure(s, NETWORK_ERR, now); // the socket works, HTTP does not
      expect(s.mode).toBe('gateway');
    }
    expect(s.failedHeals).toBe(MAX_FAILED_HEALS_PER_SESSION);
    // However long it waits and however alive the socket is.
    expect(onDirectOriginProven(s, now + 100 * MIN_GATEWAY_DWELL_MS)).toBe(s);
    // And gateway traffic keeps the mode, as before.
    expect(onControlPlaneSuccess(s).mode).toBe('gateway');
  });

  it('a device the proof is RIGHT about never runs out, however many outages the day has', () => {
    let s = onGateway();
    let now = T0;
    for (let outage = 0; outage < 25; outage += 1) {
      now += MIN_GATEWAY_DWELL_MS;
      s = onDirectOriginProven(s, now);
      expect(s.mode).toBe('direct');
      s = onControlPlaneSuccess(s); // direct really works
      expect(s.persistedFallback).toBe(false);
      now += 60_000;
      for (let i = 0; i < DIRECT_FAILURES_BEFORE_GATEWAY; i += 1) s = onControlPlaneFailure(s, NETWORK_ERR, now); // next API restart
      expect(s.mode).toBe('gateway');
      expect(s.failedHeals).toBeUndefined();
    }
  });

  it('a proven return keeps the count of earlier failed ones (the budget is per session)', () => {
    let s = onDirectOriginProven(onGateway(), AFTER_DWELL);
    s = onControlPlaneFailure(s, NETWORK_ERR, AFTER_DWELL + 1); // failed heal #1
    s = onDirectOriginProven(s, AFTER_DWELL + 1 + MIN_GATEWAY_DWELL_MS);
    s = onControlPlaneSuccess(s); // this one took
    expect(s.mode).toBe('direct');
    expect(s.failedHeals).toBe(1);
  });

  it('a state that reached the gateway without a clock starts its dwell at the first proof', () => {
    let s = initialApiOriginState(false);
    for (let i = 0; i < DIRECT_FAILURES_BEFORE_GATEWAY; i += 1) s = onControlPlaneFailure(s, NETWORK_ERR);
    expect(s.mode).toBe('gateway');
    expect(s.gatewaySinceMs).toBeUndefined();
    const started = onDirectOriginProven(s, 50_000);
    expect(started.mode).toBe('gateway');
    expect(started.gatewaySinceMs).toBe(50_000);
    expect(onDirectOriginProven(started, 50_000 + MIN_GATEWAY_DWELL_MS).mode).toBe('direct');
  });

  it('refuses a clock that is not a finite number', () => {
    const s = onGateway();
    expect(onDirectOriginProven(s, Number.NaN)).toBe(s);
    expect(onDirectOriginProven(s, Number.POSITIVE_INFINITY)).toBe(s);
    expect(onDirectOriginProven(s, undefined as unknown as number)).toBe(s);
  });

  describe('pushProvesDirect - what counts as proof', () => {
    const alive = { open: true, authOk: true, sinceLastMessageMs: 4_000 };
    it('an open, AUTHENTICATED socket heard from recently is proof', () => {
      expect(pushProvesDirect(alive)).toBe(true);
      expect(pushProvesDirect({ ...alive, sinceLastMessageMs: DIRECT_PROOF_FRESH_MS })).toBe(true);
    });
    it('a TCP open without AUTH_OK is not (player rule 5)', () => {
      expect(pushProvesDirect({ ...alive, authOk: false })).toBe(false);
    });
    it('a socket that is not open is not', () => {
      expect(pushProvesDirect({ ...alive, open: false })).toBe(false);
    });
    it('a silent socket is not - nor is a nonsense age', () => {
      expect(pushProvesDirect({ ...alive, sinceLastMessageMs: DIRECT_PROOF_FRESH_MS + 1 })).toBe(false);
      expect(pushProvesDirect({ ...alive, sinceLastMessageMs: Number.POSITIVE_INFINITY })).toBe(false);
      expect(pushProvesDirect({ ...alive, sinceLastMessageMs: Number.NaN })).toBe(false);
      expect(pushProvesDirect({ ...alive, sinceLastMessageMs: -1 })).toBe(false);
    });
  });

  describe('player/page.tsx - the wiring (source-text guards)', () => {
    const src = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8');
    const fnBody = (signature: string) => {
      const start = src.indexOf(signature);
      expect(start).toBeGreaterThan(-1);
      const end = src.indexOf('\n}\n', start);
      expect(end).toBeGreaterThan(start);
      return src.slice(start, end);
    };

    it('the fallback is stamped with the monotonic clock the dwell is measured on', () => {
      expect(fnBody('function noteControlPlaneFailure(')).toContain('onControlPlaneFailure(before, err, originClockMs())');
      expect(fnBody('function noteDirectOriginProven(')).toContain('onDirectOriginProven(before, originClockMs())');
      expect(fnBody('function originClockMs(')).toContain('performance.now()');
    });

    it('the return never clears the persisted suspicion itself - only a direct success does', () => {
      const heal = fnBody('function noteDirectOriginProven(');
      expect(heal).not.toContain('writePersistedFallback');
      expect(fnBody('function noteControlPlaneSuccess(')).toContain('writePersistedFallback(playerLocalStorage(), false)');
    });

    it('the proof is offered from ONE place, the socket supervisor, and only behind pushProvesDirect', () => {
      const calls = src.split('noteDirectOriginProven();').length - 1;
      expect(calls).toBe(1);
      const at = src.indexOf('noteDirectOriginProven();');
      const gate = src.lastIndexOf('pushProvesDirect({', at);
      expect(gate).toBeGreaterThan(-1);
      const between = src.slice(gate, at);
      expect(between).toContain('authOk: wsAuthOkRef.current');
      expect(between).toContain('open: state === WebSocket.OPEN');
      // Nothing but the gate's own arguments and a comment between the two.
      expect(between.split('\n').length).toBeLessThan(14);
      // ...and it sits inside the supervisor tick.
      const supervise = src.lastIndexOf('const supervise = () => {', at);
      const tickArmed = src.indexOf('wsSupervisorRef.current = setInterval(supervise, WS_SUPERVISOR_TICK_MS);', at);
      expect(supervise).toBeGreaterThan(-1);
      expect(tickArmed).toBeGreaterThan(at);
      expect(src.slice(supervise, at)).not.toContain('wsSupervisorRef.current = setInterval(');
    });

    it('the socket that supplies the proof dials the DIRECT origin (it would prove nothing otherwise)', () => {
      const dial = src.match(/const wsUrl = ([^\n]+)/);
      expect(dial).not.toBeNull();
      expect(dial![1]).toContain('getDirectApiRoot()');
    });
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

/**
 * 2026-09-08 REGRESSION — "the mode said gateway, the traffic never moved".
 *
 * `getApiRoot()` resolved the gateway root by handing the page origin to
 * `normalizeApiRoot`, the guard written for the `?api=` OVERRIDE. That guard
 * refuses `http:` outside development (R-01), so on a PRODUCTION BUNDLE served
 * over plaintext it returned null, `getApiRoot()` fell through to the direct
 * root, and the player logged "switching the control plane to the same-origin
 * gateway" while sending every subsequent request to the origin it had just
 * declared dead. Caught the day the E2E suite started serving a real
 * `next build` instead of `next dev`: both gateway specs failed with the mode
 * flipped, zero gateway registers and zero gateway manifests. It reaches any
 * plaintext install, an on-prem/LAN player included.
 *
 * These pin BOTH halves: the page origin is usable whatever its scheme, and
 * the allowlist gains nothing in the process.
 */
describe('gatewayApiRoot — the page origin is the anchor, not an override', () => {
  /** The shape `apiRootPolicy()` produces from a real production bundle. */
  const PROD_OVERRIDE_POLICY = {
    envApiUrl: 'https://api.example.com/api/v1',
    extraHosts: null,
    pageOrigin: 'http://localhost:3000',
    isProduction: true,
  };

  it('accepts an https page origin', () => {
    expect(gatewayApiRoot('https://venue-os.app')).toBe('https://venue-os.app');
  });

  it('accepts an http page origin under a PRODUCTION build — the regression itself', () => {
    // The override guard refuses this by design: it protects against a host
    // SOMEONE ELSE chose. The page origin is the host already running this
    // code, so that veto only ever stranded the fallback.
    expect(normalizeApiRoot('http://localhost:3000', PROD_OVERRIDE_POLICY)).toBeNull();
    expect(gatewayApiRoot('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('accepts a plaintext LAN origin — the on-prem shape, not just loopback', () => {
    // `normalizeApiRoot` refuses non-loopback http even in development, so
    // routing through it stranded an on-prem player too, not just the tests.
    expect(
      normalizeApiRoot('http://192.168.1.50:3000', {
        ...PROD_OVERRIDE_POLICY,
        pageOrigin: 'http://192.168.1.50:3000',
        isProduction: false,
      }),
    ).toBeNull();
    expect(gatewayApiRoot('http://192.168.1.50:3000')).toBe('http://192.168.1.50:3000');
  });

  it('can only ever name the origin it was given — no allowlist to widen', () => {
    // There is no policy input at all: the sole call site passes
    // window.location.origin, so the result is that origin or null. It can
    // never resolve to the env API host or to any configured extra host.
    for (const origin of ['https://venue-os.app', 'https://a.example:8443', 'http://box.local:3000']) {
      expect(gatewayApiRoot(origin)).toBe(origin);
    }
  });

  it('still refuses everything that is not an http(s) origin', () => {
    expect(gatewayApiRoot(null)).toBeNull();
    expect(gatewayApiRoot(undefined)).toBeNull();
    expect(gatewayApiRoot('')).toBeNull();
    expect(gatewayApiRoot('   ')).toBeNull();
    // An opaque (sandboxed / data:) document reports the literal string "null".
    expect(gatewayApiRoot('null')).toBeNull();
    expect(gatewayApiRoot('file:///player')).toBeNull();
    expect(gatewayApiRoot('javascript:alert(1)')).toBeNull();
    expect(gatewayApiRoot('ws://venue-os.app')).toBeNull();
    expect(gatewayApiRoot('/player')).toBeNull();
    // Embedded credentials would be replayed on every control-plane call.
    expect(gatewayApiRoot('https://u:p@venue-os.app')).toBeNull();
  });

  it('normalizes like the override path (fragment, trailing slash, /api/v1)', () => {
    expect(gatewayApiRoot('https://venue-os.app/api/v1')).toBe('https://venue-os.app');
    expect(gatewayApiRoot('https://venue-os.app/')).toBe('https://venue-os.app');
    expect(gatewayApiRoot('https://venue-os.app/#@evil.example')).toBe('https://venue-os.app');
    expect(gatewayApiRoot('https://venue-os.app/?api=https://evil.example')).toBe('https://venue-os.app');
  });
});
