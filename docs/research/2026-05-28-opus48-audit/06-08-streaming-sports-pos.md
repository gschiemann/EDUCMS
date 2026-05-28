# INTEGRATION REALITY AUDIT — §6 Streaming / §7 Sports-Data / §8 POS

> Opus 4.8 full-app audit, 2026-05-28. Read-only. Bar = the CTS water-polo path
> (verified 9/9 against prod): a real parser → an authenticated ingest endpoint →
> data reaching a rendering surface.

## PAGE 1 — COVERAGE TABLE (D / UX / F)

| § | Domain | DESIGN | UX | FUNCTIONALITY | One-line truth |
|---|---|---|---|---|---|
| **6** | Streaming | B+ | B | **C+** | YouTube/Twitch/Vimeo/HLS/DASH render for real; "providers" catalog is mostly labels — 5 of 12 are BRIDGE (you supply a capture card), satellite/Atmosphere/music-streaming are costumes. RTSP camera + NFHS overlay + responder share-links NOT built. |
| **7** | Sports-data | A- | B+ | **B** | CTS Gen 6 fully real (parser + HMAC ingest + render + auto-celebrate). Generic `/feed` ingest works for ANY HTTP pusher. BUT every *named* feed (Daktronics, Sportzcast, Genius, MaxPreps, GameChanger) is COMING_SOON or a dead dropdown — zero vendor-specific adapters. |
| **8** | POS | B+ | B | **C** | Square is genuinely end-to-end (OAuth→catalog→webhook→MenuBoardWidget). Toast/Clover/Lightspeed/Shopify/Stripe/MINDBODY are NOT-STARTED behind real-looking Connect buttons. The `custom-webhook` provider tells you to POST to an endpoint **that doesn't exist**. |

**How many integrations are real:** Of ~30 provider entries a customer can click
across these 3 surfaces, **exactly 3 are genuinely wired end-to-end to a live
third party: Square (POS), CTS Gen 6 (sports console), and the embed/HLS
streaming widget** (YouTube/Twitch/Vimeo/raw m3u8). Plus the generic sports
`/feed` HTTP ingest and `house-only` ads. **Everything else is a label, a
dropdown, or a "Coming Soon" — many wearing real-button costumes.**

---

## §6 STREAMING — per-integration verdict

| Integration | Parser? | Connect? | Reaches surface? | VERDICT | Evidence |
|---|---|---|---|---|---|
| YouTube Live (embed) | ✅ | ✅ paste URL | ✅ `StreamingWidget` iframe | **WORKS** | `StreamingWidget.tsx:313-331`; `WidgetRenderer.tsx:443` |
| Twitch (embed) | ✅ `parent=` | ✅ | ✅ | **WORKS** | `StreamingWidget.tsx:333-340` |
| Vimeo Live | ✅ embed+oEmbed | ✅ | ✅ | **WORKS** | `StreamingWidget.tsx:342-346`; `streaming.service.ts:405` |
| Custom HLS (m3u8) | ✅ hls.js | ✅ `custom-hls` | ✅ `<video>`+hls.js | **WORKS** | `StreamingWidget.tsx:178-249` |
| DASH (mpd) | ⚠️ dynamic `import('dashjs')` | ✅ | ⚠️ **dashjs not in deps** | **PARTIAL** | `StreamingWidget.tsx:264` throws "install dash.js"; pkg absent |
| Public Broadcasters | ✅ curated list | ✅ sample-data | ✅ | **WORKS** | `streaming.service.ts:52-67` |
| IPTV m3u | ❌ no playlist parser | ⚠️ row only | ⚠️ only direct m3u8 | **PARTIAL** | `streaming.ts:373` |
| Atmosphere TV | ❌ | ❌ "bring capture card→ffmpeg→HLS" | via Custom HLS only | **COSTUME** | `integrations-health.controller.ts:438-457`; `streaming.ts:138` |
| DIRECTV / DISH Business | ❌ | ❌ hardware bridge | via Custom HLS | **COSTUME** | `streaming.ts:163,188` |
| Mood Media / iHeart | ❌ | ❌ bridge | no | **COSTUME** | `streaming.ts:211,334` |
| Soundtrack Your Brand | ❌ | ❌ | no | **NOT-STARTED** | `streaming.ts:317` |
| RTSP camera widget | ❌ "needs transcode" card | ❌ | ❌ | **COSTUME** | `StreamingWidget.tsx:134-144` |
| NFHS Network overlay | ❌ | ❌ | ⚠️ scorebug exists, no transparent mode | **NOT-STARTED** | no nfhs/chroma code |
| IP-cam RTSP responder links | ❌ | ❌ | ❌ | **NOT-STARTED (V2)** | no rtsp/responder code |

**Truth:** the *widget* is real and good (multi-protocol, capability-aware codec
selection, ad overlay, Chromium-83 fallback). The *provider catalog* oversells:
the model is "operator pastes a URL," not "we connect to a provider" — fine/honest
for YouTube/HLS, dishonest for DIRECTV/Atmosphere/Soundtrack tiles that imply a connector.

---

## §7 SPORTS-DATA — per-integration verdict

| Integration | Parser? | Ingest? | Reaches surface? | VERDICT | Evidence |
|---|---|---|---|---|---|
| **CTS Gen 6 console** | ✅ real RS232 decoder | ✅ `POST board/:id/cts-snapshot` (HMAC) + `POST screens/:id/game-state` (device-signed→pub/sub) | ✅ getBoard→scene/ribbon | **WORKS** | `scoreboard-cts/src/parser.ts:73-288`; `sports-board.controller.ts:123`; `screens.controller.ts:1637` |
| Generic machine `/feed` | n/a (JSON) | ✅ `POST board/:id/feed` (HMAC) | ✅ board+auto-celebrate | **WORKS** | `sports-board.controller.ts:172`; `sports.service.ts:2482` |
| Auto-celebration from delta | ✅ delta→autoPoints | (via /feed) | ✅ fires CUE | **WORKS** | `sports.service.ts:2620-2700` |
| Manual phone/launchpad | ✅ | ✅ 50+ guarded routes | ✅ | **WORKS** | `sports.controller.ts:204-987` |
| Sponsor proof-of-play | ✅ | ✅ /impression + /sponsor-report | ✅ | **WORKS** | `sponsors.controller.ts:50,71` |
| **Daktronics All Sport** | ❌ NO parser | ❌ RS485 dropdown nothing reads | ❌ | **COSTUME** | `WiringPanel.tsx:71-75`; CtsBridge reads only `rs232_*` (`CtsBridge.tsx:364`) |
| Nevco | ❌ | ❌ dead dropdown | ❌ | **COSTUME** | `WiringPanel.tsx:73` |
| Sportzcast / Scorebird | ❌ adapter | ⚠️ could use /feed, no box shipped | n/a | **COSTUME (named)** | `integrations-health.controller.ts:815` |
| Genius / Sportradar | ❌ | ❌ | ❌ | **NOT-STARTED** | `:824` |
| MaxPreps | ❌ | ❌ | ❌ | **NOT-STARTED** | `:833` |
| GameChanger | ❌ | ❌ | ❌ | **NOT-STARTED** | `:842` |

**Truth:** CTS is the gold standard, genuine. The generic `/feed` HMAC ingest is a
real, undersold asset — a school's Sportzcast box could push to it today with a
tiny script and auto-celebration would fire. The lie is the **WiringPanel
"Daktronics All Sport / Nevco" RS485 dropdown**: persists to
`Screen.config.wiring.rs485` and the player **never consumes it**. Exactly Greg's
"real-button costume."

---

## §8 POS / COMMERCE — per-integration verdict

| Integration | Sync? | Connect? | Reaches surface? | VERDICT | Evidence |
|---|---|---|---|---|---|
| **Square POS** | ✅ real HTTP to connect.squareup.com | ✅ OAuth + HMAC webhook + hourly cron | ✅ `PosMenuItem`→`/pos/items`→`MenuBoardWidget` | **WORKS** | `pos/providers/square.ts:203`; `pos.service.ts:321`; `MenuBoardWidget.tsx:274-294` |
| Sample catalog | ✅ seeds rows | ✅ /sample-data/pos | ✅ | **WORKS (demo)** | `sample-data.controller.ts:226,332` |
| `custom-webhook` | ❌ no receiver | ❌ **UI says POST `/api/v1/pos/webhook/{id}` — DOES NOT EXIST** | only via sample | **COSTUME** | `settings/pos/page.tsx:332`; only `webhook/square` exists (`pos-oauth.controller.ts:173`) |
| Toast | ❌ | ⚠️ "not yet implemented" | ❌ | **NOT-STARTED** | `pos.service.ts:100-106` |
| Clover | ❌ "not yet implemented" | ⚠️ apiKey saves, never syncs | ❌ | **NOT-STARTED** | `pos.service.ts:235-238`; `pos.ts:125` marked DIRECT(!) |
| Lightspeed | ❌ | ⚠️ oauth2 rejected | ❌ | **NOT-STARTED** | `pos.ts:162` |
| Shopify POS | ❌ | ⚠️ rejected | ❌ | **NOT-STARTED** | `pos.ts:177` |
| Stripe catalog | ❌ | ⚠️ apiKey saves, no sync | ❌ | **NOT-STARTED** | `pos.ts:194` |
| MINDBODY | ❌ | ⚠️ rejected | ❌ | **NOT-STARTED** | `pos.ts:211` |
| Aloha/NCR | ❌ | ❌ CLOSED (honest) | ❌ | **N-A (honest)** | `pos.ts:140` throws Forbidden |
| Promo/happy-hour dayparting | ❌ | ❌ | ❌ | **NOT-STARTED** | no time-window logic |

**Truth:** Square is legitimately complete + production-grade (OAuth CSRF state,
token refresh, SHA256+SHA1 webhook verify, idempotency table, audit log, render).
It's the **only** real one. Clover is marked `DIRECT` with zero sync handler. The
`custom-webhook` "bring your own POS" escape hatch **points at a 404.** For a
product that wants to lead QSR, 1 of 7 POS providers functional is the headline gap.

---

## COMPETITIVE GAPS

**Streaming (vs Yodeck/OptiSigns/ScreenCloud):** Atmosphere TV native (HIGH for
bars/QSR — competitors ship it, we require ffmpeg bridge); IPTV `.m3u` channel
expansion; dash.js not bundled (DASH silently fails); YouTube/Vimeo OAuth picker.

**Sports (vs Daktronics/ScoreVision):** Daktronics All Sport tap-off (HIGH — every
HS gym already has one; we have a dropdown with no decoder); league stat feeds;
documented Sportzcast recipe for the existing /feed.

**POS (vs Yodeck/OptiSigns):** Toast & Clover (the two biggest QSR POS after
Square — neither works); working BYO webhook (currently 404); dayparting/happy-hour
menu auto-swap.

---

## TOP 10 RANKED FIXES

1. **[P0 — pure lie] Build `POST /api/v1/pos/webhook/:providerId`** the
   `custom-webhook` UI already advertises (`settings/pos/page.tsx:332`). Verify
   `X-Webhook-Secret`, upsert `PosMenuItem`. Turns "0 working BYO-POS" into "any
   POS that can POST JSON works." ~1 day.
2. **[P0 — pure lie] Remove or wire the Daktronics/Nevco RS485 dropdown**
   (`WiringPanel.tsx:71-75`). Either hide until a decoder exists (1 hr) or build a
   Daktronics All Sport serial decoder sibling in `packages/scoreboard-cts/` and
   route `rs485` to it (~1-2 wk). Greg cited this exact costume class.
3. **[P0] Stop marking Clover `DIRECT`** (`pos.ts:128`) when it has no sync handler
   — worst lie (looks ready, connects, never syncs). Build the handler or downgrade
   to PARTNER with honest "contact sales."
4. **[P1] Build the Toast POS handler** (`pos/providers/toast.ts` + OAuth) — #2 QSR
   POS, directly serves QSR ambition. Mirror the Square scaffold.
5. **[P1] Bundle `dashjs` or remove DASH from the picker** (`StreamingWidget.tsx:264`).
6. **[P1] Ship a documented Sportzcast/Scorebird recipe** for the existing `/feed`
   (already works + auto-celebrates). Docs + the existing `/feed-credentials` copy
   button reframes a COMING_SOON as WORKS-today. Near-zero code.
7. **[P1] Atmosphere TV** — highest-leverage streaming gap for bars/QSR. Real
   partner integration or guided EP6N HDMI-IN capture path.
8. **[P2] IPTV `.m3u` playlist expansion** into individual channel rows.
9. **[P2] Menu dayparting** — `availableFrom`/`availableTo` + day-of-week on
   `PosMenuItem`, filter in `MenuBoardWidget`. Unlocks happy-hour auto-swap.
10. **[P2] Honesty pass on the connect wizards** — `integrations-health.controller.ts`
    already distinguishes READY/DEGRADED/COMING_SOON; propagate that into
    `settings/pos` + `settings/streaming` so a bridge/degraded provider doesn't show
    an identical "Connect" button to a working one. Greg's core complaint.

---

## GOOD NEWS (don't regress)
- `integrations-health.controller.ts` is genuinely honest (READY/DEGRADED/
  COMING_SOON with reasons, hides Coming-Soon from non-super-admins). The
  dishonesty is downstream in the connect *wizards*, not this dashboard.
- Square + CTS + streaming widget + generic `/feed` + auto-celebrate + sponsor
  proof-of-play are real, audited, signed, reach a surface. Solid spine — problem
  is breadth (1 POS, 1 console, paste-only streaming), not a rotten core.
- The team already removed a bogus "Stream Deck" RS232 option with an honest
  comment (`WiringPanel.tsx:58-65`) — proof they self-correct costumes when caught.
