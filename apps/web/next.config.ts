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
