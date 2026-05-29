# Per-Sport Scoreboard + Stat-Field Completeness Audit
**Slice 2 of 6 · grounded in NFHS (HS) + NCAA rules · audited vs the Sport Engine dimensions (clock · segments · score · statFields[] · celebrations[] · mode)**

## Verdict: the 6 engine dimensions cover the PRIMARY clock/score model, but 4 STRUCTURAL concepts are missing that nearly every real scoreboard needs (belong in the schema, not per-sport hacks):

| Missing engine concept | What it is | Sports needing it |
|---|---|---|
| **A. Secondary timers `auxClocks[]`** | independent timers running CONCURRENT with the main clock; must support count-DOWN **and** count-UP/accumulating | football play clock, basketball/lacrosse/water-polo shot clock, hockey/handball/futsal/water-polo penalty/exclusion, wrestling riding-time, soccer sin-bin, esports bomb/respawn |
| **B. Per-team state arrays `teamState[]`** | counters/flags shown per team: timeouts, team fouls + bonus tier, cards, penalty-box occupants, accumulated fouls, sets won, serve, possession | every team sport |
| **C. Per-ruleset segment override** | same sport, different segments under NFHS vs NCAA-M vs NCAA-W | basketball (worst case), hockey, soccer, water polo, lacrosse, wrestling, football (12 vs 15 min Q) |
| **D. Judge-panel scoring mode** | score = aggregate of N judge scorecards, not a running counter — neither HEAD_TO_HEAD nor LEADERBOARD | boxing, MMA, gymnastics, diving, cheer |

Severity: **P0** = not credible without it · **P1** = looks amateur · **P2** = pro polish.

## Flagship six — gap highlights
- **Football:** play clock (40/25, concurrent) = **P0 NEW auxClocks**; down&distance, ball-on, timeouts/team, binary possession = **P0**. Quarter length 12(NFHS)/15(NCAA) → concept C.
- **Basketball:** halves(NCAA-M) vs quarters(NCAA-W/HS) = **P0 concept C**; shot clock toggleable+duration-configurable (NFHS optional!) = **P0 auxClocks**; team fouls+bonus/double-bonus = **P0 teamState**; timeouts/team = P0.
- **Baseball/softball:** `clock:none` ✓; Balls/Strikes/Outs = **P0 NEW** (no baseball board without it); baserunners 1/2/3 = **P0**; line score R-H-E per inning = P1; **pitch count = P1 but it's a SAFETY/compliance rule, flag it**.
- **Soccer:** count-up ✓ but **no "+stoppage"/"referee=official" mode = P0 FIFA**; cards Y/R per team = **P0 teamState**; **penalty-shootout sub-mode = P0 (every knockout can reach it)**; countdown variant (NCAA/NFHS) → concept C.
- **Volleyball:** **two-level score (points-this-set + sets-won) = P0** (flat `score` can't express); serve indicator = **P0 teamState**; deciding set to 15 = per-segment target override.
- **Wrestling:** **takedown = 3 not 2 (2024-25 rule) — verify seed or it's a WRONG board = P0**; riding-time = count-UP auxClock (engine has no accumulating timer); weight class = P0; **dual-meet running team score = P0** (meta-score above per-bout, neither mode covers it).

## Long-tail by clock model (category gaps)
- **Continuous-clock invasion** (hockey/lacrosse/water-polo/field-hockey/rugby/futsal/handball): all need auxClocks (penalty/shot) + teamState (power-play/cards/exclusions/accumulated-fouls). **Rugby BREAKS "scoreboard=official time"** (count-up, ref adds time). **Futsal accumulated-foul-threshold** is a special per-team counter. Multi-value increments (rugby try5/conv2/pen3/drop3) confirm `score.increments[]` must be a NAMED-VALUE LIST.
- **Inning/turn** (cricket): score is compound **runs/wickets** ("250/5"), progress = overs (12.3, not a clock), + run-rate/required-rate → strongest case for a **derived/computed field type**.
- **Set/rally** (tennis/badminton/pickleball/table-tennis): flat `score` wrong for ALL — need **3-level nested** (point→game→set→match). Tennis non-numeric points (15/30/40/AD) + deuce/no-ad/tiebreak sub-modes. Pickleball server-number + 3-number call. Badminton 30-cap. Configurable game-end predicate.
- **Bout/judge-panel** (boxing/MMA/fencing): boxing/MMA need **judge-panel mode (concept D)** + round clock + between-round timer. Fencing touch-lights/priority special.
- **Meet/leaderboard** (track/swim/XC/gym/cheer/golf/rowing): LEADERBOARD must add (1) marks-vs-times, (2) heat/flight grouping, (3) computed team scoring (place-sum XC, top-N gym/track), (4) judge-panel sub-mode (diving/gym/cheer), (5) wind/legality flags. Golf to-par + XC place-sum = derived fields.
- **E-sports** (CS2/Valorant/MOBA): 3-level nested (round→map→series like set sports) + multiple concurrent auxClocks (bomb, respawns) + economy/KDA statFields.

## 10 cross-sport "most commonly missed" (amateur→pro) — make each a first-class engine concept
1. **auxClocks[]** (down + up) — the #1 gap; single-`clock` is the biggest hole.
2. **teamState[]** — show the *situation*, not just the score.
3. **Per-ruleset config of the SAME sport** — a sport is a FAMILY of rule-set configs, not one.
4. **Nested/multi-level scoring** — set sports, esports, volleyball, team aggregates.
5. **Derived/computed fields** — line-to-gain, bonus tier, run-rate, to-par, place-sum.
6. **Special game-state sub-modes** — shootout, tiebreak, OT formats, power-play.
7. **Judge-panel mode (D)** — boxing/MMA/gym/diving/cheer.
8. **CORRECT CURRENT rule values** — wrestling TD=3, NFHS shot-clock optional, WP-W 30s, NCAA tennis no-ad. Stale value = WRONG board, gets laughed out of an officials' meeting.
9. **"Board is/isn't official time" flag** — rugby/FIFA unofficial; NCAA-soccer/HS official.
10. **Per-segment score capture** — line score (baseball), set-by-set, per-quarter box, per-over.

## Architectural takeaway
**Rule values must be per-ruleset, operator-overridable config SEEDS — never hard-coded constants** — they differ by governing body, by state, and change yearly. The 5 flagged "confirm before seeding" cases (NFHS football Q length 12, NFHS wrestling period structure by level, NFHS volleyball deciding-set 15, NFHS shot-clock per-state, WP men's shot clock value) prove the point.

## Sources (rulebook)
NFHS football clock-operator 2025 (assets.nfhs.org) · NCAA Football Rule 3 · 2024-25 NCAA/NFHS basketball differences (ncaaorg.s3) · NFHS shot-clock guidelines 24-25 · Bonus(basketball) Wikipedia · NFHS softball + NCAA scorebook + NJSIAA pitch-count · NFHS 24-25 soccer comparative guide + NCAA soccer book · NFHS volleyball paper-scoring + volleyref · NFHS wrestling 24-25 + themat 3-pt takedown + NCAA dual scoring · NCAA/NFHS/USAH hockey comparison · NCAA lacrosse 80s/60s shot clock · NCAA water-polo book + NFHS water-polo desk + NCAA-W 30s · NCAA field hockey · futsal/rugby/handball rules · USTA + NCAA no-ad tennis · pickleball/badminton scoring · boxing 10-point-must · Colorado Time swim/track · Olympic gymnastics D/E panels · cricket scoreboard · Valorant/CS2 broadcast UI.

**Flag before shipping seed data (confirm w/ a rules official):** NFHS HS football quarter length (12 vs conflated 15); NFHS wrestling period structure per level; NFHS volleyball deciding-set target (state-adoptable); NFHS basketball shot-clock per-state; WP men's shot-clock current value.
