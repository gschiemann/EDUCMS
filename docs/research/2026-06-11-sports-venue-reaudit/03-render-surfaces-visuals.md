# Render Surfaces + Visuals — Sports Venue Re-Audit (2026-06-11)

**Auditor scope:** what the crowd sees — `/board/[gameId]`, `/ribbon/[gameId]`, `/scorebug/[gameId]`, `/overlay/[gameId]`, `apps/web/src/components/widgets/sports/**` (incl. celebrations), graded for DESIGN / UX / FUNCTIONALITY against the first live customer (water polo, CTS WTTC-1 → Goodview EP6N → LED) and the "would this look at home on ESPN / a D1 arena" bar.

**Method:** full code-trace of all 4 routes + 10 widget/celebration modules, CLAUDE.md rule-#10 greps (BSD-safe re-run after a `\b` false-negative risk), caller-tracing of every safeguard (CTS merge, cue dedup, sponsor caps, dynamic-name injection), live curl of all 4 routes on venue-os.app (all 200), dedup against 2026-05-27/05-29/06-01/06-04/06-11 sports research. **Deferred:** live Playwright screenshots of each surface (budget) — the 06-04 cue verification carries fresh screenshot evidence (`scratch/wp-cues/after-v2-*.png`) and routes are confirmed live; everything else here is code-traced to the exact line.

---

## Page-1 coverage table (assignment areas × lenses)

| Area | Coverage | DESIGN | UX | FUNCTIONALITY |
|---|---|---|---|---|
| `/board/[gameId]` in-venue scoreboard (2,608 ln) | covered | A- | A | A- (B for water polo: no shot clock) |
| `/ribbon/[gameId]` fascia/LED (3,272 ln) | covered | A- | A | A- (B for water polo: no shot clock / exclusion countdown in score zone) |
| `/scorebug` + `/overlay` broadcast (shared ScorebugSurface, 747 ln) | covered | B+ | A | A- |
| Custom-template path (CustomScoreboardScene + GameStateContext) | covered | A- (renders any canvas) | B+ | **B-** (CTS merge gap, P1) |
| CTS widget family (CtsScoreboard, CtsRibbonWidgets) | covered | B | B- | **C+** (sample-data falsehood off-player, P1) |
| Generic sport widgets (SportWidgets, SportElementWidgets[.sports], MainScoreboardWidget, RibbonScorebugWidgets, FitOneLine) | covered | A- | A- | A- |
| Celebrations (v2 pack, deck, RibbonCelebrationStrip, CelebrationWaterPoloGoal, cues) | covered | A- | A | A- |
| Sponsor rotation + T2-9 cap | covered | B+ | A | A |
| §15 Taurus / Chromium-83 on these exact surfaces | covered | — | — | **A (clean sweep)** |
| §6 Streaming slice (OBS/vMix browser-source surfaces) | covered | B+ | A | A- |
| §7 Sports-data slice (freshness, CTS merge on render side) | covered | — | A- | B+ |
| §19 Editability slice (auto-fit, live-vs-override on MainScoreboardWidget) | covered (render side only; builder UX is another auditor's lane) | A- | B+ | B+ |
| Sprint indicator (water polo) | covered — **N-A-ish**: no F872 channel for sprint; not standard on CTS boards | — | — | P3 polish |

No silent scope-downs. Live screenshot pass deferred with reason above.

---

## 1. `/board/[gameId]` — the in-venue video scoreboard

**Architecture (verified):** fixed 1920×1080 scene + `transform:scale` (page.tsx:2566-2577), 750 ms poll of public `GET /sports/board/:id` (`POLL_MS = 750`, :149), local 100 ms clock projection from `clockMs/clockUpdatedAt/clockRunning` anchor with server-skew correction (:471-487), cold-boot paint from `readBoardCache` (:2314-2317), status-specific scenes (PreGame VS / Halftime / Final-with-winner-accent :2579-2586), CTS overlay via `applyCtsOverlay` on both legacy and custom-template paths (:2375-2378, :2524-2529).

**DESIGN A-.** Genuinely broadcast-literate: 264 px tabular-numeric scores with winner glow (:450-460), team-color gradient washes + radial logo halos, pulsing LIVE pill, possession marker beside the team name "the way every broadcast scoreboard shows it" (:417-421), penalty boxes with cap number + red-under-10s countdown (:279-309), spotlight band with stat columns, sponsor footer with crossfade. What keeps it off the A/ESPN tier (vs ScoreVision):

- **Single typeface identity.** Inter everywhere. ScoreVision's pitch is per-school look packs; we have one look. Fredoka exists only on `MainScoreboardWidget`.
- **Emoji as iconography.** `def.emoji` in the header (:674), 🏈 possession marker (:419), 🎉 cue emoji. Emoji render differently per platform and read consumer-grade at 8-foot distance. A D1 board uses drawn vector marks.
- **No score-change animation.** Digits swap with zero transition. Daktronics/ScoreVision animate score changes (pop/odometer). This is the single most visible "dead pixel of design" on an otherwise live board.
- **No idle motion.** Outside celebrations the scene is fully static; D1 boards breathe (subtle sheen/particle).
- `PreGameScene` hardcodes **"TONIGHT"** (:1405) — a 2 pm Saturday game says TONIGHT.
- "VENUEOS" watermark in the center column (:840) — fine for now; attribution decision is task #52.

**UX A.** Paste-URL public route, auto-scale to any canvas, graceful 404/loading, never blanks on poll failure (keeps last frame + cache).

**FUNCTIONALITY A- (water polo: B).**
- **Shot clock renders ONLY for basketball** — the projection state is sport-agnostic (:491-516) but the render is gated `def.key === 'basketball'` (:783). Football got its own play-clock block (:809). **Water polo — whose `WATER_POLO.shotClock = { full: 30, short: 20 }` is annotated "THE must-have for the water polo beta tester" (packages/api-types/src/sports.ts:506-512) — gets nothing on the default board.** See finding F-2.
- Exclusions: solid. `PenaltyTimers` reads `stats.penalties` (which the CTS snapshot handler populates from console exclusions with `source:'cts'`, sports.service.ts:3974-4016), projects each anchor locally at 100 ms, shows `#cap MM:SS`, red ≤10 s, caps at 4 visible (water polo max is 3/team — fine).
- Cue pipeline: per-id seen-set, first-load suppression, BOARD/RIBBON targeting, **06-05 auto+manual dual-fire dedup present** (key + team-wildcard, 6 s window, :2240-2350), queue pump with per-kind hold times, audio best-effort with cleanup, pregame-intro takeover (T2-4), custom media overlay vs takeover modes.
- **Celebration overlay now mounts on the custom-template path too** (06-05 fix, :2530-2547) — verified present.

## 2. `/ribbon/[gameId]` — LED fascia / ribbon

**Architecture (verified):** two-layer model documented against real arena practice (score anchor that never moves + rotating held-static "looks", :10-33), score-anchor recurrence for bowl wraps (auto from aspect ÷ 9, `?score=N` installer pin, operator-saved repeat, ceiling `floor(w/700)`, :1081-1099), `?canvas=WxH` demo letterbox (:716-726), media-scroll marquee mode with measured-sequence px-literal keyframes (no black-gap regression, :1356-1433), viewport-relative scroll speed calibration (:1396-1417), looks rotation keyed off a stable `looksKey` so clock ticks never reset dwell (:806-852).

**DESIGN A-.** The strongest researched surface: `readableInk` luminance floor so Raiders-black team colors stay legible on the near-black strip (:318-333), digit-count-aware score sizing (:1562-1567), separate status-line scaler so long nicknames never force the score smaller (:1574-1579), FINAL/PREGAME/spotlight leads, number-vs-label color split in situational text (:2010-2032). Same typography/emoji caveats as the board (CueBurst falls back to emoji).

**UX A.** Operator content toggles genuinely honored end-to-end (the 05-27 "none of my settings work" early-return fix is in place and gated correctly, :941-1072); never-blank fallback prompt; spotlight overlays both modes.

**FUNCTIONALITY A- (water polo: B).**
- **ScoreZone shows score + nicknames + segment + clock only.** No shot clock, no exclusion countdowns, for any sport. Water polo's `ribbonSituational` falls to the generic stat-chip branch — "HOME EXCLUSIONS 3" as a **cumulative count in a rotating look**, not the live :20 box-time countdown a crowd needs (and the live data exists in `stats.penalties`). For the first customer, whose ribbon may be the *primary* scoreboard, see findings F-2/F-4.
- Verified intact: **06-06 celebration de-tiling** (takeover renders `segCount={1}, segWf=vp.w` on BOTH looks and media paths, :1016-1021, :1175-1188); **06-05 cue dedup** (:648-764); **per-segment CelebrationErrorBoundary** with CueBurst fallback (the "crashes the entire screen" customer fix, :257-273, :3020-3031); v2 pack default with v1-strip fallback chain (media → v2 iframe → strip → CueBurst — nothing ever renders blank).
- **Canvas math vs the 1-6 × 320×1080 daisy-chain:** scale/anchor logic correct at 3-6 panels (960-1920 px). At **1 panel (320 px)** `scoreZoneW = max(360, …) = 360 > 320` → content zone width 0 and the score zone clips 40 px (:1095-1099). 2 panels leaves a 280 px content zone. Finding F-6.

## 3. `/scorebug` + `/overlay` — broadcast surfaces

Both delegate to shared `ScorebugSurface.tsx` ("can never drift apart" — verified: corner route docks to viewport, overlay route pins a fixed 1920×1080 canvas). `useScorebugData` applies `applyCtsOverlay` (:353). Renders **nothing** pre-data ("an OBS overlay must never flash a loading box onto a live broadcast" — correct instinct). Compact 100 px bug with mirrored team blocks, situational pill via the same shared `SituationalRow` the board uses, celebration toast with corner-aware animation. Custom scorebug templates supported.

**DESIGN B+** (clean, professional, not yet a branded broadcast package), **UX A** (browser-source paste + `?pos/?scale/?home/?away`), **FUNCTIONALITY A-** (no shot clock on the bug — water polo broadcasts want it; minor).

## 4. Custom-template path — the two real defects (P1s)

### F-1 (P1): GameStateProvider never applies the CTS overlay on its own polls
`GameStateContext.tsx:78-101` — the provider re-polls `/sports/board/:id` every 750 ms and `setSnapshot(json)` **raw**. `applyCtsOverlay` has exactly four callers (grep-verified): board page, ribbon page, ScorebugSurface, and nobody else. The server *intentionally* never writes CTS score/clock/segment into the operator columns (sports.service.ts:3950-3960 design comment; only exclusions→`stats.penalties` and timeouts are synced). The board page passes a merged `initial`, **but the first provider tick (≤750 ms later) replaces it with unmerged data** — the board page's own comment (board page.tsx:2514-2520, "we trust the helper to be idempotent") documents the false assumption: the provider never calls the helper at all.

**Consequence:** with a live CTS console, every `SCORE_HOME / GAME_CLOCK / GAME_SEGMENT / sb-*` widget inside a custom scoreboard/ribbon/scorebug template shows the operator-input columns (frozen/divergent) while the legacy hardcoded scenes show live console data. Currently masked only because the WTTC Gen7 decode isn't wired yet (manual path → operator columns ARE the truth); it detonates the day the new `packages/scoreboard-cts` decoders go live. **Fix:** one line — apply `applyCtsOverlay(json)` in the provider's tick (the helper is side-effect-free and idempotent).

### F-3 (P1): CTS_* widgets silently render SAMPLE scores everywhere except the player route
`CtsRibbonWidgets.tsx:97-124` and `CtsScoreboard.tsx:80-110` subscribe **only** to the `edu:cts-game-state` window event, dispatched at exactly one site: `apps/web/src/app/player/page.tsx:3991` (WS GAME_STATE). They never read `GameStateContext`. Rendered via a custom template on the public `/board` / `/ribbon` routes (CustomScoreboardScene → WidgetPreview), **no one dispatches the event and `snap ?? SAMPLE` paints fake data — clock 7:42, Q3, score 4-3, a fake "#7 EXCL 12s"** — distinguished only by an 8 px grey dot (CtsRibbonWidgets:204-221). That is a ships-a-falsehood trap on a crowd surface. Two widget families with overlapping names ("CTS Score" vs "Home Score") on different data planes is also an operator-confusion design flaw. **Fix:** make `useCtsGameState()` fall back to `useGameState()` (poll plane) when no event has arrived, and make the "not live" state unmistakable (dim + SAMPLE watermark) rather than a grey dot.

Also noted on this path: the page polls the endpoint AND the provider polls it again — 2 × 750 ms fetches per custom-template screen (F-11, P3); template hot-swap rides the `embedded` prop correctly (the 05-26 401 fix is in place — public surfaces never fetch auth-gated `/templates/:id`).

## 5. Water polo widget completeness vs a real water polo scoreboard

| Real-board element | board (legacy) | ribbon (legacy) | scorebug | custom template | player+CTS |
|---|---|---|---|---|---|
| Game clock (tenths <1:00) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Period / OT | ✓ | ✓ | ✓ | ✓ | ✓ |
| Scores | ✓ | ✓ | ✓ | ✓ (F-1 caveat) | ✓ |
| **Shot clock (30/20)** | **✗ basketball-gated** | **✗** | ✗ | ✓ (`sb-shot-clock`) | ✓ |
| Exclusion countdowns (≤3/team) | ✓ (4 slots, cap#, red) | **✗ count-only text** | ✗ | ✓ (`sb-penalty-*`) | partial (CtsScoreboard shows only 1st — F-5) |
| Timeouts left | situational/chips ✓ | situational look ✓ | situational ✓ | ✓ | ✓ |
| Cap numbers | ✓ (penalties, roster looks) | ✓ | — | ✓ | ✓ |
| Sprint indicator | ✗ everywhere — no F872 channel exists for sprint on CTS; treat as polish (F-13) | | | | |

## 6. Celebrations — quality + the 06-04 fix

**06-04 dynamic-name fix: INTACT (verified end-to-end).** `celebrationLiveDataFromCue` (celebration-assets.ts:180-206) builds `{player:{number,name}, score, context}`; both call sites pass it — board page.tsx:1876-1885 and ribbon v2 path page.tsx:2913-2920; the v1 strip path independently carries `scorerName/scorerNumber` (buildRibbonStripConfig, ribbon:2434-2435); `/celebrations/v2/{launcher.html, engine.js, cues-waterpolo.js}` exist on disk. 06-04 doc's own verification (32/32 WebKit celebration tests, before/after screenshots) stands.

**Quality:** board CueOverlay is a phased broadcast moment (shockwave rings, energy glow keyed to team color with `hexA` hex-validation fallback, diagonal sweep, confetti mixing both team colors, frozen-score lower third with mask wipe, sponsor co-brand line) — all transform/opacity. RibbonCelebrationStrip is a true ribbon-native 3-column layout (motif | title+scorer | scoreline) with height-derived px sizing, per-instance keyframe ids, luminance-aware ink, and water-polo-specific copy ("EXCLUSION / 20-SECOND PENALTY"). The deck registry has waterpolo-save/-exclusion/-powerplay with sport-aware key resolution (handles `water_polo`/`water-polo`/`waterpolo` — the 05-27 underscore bug class is closed). Cue iframes are sandboxed `allow-scripts` only. Ribbon correctly never plays cue audio (no speakers); board does, best-effort with cleanup.

**Dead path (F-10, P3):** `CelebrationWaterPoloGoal` (the design-day Canvas2D cinematic) is now reachable only via `pickCinematic`, which the ribbon deprecated on 05-27 (`eslint-disable no-unused-vars`, ribbon:2520-2533) — the v2 pack superseded it. The source comment itself says "if no one references it after the next ship, delete it." Time to decide.

## 7. Sponsors — T2-9 verified both sides

Client: sliding 60-min frequency-cap window + flight-end recheck on **both** board (:565-635) and ribbon (:822-894), weight-expanded slots (1-10), round-robin bucket mixing (never 3 sponsors in a row), impression beacon with `surfaceKind`. Server: `POST /sports/sponsors/:id/impression` is the only unguarded method, rate-limited 80/10 s/game in-memory (sponsors.controller.ts:31-65). Caveat (F-12, P3): the cap window lives in a `useRef` — a kiosk reload resets it; the server impression log is the authoritative count for sponsor billing, so this is acceptable, but document it for the sales team. Sponsor render quality: transparent logos sit on the banner (no white-sticker look), natural aspect, "PROUD SPONSOR" eyebrow — B+ (no animated sponsor transitions beyond crossfade/marquee).

## 8. §15 Taurus / Chromium-83 — clean sweep (A)

Rule-#10 greps run on exactly `apps/web/src/app/{board,ribbon,scorebug,overlay}` + `components/widgets/sports/**`:
- `inset:\s*0|inset(-x|-y)?-[0-9]` → **0 hits** (exit 1).
- plain `gap-` (Tailwind) → **0 hits**; CSS `gap:` → **0 hits** (re-run with BSD-safe plain patterns after the `\b` false-negative risk; non-empty-input sanity check passed against `components/dashboard`).
- `backdrop` → only comments asserting its absence.
- Every animation traced is transform/opacity; marquee keyframes are px-literal (no CSS-var-in-keyframe); `RibbonMediaScroll` even try/catches `ResizeObserver` for ancient WebViews. `FitOneLine`/`useMeasuredHeight` use RO unguarded — RO is Chrome 64+, inside the 83 floor, fine.
- One honest nuance, correctly documented in-file: `CtsScoreboard`/`CtsRibbonWidgets` note that CtsBridge itself needs Web Serial (Chrome 89+) but keep widget styles conservative anyway.

## 9. FitOneLine / FitBox — overflow behavior (A-)

Deterministic downscale-only `transform:scale` fit against both width and height (96 %/94 % padding factors), large fixed base font so scale ≤ 1 (crisp), `document.fonts.ready` re-measure, RO + rAF + 500 ms safety poll, no binary-search feedback loop (FitText's documented failure). Long team names shrink indefinitely rather than clip/wrap — correct trade-off for scoreboard zones (and ribbon/board name paths separately cap via `teamNick`/`teamCode` at 14 chars). `autoShrink:false` honors explicit operator font sizes. Used by SportWidgets, SportElementWidgets(.sports), RibbonScorebugWidgets, BuilderZone — genuinely the standard primitive it claims to be.

## 10. Data freshness per surface

| Surface | Transport | Cadence | Clock smoothing |
|---|---|---|---|
| board / ribbon / scorebug / overlay | HTTP poll (public) | 750 ms | 100 ms local projection, server-skew corrected |
| custom template (any surface) | page poll + provider poll | 2 × 750 ms (F-11) | 100 ms projection |
| player route CTS widgets | signed WS GAME_STATE → window event | ~5 Hz | console-driven |
| cues | ride the 750 ms poll | ≤750 ms to surface | snapshot frozen server-side at fire |

750 ms poll + anchor projection is a sound, venue-scale design (sub-second sync, drift-free clocks, graceful offline). The broadcast-grade upgrade (WS push to render surfaces for <250 ms moments) is a competitive nicety, not a defect.

---

## Findings (ranked)

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| F-1 | **P1** | Custom-template surfaces drop CTS console data after the first poll — GameStateProvider stores raw `/sports/board` JSON, never `applyCtsOverlay`; server intentionally never writes CTS into operator columns. Board comment documents the false assumption. Masked today (manual path) — breaks the moment the Gen7/WTTC decode wires up. | GameStateContext.tsx:86-88; cts-merge.ts callers grep (4 sites, no provider); sports.service.ts:3950-3960; board page.tsx:2514-2520 | Apply `applyCtsOverlay` in the provider tick (idempotent). Add a unit test: provider snapshot equals page `view` under fresh CTS. |
| F-2 | **P1** | Water polo shot clock — "THE must-have for the water polo beta tester" — never renders on the default board (render gated `def.key === 'basketball'`), nor in the ribbon ScoreZone, nor on the scorebug. | board page.tsx:783; ribbon ScoreZone:1512-1710; sports.ts:506-512 | Render the existing `shotMs` block for any sport with `def.shotClock` (board); add a compact SC readout to ScoreZone when `stats.shotClock` is live. |
| F-3 | **P1** | CTS_* widget family (CtsScoreboard + entire CtsRibbonWidgets set) renders fake SAMPLE data (7:42 / Q3 / 4-3 / fake exclusion) on any surface except the player route — only an 8 px grey dot distinguishes it. Falsehood-class on a crowd surface; also never falls back to the in-context polled game state. | CtsRibbonWidgets.tsx:97-124 (+72-83 SAMPLE); CtsScoreboard.tsx:80-110,134; dispatcher only at player/page.tsx:3991 | `useCtsGameState()` falls back to `useGameState()`; replace grey dot with an unmistakable non-live treatment; consider merging the two widget families. |
| F-4 | P2 | Legacy ribbon gives water polo no live exclusion countdowns — only a cumulative "HOME EXCLUSIONS 3" text in a rotating look, while the per-penalty live data already exists in `stats.penalties` (CTS-sourced included). | ribbon ribbonSituational:473-481; sports.service.ts:3974-4016 | Add a penalty chip strip to ScoreZone (or a dedicated look with live countdown), reusing the board's `PenaltyTimers` projection. |
| F-5 | P2 | CtsScoreboard shows only the FIRST exclusion across both teams (`homeExclusions[0] || awayExclusions[0]`); water polo runs up to 3/team concurrently. | CtsScoreboard.tsx:135-137, 222-253 | Render up to 3 per side (the 480×208 canvas has room on the bottom row). |
| F-6 | P2 | Daisy-chain canvas edge: at 1 panel (320×1080) the ribbon's 360 px score-zone minimum exceeds the canvas → content zone width 0, score clipped 40 px; 2 panels leaves only 280 px of content. | ribbon page.tsx:1095-1099 | Clamp `scoreZoneW ≤ vp.w` and stack the score vertically below ~420 px widths. |
| F-7 | P3 | "TONIGHT" hardcoded in the PreGame VS divider — wrong for day games. | board page.tsx:1396-1406 | Derive from scheduled start (TODAY/TONIGHT/date) or drop. |
| F-8 | P3 | Emoji iconography on crowd surfaces (header `def.emoji`, 🏈 possession, 🎉 cue fallback) reads consumer-grade and renders platform-dependently — the most visible gap vs ScoreVision. | board page.tsx:674,419,2053 | Vector sport marks (one SVG set, theme-tintable). |
| F-9 | P3 | No score-change animation anywhere — digits hard-swap. Daktronics/ScoreVision animate score changes; it's the moment the whole crowd looks at the board. | board TeamPanel:448-460; ribbon ScoreZone:1622-1650 | Transform/opacity pop or odometer on score delta (Chromium-83-safe). |
| F-10 | P3 | CelebrationWaterPoloGoal (design-day cinematic) is dead code on the live ribbon path — only reachable via deprecated `pickCinematic`. | ribbon page.tsx:2520-2533,2583; import :100 | Delete or fold its art into the v2 pack; keep the MIT-attributed reference if ported. |
| F-11 | P3 | Custom-template surfaces double-poll `/sports/board` (page + provider) — 2.6 req/s/screen. | board page.tsx:2311-2364 + GameStateContext.tsx:78-101 | Pass the page's polled data down (provider accepts a `snapshot` prop) or share a fetch cache. |
| F-12 | P3 | Sponsor frequency-cap window is per-pageload (`useRef`) — kiosk reload resets the client cap. Server impression log is authoritative, so acceptable; document for sponsor billing. | board page.tsx:565; ribbon page.tsx:825 | Persist window in localStorage alongside the board cache, or note as designed. |
| F-13 | P3 | No sprint/possession indicator for water polo. Genuinely minor: CTS F872 has no sprint channel; most pool boards don't show it. | grep "sprint" → only Sprint-13 comments | Optional arrow widget driven by operator console. |

## KNOWN-OPEN (verified, already documented elsewhere — not re-reported)
- The serial **decode layer** defects (Gen7/WA-2 missing in bridge wiring, legacy framing, F872 channel map) are the 06-11 buildout's known plan; the new `packages/scoreboard-cts/src/{grid,classic,gen7}` is intentionally unwired. Out of this lane.
- Console-side cue workflow (tap-cue → pick-player → fire) verified live on 06-04 with screenshots — treated as solid here.

## Solid (verified safeguards, with callers)
- **Taurus rule-#10 sweep clean** on all four routes + every sports widget (inset/gap/backdrop: 0 hits; sanity-checked non-empty input).
- **06-04 dynamic-name fix intact end-to-end** (launcher `d` param ← `encodeLive` ← `celebrationLiveDataFromCue` ← board:1884 + ribbon:2919 + strip config scorer fields).
- **06-05 dual-fire cue dedup** present and identical on board and ribbon (key + team-wildcard, 6 s).
- **06-06 celebration de-tiling** intact — takeover renders once full-width on both ribbon paths; score anchors still recur.
- **Per-segment CelebrationErrorBoundary** with CueBurst fallback (the "crashes the entire screen" incident can't recur on this path).
- **T2-9 sponsor caps** enforced client-side on both surfaces + rate-limited public impression endpoint; weight + flight-window + round-robin mixing all real.
- **CTS merge** applied on all three legacy public surfaces with a shared helper, exclusions→penalties + timeouts synced server-side, 5 s freshness window using server time (clock-skew-proof).
- **401-proof public templates** (embedded template passthrough), **cold-boot cache** on board + ribbon, **never-blank** ribbon, **OBS-safe never-flash** scorebug.
- All four routes live on venue-os.app (HTTP 200).
- FitOneLine/FitBox: deterministic, crisp, Taurus-safe auto-fit standard, with explicit-size escape hatch.
- Defensive color plumbing everywhere (`hexA` validation fallback, `readableInk` luminance floor, `pickTextOn`).

## What separates this from ScoreVision visually (the honest gap list)
1. **Typographic identity** — one font (Inter) + Fredoka on a single widget vs sellable per-school look packs. Add 2-3 curated display faces (slab athletic, varsity serif, mono-LED) wired to BrandKit.
2. **Score-change motion** (F-9) and **idle atmosphere** — our board is static between moments.
3. **Vector sport iconography** (F-8) — emoji is the tell.
4. **Shot clock on default surfaces** (F-2) — table stakes for water polo/basketball venues.
5. Where we're already *ahead* of the mid-market: score-anchor bowl recurrence, luminance-guarded team theming, celebration choreography with live data injection, operator-proof fallback chains, and a real CTS merge design. The bones are D1; the wardrobe is HS varsity.
