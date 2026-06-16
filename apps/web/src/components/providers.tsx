"use client";

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrandingProvider } from '@/lib/branding-context';

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
            // 2026-06-16 mobile-perf: DEFAULT OFF. refetchOnWindowFocus:true as
            // a GLOBAL default meant every app-switch fired a refetch sweep
            // across every mounted query — on a phone (tap home, glance at
            // another app, tap back) that burst of synchronous refetch +
            // state-update + re-render lands right when the operator is
            // tapping the bottom nav, so the tap queues and "the menu doesn't
            // pop up right away." The few queries that genuinely want
            // fresh-on-return (live fleet status) opt in per-hook. Everything
            // else stays fresh via the 5-min staleTime + its own poll.
            refetchOnWindowFocus: false,
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
      {/* BrandingProvider must be INSIDE QueryClientProvider — it uses
          useTenantBranding() which is a useQuery hook. Outside, the
          hook throws "No QueryClient set." */}
      <BrandingProvider>{children}</BrandingProvider>
    </QueryClientProvider>
  );
}
