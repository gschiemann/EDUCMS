/**
 * SSRF-safe fetcher. Resolves the hostname, rejects any address that
 * lands inside a private / link-local / loopback range, then performs
 * the HTTP(S) fetch with a strict byte cap and timeout.
 *
 * This endpoint is user-supplied URL input — every request must flow
 * through `safeFetch`. Never call `fetch(url)` directly in the
 * scraper.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class SsrfError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SsrfError'; }
}

export class FetchTooLargeError extends Error {
  constructor(msg: string) { super(msg); this.name = 'FetchTooLargeError'; }
}

const FORBIDDEN_SCHEMES = /^(file|ftp|gopher|dict|data|javascript|view-source):/i;

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(n => parseInt(n, 10));
  if (a === 10) return true;                              // 10.0.0.0/8
  if (a === 127) return true;                             // loopback
  if (a === 0) return true;                               // 0.0.0.0/8
  if (a === 169 && b === 254) return true;                // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16/12
  if (a === 192 && b === 168) return true;                // 192.168/16
  if (a === 192 && b === 0 && [0,2].includes(+ip.split('.')[2])) return true; // TEST-NETs
  if (a >= 224) return true;                              // multicast / reserved
  if (a === 100 && b >= 64 && b <= 127) return true;      // CGNAT
  return false;
}

function isPrivateV6(ip: string): boolean {
  const norm = ip.toLowerCase();
  if (norm === '::1' || norm === '::') return true;
  if (norm.startsWith('fe80:') || norm.startsWith('fe80::')) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(norm)) return true;       // unique local fc00::/7
  if (/^ff[0-9a-f]{2}:/.test(norm)) return true;          // multicast
  // IPv4-mapped: ::ffff:a.b.c.d
  const v4m = norm.match(/^::ffff:([0-9.]+)$/);
  if (v4m && isPrivateV4(v4m[1])) return true;
  return false;
}

/** True if an IP literal falls inside any private / unsafe range. */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip);
  return false;
}

/** Validate a URL string; throws SsrfError on any disallowed shape. */
export function validatePublicUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new SsrfError('Invalid URL'); }

  if (FORBIDDEN_SCHEMES.test(raw)) throw new SsrfError(`Disallowed scheme: ${u.protocol}`);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfError(`Only http(s) URLs allowed (got ${u.protocol})`);
  }

  const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
  if (![80, 443].includes(port)) throw new SsrfError(`Disallowed port ${port}`);

  // If the hostname is an IP literal, check immediately. Otherwise we
  // defer the DNS check to safeFetch so a single URL validation can be
  // done without side-effects.
  if (isIP(u.hostname) && isPrivateIp(u.hostname)) {
    throw new SsrfError(`Private/loopback IP ${u.hostname} is not allowed`);
  }

  return u;
}

export interface SafeFetchOptions {
  maxBytes?: number;         // default 5 MB
  timeoutMs?: number;        // default 8000
  accept?: string;
  userAgent?: string;
  redirectCount?: number;    // internal; don't pass
}

/**
 * Fetch a public URL with all SSRF protections enabled. Returns the
 * body as a Buffer + content-type. Caller may decode to string (HTML /
 * CSS) or stash the buffer (logos).
 *
 * The initial URL is validated, DNS-resolved, and the resolved IP is
 * checked against private ranges BEFORE the fetch. On 3xx we validate
 * the Location header the same way — at most 3 redirects — so an
 * attacker can't have us chase into 169.254.* metadata endpoints.
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<{ body: Buffer; contentType: string; finalUrl: string; status: number }> {
  const {
    maxBytes = 5 * 1024 * 1024,
    timeoutMs = 8000,
    accept,
    userAgent = 'EduSignage-Branding/1.0 (+https://edusignage.example)',
    redirectCount = 0,
  } = opts;

  if (redirectCount > 3) throw new SsrfError('Too many redirects');

  const url = validatePublicUrl(rawUrl);

  // DNS-resolve and verify every returned address is public
  if (!isIP(url.hostname)) {
    try {
      const results = await lookup(url.hostname, { all: true });
      if (!results.length) throw new SsrfError(`DNS returned no addresses for ${url.hostname}`);
      for (const r of results) {
        if (isPrivateIp(r.address)) {
          throw new SsrfError(`DNS for ${url.hostname} resolved to private range (${r.address})`);
        }
      }
    } catch (e) {
      if (e instanceof SsrfError) throw e;
      throw new SsrfError(`DNS lookup failed for ${url.hostname}`);
    }
  }

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      redirect: 'manual',     // we chase redirects ourselves after revalidating
      signal: ac.signal,
      headers: {
        'User-Agent': userAgent,
        ...(accept ? { Accept: accept } : {}),
      },
    });
  } catch (e: any) {
    clearTimeout(to);
    if (e?.name === 'AbortError') throw new SsrfError('Fetch timed out');
    throw new SsrfError(`Fetch failed: ${e?.message || e}`);
  }
  clearTimeout(to);

  // Manual redirect handling
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get('location');
    if (!loc) throw new SsrfError(`${res.status} without Location`);
    const next = new URL(loc, url).toString();
    return safeFetch(next, { ...opts, redirectCount: redirectCount + 1 });
  }

  // Streaming size cap — abort any response larger than maxBytes
  const reader = res.body?.getReader();
  if (!reader) {
    return { body: Buffer.alloc(0), contentType: res.headers.get('content-type') || '', finalUrl: url.toString(), status: res.status };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw new FetchTooLargeError(`Response exceeded ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  return {
    body: Buffer.concat(chunks.map(c => Buffer.from(c))),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
    finalUrl: url.toString(),
    status: res.status,
  };
}
