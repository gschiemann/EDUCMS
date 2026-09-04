import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * ═══ SEC-010 (2026-09-04) — CSP ROLLOUT: WHAT IS ENFORCED, WHAT IS OBSERVED ═══
 *
 * Three policies now ship from this file. Read this block before changing any
 * of them; the split is deliberate and each half is load-bearing.
 *
 *  1. `baselineEnforcedCsp()` — ENFORCING, every path on this origin
 *     (dashboard, player, and the static board HTML under `public/`).
 *     `frame-ancestors 'self'` (as before) plus `object-src 'none'`,
 *     `base-uri 'none'`, `form-action 'self'`.
 *  2. `playerCspReportOnly()` — REPORT-ONLY on `/player*`, unchanged in
 *     substance, now with a `report-uri` so it produces evidence.
 *  3. `dashboardCspReportOnly()` — REPORT-ONLY on dashboard routes. NEW.
 *     Carries the tight `connect-src` we would like to enforce.
 *
 * WHY THE FOUR ENFORCING DIRECTIVES ARE SAFE — each verified by code sweep,
 * not by assumption (the sweeps are recorded in
 * `docs/research/2026-09-04-security-remediation/SEC-010-011-csp-telemetry.md`):
 *   `object-src 'none'`  no `<object>`/`<embed>` exists in `apps/web/src`, in
 *                        the ~320 static board HTML files under `public/`, or
 *                        in AI-designer output (the sanitizer in
 *                        `src/lib/designer-safe-srcdoc.ts` strips all three
 *                        and sets `object-src 'none'` itself). The PDF preview
 *                        uses `<iframe>` (`templates/imports/page.tsx:441`).
 *   `base-uri 'none'`    no `<base>` element anywhere on this origin. Note
 *                        `base-uri` restricts only the `<base>` ELEMENT; it
 *                        does not change a document's implicit base URL, so
 *                        `'none'` costs nothing and is stricter than `'self'`.
 *   `form-action 'self'` all 17 `<form>` tags are React `onSubmit` handlers
 *                        with no `action` attribute. Every off-origin trip
 *                        (Stripe Checkout, SSO start, docs links) is a
 *                        top-level `window.location` / `window.open`
 *                        navigation, which no CSP directive governs.
 *
 * WHERE `script-src` LIVES NOW (SEC-010 re-audit, 2026-09-04): NOT in this
 * file. It is ENFORCED, nonce-based, and emitted per request by
 * `src/proxy.ts` — a per-request nonce cannot come from a static `headers()`
 * entry. See `src/lib/csp-script-policy.ts` for the policy and
 * `src/lib/csp-nonce.ts` for how the nonce reaches the browser. The two
 * blockers this file used to record are both resolved:
 *   (a) the middleware matcher was widened to dashboard documents (assets,
 *       `/player` and the static board HTML are excluded by construction);
 *   (b) the `srcdoc` inheritance blocker — an `about:srcdoc` document
 *       inherits its embedder's policy, so an AI-designer board stamped with
 *       its own fresh nonce was refused by the parent policy. MEASURED in
 *       Chromium, WebKit and Gecko on 2026-09-04: a srcdoc script with a
 *       nonce the parent does not list is blocked in all three; with the
 *       PARENT's nonce it runs in all three. `designer-safe-srcdoc.ts` now
 *       stamps the page nonce when the document was served under one.
 * The report-only policies below keep their `script-src 'self'
 * 'unsafe-inline'` line deliberately: they are a SEPARATE policy from the
 * enforced one, and dropping the directive would make every inline script
 * fall through to their `default-src 'self'` and report on every page load,
 * burying the `connect-src` signal they exist to collect.
 *
 * Everything OTHER than `script-src` — `connect-src`, `frame-src`,
 * `style-src`, `img-src`, `media-src`, `worker-src` — remains REPORT-ONLY,
 * because the collector has no fleet data yet and `connect-src` has a known
 * false positive (see `dashboardCspReportOnly`). Enforcing those off a guess
 * is how a screen goes blank.
 */

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
 *
 * 2026-09-04 (SEC-010): the "no report-uri" paragraph above is now OBSOLETE —
 * a collector exists at `/api/csp-report` (see that route for its throttle and
 * URL-redaction rules), so this policy finally produces evidence instead of
 * logging to a console on a wall-mounted panel nobody opens. What has NOT
 * changed is the substance of the policy: tightening `connect-src`/`frame-src`
 * off a guess is exactly the move that blanks a lockdown alert, and the whole
 * point of the reporting loop is to replace the guess with data first.
 * The player DID tighten in one real way: the four directives in
 * `baselineEnforcedCsp()` are now ENFORCED on this route too.
 */

/** Same-origin sink for violation reports. See `src/app/api/csp-report/route.ts`. */
const CSP_REPORT_PATH = '/api/csp-report';

/**
 * Kill switch for the reporting loop, read at BUILD time.
 *
 * `report-uri` costs one extra request per violation, and a kiosk may be on a
 * metered link. Set `CSP_REPORTING_DISABLED=1` and redeploy to drop the
 * directive from every policy. Only `report-uri` is emitted (not `report-to`):
 * it is the form Safari/WebKit and the Chromium-83 Taurus floor understand,
 * and a `report-to` group that fails to resolve makes modern Chromium send
 * NOTHING rather than falling back — a silent loss of the only signal we have.
 */
function cspReportDirective(): string | null {
  const off = process.env.CSP_REPORTING_DISABLED;
  if (off === '1' || off === 'true') return null;
  return `report-uri ${CSP_REPORT_PATH}`;
}

/**
 * The API origin every policy needs, derived once.
 *
 * Unset `NEXT_PUBLIC_API_URL` is the documented local-dev case (the client
 * falls back to localhost:8080), so fall back to the same thing rather than
 * emitting a policy that reports a violation on every dev request.
 */
function apiOriginForCsp(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return 'http://localhost:8080';
  try {
    return new URL(raw).origin;
  } catch {
    return 'http://localhost:8080';
  }
}

/** A configured origin, or nothing — used for optional envs in an allowlist. */
function optionalOrigin(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    return [new URL(raw).origin];
  } catch {
    return [];
  }
}

/**
 * ENFORCING on every path. The four directives whose safety is proven by
 * sweep (see the block at the top of this file) — no `script-src`, no
 * `default-src`, nothing that can blank a screen.
 *
 * This value applies to the static board HTML under `public/` as well, which
 * is why `form-action`/`object-src`/`base-uri` had to be verified against
 * those documents and not just against `src/`. Those boards render in
 * `sandbox`ed iframes WITHOUT `allow-same-origin`, so their origin is opaque
 * and `'self'` matches nothing inside them — `form-action 'self'` is
 * effectively `'none'` there. That is fine today (no board contains a
 * `<form>`) and would be a real breakage the day one does, so a new board with
 * a form needs this revisited rather than a blind widening.
 */
function baselineEnforcedCsp(): string {
  return [
    'frame-ancestors \'self\'',
    'object-src \'none\'',
    'base-uri \'none\'',
    'form-action \'self\'',
    cspReportDirective(),
  ]
    .filter((d): d is string => Boolean(d))
    .join('; ');
}

function playerCspReportOnly(): string {
  const api = apiOriginForCsp();
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
    "base-uri 'none'",
    "form-action 'self'",
    cspReportDirective(),
  ]
    .filter((d): d is string => Boolean(d))
    .join('; ');
}

/**
 * REPORT-ONLY on the dashboard. NEW — SEC-010.
 *
 * This is not a copy of the player policy with a different name. It is a
 * deliberate EXPERIMENT, and the thing it is testing is `connect-src`.
 *
 * SEC-010's stated impact is "an XSS can steal an active bearer and call APIs
 * as the victim". The bearer is JavaScript-readable and remembered sessions
 * last 30 days, so the containment that actually matters is not "can injected
 * script run" (it can, until nonces land) but "where can injected script SEND
 * what it stole". A `connect-src` allowlist is exactly that control, and
 * unlike `script-src` it does not need nonces to be correct — it needs an
 * accurate host inventory. So the hosts below are enumerated rather than
 * wildcarded, and this ships report-only precisely so the fleet tells us what
 * the inventory missed before anything is blocked.
 *
 * ONE KNOWN VIOLATION IS EXPECTED, and is the reason `https:` is absent:
 * `FitnessMusicPlayerWidget` polls an operator-typed `nowPlayingEndpoint`
 * (`src/components/widgets/fitness/FitnessMusicPlayerWidget.tsx:66-73`), which
 * can be any host. Enforcing this `connect-src` would break that one field.
 * That is a product decision (proxy it through the API, like RSS/iCal/custom
 * JSON already are, or accept a wildcard) — the reports will show how often it
 * actually fires before anyone has to make it.
 *
 * `img-src`/`media-src` deliberately KEEP `https:`. The dashboard is not a
 * plain admin app: the template builder and every preview render the same
 * widgets the player does, against operator-pasted image, video and audio
 * URLs, plus the branding wizard's pre-adopt logos scraped from the customer's
 * own site. There is no allowlist to be had there, and pretending otherwise
 * would just fill the log with noise that hides the connect-src signal.
 *
 * `script-src` here is NOT the real script policy any more. The enforcing,
 * nonce-based one ships from `src/proxy.ts` (SEC-010, 2026-09-04). This
 * directive keeps `'unsafe-inline'` so that THIS policy — a separate one, with
 * its own `default-src 'self'` — does not report a script violation on every
 * page load and drown the `connect-src` signal it exists to collect.
 */
function dashboardCspReportOnly(): string {
  const api = apiOriginForCsp();
  const isDev = process.env.NODE_ENV !== 'production';
  const assetCdn = optionalOrigin(process.env.NEXT_PUBLIC_ASSET_CDN);
  const growthbook = optionalOrigin(process.env.NEXT_PUBLIC_GROWTHBOOK_API_HOST);

  const connect = [
    "'self'",
    api,
    // Sentry's browser SDK posts envelopes to the DSN's ingest host. New orgs
    // are provisioned on a REGIONAL host (`oNNN.ingest.us.sentry.io`), so both
    // shapes are listed; add `.de.` if the org ever moves to the EU region.
    'https://*.ingest.sentry.io',
    'https://*.ingest.us.sentry.io',
    // Weather + location widgets call these directly from the browser. The
    // Google Geocoding key never reaches the client (server-side proxy at
    // `GET /api/v1/geocode`), so no Google host belongs here.
    'https://api.open-meteo.com',
    'https://geocoding-api.open-meteo.com',
    'https://api.zippopotam.us',
    'https://ipapi.co',
    // Address autocomplete (screen location + signup) queries both providers
    // in parallel and merges.
    'https://photon.komoot.io',
    'https://nominatim.openstreetmap.org',
    ...assetCdn,
    ...growthbook,
  ].join(' ');

  // Kept in lockstep with STREAMING_EMBED_HOSTS in
  // `src/components/widgets/streaming-hosts.ts` — that list is what
  // `safeEmbedSrc` will pass through verbatim, so the two must not drift or
  // streams black out the day this is enforced.
  const frame = [
    "'self'",
    'blob:',
    api,
    'https://www.youtube.com',
    'https://youtube.com',
    'https://www.youtube-nocookie.com',
    'https://player.vimeo.com',
    'https://vimeo.com',
    'https://player.twitch.tv',
    'https://twitch.tv',
    'https://kick.com',
    'https://*.kick.com',
    // PDF + text/html asset previews are framed at the asset's own host.
    'https://*.supabase.co',
    'https://cdn.educms.io',
    ...assetCdn,
  ].join(' ');

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    // 9,465 `style={{…}}` attributes and 260 inline <style> blocks: nonces do
    // not apply to style ATTRIBUTES at all, so 'unsafe-inline' is structural
    // here, not laziness. `fonts.googleapis.com` is the stylesheet host for
    // the 107 files that load Google Fonts.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    // hls.js runs its demuxer in a blob: worker (`enableWorker: true`).
    "worker-src 'self' blob:",
    `connect-src ${connect}`,
    `frame-src ${frame}`,
    // `child-src` is the CSP2 fallback the Chromium-83 Taurus units read when
    // they do not understand `frame-src`/`worker-src`. Union of the two —
    // `frame` already carries `blob:`, which is also all `worker-src` adds.
    `child-src ${frame}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    cspReportDirective(),
  ]
    .filter((d): d is string => Boolean(d))
    .join('; ');
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
        //
        // 2026-09-04 (SEC-010): the enforcing CSP below is no longer only
        // `frame-ancestors`. It now also carries `object-src 'none'`,
        // `base-uri 'none'` and `form-action 'self'` on EVERY path — the
        // subset whose safety is proven by sweep. `script-src` is not here;
        // the top-of-file block says exactly why and what it would take.
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: baselineEnforcedCsp() },
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
        // SEC-010 — the dashboard's report-only experiment.
        //
        // The exclusion list is not decoration. Each entry would otherwise
        // produce reports that are pure noise and would drown the connect-src
        // signal this policy exists to collect:
        //   player            has its own, deliberately different policy above
        //                     (two report-only headers on one response would
        //                     be ambiguous to read back).
        //   templates/        the ~320 static board documents. They load in
        //   holiday-templates/  sandboxed iframes WITHOUT `allow-same-origin`,
        //   celebrations/       so their origin is opaque and `'self'` matches
        //   demo/               NOTHING inside them — every same-origin script
        //                     and stylesheet they load would report as a
        //                     violation of a policy that was never written
        //                     for them.
        //   _next/            build assets; a CSP on a JS chunk does nothing.
        //   api/              route handlers return JSON, and putting a
        //                     policy on the report collector itself is circular.
        //
        // Written as a single `:path` param with a negative lookahead because
        // that is the form Next's path-to-regexp accepts; `source` entries do
        // not compose, so this and the `/player` entries above must stay
        // mutually exclusive or a response gets two report-only headers.
        source: '/:path((?!player$|player/|templates/|holiday-templates/|celebrations/|demo/|_next/|api/).*)',
        headers: [
          { key: 'Content-Security-Policy-Report-Only', value: dashboardCspReportOnly() },
        ],
      },
      {
        // The root path is not matched by the negative-lookahead source above
        // in every path-to-regexp version, so it gets its own entry. `/` is
        // the marketing/redirect page — cheap to cover, and leaving the app's
        // front door as the one unobserved document would be an odd hole.
        source: '/',
        headers: [
          { key: 'Content-Security-Policy-Report-Only', value: dashboardCspReportOnly() },
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
