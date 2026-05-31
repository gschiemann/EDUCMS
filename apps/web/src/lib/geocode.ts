import { apiFetch } from './api-client';

/** A geocode hit in the same {display_name, lat, lon} shape the pickers
 *  already consume from Nominatim/Photon, so mapping is trivial. */
export interface GeoHit {
  display_name: string;
  lat: string;
  lon: string;
  source?: 'google' | 'nominatim' | string;
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
 * Server-side geocode via `GET /api/v1/geocode` (Google when GOOGLE_MAPS_API_KEY
 * is set, OSM fallback). The Google key never leaves the server.
 *
 * Automatically biases by the operator's location (see primeLocationBias) so
 * same-named streets resolve to the nearby one. Pass `bias` to override (e.g.
 * a tenant centroid). Returns `[]` on ANY failure so callers can fall back to
 * their own client-side providers.
 */
export async function geocodeViaApi(
  query: string,
  bias?: { lat: number; lng: number } | null,
): Promise<GeoHit[]> {
  const q = (query || '').trim();
  if (q.length < 3) return [];
  // Non-blocking: kick off the prompt if it hasn't happened, but use whatever
  // bias is already cached — never make the user wait on the geolocation dialog.
  primeLocationBias();
  const b = bias ?? biasCache ?? null;
  let path = `/geocode?q=${encodeURIComponent(q)}`;
  if (b && Number.isFinite(b.lat) && Number.isFinite(b.lng)) {
    path += `&lat=${encodeURIComponent(String(b.lat))}&lng=${encodeURIComponent(String(b.lng))}`;
  }
  try {
    const res = await apiFetch<{ results?: GeoHit[] }>(path);
    return Array.isArray(res?.results) ? (res!.results as GeoHit[]) : [];
  } catch {
    return [];
  }
}
