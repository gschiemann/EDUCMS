import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Allow the API domain for images
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.educms.io' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  // Drop source maps from the prod browser bundle — user-facing pages
  // don't need them and they double bundle size / transfer time.
  productionBrowserSourceMaps: false,
  // 2026-05-04 — operator (Goodview Chromium 95 install): pushed 4
  // CSS fixes in a row, kiosk kept showing the OLD bundle because
  // Android System WebView's HTTP cache serves /player HTML for hours
  // even after we redeploy. Force the player route to revalidate on
  // every request so a redeploy reaches the kiosk on next manifest
  // poll instead of waiting for cache TTL. The static chunks
  // (/_next/static/chunks/*) are content-hashed so they keep their
  // long max-age — only the SHELL HTML at /player needs to be
  // never-cached.
  async headers() {
    return [
      {
        source: '/player',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
      {
        // Service Worker MUST never be HTTP-cached or kiosks won't
        // pick up new versions until the SW's own self-update fires.
        // Vercel defaults give it a public, max-age=0 already, but
        // some Android System WebView builds ignore that and use a
        // stale-while-revalidate heuristic. Make it explicit.
        source: '/sw-player.js',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate, max-age=0' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
  experimental: {
    // Without this, `import { Clock } from 'lucide-react'` pulls the whole
    // icon barrel into every route's bundle. Same for Base UI + dnd-kit +
    // react-query. Per 2026-04-19 perf audit this is a multi-hundred-KB
    // saving on first paint for /settings, /templates, and every dashboard.
    optimizePackageImports: [
      'lucide-react',
      '@base-ui/react',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/modifiers',
      '@dnd-kit/utilities',
      '@tanstack/react-query',
      'date-fns',
      'isomorphic-dompurify',
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // Suppress Sentry CLI output during builds
  silent: true,
  // Do not upload source maps (enable later with SENTRY_AUTH_TOKEN — see docs/OBSERVABILITY.md)
  sourcemaps: {
    disable: true,
  },
  // Do not auto-wrap server route handlers; we use the instrumentation hook instead
  autoInstrumentServerFunctions: false,
  // Disable SDK telemetry pings to Sentry
  telemetry: false,
});
