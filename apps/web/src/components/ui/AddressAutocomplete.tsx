'use client';

/**
 * AddressAutocomplete — reusable address-autocomplete input.
 *
 * 2026-05-25 — operator: "when typing in the address it should auto
 * fill it for you, like on a website it goes and find all the
 * addresses as you type them then you pick the correct one."
 *
 * Hybrid Photon (autocomplete-strong, US-biased via bbox) + Nominatim
 * (whole-address-strong, hard-pinned to US via countrycodes) — same
 * pattern as ScreenLocationModal.tsx (extracted + generalized here so
 * the signup form + add-location form + edit-location form all share
 * one input). On pick, returns the formatted display name AND the
 * lat/lng so the caller can store both (no Sprint-8 follow-up geocode
 * pass needed for addresses entered through this control — we get
 * coords for free at typing time).
 *
 * Both APIs are free + no key required. OSM attribution should land
 * somewhere on the page when a result is picked (caller's call).
 */

import { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2, X } from 'lucide-react';
import { geocodeViaApiFull, primeLocationBias } from '@/lib/geocode';

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postcode?: string;
  };
}
interface NominatimRaw {
  place_id?: number | string;
  display_name?: string;
  lat?: string;
  lon?: string;
}
interface Result {
  id: string;
  displayName: string;
  lat: number;
  lon: number;
}

function formatPhoton(f: PhotonFeature, idx: number): Result | null {
  const [lon, lat] = f.geometry?.coordinates || [];
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const p = f.properties || {};
  const streetLine = [p.housenumber, p.street].filter(Boolean).join(' ') || p.name || '';
  const cityState = [p.city, p.state].filter(Boolean).join(', ');
  const tail = [cityState, p.postcode].filter(Boolean).join(' ');
  const country = p.country && p.country !== 'United States' ? `, ${p.country}` : '';
  const displayName = [streetLine, tail].filter(Boolean).join(', ') + country;
  if (!displayName.trim()) return null;
  return {
    id: p.osm_id ? `photon-${p.osm_id}-${idx}` : `photon-${idx}-${lat}-${lon}`,
    displayName,
    lat,
    lon,
  };
}
function formatNominatim(n: NominatimRaw, idx: number): Result | null {
  const lat = parseFloat(n.lat || '');
  const lon = parseFloat(n.lon || '');
  if (!isFinite(lat) || !isFinite(lon) || !n.display_name) return null;
  return {
    id: `nom-${n.place_id || idx}-${lat}-${lon}`,
    displayName: n.display_name,
    lat,
    lon,
  };
}

/** Merge Photon + Nominatim hits, dedupe on rounded coord. Photon
 *  ordering kept first since its partial-match ranking is better;
 *  Nominatim fills the gaps. Cap at 6 results to keep the dropdown
 *  scannable. */
function mergeResults(photon: Result[], nominatim: Result[]): Result[] {
  const seen = new Set<string>();
  const out: Result[] = [];
  for (const r of [...photon, ...nominatim]) {
    const key = `${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= 6) break;
  }
  return out;
}

export interface AddressPick {
  /** Formatted display address — what to render in the input + persist. */
  displayName: string;
  /** Latitude in decimal degrees. */
  latitude: number;
  /** Longitude in decimal degrees. */
  longitude: number;
}

interface AddressAutocompleteProps {
  /** Current input value (controlled). */
  value: string;
  /** Fired on every keystroke (debounced search is internal). */
  onChange: (v: string) => void;
  /** Fired when the user picks a result from the dropdown. Receives
   *  display name + lat/lng so the caller can persist all three. */
  onPick?: (pick: AddressPick) => void;
  placeholder?: string;
  className?: string;
  /** HTML id, useful for label `for=` */
  id?: string;
  /** Render `(optional)` next to the input on focus / blur if you want. */
  ariaLabel?: string;
}

export function AddressAutocomplete({
  value,
  onChange,
  onPick,
  placeholder,
  className,
  id,
  ariaLabel,
}: AddressAutocompleteProps) {
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  // We block the next search after a pick so the dropdown doesn't
  // re-open with the just-picked address still as the query.
  const [justPicked, setJustPicked] = useState(false);
  // MOBILE BUG #216 (2026-07-01) — surface honestly when this deploy has no
  // GOOGLE_MAPS_API_KEY, instead of silently falling back to less-precise
  // matching with no explanation. null = haven't heard from the server yet.
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);
  const [noMatch, setNoMatch] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<any>(null);
  const lastQueryRef = useRef('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Prime the operator's coarse location once so geocodes bias to their region
  // (an ambiguous street resolves to the nearby one, not another state).
  useEffect(() => { primeLocationBias(); }, []);

  // Close dropdown on click outside.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  // Debounced hybrid search. 3-char threshold + 300ms debounce so
  // light typing doesn't hammer either provider; both have generous
  // free tiers but it's polite + faster for the user.
  useEffect(() => {
    if (justPicked) {
      // Reset after one render so future typing re-enables search.
      setJustPicked(false);
      return;
    }
    const q = value.trim();
    if (q.length < 3) {
      setResults([]);
      setNoMatch(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      lastQueryRef.current = q;
      setSearching(true);
      setNoMatch(false);
      // Server-side geocode FIRST: GET /api/v1/geocode chains Google (when
      // GOOGLE_MAPS_API_KEY is set — authoritative US house numbers) → US
      // Census Bureau Geocoder (free, keyless, real house-number coverage,
      // added 2026-07-01 for mobile bug #216) → Nominatim. Key stays
      // server-side. Falls through to the client-side Photon/Nominatim merge
      // below only if ALL THREE server tiers miss.
      try {
        const apiRes = await geocodeViaApiFull(q);
        if (lastQueryRef.current !== q) return; // stale
        setGoogleConfigured(apiRes.googleConfigured);
        const mapped = apiRes.hits
          .map((h, i) => ({
            id: `api-${i}-${h.lat}-${h.lon}`,
            displayName: h.display_name,
            lat: parseFloat(h.lat),
            lon: parseFloat(h.lon),
          }))
          .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
        if (mapped.length) {
          setResults(mapped);
          setOpen(true);
          setSearching(false);
          return;
        }
      } catch {
        /* fall through to client-side Photon/Nominatim */
      }
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en&bbox=-125,24,-66,49`;
      const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&countrycodes=us&limit=5&q=${encodeURIComponent(q)}`;
      const photonP = fetch(photonUrl, { headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { features?: PhotonFeature[] } | null) => {
          const feats = Array.isArray(d?.features) ? d!.features! : [];
          return feats.map((f, i) => formatPhoton(f, i)).filter((x): x is Result => x !== null);
        })
        .catch(() => [] as Result[]);
      const nomP = fetch(nomUrl, { headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((arr: NominatimRaw[] | null) => {
          const a = Array.isArray(arr) ? arr : [];
          return a.map((n, i) => formatNominatim(n, i)).filter((x): x is Result => x !== null);
        })
        .catch(() => [] as Result[]);
      try {
        const [photonHits, nomHits] = await Promise.all([photonP, nomP]);
        if (lastQueryRef.current !== q) return;
        const merged = mergeResults(photonHits, nomHits);
        setResults(merged);
        if (merged.length > 0) {
          setOpen(true);
        } else {
          setNoMatch(true);
        }
      } finally {
        if (lastQueryRef.current === q) setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, justPicked]);

  const pick = (r: Result) => {
    setJustPicked(true);
    onChange(r.displayName);
    setResults([]);
    setOpen(false);
    setNoMatch(false);
    onPick?.({
      displayName: r.displayName,
      latitude: r.lat,
      longitude: r.lon,
    });
    // Move focus off the input so the dropdown stays closed.
    inputRef.current?.blur();
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <MapPin className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          id={id}
          aria-label={ariaLabel}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className={
            className ||
            'w-full pl-10 pr-9 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white'
          }
        />
        {searching ? (
          <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" aria-hidden />
        ) : value && (
          <button
            type="button"
            onClick={() => { onChange(''); setResults([]); setOpen(false); setNoMatch(false); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"
            aria-label="Clear address"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                onMouseDown={(e) => {
                  // mousedown not click so it fires BEFORE the
                  // input loses focus and the click-outside handler
                  // closes the dropdown.
                  e.preventDefault();
                  pick(r);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-start gap-2"
              >
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                <span className="truncate">{r.displayName}</span>
              </button>
            </li>
          ))}
          <li className="px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-100">
            Results from{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-600 underline decoration-dotted"
              onMouseDown={(e) => e.stopPropagation()}
            >
              OpenStreetMap
            </a>
          </li>
        </ul>
      )}
      {/* MOBILE BUG #216 (2026-07-01) — honest note instead of silently
          returning nothing when no result matched and this deploy has no
          Google Maps key configured (precise house-number search needs it;
          the free Census/OSM fallback still covers most addresses). */}
      {!open && noMatch && googleConfigured === false && value.trim().length >= 3 && !searching && (
        <p className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
          No match yet — this deploy is using free approximate address
          search (no Google Maps key configured). Try adding the city &amp;
          state, or double-check the street number.
        </p>
      )}
    </div>
  );
}
