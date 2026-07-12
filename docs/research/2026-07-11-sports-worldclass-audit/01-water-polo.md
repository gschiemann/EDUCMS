# Water polo — world-class audit

> Auditor: single Opus agent (one-at-a-time cadence, 2026-07-12). Read-only,
> file:line-cited, graded against a Daktronics/ScoreVision-class production.
> First-real-customer sport — highest bar.

## Grades
Design: **A-** — the board is genuinely pro-grade (dedicated exclusion panel, 88px shot clock with tenths under 5s, derived power-play state, quarter-by-quarter line score, cinematic goal hero + dedicated CTS ribbon); landscape board omits T.O.L.
UX: **B** — one-tap roster exclusion, roster-backed "X of 3" stepper, and the suggested-ribbon callout are strong, but the sport's core action (an exclusion) takes 3 disconnected writes, and HS/club operators must hand-set the clock every quarter.
Functionality: **A-** — clock/penalty/shot-clock semantics are correct, server-slaved, skew-corrected, and parity-tested; the gaps are wrong defaults (8:00 quarters, OT length), not broken math.

## Findings

**[P1]** engine + console — Fixed 8:00 quarters with no per-game length setting (`packages/api-types/src/sports.ts:878-879`, `apps/api/src/sports/sports.service.ts:179-182`). The comment claims "NFHS / NCAA / FINA regulation quarters are 8:00" — true for NCAA/World Aquatics, but **NFHS high-school water polo plays 7:00 quarters** and club age-groups play 5-7:00. `segmentStartMs` resets to the definition's fixed `segmentMs` on every segment advance (`sports.service.ts:895,975,2549,2851`); there is no clock analog of golf's `countOptions`. Failure scenario: HS venue, Q2 starts, board flashes 8:00 in front of the crowd; the operator must "⌨ Set time" (console `page.tsx:1948`) four-plus times per game or run a wrong clock.

**[P1]** console — The exclusion workflow is 3 disconnected writes for the sport's most repeated action (~8-14/game, logged mid-play). The roster one-tap adds only the :20 box timer (`apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx:3688-3708`); it does NOT bump `stats.playerExclusions` (the board's "2 of 3"/EJECTED panel) nor the `homeExclusions`/`awayExclusions` team stat. The `PlayerExclusionStepper` (`page.tsx:5128-5141`) writes only `playerExclusions` and starts no timer; the server `penalties.add` links neither (`apps/api/src/sports/sports.service.ts:2368-2392`). Failure scenario: under game pace the three surfaces silently drift — a player's real 3rd major shows "1 of 3" on the video board while their :20 timer runs. One tap should do all three.

**[P2]** engine — OT resets to a full 8:00 clock. `setSegment` special-cases only football (`sports.service.ts:2549`); real water polo OT is 3:00 periods (NCAA) or straight shootout (World Aquatics). Operator must hand-set at the highest-stakes moment of the night.

**[P2]** definition/cues — No sprint (swim-off) cue or state anywhere (`sports.ts:902-909` celebrations; nothing in console). The quarter-opening sprint is a signature water polo beat a Daktronics/ScoreVision production cues with a crowd prompt.

**[P2]** cues — Dead celebration assets: `'water_polo/penalty'` (5-meter penalty shot) and `'water_polo/hatTrick'` are mapped in `apps/web/src/lib/celebration-assets.ts:111-113`, but neither key exists in the SportDefinition's `celebrations` (`sports.ts:902-909`), so `CueLaunchpad` (renders `def.celebrations`, `CueLaunchpad.tsx:186`) never offers them. A 5-meter penalty shot is water polo's peak drama and the asset already exists — unfireable.

**[P2]** board — Landscape `BoardScene` shows no timeouts-remaining and no team SHOTS/EXCL columns; only `PortraitBoardScene` renders them (`apps/web/src/app/board/[gameId]/page.tsx:3931-3937` — `T.O.` row is portrait-only). The situational footer covers shots + exclusions (`components/widgets/v2/_shared/sports-situational.tsx:645-666`) but not T.O.L. Regulation water polo boards show T.O.L.; the stat exists (`sports.ts:899-900`) and is simply not rendered on the main 16:9 board.

**[P2]** stats/leaders — `PLAYER_STATS.water_polo = ['G','A','ST','EXC']` (`sports.ts:1343`) has no `SV` (saves), though field hockey carries it (`sports.ts:1798`) and a dedicated save celebration exists. Water polo goalkeepers — often the program's star — are invisible in `LeadersPanel` and the milestone ladder (`sports.ts:2041-2045` covers G/A/ST only).

**[P3]** board — `PenaltyTimers` caps at 4 visible boxed players per team (`board/[gameId]/page.tsx:421`); legal in theory but unreachable in practice for water polo — acceptable.

**[P3]** definition — `penaltyBox` presets stop at "Exclusion :20" / "Misconduct 4:00" (`sports.ts:910-916`); a "Penalty (no time)" entry for 5-meter awards and an explicit brutality label would match pro terminology.

## Strengths
- **Correct core semantics, server-enforced:** concurrent exclusions as an array (up to 12) that freeze/run WITH the game clock via re-anchoring on every clock action (`sports.service.ts:1712-1719, 2149-2177`); shot clock slaved to game start/stop, clamped to remaining quarter time, auto-reset at quarter boundaries (`sports.service.ts:1886-1896, 1984+`; `sports.ts:886-891`).
- **Board is broadcast-grade:** skew-corrected penalty countdowns going red under 10s (`board:357-455`), per-player "X of 3"/EJECTED panel (`board:462-517`), shot clock with tenths under 5s (`board:1348-1372`), power-play strength derived from the live box (`board:284-301`), quarter line score, dedicated PRE_GAME/HALFTIME/FINAL scenes (`board:2763-3209`).
- **Console treats water polo as a first-class sport:** dedicated `PlayerExclusionStepper` with FINA 3-ejection rule and warn-at-2 (`page.tsx:5101-5187`), roster one-tap :20 exclusion by cap number (previous append-overwrite P0 fixed, `page.tsx:3688-3708`), 30/20/start-stop shot-clock controls + length configure (`page.tsx:3337-3353, 6358+`), v2 cinematic celebration pack by default on every surface (`page.tsx:1445`, `board:4347/4405/4628`).
- **Only sport with a curated ribbon suggestion** — "CTS Water Polo Ribbon" one-click + default-ribbon heads-up callout (`page.tsx:7646-7745`), a dedicated 623-line goal hero (`CelebrationWaterPoloGoal.tsx`), CTS Colorado-console bridge (`CtsScoreboard.tsx`), and sport-key normalization so `water_polo`/`water-polo` never miss (`celebrationDeckCues.ts:419-434`).
- **Verified parity:** console previews iframe the real `/board`/`/ribbon` (`SurfacePreview.tsx:8,168`); the parity test asserts the EXCLUSIONS panel renders with seeded exclusion data (`__tests__/sport-board-parity.test.tsx:140-146, 271`); `EXC` is lower-is-better in semantics tests (`sports-semantics.spec.ts:117`).

## Gaps vs pro production
A Daktronics/ScoreVision water polo show additionally runs: **per-level quarter length** (7:00 HS / 8:00 NCAA) and 3:00 OT presets; **one-touch exclusion capture** that simultaneously starts the :20 timer, increments the player's major-foul count, and bumps the team EXCL stat; a **sprint-won cue** at each quarter start; a **5-meter penalty-shot presentation** (dramatic pause graphic → goal/save resolution); **T.O.L. always on the main board**; and **goalie save counts** feeding leaders/hype boards. Everything else expected at a well-run HS/college venue — concurrent exclusion clocks with cap numbers, shot clock discipline, power-play state, quarter scoring box, halftime/final treatments, sponsor-capable celebration decks — is present and correct.
