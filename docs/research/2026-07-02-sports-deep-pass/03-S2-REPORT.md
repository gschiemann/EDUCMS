# Sports Wave S2 — builder report (compact, 2026-07-02)

Branch worktree-agent-afc60856387e44833 (base 15a779ad), 3 commits, 46 suites/
451 web tests green (incl. 42 new + 72-test parity suite), web tsc clean,
mobile-perf clean, rule-#10 sweep clean on added lines.

- S2-1 5d23f173 no-fake-data: RenderSurfaceContext ('builder'|'player');
  useGameState returns a phantom-unbound state (snapshot:null) on player
  surfaces with no provider → every widget's existing "provider, no snapshot →
  neutral" logic fires WITHOUT editing ~40 call sites. Closed the team-name
  leak (EAGLES resolved even when score showed —). "NO GAME BOUND / Bind a
  game in the score keeper" shell on live; SAMPLE watermark builder-only.
  Fence exceptions (justified, one-prop): player/page.tsx + TouchOverlay.tsx
  pass renderSurface="player".
- S2-2 ad50b868 bind-to-game: WidgetPreview wraps a zone with config.gameId
  in its own GameStateProvider when no ambient one (useHasAmbientGameProvider;
  never double-wraps — tested). GameBindField (ONE dropdown, LIVE-first 🔴,
  Unbound default) on SWIM_LANE_GRID/DIVE_LEADERBOARD/SWIM_RELAY_EXCHANGE/
  SWIM_SPLITS_PANEL/DIVE_JUDGES_PANEL/SCOREBOARD + scoreboard-main/ribbon-main/
  scorebug-main. Mid-flight regression caught: useGames() at ContentFields top
  broke 53 tests → moved into leaf per file convention; 30 suites re-verified.
- S2-3 a11cc270 gallery "Use for a game →" (SCOREBOARD/RIBBON/SCOREBUG/GAMEDAY
  cards): sportsSurfaceForCategory() fixes the would-be silent no-op for
  RIBBON/SCOREBUG; sports/page.tsx consumes ?templateId&surface&newGame=1,
  auto-opens New Game preselected, cleans URL (fence exception, consumer-only).

OUT-OF-SCOPE FOUND (not fixed): CtsScoreboard/CtsRibbonWidgets (~1700 lines)
have the SAME fake-data class via an overloaded `live` prop set true in
TemplatePreviewModal/AppConfigForm — file follow-up.

Unverified: no live click-through; RIBBON/SCOREBUG editors are gameId-only
(fuller field sets = pre-existing gap).
