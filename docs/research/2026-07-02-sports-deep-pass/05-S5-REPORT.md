# Sports Wave S5 — board presentation (2026-07-03, compact)

Commits f022d8ed + c7b0ef08. Fence: board/[gameId]/page.tsx, SwimDiveWidgets.tsx
(additive), sports-presets.ts (Halftime zone), 2 specs.
- S5-1 (P1-9): DefaultBoardScene routes laneGrid sports (swim/dive/track) to
  PreGameScene at PRE_GAME, FinalScene at FINAL (existing dual-meet home/away
  points), grid at LIVE/HALFTIME.
- S5-2 (P1-10): dropped the !isLeaderboard portrait carve-out; laneGrid gets a
  portrait? config that swaps ScaledScene natural size 1920×1080 → 960×1080
  (new optional naturalW/naturalH, other 4 callers byte-identical). At
  960×1080 the scene now renders width:960/scale(1), not scale(0.5) letterbox.
- S5-3 (Halftime): live per-tenant sponsor pull not feasible in a static
  tenant-agnostic preset (IMAGE_CAROUSEL has no live-data path) → replaced the
  empty carousel with 3 sb-sponsor text-slot tiles (Presenting/Gold/Community),
  reusing SponsorSlotWidget's graceful-text-fallback like the other 4 sponsor
  presets. Never empty out of the box; each tile editable.
- DEFERRED: volleyball stats.setHistory (touches set-advance write path) → new task.
Tests: parity 63, swim-dive 30, broader 217 board/sports, api templates 17 —
all green; web+api tsc clean; mobile-perf + rule-#10 clean.
