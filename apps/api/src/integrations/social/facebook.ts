/**
 * Facebook Page provider (2026-09-12).
 * ────────────────────────────────────
 *
 * PURE URL BUILDERS + TYPED FETCHERS — same contract as instagram.ts: no
 * Nest, no Prisma, no logging, so everything here is unit-testable with a
 * mocked fetch.
 *
 * ── THE THREE-TOKEN DANCE (the bit that is easy to get wrong) ───────────
 *   1. Facebook Login gives us a SHORT-LIVED **user** token for the person
 *      who clicked Connect.
 *   2. We swap it for a LONG-LIVED **user** token (~60 days).
 *   3. We call `/me/accounts`, which returns one **Page** token per Page
 *      that person administers. A Page token derived from a long-lived user
 *      token **does not expire** — that is why `expiresAt` is null for this
 *      provider and the refresh path is skipped entirely.
 *
 * We store the PAGE token, never the user token: it is the narrower
 * credential, it outlives the user token, and it is scoped to exactly the one
 * Page the operator picked. One connection row per Page.
 *
 * ── ENDPOINTS (each verified against Meta's docs on 2026-09-12) ─────────
 *   dialog      GET https://www.facebook.com/{version}/dialog/oauth
 *   exchange    GET https://graph.facebook.com/{version}/oauth/access_token
 *     both: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
 *   long-lived  GET https://graph.facebook.com/{version}/oauth/access_token
 *               ?grant_type=fb_exchange_token
 *   page tokens GET https://graph.facebook.com/{version}/me/accounts
 *     both: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
 *   posts       GET https://graph.facebook.com/{version}/{page-id}/posts
 *     fields + required permissions:
 *       https://developers.facebook.com/docs/graph-api/reference/page/posts/
 *
 * ── PERMISSIONS ────────────────────────────────────────────────────────
 * Meta's Page-posts reference states outright: "The pages_read_engagement
 * permission and The pages_read_user_content permission are required." We ask
 * for `pages_show_list` too, because `/me/accounts` is what enumerates the
 * Pages the operator can choose from. All three are Advanced-Access
 * permissions for arbitrary customers — see instagram.ts's access-level note;
 * with Standard Access this works for Pages OUR OWN app-role users
 * administer, which is what a pilot needs.
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

/**
 * `pages_read_user_content` — NOT `pages_read_user_engagement`, which is what
 * a lot of blog posts (and this task's own brief) say. Meta's Page-posts
 * reference names `pages_read_engagement` + `pages_read_user_content`; asking
 * for a permission that does not exist makes the whole dialog fail, so the
 * doc wins over the folklore.
 */
export const FACEBOOK_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
] as const;

export const FACEBOOK_ENV_VARS = ['META_APP_ID', 'META_APP_SECRET'] as const;

/** Which of this provider's env vars are missing. Empty array = configured. */
export function facebookMissingEnv(): string[] {
  return FACEBOOK_ENV_VARS.filter((k) => !String(process.env[k] || '').trim());
}

export function facebookConfigured(): boolean {
  return facebookMissingEnv().length === 0;
}

function appId(): string {
  return String(process.env.META_APP_ID || '').trim();
}
function appSecret(): string {
  return String(process.env.META_APP_SECRET || '').trim();
}

export function facebookAuthorizeUrl(opts: {
  state: string;
  redirectUri: string;
}): string {
  const u = new URL(
    `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`,
  );
  u.searchParams.set('client_id', appId());
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('state', opts.state);
  u.searchParams.set('response_type', 'code');
  // Facebook documents scope as a COMMA-separated list.
  u.searchParams.set('scope', FACEBOOK_SCOPES.join(','));
  return u.toString();
}

/** Step 1: one-shot `code` → short-lived user token. */
export async function facebookExchangeCode(
  opts: { code: string; redirectUri: string },
  fetchImpl?: FetchLike,
): Promise<{ accessToken: string }> {
  if (!facebookConfigured()) {
    throw new MetaHttpError('Meta app keys are not configured', 0, false);
  }
  const u = new URL(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`,
  );
  u.searchParams.set('client_id', appId());
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('client_secret', appSecret());
  u.searchParams.set('code', opts.code);
  const json = await metaFetchJson<any>(u.toString(), { fetchImpl });
  const accessToken = String(json?.access_token || '');
  if (!accessToken)
    throw new MetaHttpError(
      'Facebook did not return an access token',
      0,
      false,
    );
  return { accessToken };
}

/** Step 2: short-lived user token → long-lived user token. */
export async function facebookExchangeLongLived(
  shortLivedToken: string,
  fetchImpl?: FetchLike,
): Promise<{ accessToken: string }> {
  if (!facebookConfigured()) {
    throw new MetaHttpError('Meta app keys are not configured', 0, false);
  }
  const u = new URL(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`,
  );
  u.searchParams.set('grant_type', 'fb_exchange_token');
  u.searchParams.set('client_id', appId());
  u.searchParams.set('client_secret', appSecret());
  u.searchParams.set('fb_exchange_token', shortLivedToken);
  const json = await metaFetchJson<any>(u.toString(), { fetchImpl });
  const accessToken = String(json?.access_token || '');
  if (!accessToken) {
    throw new MetaHttpError(
      'Facebook did not return a long-lived token',
      0,
      false,
    );
  }
  return { accessToken };
}

export interface FacebookPage {
  pageId: string;
  name: string;
  /** The PAGE access token. Long-lived and non-expiring. */
  accessToken: string;
}

/**
 * Step 3: every Page this person administers, each with its own Page token.
 * One connection row per entry.
 */
export async function facebookFetchPages(
  longLivedUserToken: string,
  fetchImpl?: FetchLike,
): Promise<FacebookPage[]> {
  const u = new URL(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts`,
  );
  u.searchParams.set('fields', 'id,name,access_token');
  u.searchParams.set('limit', '100');
  u.searchParams.set('access_token', longLivedUserToken);
  const json = await metaFetchJson<any>(u.toString(), { fetchImpl });
  const rows: any[] = Array.isArray(json?.data) ? json.data : [];
  return (
    rows
      .map((r) => ({
        pageId: String(r?.id || ''),
        name: String(r?.name || ''),
        accessToken: String(r?.access_token || ''),
      }))
      // A Page with no token is one we cannot read; dropping it is honest.
      .filter((p) => p.pageId && p.accessToken)
  );
}

/** The exact field list we request. Kept as a constant so the test asserts the
 *  same string the runtime sends. */
export const FACEBOOK_POST_FIELDS =
  'id,message,full_picture,permalink_url,created_time,attachments{media_type,media,url}';

/** Newest posts published BY the Page. */
export async function facebookFetchPosts(
  pageId: string,
  pageAccessToken: string,
  limit: number,
  fetchImpl?: FetchLike,
): Promise<NormalizedSocialPost[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 30));
  // The page id comes from OUR OWN stored row, but it is still interpolated
  // into a path — keep it to the digits Meta actually issues.
  const safePageId = String(pageId || '').replace(/[^0-9A-Za-z_]/g, '');
  if (!safePageId)
    throw new MetaHttpError('Missing Facebook Page id', 0, false);
  const u = new URL(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${safePageId}/posts`,
  );
  u.searchParams.set('fields', FACEBOOK_POST_FIELDS);
  u.searchParams.set('limit', String(safeLimit));
  u.searchParams.set('access_token', pageAccessToken);
  const json = await metaFetchJson<any>(u.toString(), { fetchImpl });
  const rows: any[] = Array.isArray(json?.data) ? json.data : [];
  return rows
    .map(mapFacebookPost)
    .filter((p): p is NormalizedSocialPost => p !== null);
}

/** One post row → our normalised shape. Exported for the unit test. */
export function mapFacebookPost(row: any): NormalizedSocialPost | null {
  const providerPostId = String(row?.id || '');
  if (!providerPostId) return null;

  const attachment = Array.isArray(row?.attachments?.data)
    ? row.attachments.data[0]
    : null;
  const attachmentType = String(attachment?.media_type || '').toLowerCase();
  const attachmentImage = safeMediaUrl(attachment?.media?.image?.src);
  const fullPicture = safeMediaUrl(row?.full_picture);
  const mediaUrl = fullPicture || attachmentImage;

  let kind: NormalizedSocialPost['kind'];
  if (attachmentType === 'video') {
    kind = 'video';
  } else if (attachmentType === 'album') {
    kind = 'carousel';
  } else if (mediaUrl) {
    kind = 'image';
  } else if (attachmentType === 'link' || safeMediaUrl(attachment?.url)) {
    kind = 'link';
  } else {
    kind = 'text';
  }

  const message = typeof row?.message === 'string' ? row.message : null;
  return {
    providerPostId,
    kind,
    text: message,
    mediaUrl,
    // A Facebook post has no separate still for a video, so the picture we
    // have IS the thumbnail.
    thumbnailUrl: mediaUrl,
    permalink: safeMediaUrl(row?.permalink_url),
    postedAt: parseProviderDate(row?.created_time),
  };
}
