# Sports-Venue Setup-Menu Revamp — research + execution dossier

Greg's directive (2026-06-16): full revamp of the confusing/ugly sports Setup menu —
"best in the world, use as many agents as needed" — plus a HIGH-PRIORITY functional
auto-sizing bug (team names cut off on a real 4K TV; ribbon score-ticker resolution
wrong). Do AFTER the touch/template editor flagship work.

## Files
- **[PUNCHLIST.md](PUNCHLIST.md)** — Greg's verbatim-in-intent A–M punch list (the requirements).
- **[01-REDESIGN-SPEC.md](01-REDESIGN-SPEC.md)** — multi-agent research synthesis (6 best-in-class
  teardowns: Daktronics, ChyronHego, Ross XPression, ScoreVision, Singular/vMix, WireSpring) →
  new Setup IA (6-card pre-game checklist) + per-area (A–M) redesign + build order.
- **[02-ADVERSARIAL-CRITIQUE.md](02-ADVERSARIAL-CRITIQUE.md)** — code-verified corrections to the
  spec. **Read before implementing.** Relocates the scroll-speed bug to `ribbon/page.tsx:2234`,
  rescopes item L (de-dupe `useScaleToFit`; defer abbrev schema), drops the fabricated
  "est. impressions" sponsor number, flags the CJK + measure-timing + scale(0) traps.

## Execution status (lead-owned)
- **Item L (auto-fit) — IN PROGRESS.** Hardened the universal `FitOneLine`/`FitBox` measure
  scheduler (deferred re-measures + text-dimension polling so a cold 4K WebView never sticks a
  too-large scale → the `overflow:hidden` zone no longer clips). Converted the legacy
  `BoardScene` team name from fixed 54px → `FitOneLine`. Next: audit `MainScoreboardWidget` /
  `RibbonScorebugWidgets` per-field names + the E1 line-2234 sponsor-marquee speed bug.
- Phases 2–4 (IA spine, content authoring, sponsor model, polish) — queued per the spec's build order.

> Verification trap (memory): the operator tests the standalone `/board` `/ribbon` routes on a real
> 4K TV, NOT the in-app previews. Verify item L on the real routes at real resolutions.
