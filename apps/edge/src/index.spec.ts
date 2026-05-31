/**
 * Unit-style tests for the path-matching logic in the worker.
 * Pure-function tests; no actual fetch / Workers runtime needed.
 *
 * Run with: cd apps/edge && npx tsx src/index.spec.ts
 * (Workers don't include Jest by default — wrangler ships with Vitest
 * but adding it just for these pure-function tests is overkill.)
 */

// Re-implement the matching logic here to keep the test self-contained
// (importing from index.ts would pull in Workers globals + Env types).
// If the real implementation drifts, this file MUST be updated to match
// — these are spec-tests, not module-import tests.
const NEVER_CACHE_PATTERNS: string[] = [
  '/api/v1/player/update-check',
  '/api/v1/player/apk/',
  '/api/v1/realtime/',
  '/api/v1/screens/status/',
  '/api/v1/screens/*/manifest',
  '/api/v1/emergency/',
  '/api/v1/auth/',
  '/api/v1/sso/',
];
const CACHE_RULES: Array<{ pattern: string; ttlSec: number }> = [
  { pattern: '/api/v1/player/latest-version', ttlSec: 300 },
  { pattern: '/api/v1/health', ttlSec: 10 },
  { pattern: '/api/build-info', ttlSec: 60 },
];
function matchesPath(path: string, pattern: string): boolean {
  if (pattern.endsWith('/') ? path.startsWith(pattern) : path === pattern) return true;
  if (pattern.includes('*')) {
    const re = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '$');
    return re.test(path);
  }
  return false;
}
function shouldNeverCache(method: string, path: string, headers: Record<string, string>): boolean {
  if (method !== 'GET' && method !== 'HEAD') return true;
  if (headers['authorization']) return true;
  if (headers['cookie']) return true;
  for (const p of NEVER_CACHE_PATTERNS) {
    if (matchesPath(path, p)) return true;
  }
  return false;
}
function cacheTtl(path: string): number | null {
  for (const { pattern, ttlSec } of CACHE_RULES) {
    if (matchesPath(path, pattern)) return ttlSec;
  }
  return null;
}

let ok = 0, fail = 0;
const check = (label: string, cond: boolean) => {
  if (cond) ok++;
  else { fail++; console.log('FAIL:', label); }
};

// Never-cache lock checks.
check('GET /api/v1/player/update-check → never cache', shouldNeverCache('GET', '/api/v1/player/update-check', {}));
check('GET /api/v1/player/apk/v/10056 → never cache', shouldNeverCache('GET', '/api/v1/player/apk/v/10056', {}));
check('GET /api/v1/realtime/sse → never cache', shouldNeverCache('GET', '/api/v1/realtime/sse', {}));
check('GET /api/v1/screens/status/android-123 → never cache', shouldNeverCache('GET', '/api/v1/screens/status/android-123', {}));
check('GET /api/v1/screens/abc-123/manifest → never cache', shouldNeverCache('GET', '/api/v1/screens/abc-123/manifest', {}));
check('GET /api/v1/screens/abc/manifest/foo → NOT manifest pattern', !shouldNeverCache('GET', '/api/v1/screens/abc/manifest/foo', {}));
check('POST /api/v1/anywhere → never cache (writes)', shouldNeverCache('POST', '/api/v1/anything', {}));
check('GET with Authorization header → never cache', shouldNeverCache('GET', '/api/v1/health', { authorization: 'Bearer xxx' }));
check('GET with Cookie → never cache', shouldNeverCache('GET', '/api/v1/health', { cookie: 'session=...' }));

// Whitelist-cache TTL.
check('GET /api/v1/health → ttl 10', cacheTtl('/api/v1/health') === 10);
check('GET /api/v1/player/latest-version → ttl 300', cacheTtl('/api/v1/player/latest-version') === 300);
check('GET /api/build-info → ttl 60', cacheTtl('/api/build-info') === 60);
check('GET /api/v1/screens → no cache rule (null)', cacheTtl('/api/v1/screens') === null);

// Anonymous, non-blacklisted GETs that ARE on the whitelist.
check('anon GET /api/v1/health → cache enabled', !shouldNeverCache('GET', '/api/v1/health', {}));
check('anon GET /api/v1/health ttl=10', cacheTtl('/api/v1/health') === 10);

// Asset CDN path prefix checks.
const CDN_PREFIX = '/cdn/assets/';
check('/cdn/assets/foo.jpg starts with prefix', '/cdn/assets/foo.jpg'.startsWith(CDN_PREFIX));
check('/cdn/assets/ root matches', '/cdn/assets/'.startsWith(CDN_PREFIX));
check('/api/v1/health does NOT match CDN prefix', !'/api/v1/health'.startsWith(CDN_PREFIX));
check('/cdn/other/ does NOT match CDN prefix', !'/cdn/other/'.startsWith(CDN_PREFIX));

// Cache key normalization: strip CDN_PREFIX to get the asset path.
const stripPrefix = (path: string) => path.slice(CDN_PREFIX.length);
check('strip prefix from /cdn/assets/tenant/photo.jpg', stripPrefix('/cdn/assets/tenant/photo.jpg') === 'tenant/photo.jpg');
check('strip prefix from /cdn/assets/a/b/c.png', stripPrefix('/cdn/assets/a/b/c.png') === 'a/b/c.png');

// buildUpstreamUrl logic (mirrored from index.ts).
const buildUpstreamUrl = (path: string, assetOrigin: string): string => {
  const rest = path.slice(CDN_PREFIX.length);
  const base = assetOrigin.replace(/\/+$/, '');
  return `${base}/${rest}`;
};
const ORIGIN = 'https://proj.supabase.co/storage/v1/object/public/assets';
check(
  'buildUpstreamUrl basic path',
  buildUpstreamUrl('/cdn/assets/tid/photo.jpg', ORIGIN) ===
    'https://proj.supabase.co/storage/v1/object/public/assets/tid/photo.jpg',
);
check(
  'buildUpstreamUrl strips trailing slash from origin',
  buildUpstreamUrl('/cdn/assets/a/b.png', ORIGIN + '/') ===
    'https://proj.supabase.co/storage/v1/object/public/assets/a/b.png',
);
check(
  'buildUpstreamUrl deep path',
  buildUpstreamUrl('/cdn/assets/a/b/c/d.mp4', ORIGIN) ===
    'https://proj.supabase.co/storage/v1/object/public/assets/a/b/c/d.mp4',
);

console.log(`${ok}/${ok + fail} pass`);
if (fail > 0) process.exit(1);
