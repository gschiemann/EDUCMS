# AI Flagship Rebuild — make AI template + image generation the best feature in the app (10x OptiSigns)

**2026-06-26.** Greg: the AI-generated templates are "straight garbage"; make AI template + image gen the prize of the app, the reason people pay — best the world has seen, every screen size (touch + non-touch), every industry. He saw an OptiSign demo and it was "amazing" → know everything about it, make ours 10x better. Ran as an ultracode workflow (`wf_5a874d99-1e7`, 8 agents).

## Read order
- **00-FLAGSHIP-PLAN.md** — THE build blueprint (architecture + phased roadmap + codebase mapping).
- **01-PLAN-CRITIQUE.md** — adversarial stress-test; **reorders Phase 1** + names the make-or-break spikes. Read alongside the plan.
- agents/R1-optisign.md — OptiSigns teardown (AI Designer, OptiDev, gaps).
- agents/R2-competitors.md — whole landscape + white-space lanes.
- agents/R3-sota-design.md — how Canva/Gamma/Beautiful.ai get beautiful output (the recipe).
- agents/R4-image-gen.md — Imagen/Ideogram/Recraft/Firefly per-job + premium-imagery features.
- agents/R5-teardown.md — code-verified WHY ours looks garbage (file:line).
- agents/R6-signage-principles.md — the enforceable signage design rulebook (numeric).

## The one-sentence diagnosis (code-verified)
Ours looks like trash because the LLM is the typesetter — it emits free-floating `{x,y,w,h}` boxes of grey text on a white canvas. Every world-class tool does the opposite: **LLM = art-director only** (picks archetype + theme + copy + image), while **designer-built grid-locked archetypes + theme tokens + a rules engine** own geometry, color, type, and contrast. Rebuild around that.

## Decisions that are GREG's
- Archetype design quality (per CLAUDE.md Template Design Workflow: HTML mockup → his review → port → verify, NO batching). The engine is mine; the archetype look needs his eye.
- New image-provider keys (Imagen/Ideogram/Recraft/Firefly) — config + cost; image-gen tier (BYOK/metered, NOT platform-free).
- Library-depth target (critic: 24–32 archetypes × orientation, not 12–16) + candidate count (4–6 vs 3).

## Status: PLAN + CRITIQUE complete. Build not started — awaiting Greg's greenlight on direction + Phase-1 (reordered per critique).
