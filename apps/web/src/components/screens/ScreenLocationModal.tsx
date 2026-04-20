'use client';

/**
 * ScreenLocationModal — address-autocomplete UI for setting a screen's
 * physical location on the fleet map.
 *
 * Provider strategy (learned the hard way across two pivots):
 *   • **Photon** is an autocomplete layer — good for "fire something
 *     as soon as 2 chars are typed" latency-wise, BUT its index has
 *     coverage gaps on specific US residential addresses (e.g.
 *     "2748 Emory Oak Ct" returned 0 matches while Nominatim with
 *     countrycodes=us had 3 exact hits).
 *   • **Nominatim** is a full geocoder — SLOWER to accept partials,
 *     BUT has way better coverage of specific US addresses when you
 *     pin it with `countrycodes=us`. Without the country filter it
 *     searches globally and returns nothing for informal queries.
 *
 * So we use BOTH in parallel on each keystroke and merge results:
 *   — Photon first for partial-street autocomplete ("main st" hits).
 *   — Nominatim second (US-only) so specific house-number addresses
 *     still resolve even when Photon's index misses them.
 *   — Dedupe on lat+lon so overlapping results don't show twice.
 *
 * Country defaults to US because every pilot today is US-based; if
 * we expand internationally we'll surface a country selector at the
 * top of the modal + pass the code through to Nominatim.
 *
 * Both APIs are free + no key. OSM attribution linked at the bottom.
 */

import { useState, useEffect, useRef } from 'react';
import { Search, MapPin, X, Loader2, CheckCircle2 } from 'lucide-react';

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

interface NominatimResult {
  id: string;
  display_name: string;
  lat: string;
  lon: string;
}

function formatPhotonFeature(f: PhotonFeature, idx: number): NominatimResult | null {
  const [lon, lat] = f.geometry?.coordinates || [];
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const p = f.properties || {};
  const streetLine = [p.housenumber, p.street].filter(Boolean).join(' ') || p.name || '';
  const cityState = [p.city, p.state].filter(Boolean).join(', ');
  const tail = [cityState, p.postcode].filter(Boolean).join(' ');
  const country = p.country && p.country !== 'United States' ? `, ${p.country}` : '';
  const display_name = [streetLine, tail].filter(Boolean).join(', ') + country;
  if (!display_name.trim()) return null;
  return {
    id: p.osm_id ? `photon-${p.osm_id}-${idx}` : `photon-${idx}-${lat}-${lon}`,
    display_name,
    lat: String(lat),
    lon: String(lon),
  };
}

function formatNominatim(n: NominatimRaw, idx: number): NominatimResult | null {
  const lat = parseFloat(n.lat || '');
  const lon = parseFloat(n.lon || '');
  if (!isFinite(lat) || !isFinite(lon) || !n.display_name) return null;
  return {
    id: `nom-${n.place_id || idx}-${lat}-${lon}`,
    display_name: n.display_name,
    lat: String(lat),
    lon: String(lon),
  };
}

/**
 * Merge Photon + Nominatim results, dedupe by rounded coord. Photon
 * ordering is kept first because its results are ranked by partial-
 * match relevance; Nominatim fills the gaps with specific addresses.
 */
function mergeResults(photon: NominatimResult[], nominatim: NominatimResult[]): NominatimResult[] {
  const seen = new Set<string>();
  const out: NominatimResult[] = [];
  const key = (r: NominatimResult) =>
    `${parseFloat(r.lat).toFixed(4)},${parseFloat(r.lon).toFixed(4)}`;
  for (const r of [...photon, ...nominatim]) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= 6) break;
  }
  return out;
}

interface Props {
  screenName: string;
  currentAddress?: string | null;
  onClose: () => void;
  onSave: (body: { address: string | null; latitude: number | null; longitude: number | null }) => Promise<void>;
}

export function ScreenLocationModal({ screenName, currentAddress, onClose, onSave }: Props) {
  const [query, setQuery] = useState(currentAddress || '');
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<NominatimResult | null>(null);
  const [noMatch, setNoMatch] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<any>(null);
  const lastQueryRef = useRef<string>('');

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Debounced hybrid search (Photon + Nominatim US) on each keystroke.
  // Fires both requests in parallel, merges results, dedupes on coord.
  // 3-char threshold because Nominatim is brittle on shorter queries;
  // 300ms debounce so normal typing doesn't hammer either provider.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setNoMatch(false);
      return;
    }
    // Don't re-search what the user just picked.
    if (selected && selected.display_name === q) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      lastQueryRef.current = q;
      setSearching(true);
      setNoMatch(false);

      // Photon (autocomplete-strong, US-biased via bbox) and Nominatim
      // (whole-address strong, hard-pinned to US via countrycodes).
      // Fire both in parallel; first to land populates; the second
      // fills any gaps on dedupe merge. Either failing is fine —
      // we just use whatever came back.
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en&bbox=-125,24,-66,49`;
      const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&countrycodes=us&limit=5&q=${encodeURIComponent(q)}`;

      const photonP = fetch(photonUrl, { headers: { 'Accept': 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { features?: PhotonFeature[] } | null) => {
          const feats = Array.isArray(d?.features) ? d!.features! : [];
          return feats.map((f, i) => formatPhotonFeature(f, i)).filter((x): x is NominatimResult => x !== null);
        })
        .catch(() => [] as NominatimResult[]);

      const nomP = fetch(nomUrl, { headers: { 'Accept': 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((arr: NominatimRaw[] | null) => {
          const a = Array.isArray(arr) ? arr : [];
          return a.map((n, i) => formatNominatim(n, i)).filter((x): x is NominatimResult => x !== null);
        })
        .catch(() => [] as NominatimResult[]);

      try {
        const [photonHits, nomHits] = await Promise.all([photonP, nomP]);
        if (lastQueryRef.current !== q) return; // stale
        const merged = mergeResults(photonHits, nomHits);
        setResults(merged);
        setNoMatch(merged.length === 0);
      } finally {
        if (lastQueryRef.current === q) setSearching(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, selected]);

  const pick = (r: NominatimResult) => {
    setSelected(r);
    setQuery(r.display_name);
    setResults([]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (selected) {
        await onSave({
          address: selected.display_name,
          latitude: parseFloat(selected.lat),
          longitude: parseFloat(selected.lon),
        });
        onClose();
        return;
      }
      const q = query.trim();
      if (!q) {
        await onSave({ address: null, latitude: null, longitude: null });
        onClose();
        return;
      }
      // User typed but didn't pick — one more Nominatim US attempt
      // (it has better coverage of specific house-numbered addresses
      // than Photon). Photon-only fallback dropped because it silently
      // returned 0 for real addresses like "2748 Emory Oak Ct".
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=1&q=${encodeURIComponent(q)}`,
          { headers: { 'Accept': 'application/json' } },
        );
        if (r.ok) {
          const arr = (await r.json()) as NominatimRaw[];
          const mapped = arr[0] ? formatNominatim(arr[0], 0) : null;
          if (mapped) {
            await onSave({
              address: mapped.display_name,
              latitude: parseFloat(mapped.lat),
              longitude: parseFloat(mapped.lon),
            });
            onClose();
            return;
          }
        }
      } catch { /* fall through */ }
      // No geocode match — save address only. Map can't pin it; the
      // list view still shows the address text so it's not wasted.
      await onSave({ address: q, latitude: null, longitude: null });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await onSave({ address: null, latitude: null, longitude: null });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Set screen location"
    >
      <button className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 relative z-10">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-indigo-500" /> Where is &ldquo;{screenName}&rdquo;?
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close dialog">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Start typing the building address. Pick a suggestion so we get exact coordinates — the screen pin
          drops on the fleet map immediately.
        </p>

        {/* WAI-ARIA 1.2 combobox pattern — all the combobox semantics
            live on the <input> itself (not a wrapper), which is the
            form jsx-a11y's role-has-required-aria-props + role-
            supports-aria-props rules accept cleanly. The suggestion
            list uses role="listbox"/"option" on divs (not ul/li) so
            the no-noninteractive-element-to-interactive-role rule
            doesn't trip. */}
        <div className="relative">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-indigo-500 focus-within:bg-white">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              placeholder="e.g., 150 Chardon Ave, Chardon, OH"
              className="flex-1 bg-transparent outline-none text-sm"
              autoComplete="off"
              spellCheck={false}
              aria-label="Address"
              aria-autocomplete="list"
              aria-controls="screen-location-results"
              aria-expanded={results.length > 0}
              role="combobox"
            />
            {searching && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />}
          </div>

          {results.length > 0 && (
            <div
              id="screen-location-results"
              role="listbox"
              aria-label="Address suggestions"
              className="absolute z-10 top-full left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-xl max-h-64 overflow-y-auto"
            >
              {results.map((r) => (
                <div key={r.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => pick(r)}
                    className="w-full text-left px-3 py-2.5 hover:bg-indigo-50 flex items-start gap-2 text-sm border-b border-slate-50 last:border-0"
                  >
                    <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <span className="flex-1 text-slate-700 leading-tight">{r.display_name}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 flex items-start gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="flex-1">
              Pinned at <span className="font-mono">{parseFloat(selected.lat).toFixed(4)}, {parseFloat(selected.lon).toFixed(4)}</span>
            </span>
          </div>
        )}

        {noMatch && !selected && query.trim().length >= 3 && !searching && (
          <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            No matches. Try adding the city &amp; state, or save anyway — the address will show in the list
            but the screen won&rsquo;t pin on the map until coordinates are found.
          </div>
        )}

        <div className="flex justify-between items-center gap-2 mt-5">
          <button
            type="button"
            onClick={handleClear}
            disabled={saving || (!currentAddress && !selected && !query.trim())}
            className="px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Clear location
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 rounded-lg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || (!query.trim() && !currentAddress)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg flex items-center gap-1.5 min-w-[110px] justify-center"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Saving…' : 'Save location'}
            </button>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 mt-4 text-center">
          Search powered by <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-slate-600"
          >OpenStreetMap</a>.
        </p>
      </div>
    </div>
  );
}
