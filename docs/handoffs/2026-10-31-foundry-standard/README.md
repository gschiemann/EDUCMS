# Foundry Standard — Phase 0 handoff (2026-10-31)

Any AI picking this up: read `AGENTS.md` (the North Star) first, then this file, then `docs/governance/`.

## What happened

The owner adopted one operating standard above every app. Codex drafted the substance; the lead (Claude Fable 5.1) rewrote it as **The Foundry Standard v1.0.0** — 54 articles, each normative one naming its mechanism and evidence — in the private repository `gschiemann/foundry-standard`. The design (`01-design-brief.md`) was reviewed independently by Opus 5.5, Sonnet 5.5 and Haiku 5.5; the lead's adopt/reject verdict on every finding is the v1.0 decision record. **Reviews and verdicts live in the private repo** (`decisions/2026-10-31-phase0-multi-model-review/`), not here: they map the soft spots, and this repository is public.

VenueOS is the first adopter: `kit/bootstrap.sh` vendored the standard to `docs/governance/standard/` with `standard.lock`, `AGENTS.md` became the canonical North Star (imported by `CLAUDE.md` and `GEMINI.md`), and `docs/governance/` holds the profile, owner rules, the two autonomy registers, the launch freeze, the retrospective first response and the mechanism map.

## Design changes made during review (vs the brief)

- AGENTS.md is the single canonical North Star; CLAUDE.md / GEMINI.md import it. No copies, no sync script, no `scripts/` change (a `scripts/` change would have redeployed the API).
- The standard stays in its own private repo **and** is vendored into each app with a SHA-256 lock, so sandboxed agents see it and the pin is verifiable.
- Life safety split into CHANGE (≤L1) / OPERATE (L0) / RUNTIME (failure direction). Register split into agent authority vs product automations. Authenticity added to the priority order. Article 54 (breach and supplier compromise) added. Frontier Intake made two-stage with pre-registered thresholds and a held-out set in the private repo. Routing is cost-first.
- Security findings from the reviews about local agent configuration files and permission settings were raised to the owner directly; they are the owner's files and were not changed.

## Open for the owner

1. The local agent config and permission findings (private decision record, finding O2/S1).
2. GitHub Pro for rulesets on the private standard repo, or make it public under the proprietary licence.
3. Confirm the standing approval and the freeze as recorded in `docs/governance/`.
4. The name "Foundry Standard".

## Phase 1 (after launch) — from the GAP backlog

Continuous on-glass alert drill per hardware class · field-candidate builds through the hardware gate · per-vendor machine identities, CODEOWNERS + ruleset, commit-trailer check · protected Environments for production secrets in CI · register as YAML read by CI · instruction-conformance tests for the entry files · intake trigger as a scheduled Action · CLAUDE.md split per directory and the footer moved to a changelog · weekly review as a skill · portable gates in the kit.
