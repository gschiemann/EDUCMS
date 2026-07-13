# Football — world-class audit

> Auditor: single agent (one-at-a-time cadence, 2026-07-12). Read-only,
> file:line-cited, graded against a Daktronics/ScoreVision Friday-night HS
> football production. Marquee sport.

## Grades
Design: A− · The board is genuinely broadcast-grade (situational strip, possession glyphs, untimed-OT, dedicated scenes); generic "HOME BALL" text and a missing flag graphic are the gaps.
UX: B+ · FootballControls (typed To Go/Ball On, one-tap "New set", 25/40 play-clock buttons) is excellent; a duplicate/divergent possession control is a real wart.
Functionality: B+ · Play-clock slaving, OT, timeouts, possession column, celebrations all work; the possession divergence can show wrong data and there's no penalty overlay.

## Findings

**[P1 — FIXED this pass; deeper root cause found]** Console — two possession controls write to divergent stores. FootballControls' PossessionToggle writes `stats.possession` via the generic stats PATCH (`page.tsx:4468-4472`; onStat is `ctl.stats.mutate` at `page.tsx:1559`), while the run-bar PossessionArrowChip writes the first-class `Game.possession` column via `setPossession` (`page.tsx:2396-2402`). Board and ribbon read `Game.possession` FIRST, falling back to `stats.possession` (`board/[gameId]/page.tsx:1074-1077`). *Failure:* once the arrow chip has set the column, toggling possession in the football tray writes only `stats.possession` and is silently ignored — the tray toggle (the natural in-game control, sitting right beside down/distance) appears dead and the crowd sees the stale/wrong team with the ball. P0-adjacent when both controls are used in a game.

**[P1 — PARTIALLY FIXED this pass (cue added; full board graphic deferred)]** Board/console — no penalty/FLAG overlay for football. No flag graphic exists on `/board`, in `CelebrationsFootballWidgets.tsx`, or `CueLaunchpad.tsx` (FLAG/penalty greps return only feature-flags); football declares no `penalties` config (`sports.ts:522-556`, unlike hockey). *Failure:* a holding/PI flag — routine every drive — has no on-screen indicator. A Daktronics/ScoreVision board flashes "FLAG"/penalty text; VenueOS shows nothing.

**[P2]** Board situational — possession reads generic "🏈 HOME BALL"/"AWAY BALL", not the team name (`sports-situational.tsx:425`). A crowd thinks in team identities, not home/away. (The team-panel PossessionGlyph beside the correct name is right — this is the redundant footer text.)

**[P3 — FIXED this pass]** Ribbon scorebug — goal-to-go shows "1ST & 0" not "1ST & GOAL". The template-embedded `RibbonScorebugWidgets.tsx:212` uses `dist ?? ''` (nullish), so distance 0 renders "& 0", and it omits possession/ball-on. The standalone `/ribbon` (`page.tsx:514`) and `/board` both correctly render "& GOAL" — one of the two ribbon paths is inconsistent.

**[P3]** Board — football PLAY clock renders unconditionally, showing a static "40" even when never armed (`board/[gameId]/page.tsx:1405-1428`, `!playArmed ? 40`). A game not using the play clock shows a permanent frozen "PLAY 40". Cosmetic — real boards do idle at 40.

**[P3]** No dedicated 2-point-conversion / XP / PAT celebration beat (`sports.ts:544-555`; the widget set has TD/FG/Safety/Sack/INT/PickSix/FirstDown/Fumble). TD+2pt (=8) rides the touchdown celebration via `autoPoints:[6,7,8]`, so functional — just no distinct moment.

## Fixes applied (2026-07-12)
- **Possession divergence (P1) — root-caused deeper than the audit.** Verifying before fixing revealed the board API's `getBoardFresh` `select` **never included `possession`**, so `data.possession` was always undefined and every surface silently used `stats.possession` — meaning the run-bar arrow chip (column-only) was the control that never reached the board, not the tray toggle. Complete fix: (1) `getBoard` now selects the column, ships it top-level, and **mirrors it into `stats.possession`** via a pure `mirrorPossessionIntoStats` helper so the default board, the shared `SituationalRow`, and every widget read one value; (2) the football tray `PossessionToggle` now reads column-first and writes the column via `setPossession` — same store as the arrow chip. Both controls now agree, everywhere. 2 new getBoard tests + existing setPossession tests green (185/185).
- **FLAG cue (P1, partial).** Added a `flag` (🚩) celebration cue to the football definition, so the operator gets a one-tap FLAG overlay from the CueLaunchpad (no autoPoints — manual only, like the horn). A full animated on-board penalty graphic + team-attributed field-position marker is deferred as a larger presentation task.
- **Ribbon goal-to-go (P3).** `RibbonScorebugWidgets` now renders "1ST & GOAL" at distance 0 (was "1ST & 0" via `dist ?? ''` nullish) — matching `/board` and the standalone `/ribbon`.

## Deferred (not fixed this pass)
- **P2 possession footer team-name** ("HOME BALL" → team identity): the shared `SituationalRow` doesn't receive team names, so threading them touches its props + every caller — too invasive for a P2 (the team-panel glyph beside the correct name already reads right).
- P3 static "PLAY 40" idle, P3 no distinct 2-pt/PAT moment, and the pro depth gaps below (drive summary, RED ZONE, chain marker, field-position territory).

## Strengths
- **Play-clock ↔ game-clock slaving (T2-7) is correctly wired and is the signature detail done right:** `syncPlayClockToGameClock` fires from the clock mutation (`sports.service.ts:1805`), freezes on whistle/pause, re-anchors on start, auto-resets to 40 if expired (`2166-2202`); 25s after a timeout (`callTimeout:4513-4522`); console exposes 25/40 reset + start/stop with a live sub-second display under 5s (`page.tsx:6319-6357`).
- **Untimed football OT handled honestly end-to-end:** `setSegment` zeros the clock past regulation instead of re-anchoring 12:00 (`sports.service.ts:2646-2655`); board suppresses the clock and shows "UNTIMED" (`board:1294-1310`).
- **FootballControls UX:** typed To Go / Ball On (no +1 spamming), one-tap "New set → 1st & 10", CompactDownControl (`page.tsx:4437-4472`).
- **One shared situational renderer** so board/ribbon/widget agree: per-side timeout pips, possession, "1ST & GOAL" logic, ball-on (`sports-situational.tsx:403-440`); correct ordinals 1ST–4TH (`:24-28`).
- **callTimeout** decrements the team's timeouts with a "no timeouts left" guard + AuditLog + GameEvent (`4483-4526`); **possession is a first-class column** with a forensic POSSESSION event + AuditLog (`4819-4854`).
- **Rich celebration set** including Pick-Six, Safety, Fumble Recovery (`CelebrationsFootballWidgets.tsx`); full PRE_GAME/HALFTIME/FINAL scenes with dedicated treatments (`board:2761/2951/3201`); timeouts reset at halftime via segmentReset `'half'` (`sports.ts:531-534`).

## Gaps vs pro production
- **No penalty/flag graphic** (finding 2) — table-stakes for every football broadcast.
- **Ball-On has no field-side/territory indicator** — `ballOn` is 0–50 only (`sports.ts:538`), so "BALL ON 35" is ambiguous about whose 35. Pro boards pair it with a possessing-team/territory marker or a field-position/chain graphic.
- **No drive summary, play-by-play, "RED ZONE" treatment, team-stats line (total yards, 1st-down count), or 1st-down/chain marker.**
- **Possession footer text uses home/away, not team identity** (finding 3).
- **No distinct 2-pt/PAT moment** (finding 6).

Net: the mechanical core — play clock slaved to game clock, OT, timeouts, down & distance, possession column, celebrations — is genuinely strong and largely broadcast-grade. Two things keep it below a Friday-night Daktronics bar: the divergent possession control (a real functional/UX bug that can misreport possession) and the total absence of any penalty/flag indicator.
