"use client";

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeAuthEvents } from '@/lib/auth-events';
import { useUIStore } from '@/store/ui-store';
import { clog } from '@/lib/client-logger';

/**
 * Mounts inside DashboardLayout. Listens for session-expired events
 * (emitted by apiFetch on 401) and ejects the user back to /login.
 *
 * Also ejects if the user/token is already null on mount — catches
 * the case where a stale tab is re-focused after the session has been
 * cleared from another tab.
 *
 * 2026-06-08 — EJECT IS A HARD NAVIGATION (window.location), NOT a soft
 * router.replace(). A beta operator hit Sign Out and stayed stuck on the
 * authed dashboard in a logged-out state (avatar blanked to "?", data
 * 401'd, but no redirect to /login). Root cause: in their session the
 * Next App-Router soft navigation never completed — the same wedge that
 * also made nav buttons need two clicks. router.replace() is at the
 * mercy of that wedge; window.location.replace() is a browser-level
 * navigation that CANNOT be aborted by React/router state. It also does
 * a full page reload, which is the correct, secure behavior on logout:
 * every scrap of in-memory state (Zustand, React Query cache, any cached
 * PII) is torn down. Belt-and-suspenders with the sign-out buttons,
 * which now also hard-navigate.
 */

// Module-level latch so we fire the hard redirect exactly once even if
// several 401s land together (a logged-out dashboard fires many at once).
let ejecting = false;
function hardEjectToLogin(pathname: string, reason?: string) {
  if (ejecting) return;
  ejecting = true;
  if (typeof window === 'undefined') return;
  const redirectTo = encodeURIComponent(pathname || '/');
  const q = reason
    ? `?redirect=${redirectTo}&reason=${reason}`
    : `?redirect=${redirectTo}`;
  // replace() (not assign) so the back button can't return to the authed
  // page after logout.
  window.location.replace(`/login${q}`);
}

export function AuthExpirationGuard() {
  const pathname = usePathname() || '';
  const user = useUIStore((s) => s.user);
  const token = useUIStore((s) => s.token);
  const queryClient = useQueryClient();

  // On mount + whenever user/token goes null, eject if we're on a
  // protected route.
  useEffect(() => {
    const onProtected =
      !pathname.startsWith('/login') &&
      !pathname.startsWith('/signup') &&
      !pathname.startsWith('/pair') &&
      !pathname.startsWith('/player') &&
      !pathname.startsWith('/accept-invite') &&
      !pathname.startsWith('/reset-password');
    if (onProtected && (!user || !token)) {
      clog.warn('auth', 'Auth missing on protected route — hard-redirecting to /login', { pathname });
      try { queryClient.clear(); } catch { /* never block the eject */ }
      hardEjectToLogin(pathname);
    }
  }, [user, token, pathname, queryClient]);

  // Listen for session-expired / explicit-logout events from apiFetch +
  // ui-store so the eject happens the moment the event lands, without
  // waiting for the next render cycle to notice user/token flipped null.
  //
  // ALSO clear the React Query cache so the NEXT user (on a shared
  // school computer) doesn't see the previous user's cached screens,
  // assets, playlists, notifications for the 5-minute staleTime window.
  useEffect(() => {
    const unsub = subscribeAuthEvents((ev) => {
      clog.info('auth', `Auth event: ${ev.reason}`, { url: ev.url });
      if (ev.reason === 'session-expired' || ev.reason === 'explicit-logout') {
        try {
          queryClient.clear();
        } catch { /* swallow — shouldn't block the redirect */ }
        hardEjectToLogin(pathname, ev.reason);
      }
    });
    return unsub;
  }, [pathname, queryClient]);

  return null;
}
