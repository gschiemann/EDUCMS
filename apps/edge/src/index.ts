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
 *   4. ASSET CDN PROXY — `/cdn/assets/<path>` reverse-proxies Supabase
 *      Storage objects and overrides the upstream `no-cache` header with
 *      `Cache-Control: public, max-age=31536000, immutable`. Repeat fetches
 *      of the same path are served entirely from the Cloudflare edge cache
 *      — no egress back to Supabase origin. HTTP Range requests for
 *      video/audio seeking pass through and the full response is also cached
 *      so subsequent range requests can be satisfied from cache.
 *      Set env var ASSET_ORIGIN to your Supabase storage base URL, e.g.
 *        https://<project>.supabase.co/storage/v1/object/public/assets
 *      When ASSET_ORIGIN is unset the /cdn/assets/* routes return 503 with
 *      a plain-text explanation — the rest of the worker is unaffected.
 *
 * Atomic deploys: Workers replace globally in <5 s with zero in-flight
 * request loss. Railway's container swap, by contrast, drops a few
 * seconds of requests on every redeploy (the source of the 502 blips
 * the offline scanner used to misclassify as per-screen outages).
 */

export interface Env {
  ORIGIN_URL: string;
  /**
   * Supabase Storage base URL. Worker matches `/cdn/assets/<rest>` and
   * fetches `${ASSET_ORIGIN}/<rest>` from origin, then stores in
   * Cloudflare Cache with a 1-year immutable header.
   *
   * Example: https://xyzabc.supabase.co/storage/v1/object/public/assets
   *
   * When unset all /cdn/assets/* requests return 503. The worker otherwise
   * operates normally.
   */
  ASSET_ORIGIN?: string;
}

// ---------------------------------------------------------------------------
// Asset CDN path prefix. Incoming request path: /cdn/assets/<rest>
// Upstream path: ${ASSET_ORIGIN}/<rest>
// ---------------------------------------------------------------------------

const CDN_PREFIX = '/cdn/assets/';

// Long cache TTL for immutable assets (Supabase Storage objects are
// content-addressed via UUIDs — they never change in place).
const ASSET_MAX_AGE = 31_536_000; // 1 year in seconds
const ASSET_SWR = 86_400;         // stale-while-revalidate: 1 day

// ---------------------------------------------------------------------------
// API proxy helpers (unchanged from original)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Asset CDN proxy
// ---------------------------------------------------------------------------

/**
 * Build the Cloudflare cache key for an asset request.
 *
 * We deliberately strip the Range header from the cache key because we
 * cache the full object and serve sliced ranges from the cached body.
 * Using the full URL (without Range) means every partial-content client
 * benefits from the same cached blob.
 */
function assetCacheKey(url: URL): Request {
  // Normalize: no query string (Supabase signed URL tokens would make every
  // request a miss). Public-bucket objects don't need a token.
  const keyUrl = `https://edu-cms-asset-cdn/${url.pathname}`;
  return new Request(keyUrl, { method: 'GET' });
}

/**
 * Build the upstream Supabase Storage URL for an asset request.
 *
 * Incoming path: /cdn/assets/<rest>   e.g. /cdn/assets/tenant-id/photo.jpg
 * Upstream URL : ${ASSET_ORIGIN}/<rest>
 */
function buildUpstreamUrl(path: string, assetOrigin: string): string {
  const rest = path.slice(CDN_PREFIX.length); // strip leading /cdn/assets/
  const base = assetOrigin.replace(/\/+$/, '');
  return `${base}/${rest}`;
}

/**
 * Assemble the canonical headers we send on every cached asset response.
 * We override whatever Supabase returned with our own immutable directive.
 */
function buildAssetHeaders(sourceHeaders: Headers, hit: boolean): Headers {
  const out = new Headers();

  // Forward content headers that clients need for correct rendering.
  const forward = [
    'content-type',
    'content-length',
    'content-encoding',
    'etag',
    'last-modified',
    'accept-ranges',
  ];
  for (const h of forward) {
    const v = sourceHeaders.get(h);
    if (v) out.set(h, v);
  }

  // Override the upstream no-cache with a 1-year immutable directive.
  // stale-while-revalidate lets the edge serve stale while it refreshes
  // asynchronously — invisible to the client.
  out.set(
    'cache-control',
    `public, max-age=${ASSET_MAX_AGE}, stale-while-revalidate=${ASSET_SWR}, immutable`,
  );

  // Observability: let ops confirm edge hit/miss at the curl level.
  out.set('x-edu-asset-cache', hit ? 'HIT' : 'MISS');

  // CORS: assets are loaded cross-origin by kiosks and dashboard iframes.
  out.set('access-control-allow-origin', '*');
  out.set('cross-origin-resource-policy', 'cross-origin');

  return out;
}

/**
 * Serve an asset range response from a cached full-body response.
 *
 * Workers Cache API stores full responses. When a client sends a Range
 * header we check the cache for the full object, slice the body bytes,
 * and return 206 — so video seeking works without a Supabase round-trip.
 *
 * Returns null if the range is unsatisfiable (caller should fall through
 * to a normal full-body response instead).
 */
async function serveRangeFromCache(
  cached: Response,
  rangeHeader: string,
): Promise<Response | null> {
  const contentLength = parseInt(cached.headers.get('content-length') || '0', 10);
  if (!contentLength) return null;

  // Only handle single byte ranges of the form "bytes=<start>-[<end>]".
  const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
  if (!m) return null;

  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : contentLength - 1;

  if (start > end || start >= contentLength) {
    // 416 Range Not Satisfiable
    return new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${contentLength}` },
    });
  }

  const clampedEnd = Math.min(end, contentLength - 1);
  const sliceLength = clampedEnd - start + 1;

  // Read the full body from cache and slice.
  const arrayBuffer = await cached.arrayBuffer();
  const slice = arrayBuffer.slice(start, clampedEnd + 1);

  const headers = buildAssetHeaders(cached.headers, true);
  headers.set('content-range', `bytes ${start}-${clampedEnd}/${contentLength}`);
  headers.set('content-length', String(sliceLength));
  headers.delete('accept-ranges'); // re-add cleanly
  headers.set('accept-ranges', 'bytes');

  return new Response(slice, { status: 206, headers });
}

/**
 * Main handler for /cdn/assets/* requests.
 *
 * Flow:
 *   1. Only allow GET / HEAD. Reject everything else with 405.
 *   2. Check Cloudflare Cache API for a cached full response.
 *      - Cache HIT + client wants Range → slice from cached body (206).
 *      - Cache HIT + no Range → return full cached response (200).
 *   3. Cache MISS → fetch from Supabase origin.
 *      - Successful 2xx → store full response in cache with immutable
 *        Cache-Control, then serve (or serve as 206 if Range requested).
 *      - Non-2xx origin → pass through as-is, do NOT cache.
 */
async function handleAsset(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Only GET and HEAD are meaningful for static assets.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }

  if (!env.ASSET_ORIGIN) {
    return new Response(
      'Asset CDN not configured. Set the ASSET_ORIGIN worker variable to your Supabase Storage base URL.',
      { status: 503, headers: { 'content-type': 'text/plain' } },
    );
  }

  const url = new URL(req.url);
  const rangeHeader = req.headers.get('range');
  const cache = caches.default;
  const cacheKey = assetCacheKey(url);

  // ── Cache lookup ──────────────────────────────────────────────────────────

  const cached = await cache.match(cacheKey);
  if (cached) {
    if (rangeHeader) {
      const rangeResp = await serveRangeFromCache(cached, rangeHeader);
      if (rangeResp) return rangeResp;
      // Fall through: unsatisfiable range or missing content-length;
      // return the full cached object with rebuilt headers.
    }
    const headers = buildAssetHeaders(cached.headers, true);
    if (req.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }
    return new Response(cached.body, { status: 200, headers });
  }

  // ── Cache miss: fetch from Supabase origin ────────────────────────────────

  const upstreamUrl = buildUpstreamUrl(url.pathname, env.ASSET_ORIGIN);

  // Forward Range if present so the origin can stream efficiently on the
  // first fetch. We still cache the full object (see below) so subsequent
  // range requests are served without touching origin.
  const upstreamHeaders = new Headers();
  // Pass Range to origin only when it's the first fetch (cache miss).
  // We do NOT use the Range response for the cached copy — we need the
  // full body. So if the client sent a Range, we strip it for the origin
  // fetch in order to get a 200 (full body) back, cache that, then slice
  // the range locally.
  // Exception: HEAD — just proxy it.
  const originInit: RequestInit = {
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: upstreamHeaders,
    redirect: 'follow',
  };

  let originResp: Response;
  try {
    originResp = await fetch(upstreamUrl, originInit);
  } catch (e) {
    return new Response(`Asset origin unreachable: ${(e as Error).message}`, {
      status: 502,
      headers: { 'content-type': 'text/plain' },
    });
  }

  // Don't cache error responses.
  if (originResp.status < 200 || originResp.status >= 300) {
    // Pass through the origin error as-is so the client gets meaningful
    // diagnostics (404, 403, etc.).
    const passHeaders = new Headers(originResp.headers);
    passHeaders.set('x-edu-asset-cache', 'BYPASS');
    return new Response(originResp.body, {
      status: originResp.status,
      headers: passHeaders,
    });
  }

  if (req.method === 'HEAD') {
    const headers = buildAssetHeaders(originResp.headers, false);
    return new Response(null, { status: 200, headers });
  }

  // ── Store full response in cache ──────────────────────────────────────────

  // We need to clone the body twice: once to put in cache, once to
  // serve to the client (or slice for Range).
  const [bodyForCache, bodyForClient] = originResp.body
    ? originResp.body.tee()
    : [null, null];

  const cacheHeaders = buildAssetHeaders(originResp.headers, false);
  const cacheable = new Response(bodyForCache, {
    status: 200,
    headers: cacheHeaders,
  });

  // waitUntil keeps the worker alive until the cache write completes, but
  // doesn't block the response stream to the client.
  ctx.waitUntil(cache.put(cacheKey, cacheable));

  // ── Serve to client ───────────────────────────────────────────────────────

  const responseHeaders = buildAssetHeaders(originResp.headers, false);

  if (rangeHeader) {
    // We fetched the full body; serve the requested range from it.
    // We have to buffer because bodyForClient is a ReadableStream and we
    // need random-access slicing.
    const ab = await new Response(bodyForClient).arrayBuffer();
    const contentLength = ab.byteLength;
    const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : contentLength - 1;
      if (start <= end && start < contentLength) {
        const clampedEnd = Math.min(end, contentLength - 1);
        const slice = ab.slice(start, clampedEnd + 1);
        responseHeaders.set(
          'content-range',
          `bytes ${start}-${clampedEnd}/${contentLength}`,
        );
        responseHeaders.set('content-length', String(slice.byteLength));
        responseHeaders.set('accept-ranges', 'bytes');
        return new Response(slice, { status: 206, headers: responseHeaders });
      }
    }
    // Unsatisfiable range — return full body.
    return new Response(ab, { status: 200, headers: responseHeaders });
  }

  return new Response(bodyForClient, {
    status: 200,
    headers: responseHeaders,
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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

  // ── Asset CDN proxy (/cdn/assets/*) ──────────────────────────────────────
  if (path.startsWith(CDN_PREFIX)) {
    return handleAsset(req, env, ctx);
  }

  // ── API proxy (everything else) ───────────────────────────────────────────

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
