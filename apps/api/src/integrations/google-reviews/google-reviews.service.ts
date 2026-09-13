/**
 * GoogleReviewsService — server-side Places API (New) reader for the
 * GOOGLE_REVIEWS widget.
 *
 * ── WHAT REPLACED WHAT ───────────────────────────────────────────────────
 * `apps/web/src/components/apps/app-registry.ts` carried a `google-reviews`
 * tile marked `comingSoon` whose `build()` returned an EMPTY `SOCIAL_FEED`
 * config. This module is the real thing behind it.
 *
 * ── THE KEY NEVER LEAVES THE SERVER ──────────────────────────────────────
 * `GOOGLE_MAPS_API_KEY` is already a server-only secret (see the geocode
 * proxy — CLAUDE.md's env table says so in as many words). Every call here
 * passes it in the `X-Goog-Api-Key` HEADER, never in the URL: a key in a query
 * string lands in access logs, in `Referer`, and in any proxy in between.
 * Nothing in this file logs the key, and no error path echoes an upstream body
 * back to the caller (a Google error body can quote the request, key included).
 *
 * ── THE FIELD MASK IS THE BILL ───────────────────────────────────────────
 * Places API (New) charges by the SKU the requested fields fall into, so
 * `X-Goog-FieldMask` is the cost control, not a convenience. `reviews` is the
 * one field in `DETAILS_FIELD_MASK` that pulls the whole request into the
 * **Place Details Enterprise + Atmosphere** SKU — the most expensive Places
 * tier. Adding a field is therefore a spend decision; the mask is asserted
 * exactly, character for character, by `google-reviews.service.spec.ts`, and
 * the 6-hour response cache (`google-reviews-cache.ts`) is what keeps a fleet
 * of screens from buying one Enterprise call each.
 *
 * ── WHAT GOOGLE RETURNS, AND WHAT WE MAY SAY ABOUT IT ────────────────────
 * At most FIVE reviews come back, and they are **Google's own selection** —
 * the API does not promise "newest", and neither may we. Every surface says
 * "Reviews from Google", never "Latest reviews"; `relativePublishTimeDescription`
 * is passed through verbatim as `relative` so the age shown on a wall is
 * Google's sentence, not a number this product computed at render time (a
 * render-time clock on a signage player is wrong by minutes routinely and by
 * hours when NTP has stepped).
 *
 * Attribution is a policy REQUIREMENT, not decoration — Places API Policies,
 * "Photos and reviews": *"You must always credit the author when displaying
 * photos or reviews. Each photo and review includes an author attribution
 * (author's avatar image, name, and profile link)."* So `authorAttribution`'s
 * three parts and each review's own `googleMapsUri` are all carried through to
 * the widget; dropping any of them upstream would make the widget unable to
 * comply no matter how it renders.
 */

import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../realtime/redis.service';
import {
  getCachedReviews,
  setCachedReviews,
  REVIEWS_CACHE_TTL_SECONDS,
} from './google-reviews-cache';

/** Fixed upstream host. Nothing here takes a caller-supplied URL, so there is
 *  no SSRF surface and no need for `safeFetch`'s DNS pinning — the only
 *  caller-supplied value is a place id, which is validated and then
 *  percent-encoded into ONE path segment. */
export const PLACES_HOST = 'https://places.googleapis.com';

/**
 * EXACTLY the fields the widget renders — nothing speculative.
 *   id                → echo, so a cached payload can be proven to match
 *   displayName       → the business name in the header
 *   rating            → the big star number
 *   userRatingCount   → "based on N reviews"
 *   googleMapsUri     → the place's own Google Maps link (policy: the viewer
 *                       must be able to reach the source on Google Maps)
 *   reviews           → the review objects themselves. THIS is the field that
 *                       bills at Place Details Enterprise + Atmosphere.
 */
export const DETAILS_FIELD_MASK = 'id,displayName,rating,userRatingCount,googleMapsUri,reviews';

/** Text Search mask for the operator's "find my business" picker. Three
 *  fields, all in the cheapest Text Search tier — enough to show a
 *  disambiguating list and nothing more. */
export const SEARCH_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress';

/** Outbound budget. 8s, per the integration brief. */
export const PLACES_TIMEOUT_MS = 8000;

/** Google returns at most five; cap defensively so a provider change cannot
 *  quietly widen what we store or bill for. */
export const MAX_REVIEWS = 5;

/** Candidates returned by the operator-facing place search. */
export const MAX_SEARCH_CANDIDATES = 5;

/**
 * Place IDs are opaque base64url-ish tokens (`ChIJ_fixture_place_id_0000000000`).
 * Validated rather than trusted because it is interpolated into a URL PATH:
 * a `/`, a `.` or a `%2e` there is a path-traversal attempt against
 * places.googleapis.com, and `encodeURIComponent` alone would still let a
 * caller probe unrelated endpoints via a decoded `..`.
 */
const PLACE_ID_RE = /^[A-Za-z0-9_-]{5,512}$/;

export function isValidPlaceId(placeId: string): boolean {
  return PLACE_ID_RE.test(placeId);
}

/** An upstream failure, already reduced to something safe to show a caller.
 *  `message` is the plain-English sentence; the raw Google body never
 *  escapes this module. */
export class GoogleReviewsProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'PLACE_NOT_FOUND'
      | 'PROVIDER_REJECTED'
      | 'PROVIDER_UNAVAILABLE'
      | 'PROVIDER_MALFORMED',
  ) {
    super(message);
    this.name = 'GoogleReviewsProviderError';
  }
}

export interface GoogleReviewCandidate {
  placeId: string;
  name: string;
  address: string;
}

export interface GoogleReviewItem {
  /** Author's display name — required attribution. */
  author: string;
  /** Author's Google profile link — required attribution when space allows. */
  authorUri: string | null;
  /** Author's avatar — the MINIMUM attribution the policy accepts when space
   *  is tight, so it is never optional upstream. */
  photoUri: string | null;
  rating: number | null;
  /** The reviewer's own words, unedited. Clipping for layout happens in CSS
   *  at render time; the string is never rewritten. */
  text: string;
  /** ISO timestamp from Google. Present for ordering/debugging only — the UI
   *  shows `relative`. */
  publishedAt: string | null;
  /** Google's own phrasing ("a month ago"). Never computed here. */
  relative: string | null;
  /** This individual review on Google Maps. Policy: *"For each photo and
   *  review, end-users must always have access to view the individual source
   *  photo or review on Google Maps using the provided googleMapsUri."* */
  reviewUri: string | null;
}

export interface GoogleReviewsPlace {
  name: string;
  rating: number | null;
  count: number | null;
  mapsUri: string | null;
}

export interface GoogleReviewsPayload {
  place: GoogleReviewsPlace;
  reviews: GoogleReviewItem[];
  /** When the bytes were actually fetched from Google. The ONLY legitimate
   *  source of any freshness label anywhere in the product — a cache hit
   *  carries the ORIGINAL fetch time, not the time it was served. */
  fetchedAt: string;
}

/** Raw shapes we read off the Places (New) JSON. Narrow on purpose. */
interface RawAuthorAttribution {
  displayName?: unknown;
  uri?: unknown;
  photoUri?: unknown;
}
interface RawReview {
  rating?: unknown;
  text?: { text?: unknown } | unknown;
  originalText?: { text?: unknown } | unknown;
  authorAttribution?: RawAuthorAttribution;
  publishTime?: unknown;
  relativePublishTimeDescription?: unknown;
  googleMapsUri?: unknown;
}
interface RawPlaceDetails {
  id?: unknown;
  displayName?: { text?: unknown } | unknown;
  rating?: unknown;
  userRatingCount?: unknown;
  googleMapsUri?: unknown;
  reviews?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function localizedText(v: unknown): string | null {
  if (typeof v === 'string') return str(v);
  if (v && typeof v === 'object' && 'text' in (v as Record<string, unknown>)) {
    return str((v as { text?: unknown }).text);
  }
  return null;
}

function finiteNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

@Injectable()
export class GoogleReviewsService {
  private readonly logger = new Logger(GoogleReviewsService.name);

  /** `RedisService` comes free from the @Global RealtimeModule (same as
   *  FeedsService). `publisher` is null when Redis is absent — the cache falls
   *  back to its per-replica LRU and nothing here fails. */
  constructor(private readonly redis: RedisService) {}

  private get apiKey(): string | undefined {
    const k = process.env.GOOGLE_MAPS_API_KEY;
    return k && k.trim() ? k.trim() : undefined;
  }

  /** Is the integration configured at all? Never throws, never logs the key. */
  enabled(): boolean {
    return !!this.apiKey;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Outbound
  // ──────────────────────────────────────────────────────────────────────

  /**
   * One Places call. The key rides the `X-Goog-Api-Key` header, the mask rides
   * `X-Goog-FieldMask`, and the request is bounded at 8s across the BODY read
   * (the abort signal is attached to the fetch, so a headers-then-stall
   * upstream cannot wedge us — the same failure class as player rule 4's
   * `fetchJsonBounded`).
   */
  private async callPlaces(
    url: string,
    fieldMask: string,
    init: { method: 'GET' | 'POST'; body?: string },
  ): Promise<unknown> {
    const key = this.apiKey;
    if (!key) throw new GoogleReviewsProviderError('Google Places is not configured.', 'PROVIDER_UNAVAILABLE');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PLACES_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method,
        headers: {
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': fieldMask,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
        signal: controller.signal,
      });
    } catch {
      // Network error / abort. Deliberately does NOT include the thrown
      // message: an undici error can carry the full request line.
      throw new GoogleReviewsProviderError(
        'Google Places did not respond in time. Showing the last reviews we have.',
        'PROVIDER_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // Read and DISCARD the body so the socket is released, then map by
      // status only. Nothing from the body reaches the caller or the log.
      try {
        await res.text();
      } catch {
        /* ignore */
      }
      this.logger.warn(`Places API responded ${res.status} (field mask: ${fieldMask})`);
      if (res.status === 404) {
        throw new GoogleReviewsProviderError(
          'Google doesn’t recognise that business any more. Pick it again in the Apps tab.',
          'PLACE_NOT_FOUND',
        );
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new GoogleReviewsProviderError(
          'Google refused the request — the API key needs “Places API (New)” enabled and unrestricted for this server.',
          'PROVIDER_REJECTED',
        );
      }
      if (res.status === 429) {
        throw new GoogleReviewsProviderError(
          'Google Places is rate-limiting this key right now. It will retry on its own.',
          'PROVIDER_UNAVAILABLE',
        );
      }
      throw new GoogleReviewsProviderError('Google Places is not answering right now.', 'PROVIDER_UNAVAILABLE');
    }

    try {
      return await res.json();
    } catch {
      throw new GoogleReviewsProviderError('Google Places sent something we could not read.', 'PROVIDER_MALFORMED');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Place search (operator-facing)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Text Search so the operator never has to hunt for a place ID. Returns at
   * most five candidates; an empty array is a real answer ("we found nothing"),
   * never an error.
   */
  async searchPlaces(query: string): Promise<GoogleReviewCandidate[]> {
    const q = (query || '').trim();
    if (q.length < 3) return [];
    const body = await this.callPlaces(`${PLACES_HOST}/v1/places:searchText`, SEARCH_FIELD_MASK, {
      method: 'POST',
      body: JSON.stringify({ textQuery: q }),
    });
    const places = (body as { places?: unknown })?.places;
    if (!Array.isArray(places)) return [];
    const out: GoogleReviewCandidate[] = [];
    for (const p of places) {
      const row = p as { id?: unknown; displayName?: unknown; formattedAddress?: unknown };
      const placeId = str(row.id);
      const name = localizedText(row.displayName);
      if (!placeId || !name || !isValidPlaceId(placeId)) continue;
      out.push({ placeId, name, address: localizedText(row.formattedAddress) ?? '' });
      if (out.length >= MAX_SEARCH_CANDIDATES) break;
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Reviews
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Reviews for one business, served from the 6-hour cache when warm.
   *
   * `fetchedAt` is stamped at the moment of the REAL fetch and then travels
   * inside the cached blob, so a cache hit reports when Google was actually
   * asked. Stamping it on the way out would make every response claim to be
   * seconds old, which is exactly the kind of freshness lie player rule 10
   * exists to forbid.
   */
  async getReviews(placeId: string): Promise<{ payload: GoogleReviewsPayload; cached: boolean }> {
    if (!isValidPlaceId(placeId)) {
      throw new GoogleReviewsProviderError('That doesn’t look like a Google business id.', 'PLACE_NOT_FOUND');
    }
    const redis = this.redis?.publisher ?? null;
    const hit = await getCachedReviews(redis, placeId);
    if (hit) {
      try {
        const parsed = JSON.parse(hit) as GoogleReviewsPayload;
        if (parsed && parsed.place && Array.isArray(parsed.reviews) && typeof parsed.fetchedAt === 'string') {
          return { payload: parsed, cached: true };
        }
      } catch {
        // Corrupt entry — fall through to a fresh fetch rather than fail.
      }
    }

    const raw = (await this.callPlaces(
      `${PLACES_HOST}/v1/places/${encodeURIComponent(placeId)}`,
      DETAILS_FIELD_MASK,
      { method: 'GET' },
    )) as RawPlaceDetails;

    const payload = this.mapDetails(raw);
    await setCachedReviews(redis, placeId, JSON.stringify(payload), REVIEWS_CACHE_TTL_SECONDS);
    return { payload, cached: false };
  }

  /** Places (New) JSON → the widget's payload. Exported behaviour is pinned by
   *  the spec; every field is optional upstream, so every read is defensive. */
  private mapDetails(raw: RawPlaceDetails): GoogleReviewsPayload {
    const reviewsRaw = Array.isArray(raw?.reviews) ? (raw.reviews as RawReview[]) : [];
    const reviews: GoogleReviewItem[] = [];
    for (const r of reviewsRaw) {
      // `text` is the (possibly Google-translated) display text; `originalText`
      // is the author's own language. Prefer `text` — it is what Google shows
      // — and fall back to `originalText` when a review has no translation.
      const body = localizedText(r?.text) ?? localizedText(r?.originalText);
      const attribution = (r?.authorAttribution ?? {}) as RawAuthorAttribution;
      const author = str(attribution.displayName);
      // A review we cannot attribute is a review we are not allowed to show
      // (Places API Policies, "Photos and reviews"). Dropping it is the only
      // compliant option; rendering it anonymously is not.
      if (!body || !author) continue;
      reviews.push({
        author,
        authorUri: str(attribution.uri),
        photoUri: str(attribution.photoUri),
        rating: finiteNumber(r?.rating),
        text: body,
        publishedAt: str(r?.publishTime),
        relative: str(r?.relativePublishTimeDescription),
        reviewUri: str(r?.googleMapsUri),
      });
      if (reviews.length >= MAX_REVIEWS) break;
    }

    return {
      place: {
        name: localizedText(raw?.displayName) ?? '',
        rating: finiteNumber(raw?.rating),
        count: finiteNumber(raw?.userRatingCount),
        mapsUri: str(raw?.googleMapsUri),
      },
      reviews,
      fetchedAt: new Date().toISOString(),
    };
  }
}
