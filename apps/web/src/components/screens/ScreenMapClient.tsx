"use client";

// Leaflet relies on `window`, so the map component must be loaded
// dynamically with SSR disabled. Next.js 16 App Router requires the
// dynamic call to be from a client component.
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

export const ScreenMapClient = dynamic(
  () => import('./ScreenMap').then(m => m.ScreenMap),
  {
    ssr: false,
    loading: () => (
      // Match ScreenMap's responsive height so the skeleton doesn't
      // flash a 600px slab on a phone before the map mounts.
      <div className="h-[60dvh] max-h-[600px] sm:h-[600px] sm:max-h-none w-full rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    ),
  },
);
