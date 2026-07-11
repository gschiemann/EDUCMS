# Sports venue world-class audit — 2026-07-11

**Mandate (Greg):** "audit our sports venue for each sport and ensure we are world class."

**Method:** 24-agent workflow (run `wf_eefbfcae-a4d`) — one auditor per sport in the
registry (19: football, basketball, baseball, softball, soccer, volleyball,
wrestling, hockey, lacrosse, field_hockey, water_polo, pickleball,
track_and_field, swimming, diving, cross_country, gymnastics, golf,
competitive_cheer) + 5 cross-cutting lenses (console-workflow,
celebrations-show, led-render-safety, data-feeds-integrity,
presentation-benchmark). Every auditor grades Design/UX/Functionality against a
Daktronics/ScoreVision-class bar with mandatory file:line citations; unique
P0/P1 findings then get a refute-first adversarial verification pass.

**Run log:** two launch attempts burned on partial usage-limit windows
(2026-07-11 pre-dawn; ~2.2M subagent tokens lost, 0 auditors completed —
journal confirms empty). Both died with EVERY agent mid-flight: 24-wide
parallel fan-out means a wall erases all in-progress work at once.

**Checkpointed rework (2026-07-11, per Greg: "they need to stop and report
more often so we dont lose shit"):** same 24 auditors, restructured into
sequential waves of 4 that complete + journal before the next wave launches.
Priority scopes ride wave 1 (water polo, swimming, diving, console-workflow
lens — the live-customer surfaces), remaining lenses wave 2, other sports
after. An all-null wave = wall detected → circuit breaker halts remaining
waves and returns partial results with `walled: true` instead of burning the
window; journaled waves survive and replay from cache on
`resumeFromRunId: wf_eefbfcae-a4d`. Verify phase is waved the same way
(batches of 6, all-UNVERIFIED batch = wall). Agent prompts/opts kept
byte-identical to the original script for cache stability.

**Deliverables (to be written here when the fleet lands):**
- `01-REPORT-CARD.md` — 19 sports × 3 lenses grade table + 5 lens grades
- `02-VERIFIED-FINDINGS.md` — adversarially confirmed P0/P1 list with citations
- `03-GAPS-VS-PRO.md` — what a pro production shows that VenueOS does not, per sport
- `04-FIX-PLAN.md` — sequenced fix waves

**Priority note:** water polo (first real customer), swimming/diving (CTS
timing install) hold the highest bar.
