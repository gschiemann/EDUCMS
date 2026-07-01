# VenueOS Apps Library — Synthesis & Build Plan (2026-06-30)

Lead-authored synthesis from the 5-agent research fan-out (raw findings in `raw/`).
The workflow's own synthesis step kept dropping on API/session limits; this is the
senior-dev synthesis of the captured research (competitors 56 apps, social-feasibility
16, data/utility 30, map-to-VenueOS 20, OptiSigns catalog summary).

## 1. Executive summary

OptiSigns' ~140-app library (and Yodeck ~130 / ScreenCloud ~80) is **the same ~80-app
spine wrapped in a nice picker**: each "app" is a thin wrapper over one of five
primitives — an **iframe** (publish-to-web URL), an **RSS/feed parse**, an **API poll
→ render**, a **headless-browser screenshot** (for auth-gated dashboards), or a
**file/HTML package**. VenueOS already owns a widget for nearly every primitive
(`WEBPAGE`, `RSS_FEED`, `STREAMING`, `LIVE_DATA`, `CALENDAR`, `WEATHER`, `CHART`,
`IMAGE_CAROUSEL`, `MUSIC_PLAYER`, `EXTERNAL_HTML`). **So a curated "Apps" library is
mostly packaging + per-app config forms on top of what we have — not 20 new integrations.**

**The honest 2026 reality (the crux):** the "paste a social URL, get a live wall" era
is over for the big networks. Instagram Basic Display API shut down **Dec 4 2024**; Meta
removed legacy oEmbed **April 2025**; X free API is dead (cheapest ~$100/mo, timelines
only render to logged-in users); TikTok/LinkedIn have no public feed API. **Only
Facebook Page Plugin, Pinterest, Bluesky, and Tripadvisor still have free official
embeds.** Everything else social = a **paid aggregator** (Walls.io / EmbedSocial /
Taggbox / Curator) or a reviewed **Business API + OAuth**. Pure video (YouTube, Vimeo,
Twitch) stays clean official iframes. **We win by being honest about this in the picker
where competitors bury it — and by solving social with ONE aggregator/managed tier
instead of five broken per-network "apps."**

## 2. The ranked Top 20 (what to add first)

Ranked by operator demand × 2026 feasibility × leverage of our existing widgets.
Effort: **S**=reuse a widget + config form · **M**=config + light backend/API key ·
**L**=OAuth/aggregator/headless plumbing.

| # | App | Category | 2026 method | Effort | Risk | Rides our widget |
|---|-----|----------|-------------|--------|------|------------------|
| 1 | **YouTube** (video/channel/playlist/live) | Video | Official `/embed` iframe — free, Chromium-83 safe | S | low | STREAMING |
| 2 | **Google Slides** | Docs | Publish-to-web `/embed` iframe (auto-advance) — the #1 signage app | S | low | WEBPAGE |
| 3 | **Calendar** (Google / Outlook / iCal) | Calendar | ONE ICS engine → 3 branded apps; public iframe or .ics parse | S–M | low | CALENDAR |
| 4 | **Weather** (current/hourly/daily/alerts) | Weather | Already shipped; enrich w/ free NWS + radar | S | low | WEATHER |
| 5 | **News / RSS** (named channels + topic feeds) | News | Curated public RSS behind friendly names + logos; brand-native render | S | low | RSS_FEED |
| 6 | **Web Page / URL** (+ embeddability pre-flight) | Web | Sandboxed iframe (we have it) + X-Frame/CSP HEAD check first | S | low | WEBPAGE |
| 7 | **QR Code** | Utility | Client-side SVG QR — no service, offline-safe | S | low | *new (tiny)* |
| 8 | **Clock / Countdown / Date** (variants) | Utility | Pure client render; we have CLOCK/COUNTDOWN | S | low | CLOCK/COUNTDOWN |
| 9 | **Canva** | Docs | Public design `?embed` iframe (auto-updates) | S–M | low | WEBPAGE |
| 10 | **PowerPoint / OneDrive** | Docs | Office-for-web `/embed` iframe or .pptx upload | S | low | WEBPAGE |
| 11 | **Google Maps / Traffic** | Utility | Maps Embed API (we have the key) — free iframe, traffic layer | S | low | WEBPAGE |
| 12 | **Vimeo** | Video | Official player iframe — free | S | low | STREAMING |
| 13 | **Cloud-folder slideshow** (Drive/Dropbox/OneDrive) | Media | Point at a folder → auto-carousel ("drop a photo, it's on screen") | M | low | IMAGE_CAROUSEL |
| 14 | **Google Sheets** (embed + as data source) | Data | Publish-to-web iframe OR read as a live data source | S–M | low | WEBPAGE / LIVE_DATA |
| 15 | **Facebook Page** | Social | Page Plugin iframe — the ONE still-free official social embed | S | med | SOCIAL_FEED |
| 16 | **Official-embed social/reviews** (Pinterest · Bluesky · Tripadvisor) | Social/Reviews | Each has a free keyless official widget | S | low | WEBPAGE |
| 17 | **Stocks / Crypto / Currency ticker** | Data | Free APIs (Finnhub/CoinGecko/Frankfurter) → brand-native ticker | S–M | low | LIVE_DATA/TICKER |
| 18 | **Twitch** | Video | Official iframe (needs `parent=` domain param — sandbox gotcha) | M | low | STREAMING |
| 19 | **Social Wall** (IG+FB+X+TikTok, aggregator-backed) | Social | ONE aggregator (Walls.io/EmbedSocial) → the honest solve for all dead native embeds; the marquee "social" answer | M–L | med | SOCIAL_FEED/WEBPAGE |
| 20 | **Reviews Wall** (Google · Yelp) | Reviews | Places/Fusion API (key) or aggregator; star-rating filters | M | med | SOCIAL_FEED |

> Instagram / X / TikTok / LinkedIn are intentionally **not** standalone tiles — they're
> covered honestly by **#19 Social Wall** (aggregator) because their standalone embeds
> are dead/paywalled in 2026. Shipping them as fake "apps" that silently break is exactly
> what we should NOT copy from competitors.

## 3. Beyond the Top 20 — the leapfrog moats (Phase 3)

These are where we **beat** OptiSigns, not match it:

- **Secure Dashboards** (Power BI / Tableau / Looker / Grafana) — ScreenCloud's standout:
  ONE headless-browser "authenticated render" engine that logs in server-side and
  streams/screenshots the auth-gated page. High-value, corporate, hard for rivals.
- **Generic Data-Source app** (Xibo "DataSet" parity) — connect CSV / Google Sheet / JSON
  API once, then ANY template binds to it (menu, table, ticker, directory). Decouples
  "connect data" from "design."
- **Webhook-in app** — external systems POST content to a screen (POS order status, our
  own sports engine, CI result, alarm). We already have the webhook retry queue.
- **Emergency / Safety app category** — CAP/NWS inbound + named K-12 vendors (Raptor,
  RapidSOS, InformaCast, Alertus, CrisisGo). **No signage-only rival leads with this —
  it's our moat.** Auto-flip screens on a county CAP alert.
- Spotify / Apple Music now-playing, Sports scores, Transit/Flights, Slack/Teams comms,
  Room booking, Building directory, Birthdays/recognition, Digital menu (have it), PDF.

## 4. How we design it BETTER than OptiSigns

1. **Honesty-first, friction-tiered picker.** Tag every app **"Instant · no login"**,
   **"Needs a business login"**, or **"Powered by our social wall"** — and sort by
   friction, not A–Z. Competitors bury setup requirements until after you pick.
2. **AI-Concierge is the picker's brain.** Operator pastes their website / says "coffee
   shop in Austin" → we auto-detect their social handles (og:tags, footer links), suggest
   the right app stack, and pre-fill each config. Nobody else has this.
3. **Finished-board templates per app, not bare widgets.** Every app tile ships 2–3
   designer-grade layouts (via our AI Designer) with the app's data already placed —
   matching Rise Vision (600+) / Yodeck (800+) but generated, brand-aware, on-brand.
4. **Live preview + per-app scheduling** (first-class playlist items, day/time/date-range).
5. **Offline/Taurus resilience** — "snapshot-to-Asset": periodically render each
   publish-to-web app to an image/video into our Supabase bucket so a Chromium-83 LED
   kiosk shows the latest frame even if the live embed can't run. Plus a **per-app
   Taurus/LED compatibility badge** (copy Yodeck's hardware matrix).
6. **Guardrails competitors lack** — embeddability pre-flight (X-Frame-Options/CSP HEAD
   check) warns "this site can't be embedded" *before* adding it; a public-exposure
   warning on "publish to web" apps (Power BI/Slides) that the content becomes internet-public.
7. **Managed social tier** — hold ONE enterprise aggregator account (our Tier-3 managed
   model); the operator never wires a token, social "just works."
8. **Free-by-default providers** — NWS weather, Frankfurter currency, CoinGecko crypto,
   Google News RSS — zero-config, zero-key where possible.
9. **Brand-native render** — for stocks/crypto/news/sports, fetch server-side and render
   into OUR palette (TICKER/LIVE_DATA), not an ugly third-party iframe.

## 5. Architecture (smallest-clean)

An **App Registry**: each app = `{ id, name, icon, category, frictionTier, configSchema,
build(config) → a standard zone config }`. ~90% of apps `build()` a `WEBPAGE` /
`EXTERNAL_HTML` / `RSS_FEED` / `LIVE_DATA` / `CALENDAR` / `STREAMING` config we already
render — so the player/renderer needs almost no new code. The editor gets an **"Apps"**
entry (card grid + category filter + search) that, on pick, opens the per-app config form
(with live preview) and writes the zone. New render code needed only for: QR, and the
Phase-3 services (headless-render, data-source, webhook-in, CAP). Concierge tie-in +
snapshot-to-asset are additive backend services.

## 6. Build plan (phased; Sonnet-5 does the boilerplate, lead reviews/upgrades)

- **Phase 1 — App Library shell + "Instant" apps.** The card-grid picker + per-app config
  + live preview + the App Registry, then the S-effort apps that ride existing widgets:
  YouTube, Slides, Calendar/ICS, Weather, News/RSS, Web URL, QR, Clock/Countdown, Maps,
  Vimeo, PowerPoint, Canva, Sheets, Pinterest/Bluesky/Tripadvisor, cloud-folder slideshow,
  stocks/crypto/currency. **~most of the top-20 with almost no backend.**
- **Phase 2 — Social done right + reviews + resilience.** Facebook Page, Social Wall
  (aggregator), Google/Yelp reviews, Twitch; + Concierge auto-config, snapshot-to-Asset,
  Taurus/LED badge, embeddability pre-flight.
- **Phase 3 — Leapfrog moats.** Secure Dashboards (headless auth render), Generic
  Data-Source app, Webhook-in, Emergency/CAP + safety vendors, Spotify/Apple Music,
  Slack/Teams, sports/transit.

**Execution model:** delegate the mechanical builds (per-app config forms, registry
entries, widget config mappers) to Sonnet-5 agents in isolated worktrees; lead (Opus)
owns the architecture, reviews every diff, and upgrades for the end product (offline
resilience, Taurus safety, brand-native render, Concierge tie-in) before merge.

## 7. Risks / caveats
- Social native embeds are dead/paywalled (IG/X/TikTok/LinkedIn) → aggregator or Business
  API only; never ship them as silent-break tiles.
- "Publish to web" apps expose content publicly — warn the operator.
- Chromium-83 LED controllers: some live embeds/modern APIs won't run → snapshot-to-Asset
  fallback + compatibility badge.
- Aggregator/API tiers cost money → decide managed-tier vs BYO-key per app.
- Attribution is a ToS requirement on reviews (Google/Yelp/Tripadvisor) — bake it in.
