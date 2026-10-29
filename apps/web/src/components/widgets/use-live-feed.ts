"use client";

/**
 * useLiveRssFeed / useLiveIcsFeed — shared hooks so RSSWidget and
 * CalendarWidget get REAL data from an operator-supplied feed URL instead
 * of the hardcoded sample content (Launch Sprint FEEDS domain, 2026-07-01 —
 * "RSSWidget renders 5 HARDCODED fake headlines... CalendarWidget never
 * fetches its feedUrl. Build the honest backend + wire the widgets.").
 *
 * Unlike `useCustomData` (apps/web/src/lib/data/use-custom-data.ts), these
 * hooks do NOT go through `apiFetch` — that helper assumes an authenticated
 * dashboard session (cookies, CSRF token, 401→logout handling). RSS_FEED
 * and CALENDAR widgets render on the UNAUTHED PLAYER too (a kiosk/LED board
 * running a device token, or no auth context at all), so a plain same-
 * origin-API `fetch()` is used instead — mirroring exactly how
 * WeatherWidget's `fetchWeather()` calls a third-party API directly, except
 * here the target is OUR OWN public, SSRF-guarded backend
 * (GET /api/v1/feeds/rss|ics) rather than a third party. See
 * apps/api/src/feeds/feeds.controller.ts for why that route has no auth
 * guard (same reasoning as /proxy/web).
 *
 * Polling discipline (CLAUDE.md mobile-perf standard):
 *   - Poll only while the tab/board is visible — a backgrounded dashboard
 *     tab must not keep firing requests. `perf-allow`: on the LIVE PLAYER
 *     specifically, a signage board is meant to keep showing fresh content
 *     even if no human is looking at a monitor — but chromium's page
 *     visibility API reports 'visible' for a kiosk display that's simply
 *     not focused (no user tab-switch scenario applies to a dedicated
 *     board), so the SAME visibility gate is correct and sufficient on
 *     both surfaces without a special case.
 *   - Cadence floor of 5 minutes (matches the RSS cache TTL server-side —
 *     polling faster just re-serves the same cached payload).
 *   - `setTimeout` self-scheduling (not `setInterval`) so a slow response
 *     can't cause overlapping in-flight requests.
 *   - Stale-while-error: the first failed load returns null (caller shows
 *     its sample data); once loaded once, a transient failure keeps the
 *     last-good result on screen instead of blanking it.
 */

import { useEffect, useRef, useState } from 'react';
import type { FeedItem, CalendarFeedEvent } from './feed-types';

const API_BASE = (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_API_URL)
  ? process.env.NEXT_PUBLIC_API_URL.replace('/api/v1', '')
  : 'http://localhost:8080';

/** Floor matches the server's RSS cache TTL (feeds.service.ts) — polling
 *  more often than the cache refreshes just re-fetches the same payload. */
export const RSS_POLL_INTERVAL_MS = 5 * 60 * 1000;
/** Calendars change far less often than news — matches the ICS cache TTL. */
export const ICS_POLL_INTERVAL_MS = 15 * 60 * 1000;

function isVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

interface RssApiResponse {
  title: string;
  items: FeedItem[];
}

interface IcsApiResponse {
  events: CalendarFeedEvent[];
  meta: { recurringEventCount: number; recurrenceExpansionDays: number; hasUnexpandedRecurrence: boolean };
}

/** Generic visibility-gated, stale-while-error poll loop shared by both
 *  hooks below — the only difference between RSS and ICS is the URL/shape. */
export function usePolledFeed<T>(
  active: boolean,
  buildUrl: () => string,
  intervalMs: number,
  holdMs = Infinity,
  timeoutMs = 8000,
  initialDelayMs = 0,
): { data: T | null; loading: boolean; error: boolean } {
  const requestUrl = buildUrl();
  const [data, setData] = useState<{ url: string; value: T } | null>(null);
  const goodAt = useRef(0);
  const [loading, setLoading] = useState(active);
  const [error, setError] = useState(false);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    hasLoadedRef.current = false; goodAt.current = 0; setData(null); setError(false); setLoading(active);
    if (!active) {
      setData(null);
      setLoading(false);
      setError(false);
      hasLoadedRef.current = false;
      return;
    }

    let cancelled = false;
    let retrySoon = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingController: AbortController | null = null;
    let requestTimeout: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, retrySoon ? Math.min(intervalMs, 60_000) : intervalMs);
    };

    const tick = async () => {
      // Never poll a backgrounded tab (CLAUDE.md mobile-perf standard).
      // Re-check on wake via the visibilitychange listener below instead
      // of burning a timer while hidden.
      if (!isVisible()) {
        scheduleNext();
        return;
      }
      if (inFlight) return;
      inFlight = true;
      try {
        pendingController = new AbortController();
        const controller = pendingController;
        requestTimeout = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(requestUrl, { signal: controller.signal });
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        hasLoadedRef.current = true;
        goodAt.current = Date.now();
        setData({ url: requestUrl, value: json });
        retrySoon = false;
        setError(false);
        setLoading(false);
      } catch {
        if (cancelled) return;
        // First load failed → surface the error so the caller falls back
        // to its static/sample content. Once loaded once, keep the last
        // good data on screen (stale-while-error) rather than blanking.
        retrySoon = true;
        setError(true);
        setLoading(false);
        if (!hasLoadedRef.current || Date.now() - goodAt.current > holdMs) setData(null);
      } finally {
        if (requestTimeout) clearTimeout(requestTimeout);
        pendingController = null;
        inFlight = false;
        scheduleNext();
      }
    };

    // Wake immediately on regaining visibility instead of waiting out
    // whatever was left of the last interval — a board that was hidden
    // (or a dashboard tab that regained focus) should refresh promptly.
    const onVisibility = () => {
      if (isVisible()) void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    timer = setTimeout(tick, initialDelayMs);
    return () => {
      cancelled = true;
      pendingController?.abort();
      if (requestTimeout) clearTimeout(requestTimeout);
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, intervalMs, requestUrl, holdMs, timeoutMs, initialDelayMs]);

  return { data: data?.url === requestUrl ? data.value : null, loading, error };
}

export interface LiveRssResult {
  title: string | null;
  items: FeedItem[] | null;
  loading: boolean;
  error: boolean;
}

export function useLiveRssFeed(feedUrl: string | undefined, maxItems: number, holdMs = Infinity): LiveRssResult {
  const trimmed = (feedUrl || '').trim();
  const active = trimmed.length > 0;
  const url = `${API_BASE}/api/v1/feeds/rss?url=${encodeURIComponent(trimmed)}`;

  const { data, loading, error } = usePolledFeed<RssApiResponse>(active, () => url, RSS_POLL_INTERVAL_MS, holdMs);

  return {
    title: data?.title ?? null,
    items: data?.items ? data.items.slice(0, maxItems) : null,
    loading,
    error,
  };
}

export interface LiveIcsResult {
  events: CalendarFeedEvent[] | null;
  loading: boolean;
  error: boolean;
  meta: IcsApiResponse['meta'] | null;
}

export function useLiveIcsFeed(feedUrl: string | undefined): LiveIcsResult {
  const trimmed = (feedUrl || '').trim();
  const active = trimmed.length > 0;
  const url = `${API_BASE}/api/v1/feeds/ics?url=${encodeURIComponent(trimmed)}`;

  const { data, loading, error } = usePolledFeed<IcsApiResponse>(active, () => url, ICS_POLL_INTERVAL_MS);

  return {
    events: data?.events ?? null,
    loading,
    error,
    meta: data?.meta ?? null,
  };
}
