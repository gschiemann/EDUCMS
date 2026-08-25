"use client";

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BrandingProvider } from '@/lib/branding-context';
import { I18nProvider } from '@/i18n/I18nProvider';
import { installThumbTransformFallback } from '@/lib/asset-image';
import { AppToaster } from '@/components/ui/AppToaster';
import { buildMutationCache } from '@/lib/mutation-error-cache';

export default function Providers({ children }: { children: React.ReactNode }) {
  // Supabase image-transform fallback (2026-07-30): on the Free plan the
  // /render/image/ thumbnail URLs 400; this one capture-phase listener
  // swaps any failed transform back to the raw object URL app-wide. On
  // Pro it never fires. See asset-image.ts.
  useEffect(() => installThumbTransformFallback(), []);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Cache-level mutation errors → one plain-English toast, so a failed
        // save stops being invisible. ADDITIVE to every existing per-mutation
        // onError, so the optimistic rollbacks in use-api.ts are untouched.
        // Opt a surface out with `meta: { suppressGlobalError: true }`.
        // See lib/mutation-error-cache.ts.
        mutationCache: buildMutationCache(),
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
      {/* I18nProvider is client-side by design (static prerender stays
          intact — see src/i18n/config.ts). It renders English on the
          server/first paint and applies the saved language after mount. */}
      <I18nProvider>
        <BrandingProvider>{children}</BrandingProvider>
      </I18nProvider>
      {/* One toast host for the whole app (dashboard + login + marketing).
          Pinned BELOW the emergency overlay — see AppToaster's z-index note. */}
      <AppToaster />
    </QueryClientProvider>
  );
}
