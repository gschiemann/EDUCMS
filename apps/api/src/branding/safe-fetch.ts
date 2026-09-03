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
import * as dns from 'node:dns';
import { isIP } from 'node:net';
import * as https from 'node:https';
import * as http from 'node:http';
import * as zlib from 'node:zlib';

export class SsrfError extends Error {
  /**
   * SDE-01 (2026-08-04) — the message a CALLER is allowed to see.
   *
   * `message` deliberately carries the diagnostic detail, including the IP a
   * hostname resolved to, because that is what makes a server log useful. But
   * `/api/v1/proxy/web` is UNAUTHENTICATED (`@Controller('api/v1/proxy')` has
   * no guards) and echoed `e.message` straight back, so anyone on the internet
   * could submit `?url=http://something.internal/` and read back both the fact
   * that it resolved privately and the exact address — an internal network
   * mapper, free of charge, with no account.
   *
   * So every SsrfError now carries a second, uniform string for the wire. It is
   * intentionally identical for a private-IP literal, a private DNS
   * resolution, a bad scheme and a bad port: a caller who can distinguish those
   * can still enumerate internal hostnames by watching WHICH refusal comes
   * back, even without the address. One message tells them only "no".
   */
  readonly publicMessage: string;
  constructor(msg: string, publicMessage = 'Upstream host is not permitted') {
    super(msg);
    this.name = 'SsrfError';
    this.publicMessage = publicMessage;
  }
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

/**
 * Full SSRF check for a URL that will be handed to something OTHER
 * than `safeFetch` — e.g. Puppeteer's `page.goto`. Does everything
 * `validatePublicUrl` does (scheme / port / IP-literal) AND resolves
 * the hostname via DNS, rejecting if any returned address is private/
 * loopback/link-local. `safeFetch` already does this inline; this is
 * the same logic exported so the headless-browser renderer can guard
 * `page.goto` instead of fetching internal services unchecked.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  const url = validatePublicUrl(rawUrl);
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
  return url;
}

/**
 * net.LookupFunction that re-resolves at CONNECT TIME and rejects any
 * private/loopback/link-local address. Wired into the http(s) request's
 * `lookup` option so the socket only ever connects to an address THIS
 * validates — closing the DNS-rebind TOCTOU (a low-TTL domain that passes
 * the up-front check then flips to 169.254.169.254 / 10.x for the actual
 * connection). No dependency — this is core node:dns, so it cannot break
 * boot the way the reverted undici@8 approach did.
 */
function ssrfSafeLookup(
  hostname: string,
  options: dns.LookupOneOptions | dns.LookupAllOptions | dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: any, family?: number) => void,
): void {
  dns.lookup(hostname, { ...(options as any), all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = (Array.isArray(addresses) ? addresses : []) as dns.LookupAddress[];
    if (!list.length) {
      return callback(new SsrfError(`DNS returned no addresses for ${hostname}`) as any, '', 4);
    }
    for (const a of list) {
      if (isPrivateIp(a.address)) {
        return callback(
          new SsrfError(`DNS for ${hostname} resolved to private range (${a.address})`) as any,
          '',
          4,
        );
      }
    }
    if ((options as any)?.all) return callback(null, list, undefined as any);
    return callback(null, list[0].address, list[0].family);
  });
}

export interface SafeFetchOptions {
  maxBytes?: number;         // default 5 MB — cap on the COMPRESSED wire bytes
  /**
   * Cap on the DECOMPRESSED body (see `decodedByteCeiling`). Defaults to
   * `min(24 MB, maxBytes × 12)`. Callers should not need to set this.
   */
  maxDecodedBytes?: number;
  timeoutMs?: number;        // default 8000
  accept?: string;
  userAgent?: string;
  redirectCount?: number;    // internal; don't pass
}

/**
 * DECOMPRESSION-BOMB CEILING (2026-09-02, security re-audit finding SF-01).
 *
 * The streaming cap in `safeFetch` counts bytes ON THE WIRE. Until this
 * landed, the gzip/deflate/br decode that follows had NO output limit, so a
 * hostile upstream could answer a few hundred KB of gzip that inflates to
 * gigabytes and exhaust the API process — the same process that owns
 * emergency fan-out. Reachable from 22 call sites, several of which take a
 * URL straight from an operator (branding scrape, integration discovery,
 * RSS/ICS feeds, data-source, `/proxy/web`) and two of which
 * (`/proxy/web`, `/feeds/*`) are UNAUTHENTICATED.
 *
 * The ceiling is deliberately generous so no real page is refused:
 *   - a 12× ratio is well above real HTML/CSS/JSON gzip (typically 3-8×),
 *   - already-compressed payloads (images, the 8 MB re-host callers) gain
 *     nothing from `content-encoding`, so their decoded size ≈ wire size,
 *   - and the absolute ceiling bounds worst-case memory per in-flight fetch
 *     at 24 MB instead of "whatever the attacker chose".
 */
const DECOMPRESSION_RATIO_LIMIT = 12;
const MAX_DECODED_BYTES_ABSOLUTE = 24 * 1024 * 1024;

export function decodedByteCeiling(maxBytes: number, explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return Math.min(explicit, MAX_DECODED_BYTES_ABSOLUTE);
  }
  return Math.min(MAX_DECODED_BYTES_ABSOLUTE, Math.max(maxBytes, 1) * DECOMPRESSION_RATIO_LIMIT);
}

export interface SafePostOptions {
  body: string;
  headers?: Record<string, string>;
  maxBytes?: number;         // default 64 KB — we only need a small status echo
  timeoutMs?: number;        // default 8000
}

/**
 * SSRF-safe POST for OUTBOUND, user/operator-supplied destination URLs
 * (e.g. tenant webhook delivery). Same defense as `safeFetch`:
 *   - up-front `validatePublicUrl` (scheme / port / IP-literal block)
 *   - DNS resolve + reject any private/loopback/link-local address
 *   - connect-time `ssrfSafeLookup` pin so the socket only ever reaches an
 *     address THIS validated — closes the DNS-rebind TOCTOU even though the
 *     up-front resolve and the connect resolve are separate lookups
 *
 * Deliberately does NOT follow redirects (a 3xx from a webhook receiver is a
 * misconfiguration, and following one would re-open a rebind/redirect-to-
 * internal surface for a POST with a signed body). Reads at most `maxBytes`
 * of the response so a hostile receiver can't stream us an unbounded body —
 * but the caller MUST NOT reflect that body back to operators (it can be the
 * contents of an internal service if a private IP somehow slipped through).
 */
export async function safeFetchPost(
  rawUrl: string,
  opts: SafePostOptions,
): Promise<{ status: number }> {
  const { body, headers = {}, maxBytes = 64 * 1024, timeoutMs = 8000 } = opts;

  // Throws SsrfError on bad scheme / port / private IP literal. This is the
  // first gate; the connect-time pin below is the rebind-proof second gate.
  const url = validatePublicUrl(rawUrl);

  // DNS-resolve and verify every returned address is public BEFORE we open
  // the socket (mirrors safeFetch).
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

  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const payload = Buffer.from(body, 'utf8');

  return await new Promise<{ status: number }>((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: 'POST',
        lookup: ssrfSafeLookup as any, // ← the SSRF connect-time pin (rebind-proof)
        timeout: timeoutMs,
        headers: {
          ...headers,
          'Content-Length': String(payload.length),
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        // Drain a bounded amount so we don't leak fds / let a hostile
        // receiver stream forever, then discard — callers store only the
        // status, never the body (anti-exfil).
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > maxBytes) {
            res.destroy();
          }
        });
        res.on('end', () => resolve({ status }));
        res.on('close', () => resolve({ status }));
        res.on('error', (e) => reject(new SsrfError(`Read failed: ${e.message}`)));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new SsrfError('Request timed out'));
    });
    req.on('error', (e: any) => {
      reject(e instanceof SsrfError ? e : new SsrfError(`Request failed: ${e?.message || e}`));
    });
    req.write(payload);
    req.end();
  });
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

  // Use node:http(s) request (NOT global fetch) so we can pin DNS at connect
  // via the `lookup` option — closing the rebind window. `fetch` gives no way
  // to do this without an extra dependency (the reverted undici approach
  // crashed boot on Node 20.20.2). We replicate fetch's behavior we relied on:
  // manual redirects, a streaming byte cap, a timeout, and transparent
  // gzip/deflate/br decoding (fetch did the last one for free).
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  const result = await new Promise<
    | { kind: 'redirect'; location: string | undefined; status: number }
    | { kind: 'body'; status: number; headers: http.IncomingHttpHeaders; body: Buffer }
  >((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: ssrfSafeLookup as any, // ← the SSRF connect-time pin
        timeout: timeoutMs,
        headers: {
          'User-Agent': userAgent,
          'Accept-Encoding': 'gzip, deflate, br',
          ...(accept ? { Accept: accept } : {}),
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.resume(); // drain so the socket frees
          resolve({ kind: 'redirect', location: res.headers.location, status });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > maxBytes) {
            req.destroy();
            reject(new FetchTooLargeError(`Response exceeded ${maxBytes} bytes`));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ kind: 'body', status, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', (e) => reject(new SsrfError(`Read failed: ${e.message}`)));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new SsrfError('Fetch timed out'));
    });
    req.on('error', (e: any) => {
      reject(e instanceof SsrfError ? e : new SsrfError(`Fetch failed: ${e?.message || e}`));
    });
    req.end();
  });

  if (result.kind === 'redirect') {
    if (!result.location) throw new SsrfError(`${result.status} without Location`);
    const next = new URL(result.location, url).toString();
    // validatePublicUrl + the connect-time lookup re-validate the next hop too.
    return safeFetch(next, { ...opts, redirectCount: redirectCount + 1 });
  }

  // Transparently decode the content-encoding fetch used to handle for us.
  //
  // SF-01: every decode is bounded by `maxOutputLength`. zlib throws
  // ERR_BUFFER_TOO_LARGE the moment the output would pass the ceiling, so a
  // decompression bomb is refused BEFORE the buffer is allocated — it never
  // becomes resident memory. A size refusal is surfaced as
  // FetchTooLargeError (the type every caller already maps to a 413/502);
  // any OTHER zlib error keeps the pre-existing raw-bytes fallback, so a
  // merely malformed encoding behaves exactly as it did before.
  let body = result.body;
  const enc = String(result.headers['content-encoding'] || '').toLowerCase();
  const maxOutputLength = decodedByteCeiling(maxBytes, opts.maxDecodedBytes);
  try {
    if (enc === 'gzip') body = zlib.gunzipSync(body, { maxOutputLength });
    else if (enc === 'deflate') body = zlib.inflateSync(body, { maxOutputLength });
    else if (enc === 'br') body = zlib.brotliDecompressSync(body, { maxOutputLength });
  } catch (e: any) {
    if (e?.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new FetchTooLargeError(
        `Decompressed response exceeded ${maxOutputLength} bytes (content-encoding: ${enc})`,
      );
    }
    // Bad/partial encoding — fall back to the raw bytes rather than throw.
  }

  return {
    body,
    contentType: String(result.headers['content-type'] || 'application/octet-stream'),
    finalUrl: url.toString(),
    status: result.status,
  };
}
