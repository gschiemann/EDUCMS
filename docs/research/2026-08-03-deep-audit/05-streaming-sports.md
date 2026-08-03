# §6 Streaming + §7 Sports audit — 2026-08-03

Scope: Standard Audit Surface §6 (Streaming integrations) and §7 (Sports score / data integrations). Read-only. All other sections explicitly **out of scope** (not covered here).

## Coverage table

| # | Bullet | Status | D | UX | F | Note |
|---|---|---|---|---|---|---|
| 6.1 | RTSP camera widgets (V2 Responder Bridge) | N-A (not built) | – | B | – | Only a `StreamPlaybackKind` union member + honest "needs server transcode" placeholder (`StreamingWidget.tsx:80,136-146`). No provider in `STREAM_PROVIDERS` declares `playback:'rtsp'`. |
| 6.2 | HLS / DASH / M3U8 in the player | Covered (HLS real; DASH refused) | B | B | B | `hls.js ^1.6.16` bundled + lazily imported (`StreamingWidget.tsx:212`); Safari native path at `:205`. DASH honestly refused at `:151`. `dashjs ^5.1.1` is an **unused** dependency. |
| 6.2b | APK WebView HLS support | Covered | – | – | B | APK sets `mediaPlaybackRequiresUserGesture = false` (`MainActivity.kt:999,1484`). Chromium <51 gets an honest hardware-upgrade card (`StreamingWidget.tsx:109-122`). |
| 6.3 | YouTube / Twitch / Vimeo embeds | Covered | B | A– | B+ | Host-allowlisted since INJ-006 (`StreamingWidget.tsx:342-423`). Server-side embeddability probe (Error-153 pre-check) at `streaming.service.ts:354-519`. |
| 6.3b | Facebook Live / Periscope | N-A | – | C | – | Single catalog row `status:'COMING'` (`fitnessSourceCatalog.ts:287`). No code. COSTUME-but-labelled. |
| 6.4 | NFHS Network broadcast overlay | N-A (COMING_SOON) | – | B | – | Honest row in `discovery.service.ts:331-341` + `integrations-health.controller.ts`. The only real NFHS path is HDMI-in on the hardware (`api-types/src/hardware.ts:232`). |
| 6.5 | Webcam URL widget | N-A (not built) | – | – | – | Two methods (grep + `git grep`) return only a code comment at `player/page.tsx:918`. |
| 6.6 | Streaming assets in playlists / infinite duration | PARTIAL | C | C | C | Streams are a template **zone widget**, never an `Asset`. An infinite live stream is simply cut at the playlist item's `durationMs` — no "play until next" semantics. |
| 6.7 | IP-camera RTSP share-links for responders | N-A (not built) | – | – | – | Same absence evidence as 6.1. |
| 6.8 | CSP / frame-ancestors | Covered | – | – | B | `frame-ancestors 'self'` app-wide (`next.config.ts:131`); player content CSP is **report-only** (`:146,154`) with `frame-src 'self' <api> https:` (`:70`). |
| 6.9 | Autoplay + muted on kiosk | Covered | – | A | A | `muted ?? true`, `autoPlay playsInline` everywhere + APK gesture flag off. |
| 6.10 | Stream-drop / reconnect behaviour | **GAP** | D | D | D | See F-3. No hls.js recovery in either HLS widget. |
| 6.11 | Offline / no-network behaviour | Covered (degraded) | C | B | C | Live streams inherently uncacheable; both widgets show an honest error/placeholder rather than a black box. |
| 7.1 | Daktronics All Sport tap-off | Covered (PROVISIONAL) | B | B | C+ | Real decoder `scoreboard-cts/src/daktronics/*`, real profile, but `status:'provisional'` — offsets from third-party RE tables, never validated on hardware (`console-profiles.ts:163-175`). |
| 7.2 | Sportzcast / Scorebird | COSTUME as named vendor; generic path REAL | – | B | C | `POST /sports/board/:id/feed` (`sports-board.controller.ts:323-362`) + HMAC feed token is a genuine BYO-push surface. No vendor-specific code. |
| 7.3 | Genius Sports / Sportradar | COSTUME (honest COMING_SOON) | – | B | – | `integrations-health.controller.ts:866-872` only. |
| 7.4 | MaxPreps | COSTUME (honest COMING_SOON) | – | B | – | `discovery.service.ts:500-509`, `integrations-health.controller.ts:874-882`. |
| 7.5 | GameChanger | COSTUME (honest COMING_SOON) | – | B | – | `integrations-health.controller.ts:883-891`. |
| 7.6 | Game-state console publishing | Covered | B | B | A– | `POST /screens/:id/game-state` (legacy WS) + `POST /sports/board/:id/cts-snapshot` (persistent). |
| 7.7 | Auto-celebration from score delta | Covered | A– | B+ | A– | `sports.service.ts:3819-3960` incl. a celebration mutex + per-game enable cache; audit rows via `POST board/:id/cts-cue-fired`. |
| 7.8 | Per-sport widget/clock parity | Covered | B+ | B | B+ | 19 sports in the picker (`sports.ts:1288-1292`) + 1 deprecated alias. See §Per-sport below. |
| 7.9 | CTS bridge — real or scaffold? | **REAL** | B | C+ | B | See table below. |
| 7.10 | Scoreboard manifest bypasses hot cache | Confirmed, load OK | – | – | A– | `screens.controller.ts:3492-3543` returns before `getManifestCache` at `:3558`. Cost = 1 extra `game.findFirst` + synthetic build per ~30 s poll. ETag/304 still applies (`:3536-3539`). |
| 7.11 | Clock authority / shot clock slaved | Covered | – | B | A– | Server stores an anchor, never ticks; 1 s sweep with idle-skip (`clock-advance.service.ts`). Shot clock derives `running` from the game clock (`CtsBridge.tsx:1015-1020`; `sports.service.ts:2130-2180`). |
| 7.12 | Multi-screen scoreboard consistency | Covered (eventual, ~1.7 s worst case) | – | B | B– | board/ribbon/scorebug all poll the same endpoint at `POLL_MS = 750` and project the clock locally; server memoises 1 s (`sports.service.ts:570`). **Not** frame-locked — the scoreboard manifest branch emits no `sync` block (only the playlist branch at `screens.controller.ts:3894`). Clock stays exact (anchored); a *score* can differ across surfaces for ≤1.75 s. |

## Integration reality table

| Integration | Config / auth | Fetch / transport | Renders where | Verdict | Evidence |
|---|---|---|---|---|---|
| Custom HLS | `auth:'customHls'`, `playbackUrl` | `hls.js` MSE / Safari native | `StreamingWidget` in any template zone | **REAL** | `streaming.ts:372-386`; `StreamingWidget.tsx:193-263` |
| YouTube / Twitch / Vimeo | `iframeOnly`, URL paste | allowlisted `https` iframe, `allow-scripts allow-same-origin allow-presentation` | `StreamingWidget` | **REAL** | `StreamingWidget.tsx:295-329,362-423` |
| Public Broadcasters (NHK/F24/DW/AJ/Bloomberg/Sky/CBS) | `auth:'none'`, one-click seed | curated in-code list → embed/HLS | `StreamingWidget` | **REAL** | `streaming.service.ts:80-95`; seed `sample-data.controller.ts:112-160` |
| Atmosphere / DIRECTV / DISH / Mood / iHeart | `customHls` + documented HDMI-capture `bridgeSteps` | operator's own local HLS | `StreamingWidget` | **REAL (bridge)** — honest, not a costume | `streaming.ts:137-230,348-369` |
| Vimeo Live (OAuth), Soundtrack | `oauth2` | **none** — `createConnection` throws 400 | – | **COSTUME, correctly labelled PARTNER** | `streaming.service.ts:149-151`; `streaming.ts:301-319,326-347` |
| IPTV M3U Playlist | `customHls`, tier **DIRECT** | **no M3U parser, no file upload** | – | **COSTUME** (mislabelled DIRECT) | `streaming.ts:387-401`; two-method absence: no `EXTINF`/`EXTM3U`/`parseM3u` anywhere |
| Pluto TV / Xumo (fitness) | channel-picker | bundled public HLS URLs → `<video>` | `FitnessLiveTVWidget` | **REAL playback**, licensing contested — see F-4 | `fastChannelCatalogs.ts:1-60`; `fitnessSourceCatalog.ts:117-137` |
| Samsung TV+ / Tubi / Roku / LG | info-only field | none | – | COSTUME, honestly labelled PARTNER | `fitnessSourceCatalog.ts:126-163` |
| CTS Gen6 / Gen7 (RS-232) | `?consoleProfile=` or `Screen.config.consoleProfile` | Web Serial **or** APK `/dev/ttyS1` via `SerialPortBridge` | `/board`, `/ribbon`, `/scorebug`, CTS ribbon widgets | **REAL** | `CtsBridge.tsx:801-846`; `SerialPortBridge.kt`; `MainActivity.kt:1405`; `console-profiles.ts:118-146` |
| CTS WTTC (Gen7/WA-2 RS-485) | profile `cts-wttc` | FTDI → `/dev/ttyUSB0` | same | **REAL but PROVISIONAL** | `console-profiles.ts:147-160` |
| Daktronics All Sport 5000 | profile `daktronics-allsport`, `?dakSport=` | 19200/8/N/1 → `DaktronicsParser` | same | **REAL but PROVISIONAL** | `console-profiles.ts:161-176`; `daktronics/offsets.ts` |
| CTS swim timing | `POST board/:id/swim-timing-snapshot` | pure normaliser → `Game.stats.results` | `SWIM_LANE_GRID`, `SWIM_SPLITS_PANEL` | **REAL** | `swim-timing-feed.ts`; `sports-board.controller.ts:294` |
| Elgato Stream Deck (RS-232 line cues) | `Screen.config.wiring.rs232_*` | newline ASCII → `/cue` + `/score` | cue launchpad / celebrations | **REAL** | `CtsBridge.tsx:235-256,641-683` |
| Sportzcast / Scorebird / Genius / Sportradar / MaxPreps / GameChanger | – | – | – | **COSTUME** (all honestly COMING_SOON) | Two-method sweep: only `integrations-health.controller.ts:848-891`, `discovery.service.ts:500-509`, doc comments |

## Findings

**[P1] FitnessLiveTVWidget loads hls.js from a public CDN at runtime via `new Function` — NEW**
`apps/web/src/components/widgets/fitness/FitnessLiveTVWidget.tsx:249-252` does `new Function('u','return import(u)')('https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.mjs')`. Impact: (a) a kiosk on a locked-down venue LAN or with CDN egress blocked silently loses live TV; (b) it is unpinned third-party code executing on the same surface that renders lockdown alerts — a jsdelivr compromise is a fleet compromise; (c) it violates both `script-src 'self'` and the missing `'unsafe-eval'` in the production player CSP (`next.config.ts:57`), so promoting that policy to enforcing breaks this widget twice. **The app already bundles `hls.js ^1.6.16`** (`apps/web/package.json:50`) and `StreamingWidget.tsx:212` imports it correctly. Fix: replace with `await import('hls.js')`.

**[P1] `FITNESS_LIVE_TV` / `FITNESS_TRAINING_VIDEO` are missing from the zone URL guard, and the fitness widget frames a raw operator URL — NEW**
`apps/api/src/templates/zone-url-guard.ts:70-87` covers `WEBPAGE`, `EXTERNAL_HTML`, `STREAMING` only. `FitnessLiveTVWidget.tsx:337-344` renders `src={c.streamUrl}` verbatim in an iframe carrying `sandbox="allow-scripts allow-same-origin allow-presentation"` and `allow="autoplay; encrypted-media; picture-in-picture"`. This is precisely the hole INJ-006 closed on `StreamingWidget` (`StreamingWidget.tsx:271-276,400-422`) — but the fitness twin was never swept. Because `allow-same-origin` is only safe while `src` is *guaranteed* foreign (the reasoning at `StreamingWidget.tsx:302-310`), a same-origin `streamUrl` would hand the frame the player's DOM and device token. `FitnessTrainingVideoWidget.tsx:137` (`<video src={c.videoUrl}>`) has the same guard gap, lower severity. Fix: add `FITNESS_LIVE_TV: ['streamUrl','hlsUrl']` and `FITNESS_TRAINING_VIDEO: ['videoUrl','posterUrl']` to `URL_BEARING_ZONE_FIELDS`, and route `streamUrl` through `isAllowedStreamingHost`.

**[P1] A dropped HLS stream is a permanent black screen until someone reloads the kiosk — NEW**
`StreamingWidget.tsx:229-233` and `FitnessLiveTVWidget.tsx:269-271` both handle `Hls.Events.ERROR` by setting an error string and stopping. Neither calls `hls.startLoad()` (network-fatal) or `hls.recoverMediaError()` (media-fatal), and neither retries. Two-method check: no `recoverMediaError` / `startLoad` / `NETWORK_ERROR` anywhere under `apps/web/src/components/widgets`. A venue Wi-Fi blip at 7pm on game night kills the board for the night — the manifest poll won't remount the widget because the manifest didn't change. Fix: the standard hls.js fatal-error ladder plus a capped exponential re-`loadSource`.

**[P1] Pluto TV / Xumo ship as "legal for commercial display" while the streaming catalog says the opposite — NEW**
`packages/api-types/src/streaming.ts:232-237` states Pluto/Tubi/Plex "were considered here but their consumer TOS explicitly forbids commercial display… litigation bait. Removed from the catalog." Yet `fitnessSourceCatalog.ts:117-124` ships Pluto as `status:'READY'` with the note "Pluto TV streams are free and permitted for commercial display", and `fastChannelCatalogs.ts` bundles 30 Pluto + 20 Xumo HLS URLs (community-indexed stitch endpoints) that play in gym tenants. One of these two positions is wrong; the platform's own licensing-discipline doctrine sits in the file that says no. Needs a legal call, not a code call.

**[P1] `iptv-m3u` is a DIRECT-tier tile with no parser and no upload — NEW**
`streaming.ts:387-401` promises "Upload a .m3u / .m3u8 playlist file (multi-channel IPTV)… We parse + render channels" at tier `DIRECT`. Two independent methods found zero M3U parsing code and no upload path; the connect modal only accepts a single `playbackUrl` (`settings/streaming/page.tsx:625`). Under this catalog's own honesty rules (the same reasoning that demoted `vimeo-live` and `soundtrack` to PARTNER) this should not be DIRECT.

**[P2] A volunteer scorekeeper cannot start a console-fed game from a phone — the kiosk needs a hand-typed URL — NEW**
`player/page.tsx:9082-9092` mounts `CtsBridge` only on `?cts=1`, and takes `gameId`/`feedToken` **exclusively** from URL query params (`qp('game')`, `qp('feedToken')`). `wiring` and `consoleProfile` correctly come from the manifest, but the game binding does not — even though the server already knows it (`Screen.activeBoardGameId`, used at `screens.controller.ts:3492`). Consequence: every new game requires physically retyping a URL with a UUID and a 32-hex token on the kiosk. That blows the CLAUDE.md 30-second UX gate for the exact operator persona (volunteer scorekeeper) this vertical targets. Fix: carry `gameId` + a short-TTL structured feed token on the manifest and let `?cts=1` alone suffice. **UX grade for the console-fed path: D.** (The *manual* console path is fine — see below.)

**[P2] Daktronics + WTTC decoders are `provisional` against unvalidated byte offsets — KNOWN** (`console-profiles.ts:147-176`, self-documented 2026-06-09). Daktronics `playClock`/`possession` explicitly unconfirmed. Capture tooling to promote them exists (`?ctsCapture=1`, `CtsBridge.tsx:442-481`) — a bring-up task, not a code defect, but "Daktronics support" should not be sold as validated.

**[P2] `GET /api/v1/sports/board/:id` is public with no rate limit — NEW.** Its siblings in the same controller carry a 40/10 s limiter (`sports-board.controller.ts:36-38,65-82`) and the feed POST uses the Redis-backed limiter, but `@Get(':id')` at `:50-53` has neither. The 1 s memo cache (`sports.service.ts:570-592`) blunts DB impact, so this is CPU/egress amplification only, on an unguessable UUID. Low.

**[P2] `kick.com` is allowlisted with no normalise rule — NEW.** `STREAMING_EMBED_HOSTS` includes `kick.com` (`StreamingWidget.tsx:348`) but `normalizeEmbedUrl` has no Kick branch, so any `https://kick.com/...` URL falls through to the verbatim-return at `:414-419`. Contained by the allowlist; the file's own comment warns the two lists must stay in step.

**[P2] `dashjs ^5.1.1` is an unused dependency** (`apps/web/package.json:48`; zero import sites by two methods) while both the widget and the validator honestly refuse DASH. Either wire it or drop it. **NEW.**

**Per-sport parity (7.8).** `SPORTS` ships 19 pickable sports (`sports.ts:1288-1292`); `SPORT_DEFINITIONS` has 20 including the deprecated `swimming_diving` alias retained for pre-2026-07-01 games. Every definition carries a clock model (`countdown`/`count-up`/`none`), a segment model, score increments, stats and celebrations; judged sports carry `scoreDecimals` + `judgePanel`. Shot-clock config exists only where the sport has one (`water_polo:921`, basketball). `CAREER_THRESHOLDS` (`sports.ts:2026-2110`) has a row per sport, with deliberate empty rows for judged/lower-is-better sports. Widget sets are variant-dispatched under `SCOREBOARD` with dedicated swim/dive flagships (`SwimDiveWidgets.tsx`, `StadiumMeetBoardWidget.tsx`). The 2026-06-13 "all 18 sports" claim holds and has since grown to 19. **No parity gap found.**

**Operator UX verdict (30-second gate).** *Manual* game start passes: New Game needs sport + away team (home team remembered in localStorage), templates hidden behind a `<details>`, CTA is "Create & control" (`sports/page.tsx:468-500,784-787`). *Console-fed* game start fails — see the P2 above. Streaming setup passes: Settings → Streaming leads with Quick Start one-click cards for public broadcasters / YouTube / custom HLS (`settings/streaming/page.tsx:171-270`) plus a server-side embeddability pre-check that catches YouTube Error 153 before it reaches a screen.

## Unverified / open questions

1. **Nothing was executed.** No build, no test run, no live stream loaded. Every grade is code-reading, not observed behaviour — in particular F-3 (black-screen-on-drop) is inferred from the absence of recovery calls and was not reproduced on a kiosk.
2. **Real-hardware validity of the Daktronics + WTTC decoders is unknown by design** — the code says so itself. Not independently verifiable from the repo.
3. **Whether the report-only player CSP is currently reporting the jsdelivr violation in production** is unverified — no collector endpoint exists (`next.config.ts:20-22`), so violations are console-only on kiosks nobody is watching.
4. **Pluto/Xumo licensing** is a legal question; the repo contradicts itself.
5. **Chromium-83 Taurus behaviour of the fitness HLS path** was not checked against the `taurus-safety` scan paths — `apps/web/src/components/widgets/fitness/` may or may not be in that gate's scope.
