/**
 * live-data-client — the one place the traffic / flights / scores / markets
 * widgets talk to `/api/v1/integrations/live-data/*`.
 *
 * Same credential split as `lib/reviews/google-reviews-client.ts`: on a wall
 * the player holds a DEVICE token (Bearer), in the builder `apiFetch` attaches
 * the operator session. Every route spends money on our provider keys, so
 * none is anonymous; the keys themselves never reach the browser — the API
 * only ever answers data, a credit line and `enabled`.
 *
 * Contract (do not collapse it): `null` = the request FAILED (keep the last
 * good answer); `{ enabled:false }` = a real answer, the family is dormant on
 * this deploy; `{ enabled:true, items:[] }` = a real answer with nothing in it.
 */

import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api-client';
import { API_URL } from '@/lib/api-url';
import { resolveDeviceToken } from '@/lib/menu/device-menu';

export type LiveDataFamily = 'traffic' | 'flights' | 'scores' | 'stocks' | 'crypto';
export const LIVE_DATA_FAMILIES: LiveDataFamily[] = ['traffic', 'flights', 'scores', 'stocks', 'crypto'];

export interface LiveAnswer<T> {
  enabled: boolean;
  source?: string;
  sourceUrl?: string;
  fetchedAt?: string;
  items?: T[];
  [extra: string]: unknown;
}

export interface TrafficItem {
  id: string;
  type: string;
  road: string;
  area: string;
  delayMin: number | null;
  severity: 'unknown' | 'minor' | 'moderate' | 'major' | 'closure';
  distanceKm: number;
}
export interface FlightRow {
  flight: string;
  airline: string;
  time: string;
  revised: string;
  place: string;
  placeCode: string;
  gate: string;
  terminal: string;
  status: string;
}
export interface ScoreRow {
  id: string;
  state: 'live' | 'final' | 'upcoming';
  period: string;
  clock: string;
  home: { name: string; score: number | null };
  away: { name: string; score: number | null };
  startsAt: string;
  venue: string;
}
export interface QuoteRow {
  symbol: string;
  name: string;
  price: number;
  change: number;
  pct: number;
  currency: string;
  marketOpen: boolean;
}
export interface CoinRow {
  id: string;
  symbol: string;
  name: string;
  price: number;
  pct24h: number;
}

const BASE = '/integrations/live-data';

export async function fetchLiveData<T>(pathAndQuery: string, signal?: AbortSignal): Promise<LiveAnswer<T> | null> {
  const token = resolveDeviceToken();
  try {
    let body: unknown;
    if (token) {
      const res = await fetch(`${API_URL}${BASE}${pathAndQuery}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal,
      });
      if (!res.ok) return null;
      body = await res.json();
    } else {
      body = await apiFetch<unknown>(`${BASE}${pathAndQuery}`, { signal } as never);
    }
    if (!body || typeof (body as LiveAnswer<T>).enabled !== 'boolean') return null;
    return body as LiveAnswer<T>;
  } catch {
    return null;
  }
}

/**
 * Poll one live-data query while the page is visible. The server caches for
 * minutes, so this costs our providers nothing per screen; `intervalMs` only
 * bounds how stale the glass may be relative to that cache.
 */
export function useLiveData<T>(
  pathAndQuery: string | null,
  intervalMs: number,
): { data: LiveAnswer<T> | null; loading: boolean } {
  const [state, setState] = useState<{ key: string | null; data: LiveAnswer<T> | null; loading: boolean }>({
    key: pathAndQuery,
    data: null,
    loading: !!pathAndQuery,
  });
  useEffect(() => {
    // A new query needs no reset here: the return below ignores state whose
    // key is not the current query.
    if (!pathAndQuery) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(tick, intervalMs);
        return;
      }
      controller = new AbortController();
      const answer = await fetchLiveData<T>(pathAndQuery, controller.signal);
      if (cancelled) return;
      // A failure keeps the last good answer (the server's own TTL bounds its age).
      setState((prev) => ({ key: pathAndQuery, data: answer ?? (prev.key === pathAndQuery ? prev.data : null), loading: false }));
      // Dormant: ask again every 15 minutes, so a key added later reaches
      // the glass without a reload, at no meaningful cost.
      timer = setTimeout(tick, !answer ? Math.min(intervalMs, 30_000) : answer.enabled ? intervalMs : 15 * 60_000);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [pathAndQuery, intervalMs]);
  return state.key === pathAndQuery ? { data: state.data, loading: state.loading } : { data: null, loading: !!pathAndQuery };
}

// ── status (builder only) ──────────────────────────────────────────────────

export type LiveDataStatus = Record<LiveDataFamily, { enabled: boolean; source: string; missing: string[] }>;
let statusPromise: Promise<LiveDataStatus | null> | null = null;

/** Which families this deploy has keys for. `null` = could not find out. */
export function fetchLiveDataStatus(): Promise<LiveDataStatus | null> {
  if (!statusPromise) {
    // `Promise.resolve().then` so a throwing or non-promise apiFetch (a test
    // double, an offline shell) is a failure, never an exception at mount.
    statusPromise = Promise.resolve()
      .then(() => apiFetch<{ families?: LiveDataStatus }>(`${BASE}/status`))
      .then((b) => (b?.families && typeof b.families === 'object' ? b.families : null))
      .catch(() => null)
      .then((s) => {
        // Never memoise a failure: the next mount asks again.
        if (!s) statusPromise = null;
        return s;
      });
  }
  return statusPromise;
}

/** Test seam. */
export function __resetLiveDataStatus(): void {
  statusPromise = null;
}

export interface ScoreLeague {
  id: string;
  name: string;
  sport: string;
}
export async function fetchScoreLeagues(): Promise<ScoreLeague[]> {
  try {
    const b = await Promise.resolve(apiFetch<{ leagues?: ScoreLeague[] }>(`${BASE}/leagues`));
    return Array.isArray(b?.leagues) ? b.leagues : [];
  } catch {
    return [];
  }
}
