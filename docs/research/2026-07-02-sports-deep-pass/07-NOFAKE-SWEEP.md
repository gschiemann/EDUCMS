# No-fake-data widget sweep (overnight-review follow-up, 2026-07-03)

Closed the 6 sample-data leaks S2/#290's widget-by-widget pass missed. All now
gate their SAMPLE_ fallback behind useRenderSurface()==='player': CtsSponsor
Rotator (P0), CtsAnnouncement (P0), TeamRecord (P1), Leaderboard (P1),
RibbonScoreboard reel field (P1), SwimRecordLine (agent's call — a real leak;
its sibling SwimRelayExchange gates the same, SwimRecordLine just never called
useGameState). New drift-catcher spec (20 tests) + a STATIC scan that fails CI
if any components/widgets/sports file declares a SAMPLE_/N_ constant without
referencing a render-surface guard — so the class can't silently regress.
111 + 278 sports tests green; tsc/mobile-perf/rule-#10 clean.
RESIDUAL (filed): variants-register.ts:~1468 still pre-seeds TeamRecordWidget's
default placeholder with fabricated '10-1'/'8-3' — display leak closed, but an
operator retyping the exact seed is indistinguishable. Config-shape, low-pri.
Commits da3e41b8, b6f7d4d8, 73620ec9, 345683cd, 8672982f, d14e1e19.
