# Stadium board v2 "Duel" — live port (2026-07-03)

StadiumDuelScene added to StadiumMeetBoardWidget (boardStyle='duel'); v1
StadiumBroadcastScene untouched (re-verified). Preset sports-stadium-duel-board
("🏊 Dual-Meet Duel Board"), variant stadium-meet-board-duel. Faithful to
stadium-lane-v2-duel.html: diagonal home/away color floods, huge team scores +
names, per-swimmer +time deltas, medal chips, live ticker. LIVE data: scores/
names/colors from snapshot.home*/away*; deltas from parseMarkMs vs leader time
(leader/DQ = —); ticker LIVE clause from leader + score gap; UP-NEXT OMITTED
(no schedule field — never fabricated, test-asserted). No-fake-data guarded.
LEAD REVIEW: screenshot vs mockup — faithful (floods/scores/deltas/medals/
ticker match). Ticker paraphrases ("leads the field" vs mockup "wins heat 3")
— honest, no heat-completion signal exists. 94 tests green; both tsc/mobile-perf/
rule-#10 clean. Commits 9114bb5d,1ce06b20,525caf45,672ca40c,6fce7077.
