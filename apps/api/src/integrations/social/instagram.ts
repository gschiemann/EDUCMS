/**
 * Instagram provider — "Instagram API with Instagram Login" (2026-09-12).
 * ───────────────────────────────────────────────────────────────────────
 *
 * PURE URL BUILDERS + TYPED FETCHERS. No Nest, no Prisma, no logging — so
 * every one of these is unit-testable with a mocked fetch, and so the only
 * place a token can be mishandled is the service that calls them.
 *
 * ── WHICH INSTAGRAM API THIS IS ─────────────────────────────────────────
 * The old **Basic Display API is dead** (Meta shut it down in December 2024),
 * which is exactly why the App Library tile said "Coming soon". Its
 * replacement, "Instagram API with Instagram Login", supports **business and
 * creator accounts only** — a personal Instagram account CANNOT be connected,
 * by anybody, and the operator has to switch their account to professional
 * first. That is a product fact, not a bug in this file.
 *
 * This login uses the **Instagram app's own** credentials (Meta App Dashboard
 * → Instagram product → "Instagram app ID" / "Instagram app secret"), which
 * are DIFFERENT values from the Facebook app id/secret used by facebook.ts.
 * Hence INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET, separate from META_APP_ID /
 * META_APP_SECRET.
 *
 * ── ACCESS LEVEL: READ THIS BEFORE PROMISING A CUSTOMER ─────────────────
 * `instagram_business_basic` starts at **Standard Access**, and Meta is
 * explicit that "Permissions with Standard Access can only be requested from
 * app users who have a role on the requesting app." So out of the box this
 * connector works for accounts OUR OWN TEAM administers — a pilot, a demo
 * tenant, a venue whose IG account we have been added to. Serving arbitrary
 * customers needs **Advanced Access**, which "must be approved on an
 * individual permission and feature basis through the App Review process"
 * and additionally requires Business Verification. The connector is built to
 * work for Standard Access TODAY and needs no code change when Advanced
 * Access is granted — only the Meta-side approval.
 *   https://developers.facebook.com/docs/graph-api/overview/access-levels
 *
 * ── ENDPOINTS (each verified against Meta's docs on 2026-09-12) ─────────
 *   authorize   GET  https://www.instagram.com/oauth/authorize
 *   exchange    POST https://api.instagram.com/oauth/access_token
 *   long-lived  GET  https://graph.instagram.com/access_token
 *   refresh     GET  https://graph.instagram.com/refresh_access_token
 *     all four: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
 *   media       GET  https://graph.instagram.com/{version}/me/media
 *     fields + media_type values:
 *       https://developers.facebook.com/docs/instagram-platform/reference/instagram-media
 */
import {
  META_GRAPH_VERSION,
  MetaHttpError,
  metaFetchJson,
  parseProviderDate,
  safeMediaUrl,
  type FetchLike,
  type NormalizedSocialPost,
} from './meta-http';

/** The one scope we ask for. Read-only: media + the account's own profile.
 *  We deliberately do NOT ask for publish / messages / comments — a signage
 *  product has no business holding a permission it cannot use. */
export const INSTAGRAM_SCOPES = ['instagram_business_basic'] as const;

export const INSTAGRAM_ENV_VARS = [
  'INSTAGRAM_APP_ID',
  'INSTAGRAM_APP_SECRET',
] as const;

/** Which of this provider's env vars are missing. Empty array = configured. */
export function instagramMissingEnv(): string[] {
  return INSTAGRAM_ENV_VARS.filter((k) => !String(process.env[k] || '').trim());
}

export function instagramConfigured(): boolean {
  return instagramMissingEnv().length === 0;
}

function appId(): string {
  return String(process.env.INSTAGRAM_APP_ID || '').trim();
}
function appSecret(): string {
  return String(process.env.INSTAGRAM_APP_SECRET || '').trim();
}

/**
 * The page we send the operator to. `state` is the single-use CSRF nonce the
 * controller minted and stored server-side — it is never read back from the
 * request on the callback, only compared.
 */
export function instagramAuthorizeUrl(opts: {
  state: string;
  redirectUri: string;
}): string {
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.searchParams.set('client_id', appId());
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('response_type', 'code');
  // Meta documents scope as a COMMA-separated list for this login.
  u.searchParams.set('scope', INSTAGRAM_SCOPES.join(','));
  u.searchParams.set('state', opts.state);
  return u.toString();
}

interface ShortLivedToken {
  accessToken: string;
  /** Instagram's own user id for the connected professional account. */
  userId: string;
}

/**
 * Step 1 of 2: the one-shot `code` → a SHORT-LIVED (1h) token.
 * POST form-encoded, per the docs.
 */
export async function instagramExchangeCode(
  opts: { code: string; redirectUri: string },
  fetchImpl?: FetchLike,
): Promise<ShortLivedToken> {
  if (!instagramConfigured()) {
    throw new MetaHttpError('Instagram app keys are not configured', 0, false);
  }
  const json = await metaFetchJson<any>(
    'https://api.instagram.com/oauth/access_token',
    {
      method: 'POST',
      form: {
        client_id: appId(),
        client_secret: appSecret(),
        grant_type: 'authorization_code',
        redirect_uri: opts.redirectUri,
        code: opts.code,
      },
      fetchImpl,
    },
  );
  const accessToken = String(json?.access_token || '');
  // Meta has shipped this as both `user_id` and (in the permissions-array
  // shape) the same value under `user_id` on the first entry. Read both.
  const userId = String(
    json?.user_id ??
      (Array.isArray(json?.data) ? json.data[0]?.user_id : '') ??
      '',
  );
  if (!accessToken)
    throw new MetaHttpError(
      'Instagram did not return an access token',
      0,
      false,
    );
  return { accessToken, userId };
}

/**
 * Step 2 of 2: short-lived → LONG-LIVED (60 days).
 * `expires_in` is seconds; we turn it into an absolute instant so the refresh
 * decision is a plain date comparison and not clock arithmetic at read time.
 */
export async function instagramExchangeLongLived(
  shortLivedToken: string,
  fetchImpl?: FetchLike,
): Promise<{ accessToken: string; expiresAt: Date }> {
  if (!instagramConfigured()) {
    throw new MetaHttpError('Instagram app keys are not configured', 0, false);
  }
  const u = new URL('https://graph.instagram.com/access_token');
  u.searchParams.set('grant_type', 'ig_exchange_token');
  u.searchParams.set('client_secret', appSecret());
  u.searchParams.set('access_token', shortLivedToken);
  const json = await metaFetchJson<any>(u.toString(), { fetchImpl });
  const accessToken = String(json?.access_token || '');
  if (!accessToken)
    throw new MetaHttpError(
      'Instagram did not return a long-lived token',
      0,
      false,
    );
  const seconds = Number(json?.expires_in);
  const ttl =
    Number.isFinite(seconds) && seconds > 0 ? seconds : 60 * 24 * 60 * 60;
  return { accessToken, expiresAt: new Date(Date.now() + ttl * 1000) };
}

/**
 * Roll a long-lived token forward. Meta requires the token to be at least 24h
 * old and still valid; we run this with >24h old and <10 days remaining (see
 * SocialService.REFRESH_WINDOW_MS), which sits comfortably inside both bounds.
 */
export async function instagramRefreshToken(
  longLivedToken: string,
  fetchImpl?: FetchLike,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const u = new URL('https://graph.instagram.com/refresh_access_token');
  u.searchParams.set('grant_type', 'ig_refresh_token');
  u.searchParams.set('access_token', longLivedToken);
  const json = await metaFetchJson<any>(u.toString(), { fetchImpl });
  const accessToken = String(json?.access_token || '');
  if (!accessToken)
    throw new MetaHttpError(
      'Instagram did not return a refreshed token',
      0,
      false,
    );
  const seconds = Number(json?.expires_in);
  const ttl =
    Number.isFinite(seconds) && seconds > 0 ? seconds : 60 * 24 * 60 * 60;
  return { accessToken, expiresAt: new Date(Date.now() + ttl * 1000) };
}

/** The connected account's own id + handle, for `displayName`. */
export async function instagramFetchProfile(
  accessToken: string,
  fetchImpl?: FetchLike,
): Promise<{ accountId: string; username: string }> {
  const u = new URL(`https://graph.instagram.com/${META_GRAPH_VERSION}/me`);
  u.searchParams.set('fields', 'id,username');
  u.searchParams.set('access_token', accessToken);
  const json = await metaFetchJson<any>(u.toString(), { fetchImpl });
  return {
    accountId: String(json?.id || ''),
    username: String(json?.username || ''),
  };
}

/** The exact field list we request. Kept as a constant so the test asserts the
 *  same string the runtime sends. */
export const INSTAGRAM_MEDIA_FIELDS =
  'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username,children{media_url,media_type}';

/**
 * Newest posts for the connected account.
 *
 * media_type is one of IMAGE | VIDEO | CAROUSEL_ALBUM (per the Instagram
 * Media reference). A VIDEO's `media_url` is the video file and
 * `thumbnail_url` is the still — a signage board wants the still, so we keep
 * both and let the widget choose. A CAROUSEL_ALBUM has no `media_url` of its
 * own; its first child's does, which is why `children{media_url,media_type}`
 * is in the field list.
 */
export async function instagramFetchMedia(
  accessToken: string,
  limit: number,
  fetchImpl?: FetchLike,
): Promise<NormalizedSocialPost[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 30));
  const u = new URL(
    `https://graph.instagram.com/${META_GRAPH_VERSION}/me/media`,
  );
  u.searchParams.set('fields', INSTAGRAM_MEDIA_FIELDS);
  u.searchParams.set('limit', String(safeLimit));
  u.searchParams.set('access_token', accessToken);
  const json = await metaFetchJson<any>(u.toString(), { fetchImpl });
  const rows: any[] = Array.isArray(json?.data) ? json.data : [];
  return rows
    .map(mapInstagramMedia)
    .filter((p): p is NormalizedSocialPost => p !== null);
}

/** One media row → our normalised shape. Exported for the unit test. */
export function mapInstagramMedia(row: any): NormalizedSocialPost | null {
  const providerPostId = String(row?.id || '');
  if (!providerPostId) return null;

  const type = String(row?.media_type || '').toUpperCase();
  const firstChild = Array.isArray(row?.children?.data)
    ? row.children.data[0]
    : null;

  let kind: NormalizedSocialPost['kind'];
  let mediaUrl = safeMediaUrl(row?.media_url);
  const thumbnailUrl = safeMediaUrl(row?.thumbnail_url);

  if (type === 'CAROUSEL_ALBUM') {
    kind = 'carousel';
    // A carousel carries no media_url of its own — fall to the first child.
    if (!mediaUrl) mediaUrl = safeMediaUrl(firstChild?.media_url);
  } else if (type === 'VIDEO') {
    kind = 'video';
  } else if (type === 'IMAGE') {
    kind = 'image';
  } else {
    // An unknown/new media_type still caches as a post with its caption —
    // degrading to text beats dropping the operator's content on the floor.
    kind = mediaUrl ? 'image' : 'text';
  }

  const caption = typeof row?.caption === 'string' ? row.caption : null;
  return {
    providerPostId,
    kind,
    text: caption,
    mediaUrl,
    thumbnailUrl,
    permalink: safeMediaUrl(row?.permalink),
    postedAt: parseProviderDate(row?.timestamp),
  };
}
