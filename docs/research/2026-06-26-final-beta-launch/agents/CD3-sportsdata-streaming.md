# Wave D — Sports-data + streaming reality (§6, §7)

**Auditor:** Wave-D agent CD3 (read-only). FINAL pre-launch beta audit.
**Date:** 2026-06-26
**Surface + scale tier:** Sprint-13 VenueOS Sports (live water-polo customer, first paying beta) + Sprint-8c multi-vertical streaming (gym / bar / restaurant). Scale tier: **single live customer today**, designed for fleet.
**Standard Audit Surface §§ covered:** §6 (Streaming integrations) + §7 (Sports score/data integrations). §1/§16 touched only where they intersect (HMAC feed-token auth + cue audit log).
**Method:** code-trace of `apps/api/src/streaming/**`, `apps/api/src/sports/**`, `packages/scoreboard-cts/**`, `packages/api-types/src/streaming.ts`, `apps/web/.../StreamingWidget.tsx`, `CtsBridge.tsx`, the sports game console page; ran the `@cms/scoreboard-cts` jest suite (56/56 green); curled live prod (`api-production-39a1.up.railway.app`) for endpoint existence + auth posture. NEVER touched the Dodgers tenant/game/LED.

---

## Headline

This is the **opposite of a costume surface.** The score-feed ingest is a real, HMAC-authenticated, deployed-and-verified machine-to-machine pipeline that writes `GameEvent` and auto-fires celebrations; the Daktronics + CTS serial decoders are genuine protocol parsers (414 + 524 lines, 56 passing tests); the streaming widget is a real multi-protocol renderer (hls.js + iframe). The honest "BRIDGE/PARTNER/CLOSED" tiering in the streaming catalog is exactly what the lead wants — no green "Connect" buttons that dead-end. The few gaps are **named-vendor protocol coverage** (Sportzcast/Scorebird/Genius/Sportradar/MaxPreps/GameChanger have NO dedicated parser — they work ONLY if the vendor speaks our generic JSON feed shape) and **one stale UI label**.

---

## Provider-by-provider classification table

### §7 — Sports score / data

| provider / integration | verdict | evidence (file:line / curl) | notes |
|---|---|---|---|
| **CTS System 6 / Gen 6** | **REAL** | `packages/scoreboard-cts/src/parser.ts` (524 ln) + `console-profiles.ts:120` `cts-gen6`; `CtsBridge.tsx:1-68` Web-Serial + native bridge; 56/56 jest green | Full seven-segment decoder. The live water-polo customer's console. Genuine. |
| **CTS Gen 7 (RS-232)** | **REAL** | `console-profiles.ts:132` `cts-gen7`; `gen7.ts` (362 ln) | Real framing variant. |
| **CTS Wireless Tabletop (WTTC / RS-485)** | **REAL** | `console-profiles.ts:150` `cts-wttc` baud 115200 | Real. RS-485 path. |
| **Daktronics All Sport 5000** | **REAL** ⭐ | `packages/scoreboard-cts/src/daktronics/parser.ts:1-80` "All Sport 5000 Enhanced RTD decoder" (414 ln) + `offsets.ts` (260 ln) + `daktronics.test.ts` passing; wired in `CtsBridge.tsx:61` `DaktronicsParser`; `console-profiles.ts:165` `daktronics-allsport` baud 19200 | **Task #171 ("Daktronics/Nevco RS485 dropdown is a costume") is RESOLVED — it is now a real SYN/ETB-framed, checksum-validated RTD parser.** Offsets flagged `'provisional'` (`offsets.ts:175`) pending a captured real-console RTD dump — see Finding D3. |
| **Generic external score feed** (Sportzcast box / console reader / any POST-JSON script) | **REAL** | `sports-board.controller.ts` `POST :id/feed` + `sports-feed-token.ts` (HMAC); `sports.service.ts:3042` `ingestByFeed`→`ingest({auto:true})` persists score + fires `maybeAutoCelebrate`; **live: `POST /sports/board/<uuid>/feed` → HTTP 401 with bad token (deployed, route exists, token-gated)** | The real ingest spine. Any vendor that can POST `{homeScore,awayScore,clockMs,clockRunning,segment}` with the `x-feed-token` HMAC drives a live game. Revocable per-game via `feedTokenVersion`. |
| **Sportzcast** (by name) | **DEFERRED** (works via generic feed; no dedicated parser) | named only as docs in `sports/[gameId]/page.tsx:925,940` ("Push live score from a Sportzcast box"); **no** `sportzcast`-specific parser anywhere | Works IF the Sportzcast box is configured to POST our JSON shape (it emits a generic socket feed → needs a small adapter the customer/we write). Not a costume (no fake Connect button), but not turnkey either. |
| **Scorebird** | **DEFERRED** (generic-feed only) | referenced in `sports-feed-token.ts:8` comment; no parser | Same as Sportzcast — generic feed path only. |
| **Genius Sports** | **NOT-BUILT** (honestly labeled "queued") | `test-integrations/page.tsx:98` "Daktronics / Sportzcast / Genius queued" | Cloud data API; no client. Honestly marked queued. |
| **Sportradar** | **NOT-BUILT** | no source match outside playwright/next type files | Not built, not advertised as connectable. |
| **MaxPreps** | **NOT-BUILT** | no source match | Not built, not advertised. |
| **GameChanger** | **NOT-BUILT** | `sports/[gameId]/page.tsx:3382` mention only ("GameChanger/ScoreVision" as roster-source examples) | Not built, not advertised as connectable. |
| **Game-state console publishing** (board→player broadcast) | **REAL** | `CtsBridge.tsx:11-19` POST `screens/:id/game-state` → signed-WS fan-out; `ingestCtsSnapshot` (`sports.service.ts:4738`) writes `Game.stats.cts` without clobbering operator columns | Real. The snapshot→broadcast→LED loop. |
| **Auto-celebration from score delta** | **REAL** | `sports.service.ts:3190` `maybeAutoCelebrate` + `:2360-2510` prev/post delta arithmetic; fired from feed path (`:3173`), manual-set (`:1500,1547`) and CTS (`:4988`); per-game toggle cache `:135` | Real delta detection → CUE `GameEvent`. The Sprint-13 "AUTO" trigger. |
| **CTS cue-fired audit log** | **REAL** | `sports-board.controller.ts` `POST :id/cts-cue-fired` → `recordCueFired`; rate-limited 40/10s | Forensic proof-of-play row per celebration. |

### §6 — Streaming

| provider / integration | verdict | evidence (file:line / curl) | notes |
|---|---|---|---|
| **YouTube** (public video/channel/live embed) | **REAL** | catalog `streaming.ts:263` tier DIRECT `auth:iframeOnly`; `StreamingWidget.tsx:281` `normalizeEmbedUrl` builds `/embed/`; `validateStreamUrl` `streaming.service.ts` oEmbed embeddability probe | Real iframe playback + pre-flight embeddability check. |
| **Twitch** | **REAL** | `streaming.ts:281` DIRECT; `StreamingWidget.tsx:305` `player.twitch.tv/?channel=…&parent=<host>` | Real. parent= host handled at render. |
| **Vimeo (URL paste)** | **REAL (iframe)** | `StreamingWidget.tsx:314` vimeo embed; `validateStreamUrl` vimeo oEmbed probe | Paste-a-URL path is real. |
| **Vimeo Live (OAuth connect)** | **DEFERRED** (honestly) | `streaming.ts:298-319` tier **PARTNER**, `auth:oauth2`; `streaming.service.ts:~115` `createConnection` THROWS 400 on oauth2 | OAuth connect NOT built; tile honestly says "coming soon — paste a Vimeo URL instead." Server rejects oauth2 at the API boundary (no empty PENDING rows). Correct. |
| **Public Broadcasters** (NHK/France24/DW/AlJazeera/Bloomberg/Sky/CBS) | **REAL** | `streaming.ts:245` DIRECT `auth:none`; `listPresetChannels` returns curated `PUBLIC_BROADCASTER_CHANNELS` server-side | Real, zero-auth, curated channel list. |
| **Custom HLS (.m3u8)** | **REAL** | `streaming.ts:373` DIRECT `auth:customHls`; `StreamingWidget.tsx:193` `HlsStream` (hls.js dynamic import, live tuning) | Real. The most powerful path. |
| **IPTV M3U playlist** | **REAL (renderer)** / partial | `streaming.ts:388` DIRECT; renders as HLS | Catalog + render real; multi-channel `.m3u` *file parsing* not separately verified (see Finding D4). |
| **Atmosphere TV** | **DEFERRED (BRIDGE — honest)** | `streaming.ts:137` tier BRIDGE w/ 6-step `bridgeSteps` (HDMI capture → ffmpeg → Custom HLS) | No CMS API exists; honestly a hardware-bridge workflow, not a fake Connect. |
| **DIRECTV for Business** | **DEFERRED (BRIDGE)** | `streaming.ts:162` BRIDGE + `requiresVenueLicense:true` | Honest bridge. |
| **DISH Business** | **DEFERRED (BRIDGE)** | `streaming.ts:187` BRIDGE | Honest bridge. |
| **Mood Media** | **DEFERRED (BRIDGE)** | `streaming.ts:210` BRIDGE | Honest bridge. |
| **iHeart for Business** | **DEFERRED (BRIDGE)** | `streaming.ts:348` BRIDGE (audio capture) | Honest bridge. |
| **Soundtrack Your Brand** | **DEFERRED (PARTNER — honest)** | `streaming.ts:323-347` PARTNER `auth:oauth2`; createConnection THROWS 400 | OAuth not built; honestly "contact sales." Correct. |
| **HLS in player** | **REAL** | `StreamingWidget.tsx:193-264` native HLS (Safari) + hls.js polyfill, fatal-error surface, Chromium<51 friendly fallback (`:109`) | Real. |
| **MPEG-DASH (.mpd) in player** | **NOT-BUILT (honest)** | `StreamingWidget.tsx:151` + `streaming.service.ts` validate → "use HLS instead" | No DASH renderer bundled; honest message, not a black box. Correct. |
| **RTMP / RTSP in player** | **NOT-BUILT (honest placeholder)** | `StreamingWidget.tsx:136` "RTMP / RTSP requires a server-side transcode" | Honest limitation surface, not a costume. No server transcode gateway exists. |
| **RTSP camera feed widget** (§6 V2 Responder Bridge) | **NOT-BUILT** | only the RTMP/RTSP placeholder above; no camera widget in `WidgetRenderer.tsx` | V2 item; not advertised. |
| **Webcam URL widget** | **PARTIAL (via WEBPAGE/iframe)** | `WidgetRenderer.tsx:482` `WEBPAGE` iframe; no dedicated webcam widget | A public webcam page can be iframed; no first-class widget. |
| **NFHS Network broadcast overlay** | **NOT-BUILT as integration / REAL as generic OBS surface** | `overlay/[gameId]/page.tsx:20` + `SurfacePreview.tsx:192` mention NFHS/Hudl as *consumers* of the generic scorebug/overlay route | We expose a 1080p/4K scorebug + transparent overlay route any broadcaster (NFHS/Hudl/OBS) can pull as a source. There is NO NFHS-Network-specific API integration — and none is claimed. |
| **Embedded YouTube/Twitch/Facebook Live** | **REAL (YT/Twitch)** / **NOT-BUILT (Facebook Live)** | YT+Twitch real (above); no `facebook`/`fb.watch` embed branch in `normalizeEmbedUrl` | Facebook Live falls through to the generic iframe path — works only if the operator pastes a fully-formed FB embed URL. Not first-classed. |

---

## Findings table

| # | Sev | area | what | repro | evidence |
|---|---|---|---|---|---|
| D1 | **P2** | §7 UI honesty | Sports-data integration row label is **stale**: says "Daktronics … queued" but Daktronics is now a real shipped parser. Risks under-selling a built feature + confusing the operator. | Read the Sports-data row in Settings → Test Integrations | `test-integrations/page.tsx:98` "Sport Engine (manual entry today) — Daktronics / Sportzcast / Genius queued." vs real `packages/scoreboard-cts/src/daktronics/parser.ts` |
| D2 | **P2** | §6 streaming dead-comment | `streaming.ts:16` + `streaming.service.ts` reference per-provider handlers at `apps/api/src/streaming/providers/<id>.ts` — **that directory does not exist.** Misleads the next dev into thinking a handler layer exists. No runtime impact (all providers resolve via the catalog + widget). | `ls apps/api/src/streaming/providers` → no such dir | `streaming.ts:16-17`; `streaming.service.ts:106` comment "per-provider handlers can do deeper validation in a future commit" |
| D3 | **P2** | §7 Daktronics fidelity | Daktronics RTD field offsets are flagged **`'provisional'`** — derived from docs, not a captured real All Sport 5000 RTD dump. A real Daktronics customer could see mis-sliced fields (score in wrong cell) until offsets are field-verified. | Read offsets confidence flag | `packages/scoreboard-cts/src/daktronics/offsets.ts:175` "'provisional' until a captured RTD" |
| D4 | **P2** | §6 IPTV M3U | `iptv-m3u` provider advertises "Upload a .m3u/.m3u8 playlist (multi-channel)" but I found no server-side **multi-channel M3U *parser*** that splits a playlist into per-channel `StreamChannel` rows — it appears to render as a single HLS URL. Single-stream works; the multi-channel promise is unverified. | Trace `iptv-m3u` from catalog to a channel-splitting parser → none found | `streaming.ts:388` blurb "multi-channel IPTV" vs no `.m3u` parser in `streaming.service.ts` |
| D5 | **P2** | §6 Facebook Live | Catalog/marketing implies broad live-platform support; Facebook Live has no embed branch — silently falls to generic iframe. Operator pasting a normal FB watch URL gets no normalization and likely a broken embed. | Paste an `fb.watch/...` URL into a streaming channel | `StreamingWidget.tsx:281-321` `normalizeEmbedUrl` handles YT/Twitch/Vimeo only |
| D6 | **P2** | §7 feed UX (concierge gap) | The generic feed is powerful but **operator-hostile for named vendors**: there is no "I have a Sportzcast — set it up for me" wizard. The operator must hand a curl URL+token to their feed vendor and trust the vendor emits our exact JSON shape. No adapter, no field-mapping UI. Real but not "the app almost does it for them." | Open Setup → External score feed → only "Copy feed URL" | `sports/[gameId]/page.tsx:934-960`; no per-vendor adapter |

**No P0 or P1 findings.** Nothing here is a costume, nothing is broken end-to-end, nothing falsely claims to work. All six findings are honesty/polish/fidelity (P2).

---

## Coverage — what I could NOT reach + why

- **Live authed streaming catalog JSON** — `/streaming/providers` is auth-gated (curl → 401). Verified the catalog by reading the source-of-truth `packages/api-types/src/streaming.ts` instead (it is the single source both API + web read).
- **A live score-feed end-to-end push** — would require minting a real feed token against a real game on a real tenant; out of scope (no throwaway sports tenant created, and I must never touch Dodgers). Mitigated: verified the route exists + rejects bad tokens on prod (401), and traced the full `feed → ingest → GameEvent → maybeAutoCelebrate` chain in source + the 56-test parser suite.
- **Daktronics offset correctness against a physical console** — cannot verify without hardware; flagged as D3 (provisional).
- **`.m3u` multi-channel parsing** — traced source; found no splitter, flagged D4. Could be in an unread helper, so marked P2 "unverified" not "broken."

---

## Grade — Greg's 3 lenses

| Lens | Grade | Rationale |
|---|---|---|
| **DESIGN** | **A−** | Streaming catalog tiering (DIRECT/PARTNER/BRIDGE) with bridge-step hardware shopping lists is genuinely premium + honest. Sports console feed UX is clean. −for the stale "queued" label + the bare curl-string handoff for feeds. |
| **UX** | **B** | Self-serve for YouTube/Twitch/Public-Broadcasters/Custom-HLS is one-paste-and-done. But the named-vendor sports-data path (Sportzcast etc.) fails the 30-second / no-IT-guy bar — it hands the operator a raw curl URL and assumes their vendor speaks our JSON. No Integration-Concierge "describe your scoreboard → we wire it." |
| **FUNCTIONALITY** | **A−** | The hard part is REAL and deployed: HMAC feed ingest (401-verified on prod), genuine CTS + Daktronics serial decoders (56 tests green), auto-celebration delta, multi-protocol HLS/iframe renderer. −for DASH/RTSP/RTMP not built (but honestly surfaced) and Daktronics offsets provisional. |

**Bottom line for the lead:** the water-polo customer's score path is real, signed, deployed, and tested — this is NOT the costume surface the audit hunts for. The only "honest costume risk" is the named-vendor dropdown framing in marketing copy vs. the generic-feed reality, plus one stale label. Ship-blocking: none.
