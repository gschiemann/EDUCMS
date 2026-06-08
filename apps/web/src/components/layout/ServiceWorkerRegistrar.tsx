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

  // 2026-06-01 — auto-recover from deploy/chunk skew. After a deploy the JS
  // chunk filenames change; a page already open in the browser still points
  // at the OLD chunk URLs, so a client navigation that lazy-loads a route
  // (e.g. opening the template builder) throws ChunkLoadError and lands on
  // the route error boundary ("This page couldn't load"). A full reload pulls
  // the current build's HTML + chunk references and fixes it — so do that
  // automatically. Guarded to one reload per 30s so a genuinely-missing chunk
  // can't cause an infinite reload loop (it falls through to the boundary).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isChunkError = (msg?: string | null) =>
      !!msg && /ChunkLoadError|Loading chunk [^ ]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(msg);
    const reloadOnce = () => {
      try {
        const KEY = '__educms_chunk_reload_at';
        const last = Number(sessionStorage.getItem(KEY) || '0');
        if (Date.now() - last < 30_000) return; // already tried recently → give up, show boundary
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch { /* sessionStorage blocked — still reload once */ }
      window.location.reload();
    };
    const onError = (e: ErrorEvent) => {
      if (isChunkError(e?.message) || isChunkError((e?.error as Error | undefined)?.message) || isChunkError((e?.error as Error | undefined)?.name)) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e?.reason as (Error & { name?: string }) | string | undefined;
      const msg = typeof r === 'string' ? r : (r?.message || r?.name);
      if (isChunkError(msg)) reloadOnce();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

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

  // 2026-06-08 — force a service-worker update check whenever the tab
  // regains focus (throttled to once/60s). Why this matters for the
  // "stale dashboard after a deploy" report:
  //
  // By spec the browser only re-fetches /sw.js on navigation at most
  // once per 24h — so a tab left open across a deploy can keep running
  // the OLD service worker (and its old cached shell) for up to a day.
  // Calling registration.update() bypasses that throttle and pulls the
  // freshly-deployed SW immediately. The new SW self-skipWaits +
  // purges the old CacheStorage on activate (see public/sw.js), so the
  // next reload — whether the operator's own, or the StaleBundleWatcher
  // countdown — lands on fresh code with NO manual cache clearing.
  //
  // Runs once (deps: []) so we don't stack listeners on every nav.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    let lastUpdate = 0;
    const maybeUpdate = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastUpdate < 60_000) return; // throttle: at most once/min
      lastUpdate = now;
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => reg?.update())
        .catch(() => { /* non-fatal */ });
    };

    document.addEventListener('visibilitychange', maybeUpdate);
    window.addEventListener('focus', maybeUpdate);
    // Kick one check shortly after mount too (covers the tab that was
    // already focused when a deploy landed).
    const kick = setTimeout(maybeUpdate, 10_000);
    return () => {
      document.removeEventListener('visibilitychange', maybeUpdate);
      window.removeEventListener('focus', maybeUpdate);
      clearTimeout(kick);
    };
  }, []);

  return null;
}
