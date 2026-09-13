'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  fetchSocialPosts,
  readLastGood,
  writeLastGood,
  SOCIAL_POLL_INTERVAL_MS,
  type SocialConnectionView,
  type SocialPostView,
} from './device-social';

/**
 * useSocialPosts — the one shared live feed SocialFeedWidget consumes.
 *
 * Modelled on `usePosMenuItems`, including its two load-state rules:
 *
 *  • An EMPTY array is DATA and CLEARS the list. A connection whose posts
 *    were all deleted must not keep showing them.
 *  • A FAILURE after a successful load is IGNORED — the last good list stays
 *    on screen. A wall must not blank because the uplink hiccupped.
 *
 * On a cold start with no network we seed from localStorage (`readLastGood`)
 * so a rebooted kiosk paints real posts instead of an empty frame, and mark
 * that as NOT-yet-loaded so the first real response still wins.
 *
 * `status` is what lets the widget tell the operator the truth instead of
 * guessing:
 *   'loading'   nothing yet, no cache
 *   'ready'     posts, from a successful fetch
 *   'empty'     a successful fetch returned nothing
 *   'stale'     showing a cached list because the fetch is failing
 *
 * MOBILE-PERF: the timer is a plain setTimeout gated on the effect's
 * lifetime, at a 5-minute cadence — no background polling storm, nothing to
 * opt out of on blur.
 */
export type SocialFeedStatus = 'loading' | 'ready' | 'empty' | 'stale';

export interface SocialFeedState {
  posts: SocialPostView[] | null;
  status: SocialFeedStatus;
  /** Credential-free connection facts, once a fetch has succeeded. */
  connection: SocialConnectionView | null;
}

export function useSocialPosts(
  connectionId: string | undefined,
  limit: number,
): SocialFeedState {
  const [posts, setPosts] = useState<SocialPostView[] | null>(null);
  const [status, setStatus] = useState<SocialFeedStatus>('loading');
  const [connection, setConnection] = useState<SocialConnectionView | null>(null);
  // Ref, not state: the poll loop must see the live value, never a stale
  // closure from the first effect run (the usePosMenuItems lesson).
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (!connectionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPosts(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('loading');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConnection(null);
      hasLoadedRef.current = false;
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    hasLoadedRef.current = false;

    // Seed from the last good list so a cold offline boot is not blank. This
    // is NOT a successful load — the first real answer still replaces it.
    const cached = readLastGood(connectionId);
    if (cached && cached.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPosts(cached);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('stale');
    }

    const tick = async () => {
      controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const next = await fetchSocialPosts(
        { connectionId, limit, signal: controller?.signal },
        (path, init) => apiFetch<unknown>(path, init as Parameters<typeof apiFetch>[1]),
      );
      if (cancelled) return;

      if (next) {
        // Success — including empty, which must CLEAR.
        hasLoadedRef.current = true;
        setPosts(next.posts);
        setConnection(next.connection);
        setStatus(next.posts.length > 0 ? 'ready' : 'empty');
        if (next.posts.length > 0) writeLastGood(connectionId, next.posts);
      } else if (!hasLoadedRef.current) {
        // First load failed. Keep whatever the cache gave us and say so;
        // with no cache there is genuinely nothing to show yet.
        setStatus((prev) => (prev === 'stale' ? 'stale' : 'loading'));
      } else {
        // A transient failure AFTER a good load: keep the list on the wall.
        setStatus('stale');
      }

      if (!cancelled) timer = setTimeout(tick, SOCIAL_POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      try { controller?.abort(); } catch { /* noop */ }
    };
  }, [connectionId, limit]);

  return { posts, status, connection };
}
