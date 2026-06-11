# Pre-launch Final Audit — Sections 6 + 7: Streaming Integrations + Sports Score/Data

**Auditor:** frontier-model fresh pass (assignment 04) · **Date:** 2026-06-10
**Scope:** Standard Audit Surface §6 (Streaming integrations) + §7 (Sports score/data integrations, Sprint 13)
**Method:** code-trace of real execution paths (widget → API → DB → board surfaces), live curl probes against https://venue-os.app, dedup against `docs/research/2026-06-09-full-audit/REPORT.md` + `2026-06-08-launch-readiness-audit/00-MASTER-SYNTHESIS.md`.

---

## Coverage table (page 1)

| Surface bullet | Coverage | D | UX | F | One-liner |
|---|---|---|---|---|---|
| §6 RTSP camera feed widgets (V2) | N-A (honest) | — | — | — | Honest "needs server transcode" placeholder, `StreamingWidget.tsx:136-146` |
| §6 HLS / DASH / M3U8 in player | covered | A- | B+ | A- | hls.js 1.6.16 dynamic import + native Safari path real; DASH honestly refused |
| §6 YouTube / Twitch / FB Live embeds | covered | A- | B | B | watch-URL + Twitch + Vimeo real; **channel-live path broken** (P2 below); FB Live absent |
| §6 NFHS Network broadcast overlay | N-A (honest) | — | — | — | `/overlay/[gameId]` OBS browser-source is the honest bridge; no fake NFHS API |
| §6 Webcam URL widget | N-A (not built) | — | — | — | No webcam widget exists (grep: 0 hits); workaround = custom-hls channel or WEBPAGE |
| §6 Streaming-as-Asset scheduling | deferred (gap) | — | C | C | No stream Asset type; path = STREAMING widget in template→playlist; URL assets iframe raw watch-URLs (frame-blocked) |
| §6 IP-camera RTSP responder links (V2) | N-A | — | — | — | V2 spec, nothing faked |
| **§6 overall** | **covered** | **A-** | **B** | **B+** | |
| §7 Daktronics All Sport tap-off | covered (new since prior audits) | B+ | B | B | Real RTD decoder + picker, BUT labeled `stable` with zero real-hardware capture (P1 below) |
| §7 Sportzcast / Scorebird | covered-as-generic | — | B+ | B+ | No named connector (honest); generic HMAC `/board/:id/feed` + copyable credentials is the documented hook |
| §7 Genius Sports / Sportradar | N-A (honest) | — | — | — | Not built, not faked |
| §7 MaxPreps | N-A (honest) | — | — | — | Not built, not faked |
| §7 GameChanger | N-A (honest) | — | — | — | Not built, not faked |
| §7 Game-state console publishing | covered | A- | A- | A- | 750ms public poll + 1s cache + per-write invalidation; board/ribbon/scorebug/overlay all live on prod (curl 200) |
| §7 Auto-celebration on score delta | covered | A- | A- | A- | Fires on feed ingest AND manual adjust/set; per-game toggle persisted; AuditLog rows |
| §7 Per-sport widget parity | covered (1 gap) | A- | B+ | B+ | 18 sports defined; **tennis missing** despite task #28 claiming complete |
| **§7 overall** | **covered** | **A-** | **B+** | **B+** | |

**Dedup status:** prior full-audit graded §6 B+/B+/B and §7 A-/B+/B+ ("YT/Twitch/HLS real; RTSP/NFHS honest N-A; CTS + /feed real; named-vendor syncs honest N-A"). This pass **confirms** those calls and goes a level deeper: every finding below is NEW except the M9 parseInt item (verified partially fixed, listed KNOWN-OPEN).

---

## What an athletic director gets TODAY on game night

**Grade: B+ — genuinely game-night usable for the shipping path, with two honesty caveats.**

- **Water polo on a CTS Gen 6 console (the beta-venue path): A-.** RS-232 → EP6N/ECBox UART → `CtsParser` (seven-segment decode, shot clock, exclusions, timeouts, cadence-derived clock-running per T2-1) → 5 Hz `cts-snapshot` POSTs → board/ribbon/scorebug surfaces. Live integration test with screenshots was done (task #164). Manual override (+/- chips) keeps working when CTS goes dark — snapshot ingest NEVER touches operator columns (`sports-board.controller.ts:117-122`), which is exactly the right failure posture.
- **Any of 18 sports with a human at the console: A-.** Real game engine: clock-as-anchor (server never ticks; board projects at 100ms — `board/[gameId]/page.tsx:149,263`), segment auto-resets, penalty/shot-clock slaving on ingest (`sports.service.ts:2646-2660`), undo rail, hold-to-confirm, multi-role views, keyboard shortcuts. Surfaces: `/board`, `/ribbon`, `/scorebug`, `/overlay` (OBS browser source for NFHS/Hudl-style streams) — all public-by-design with uuid game ids, all returning 200 on prod.
- **Auto-celebrations: A-.** Score delta → matching `autoPoints` celebration → `CUE` GameEvent → every surface plays it within ~750ms. Fires from machine feed AND the manual quick-buttons; per-game toggle survives restart (hydrated from `AUTO_CELEBRATE` GameEvent); every auto-fire writes an immutable AuditLog row (`sports.service.ts:2698-2772`).
- **A Daktronics gym: C+ (the honesty caveat).** Wired and selectable, but see P1 — the decoder has never seen real console bytes. Treat it as provisional until a hardware capture; do NOT promise it to a customer for a real game yet.
- **A streamed game: B+.** `/overlay/[gameId]` into OBS works; scorebug composites over the broadcast. YouTube *watch-URL* embeds in signage work; **YouTube channel-live URLs black-box** (P2).

---

## Verified solid (trace evidence)

1. **hls.js wiring is real, not a costume.** `apps/web/package.json:49` (`"hls.js": "^1.6.16"`), dynamic `await import('hls.js')` only when `canPlayType('application/vnd.apple.mpegurl')` is empty (native Safari path first), live-tuned config (`liveSyncDurationCount: 3`, `lowLatencyMode`), fatal-error surface, destroy on unmount — `StreamingWidget.tsx:192-264`. Mounted for real: `WidgetRenderer.tsx:470 case 'STREAMING'`, PropertiesPanel editor at `PropertiesPanel.tsx:4711+` (channel picker bound to `/streaming/channels`). Chromium<51 device gets an honest "too old for HLS" panel instead of a black box (`StreamingWidget.tsx:109-122`).
2. **DASH / RTMP / RTSP are honestly refused** with operator-readable guidance instead of silent black boxes (`StreamingWidget.tsx:136-161`). Matches the catalog: no DASH player is bundled, and that is stated.
3. **Streaming provider catalog honesty enforced server-side, not just in UI.** `streaming.service.ts:99-108` blocks `commercialUseLegal: false` (ForbiddenException citing TOS) and `integrationTier === 'CLOSED'`; oauth2 connect attempts are rejected at the API boundary too (CYCLE-4 BUG-007 fix, mirrors POS). Tiers in `packages/api-types/src/streaming.ts`: DIRECT = youtube/twitch/custom-hls/iptv-m3u/public-broadcasters (all genuinely playable), PARTNER = vimeo-live/soundtrack (PENDING + a real "Coming soon — contact sales" modal, `settings/streaming/page.tsx:233`), BRIDGE = DirecTV/DISH/Atmosphere/Mood/iHeart (HARDWARE BRIDGE badges + bridge steps). The page even answers "Why can't I just paste my Hulu password?" in plain English. This is the honesty pattern the 2026-05-21 "integration costumes" rule demanded.
4. **Streaming credentials get real envelope encryption** — per-row AES-256-GCM data key wrapped by `DEVICE_SECRET_KEY`, prod boot-throw when key is short (`creds-cipher.ts:33-45`); connection creation goes through `safeFetch`/`validatePublicUrl` (SSRF-aware import at `streaming.service.ts:20`).
5. **P0-6 re-tier VERIFIED FIXED.** `WiringPanel.tsx:73-93` — the Daktronics/Nevco RS-485 dropdown that was a costume is now a disabled "Coming soon" treatment (`RS485_DECODERS_COMING_SOON`, rendered at :241-260); role values kept in schema for back-compat, selectable role only `'off'`. Nevco appears nowhere else as selectable. (But see P2-3: the copy now *contradicts* the new RS-232 Daktronics picker.)
6. **Feed token is real security engineering.** Game-scoped HMAC-SHA256 (`sports-feed-token.ts`): bare legacy + structured versioned tokens, per-game revocation via `Game.feedTokenVersion`, optional TTL inside the MAC, `crypto.timingSafeEqual` compare, dedicated `SPORTS_FEED_SECRET` with boot-validated fallback. Feed POST rate-limited 40/10s/game (`sports-board.controller.ts:30-35`).
7. **The "theater" pub/sub was removed, not papered over.** `sports.service.ts:41-49,125-137` documents Audit-Fix 2: the old signed `game:<id>` publish died on a psubscribe mismatch, so delivery is now explicitly the 750ms poll + 1s cache + per-write invalidation (`record()` → `invalidateBoardCache`). The class-level comment even tells the future engineer exactly where to re-add WS. This is the discipline the 2026-05-21 lesson demanded — verified caller-by-caller.
8. **Auto-celebration end-to-end** (assigned bullet): `ingestByFeed` → `ingest(opts.auto)` → `maybeAutoCelebrate` (delta>0 only, `autoPoints.includes(delta)`, both teams independently) → `record(id,'CUE',{auto:true,team,source,snapshot})` + AuditLog `SPORTS_CUE_FIRED` (`sports.service.ts:2550-2772`). Manual +N adjust and manual set fire the same path with `source:'manual'` + actor userId (`:1309-1369`). Toggle fail-opens so a celebration bug can never block score sync.
9. **CTS bridge fidelity (T2-1) is real.** `CtsBridge.tsx` (1762 lines): native APK serial path via `WebAppBridge.kt`/`SerialPortBridge.kt` + Web Serial fallback, dual-RS232 (port 2 = Stream Deck line protocol with its own accumulator, default `/dev/ttyS2`), console-profile registry drives baud/parity/tty/decoder, 5 Hz POST cap, clock-cadence-derived running state. `SerialPortBridge.kt` is a real implementation (stty shell-out config, blocking read loop, base64 bytes → WebView) — ECBox Phase 1 done; Phases 2-4 (hardware bring-up, APK settings UI, dress rehearsal) honestly still open in tasks #136-138.
10. **Daktronics parser is a real decoder, not a stub.** SYN..ETB frame accumulation, modulo-256 checksum validation, persistent space-initialized RTD display buffer with positional splicing (matches physical display memory semantics), per-sport field re-slicing, 24 unit tests (`daktronics/parser.ts`, `daktronics.test.ts`). Wired end-to-end: screens-page picker → `Screen.config.consoleProfile` → manifest → CtsBridge → `cts-snapshot` POSTs tagged `source:'daktronics'` (`CtsBridge.tsx:1097-1106`).
11. **Public board endpoint exposure is minimal.** `getBoardFresh` explicit-selects only display fields — no feedToken, no tenant internals (`sports.service.ts:382-397`); game id is `@default(uuid())` (`schema.prisma:2044`), matching the "unguessable" claim. Live probes: `GET /api/v1/sports/board/bogus` → 404; `GET /api/v1/streaming/providers` → 401 (correctly authed); `/board/x`, `/overlay/x` pages → 200.
12. **Sport engine breadth:** 18 sports with typed fields + celebrations: football, basketball, baseball, softball, soccer, volleyball, wrestling, hockey, lacrosse, field_hockey, water_polo, pickleball, track_and_field, swimming_diving, cross_country, gymnastics, golf, competitive_cheer (`packages/api-types/src/sports.ts`). Segment ingest applies the same clock side-effects as the operator path ("same rules whether we do it or the integration does it").
13. **test-integrations page** is a real probe dashboard (server-side READY/DEGRADED/NOT_CONFIGURED/COMING_SOON statuses + latency + open-in-builder), admin-gated via RoleGate, Taurus-safe CSS discipline baked in.

---

## Findings

### P1-1 — Daktronics profile labeled `stable` with zero real-hardware evidence; picker shows no warning
- **Evidence:** `packages/scoreboard-cts/src/console-profiles.ts:163-171` — `daktronics-allsport` has `status: 'stable'`, while `cts-wttc` is `provisional` ("byte format pending a real-hardware capture"). The Daktronics offsets are derived from a third-party reverse-engineering project's Rust tables, not Daktronics docs (`daktronics/offsets.ts:9` — "src/sports/{football,basketball,baseball}.rs `sport_builder!` field"), with an `UNCERTAIN_OFFSETS` list flagging playClock/possession as "console-code dependent" (`offsets.ts:243-245`); tests run against a self-written mock only. The dashboard picker renders no `provisional` flag for it (`screens/page.tsx:607` lacks `provisional: true`; WTTC at :606 has it). Task #207 ("Daktronics console parser") is itself still in_progress.
- **Why it matters:** the status doc defines `stable` as "the established path." An AD wires an All Sport 5000 off this label; a wrong offset on game night = wrong score on the public board, in front of the crowd — the exact trust moment Sprint 13 sells. The same evidence level made WTTC `provisional`; the inconsistency is the bug.
- **Fix:** flip `daktronics-allsport` to `status: 'provisional'` + `provisional: true` in `CONSOLE_OPTIONS`, note "pending real-hardware capture" in `notes`/`help`; promote to stable only after a captured RTD session validates the offsets (then keep the capture in the repo as a fixture).

### P2-1 — StreamingWidget YouTube *channel-live* URLs always end in a black box
- **Evidence:** `StreamingWidget.tsx:299-303` — regex `youtube\.com\/(?:c|channel|user|@)([\w-]+)\/live` cannot match `/channel/UCxxx/live` or `/c/Name/live` (no `/` between alternation and capture; `[\w-]+` won't cross `/`). Only `@handle/live` matches — and then builds `embed/live_stream?channel=@handle`, but that embed endpoint requires the `UC…` channel ID, not a handle. Everything else falls through to raw-URL iframe (`:319-320`) → YouTube's `X-Frame-Options: SAMEORIGIN` → black box. Meanwhile the codebase already has a correct server-side resolver — `/api/v1/fitness/youtube-live/resolve` used by `FitnessLiveTVWidget.tsx:26-28` — that StreamingWidget doesn't reuse.
- **Why it matters:** "point the lobby screen at our school's YouTube live channel" is the most common school streaming ask; it silently fails today (a `watch?v=`/`youtube.com/live/<id>` URL works, but a channel URL doesn't, and the operator can't tell why).
- **Fix:** route channel-form URLs through the existing youtube-live resolver (or resolve handle→channelId server-side) and emit `embed/live_stream?channel=UC…`; fix the regex separators while there.

### P2-2 — Tennis claimed shipped, doesn't exist in the sport engine
- **Evidence:** task #28 "Volleyball + Tennis + Pickleball (set/rally) widget set" marked completed; `grep -n tennis packages/api-types/src/sports.ts` → zero hits. 18 sports defined; tennis is not one of them.
- **Why it matters:** parity claims drive sales conversations; an AD with a tennis program gets nothing (closest hack: run it as pickleball with wrong labels/regulation defaults).
- **Fix:** add a `tennis` SportDefinition (sets/games/points, tiebreak field, ad/no-ad) — the composable def-driven engine makes this a data-only addition — or correct the claim everywhere it's made.

### P2-3 — Contradictory Daktronics messaging: "Coming soon" and a live picker on adjacent screens
- **Evidence:** `WiringPanel.tsx:91-93,241-260` renders "Daktronics All Sport / Nevco — Coming soon" (RS-485 decoder roles), while the same screen detail page's "Scoreboard console" picker offers "Daktronics All Sport 5000" as selectable (`screens/page.tsx:607,697-723`). The distinction (RS-485 multidrop vs RS-232 RTD via Port Expander) is real but invisible to a non-IT operator.
- **Fix:** cross-reference copy in WiringPanel ("RS-232 RTD is supported — pick it under Scoreboard console; RS-485 multidrop is coming soon") and/or rename the coming-soon rows to "Daktronics (RS-485 multidrop)".

### P3-1 — Unauthenticated `POST /sports/board/:id/cts-cue-fired` lets anyone with a game URL write forensic rows
- **Evidence:** `sports-board.controller.ts:65-101` — no feed token required (unlike `cts-snapshot` on the same component); 40/10s/game rate limit only. Writes `CTS_CUE` GameEvents (`sports.service.ts:3690-3699`). Mitigations verified: type is `CTS_CUE`, NOT `CUE` — the board cue feed won't play it (no remote celebration firing), and grep shows no current reader of `CTS_CUE`, so impact today = forensic noise. The stated purpose ("drives the sponsor proof-of-play report") makes this worth closing before any sponsor report reads these rows.
- **Fix:** require the same `x-feed-token` the bridge already holds (it sends snapshots with it); one header on the existing POST.

### P3-2 — KNOWN-OPEN: CTS parser NaN renders (prior M9, partially fixed)
- **Evidence:** `scoreboard-cts/src/parser.ts:95` (`digitsToInt`) is now NaN-guarded; `:133` (`parseInt(mins,10)` in `formatClock` — non-digit decoded chars could render "NaN:SS" on the board) and `:503` remain raw. Prior audit M9 said "cheap fix"; it's half-done.
- **Fix:** reuse `digitsToInt` at both sites.

### P3-3 — AdOverlay timer math trusts operator config
- **Evidence:** `StreamingWidget.tsx:353` — `slots.reduce((min,s)=>Math.min(min,s.intervalMs), 300000)`; a slot with `intervalMs` 0/undefined yields `setInterval(fn, 0/NaN)` → ad overlay flickers continuously over the stream. `durationMs ≥ intervalMs` also lets the timeout/next-show overlap.
- **Fix:** clamp `intervalMs` to ≥15s and `durationMs` to `< intervalMs` at render (and sanitize at the ad-slot API).

### P3-4 — kick.com sniffed as iframe but never normalized
- **Evidence:** `guessPlaybackType` lists `kick\.com` (`StreamingWidget.tsx:187`) but `normalizeEmbedUrl` has no kick branch → raw kick.com page iframe → frame-blocked. Either add `player.kick.com/{channel}` or drop kick from the sniffer.

### P3-5 — Unbounded in-memory Maps in the sports hot path
- **Evidence:** `feedHits` (`sports-board.controller.ts:33`), `boardCache`, `autoCelebrateCache` (`sports.service.ts:73`) never evict finished games — slow growth on a long-lived single instance; also no negative-result caching/rate limit on the public `GET board/:id` (each bogus uuid = one indexed DB lookup). Low risk at current scale; add an LRU cap / sweep when fleet grows.

---

## Missing features (competitive parity, §6/§7 lens)

- Webcam/IP-camera URL widget (MJPEG/snapshot-refresh) — Yodeck/OptiSigns ship one; today's answer is a custom-HLS channel or WEBPAGE iframe.
- Stream-as-playlist-item ("add this live channel to the lunch rotation") — currently requires building a template around the STREAMING widget; URL assets don't embed-normalize streaming URLs.
- Facebook Live embed normalization (YouTube/Twitch/Vimeo exist; FB Live does not).
- Named Sportzcast/Scorebird connectors (generic feed API exists; a vendor-specific one-click would close the loop).
- Tennis sport definition (see P2-2).
- DASH playback (honest gap; most providers offer HLS — fine to leave, stated clearly).

## Housekeeping notes (not findings)

- Task #45 "AUTO celebration on score feed" still shows in_progress but the code is shipped + audited end-to-end — close it.
- ECBox3576: Phase 1 (code) real; Phases 2-4 (hardware bring-up, cable spec, APK settings UI, dress rehearsal) honestly open — don't sell ECBox serial until #136-138 close.
