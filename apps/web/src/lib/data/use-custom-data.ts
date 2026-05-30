'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-client';

/**
 * useCustomData — Phase 3 field-mapping. The shared live-feed hook for
 * the generic "Custom data" source (template meta.dataSource === 'CUSTOM').
 * Mirrors the Phase-2 usePosMenuItems pattern: poll a server endpoint,
 * keep the last-good result on error, return null before the first load
 * so the caller can fall back to its static config.
 *
 * It NEVER fetches the operator's URL from the browser — it asks the API
 * (POST /api/v1/data-source/fetch), which fetches it server-side through
 * the SSRF gate (safeFetch) and returns normalized rows. So there's no
 * CORS dance and no way for a template to make the player hit an internal
 * address.
 *
 * Returns the normalized rows (Array<Record<string,string>>) or null:
 *   • null   → not enabled, no URL, or the FIRST load hasn't succeeded yet
 *   • rows[] → last good fetch (kept across transient errors mid-display)
 */

export interface CustomDataResponse {
  rows: Array<Record<string, string>>;
  columns: string[];
  totalRows: number;
  format: 'json' | 'csv';
}

// Generous cadence — a deployed wall doesn't need sub-minute freshness
// for a generic feed, and the API rate-limits per tenant. 60s keeps an
// edited feed reaching the screen without a manual refresh while staying
// far under the server's per-tenant ceiling.
export const CUSTOM_DATA_POLL_INTERVAL_MS = 60_000;

export function useCustomData(
  enabled: boolean,
  url: string | undefined,
  format: 'json' | 'csv' = 'json',
): Array<Record<string, string>> | null {
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null);
  // Ref (not state) so the poll loop always sees the live "have we ever
  // loaded?" value, never a stale closure from the first effect run.
  const hasLoadedRef = useRef(false);

  const trimmedUrl = (url || '').trim();
  const active = enabled && trimmedUrl.length > 0;

  useEffect(() => {
    // Synchronous reset when the feed is turned off / cleared so the
    // widget falls back to its static config immediately (faithful to
    // the shipped POS pattern).
    if (!active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows(null);
      hasLoadedRef.current = false;
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await apiFetch<CustomDataResponse>('/data-source/fetch', {
          method: 'POST',
          body: JSON.stringify({ url: trimmedUrl, format }),
        });
        if (cancelled) return;
        if (res && Array.isArray(res.rows)) {
          hasLoadedRef.current = true;
          setRows(res.rows);
        } else if (!hasLoadedRef.current) {
          setRows(null);
        }
      } catch {
        // FIRST load failed → null so the caller uses its static config.
        // Once we've loaded once, a transient failure is IGNORED — keep
        // the last good rows on screen instead of blanking.
        if (cancelled) return;
        if (!hasLoadedRef.current) setRows(null);
      }
      if (!cancelled) {
        timer = setTimeout(tick, CUSTOM_DATA_POLL_INTERVAL_MS);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, trimmedUrl, format]);

  return rows;
}
