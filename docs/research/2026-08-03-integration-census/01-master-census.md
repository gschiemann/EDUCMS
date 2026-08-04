# VenueOS Integration Census — HEAD (b9122ea0), 2026-08-03

> Master-enumerator census agent report, persisted verbatim 2026-08-03 evening. Read-only pass.

## 0. Catalog inventory (exact counts, each verified two ways)

| Catalog | Count | Verification |
|---|---|---|
| App Library `APP_REGISTRY` | **19** entries (4 `comingSoon`) | grep counts ×2 — `apps/web/src/components/apps/app-registry.ts:270-853` |
| Concierge `RULES` | **26** (not ~34) | grep counts ×2 — `apps/api/src/integrations/discovery.service.ts:210-560` |
| `POS_PROVIDERS` | **9** | `packages/api-types/src/pos.ts:92-270` |
| `STREAMING_PROVIDERS` | **12** | `packages/api-types/src/streaming.ts:138-391` |
| `AD_NETWORKS` | **8** | `packages/api-types/src/ad-network.ts:106-262` |
| Integration-health rows | ~45 | `apps/api/src/health/integrations-health.controller.ts:144`, rendered at `settings/test-integrations/page.tsx:172` |

There is no separate api-side "app catalog"; `/demo/app-library` and `/onboarding/apps` both mount the same `APP_REGISTRY` + `concierge-map.ts`.

---

## 1. COSTUME findings (ranked first)

### C-1 — `SOCIAL_FEED` widget: full config UI, zero backend. **CONFIRMED COSTUME.**
- Offered in the widget palette as a first-class type: "Social Media — Posts from social accounts" — `template-builder/constants.ts:166` and `templates/page.tsx:264`.
- Real editable fields: "Profile / feed URL" + "Max posts to show" — `PropertiesPanel.tsx:4151-4153`; a second `embedUrl` input at `templates/page.tsx:4821`.
- The renderer is a static gradient card that **never fetches anything**, and prints the word **"Connected"** whenever `embedUrl` is truthy — `WidgetRenderer.tsx:4308-4316` (line 4313).
- Absence proven twice: (a) full function body read, no fetch/hook; (b) `grep -rn "useLiveSocial|socialFeed|fetchSocial" apps/web/src` → zero; `grep -rn "instagram|facebook|walls.io|embedsocial" apps/api/src` → only an unrelated icon-name regex (`branding-scraper.service.ts:736`).
- The App Library authors *did* get this right — all four social tiles are `comingSoon` (`app-registry.ts:818,829,840,851`). The costume is the raw widget type, which the truth-gate does not cover.

### C-2 — Ad-network creative pipeline: documented file tree does not exist. **PARTIAL bordering COSTUME.**
- `ads.service.ts:7-9` claims "Per-network creative-fetch handlers live in `apps/api/src/ads/networks/<id>.ts`".
- Absence proven twice: `find apps/api/src/ads -type d` → only the root; grep → the comment plus a route string only.
- Kept out of full-costume by: connections save `status:'PENDING'` (`ads.service.ts:112`), CLOSED tiers rejected (`:89`), `salesLedOnly` rejected (`:101`), health reports COMING_SOON (`integrations-health.controller.ts:928,938,948`).

---

## 2. Master table

Env gate legend: **P** = platform-level, **T** = tenant BYOK/OAuth. "SET"/"ABSENT" per live prod config (key names only).

| Integration | Category | Status | Env gate | BYOK/platform | Evidence |
|---|---|---|---|---|---|
| PostgreSQL | infra | REAL | `DATABASE_URL` | P | `integrations-health.controller.ts:220` |
| Redis pub/sub | infra | REAL | `REDIS_URL` (SET) | P | `:260` |
| Supabase Storage | infra | REAL | `SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY` (SET) | P | `supabase-storage.service.ts:64,77` |
| Cloudflare Worker asset CDN | infra | REAL | `NEXT_PUBLIC_ASSET_CDN` | P | `apps/edge/src/index.ts:26,156` |
| Sentry | observability | REAL | `SENTRY_DSN` (SET) | P | `apps/api/src/sentry.ts:37,42` |
| GrowthBook | observability | PARTIAL | `GROWTHBOOK_API_HOST`+`GROWTHBOOK_CLIENT_KEY` (ABSENT) | P | `feature-flags.service.ts:40-45`; health `:290,308` |
| Resend (email) | comms | REAL | `RESEND_API_KEY`+`EMAIL_FROM` (SET) | P | `email.service.ts:426,450,468` + 2 alerting services |
| Stripe billing | payments | REAL (test mode) | `STRIPE_*` (SET) | P | `stripe.service.ts:113,121,130,222,327` |
| GitHub Releases (player OTA) | ops | REAL | `GH_TOKEN` (SET), `PLAYER_APK_GITHUB_REPO` | P | `player-ota.controller.ts:1193,1211,1223,1293,1442` |
| GitHub Issues (bug reports) | ops | REAL | `GITHUB_REPO`+`GH_TOKEN` (SET) | P | `bugs.controller.ts:599,1109,1180` |
| Google Geocoding | geo | REAL | `GOOGLE_MAPS_API_KEY` (SET) | P | `geocoding.service.ts:62,113,168` |
| Nominatim / OSM | geo | REAL (keyless fallback) | none | P | `geocoding.service.ts:140,274` + 3 client sites |
| CARTO basemap tiles | geo | REAL | none | P | `ScreenMap.tsx:203` |
| Google Fonts | assets | REAL | none | P | `google-fonts.ts:68`; `designer-prompt.ts:102` |
| Anthropic API | AI | REAL, BYOK-only in prod | `ANTHROPIC_API_KEY` (ABSENT) | T (P fallback unset) | `ai-providers.ts:496`; `ai.service.ts:592`; `bug-analyzer.service.ts:665`; `ai-alt-text.service.ts:909,1133` |
| OpenAI API | AI | REAL, BYOK-only | `OPENAI_API_KEY` (ABSENT) | T | `ai-providers.ts:567`; `ai.service.ts:4250` |
| Google Gemini | AI | REAL, BYOK-only by design | tenant key only | T | `ai-providers.ts:592`; capability VERIFIED `capability-registry.ts:370-373` |
| Pexels stock photos | assets | PARTIAL (dark in prod) | `PEXELS_API_KEY` (ABSENT) | P | `stock-image.service.ts:66,78,128-129`; UI `StockPhotoSearch.tsx:190` |
| Clever SIS | sis | REAL, unconfigured in prod | `CLEVER_*` (ABSENT) | P app + T OAuth | `clever.service.ts:74,87-90`; capability CONFIGURED `capability-registry.ts:295-298` |
| OIDC SSO (Google/MS/Okta) | identity | REAL | none (tenant-supplied) | T | `sso.service.ts:275-288`; capability VERIFIED |
| SAML SSO | identity | COMING_SOON (fails closed) | — | T | `capability-registry.ts:355-366` NOT_BUILT; CVE-2025-54419 arm-gate |
| Square POS | pos | REAL | `SQUARE_*` | P + T | `registry.ts:64-73`; DIRECT `pos.ts:95-98` |
| Clover POS | pos | REAL | `CLOVER_*` | P + T | `registry.ts:75-84` |
| Lightspeed Retail | pos | REAL | `LIGHTSPEED_*` | P + T | `registry.ts:85-94` |
| Shopify POS | pos | REAL | `SHOPIFY_CLIENT_ID` | P + T | `registry.ts:95-104` |
| Custom Webhook (POS inbound) | pos | REAL | none | T | `pos.ts:260-263` |
| Toast / Aloha / Stripe Catalog / MINDBODY | pos | COMING_SOON | — | — | honestly gated, tiles + refusals |
| YouTube / Twitch / Vimeo embeds | streaming | REAL | none | T | `app-registry.ts:270-379`; DIRECT tiers |
| Vimeo Live | streaming | COMING_SOON | — | — | PARTNER `streaming.ts:298-307` |
| Custom HLS | streaming | REAL (hls.js) | none | T | `streaming.ts:373-376`; `StreamingWidget.tsx:205-230` |
| IPTV M3U | streaming | listed REAL here — **see 02-streaming report: COSTUME (no parser)** | none | T | `streaming.ts:388-391` |
| Public Broadcasters / Mux test | streaming | REAL | none | P | `streaming.ts:246-249`; health `:378-398` |
| Atmosphere/DIRECTV/DISH/Mood/iHeart | streaming | PARTIAL (BRIDGE = HDMI, no API) | — | T | `streaming.ts:141-352`; health `:440-449` |
| Soundtrack Your Brand | music | COMING_SOON | — | — | PARTNER `streaming.ts:323-335` |
| SomaFM / NPR stations | music | REAL | none | P | `music.controller.ts:40,49` |
| Spotify for Business | music | **PARTIAL — authorize redirect built, NO callback route** | `SPOTIFY_BUSINESS_*` (ABSENT) | P | `music.controller.ts:64-87`; only 4 routes; no callback (2 methods); secret never read |
| Apple Music for Business | music | COMING_SOON | — | — | `music.controller.ts:90-100` |
| Hivestack / Vistar / Place Exchange / Broadsign | monetize | PARTIAL (see C-2) | — | T | `ad-network.ts:106-172`; `ads.service.ts:70-125` |
| Loop Media / Atmosphere(monetize) / Lamar | monetize | COMING_SOON (rejected) | — | — | `ads.service.ts:89-103` |
| House-only ads | monetize | REAL | none | T | `ad-network.ts:259-262` |
| RSS / Atom feeds | widget | REAL | none | P (SSRF-guarded proxy) | `feeds.controller.ts:52-57`; `rss-parser.ts` |
| iCalendar (ICS) | widget | REAL | none | P | `ics-parser.ts` |
| Open-Meteo weather | widget | REAL | none | P (keyless) | `WidgetRenderer.tsx:1092,1106`; `WeatherWidgets.tsx:44,50` |
| WEBPAGE proxy / headless renderer | widget | REAL | `ALLOWED_ORIGINS` | P | `proxy.controller.ts:49`; `renderer.service.ts:52` |
| Google Slides / PowerPoint / Canva-share / Sheets / Maps / Calendar embeds | app | REAL (Maps keyed leg = PARTIAL, TODO at `url-transforms.ts:129-131`) | none | T | `app-registry.ts:389-805` |
| QR / Clock / Countdown | app | REAL (local) | none | — | `app-registry.ts:601-662` |
| Facebook Page / Instagram / Social Wall / Google Reviews | app tiles | COMING_SOON | — | — | `app-registry.ts:812-853` |
| **SOCIAL_FEED widget** | widget | **COSTUME** | — | — | §1 C-1 |
| Design import — PDF / image | design | REAL | none | T | `imports.controller.ts:5-24`; health `:766-774` |
| Canva Connect OAuth / Slides Drive API / MS Graph / Figma | design | COMING_SOON | `CANVA_*` (ABSENT) | P | health `:763-810` |
| Twilio / Slack / Teams / Push | comms | COMING_SOON | (ABSENT) | P | health `:725-750` |
| Outbound tenant webhooks | developer | REAL | none | T | `webhook-dispatch.service.ts` + retry worker |
| Manual scoreboard | sports | REAL | — | T | health `:835-838` |
| CTS swim/dive timing | sports | REAL (hardware ingest) | `SPORTS_FEED_SECRET` | P | `swim-timing-feed.ts:1-23` |
| Daktronics / Sportzcast / Scorebird / Genius / Sportradar / MaxPreps / GameChanger | sports | COMING_SOON (Daktronics mis-badged — see 02 report) | — | — | health `:848-884` |
| OpenTable / Resy / NFHS / GCal connector / Eventbrite / Mailchimp / Constant Contact / Instagram-rule / Tithe.ly / Pushpay / GivingTrac | concierge | COMING_SOON | — | — | `discovery.service.ts:277-560` |

---

## 3. Counts by status

| Status | Count | Notes |
|---|---|---|
| **REAL** | **49** | Includes 3 code-complete but env-dark in prod: Clever + platform legs of Anthropic/OpenAI (BYOK live). |
| **PARTIAL** | **10** | GrowthBook, Pexels, Spotify, Maps-keyed, Hivestack, Vistar, Place Exchange, Broadsign, BRIDGE-streaming (5-as-one), ads-creative-pipeline. |
| **COSTUME** | **1** | `SOCIAL_FEED` widget (C-1). (Census counts iptv-m3u REAL; the streaming deep-pass re-classifies it COSTUME — no parser. Synthesis carries the stricter verdict → **2**.) |
| **COMING_SOON** | **38** | All carry `connectHref: null` / `publicClaim: null` / explicit reason. |

Truth-gate machinery is real and working: `capability-registry.ts` (23 capabilities) + CI consumer + workflow. `buildCandidate` structurally cannot emit AVAILABLE without a routable `connectHref`. The one gap: the raw widget-type palette — exactly where C-1 lives.

---

## 4. UNVERIFIED

1. Whether `SOCIAL_FEED` zones exist in any shipped template/preset (if none, C-1 is reachable only by manual widget add).
2. Runtime reachability of `POST /api/v1/integrations/discover` guard chain.
3. Clever OAuth against live Clever (`clever-http.client.ts:8` self-documents as unexercised).
4. Exact integrations-health row total (~45; dynamic emitters).
5. `GITHUB_TOKEN` vs `GH_TOKEN` precedence in prod (only GH_TOKEN stated SET).
6. Player (Android) Kotlin-side integrations not read.
7. `PLATFORM_ALERT_EMAILS` consumers (10 refs) not individually enumerated — confirmed ABSENT in prod, alerting routing dark.
