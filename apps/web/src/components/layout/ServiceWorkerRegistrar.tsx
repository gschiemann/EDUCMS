"use client";

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Registers the dashboard's service worker on mount (Phase 1 of
 * MOBILE_APP_ROADMAP.md). Wired into DashboardLayout so it only runs
 * for authenticated dashboard surfaces — never on the public marketing
 * site, the /login page, the /player route (which has its own SW), or
 * /panic (immersive surface, no need).
 *
 * Why a separate component instead of inline in DashboardLayout: keeps
 * the layout file readable AND lets us bail on registration cleanly
 * when the route doesn't want a SW (no early-return in JSX needed).
 *
 * Cleanly handles the dev case: in `next dev`, the SW would intercept
 * HMR sockets and break hot reload. Gate registration on production
 * builds.
 */
export function ServiceWorkerRegistrar() {
  const pathname = usePathname() || '';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // Don't register on routes that have their own SW or shouldn't
    // get one (player has sw-player.js, panic / login are immersive
    // surfaces).
    if (
      pathname.startsWith('/player') ||
      pathname.startsWith('/panic') ||
      pathname.startsWith('/login') ||
      pathname.startsWith('/signup')
    ) {
      return;
    }

    // In dev, Next's hot-reload + the SW's fetch handler argue with
    // each other (asset paths shift between renders). Easier to just
    // gate registration on production. Operators can still test the
    // PWA install flow via `pnpm preview` / `pnpm build && next start`.
    if (process.env.NODE_ENV !== 'production') return;

    // Register quietly. Failures are non-fatal — the app still works
    // online without the SW.
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[sw] dashboard service worker registration failed', err);
      });
  }, [pathname]);

  return null;
}
