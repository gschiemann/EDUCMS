import { apiFetch } from './api-client';

/** A geocode hit in the same {display_name, lat, lon} shape the pickers
 *  already consume from Nominatim/Photon, so mapping is trivial. */
export interface GeoHit {
  display_name: string;
  lat: string;
  lon: string;
  source?: 'google' | 'census' | 'nominatim' | string;
}

/** Full server response — `hits` plus enough metadata for a picker to
 *  surface an honest "why is search less precise" note (mobile bug #216,
 *  2026-07-01). `googleConfigured` is false when the deploy has no
 *  GOOGLE_MAPS_API_KEY, meaning search rode the free Census/Nominatim tiers
 *  instead of Google's authoritative match. */
export interface GeoApiResponse {
  hits: GeoHit[];
  provider: 'google' | 'census' | 'nominatim' | string | null;
  googleConfigured: boolean | null;
}

// ── Region bias ───────────────────────────────────────────────────────────
// An ambiguous street ("Emory Oak Ct" exists in TX *and* CA) must resolve to
// the one near the OPERATOR, not a far-away same-named street. We bias geocodes
// by the operator's coarse browser location. Requested ONCE per session, cached,
// and never blocks typing: `undefined` = not asked yet, `null` = denied/unavailable.
let biasCache: { lat: number; lng: number } | null | undefined = undefined;
let biasInFlight = false;

/**
 * Kick off the one-time geolocation request (call on picker mount so the
 * permission prompt happens before the user types). Resolves fast on repeat
 * calls. Safe to call repeatedly; only the first does anything.
 */
export function primeLocationBias(): void {
  if (biasCache !== undefined || biasInFlight) return;
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    biasCache = null;
    return;
  }
  biasInFlight = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      biasCache = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      biasInFlight = false;
    },
    () => {
      biasCache = null; // denied / unavailable — geocode unbiased, still works
      biasInFlight = false;
    },
    { timeout: 4000, maximumAge: 10 * 60_000, enableHighAccuracy: false },
  );
}

/** The cached bias if the operator has granted location this session, else null. */
export function currentLocationBias(): { lat: number; lng: number } | null {
  return biasCache ?? null;
}

/**
 * Server-side geocode via `GET /api/v1/geocode`. Provider chain (server-side,
 * mobile bug #216, 2026-07-01): Google (when GOOGLE_MAPS_API_KEY is set) →
 * US Census Bureau Geocoder (free, keyless, real US house-number coverage) →
 * OSM Nominatim (final fallback). The Google key never leaves the server.
 *
 * Automatically biases by the operator's location (see primeLocationBias) so
 * same-named streets resolve to the nearby one. Pass `bias` to override (e.g.
 * a tenant centroid). Returns full metadata (`hits` + `provider` +
 * `googleConfigured`) on ANY success, and an empty/unconfigured shape on
 * failure so callers can fall back to their own client-side providers.
 */
export async function geocodeViaApiFull(
  query: string,
  bias?: { lat: number; lng: number } | null,
): Promise<GeoApiResponse> {
  const q = (query || '').trim();
  // googleConfigured: null = WE DON'T KNOW (request failed / never asked) —
  // only a real server answer may say false. A transient error used to
  // return false here, which painted the operator-facing "no Google Maps
  // key configured" note on deploys where the key is set and working
  // (2026-08-31 operator report — the key was live the whole time).
  const empty: GeoApiResponse = { hits: [], provider: null, googleConfigured: null };
  if (q.length < 3) return empty;
  // Non-blocking: kick off the prompt if it hasn't happened, but use whatever
  // bias is already cached — never make the user wait on the geolocation dialog.
  primeLocationBias();
  const b = bias ?? biasCache ?? null;
  let path = `/geocode?q=${encodeURIComponent(q)}`;
  if (b && Number.isFinite(b.lat) && Number.isFinite(b.lng)) {
    path += `&lat=${encodeURIComponent(String(b.lat))}&lng=${encodeURIComponent(String(b.lng))}`;
  }
  try {
    const res = await apiFetch<{
      results?: GeoHit[];
      provider?: string;
      googleConfigured?: boolean;
    }>(path);
    return {
      hits: Array.isArray(res?.results) ? (res!.results as GeoHit[]) : [],
      provider: res?.provider ?? null,
      googleConfigured: typeof res?.googleConfigured === 'boolean' ? res.googleConfigured : null,
    };
  } catch {
    return empty;
  }
}

/**
 * Back-compat convenience wrapper — same as `geocodeViaApiFull` but returns
 * just the hit array, for callers that don't need the provider metadata.
 */
export async function geocodeViaApi(
  query: string,
  bias?: { lat: number; lng: number } | null,
): Promise<GeoHit[]> {
  const res = await geocodeViaApiFull(query, bias);
  return res.hits;
}

/**
 * Reverse geocode (lat/lng → nearest address) via `GET /api/v1/geocode/reverse`.
 * Powers "drop a pin on the fleet map → auto-fill the address". Returns null on
 * any failure (caller can still let the operator type the address).
 */
export async function reverseGeocodeViaApi(
  lat: number,
  lng: number,
): Promise<GeoHit | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const res = await apiFetch<{ result?: GeoHit | null }>(
      `/geocode/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`,
    );
    return res?.result ?? null;
  } catch {
    return null;
  }
}
