# Integration Re-Verify — §6 Streaming · §7 Sports-Data

> Opus 4.8 read-only re-verify, 2026-05-28 (Wave 3), at master a3f8533. Baseline
> (06-08) re-checked; 3 material changes found. Verdict: WORKS/PARTIAL/COSTUME/NOT-BUILT.

## Bottom line
Spine is real + honest where it counts (CTS Gen6, the multi-protocol streaming widget,
auto-celebration, the honesty dashboard). Problems: (a) **breadth** — every *named* vendor
feed is COMING_SOON, no `ScoreSource` adapters exist; (b) **2 genuine costumes the honesty
pass missed**; (c) a **working feature stranded behind an unrendered button**.

## §6 Streaming
| Integration | Verdict | Evidence |
|---|---|---|
| YouTube / Twitch / Custom-HLS / Public-Broadcasters (1-click) | **WORKS** | `StreamingWidget.tsx:178-340`; `streaming.service.ts:52-67,440-460` |
| FitnessLiveTV — HLS/iframe/YouTube-Live | **WORKS** | `FitnessLiveTVWidget.tsx:226-289`; real SSRF-safe resolver `youtube-live.controller.ts:60-111`. ⚠️ uses `4cqh/cqh` (`:495,498,528`) — verify Chromium-83 Taurus (polyfill should cover) |
| FitnessLiveTV FAST catalog (Xumo, 20 real) | **PARTIAL/dead-config** | real `content.xumo.com` URLs `fastChannelCatalogs.ts:143-162` but **no UI sets provider+channelId** — unreachable |
| FitnessLiveTV FAST (Pluto/Samsung/Tubi/Roku/LG, 60) | **COSTUME** | **60 literal `hlsUrl:'https://TODO-provider-hls-url/…'`** `:117-136,172-198`, all `placeholder:true` |
| DASH (.mpd) | **PARTIAL (silent fail)** | `StreamingWidget.tsx:264` `import('dashjs')` — **dashjs not in any package.json** |
| Vimeo Live (connect) | **COSTUME (soft)** | catalog `streaming.ts:298` green "Self-serve" badge but `auth:'oauth2'` rejected `streaming.service.ts:121-123`; Connect disabled. (Pasting a Vimeo URL via custom-hls DOES work) |
| Soundtrack Your Brand | **NOT-BUILT (honest)** | `streaming/page.tsx:226-234` "COMING SOON — contact sales" |
| Atmosphere/DIRECTV/DISH/Mood/iHeart | **NOT-BUILT (honest BRIDGE)** | `streaming.ts:137-230` BRIDGE, honest HDMI-capture wizard |
| IPTV .m3u | **PARTIAL** | no playlist parser, only single .m3u8 |
| RTSP/RTMP camera | **COSTUME** | `StreamingWidget.tsx:134-144` "requires server transcode" placeholder, no transcoder |
| **Traffic-camera widget** | **COSTUME (worst)** | `LiveDataWidgets.tsx:477-516` renders hardcoded gradient tiles + fake "Updated 30s ago · via DOT cameras" — NO real feed, NO honesty badge, droppable on canvas |
| NFHS overlay / IP-cam responder links | **NOT-BUILT** | V2 |

Backend fact: NO `apps/api/src/streaming/providers/` dir exists — every provider flows through generic paths (`none`/`iframeOnly`/`customHls` auto-ACTIVE) or is rejected (oauth2/CLOSED).

## §7 Sports-Data
| Integration | Verdict | Evidence |
|---|---|---|
| **CTS Gen 6 console** | **WORKS (gold standard)** | RS232 7-seg decoder `packages/scoreboard-cts/src/parser.ts:52-288`; Web-Serial+APK bridge `CtsBridge.tsx:71-168`; HMAC POST `sports-board.controller.ts:123-170`; persists `sports.service.ts:3799`; board polls `:314-371` |
| Generic external `/feed` (JSON) | **WORKS backend / UNREACHABLE UI** | `sports-board.controller.ts:172-208` + `sports.controller.ts:458-490`. **`copyFeedUrl` `[schoolId]/sports/[gameId]/page.tsx:374` is NEVER bound to onClick** (grep → 0 hits) — operator can't get their token |
| Auto-celebration from score delta | **WORKS** | `sports.service.ts:2611-2704` delta→CUE→AuditLog→board |
| CTS simulator | **WORKS (honest dev tool)** | `super/cts-simulator` SUPER_ADMIN-only, not sold as integration |
| Manual scoring / sponsor proof-of-play | **WORKS** | guarded routes; reuses AuditLog |
| **Daktronics/Nevco RS485** | **NOT-BUILT (honest — FIXED since baseline)** | baseline #2 P0 GONE: `WiringPanel.tsx:71-91,240-277` honest "Coming soon" panel, player never reads `wiring.rs485` |
| Sportzcast/Scorebird, Genius/Sportradar, MaxPreps, GameChanger | **NOT-BUILT (honest)** | `integrations-health.controller.ts:823-853` COMING_SOON |
| `ScoreSource` abstraction | **DOES-NOT-EXIST** | only a string in COMING_SOON msgs; reality = 2 endpoints (`/feed`, `/cts-snapshot`) |

## Costumes ranked by customer visibility
1. **Traffic-camera widget** (`LiveDataWidgets.tsx:477-516`) — fully-rendered fake "live" DOT-camera tiles, no honesty badge, droppable. **Highest.**
2. **60 TODO-URL FAST channels** (`fastChannelCatalogs.ts`) — CNN/NFL Network/NBA TV… resolving to `https://TODO-provider-hls-url`. Mitigated by `placeholder:true` + UI-unreachable.
3. **Vimeo "Self-serve" badge** (`streaming.ts:298`) — over-promises; Connect dead-ends (modal honest once opened).
4. RTSP/RTMP placeholder — honest-ish but never plays (no transcoder).
5. DASH `.mpd` — silent fail (dashjs unbundled).

## ACTIONABLE FIX LIST
1. **Traffic-camera widget** — it's fake "live" data. Either gate behind an honest "Sample data" badge like other demo widgets, or remove it from the palette. (`LiveDataWidgets.tsx:477-516`)
2. **Wire `copyFeedUrl`** onClick on the game console (`[schoolId]/sports/[gameId]/page.tsx:374`) — ~1 line; unstrands the only way to get a feed token. Highest-leverage sports-data fix.
3. **Delete the 60 `TODO-provider-hls-url` FAST entries** (`fastChannelCatalogs.ts:117-136,172-198`) — keep the 20 real Xumo; or wire a UI to reach them.
4. **Vimeo** — drop the green "Self-serve" badge → "Coming soon"/BRIDGE honest label (`streaming.ts:298`).
5. **DASH** — remove `.mpd` from the picker (silent fail) OR bundle `dashjs`.
6. Verify FitnessLiveTV `cqh` units render on Taurus (polyfill should cover; confirm).

Net: streaming = 5 real paths + an excellent widget; sports-data = CTS (gold) + auto-celebration + a UI-stranded generic feed. Breadth (named vendors all COMING_SOON) + 2 costumes + 1 stranded button.
