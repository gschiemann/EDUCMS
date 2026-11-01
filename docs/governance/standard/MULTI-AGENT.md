# Multi-agent protocol — every vendor, one standard

Companion to Articles 16, 17, 42 and 53. The owner's rule (2026-10-31): Codex, Gemini, Grok, Claude — everything — must be able to jump in and help, getting the most out of every model, cost-effectively, without breaking the standard. Not everything is built with the most expensive model.

## Entry files — one text, imported, never copied

- **`AGENTS.md`** is the universal front door and the **canonical North Star**: the first page of it is the one-page summary every agent reads before anything else. Codex, Cursor, Jules, Amp, Copilot's coding agent and any tool without its own convention read it natively; a tool that does not is pointed at it in its first instruction.
- **`CLAUDE.md`** (Claude) and **`GEMINI.md`** (Gemini CLI) begin with an import of `AGENTS.md` and add only vendor-specific notes. No other copies exist, so nothing needs synchronising.
- **Precedence when texts disagree:** the owner's written rules (`OWNER-RULES.md`) → the standard → the application's rulebook (`CLAUDE.md` in VenueOS) → entry files → any vendor's private memory. Where the standard and a rulebook conflict, the stricter applies and an amendment is proposed.

## Equal binding

Every model is bound by the same standard and the same gates. No vendor gets a bypass. No model pushes to the main branch. One **Lead** session merges after reading the diff and the evidence (today: Claude in Claude Code; succession below). The **Owner** approves consequential changes and raises autonomy levels.

## Identity and attribution

- Every AI-authored commit carries `Co-Authored-By: <Model name> <noreply@vendor-domain>`; every pull request names model, version and harness. (Phase 1: CI rejects a commit with neither a model trailer nor a human marker.)
- Phase 1: a machine identity per vendor (a GitHub App or machine user, no `workflow` scope) so authorship, approval and pushes are distinguishable, and CODEOWNERS plus a ruleset requiring the owner's review on life-safety, authentication and governance paths.
- Any override typed by an AI on the owner's behalf records `executed-by: <model>` beside the owner's initials.

## Credentials — no AI receives a production secret

- Per-vendor, scoped, short-lived credentials: a SELECT-only database role for agents; tokens without `workflow` scope; no service-role or platform token outside the Lead.
- **No agent configuration file holds a production secret** — not `.mcp.json`, not `.codex/config.toml`, not any settings file. Non-lead vendors work in **clean-room checkouts** (no `.env`, no local config with secrets). All such files are listed in the application's rotation inventory.
- Permission allow / ask / deny lists are **derived from Register A**: production writes, pushes to the main branch, environment edits and fleet pushes are "ask" at most.
- A session that ingests untrusted text (customer content, bug reports, web pages, logs) holds no write, deploy or secret-bearing tool.

## Cross-vendor review

Consequential changes are reviewed by a model from a **different vendor** than the one that wrote them. During a freeze the rule applies only to emergency, authentication/secrets, migrations, billing and the native player; the owner may waive it for 24 hours per change, recorded in the PR.

## Shared memory is the repository

Anything another model needs is written to a **tracked** path. In VenueOS `docs/research/` is gitignored (lead-only) — cross-AI findings go to `docs/handoffs/` when they are not sensitive, and to the private standard repository's `decisions/` when they are (security findings, forensics, anything that maps the soft spots). A vendor's private memory is a cache of the repository, never the record.

## Handoff — how any model picks up work

1. Read `AGENTS.md` (the North Star first), then the application rulebook, then `docs/governance/` (profile, owner rules, register, mechanisms), then the latest handoff in `docs/handoffs/`.
2. Run the operational sweep the rulebook names before any other work.
3. Work in an isolated worktree on a branch `<vendor>/<topic>`; edit only the files you were assigned; never push to the main branch; never edit the standard in place.
4. Open a pull request in the decision format (`kit/templates/DECISION.md`); attach the proof for every "done" claim or say "unverified".
5. Record what you learned where the next model can read it (tracked path).

## Routing — cost per unit of quality

**The rule:** default to the least expensive model whose track record passes the gate for that task class; escalate only on a failed gate, a consequential change or genuine ambiguity. Frontier models are reserved for what needs them. **Every row below is a HYPOTHESIS until a Frontier Intake measures it** — the table is replaced by evidence, never by preference.

| Task class | Default (cheapest proven) | Escalate to | Independent review by |
|---|---|---|---|
| Mechanical edits, test stubs, docs formatting | Haiku-class (Claude Haiku 5.5; small OpenAI / Gemini Flash-class models) | Sonnet-class | — |
| Routine features and bug fixes | Sonnet-class / Codex | Opus-class | a different vendor |
| Normal design-and-build, incident investigation | Opus-class | Fable-class | Codex or Gemini |
| Hard, risky, architecture, security design, emergency path | Fable-class (frontier) | — | a different vendor, always |
| Adversarial review, "what would break this" | Grok / Gemini | — | — |
| Large-context analysis, screenshot and multimodal review | Gemini | — | — |
| Real-time or web research | Grok / Gemini | — | — |

Routing evidence that matters most: **escape rate** (revert or hotfix within 72 hours) per builder and per reviewer model, from the commit trailers; and cost per passed task from the intake set.

## Continuity when a vendor is down

The owner sets a succession order. If the Lead's vendor is unavailable (outage, usage cap, revoked credential), the next vendor in order acts as Lead under the same gates, and says so in every PR it merges. Each application keeps a vendor-neutral verification command (`verify`) that any model can run.

## Budget

Vendor spend is tracked per task class. Governance work stays within 5 % of total AI spend. Every intake has a cap.
