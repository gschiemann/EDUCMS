/**
 * OIDC issuer discovery through the SSRF-safe fetcher (2026-10-11, launch
 * security re-audit V-3).
 *
 * `openid-client`'s `Issuer.discover(url)` is a raw server-side GET to a URL a
 * tenant admin typed, reachable from a PUBLIC route (`/auth/sso/:slug/oidc/
 * login`). It had no private-address, scheme or port check, and the test route
 * echoed its error text back — a reachability oracle into the private network.
 *
 * Now:
 *  - the issuer and every endpoint the discovery document names must be
 *    `https:` on port 443 at a public address (`validatePublicUrl`, plus a
 *    refusal of internal-only names at save time);
 *  - the discovery document itself is fetched with `safeFetch` (DNS pinned at
 *    connect, redirects re-validated, size + time capped);
 *  - every later openid-client request (JWKS, token, userinfo) is pinned to
 *    the same connect-time lookup (`ssrfSafeLookup`) through openid-client's
 *    own `custom.http_options` hook. openid-client does not follow redirects.
 *  - callers report failures in generic words; the raw error is logged only.
 */
import { safeFetch, validatePublicUrl, ssrfSafeLookup, SsrfError } from '../branding/safe-fetch';

/** Names that only ever resolve inside a private network. */
const INTERNAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/i;

export class OidcIssuerUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcIssuerUrlError';
  }
}

/**
 * Shape check for an issuer or endpoint URL (no DNS — usable at save time).
 * Throws OidcIssuerUrlError.
 */
export function assertSafeOidcUrl(raw: string): URL {
  let u: URL;
  try {
    u = validatePublicUrl(String(raw || '').trim());
  } catch (e) {
    throw new OidcIssuerUrlError(e instanceof SsrfError ? e.message : 'Invalid URL');
  }
  if (u.protocol !== 'https:') throw new OidcIssuerUrlError('The identity provider address must start with https://');
  if (u.port && u.port !== '443') throw new OidcIssuerUrlError('The identity provider must use the standard https port');
  if (u.username || u.password) throw new OidcIssuerUrlError('The identity provider address must not contain credentials');
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (INTERNAL_NAME.test(host) || !host.includes('.')) {
    throw new OidcIssuerUrlError('The identity provider address must be a public host name');
  }
  return u;
}

const ENDPOINT_FIELDS = [
  'authorization_endpoint',
  'token_endpoint',
  'userinfo_endpoint',
  'jwks_uri',
  'end_session_endpoint',
  'revocation_endpoint',
  'introspection_endpoint',
] as const;

type FetchFn = typeof safeFetch;

/**
 * Discover an issuer safely. Resolves an openid-client `Issuer` whose own
 * outbound requests (and those of every Client built from it, see
 * `pinClientRequests`) connect only to addresses `ssrfSafeLookup` approves.
 */
export async function discoverOidcIssuer(issuerUrl: string, fetchFn: FetchFn = safeFetch): Promise<any> {
  const base = assertSafeOidcUrl(issuerUrl);
  const wellKnown = `${base.toString().replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const res = await fetchFn(wellKnown, {
    maxBytes: 256 * 1024,
    timeoutMs: 6000,
    accept: 'application/json',
  });
  if (res.status !== 200) throw new Error(`discovery answered ${res.status}`);
  let doc: any;
  try {
    doc = JSON.parse(res.body.toString('utf8'));
  } catch {
    throw new Error('discovery document is not JSON');
  }
  if (!doc || typeof doc !== 'object' || typeof doc.issuer !== 'string') {
    throw new Error('discovery document has no issuer');
  }
  for (const f of ENDPOINT_FIELDS) {
    if (doc[f] !== undefined && doc[f] !== null) assertSafeOidcUrl(String(doc[f]));
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Issuer, custom }: any = require('openid-client');
  const issuer = new Issuer(doc);
  if (custom?.http_options) issuer[custom.http_options] = pinnedHttpOptions;
  return issuer;
}

/** Pin a Client's token / userinfo requests to the SSRF-safe lookup. */
export function pinClientRequests(client: any): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { custom }: any = require('openid-client');
  if (client && custom?.http_options) client[custom.http_options] = pinnedHttpOptions;
  return client;
}

function pinnedHttpOptions(_url: URL, options: Record<string, unknown>) {
  return { ...options, lookup: ssrfSafeLookup, timeout: 6000 };
}
