/**
 * Same-origin asset caching proxy (Vercel edge) — 2026-05-30 egress fix.
 *
 * Supabase Storage serves every object with `cache-control: no-cache`
 * (verified — raw REST + storage-js both ignored), so Cloudflare never
 * caches and every load re-pulls the full file from origin (the 98 MB →
 * 5.79 GB incident). We can't change Supabase's served header, so instead we
 * front it with a route WE control: this proxy fetches the object once,
 * overrides the header with `immutable`, and lets Vercel's Edge Network
 * cache it. Repeat loads — across every screen/preview/headless run — are
 * then served from Vercel's edge, not Supabase.
 *
 * SSRF-safe: the proxy is hard-locked to the public `assets` bucket of OUR
 * Supabase project. The `[...path]` segment is the object path only; we
 * encode each segment and prepend the fixed prefix — there is NO way to make
 * it fetch an arbitrary URL.
 *
 * Edge runtime so large media streams through without the 4.5 MB serverless
 * response cap. NOTE: whether Vercel's edge cache actually HOLDS a large
 * (e.g. 28 MB) video is verified live with curl after deploy — images cache
 * for sure; video is empirically checked, not assumed.
 */
export const runtime = 'edge';

const SUPABASE_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bhdaxzfalaycfopvcopm.supabase.co').replace(/\/+$/, '');
const ASSET_PREFIX = `${SUPABASE_BASE}/storage/v1/object/public/assets`;

const IMMUTABLE = 'public, max-age=31536000, s-maxage=31536000, immutable';

async function proxy(req: Request, paramsPromise: Promise<{ path: string[] }>, isHead: boolean): Promise<Response> {
  const { path } = await paramsPromise;
  const parts = Array.isArray(path) ? path : [];
  if (parts.length === 0) return new Response('Not found', { status: 404 });

  // Locked to the assets bucket; encode each segment. No arbitrary-URL fetch.
  const objectPath = parts.map((p) => encodeURIComponent(p)).join('/');
  const upstream = `${ASSET_PREFIX}/${objectPath}`;

  let res: Response;
  try {
    // Do NOT forward Range — request the full object so the response is a
    // cacheable 200 (CDNs cache 200, not 206). <video> plays fine off a full
    // 200; signage plays start-to-end/loops, so we trade seek-without-redownload
    // for cacheability. The full file is cached once, then edge-served.
    res = await fetch(upstream, { method: isHead ? 'HEAD' : 'GET' });
  } catch {
    return new Response('Upstream fetch failed', { status: 502 });
  }

  const headers = new Headers();
  for (const k of ['content-type', 'content-length', 'etag', 'last-modified']) {
    const v = res.headers.get(k);
    if (v) headers.set(k, v);
  }
  // The whole point: override Supabase's no-cache with immutable so Vercel's
  // edge + the browser + the player service worker all cache it.
  headers.set('cache-control', IMMUTABLE);
  headers.set('x-asset-proxy', 'vercel-edge');

  return new Response(isHead || !res.ok ? null : res.body, {
    status: res.status,
    headers,
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return proxy(req, ctx.params, false);
}

export async function HEAD(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return proxy(req, ctx.params, true);
}
