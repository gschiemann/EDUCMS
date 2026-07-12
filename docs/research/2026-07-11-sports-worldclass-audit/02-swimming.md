# Swimming — world-class audit

> Auditor: single Opus agent (one-at-a-time cadence, 2026-07-12). Read-only,
> file:line-cited, graded against a Daktronics/Colorado-Time-Systems-grade
> natatorium production. Real CTS timing install pending — high bar.

## Grades
Design: **A-** — Lane grid, Stadium Lane trio, record line, and portrait LED support are genuinely broadcast-grade; only the missing live team-score strip keeps it from A.
UX: **B-** — The lane pad (roster autofill, auto-place, DQ/SCR chips, undo, debounced mid-heat publish) is world-class; but team points are operator mental math, and splits/relays/records demand typing into template config mid-meet.
Functionality: **C** — The manual loop is race-hardened (#292 drain, withStatsTx), but two crowd-visible wrong-result paths, an unreachable CTS chain, and decoded-then-discarded data leave the "real CTS install" promise unmet.

## Findings

**[P0 — FIXED `c221bcab`… (this pass)]** CTS ingest — fabricates red "DQ" on empty lanes (`apps/api/src/sports/swim-timing-feed.ts:68-72`; heatOver at `apps/api/src/sports/sports.service.ts:5613-5619`) — 6 swimmers in an 8-lane pool: lanes 7/8 broadcast 0xFF (blank); the instant the first swimmer touches, `heatOver` flips (still-racing lanes satisfy `display !== ''` via running time) and both empty lanes persist `mark:'DQ'`. `readResults` keeps name-less rows with a mark (`apps/web/src/components/widgets/v2/_shared/sports-situational.tsx:90`), so the natatorium board shows red DQs (`SwimDiveWidgets.tsx:389,420`) — mid-race, on lanes that were simply empty. Also wrong semantics: a no-time lane is empty/NS; real DQs post times and come from the referee. **FIX:** `laneMark` never fabricates DQ — a blank lane is empty (time-or-blank only); the whole `heatOver` inference was removed. DQ/SCR stay operator-entered via the lane pad chips. Empty lanes now have blank mark + blank name → dropped downstream, so they vanish instead of showing red DQs.

**[P0 — FIXED this pass]** Console+board — "current event" ordering poisoned by event *names* (`lane-pad.ts:201-207`; `pickEvent` at `apps/web/src/components/widgets/sports/SwimDiveWidgets.tsx:244-248`; same reduce in `apps/web/src/app/ribbon/[gameId]/page.tsx:450-454`) — the lane pad's own placeholder invites "100 Free"; `parseInt('500 Free')`=500 → order 50000+heat. In standard NFHS dual-meet order, every event after the 500 Free (200 Free Relay, 100 Back, 100 Breast, 400 Free Relay) computes a *lower* order, so board and ribbon stay stuck on the 500 Free's results for the back half of the meet. **FIX:** `buildHeatResult` now derives the deterministic `eventNumber*100+heat` order ONLY when BOTH fields are bare integers (`/^\d+$/`); a NAME like "500 Free" (even digit-leading) falls back to `orderHint` (entry recency), so the newest heat is current and corrections replace-in-place without jumping to current. `pickEvent`/ribbon reduce unchanged (they just surfaced the bad order).

**[P1]** CTS integration — no shipped client for the swim feed: nothing in apps/web or the player instantiates `SwimTimingParser` or POSTs `/swim-timing-snapshot` (endpoint at `apps/api/src/sports/sports-board.controller.ts:241`); `CtsBridge.tsx` is water-polo-only, `mock.ts` has no swim feed. A venue with a real CTS console cannot connect without writing its own bridge software.

**[P1]** Console — CTS status pill blind to the swim feed: `CtsConsoleStatus` reads `stats.cts.lastUpdateAt` (`sports/[gameId]/page.tsx:7534`), which `ingestSwimTimingSnapshot` never writes (`sports.service.ts:5638-5675`); its guidance ("open a kiosk with `?cts=1`", page.tsx:7570) launches the water-polo parser, which can't decode the swim wire format. With a live swim feed running, Setup shows "never connected."

**[P1]** Board — dual-meet team score invisible during LIVE: the swim default renders only `SwimLaneGridWidget` (`board/[gameId]/page.tsx:4548-4558`), which has no score strip; CTS module 0x0D lands in `stats.swimHomeScore/swimAwayScore` which **nothing reads** (sole site `sports.service.ts:5652-5653`); and the lane pad never auto-credits NFHS 6-4-3-2-1 / relay 8-4-2 points despite `SWIMMING.score` documenting them (`packages/api-types/src/sports.ts:1034-1037`) — the operator computes place points mentally and taps chips. Team score appears only at PRE_GAME/FINAL or via an opt-in Stadium template.

**[P1]** Splits — decoded then discarded: the parser fills `snapshot.splits` (`packages/scoreboard-cts/src/swim-timing.ts:365-372`), but `normalizeSwimSnapshot` never reads them (`swim-timing-feed.ts:87-124`) and `SwimSplitsPanelWidget` renders only operator-typed config rows (`SwimDiveWidgets.tsx:811-817`). No split from the timer can ever reach a board; hand-typing per-length splits into a PropertiesPanel mid-race is not a live workflow.

**[P2]** Lane pad — dead-heat ties get distinct places: `computePlaces` assigns sequential 1..n for identical marks via stable lane-order sort (`lane-pad.ts:112-130`); swimming awards tied places (and splits the points). Operator must notice and override both lanes.

**[P2]** CTS parser — mid-stream attach can misframe indefinitely: framing is fixed-length with no checksum and 1-byte resync only for *unknown* modules (`swim-timing.ts:261-286`), but payload bytes (lane 1-12, place 0-12, seconds 0-59) overlap the 0x01-0x0A module address space, so joining an already-broadcasting console (the normal case) can lock onto wrong boundaries and emit garbage lane times; real listeners resync on inter-byte timing gaps. The header even references a `resyncToKnownModule` that doesn't exist (`swim-timing.ts:24`).

**[P2]** CTS parser — module 0x0B (lengths & pool records) not decoded (`swim-timing.ts:29,129-138`): no lengths counter for the 500 Free — a table-stakes natatorium display — and on-wire pool-record data is dropped.

**[P2]** Records/relays — display-as-typed only: `SWIM_RECORD_LINE` needs hand-typed record, pace deltas, and a manual `recordBroken` flag (`SwimDiveWidgets.tsx:913-965`) — no auto-compare against live finish times; relay legs/exchanges are template config, not console entry (`SwimDiveWidgets.tsx:580-616`).

**[P2]** Celebrations — zero swim cinematics: no `swimming/*` keys in MARQUEE/DECK/V2_KEYS (`apps/web/src/lib/celebration-assets.ts:14-119`); all four defined cues (`sports.ts:1045-1050`) fall to generic confetti while gymnastics/cheer/pickleball/wrestling got bespoke scenes (2026-06-13 wave predates the 07-01 swim split).

**[P3]** Manual↔CTS label mismatch: `"12 — HEAT 3"` (`lane-pad.ts:147-153`) vs `"EVENT 12 — HEAT 3"` (`swim-timing-feed.ts:49-52`) — switching sources mid-event duplicates the heat row, defeating the stated design goal (`lane-pad.ts:23-25`).

**[P3]** Meet structure polish: no event program ("Event 12 of 24" / up-next queue); heat auto-increment never resets when the event changes (`LanePadSection.tsx:364-371`); the `course` stat (SCY/SCM/LCM) is captured but rendered nowhere (`sports.ts:1041`; `board/[gameId]/page.tsx:1578-1581`).

## Strengths
- **Lane pad is best-in-class for manual timing**: roster-by-lane autofill, auto-place from parsed marks with operator override, DQ/SCR round-tripping, one-tap heat advance with auto-increment and true Undo (grid + persisted state), and a debounced provisional publish so the wall board is never a heat behind (`LanePadSection.tsx`, `lane-pad.ts` — pure and unit-tested).
- **Serious concurrency discipline**: provisional-drain before finalize (#292), Serializable `withStatsTx` on the 5-10Hz ingest, single merged write including the audit-cadence marker, sampled AuditLog.
- **Board defaults are right**: dedicated lane grid at LIVE (portrait 960×1080 aware), PreGame/Final winner moments, empty-shell + "bind a game" callout instead of fake data, place-sorted `readResults` keeping ribbon/board honest; console preview iframes the real `/board` so parity is structural.
- **CTS decoder itself is faithful and fully round-trip tested** (12 lanes, event/heat, team score, splits, blank semantics; encode/decode inverses in `swim-timing.test.ts`).

## Gaps vs pro production
A Daktronics/CTS-grade natatorium show has: live console→board times with **no custom software** (bridge is the missing link), running dual-meet **team score always on glass**, **splits and lengths** for distance events, **tied-place** handling, event **program/progression**, auto **record callouts** when a finish beats pool/meet marks, relay exchange readouts from the timer, and signature celebration moments. VenueOS has the right data contracts and premier manual tooling, but the automated layer (CTS chain end-to-end, auto team scoring, splits, records) is where world-class is decided — and it's currently decoded-but-dropped, written-but-unread, or documented-but-unbuilt.
