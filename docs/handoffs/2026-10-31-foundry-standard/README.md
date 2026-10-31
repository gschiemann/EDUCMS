# Foundry Standard — Phase 0 handoff (2026-10-31)

Any AI (Claude, Codex, Gemini, Grok, …) picking this up: read this file, then `01-design-brief.md`.
Nothing here touches launch code. Branch: `governance/foundry-standard-phase0`.

## What this is

The owner (Greg) decided on 2026-10-31 to adopt **one master operating standard above every app
we build** — product + the factory that builds it, improving on every event, never silently
rewriting its own rules. Codex drafted the substance (50 sections + a "world-class ambition"
insert; approved). The lead (Claude Fable 5.1 in Claude Code) rewrites it as **The Foundry
Standard v1.0** in the form "every article names its Mechanism and its Evidence". The brief in
`01-design-brief.md` is the design; it was sent to three independent reviewers (Opus, Sonnet,
Haiku — same brief, no shared context) and to a mapping agent that verifies, by grep, which
articles this repo already enforces and where.

## Owner's rules for this work (verbatim intent)

- "You're the boss — review the others' findings and make sure you 100% agree before they get
  implemented." → the lead writes `06-lead-verdicts.md` (adopt / reject + why) BEFORE building.
- "We will use all of them to build our apps, not everything is built with Fable; be
  cost-effective and get the max out of each LLM version while putting out the best product
  possible." → routing rule: the **cheapest model whose track record passes the gate**; escalate
  only on a failed gate, a consequential change, or real ambiguity; the intake set measures
  quality **per dollar**.
- "Every time a new LLM drops I want a full audit of this and a discussion on how we make it
  even better." → Frontier Intake is mandatory, any vendor, within 14 days.
- "Make it one of a kind, best in the world, easily replicated for every app." → the kit.
- Save backups first (done — see below).

## State

| Item | Status |
|---|---|
| Backups | tag `backup/pre-phase0-governance-20261031-105335` on origin (c810ffc9); `~/EDU-CMS-backups/phase0-governance-text-20261031-105335.tar.gz` (11 MB) + `claude-memory-20261031-105335.tar.gz` |
| Lead's memory index | compressed 25.7 → 17.9 KB, 0 links lost (verified) |
| Design brief | `01-design-brief.md` (this folder) |
| Reviews (Opus / Sonnet / Haiku) | `02-review-opus.md`, `03-review-sonnet.md`, `04-review-haiku.md` when copied; else in the lead's session scratchpad `…/9e11fd16-339b-4b16-bbaa-14bb7ed1a236/scratchpad/review-*.md` |
| Mechanism map | `05-mechanisms-map.md` when copied; else `…/scratchpad/mechanisms-map.md` |
| Lead's verdicts | `06-lead-verdicts.md` — NOT written yet |
| `foundry-standard` repo | `~/Desktop/foundry-standard` exists, EMPTY; not created on GitHub yet |
| VenueOS governance files | none written yet (`docs/governance/` is empty) |

## Resume checklist

1. Reviews present in this folder? If not, copy from the scratchpad; if the scratchpad is gone,
   re-run them: three reviewer agents (models opus, sonnet, haiku) given `01-design-brief.md` §0
   as their instructions, read-only on the repo; one mapping agent (opus) producing the
   article → mechanism table with verified paths.
2. Write `06-lead-verdicts.md`: each finding → ADOPT / REJECT, one line of why, and the change it
   makes to the brief. Only adopted items go into the build.
3. Build, in this order: (a) `~/Desktop/foundry-standard` → `README.md`, `STANDARD.md`,
   `AUTONOMY.md`, `FRONTIER-INTAKE.md`, `MULTI-AGENT.md`, `AMENDMENTS.md`, `CHANGELOG.md`,
   `AGENTS.md`, `LICENSE`, `kit/` (templates, `bootstrap.sh`, `scripts/check-north-star-sync.cjs`),
   `decisions/2026-10-31-phase0-multi-model-review/` (copies of 02–06); `git init`, commit,
   `gh repo create gschiemann/foundry-standard --private --source . --push`.
   (b) VenueOS: `docs/governance/{README,NORTH-STAR,VENUEOS-PROFILE,MECHANISMS,AUTONOMY-REGISTER}.md`;
   North Star block between `<!-- NORTH-STAR:BEGIN -->` / `<!-- NORTH-STAR:END -->` markers in
   `CLAUDE.md` (right after the H1) and `AGENTS.md`; `GEMINI.md` + `.github/copilot-instructions.md`
   pointers; `scripts/check-north-star-sync.cjs` + a hygiene-check axis; update the CLAUDE.md
   footer stamp. (c) One PR from this branch; the owner reviews.
4. Do not touch CI workflows or product code this week (launch).
