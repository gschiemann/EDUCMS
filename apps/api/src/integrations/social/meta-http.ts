/**
 * Shared Meta (Instagram + Facebook) HTTP plumbing.
 * ─────────────────────────────────────────────────
 *
 * Everything both providers need and neither may re-invent:
 *
 *   • ONE pinned Graph API version, in one place.
 *   • A FIXED host allowlist. Every outbound URL this module builds is
 *     checked against it before the request leaves — a provider module
 *     cannot be talked into fetching some other origin by a value that
 *     came back from the network (a `paging.next` cursor, a redirect).
 *   • A bounded fetch: 8s AbortSignal, `redirect: 'manual'` so a 30x to
 *     another host is an error rather than a silent SSRF hop, and a size
 *     cap so a hostile/limitless body cannot pin the process.
 *   • Error text that is SAFE TO STORE. `statusReason` ends up on an
 *     operator's screen; a raw Graph error body echoes the access token
 *     back in some shapes, so the body never leaves this file.
 *
 * Doc references (verified 2026-09-12):
 *   Graph versions   https://developers.facebook.com/docs/graph-api/changelog
 *   IG media fields  https://developers.facebook.com/docs/instagram-platform/reference/instagram-media
 */

/**
 * Pinned Graph API version. v26.0 is what Meta lists as "the latest Graph API
 * version" (introduced 2026-07-29) — checked against the changelog on
 * 2026-09-12. Meta supports a version for ~2 years from release, so this is
 * good until roughly mid-2028. It lives HERE and nowhere else: an unpinned
 * `/v{latest}/` path silently changes behaviour under us the day Meta ships a
 * new default.
 */
export const META_GRAPH_VERSION = 'v26.0';

/** The only hosts this connector may ever talk to. */
export const META_ALLOWED_HOSTS: readonly string[] = [
  'api.instagram.com',
  'graph.instagram.com',
  'graph.facebook.com',
  'www.instagram.com',
  'www.facebook.com',
];

/** One provider call may not exceed this. Bounded ACROSS THE BODY READ (the
 *  player-reliability F1 lesson: `fetch()` resolves at headers, so a timeout
 *  cleared there still lets a 200-then-stalled body wedge the caller). */
export const META_FETCH_TIMEOUT_MS = 8_000;

/** Hard cap on a provider response body. A media page of 30 posts is a few
 *  tens of KB; 2 MB is generous and still bounded. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export class MetaHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when the provider told us the credential is dead (OAuth 190 /
     *  401 / 403) — the caller turns this into EXPIRED, not ERROR. */
    readonly authFailure: boolean,
  ) {
    super(message);
    this.name = 'MetaHttpError';
  }
}

/** Is this a host we are allowed to call? Exact match only — no suffix rule,
 *  because `graph.facebook.com.evil.example` is exactly the attack a suffix
 *  match lets through. */
export function isAllowedMetaHost(host: string): boolean {
  return META_ALLOWED_HOSTS.includes(String(host || '').toLowerCase());
}

/**
 * Assert a URL points at an allowed Meta host over https, and return it.
 * Throws otherwise. Called on EVERY request, including ones built from a
 * value the network handed us.
 */
export function assertMetaUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MetaHttpError('Malformed provider URL', 0, false);
  }
  if (parsed.protocol !== 'https:') {
    throw new MetaHttpError('Provider URL must be https', 0, false);
  }
  if (!isAllowedMetaHost(parsed.hostname)) {
    throw new MetaHttpError(
      `Refusing to call non-Meta host ${parsed.hostname}`,
      0,
      false,
    );
  }
  return parsed;
}

/**
 * Graph errors that mean "this credential is finished". 190 is the OAuth
 * family (expired / revoked / password changed / user removed the app);
 * 102 is a dead session; 10 and 200-299 are permission losses, which for our
 * read-only purposes are just as terminal as an expiry.
 * https://developers.facebook.com/docs/graph-api/guides/error-handling
 */
function isAuthFailure(
  status: number,
  code: unknown,
  subcode: unknown,
): boolean {
  if (status === 401) return true;
  const c = Number(code);
  const sc = Number(subcode);
  if (c === 190 || c === 102 || c === 10) return true;
  if (c >= 200 && c <= 299) return true;
  // 463 = expired, 467 = invalid, 458 = app not authorised, 459/460 = session.
  if ([458, 459, 460, 463, 467].includes(sc)) return true;
  return false;
}

/**
 * A Graph error body, reduced to something safe to persist and show.
 *
 * NEVER include the body verbatim: Meta echoes the request (and in some
 * shapes the `access_token` query parameter) inside `error.message` /
 * `error.error_user_msg`, and `statusReason` is rendered to the operator and
 * written to the log. We keep the error TYPE and CODE, which is what a human
 * needs to search, and nothing that can carry a secret.
 */
function safeErrorSummary(
  status: number,
  json: any,
): { message: string; auth: boolean } {
  const err = json && typeof json === 'object' ? json.error : null;
  const type = err && typeof err.type === 'string' ? err.type : '';
  const code = err ? err.code : undefined;
  const subcode = err ? (err.error_subcode ?? err.errorSubcode) : undefined;
  const auth = isAuthFailure(status, code, subcode);
  const bits = [`HTTP ${status}`];
  if (type) bits.push(type);
  if (code !== undefined && code !== null) bits.push(`code ${code}`);
  if (subcode !== undefined && subcode !== null)
    bits.push(`subcode ${subcode}`);
  return { message: bits.join(' · '), auth };
}

/** The fetch implementation. Overridable ONLY for unit tests — production
 *  always uses global fetch. */
export type FetchLike = (input: any, init?: any) => Promise<any>;

export interface MetaFetchOptions {
  method?: 'GET' | 'POST';
  /** Form-encoded body for the one POST we make (the IG code exchange). */
  form?: Record<string, string>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Call a Meta endpoint and parse JSON, bounded and host-checked.
 *
 * Returns the parsed body on 2xx. Throws `MetaHttpError` otherwise — with
 * `authFailure` set when the provider says the credential is dead, so the
 * caller can mark the connection EXPIRED (reconnect) rather than ERROR
 * (retryable).
 */
export async function metaFetchJson<T = any>(
  url: string,
  opts: MetaFetchOptions = {},
): Promise<T> {
  const parsed = assertMetaUrl(url);
  const doFetch: FetchLike = opts.fetchImpl || (globalThis.fetch as FetchLike);
  if (typeof doFetch !== 'function') {
    throw new MetaHttpError('No fetch implementation available', 0, false);
  }

  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutMs = opts.timeoutMs ?? META_FETCH_TIMEOUT_MS;
  // ONE deadline for the whole exchange — headers AND body. Cleared in the
  // finally, so a fast response never leaves a timer behind.
  const timer = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch {
          /* already settled */
        }
      }, timeoutMs)
    : null;
  if (timer && typeof (timer as any).unref === 'function')
    (timer as any).unref();

  try {
    const init: any = {
      method: opts.method || 'GET',
      // A 30x to ANOTHER host would otherwise be followed silently — that is
      // the SSRF hop this connector must not have. `manual` surfaces it as a
      // non-2xx we reject below.
      redirect: 'manual',
      signal: controller ? controller.signal : undefined,
      headers: {} as Record<string, string>,
    };
    if (opts.form) {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(opts.form).toString();
    }

    const res = await doFetch(parsed.toString(), init);
    const status = Number(res?.status ?? 0);

    // Body read is INSIDE the same deadline (see above).
    const text = typeof res?.text === 'function' ? await res.text() : '';
    if (typeof text === 'string' && text.length > MAX_BODY_BYTES) {
      throw new MetaHttpError('Provider response too large', status, false);
    }

    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (status < 200 || status >= 300) {
      const { message, auth } = safeErrorSummary(status, json);
      throw new MetaHttpError(message, status, auth);
    }
    if (json === null) {
      throw new MetaHttpError(
        'Provider returned a non-JSON body',
        status,
        false,
      );
    }
    return json as T;
  } catch (err: any) {
    if (err instanceof MetaHttpError) throw err;
    // AbortError / network failure. The message is ours, not the provider's.
    const aborted = err?.name === 'AbortError';
    throw new MetaHttpError(
      aborted
        ? `Provider did not answer within ${timeoutMs}ms`
        : 'Could not reach the provider',
      0,
      false,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Normalised shape every provider maps its posts onto. */
export interface NormalizedSocialPost {
  providerPostId: string;
  /** image | video | carousel | text | link */
  kind: 'image' | 'video' | 'carousel' | 'text' | 'link';
  text: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  postedAt: Date;
}

/** Keep only an https URL we are willing to put in an `<img src>`. Meta serves
 *  media from CDN hosts (scontent-*.cdninstagram.com / *.fbcdn.net) that are
 *  deliberately NOT on the API allowlist — the API never fetches them, the
 *  BROWSER does. So this is a shape check, not a host check. */
export function safeMediaUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Parse a provider timestamp, falling back to "now" so a post with an
 *  unreadable date still caches (ordering degrades; the post is not lost). */
export function parseProviderDate(raw: unknown): Date {
  if (typeof raw === 'string' && raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}
