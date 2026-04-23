"use client";

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeAuthEvents } from '@/lib/auth-events';
import { useUIStore } from '@/store/ui-store';
import { clog } from '@/lib/client-logger';

/**
 * Mounts inside DashboardLayout. Listens for session-expired events
 * (emitted by apiFetch on 401) and redirects the user back to /login.
 *
 * Also redirects if the user/token is already null on mount — catches
 * the case where a stale tab is re-focused after the session has been
 * cleared from another tab.
 *
 * Why a React component and not just a global listener: useRouter()
 * is only valid inside components. apiFetch runs outside React so it
 * can't call the router directly — we use a small event bus to bridge.
 */
export function AuthExpirationGuard() {
  const router = useRouter();
  const pathname = usePathname() || '';
  const user = useUIStore((s) => s.user);
  const token = useUIStore((s) => s.token);
  const queryClient = useQueryClient();

  // On mount + whenever user/token goes null, redirect if we're on a
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
      clog.warn('auth', 'Auth missing on protected route — redirecting to /login', { pathname });
      const redirectTo = encodeURIComponent(pathname);
      router.replace(`/login?redirect=${redirectTo}`);
    }
  }, [user, token, pathname, router]);

  // Listen for session-expired events from apiFetch so the redirect
  // happens the moment the 401 lands, without waiting for the next
  // render cycle to notice user/token flipped to null.
  //
  // ALSO clear the React Query cache so the NEXT user (on a shared
  // school computer) doesn't see the previous user's cached screens,
  // assets, playlists, notifications for the 5-minute staleTime
  // window. SchoolSwitcher already does this on tenant switch;
  // logout needs the same treatment.
  useEffect(() => {
    const unsub = subscribeAuthEvents((ev) => {
      clog.info('auth', `Auth event: ${ev.reason}`, { url: ev.url });
      if (ev.reason === 'session-expired' || ev.reason === 'explicit-logout') {
        try {
          queryClient.clear();
        } catch { /* swallow — shouldn't block the redirect */ }
        const redirectTo = encodeURIComponent(pathname);
        router.replace(`/login?redirect=${redirectTo}&reason=${ev.reason}`);
      }
    });
    return unsub;
  }, [router, pathname, queryClient]);

  return null;
}
