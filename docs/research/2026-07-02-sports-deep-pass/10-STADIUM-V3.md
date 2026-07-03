# Stadium board v3 "Record Chase" — live port + lead port-correction (2026-07-03)

StadiumChaseScene added to StadiumMeetBoardWidget (boardStyle='chase'); v1/v2
scenes untouched (re-verified). Preset sports-stadium-chase-board ("🏊 Record
Chase Board"), variant stadium-meet-board-chase, PropertiesPanel 'chase' → (live).
Faithful to stadium-lane-v3-chase.html: left rail (event-name hero + LIVE-FINALS
pill + race clock + POOL RECORD CHASE card with progress bar/gap + team-score
chip) and place-ordered medal ladder. LIVE data: race clock = leader's real
finish time (place===1, non-DQ), "—" if none; record card = config-or-omit
(v1's recordLabel/recordValue/recordHolder/recordDelta), progress bar only when
both record + leader parse; team chip = snapshot home/away score+name+colors.
No-fake-data guarded. LEAD PORT-CORRECTION (d4285238): flipped hero/pill so
event NAME is the giant hero and FINALS the pill (matched mockup), default
record label → "POOL RECORD CHASE". 49 stadium tests (112/112 incl parity),
tsc/mobile-perf/rule-#10 clean. Commits 3c3d21b9,028ace37,dcd0e314,a1eee68f,
0afc4598,d4285238. Lead-reviewed screenshot: faithful to mockup.

## Stadium set COMPLETE (#288 / S6)
v1 Broadcast (d651da4b), v2 Duel (8032bceb), v3 Record Chase — all 3 Greg-
approved designs shipped as selectable SCOREBOARD presets, live game-bound, no
static costumes, no-fake-data guarded, Chromium-83/Taurus-safe.
