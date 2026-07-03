# Sports deep pass — lead fix plan (waves, fences) — 2026-07-02

Source: 00-AUDIT.md (3 P0, 9 P1, 6 P2 — all file:line-grounded). Greg's
contract: every sports board binds to a Game, is driven live by the score-
keeper console (standalone), accepts CTS as a layer, and looks stadium-grade.

## Wave S1 — scorer feel + data integrity (Sonnet, worktree)
P0-1 optimistic score/clock/segment/stats mutations (mirror screens-hooks
pattern, rollback on error) · P1-4 lane pad provisional mid-heat publish ·
P1-5 undo restores typed rows · P1-6 meet-results draft state + commit-on-blur
+ 44px inputs · P2 EndSetMacro → single server-side end-segment endpoint.
FENCE: apps/web/src/hooks/use-api.ts (sports hooks only), LanePadSection.tsx,
MeetResultsSection region of sports/[gameId]/page.tsx, apps/api/src/sports/
(new macro endpoint + spec). Do NOT touch widgets, presets, board routes.

## Wave S2 — no-fake-data + binding UX (Sonnet, worktree)
P0-2 (a) live-surface guard: sports widgets outside a GameStateProvider on
player/live paths render an empty shell + "Bind a game" callout — NEVER sample
data (builder keeps sample, clearly watermarked) · P0-2 (b) `gameId` binding
config + PropertiesPanel "Bind to game" picker that wraps the zone in
GameStateProvider · P1-12 "Use for a game →" action on SCOREBOARD/RIBBON/
SCOREBUG gallery cards → game picker / New Game with template pre-selected.
FENCE: sports widgets (SwimDiveWidgets, MainScoreboardWidget sample paths),
WidgetRenderer sports dispatch, PropertiesPanel sports-binding section,
templates gallery card actions. Do NOT touch console page, use-api sports
hooks (S1 owns), presets file (S5 owns).

## Wave S3 — diving judge pad (Sonnet, worktree) [after S1 merges — same console page]
P0-3 console judge pad: roster-tap diver → per-judge 0-10 half-step chips →
computeDiveScore (exists) → write stats.judgeScores + append running total to
stats.results · declare judgeScores in DIVING stat model · stop fabricated
diveGroup on live surfaces (empty when absent).

## Wave S4 — pickers + workflow (Sonnet, worktree) [after S1]
P1-7 per-sport suggestion map + sport-aware picker ordering + generic amber
copy · P1-8 additive Game.scheduledAt migration + optional create/Setup field
+ LIVE-first list ordering · P2 new-game modal: layouts behind Advanced +
sport search/recents · P2 game list: LIVE→upcoming→past collapse.

## Wave S5 — board presentation completeness (Sonnet, worktree) [after S2]
P1-9 PRE_GAME/FINAL scenes for laneGrid sports · P1-10 portrait base for lane
grid/leaderboards (drop !isLeaderboard carve-out; verify on 960×1080) · P2
volleyball stats.setHistory + FINAL set columns · Halftime Board pulls the
tenant Sponsors library instead of urls:[].

## Wave S6 — stadium visual language (LEAD designs → Greg approves → port)
P1-11: 3-5 mockup directions for the lane-grid/meet board family (type scales
with row height, team-color washes, broadcast energy, sponsor moments) per the
Template Design Workflow. NO batch port before Greg's pick. Then apply the
approved language across the six gallery presets + seed Halftime sponsor art.

## Gates (every wave)
tsc both apps (api non-incremental) · targeted jest incl. a regression spec
per fixed item · sport-board-parity test must stay green · taurus-safety +
mobile-perf guards · WIP commit per item · no subagents · lead merges
per-commit, batch push, CI to green.
