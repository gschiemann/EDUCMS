# Stadium board v1 "Broadcast" — live port (2026-07-03)

Greg approved all 3 stadium designs as sports scoreboard template options.
StadiumMeetBoardWidget (STADIUM_MEET_BOARD, variant stadium-meet-board-broadcast,
preset sports-stadium-broadcast-board "🏊 Broadcast Meet Board"). Byte-faithful
port of stadium-lane-v1-broadcast.html, LIVE-bound: reads Game.stats.results
(same readResults contract as SwimLaneGridWidget), team-color chips from
snapshot.homeColor/awayColor, DQ struck-through + optional operator reason.
Pool-record + sponsor footer = new config fields, config-or-OMIT (never the
mockup's fabricated 50.84/RIVER DENTAL on a live board). No-fake-data guard:
player-surface-no-game → "NO GAME BOUND". Widget is a router + StadiumBroadcast
Scene; boardStyle 'duel'/'chase' reserved for v2/v3.
LEAD REVIEW: screenshot vs mockup — faithful (header/rows/gold-leader/medallions/
DQ/footer match); the red "N Issues" chip is a Next.js dev overlay, not the board.
LEAD ENHANCEMENT: swapped literal HOME/AWAY for the real bound team name
(snapshot.homeTeam/awayTeam, HOME/AWAY fallback) so a real dual meet shows the
schools like the mockup. 80 tests green; both tsc + mobile-perf + rule-#10 clean.
NEXT: v2 Duel, v3 Chase (same widget). Data note: multi-team meets only carry
home/away, not per-swimmer club — a per-swimmer club field is a future model add.
