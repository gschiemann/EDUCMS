/**
 * Resolve the REAL client IP from a request behind Railway's multi-hop proxy.
 *
 * ── HISTORY: TWO BUGS, ONE HELPER ─────────────────────────────────────────
 *
 * BUG 1 (2026-07-07) — `req.ip` is a ROTATING internal hop. Under
 * `app.set('trust proxy', 1)` (main.ts) behind Railway's internal mesh,
 * Express resolves `req.ip` to the RIGHTMOST `X-Forwarded-For` entry, which is
 * an internal address that CHANGES per request. That silently defeated every
 * per-IP rate limit (the throttle key moved on every request, so a shared
 * counter never accumulated to the cap and brute-force 429s never fired) and
 * made AuditLog / RequestLog / Screen `ipAddress` record a meaningless
 * internal address. Proven live:
 *   x-forwarded-for: "216.241.83.102, 152.233.76.9"
 *   req.ip         =  152.233.76.9        (internal hop — rotates)
 *   true client    =  216.241.83.102
 * See docs/research/2026-07-07-ratelimit-tracker-fix/00-FINDINGS.md.
 *
 * BUG 2 (2026-08-01, finding ACC-08) — the fix for bug 1 took the LEFTMOST
 * XFF entry. That is stable, but it is the one position in the header an
 * ATTACKER fully controls: proxies APPEND, so anything a client sends arrives
 * as a PREFIX of the final header. `X-Forwarded-For: <random>` on each request
 * therefore rotated the throttle key at will (defeating every brute-force cap
 * exactly as bug 1 did) and wrote an attacker-chosen address into the
 * AuditLog row for an emergency trigger — forging the forensic record of who
 * fired a district-wide lockdown.
 *
 * ── THE FIX: COUNT FROM THE RIGHT BY TRUSTED-HOP COUNT ────────────────────
 * Each trusted proxy in front of us APPENDS exactly one entry, and it appends
 * the address IT observed — which it saw at the TCP layer and the client
 * cannot forge. So with N trusted appending proxies, the true client sits at
 * index `len - N`, counted from the right, and every entry to the LEFT of it
 * is client-supplied garbage that we ignore.
 *
 *   honest:  [client, edge]                    len 2, N 2 → index 0 = client ✓
 *   spoofed: [FAKE, client, edge]              len 3, N 2 → index 1 = client ✓
 *   spoofed: [FAKE, FAKE, FAKE, client, edge]  len 5, N 2 → index 3 = client ✓
 *
 * Both required properties now hold:
 *   STABLE      — the chosen entry does not move between requests from the
 *                 same client, no matter how the internal hop rotates (that
 *                 rotating value lives to the RIGHT of the client entry and is
 *                 never selected). This is the property bug 1 needed and it is
 *                 preserved — do NOT regress it.
 *   UNSPOOFABLE — injected entries only ever lengthen the prefix, and the
 *                 prefix is never read. A client cannot move its own position.
 *
 * `TRUSTED_PROXY_HOPS` (env, integer >= 1, default 2) is that count. The
 * default matches the measured production chain above — Railway edge + one
 * internal hop, i.e. TWO appenders. A deployment whose chain differs (an extra
 * CDN/WAF in front, or none at all) MUST set it; getting it wrong does not
 * crash anything, it just selects the wrong entry, so verify against a real
 * request's `X-Forwarded-For` after any infrastructure change. If the observed
 * header is SHORTER than the configured hop count we are not behind the full
 * chain (local dev, a direct hit, an in-cluster probe), so we clamp to index
 * 0; that case is spoofable, which is why it must not be the production shape.
 *
 * Fully defensive — never throws.
 *
 * @returns the normalized client IP, or `null` if nothing is resolvable
 *   (callers needing a non-null string, e.g. a throttle key, must coalesce).
 */

import { createHash, timingSafeEqual } from 'crypto';

/** Default matches the measured Railway chain: edge + one internal hop. */
const DEFAULT_TRUSTED_PROXY_HOPS = 2;

// ── BUG 3 (2026-09-02) — THE SAME-ORIGIN GATEWAY HOP ──────────────────────
//
// Some OEM Android WebViews can load the player shell from the WEB origin
// (Vercel) but cannot reach this API's origin at all. Those devices fall back
// to running their whole control plane through a Next-middleware gateway on
// the web origin (`apps/web/src/middleware.ts`).
//
// That adds an appender to `X-Forwarded-For`, and the entry it appends is
// VERCEL'S EGRESS ADDRESS. Counted from the right by the normal rule, every
// gateway device in the world would resolve to that ONE address: a single
// shared throttle key (so per-IP brute-force caps collapse — exactly bug 1's
// consequence, fleet-wide) and an AuditLog `ipAddress` naming Vercel instead
// of whoever fired a district-wide lockdown.
//
// So the gateway forwards the real client IP explicitly, with a shared secret
// proving the header came from us. We trust the forwarded IP ONLY on a
// constant-time secret match; otherwise we ignore BOTH headers and fall
// through to the normal right-counted rule — never to a client-supplied
// value. Since the header is only honored with the secret, an attacker who
// sets it themselves gains nothing.
//
// `GATEWAY_SHARED_SECRET` must be set on BOTH services (and must match). When
// it is unset, or too short to be a real secret, the feature is OFF and this
// helper behaves exactly as it did before.

/** Real client IP, forwarded by our own gateway. */
export const GATEWAY_CLIENT_IP_HEADER = 'x-venueos-gw-client-ip';
/** Proof the forwarded IP came from our gateway and not from a client. */
export const GATEWAY_SECRET_HEADER = 'x-venueos-gw-secret';
/** Below this a "secret" is a guessable token, not a credential. */
const MIN_GATEWAY_SECRET_LEN = 16;

function firstHeaderValue(v: unknown): string | null {
  const raw = Array.isArray(v) ? v[0] : v;
  return typeof raw === 'string' && raw.length ? raw : null;
}

/**
 * Constant-time comparison of the presented gateway secret against the
 * configured one. Both sides are SHA-256'd first so the comparison length is
 * fixed and the check never leaks the secret's length.
 */
export function gatewaySecretMatches(presented: unknown): boolean {
  const expected = process.env.GATEWAY_SHARED_SECRET;
  if (typeof expected !== 'string' || expected.length < MIN_GATEWAY_SECRET_LEN) return false;
  const got = firstHeaderValue(presented);
  if (!got) return false;
  try {
    const a = createHash('sha256').update(got).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Parsed once per process. Read lazily (not at module load) so tests and
 * boot-order changes can set the env var before first use; cached after.
 */
let cachedHops: number | null = null;
let cachedHopsRaw: string | undefined;

export function trustedProxyHopCount(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (cachedHops !== null && raw === cachedHopsRaw) return cachedHops;
  cachedHopsRaw = raw;
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  // A hop count below 1 would mean "trust the rightmost entry", i.e. trust a
  // value no proxy vouched for — reject it and fall back to the default.
  cachedHops = Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_TRUSTED_PROXY_HOPS;
  return cachedHops;
}

/** Test-only: drop the memoized hop count so a test can change the env var. */
export function __resetTrustedProxyHopCache(): void {
  cachedHops = null;
  cachedHopsRaw = undefined;
}

/**
 * Normalize an address so the SAME client always produces the SAME string —
 * a throttle key that differs by `::ffff:` prefix or an ephemeral source port
 * would fragment the counter exactly like the bugs above.
 */
function normalizeIp(value: string): string | null {
  let v = value.trim();
  if (!v) return null;
  // "[2001:db8::1]:443" → "2001:db8::1"
  const bracketed = v.match(/^\[(.+)\](?::\d+)?$/);
  if (bracketed) {
    v = bracketed[1];
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(v)) {
    // "203.0.113.9:51514" → "203.0.113.9" (IPv4 + port). Bare IPv6 keeps its
    // colons and is deliberately not touched here.
    v = v.slice(0, v.lastIndexOf(':'));
  }
  v = v.toLowerCase();
  // IPv4-mapped IPv6 ("::ffff:203.0.113.9") → the IPv4 form.
  const mapped = v.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) v = mapped[1];
  return v || null;
}

/** Every X-Forwarded-For entry, left-to-right, across repeated headers. */
function forwardedForChain(xff: unknown): string[] {
  // Node collapses duplicate headers into an array. Concatenating in order is
  // the correct chain — reading only the first element would let an attacker
  // send a SECOND X-Forwarded-For header to shift our index.
  const raw = Array.isArray(xff) ? xff.join(',') : xff;
  if (typeof raw !== 'string' || !raw.length) return [];
  return raw
    .split(',')
    .map((part) => normalizeIp(part))
    .filter((part): part is string => !!part);
}

export function clientIpFromRequest(req: unknown): string | null {
  const r = req as
    | {
        headers?: Record<string, unknown>;
        ip?: unknown;
        socket?: { remoteAddress?: unknown };
      }
    | undefined;
  try {
    // Our own gateway hop (bug 3 above) — trusted ONLY on a secret match.
    const headers = r?.headers;
    if (headers && gatewaySecretMatches(headers[GATEWAY_SECRET_HEADER])) {
      const forwarded = firstHeaderValue(headers[GATEWAY_CLIENT_IP_HEADER]);
      const candidate = forwarded ? normalizeIp(forwarded.split(',')[0]) : null;
      // Shape-check even a secret-authenticated value: a junk string would
      // become a throttle key and an AuditLog `ipAddress`.
      const normalized = candidate && /^[0-9a-f.:]+$/.test(candidate) ? candidate : null;
      // A match with a junk/absent IP falls THROUGH to the normal rule; it
      // never yields a client-supplied value.
      if (normalized) return normalized;
    }
  } catch {
    /* fall through to the normal rule below */
  }
  try {
    const chain = forwardedForChain(r?.headers?.['x-forwarded-for']);
    if (chain.length) {
      // Count from the RIGHT by the trusted-hop count. Clamp at 0 so a
      // shorter-than-expected chain still yields the leftmost (see note above).
      const index = Math.max(0, chain.length - trustedProxyHopCount());
      const chosen = chain[index];
      if (chosen) return chosen;
    }
  } catch {
    /* fall through to req.ip / socket below */
  }
  // No usable XFF: not behind the proxy chain at all (direct hit, tests,
  // in-cluster probes). `req.ip` then IS the peer address rather than a
  // rotating hop, so it is the right fallback.
  const ip = r?.ip;
  if (typeof ip === 'string' && ip.length) return normalizeIp(ip);
  const sock = r?.socket?.remoteAddress;
  if (typeof sock === 'string' && sock.length) return normalizeIp(sock);
  return null;
}
