/**
 * WHICH DOMAIN A PASSKEY IS BOUND TO — the relying-party resolution.
 *
 * A WebAuthn credential is cryptographically welded to an `rpID` (a domain)
 * and each ceremony is checked against an `expectedOrigin`. Those two values
 * decide WHOSE site a signature is valid for, so they are an authorization
 * input, not configuration trivia:
 *
 *   • an attacker-chosen `rpID` would let a credential minted on
 *     `evil.example` be presented here;
 *   • an attacker-chosen `expectedOrigin` would let an assertion collected by
 *     a phishing page satisfy `verifyAuthenticationResponse`.
 *
 * So this module NEVER reads a body field. It reads the request's `Origin`
 * header — which the browser sets and page JavaScript cannot forge — and then
 * refuses anything that is not already on an allowlist WE control. Two
 * sources, in order:
 *
 *   1. `WEBAUTHN_RP_ID` + `WEBAUTHN_ORIGINS` (comma list). An explicit
 *      override for a deploy whose passkey domain is not simply the dashboard
 *      origin's host (an apex `rpID` serving several subdomains is the usual
 *      reason). BOTH must be set — a half-configured override is ignored
 *      rather than half-applied, and falls through to (2), which still works.
 *   2. `ALLOWED_ORIGINS` — the SAME allowlist the CORS layer already enforces
 *      in `main.ts`. Reusing it means there is exactly one list of "origins
 *      this API serves", so a passkey can never be bound to a domain CORS
 *      would have rejected, and an operator adding a domain does not have to
 *      remember a second variable. `rpID` is that origin's hostname.
 *
 * Outside production, loopback (`http://localhost:<port>` /
 * `http://127.0.0.1:<port>`) is additionally accepted, because that is where
 * the dashboard runs in dev and WebAuthn permits `http:` only for loopback.
 * Production never reaches that branch.
 *
 * ── THE PAIR MUST BE PINNED FOR THE WHOLE CEREMONY ────────────────────────
 * The caller resolves ONCE, at options time, and stores the resolved
 * `{ rpID, origin }` WITH the challenge (see `webauthn-challenge-store.ts`).
 * Verify reads the stored pair and never re-resolves. Re-reading at verify
 * would let a caller start a ceremony on one origin and finish it on another
 * — the allowlist would still be satisfied at both ends, and the check would
 * still "pass", while proving nothing about which site the user was on.
 */

/** User-visible RP name. A constant, not an env var — it is our product name. */
export const WEBAUTHN_RP_NAME = 'VenueOS';

export interface WebAuthnRelyingParty {
  /** The domain the credential is scoped to (no port, no scheme). */
  rpID: string;
  /** User-visible name shown in the platform's passkey prompt. */
  rpName: string;
  /** The exact origin this ceremony must be performed on. */
  origin: string;
}

export interface ResolveRelyingPartyOpts {
  /**
   * The request's `Origin` header, verbatim. NEVER a body field, and never a
   * `Referer` (which is truncatable and omitted under some policies).
   */
  requestOrigin?: string | null;
  /** Injectable so the tests never mutate the ambient environment. */
  env?: Record<string, string | undefined>;
}

/**
 * Canonical `scheme://host[:port]` form, or null if it is not a usable
 * http(s) origin. `URL#origin` drops a default port and a trailing slash, so
 * `https://app.example.com:443/` and `https://app.example.com` compare equal
 * — an operator's harmless formatting difference must not silently fail to
 * match the browser's header.
 */
function normalizeOrigin(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Comma-separated env list → normalized, de-duplicated origins. */
function originList(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const normalized = normalizeOrigin(part);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/**
 * Loopback over plain http. The WebAuthn spec carves these out of its secure-
 * context requirement precisely so local development works; everything else
 * must be https.
 */
function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

let warnedPartialOverride = false;

/** Test seam: forget that the partial-override warning was already printed. */
export function __resetWebAuthnConfigWarningForTests(): void {
  warnedPartialOverride = false;
}

/**
 * Resolve the relying party for ONE ceremony.
 *
 * @returns the pinned `{ rpID, rpName, origin }`, or `null` when the request's
 *   origin is not one this deploy serves. A null is a `400
 *   PASSKEY_ORIGIN_NOT_ALLOWED` at the controller — never a fallback to some
 *   default domain, which would be exactly the attacker-chosen `rpID` this
 *   module exists to prevent.
 */
export function resolveRelyingParty(
  opts: ResolveRelyingPartyOpts = {},
): WebAuthnRelyingParty | null {
  const env = opts.env ?? process.env;
  const requestOrigin = normalizeOrigin(opts.requestOrigin);

  const rpIdOverride = (env.WEBAUTHN_RP_ID ?? '').trim();
  const originOverrides = originList(env.WEBAUTHN_ORIGINS);

  if (rpIdOverride && originOverrides.length) {
    // An override is configured. The request's origin still has to be one of
    // the listed ones — a ceremony started from an origin that is not in the
    // list could not complete anyway, and refusing gives the operator a named
    // error instead of an opaque verification failure minutes later.
    if (!requestOrigin) {
      // No `Origin` header at all (a non-browser caller). We still pin an
      // origin WE chose rather than refusing outright, so a proxy that strips
      // the header cannot brick passkeys; a ceremony genuinely performed
      // elsewhere simply fails at verify.
      return {
        rpID: rpIdOverride,
        rpName: WEBAUTHN_RP_NAME,
        origin: originOverrides[0],
      };
    }
    if (!originOverrides.includes(requestOrigin)) return null;
    return {
      rpID: rpIdOverride,
      rpName: WEBAUTHN_RP_NAME,
      origin: requestOrigin,
    };
  }

  if ((rpIdOverride || originOverrides.length) && !warnedPartialOverride) {
    warnedPartialOverride = true;

    console.warn(
      '[webauthn] WEBAUTHN_RP_ID and WEBAUTHN_ORIGINS must BOTH be set to take effect. ' +
        'Only one is set, so the override is ignored and the relying party is derived from ' +
        'ALLOWED_ORIGINS instead.',
    );
  }

  // Derived from the CORS allowlist. Here the request's origin is the only
  // thing that can tell us which host to bind to, so its absence is fatal.
  if (!requestOrigin) return null;

  const allowed = originList(env.ALLOWED_ORIGINS);
  const isProduction = env.NODE_ENV === 'production';
  const permitted =
    allowed.includes(requestOrigin) ||
    (!isProduction && isLoopbackOrigin(requestOrigin));
  if (!permitted) return null;

  // `hostname`, not `host` — an rpID carries no port. A credential registered
  // on `http://localhost:3000` is therefore scoped to `localhost`, which is
  // what the platform authenticator expects.
  const hostname = new URL(requestOrigin).hostname;
  if (!hostname) return null;
  return { rpID: hostname, rpName: WEBAUTHN_RP_NAME, origin: requestOrigin };
}

/** The `Origin` header off an Express request, defensively. */
export function requestOriginHeader(req: unknown): string | null {
  const headers = (req as { headers?: Record<string, unknown> } | undefined)
    ?.headers;
  const raw = headers?.origin;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.length ? value : null;
}
