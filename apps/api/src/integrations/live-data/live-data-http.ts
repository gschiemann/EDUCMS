/**
 * The one outbound call for every live-data provider.
 *
 * Fixed vendor hosts only (`LIVE_DATA_PROVIDERS[*].host`): a caller passes a
 * PATH and query, never a URL, so there is no SSRF surface and no need for
 * `safeFetch`'s DNS pinning. Whatever goes wrong, the thrown error is a
 * `LiveDataUpstreamError` with a fixed sentence — never the URL (TomTom's key
 * rides in it), never the vendor's body (vendors echo the request).
 */

import {
  LIVE_DATA_PROVIDERS,
  type LiveDataFamily,
} from './live-data-providers';

export const LIVE_DATA_TIMEOUT_MS = 8000;
export const LIVE_DATA_MAX_BYTES = 2 * 1024 * 1024;

/** The only hosts a family's key may be sent to. CoinGecko's free Demo plan
 *  lives on a different host from its paid plans; nothing else has two. */
const ALT_HOSTS: Record<LiveDataFamily, string[]> = {
  traffic: [LIVE_DATA_PROVIDERS.traffic.host],
  flights: [LIVE_DATA_PROVIDERS.flights.host],
  scores: [LIVE_DATA_PROVIDERS.scores.host],
  stocks: [LIVE_DATA_PROVIDERS.stocks.host],
  crypto: [LIVE_DATA_PROVIDERS.crypto.host, 'api.coingecko.com'],
};

export class LiveDataUpstreamError extends Error {
  constructor(
    readonly code:
      | 'REJECTED'
      | 'RATE_LIMITED'
      | 'UNAVAILABLE'
      | 'MALFORMED'
      | 'TOO_LARGE',
  ) {
    super(
      code === 'REJECTED'
        ? 'The data provider refused this request.'
        : code === 'RATE_LIMITED'
          ? 'The data provider is busy. Try again shortly.'
          : code === 'MALFORMED'
            ? 'The data provider sent something we could not read.'
            : code === 'TOO_LARGE'
              ? 'The data provider sent too much data.'
              : 'Could not reach the data provider right now.',
    );
    this.name = 'LiveDataUpstreamError';
  }
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{
  status: number;
  text(): Promise<string>;
  headers?: { get(name: string): string | null };
}>;

/** Test seam: specs swap the transport for a fixture-serving fake. */
let transport: FetchLike = (url, init) => fetch(url, init) as never;
export function __setLiveDataTransport(next: FetchLike | null): void {
  transport = next ?? ((url, init) => fetch(url, init) as never);
}

export async function providerGetJson(
  family: LiveDataFamily,
  pathAndQuery: string,
  headers: Record<string, string> = {},
  hostOverride?: string,
): Promise<unknown> {
  if (!pathAndQuery.startsWith('/'))
    throw new LiveDataUpstreamError('MALFORMED');
  const host = hostOverride ?? LIVE_DATA_PROVIDERS[family].host;
  if (!ALT_HOSTS[family].includes(host))
    throw new LiveDataUpstreamError('MALFORMED');
  const url = `https://${host}${pathAndQuery}`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await transport(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'VenueOS/1.0 (public information display)',
        ...headers,
      },
      signal: AbortSignal.timeout(LIVE_DATA_TIMEOUT_MS),
    });
  } catch {
    // The native error can carry the URL; never forward it.
    throw new LiveDataUpstreamError('UNAVAILABLE');
  }
  if (res.status === 401 || res.status === 403)
    throw new LiveDataUpstreamError('REJECTED');
  if (res.status === 429) throw new LiveDataUpstreamError('RATE_LIMITED');
  if (res.status < 200 || res.status >= 300)
    throw new LiveDataUpstreamError('UNAVAILABLE');
  const declared = Number(res.headers?.get('content-length') || 0);
  if (declared > LIVE_DATA_MAX_BYTES)
    throw new LiveDataUpstreamError('TOO_LARGE');
  let body: string;
  try {
    body = await res.text();
  } catch {
    throw new LiveDataUpstreamError('UNAVAILABLE');
  }
  if (Buffer.byteLength(body) > LIVE_DATA_MAX_BYTES)
    throw new LiveDataUpstreamError('TOO_LARGE');
  try {
    return JSON.parse(body);
  } catch {
    throw new LiveDataUpstreamError('MALFORMED');
  }
}
