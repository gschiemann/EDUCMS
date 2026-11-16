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
 *
 * The route handler is `[...path]/route.ts`; the logic lives here so it can
 * be unit-tested (a route file may only export route fields).
 */

const SUPABASE_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bhdaxzfalaycfopvcopm.supabase.co').replace(/\/+$/, '');
const ASSET_PREFIX = `${SUPABASE_BASE}/storage/v1/object/public/assets`;

const IMMUTABLE = 'public, max-age=31536000, s-maxage=31536000, immutable';

/** Headers set on EVERY response from this route, success or error. */
const SAFETY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "sandbox; default-src 'none'",
};

function withSafety(headers: Headers): Headers {
  for (const [k, v] of Object.entries(SAFETY_HEADERS)) headers.set(k, v);
  return headers;
}

function plain(body: string, status: number): Response {
  return new Response(body, { status, headers: withSafety(new Headers({ 'content-type': 'text/plain; charset=utf-8' })) });
}

/**
 * A path segment is acceptable only if no decoding of it is empty, `.` or
 * `..`. Next hands us segments already decoded once; we keep decoding (a few
 * rounds) so an encoded dot segment cannot reach the object path.
 */
export function isSafeSegment(seg: unknown): boolean {
  if (typeof seg !== 'string') return false;
  let cur = seg;
  for (let i = 0; i < 4; i++) {
    if (cur === '' || cur === '.' || cur === '..') return false;
    let next: string;
    try {
      next = decodeURIComponent(cur);
    } catch {
      return false;
    }
    if (next === cur) return true;
    cur = next;
  }
  // Still changing after several rounds — refuse rather than guess.
  return false;
}

/** Media types served inline; everything else downloads as an attachment. */
export function isInlineContentType(ct: string | null | undefined): boolean {
  if (!ct) return false;
  const base = ct.split(';')[0].trim().toLowerCase();
  return (
    /^image\/[a-z0-9.+-]+$/.test(base) ||
    /^video\/[a-z0-9.+-]+$/.test(base) ||
    /^audio\/[a-z0-9.+-]+$/.test(base) ||
    base === 'application/pdf'
  );
}

export async function proxy(req: Request, paramsPromise: Promise<{ path: string[] }>, isHead: boolean): Promise<Response> {
  const { path } = await paramsPromise;
  const parts = Array.isArray(path) ? path : [];
  if (parts.length === 0) return plain('Not found', 404);
  if (!parts.every(isSafeSegment)) return plain('Bad request', 400);

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
    return plain('Upstream fetch failed', 502);
  }

  const headers = new Headers();
  for (const k of ['content-length', 'etag', 'last-modified']) {
    const v = res.headers.get(k);
    if (v) headers.set(k, v);
  }
  const upstreamType = res.headers.get('content-type');
  if (isInlineContentType(upstreamType)) {
    headers.set('content-type', upstreamType!);
  } else {
    headers.set('content-type', 'application/octet-stream');
    headers.set('content-disposition', 'attachment');
  }
  withSafety(headers);
  // The whole point: override Supabase's no-cache with immutable so Vercel's
  // edge + the browser + the player service worker all cache it.
  headers.set('cache-control', IMMUTABLE);
  headers.set('x-asset-proxy', 'vercel-edge');

  return new Response(isHead || !res.ok ? null : res.body, {
    status: res.status,
    headers,
  });
}
