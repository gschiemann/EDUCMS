"use client";

/**
 * BugCaptureProviders — mounts the bug-reporter ringbuffer interceptors
 * + wires React Query's QueryClient into the capture snapshot.
 *
 * The four ringbuffers (breadcrumbs / console / network / react-query)
 * are global side effects (console + fetch are monkey-patched, click +
 * route listeners are document-level). We install them inside a client
 * component mounted from `apps/web/src/app/layout.tsx` so:
 *
 *   1. SSR never executes the install (no `window`).
 *   2. The install runs exactly once per tab lifetime (the install fn
 *      itself is idempotent — Next Strict Mode is safe).
 *   3. The QueryClient (from <Providers />, which sits above this in the
 *      tree) is grabbed via useQueryClient and handed to the snapshot
 *      function. Without this the React Query section of every bug
 *      bundle would be empty.
 *
 * Renders nothing — this is plumbing.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  installBugCaptureRingbuffers,
  setBugCaptureQueryClient,
} from '@/lib/bug-ringbuffers';

export function BugCaptureProviders() {
  const queryClient = useQueryClient();

  useEffect(() => {
    installBugCaptureRingbuffers();
  }, []);

  useEffect(() => {
    setBugCaptureQueryClient(queryClient);
    return () => setBugCaptureQueryClient(null);
  }, [queryClient]);

  return null;
}
