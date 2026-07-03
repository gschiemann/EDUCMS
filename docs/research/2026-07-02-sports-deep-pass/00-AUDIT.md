# VenueOS Sports Venue Experience — Ranked Audit (2026-07-02, read-only, code-grounded)

Opus auditor, single-context, verified at HEAD `15a779ad`. Cross-checked against
2026-06-16 setup-revamp PUNCHLIST, 2026-06-21 console-fit, 2026-07-01 parity
audit, 2026-06-25 live-test, 2026-06-27 per-vertical. Trigger: Greg — "sports
venue workflow and picker and game scorer needs a ton of work...lots of
places" + the gallery screenshot critique ("lame, tiny text, plain black
backgrounds... need to work standalone or with integrations and be controlled
by the score keeper app").

## RANKED FINDINGS

### [P0-1] [scorer] Score/clock taps have NO optimistic update
`useGameControl` score/clock/segment/stats mutations have no `onMutate`
(use-api.ts:3127-3146) while ~20 screens-hooks in the same file do; the file's
own shotClock comment (:3263-3268) names the failure ("feels like the button
did nothing"). Every +1 waits a full RTT (300-900ms venue Wi-Fi) → double-tap
double-scores. Fix: optimistic cache writes + rollback, mirroring the
screens-hooks pattern. Effort S. NEW.

### [P0-2] [picker/costume] Sports templates render FABRICATED data on real screens
`GameStateProvider` mounts ONLY on /board route + CustomScoreboardScene
(board/[gameId]/page.tsx:4526, CustomScoreboardScene.tsx:180). The player
route renders template zones with no provider → `SwimLaneGridWidget` shows
SAMPLE_SWIM_EVENT fake swimmers incl. a DQ (SwimDiveWidgets.tsx:142-155,233);
`MainScoreboardWidget` self-plays EAGLES 62/TIGERS 58 (:19-28, comment assumes
"BUILDER ONLY"). Operator schedules a gallery board to a screen (normal
signage mental model) → invented athletes shown to a real crowd. Root of
"not set up to be tied into sports systems." Fix: (a) no-provider guard on
live surfaces (empty shell + "BIND A GAME" callout), (b) gameId binding config
+ PropertiesPanel "Bind to game" picker wrapping the zone in GameStateProvider.
Effort M. NEW.

### [P0-3] [scorer/costume] Diving: console cannot produce judge scores
`DiveJudgesPanelWidget` reads `stats.judgeScores` (SwimDiveWidgets.tsx:974-977)
but DIVING declares no such stat (api-types sports.ts:1004-1013) and the ONLY
producer is the static template editor (PropertiesPanel.tsx:5397). Live boards
also render a fabricated dive group "REVERSE 1½ SOMERSAULT TUCK"
(SwimDiveWidgets.tsx:983 `c.diveGroup ?? sample`). The judge loop (diver up →
judges flash → award → running total) is impossible; operator does drop-high/
low × DD math on paper. Fix: console diving judge pad (roster-tap diver →
0-10 half-step chips per judge → auto-compute via existing computeDiveScore →
write judgeScores + append to stats.results); never fabricate diveGroup live.
Effort M. NEW.

### [P1-4] [scorer] Lane pad: wall board shows NOTHING mid-heat
All lane rows are local state; only `nextHeat()` writes stats.results
(LanePadSection.tsx:147-149, 175-204) → natatorium board is one heat behind in
manual mode (most HS pools; CTS is the only live path). Fix: debounced
provisional in-progress result commit on mark blur; Next heat finalizes.
Effort S/M. NEW.

### [P1-5] [scorer] Lane pad Undo destroys the typed heat
`nextHeat()` clears the grid after saving (:203); `undoLastSave()` (:206-210)
reverts stats.results but never restores rows → 8 typed times gone mid-meet.
Fix: snapshot rows in lastSaved; restore on undo. Effort S. NEW.

### [P1-6] [scorer] Meet results editor fires a network PATCH per keystroke
Every onChange calls updateEntry → write() → ctl.stats.mutate
(console page.tsx:5392, 5522-5586): "Katie Ledecky" = 13 PATCHes of the whole
results array; racy last-writer-wins; inputs 36px (< 44px floor). Affects
diving/gym/cheer/golf/XC. Fix: local draft + commit-on-blur/Enter (the
GameScopeText/LanePad pattern); 44px inputs. Effort S. NEW.

### [P1-7] [picker] Water-polo ribbon recommended to EVERY sport
LayoutsPanel hardcodes `suggested: 'sports-cts-water-polo-ribbon'`
(page.tsx:6987-6991, comment admits it) + amber warning steers every sport to
"CTS Water Polo Ribbon" (:7050-7059); all three pickers are bare selects with
no sport filtering (:7018-7031). Fix: per-sport suggestion map + sport-aware
ordering + generic copy. Effort S. NEW (adjacent to punchlist-C, partial).

### [P1-8] [workflow] Games have no date/time
No scheduledAt on Game (schema:2077+); create modal never asks; list is
ungrouped/undated; COUNTDOWN/PreGameScene have no target; no auto
SCHEDULED→PRE_GAME. Fix: additive scheduledAt migration + optional create/
Setup field + LIVE-first-then-upcoming list. Effort M. NEW.

### [P1-9] [post-game] Meet sports have no FINAL or PRE_GAME presentation
DefaultBoardScene routes laneGridDefault sports to the grid across every
status (board page.tsx:4481-4542); FinalScene (:3106)/PreGameScene unreachable
for them. Meet ends → last heat forever, no winner moment. Fix: status scenes
for laneGrid sports at PRE_GAME/FINAL (dual-meet points exist). Effort S. NEW.

### [P1-10] [board] Portrait LEDs letterbox all meet boards
`portrait = vp.w < vp.h && !isLeaderboard` (board page.tsx:4496) + laneGrid
always scales a 1920×1080 base → on the customer's real 960×1080 wall a meet
board is a 540px strip, text at 0.5×. Fix: portrait base for lane grid /
leaderboards; drop the carve-out. Effort M. NEW for sports (class known from
emergency canvas-fit).

### [P1-11 design] The six gallery boards are visually flat
SwimLaneGrid: 30px names/32px times/22px headers fixed inside ~110px rows on
1920×1080 (SwimDiveWidgets.tsx:302-305,337,343-350) — text doesn't scale with
row height; flat near-black bgs (#050b16/#0a1020/#0a0714/#0a0f1d,
sports-presets.ts:605,625,649,799); team color = 8px sliver (:336); Halftime
ships an EMPTY sponsor carousel (urls: [], :802). Violates the repo's own
gold standard (MainScoreboardWidget.tsx:9-11,30-32 "DO NOT regress to the
muted-panel look"). Fix: type scales with row height (FitOneLine pattern),
team-color washes + accent gradients per approved HS language, seeded sponsor
art. Effort M. NEW.

### [P1-12] [workflow] Gallery bind dead-end
All six preset descriptions say "Bind a meet/game" (sports-presets.ts:600,620,
644,663,678) but binding exists only via New Game or in-game Layouts panel —
no gallery/builder affordance. Fix: "Use for a game →" action on SCOREBOARD/
RIBBON/SCOREBUG cards. Effort S. NEW.

### P2s
- Sponsors vocab split: in-game row plain-English (fixed), Sponsors page still
  "Rotation weight" slider (sports/sponsors/page.tsx:423, :207). Port tier
  control. S. KNOWN(punchlist-G half).
- EndSetMacro = 4 sequential non-atomic mutations (page.tsx:2653-2668) →
  half-ended set on mid-sequence failure. Server-side end-segment macro. S/M. NEW.
- Volleyball: no per-set score history (only set counters) → FINAL board can't
  show 25-23/23-25/15-11. stats.setHistory on EndSetMacro + board columns. M. NEW.
- New-game modal heavier than happy path (18-sport grid no search; 3 layout
  dropdowns duplicate Setup panel; page.tsx:377-506). Collapse behind
  Advanced + sport search/recents. S. NEW.
- Game list scales badly (flat grid, no LIVE-first, no dates, no search;
  :138-218). Order LIVE→upcoming→FINAL, collapse past. S. NEW.
- Known-open per-sport depth: golf/gym/cheer/XC LeaderboardScene shells (4
  PARITY-DEBT markers, sport-board-parity.test.tsx:292-310); meet ribbon line
  not tiles; swim scorebug context-label only. ALL KNOWN (#270).

## COSTUME CHECK — the six screenshotted presets

Mechanism: all six live-render ONLY via CustomScoreboardScene's
GameStateProvider on /board|/ribbon|/scorebug as a game's surface template
(CustomScoreboardScene.tsx:180); CTS reaches all via applyCtsOverlay
(GameStateContext.tsx:104-107) + swim timing feed writes the same
stats.results (swim-timing-feed.ts:17-20). Every other context (builder,
thumbnail, playlist→player) = sample data (P0-2).

| Preset | Bound? | Standalone+CTS | Bind | Design |
|---|---|---|---|---|
| Swimming Lane Board (:596-609) | YES via game-surface path | lane pad per-heat only (P1-4); CTS yes | B | D+ |
| Track Lane Board (:616-638) | same widget | same | B | D+ |
| Diving Leaderboard (:640-652) | YES reads stats.results | hand-typed totals (P1-6); no CTS dive feed | B | D+ |
| Swim Relay Exchange (:659-672) | PARTIAL — no console producer for leg data; laneNumber fixed config | CTS-or-nothing | C | C- |
| Diving Judges + Leaderboard (:674-687) | HEADER ONLY — judgeScores has NO producer (P0-3); fabricated diveGroup live | impossible standalone | D | C- |
| Halftime Board (:790-806) | N/A by design; NOT wired to Sponsors library (urls: []) | standalone only | C | D |

Verdict: real, live-capable widgets wearing costume presentation — binding
exists but invisible/single-path; visuals regressed to the banned muted-panel
look.

## Prior-punchlist verification
2026-06-16 PUNCHLIST: 8/13 genuinely FIXED (A,B,D,E-scroll,I,J,K,L); partial
C,E-crowd,F,G; H unverified-deep. 2026-07-01 parity: #1,#2,#5 FIXED; #3 half;
#4 partial; #6 open. Total verified-fixed: 11.

## Five-first for a Friday-night volunteer
1. Optimistic score/clock (P0-1) 2. Per-sport surface suggestions (P1-7)
3. Lane pad live publish + undo restore (P1-4/5) 4. Diving judge pad (P0-3)
5. No-fake-data guard + "Use for a game" (P0-2 + P1-12).

## Coverage note (agent's, honest)
Deep-read: console scorer core (7,687-line page), LanePad, board scene
dispatch, SwimDiveWidgets, GameStateContext, presets, useGameControl,
scorebug, ribbon meet branch, parity test, 7 sport defs, timing feed, schema.
NOT examined: CueLaunchpad/ShowCaller/PA internals, SponsorPanel accounting,
celebration art, ribbon reel logic, RosterPanel depth, sports.controller auth,
SurfaceHealthPills, punchlist-H depth. No live rendering/DB/device — visual
grades inferred from code (px values, layout math).
