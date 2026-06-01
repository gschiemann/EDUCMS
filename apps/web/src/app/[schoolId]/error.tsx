'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Per-tenant route error boundary. Isolates errors inside a school's
 * routes so the rest of the admin app (cross-tenant nav, logout) stays
 * interactive if one school's data fetch blows up.
 */
export default function TenantError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  // 2026-06-01 — "Try again" does a FULL reload, not React's reset().
  // The common cause of this boundary in production is deploy/chunk skew:
  // a new build renamed the JS chunks, but the page in the browser still
  // references the old ones, so loading a route (e.g. opening the builder)
  // throws ChunkLoadError. reset() just re-renders the SAME stale module
  // and crashes again (operator: "still crashing" after Try again). A
  // hard reload re-fetches the current build's HTML + chunks, which is
  // what actually recovers.
  const handleRetry = () => {
    try { window.location.reload(); } catch { /* no-op */ }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-semibold mb-2 text-slate-900 dark:text-slate-100">
          This page couldn&apos;t load
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mb-5">
          We hit an error loading this page. The team has been notified.
        </p>
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
