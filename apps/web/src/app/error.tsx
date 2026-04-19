'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Root-route error boundary — catches errors below the root layout so
 * the chrome (nav / shell) stays mounted while we show recovery UI.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-semibold mb-2 text-slate-900 dark:text-slate-100">
          Something went wrong
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mb-5">
          This page failed to load. The error has been reported.
        </p>
        {error?.digest && (
          <p className="text-xs font-mono text-slate-400 mb-5">
            Reference: {error.digest}
          </p>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => reset()}
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
