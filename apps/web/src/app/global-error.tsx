'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { clog } from '@/lib/client-logger';

/**
 * Top-level global error boundary. Catches errors in the root layout
 * itself — the only boundary that MUST render its own <html>/<body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Mirror to client-logger so the operator's downloadable log
    // captures the crash even if Sentry isn't configured for this
    // tenant yet.
    clog.error('react', 'Unhandled render error (global boundary)', {
      message: error?.message,
      digest: error?.digest,
      stack: error?.stack?.slice(0, 2000),
    });
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#0f172a',
          color: '#f1f5f9',
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: 560, textAlign: 'center' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#94a3b8', marginBottom: '1.5rem' }}>
            We hit an unexpected error. The issue has been reported and we are
            looking into it.
          </p>
          {error?.digest && (
            <p
              style={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                color: '#64748b',
                marginBottom: '1.5rem',
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button
              onClick={() => reset()}
              style={{
                background: '#6366f1',
                color: 'white',
                border: 'none',
                padding: '0.625rem 1.25rem',
                borderRadius: '0.5rem',
                fontSize: '0.95rem',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                color: '#f1f5f9',
                border: '1px solid #334155',
                padding: '0.625rem 1.25rem',
                borderRadius: '0.5rem',
                fontSize: '0.95rem',
                textDecoration: 'none',
              }}
            >
              Home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
