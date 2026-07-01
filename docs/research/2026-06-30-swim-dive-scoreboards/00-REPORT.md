# Swimming & Diving Scoreboards — Research + Proposed VenueOS Sport Engine Widgets

**Date:** 2026-06-30
**Author:** research agent (read/WebSearch/WebFetch only — no code changed)
**Scope:** Standard Audit Surface §7 (sports data integrations) + §19 (widget editability). This is a **gap analysis + design proposal**, not an implementation.

## TL;DR / Recommendations

1. **We are missing competitive SWIMMING entirely.** It is a *lane/heat/time* sport with a rich, well-standardized data model (8–10 lanes × {name, team, seed, live rank, splits, running time, finish, place}) that maps cleanly to a small widget set. This is a high-value, mostly-mechanical add — the data model and timing-system feeds are standardized across the whole industry (Colorado Time Systems, Daktronics, Swiss Timing/Omega) and every real board renders essentially the same fields.
2. **DIVING is a fundamentally different sport and must be SPLIT out of Swimming.** Diving is a *judged* sport: a panel of 3–7 judges score each dive 0–10, drop high/low, sum × Degree of Difficulty (DD), accumulate a running total across a fixed dive list, rank vs. field. There are **no lanes, no times, no splits**. Bundling it with Swimming would force a lanes-and-times widget model onto a judges-and-DD sport — exactly the "wrong widget set" failure mode. Make **Diving its own sport** in the sport engine with its own widget set.
3. **Build a reusable "Lane/Heat board" primitive.** Swimming's lane-grid is the same shape as Track & Field running events and Rowing/Crew. Design the swimming lane-grid so the "sport" is a parameter (stroke/distance vs. event name), and Track/Rowing largely fall out for free later.

---

## PART A — SWIMMING

### A1. The Lane Model (the core data structure)

A swim race is **N lanes** (typically 1–8; up to 10, and CTS/Daktronics consoles support up to 12) running simultaneously. Each lane carries a swimmer (or a 4-person relay). Per lane, a real board can show:

| Field | Meaning | When it appears |
|---|---|---|
| **Lane #** | Physical lane (1..N) | Always (row identity) |
| **Swimmer name** | Athlete (or relay team) name | Start list / results (from meet-manager data, not the timer) |
| **Team / club** | School / club code | Start list / results |
| **Seed time** | Entry time (fastest prior time) — the swimmer's "expected" time; used to place them into heats/lanes | Pre-race / start list |
| **Live place / rank** | Current position *as the race runs* | During race (recomputed on every touch/split) |
| **Split time** | Time at each length/turn — *subtractive* (this length) or *cumulative* (elapsed) | During race, per length |
| **Running / cumulative time** | Elapsed race clock (counts up); the leading lane's running clock is often shown large | During race |
| **Finish time** | Final time when the lane touches the pad | On touch |
| **Final place** | 1st/2nd/3rd… after the touch | On touch |
| **Reaction / takeoff time** | Start-reaction (blocks) or relay-exchange time | Advanced boards, relays |

**Two display orderings** (both are real, board-selectable — Daktronics OmniSport lets the operator pick):
- **LANE order** — rows sorted by lane number (default when #lanes ≤ #lines). This is the "grid" view spectators use to find their swimmer.
- **PLACE order** — rows sorted by finish rank (default when #lanes > #lines / for results). This is the "results list."

A good VenueOS board should support **both, as a toggle**, because that's exactly what the professional consoles do.

### A2. Meet context (the header)

Every board shows *which race this is*. From a swim heat sheet / meet program the fields are:

- **Event #** + **event name** (order the events are swum in).
- **Heat #** and **heats-in-event** (e.g., "Heat 4 of 7"). Heats run slowest→fastest; the last heat is the fastest.
- **Distance + stroke**: distance (50/100/200/400/500/800/1500/1650…) × stroke — **Free, Back, Breast, Fly, IM (individual medley), Relay**. Medley relay stroke order is fixed: Back → Breast → Fly → Free.
- **Course**: SCY (short-course yards) / SCM / LCM (long-course meters) — affects how times/records read.
- **Age group / division / gender**.
- **Round**: Prelims vs. Semis vs. Finals (prelims use "circle seeding").

The timing console (CTS/Daktronics) natively sends **Event & Heat** as their own scoreboard channels; names/teams/seed come from the **meet-management** software (Hy-Tek MEET MANAGER, Splash Meet Manager) merged with the live timer feed.

### A3. Record lines

Boards display pace/record reference lines and flash when broken:
- **WR** (world), **AR** (American), **NR** (national), **US Open**, **pool record**, **meet record**, and championship/qualifying cuts.
- A "**record pace**" line and a "**RECORD**" flash when a live/finish time beats the reference. CTS reserves a scoreboard channel for "lengths and pool records."

### A4. Relays

A relay lane is **4 swimmers** in a fixed order. Board needs:
- The 4 swimmer names per lane (or the relay team name, with leg names on expand).
- **Per-leg splits** (each 100/50 leg's time) and **cumulative** relay time.
- **Exchange / takeoff time** — the reaction time at each handoff (legal ≥ 0.00; a negative exchange = DQ). This is a relay-specific field the consoles capture via relay take-off platforms.

### A5. Lane states (must be first-class, not afterthoughts)

- **On the blocks / "on deck"** — heat is staged.
- **Up next / on deck** — the following heat's swimmers.
- **DQ** — disqualified (show "DQ", suppress place, keep the name).
- **SCR / scratch** — withdrew.
- **Empty lane** — no swimmer assigned (render blank row, not a zero).
- **NS** — no-show / did not start.
- **DFS/DNF** — declared false start / did not finish.

### A6. Layouts real boards use

1. **Heat-lane GRID** (lane rows) — the primary live board. One row per lane, columns = lane / name / team / (live rank) / split or running time / finish / place. This is the "now swimming" view.
2. **Results LIST** (rank order) — post-race, sorted by place; often the same widget in PLACE mode.
3. **Broadcast lower-third / scorebug** — a compact overlay for streaming: a leader strip or a single-lane callout (name, team, lane, split/time, live rank), plus the big running clock. (NBC-style; the actual on-air version overlays the underwater/finish shot.)
4. **"Now swimming / Up next" flow** — header states that cycle: *On the blocks → racing (live splits) → results → Up next heat*. This cadence is what makes it feel live.

### A7. Timing systems & how a board gets the data (the integration surface)

This is standardized across the industry — three vendors, well-documented feeds. Any signage vendor "taps" one of these:

- **Colorado Time Systems (CTS)** — *Gen7* (legacy + serial variants), *System 6* console, *Dolphin* wireless. **Scoreboard serial protocol** is the tap point: **RS-232, 9600 baud, 8-E-1**. Data is a stream of **module packets** addressed 0x00–0x1F:
  - `0x01–0x0A` = lanes 1–10 (`0x17–0x18` = lanes 11–12), each carrying **`[Lane][Place][Min][Sec][hundredths]`**.
  - `0x0B` = lengths & pool records · `0x0C` = **event & heat** · `0x0D` = team scores · `0x16` = time-of-day · `0x19–0x1E` = **split times** (lane pairs).
  - Modules daisy-chain: each matches its address and relays the rest downstream. There are open Arduino/Python/Node emulators of this exact stream — meaning **we can build a CTS-serial ingest without reverse-engineering.**
- **Daktronics OmniSport 2000** — console for aquatics/track; talks to touchpads, relay take-off pads, start-reaction. Interfaces to **Hy-Tek MEET MANAGER** for **event order + start lists with competitor names**. Outputs to numeric boards (MultiDrop/MultiLine) *and* to video boards as **RTD (Real-Time Data)** sequences. The **MEET MANAGER computer merges timer data + names/affiliation and sends the combined feed to the videoboard** — this is exactly the pattern VenueOS would consume for a video board. (Note: Daktronics has announced sunsetting OmniSport, so favor the CTS serial + Hy-Tek RTD paths.)
- **Swiss Timing / Omega** — Olympic-level (Quantum/Ares). Boards list "Omega" as a selectable protocol; same field set at the top end (country codes, names, splits, records).
- **Software layer**: **Hy-Tek MEET MANAGER** and **Splash Meet Manager** hold the roster/seed/event data; the timer holds the live clock/splits. **Names+seed come from meet-mgmt; times+splits+place come from the timer; the board merges them.** VenueOS's ingest must join these two streams on (event, heat, lane).

> **Integration Concierge angle:** an operator should paste/select their timing system ("Colorado Time Systems System 6", "Daktronics OmniSport", "Swiss Timing") + point us at their Hy-Tek/Splash export, and we auto-wire the lane-grid — matching the "no IT consultant" north-star. A **CTS RS-232 → LAN bridge** (or the venue's existing scoreboard serial line) is the physical tap.

### A8. Proposed VenueOS **Swimming** widget set

Each widget lists the data it needs. All follow the §19 editability standard (text/color/brand-palette addressable) and the sport-engine per-sport pattern.

| Widget | Purpose | Data needed |
|---|---|---|
| **`SWIM_LANE_GRID`** (flagship) | Live heat board, one row per lane; LANE⇄PLACE toggle | per-lane: lane#, name, team, seed, liveRank, latestSplit/runningTime, finishTime, place, state(DQ/SCR/empty); config: #lanes, split mode (subtractive/cumulative), order mode |
| **`SWIM_RESULTS_LIST`** | Post-race results in rank order | ranked list of {place, lane, name, team, finishTime, gap-to-1st}; can be same engine as grid in PLACE mode |
| **`SWIM_EVENT_HEADER`** | Meet context bar | event#, event name, heat# / heats-in-event, distance, stroke, course (SCY/LCM), age/gender, round (prelim/final), state (on blocks / racing / final) |
| **`SWIM_RECORD_LINE`** | Record/pace reference + broken flash | record type(s) (WR/AR/NR/pool/meet), record time, holder, live "on/off pace" delta, `broken` flash |
| **`SWIM_SPLITS_PANEL`** | Per-length split table for a focused lane/heat | per length: length#, split (subtractive) + cumulative; optional pace-vs-record row |
| **`SWIM_RELAY_EXCHANGE`** | Relay legs + takeoffs | per lane: 4 leg names, per-leg split, cumulative, exchange/takeoff time (flag negative = DQ) |
| **`SWIM_SCOREBUG`** (broadcast lower-third) | Compact streaming overlay | big running clock; leader strip OR single-lane callout {lane, name, team, split, liveRank}; transparent bg |
| **`SWIM_NOW_UP_NEXT`** | "Now swimming / Up next" flow strip | current heat summary + next heat's lane/name/team list |
| **`SWIM_TEAM_SCORE`** | Dual/championship team score | team names + cumulative points (CTS channel 0x0D) |

**Ingest layer (not a widget):** a `SwimTimingFeed` service that normalizes CTS-serial / OmniSport-RTD / Swiss-Timing into a canonical `{event, heat, lane[]}` snapshot on every touch/split, joined with Hy-Tek/Splash roster (names/seed). All widgets read from that snapshot.

---

## PART B — DIVING (a different sport)

### B1. Why diving is NOT swimming

Diving shares a pool and a governing body but shares **none** of swimming's data model:
- **No lanes, no clock, no splits, no finish time.** A diver performs one dive at a time from a board/platform.
- Scoring is **judged**, not timed. It's the same shape as gymnastics/figure-skating, not swimming.

### B2. Judged scoring model

- **Panel:** **3 judges** (HS dual/most HS meets — NFHS requires "at least three"), **5 or 7** at championships/college/international. Synchronized diving uses **9 or 11** judges split into execution + synchronization panels (e.g., 3 for diver A execution, 3 for diver B execution, 5 for sync).
- **Each judge scores 0–10 in half-point increments** (0 = failed, 10 = excellent).
- **Drop high/low** based on panel size:
  - 3 judges → (rules-dependent) typically keep all or drop nothing / use as-is.
  - 5 judges → drop 1 high + 1 low, sum the middle **3**.
  - 7 judges → drop 2 high + 2 low, sum the middle **3**.
- **Degree of Difficulty (DD):** each dive has a predetermined DD, **1.2 – 4.1** in 0.1 steps, from the dive's group (forward/back/reverse/inward/twisting/armstand), somersaults, twists, and position (tuck/pike/straight/free).
- **Dive score = (sum of kept judge scores) × DD.** (In HS the 3-judge sum is multiplied by DD then by a factor to normalize — display just the resulting dive score.)
- **Synchro:** sum {median exec diver A, median exec diver B, middle-3 sync scores} × DD × 0.6.

### B3. Dive list / rounds / rank

- The event is a **fixed list of dives** (each diver's own list), scored **cumulatively** — a **running total** across the list.
- **Dive count by level:** HS dual = **6 dives** (1 voluntary + 5 optional, one from each category); HS championship = **11 dives** (5 voluntary + 6 optional, all categories); the championship format is often **prelim (5/6) → semi (3) → final (3)**. NCAA/international springboard = **6 dives (women) / 6 (men) at many meets, 11-dive lists at championships**; platform lists vary.
- **Rank vs. field** is by running total; positions reshuffle after every dive (much like a leaderboard, not a fixed grid).

### B4. What a diving board/broadcast shows

- Current **diver name + team**, **dive # of N** in the list.
- The **dive being attempted**: dive number code (e.g., 105B), name, **DD**, group, position.
- **Individual judge scores** (the row of 0–10 marks) with dropped scores greyed out.
- Computed **dive score** for that dive.
- **Running total** and **current rank / place vs. field**.
- A **leaderboard** (all divers by running total).
- Synchro: two diver names + separate exec/sync judge rows.

### B5. Proposed VenueOS **Diving** widget set (separate sport)

| Widget | Purpose | Data needed |
|---|---|---|
| **`DIVE_JUDGES_PANEL`** | Row of judge scores for the current dive | judge scores[3/5/7], which are dropped, panel size |
| **`DIVE_CARD`** (current dive) | The dive being attempted + its math | diver name, team, dive code+name, group, position, **DD**, dive# of N, computed dive score |
| **`DIVE_RUNNING_TOTAL`** | The diver's cumulative score + rank | running total, place, dives completed / remaining |
| **`DIVE_LEADERBOARD`** | Whole field by running total | ranked list {place, diver, team, total, dives done} |
| **`DIVE_ROUND_HEADER`** | Event context | event (1m/3m springboard / platform), round (prelim/semi/final), dives-in-list, gender/division |
| **`DIVE_SYNCHRO_PANEL`** | Synchronized events | two diver names+teams, execution judges per diver, synchronization judges, combined score |
| **`DIVE_SCOREBUG`** | Broadcast lower-third | diver name/team, dive+DD, judge scores, dive score, running total, rank |

**Ingest layer:** diving is usually scored in **DiveMeets / Dive Live / Hy-Tek** — a `DivingScoreFeed` service normalizing {diver, dive#, DD, judge scores, dive score, running total, rank}. Completely disjoint from `SwimTimingFeed`.

### B6. How Diving slots into the per-sport widget model

Our engine already keys widget sets by **sport**. Diving becomes a peer sport (like basketball vs. water polo): its own entry in the sport catalog, its own `widgetSet`, its own sample templates and AI prompts ("judges panel", "DD", "leaderboard" — never "lanes/splits"). Swimming and Diving can share a **vertical/venue** ("Aquatics") and even a physical board, but they are two sports with two widget sets — the same way a sports venue runs basketball and volleyball on one scoreboard.

---

## PART C — Reusable "Lane / Heat board" primitive

Swimming's lane-grid generalizes. Design `SWIM_LANE_GRID` so the sport-specific bits (stroke/distance label, split semantics) are config, and these fall out cheaply later:

- **Track & Field (running events):** identical shape — lanes × {athlete, team, lane, reaction, place, time}, Event/Heat header, records, LANE⇄PLACE. Daktronics/FinishLynx & Hy-Tek Track feed it. Field events (jumps/throws) are attempt-based (closer to diving's attempt/leaderboard model — a *second* reusable primitive: the **attempt-leaderboard**, which Diving also uses).
- **Rowing / Crew:** lanes of boats × {crew, seed, split (per 500m), elapsed, place} — same lane-grid with a "per-500m split" instead of "per-length split."

So two reusable primitives cover a lot of ground:
1. **Lane/Heat grid** → Swimming, Track (running), Rowing.
2. **Attempt leaderboard** (judged/measured, cumulative total, rank-shuffling) → Diving, Track field events, Gymnastics.

Building Swimming's lane-grid and Diving's leaderboard cleanly = most of these other sports for near-free.

---

## Sources (URLs actually read)

**Swimming boards & fields**
- Colorado Time Systems — Numeric LED Scoreboards (LED-R) for Swimming, Diving, Water Polo: https://coloradotime.com/products/numeric-led-scoreboards-led-r-for-swimming-diving-and-water-polo
- SwimDisplay — Specifications (fields + timing-system compatibility): https://swimdisplay.com/specifications.php
- SwimDisplay — Numeric scoreboards: https://swimdisplay.com/numeric_scoreboards.php
- SwimOutlet — How to Read a Swim Meet Program: https://www.swimoutlet.com/blogs/guides/how-to-read-a-swim-meet-program

**Timing systems & protocols**
- Colorado Time Systems — Gen7 Swim Timing (Legacy): https://coloradotime.com/products/gen7-swim-timing-legacy
- Marco's Corner — Colorado Timing Console Scoreboard Protocol (RS-232 9600 8-E-1, module/address/lane/split map): https://marcoscorner.walther-family.org/2015/07/colorado-timing-console-scoreboard-protocol/
- Daktronics — OmniSport 2000 controller: https://www.daktronics.com/en-us/support/controllers/omnisport-2000
- Daktronics KB — Lane vs. Place results display: https://www.daktronics.com/en-us/support/kb/DD2637631
- Daktronics — Swimming Software / Hy-Tek MEET MANAGER + RTD videoboard: https://www.daktronics.com/en-us/support/components/swimming-software

**Diving scoring**
- USA Diving — Judging and Scoring (panels, DD, synchro): https://www.usadiving.org/about-us/diving-101/judging-and-scoring
- The Diver Guy — How Diving Scoring Works (5/7-judge drop rules, DD): https://www.thediverguy.com/pages/how-diving-scoring-works
- NBC Olympics — Diving 101 scoring: https://www.nbcolympics.com/news/diving-101-olympic-scoring-rules-and-regulations
- NFHS — HS diving rules (6-dive dual, 11-dive championship, ≥3 judges): https://nfhs.org/stories/high-school-swimming-diving-rules-changes-address-number-of-dives-during-championship-meets
- OHSAA — Official NFHS Diving Scoresheet (dive list/DD structure): https://www.ohsaa.org/sports/sd/diveforms/NFHSscoresht.PDF

**Lane/heat parallels**
- Daktronics — Track & Field scoreboards (FinishLynx/Hy-Tek, lanes + Event/Heat + records): https://www.daktronics.com/en-us/products/sports/track
- Daktronics — Track & Field interface setup (PDF): https://www.daktronics.com/web-documents/customer-service-manuals/dd3059635.pdf
