import {
  API_ROOT_STORAGE_KEY,
  DEVICE_TOKEN_STORAGE_KEY,
  allowedApiHosts,
  hostMatches,
  isPlausibleDeviceToken,
  normalizeApiRoot,
  resolveApiRoot,
  resolveDeviceToken,
  type ApiRootPolicy,
} from '../trustGuards';

/**
 * R-01 — the player's API root is its ENTIRE trust anchor (WebSocket, SSE,
 * the device-authenticated manifest that solely arbitrates the lockdown
 * overlay, and the stranded-alert reconcile). It used to be repointable by an
 * unvalidated `?api=` query param that persisted to localStorage forever.
 */

function memStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

const PROD: ApiRootPolicy = {
  envApiUrl: 'https://api-production-39a1.up.railway.app/api/v1',
  extraHosts: null,
  pageOrigin: 'https://venue-os.app',
  isProduction: true,
};
const DEV: ApiRootPolicy = {
  envApiUrl: 'http://localhost:8080/api/v1',
  extraHosts: null,
  pageOrigin: 'http://localhost:3000',
  isProduction: false,
};
const FALLBACK = 'https://api-production-39a1.up.railway.app';

describe('hostMatches — dot-boundary suffix, never includes()/startsWith()', () => {
  it('accepts exact host and real subdomains', () => {
    expect(hostMatches('venue-os.app', 'venue-os.app')).toBe(true);
    expect(hostMatches('api.venue-os.app', 'venue-os.app')).toBe(true);
    expect(hostMatches('a.b.venue-os.app', 'venue-os.app')).toBe(true);
  });

  it('THE ATTACK: a lookalike that only shares a PREFIX is rejected', () => {
    // `includes()` / `startsWith()` would both accept these.
    expect(hostMatches('venue-os.app.evil.com', 'venue-os.app')).toBe(false);
    expect(hostMatches('venue-os.appevil.com', 'venue-os.app')).toBe(false);
    expect(hostMatches('evil-venue-os.app', 'venue-os.app')).toBe(false);
    expect(hostMatches('xvenue-os.app', 'venue-os.app')).toBe(false);
  });
});

describe('allowedApiHosts', () => {
  it('derives from NEXT_PUBLIC_API_URL, the page origin, extras and the built-ins', () => {
    const hosts = allowedApiHosts({
      ...PROD,
      extraHosts: 'staging.venue-os.app, https://onprem.district.k12.us/api/v1',
    });
    expect(hosts).toContain('api-production-39a1.up.railway.app');
    expect(hosts).toContain('venue-os.app');
    expect(hosts).toContain('staging.venue-os.app');
    expect(hosts).toContain('onprem.district.k12.us');
    expect(hosts).not.toContain('evil.example');
  });
});

describe('normalizeApiRoot', () => {
  it('accepts a valid https override on an allowlisted host and strips /api/v1', () => {
    expect(normalizeApiRoot('https://api-production-39a1.up.railway.app/api/v1', PROD))
      .toBe('https://api-production-39a1.up.railway.app');
    expect(normalizeApiRoot('https://venue-os.app/api/v1/', PROD))
      .toBe('https://venue-os.app');
    expect(normalizeApiRoot('https://api.venue-os.app', PROD))
      .toBe('https://api.venue-os.app');
  });

  it('REJECTS http:// (plaintext) even on an allowlisted host', () => {
    expect(normalizeApiRoot('http://api-production-39a1.up.railway.app/api/v1', PROD)).toBeNull();
    expect(normalizeApiRoot('http://venue-os.app', PROD)).toBeNull();
  });

  it('REJECTS an unknown host', () => {
    expect(normalizeApiRoot('https://evil.example', PROD)).toBeNull();
    expect(normalizeApiRoot('https://evil.example/api/v1', PROD)).toBeNull();
  });

  it('THE ATTACK: rejects `venue-os.app.evil.com` (prefix lookalike)', () => {
    expect(normalizeApiRoot('https://venue-os.app.evil.com', PROD)).toBeNull();
    expect(normalizeApiRoot('https://api-production-39a1.up.railway.app.evil.com', PROD)).toBeNull();
  });

  it('rejects non-http(s) schemes, embedded credentials and unparseable values', () => {
    expect(normalizeApiRoot('ws://venue-os.app', PROD)).toBeNull();
    expect(normalizeApiRoot('javascript:alert(1)', PROD)).toBeNull();
    expect(normalizeApiRoot('data:text/html,<script>', PROD)).toBeNull();
    expect(normalizeApiRoot('file:///etc/passwd', PROD)).toBeNull();
    expect(normalizeApiRoot('https://user:pass@venue-os.app', PROD)).toBeNull();
    expect(normalizeApiRoot('//evil.example', PROD)).toBeNull();
    expect(normalizeApiRoot('/api/v1', PROD)).toBeNull();
    expect(normalizeApiRoot('', PROD)).toBeNull();
    expect(normalizeApiRoot(null, PROD)).toBeNull();
    expect(normalizeApiRoot(42, PROD)).toBeNull();
  });

  it('strips query + fragment so a decorated URL cannot smuggle anything through', () => {
    expect(normalizeApiRoot('https://venue-os.app/api/v1?x=1#@evil.example', PROD))
      .toBe('https://venue-os.app');
  });

  it('allows http://localhost ONLY outside production', () => {
    expect(normalizeApiRoot('http://localhost:8080/api/v1', DEV)).toBe('http://localhost:8080');
    expect(normalizeApiRoot('http://127.0.0.1:8080', DEV)).toBe('http://127.0.0.1:8080');
    expect(normalizeApiRoot('http://localhost:8080/api/v1', PROD)).toBeNull();
    expect(normalizeApiRoot('http://127.0.0.1:8080', PROD)).toBeNull();
  });
});

describe('resolveApiRoot — the full ?api= → localStorage → env read path', () => {
  it('accepts and persists a valid override', () => {
    const s = memStorage();
    const got = resolveApiRoot({
      search: '?api=https://api-production-39a1.up.railway.app/api/v1',
      policy: PROD, storage: s, fallback: FALLBACK,
    });
    expect(got).toBe('https://api-production-39a1.up.railway.app');
    expect(s.map.get(API_ROOT_STORAGE_KEY)).toBe('https://api-production-39a1.up.railway.app');
  });

  it('IGNORES an attacker override and never persists it', () => {
    const s = memStorage();
    const rejected: string[] = [];
    const got = resolveApiRoot({
      search: '?api=https://evil.example',
      policy: PROD, storage: s, fallback: FALLBACK,
      onReject: (reason) => rejected.push(reason),
    });
    expect(got).toBe(FALLBACK);
    expect(s.map.has(API_ROOT_STORAGE_KEY)).toBe(false);
    expect(rejected).toContain('untrusted-api-param');
  });

  it('IGNORES an http:// override and a `venue-os.app.evil.com` override', () => {
    for (const bad of ['http://venue-os.app', 'https://venue-os.app.evil.com']) {
      const s = memStorage();
      expect(resolveApiRoot({
        search: `?api=${bad}`, policy: PROD, storage: s, fallback: FALLBACK,
      })).toBe(FALLBACK);
      expect(s.map.has(API_ROOT_STORAGE_KEY)).toBe(false);
    }
  });

  it('SELF-HEAL: a previously-poisoned localStorage value is ignored AND cleared', () => {
    const s = memStorage({ [API_ROOT_STORAGE_KEY]: 'https://evil.example' });
    const rejected: string[] = [];
    const got = resolveApiRoot({
      search: '', policy: PROD, storage: s, fallback: FALLBACK,
      onReject: (reason) => rejected.push(reason),
    });
    expect(got).toBe(FALLBACK);
    expect(s.map.has(API_ROOT_STORAGE_KEY)).toBe(false); // cleared, not just ignored
    expect(rejected).toContain('untrusted-stored-api-root');
  });

  it('a bad ?api= does NOT clobber a good stored value', () => {
    const s = memStorage({ [API_ROOT_STORAGE_KEY]: 'https://venue-os.app' });
    expect(resolveApiRoot({
      search: '?api=https://evil.example', policy: PROD, storage: s, fallback: FALLBACK,
    })).toBe('https://venue-os.app');
    expect(s.map.get(API_ROOT_STORAGE_KEY)).toBe('https://venue-os.app');
  });

  it('keeps a legitimate stored value across loads', () => {
    const s = memStorage({ [API_ROOT_STORAGE_KEY]: 'https://api-production-39a1.up.railway.app' });
    expect(resolveApiRoot({ search: '', policy: PROD, storage: s, fallback: FALLBACK }))
      .toBe('https://api-production-39a1.up.railway.app');
  });

  it('falls back to the env root when storage is unavailable', () => {
    expect(resolveApiRoot({ search: '', policy: PROD, storage: null, fallback: FALLBACK }))
      .toBe(FALLBACK);
  });
});

describe('device token hygiene (R-01 adjacent — same "persist whatever the URL says" shape)', () => {
  const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzY3JuLTEifQ.c2ln-bmF0dXJl_x';

  it('accepts a JWT and the dev_ token form', () => {
    expect(isPlausibleDeviceToken(JWT)).toBe(true);
    expect(isPlausibleDeviceToken('dev_screen-123_tenant-456')).toBe(true);
  });

  it('rejects junk: whitespace, markup, newlines and absurd length', () => {
    expect(isPlausibleDeviceToken('has space')).toBe(false);
    expect(isPlausibleDeviceToken('<script>alert(1)</script>')).toBe(false);
    expect(isPlausibleDeviceToken('abc\ndef')).toBe(false);
    expect(isPlausibleDeviceToken('a'.repeat(5000))).toBe(false);
    expect(isPlausibleDeviceToken('')).toBe(false);
    expect(isPlausibleDeviceToken(null)).toBe(false);
  });

  it('persists a well-formed ?token= and refuses a malformed one', () => {
    const ok = memStorage();
    expect(resolveDeviceToken({ search: `?token=${JWT}`, storage: ok })).toBe(JWT);
    expect(ok.map.get(DEVICE_TOKEN_STORAGE_KEY)).toBe(JWT);

    const bad = memStorage();
    expect(resolveDeviceToken({ search: '?token=has%20space', storage: bad })).toBeNull();
    expect(bad.map.has(DEVICE_TOKEN_STORAGE_KEY)).toBe(false);
  });

  it('SELF-HEAL: a malformed stored token is ignored AND cleared', () => {
    const s = memStorage({ [DEVICE_TOKEN_STORAGE_KEY]: '<script>x</script>' });
    expect(resolveDeviceToken({ search: '', storage: s })).toBeNull();
    expect(s.map.has(DEVICE_TOKEN_STORAGE_KEY)).toBe(false);
  });

  it('a real stored token still round-trips (no regression for paired kiosks)', () => {
    const s = memStorage({ [DEVICE_TOKEN_STORAGE_KEY]: JWT });
    expect(resolveDeviceToken({ search: '', storage: s })).toBe(JWT);
  });

  // ── W1-12 (2026-08-30): stored-wins precedence — the downgrade-loop killer ──
  describe('stored token wins over a shell-injected ?token=', () => {
    const STALE_NATIVE = 'eyJOLD.eyJmossil.native';

    it('THE FLEET BUG: a stale native URL token can no longer clobber the fresh stored one', () => {
      const s = memStorage({ [DEVICE_TOKEN_STORAGE_KEY]: JWT });
      expect(resolveDeviceToken({ search: `?token=${STALE_NATIVE}`, storage: s })).toBe(JWT);
      // storage untouched — repeated resolution (getDeviceToken on every
      // call site) must not re-poison it either
      expect(s.map.get(DEVICE_TOKEN_STORAGE_KEY)).toBe(JWT);
    });

    it('URL token still bootstraps a device with EMPTY storage (fresh install / cleared WebView data)', () => {
      const s = memStorage();
      expect(resolveDeviceToken({ search: `?token=${JWT}`, storage: s })).toBe(JWT);
      expect(s.map.get(DEVICE_TOKEN_STORAGE_KEY)).toBe(JWT);
    });

    it('a malformed stored token self-heals and falls through to a valid URL token', () => {
      const s = memStorage({ [DEVICE_TOKEN_STORAGE_KEY]: '<junk>' });
      expect(resolveDeviceToken({ search: `?token=${JWT}`, storage: s })).toBe(JWT);
      expect(s.map.get(DEVICE_TOKEN_STORAGE_KEY)).toBe(JWT);
    });

    it('B-P1-5: unreadable storage STILL adopts a URL token in memory — it is the only credential there is', () => {
      const broken = {
        getItem: () => { throw new Error('sandboxed'); },
        setItem: () => { throw new Error('sandboxed'); },
        removeItem: () => { throw new Error('sandboxed'); },
      };
      // The shell injected it; storage being hostile must not strand the
      // screen with NO credential. Persisting fails silently; every
      // getDeviceToken() re-resolves from the URL, which the scrub keeps
      // in place exactly for this runtime (persist read-back guard).
      expect(resolveDeviceToken({ search: `?token=${JWT}`, storage: broken })).toBe(JWT);
    });
  });
});
