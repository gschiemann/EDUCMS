"use client";

import { useEffect } from 'react';

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

    // 2026-06-08 — Dashboard service worker DISABLED. It caused a recurring
    // class of bugs: stale bundles after deploys, and (today) an unresponsive
    // worker that wedged Next.js client-side navigation (clicks did nothing;
    // only a hard refresh worked). For an admin dashboard that bypasses /api/,
    // offline support was never useful — the risk far outweighs the benefit.
    //
    // We no longer register it. Instead, ACTIVELY unregister any existing
    // dashboard worker and purge its caches so every client that loads this
    // build sheds the worker immediately and returns to plain network. Only
    // the dashboard SW (scriptURL .../sw.js) is touched — never the kiosk
    // player's sw-player.js. (public/sw.js is itself a self-destruct stub now,
    // covering clients that don't reach this code.)
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        for (const r of regs) {
          try {
            if (r.active && /\/sw\.js(\?|$)/.test(r.active.scriptURL)) {
              r.unregister().catch(() => {});
            }
          } catch { /* noop */ }
        }
      })
      .catch(() => { /* noop */ });
    if (typeof caches !== 'undefined') {
      caches.keys()
        .then((keys) => keys.filter((k) => k.startsWith('edu-shell-')).forEach((k) => { caches.delete(k).catch(() => {}); }))
        .catch(() => {});
    }
    // Run ONCE on mount (deps: []), not on every navigation. The previous
    // [pathname] version called getRegistrations() on every client nav —
    // pure overhead, and it hangs ~45s per nav if a worker is wedged.
  }, []);

  return null;
}
