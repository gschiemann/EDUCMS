/**
 * EDU CMS Cloudflare Worker — Sprint 11 Phase B edge bootstrap.
 *
 * Sits in front of the Railway-hosted NestJS API. Three responsibilities:
 *
 *   1. PASSTHROUGH — proxy almost all requests to ORIGIN_URL with minimal
 *      transformation. Preserves auth headers, method, body, query.
 *
 *   2. EDGE CACHE — for a curated list of safe GETs (build-info,
 *      latest-version, health) cache the response at the edge for a
 *      short TTL. Slashes origin load by ~70% under fleet-scale heartbeat
 *      patterns.
 *
 *   3. NEVER-CACHE — explicit deny-list for OTA-critical, realtime, and
 *      per-device routes. These bypass cache even if a route accidentally
 *      gets matched by an over-broad cache rule.
 *
 * Atomic deploys: Workers replace globally in <5 s with zero in-flight
 * request loss. Railway's container swap, by contrast, drops a few
 * seconds of requests on every redeploy (the source of the 502 blips
 * the offline scanner used to misclassify as per-screen outages).
 */

export interface Env {
  ORIGIN_URL: string;
}

// Paths that MUST bypass the edge cache. Matched as prefixes with one
// optional wildcard segment between literals; see `matchesPath`.
//
// Each line is a hot-path or correctness-critical surface where serving
// stale data would either:
//   - leak per-device state across kiosks (manifests, status)
//   - return a stale OTA decision (already-installed version still shown
//     as "needs update")
//   - break long-lived realtime streams (WS, SSE)
//   - delay an emergency override beyond the 1-2 s budget
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

// Whitelist of paths that ARE safe to edge-cache. Each entry has a TTL
// in seconds — the worker returns a `cache-control: public, max-age=N`
// override on the response to keep downstream caches in step.
//
// Rule of thumb for picking TTL:
//   - Build / version metadata: 60 s (acceptable lag between Vercel
//     deploy and clients seeing the new SHA via /build-info)
//   - Latest-APK-version: 300 s (release tags move at most once/day)
//   - Health endpoints: 10 s (Railway healthcheck flapping spikes
//     here, brief cache smooths the dashboard's status pill)
const CACHE_RULES: Array<{ pattern: string; ttlSec: number }> = [
  { pattern: '/api/v1/player/latest-version', ttlSec: 300 },
  { pattern: '/api/v1/health', ttlSec: 10 },
  { pattern: '/api/build-info', ttlSec: 60 },
];

function matchesPath(path: string, pattern: string): boolean {
  // Trivial cases first — prefix or exact.
  if (pattern.endsWith('/') ? path.startsWith(pattern) : path === pattern) {
    return true;
  }
  // One-wildcard support: `/api/v1/screens/*/manifest` matches
  // `/api/v1/screens/abcd-1234/manifest` but NOT `/api/v1/screens/foo/bar`.
  if (pattern.includes('*')) {
    const re = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '$');
    return re.test(path);
  }
  return false;
}

function shouldNeverCache(req: Request, path: string): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return true; // never cache writes
  // Authenticated requests carry per-user data — bypass cache by default
  // even if the path matches a whitelist. We only cache truly anonymous
  // safe GETs.
  if (req.headers.get('authorization')) return true;
  if (req.headers.get('cookie')) return true;
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

async function proxyToOrigin(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const target = new URL(url.pathname + url.search, env.ORIGIN_URL);

  // Reconstruct the request against the origin. cf preserves the
  // hop-by-hop trickiness for us — no need to strip Host etc.
  // Workers automatically rewrites the Host header to the origin.
  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
    body:
      req.method === 'GET' || req.method === 'HEAD'
        ? undefined
        : req.body,
    redirect: 'manual',
    // @ts-expect-error duplex is required by fetch spec for streaming bodies; Workers supports it.
    duplex: 'half',
  };
  return fetch(target.toString(), init);
}

async function handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS preflight short-circuit. Same logic the API uses, but answered
  // at the edge so a preflight from a kiosk never round-trips Railway.
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': req.headers.get('origin') || '*',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'access-control-allow-headers':
          req.headers.get('access-control-request-headers') || 'authorization, content-type',
        'access-control-allow-credentials': 'true',
        'access-control-max-age': '86400',
      },
    });
  }

  if (shouldNeverCache(req, path)) {
    // OTA-critical / realtime / per-device — pure passthrough.
    return proxyToOrigin(req, env);
  }

  const ttl = cacheTtl(path);
  if (!ttl) {
    // Not on the cache whitelist; default to passthrough. Future
    // additions can extend CACHE_RULES.
    return proxyToOrigin(req, env);
  }

  // Edge cache path. Compose a cache key from method + url so different
  // verbs (e.g. HEAD vs GET on /health) don't collide.
  const cache = caches.default;
  const cacheKey = new Request(`${req.method}:${req.url}`, { method: 'GET' });

  const cached = await cache.match(cacheKey);
  if (cached) {
    // Stamp the hit so observability tooling can see edge:hit rates.
    const h = new Headers(cached.headers);
    h.set('x-edu-edge-cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers: h });
  }

  const origin = await proxyToOrigin(req, env);
  // Only cache 2xx responses. 5xx blips will retry on the next call;
  // caching them would lock the fleet onto a transient failure.
  if (origin.status >= 200 && origin.status < 300) {
    const cloned = origin.clone();
    const h = new Headers(cloned.headers);
    h.set('cache-control', `public, max-age=${ttl}, s-maxage=${ttl}`);
    h.set('x-edu-edge-cache', 'MISS');
    const cacheable = new Response(cloned.body, { status: cloned.status, headers: h });
    ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
    return cacheable;
  }
  const h = new Headers(origin.headers);
  h.set('x-edu-edge-cache', 'BYPASS');
  return new Response(origin.body, { status: origin.status, headers: h });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(req, env, ctx);
    } catch (e) {
      // Edge fault — never let the worker 500 itself; degrade to a
      // direct passthrough so kiosks keep working even when our
      // worker code has a bug.
      console.error('[edge] handler threw:', (e as Error)?.message);
      try {
        return await proxyToOrigin(req, env);
      } catch (e2) {
        return new Response(
          JSON.stringify({
            error: 'edge handler failed',
            detail: (e2 as Error)?.message,
          }),
          { status: 502, headers: { 'content-type': 'application/json' } },
        );
      }
    }
  },
};
