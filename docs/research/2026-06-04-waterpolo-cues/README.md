# Water Polo Celebration Cues — audit + fix (2026-06-04)

Triggered by the water-polo beta customer: the live celebration cues showed hardcoded
player names ("#7 RIVERA", "#1 OKONKWO"), some didn't surface the right data, and the
operator wanted a **click-cue → pick-player → fire-instantly** workflow.

## Reports
- **`01-cue-logic-audit.md`** — read-only code-trace audit (agent). Found the live
  cinematics render from param-less static HTML with baked-in placeholder names + no
  channel for live score/scorer. Traces every water polo cue across both surfaces, the
  design-vs-port regression, the hardcoded-name leaks, and the scorer-attribution gaps.
- **`02-fix-and-verification.md`** — what shipped (5 files, two halves: live-data
  injection + the `CueScorerPicker` workflow), verification (screenshots + tsc + lint +
  WebKit canary), and the secondary follow-ups.

## Outcome
- Player names on the board + ribbon cinematics are now **dynamic** (the operator's
  pick), not hardcoded. Firing without a pick shows a clean cue with **no** placeholder.
- New workflow: tap a name cue → fast roster picker pops → tap player → fires instantly.
- Verified by direct cinematic render (before/after screenshots in `scratch/wp-cues/`,
  gitignored), tsc, eslint, and the WebKit celebration canary (32/0).
