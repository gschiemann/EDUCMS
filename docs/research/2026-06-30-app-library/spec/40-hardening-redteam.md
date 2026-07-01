# App Library — Cross-Cutting Hardening & Red-Team Spec (40)

Companion to the App Library build spec. This is the **security / reliability
floor** every app in the registry must clear before it ships. It red-teams the
whole plan in `../00-SYNTHESIS.md` and turns the seven risk categories into
concrete, code-grounded mitigations a mid-level dev can implement without
guessing.

**How to read this doc:** each app in the registry (`AppDefinition`, spec 10)
gets a `hardening` block. This file defines the shape of that block, the shared
services it leans on (most already exist in our codebase), and the invariants CI
must enforce. When you add an app, you fill in its `hardening` block and the app
is done only when every gate below is green.

Grounding — the real files this spec builds on (all verified to exist today):

| Concern | File | What it already gives us |
|---|---|---|
| SSRF-safe fetch | `apps/api/src/branding/safe-fetch.ts` | `safeFetch` / `safeFetchPost` / `assertPublicUrl` / `validatePublicUrl` — scheme+port+IP-literal block, DNS-resolve reject-private, **connect-time DNS-rebind pin** (`ssrfSafeLookup`), 3-hop redirect re-validation, byte cap, timeout, transparent gzip/br decode |
| Web embed proxy | `apps/api/src/proxy/proxy.controller.ts` | `/api/v1/proxy/web` — strips X-Frame-Options/CSP so any site can iframe; per-IP throttle 60/min; **interactive mode runs upstream JS unsandboxed same-origin** (the biggest new risk) |
| Headless render | `apps/api/src/proxy/renderer.service.ts` | Puppeteer SSR w/ `assertPublicUrl` gate + per-sub-request `validatePublicUrl`, cache TTL, concurrency cap, browser recycle — the base for snapshot-to-Asset + Secure Dashboards |
| Generic data feed | `apps/api/src/data-source/data-source.service.ts` + `data-source-rate-limiter.ts` | `safeFetch`-backed JSON/CSV normalizer, MAX_ROWS/COLS/CELL caps, **120/hr/tenant + 4000/hr global** in-memory limiter |
| Emergency media allowlist | `apps/api/src/emergency/media-url-guard.ts` | strict host-allowlist pattern (`isAllowedEmergencyMediaUrl`) — the model for tighter per-category URL policies |
| Widget render contract | `apps/web/src/components/widgets/WidgetRenderer.tsx` | the `switch` is the render contract; `WebpageWidget` / `ExternalHtmlWidget` / `StreamingWidget` are the iframe hosts |
| Device capability detect | `apps/web/src/lib/capabilities.ts` | `detectCapabilities()` → `chromiumMajor`, `modernChromium`, per-feature flags — the basis for the per-app Taurus badge + runtime downgrade |
| Outbound webhook (SSRF) | `apps/api/src/webhooks/webhook-dispatch.service.ts` | `safeFetchPost` reuse pattern for the Phase-3 Webhook-in app |
| API CSP | `apps/api/src/main.ts` (helmet, ~L108) | `frameSrc: ['self', https:, http:]`, `scriptSrc: ['self']`, `objectSrc: ['none']` |
| Web CSP | `apps/web/next.config.ts` (`headers()`, ~L50) | dashboard sends `X-Frame-Options: SAMEORIGIN` + `frame-ancestors 'self'` |

---

## 0. The `hardening` block — every app carries one

Add to the `AppDefinition` interface (spec 10). This is the single place an app
declares its risk posture; the picker, the config form, the player, and CI all
read it.

```ts
// packages/api-types/src/apps.ts  (new — shared FE+BE)
export interface AppHardening {
  /**
   * Does this app's live render run on a Chromium-83 Taurus LED controller?
   *   'safe'      — pure client render or official iframe known to work on 83
   *                 (YouTube /embed, QR, Clock, brand-native TICKER/LIVE_DATA).
   *   'snapshot'  — the LIVE embed will NOT run on 83; the player MUST show the
   *                 server-rendered snapshot image instead (Slides, Canva,
   *                 Power BI, most publish-to-web dashboards, social walls).
   *   'blocked'   — cannot run on Taurus at all AND cannot be snapshotted
   *                 meaningfully (interactive-only apps). Picker warns; the app
   *                 is hidden when the target screen group is flagged LED/Taurus.
   */
  taurus: 'safe' | 'snapshot' | 'blocked';

  /** How the app reaches the network at render time. Drives the sandbox policy. */
  renderKind:
    | 'client-only'        // QR, Clock, Countdown — no network, offline-safe
    | 'official-iframe'    // provider's own /embed URL, loaded direct (no proxy)
    | 'proxied-iframe'     // arbitrary URL through /api/v1/proxy/web
    | 'server-data'        // server fetches → brand-native widget (TICKER etc.)
    | 'headless-snapshot'  // renderer.service → image/HTML into a widget
    | 'authed-headless';   // Secure Dashboards — server logs in, then renders

  /** Where server-side fetches (preflight/data/snapshot) must be gated. */
  ssrf: 'none' | 'safeFetch' | 'assertPublicUrl' | 'host-allowlist';

  /**
   * Minimum seconds between refreshes the config form will ALLOW, and the
   * default it seeds. Guards paid tiers + rate caps. See §4.
   */
  refresh: { defaultSec: number; minSec: number };

  /** Cost posture — surfaced in the picker + used to decide key ownership. */
  cost: 'free' | 'free-tier-capped' | 'paid-key' | 'managed-tier';

  /** Legal/ToS obligations the render MUST honor. See §3. */
  attribution?: 'google' | 'yelp' | 'tripadvisor' | 'pexels' | 'none';

  /** Does connecting this app store a credential? Drives §2 credential rules. */
  credentials: 'none' | 'public-url' | 'api-key' | 'oauth';

  /** True when the produced content becomes internet-public (publish-to-web). */
  publicExposure: boolean;
}
```

Every registry entry sets this. A missing/malformed block fails the registry
lint (§7 CI-1). Sensible library defaults for the ~90% "config → existing
widget" apps: `{ taurus:'safe', renderKind:'server-data'|'official-iframe',
ssrf:'safeFetch', refresh:{defaultSec:900,minSec:300}, cost:'free',
credentials:'public-url', publicExposure:false }`.

---

## 1. Taurus Chromium-83 — what will NOT render, and the fallbacks

**Constraint (CLAUDE.md rule #10):** NovaStar Taurus LED controllers ship
Chromium **83–87** (worst case 83). Modern embeds and CSS silently fail there.
`detectCapabilities().chromiumMajor` (from `capabilities.ts`) is our runtime
oracle; treat `chromiumMajor > 0 && chromiumMajor < 88` as "Taurus-class."

### 1a. Which apps are `snapshot` / `blocked` (the classification)

| App | Taurus verdict | Why |
|---|---|---|
| YouTube `/embed`, Vimeo player | `safe` | official iframes work on Chromium 83 (H.264 + basic JS) |
| QR, Clock, Countdown, Date | `safe` | pure client render, zero network — also offline-safe |
| News/RSS, Stocks/Crypto/Currency, Reviews (brand-native), any Generic Data-Source render | `safe` | server fetches, we render into our own TICKER/LIVE_DATA React widgets that already pass the taurus-safety gate |
| Weather | `safe` | already shipped, renders in-house |
| **Google Slides, Canva, Google Sheets embed, PowerPoint/Office-for-web** | `snapshot` | publish-to-web embeds rely on modern JS/CSS + service workers; render blank or broken on 83 |
| **Google Maps Embed API / traffic** | `snapshot` | WebGL2 + modern JS; unreliable on 83 → snapshot the map tile |
| **Facebook Page Plugin, Social Wall (aggregator), Pinterest/Bluesky/Tripadvisor widgets** | `snapshot` | third-party widget JS assumes evergreen Chromium; social walls especially |
| **Twitch** | `snapshot` on Taurus, `safe` elsewhere | needs `parent=` + modern player; degrade to a channel poster snapshot on 83 |
| **Secure Dashboards (Power BI/Tableau/Looker/Grafana)** | `snapshot` (always — it's `authed-headless`) | never expose the auth-gated live page to the device; server renders, streams image |
| **arbitrary Web Page / URL app (`proxied-iframe`)** | `snapshot` by default, `safe` only if preflight says the site is 83-clean | most modern sites break; the proxy already SSR-strips scripts on the non-interactive path — pair that with a snapshot fallback |

### 1b. The snapshot-to-Asset fallback (Phase-2 build, extends `renderer.service.ts`)

There is **no server screenshot service today** — `renderer.service.render()`
returns HTML, and the widget-level `freeze` flag only renders one client frame.
Build `SnapshotService`:

```ts
// apps/api/src/proxy/snapshot.service.ts (new)
@Injectable()
export class SnapshotService {
  // Reuses RendererService's browser pool + SSRF gate. Adds page.screenshot.
  async snapshot(url: string, opts: {
    tenantId: string; appId: string; zoneId: string;
    width: number; height: number;             // = the zone's canvas px
    fullPage?: boolean;
  }): Promise<{ assetUrl: string } | null> {
    await assertPublicUrl(url);                 // SAME gate as render()
    // 1. render via the shared Puppeteer pool (viewport = zone px)
    // 2. page.screenshot({ type:'webp', quality:80 })  (jpeg fallback for 83)
    // 3. re-host into Supabase under snapshots/{tenantId}/{appId}/{zoneId}.webp
    //    — durable + offline-cacheable on Taurus (same pattern as
    //    AiService.attachKeptBoardPhoto re-hosting)
    // 4. return the Supabase URL; store on the zone config as
    //    config.snapshotUrl + config.snapshotAt
  }
}
```

- **Cron cadence:** a background job re-snapshots every `snapshot`-tier app zone
  at that app's `refresh.defaultSec` (min 300s; see §4). Multi-tenant safe: the
  browser pool is shared but each snapshot is keyed by `{tenantId, appId, zoneId}`
  and re-hosted under the tenant's Supabase prefix.
- **Player behavior:** the widget renders `config.snapshotUrl` (an `<img>`/video,
  which the SW already caches on the never-evict tier) when
  `detectCapabilities().chromiumMajor < 88 && hardening.taurus === 'snapshot'`,
  OR when the live embed's `onError`/load-timeout fires (see §6). On modern
  screens it renders the live embed.
- **Never blank:** if the snapshot is missing (first run, cron not caught up) the
  widget shows the app's themed placeholder (brand gradient + app name), NEVER a
  broken-iframe icon or an error string.

### 1c. No-inset / no-gap for ANY new widget (QR is the only new render code)

The registry ships almost no new render code, but **QR** and any Phase-3 widgets
(webhook status, data-source table) are new. They MUST obey CLAUDE.md rule #10:

- No `inset:0` / Tailwind `inset-0` / `inset-x-*` / `inset-y-*` — use physical
  longhand `top-0 right-0 bottom-0 left-0` (or `style={{position:'absolute',
  top:0,right:0,bottom:0,left:0}}`).
- No `gap` on a flex container in player-shipped widget code — use per-child
  `margin`. (Grid `gap` is fine only on modern-gated paths.)
- No `backdrop-filter` without a solid-bg fallback; no `:has()` / container
  queries / `oklch` / `color-mix` on the player path without an `@supports`
  fallback (all of these are `false` on Taurus per `capabilities.ts`).
- QR generation must be **client-side SVG** (e.g. a tiny pure-JS QR lib emitting
  `<rect>` paths) — SVG rects render on Chromium 83; do NOT use `OffscreenCanvas`
  (false on 83) or an external QR-image API (network dependency + a tracking/ToS
  surface).

**CI gate (existing `taurus-safety`):** its grep (`inset:0|inset(-x|-y)?-[0-9]`)
already scans `apps/web/src/components/widgets`. Add the new QR/data-source/
webhook widget files to that scan path (CI-2, §7). Any hit = red.

---

## 2. Security — sandbox, SSRF, credentials, public exposure

### 2a. The iframe sandbox policy (the single most important table)

We render three iframe classes today with **different** trust levels. Pin each
app to the right one; do not widen a policy for convenience.

| Render path | Origin | `sandbox` | Trust model | Which apps |
|---|---|---|---|---|
| **EXTERNAL_HTML / AI-designer board** (`ExternalHtmlWidget`) | **null** (`sandbox="allow-scripts"`, NO `allow-same-origin`) | strict null-origin | HTML we authored; can't reach cookies/parent | our own board templates only |
| **Official provider `/embed`** (`official-iframe`) | provider origin | **none needed** — cross-origin isolation is inherent | provider's own sandboxing; we only pass their embed URL | YouTube, Vimeo, Twitch, Facebook Page, Pinterest/Bluesky/Tripadvisor, Slides/Canva/Sheets/Office publish-to-web |
| **Arbitrary URL via proxy** (`proxied-iframe`, `/api/v1/proxy/web?interactive=true`) | **OUR proxy origin (same-origin as the app!)** | **NONE** (deliberate — see below) | UNTRUSTED upstream JS running same-origin with our API host | the generic Web Page / URL app |

**The load-bearing risk (must be in the spec, must not regress):** the
`interactive=true` proxy path (`proxy.controller.ts` L353+) injects the upstream
page's own `<script>` tags and runs them **unsandboxed** in an iframe whose
document origin is our API host (`https://api-*.railway.app`). This is
intentional — a null-origin sandbox would CORS-break the upstream site's XHRs
back to its own API, and the operator wants a live working site. But it means:

- Untrusted third-party JS executes with our API's origin. It **cannot** read a
  logged-in operator's JWT (that lives on the *web* origin cookie / localStorage,
  not the API origin — cross-origin), which is why this is tolerable. **Do not
  ever move the proxy to the web origin or serve authed dashboard routes from the
  API origin** — that would hand session tokens to arbitrary sites.
- Mitigations already present and MUST stay: SSRF via `safeFetch`, per-IP
  throttle 60/min, 10 MB byte cap, `<meta refresh>` strip, error-page HTML-escape.
- **New requirement for the App Library:** the generic Web Page app defaults to
  `staticMode:true` (script-stripped, non-interactive) UNLESS the operator
  explicitly enables "Interactive." Interactive mode shows a one-line warning in
  the config form: *"Interactive mode runs this website's own code on your
  screen. Only use it for sites you trust."* This flips the default from the
  current always-interactive behavior for the *new* app-library entry point (the
  legacy WEBPAGE widget default is unchanged).

### 2b. SSRF surface — reuse the existing gate, never re-implement

Every server-side network touch an app makes (preflight HEAD, data fetch,
snapshot `page.goto`, webhook POST) MUST route through the existing gate. We
already had the **DNS-rebind TOCTOU** closed (`ssrfSafeLookup` connect-time pin)
and the **AI-emitted-URL SSRF** fix (task #58). Do not open a new hole.

| App server call | Use exactly | Notes |
|---|---|---|
| Web Page preflight (X-Frame/CSP HEAD check, §6) | `safeFetch(url, {maxBytes: 8192})` and read only response headers | HEAD may be blocked; fall back to a range GET reading just headers; NEVER `fetch()` |
| Web Page live proxy | already `safeFetch` in `proxy.controller.ts` | leave as-is |
| Generic Data-Source | already `safeFetch` in `data-source.service.ts` | leave as-is |
| Snapshot render | `assertPublicUrl` before `page.goto` + `validatePublicUrl` per sub-request | already in `renderer.service.ts` — the SnapshotService inherits it |
| Webhook-in delivery / any outbound POST | `safeFetchPost` (no redirects, body never reflected) | already in `webhook-dispatch.service.ts` |
| Reviews/Stocks/Weather/Currency third-party APIs | `safeFetch` | even "trusted" provider hosts go through it — a DNS-rebind on any host is the threat, not the brand |

**Rule:** grep-forbid raw `fetch(` / `axios` / `http.request` in any new
`apps/api/src/apps/**` or app service. CI-3 (§7) enforces it. The only network
egress functions permitted are `safeFetch`, `safeFetchPost`, `assertPublicUrl`
+ Puppeteer-behind-`assertPublicUrl`.

**Preflight-specific SSRF note:** the embeddability preflight is a *new*
operator-supplied-URL server fetch → it is a first-class SSRF surface. It must
go through `safeFetch` and must NOT leak internal-vs-invalid distinction in its
response (mirror `proxy.controller.ts`'s uniform "Upstream blocked" message).

### 2c. Credential storage for authed apps

Only Phase-2/3 apps store credentials (Reviews API keys, Secure Dashboards
login, aggregator token, Twitch if we ever go authed). Rules:

- **API keys / tokens** → encrypted at rest using the **same envelope encryption
  the BYOK AI keys already use** (per-tenant, in the DB, never in zone config
  JSON, never in `defaultConfig`, never logged). Reuse that service; do not add a
  second secret store. Zone config holds only a reference id, never the secret.
- **Secure Dashboards (`authed-headless`)** — the login credential is a stored
  secret used ONLY server-side by the headless renderer. The rendered output is
  an **image/snapshot**, never the live auth-gated DOM handed to the device
  (which would leak the session cookie to the LED). The headless session cookies
  live in the server browser context and are discarded per render.
- **OAuth apps** (Facebook Page if we go Business API, Google Reviews) — store
  refresh tokens encrypted; scope them per tenant; support revocation (an
  audit-logged "Disconnect" that deletes the token). Never put an OAuth token in
  a URL or a client-reachable response.
- **AuditLog** every credential create / rotate / revoke and every failed key
  test (same discipline as the AI providers — Standard Audit Surface §3).

### 2d. Public-exposure warning (publish-to-web apps)

Any app with `hardening.publicExposure === true` (Slides, Canva, Sheets embed,
Power BI publish-to-web, Office-for-web) shows a **blocking checkbox** in the
config form before save: *"This makes the content publicly viewable to anyone
with the link. Don't use it for confidential info."* The operator must
acknowledge once per app instance. This is a competitor gap we call out in
`00-SYNTHESIS.md` §4.6 — bake it in, don't leave it implicit.

---

## 3. Privacy / ToS — attribution, aggregator terms, no scraping

Legal obligations are render-time requirements, not nice-to-haves. Encode them in
`hardening.attribution` and enforce in the widget.

- **Google (Places/Reviews, Maps):** ToS requires the "Powered by Google" mark
  and reviewer attribution (author name + avatar + relative time). The brand-
  native Reviews render MUST include these; do NOT strip them to look cleaner.
  `attribution:'google'` → the Reviews/Maps widget renders the mandated marks.
- **Yelp Fusion:** requires the Yelp logo/link and "as seen on Yelp"-style
  attribution; may not cache review content beyond their TTL. `attribution:'yelp'`.
- **Tripadvisor:** their free widget must be used as-shipped (their iframe/JS),
  with their branding intact — do NOT re-render their content in our palette
  (that violates their terms). Ship it as `official-iframe` + `snapshot`, not
  brand-native.
- **Pexels (already in the app for AI boards):** free but requires attribution
  where feasible; reuse the existing pattern. `attribution:'pexels'`.
- **Aggregators (Walls.io / EmbedSocial / Taggbox / Curator) — the Social Wall:**
  use their **official embed** only; we hold ONE managed enterprise account
  (Tier-3 managed model). Do NOT scrape Instagram/TikTok/X/LinkedIn ourselves —
  their APIs are dead/paywalled (Instagram Basic Display shut Dec 2024, Meta
  oEmbed removed Apr 2025, X free API dead) and scraping violates their ToS and
  breaks constantly. The Social Wall app is `official-iframe` (aggregator embed)
  + `snapshot` for Taurus; there is no per-network scraper anywhere in our code.
- **No dead-embed tiles:** do NOT ship standalone Instagram/X/TikTok/LinkedIn
  apps that silently break — this is the exact anti-pattern
  (`00-SYNTHESIS.md` §7). The discovery service already marks `instagram` as
  `COMING_SOON`; keep it honest.
- **Data minimization:** the Generic Data-Source and proxy already **never log
  response bodies or full third-party URLs** (`data-source.service.ts` L111-114,
  proxy comments). Preserve that — a tenant's third-party feed contents must not
  land in our logs. Row counts / status codes only.

---

## 4. Cost / rate-limits — which apps cost money, and safe refresh defaults

The `refresh.{defaultSec,minSec}` block is the throttle. The config form clamps
the operator's chosen interval to `>= minSec`; the snapshot cron uses
`defaultSec`. Per-tenant server-fetch caps ride the existing
`DataSourceRateLimiter` pattern (120/hr/tenant, 4000/hr global) — extend it to a
generic per-app limiter (`AppFetchRateLimiter`) so no single app can exhaust the
budget.

| App | Cost tier | Provider cap (2026) | `minSec` | `defaultSec` | Notes |
|---|---|---|---|---|---|
| YouTube/Vimeo embed | free | none (client iframe) | — | live | no server fetch |
| Google Slides/Canva/Sheets/Office embed | free | none (publish-to-web) | 300 | 900 | snapshot cron only |
| Weather (NWS) | **free, keyless** | NWS courtesy limits | 600 | 900 | prefer NWS over paid OpenWeather |
| News/RSS (Google News RSS, public feeds) | free | polite-poll expectation | 300 | 900 | many feeds rate-limit aggressive polling |
| Currency (Frankfurter) | **free, keyless** | daily ECB data | 3600 | 21600 | rates update once/day — hourly+ is wasteful |
| Crypto (CoinGecko free) | free-tier-capped | ~10–30 calls/min public | 300 | 900 | shared across tenants → the per-app limiter matters |
| Stocks (Finnhub free) | free-tier-capped | 60 calls/min free | 300 | 900 | key-gated; count against tenant cap |
| Google Maps Embed / geocode | paid-key | ~$ per 1k after free tier; we hold `GOOGLE_MAPS_API_KEY` | 900 (snapshot) | 3600 | server-side only (key never in browser — same rule as `/geocode`) |
| Reviews (Google Places / Yelp Fusion) | paid-key / free-tier-capped | Places $ per call; Yelp 5000/day | 3600 | 21600 | reviews change slowly — poll rarely; cache to TTL |
| Social Wall (aggregator) | **managed-tier** | our enterprise plan quota | 600 | 1800 | VenueOS pays; watch our plan's refresh quota |
| Facebook Page Plugin | free | client iframe | — | live | no server fetch |
| Secure Dashboards | paid (compute) | our Puppeteer/Railway cost | 300 | 900 | each render is a full headless page — expensive; cache hard |
| Generic Data-Source | free (tenant's feed) | tenant cap 120/hr | 60 | 300 | already limited |
| QR / Clock / Countdown | free | none | — | client | no network |

**Rules:**
1. The config form **must not allow** a refresh below `minSec`. Enforce
   server-side too (a hand-edited zone JSON can't bypass it — the fetch/snapshot
   service clamps).
2. Any app with `cost:'paid-key'` or `'managed-tier'` shows a cost note in the
   picker ("Uses your Google API key" / "Included in your VenueOS plan").
3. Snapshot cron dedups by `{url}` across tenants where the URL is identical
   (public feeds) — reuse `renderer.service.ts`'s URL-keyed cache so a 150-screen
   fleet on the same Slides deck triggers ONE render.
4. Never let an app on the **AI Tier-1 platform key** budget (Concierge). App
   data fetches are free/BYO-key/managed — the platform Concierge key is
   setup-time only (CLAUDE.md economic model).

---

## 5. Multi-tenant isolation

App configs live on `TemplateZone.defaultConfig` (JSON) under a Template that has
`tenantId` (schema `packages/database/prisma/schema.prisma`). Isolation rules:

- **Config scoping:** zone config is reached only through the Template, which is
  tenant-scoped. Every read/write of an app config MUST go through a query that
  filters `where: { tenantId }` (the actor's tenant from the JWT) — never a bare
  `template.findUnique({ where:{ id } })` without a tenant check. This is the
  Standard Audit Surface §16 "cross-tenant scope verification on every actor-id
  check." Add a spec-level test that a tenant B cannot read/patch tenant A's app
  config zone.
- **Credential scoping:** encrypted app credentials are stored per tenant and
  are NEVER reachable cross-tenant. The credential-reference id in zone config is
  resolved server-side against the actor's tenant; a copied/hand-edited reference
  id pointing at another tenant's credential MUST fail the tenant check (don't
  trust the id in the config).
- **Snapshot bucket paths:** `snapshots/{tenantId}/{appId}/{zoneId}` — tenant id
  first, so a bucket-path traversal can't cross tenants. (Note: task #200 is
  moving floor-plans to a private bucket — snapshots that embed
  authed-dashboard content or any sensitive feed MUST use a **private** Supabase
  bucket with signed URLs, not the public asset bucket.)
- **Rate-limit keying:** the `AppFetchRateLimiter` keys per tenant (like
  `DataSourceRateLimiter`) so one noisy tenant can't consume another's budget;
  the global cap is the blast-radius wall.
- **Template export/import:** when a template with app zones is exported/imported
  across tenants (task #3), app configs travel but **credential references must
  NOT** — strip them on export; the importing tenant re-connects. A copied API
  key reference would otherwise leak or dangle.
- **Rendered-content leakage:** a snapshot of tenant A's private dashboard must
  never be served to tenant B's screen. Manifest/asset URLs for `snapshot`-tier
  apps that carry sensitive content use signed, short-TTL URLs scoped to the
  paired device's tenant.

---

## 6. Failure modes — never a blank/error screen on signage

Signage is unattended. A 404 / CSP-block / rate-limit / timeout must degrade to
*something on brand*, never a broken-iframe icon, a CORS error, or a stack trace.
This is a hard product rule (the operator has repeatedly rejected "error wearing
a costume").

### 6a. The degrade ladder (every app implements top-to-bottom)

1. **Live embed / live data** — the happy path.
2. **Last good snapshot** — `config.snapshotUrl` (from §1b). For `snapshot`-tier
   apps this is the *primary* path on Taurus and the *fallback* everywhere.
3. **Last good cached data** — for `server-data` apps (TICKER/LIVE_DATA), keep
   the previous successful payload and render it with a subtle "as of {time}"
   note rather than going blank on one failed poll. (Stale-while-revalidate.)
4. **App placeholder** — themed brand gradient + app name/icon (the AI-board
   gradient-fallback pattern). Shown only if there has never been a good render.
5. **NEVER** the raw provider error, a broken-image glyph, or a blank zone.

### 6b. Per-failure handling

- **URL 404 / 5xx (preflight or live):** the embeddability preflight (§2b) runs
  at **config time** and warns "this site can't be embedded / can't be reached"
  BEFORE the operator saves — so most dead URLs never reach a screen. At runtime,
  a proxied fetch failure falls to snapshot → placeholder. The proxy already
  serves a styled dark error page (`proxy.controller.ts` L639) — for the app
  library, intercept that and render the placeholder instead so signage never
  shows "Website Connection Failed."
- **X-Frame-Options / CSP blocks embedding:** preflight HEAD checks
  `X-Frame-Options` and `Content-Security-Policy: frame-ancestors` at config time.
  If the site forbids framing AND the proxy can't strip it (some sites enforce
  via both header and JS frame-busting), mark the app `snapshot`-only and tell
  the operator "This site blocks embedding — we'll show a periodic snapshot
  instead." Never let a frame-buster navigate the kiosk away (the proxy already
  forces `target="_self"` and strips `<meta refresh>`; keep that).
- **Rate-limit hit (429 from provider):** the `AppFetchRateLimiter` returns a
  typed error; the widget keeps the last good data (ladder step 3), backs off
  (exponential, capped at `minSec`), and logs — it does NOT surface the 429 or
  blank the zone.
- **Aggregator/social wall down:** snapshot fallback; if no snapshot, placeholder
  "Latest posts loading…" — never an aggregator error frame.
- **Snapshot render failure:** `SnapshotService` returns null (like
  `renderer.service.render()` does today) → keep the previous snapshot; if none,
  placeholder. A failed snapshot never overwrites a good one.
- **Provider embed JS throws on Taurus:** the widget arms a load-timeout
  (~8–10s) + `onerror`; on trip it swaps to snapshot/placeholder. Because the
  iframe is cross-origin we can't read its errors — rely on load-timeout + the
  `hardening.taurus` precomputed verdict (don't even attempt the live embed when
  `taurus==='snapshot' && chromiumMajor < 88`).
- **Emergency override always wins:** none of this app machinery may block or
  delay an emergency override. The emergency overlay + manifest fallback are
  independent of app zones (Standard Audit Surface §1) — app fetch/snapshot
  timers must be cancelable and must never hold the render thread when an
  OVERRIDE arrives.

### 6c. Health surfacing

Each app zone reports a health chip in the editor (green live / amber snapshot /
red placeholder-only) so the operator sees degradation without staring at a wall
— reuse the per-surface health-pill pattern from the sports console (task T1-6).

---

## 7. The 3–4 biggest risks that could sink the feature + how to de-risk early

### RISK 1 — "Silent-break tiles" destroy trust (the feature's reputation risk)
An app that renders blank/broken on a customer's Taurus wall (or when a
provider's embed dies) is worse than not shipping it — it's the exact "costume"
the operator has banned, at signage scale where nobody's watching.
**De-risk first, before building breadth:**
- Build the **snapshot-to-Asset fallback (§1b) and the degrade ladder (§6a) in
  Phase 1**, not Phase 2 — they are the safety net every app depends on. Do not
  ship the picker breadth before the net exists.
- Add a **Taurus render gate to CI**: a Playwright/Chromium-83-emulated smoke
  that loads each `taurus:'safe'` app's widget and asserts non-blank; any app
  that can't pass is reclassified `snapshot`. (Extend the existing
  cross-browser/taurus-safety harness.)
- **Honesty in the picker:** the friction/compat badges (Instant / Needs login /
  Powered-by-social-wall, + LED-compatible / snapshot-on-LED) are a Phase-1
  requirement, not polish.

### RISK 2 — SSRF / same-origin proxy XSS blows a hole in the platform
The `proxied-iframe` interactive path runs untrusted JS same-origin with our API,
and every new server fetch (preflight, snapshot, data, webhook) is an SSRF
surface. One raw `fetch()` or one origin mistake and we're an SSRF gateway into
Railway's metadata endpoint or leaking session tokens.
**De-risk:**
- **CI-3 grep-forbid** raw `fetch(`/`axios`/`http.request`/`https.request` in
  `apps/api/src/apps/**` and every app service — force `safeFetch`/`safeFetchPost`/
  `assertPublicUrl`. Port the existing `data-source.ssrf.spec.ts` /
  `webhook-dispatch.ssrf.spec.ts` pattern to a shared `apps.ssrf.spec.ts`
  covering preflight + snapshot + every server-data app.
- **Freeze the origin rule in a comment + a test:** the proxy/API origin must
  never serve authed dashboard routes and the web origin must never proxy
  arbitrary sites. Add a doc-comment + an architectural note so a future agent
  can't "simplify" them together.
- Keep the interactive Web Page app **opt-in with a trust warning** (§2a);
  default to script-stripped static mode for the new app entry point.

### RISK 3 — Dead/paywalled social + provider ToS changes rot the library
Instagram/X/TikTok/LinkedIn native embeds are already dead; Google/Yelp/
aggregator terms and embed APIs change on their schedule, not ours. A library
full of provider-dependent tiles is a maintenance treadmill that silently breaks.
**De-risk:**
- **One aggregator, one managed account** for all of social (§3), not five
  per-network scrapers. Zero scraping anywhere — it's a ToS + fragility trap.
- **Attribution encoded in `hardening.attribution`** and rendered by the widget
  so a ToS audit is a data check, not a code hunt.
- A **quarterly "embed liveness" check** (extend the app-registry lint): a cron
  hits each provider's canonical embed and flags any that now 404/CSP-block, so
  we reclassify to `snapshot`/`COMING_SOON` before a customer finds it dead.
  Every provider tile carries a `lastVerified` date.

### RISK 4 — Cost / rate-limit blowout on paid + managed tiers
A fleet of 150 screens each polling a paid Maps/Reviews/aggregator endpoint every
30s quietly runs up a bill or trips a provider cap that dark-screens every tenant.
**De-risk:**
- **`refresh.minSec` clamp enforced server-side** (config form AND fetch/snapshot
  service) + the per-app/per-tenant + global `AppFetchRateLimiter` (extend
  `DataSourceRateLimiter`) shipped WITH the first paid-tier app.
- **Cross-tenant snapshot dedup** by URL (reuse `renderer.service.ts` cache) so
  identical public content renders once for the whole fleet.
- **Never spend the AI Tier-1 platform key** on app data (economic model);
  paid apps are BYO-key or managed-tier with a visible cost note.

---

## 8. CI / acceptance gates (this feature is not "done" until these are green)

- **CI-1 registry-lint:** every `AppDefinition` has a well-formed `hardening`
  block; `AVAILABLE`-style invariants (e.g. `taurus:'blocked'` ⇒ hidden on LED
  groups; `publicExposure` ⇒ config form has the ack checkbox;
  `cost:'paid-key'` ⇒ picker cost note) verified structurally.
- **CI-2 taurus-safety:** extend the existing grep
  (`inset:0|inset(-x|-y)?-[0-9]`, `gap` on flex, `backdrop-filter` unguarded) to
  the new QR/data-source/webhook widget files. Plus the Chromium-83-emulated
  non-blank smoke for every `taurus:'safe'` app.
- **CI-3 ssrf-lint + specs:** grep-forbid raw network calls in app code;
  `apps.ssrf.spec.ts` covers preflight, snapshot, and every server-data app with
  the private-IP / DNS-rebind / redirect-to-internal cases (ported from the
  existing data-source/webhook SSRF specs).
- **CI-4 multi-tenant test:** tenant B cannot read/patch tenant A's app config
  zone or resolve tenant A's credential reference; export strips credentials.
- **CI-5 degrade test:** for a representative `snapshot` and `server-data` app,
  simulate 404 / 429 / CSP-block and assert the widget renders snapshot →
  cached → placeholder, never blank/error (Playwright).
- **Acceptance (UX 30-second gate, CLAUDE.md §20):** an operator adds an app,
  the config form pre-flights the URL and warns on un-embeddable/public-exposure,
  clamps refresh, and lands a working (or snapshot-backed) zone — with a
  screenshot/Playwright run proving it — before the app is marked shippable.

---

## 9. Summary checklist (per app)

Before an app merges, its `hardening` block is filled AND:

- [ ] `taurus` verdict correct; `snapshot`/`blocked` apps have the fallback wired
- [ ] no `inset-*` / unguarded `gap`/`backdrop-filter` in any new widget code
- [ ] every server fetch goes through `safeFetch`/`safeFetchPost`/`assertPublicUrl`
- [ ] correct sandbox class (null-origin / official-iframe / proxied w/ warning)
- [ ] credentials encrypted per tenant, never in zone config, never logged, revocable, audit-logged
- [ ] `publicExposure` apps have the acknowledgement checkbox
- [ ] `attribution` rendered where the provider's ToS requires it; no scraping
- [ ] `refresh.minSec` clamped server-side; per-tenant + global rate cap wired for paid/managed
- [ ] multi-tenant scope test passes; export strips credential refs
- [ ] degrade ladder verified (404/429/CSP → snapshot → cached → placeholder, never blank)
- [ ] emergency override is never blocked or delayed by app timers
- [ ] all CI-1..CI-5 gates green
