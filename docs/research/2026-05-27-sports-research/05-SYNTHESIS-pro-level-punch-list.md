# Synthesis — what takes VenueOS to pro level (CTS-only filter)

**Source:** the 4 research-agent reports in this folder
(`01-operator-ux-game-console.md`, `02-display-surface-render-rules.md`,
`03-external-console-integration.md`,
`04-sport-engine-clock-state-machine.md`).

**Filter applied (per Greg, 2026-05-28):** drop every external
integration except CTS — no Daktronics All Sport adapter, no
Sportzcast / Scorebird vendor adapter, no Genius / Sportradar, no
MaxPreps / GameChanger, no Nevco, no NCAA live stats inbound, no
NFHS broadcast capture path, no streaming-overlay polish. Keep
everything that makes the rest of the app pro-level.

---

## The single unifying defect — "same rules apply" is broken

Every report flagged the same architectural bug, and Greg has called
it out by name twice:

> "all the same rules apply if we are doing it or the integration is doing it"

Right now there are **two different code paths** for changing game
state — operator console (`adjustScore`, `clockAction`, `setSegment`)
and integration ingest (`ingest`, `ingestCtsSnapshot`). They don't
share helpers:

| Helper                       | operator path | CTS path | feed path |
| ---                          | ---           | ---      | ---       |
| `maybeAutoCelebrate`         | ✓             | ✗        | ✓         |
| `syncShotClockToGameClock`   | ✓             | ✗        | ✗         |
| `syncPenaltiesToClock`       | ✓             | ✗        | ✗         |
| `record('SCORE', …)` event   | ✓             | ✗ (only sampled `CTS_SNAPSHOT_INGEST`) | partial (`INGEST` event) |
| AuditLog per mutation        | ✓             | ✗ (sampled) | partial |
| Score-floor clamp            | ✓             | ✓        | ✓         |
| Idempotency / dedup          | n/a           | ✗        | ✗         |

Two paths, two behaviors, divergent observability. **Item #1 below
fixes this as a structural refactor; every CTS-specific gap in the
next list collapses out of it.**

---

## TIER 1 — Ship this week (before next live game)

These are the 6 things that would let a pro back-room operator run
a game without getting embarrassed. Each is a 1-2 day build at most.

### T1-1. Unify operator + integration mutation paths
**Why:** Greg's "same rules" rule, every report. **Severity: critical.**

Refactor `ingest()` and `ingestCtsSnapshot()` to internally call the
same helpers the operator path uses — `setSegment`, `clockAction`,
`syncShotClockToGameClock`, `syncPenaltiesToClock`,
`maybeAutoCelebrate`, `record('SCORE'/'CLOCK'/'SEGMENT', …)`. The
helpers already exist; the integration path just bypasses them.

Files: `apps/api/src/sports/sports.service.ts` lines 1999-2030
(`ingest`), 2751-2862 (`ingestCtsSnapshot`), 2108-2182
(`maybeAutoCelebrate`), 1565-1600 (`syncShotClockToGameClock`).

After this, every CTS score writes a `SCORE` GameEvent + AuditLog,
fires the autoCelebrate cinematic exactly like the operator's +1
button, and freezes penalty clocks when CTS pauses the game clock.

### T1-2. Durable undo rail (10-deep, server-backed)
**Why:** Report 1 §1.2 + §4. **Severity: high — every operator hits this.**

Today: `lastScore` is a `useState` that vanishes on the next re-render.
Pro: a 25-row right rail of recent events, every row has an Undo
button.

We already have the data: every mutation writes a `GameEvent` row
(SCORE / CLOCK / SEGMENT / STAT / CUE / STATUS) — the operator
console just never reads them. Two pieces:

1. Extend `record()` to capture `prev*` snapshots on every event
   (today only `new` is stored).
2. New endpoint `GET /sports/games/:id/events?limit=25` + a right-rail
   panel in Run mode. Undo button synthesizes the inverse PATCH using
   the existing mutation routes (`score.mutate({delta: -delta})`,
   etc.) and records the inverse as a new `GameEvent` with
   `payload.undoOf=<eventId>`.

Files: `sports.service.ts` `record()` line ~360, `page.tsx` Run mode
(new RightRail component).

### T1-3. Hold-to-confirm on destructive transitions
**Why:** Report 1 §1.1, §6. **Severity: high — silent data loss.**

Today: tapping `+` next to "Q2" instantly wipes the clock to 8:00
stopped and there is no undo path. Same for FINAL transition.

Wire the same hold-to-trigger pattern the mobile panic page uses
(800ms hold animates a ring; release early = no-op):
- Segment ± chips at `page.tsx:803-820`
- FINAL status pill at `page.tsx:362-378`
- "Reset clock to segment start" button at `page.tsx:846-852`

Files: `apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx`.

### T1-4. Call Timeout — first-class action
**Why:** Report 1 §2 + §6.6, Report 4 P0-A. **Severity: high.**

Daktronics, ScoreVision, every HS console has a dedicated TIMEOUT
key per team. Today VenueOS has *no* timeout endpoint. Operator
must manually pause clock + edit a `homeTimeouts` stat field — two
mutations, atomic neither, no audit trail.

New endpoint `POST /games/:id/timeout { team, type? }`:
- Decrement `home/awayTimeouts` (atomic, with floor at 0)
- Call `clockAction({action:'pause'})` → cascades through #T1-1
- Reset football play clock to 25s if `sport === 'FOOTBALL'`
- Write `TIMEOUT` GameEvent + AuditLog row
- Fire a `timeout` CUE → triggers the scoreboard takeover overlay
  ("TIMEOUT — EASTSIDE 2 LEFT")

Operator UI: a `Timeout` button per team in the ScoreTile (already
has `homeTimeouts` stepper at the same spot — add a TO button next
to it).

Files: `sports.service.ts` (new), `sports.controller.ts` (new),
`packages/api-types/src/sports.ts` (extend `useGameControl`),
`page.tsx` ScoreTile sideStats.

### T1-5. Auto-fire status-transition cinematics
**Why:** Report 2 §1.1, §5.1. **Severity: high — looks amateur.**

When `setStatus` flips to HALFTIME or FINAL, the board just *swaps
scenes* on the next 750ms poll — no transition, no drama, no horn.
Pro: end-of-period buzzer fires a Q-end cinematic; halftime fires
"HALFTIME SHOW BEGINS"; FINAL fires a winner-spotlight celebration.

`setStatus` in `sports.service.ts:2225-2241` writes a STATUS
GameEvent. Just add: when status becomes HALFTIME / FINAL / END_OF_*,
emit a synthetic `CUE` with key `status:halftime` / `status:final-{winner}`
so the existing CUE feed plays a transition graphic. Add 3 cinematic
widgets in `v2/CelebrationsOtherSportsWidgets.tsx`.

Companion: fire a `'horn'` CUE from `autoAdvanceExpiredClocks`
(`sports.service.ts:1771`) on every clock-expired event (Report 4
P0-E). Add `celebrations: [{ key: 'horn', label: 'Horn', emoji: '📯' }]`
to every clockful sport's `SportDefinition`.

### T1-6. Per-surface health pill row in Run mode
**Why:** Report 1 §1.4 + §6.3. **Severity: high — flying blind.**

Today you have no idea if a scoreboard went dark mid-game.
`useGameScreens` already polls every 10s. Render a fixed pill row
pinned to the top toolbar:

```
🟢 Scoreboard · 🟢 Ribbon · 🔴 Concourse-3 (offline 14s)
```

Click pill → opens that surface in a side-by-side iframe drawer.

Files: `page.tsx` toolbar, reuse `useGameScreens` data
(`use-api.ts:2731`).

---

## TIER 2 — Within the next sprint (the "looks like a pro system" tier)

### T2-1. CTS bridge full-fidelity pass
**Why:** Report 3 P0-1, P0-4, #1, #3, #6. **Severity: high — water polo install depends on this.**

Five module types are decoded from CTS by the parser, then **dropped
on the floor before the POST body**:

| CTS module | Today | Should |
| --- | --- | --- |
| 0x06 / 0x07 home/away shot clock | parsed → discarded | per-side `{ms, running, at}` objects in `stats.cts` |
| 0x08-0x0A / 0x0B-0x0D home/away exclusions (3 each) | parsed → discarded | merged into `stats.penalties` with `source: 'cts'` |
| 0x10 / 0x11 home/away timeouts remaining | parsed → discarded | merged into `stats.homeTimeouts` / `awayTimeouts` |

Three commits:
1. Extend `CtsBridge.tsx` POST body (lines 774-782) with the missing
   fields.
2. Extend `cleanCtsSnapshot` in `sports.service.ts:2684-2740` to accept
   them.
3. Extend `applyCtsOverlay` in `apps/web/src/lib/cts-merge.ts:144-182`
   to merge them into the board overlay.

Companion fix (Report 3 P0-3): `clockRunning` is currently inferred
from "did the display string change in 800ms?" which false-pauses on
high clock values where CTS only emits once per second. Derive from
packet inter-arrival cadence instead — track `lastPacketAt` per
module 0x01, treat sustained gap > inter-tick * 1.5 as paused.

### T2-2. Keyboard shortcuts on the operator console
**Why:** Report 1 §1.5 + §6.4. **Severity: high.**

A scorekeeper on a laptop cannot tap Space to start/stop. There are
ZERO `keydown` handlers anywhere in the sports console.

One `useEffect` with a document-level listener:
- `Space` = start/stop clock
- `h` / `a` = score +1 home/away
- `Shift+H` / `Shift+A` = −1
- `1`-`9` = fire cue tile N
- `u` = undo (wires into T1-2)
- `r` = reset clock (with confirm)
- `t` / `Shift+T` = timeout home/away (wires into T1-4)
- `?` opens a cheat-sheet modal

Cheap, transformative, gates on `mode === 'run'` so Setup-mode typing
isn't intercepted.

### T2-3. Multi-role views (scorekeeper / show-caller / PA)
**Why:** Report 1 §3. **Severity: medium-high — pro production needs role split.**

Today the console is one giant page; every operator sees every
surface, and a show-caller can crash the scoreboard with a bad tap.

Three layout modes gated by `?view=score|show|pa`:
- **Score** — only score + clock + sport stats. Hides cues / roster /
  ribbon preview entirely. The "JV-game volunteer" view.
- **Show** — ribbon + scoreboard iframe thumbnails always-on, full
  `CueLaunchpad` always-on (not a popup), spotlight roster. Hides
  every clock / score control. The "second tablet at the table."
- **PA** — current spotlight (read-only), roster with one-tap
  spotlight + intro reel. No clock, no score, no cues. Phone view.

Layout-only commit — no schema changes. Server-side, the deeper
change is making destructive mutations role-aware (today every
CONTRIBUTOR has full `useGameControl`).

### T2-4. Pre-game starting-lineup choreography
**Why:** Report 2 §1.3, §5.6. **Severity: medium — every parent expects this.**

A `RosterPlayer` model exists (`schema.prisma:1791-1809`) with
photoUrl + stats. The ribbon's `buildLooks` includes a `kind: 'player'`
look but it just cycles 7.5s static cards mixed with sponsors. There
is no choreographed starting-lineup sequence on the scoreboard.

New `pregame-intro` cue mode: when fired from the operator panel,
takes over the scoreboard for a 30-second sequence. Per-player 3.5s
slots: photo + name + number + position + 1 stat line, with
team-color brand shim. Music sync via existing `audioUrl` field on
custom cues. Skippable. Add `?intro=1` query param so it triggers
from a tablet without typing.

### T2-5. Live-game text overlay system
**Why:** Report 2 §1.4, §5.4. **Severity: medium-high — football needs this badly.**

Zero hits for `PenaltyBanner` / `InjuryTimeout` / `ReplayReview` in
the entire codebase. Football broadcasts spend half their on-screen
time on these strips.

New `LIVE_OVERLAY` event type + three banner widgets:
- `PenaltyOverlayWidget` — 3s lower-third "HOLDING #44 — 10 YDS"
- `OfficialReviewOverlayWidget` — persistent until cleared
- `TimeoutOverlayWidget` — fly-in pill "AWAY TIMEOUT — 2 LEFT"

Operator panel: a "Call" group in `CueLaunchpad.tsx` next to the
existing celebration cues. Auto-clears on next CLOCK start. Pairs
with T1-4 (timeout button fires the overlay automatically).

### T2-6. Ribbon ≠ Scoreboard cue rendering
**Why:** Report 2 §1.5, §5.5. **Severity: medium — looks "made by one person."**

Today `target: 'RIBBON'` plays the SAME full-bleed 4500ms cinematic
as the scoreboard, on a strip that should be tighter. Pro flow:
scoreboard plays the 4-second cinematic; the ribbon does a single
"TOUCHDOWN — BROWNS 14" crawl; the scorebug pulses.

Add a `ribbonStrip` boolean to the cue payload — when true, ribbon
uses `RibbonCelebrationStrip` (text-crawl-only) for ~2.5s instead of
`RibbonCueOverlay`'s 4500ms full takeover.

Companion (Report 1 §5 + §6.8): the inline cues bar in Run mode
hardcodes `target: 'ALL'`. Add Board/Ribbon/All chips on the inline
bar so the fast path can fire to one surface.

### T2-7. Football play clock slaved to game clock
**Why:** Report 4 P0-B, #2. **Severity: high for football tenants.**

`setPlayClock` (`sports.service.ts:1463`) runs completely independent
of `clockAction`. When the operator stops the game clock for a
stoppage, the 40-second play clock keeps counting down on its own
and never auto-resets to 25 (the correct duration after a stoppage).
Game clock resume doesn't auto-start the play clock.

Add `syncPlayClockToGameClock` mirroring `syncShotClockToGameClock`
(lines 1565-1600). Call it from `clockAction` start/pause AND from
`setSegment` and `autoAdvanceExpiredClocks`. On `'start'` auto-start
play clock to 40s if armed; on `'pause'` freeze it.

After T1-1 unifies paths, this also fires on CTS-driven clock state
changes for free.

### T2-8. Possession arrow as first-class field
**Why:** Report 4 P0-D, #7. **Severity: medium-high — basketball needs this.**

Today `possession` is free-text on basketball and football (`'home'`
or `'away'` typed by hand into a stat field). Basketball's
alternating-possession-arrow rule (flips after every held ball) is
entirely absent.

`POST /games/:id/possession { team }`. New `Game.possession` text
column with `'home' | 'away' | null` validator. Operator UI: a POSS
toggle button between home/away score tiles. For basketball, auto-flip
on a `STAT_BALL_AWARD` event (manual until we have a held-ball
action).

### T2-9. Sponsor frequency cap + per-impression log
**Why:** Report 2 §1.2, §3, §5.2-3. **Severity: high — blocks ad-revenue sales.**

`Sponsor.frequencyCapPerHour` is in the schema and accepted by the
API, but the rotation logic in
`board/[gameId]/page.tsx:540-549` and `ribbon/[gameId]/page.tsx:514-521`
builds slots purely off `weight` and never reads the cap. A Title
sponsor at cap=12/hr can air 200 times an hour.

Also: `sponsors.service.ts.report()` returns an *estimated* spot
count = `cycles × weight`. There is no per-impression log. We can't
ship a sponsor a real proof-of-play PDF.

Two commits:
1. Per-game `useRef<Map<sponsorId, lastShownAt[]>>` in the rotation
   builder; drop sponsor if `lastShownAt[]` in trailing hour ≥ cap.
   Re-filter `flightEndAt` client-side every tick.
2. New `SponsorImpression` Prisma model `{ sponsorId, gameId,
   surfaceKind, ts }`. Board/ribbon/scorebug pages POST to
   `/sports/sponsors/:id/impression` when a sponsor look enters
   view. Per-game and per-tenant report endpoints aggregate from the
   table.

Schema migration is additive (new table, no existing column changes)
— pilot-safe.

### T2-10. Per-team auto-reset on segment advance
**Why:** Report 1 §1.3, Report 4 Invariants 2, 3, 6, 7. **Severity: medium.**

Several "should-happen-on-segment-advance" rules are silently
missing:

- Basketball `homeFouls` / `awayFouls` don't auto-reset per period
  (operator has to clear them manually; missed once → bonus logic
  breaks for the whole half)
- `homeTimeouts` / `awayTimeouts` don't auto-reset between halves
  (where the sport's rule says they should)
- Shot clock not reset on segment advance
- `applyBaseballCount` strikeout-out and `applySetWin` set-win never
  fire a `CUE` — declared celebrations are dead code
- Shot clock should clamp at `Math.min(ms, gameClockMs)` (no
  24-second shot in 0:08-left Q4)

All small, mechanical wires. `setSegment` already exists — add the
rule logic per `SportDefinition`. Wire `applyBaseballCount` +
`applySetWin` to `maybeAutoCelebrate` looking up celebrations where
`key === 'strikeout' | 'setWin'`.

---

## TIER 3 — Architectural moves (the moat tier)

### T3-1. Typed `GameState` per sport
**Why:** Report 4 #10. **Severity: foundational, not urgent.**

Today `Game.stats` is a free-form `Record<string, unknown>` holding
`shotClock`, `playClock`, `penalties[]`, `cts`, `homeFouls`, plus
operator's free-text `possession` string. Typo-prone, silently
swallows wrong-key writes, no compile-time safety per sport.

Migrate to a discriminated union per sport-key. Additive schema
migration (new typed columns alongside `stats`); each `Game` row
gradually fills the typed columns as it's touched. Catches every
"operator typed wrong key, scoreboard renders zero" failure mode.

This is the architectural fix that unlocks T2-8 / T2-10 / future
per-sport rule layers cleanly.

### T3-2. Game rundown / pre-game script
**Why:** Report 1 §5, §6.5. **Severity: medium — workflow gap.**

The show caller has to remember what to fire at first-Q timeout, at
halftime, before player-of-the-game spotlight. We have every
primitive (cues, sponsors, spotlights, sponsor rotation weights).

New `GameRundownItem` Prisma model:
```
{ gameId, sequenceOrder, triggerType: 'manual'|'timeoutN'|'segmentStart'|'segmentEnd'|'final',
  cueId | spotlightPayload | sponsorId | templateSwapPayload,
  notes }
```

Show-caller view (T2-3) gets a `RundownPanel`: drag-drop sequence,
trigger types, each item resolves to a fire-cue / fire-spotlight /
set-template / TIMEOUT-overlay payload. Auto-fires on the matching
event; the operator can mark each item DONE inline.

Lets a show caller write their game plan Monday and run the show
Friday without thinking.

### T3-3. Mid-game template swap with auto-revert
**Why:** Report 1 §5 "mid-game template swap." **Severity: low-medium.**

Today swapping templates mid-game is irreversible (operator
manually swaps back). Add an "auto-revert in N seconds" option so a
celebration-board template can take over for 8 seconds then
automatically return — the canonical broadcast pattern.

---

## Out of scope (per Greg's 2026-05-28 direction)

Items in the original reports that we **don't** ship in this pass
because they're non-CTS integrations:

| Item | Source | Reason for skip |
|---|---|---|
| Daktronics All Sport adapter | Report 3 #5 | Not CTS |
| Sportzcast / Scorebird vendor adapter | Report 3 §4 | Not CTS (the generic `/feed` stays — it's our own) |
| ScoreVision integration | Report 3 §4 | Not CTS + closed system |
| Genius Sports / Sportradar pull | Report 3 §4 | Not CTS |
| MaxPreps / GameChanger import | Report 3 §4 | Not CTS |
| NCAA live stats | Report 3 §4 | Not CTS |
| NFHS broadcast HDMI-IN capture | Report 3 §4 | Not CTS |
| Bidirectional CTS-style writes to other consoles | Report 3 #7 | Not CTS (we're keeping CTS as inbound-only for now) |
| Streaming overlay polish (anti-burn, OBS recipe, palette override) | Report 2 §4 | Defer — not a pro-level live-game gap |
| Concourse takeover during games | Report 2 §5.10 | Defer — not core to the live game |

These remain documented in the source reports for when they're
revisited.

---

## Recommended order of execution

1. **T1-1** (unify paths) FIRST — every other T1 + every CTS item in
   T2-1 depends on the operator/integration helpers being shared.
2. **T1-2, T1-3, T1-4** in parallel (independent UI commits).
3. **T1-5, T1-6** any time after T1-1 (independent).
4. **T2-1** (CTS full fidelity) immediately after T1-1 — water polo
   install needs it.
5. **T2-7** (play clock slave) any time after T1-1 — football tenants.
6. **T2-2, T2-3** in parallel with T2 work above (pure UI).
7. **T2-4, T2-5, T2-6** any time (display-side commits).
8. **T2-8, T2-9, T2-10** any time.
9. **T3-1** (typed GameState) — start when T2 is stable; this is the
   foundation that makes T3-2 / T3-3 clean.

Total: 6 ship-this-week items, 10 within-sprint items, 3
architectural moves. Every item has cited file paths in the source
reports. None are speculative.
