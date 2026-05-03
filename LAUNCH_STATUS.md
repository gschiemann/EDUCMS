# VenueOS — Launch Status (2026-05-03)

Honest accounting of what's wired up vs. what needs vendor-side setup before
it can do real work in production. Use this as the pre-launch checklist.

## 🎯 Integration tier reality check (2026-05-03)

After audit, every provider in our streaming + POS + ad-network catalogs
is now classified into one of three tiers. The UI surfaces these as
badges so operators see at a glance what they're looking at:

- **DIRECT (green Self-serve badge)** — Real public API or open embed.
  Operator can self-serve today.
  - Streaming: YouTube, Twitch, Vimeo, Public Broadcasters, Custom HLS,
    IPTV M3U, Soundtrack Your Brand
  - POS: Square, Clover, Lightspeed Retail, Shopify POS, Stripe Catalog,
    Custom Webhook
  - Ads: House-only

- **PARTNER (amber Partnership badge)** — Real public API exists, but
  vendor requires a publisher contract / application before activating.
  We let the operator save in PENDING; staff or the OAuth callback
  flips ACTIVE once the partnership lands.
  - Streaming: (none currently)
  - POS: Toast, MINDBODY (ABC Fitness)
  - Ads: Hivestack, Vistar Media, Place Exchange, Broadsign Reach,
    Loop Media

- **CLOSED (grey Info-only badge)** — No public API for third-party CMS
  integration. Listed so customers know we know about them; tile
  links to the vendor's site instead of opening a Connect modal.
  - Streaming: Atmosphere TV, DIRECTV for Business, DISH Business,
    Mood Media, iHeart for Business
  - POS: Aloha (NCR)
  - Ads: Atmosphere TV (monetize), Lamar Advertising

The server enforces these tiers — POST /streaming/connections,
/pos/connections, /ads/connections all 403 on CLOSED-tier providers
even if the operator hits the API directly.

## ✅ What's live and working

### Multi-vertical platform
- K12 / GYM / RETAIL / CORPORATE / QSR / FASHION / **BAR** verticals all routed
- Vertical-aware UI copy via `useTenantCopy()` (org noun, role labels, template categories, default brand)
- Tenant.vertical column drives template visibility per tenant
- Templates page hides K12 grade-level chips for non-K12 tenants

### Templates
- 60+ K12 system presets (animated, themed, MS pack 8 + portrait, holiday lobby, etc.)
- 7 fitness/GYM presets (cardio-hub, music-player, ad-banner, class-schedule, training-video, workout-timer, motivational-quote) + 6 fitness widgets
- 8 RESTAURANT/QSR presets (Drive-Thru Menu, Counter-Order, Coffee Shop, Pizza, Sushi, Daily Specials, Loyalty, Wait Time) + 6 widgets (MenuBoard, ComboCarousel, WaitTime, LoyaltyTicker, SpecialsCallout, AllergyLegend)
- 8 RETAIL presets (Storefront Welcome, Sale/BOGO, Lookbook, Wayfinding, Loyalty, Window Display portrait, End-Cap, Holiday) + 7 widgets (ProductGrid, PriceCallout, SaleCountdown, WayfindingMap, LoyaltyQR, LookbookCarousel, StorefrontHours)
- 6 BAR presets (Tap List, Cocktail Menu, Game Day Hub, Live Event, Happy Hour, Trivia Night) + 6 widgets (TapList, CocktailMenu, HappyHourCountdown, GameDaySchedule, EventTonight, TriviaScoreboard)
- ensureSystemPresets() seeds + vertical-tag migrates rows on every API boot — RESTAURANT/RETAIL/BAR vertical tags applied automatically

### Widget framework
- `WidgetErrorBoundary` wraps every WidgetPreview — single bad widget no longer tanks the whole route
- Drag-threshold pattern (4px) on every widget type — click-to-edit no longer hijacks drag
- Capture-phase pointer cleanup — chalkboard / EditableText pointerup.stopPropagation() no longer leaves drag listeners hanging
- Shared `formatTime12 / parseTimeToMinutes / to24Hour` in `lib/format-time.ts` — every bell schedule + fitness class schedule now displays 12-hour regardless of stored format
- BellSchedule editor uses native `<input type="time">` (AM/PM picker + manual typing both work)
- BuilderZone CSS injection scoped to `[data-widget-content]` — font-size bumps no longer scale the chrome label badge
- VariantPicker click always ADDS — no more accidental swap when clicking a same-category tile
- Grid placement for new zones (no more cascading-stack overlap)
- Auto-jump to Properties on every selection change

### Streaming framework (Sprint 8c)
- Provider catalog in `packages/api-types/src/streaming.ts` — 14 providers across 6 tiers
- Public Broadcasters preset (NHK / France 24 / DW / Al Jazeera / Bloomberg / Sky News / CBS — venue-friendly, free, zero auth)
- StreamingWidget renderer — HLS (hls.js polyfill), DASH (lazy shaka), iframe (YouTube / Twitch / Vimeo with normalized embed URLs), RTMP/RTSP placeholder
- Ad overlay engine — lower-third / side-rail / full-bleed placements, weighted round-robin, per-channel allowAdOverlay flag
- Server-side: `/streaming/providers` + `/streaming/connections` + `/streaming/channels` REST endpoints under `/api/v1/streaming`
- Envelope-encrypted credential storage (per-row data key wrapped by DEVICE_SECRET_KEY)
- Tenant admin UI at `/[schoolId]/settings/streaming` — connect provider, pick channels, manage connections

### Billing
- License tier catalog in `packages/api-types/src/billing.ts` — 11 tiers (PILOT / CMS_CORE / SCHOOL_UNLIMITED / GYM_PRO / RESTAURANT_CHAIN / RETAIL_CHAIN / COMMAND / DISTRICT_OPS / RESPONDER_BRIDGE / COMP / CUSTOM)
- `/license/current` + `/license/tiers?vertical=X` API endpoints
- Tenant billing UI at `/[schoolId]/settings/billing` — current plan card + upgrade picker filtered to tenant's vertical
- Stripe Checkout endpoint scaffolding (`/api/v1/billing/checkout`) — 501 fallback to sales@ when STRIPE_SECRET_KEY is unset

### POS catalog sync (Sprint 8d) — NEW
- `POS_PROVIDERS` catalog in `packages/api-types/src/pos.ts` — 8 providers across 5 tiers:
  - Restaurant/QSR — Square, Toast, Clover, Aloha (NCR)
  - Retail — Lightspeed Retail, Shopify POS
  - Payments — Stripe Terminal
  - Gym — MINDBODY (ABC Fitness)
  - Custom webhook
- Prisma additions: `PosProviderConnection` (envelope-encrypted creds, last-sync metadata, location-map), `PosMenuItem` (synced catalog rows menu-board widgets read directly), `PosCategory`
- Server: `/api/v1/pos/providers`, `/api/v1/pos/connections` (CRUD), `/api/v1/pos/connections/:id/sync` (manual trigger), `/api/v1/pos/items` (live catalog read)
- Tenant admin UI at `/[schoolId]/settings/pos` — connect provider, view sync status, manual re-sync, disconnect

### Ad-network monetization (Sprint 8d) — NEW
- `AD_NETWORKS` catalog in `packages/api-types/src/ad-network.ts` — 8 networks across 4 tiers:
  - Programmatic DOOH — Hivestack, Vistar Media, Place Exchange, Broadsign Reach
  - Venue networks — Loop Media, Atmosphere TV (monetize)
  - Direct sales — Lamar Advertising
  - House-only (operator's own ads, no rev share)
- K12_FORBIDDEN gate enforced server-side — schools cannot connect third-party networks
- Per-connection content controls — IAB-category blocks (Alcohol / Pharma / Gambling / etc.) + dayparts + pause-during-emergency
- Prisma additions: `AdNetworkConnection`, `AdImpression`, `AdRevenueDaily` (nightly rollup for fast dashboard reads)
- Server: `/api/v1/ads/networks`, `/api/v1/ads/connections` (CRUD + pause/resume), `/api/v1/ads/earnings` (today/month/year + top earner)
- Tenant admin UI at `/[schoolId]/settings/monetize` — earnings dashboard + connections + content controls + network catalog

### APK status (2026-05-03)
- **No new APK has been built or shipped.** All Sprint 8c/8d features
  (streaming, POS, ads, billing UI, capability runtime) live in the
  Next.js web bundle that the existing APK loads on boot. **No APK
  rebuild needed for any of the new functionality.**
- Existing APK on test devices auto-picks up the new bundle on next
  page reload / pairing handshake — usually within 2 min of Vercel
  deploy.
- StreamingWidget now uses `pickBestVideo()` from the capability layer
  to auto-select H.264 over H.265 / AV1 on devices that don't decode
  the modern codec. Surfaces a friendly fallback message on Chromium
  <51 instead of a black box.
- Docs at `docs/APK_TESTING.md` cover three paths to verify Chromium
  95-and-older devices: BrowserStack, ADB-on-real-kiosk, browser UA
  override.

### Android 7→14 compatibility (Sprint 8d) — NEW
- `apps/web/src/lib/capabilities.ts` — boot-time detection of 22 capabilities (CSS / Web APIs / codecs / input). Memoized; SSR-safe.
- `useCapabilities()` React hook + `pickBestVideo()` / `pickBestImage()` helpers for codec / format auto-selection
- `ensurePolyfill('intersection-observer'|'resize-observer'|'broadcast-channel')` lazy-loader so polyfill bytes only ship to old WebView
- Player boot reports the capability snapshot to the server in device info — per-screen diagnostics let ops spot Chromium <70 / missing-H.265 fleet members
- `docs/ANDROID_COMPATIBILITY.md` is the load-bearing reference: three-layer strategy (CSS @supports → JS gate → polyfill), Android-version capability matrix, rules for adding new bleeding-edge features without dropping Android 7 support

### Existing platform
- Emergency system (4 panic types, signed pub/sub, AuditLog)
- Multi-tenant + tenant hierarchy (district→school)
- RBAC (5 roles)
- Brand kit (auto-scrape from URL, per-tenant + per-template)
- Template builder (zones, drag-drop, variants picker, brand kit)
- Player APK + manifest sync + emergency cache
- Submissions / approval workflow (Sprint 1.5)
- Floor plans + per-screen emergency overrides (Sprint 8b)

---

## ⚠️ What needs vendor-side setup before going live

Each item below is fully scaffolded in code but needs an account / API key
/ partner approval that has to happen outside the codebase.

### Stripe billing
- [ ] Create Stripe account, configure tax / business profile
- [ ] Create Products + Prices in Stripe (one per LICENSE_TIER + monthly/annual)
- [ ] Paste Price IDs into `LICENSE_TIERS` in `packages/api-types/src/billing.ts`
- [ ] Set `STRIPE_SECRET_KEY` in API env (Railway prod + dev)
- [ ] `pnpm --filter api add stripe` (currently lazy-imported; install when ready)
- [ ] Configure Stripe Customer Portal (cancel / upgrade / payment-method update)
- [ ] Implement `/billing/webhook` — sync subscription status → `License.status`. Webhook signing-secret verification required.
- [ ] Test with `stripe listen --forward-to https://api/api/v1/billing/webhook`

### Streaming provider OAuth (Vimeo + Soundtrack Your Brand)
Code path is `provider.auth === 'oauth2'` — currently shows "Contact sales" placeholder.
- [ ] Register OAuth app with Vimeo (developer.vimeo.com) — client ID / secret
- [ ] Register OAuth app with Soundtrack (developer.soundtrackyourbrand.com)
- [ ] Build callback endpoint `/streaming/oauth/:provider/callback`
- [ ] Token refresh job (cron) — exchange refresh_token → access_token before expiry

### POS provider sync handlers
Code path is `apps/api/src/pos/providers/<id>.ts` — file-per-provider that maps the provider's catalog API → our `PosMenuItem` rows. Connection wizard works today; sync button currently returns "handler not yet implemented" until each handler ships.
- [ ] `square.ts` — Square Catalog API (`GET /v2/catalog/list`); register OAuth app at squareup.com/developers
- [ ] `toast.ts` — Toast Menus API; Toast Partner Program enrollment required
- [ ] `clover.ts` — Clover Inventory API (`/v3/merchants/:id/items`); free dev portal
- [ ] `lightspeed-retail.ts` — Lightspeed R-Series Items API
- [ ] `shopify-pos.ts` — Shopify Admin API products endpoint
- [ ] `stripe-terminal.ts` — Stripe Products + Prices listing
- [ ] `mindbody.ts` — MINDBODY Public API (Site → Class → Retail)
- [ ] Webhook receiver `/api/v1/pos/webhook/:provider` for custom-webhook + Square/Toast realtime updates

### Ad-network creative-fetch handlers
Code path is `apps/api/src/ads/networks/<id>.ts`. Each implements the creative fetch + impression report cycle for that network.
- [ ] `hivestack.ts` — Hivestack Publisher API; OpenRTB 2.5 bid request
- [ ] `vistar-media.ts` — Vistar Publisher API; their Open Direct format
- [ ] `place-exchange.ts` — Place Exchange OpenRTB DOOH integration
- [ ] `broadsign-reach.ts` — Broadsign Reach SSP API
- [ ] `loop-media.ts` — Loop.tv publisher API (curated content + rev share)
- [ ] Daily revenue aggregator cron (rolls AdImpression → AdRevenueDaily)

### Streaming partner programs (Atmosphere / DIRECTV / DISH / Mood Media / iHeart)
These providers are partner-only (no self-serve API).
- [ ] Email Atmosphere TV partners@ — pitch as a digital-signage integration partner
- [ ] Same for DIRECTV STREAM for Business, DISH Business, Mood Media
- [ ] Once granted, build per-provider handler in `apps/api/src/streaming/providers/`

### Canva Connect
- [ ] Apply to Canva Connect partner program (canva.dev/docs/connect)
- [ ] Register OAuth app
- [ ] Build the import endpoint that calls Canva's `/v1/designs` API
- [ ] Build the per-design renderer (PDF → PNG via the Sprint 10 pipeline)

### Social media integrations (Instagram / Facebook / X / TikTok)
- [ ] Register Meta developer app (Instagram + Facebook)
- [ ] Register Twitter/X dev account
- [ ] Register TikTok for Developers app
- [ ] Build OAuth flows + post-fetch endpoints
- [ ] Add per-platform feed widgets (currently `SOCIAL_FEED` is a placeholder)

### POS integrations (Square / Toast / Clover / Stripe Terminal)
- [ ] Register Square developer app — sandbox + production
- [ ] Same for Toast (commercial-grade approval needed) and Clover
- [ ] Build webhook ingestion for menu/price changes
- [ ] Add menu-board sync that re-renders RESTAURANT presets when POS data changes

### Production deploy checklist (morning launch)
- [ ] Run Prisma migration for the 8 new tables (streaming + POS + ads):
       `stream_provider_connections`, `stream_channels`, `stream_ad_slots`,
       `pos_provider_connections`, `pos_menu_items`, `pos_categories`,
       `ad_network_connections`, `ad_impressions`, `ad_revenue_daily`
       (run `pnpm db:push` against prod DATABASE_URL)
- [ ] Set `STRIPE_SECRET_KEY` (when ready — until then UI falls back to sales@)
- [ ] Set `STRIPE_WEBHOOK_SECRET` (when ready)
- [ ] Verify `DEVICE_SECRET_KEY` = 64 hex chars (now used by streaming + POS + ads creds-cipher)
- [ ] Verify `ALLOWED_ORIGINS` includes the Vercel prod URL
- [ ] Smoke-test the new endpoints:
       `/api/v1/streaming/providers` → catalog
       `/api/v1/pos/providers` → catalog
       `/api/v1/ads/networks` → catalog
       `/api/v1/license/tiers?vertical=GYM` → GYM_PRO recommended
- [ ] Verify the new admin pages render:
       `/<schoolSlug>/settings/streaming`
       `/<schoolSlug>/settings/billing`
       `/<schoolSlug>/settings/pos`
       `/<schoolSlug>/settings/monetize`
- [ ] Confirm RESTAURANT/RETAIL/BAR templates appear in the gallery for tenants of those verticals (`/<slug>/templates`)
- [ ] Spot-check the player capability snapshot in browser dev console: `[Player] capabilities { chromium: ..., modern: ..., h265: ..., av1: ... }`

---

## 🚧 Known gaps / future sprints

- DASH playback needs `pnpm --filter web add dashjs` to actually play DASH streams (lazy-loaded; widget shows fallback message until installed)
- StreamAdSlot scheduling UI (scheduler / cadence editor) not yet built — only the renderer is. Operators can define slots via API but there's no admin form yet
- Webhook-based Stripe subscription sync not implemented — License.status must be updated manually until webhook handler ships
- Per-provider channel discovery (auto-import from a connected provider's API) only implemented for `public-broadcasters`; other providers require manual URL entry
- Canva / Square / social OAuth flows scaffolded as placeholders; no actual token exchange yet

---

## 🎯 Next-up sprint candidates

In priority order, ranked by revenue impact:

1. **Square POS sync handler** (`apps/api/src/pos/providers/square.ts`) —
   first POS to wire end-to-end. Free OAuth, broad merchant base, immediate
   value for restaurant/QSR/retail tenants.
2. **Stripe webhook + License sync** — closes the billing loop. Once the
   Square handler proves the credential flow, repeat for Stripe billing.
3. **Hivestack ad-network handler** (`apps/api/src/ads/networks/hivestack.ts`) —
   first revenue-generating ad integration. Highest fill rate of the
   programmatic DOOH options.
4. **YouTube OAuth + channel discovery** — gym/bar operators sign in once,
   pick from their YouTube subscriptions instead of pasting URLs.
5. **Toast / Clover POS handlers** — round out the QSR/restaurant integrations.
6. **StreamAdSlot scheduler UI** — daypart picker + asset → slot binding for
   in-house ad rotations.
7. **Canva Connect MVP** — partner application + import flow.
8. **Vistar / Place Exchange / Broadsign ad handlers** — broader DOOH inventory.

Each is independently shippable. Recommended order is "first revenue path
end-to-end" (Stripe billing → Square POS → Hivestack ads) before fanning
out to additional providers within each category.

## 📊 What you're shipping in the morning launch

Counts as of last commit:
- **8 verticals** (K12, GYM, RETAIL, CORPORATE, QSR, FASHION, BAR, +UNIVERSAL)
- **30+ vertical-specific templates** + 60+ universal K12 presets
- **80+ widget renderers** across the verticals
- **30 streaming providers** (across streaming + POS + ads catalogs combined)
- **11 license tiers** with vertical-aware upgrade picker
- **8 new database tables** ready for `pnpm db:push`
- **4 new admin pages** at `/settings/streaming`, `/settings/billing`,
  `/settings/pos`, `/settings/monetize`
- **Android 7→14 single-bundle compatibility** with auto-fallback runtime
- **2 new framework docs** in `docs/` covering the Android compat plan

---

*Last refreshed: 2026-05-03 by autonomous build session.*
