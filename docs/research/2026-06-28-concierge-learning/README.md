# Concierge Learning Flywheel — research + design (2026-06-28)

Greg's ask: *"keep making our AI chat agent smarter and better at building these,
make it learn from all the customers that use it to improve and get smarter and
better until it's the best in the world."*

Goal: a REAL continuous-learning loop (not a costume) — no model training, just
in-context learning + retrieval + a Postgres-computable ranking that improves
every generation from accumulated customer outcomes. Built by a 5-agent workflow
(`wf_9bf66b81`): 4 parallel read-only researchers → 1 architect synthesis.

## Files
- [`00-DESIGN-learning-flywheel.md`](00-DESIGN-learning-flywheel.md) — **the design.** Signal schema, learning job, retrieval/few-shot injection, concierge question-learning, metrics, phased plan, costume risks. **Start here.**
- [`01-pipeline-persistence.md`](01-pipeline-persistence.md) — every generation entry point × what's persisted vs LOST, + the exact capture hook points.
- [`02-existing-signals-schema.md`](02-existing-signals-schema.md) — existing outcome signals (publish-to-screen = strongest positive), AuditLog actions, the additive Prisma model.
- [`03-best-in-world-architecture.md`](03-best-in-world-architecture.md) — competitive scan (Canva/Designer/OptiSign/Yodeck) + the recommended RAG + bandit architecture, no ML infra.
- [`04-prompt-injection-points.md`](04-prompt-injection-points.md) — the exact file:function injection points for exemplars + learned archetype/theme bias + learned questions.

## The headline finding
Every generation already writes an `AuditLog` row with *dimensions*
(archetype/theme/vertical) but **never which candidate of N was kept, the
intake→spec→outcome tuple, post-keep edits, or the publish-to-screen signal** —
and the audit rows aren't joined to the `Template`. So today nothing can learn.
The flywheel starts by capturing those signals.

## Phase 0 MVP (the highest-leverage first slice — shippable now)
**"Log OFFERED + KEPT."** Additive only: a new `SignageGenEvent` table + a
nullable `Template.createdVia`. `generateSignageBoardCandidates` mints a
`batchId` and logs N OFFERED rows; `createFromCandidate` logs the KEPT row
(which candidate index, the verbatim spec, the templateId). Best-effort writes,
never block a generation. No behavior change — it just starts the data flowing,
the prerequisite for the bandit + retrieval phases. Once data accrues, later
phases read it to bias archetype/theme selection and inject "boards customers
loved" exemplars at generate time.

## Status
Design complete + persisted. Phase 0 not yet built. (The same-day
candidate-diversity fix — forcing distinct archetype/theme per candidate so the
3 takes aren't clones — shipped separately in `aec82351`.)
