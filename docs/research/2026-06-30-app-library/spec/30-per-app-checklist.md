# 30 — Per-App Build Checklist (all Top-20 + Phase-3 moat apps)

Build-ready spec for every app in the VenueOS **Apps Library**. Grounded in the real
codebase (`00-SYNTHESIS.md` §2/§3 + the map-to-venueos agent that inspected the repo).
A mid-level dev (Sonnet-5) should be able to implement each entry with **no further
research**.

> Read `10-architecture.md` / `20-registry-schema.md` first for the `AppDef` type, the
> `AppsCatalog` registry, the `<AppConfigForm>` renderer, and the two new backend routes.
> This file is the per-app payload that fills that registry.

---

## 0. Ground truth (verified in code, do not re-derive)

Every app is one `AppDef` entry (modeled 1:1 on `FitnessSource` in
`apps/web/src/components/widgets/fitness/fitnessSourceCatalog.ts`). Its `build(config)`
returns `{ widgetType, defaultConfig }` for an **existing** renderer — so ~90% of apps
need **zero** new React/player code.

Verified render contract (`apps/web/src/components/widgets/WidgetRenderer.tsx`):

| widgetType | Renderer | Config keys the renderer actually reads | Line |
|---|---|---|---|
| `WEBPAGE` | `WebpageWidget` | `url`, `refreshIntervalMs`, `interactive` → proxied `${API_BASE}/api/v1/proxy/web?url=<enc>&v=3[&interactive=true]` | 3810–3853 |
| `STREAMING` | `StreamingWidget` | `embedUrl`, `playbackUrl`, `playbackType:'iframe'|'hls'|'dash'|'rtmp'|'rtsp'`, `muted`, `isLive`, `title`, `poster` | 470 / StreamingWidget 70–95, `normalizeEmbedUrl` 281 |
| `CALENDAR` | `CalendarWidget` | `events[]` (`{title,start,end,allDay?,location?}`), `mode`, theme fields | 456 |
| `WEATHER` | `WeatherWidget` | `location`/`lat`/`lng`, `units`, variant/theme (already live via `use-live-weather.ts`) | 448 |
| `RSS_FEED` | `RSSWidget` | **⚠ renders 5 HARDCODED items today (L3998–4028), ignores any URL** — must be wired to real feed before any News app ships | 493 |
| `SOCIAL_FEED` | `SocialWidget` | placeholder (icon + "Connected"); no fetch/render | 494 |
| `TICKER` | `TickerWidget` | `messages[]` OR `text` (split on `\n`/`•`) OR live `dataUrl`; `speed:'slow'|'normal'|'fast'` | 453 / 2201–2219 |
| `MUSIC_PLAYER` | `MusicPlayerWidget` | `source`, stream URL, business-hours (SomaFM/NPR/NTS/custom real) | 480 |
| `IMAGE_CAROUSEL` | `ImageCarouselWidget` | `assetUrls[]`/`urls[]`, dwell/transition | 459 |
| `LIVE_DATA` / `CHART` | variant registry (`variants-register.ts`) | resolves best non-`previewOnly` variant; merge `defaultConfig` under `cfg` | 684–719 |
| `QUOTE`, `CLOCK`, `COUNTDOWN` | native | client-render, fully editable | 505 / 447 / 449 |
| `TOUCH_QR` | canonicalizes → `TOUCH_POINT` variant `'qr'` (`QrCodeVariant`) | `data`/`url`, size, logo | AddSidebar L83–94 |

**QR is already built** (`AddSidebar` `{id:'qr', widgetType:'TOUCH_QR'}` → real `QrCodeVariant`).
The "QR" app is a friendly config over `TOUCH_QR` — **not** a new widget.

**Two — and only two — new backend routes** unlock the marquee non-costume apps
(build once, reused by many apps below). Both reuse the SSRF guard in
`apps/api/src/branding/safe-fetch.ts` exactly as `discovery.service.ts` does:

- **`GET /api/v1/proxy/rss?url=`** — fetch + parse RSS/Atom → `{items:[{title,link,pubDate,image?,summary?}]}`. Add sibling file `apps/api/src/proxy/proxy.controller.ts` (new `@Get('rss')`), parser via `rss-parser` (npm). Then **wire `RSSWidget` to fetch it** (React Query, poll `refreshIntervalMs`, fall back to cached last-good).
- **`GET /api/v1/calendar/ics?url=`** — fetch + parse a public `.ics` (RFC 5545, handle `RRULE`, TZ, all-day) → the `events[]` shape `CalendarWidget` already consumes. Parser via `node-ical`. Cache + revalidate so a briefly-down source doesn't blank the board.

**Status enum** (honesty-first, mirrors `SourceStatus` + `ConnectorStatus`):
`AVAILABLE` (real self-serve path now) · `NEEDS_LOGIN` (business OAuth/token) ·
`BRING_ACCOUNT` (paste your paid-aggregator/3rd-party widget URL) · `COMING_SOON` (recognised, not wired — **never a live Connect button**, per `discovery.service.ts buildCandidate()` invariant).

**`frictionTier`** (drives the picker sort + badge, §4.1 synthesis):
`instant` (no login) · `publish` (publish-to-web / make-public step) · `business-login` (OAuth/API key) · `aggregator` (paid third party).

**Taurus/LED note (CLAUDE.md #10):** the player floor is Chromium 83–87. Pure `<iframe src>` embeds render fine. **JS-SDK embeds that must run a `<script>` (Pinterest `pinit.js`, X `widgets.js`, TikTok `embed.js`, Twitch `parent=`)** need a **non-null-origin** frame — they FAIL in our null-origin sandboxed `EXTERNAL_HTML` board and must ride `WEBPAGE(interactive)` (which serves same-origin via `/api/v1/proxy/web`). Live embeds have **no offline frame** on a Chromium-83 LED that loses network → mark for **snapshot-to-Asset** fallback (Phase 2 service: periodically screenshot the embed to a Supabase-hosted IMAGE and swap it in when the live frame can't load). Never emit the `inset` shorthand / `inset-0` in any new widget/player CSS — longhand `top/right/bottom/left` only.

---

# PHASE 1 — App Library shell + "Instant" apps

Ride existing widgets; ~zero backend except the RSS + ICS routes (needed for News + branded Calendar).

---

### 1. YouTube  · `youtube` · Video · frictionTier `instant`
- **configFields:**
  - `url` (url, required) — "Paste a YouTube video, playlist, live, or channel link". placeholder `https://youtube.com/watch?v=…`
  - `mode` (select, default `auto`) — `auto | video | playlist | live` (auto-detected from URL; expose as override)
  - `muted` (bool, default `true`) — helper "Required for autoplay on displays"
  - `loop` (bool, default `true`)
  - `controls` (bool, default `false`)
- **build(config):** `{ widgetType:'STREAMING', defaultConfig:{ playbackType:'iframe', embedUrl: yt(config.url), muted:config.muted, isLive: config.mode==='live', title:'YouTube' } }`
- **URL transform `yt()`:** reuse `StreamingWidget.normalizeEmbedUrl` (handles watch/`youtu.be`/`/live/`/channel). Rules: `watch?v=ID`→`/embed/ID`; `?list=PL…`→`/embed/videoseries?list=PL…`; `live_stream?channel=ID` for live. Append `?autoplay=1&mute=1&loop=1&controls=0&playlist=ID` (loop needs `playlist=ID` for single video).
- **method/auth:** Official `/embed` iframe, **no key** for plain embed (Data API key only if you later resolve "latest on channel"). Content must be PUBLIC (not unlisted/private).
- **ToS/attribution:** none for embed.
- **Taurus/LED:** ✅ pure iframe. Autoplay needs `mute=1` (browser policy). No offline frame (live network required).
- **effort:** S

### 2. Google Slides · `google-slides` · Docs · frictionTier `publish`
- **configFields:**
  - `url` (url, required) — "Paste your Slides share or publish-to-web link"
  - `delayMs` (select, default `5000`) — 3s/5s/10s/15s/30s per-slide dwell
  - `loop` (bool, default `true`)
- **build:** `{ widgetType:'WEBPAGE', defaultConfig:{ url: slides(config.url), refreshIntervalMs:0 } }` (published Slides send permissive `frame-ancestors`, so it can skip the proxy; still route via `WEBPAGE` for uniformity).
- **URL transform `slides()`:** accept the `/d/<id>/edit` or `/d/e/<pub-id>/pub` form → rewrite to `https://docs.google.com/presentation/d/e/<pub-id>/embed?start=true&loop=<loop>&delayms=<delayMs>&rm=minimal`. `rm=minimal` hides Google chrome; `start=true` auto-plays.
- **method/auth:** File → Share → **Publish to web → Embed**. No key, no OAuth. Deck must be published (public).
- **ToS/attribution:** none. **Public-exposure warning** in form: "Publishing makes this deck visible to anyone with the link."
- **Taurus/LED:** ✅ pure iframe. Auto-refreshes on deck edit (few-min cache). No offline.
- **effort:** S

### 3. Calendar (Google / Outlook / Apple / iCal) · `calendar` · Calendar · frictionTier `publish`
- Ship as **one app with a `source` select** (`google | outlook | apple | ics`) OR 3 named tiles that all `build()` to the same path. Two tiers per source:
- **configFields:**
  - `source` (select, default `ics`) — Google Calendar / Outlook / Apple / Other iCal
  - `icsUrl` (url, required) — "Paste the public iCal / .ics feed URL" (helper per source: Google = Settings→Integrate→*Public address in iCal format*; Outlook = Settings→Shared calendars→**Publish**; Apple = shared-calendar `webcal://`)
  - `mode` (select, default `agenda`) — `agenda | week | month`
  - `render` (select, default `branded`) — `branded` (our CALENDAR widget) | `iframe` (Google's/Outlook's own UI)
- **build:**
  - `render==='branded'` → `{ widgetType:'CALENDAR', defaultConfig:{ icsUrl: config.icsUrl, mode: config.mode /* CalendarWidget fetches events via GET /api/v1/calendar/ics?url= */ } }`
  - `render==='iframe'` → `{ widgetType:'WEBPAGE', defaultConfig:{ url: config.icsUrl-or-embed-url } }` (Google embed = `calendar.google.com/calendar/embed?src=<calId>&mode=<MODE>`)
- **URL/transform:** normalize `webcal://`→`https://`. Backend `GET /api/v1/calendar/ics?url=` parses RFC-5545 (RRULE recurrence, TZ, all-day) → `events[]`. **Wire `CalendarWidget` to fetch it** (today it only reads hand-entered `config.events`).
- **method/auth:** ICS = open standard, **no key**. OAuth (Graph / Google Calendar API) only for private calendars — **defer**.
- **ToS/attribution:** none (ICS open standard).
- **Taurus/LED:** ✅ branded render is our own DOM (offline-cacheable events). iframe render = live-only.
- **effort:** S (iframe) / **M** (branded ICS parser — one backend, unlocks 4 named tiles). Flag "admin disabled publishing" failure in UX for Outlook/M365.

### 4. Weather · `weather` · Weather · frictionTier `instant`
- Already fully built (`WeatherWidget` + `use-live-weather.ts`, ~30 themed variants). App tile = friendly label + location/units config.
- **configFields:** `location` (text, default = tenant address/geocode), `units` (select `imperial|metric`, default `imperial`), `variant` (select — current / hourly / 7-day / radar), `provider` (select, default `auto`)
- **build:** `{ widgetType:'WEATHER', defaultConfig:{ location, units, variant } }`
- **Enrichment (S, additive):** add **NWS `api.weather.gov`** (free, keyless, US — official alerts/CAP, hourly) + **Open-Meteo** (free, keyless, global) as no-key providers; RainViewer free radar tiles. NWS severe-weather CAP feeds the emergency moat (see App 30).
- **method/auth:** current provider uses a key; NWS/Open-Meteo need none.
- **ToS/attribution:** NWS/Open-Meteo free; attribution light. **Taurus:** ✅ our DOM.
- **effort:** S

### 5. News / RSS · `news` · News · frictionTier `instant`
- **⚠ BLOCKED until `GET /api/v1/proxy/rss` exists AND `RSSWidget` is wired to it** (today it renders 5 hardcoded fakes). Do NOT ship as turnkey before that.
- **configFields:**
  - `preset` (select) — curated feeds by topic/region: Google News Top/World/Business/Tech/Sports/local-by-query, AP, Reuters, BBC, NPR, ESPN (each maps to a vetted RSS URL)
  - `feedUrl` (url, optional) — "Or paste any RSS/Atom URL"
  - `maxItems` (number, default 6, 1–20)
  - `showImages` (bool, default true) — prefer publisher enclosure images (scraping headline images = medium takedown risk)
- **build:** `{ widgetType:'RSS_FEED', defaultConfig:{ feedUrl: presetUrl(config.preset) || config.feedUrl, maxItems, showImages } }`
- **URL/transform:** Google News RSS = `https://news.google.com/rss/…` (topic/search params). Backend parses server-side (browsers can't fetch cross-origin XML).
- **method/auth:** RSS = free, keyless. **Avoid NewsAPI.org** (dev-only license = legal landmine for a commercial CMS). If richer search-news wanted later: GNews / NewsData.io on a **Tier-1 platform key**, cache aggressively (M).
- **ToS/attribution:** RSS license-friendly; prefer publisher-provided images.
- **Taurus/LED:** ✅ our DOM (cache last-good so an offline LED still shows headlines).
- **effort:** S (curated presets) + **M** one-time (RSS route + wiring). ← the gating M.

### 6. Web Page / URL · `webpage` · Web · frictionTier `instant`
- The universal catch-all + the engine under every iframe app.
- **configFields:** `url` (url, required), `refreshIntervalMs` (select, default 0 — off/1m/5m/15m/1h), `interactive` (bool, default false — "run the page's own scripts"), `scrollEnabled` (bool)
- **build:** `{ widgetType:'WEBPAGE', defaultConfig:{ url, refreshIntervalMs, interactive } }`
- **method/auth:** SSRF-guarded proxy `GET /api/v1/proxy/web?url=&interactive=` (exists) strips `X-Frame-Options`/CSP `frame-ancestors`.
- **Guardrail (do-better #6):** at config time, **HEAD-check** the URL for `X-Frame-Options`/CSP `frame-ancestors` and **warn "this site can't be embedded"** before adding (recurring-failure class). Small backend `GET /api/v1/proxy/embeddable?url=` returning `{embeddable:bool, reason}`.
- **ToS/attribution:** medium (embedding arbitrary sites can break/violate their terms — named-app configs de-risk the common cases).
- **Taurus/LED:** ✅ iframe; interactive-mode JS may strain Chromium-83 → snapshot fallback candidate.
- **effort:** S (+ optional S for the pre-flight check).

### 7. QR Code · `qr` · Utility · frictionTier `instant`
- **Reuses existing `TOUCH_QR`** (→ `TOUCH_POINT` variant `'qr'` / `QrCodeVariant`). No new widget.
- **configFields:** `content` (text, required — URL / text / vCard / `WIFI:` string), `label` (text, optional caption), `logoUrl` (url, optional center logo), `fgColor` / `bgColor` (color, brand-preset aware)
- **build:** `{ widgetType:'TOUCH_QR', defaultConfig:{ data: config.content, label, logoUrl, fgColor, bgColor } }`
- **method/auth:** client-side SVG generation (bundle `qrcode` npm). **Never** call `api.qrserver.com`/Google Charts (privacy + offline).
- **ToS/attribution:** none. **Taurus/LED:** ✅ inline SVG, crisp at 4K, fully offline. Universal fallback for any un-embeddable "follow us / order / review" link.
- **effort:** S (mostly done).

### 8. Clock / Countdown / Date · `clock` `countdown` `date` · Utility · frictionTier `instant`
- Native `CLOCK` / `COUNTDOWN` widgets exist + editable. App tiles = named presets.
- **Clock configFields:** `timezone` (select), `format` (select `12h|24h`), `face` (select `digital|analog|world|flip`), `showSeconds` (bool), `showDate` (bool)
- **Countdown configFields:** `targetDate` (datetime, required), `label` (text), `units` (multiselect days/hours/min/sec), `onComplete` (select `hide|hold-zero|count-up`)
- **build:** `{ widgetType:'CLOCK'|'COUNTDOWN', defaultConfig:{…} }`
- **method/auth:** pure client render (device time / target date), no service.
- **ToS/attribution:** none. **Taurus/LED:** ✅ fully offline (avoid modern-only `Intl` edge cases; test on Chromium-83).
- **effort:** S. **Gap vs competitors = variant breadth** (analog face, world/multi-zone row, count-up) — cheap CSS/JS to fill the Utility row.

### 9. Canva · `canva` · Docs · frictionTier `publish`
- **configFields:** `url` (url, required — "Paste your Canva public design link"), `autoplay` (bool — presentations)
- **build:** `{ widgetType:'WEBPAGE', defaultConfig:{ url: canva(config.url) } }`
- **URL transform `canva()`:** `canva.com/design/<id>/view` → append `?embed`. Design must be set "anyone with the link".
- **method/auth:** Share → More → **Embed** (public iframe, no OAuth, live-updates, VIEW-only, shows Canva chrome).
- **Premium (defer, L):** Canva Connect API (OAuth2+PKCE, `CANVA_CLIENT_ID/SECRET` already in env, Sprint 11) → export design → PNG/MP4 → re-host as `IMAGE`/`VIDEO` Asset (no Canva chrome, offline-cacheable). Canva is OptiSigns' highest-rated app (4.8) — parity matters; upsell later.
- **ToS/attribution:** none for embed. **Taurus:** ✅ iframe (chrome visible); no offline until Connect-export path.
- **effort:** S (embed) / L (Connect export).

### 10. PowerPoint / OneDrive · `powerpoint` · Docs · frictionTier `publish`
- **configFields:** `url` (url, required — "Paste your OneDrive/Office embed link OR a public .pptx URL")
- **build:** `{ widgetType:'WEBPAGE', defaultConfig:{ url: office(config.url) } }`
- **URL transform `office()`:** if already an `onedrive.live.com/embed`/`office.com` embed → use as-is. If a public `.pptx`/`.docx`/`.xlsx`/`.pdf` URL → wrap in **Office Online Viewer**: `https://view.officeapps.live.com/op/embed.aspx?src=<enc PUBLIC_URL>`.
- **method/auth:** PowerPoint for the web → File → Share → **Embed** (public iframe). Personal OneDrive embed is anonymous.
- **Gotcha (surface in UX):** detect `sharepoint.com` / `-my.sharepoint.com` → warn **"Business/SharePoint links force a Microsoft sign-in and show a login wall on a kiosk unless your admin enables anonymous embed links."** Upgrade path = M365 Graph OAuth (L, defer).
- **ToS/attribution:** none. **Taurus:** ✅ iframe; no offline.
- **effort:** S. (Note: Office Online *Server* on-prem retires 31-Dec-2026; does NOT affect the cloud embed.)

### 11. Google Maps / Traffic · `google-maps` · Utility · frictionTier `instant`
- **configFields:** `mode` (select, default `place`) — `place | directions | view | streetview | search`; `query` (text, required — address/place); `origin`+`destination` (text, for directions); `trafficLayer` (bool)
- **build:** `{ widgetType:'WEBPAGE', defaultConfig:{ url: mapsEmbed(config) } }`
- **URL transform `mapsEmbed()`:** `https://www.google.com/maps/embed/v1/<mode>?key=<GOOGLE_MAPS_API_KEY>&q=<enc query>` (+ `origin`/`destination` for directions). **Build server-side or via a thin `GET /api/v1/maps/embed-url` proxy so the key never hits the browser** (we already keep `GOOGLE_MAPS_API_KEY` server-only for geocoding). Legacy keyless fallback: `maps.google.com/maps?q=<q>&output=embed`.
- **method/auth:** Maps **Embed API** — free, **unlimited** (needs GCP key w/ billing enabled but $0 for Embed). Restrict key to Embed API + referrer. Min 200×200.
- **ToS/attribution:** Google branding shown by the embed (satisfies attribution). May show ads.
- **Taurus/LED:** ✅ iframe. **effort:** S. Also the delivery vehicle for the Traffic sub-app (traffic layer via view/directions params).

### 12. Vimeo · `vimeo` · Video · frictionTier `instant`
- **configFields:** `url` (url, required), `muted` (bool, default true), `loop` (bool, default true), `background` (bool — clean no-chrome mode), `autopause` (bool, default false)
- **build:** `{ widgetType:'STREAMING', defaultConfig:{ playbackType:'iframe', embedUrl: vimeo(config.url), muted, isLive:false, title:'Vimeo' } }`
- **URL transform `vimeo()`:** reuse `normalizeEmbedUrl` (`vimeo.com/<id>` → `player.vimeo.com/video/<id>?muted=1&autoplay=1&loop=1&autopause=0&background=<background>`). oEmbed resolver already in `streaming.service.ts`.
- **method/auth:** official player iframe, no key.
- **Gotcha:** Pro/Business accounts can domain-allowlist embeds — **warn "if the video is private, add our player domain to Vimeo's allowed-domains."** Standard+ hides logo/controls (cleanest signage look).
- **ToS/attribution:** none. **Taurus:** ✅ iframe. **effort:** S.

### 13. Cloud-folder slideshow (Drive / Dropbox / OneDrive) · `cloud-folder` · Media · frictionTier `publish`
- "Drop a photo in the folder → it's on screen."
- **configFields:** `folderUrl` (url, required — public shared folder link), `provider` (select `gdrive|dropbox|onedrive`, auto-detect), `dwellMs` (select, default 8000), `transition` (select `fade|slide|none`), `order` (select `name|newest|shuffle`)
- **build:** `{ widgetType:'IMAGE_CAROUSEL', defaultConfig:{ urls: [...resolved image URLs], dwellMs, transition } }`
- **method/auth:** backend **`GET /api/v1/proxy/cloud-folder?url=`** lists a public folder → image direct-URLs. Drive: Drive API `files.list?q='<folderId>'+in+parents` with a public folder + platform key, OR the public folder-share HTML parse. Dropbox: `?dl=1` on shared links. Start with **Google Drive public folder + platform key**; others additive. (M — this route is the only new work.)
- **ToS/attribution:** none (operator's own content). **Taurus/LED:** ✅ images re-hosted/cached → offline-safe.
- **effort:** M.

### 14. Google Sheets (embed + as data source) · `google-sheets` · Data · frictionTier `publish`
- **configFields:** `url` (url, required — publish-to-web link), `render` (select `iframe|branded`, default `iframe`), `range` (text, optional `Sheet1!A1:D20`), `asChart` (bool — branded mode)
- **build:**
  - `iframe` → `{ widgetType:'WEBPAGE', defaultConfig:{ url: sheetEmbed(config.url) } }` — `docs.google.com/spreadsheets/d/e/<id>/pubhtml?gid=&range=&widget=true&headers=false`
  - `branded` → `{ widgetType:'LIVE_DATA', defaultConfig:{ dataUrl: sheetCsv(config.url), … } }` (or `CHART` if `asChart`) — pull `…/pub?output=csv` (or gviz JSON), render into our brand palette
- **URL/transform:** File → Share → **Publish to web**. CSV path: `output=csv&gid=<gid>`. The published-CSV fetcher is shared with the generic Data-Source app (App 22) + Digital Menu.
- **method/auth:** publish-to-web, no key. Sheets API v4 (key for public / OAuth for private) only for the deeper path — defer.
- **ToS/attribution:** none. Public-exposure warning. **Taurus:** ✅ iframe; branded render offline-cacheable.
- **effort:** S (iframe) / M (branded CSV fetcher).

### 15. Pinterest · `pinterest` · Social · frictionTier `instant`
- One of the few **keyless official** social embeds left.
- **configFields:** `url` (url, required — board or profile URL), `type` (select `board|profile|pin`, auto), `columns` (number, default 3)
- **build:** `{ widgetType:'WEBPAGE', defaultConfig:{ url: <hosted EXTERNAL_HTML shim url>, interactive:true } }` — needs `pinit.js` to run, so bake a tiny `EXTERNAL_HTML` board carrying the anchor + `<script src=pinit.js>` and load it via `WEBPAGE(interactive)` (non-null origin). **Not** a bare `src` iframe.
- **method/auth:** Pinterest widget builder (Pin/Board/Profile via `pinit.js`), free, keyless, up to 50 pins.
- **ToS/attribution:** Pinterest branding in widget. **Taurus/LED:** ⚠ needs script → `WEBPAGE(interactive)`, not the null-origin board; snapshot fallback for offline LEDs.
- **effort:** S. Good for RETAIL/FASHION/HOSPITALITY.

### 16. Bluesky · `bluesky` · Social · frictionTier `instant`
- **Cleanest modern social embed** — keyless oEmbed, open protocol.
- **configFields:** `url` (url, required — `bsky.app/…/post/…` or AT-URI), `maxWidth` (number, 220–600, default 500)
- **build:** `{ widgetType:'WEBPAGE', defaultConfig:{ url: <shim>, interactive:true } }` — embed JS from `embed.bsky.app` re-fetches the post and renders media/quotes.
- **URL/transform:** oEmbed at `https://embed.bsky.app/oembed?url=<enc>` returns blockquote+script; wrap in an `EXTERNAL_HTML` shim.
- **method/auth:** official oEmbed (registered provider in `oembed.com/providers.json`), no key, no business account.
- **ToS/attribution:** low risk. **Taurus:** ⚠ script → `WEBPAGE(interactive)`. Single post today (account feeds = 3rd-party). **effort:** S.

### 16b. Tripadvisor · `tripadvisor` · Reviews · frictionTier `instant`
- Best keyless of the three review sources.
- **configFields:** `widgetSnippet` (text/paste — the official copy-paste embed code) OR `businessName` (text) + `widgetType` (select — latest reviews / rating badge)
- **build:** `{ widgetType:'WEBPAGE', defaultConfig:{ url:<shim carrying the TA snippet>, interactive:true } }`
- **method/auth:** official free widget builder at `tripadvisor.com/Widgets` (fixed presets, TA-branded, keyless). Deeper = paid Content API / 3rd-party (defer).
- **ToS/attribution:** **Tripadvisor attribution required** (baked into their widget). **Taurus:** ⚠ script. **effort:** S. Good for HOSPITALITY/RESTAURANT.

### 17. Stocks / Crypto / Currency ticker · `stocks` `crypto` `currency` · Data · frictionTier `instant`
- Brand-native render (do NOT iframe ugly 3rd-party widgets).
- **configFields (crypto):** `coins` (multiselect/text, default `bitcoin,ethereum`), `vsCurrency` (select, default `usd`), `format` (select `ticker|cards`)
- **configFields (currency):** `base` (select, default `USD`), `targets` (multiselect, default `EUR,GBP,JPY`)
- **configFields (stocks):** `symbols` (text, default `AAPL,MSFT,SPY`), `format` (select `ticker|cards`)
- **build:** `{ widgetType:'TICKER', defaultConfig:{ dataUrl:'/api/v1/data/<crypto|fx|stocks>?…', speed:'normal' } }` (or `LIVE_DATA` for cards). `TickerWidget` already prefers a live `dataUrl` feed (L2215).
- **method/auth (2026, verified):**
  - **Currency → Frankfurter (`frankfurter.dev`)** — ECB data, **NO key**, unlimited, ~33 currencies. Zero-config default. **ToS: low.**
  - **Crypto → CoinGecko** free API (generous, key-optional), 14k coins. **ToS: low** (no display license issue).
  - **Stocks → Finnhub** free tier (60 calls/min, stocks+forex+crypto) — key required, server-side only. **ToS: medium** (free tiers restrict commercial redistribution — read terms before GA; Finnhub/CoinGecko are the most signage-friendly).
- **Backend:** `GET /api/v1/data/{crypto|fx|stocks}` — server-side fetch on **platform key**, **cache aggressively (60s)** so the shared rate-limit holds across tenants. Never expose keys client-side.
- **Taurus/LED:** ✅ our DOM. **effort:** S (currency, keyless) / M (stocks — key + cache plumbing; crypto rides same route).

---

# PHASE 2 — Social done right + reviews + resilience

Facebook Page, aggregator Social Wall, Google/Yelp reviews, Twitch + the resilience/UX layers.

---

### 18. Twitch · `twitch` · Video · frictionTier `instant`
- **configFields:** `channel` (text, required — `twitch.tv/<channel>` or channel name), `content` (select `live|vod|clip`, default live), `muted` (bool, default true), `showChat` (bool, default false)
- **build:** `{ widgetType:'STREAMING', defaultConfig:{ playbackType:'iframe', embedUrl: twitch(config.channel, parentHost), muted } }`
- **URL transform `twitch()`:** `https://player.twitch.tv/?channel=<ch>&parent=<HOST>&muted=1&autoplay=true`. **The `parent=` param is the whole job:** it MUST equal the deployed player host(s) (`window.location.hostname`) and the frame MUST be served over HTTPS from a **non-null origin**. `StreamingWidget` already injects `parent` from `window.location.hostname`. **A null-origin sandboxed `EXTERNAL_HTML` board FAILS the parent check** → must mount in `STREAMING`/`WEBPAGE` carrying our real origin.
- **method/auth:** official iframe, no key.
- **ToS/attribution:** none. **Taurus/LED:** ✅ iframe (real origin). No offline. **effort:** M (the parent-domain enumeration is the real work).

### 19. Social Wall (IG + FB + X + TikTok + LinkedIn, aggregator-backed) · `social-wall` · Social · frictionTier `aggregator`
- **The honest solve** for every dead native embed (IG Basic Display shut Dec 4 2024; Meta oEmbed reviewed-token since Apr 2025; X API pay-per-use since Feb 6 2026; TikTok/LinkedIn no public feed). The marquee "social" answer.
- **Two models (config `mode`):**
  - `byo` (BRING_ACCOUNT, ship first) — operator pastes their **own aggregator's published-wall URL**; zero ToS risk to us, they pay the aggregator.
  - `managed` (NEEDS_LOGIN, Tier-3) — VenueOS holds ONE enterprise aggregator account and resells walls as a billed line item (matches the managed-AI economic model).
- **configFields:** `mode` (select), `wallUrl` (url, required if byo — "Paste your Walls.io / EmbedSocial / Taggbox / Curator / Juicer wall URL"), `refreshHint` (info — "Walls refresh on the aggregator's schedule, ~10 min")
- **build:** `{ widgetType:'WEBPAGE', defaultConfig:{ url: config.wallUrl, refreshIntervalMs: 600000 } }`
- **method/auth:** aggregator handles OAuth/tokens/moderation; gives back one iframe/URL. Pricing ~$19–$99/mo (Taggbox/EmbedSocial/Juicer) up to $250/30-day (Walls.io events).
- **ToS/attribution:** aggregator absorbs the takedown/rate-limit/ToS liability. **Taurus:** ✅ iframe (their hosted wall). **effort:** M (byo) / L (managed billing tier).

### 20. Reviews Wall (Google · Yelp) · `reviews` · Reviews · frictionTier `business-login`
- **configFields:** `source` (select `google|yelp`), `placeId` (text — Google Place ID) / `yelpBusinessId` (text), `minStars` (select filter), `maxReviews` (number — capped by API)
- **build:** `{ widgetType:'LIVE_DATA', defaultConfig:{ dataUrl:'/api/v1/reviews?source=&id=', variant:'review-cards' } }` (brand-native cards) OR `WEBPAGE` of a paste-your-3rd-party-widget URL (BRING_ACCOUNT fallback).
- **method/auth (2026, verified):**
  - **Google → Places API** (key, **server-side only** like `GOOGLE_MAPS_API_KEY`): **caps at ~5 reviews/location**; **ToS PROHIBITS caching/storing review content** (only `place_id` is cacheable) — a real offline/LED problem; must live-fetch. Attribution to Google **required**.
  - **Yelp → Fusion API** (key, server-side): **3 review EXCERPTS** free (7 on paid Pro Premium), never full reviews; Yelp attribution + Fusion Terms compliance **required**.
- **Backend:** `GET /api/v1/reviews` — server-side key, respect caps + attribution, honor Google no-cache ToS. **Do NOT scrape Google Maps/Yelp** (takedown risk).
- **ToS/attribution:** **attribution mandatory** (both). **Taurus/LED:** ⚠ Google no-cache means live-only (no offline snapshot of review text). **effort:** M (Google) / M (Yelp). Lead with Google (most-asked).

### 21. Facebook Page · `facebook` · Social · frictionTier `instant` (best-effort)
- **configFields:** `pageUrl` (url, required — public FB Page URL), `tabs` (select `timeline|events|messages`, default timeline), `smallHeader` (bool)
- **build:** `{ widgetType:'WEBPAGE', defaultConfig:{ url: fbPagePlugin(config), interactive:true } }`
- **URL transform:** `https://www.facebook.com/plugins/page.php?href=<enc pageUrl>&tabs=<tabs>&width=<w>&height=<h>&small_header=<bool>&adapt_container_width=true`.
- **method/auth:** **Page Plugin** iframe renders a public Page's timeline **without a token** — the ONE still-viable turnkey FB path. Fragile/Meta-throttled/regionally login-walled; refresh ~10 min.
- **Honesty:** label **"Basic — public Pages only, may be throttled."** Anything beyond a raw page timeline (single posts, mixed wall) needs a reviewed Meta app + token (post-Apr-2025) or the aggregator (App 19).
- **ToS/attribution:** medium (Meta throttling). **Taurus:** ⚠ script/plugin → `WEBPAGE`, real origin. **effort:** M.

### Phase-2 resilience/UX layers (cross-cutting, not tiles) — wire into the registry + editor
- **Concierge auto-config** — pipe `discovery.service.ts` output into the Apps grid: operator pastes website → highlight matching app tiles ("we found your Instagram + YouTube") + pre-fill each config form. Classifier already exists; surface it in the editor panel (it's onboarding-only today). Single-handle resolve on Tier-1 platform key.
- **snapshot-to-Asset** — backend cron renders each publish-to-web/live-embed app to an IMAGE/short-MP4 into the Supabase bucket; player swaps it in when the live frame can't run (offline/Chromium-83). Store `snapshotAssetId` on the zone config.
- **Taurus/LED badge** — per-app compatibility badge in the tile (✅ native/offline · ⚠ live-embed only · script-required) driven by an `AppDef.taurus: 'safe'|'live-only'|'needs-script'` field.
- **Embeddability pre-flight** — the `GET /api/v1/proxy/embeddable?url=` HEAD check from App 6, applied on any raw-URL app.

---

# PHASE 3 — Leapfrog moats (where we BEAT OptiSigns)

---

### 22. Generic Data-Source app (Xibo "DataSet" parity) · `data-source` · Data · frictionTier `publish`
- Connect data ONCE, then ANY template binds to it (menu / table / ticker / directory). Decouples "connect data" from "design."
- **configFields:** `name` (text, required), `type` (select `csv|google-sheet|json-api`), `sourceUrl` (url, required), `refreshMs` (select, default 300000), `keyPath` (text — JSONPath into the array for `json-api`), `columns` (repeatable `{key,label,type}`)
- **build:** creates a named **DataSet record** (new lightweight table `data_sources`) + returns `{ widgetType:'LIVE_DATA', defaultConfig:{ dataSourceId, columns } }`. Other widgets (menu/ticker/table) reference `dataSourceId`.
- **method/auth:** `GET /api/v1/data-sources/:id/rows` — server-side fetch (reuse the published-CSV fetcher from App 14 + a JSON fetcher w/ JSONPath), SSRF-guarded, cached. No third-party key for public sources.
- **ToS/attribution:** none (operator's data). **Taurus/LED:** ✅ rows cached → offline-safe.
- **effort:** L (new table + fetcher + binding UI). High leverage — powers menu/leaderboard/directory boards.

### 23. Webhook-in app · `webhook-in` · Data · frictionTier `instant`
- External systems POST content to a screen (POS order status, our sports engine, CI result, alarm). We already own the **outbound** webhook retry queue; this is the inbound receiver.
- **configFields:** `name` (text), `token` (auto-generated, readonly — the shared secret), `endpointUrl` (info, readonly — the generated inbound URL), `template` (select — how the payload renders: ticker / card / banner), `fieldMap` (repeatable `{jsonPath → zone field}`)
- **build:** `{ widgetType:'LIVE_DATA', defaultConfig:{ webhookChannelId, template, fieldMap } }`; the widget subscribes to the channel via the existing realtime bus.
- **method/auth:** new `POST /api/v1/webhook-in/:channelId` (HMAC-verify the `token`, reuse the emergency `WebsocketSignerService` signing pattern for the fan-out; AuditLog every receipt). Publishes to Redis channel → widget renders.
- **ToS/attribution:** none. **Taurus/LED:** ✅ pushes via realtime (HTTP-poll fallback), our DOM.
- **effort:** M.

### 24. Secure Dashboards (Power BI · Tableau · Looker Studio · Grafana) · `secure-dashboard` · Data · frictionTier `publish` (public) / `business-login` (auth)
- ScreenCloud's standout. Two tiers.
- **configFields:** `provider` (select `powerbi|tableau|looker|grafana`), `mode` (select `public|authenticated`), `embedUrl` (url, required for public), `refreshMs`
- **build (public):** `{ widgetType:'WEBPAGE', defaultConfig:{ url: config.embedUrl } }`
- **build (authenticated, the moat):** `{ widgetType:'IMAGE_CAROUSEL' or WEBPAGE, defaultConfig:{ snapshotAssetId } }` — one **headless-browser "authenticated render" engine** logs in server-side (stored per-tenant creds, encrypted like BYOK keys) and screenshots/streams the auth-gated page into a Supabase Asset on a schedule.
- **method/auth per provider (verified):**
  - **Power BI** — "Publish to web" = anonymous public iframe (⚠ **exposes report to the entire internet** — loud governance warning; many orgs disable it). Secure = Power BI Embedded (Azure AD/service principal, L).
  - **Tableau** — Tableau Public = free public iframe; Tableau Cloud private = Connected Apps/JWT (L).
  - **Looker Studio** — Share → Embed (enable embedding) → iframe, public or signed-in. Friendliest free path.
  - **Grafana** — public snapshot/embed URL or API-key panel render.
- **ToS/attribution:** none, but **public-exposure warning mandatory** on publish-to-web modes.
- **Taurus/LED:** ⚠ heavy JS dashboards strain Chromium-83 → **snapshot-render is the Taurus-safe path** (headless render → image). **effort:** S (public iframe) / L (headless auth-render engine — the differentiator).

### 25. Emergency / Safety category (CAP/NWS + named vendors) · `public-alert` `emergency-vendor` · Safety · frictionTier `instant` (NWS) / `business-login` (vendors)
- **Our moat** — no signage-only rival leads with life-safety. Auto-flip screens on a county CAP alert.
- **configFields (NWS):** `state` + `county`/`zone` (select, default from tenant geocode), `severities` (multiselect — Extreme/Severe/Moderate), `autoTrigger` (bool — "Automatically flip screens to the emergency layer on a matching alert")
- **build:** `{ widgetType:'LIVE_DATA', defaultConfig:{ dataUrl:'/api/v1/alerts/nws?zone=', variant:'alert-banner' } }` + optional wire into the **existing emergency pipeline** (`emergency.trigger`).
- **method/auth:** **NWS `api.weather.gov`** — free, **keyless**, US. Emits CAP v1.2 XML + JSON-LD + ATOM by state/county/zone (the FEMA IPAWS-profile feed). Backend `GET /api/v1/alerts/nws` polls the zone feed, parses active alerts. Full IPAWS inbound = V2 (Standard Audit Surface §13); outbound origination = FEMA-authorized only (do NOT build).
- **Named K-12/venue vendors (COMING_SOON tiles, honest):** Raptor, RapidSOS, InformaCast (SingleWire), Alertus, CrisisGo — each an inbound integration; mark COMING_SOON until wired.
- **ToS/attribution:** NWS free/authoritative, no attribution burden. **Taurus/LED:** ✅ our DOM. **effort:** M (NWS CAP parser + emergency-pipeline wire) — strategic, do early despite Phase-3 grouping.

### 26. Spotify / Apple Music (now-playing) · `spotify` `apple-music` · Music · frictionTier `instant` (embed) / `business-login` (now-playing)
- **configFields (embed):** `url` (url — track/album/playlist link)
- **build (embed):** `{ widgetType:'MUSIC_PLAYER' or WEBPAGE, defaultConfig:{ embedUrl } }` — Spotify `open.spotify.com/embed/<type>/<id>`; Apple `embed.music.apple.com/…`.
- **build (now-playing card):** `{ widgetType:'LIVE_DATA', defaultConfig:{ dataUrl:'/api/v1/music/now-playing?tenant=', variant:'now-playing' } }` — album art/title/artist.
- **method/auth:** embed = no OAuth but **only 30–90s previews headless** (browser autoplay policy + auth) — **it's a display/interactive widget, NOT a background-audio engine; set that expectation.** Now-playing = Web API OAuth (per-account token + refresh). Apple = MusicKit JS + paid Apple Developer membership (more friction — defer).
- **ToS/attribution:** medium (Spotify/Apple dev terms restrict commercial/automated display + branding; read before GA). **Taurus:** ⚠ WebKit quirks with Apple embed — test on player. **effort:** M.

### 27. Slack / Microsoft Teams (comms wall) · `slack` `teams` · Comms · frictionTier `business-login`
- **configFields:** `channel` (select — after OAuth), `mode` (select — messages / announcements)
- **build:** `{ widgetType:'LIVE_DATA', defaultConfig:{ dataUrl:'/api/v1/comms/slack?channel=', variant:'message-wall' } }`
- **method/auth:** Slack app OAuth (bot token, `channels:history`) / Teams via Graph API. **Note:** Slack/Twilio were already flipped to COMING_SOON in a prior audit (task #211) — keep honest until the OAuth is genuinely wired.
- **ToS/attribution:** provider dev terms. **Taurus:** ✅ our DOM. **effort:** L (OAuth per provider).

### 28. Sports Scores (passive, league-wide) · `sports-scores` · Data · frictionTier `instant`/`business-login`
- **Distinct from** our Sprint-13 live game-presentation console — this is passive "show scores around the league" for BAR/RESTAURANT/SPORTS lobbies.
- **configFields:** `league` (select NFL/NBA/MLB/NHL/college/…), `teams` (multiselect, optional filter), `format` (select `ticker|cards`)
- **build:** `{ widgetType:'TICKER' or LIVE_DATA, defaultConfig:{ dataUrl:'/api/v1/scores?league=', variant } }`
- **method/auth:** **API-Sports (api-sports.io)** on a platform key = the only reliable+licensable option (real-time, broad). **TheSportsDB** free tier = broader leagues + logos (community, not real-time). **ESPN hidden endpoints** (`site.api.espn.com/…/scoreboard`) are free/keyless but **unofficial — can break anytime, gray-area ToS; do NOT build a paid feature on them.** Cache + graceful fallback.
- **ToS/attribution:** high (respect provider redistribution terms). **Taurus:** ✅ our DOM. **effort:** M.

### 29. Transit / Flights · `transit` `flights` · Transit · frictionTier `business-login` — **defer (vertical-driven)**
- **Traffic** = Google Maps Embed traffic layer (already covered by App 11, S).
- **Transit** = **GTFS-Realtime** (protobuf: trip updates, vehicle positions, alerts) — per-agency feed URL, sometimes a free key, agency ToS varies. Parse server-side → branded departures board (new `LIVE_DATA` variant). **L.**
- **Flights** = **paid** only — FlightAware AeroAPI (~$5/mo free credit then paid) or Aviationstack (free 100–500/mo). Branded arrivals/departures board; pass API cost as a managed line item. **L.**
- **build:** `{ widgetType:'LIVE_DATA', defaultConfig:{ dataUrl:'/api/v1/transit?feed=' , variant:'departures' } }`
- **Taurus:** ✅ our DOM. **effort:** L each — defer until a transit-hub/airport/hotel customer asks.

### 30. Digital Menu (BYO / no-POS) · `digital-menu` · Docs/Commerce · frictionTier `instant`
- Non-integrated counterpart to the existing POS menu pipeline (Square/Toast/Clover — already largely built, tasks #170/#201/#208/#224; surface those as a first-class "Digital Menu — connect POS" app too).
- **configFields:** `source` (select `manual|google-sheet`), `sheetUrl` (url — the no-code CMS path, reuses App 14 CSV fetcher), `items` (repeatable `{name,price,category,dietaryTags,photo}` for manual), `auto86` (bool)
- **build:** `{ widgetType:'LIVE_DATA' or EXTERNAL_HTML menu template, defaultConfig:{ items | dataSourceId, auto86 } }`
- **method/auth:** manual = none; Sheet = publish-to-web CSV (App 14). POS variant = existing connector registry OAuth.
- **ToS/attribution:** none. **Taurus/LED:** ✅ EXTERNAL_HTML menu boards + click-to-edit are offline-safe. **effort:** S (BYO) / M (POS surface reuse).

---

## Appendix A — Explicitly NOT standalone tiles (honesty policy)

Per synthesis §2/§7, these ship **only** via App 19 (Social Wall aggregator) or as **single-post** paste (BRING_ACCOUNT), never as auto-updating "apps" that silently break:

| Network | 2026 reality | Standalone tile? |
|---|---|---|
| Instagram | Basic Display API shut Dec 4 2024; oEmbed reviewed-token since Apr 2025; feed = Business OAuth or aggregator | ❌ → Social Wall; single-post = paste |
| X / Twitter | API pay-per-use since Feb 6 2026 (no free tier); `widgets.js` timeline intermittently blank | ❌ → Social Wall; single-tweet = "may go blank" best-effort |
| TikTok | keyless oEmbed = single video only; feed = Display API OAuth / aggregator | single-video tile OK (S); feed ❌ → Social Wall |
| LinkedIn | no company-feed embed ever; single public post only | ❌ → Social Wall (aggregator-only) |
| Threads | Meta oEmbed Read (reviewed token) — rides the IG/FB Meta app if built | bundle into Meta setup; low demand |
| Snapchat | keyless single-item embeds (Spotlight/Story/Profile/Lens); no feed | optional paste-embed tile (M, low priority) |

## Appendix B — New backend routes summary (build order)

1. `GET /api/v1/proxy/rss?url=` + wire `RSSWidget` — **gates App 5** (News). Reuse `safe-fetch.ts`.
2. `GET /api/v1/calendar/ics?url=` + wire `CalendarWidget` — **gates App 3** branded calendar (unlocks Google/Outlook/Apple).
3. `GET /api/v1/proxy/embeddable?url=` — HEAD X-Frame-Options/CSP pre-flight (App 6 guardrail, Phase-2 UX).
4. `GET /api/v1/maps/embed-url` — server-side key injection for App 11 (key never in browser).
5. `GET /api/v1/data/{crypto|fx|stocks}` — cached platform-key finance feeds (App 17).
6. `GET /api/v1/reviews?source=&id=` — Google Places / Yelp Fusion, attribution + no-cache ToS (App 20).
7. `GET /api/v1/proxy/cloud-folder?url=` — public folder → image URLs (App 13).
8. `GET /api/v1/alerts/nws?zone=` — CAP parser + emergency-pipeline wire (App 25, do early).
9. `POST /api/v1/webhook-in/:channelId` + realtime fan-out (App 23).
10. `GET /api/v1/data-sources/:id/rows` + `data_sources` table (App 22).
11. Headless auth-render engine → Supabase snapshot Asset (App 24 secure tier + snapshot-to-Asset resilience).

All fetch routes: reuse `apps/api/src/branding/safe-fetch.ts` SSRF guard, add `AbortSignal` timeout, cache last-good, never expose keys client-side.

## Appendix C — Effort roll-up

- **S (reuse widget + config form):** YouTube, Slides, Weather, Web URL, QR, Clock/Countdown/Date, Canva(embed), PowerPoint, Maps, Vimeo, Sheets(iframe), Pinterest, Bluesky, Tripadvisor, Currency, Twitch(minus parent work), Digital Menu(BYO), Secure-Dashboard(public iframe), Facebook single-post.
- **M (config + light backend/key):** Calendar(branded ICS), News(RSS route), Cloud-folder, Sheets(branded CSV), Stocks/Crypto, Facebook Page, Reviews(Google/Yelp), Social Wall(byo), Twitch(parent enum), Spotify/Apple(now-playing), Public-Alert/NWS, Webhook-in, Sports Scores.
- **L (OAuth/aggregator/headless/protobuf):** Canva Connect export, Social Wall(managed tier), Secure-Dashboard(headless auth-render), Data-Source app, Slack/Teams, Transit(GTFS-RT), Flights(paid API), snapshot-to-Asset engine.
