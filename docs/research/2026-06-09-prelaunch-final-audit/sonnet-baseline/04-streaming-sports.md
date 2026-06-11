# Pre-Launch Final Audit — Sections 6 + 7: Streaming Integrations + Sports Data

**Date:** 2026-06-10 (overnight) · **Auditor:** sonnet-4-6 read-only  
**Scope:** Standard Audit Surface §6 (Streaming integrations) + §7 (Sports score/data integrations)  
**Dedup basis:** 2026-06-09 REPORT.md + 2026-06-08 00-MASTER-SYNTHESIS.md reviewed; only net-new items reported.  
**Method:** Code trace to real callers; no vibes.

---

## Coverage Table

| Sub-domain | Coverage | D | UX | F |
|---|---|---|---|---|
| §6 HLS/DASH/RTSP in player widgets | covered | B+ | B | B+ |
| §6 YouTube / Twitch embeds | covered | A | A | A |
| §6 Webcam URL widget | N-A | — | — | — |
| §6 Streaming-as-Asset scheduling | N-A (honest gap) | — | — | C |
| §6 RTSP / RTMP | covered (honest N-A) | B | B | B |
| §6 NFHS Network overlay | N-A (not built) | — | — | — |
| §6 Provider tier honesty | covered | B+ | B+ | A |
| §7 CTS Gen6 parser fidelity | covered | A | A | A |
| §7 ECBox3576 serial bridge | partially covered | B | B | B |
| §7 Daktronics All Sport parser | covered (needs hardware validation) | A- | B+ | B |
| §7 Sportzcast / Scorebird | covered via open feed API | B | B+ | B+ |
| §7 Genius Sports / Sportradar | N-A (honest) | — | — | N-A |
| §7 MaxPreps / GameChanger | N-A (honest) | — | — | N-A |
| §7 Auto-celebration on score delta | covered | A | A | A |
| §7 Console → scoreboard/ribbon/scorebug | covered | A | A | A |
| §7 Per-sport widget parity | covered | A | A | A- |

---

## §6 — Streaming Integrations

### What is genuinely solid

**HLS playback is real.** `StreamingWidget.tsx` lazy-imports `hls.js` via dynamic `import()` for non-Safari browsers (`HlsStream` component, lines 193–263). Safari's native HLS (`canPlayType('application/vnd.apple.mpegurl')`) is detected and used directly, no polyfill. Low-latency options are set (`liveSyncDurationCount: 3`, `lowLatencyMode: true`). Fatal-error surfacing via `data.fatal` check is present. The widget is wired into `WidgetRenderer.tsx:470` via `case 'STREAMING': return <StreamingWidget .../>` — it is mounted, not dead code.

**YouTube / Twitch / Vimeo embeds are real.** `normalizeEmbedUrl()` (StreamingWidget.tsx:281) correctly transforms watch URLs, YouTube channel live links, Twitch login, and Vimeo URLs into their respective embed forms. Twitch's mandatory `parent=` param is dynamically set from `window.location.hostname`, which is the correct cross-environment implementation. Autoplay + mute parameters are threaded through. The `guessPlaybackType()` sniffer (line 184) routes these to `IframeStream` — correct.

**RTMP / RTSP honest messaging.** Both modes render a friendly `⚠️ "requires server-side transcode"` panel (StreamingWidget.tsx:136–146) rather than silently black-boxing. RTSP is listed in the type union but has no live playback attempt — honest.

**DASH honest messaging.** `.mpd` URLs get an explicit "MPEG-DASH isn't supported" panel (StreamingWidget.tsx:148–161) directing operators to HLS. This prevents the silent black-box failure.

**Provider tier labeling is honest.** `packages/api-types/src/streaming.ts` uses `DIRECT / PARTNER / BRIDGE / CLOSED` with inline `tierReason` strings. Atmosphere TV, DIRECTV, DISH, Mood Media are all `BRIDGE` with explicit hardware setup steps. No fake `DIRECT` tiles. The Daktronics / Nevco RS485 costume that was P0-6 in the 05-28 audit is fixed — task #171 completed.

**Ad overlay engine is present.** `AdOverlay` component (StreamingWidget.tsx:324) implements weighted round-robin across slots; `intervalMs`/`durationMs` cadence; three placement types (lower-third, side-rail, full-bleed); overlay is gated by `isLive && allowAdOverlay !== false`. Not theater.

**Capability-aware codec selection.** `pickBestVideo()` from `@/lib/capabilities` selects AV1 → H.265 → VP9 → H.264 based on device caps (StreamingWidget.tsx:101–103). Chromium <51 shows a friendly "too old for HLS" message rather than a black box (lines 109–122).

**Streaming API backend is real.** `apps/api/src/streaming/` has controller + service + creds-cipher. `StreamingService` validates against the canonical `STREAM_PROVIDERS` catalog, stores AES-encrypted credentials via `sealCredentials`, resolves playback URLs tenant-scoped. SSRF defense reused from `safeFetch` / `validatePublicUrl`. AuditLog row on disconnect per task #189.

**Settings UI for streaming exists.** `apps/web/src/app/[schoolId]/settings/streaming/page.tsx` is a real page with React Query hooks for `streaming-channels` and `streaming-channels-picker`.

---

### Findings — §6 Streaming

#### F6-1 (P2) — STREAMING widget not schedulable as a playlist item

**Evidence:** `PlaylistItem` schema (`schema.prisma:999–1050`) carries `assetId` and `templateId` foreign keys. There is no `streamingChannelId` column on `PlaylistItem`. The `streaming-as-Asset scheduling` bullet from the Standard Audit Surface is not implemented — a streaming channel cannot be dropped into a playlist slot and scheduled to play "every Friday 7–9pm for sports night."

The work comment at `health/integrations-health.controller.ts:891` says "Upload your own creatives in Assets → Ad Slots and the streaming widget renders them on a flight schedule" — that is ad overlay scheduling, not the channel itself as a schedulable item.

**Impact:** An athletic director who wants DIRECTV sports running 2–5pm then custom content 5–7pm cannot do this in the scheduler. They must leave the streaming widget always-on in a template or swap templates manually.

**Fix:** Add `streamingChannelId String? @map("streaming_channel_id")` to `PlaylistItem`; add nullable FK to `StreamProviderChannel`; extend playlist renderer to resolve and pass `playbackUrl`/`embedUrl`/`playbackType` when the item is a channel. Medium-complexity migration.

**Severity:** P2 (not a launch blocker for K-12 signage, significant for sports/bar/gym vertical)

---

#### F6-2 (P3) — Webcam URL widget does not exist

**Evidence:** Grep across all widget files for "webcam"/"Webcam"/"WEBCAM" returns zero hits in widget component files. Standard Audit Surface §6 lists "Webcam URL widget" explicitly. There is no `WEBCAM` case in `WidgetRenderer.tsx`.

The `WEBPAGE` widget can display a webcam if the operator pastes a webcam embed page URL — but that is a workaround, not a native widget with "Webcam URL" label, stream format guidance, or error states. For a SPORTS vertical customer who wants a fan-cam upper-right zone, this means hunting for an embed URL and hoping the WEBPAGE widget renders it.

**Impact:** Low for school signage; visible gap for sports/venue customers.

**Fix:** Register a thin `WEBCAM_URL` widget variant that wraps `HlsStream` or an iframe with a focused "paste your RTSP-to-HLS or webcam embed URL" UX in PropertiesPanel. 1–2h work on top of the existing `HlsStream` component.

**Severity:** P3

---

#### F6-3 (P2) — Feed-rate in-memory limiter is per-replica, not global

**Evidence:** `SportsBoardController.feedHits` is a `Map<string, number[]>` instance variable (sports-board.controller.ts:33). On a multi-replica deploy, each replica has its own map. The stated limit is 40 POSTs / 10s per game; a misbehaving client with access to a leaked feed token can effectively send 40 × N_replicas requests/10s. Same class as the AI hourly cap issue (H5 in REPORT.md) — already flagged there; noted here for §6 completeness.

**Severity:** P2 (acceptable at single-replica current deploy; must move to Redis before scaling)

---

#### F6-4 (P3, design) — RTSP / NFHS Network shown in provider catalog with no path to working playback

**Evidence:** `StreamIntegrationTier` enum includes `'BRIDGE'` for RTSP-based providers. The UI shows these in the streaming settings page. While the widget honestly renders a "needs transcode" message, the operator has no guided path for setting up the ffmpeg HLS bridge Docker image mentioned in `bridgeSteps`. The Docker image `venueos/hls-bridge` is referenced in step text (streaming.ts:159) but does not appear to exist in this repo and there is no link to a Docker Hub page.

**Fix:** Either publish the Docker image or change the `bridgeSteps` text to point to a real resource. A broken step in the setup guide undermines the BRIDGE tier's value proposition.

**Severity:** P3

---

## §7 — Sports Score / Data Integrations

### What is genuinely solid

**CTS Gen6 parser is high fidelity.** `packages/scoreboard-cts/src/parser.ts` implements the full seven-segment decode (XOR `~byte & 0x7F` → SEG_TO_CHAR lookup), address-byte packet framing, mid-packet flush on new address byte, blank-digit handling, and the full CTS module set: `GAME_CLOCK` (5-byte M:SS format + sub-minute tenths mode), `HOME_SCORE`, `AWAY_SCORE`, `PERIOD`, `SHOT_CLOCK_HOME`, `SHOT_CLOCK_AWAY`, up to 3 `EXCLUSION_*` slots per team, and the horn one-shot. Protocol is sourced from the CTS operator manual + `fabriziobertocci/coloradoScoreboard` cross-reference.

**Cadence-derived clock running (T2-1) is real.** `CtsParser.clockPacketHistory` tracks timestamps of the last two `GAME_CLOCK` packets; `getClockPacketIntervalMs()` exposes the derived interval; the `CtsBridge` uses this to compute `clockRunning` without relying on the display string changing — correctly handles the "clock frozen at 0:00" state that would otherwise show as running.

**`digitsToInt` is safe.** The 2026-06-09 REPORT.md M9 finding noted `parseInt` without range checks at parser.ts:95,133,503. Verified: the function at line 92–96 guards with `Number.isFinite(n) ? n : 0` — no raw `parseInt` without guard. M9 appears to be a false finding from the 2026-06-09 batch; the actual implementation is already safe.

**Daktronics All Sport parser is structurally sound.** `packages/scoreboard-cts/src/daktronics/parser.ts` correctly implements the Enhanced RTD framing (SYN 0x16 → accumulate → ETB 0x17, modulo-256 checksum, 1-based offset → 0-based buffer), persistent display buffer, incremental frame writes, and sport-switchable offset tables for football, basketball, and baseball/softball. The parser re-exports `UNVERIFIED_OFFSETS` — a machine-readable list of 19 fields that need hardware validation (play-clock, possession indicators, bonus fouls, at-bat indicators, hits, errors). Core fields (clock, scores, period, quarter/segment, down/distance, balls/strikes/outs) are `verified: true` and corroborated by both the Daktronics ED-12483 reference manual and the MIT-licensed `zabackary/daktronics-allsport-5000-rs` decoder.

**ECBox3576 Phase 1 native serial bridge is shipped.** Task #135 completed. The `CtsBridge.tsx` has a full native mode (lines 529+) that detects `window.EduCmsNative?.ctsSerialConnect` and bypasses Web Serial for the ECBox Android device. The Phase-1 5-second status-poll loop (line 797+) drives auto-reconnect on cable-yank with 2s backoff. Native mode and Web Serial mode use the same `CtsParser`/`DaktronicsParser` pipeline — the bridge is parser-agnostic.

**Auto-celebration on score delta is real.** `SportsService.maybeAutoCelebrate()` is called from 5 sites: `adjustScore`, the CTS snapshot ingest path, the feed ingest path, the Daktronics snapshot path, and the timeout path. All use a pre-mutation snapshot of `prevScores` to compute the delta (Audit-Fix 1 comment at line 1266 is explicit about preventing aliasing). The `source` field ('auto', 'manual', 'preview') flows through to the `GameEvent` row and the CTS-cue-fired audit log.

**Feed-token ingest for Sportzcast / Scorebird is real.** `POST /api/v1/sports/board/:id/feed` is a real endpoint with: (a) per-game in-memory rate limiting before auth; (b) constant-time HMAC verification via `verifyFeedToken` against the game's live `feedTokenVersion`; (c) legacy bare-token backward compatibility (version 0); (d) optional structured tokens with expiry (`ttl > 0`). The operator copies the feed URL + token from `GET /sports/games/:id/feed-credentials` and hands it to their feed vendor (Sportzcast, Scorebird, or any custom integration). This is the open-feed-API pattern that lets any vendor push scores without a dashboard login.

**CTS heartbeat + manual-override fallback is real.** `sports-board.controller.ts:121` comment confirms: "board falls back to them [operator inputs] as soon as the CTS heartbeat goes stale." `SportsService.ingestCtsSnapshot` writes to `Game.stats.cts` (not `Game.homeScore/awayScore/clockMs`) — the operator's manual inputs in the Run console always win for the persistent state; CTS is a real-time overlay that degrades gracefully to the last operator-entered score when the USB cable is yanked.

**Per-sport widget parity is complete for the announced sports.** Verified registrations in `variants-register.ts`: football, basketball, baseball/softball, soccer, volleyball/tennis/pickleball, hockey/lacrosse/water polo, wrestling, track/swim/gymnastics leaderboard. All have `SportWidgets`, `SportElementWidgets`, and `MainScoreboardWidget`. Scorebug variants registered for CLOCK, TEXT, WEATHER, ANNOUNCEMENT, CALENDAR, STAFF_SPOTLIGHT, COUNTDOWN, IMAGE_CAROUSEL, TICKER (lines 726–733+).

**Console → scoreboard / ribbon / scorebug publishing is real.** The data flow: operator taps the Run console → `SportsService.adjustScore|callTimeout|clockAction|segmentChange` → `record()` appends a `GameEvent` → `SportsService.getBoard()` returns live game state + linked templates. The board page polls `GET /api/v1/sports/board/:id` at 750ms with a 1s in-memory cache + per-write invalidation. CTS snapshot flow: CtsBridge serial read → parser → `POST /cts-snapshot` → `ingestCtsSnapshot()` writes to `game.stats.cts` → board poll merges. The comment at sports.service.ts:39–47 correctly explains why there is no Redis pub/sub fan-out for game events (the `game:*` channel is not subscribed in the current `RedisService.psubscribe`), and why 750ms polling is intentional for this phase.

---

### Findings — §7 Sports Data

#### F7-1 (P1) — Daktronics 19 unverified fields need hardware validation before any athletic director relies on them

**Evidence:** `UNVERIFIED_OFFSETS` (daktronics/offsets.ts:236–260) lists 19 fields across football, basketball, and baseball that are "transcribed from the reference but NOT corroborated by a second source or a real console." These include:
- Football: `playClock`, `homePossession`, `guestPossession`
- Basketball: `shotClock`, `homePossession`, `guestPossession`, `homeBonus`, `homeDoubleBonus`, `guestBonus`, `guestDoubleBonus`
- Baseball: `homeAtBat`, `guestAtBat`, `homeHits`, `guestHits`, `homeErrors`, `guestErrors`, `batterNumber`

If any offset is wrong, the widget renders nonsense in a live game (e.g., shot clock showing random garbage). The verified fields (main clock, scores, period, down/distance, balls/strikes/outs) are sufficient for a basic working scoreboard, but the unverified fields are exactly the stats that differentiate a VenueOS scoreboard from a blank one.

**This is an honest assessment already embedded in the code** (the `verified` field exists precisely for this). But the UNVERIFIED_OFFSETS list needs to be surfaced to Greg as a pre-game-day validation task — connect a real All Sport console (or use Daktronics' RTD simulator) before selling Daktronics integration to a school.

**Fix:** Before any Daktronics sales pitch, run the parser against a real All Sport 5000/5500 console or Daktronics' own RTD test tool. Update `verified: true` for each confirmed field. Consider adding a `DaktronicsParser.getVerificationReport()` method that surfaces bad-checksum rate + which fields are still unverified, surfaced in the CTS bridge UI panel.

**Severity:** P1 for Daktronics customers; not a launch blocker for the K-12 + water-polo first customer.

---

#### F7-2 (P2) — Game pub/sub is polling-only; no WebSocket push for live board updates

**Evidence:** `sports.service.ts:39–47` explicitly documents that WebSocket fan-out for game events was attempted but does not work: "There is intentionally NO pub/sub fan-out for game-state events: an earlier draft published a signed `game:<id>` message on every write, but `RedisService.psubscribe` only listens on `tenant:* | group:* | device:*`, so the signed message landed on the bus and died — theater, not delivery."

The board page polls every 750ms. For a water polo game with a goal scored: the operator taps +1 → DB write → up to 750ms before the scoreboard updates. For a basketball shot clock at tenths precision, this is perceptible latency on the physical LED board. For the 5–10 Hz CTS snapshot path, the poll at 750ms is effectively the rate-limiting step (CTS data arrives faster than the board can render it).

**This is honest engineering** — the comment says "If a true WS-driven board lands later, register `game:*` on the RedisService psubscribe list." The existing infra supports this change in 1–2 hours. For a first live customer install (water polo, one venue), 750ms latency is acceptable. For a football scoreboard where 3 seconds of wrong score on the board during a fast-break is visible to 2,000 fans, it is borderline.

**Fix:** Register `game:*` in `RedisService.psubscribe`; emit a `GAME_UPDATE { gameId }` message on every `SportsService.record()` call; have the board page switch from polling to WS-triggered invalidation (still fetch via HTTP, just on event). Existing HMAC gate already covers `game:*` once registered. 2–4h change.

**Severity:** P2 for current water polo install (750ms acceptable); P1 if basketball/football with full-court LED walls is sold.

---

#### F7-3 (P2) — ECBox Phase 2–4 are in-progress / pending; first hardware bring-up is blocking the CTS path for Android kiosk deployments

**Evidence:** Tasks #136 (Phase 2 — hardware bring-up), #137 (Phase 3 — APK serial settings UI), #138 (Phase 4 — production dress rehearsal) are in-progress or pending. The Phase 1 native bridge code is complete, but without a real ECBox device + cable + APK sideload test, the end-to-end CTS → Android path is unverified in production.

The fallback (Web Serial via Chrome 89+ on a Beelink Windows mini-PC) is fully validated per task #164 (live CTS integration test). So there IS a working path today for the current water polo install. But the athletic director's intended production setup is ECBox (Android), not a separate Windows mini-PC.

**Severity:** P2 (workaround exists; affects Phase 4 production readiness)

---

#### F7-4 (P3) — `Game.stats` is an untyped JSON blob; TypedGameState (T3-1) pending

**Evidence:** `schema.prisma:2055`: `stats Json @default("{}")` — untyped. Task #159 (T3-1: Typed GameState per sport) is pending. `SportsService` reads/writes stats as `Record<string, unknown>` casts throughout (e.g., sports.service.ts:3243). The stat keys (`homeTimeouts`, `awayTimeouts`, etc.) are stringly-typed, meaning a typo in a stat key silently produces a wrong value rather than a compile-time error.

This is an architectural debt item, not a launch blocker. The code works correctly today because all the stat keys are in a small, well-tested service. But adding a new sport or a new stat field requires careful string matching instead of typed access.

**Severity:** P3 (architectural; no user-visible bug today)

---

#### KNOWN-OPEN (from REPORT.md M9): CTS parseInt safety — VERIFIED FIXED

**Verification:** `digitsToInt()` in `parser.ts:91–97` uses `parseInt(trimmed, 10)` followed by `Number.isFinite(n) ? n : 0`. The M9 finding referenced "parser.ts:95,133,503" — all three are this same safe helper or callers of it. There is no raw unguarded `parseInt` in the file. M9 is a false positive from the 2026-06-09 batch. Mark as solid.

---

#### KNOWN-OPEN (from REPORT.md): P0-6 Daktronics/Nevco RS485 costume — VERIFIED FIXED

**Verification:** Task #171 completed. The dropdown that previously showed RS485 options with no backend is gone. The current integration is the real `DaktronicsParser` + `POST /board/:id/cts-snapshot` endpoint. This is now genuinely not a costume. Mark as solid.

---

## Athletic Director Game-Night Grade: B+ → A- path

What an athletic director gets TODAY on game night with CTS water polo:

- CTS console plugged into Beelink mini-PC via USB-RS232: **works** (task #164 verified live)
- Clock ticks on LED ribbon: **works** (parser → API → 750ms poll → widget re-render)
- Goal scored → auto-celebration fires: **works** (both CTS snapshot path and manual +1 button)
- Sponsor rotation on ribbon: **works** (T2-9 frequency cap + impression log)
- Exclusions (penalty box countdown): **works** (CTS exclusion modules, up to 3 per team)
- Shot clocks per team: **works** (T2-1 cadence-derived)
- Timeouts: **works** (T1-4 + T2-10 + Daktronics timeout coupling)
- Manual override when cable yanks: **works** (CTS writes to `game.stats.cts`, operator inputs win)
- Phone-based operator control: **works** (mobile console, Sprint 13)

Gaps that would elevate to A:
- 750ms → sub-100ms board latency (F7-2 WebSocket fix, 2–4h)
- ECBox Android validated end-to-end (F7-3, hardware-dependent)
- Daktronics 19 unverified fields confirmed (F7-1, need real console)
- Streaming channels schedulable as playlist items (F6-1, medium lift)

---

## Summary Scorecard

| § | Sub-section | Coverage | D | UX | F |
|---|---|---|---|---|---|
| 6 | HLS player wiring | covered | B+ | B | B+ |
| 6 | YouTube / Twitch / Vimeo embeds | covered | A | A | A |
| 6 | RTSP / RTMP honesty | covered | B | B | B |
| 6 | DASH honesty | covered | B+ | B+ | B+ |
| 6 | Streaming-as-Asset scheduling | **N-A (gap, F6-1)** | — | — | C |
| 6 | Webcam URL widget | **N-A (gap, F6-2)** | — | — | N-A |
| 6 | NFHS Network | N-A (honest, V2) | — | — | N-A |
| 6 | Provider tier honesty | covered | B+ | B+ | A |
| 6 | Feed-rate multi-replica safety | gap (F6-3) | — | — | C |
| 7 | CTS Gen6 parser fidelity | covered | A | A | A |
| 7 | Daktronics All Sport parser | covered (19 unverified fields, F7-1) | A- | B+ | B |
| 7 | Sportzcast/Scorebird via open feed | covered | B | B+ | B+ |
| 7 | Genius Sports/Sportradar/MaxPreps/GameChanger | N-A (honest) | — | — | N-A |
| 7 | Auto-celebration on score delta | covered | A | A | A |
| 7 | Console → board/ribbon/scorebug | covered | A | A | A |
| 7 | ECBox3576 serial bridge | Phase 1 done; 2–4 pending (F7-3) | B | B | B |
| 7 | WebSocket board latency | gap (F7-2) | — | — | C+ |
| 7 | Per-sport widget parity | covered | A | A | A- |

---

## New Findings Ranked

| ID | Severity | Title |
|---|---|---|
| F7-1 | P1 | Daktronics 19 unverified fields need hardware validation before any AD relies on them |
| F6-1 | P2 | STREAMING widget not schedulable as a playlist item |
| F7-2 | P2 | Game board is polling-only (750ms); no WebSocket push |
| F7-3 | P2 | ECBox Phase 2–4 in-progress; Android CTS path not production-validated |
| F6-3 | P2 | Feed-rate in-memory limiter is per-replica (same class as H5 in REPORT.md) |
| F6-2 | P3 | Webcam URL widget does not exist |
| F7-4 | P3 | Game.stats is untyped JSON; TypedGameState T3-1 pending |
| F6-4 | P3 | BRIDGE-tier Docker image `venueos/hls-bridge` referenced but not published |

---

## Solid (verified from prior audits, not re-raised)

- KNOWN-OPEN M9 (CTS parseInt safety) — VERIFIED FIXED: `digitsToInt()` guards with `Number.isFinite`.
- KNOWN-OPEN P0-6 (Daktronics/Nevco RS485 costume) — VERIFIED FIXED: real `DaktronicsParser` + feed endpoint in production.
- CTS exclusion parsing correct for up to 3 slots per team.
- CTS cadence-derived `clockRunning` (T2-1) correctly avoids relying on display-string change.
- Feed token revocation via `feedTokenVersion` is a real, stateless mechanism.
- Auto-celebrate `prevScores` aliasing bug (Audit-Fix 1) is real and correctly implemented.
- CTS heartbeat graceful fallback to operator manual inputs is real.
- Scorebug variants (clock, text, weather, etc.) registered and routed in `WidgetRenderer`.
