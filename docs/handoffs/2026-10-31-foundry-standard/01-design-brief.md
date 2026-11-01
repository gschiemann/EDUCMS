# Phase 0 design brief — "The Foundry Standard" (for independent review)

Date: 2026-10-31. Author: the lead (Claude Fable 5.1, Claude Code). Owner: Greg Schiemann.
This brief is the DESIGN that is about to be implemented. It has not been written yet. You are
one of several independent reviewers (different models, same brief, no shared context). We want
disagreement, not agreement. Rank what you find. Be specific. Cite repo evidence where you claim
something about the codebase (`/Users/gschiemann/Desktop/EDU CMS`, read-only for you).

## 0. What we want from you

1. Your **top 10 findings**, ranked by severity, each with: the problem, why it matters, a concrete
   fix (not "consider"). Include at least two things to CUT.
2. What is **missing** for this to be genuinely the best operating standard for an AI-native
   software company — not "best practice", best. Name what the world's best engineering orgs do
   that this design does not.
3. What in this design could **hurt the launch week** (see constraints) or cost money.
4. Where the design **contradicts itself**, contradicts the repo's existing binding rules in
   `CLAUDE.md`, or is unenforceable prose dressed as a rule.
5. A one-line **verdict**: ship as is / revise (what) / stop (why).
6. Length: ≤ 1,500 words. Bullets. No flattery, no restating the brief.

## 1. Context and constraints

- Product: VenueOS (repo "EDU CMS"), a signage + life-safety emergency-alert CMS for K-12 schools,
  sports venues, QSR/retail/worship/corporate. Monorepo: NestJS API, Next.js web, Android kiosk
  player (Kotlin), Prisma/Postgres (Supabase), Redis, Railway + Vercel. Lockdown / weather /
  evacuation alerts go to physical screens — a **life-safety** path exists.
- One owner (Greg). Development is done by AI agents (Claude in Claude Code as lead; Codex for
  reviews; others) with Greg supervising consequential decisions.
- **Launch week**: a large customer (Brookfield) goes live on Goodview GUQ panels in the next
  1–2 weeks. Nothing in Phase 0 may touch production code paths or slow the launch.
- Cost constraints: GitHub Actions minutes are billed (repo is public to keep CI free; owner
  refuses $100+/mo overage), Vercel is on the free tier near its limits, AI usage caps are
  real. The operating layer must have a budget.
- `CLAUDE.md` is 28,772 words and is the always-loaded rulebook for Claude. `AGENTS.md`
  (1,252 words) is a pointer file for Codex/Cursor. The lead's memory index (`MEMORY.md`) is
  25.7 KB against a 24.4 KB load limit — it is being truncated today.
- `docs/research/` is **gitignored** (lead's machine only). 22 CI workflows and ~35 guard
  scripts exist (`scripts/`, `apps/web/tools/`), each born from an incident.
- Binding owner rules already in force (must not be contradicted): no unrequested UI; the lead
  is developer not designer; don't over-engineer; verify before claiming done (screenshot /
  live fetch / CI green + deploy Ready, else say "unverified"); never mass-force OTA during
  playback (one screen per hardware class, off-hours); every autonomous behaviour has a
  subtractive env kill switch (unset = today's behaviour, never a lockout); green CI is a
  unit-test claim, never a fleet claim (hardware qualification gate before any player release);
  short bulleted status reports; every user-facing string ships in en+es+zh; never discard
  agent work; worktree isolation for agents, lead owns the merge; agent model routing today:
  Fable = hard/risky, Opus = normal, Sonnet = routine, Haiku = mechanical, Codex = independent
  review.

## 2. The owner's requirements (this week, verbatim intent)

1. Adopt a master founding standard that sits above every app: build the product AND the
   factory that builds products; improve on every event; the standard itself is a living
   product that proposes changes but never silently rewrites its own rules. (Codex drafted a
   50-section version plus a "World-class ambition" section; the owner approved the substance;
   see Appendix A for its section list.)
2. "Make sure our system supports multiple AIs — Codex, Gemini, Grok, everything — able to jump
   in and help, getting the most out of every AI without breaking our standards."
3. "Make this idea one of a kind, make us the best in the world, and make it easily replicated
   so we develop apps at this standard always."
4. "Every time a new LLM drops I want a full audit of this and a discussion on how we make it
   even better, to ensure we are the leader always in everything we do."
5. Save backups first (done: git tag `backup/pre-phase0-governance-20261031-105335` pushed;
   text-only tarball of governance files; tarball of the memory directory).

## 3. Proposed deliverables

### 3a. A new private repo: `gschiemann/foundry-standard` (the standard's single home)

```
foundry-standard/
  README.md            what it is; adopt in 10 minutes; how to amend; how intake works
  STANDARD.md          The Foundry Standard v1.0.0 — the constitution (Parts I–VII, ~53 articles)
  AUTONOMY.md          ladder L0–L5, consequential list, ceilings, promotion/demotion rules
  FRONTIER-INTAKE.md   the mandatory new-model audit protocol (runbook)
  MULTI-AGENT.md       multi-vendor protocol (entry files, roles, cross-vendor review, attribution)
  AMENDMENTS.md        the 8-field proposal, who approves what, semver rules; CHANGELOG.md
  intake/              one record per model intake (template + index)
  decisions/           decision records (this review is the first one)
  kit/                 the replicable bootstrap for any new app
    bootstrap.sh       copies templates into a new repo, idempotent, never overwrites
    templates/         NORTH-STAR.md, AGENTS.md, CLAUDE.md, GEMINI.md, copilot-instructions.md,
                       APP-PROFILE.md, MECHANISMS.md, AUTONOMY-REGISTER.md, FIRST-RESPONSE.md,
                       INCIDENT.md, DECISION.md, PULL_REQUEST_TEMPLATE.md
    scripts/           check-north-star-sync.cjs (drift check for embedded copies)
  AGENTS.md            how any AI edits THIS repo (amend only via PR + template)
  LICENSE              proprietary, all rights reserved
```

Each app pins a standard version in its North Star. Amendments happen only by PR in this repo.

### 3b. STANDARD.md — form and outline

Form: a constitution where **every article ends with two lines**:
`Mechanism:` what enforces it (gate, register, template, script — the app-specific instance is
named in that app's `docs/governance/MECHANISMS.md`) and `Evidence:` what proves compliance.
A principle with no mechanism is listed as a GAP in the app's map, never pretended.

Outline (substance = Codex's 50 sections + ambition, regrouped; NEW = not in Codex's draft):

- Preamble: what this is; the one constant objective; the mechanism rule.
- PART I — MISSION AND AMBITION. 1 Mission (product + factory; Research → … → Improve loop).
  2 World-class ambition (most useful / profitable / cutting-edge / creative / flexible /
  safest-and-most-trustworthy; competitor = baseline not ceiling; 10× thinking; customer value
  is the test; scorecard; the world-class loop; ambition must improve).
  3 **NEW Priority order** (tiebreak when goals collide): life safety → security & privacy →
  reliability → customer usefulness → speed → profitability → novelty.
  4 Improve on every event (the trigger list). 5 Non-negotiable truths.
- PART II — EVERY APPLICATION. 6 Application profile (the §3 fields + approved exceptions).
  7 Build two things at once (product + reusable operating layer). 8 Day-zero product
  definition. 9 Architect for change. 10 Startup procedure + first response (→ kit).
- PART III — SECURITY. 11 Security is foundational + threat model. 12 Independent security
  function (cross-vendor). 13 Continuous threat intelligence. 14 Software inventory (SBOM).
  15 **NEW Kill switches and decided failure directions**: every autonomous behaviour ships
  with a subtractive switch; when a safeguard cannot run, its failure direction (open/closed)
  is decided in advance and written down.
- PART IV — EVIDENCE. 16 Separation of authority — mechanical, five roles (Builder, Reviewer on
  a different vendor, Gate = CI, Lead merges, Owner approves). 17 Multi-model development +
  cross-vendor review of consequential changes. 18 Consensus is not evidence (testing depth
  reflects risk). 19 **NEW Glass is the truth**: CI is a unit-test claim; real-target
  qualification is a gate. 20 Simulation / digital twin. 21 **NEW Verification before claim**.
- PART V — OPERATE. 22 Observability is a feature. 23 Software reports its own problems.
  24 Universal incident pipeline. 25 Support is engineering (two questions). 26 Customer
  communication states (never fabricate status). 27 Every bug creates permanent value.
  28 Release philosophy + **NEW blast radius by hardware class, off-hours**. 29 Rollback is
  part of the feature.
- PART VI — AUTONOMY AND GOVERNANCE. 30 Human-supervised startup + decision format (Situation /
  Evidence / Recommendation / Risk / Validation / Rollback / Decision). 31 Decision records, not
  raw reasoning. 32 Human feedback becomes policy (versioned rules). 33 Autonomy ladder +
  **NEW consequential list + life-safety ceiling (never above L1)**. 34 Trust is reversible.
  35 Version everything. 36 Structured memory + **NEW size bound**. 37 Complete auditability.
  38 **NEW The budget of the factory** (operating-layer cost is a metric).
- PART VII — LEARN AND COMPOUND. 39 Continuous product intelligence. 40 R&D never stops.
  41 **Frontier model intake — mandatory on every new model** (→ FRONTIER-INTAKE.md).
  42 Model routing by evidence. 43 Our own benchmarks. 44 Improvement cadence (daily sweep,
  weekly review, intake per model, quarterly "from zero today" question). 45 The standard may
  improve, never silently. 46 Replace old ideas. 47 Failure protocol (two investigations).
  48 Success protocol. 49 Universal metrics. 50 Speed + better every day. 51 Every app makes
  the next better (→ kit). 52 End state. 53 **NEW Multi-AI participation** (→ MULTI-AGENT.md).
- Final directive.

### 3c. The North Star — the one page every AI loads (draft)

Lives canonically at `docs/governance/NORTH-STAR.md` in each app; embedded verbatim between
`<!-- NORTH-STAR:BEGIN/END -->` markers in `CLAUDE.md` and `AGENTS.md`; a check script fails
when any copy drifts. Draft text (≈450 words):

> VenueOS is one product of an AI-native software company governed by **The Foundry Standard**
> (`gschiemann/foundry-standard`, v1.0.0). This page is the always-loaded summary; the standard
> is the law; `docs/governance/` is how this app implements it. Amend the standard only by PR
> there — never silently.
> **Mission.** Build the best product in every category we enter, measured by customer outcome,
> while building the factory that builds it: every incident, correction and release makes the
> organisation smarter.
> **Priority order:** life safety → security & privacy → reliability → usefulness → speed →
> profitability → novelty. A principle with no mechanism is a wish (`MECHANISMS.md`).
> **Autonomy ladder (per action category, `AUTONOMY-REGISTER.md`):** L0 observe · L1 prepare ·
> L2 execute after approval · L3 execute + notify · L4 autonomous with audit + rollback · L5
> closed loop. Trust is reversible. Life-safety never above L1. Only the owner raises a level.
> **Consequential — L≤2 until the owner raises it:** emergency path · device credentials, auth,
> secrets · schema & migrations · fleet-wide actions (OTA, reload, broadcast) · anything that
> emails/texts a customer · billing & pricing · public content, repo visibility · any
> autonomy-level change · amendments to the standard.
> **House invariants.** Subtractive kill switch on every autonomous behaviour. Glass is the
> truth. Blast radius = one hardware class, off-hours. Verify before claim or say "unverified".
> Models generate hypotheses, tests generate evidence, consensus is not evidence. Creativity
> produces proposals (L0–L1); unrequested UI never ships. Memory and this file are size-bounded.
> **Every AI is bound equally.** Entry: AGENTS.md (all vendors) · CLAUDE.md · GEMINI.md ·
> copilot-instructions. Consequential changes are reviewed by a different vendor than wrote
> them. Every AI-authored commit names its model. Shared memory is the repo, not a vendor's
> private memory.
> **Decision format to the owner:** Situation · Evidence · Recommendation · Risk · Validation ·
> Rollback · Decision. Two investigations per failure: why the product failed, why the system
> let it reach a customer.
> **Cadence.** `ops-sweep` first, every session (daily). Weekly review: real signals in, ≤10
> bullets + ≤3 amendment proposals out. **Frontier intake on every new model** (full audit of
> the standard and the app, within 14 days). The factory has a budget: CI minutes, inference and
> lead time are metrics.

### 3d. AUTONOMY.md (rules the registers follow)

- Levels L0–L5 as above. Each ACTION CATEGORY has its own level; there is no global switch.
- Ceilings: life-safety code and operations = L1 forever; the consequential list ≤ L2 until the
  owner raises it, in writing, in the register.
- Promotion needs: a kill switch, a proven rollback, N successful executions with zero reversals
  in a window, and a decision record.
- Demotion is automatic on: a rollback, a security event, a customer-impacting error, a wrong
  call, or calibration drift; the register row drops one level and says why.
- Register format: category · level · ceiling · evidence · kill switch · rollback · last review.

### 3e. FRONTIER-INTAKE.md (mandatory on every new model)

Trigger: a materially new model or generation from ANY vendor (Anthropic, OpenAI, Google, xAI,
Meta, DeepSeek, Mistral, …) or a new agent-harness capability; or the owner says "new model".
Deadline: intake record opened within 7 days, completed within 14. Steps: (1) open
`intake/<date>-<vendor>-<model>.md` from the template; (2) get the model into at least one
harness we use; (3) the model audits (a) the standard itself (incomplete / outdated / redundant /
dangerous / missing), (b) the app against its 21-section audit surface, (c) "if you built this
company from zero today with your capabilities, what would you do differently", (d) what it can
do that incumbents cannot; (4) evidence: run the intake set (initially 10 historical bugs with
fixes hidden, 3 security findings, 2 architecture decisions, 1 incident; later the full
proprietary eval suite) and compare correctness, cost, latency, review quality vs incumbents;
(5) a structured discussion (owner + lead + the new model + one incumbent) producing a decision
record: roles to adopt it for, routing changes, amendment proposals; (6) amendments via the
process, routing table updated with evidence, autonomy levels unchanged unless evidence; (7)
record outcome; app-level follow-ups become issues. Mechanisation path: the product already runs
a daily model-feed sync (`ai-model-sync.cron.ts`); Phase 1 wires it to open an intake issue.

### 3f. MULTI-AGENT.md

- Entry files: `AGENTS.md` is the universal front door (Codex, Cursor, Jules, Amp, anything
  without its own convention — Grok included); `CLAUDE.md` (Claude), `GEMINI.md` (Gemini CLI),
  `.github/copilot-instructions.md` (Copilot) are pointers/embeds of the same North Star.
- Every AI is bound by the same gates; no vendor gets a bypass; none pushes to master; the Lead
  (one designated session) merges; the Owner approves consequential changes.
- Consequential changes: Reviewer vendor ≠ Builder vendor.
- Attribution: every AI-authored commit carries `Co-Authored-By: <Model> <noreply@vendor>`; PR
  body names model, version, harness.
- Shared memory is the repo (`CLAUDE.md`, `docs/governance`, `docs/handoffs`, PRs). Vendor-private
  memory is a cache. Anything another AI needs is written to a TRACKED path (`docs/research` is
  gitignored, so cross-AI findings go to `docs/handoffs/` or the PR).
- Handoff: read order (AGENTS → North Star → CLAUDE.md → governance → latest handoff), run the
  ops sweep, work in a worktree/branch `<vendor>/<topic>`, PR in the decision format, never edit
  the standard.
- Routing table: an explicit HYPOTHESIS until intake evidence replaces it (Claude Fable
  hard/risky, Opus normal, Sonnet routine, Haiku mechanical; Codex independent code review and
  second implementations; Gemini large-context analysis and multimodal/screenshot review; Grok
  adversarial review and real-time research). No vendor attachment.
- No AI receives production secrets; env lives on the platforms.

### 3g. Kit

`bootstrap.sh <target-repo>` copies the templates (placeholders `{{APP_NAME}}` etc.), never
overwrites, prints the §50 first-response checklist as the next step. `check-north-star-sync.cjs`
is copied into the app's `scripts/`. Portable CI gates (lockfile drift, secret scan, dependency
audit, hygiene) are Phase 1.

### 3h. VenueOS changes in Phase 0 (docs + one check script; no product code)

- `docs/governance/`: `README.md`, `NORTH-STAR.md` (canonical), `VENUEOS-PROFILE.md` (the §6
  fields: mission, users, business model, critical workflows, sensitive data incl. K-12 student
  data default-deny, integrations, availability, regulatory considerations stated factually —
  FERPA, PCI SAQ-A scope, WCAG AA target — never certifications we lack; approved exceptions),
  `MECHANISMS.md` (every article → mechanism or GAP, verified by grep; the GAP list is the Phase
  1 backlog), `AUTONOMY-REGISTER.md` (first rows: customer alert emails L1 shadow; owner fleet
  alarms L3; capacity alerts L3; video re-mux/probe/transcode L4 with kill switches; playback
  gate L1 warn; playback demotion L3; AI model catalog sync L4; OTA push L2 one class at a time;
  player release L2 with hardware gate; secret rotation L1/L2; schema migrations L1 + CI gate;
  PR merge L2; deploy-on-merge L4 with rollback; worktree agents L1; memory writes L3; CLAUDE.md
  amendments L2; standard amendments L1; emergency path L1 ceiling; platform asset wipe L0;
  destructive DB ops L0).
- `CLAUDE.md`: the North Star block inserted after the H1; footer stamp updated.
- `AGENTS.md`: keeps its current 8 rules + table (they are good and current), gains the North
  Star block and the multi-AI section. `GEMINI.md` and `.github/copilot-instructions.md`:
  short pointers to `AGENTS.md`.
- `scripts/check-north-star-sync.cjs` + a hygiene-check axis (pre-push warning); CI job in
  Phase 1.
- Memory: compress the index under the limit (shorten lines; move September 2026 project wraps
  into a history index file, keeping every link); add one memory recording the decision.
- One PR, reviewed by the owner. Backups already taken.

### 3i. Phasing

- Phase 0 (now, hours): everything in 3a–3h.
- Phase 1 (after Brookfield is stable): weekly review as a skill reading real signals; CI job
  for the sync check; portable gates in the kit; template repo for new apps; intake issue
  automation; AGENTS drift check in CI; "unreachable-but-tested module" guard; SBOM export.
- Phase 2 (when a trigger justifies it): proprietary eval suite built from historical bugs;
  fault-injection/soak harness; incident-pipeline tooling with correlation.
- Explicitly NOT: eleven named agents; daily improvement proposals; multi-model review on every
  change (consequential list only).

## 4. Known risks and open questions (we want your view)

- Is 53 articles too many to be read? Should the constitution be shorter with the detail in
  companion docs, or is the article-level Mechanism/Evidence form worth the length?
- Does the always-loaded North Star (~450 words) carry the right 450 words?
- Is "life safety never above L1" too blunt — e.g. the emergency DELIVERY system itself runs
  autonomously by design; the ceiling is meant for CHANGES to it and for agent actions on it.
  Is the wording clear enough to prevent an agent from reading it either way?
- Cross-vendor review on consequential changes: cost vs value during launch week.
- Is a separate repo the right home, or does it fragment the rules?
- The intake deadline (7/14 days) and the "intake set" size — right?
- What should the FIRST automatic demotion rule be, and is "automatic" credible without tooling?
- Anything here that an engineer at the world's best org would call theatre.

## Appendix A — Codex's draft section list (the approved substance)

1 Mission · 2 Fundamental principle · 3 Applies to every application · 4 Build two things at once
· 5 Day-zero product definition · 6 Architect for change · 7 Security is foundational · 8
Security agent · 9 Continuous threat intelligence · 10 Software inventory · 11 Separation of
authority (11 agents) · 12 Multi-model development · 13 Consensus is not evidence · 14 Digital
twin · 15 Observability · 16 Software reports its own problems · 17 Universal incident pipeline ·
18 Support is engineering · 19 Customer communication · 20 Every bug creates permanent value ·
21 Human-supervised startup · 22 Don't expose raw reasoning · 23 Human feedback becomes policy ·
24 Autonomy ladder · 25 Trust is reversible · 26 Release philosophy · 27 Rollback · 28
Continuous product intelligence · 29 R&D never stops · 30 Frontier model intake · 31 Model
routing · 32 Our benchmarks · 33 Version everything · 34 Structured memory · 35 Auditability ·
36 Daily self-improvement loop · 37 Constitution never silently · 38 Weekly meta-review · 39
Monthly frontier review · 40 Replace old ideas · 41 Failure protocol · 42 Success protocol · 43
Universal metrics · 44 Non-negotiable truths · 45 Speed · 46 Better every day · 47 Every app
makes the next better · 48 End state · 49 Startup procedure · 50 First response. Plus the
"World-class ambition" insert: most useful / profitable / cutting-edge / creative / flexible;
safest and most trustworthy; competitor is not the target; 10× thinking; customer value is the
test; scorecard; the world-class loop; the ambition must improve; revised north star.
