"use client";

/**
 * StockPhotoSearch — Wave B / editor-crush B1 (2026-07-02).
 *
 * The "Stock photos" tab shared by AssetLibraryModal (PropertiesPanel) and
 * BackgroundPanel's Photos lane. Audit finding (05-EDITOR-CRUSH-LENSES.md
 * elements-assets P0): StockImageService (apps/api/src/ai/stock-image.
 * service.ts) is a production-grade, FREE Pexels search that already powers
 * every AI-generated board — but no operator-facing picker could reach it.
 * This is the thin client over the new GET /ai/stock-search + POST
 * /ai/stock-rehost endpoints (apps/api/src/ai/ai.controller.ts).
 *
 * Behavior:
 *   - Debounced search (500ms+) so a free-text query doesn't hammer Pexels'
 *     free tier (~200 req/hr) on every keystroke.
 *   - Caches the LAST results client-side (component state) so switching
 *     tabs and back doesn't re-fire the search.
 *   - Renders NOTHING (returns null) when the server reports
 *     `configured: false` (no PEXELS_API_KEY) — same "invisible when
 *     unconfigured" contract as every other AI-adjacent feature in this app.
 *   - On pick: best-effort re-hosts the Pexels URL into our own Supabase
 *     bucket (POST /ai/stock-rehost, mirrors attachKeptBoardPhoto's rehost
 *     path) so the asset is durable + offline-cacheable on Taurus; falls
 *     back to the raw Pexels URL if the rehost fails (never blocks the
 *     operator on a network hiccup — the photo still renders).
 *   - Pexels attribution line under every result grid per their API terms
 *     (https://www.pexels.com/api/documentation/#guidelines).
 */

import { useEffect, useRef, useState } from 'react';
import { Search, Loader2, ImageOff } from 'lucide-react';
import { useStockSearch, useStockRehost, type StockSearchResult } from '@/hooks/use-api';

const SEARCH_DEBOUNCE_MS = 550;

export function StockPhotoSearch({
  onPick,
  orientation = 'landscape',
}: {
  /** Receives the final URL to use — the re-hosted Supabase URL when the
   *  rehost succeeds, otherwise the raw Pexels URL (best-effort fallback). */
  onPick: (url: string) => void;
  orientation?: 'landscape' | 'portrait';
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [pickingUrl, setPickingUrl] = useState<string | null>(null);
  const search = useStockSearch();
  const rehost = useStockRehost();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef('');

  // Fire an empty-query probe on mount ONLY to learn `configured` — the FE
  // must not render a dead search box when PEXELS_API_KEY is unset. A blank
  // query short-circuits server-side (StockImageService returns []) so this
  // costs nothing and never hits Pexels.
  useEffect(() => {
    let alive = true;
    search.mutate(
      { query: '__probe__', orientation },
      {
        onSuccess: (res) => { if (alive) setConfigured(res.configured); },
        onError: () => { if (alive) setConfigured(false); },
      },
    );
    return () => { alive = false; };
    // Probe once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      lastQueryRef.current = q;
      search.mutate(
        { query: q, orientation },
        {
          onSuccess: (res) => {
            // Ignore a stale response that resolved after a newer query fired.
            if (lastQueryRef.current !== q) return;
            setResults(res.results);
            setConfigured(res.configured);
          },
          onError: () => setResults([]),
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, orientation]);

  // Unconfigured (no PEXELS_API_KEY anywhere) → invisible, matches every
  // other AI-adjacent feature's degrade-gracefully contract. `null` = still
  // probing, render nothing to avoid a flash of a dead search box.
  if (configured === false || configured === null) return null;

  const handlePick = async (result: StockSearchResult) => {
    setPickingUrl(result.url);
    try {
      const res = await rehost.mutateAsync({ url: result.url });
      onPick(res.url || result.url); // best-effort — fall back to the raw Pexels URL
    } catch {
      onPick(result.url); // rehost call itself failed — still let the photo through
    } finally {
      setPickingUrl(null);
    }
  };

  return (
    <div>
      <div className="relative mb-2">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search free stock photos…"
          className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
          aria-label="Search stock photos"
        />
      </div>

      {search.isPending && !results.length && query.trim() && (
        <div className="py-8 text-center text-xs text-slate-400 flex flex-col items-center gap-1.5">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          Searching…
        </div>
      )}

      {!search.isPending && query.trim() && results.length === 0 && (
        <div className="py-8 text-center text-xs text-slate-400 flex flex-col items-center gap-1.5">
          <ImageOff className="w-5 h-5 opacity-50" aria-hidden />
          No photos found — try a different search.
        </div>
      )}

      {!query.trim() && (
        <p className="text-[11px] text-slate-400 italic py-2">
          Type to search millions of free stock photos.
        </p>
      )}

      {results.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            {results.map((r) => {
              const isPicking = pickingUrl === r.url;
              return (
                <button
                  key={r.url}
                  type="button"
                  onClick={() => handlePick(r)}
                  disabled={!!pickingUrl}
                  title={r.photographer ? `Photo by ${r.photographer} on Pexels` : 'Use this photo'}
                  className="group relative aspect-square rounded-lg overflow-hidden bg-slate-100 border border-slate-200 hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200 transition-all disabled:opacity-60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.thumbUrl || r.url}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  {isPicking && (
                    <div className="absolute top-0 right-0 bottom-0 left-0 bg-black/40 flex items-center justify-center">
                      <Loader2 className="w-4 h-4 text-white animate-spin" aria-hidden />
                    </div>
                  )}
                  {r.photographer && (
                    <div className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/70 to-transparent text-white text-[8px] px-1 py-0.5 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                      {r.photographer}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {/* Pexels attribution — required by their API guidelines
              (pexels.com/api/documentation/#guidelines). */}
          <p className="text-[9px] text-slate-400 mt-2 text-center">
            Photos provided by{' '}
            <a
              href="https://www.pexels.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-slate-600"
            >
              Pexels
            </a>
          </p>
        </>
      )}
    </div>
  );
}
