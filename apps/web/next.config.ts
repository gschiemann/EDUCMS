import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * INJ-002 (2026-08-02) — content CSP for the PLAYER route, REPORT-ONLY.
 *
 * Before this, the only CSP anywhere was `frame-ancestors 'self'` (below).
 * The comment there justified skipping a full policy because "the widget
 * system renders pervasive inline styles" — true, but that argues against
 * `style-src`, not against `script-src`, `object-src`, `base-uri`,
 * `form-action` or `frame-src`, which is where the actual containment value
 * is. So we ship those.
 *
 * WHY REPORT-ONLY FIRST: the player is a life-safety surface. An enforcing
 * policy that is even slightly wrong blanks a lockdown alert on thousands of
 * screens. `Content-Security-Policy-Report-Only` changes nothing about what
 * renders — the browser only logs violations to the console — so this is a
 * zero-risk way to collect the real violation set from live kiosks (including
 * the Chromium-83 Taurus units, which support CSP Level 2) before anyone
 * flips it to enforcing. There is deliberately NO `report-uri`/`report-to`:
 * we have no collector endpoint, and pointing one at a URL that 404s would
 * add a request per violation on a metered kiosk link. Console-only for now.
 *
 * WHAT `script-src` COULD HONESTLY BE TODAY: `'self' 'unsafe-inline'`.
 * Next's App Router emits its own inline bootstrap/flight scripts
 * (`self.__next_f.push(...)`) with no nonce, so a nonce-only policy would
 * break hydration on the player instantly. Reaching real nonces needs Next
 * middleware to mint a per-request nonce, thread it through
 * `next.config` → `headers` AND every inline `<script>` we emit ourselves
 * (layout.tsx's viewport-pin script, BrandStyleInjector), plus a
 * `'strict-dynamic'` rollout — a separate, testable piece of work. Until
 * then `'unsafe-inline'` means this policy does NOT stop injected inline JS;
 * what it DOES stop is loading script from a foreign host, `<object>`/applet
 * embedding, `<base>` hijacking, and form posts off-origin.
 */
function playerCspReportOnly(): string {
  const apiOrigin = (() => {
    const raw = process.env.NEXT_PUBLIC_API_URL;
    if (!raw) return null;
    try {
      return new URL(raw).origin;
    } catch {
      return null;
    }
  })();
  // Unset NEXT_PUBLIC_API_URL is the documented local-dev case (the client
  // falls back to localhost:8080), so fall back to the same thing rather than
  // emitting a policy that reports a violation on every dev request.
  const api = apiOrigin ?? 'http://localhost:8080';
  const wsApi = api.replace(/^http/, 'ws');
  const isDev = process.env.NODE_ENV !== 'production';

  return [
    "default-src 'self'",
    // See the note above: 'unsafe-inline' is required by Next's own inline
    // bootstrap today. `next dev` additionally evals its HMR runtime.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    // Widgets render pervasive inline styles + inline <style> blocks; Google
    // Fonts is used by the templates.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // Assets are operator-supplied URLs (Supabase bucket, CDN, stock photos).
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    // hls.js spins up a blob: worker; the service worker is same-origin.
    "worker-src 'self' blob:",
    `connect-src 'self' ${api} ${wsApi} https: wss:`,
    // The player frames: its own /player tiles, the API proxy (WEBPAGE +
    // text/html assets), Supabase-hosted PDFs, and streaming embeds.
    `frame-src 'self' ${api} https:`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

const nextConfig: NextConfig = {
  // Inline the deploy's git SHA into the CLIENT bundle so the StaleBundleWatcher
  // (stale-tab detection) and the bug reporter's `buildSha` telemetry actually
  // have a value to read. Vercel injects VERCEL_GIT_COMMIT_SHA at build time; the
  // NEXT_PUBLIC_ prefix is what makes Next inline it to the browser. Without this
  // the client reads of NEXT_PUBLIC_BUILD_SHA were always undefined — so we
  // couldn't tell a stale tab from a live bug (the 2026-06-08 Safari fire).
  // Empty on local builds, which is fine — only prod needs it.
  env: {
    NEXT_PUBLIC_BUILD_SHA:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.NEXT_PUBLIC_BUILD_SHA ||
      '',
  },
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
        // Security headers on every route. Closes the clickjacking gap
        // (no X-Frame-Options / frame-ancestors existed before),
        // enforces HTTPS, and blocks MIME-sniffing. A full content CSP
        // (script-src / style-src) is deliberately NOT set here: the
        // widget system renders pervasive inline styles and inline
        // <style> blocks, so an enforcing content CSP needs a
        // nonce-based rollout verified across every player + widget
        // surface. These five headers carry zero rendering risk.
        //
        // 2026-08-02 (INJ-002): a CONTENT policy now ships on the player
        // route in REPORT-ONLY mode — see playerCspReportOnly() above. It is
        // scoped to /player deliberately: that is the surface an attacker
        // reaches through a WEBPAGE widget or a text/html asset, and it is
        // the one we can validate on real kiosks without risking the
        // dashboard.
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // 2026-08-04 — Permissions-Policy. This was the one standard security
          // header still missing, and district security scans look for it.
          //
          // Built from an ACTUAL capability census of apps/web/src, not a
          // copied template, because a wrong value here silently disables a
          // browser API on every screen we run:
          //   camera        USED  — /pair (QR enrolment) and
          //                         screens/sync-calibrate both call
          //                         getUserMedia. Both are top-level React
          //                         pages, and no iframe requests camera via
          //                         `allow=`, so `self` is sufficient.
          //   microphone    UNUSED — both getUserMedia calls pass
          //                         `audio: false`, and there is no other
          //                         mediaDevices caller. Denied outright.
          //   geolocation   USED  — 21 files (address pickers).
          //   payment       USED  — Stripe surfaces.
          //   autoplay      USED  — signage boards: 20 files reference
          //                         autoplay, 41 contain <video>. Left at
          //                         `self`; denying it would black out video
          //                         playback on every screen.
          //   screen-wake-lock  currently 0 callers, but deliberately ALLOWED:
          //                         this is digital signage, keeping a display
          //                         awake is squarely in-product, and a future
          //                         caller would otherwise hit a silent no-op
          //                         that is painful to debug.
          //
          // Everything denied below has ZERO callers in the codebase: exotic
          // hardware bridges (bluetooth/serial/usb/hid/midi), screen capture,
          // the motion sensors, font enumeration, idle detection and XR.
          //
          // NOTE on semantics: a feature you do not list keeps its BROWSER
          // DEFAULT — listing is not required to permit something. The
          // `(self)` entries are therefore no-ops today, written out on
          // purpose so the intent is explicit and a future edit cannot quietly
          // change a used capability.
          {
            key: 'Permissions-Policy',
            value: [
              // used — pinned to our own origin
              'camera=(self)',
              'geolocation=(self)',
              'payment=(self)',
              'autoplay=(self)',
              'fullscreen=(self)',
              'screen-wake-lock=(self)',
              // unused — denied everywhere, including our own origin
              'microphone=()',
              'bluetooth=()',
              'serial=()',
              'usb=()',
              'hid=()',
              'midi=()',
              'display-capture=()',
              'idle-detection=()',
              'local-fonts=()',
              'xr-spatial-tracking=()',
              'accelerometer=()',
              'gyroscope=()',
              'magnetometer=()',
              'ambient-light-sensor=()',
            ].join(', '),
          },
        ],
      },
      {
        source: '/player',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
          // REPORT-ONLY. Never promote this to `Content-Security-Policy`
          // without first reading the violation reports off real kiosks —
          // this route is what shows a lockdown alert.
          { key: 'Content-Security-Policy-Report-Only', value: playerCspReportOnly() },
        ],
      },
      {
        // Player sub-routes (tiles, diagnostics) get the same report-only
        // policy. Separate entry because Next matches one source per object.
        source: '/player/:path*',
        headers: [
          { key: 'Content-Security-Policy-Report-Only', value: playerCspReportOnly() },
        ],
      },
      {
        // Service Worker MUST never be HTTP-cached or kiosks won't
        // pick up new versions until the SW's own self-update fires.
        // Vercel defaults give it a public, max-age=0 already, but
        // some Android System WebView builds ignore that and use a
        // stale-while-revalidate heuristic. Make it explicit.
        //
        // 2026-06-08 — BOTH service workers need this. Originally only
        // /sw-player.js (kiosk) carried it; the dashboard's /sw.js was
        // left on Vercel's default, so Safari/Chrome could hold a stale
        // dashboard SW across deploys. A stale dashboard SW kept serving
        // an old cached app shell from CacheStorage — which a normal
        // reload can't escape (only "clear site data" does). That was
        // the root of the "I have to click everything twice / clear my
        // cache after every update" report. Explicit no-store on /sw.js
        // means the browser always revalidates the SW script and adopts
        // a freshly-deployed version on the next load. The matching
        // sources MUST stay separate objects (Next matches one source
        // per entry).
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate, max-age=0' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
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
