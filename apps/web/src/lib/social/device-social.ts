/**
 * device-social.ts — the player-side, device-authed social-post fetch.
 * ───────────────────────────────────────────────────────────────────
 *
 * Same job, same shape and the same hard-won contract as
 * `apps/web/src/lib/menu/device-menu.ts`:
 *
 *   • On a REAL PLAYER (a device JWT in localStorage) the fetch carries
 *     `Authorization: Bearer <device token>`. This is the whole reason
 *     `GET /integrations/social/posts` is guarded by `JwtAuthGuard` ALONE
 *     rather than `JwtAuthGuard + RbacGuard`: a device token has a tenantId
 *     but no role, so an RBAC-guarded endpoint 403s it. The menu board
 *     already learned this the expensive way — it demoed perfectly in the
 *     dashboard preview and was dead on every wall.
 *   • In the DASHBOARD (an operator session, no device token) the same call
 *     goes through the injected `apiFetch`, which attaches the user JWT.
 *
 * ── THE null / [] / data CONTRACT (do not collapse these) ───────────────
 *   `null`   = FAILURE. Network error, non-2xx, nothing configured. The
 *              caller KEEPS its last good list.
 *   `[]`     = DATA. The account really has no posts (or the connection was
 *              disconnected). The caller CLEARS.
 *   array    = DATA.
 *
 * device-menu.ts carries the same comment because collapsing "empty" into
 * "failed" is what kept sold-out items, with their prices, on a live menu
 * board indefinitely. A social wall has the milder version of the same bug —
 * deleted posts that never go away — and the identical fix.
 *
 * Chromium-83 / Taurus-safe: plain fetch + JSON, no modern-only APIs.
 */

const LS_DEVICE_TOKEN = 'edu_device_token';
const LS_MANIFEST_CACHE = 'edu_manifest_cache_v1';
/** Last good posts, per connection, so a cold boot with no uplink still
 *  paints something real rather than an empty frame. */
const LS_LAST_GOOD_PREFIX = 'venueos_social_lastgood_';

export interface SocialPostView {
  id: string;
  connectionId: string;
  kind: string;
  text: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  /** ISO */
  postedAt: string;
}

function getQueryParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

/** Resolve the device JWT the same way device-menu.ts does: URL `?token=`
 *  then localStorage, so the two never disagree about which credential is in
 *  play. (The player's own stored-wins rule governs what gets WRITTEN; this
 *  is a read.) */
export function resolveDeviceToken(): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = getQueryParam('token');
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem(LS_DEVICE_TOKEN);
  } catch {
    return null;
  }
}

/** True when we are running as a real paired device. */
export function hasDeviceContext(): boolean {
  if (typeof window === 'undefined') return false;
  if (!resolveDeviceToken()) return false;
  // A device token alone is enough for this endpoint (it carries tenantId),
  // but require the manifest cache / screen id too so a dashboard tab that
  // happens to have a stale token does not take the device path.
  try {
    if (localStorage.getItem(LS_MANIFEST_CACHE)) return true;
  } catch {
    /* storage blocked */
  }
  return !!getQueryParam('screenId') || !!(window as any).__VENUEOS_SCREEN_ID__;
}

/**
 * The API origin, WITHOUT the `/api/v1` suffix.
 *
 * `NEXT_PUBLIC_API_URL` is documented as including `/api/v1`
 * (`apps/web/src/lib/api-url.ts`), so a naive `${env}/api/v1/...` yields
 * `/api/v1/api/v1/...`. The player strips the suffix for exactly this reason
 * (`getApiRoot` in app/player/page.tsx); we do the same.
 */
export function socialApiRoot(): string {
  const fromEnv =
    (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_API_URL) || '';
  const root = fromEnv || (typeof window !== 'undefined' ? window.location.origin : '');
  return root.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
}

function mapRows(rows: any[]): SocialPostView[] {
  return rows
    .filter((r) => r && typeof r.id === 'string')
    .map((r) => ({
      id: String(r.id),
      connectionId: String(r.connectionId || ''),
      kind: String(r.kind || 'text'),
      text: typeof r.text === 'string' ? r.text : null,
      mediaUrl: typeof r.mediaUrl === 'string' ? r.mediaUrl : null,
      thumbnailUrl: typeof r.thumbnailUrl === 'string' ? r.thumbnailUrl : null,
      permalink: typeof r.permalink === 'string' ? r.permalink : null,
      postedAt: typeof r.postedAt === 'string' ? r.postedAt : new Date(0).toISOString(),
    }));
}

/** Accept either a bare array or `{ posts: [...] }`. */
function rowsFromBody(body: any): any[] | null {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.posts)) return body.posts;
  return null;
}

/** Credential-free connection facts the widget renders an honest state from.
 *  `null` when the caller named a connection that is not theirs. */
export interface SocialConnectionView {
  id: string;
  providerId: string;
  displayName: string | null;
  status: string;
  lastSyncedAt: string | null;
}

function connectionFromBody(body: any): SocialConnectionView | null {
  const c = body && typeof body === 'object' ? body.connection : null;
  if (!c || typeof c.id !== 'string') return null;
  return {
    id: String(c.id),
    providerId: String(c.providerId || ''),
    displayName: typeof c.displayName === 'string' ? c.displayName : null,
    status: String(c.status || ''),
    lastSyncedAt: typeof c.lastSyncedAt === 'string' ? c.lastSyncedAt : null,
  };
}

export interface FetchSocialOptions {
  connectionId: string;
  limit?: number;
  signal?: AbortSignal;
}

/** A SUCCESSFUL answer. `posts` may legitimately be empty. */
export interface SocialFetchResult {
  posts: SocialPostView[];
  connection: SocialConnectionView | null;
}

/**
 * Fetch this device's (or this operator's) cached posts for one connection.
 * See the null / [] / data contract above.
 */
export async function fetchSocialPosts(
  opts: FetchSocialOptions,
  apiFetchFallback: (path: string, init?: { signal?: AbortSignal }) => Promise<any>,
): Promise<SocialFetchResult | null> {
  const connectionId = String(opts.connectionId || '').trim();
  if (!connectionId) return null;
  const limit = Math.max(1, Math.min(50, Math.floor(opts.limit ?? 12)));
  const qs = `?connectionId=${encodeURIComponent(connectionId)}&limit=${limit}`;

  // ── Player path: the device JWT ──
  const deviceToken = hasDeviceContext() ? resolveDeviceToken() : null;
  if (deviceToken) {
    try {
      const res = await fetch(`${socialApiRoot()}/api/v1/integrations/social/posts${qs}`, {
        headers: { Authorization: `Bearer ${deviceToken}` },
        cache: 'no-store',
        signal: opts.signal,
      });
      if (res.ok) {
        const body = await res.json();
        const rows = rowsFromBody(body);
        // A malformed body is a FAILURE (keep last good); an empty array is
        // DATA (clear).
        return rows ? { posts: mapRows(rows), connection: connectionFromBody(body) } : null;
      }
      // 404 = endpoint not deployed yet; fall through so the dashboard
      // preview still works. Anything else is a real failure.
      if (res.status !== 404) return null;
    } catch {
      return null;
    }
  }

  // ── Dashboard path: the operator session ──
  try {
    const body = await apiFetchFallback(`/integrations/social/posts${qs}`, {
      signal: opts.signal,
    });
    const rows = rowsFromBody(body);
    return rows ? { posts: mapRows(rows), connection: connectionFromBody(body) } : null;
  } catch {
    return null;
  }
}

// ─── last-good cache ──────────────────────────────────────────────────
//
// Per-viewer, per-connection, in localStorage. Not a substitute for the
// SERVER-side cache (SocialPost) — that is what survives a Meta outage. This
// is the thinner guarantee: a kiosk that boots with no uplink paints the
// posts it had before the reboot instead of an empty frame.

export function readLastGood(connectionId: string): SocialPostView[] | null {
  if (typeof window === 'undefined' || !connectionId) return null;
  try {
    const raw = localStorage.getItem(LS_LAST_GOOD_PREFIX + connectionId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const rows = rowsFromBody(parsed);
    return rows ? mapRows(rows) : null;
  } catch {
    return null;
  }
}

export function writeLastGood(connectionId: string, posts: SocialPostView[]): void {
  if (typeof window === 'undefined' || !connectionId) return;
  try {
    // Cap what we persist — a kiosk's storage quota is not ours to fill.
    localStorage.setItem(
      LS_LAST_GOOD_PREFIX + connectionId,
      JSON.stringify({ posts: posts.slice(0, 12) }),
    );
  } catch {
    /* quota / private mode — the feature degrades, it never throws */
  }
}

/** Poll cadence. Posts are not life-safety and the server only refreshes from
 *  Meta hourly, so anything faster just burns fleet requests for no new data.
 *  Five minutes keeps a "we just posted this" edit on screen within one
 *  rotation of the board. */
export const SOCIAL_POLL_INTERVAL_MS = 5 * 60_000;
