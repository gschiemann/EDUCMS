import { apiFetch } from './api-client';

/** A geocode hit in the same {display_name, lat, lon} shape the pickers
 *  already consume from Nominatim/Photon, so mapping is trivial. */
export interface GeoHit {
  display_name: string;
  lat: string;
  lon: string;
  source?: 'google' | 'nominatim' | string;
}

/**
 * Server-side geocode via `GET /api/v1/geocode`.
 *
 * The API uses Google Geocoding when `GOOGLE_MAPS_API_KEY` is set (authoritative
 * US house-number coverage — finds addresses OSM/Census miss), falling back to
 * OSM Nominatim otherwise. The Google key never leaves the server.
 *
 * Returns `[]` on ANY failure (network, 401, empty) so callers can fall back to
 * their own client-side Photon/Nominatim providers without a try/catch.
 */
export async function geocodeViaApi(query: string): Promise<GeoHit[]> {
  const q = (query || '').trim();
  if (q.length < 3) return [];
  try {
    const res = await apiFetch<{ results?: GeoHit[] }>(
      `/geocode?q=${encodeURIComponent(q)}`,
    );
    return Array.isArray(res?.results) ? (res!.results as GeoHit[]) : [];
  } catch {
    return [];
  }
}
