/**
 * google-reviews-client — the ONE place the GOOGLE_REVIEWS widget talks to
 * the API, on both of the surfaces it renders on.
 *
 * ── TWO SURFACES, ONE CREDENTIAL EACH ────────────────────────────────────
 * Same split as `lib/menu/device-menu.ts`, and for the same reason: on a real
 * wall the player holds a DEVICE token and no session, while the builder holds
 * an operator session and no device token. So:
 *   • device context (a resolvable `edu_device_token`) → a plain `fetch` with
 *     `Authorization: Bearer <device token>`;
 *   • otherwise → `apiFetch`, which attaches the user JWT.
 * `resolveDeviceToken` is imported from device-menu rather than re-implemented,
 * because two copies of "where does the device token live" is precisely the
 * three-disagreeing-token-stores failure the player reliability program was
 * written to end (CLAUDE.md player rule 3).
 *
 * ── WHY IT ADDRESSES `API_URL` DIRECTLY ──────────────────────────────────
 * CLAUDE.md's GATEWAY_SHARED_SECRET note is explicit: never add a NEW relative
 * `/api/v1` fetch on the web origin — use `API_URL`. The player's same-origin
 * gateway allowlist (`app/player/gatewayPaths.ts`) is a deliberately narrow
 * list and must not be widened for a reviews board. The consequence is stated
 * rather than hidden: on one of the rare WebView units that can ONLY reach the
 * web origin, reviews will not load and the widget falls back to its last good
 * payload, then to a quiet empty zone. Reviews are not life-safety.
 *
 * NOTE (out of scope here, reported instead of copied): device-menu's own
 * `getApiRoot()` returns `NEXT_PUBLIC_API_URL` *unstripped* and then appends
 * `/api/v1/...`, which doubles the prefix on any deploy where that env var
 * ends in `/api/v1` — which is the documented format. This module appends to
 * `API_URL` exactly the way `apiFetch` does instead, so the two paths agree.
 *
 * ── THE null / [] / DATA CONTRACT (do not collapse it) ───────────────────
 * `fetchGoogleReviews` returns:
 *   • `null`                      → the request FAILED. Absence of data.
 *                                   The caller may keep the last good payload.
 *   • `{ enabled: false, … }`     → a real answer: no API key on this deploy.
 *   • `{ reviews: [] }`           → a real answer: nothing matched. This
 *                                   REPLACES the last good list.
 * Collapsing an empty success into `null` is the exact bug that kept sold-out
 * items — and their prices — on menu boards for months (device-menu.ts,
 * 2026-09-11). An empty result is DATA; only a failure is an absence of it.
 *
 * ── THE LAST-GOOD CACHE IS BOUNDED, ON PURPOSE ───────────────────────────
 * A screen that loses its uplink keeps showing the reviews it last had, so the
 * board does not go blank — but not forever. Google Maps Platform Service
 * Specific Terms §5.4 permits only *temporary* caching of Places content (the
 * longest window it names for any Places value is 30 consecutive calendar
 * days, and the ONLY value exempt from the restriction outright is the place
 * ID). `LAST_GOOD_MAX_AGE_MS` is 24 hours: long enough to ride out any outage
 * a signage screen realistically sees, two orders of magnitude inside the
 * ceiling, and old enough that nobody is looking at a year-old star rating.
 */

import { apiFetch } from '@/lib/api-client';
import { API_URL } from '@/lib/api-url';
import { resolveDeviceToken } from '@/lib/menu/device-menu';

export interface GoogleReviewItem {
  /** Required attribution — the author's display name. */
  author: string;
  /** Required attribution — the author's Google profile link, when present. */
  authorUri: string | null;
  /** Required attribution — the author's avatar. The policy's MINIMUM when
   *  space is tight, so it is never dropped in transit. */
  photoUri: string | null;
  rating: number | null;
  /** The reviewer's own words. Never rewritten — layout clipping is CSS. */
  text: string;
  publishedAt: string | null;
  /** Google's own phrasing ("a month ago"). Never computed at render time. */
  relative: string | null;
  /** This review on Google Maps. */
  reviewUri: string | null;
}

export interface GoogleReviewsPlace {
  name: string;
  rating: number | null;
  count: number | null;
  mapsUri: string | null;
}

export interface GoogleReviewsPayload {
  /** False when the deploy has no Google Maps API key. A real answer, not an error. */
  enabled: boolean;
  place: GoogleReviewsPlace | null;
  reviews: GoogleReviewItem[];
  /** When Google was ACTUALLY called (stamped server-side, travels inside the
   *  cached blob). The only value any freshness label may be built from. */
  fetchedAt: string | null;
}

export interface GoogleReviewCandidate {
  placeId: string;
  name: string;
  address: string;
}

/** Reviews change on the scale of days; the server caches for 6 hours. Half an
 *  hour keeps a wall current without buying anything. */
export const GOOGLE_REVIEWS_POLL_INTERVAL_MS = 30 * 60 * 1000;

/** How long a screen may keep showing the last payload it successfully got.
 *  See the header for why this number exists and why it is 24h. */
export const LAST_GOOD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const LS_PREFIX = 'venueos_greviews_v1:';

const REVIEWS_PATH = '/integrations/google-reviews/reviews';
const STATUS_PATH = '/integrations/google-reviews/status';
const SEARCH_PATH = '/integrations/google-reviews/places/search';

function isPayload(v: unknown): v is GoogleReviewsPayload {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<GoogleReviewsPayload>;
  return typeof p.enabled === 'boolean' && Array.isArray(p.reviews);
}

/** Normalise whatever the API returned into the payload shape, or null when it
 *  is not a shape we can trust. */
function toPayload(body: unknown): GoogleReviewsPayload | null {
  if (!isPayload(body)) return null;
  return {
    enabled: body.enabled,
    place: body.place ?? null,
    reviews: body.reviews,
    fetchedAt: typeof body.fetchedAt === 'string' ? body.fetchedAt : null,
  };
}

// ── last-good, on the device ───────────────────────────────────────────────

interface StoredPayload {
  payload: GoogleReviewsPayload;
  storedAt: number;
}

export function readLastGoodReviews(placeId: string): GoogleReviewsPayload | null {
  if (typeof window === 'undefined' || !placeId) return null;
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + placeId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPayload;
    if (!parsed || typeof parsed.storedAt !== 'number' || !isPayload(parsed.payload)) return null;
    if (Date.now() - parsed.storedAt > LAST_GOOD_MAX_AGE_MS) {
      // Past the window we allow ourselves to hold Places content. Drop it
      // rather than show it — a blank zone is honest, a stale one is not.
      try {
        window.localStorage.removeItem(LS_PREFIX + placeId);
      } catch {
        /* ignore */
      }
      return null;
    }
    return parsed.payload;
  } catch {
    return null;
  }
}

export function writeLastGoodReviews(placeId: string, payload: GoogleReviewsPayload): void {
  if (typeof window === 'undefined' || !placeId) return;
  try {
    const stored: StoredPayload = { payload, storedAt: Date.now() };
    window.localStorage.setItem(LS_PREFIX + placeId, JSON.stringify(stored));
  } catch {
    // Private mode / quota. The widget still has the payload in memory for
    // this session; only the offline-restore is lost.
  }
}

// ── fetching ───────────────────────────────────────────────────────────────

/**
 * Reviews for one business.
 *
 * Returns `null` for a FAILURE and a payload for a success — including a
 * success whose `reviews` array is empty. See the header.
 */
export async function fetchGoogleReviews(
  placeId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<GoogleReviewsPayload | null> {
  const id = (placeId || '').trim();
  if (!id) return null;
  const query = `?placeId=${encodeURIComponent(id)}`;
  const deviceToken = resolveDeviceToken();

  if (deviceToken) {
    try {
      const res = await fetch(`${API_URL}${REVIEWS_PATH}${query}`, {
        headers: { Authorization: `Bearer ${deviceToken}` },
        cache: 'no-store',
        signal: opts.signal,
      });
      if (!res.ok) return null;
      return toPayload(await res.json());
    } catch {
      return null;
    }
  }

  try {
    return toPayload(await apiFetch<unknown>(`${REVIEWS_PATH}${query}`, opts as never));
  } catch {
    return null;
  }
}

/** Is the integration configured on this deploy? `null` means we could not
 *  find out — which the caller must NOT render as "not configured". */
export async function fetchGoogleReviewsStatus(): Promise<boolean | null> {
  try {
    const body = await apiFetch<{ enabled?: unknown }>(STATUS_PATH);
    return typeof body?.enabled === 'boolean' ? body.enabled : null;
  } catch {
    return null;
  }
}

/** Operator-facing business search. Session only, server-side. */
export async function searchGooglePlaces(query: string): Promise<GoogleReviewCandidate[]> {
  const q = (query || '').trim();
  if (q.length < 3) return [];
  const body = await apiFetch<{ candidates?: unknown }>(SEARCH_PATH, {
    method: 'POST',
    body: JSON.stringify({ query: q }),
  } as never);
  const rows = body?.candidates;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (r): r is GoogleReviewCandidate =>
        !!r && typeof (r as GoogleReviewCandidate).placeId === 'string' && typeof (r as GoogleReviewCandidate).name === 'string',
    )
    .map((r) => ({ placeId: r.placeId, name: r.name, address: typeof r.address === 'string' ? r.address : '' }));
}

// ── selection ──────────────────────────────────────────────────────────────

/**
 * Apply the operator's two display choices.
 *
 * `minRating` FILTERS and `maxItems` CAPS, and the widget is required to SAY
 * so next to the attribution — Places API Policies, "Reviews": *"Include a
 * clear notice that describes how reviews are being ordered and filtered
 * including any search criteria applied."* A review with no rating at all is
 * kept when `minRating` is 0 and dropped otherwise; we cannot assert it clears
 * a bar we cannot measure.
 */
export function selectReviews(
  reviews: GoogleReviewItem[],
  opts: { minRating?: number; maxItems?: number },
): GoogleReviewItem[] {
  const min = Number.isFinite(opts.minRating) ? Math.max(0, Math.min(5, Number(opts.minRating))) : 0;
  const cap = Number.isFinite(opts.maxItems) ? Math.max(1, Math.min(5, Math.floor(Number(opts.maxItems)))) : 5;
  const kept = reviews.filter((r) => {
    if (min <= 0) return true;
    return typeof r.rating === 'number' && r.rating >= min;
  });
  return kept.slice(0, cap);
}
