# Celebration animation inventory (2026-06-16)

Full render of every cue: `/tmp/celeb-verify/CELEBRATION-LIBRARY.png` (rebuild
with `/tmp/celeb-verify/build-gallery.cjs`). 51 animations, three quality tiers.

## The truth about "good animations for every sport"
Every sport HAS cues, but only TWO sports are on the rich **V2 cinematic
engine**. Most cues are the older **DECK** tier (big text on a dark field +
one small icon) — that's what reads as "old / dumb."

### V2 — cinematic engine (the good ones) — 8
- **Basketball**: 3-Pointer, Dunk  ← NEW (2026-06-16). Dunk still reads like a
  made shot, not a slam — REWORK.
- **Water Polo**: Goal, Save, Exclusion, Penalty, Power Play, Hat Trick

### MARQUEE — bespoke hero files (decent) — 8
football Touchdown, football Field Goal, baseball Home Run, hockey Goal,
soccer Goal, volleyball Kill, basketball 3-Pointer, water polo Goal

### DECK — older parametric scenes (the weak/"old" tier) — ~35
basketball **Buzzer Beater, Steal** ← operator flagged as old · football First
Down/Sack/Turnover · baseball Grand Slam/Strikeout/Double Play · soccer
Penalty/Yellow/Red · hockey Power Play/Penalty Kill/Hat Trick/Save · volleyball
Ace/Block/Set Won · wrestling Pin/Takedown/Near Fall/Tech Fall · gymnastics
Perfect Score/Stick Landing/All-Around · cheer Full Out/Perfect Stunt/Round Win ·
pickleball Dink · field hockey Goal/Save · lacrosse Goal/Save · Horn (universal)

## Operator-flagged issues
1. basketball Buzzer Beater + Steal = DECK (old). Fix: add v2 cues.
2. v2 Dunk doesn't read as a dunk. Fix: real slam (arm drives down, rim flex/hang, harder/faster).

## Recommended path
1. Rework v2 Dunk → real slam.
2. Add v2 Buzzer Beater + Steal (extend cues-basketball.js).
3. Roll v2 to the rest of basketball, then sport-by-sport, replacing the DECK tier.
