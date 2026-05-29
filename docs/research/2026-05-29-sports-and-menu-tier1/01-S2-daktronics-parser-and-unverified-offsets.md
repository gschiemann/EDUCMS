# S2 — Daktronics All Sport 5000 console parser

**Commit:** `8174c08` · **Package:** `@cms/scoreboard-cts` (added as sibling
modules, no new package → no lockfile/tsconfig churn) · **Tests:** 33/33
pass · package tsc clean · web tsc clean · `next build` green · CTS path
byte-for-byte unchanged.

## What was built
- `src/daktronics/parser.ts` — `DaktronicsParser` decodes the All Sport's
  "positioned text" RTD wire protocol (`SYN/HEADER/SOH/CONTROL/STX/TEXT/
  EOT/SUM/ETB`), validates the mod-256 checksum, splices each frame's TEXT
  into a persistent ASCII display buffer at its addressed offset, and
  re-slices named fields per sport. Emits the **same normalized snapshot
  shape** as `CtsParser` (`clock/homeScore/awayScore/period/clockRunning/
  horn` + per-sport extension blocks).
- `src/daktronics/offsets.ts` — per-sport `(offset, length)` field maps,
  transcribed verbatim from the MIT-licensed
  `zabackary/daktronics-allsport-5000-rs` decoder (Daktronics Enhanced RTD
  manual ED-12483), cross-checked against `rpitv/scoreboard` + the
  TimingGuys protocol reference.
- `src/daktronics/mock.ts` — builds checksummed frames straight from the
  offset table, so tests can't let a wrong offset silently pass.
- `src/console-profiles.ts` — registry: console family → serial settings +
  decoder. `cts-gen6` = 9600/8/E/1; `daktronics-allsport` = 19200/8/N/1.
- `CtsBridge.tsx` — `consoleProfile` prop / `?consoleProfile=` query param
  picks BOTH the serial `open()` settings AND the parser. `dakSport` prop /
  `?dakSport=` chooses football/basketball/baseball field map. Daktronics
  `clockRunning` is **authoritative** (explicit stopped flag) → skips the
  CTS cadence-derivation hack. Snapshots POST through the identical
  gameId/legacy endpoints.

## CTS path unchanged
Default profile (`cts-gen6`) yields the exact prior 9600/8/E/1 settings,
same `CtsParser`, same POST body. Verified by assertion against the built
module.

## ⚠️ FIELD-VALIDATION CHECKLIST — unverified offsets (need a real console / simulator)

High-confidence **core fields are corroborated and marked `verified: true`**:
main clock, both scores, period/inning, football down/distance/ball-on,
baseball balls/strikes/outs. These come from a community reverse-engineered
decoder.

The following are flagged `verified: false` in `UNVERIFIED_OFFSETS` and
**must be validated against a real All Sport console** (per-sport offsets
vary by console code / insert). Until validated, treat these as
best-effort:

**Football:** `playClock` (off 201), `homePossession` (210),
`guestPossession` (215)

**Basketball:** `shotClock` (201), `homePossession` (210),
`guestPossession` (216), `homeBonus` (222), `homeDoubleBonus` (223),
`guestBonus` (229), `guestDoubleBonus` (230)

**Baseball:** `homeAtBat` (201), `guestAtBat` (202), `homeHits` (203),
`guestHits` (209), `homeErrors` (205), `guestErrors` (211), `batterNumber`
(215)

**Protocol subtlety (recorded so it isn't rediscovered):** offsets in the
tables are **1-based item positions** (Daktronics manual numbering); the
reader subtracts 1 for the 0-based buffer index (`real_index = item - 1`,
matching the reference decoder). Kept 1-based so the table diffs cleanly
against the manual.

## Test coverage (24 new + 9 existing CTS)
Framing/checksum (incl. bad-checksum rejection + stray-SYN resync); all 3
sports' core + sport-specific fields; incremental-write buffer
preservation; change-only emit; clock-stopped flag; horn edges;
sport-switch; reset; offset-table integrity. Runtime smoke confirmed
correct decode of a football scenario (3rd & 8 on the 45, 21-14, Q3,
possession) and a baseball count (2-1, 2 outs, away batting).
