'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Per-tenant route error boundary. Isolates errors inside a tenant's
 * routes so the rest of the admin app (cross-tenant nav, logout) stays
 * interactive if one page blows up.
 */
export default function TenantError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // 2026-06-01 — the #1 production cause of this boundary is deploy/chunk
  // skew: a page already open in the browser references JS chunk filenames
  // that a newer deploy renamed (and the CDN eventually purges). Opening a
  // code-split route (e.g. the template builder) then lazy-loads a chunk
  // that 404s → ChunkLoadError → this boundary. React's boundary swallows it
  // (so window.onerror never fires), and the old "Try again" = reset() just
  // re-imports the SAME dead chunk and crashes again (operator: "still
  // crashing"). So: detect a chunk/module-load error and do a FULL reload
  // ONCE (fetches the current build's HTML + chunks). Guarded to 1 reload /
  // 30s so a genuinely-missing chunk can't infinite-loop — it falls through
  // to the visible boundary instead.
  const errText = `${error?.name || ''} ${error?.message || ''}`;
  const isChunkError =
    /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(errText);

  useEffect(() => {
    Sentry.captureException(error);
    if (!isChunkError) return;
    try {
      const KEY = '__educms_boundary_reload_at';
      const last = Number(sessionStorage.getItem(KEY) || '0');
      if (Date.now() - last < 30_000) return; // already auto-reloaded recently → show the boundary
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch { /* sessionStorage blocked — still reload once below */ }
    window.location.reload();
  }, [error, isChunkError]);

  const handleRetry = () => {
    // A reset() re-renders the same (possibly stale) module; a full reload
    // re-fetches the current build, which is what actually recovers.
    try { window.location.reload(); } catch { /* no-op */ }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-semibold mb-2 text-slate-900 dark:text-slate-100">
          This page couldn&apos;t load
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mb-4">
          {isChunkError
            ? 'A new version was just deployed. Reloading to pick it up…'
            : 'We hit an error loading this page. The team has been notified.'}
        </p>
        {/* Surface the real error on-screen so it's diagnosable without
            DevTools (operator can read it back to us). Truncated + scrollable. */}
        {(error?.name || error?.message) && (
          <pre className="text-[11px] font-mono text-rose-600 dark:text-rose-400 mb-4 text-left whitespace-pre-wrap break-words max-h-32 overflow-auto bg-slate-50 dark:bg-slate-800/40 rounded-md p-3 border border-slate-200 dark:border-slate-700">
            {(error.name ? `${error.name}: ` : '') + (error.message || '').slice(0, 500)}
          </pre>
        )}
        {error?.digest && (
          <p className="text-xs font-mono text-slate-400 mb-5">
            Reference: {error.digest}
          </p>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={handleRetry}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Try again
          </button>
          <a
            href="/"
            className="border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-md text-sm font-medium"
          >
            Home
          </a>
        </div>
      </div>
    </div>
  );
}
