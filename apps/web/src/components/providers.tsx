"use client";

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 5-minute staleTime covers 99% of screens — templates, widget
            // catalog, user lists, playlists all rarely change during a
            // session. Cached results render instantly on re-navigation.
            staleTime: 5 * 60 * 1000,
            // Refetch when the tab regains focus so the user always sees
            // fresh data after switching apps — cheaper than polling.
            refetchOnWindowFocus: true,
            // DO NOT add a global refetchInterval here. It turns every
            // mounted page into a polling storm (every useQuery — screens,
            // assets, users, settings — would re-fire every N seconds,
            // which is the #1 cause of "clicking around feels slow" that
            // the Vercel-deploy audit uncovered 2026-04-19. Opt-in to
            // polling per-hook only where it's genuinely needed (emergency
            // status, tenant status, notifications).
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
