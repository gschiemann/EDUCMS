# Diving — world-class audit

> Auditor: single agent (one-at-a-time cadence, 2026-07-12). Read-only,
> file:line-cited, graded against a Daktronics/CTS-grade judged-diving
> production. Judged sport sharing the natatorium with the swim CTS install.

## Grades
Design: B — premium judge-panel + leaderboard widgets (kept/dropped chips, mono score type, panel readout), but the FINAL moment and celebrations fall back to generic chrome.
UX: B− — the judge pad is a strong one-screen flow (roster chips, half-point two-tap, live drop preview, Award), undercut by a 0.0-default mis-score trap and a team-score the pad silently never writes.
Functionality: C+ — shared/correct drop-high-low math and a robust sanitizer, but per-dive scores round to 0.1 (wrong vs official 2-decimal), and FINAL renders a team score the judge flow never produces.

## Findings

**[P1 — FIXED this pass]** console+board math — `computeDiveScore` rounds every dive to ONE decimal (`Math.round(sum*dd*10)/10`, SwimDiveWidgets.tsx:1074); the panel widget (`diveScore.toFixed(1)`, :1228) and console preview/Award button (page.tsx:6107, 6191) all display 1-decimal. Official single-dive scores carry 2 decimals — 3×7.5 = 22.5 × DD 2.7 = **60.75**, but the pad shows **60.8**. The running total (`toFixed(2)`, page.tsx:5968) is then summed from these 1-decimal values, so board totals never reconcile to the official scorer's `.x5` sheet. The DIVING def itself is 2-decimal (`scoreDecimals: 2`, sports.ts:1113; comment example "245.60") — the per-dive pipeline is inconsistent with it. Failure: a coach/scorer watching sees 60.8 where their sheet reads 60.75, and a 6-dive total drifts by up to ~0.3.

**[P1 — FIXED this pass]** board FINAL — the judge pad's `award()` writes `results` + scalars but **never `homeScore`/`awayScore`** (page.tsx:5982–5994). At FINAL, diving (a laneGrid sport) renders `FinalScene`/`PortraitBoardScene`, which show ONLY the two team totals (board/page.tsx:4580, 3319–3362; `laneGridShowsGrid` excludes FINAL at :4514). There is no diving team-score producer — `extractSwimTeamScore` is swimming-CTS-only (sports.service.ts:5754). Failure: an operator who runs the whole meet through the judge pad (the intended flow) and never hand-maintains the +1/+5/+10 stepper gets a FINAL board reading **0.00 – 0.00** with the winner cinematic crowning nobody, despite a full leaderboard of divers seconds earlier. Borderline P0.

**[P1 — FIXED this pass]** board FINAL — the per-diver standings vanish exactly when they matter. `DiveLeaderboardWidget` (running totals + place — the real meet result) renders only at LIVE/HALFTIME (`laneGridShowsGrid = laneGridDefault && !isPreGame && !isFinal`, board/page.tsx:4514, 4530). At FINAL the crowd sees a two-number team cinematic with no placement table. Failure: meet ends, board can't show who won the 1-meter.

**[P2]** console judge pad — `canAward` checks only diver name + DD>0 (page.tsx:5940); the N judge scores default to 0.0 (:5903) and 0.0 is a legal score, so there is no "all judges entered" guard. On a 3-judge panel (no drops) a single forgotten judge left at 0.0 silently tanks the awarded score the crowd sees. Failure: distracted operator taps Award with J2 still 0.0 → a 7.5/0.0/7.5 dive posts a wrong low total.

**[P2]** celebrations — diving's award path never auto-fires a celebration; the 4 cues (perfectDive/bigDD/firstPlace, sports.ts:1133–1138) are manual cue tiles only, and diving scores arrive via the judge pad, not the score stepper that drives auto-celebration (Standard Audit Surface #4). A 10.0 or DD-4.0 dive draws no automatic crowd moment. Failure vs pro: perfect dive lands, board stays flat unless the operator hand-taps a tile.

**[P2]** celebrations — no bespoke diving art. `celebrationAsset()` ships cinematic marquee/deck packs for many sports (e.g. `gymnastics/perfectScore`, celebration-assets.ts:87) but diving's keys fall through to the generic emoji+confetti fallback (:124–141). Functional, not premium at the graded bar.

**[P3]** board dead code — `LeaderboardScene`'s diving branch (board/page.tsx:1582–1585, `'NOW DIVING'`) is unreachable: diving short-circuits to `DiveLeaderboardWidget` at LIVE and PreGame/Final scenes otherwise (:4514, 4570). Harmless but misleading for the next editor.

**[P3]** console DD input — DD is stripped to `[0-9.]` + `parseFloat` with no upper bound (page.tsx:6096, 5940); a mistyped "27" instead of "2.7" produces a 10× score with no warning. Real DDs top out ~4.8.

## Strengths
- Single source of truth: `keptIndices`/`computeDiveScore` are exported from SwimDiveWidgets and reused by the console pad (page.tsx:76), so console preview and board render can't drift. Drop rules are correct — 3=keep all, 5=drop 1/1, 7=drop 2/2, unknown size=keep all (SwimDiveWidgets.tsx:1048–1063).
- `sanitizeJudgeScores` is robust: clamps [0,10], **drops** malformed entries rather than coercing to a harsh 0.0, caps panel entries, half-point rounds (sports.ts:488–496, 466–470).
- Running-total accumulation is well-built: find-or-create the diver within the current round, add to prior mark, re-rank by total, infer team side from roster (page.tsx:5955–5980).
- No-fake-data discipline everywhere: WARM-UPS / NO DIVE IN PROGRESS / NO RESULTS YET / bind-game callout; the fabricated `diveGroup` was correctly gated to non-live (SwimDiveWidgets.tsx:1141, 1172–1178). The removed-fabricated-diveGroup fix is sound.
- `formatScore`/`parseScoreInput` handle the 2-decimal scaled-int team total correctly (sports.ts:1312–1353); comparisons run on the raw int.
- Panel size 3/5/7 persists per-game via the `judgeCount` scalar seeded from the def (page.tsx:5883–5890); 44px touch targets, live-greying dropped chips.
- Ribbon renders a clean diving line — `NOW DIVING · DIVER (CODE)` (ribbon/page.tsx:677–683).

## Fixes applied (2026-07-12)
- **2-dp per-dive scoring** — `computeDiveScore` now rounds to 2 decimals (60.75, not 60.8); all three console award-display sites + the DiveJudgesPanel widget show `toFixed(2)`. The stored running total was already 2-dp (`runningTotal.toFixed(2)`) and now sums 2-dp per-dive values, so board totals reconcile to the official sheet. Judge chips stay half-point 1-dp (correct). Test updated to assert the exact `60.75` mark.
- **FINAL board** — diving now keeps its **standings leaderboard** at FINAL (winner ranked #1) instead of the shared two-number `FinalScene` the judge pad never populates. One targeted change to `laneGridShowsGrid` (diving only; swimming/track keep FinalScene, their dual-meet points are real). Kills the 0.00–0.00 crowning-nobody bug AND keeps the diver standings visible at FINAL — both P1s, one fix. Parity test updated for the new diving-FINAL behavior; both suites green (74/74).

## Remaining gaps vs pro production (not fixed this pass)
4. **Award guardrail** — warn/confirm when a judge chip is still 0.0 on a no-drop panel.
5. **Auto-celebration + bespoke art** on a perfect/big dive.
6. **Depth pro operators expect but absent:** per-dive DD/round validation, a dive-list progression readout ("dive 4 of 6") tied to real data, and 11-dive championship (drop-high/low is there, but no dive-sheet import).
